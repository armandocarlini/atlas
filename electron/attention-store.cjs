const { buildAttention, parseItemId, snoozeUntil, DISMISSIBLE } = require('./attention.cjs');

// Leitura e gravação da fila "Precisam de mim" (docs/planos/PLANO_GESTAO_DE_ATENCAO.md).
// Sem migration: adiar e dispensar ficam em `app_state`, e cada ação vira evento de auditoria.
const SNOOZED_KEY = 'attention.snoozed';
const DISMISSED_KEY = 'attention.dismissed';
const LAST_CLOSE_KEY = 'last_normal_close_at';

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
      tasks: db.prepare(`SELECT id, project_id, title, state, updated_at, blocked_reason, assigned_session_id FROM tasks WHERE ${inProjects('project_id')}`).all(ids),
      runs: db.prepare(`SELECT r.id, r.session_id, r.state, r.reason, r.exit_code, r.signal, r.ended_at, r.attempt,
          s.project_id, s.name AS session_name, s.role AS session_role, s.removed_at AS session_removed_at
        FROM agent_runs r JOIN sessions s ON s.id = r.session_id WHERE ${inProjects('s.project_id')}`).all(ids),
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
    const result = buildAttention({
      now: now(), ...rows, autoNotes,
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

    // Só pedido que falhou e run que parou: o resto sai quando a entidade muda de estado.
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
