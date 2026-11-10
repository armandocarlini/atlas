import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWorkspaceTree,
  nextVisibleSessionId,
  normalizeTerminalLayout,
  sameWorkspacePath,
  sessionsInLayout,
  visibleWorkspaceSessions,
} from '../src/workspace-layout.js';

const projects = [{
  id: 'p1', name: 'ATLAS', path: 'C:\\work\\atlas',
  repositories: [{
    id: 'r1', name: 'atlas', worktrees: [
      { id: 'w1', path: 'C:\\work\\atlas', name: 'main' },
      { id: 'w2', path: 'C:\\work\\atlas-visual', name: 'visual' },
    ],
  }],
}];
const sessions = [
  { id: 'principal', projectId: 'p1', worktree: 'c:/work/atlas/' },
  { id: 'agente', projectId: 'p1', worktree: 'C:\\work\\atlas-visual' },
  { id: 'manual', projectId: 'p1', worktree: 'D:\\elsewhere' },
  { id: 'outro', projectId: 'p2', worktree: 'C:\\work\\atlas' },
];

test('árvore agrupa sessões por projeto e worktree sem diferenciar caixa ou barra final', () => {
  const [tree] = buildWorkspaceTree(projects, sessions);
  assert.equal(tree.sessionCount, 3);
  assert.deepEqual(tree.repositories[0].worktrees.map((item) => item.sessions.map((session) => session.id)), [['principal'], ['agente']]);
  assert.deepEqual(tree.sessions.map((session) => session.id), ['manual']);
});

test('sessão de outro projeto não aparece na árvore', () => {
  const [tree] = buildWorkspaceTree(projects, sessions);
  assert(!JSON.stringify(tree).includes('outro'));
});

test('caminhos vazios ou ausentes não são considerados a mesma worktree', () => {
  assert.equal(sameWorkspacePath('', ''), false);
  assert.equal(sameWorkspacePath(null, null), false);
  assert.equal(sameWorkspacePath('C:/work/atlas/', 'c:\\work\\atlas'), true);
});

test('ocultar remove só a apresentação e mantém as demais sessões', () => {
  assert.deepEqual(visibleWorkspaceSessions(sessions, ['agente']).map((session) => session.id), ['principal', 'manual', 'outro']);
  assert.equal(nextVisibleSessionId(sessions, ['principal', 'agente']), 'manual');
  assert.equal(nextVisibleSessionId(sessions, sessions.map((session) => session.id)), null);
});

test('spotlight e abas mostram uma sessão; grade e sidebar preservam todas as visíveis', () => {
  const options = { selectedId: 'agente', hiddenSessionIds: ['manual', 'outro'] };
  assert.deepEqual(sessionsInLayout(sessions, { ...options, layout: 'grid' }).map((session) => session.id), ['principal', 'agente']);
  assert.deepEqual(sessionsInLayout(sessions, { ...options, layout: 'sidebar' }).map((session) => session.id), ['agente', 'principal']);
  assert.deepEqual(sessionsInLayout(sessions, { ...options, layout: 'spotlight' }).map((session) => session.id), ['agente']);
  assert.deepEqual(sessionsInLayout(sessions, { ...options, layout: 'tabs' }).map((session) => session.id), ['agente']);
});

test('foco explícito vence a seleção no spotlight e seleção oculta cai na primeira visível', () => {
  assert.deepEqual(sessionsInLayout(sessions, { layout: 'spotlight', selectedId: 'agente', focusId: 'principal' }).map((session) => session.id), ['principal']);
  assert.deepEqual(sessionsInLayout(sessions, { layout: 'tabs', selectedId: 'agente', hiddenSessionIds: ['agente'] }).map((session) => session.id), ['principal']);
});

test('layout desconhecido volta à grade', () => {
  assert.equal(normalizeTerminalLayout('custom'), 'grid');
  assert.equal(normalizeTerminalLayout('sidebar'), 'sidebar');
});

test('layout lateral prioriza principal visível, ou seleção quando não há principal', () => {
  const items = [{ id: 'history', archived: true }, { id: 'agent' }, { id: 'lead', roleKind: 'orchestrator' }];
  assert.deepEqual(sessionsInLayout(items, { layout: 'sidebar', selectedId: 'agent' }).map(item => item.id), ['lead', 'history', 'agent']);
  assert.deepEqual(sessionsInLayout(items, { layout: 'sidebar', selectedId: 'agent', hiddenSessionIds: ['lead'] }).map(item => item.id), ['agent', 'history']);
  assert.deepEqual(sessionsInLayout([], { layout: 'sidebar' }), []);
});
