import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createOperationalStore } = require('../electron/operational-store.cjs');
const { createAttentionHost } = require('../electron/attention-host.cjs');

const START = Date.parse('2026-11-13T12:00:00.000Z');
const AUTHORIZED = ['/fixture/a', '/fixture/b'];

function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-attention-'));
  const filename = path.join(directory, 'attention.sqlite');
  const clock = { ms: START };
  const now = () => new Date(clock.ms).toISOString();
  const timers = [];
  const changes = [];
  const notes = new Map();
  let store;
  let handlers;
  function mount() {
    store = createOperationalStore({ filename, now });
    handlers = new Map();
    createAttentionHost({
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      projectHost: { isAllowedCwd: (cwd) => AUTHORIZED.includes(cwd) },
      store,
      isMainSender: (event) => event.sender === 'main',
      autoNoteFor: (requestId) => notes.get(requestId) ?? null,
      onChange: () => changes.push(now()),
      setTimer: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
      clearTimer: (timer) => { timer.cleared = true; },
      clock: () => clock.ms,
    });
    return store;
  }
  mount();
  for (const [id, name, projectPath] of [['project-a', 'Primeiro', '/fixture/a'], ['project-b', 'Segundo', '/fixture/b'], ['project-c', 'Fora', '/fixture/c']]) {
    store.registerProject({ id, name, path: projectPath });
  }
  t.after(() => {
    if (!store.closed) store.close();
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith('atlas-attention-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const api = {
    get store() { return store; },
    filename, clock, timers, changes, notes,
    advance: (minutes) => { clock.ms += minutes * 60000; },
    call: (name, request, sender = 'main') => handlers.get(name)({ sender }, request),
    list: () => handlers.get('attention:list')({ sender: 'main' }),
    reopen: () => { store.close(); return mount(); },
    raw(operation) {
      const db = new DatabaseSync(filename);
      try { return operation(db); } finally { db.close(); }
    },
    session(id, projectId, { role = 'agent', name = id } = {}) {
      return store.startSession({ id, projectId, name, adapterId: 'opencode', cli: 'opencode', version: '1.0.0', cwd: `/fixture/${projectId.slice(-1)}`, origin: role === 'orchestrator' ? 'user' : 'orchestrator', createdAt: now(), role });
    },
    requestAgent(projectId, key, name = 'Implementador') {
      return store.requestAgent({ projectId, requestedBy: `principal-${projectId.slice(-1)}`, name, purpose: 'Implementar a fila.', idempotencyKey: key });
    },
    task(projectId, key, state, fields = {}) {
      const created = store.createTask({ projectId, title: `Tarefa ${key}`, acceptance: 'Funciona', idempotencyKey: key });
      api.raw((db) => db.prepare('UPDATE tasks SET state = ?, blocked_reason = ?, updated_at = ? WHERE id = ?').run(state, fields.blockedReason ?? null, now(), created.id));
      return created.id;
    },
    review(projectId, taskId, requestedBy, suiteState = null) {
      const id = `review-${taskId.slice(0, 8)}`;
      api.raw((db) => {
        db.prepare("INSERT INTO reviews (id, project_id, task_id, requested_by, state, summary, created_at, version) VALUES (?, ?, ?, ?, 'pending', 'Pronto', ?, 1)").run(id, projectId, taskId, requestedBy, now());
        if (suiteState) db.prepare("INSERT INTO regression_runs (id, project_id, task_id, review_id, state, command, created_at, version) VALUES (?, ?, ?, ?, ?, 'npm test', ?, 1)").run(`suite-${id}`, projectId, taskId, id, suiteState, now());
      });
      return id;
    },
    appState: (key) => api.raw((db) => db.prepare('SELECT value FROM app_state WHERE key = ?').get(key)?.value ?? null),
    events: (type) => store.listEvents('project-a').concat(store.listEvents('project-b')).filter((event) => event.type === type),
  };
  return api;
}

const ids = (view) => view.items.map((item) => item.id);

test('lista itens dos dois projetos autorizados com projectId correto e ignora projeto fora das pastas', async (t) => {
  const h = harness(t);
  h.session('principal-a', 'project-a', { role: 'orchestrator' });
  h.session('principal-b', 'project-b', { role: 'orchestrator' });
  h.session('principal-c', 'project-c', { role: 'orchestrator' });
  const a = h.requestAgent('project-a', 'request-a-0001');
  h.advance(1);
  const b = h.requestAgent('project-b', 'request-b-0001');
  h.requestAgent('project-c', 'request-c-0001');
  const view = await h.list();
  assert.deepEqual(view.items.map((item) => [item.id, item.projectId, item.projectName]), [
    [`request_pending:${a.id}`, 'project-a', 'Primeiro'],
    [`request_pending:${b.id}`, 'project-b', 'Segundo'],
  ]);
  assert.deepEqual(view.projects.map((project) => project.projectId), ['project-a', 'project-b']);
  assert.equal(view.nextChangeAt, undefined, 'o horário interno não sai pela IPC');
  await assert.rejects(async () => h.call('attention:list', undefined, 'popup'), /não autorizada/);
  await assert.rejects(async () => h.call('attention:snooze', { itemId: `request_pending:${a.id}`, until: 'x' }, 'popup'), /não autorizada/);
  await assert.rejects(async () => h.call('attention:snooze', null), /Pedido inválido/);
  await assert.rejects(async () => h.call('attention:dismiss', { itemId: 42 }), /Campo inválido: itemId/);
});

test('pedido pendente mostra o motivo do modo autônomo; aprovado sai da fila; falha entra', async (t) => {
  const h = harness(t);
  h.session('principal-a', 'project-a', { role: 'orchestrator' });
  const request = h.requestAgent('project-a', 'request-a-0001');
  h.notes.set(request.id, 'Aguardando vaga: 2 de 2 agentes ativos.');
  assert.match((await h.list()).items[0].reason, /^Modo autônomo: Aguardando vaga/);
  h.store.approveAgentRequest({ projectId: 'project-a', requestId: request.id, payloadHash: request.payloadHash });
  assert.deepEqual(ids(await h.list()), []);
  h.store.completeAgentRequest({ projectId: 'project-a', requestId: request.id, error: 'CLI não encontrado' });
  const view = await h.list();
  assert.deepEqual(ids(view), [`request_failed:${request.id}`]);
  assert.equal(view.items[0].reason, 'CLI não encontrado');
});

test('suíte vermelha com revisão pendente gera um item só, alto; revisão normal fica normal', async (t) => {
  const h = harness(t);
  h.session('agent-a', 'project-a');
  const red = h.task('project-a', 'task-red-0001', 'in_review');
  const green = h.task('project-a', 'task-green-0001', 'in_review');
  const redReview = h.review('project-a', red, 'agent-a', 'timeout');
  h.review('project-a', green, 'agent-a', 'passed');
  const view = await h.list();
  assert.equal(view.items.filter((item) => item.taskId === red).length, 1);
  assert.deepEqual(view.items.map((item) => [item.kind, item.taskId, item.urgency]), [['review_pending', red, 'alta'], ['review_pending', green, 'normal']]);
  assert.equal(view.items[0].id, `review_pending:${redReview}`);
  assert.match(view.items[0].reason, /\(timeout\)/);
});

test('run encerrada pelo usuário, sessão desanexada e fechamento normal não geram item; falha e queda geram', async (t) => {
  const h = harness(t);
  // "Encerrar processo": o pedido é marcado antes de o processo sair com código diferente de zero.
  const stopped = h.session('agent-stopped', 'project-a');
  h.store.markRunStopRequested(stopped.id);
  h.store.finishRun({ runId: stopped.id, expectedVersion: stopped.version, exitCode: 1 });
  // Desanexar sessão externa fecha a run com código 0.
  const detached = h.store.startSession({ id: 'agent-external', projectId: 'project-a', name: 'Externa', adapterId: 'codex', cli: 'codex', version: '1', cwd: '/fixture/a', origin: 'user', createdAt: new Date(h.clock.ms).toISOString(), attachment: 'external' });
  h.store.finishRun({ runId: detached.id, expectedVersion: detached.version, exitCode: 0 });
  const failed = h.session('agent-failed', 'project-a');
  h.store.finishRun({ runId: failed.id, expectedVersion: failed.version, exitCode: 3 });
  // Queda: a run que estava ativa vira `lost` por reinício na abertura seguinte.
  const crashed = h.session('agent-crashed', 'project-b');
  h.store.reconcileRuns('application_restarted');
  // Fechamento normal: as runs ativas ficam `lost` com `application_closed`.
  h.session('agent-closed', 'project-a');
  h.store.markAppClosed([]);
  const view = await h.list();
  assert.deepEqual(ids(view).sort(), [`run_failed:${crashed.id}`, `run_failed:${failed.id}`].sort());
  const reasons = Object.fromEntries(h.raw((db) => db.prepare('SELECT session_id, state, reason FROM agent_runs').all()).map((row) => [row.session_id, `${row.state}/${row.reason}`]));
  assert.deepEqual(reasons, {
    'agent-stopped': 'failed/user_closed', 'agent-external': 'succeeded/null', 'agent-failed': 'failed/null',
    'agent-crashed': 'lost/application_restarted', 'agent-closed': 'lost/application_closed',
  });
  // Nova run da mesma sessão tira o item; excluir a sessão também.
  const retry = h.session('agent-failed', 'project-a');
  assert.deepEqual(ids(await h.list()), [`run_failed:${crashed.id}`]);
  h.store.finishRun({ runId: retry.id, expectedVersion: retry.version, exitCode: 0 });
  h.store.removeSession('agent-crashed');
  assert.deepEqual(ids(await h.list()), []);
});

test('adiar: some, volta após a data, avisa a interface e grava um evento por ação', async (t) => {
  const h = harness(t);
  const blocked = h.task('project-a', 'task-blocked-0001', 'blocked', { blockedReason: 'Sem acesso' });
  const itemId = `task_blocked:${blocked}`;
  const until = new Date(h.clock.ms + 30 * 60000).toISOString();
  const first = await h.call('attention:snooze', { itemId, until });
  assert.deepEqual(first, { itemId, until, changed: true });
  assert.equal(h.changes.length, 1);
  const repeated = await h.call('attention:snooze', { itemId, until });
  assert.equal(repeated.changed, false);
  assert.equal(h.events('attention.snoozed').length, 1);
  assert.deepEqual(h.events('attention.snoozed')[0].payload, { itemId, until, actor: 'user' });
  const hidden = await h.list();
  assert.deepEqual(ids(hidden), []);
  assert.equal(hidden.hidden.snoozed, 1);
  const timer = h.timers.at(-1);
  assert(!timer.cleared);
  assert(timer.delay >= 30 * 60000 && timer.delay < 31 * 60000);
  h.advance(31);
  timer.callback();
  assert.equal(h.changes.length, 2, 'o vencimento avisa a interface');
  assert.deepEqual(ids(await h.list()), [itemId]);
  assert.equal(h.appState('attention.snoozed'), '{}');
  await assert.rejects(async () => h.call('attention:snooze', { itemId, until: new Date(h.clock.ms - 1000).toISOString() }), /futuro/);
  await assert.rejects(async () => h.call('attention:snooze', { itemId: 'task_blocked:nao-existe', until: new Date(h.clock.ms + 60000).toISOString() }), /não está mais na fila/);
});

test('dispensar: recusado nos kinds que saem sozinhos, aceito em run_failed e request_failed', async (t) => {
  const h = harness(t);
  h.session('principal-a', 'project-a', { role: 'orchestrator' });
  const request = h.requestAgent('project-a', 'request-a-0001');
  const blocked = h.task('project-a', 'task-blocked-0001', 'blocked');
  const reviewTask = h.task('project-a', 'task-review-0001', 'in_review');
  const review = h.review('project-a', reviewTask, 'principal-a');
  const run = h.session('agent-a', 'project-a');
  h.store.finishRun({ runId: run.id, expectedVersion: run.version, exitCode: 1 });
  for (const itemId of [`request_pending:${request.id}`, `task_blocked:${blocked}`, `review_pending:${review}`]) {
    await assert.rejects(async () => h.call('attention:dismiss', { itemId }), /sai da fila sozinho/, itemId);
  }
  const dismissed = await h.call('attention:dismiss', { itemId: `run_failed:${run.id}` });
  assert.equal(dismissed.changed, true);
  assert.equal((await h.call('attention:dismiss', { itemId: `run_failed:${run.id}` })).changed, false);
  assert.equal(h.events('attention.dismissed').length, 1);
  const view = await h.list();
  assert(!ids(view).includes(`run_failed:${run.id}`));
  assert.equal(view.hidden.dismissed, 1);
  await assert.rejects(async () => h.call('attention:snooze', { itemId: `run_failed:${run.id}`, until: new Date(h.clock.ms + 60000).toISOString() }), /já foi dispensado/);
});

test('item resolvido deixa a lista e as entradas órfãs em app_state são limpas', async (t) => {
  const h = harness(t);
  h.session('principal-a', 'project-a', { role: 'orchestrator' });
  const request = h.requestAgent('project-a', 'request-a-0001');
  const itemId = `request_pending:${request.id}`;
  await h.call('attention:snooze', { itemId, until: new Date(h.clock.ms + 5 * 60000).toISOString() });
  assert.match(h.appState('attention.snoozed'), new RegExp(request.id));
  h.store.rejectAgentRequest({ projectId: 'project-a', requestId: request.id });
  assert.deepEqual(ids(await h.list()), []);
  assert.equal(h.appState('attention.snoozed'), '{}');
});

test('pedido pendente sai da fila quando expira e o horário da expiração é agendado', async (t) => {
  const h = harness(t);
  h.session('principal-a', 'project-a', { role: 'orchestrator' });
  h.requestAgent('project-a', 'request-a-0001');
  await h.list();
  const timer = h.timers.at(-1);
  assert(timer.delay >= 15 * 60000 && timer.delay < 16 * 60000);
  h.advance(16);
  assert.deepEqual(ids(await h.list()), []);
});

test('app_state com JSON corrompido não derruba a lista', async (t) => {
  const h = harness(t);
  const blocked = h.task('project-a', 'task-blocked-0001', 'blocked');
  h.raw((db) => {
    db.prepare("INSERT INTO app_state (key, value) VALUES ('attention.snoozed', '{')").run();
    db.prepare("INSERT INTO app_state (key, value) VALUES ('attention.dismissed', '[1,2]')").run();
    db.prepare("INSERT INTO app_state (key, value) VALUES ('last_normal_close_at', 'nao-e-json')").run();
  });
  const view = await h.list();
  assert.deepEqual(ids(view), [`task_blocked:${blocked}`]);
  assert.equal(view.lastVisitAt, null);
  assert.equal(h.appState('attention.snoozed'), '{}');
  assert.equal(h.appState('attention.dismissed'), '{}');
});

test('adiar e dispensar sobrevivem a fechar e reabrir o store', async (t) => {
  const h = harness(t);
  const blocked = h.task('project-a', 'task-blocked-0001', 'blocked');
  const run = h.session('agent-a', 'project-b');
  h.store.finishRun({ runId: run.id, expectedVersion: run.version, exitCode: 1 });
  await h.call('attention:snooze', { itemId: `task_blocked:${blocked}`, until: new Date(h.clock.ms + 60 * 60000).toISOString() });
  await h.call('attention:dismiss', { itemId: `run_failed:${run.id}` });
  h.reopen();
  const view = await h.list();
  assert.deepEqual(ids(view), []);
  assert.deepEqual(view.hidden, { snoozed: 1, dismissed: 1 });
  h.advance(61);
  h.reopen();
  assert.deepEqual(ids(await h.list()), [`task_blocked:${blocked}`]);
});

test('resumo: última visita é o último fechamento normal, mesmo sem runs ativas', async (t) => {
  const h = harness(t);
  const before = h.task('project-a', 'task-before-0001', 'done');
  assert.equal((await h.list()).lastVisitAt, null);
  h.advance(10);
  h.store.markAppClosed([]);
  const closedAt = new Date(h.clock.ms).toISOString();
  h.reopen();
  h.advance(5);
  const after = h.task('project-a', 'task-after-0001', 'done');
  const working = h.task('project-a', 'task-working-0001', 'in_progress');
  const stuck = h.task('project-b', 'task-stuck-0001', 'blocked');
  const view = await h.list();
  assert.equal(view.lastVisitAt, closedAt);
  const [a, b] = view.projects;
  assert.deepEqual(a.doneSinceLastVisit, { count: 1, taskIds: [after] });
  assert(!a.doneSinceLastVisit.taskIds.includes(before));
  assert.deepEqual(a.inProgress, { count: 1, taskIds: [working] });
  assert.deepEqual(b.blocked, { count: 1, taskIds: [stuck] });
  // Banco anterior, sem a chave: vale o fechamento registrado nas runs (migration 15).
  h.raw((db) => db.prepare("DELETE FROM app_state WHERE key = 'last_normal_close_at'").run());
  h.session('agent-a', 'project-a');
  h.advance(1);
  h.store.markAppClosed([]);
  h.raw((db) => db.prepare("DELETE FROM app_state WHERE key = 'last_normal_close_at'").run());
  assert.equal((await h.list()).lastVisitAt, new Date(h.clock.ms).toISOString());
});
