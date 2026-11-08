// Regras do Painel do Atlas, sem React, para testar em Node.

const TASK_STATE_LABELS = {
  backlog: 'backlog', ready: 'pronta', in_progress: 'em andamento', in_review: 'em revisão',
  blocked: 'bloqueada', done: 'concluída', canceled: 'cancelada',
};

function clip(text, size = 90) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > size ? `${value.slice(0, size - 1)}…` : value;
}

// O que espera o usuário, na ordem em que costuma destravar o trabalho:
// iniciar a principal, decidir pedidos de agente e concluir revisões.
export function atlasDecisions({ requests = [], tasks = [], reviews = [], needsPrincipal = false }) {
  const decisions = [];
  if (needsPrincipal) decisions.push({ id: 'principal', kind: 'principal', title: 'Iniciar a sessão principal', detail: 'Escolha o CLI e o modelo que vão planejar e delegar.' });
  for (const request of requests) {
    if (request.state !== 'pending') continue;
    decisions.push({ id: `request-${request.id}`, kind: 'request', targetId: request.id, title: `Novo agente: ${request.name}`, detail: clip(request.purpose) || 'Pedido da sessão principal.' });
  }
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const review of reviews) {
    const task = byId.get(review.taskId);
    if (review.state !== 'pending' || task?.state !== 'in_review') continue;
    decisions.push({ id: `review-${review.id}`, kind: 'review', targetId: task.id, title: `Revisar: ${clip(task.title, 60)}`, detail: `Pedida por ${review.requesterName || 'um agente'}. Só você conclui.` });
  }
  return decisions;
}

// A equipe agrupada pela tarefa que cada agente detém. A principal vem à parte.
export function teamByTask(sessions = [], tasks = []) {
  const principal = sessions.find((session) => session.roleKind === 'orchestrator') || null;
  const agents = sessions.filter((session) => session !== principal);
  const used = new Set();
  const groups = [];
  for (const task of tasks) {
    if (!task.assignedSessionId || task.state === 'done' || task.state === 'canceled') continue;
    const members = agents.filter((session) => session.id === task.assignedSessionId && !used.has(session.id));
    if (!members.length) continue;
    members.forEach((session) => used.add(session.id));
    groups.push({ task: { id: task.id, title: task.title, state: task.state, stateLabel: TASK_STATE_LABELS[task.state] || task.state }, members });
  }
  return { principal, groups, free: agents.filter((session) => !used.has(session.id)) };
}
