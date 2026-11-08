import assert from 'node:assert/strict';
import test from 'node:test';
import { atlasDecisions, teamByTask } from '../src/atlas-panel.js';

const tasks = [
  { id: 't1', title: 'Validar terminal', state: 'in_review', assignedSessionId: 'a1' },
  { id: 't2', title: 'Mensagens', state: 'in_progress', assignedSessionId: 'a2' },
  { id: 't3', title: 'Antiga', state: 'done', assignedSessionId: 'a3' },
  { id: 't4', title: 'Sem dono', state: 'backlog', assignedSessionId: null },
];

test('decisões: principal, pedidos pendentes e revisões pendentes, nessa ordem', () => {
  const decisions = atlasDecisions({
    needsPrincipal: true,
    requests: [{ id: 'r1', state: 'pending', name: 'revisor', purpose: '  Conferir   a tarefa ' }, { id: 'r2', state: 'approved', name: 'velho', purpose: 'x' }],
    tasks,
    reviews: [{ id: 'v1', taskId: 't1', state: 'pending', requesterName: 'exploracao' }, { id: 'v0', taskId: 't3', state: 'accepted' }],
  });
  assert.deepEqual(decisions.map((item) => item.id), ['principal', 'request-r1', 'review-v1']);
  assert.equal(decisions[1].detail, 'Conferir a tarefa');
  assert.equal(decisions[1].targetId, 'r1');
  assert.equal(decisions[2].targetId, 't1');
});

test('revisão pendente de tarefa que já saiu de revisão não espera o usuário', () => {
  const decisions = atlasDecisions({ tasks: [{ id: 't1', title: 'x', state: 'in_progress' }], reviews: [{ id: 'v1', taskId: 't1', state: 'pending' }] });
  assert.deepEqual(decisions, []);
});

test('propósito longo é cortado com reticências', () => {
  const [decision] = atlasDecisions({ requests: [{ id: 'r', state: 'pending', name: 'n', purpose: 'a'.repeat(200) }] });
  assert.equal(decision.detail.length, 90);
  assert(decision.detail.endsWith('…'));
});

test('equipe por tarefa: principal à parte, tarefas encerradas não agrupam, resto sem tarefa', () => {
  const sessions = [
    { id: 'p', roleKind: 'orchestrator' },
    { id: 'a1', roleKind: 'agent' }, { id: 'a2', roleKind: 'agent' }, { id: 'a3', roleKind: 'agent' }, { id: 'm', roleKind: 'agent' },
  ];
  const { principal, groups, free } = teamByTask(sessions, tasks);
  assert.equal(principal.id, 'p');
  assert.deepEqual(groups.map((group) => [group.task.id, group.task.stateLabel, group.members.map((item) => item.id)]), [['t1', 'em revisão', ['a1']], ['t2', 'em andamento', ['a2']]]);
  assert.deepEqual(free.map((item) => item.id), ['a3', 'm']);
});

test('sem principal e sem tarefas, todos ficam sem tarefa', () => {
  const { principal, groups, free } = teamByTask([{ id: 'x', roleKind: 'agent' }], []);
  assert.equal(principal, null);
  assert.deepEqual(groups, []);
  assert.deepEqual(free.map((item) => item.id), ['x']);
});
