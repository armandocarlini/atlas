const { randomUUID } = require('node:crypto');

// Revisão e conclusão de tarefas (marco 5a). O responsável pede revisão com uma
// declaração (resumo e comandos com exit code); o ATLAS anexa o retrato Git que
// ele mesmo coletou. Só a decisão do usuário conclui a tarefa ou pede ajustes.

const MAX_COMMANDS = 20;

function cleanText(label, value, { max, required = true }) {
  if (value === undefined && !required) return '';
  if (typeof value === 'string') value = value.replace(/\r\n/g, '\n');
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label}: informe texto válido com até ${max} caracteres.`);
  if (/\p{Cf}|[^\P{Cc}\n\t]/u.test(value)) throw new Error(`${label}: remova caracteres de controle ou formatação invisível.`);
  return value.trim();
}

function declaredCommands(commands = []) {
  if (!Array.isArray(commands) || commands.length > MAX_COMMANDS) throw new Error(`Comandos: informe uma lista com até ${MAX_COMMANDS} itens.`);
  return commands.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Comando ${index + 1} inválido.`);
    if (!Number.isInteger(item.exitCode) || item.exitCode < -1 || item.exitCode > 255) throw new Error(`Comando ${index + 1}: exit code deve ser um inteiro entre -1 e 255.`);
    return { command: cleanText(`Comando ${index + 1}`, item.command, { max: 300 }), exitCode: item.exitCode };
  });
}

const REVIEW_SELECT = `
  SELECT r.id, r.project_id AS projectId, r.task_id AS taskId, r.requested_by AS requestedBy, s.name AS requesterName,
    r.run_id AS runId, r.state, r.summary, r.created_at AS createdAt, r.decided_at AS decidedAt, r.decided_by AS decidedBy, r.note, r.version
  FROM reviews r JOIN sessions s ON s.id = r.requested_by`;

function createTaskReview({ db, now, event, transaction, requireClaim, getTask }) {
  const evidenceRow = (row) => ({ id: row.id, projectId: row.project_id, taskId: row.task_id, reviewId: row.review_id, kind: row.kind, source: row.source, sessionId: row.session_id, runId: row.run_id, payload: JSON.parse(row.payload), createdAt: row.created_at });
  const getReview = (projectId, reviewId) => {
    const row = db.prepare(`${REVIEW_SELECT} WHERE r.id = ? AND r.project_id = ?`).get(reviewId, projectId);
    return row && { ...row };
  };

  function recordEvidence({ projectId, taskId, reviewId, kind, source, sessionId = null, runId = null, payload, at }) {
    const id = randomUUID();
    db.prepare('INSERT INTO evidence (id, project_id, task_id, review_id, kind, source, session_id, run_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, projectId, taskId, reviewId, kind, source, sessionId, runId, JSON.stringify(payload), at);
    event({ projectId, sessionId, runId, type: 'evidence.recorded', payload: { evidenceId: id, taskId, reviewId, kind, source }, correlationId: reviewId, at });
    return id;
  }

  return {
    getReview,
    listReviews: (projectId) => db.prepare(`${REVIEW_SELECT} WHERE r.project_id = ? ORDER BY r.created_at, r.id`).all(projectId).map((row) => ({ ...row })),
    listEvidence: (projectId) => db.prepare('SELECT * FROM evidence WHERE project_id = ? ORDER BY created_at, rowid').all(projectId).map(evidenceRow),

    // `git` é o retrato coletado pelo host antes da transação, ou `{ unavailable }` com o motivo.
    requestReview({ projectId, taskId, sessionId, runId, summary, commands, git }) {
      const text = cleanText('Resumo', summary, { max: 2000 });
      const declared = declaredCommands(commands);
      return transaction(db, () => {
        const task = requireClaim(projectId, taskId, sessionId, runId);
        if (task.state !== 'in_progress') throw new Error('Resolva o bloqueio antes de pedir revisão.');
        const id = randomUUID();
        const at = now();
        db.prepare("INSERT INTO reviews (id, project_id, task_id, requested_by, run_id, state, summary, created_at, version) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 1)")
          .run(id, projectId, task.id, sessionId, runId, text, at);
        recordEvidence({ projectId, taskId: task.id, reviewId: id, kind: 'agent_report', source: 'agent', sessionId, runId, payload: { summary: text, commands: declared }, at });
        recordEvidence({ projectId, taskId: task.id, reviewId: id, kind: 'git_snapshot', source: 'system', payload: git, at });
        db.prepare("UPDATE tasks SET state = 'in_review', version = version + 1, updated_at = ? WHERE id = ?").run(at, task.id);
        event({ projectId, sessionId, runId, type: 'task.review_requested', payload: { taskId: task.id, reviewId: id }, correlationId: id, at });
        return getReview(projectId, id);
      });
    },

    // Decisão do usuário: aceitar conclui a tarefa; pedir ajustes devolve ao responsável.
    // `currentGit` é o retrato coletado de novo no momento do aceite: a worktree não
    // pode ter mudado desde o pedido de revisão, e o HEAD aceito vai para o evento.
    decideReview({ projectId, reviewId, decision, note, currentGit }) {
      if (!['accept', 'changes'].includes(decision)) throw new Error('Decisão inválida: use accept ou changes.');
      const text = cleanText('Nota da revisão', note, { max: 2000, required: decision === 'changes' });
      return transaction(db, () => {
        const review = typeof reviewId === 'string' && getReview(projectId, reviewId);
        if (!review) throw new Error('Revisão não encontrada neste projeto.');
        if (review.state !== 'pending') throw new Error(`A revisão já foi decidida (${review.state}).`);
        const task = getTask(projectId, review.taskId);
        if (task.state !== 'in_review') throw new Error(`A tarefa não está em revisão (${task.state}).`);
        const at = now();
        const evidenceIds = db.prepare('SELECT id FROM evidence WHERE review_id = ? ORDER BY created_at, rowid').all(review.id).map((row) => row.id);
        if (decision === 'accept') {
          const recorded = db.prepare("SELECT payload FROM evidence WHERE review_id = ? AND kind = 'git_snapshot'").get(review.id);
          const reviewed = recorded && JSON.parse(recorded.payload);
          let acceptedHeadCommit = null;
          if (reviewed && !reviewed.unavailable) {
            if (!currentGit || currentGit.unavailable) throw new Error('Não foi possível conferir a worktree agora. Tente de novo ou peça ajustes.');
            const changed = currentGit.headCommit !== reviewed.headCommit || currentGit.uncommittedFiles !== reviewed.uncommittedFiles
              || JSON.stringify(currentGit.diff) !== JSON.stringify(reviewed.diff);
            if (changed) throw new Error(`A worktree mudou desde o pedido de revisão (HEAD ${String(reviewed.headCommit).slice(0, 8)} → ${String(currentGit.headCommit).slice(0, 8)}). Peça ajustes para o agente pedir nova revisão.`);
            acceptedHeadCommit = currentGit.headCommit;
          }
          db.prepare("UPDATE reviews SET state = 'accepted', decided_at = ?, decided_by = 'user', note = ?, version = version + 1 WHERE id = ?").run(at, text || null, review.id);
          db.prepare("UPDATE tasks SET state = 'done', claim_run_id = NULL, blocked_reason = NULL, version = version + 1, updated_at = ? WHERE id = ?").run(at, task.id);
          event({ projectId, sessionId: task.assignedSessionId, type: 'task.completed', payload: { taskId: task.id, reviewId: review.id, actor: 'user', acceptance: task.acceptance, evidenceIds, acceptedHeadCommit }, correlationId: review.id, at });
        } else {
          db.prepare("UPDATE reviews SET state = 'changes_requested', decided_at = ?, decided_by = 'user', note = ?, version = version + 1 WHERE id = ?").run(at, text, review.id);
          db.prepare("UPDATE tasks SET state = 'in_progress', version = version + 1, updated_at = ? WHERE id = ?").run(at, task.id);
          event({ projectId, sessionId: task.assignedSessionId, type: 'task.changes_requested', payload: { taskId: task.id, reviewId: review.id, actor: 'user' }, correlationId: review.id, at });
        }
        return { review: getReview(projectId, review.id), task: getTask(projectId, task.id) };
      });
    },
  };
}

module.exports = { createTaskReview };
