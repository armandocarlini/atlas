const { buildAttention, parseItemId, snoozeUntil, DISMISSIBLE } = require('./attention.cjs');

// Leitura e gravação da fila "Precisam de mim" (docs/planos/PLANO_GESTAO_DE_ATENCAO.md).
// Sem migration: adiar e dispensar ficam em `app_state`, e cada ação vira evento de auditoria.
const SNOOZED_KEY = 'attention.snoozed';
const DISMISSED_KEY = 'attention.dismissed';
const LAST_CLOSE_KEY = 'last_normal_close_at';
const SINCE_KEY = 'attention.since';

function createAttentionStore({ db, now, event, transaction }) {
  const readState = (key) => db.prepare('SELECT value FROM app_state WHERE key = ?').get(key)?.value ?? null;
  const writeState = (key, value) => db.prepare(`INSERT INTO app_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value));

  // Último fechamento normal. Em bancos anteriores, o fechamento mais recente que a
  // migration 15 deixou nas runs (`application_closed`).
  function lastVisitAt() {
    const saved = readState(LAST_CLOSE_KEY);
    if (saved) {
      try {
        const value = JSON.parse(saved);
        if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
      } catch { /* valor corrompido: cai no registro das runs */ }
    }
    return db.prepare("SELECT max(ended_at) AS at FROM agent_runs WHERE state = 'lost' AND reason = 'application_closed'").get()?.at ?? null;
  }

  function sources(projectIds) {
    const ids = JSON.stringify([...new Set(projectIds)]);
    const inProjects = (column) => `${column} IN (SELECT value FROM json_each(?))`;
    return {
      projects: db.prepare(`SELECT id, name FROM projects WHERE ${inProjects('id')} ORDER BY created_at, id`).all(ids),
      requests: db.prepare(`SELECT id, project_id, requested_by, name, state, created_at, expires_at, resolved_at, session_id, error, task_id
        FROM agent_requests WHERE state IN ('pending', 'failed') AND ${inProjects('project_id')}`).all(ids),
      reviews: db.prepare(`SELECT r.id, r.project_id, r.task_id, r.requested_by, r.state, r.created_at, s.name AS requester_name
        FROM reviews r LEFT JOIN sessions s ON s.id = r.requested_by WHERE r.state = 'pending' AND ${inProjects('r.project_id')}`).all(ids),
      regressionRuns: db.prepare(`SELECT g.id, g.review_id, g.state FROM regression_runs g JOIN reviews r ON r.id = g.review_id
        WHERE r.state = 'pending' AND ${inProjects('g.project_id')}`).all(ids),
      tasks: db.prepare(`SELECT t.id, t.project_id, t.title, t.state, t.updated_at, t.blocked_reason, t.assigned_session_id, t.claim_run_id, t.claim_epoch,
          lost.run_id AS lost_run_id, lost.created_at AS lost_at
        FROM tasks t LEFT JOIN audit_events lost ON lost.sequence = (
          SELECT e.sequence FROM audit_events e
          WHERE t.state = 'in_progress' AND t.claim_run_id IS NULL AND e.project_id = t.project_id
            AND e.correlation_id = t.id AND e.type = 'task.claim_lost' AND e.session_id = t.assigned_session_id
            AND json_extract(e.payload, '$.epoch') = t.claim_epoch
          ORDER BY e.sequence DESC LIMIT 1
        ) WHERE ${inProjects('t.project_id')}`).all(ids),
      runs: db.prepare(`SELECT r.id, r.session_id, r.state, r.reason, r.exit_code, r.signal, r.ended_at, r.attempt,
          s.project_id, s.name AS session_name, s.role AS session_role, s.removed_at AS session_removed_at,
          s.attachment, coalesce(f.name, r.function_slug, CASE WHEN s.role = 'orchestrator' THEN 'Orquestrador' END) AS function_name,
          coalesce(json_extract(e.payload, '$.cli'), CASE WHEN r.adapter_id = s.adapter_id THEN s.cli END) AS session_cli
        FROM agent_runs r JOIN sessions s ON s.id = r.session_id
        LEFT JOIN agent_functions f ON f.slug = r.function_slug AND f.project_id IS NULL
        LEFT JOIN audit_events e ON e.sequence = (
          SELECT a.sequence FROM audit_events a WHERE a.project_id = s.project_id AND a.run_id = r.id AND a.type = 'run.started'
          ORDER BY a.sequence LIMIT 1
        ) WHERE ${inProjects('s.project_id')}`).all(ids),
      handoffs: db.prepare(`SELECT h.id, h.project_id, h.state, h.task_id, h.created_at, h.from_session_id, h.to_session_id,
          t.title AS task_title, sender.name AS from_name, recipient.name AS to_name
        FROM handoffs h JOIN tasks t ON t.id = h.task_id
        JOIN sessions sender ON sender.id = h.from_session_id JOIN sessions recipient ON recipient.id = h.to_session_id
        WHERE h.state = 'offered' AND t.state = 'ready' AND ${inProjects('h.project_id')}`).all(ids),
      unreadMessages: db.prepare(`SELECT m.id, m.project_id, m.subject, m.created_at, s.id AS session_id, s.name AS session_name,
          (SELECT other.id FROM messages other WHERE other.project_id = m.project_id AND other.to_session_id = s.id
            ORDER BY other.created_at DESC, other.rowid DESC LIMIT 1) AS latest_message_id
        FROM message_deliveries d JOIN messages m ON m.id = d.message_id JOIN sessions s ON s.id = d.session_id
        WHERE d.read_at IS NULL AND ${inProjects('m.project_id')}
          AND NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.session_id = s.id AND r.state = 'running')
        ORDER BY m.created_at DESC, m.rowid DESC`).all(ids),
    };
  }

  // Calcula a fila e limpa, na mesma transação, as entradas órfãs, vencidas ou inválidas.
  function compute({ projectIds, autoNoteFor }) {
    const rows = sources(projectIds);
    const autoNotes = {};
    if (typeof autoNoteFor === 'function') {
      for (const request of rows.requests) {
        if (request.state !== 'pending') continue;
        const note = autoNoteFor(request.id, request.project_id);
        if (typeof note === 'string' && note) autoNotes[request.id] = note;
      }
    }
    const at = now();
    const saved = readState(SINCE_KEY);
    let since = null;
    try { since = JSON.parse(saved); } catch { /* redefine marco inválido */ }
    if (typeof since !== 'string' || !Number.isFinite(Date.parse(since))) {
      since = at;
      if (rows.projects.length) writeState(SINCE_KEY, since);
    }
    const result = buildAttention({
      now: at, ...rows, autoNotes, since,
      snoozedRaw: readState(SNOOZED_KEY), dismissedRaw: readState(DISMISSED_KEY), lastVisitAt: lastVisitAt(),
    });
    if (result.prefsChanged.snoozed) writeState(SNOOZED_KEY, result.prefs.snoozed);
    if (result.prefsChanged.dismissed) writeState(DISMISSED_KEY, result.prefs.dismissed);
    return result;
  }

  function requireItem(result, itemId) {
    const parsed = parseItemId(itemId);
    if (!parsed) throw new Error('Item da fila inválido.');
    const found = result.all.find((entry) => entry.id === itemId);
    if (!found) throw new Error('Este item não está mais na fila.');
    return found;
  }

  return {
    listAttention({ projectIds = [], autoNoteFor } = {}) {
      return transaction(db, () => {
        const result = compute({ projectIds, autoNoteFor });
        return { ...result.view, nextChangeAt: result.nextChangeAt };
      });
    },

    // Some até a data e volta sozinho. A mesma data de novo não grava outro evento.
    snoozeAttention({ itemId, until, projectIds = [], autoNoteFor }) {
      return transaction(db, () => {
        const at = now();
        const date = snoozeUntil(until, at);
        const result = compute({ projectIds, autoNoteFor });
        const target = requireItem(result, itemId);
        if (result.prefs.dismissed[itemId]) throw new Error('Este item já foi dispensado.');
        if (result.prefs.snoozed[itemId] === date) return { itemId, until: date, changed: false };
        writeState(SNOOZED_KEY, { ...result.prefs.snoozed, [itemId]: date });
        event({ projectId: target.projectId, type: 'attention.snoozed', payload: { itemId, until: date, actor: 'user' }, correlationId: itemId, at });
        return { itemId, until: date, changed: true };
      });
    },

    // Dispensa a ocorrência e audita, sem alterar a entidade que gerou o item.
    dismissAttention({ itemId, projectIds = [], autoNoteFor }) {
      const parsed = parseItemId(itemId);
      if (!parsed) throw new Error('Item da fila inválido.');
      if (!DISMISSIBLE.includes(parsed.kind)) throw new Error('Este item sai da fila sozinho quando for resolvido; não é possível dispensá-lo.');
      return transaction(db, () => {
        const at = now();
        const result = compute({ projectIds, autoNoteFor });
        const target = requireItem(result, itemId);
        // Dispensar de novo não grava outro evento.
        if (result.prefs.dismissed[itemId]) return { itemId, dismissedAt: result.prefs.dismissed[itemId], changed: false };
        const { [itemId]: _snooze, ...snoozed } = result.prefs.snoozed;
        if (_snooze) writeState(SNOOZED_KEY, snoozed);
        writeState(DISMISSED_KEY, { ...result.prefs.dismissed, [itemId]: at });
        event({ projectId: target.projectId, type: 'attention.dismissed', payload: { itemId, actor: 'user' }, correlationId: itemId, at });
        return { itemId, dismissedAt: at, changed: true };
      });
    },
  };
}

module.exports = { createAttentionStore, SNOOZED_KEY, DISMISSED_KEY, LAST_CLOSE_KEY };
