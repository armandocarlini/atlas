// Fila "Precisam de mim" na navegação (docs/planos/PLANO_GESTAO_DE_ATENCAO.md, etapa 2).
// Os itens vêm prontos do processo principal (attention:list); aqui só se monta a
// apresentação. A única exceção é "Iniciar a sessão principal" do projeto ativo, que é
// estado do renderer e entra como item local, sem adiar nem dispensar.

const DISMISSIBLE = new Set(['request_failed', 'run_failed']);
export const PRINCIPAL_KIND = 'principal_start';

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// "Desde a última visita: 2 concluídas · 1 em andamento · 1 bloqueada · 3 esperam você".
// Zeros saem; sem última visita registrada, "concluídas" não aparece; tudo zero, nada.
export function summaryLine(view) {
  const total = (key) => (view?.projects || []).reduce((sum, project) => sum + (project?.[key]?.count || 0), 0);
  const parts = [
    view?.lastVisitAt ? [total('doneSinceLastVisit'), 'concluída', 'concluídas'] : null,
    [total('inProgress'), 'em andamento', 'em andamento'],
    [total('blocked'), 'bloqueada', 'bloqueadas'],
    [total('awaitingUser'), 'espera você', 'esperam você'],
  ].filter((part) => part && part[0] > 0).map(([count, one, many]) => plural(count, one, many));
  return parts.length ? `Desde a última visita: ${parts.join(' · ')}` : '';
}

// Contador da árvore e do trilho: itens da fila de cada projeto, de todos os projetos.
export function countByProject(items = []) {
  const counts = {};
  for (const item of items) {
    if (item?.projectId) counts[item.projectId] = (counts[item.projectId] || 0) + 1;
  }
  return counts;
}

// O item local da principal entra só no projeto ativo, à frente dos itens do host.
export function withPrincipalItem(items = [], { needsPrincipal = false, project = null } = {}) {
  if (!needsPrincipal || !project?.id) return items;
  return [{
    id: `local:principal:${project.id}`,
    kind: PRINCIPAL_KIND,
    local: true,
    projectId: project.id,
    projectName: project.name,
    taskId: null,
    sessionId: null,
    title: 'Iniciar a sessão principal',
    reason: 'Escolha o CLI e o modelo que vão planejar e delegar.',
    urgency: 'normal',
  }, ...items];
}

export const canDismiss = (item) => Boolean(item && !item.local && DISMISSIBLE.has(item.kind));
export const canSnooze = (item) => Boolean(item && !item.local);

// Datas de adiar no horário local: 1 h, 4 h e amanhã às 9h (o dia seguinte ao de agora).
export function snoozeOptions(now = new Date()) {
  const base = new Date(now);
  const tomorrow = new Date(base);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return [
    { id: 'hour', label: 'Adiar 1 hora', until: new Date(base.getTime() + 60 * 60 * 1000).toISOString() },
    { id: 'four-hours', label: 'Adiar 4 horas', until: new Date(base.getTime() + 4 * 60 * 60 * 1000).toISOString() },
    { id: 'tomorrow', label: 'Adiar até amanhã', until: tomorrow.toISOString() },
  ];
}

// Nome acessível completo, igual na lista larga e no trilho compacto.
export function itemDescription(item) {
  return [item.projectName, item.title, item.reason, item.urgency === 'alta' ? 'urgência alta' : ''].filter(Boolean).join(' · ');
}

export function countAnnouncement(count) {
  return count ? `${plural(count, 'item precisa', 'itens precisam')} de você` : 'Nada precisa de você agora.';
}

// Onde a decisão de cada item acontece.
export function attentionDestination(item) {
  if (!item) return null;
  if (item.kind === PRINCIPAL_KIND) return { kind: 'principal' };
  if (item.kind === 'request_pending' || item.kind === 'request_failed') return { kind: 'request', id: item.evidence?.id };
  if (item.kind === 'review_pending' || item.kind === 'task_blocked') return { kind: 'task', id: item.taskId };
  if (item.kind === 'run_failed') return { kind: 'session', id: item.sessionId };
  return null;
}

// Abrir um item de outro projeto: espera tarefas e pedidos DAQUELE projeto carregarem.
// 'wait' enquanto a carga não chegou, 'missing' se o alvo não existe mais, 'ready' para abrir.
export function attentionTargetStatus({ item, taskState, agentRequestState, sessions = [] }) {
  const destination = attentionDestination(item);
  if (!destination) return 'missing';
  if (destination.kind === 'session') return sessions.some((session) => session.id === destination.id) ? 'ready' : 'missing';
  if (destination.kind === 'principal') return 'ready';
  const tasksLoaded = taskState?.projectId === item.projectId && !taskState.loading;
  const requestsLoaded = agentRequestState?.projectId === item.projectId && Boolean(agentRequestState.policy || agentRequestState.error);
  if (!tasksLoaded || !requestsLoaded) return 'wait';
  if (destination.kind === 'request') {
    const request = (agentRequestState.items || []).find((entry) => entry.id === destination.id);
    const expected = item.kind === 'request_pending' ? 'pending' : 'failed';
    return request?.state === expected ? 'ready' : 'missing';
  }
  // A tarefa precisa continuar no estado que gerou o item.
  const expected = item.kind === 'review_pending' ? 'in_review' : 'blocked';
  return (taskState.items || []).some((task) => task.id === destination.id && task.state === expected) ? 'ready' : 'missing';
}
