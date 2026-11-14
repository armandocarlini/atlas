import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  summaryLine, countByProject, snoozeOptions, canDismiss, canSnooze,
  itemDescription, countAnnouncement, attentionDestination, attentionTargetStatus,
} from '../src/attention-queue.js';

const bucket = (...taskIds) => ({ count: taskIds.length, taskIds });
const project = (id, fields = {}) => ({ projectId: id, projectName: id, doneSinceLastVisit: bucket(), inProgress: bucket(), blocked: bucket(), awaitingUser: bucket(), ...fields });

test('resumo soma os projetos, omite zeros e usa singular e plural', () => {
  const view = {
    lastVisitAt: '2026-11-12T22:00:00.000Z',
    projects: [
      project('a', { doneSinceLastVisit: bucket('t1', 't2'), inProgress: bucket('t3'), awaitingUser: bucket('t4') }),
      project('b', { blocked: bucket('t5'), awaitingUser: bucket('t6', 't7') }),
    ],
  };
  assert.equal(summaryLine(view), 'Desde a última visita: 2 concluídas · 1 em andamento · 1 bloqueada · 3 esperam você');
  assert.equal(summaryLine({ ...view, projects: [project('a', { awaitingUser: bucket('t1') })] }), 'Desde a última visita: 1 espera você');
  assert.equal(summaryLine({ ...view, projects: [project('a', { inProgress: bucket('x', 'y') })] }), 'Desde a última visita: 2 em andamento');
});

test('resumo sem última visita omite concluídas; tudo zero não gera linha', () => {
  const projects = [project('a', { doneSinceLastVisit: bucket('t1'), blocked: bucket('t2', 't3') })];
  assert.equal(summaryLine({ lastVisitAt: null, projects }), 'Desde a última visita: 2 bloqueadas');
  assert.equal(summaryLine({ lastVisitAt: null, projects: [project('a', { doneSinceLastVisit: bucket('t1') })] }), '');
  assert.equal(summaryLine({ lastVisitAt: '2026-11-12T22:00:00.000Z', projects: [project('a')] }), '');
  assert.equal(summaryLine(null), '');
  assert.equal(summaryLine({ projects: [] }), '');
});

test('contagem por projeto vem dos itens de cada projectId, de todos os projetos', () => {
  const counts = countByProject([{ projectId: 'a' }, { projectId: 'b' }, { projectId: 'a' }, { projectId: null }, null]);
  assert.deepEqual(counts, { a: 2, b: 1 });
  assert.deepEqual(countByProject(), {});
});

test('apenas pendências do host contam, inclusive uma queda real da principal', () => {
  const items = [{ id: 'request_pending:r1', kind: 'request_pending', projectId: 'b' }];
  assert.deepEqual(countByProject(items), { b: 1 });
  assert.deepEqual(countByProject([...items, { kind: 'run_failed', projectId: 'a' }]), { a: 1, b: 1 });
  assert.equal(attentionDestination({ kind: 'principal_start' }), null);
});

test('dispensar só em request_failed e run_failed; adiar em todos os itens do host', () => {
  for (const kind of ['request_failed', 'run_failed']) assert.equal(canDismiss({ kind }), true, kind);
  for (const kind of ['request_pending', 'review_pending', 'task_blocked']) {
    assert.equal(canDismiss({ kind }), false, kind);
    assert.equal(canSnooze({ kind }), true, kind);
  }
});

test('datas de adiar: 1 h, 4 h e amanhã às 9h locais, inclusive na virada do dia', () => {
  const now = new Date(2026, 10, 13, 15, 20, 0);
  const [hour, four, tomorrow] = snoozeOptions(now);
  assert.deepEqual([hour.label, four.label, tomorrow.label], ['Adiar 1 hora', 'Adiar 4 horas', 'Adiar até amanhã']);
  assert.equal(Date.parse(hour.until) - now.getTime(), 60 * 60 * 1000);
  assert.equal(Date.parse(four.until) - now.getTime(), 4 * 60 * 60 * 1000);
  assert.equal(tomorrow.until, new Date(2026, 10, 14, 9, 0, 0).toISOString());
  // 22h30: 4 horas passam da meia-noite; "amanhã" continua sendo o dia seguinte às 9h.
  const late = new Date(2026, 10, 13, 22, 30, 0);
  const [, lateFour, lateTomorrow] = snoozeOptions(late);
  assert.equal(new Date(lateFour.until).getDate(), 14);
  assert.equal(lateTomorrow.until, new Date(2026, 10, 14, 9, 0, 0).toISOString());
  // 0h15: o dia seguinte é o próximo dia do calendário, não a manhã do mesmo dia.
  const [, , afterMidnight] = snoozeOptions(new Date(2026, 10, 14, 0, 15, 0));
  assert.equal(afterMidnight.until, new Date(2026, 10, 15, 9, 0, 0).toISOString());
  // Virada de mês e de ano.
  assert.equal(snoozeOptions(new Date(2026, 11, 31, 18, 0, 0))[2].until, new Date(2027, 0, 1, 9, 0, 0).toISOString());
});

test('descrição acessível completa e anúncio da contagem', () => {
  assert.equal(itemDescription({ projectName: 'ATLAS', title: 'Revisar: Fila', reason: 'A suíte falhou.', urgency: 'alta' }), 'ATLAS · Revisar: Fila · A suíte falhou. · urgência alta');
  assert.equal(itemDescription({ projectName: 'ATLAS', title: 'Bloqueada: X', reason: '', urgency: 'normal' }), 'ATLAS · Bloqueada: X');
  assert.equal(countAnnouncement(0), 'Nada precisa de você agora.');
  assert.equal(countAnnouncement(1), '1 item precisa de você');
  assert.equal(countAnnouncement(4), '4 itens precisam de você');
});

test('destino de cada kind', () => {
  assert.deepEqual(attentionDestination({ kind: 'request_pending', evidence: { type: 'agent_request', id: 'r1' } }), { kind: 'request', id: 'r1' });
  assert.deepEqual(attentionDestination({ kind: 'request_failed', evidence: { type: 'agent_request', id: 'r2' } }), { kind: 'request', id: 'r2' });
  assert.deepEqual(attentionDestination({ kind: 'review_pending', taskId: 't1', evidence: { type: 'regression_run', id: 'g1' } }), { kind: 'task', id: 't1' });
  assert.deepEqual(attentionDestination({ kind: 'task_blocked', taskId: 't2' }), { kind: 'task', id: 't2' });
  assert.deepEqual(attentionDestination({ kind: 'run_failed', sessionId: 's1' }), { kind: 'session', id: 's1' });
  assert.deepEqual(attentionDestination({ kind: 'task_orphaned', taskId: 't3' }), { kind: 'task', id: 't3' });
  assert.deepEqual(attentionDestination({ kind: 'handoff_stranded', taskId: 't4' }), { kind: 'task', id: 't4' });
  assert.deepEqual(attentionDestination({ kind: 'messages_stranded' }), { kind: 'messages' });
  assert.equal(attentionDestination({ kind: 'outro' }), null);
});

test('abrir item de outro projeto espera tarefas e pedidos daquele projeto', () => {
  const item = { kind: 'request_pending', projectId: 'b', evidence: { id: 'r1' } };
  const loadedTasks = { projectId: 'b', loading: false, items: [] };
  const loadedRequests = { projectId: 'b', policy: { mode: 'assisted' }, items: [{ id: 'r1', state: 'pending' }] };
  assert.equal(attentionTargetStatus({ item, taskState: { projectId: 'a', loading: false, items: [] }, agentRequestState: loadedRequests }), 'wait', 'tarefas ainda do projeto anterior');
  assert.equal(attentionTargetStatus({ item, taskState: { projectId: 'b', loading: true, items: [] }, agentRequestState: loadedRequests }), 'wait', 'tarefas carregando');
  assert.equal(attentionTargetStatus({ item, taskState: loadedTasks, agentRequestState: { projectId: 'b', policy: null, items: [] } }), 'wait', 'pedidos carregando');
  assert.equal(attentionTargetStatus({ item, taskState: loadedTasks, agentRequestState: loadedRequests }), 'ready');
  assert.equal(attentionTargetStatus({ item, taskState: loadedTasks, agentRequestState: { ...loadedRequests, items: [{ id: 'r1', state: 'approved' }] } }), 'missing', 'pedido já resolvido');
  assert.equal(attentionTargetStatus({ item, taskState: loadedTasks, agentRequestState: { projectId: 'b', policy: null, error: 'falhou', items: [] } }), 'missing', 'erro de carga não abre nada');
  const failed = { kind: 'request_failed', projectId: 'b', evidence: { id: 'r2' } };
  assert.equal(attentionTargetStatus({ item: failed, taskState: loadedTasks, agentRequestState: { ...loadedRequests, items: [{ id: 'r2', state: 'failed' }] } }), 'ready');
});

test('tarefa precisa continuar no estado do item; sessão precisa existir', () => {
  const taskState = { projectId: 'a', loading: false, items: [{ id: 't1', state: 'blocked' }, { id: 't2', state: 'in_review' }] };
  const agentRequestState = { projectId: 'a', policy: {}, items: [] };
  assert.equal(attentionTargetStatus({ item: { kind: 'task_blocked', projectId: 'a', taskId: 't1' }, taskState, agentRequestState }), 'ready');
  assert.equal(attentionTargetStatus({ item: { kind: 'review_pending', projectId: 'a', taskId: 't2' }, taskState, agentRequestState }), 'ready');
  assert.equal(attentionTargetStatus({ item: { kind: 'task_blocked', projectId: 'a', taskId: 't2' }, taskState, agentRequestState }), 'missing');
  assert.equal(attentionTargetStatus({ item: { kind: 'task_blocked', projectId: 'a', taskId: 'sumiu' }, taskState, agentRequestState }), 'missing');
  assert.equal(attentionTargetStatus({ item: { kind: 'run_failed', projectId: 'b', sessionId: 's1' }, sessions: [{ id: 's1' }] }), 'ready', 'sessão não espera tarefas');
  assert.equal(attentionTargetStatus({ item: { kind: 'run_failed', projectId: 'b', sessionId: 's9' }, sessions: [{ id: 's1' }] }), 'missing');
});
