import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { planWorktree, createWorktree } = require('../electron/worktree-manager.cjs');
const { createOperationalStore, migrate, MIGRATIONS } = require('../electron/operational-store.cjs');
const { createAgentRequestHost } = require('../electron/agent-request-host.cjs');

const TASK_ID = '3f2a9c1b-7d4e-4a10-9b2c-0123456789ab';

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=ATLAS Teste', '-c', 'user.email=teste@atlas.invalid', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function repository(t, { commit = true } = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-worktree-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repo = path.join(directory, 'projeto');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', '--initial-branch=main');
  if (commit) {
    fs.writeFileSync(path.join(repo, 'LEIA.md'), 'fixture\n');
    git(repo, 'add', 'LEIA.md');
    git(repo, 'commit', '--quiet', '-m', 'inicial');
  }
  return { directory, repo, project: { id: 'project-a', path: repo, repositories: [{ path: repo }] } };
}

test('plano é determinístico pela tarefa, ao lado do repositório e fora dele', (t) => {
  const { repo, project } = repository(t);
  const plan = planWorktree({ project, taskId: TASK_ID });
  assert.deepEqual(plan, { repositoryPath: repo, path: path.join(`${repo}.atlas-worktrees`, 'task-3f2a9c1b'), branch: 'atlas/task-3f2a9c1b' });
  assert.throws(() => planWorktree({ project: { repositories: [] }, taskId: TASK_ID }), /não tem repositório Git/);
  assert.throws(() => planWorktree({ project: { repositories: [{ path: repo }, { path: `${repo}-2` }] }, taskId: TASK_ID }), /mais de um repositório/);
  assert.throws(() => planWorktree({ project, taskId: '../../x' }), /Identificador de tarefa inválido/);
});

test('cria worktree real na branch da tarefa a partir do HEAD', async (t) => {
  const { repo, project } = repository(t);
  const head = git(repo, 'rev-parse', 'HEAD');
  const created = await createWorktree(planWorktree({ project, taskId: TASK_ID }));
  assert.equal(created.baseCommit, head);
  assert.equal(git(created.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'atlas/task-3f2a9c1b');
  assert.equal(git(created.path, 'rev-parse', 'HEAD'), head);
  assert(fs.existsSync(path.join(created.path, 'LEIA.md')));
  assert(git(repo, 'worktree', 'list', '--porcelain').includes(created.path.replaceAll('\\', '/')) || git(repo, 'worktree', 'list').includes(path.basename(created.path)));
  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'repositório principal permanece na branch original');
});

test('caminho ou branch existentes e repositório sem commit recusam sem alterar nada', async (t) => {
  const { repo, project } = repository(t);
  const plan = planWorktree({ project, taskId: TASK_ID });
  fs.mkdirSync(plan.path, { recursive: true });
  fs.writeFileSync(path.join(plan.path, 'do-usuario.txt'), 'não tocar');
  await assert.rejects(createWorktree(plan), /caminho da worktree já existe/);
  assert.equal(fs.readFileSync(path.join(plan.path, 'do-usuario.txt'), 'utf8'), 'não tocar');
  fs.rmSync(plan.path, { recursive: true });
  git(repo, 'branch', 'atlas/task-3f2a9c1b');
  await assert.rejects(createWorktree(plan), /branch atlas\/task-3f2a9c1b já existe/);
  assert(!fs.existsSync(plan.path));
  await assert.rejects(createWorktree({ ...plan, branch: 'main' }), /fora da política/);
  const empty = repository(t, { commit: false });
  await assert.rejects(createWorktree(planWorktree({ project: empty.project, taskId: TASK_ID })), /ainda não tem commit/);
});

function hostHarness(t, { adapterError = null, createAgent, worktrees } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-worktree-requests-'));
  const store = createOperationalStore({ filename: path.join(directory, 'requests.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const project = { id: 'project-a', name: 'Projeto', path: '/fixture/a', repositories: [{ path: '/fixture/a' }] };
  store.registerProject(project);
  store.registerProject({ id: 'project-b', name: 'Outro', path: '/fixture/b' });
  const session = (id, projectId, role) => store.startSession({ id, projectId, name: id, adapterId: 'kimi-code', cli: 'Kimi Code', version: '2.3.3', cwd: `/fixture/${projectId.slice(-1)}`, origin: 'user', createdAt: new Date().toISOString(), role });
  session('principal', 'project-a', 'orchestrator');
  session('principal-b', 'project-b', 'orchestrator');
  const allowed = new Set(['/fixture/a']);
  const calls = [];
  const projectHost = {
    ready: Promise.resolve(),
    refresh: async () => { calls.push('refresh'); for (const item of created) allowed.add(item); },
    isAllowedCwd: (cwd) => allowed.has(cwd),
    getProjectForCwd: (cwd) => (cwd === '/fixture/a' ? project : null),
  };
  const created = [];
  const fakeWorktrees = worktrees || {
    planWorktree: ({ taskId }) => ({ repositoryPath: '/fixture/a', path: `/fixture/a.atlas-worktrees/task-${taskId.slice(0, 8)}`, branch: `atlas/task-${taskId.slice(0, 8)}` }),
    createWorktree: async (plan) => { calls.push('create'); created.push(plan.path); return { ...plan, baseCommit: 'abc1234def' }; },
  };
  const spawns = [];
  const agentHost = {
    countActive: () => 0,
    requireAdapter: async () => { calls.push('adapter'); if (adapterError) throw new Error(adapterError); },
    createAgent: createAgent || (async (request, options) => { spawns.push(request); session('criado', 'project-a', 'agent'); return { id: 'criado', name: request.name, cwd: request.cwd, origin: options.origin }; }),
  };
  const handlers = new Map();
  createAgentRequestHost({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, projectHost, store, isMainSender: () => true, agentHost, worktrees: fakeWorktrees });
  const task = store.createTask({ projectId: 'project-a', title: 'Corrigir ANSI', acceptance: 'Regressão passa', idempotencyKey: 'tarefa-wt-0001' });
  const ask = (overrides = {}) => store.requestAgent({ projectId: 'project-a', requestedBy: 'principal', name: 'executor', purpose: 'Executar a tarefa em worktree.', taskId: task.id, worktree: true, idempotencyKey: `pedido-${Math.random().toString(16).slice(2, 10)}`, ...overrides });
  const approve = (request) => handlers.get('agent-request:approve')({}, { cwd: '/fixture/a', requestId: request.id, payloadHash: request.payloadHash });
  return { store, task, ask, approve, calls, spawns };
}

test('pedido com worktree exige tarefa válida do projeto e uma worktree por tarefa', (t) => {
  const { store, task, ask } = hostHarness(t);
  assert.throws(() => ask({ taskId: undefined }), /Worktree exige a tarefa/);
  assert.throws(() => ask({ taskId: 'inexistente' }), /Tarefa não encontrada/);
  assert.throws(() => ask({ worktree: 'sim' }), /verdadeiro ou falso/);
  const other = store.createTask({ projectId: 'project-b', title: 'Alheia', acceptance: 'Aceite', idempotencyKey: 'tarefa-wt-0002' });
  assert.throws(() => ask({ taskId: other.id }), /Tarefa não encontrada/);
  const request = ask();
  assert.equal(request.taskId, task.id);
  assert.equal(request.taskTitle, 'Corrigir ANSI');
  assert.equal(request.useWorktree, true);
  assert.equal(request.worktree, null);
  assert.throws(() => ask(), /já tem um pedido de agente com worktree/);
  const plain = store.requestAgent({ projectId: 'project-a', requestedBy: 'principal', name: 'simples', purpose: 'Sem worktree.', idempotencyKey: 'pedido-simples-01' });
  assert.equal(plain.useWorktree, false);
  assert.equal(plain.taskId, null);
});

test('aprovação confirma o CLI, cria e registra a worktree e inicia o agente nela', async (t) => {
  const { store, task, ask, approve, calls, spawns } = hostHarness(t);
  const request = ask();
  const result = await approve(request);
  assert.deepEqual(calls, ['adapter', 'create', 'refresh']);
  assert.equal(spawns[0].cwd, `/fixture/a.atlas-worktrees/task-${task.id.slice(0, 8)}`);
  assert.equal(result.agent.cwd, spawns[0].cwd);
  assert.deepEqual(result.request.worktree, { path: spawns[0].cwd, branch: `atlas/task-${task.id.slice(0, 8)}` });
  const [worktree] = store.listWorktrees('project-a');
  assert.equal(worktree.taskId, task.id);
  assert.equal(worktree.requestId, request.id);
  assert.equal(worktree.baseCommit, 'abc1234def');
  const event = store.listEvents('project-a').find((item) => item.type === 'worktree.created');
  assert.deepEqual(event.payload, { worktreeId: worktree.id, taskId: task.id, requestId: request.id, path: worktree.path, branch: worktree.branch, baseCommit: 'abc1234def' });
});

test('CLI ausente recusa antes de criar a worktree', async (t) => {
  const { store, ask, approve, calls, spawns } = hostHarness(t, { adapterError: 'Kimi Code não está disponível.' });
  const request = ask();
  await assert.rejects(approve(request), /não está disponível/);
  assert.deepEqual(calls, ['adapter']);
  assert.equal(spawns.length, 0);
  assert.deepEqual(store.listWorktrees('project-a'), []);
  assert.equal(store.getAgentRequest('project-a', request.id).state, 'failed');
});

test('falha de spawn depois da criação mantém a worktree e informa o caminho', async (t) => {
  const { store, ask, approve } = hostHarness(t, { createAgent: async () => { throw new Error('PTY indisponível'); } });
  const request = ask();
  await assert.rejects(approve(request), /Worktree criada em .*task-.*mas o agente não iniciou: PTY indisponível/);
  const failed = store.getAgentRequest('project-a', request.id);
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /Worktree criada em/);
  assert.equal(store.listWorktrees('project-a').length, 1, 'worktree não é removida automaticamente');
});

test('falha da própria criação Git vira pedido failed sem registro de worktree', async (t) => {
  const { store, ask, approve } = hostHarness(t, { worktrees: { planWorktree: () => ({ repositoryPath: '/fixture/a', path: '/x', branch: 'atlas/task-00000000' }), createWorktree: async () => { throw new Error('A branch atlas/task-00000000 já existe. Nada foi alterado.'); } } });
  const request = ask();
  await assert.rejects(approve(request), /já existe/);
  assert.equal(store.getAgentRequest('project-a', request.id).state, 'failed');
  assert.deepEqual(store.listWorktrees('project-a'), []);
});

test('migration 6→7 preserva pedidos anteriores sem tarefa nem worktree', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-worktree-migration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'legacy.sqlite');
  const raw = new DatabaseSync(filename);
  try {
    raw.exec('PRAGMA foreign_keys = ON');
    migrate(raw, MIGRATIONS.slice(0, 6));
    raw.prepare('INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('legacy', 'Legado', '/legado', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    raw.prepare("INSERT INTO sessions (id, project_id, name, adapter_id, cli, cli_version, cwd, origin, created_at, role) VALUES ('p', 'legacy', 'P', 'kimi-code', 'Kimi', '1', '/legado', 'user', '2026-01-01T00:00:00Z', 'orchestrator')").run();
    raw.prepare("INSERT INTO agent_requests (id, project_id, requested_by, name, purpose, payload_hash, state, created_at, expires_at, version) VALUES ('r', 'legacy', 'p', 'antigo', 'Pedido antigo.', 'h', 'rejected', '2026-01-01T00:00:00Z', '2026-01-01T00:15:00Z', 2)").run();
  } finally { raw.close(); }
  const store = createOperationalStore({ filename });
  try {
    const [request] = store.listAgentRequests('legacy');
    assert.equal(request.name, 'antigo');
    assert.equal(request.useWorktree, false);
    assert.equal(request.taskId, null);
    assert.deepEqual(store.listWorktrees('legacy'), []);
  } finally { store.close(); }
});

test('listagem mostra caminho e branch planejados só para pedidos pendentes com worktree', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-worktree-list-'));
  const store = createOperationalStore({ filename: path.join(directory, 'list.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const project = { id: 'project-a', name: 'Projeto', path: '/fixture/a', repositories: [] };
  store.registerProject(project);
  store.startSession({ id: 'principal', projectId: 'project-a', name: 'P', adapterId: 'kimi-code', cli: 'Kimi Code', version: '2.3.3', cwd: '/fixture/a', origin: 'user', createdAt: new Date().toISOString(), role: 'orchestrator' });
  const handlers = new Map();
  createAgentRequestHost({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, projectHost: { ready: Promise.resolve(), isAllowedCwd: () => true, getProjectForCwd: () => project }, store, isMainSender: () => true, agentHost: { countActive: () => 0 } });
  const task = store.createTask({ projectId: 'project-a', title: 'T', acceptance: 'A', idempotencyKey: 'tarefa-lista-01' });
  store.requestAgent({ projectId: 'project-a', requestedBy: 'principal', name: 'com-worktree', purpose: 'P.', taskId: task.id, worktree: true, idempotencyKey: 'pedido-lista-01' });
  store.requestAgent({ projectId: 'project-a', requestedBy: 'principal', name: 'sem-worktree', purpose: 'P.', idempotencyKey: 'pedido-lista-02' });
  const list = async () => (await handlers.get('agent-request:list')({}, { cwd: '/fixture/a' })).items;
  let [withWorktree, plain] = await list();
  assert.match(withWorktree.plannedWorktree.error, /não tem repositório Git/);
  assert.equal(plain.plannedWorktree, undefined);
  project.repositories = [{ path: '/fixture/a' }];
  [withWorktree] = await list();
  assert.deepEqual(withWorktree.plannedWorktree, { path: path.join('/fixture/a.atlas-worktrees', `task-${task.id.replace(/-/g, '').slice(0, 8)}`), branch: `atlas/task-${task.id.replace(/-/g, '').slice(0, 8)}`, outsideProject: true });
});

test('regressão: tarefa com worktree registrada não ganha nova worktree', async (t) => {
  const { store, ask, approve } = hostHarness(t, { createAgent: async () => { throw new Error('PTY indisponível'); } });
  await assert.rejects(approve(ask()), /Worktree criada em/);
  assert.throws(() => ask(), /já tem uma worktree registrada em .*task-/);
  assert.equal(store.listWorktrees('project-a').length, 1);
});

test('regressão: aprovação recusa quando a tarefa deixou de estar disponível', async (t) => {
  const { store, task, ask, approve, calls } = hostHarness(t);
  const request = ask();
  store.startSession({ id: 'outro-agente', projectId: 'project-a', name: 'outro', adapterId: 'kimi-code', cli: 'Kimi Code', version: '2.3.3', cwd: '/fixture/a', origin: 'user', createdAt: new Date().toISOString() });
  const run = store.listRuns('project-a').find((item) => item.session_id === 'outro-agente');
  const handoff = store.offerHandoff({ projectId: 'project-a', fromSessionId: 'principal', toSessionId: 'outro-agente', taskId: task.id, objective: 'Assumir.', idempotencyKey: 'oferta-concorrente-01' });
  store.acceptHandoff({ projectId: 'project-a', handoffId: handoff.id, sessionId: 'outro-agente', runId: run.id });
  await assert.rejects(approve(request), /não está mais disponível \(in_progress\)/);
  assert.deepEqual(calls, [], 'nenhum efeito Git');
  assert.equal(store.getAgentRequest('project-a', request.id).state, 'pending', 'usuário ainda pode recusar');
});
