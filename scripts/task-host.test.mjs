import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createOperationalStore, migrate, MIGRATIONS } = require('../electron/operational-store.cjs');
const { createTaskHost } = require('../electron/task-host.cjs');

function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-tasks-'));
  const filename = path.join(directory, 'tasks.sqlite');
  let store = createOperationalStore({ filename });
  const projects = [{ id: 'project-a', name: 'Primeiro', path: '/fixture/a' }, { id: 'project-b', name: 'Segundo', path: '/fixture/b' }];
  projects.forEach((project) => store.registerProject(project));
  const handlers = new Map();
  const projectHost = { ready: Promise.resolve(), isAllowedCwd: (cwd) => projects.some((project) => project.path === cwd), getProjectForCwd: (cwd) => projects.find((project) => project.path === cwd) };
  createTaskHost({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, projectHost, store, isMainSender: (event) => event.sender === 'main' });
  t.after(() => {
    store.close();
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith('atlas-tasks-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { store, filename, projectHost, call: (name, request, sender = 'main') => handlers.get(name)({ sender }, request), reopen: () => { store.close(); store = createOperationalStore({ filename }); return store; } };
}

const request = { cwd: '/fixture/a', title: 'Validar Unicode · revisão', description: 'Escopo da tarefa', acceptance: 'Resultado persiste após reinício', idempotencyKey: 'request-0001' };

test('criação via IPC persiste tarefa, comando e evento com ator e estado do núcleo', async (t) => {
  const { call, store, filename, reopen } = harness(t);
  const task = await call('task:create', { ...request, state: 'done', createdBy: 'orchestrator', projectId: 'project-b' });
  assert.equal(task.projectId, 'project-a');
  assert.equal(task.state, 'backlog');
  assert.equal(task.createdBy, 'user');
  assert.equal(task.acceptance, request.acceptance);
  assert.match(task.id, /^[0-9a-f-]{36}$/);
  assert.equal(store.listEvents('project-a').filter((event) => event.type === 'task.created').length, 1);
  const raw = new DatabaseSync(filename, { readOnly: true });
  try {
    const command = raw.prepare('SELECT status, target_id, correlation_id FROM commands').get();
    assert.equal(command.status, 'completed');
    assert.equal(command.target_id, task.id);
    assert.equal(store.listEvents('project-a').at(-1).correlation_id, command.correlation_id);
  } finally { raw.close(); }
  assert.deepEqual(reopen().listTasks('project-a'), [task]);
});

test('envios concorrentes com mesma chave não duplicam tarefa ou evento', async (t) => {
  const { call, store } = harness(t);
  const [first, second] = await Promise.all([call('task:create', request), call('task:create', request)]);
  assert.deepEqual(first, second);
  assert.equal(store.listTasks('project-a').length, 1);
  assert.equal(store.listEvents('project-a').filter((event) => event.type === 'task.created').length, 1);
  await assert.rejects(call('task:create', { ...request, title: 'Outro conteúdo' }), /outro conteúdo/);
});

test('projetos isolam listagem e chave de idempotência', async (t) => {
  const { call } = harness(t);
  const first = await call('task:create', request);
  const empty = await call('task:list', { cwd: '/fixture/b' });
  assert.equal(empty.items.length, 0);
  const second = await call('task:create', { ...request, cwd: '/fixture/b' });
  assert.notEqual(first.id, second.id);
  assert.deepEqual((await call('task:list', { cwd: '/fixture/a' })).items, [first]);
});

test('IPC recusa janela secundária, diretório não autorizado e projeto ausente', async (t) => {
  const { call, projectHost, store } = harness(t);
  await assert.rejects(call('task:create', request, 'popup'), /Janela não autorizada/);
  await assert.rejects(call('task:list', { cwd: '/fixture/a' }, 'popup'), /Janela não autorizada/);
  await assert.rejects(call('task:create', { ...request, cwd: '/outside' }), /pasta autorizada/);
  await assert.rejects(call('task:list', null), /pasta autorizada/);
  projectHost.getProjectForCwd = () => null;
  await assert.rejects(call('task:create', request), /Projeto não encontrado/);
  assert.equal(store.listTasks('project-a').length, 0);
});

test('textos vazios, tipos e limites são validados antes de gravar', async (t) => {
  const { call, store } = harness(t);
  for (const invalid of [
    { title: '   ' }, { title: 10 }, { title: 'a'.repeat(161) },
    { acceptance: '' }, { acceptance: [] }, { acceptance: 'a'.repeat(4001) },
    { description: null }, { description: 'a'.repeat(8001) }, { idempotencyKey: 'x' },
  ]) await assert.rejects(call('task:create', { ...request, ...invalid }), /texto válido|idempotência/);
  assert.equal(store.listTasks('project-a').length, 0);
  const maximal = await call('task:create', { ...request, title: 'a'.repeat(160), description: 'b'.repeat(8000), acceptance: 'c'.repeat(4000) });
  assert.equal(maximal.title.length, 160);
});

test('falha ao gravar evento reverte tarefa e comando; mesma chave pode ser tentada de novo', async (t) => {
  const { call, store, filename } = harness(t);
  const raw = new DatabaseSync(filename);
  try {
    raw.exec("CREATE TRIGGER fail_task_event BEFORE INSERT ON audit_events WHEN NEW.type = 'task.created' BEGIN SELECT RAISE(ABORT, 'disk unavailable'); END");
    await assert.rejects(call('task:create', request), /disk unavailable/);
    assert.equal(store.listTasks('project-a').length, 0);
    assert.equal(raw.prepare('SELECT count(*) AS count FROM commands').get().count, 0);
    raw.exec('DROP TRIGGER fail_task_event');
    assert((await call('task:create', request)).id);
  } finally { raw.close(); }
});

test('conteúdo de tarefa é tratado como texto, sem interpretar SQL', async (t) => {
  const { call } = harness(t);
  const task = await call('task:create', { ...request, title: "'); DROP TABLE tasks; --", description: '<script>example()</script>' });
  assert.equal((await call('task:list', { cwd: request.cwd })).items[0].title, task.title);
});

test('migration 1 para 2 preserva projetos, sessões, runs e eventos', (t) => {
  const { filename, store, reopen } = harness(t);
  store.close();
  const legacyFile = `${filename}.legacy`;
  const legacy = new DatabaseSync(legacyFile);
  try {
    migrate(legacy, [MIGRATIONS[0]]);
    legacy.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?)').run('legacy', 'Legado', '/fixture/legacy', '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z');
    legacy.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('old-session', 'legacy', 'Sessão anterior', 'kimi-code', 'Kimi Code', '2.3.2', '/fixture/legacy', 'user', '2026-10-26T00:00:00Z');
    legacy.prepare("INSERT INTO agent_runs (id, session_id, state, started_at) VALUES ('old-run', 'old-session', 'running', '2026-10-26T00:00:00Z')").run();
    legacy.prepare("INSERT INTO audit_events (id, project_id, session_id, run_id, type, correlation_id, payload, created_at) VALUES ('old-event', 'legacy', 'old-session', 'old-run', 'run.started', 'old-run', '{}', '2026-10-26T00:00:00Z')").run();
  } finally { legacy.close(); }
  const upgraded = createOperationalStore({ filename: legacyFile });
  try {
    assert.equal(upgraded.listProjects()[0].id, 'legacy');
    assert.equal(upgraded.listSessions('legacy')[0].id, 'old-session');
    assert.equal(upgraded.listRuns('legacy')[0].state, 'running');
    assert.equal(upgraded.listEvents('legacy')[0].id, 'old-event');
    assert(upgraded.createTask({ ...request, projectId: 'legacy' }).id);
    assert.equal(upgraded.listTasks('legacy').length, 1);
  } finally { upgraded.close(); }
  reopen();
});
