const { randomUUID, createHash } = require('node:crypto');

// Delegação de tarefas por handoff (marco 4c-1). A principal oferece, o agente de
// destino aceita pelo token da sua run e passa a deter o claim. Toda escrita do
// responsável exige o claim atual (sessão + run); `claim_epoch` cresce a cada
// aceite ou devolução para invalidar donos anteriores.

const OPEN_FOR_OFFER = ['backlog', 'ready'];
const CLAIMED = ['in_progress', 'blocked'];

// Texto escrito por agentes e exibido ao usuário e a outros agentes.
function agentText(label, value, { max, required = true }) {
  if (value === undefined && !required) return '';
  // Quebras de linha do Windows (CRLF) viram LF antes da validação.
  if (typeof value === 'string') value = value.replace(/\r\n/g, '\n');
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label}: informe texto válido com até ${max} caracteres.`);
  if (/\p{Cf}|[^\P{Cc}\n\t]/u.test(value)) throw new Error(`${label}: remova caracteres de controle ou formatação invisível.`);
  return value.trim();
}

const TASK_SELECT = `
  SELECT t.id, t.project_id AS projectId, t.title, t.description, t.acceptance, t.state, t.version,
    t.created_by AS createdBy, t.created_at AS createdAt, t.updated_at AS updatedAt,
    t.assigned_session_id AS assignedSessionId, assignee.name AS assigneeName,
    t.claim_run_id AS claimRunId, t.claim_epoch AS claimEpoch, t.blocked_reason AS blockedReason
  FROM tasks t LEFT JOIN sessions assignee ON assignee.id = t.assigned_session_id`;

const HANDOFF_SELECT = `
  SELECT h.id, h.project_id AS projectId, h.task_id AS taskId, task.title AS taskTitle,
    h.from_session_id AS fromSessionId, origin.name AS fromName,
    h.to_session_id AS toSessionId, target.name AS toName,
    h.objective, h.context, h.next_steps AS nextSteps, h.state,
    h.created_at AS createdAt, h.resolved_at AS resolvedAt, h.resolved_by AS resolvedBy, h.reason, h.version
  FROM handoffs h
  JOIN tasks task ON task.id = h.task_id
  JOIN sessions origin ON origin.id = h.from_session_id
  JOIN sessions target ON target.id = h.to_session_id`;

function createTaskDelegation({ db, now, event, transaction }) {
  const plain = (row) => row && { ...row };
  const getTask = (projectId, taskId) => plain(db.prepare(`${TASK_SELECT} WHERE t.id = ? AND t.project_id = ?`).get(taskId, projectId));
  const getHandoff = (projectId, handoffId) => plain(db.prepare(`${HANDOFF_SELECT} WHERE h.id = ? AND h.project_id = ?`).get(handoffId, projectId));
  const session = (projectId, sessionId) => db.prepare('SELECT id, role FROM sessions WHERE id = ? AND project_id = ?').get(sessionId, projectId);
  const activeRun = (sessionId) => db.prepare("SELECT id FROM agent_runs WHERE session_id = ? AND state = 'running'").get(sessionId);

  function requireTask(projectId, taskId) {
    const task = typeof taskId === 'string' && getTask(projectId, taskId);
    if (!task) throw new Error('Tarefa não encontrada neste projeto.');
    return task;
  }

  function requireOffered(projectId, handoffId) {
    const handoff = typeof handoffId === 'string' && getHandoff(projectId, handoffId);
    if (!handoff) throw new Error('Handoff não encontrado neste projeto.');
    if (handoff.state !== 'offered') throw new Error(`O handoff já foi resolvido (${handoff.state}).`);
    return handoff;
  }

  // Fencing: só a sessão responsável, na run que detém o claim, escreve na tarefa.
  function requireClaim(projectId, taskId, sessionId, runId) {
    const task = requireTask(projectId, taskId);
    if (task.assignedSessionId !== sessionId) throw new Error('Esta sessão não é responsável pela tarefa.');
    if (!task.claimRunId || task.claimRunId !== runId) throw new Error('O claim desta tarefa não pertence à run atual. Peça ao usuário para devolver a tarefa.');
    if (!CLAIMED.includes(task.state)) throw new Error(`A tarefa não está em andamento (${task.state}).`);
    return task;
  }

  function touchTask(id, at, changes) {
    const columns = Object.keys(changes);
    db.prepare(`UPDATE tasks SET ${columns.map((column) => `${column} = ?`).join(', ')}, version = version + 1, updated_at = ? WHERE id = ?`)
      .run(...columns.map((column) => changes[column]), at, id);
  }

  return {
    getTask,
    listTasks: (projectId) => db.prepare(`${TASK_SELECT} WHERE t.project_id = ? ORDER BY t.created_at, t.id`).all(projectId).map(plain),
    getHandoff,
    listHandoffs: (projectId) => db.prepare(`${HANDOFF_SELECT} WHERE h.project_id = ? ORDER BY h.created_at, h.id`).all(projectId).map(plain),

    offerHandoff(request) {
      const payload = {
        taskId: request.taskId,
        toSessionId: request.toSessionId,
        objective: agentText('Objetivo', request.objective, { max: 2000 }),
        context: agentText('Contexto', request.context, { max: 4000, required: false }),
        nextSteps: agentText('Próximos passos', request.nextSteps, { max: 2000, required: false }),
      };
      const actor = `agent:${request.fromSessionId}`;
      const encoded = JSON.stringify({ ...payload, fromSessionId: request.fromSessionId });
      const hash = createHash('sha256').update(encoded).digest('hex');
      return transaction(db, () => {
        const previous = db.prepare('SELECT payload_hash, result FROM commands WHERE project_id = ? AND idempotency_key = ?').get(request.projectId, request.idempotencyKey);
        if (previous) {
          if (previous.payload_hash !== hash) throw new Error('Chave de idempotência já usada com outro conteúdo.');
          return getHandoff(request.projectId, JSON.parse(previous.result).id);
        }
        const from = session(request.projectId, request.fromSessionId);
        if (!from || from.role !== 'orchestrator') throw new Error('Somente a sessão principal deste projeto delega tarefas.');
        const to = typeof payload.toSessionId === 'string' && session(request.projectId, payload.toSessionId);
        if (!to) throw new Error('A sessão de destino não pertence a este projeto.');
        if (to.role !== 'agent') throw new Error('Delegue para uma sessão de agente, não para a sessão principal.');
        if (!activeRun(to.id)) throw new Error('A sessão de destino não está em execução.');
        const task = requireTask(request.projectId, payload.taskId);
        if (!OPEN_FOR_OFFER.includes(task.state) || task.assignedSessionId) throw new Error(`A tarefa não está disponível para delegação (${task.state}).`);
        if (db.prepare("SELECT 1 FROM handoffs WHERE task_id = ? AND state = 'offered'").get(task.id)) throw new Error('Já existe uma oferta aberta para esta tarefa.');
        const id = randomUUID();
        const commandId = randomUUID();
        const at = now();
        db.prepare(`INSERT INTO handoffs (id, project_id, task_id, from_session_id, to_session_id, objective, context, next_steps, state, created_at, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'offered', ?, 1)`).run(id, request.projectId, task.id, from.id, to.id, payload.objective, payload.context, payload.nextSteps, at);
        if (task.state === 'backlog') {
          touchTask(task.id, at, { state: 'ready' });
          event({ projectId: request.projectId, sessionId: from.id, type: 'task.ready', payload: { taskId: task.id }, correlationId: commandId, at });
        }
        db.prepare('INSERT INTO commands VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(commandId, request.projectId, 'handoff.offer', id, encoded, hash, request.idempotencyKey, 'completed', actor, at, at, JSON.stringify({ id }), commandId);
        event({ projectId: request.projectId, sessionId: to.id, type: 'handoff.offered', payload: { handoffId: id, taskId: task.id, fromSessionId: from.id, actor }, correlationId: commandId, at });
        return getHandoff(request.projectId, id);
      });
    },

    acceptHandoff({ projectId, handoffId, sessionId, runId }) {
      return transaction(db, () => {
        const handoff = requireOffered(projectId, handoffId);
        if (handoff.toSessionId !== sessionId) throw new Error('Somente a sessão de destino aceita este handoff.');
        if (activeRun(sessionId)?.id !== runId) throw new Error('A run desta sessão não está ativa.');
        const task = requireTask(projectId, handoff.taskId);
        if (task.state !== 'ready' || task.assignedSessionId) throw new Error(`A tarefa não está disponível (${task.state}).`);
        const at = now();
        const epoch = task.claimEpoch + 1;
        db.prepare("UPDATE handoffs SET state = 'accepted', resolved_at = ?, resolved_by = ?, version = version + 1 WHERE id = ?").run(at, `agent:${sessionId}`, handoff.id);
        touchTask(task.id, at, { state: 'in_progress', assigned_session_id: sessionId, claim_run_id: runId, claim_epoch: epoch, blocked_reason: null });
        event({ projectId, sessionId, runId, type: 'handoff.accepted', payload: { handoffId: handoff.id, taskId: task.id }, correlationId: handoff.id, at });
        event({ projectId, sessionId, runId, type: 'task.assigned', payload: { taskId: task.id, epoch }, correlationId: handoff.id, at });
        return { handoff: getHandoff(projectId, handoff.id), task: getTask(projectId, task.id) };
      });
    },

    rejectHandoff({ projectId, handoffId, sessionId, reason }) {
      const note = agentText('Motivo', reason, { max: 1000 });
      return transaction(db, () => {
        const handoff = requireOffered(projectId, handoffId);
        if (handoff.toSessionId !== sessionId) throw new Error('Somente a sessão de destino recusa este handoff.');
        const at = now();
        db.prepare("UPDATE handoffs SET state = 'rejected', resolved_at = ?, resolved_by = ?, reason = ?, version = version + 1 WHERE id = ?").run(at, `agent:${sessionId}`, note, handoff.id);
        event({ projectId, sessionId, type: 'handoff.rejected', payload: { handoffId: handoff.id, taskId: handoff.taskId }, correlationId: handoff.id, at });
        return getHandoff(projectId, handoff.id);
      });
    },

    // Cancelada pelo usuário na interface ou pela principal que ofereceu.
    cancelHandoff({ projectId, handoffId, actor }) {
      return transaction(db, () => {
        const handoff = requireOffered(projectId, handoffId);
        if (actor !== 'user' && actor !== `agent:${handoff.fromSessionId}`) throw new Error('Somente o usuário ou a sessão que ofereceu cancelam este handoff.');
        const at = now();
        db.prepare("UPDATE handoffs SET state = 'canceled', resolved_at = ?, resolved_by = ?, version = version + 1 WHERE id = ?").run(at, actor, handoff.id);
        event({ projectId, sessionId: handoff.toSessionId, type: 'handoff.canceled', payload: { handoffId: handoff.id, taskId: handoff.taskId, actor }, correlationId: handoff.id, at });
        return getHandoff(projectId, handoff.id);
      });
    },

    updateTask({ projectId, taskId, sessionId, runId, kind, note }) {
      if (!['progress', 'blocked', 'resumed'].includes(kind)) throw new Error('Tipo de atualização inválido: use progress, blocked ou resumed.');
      const text = agentText('Nota', note, { max: 2000 });
      return transaction(db, () => {
        const task = requireClaim(projectId, taskId, sessionId, runId);
        const at = now();
        const payload = { taskId: task.id, epoch: task.claimEpoch, note: text };
        if (kind === 'progress') {
          event({ projectId, sessionId, runId, type: 'task.progress', payload, correlationId: task.id, at });
        } else if (kind === 'blocked') {
          if (task.state !== 'in_progress') throw new Error('A tarefa já está bloqueada.');
          touchTask(task.id, at, { state: 'blocked', blocked_reason: text });
          event({ projectId, sessionId, runId, type: 'task.blocked', payload, correlationId: task.id, at });
        } else {
          if (task.state !== 'blocked') throw new Error('A tarefa não está bloqueada.');
          touchTask(task.id, at, { state: 'in_progress', blocked_reason: null });
          event({ projectId, sessionId, runId, type: 'task.unblocked', payload, correlationId: task.id, at });
        }
        return getTask(projectId, task.id);
      });
    },

    // Devolução pelo responsável (com claim atual) ou pelo usuário a qualquer momento.
    releaseTask({ projectId, taskId, actor, sessionId = null, runId = null, reason = '' }) {
      const text = actor === 'user' ? '' : agentText('Motivo', reason, { max: 1000 });
      return transaction(db, () => {
        const task = actor === 'user' ? requireTask(projectId, taskId) : requireClaim(projectId, taskId, sessionId, runId);
        if (actor !== 'user' && actor !== `agent:${sessionId}`) throw new Error('Ator de devolução inválido.');
        if (!CLAIMED.includes(task.state) || !task.assignedSessionId) throw new Error(`A tarefa não está com um responsável (${task.state}).`);
        const at = now();
        touchTask(task.id, at, { state: 'ready', assigned_session_id: null, claim_run_id: null, claim_epoch: task.claimEpoch + 1, blocked_reason: null });
        event({ projectId, sessionId: task.assignedSessionId, type: 'task.released', payload: { taskId: task.id, actor, previousEpoch: task.claimEpoch, reason: text }, correlationId: task.id, at });
        return getTask(projectId, task.id);
      });
    },

    // Chamado dentro da transação que encerra ou reconcilia a run. A tarefa mantém
    // estado e responsável: o trabalho real é incerto e cabe ao usuário decidir.
    // Ofertas ainda abertas para a sessão são canceladas: sessões de agente não
    // ganham nova run, então nunca poderiam aceitar e prenderiam a tarefa.
    loseClaims(runId, at) {
      const tasks = db.prepare('SELECT id, project_id, assigned_session_id, claim_epoch FROM tasks WHERE claim_run_id = ?').all(runId);
      for (const task of tasks) {
        db.prepare('UPDATE tasks SET claim_run_id = NULL, version = version + 1, updated_at = ? WHERE id = ?').run(at, task.id);
        event({ projectId: task.project_id, sessionId: task.assigned_session_id, runId, type: 'task.claim_lost', payload: { taskId: task.id, epoch: task.claim_epoch }, correlationId: task.id, at });
      }
      const sessionId = db.prepare('SELECT session_id FROM agent_runs WHERE id = ?').get(runId)?.session_id;
      const offers = db.prepare("SELECT id, project_id, task_id FROM handoffs WHERE to_session_id = ? AND state = 'offered'").all(sessionId);
      for (const offer of offers) {
        db.prepare("UPDATE handoffs SET state = 'canceled', resolved_at = ?, resolved_by = 'system', reason = ?, version = version + 1 WHERE id = ?").run(at, 'A sessão de destino encerrou antes de responder.', offer.id);
        event({ projectId: offer.project_id, sessionId, runId, type: 'handoff.canceled', payload: { handoffId: offer.id, taskId: offer.task_id, actor: 'system' }, correlationId: offer.id, at });
      }
    },
  };
}

module.exports = { createTaskDelegation };
