import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createOperationalStore, migrate, MIGRATIONS } = require('../electron/operational-store.cjs');
const { collectGitEvidence, parseShortstat } = require('../electron/git-evidence.cjs');
const { createMcpHost } = require('../electron/mcp-host.cjs');
const { createTaskHost } = require('../electron/task-host.cjs');
const bridgePath = require.resolve('../electron/atlas-mcp-bridge.cjs');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=ATLAS Teste', '-c', 'user.email=teste@atlas.invalid', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-review-'));
  const store = createOperationalStore({ filename: path.join(directory, 'review.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  for (const id of ['project-a', 'project-b']) store.registerProject({ id, name: id, path: `/fixture/${id}` });
  const runs = {};
  const session = (id, projectId, role = 'agent') => { runs[id] = store.startSession({ id, projectId, name: `sessao-${id}`, adapterId: 'kimi-code', cli: 'Kimi Code', version: '2.3.3', cwd: `/fixture/${projectId}`, origin: 'user', createdAt: new Date().toISOString(), role }); };
  session('principal', 'project-a', 'orchestrator');
  session('agente', 'project-a');
  session('outro', 'project-a');
  const task = store.createTask({ projectId: 'project-a', title: 'Corrigir ANSI', acceptance: 'Regressão passa', idempotencyKey: 'tarefa-review-01' });
  const handoff = store.offerHandoff({ projectId: 'project-a', fromSessionId: 'principal', toSessionId: 'agente', taskId: task.id, objective: 'Corrigir.', idempotencyKey: 'oferta-review-01' });
  store.acceptHandoff({ projectId: 'project-a', handoffId: handoff.id, sessionId: 'agente', runId: runs.agente.id });
  const git = { worktreePath: '/fixture/wt', branch: 'atlas/task-12345678', baseCommit: 'aaaaaaa', headCommit: 'bbbbbbb', commits: 1, diff: { files: 2, insertions: 10, deletions: 1 }, uncommittedFiles: 0 };
  const request = (overrides = {}) => store.requestReview({ projectId: 'project-a', taskId: task.id, sessionId: 'agente', runId: runs.agente.id, summary: 'Regressão escrita e correção aplicada.', commands: [{ command: 'npm test', exitCode: 0 }], git, ...overrides });
  return { store, directory, runs, task, request, git };
}

test('responsável pede revisão: tarefa em revisão com declaração do agente e retrato do sistema', (t) => {
  const { store, task, request, git } = harness(t);
  const review = request();
  assert.equal(review.state, 'pending');
  assert.equal(review.requesterName, 'sessao-agente');
  assert.equal(store.getTask('project-a', task.id).state, 'in_review');
  const evidence = store.listEvidence('project-a');
  assert.deepEqual(evidence.map((item) => [item.kind, item.source]), [['agent_report', 'agent'], ['git_snapshot', 'system']]);
  assert.deepEqual(evidence[0].payload, { summary: 'Regressão escrita e correção aplicada.', commands: [{ command: 'npm test', exitCode: 0 }] });
  assert.deepEqual(evidence[1].payload, git);
  assert(evidence.every((item) => item.reviewId === review.id));
  assert.throws(() => request(), /não está em andamento \(in_review\)/, 'uma revisão pendente por vez');
  assert.throws(() => store.updateTask({ projectId: 'project-a', taskId: task.id, sessionId: 'agente', runId: store.listRuns('project-a').find((run) => run.session_id === 'agente').id, kind: 'progress', note: 'x' }), /não está em andamento/);
});

test('pedido de revisão exige claim, tarefa sem bloqueio e declaração válida', (t) => {
  const { store, task, request, runs } = harness(t);
  assert.throws(() => request({ sessionId: 'outro', runId: runs.outro.id }), /não é responsável/);
  assert.throws(() => request({ summary: '' }), /Resumo/);
  assert.throws(() => request({ commands: [{ command: 'npm test', exitCode: 'zero' }] }), /exit code/);
  assert.throws(() => request({ commands: [{ command: 'rm‮ -rf', exitCode: 0 }] }), /Comando 1: remova/);
  assert.throws(() => request({ commands: Array.from({ length: 21 }, () => ({ command: 'x', exitCode: 0 })) }), /até 20 itens/);
  store.updateTask({ projectId: 'project-a', taskId: task.id, sessionId: 'agente', runId: runs.agente.id, kind: 'blocked', note: 'Sem fixture.' });
  assert.throws(() => request(), /Resolva o bloqueio/);
  assert.equal(store.listEvidence('project-a').length, 0);
});

test('aceite do usuário conclui a tarefa com critérios e evidências no evento', (t) => {
  const { store, task, request, git: snapshot } = harness(t);
  const review = request();
  const { task: done, review: accepted } = store.decideReview({ projectId: 'project-a', reviewId: review.id, decision: 'accept', currentGit: snapshot });
  assert.equal(done.state, 'done');
  assert.equal(done.claimRunId, null);
  assert.equal(done.assignedSessionId, 'agente', 'responsável preservado no histórico');
  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.decidedBy, 'user');
  const completed = store.listEvents('project-a').find((item) => item.type === 'task.completed');
  assert.deepEqual(completed.payload, { taskId: task.id, reviewId: review.id, actor: 'user', acceptance: 'Regressão passa', evidenceIds: store.listEvidence('project-a').map((item) => item.id), acceptedHeadCommit: 'bbbbbbb' });
  assert.throws(() => store.decideReview({ projectId: 'project-a', reviewId: review.id, decision: 'accept' }), /já foi decidida/);
  assert.throws(() => store.releaseTask({ projectId: 'project-a', taskId: task.id, actor: 'user' }), /não está com um responsável \(done\)/);
});

test('pedir ajustes exige nota e devolve ao responsável, que pode pedir nova revisão', (t) => {
  const { store, task, request, runs, git: snapshot } = harness(t);
  const first = request();
  assert.throws(() => store.decideReview({ projectId: 'project-a', reviewId: first.id, decision: 'changes' }), /Nota da revisão/);
  assert.throws(() => store.decideReview({ projectId: 'project-a', reviewId: first.id, decision: 'merge' }), /Decisão inválida/);
  assert.throws(() => store.decideReview({ projectId: 'project-b', reviewId: first.id, decision: 'accept' }), /não encontrada neste projeto/);
  const { task: back } = store.decideReview({ projectId: 'project-a', reviewId: first.id, decision: 'changes', note: 'Falta o caso de resize.' });
  assert.equal(back.state, 'in_progress');
  assert.equal(back.claimRunId, runs.agente.id, 'claim continua com o responsável');
  const second = request({ summary: 'Resize coberto.' });
  assert.equal(store.listReviews('project-a').map((item) => item.state).join(','), 'changes_requested,pending');
  assert.equal(store.decideReview({ projectId: 'project-a', reviewId: second.id, decision: 'accept', note: 'Ok.', currentGit: snapshot }).task.state, 'done');
  assert.equal(store.listEvidence('project-a').length, 4);
});

test('run perdida durante a revisão não decide nada; o usuário ainda decide', (t) => {
  const { store, task, request, runs, git: snapshot } = harness(t);
  const review = request();
  store.finishRun({ runId: runs.agente.id, expectedVersion: 1, exitCode: 0 });
  assert.equal(store.getTask('project-a', task.id).state, 'in_review', 'run.succeeded não implica done');
  assert.equal(store.decideReview({ projectId: 'project-a', reviewId: review.id, decision: 'accept', currentGit: snapshot }).task.state, 'done');
});

test('retrato Git real: branch, commit-base, HEAD, commits, diff e alterações não commitadas', async (t) => {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-review-git-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repo = path.join(directory, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'um\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '--quiet', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  const worktree = path.join(directory, 'wt');
  git(repo, 'worktree', 'add', '--quiet', '-b', 'atlas/task-12345678', worktree, base);
  fs.writeFileSync(path.join(worktree, 'a.txt'), 'um\ndois\n');
  fs.writeFileSync(path.join(worktree, 'b.txt'), 'novo\n');
  git(worktree, 'add', 'a.txt', 'b.txt');
  git(worktree, 'commit', '--quiet', '-m', 'mudança');
  fs.writeFileSync(path.join(worktree, 'pendente.txt'), 'sem commit\n');
  const before = git(worktree, 'status', '--porcelain');
  const snapshot = await collectGitEvidence({ repositoryPath: repo, path: worktree, branch: 'atlas/task-12345678', baseCommit: base });
  assert.deepEqual({ ...snapshot, headCommit: undefined }, { worktreePath: worktree, expectedBranch: 'atlas/task-12345678', branch: 'atlas/task-12345678', baseCommit: base, headCommit: undefined, commits: 1, diff: { files: 2, insertions: 2, deletions: 0 }, uncommittedFiles: 1 });
  assert.equal(snapshot.headCommit, git(worktree, 'rev-parse', 'HEAD'));
  assert.equal(git(worktree, 'status', '--porcelain'), before, 'coleta não altera a worktree');
  await assert.rejects(collectGitEvidence({ repositoryPath: repo, path: worktree, branch: 'x', baseCommit: 'HEAD; rm -rf' }), /Commit-base inválido/);
  assert.deepEqual(parseShortstat(' 1 file changed, 1 deletion(-)'), { files: 1, insertions: 0, deletions: 1 });
});

function startBridge(t, endpoint, token) {
  const child = spawn(process.execPath, [bridgePath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ATLAS_MCP_ENDPOINT: endpoint, ATLAS_MCP_TOKEN: token }, stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => child.kill());
  let buffer = '';
  const waiting = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      waiting.get(message.id)?.(message);
    }
  });
  let next = 1;
  const rpc = (method, params = {}) => new Promise((resolve) => { const id = next++; waiting.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return {
    initialize: () => rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'teste', version: '1' } }),
    call: async (name, args) => {
      const result = (await rpc('tools/call', { name, arguments: args })).result;
      const text = result.content[0].text;
      return { isError: Boolean(result.isError), text, value: result.isError ? null : JSON.parse(text) };
    },
  };
}

test('ponte real: agente pede revisão de forma assíncrona com retrato coletado pelo host', async (t) => {
  const { store, runs, task } = harness(t);
  const worktree = store.recordWorktree({ projectId: 'project-a', requestId: null, taskId: task.id, repositoryPath: '/fixture/project-a', path: '/fixture/wt', branch: 'atlas/task-12345678', baseCommit: 'aaaaaaa' });
  const collected = [];
  const changes = [];
  const host = createMcpHost({ store, onTaskChange: (projectId) => changes.push(projectId), collectGitEvidence: async (item) => { collected.push(item.path); await new Promise((resolve) => setTimeout(resolve, 20)); return { worktreePath: item.path, branch: item.branch, baseCommit: item.baseCommit, headCommit: 'ccccccc', commits: 2, diff: { files: 1, insertions: 3, deletions: 0 }, uncommittedFiles: 0 }; } });
  await host.listen();
  t.after(() => host.close());
  const agentToken = host.register({ projectId: 'project-a', sessionId: 'agente', role: 'agent' });
  host.bindRun(agentToken, runs.agente.id);
  const principalToken = host.register({ projectId: 'project-a', sessionId: 'principal', role: 'orchestrator' });
  host.bindRun(principalToken, runs.principal.id);
  const agent = startBridge(t, host.endpoint, agentToken);
  const principal = startBridge(t, host.endpoint, principalToken);
  await agent.initialize();
  await principal.initialize();
  assert.match((await principal.call('tasks_request_review', { taskId: task.id, summary: 'x' })).text, /sessões de agente/);
  const asked = await agent.call('tasks_request_review', { taskId: task.id, summary: 'Pronto para revisão.', commands: [{ command: 'npm test', exitCode: 0 }] });
  assert.equal(asked.isError, false, asked.text);
  assert.equal(asked.value.state, 'in_review');
  assert.match(asked.value.note, /Só o usuário conclui/);
  assert.deepEqual(collected, [worktree.path]);
  assert.deepEqual(changes, ['project-a']);
  const snapshot = store.listEvidence('project-a').find((item) => item.kind === 'git_snapshot');
  assert.equal(snapshot.payload.headCommit, 'ccccccc');
  const listed = (await principal.call('tasks_list', {})).value.tasks[0];
  assert.equal(listed.state, 'in_review');
  assert.deepEqual(listed.lastReview, { id: asked.value.reviewId, state: 'pending', note: null });
});

test('falha na leitura Git vira evidência honesta de indisponibilidade', async (t) => {
  const { store, runs, task } = harness(t);
  store.recordWorktree({ projectId: 'project-a', requestId: null, taskId: task.id, repositoryPath: '/fixture/project-a', path: '/fixture/sumiu', branch: 'atlas/task-12345678', baseCommit: 'aaaaaaa' });
  const host = createMcpHost({ store, collectGitEvidence: async () => { throw new Error('Command failed: git status\nfatal: \u202Etexto da worktree'); } });
  await host.listen();
  t.after(() => host.close());
  const token = host.register({ projectId: 'project-a', sessionId: 'agente', role: 'agent' });
  host.bindRun(token, runs.agente.id);
  const agent = startBridge(t, host.endpoint, token);
  await agent.initialize();
  assert.equal((await agent.call('tasks_request_review', { taskId: task.id, summary: 'Pronto.' })).isError, false);
  const snapshot = store.listEvidence('project-a').find((item) => item.kind === 'git_snapshot');
  assert.deepEqual(snapshot.payload, { unavailable: 'O ATLAS não conseguiu ler a worktree registrada da tarefa.', worktreePath: '/fixture/sumiu', detail: 'Command failed: git status' });
});

test('IPC de decisão: só a janela principal, com aviso de mudança e lista com revisões e evidências', async (t) => {
  const { store, request } = harness(t);
  const review = request();
  const handlers = new Map();
  const changes = [];
  const projectHost = { ready: Promise.resolve(), isAllowedCwd: (cwd) => cwd === '/fixture/project-a', getProjectForCwd: () => ({ id: 'project-a', name: 'A', path: '/fixture/project-a' }) };
  createTaskHost({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, projectHost, store, isMainSender: (event) => event.sender === 'main', onChange: (projectId) => changes.push(projectId) });
  const invoke = (name, payload, sender = 'main') => handlers.get(name)({ sender }, payload);
  await assert.rejects(invoke('task:review-decide', { cwd: '/fixture/project-a', reviewId: review.id, decision: 'accept' }, 'popup'), /Janela não autorizada/);
  const listed = await invoke('task:list', { cwd: '/fixture/project-a' });
  assert.equal(listed.reviews.length, 1);
  assert.equal(listed.evidence.length, 2);
  const decided = await invoke('task:review-decide', { cwd: '/fixture/project-a', reviewId: review.id, decision: 'changes', note: 'Ajustar.' });
  assert.equal(decided.task.state, 'in_progress');
  assert.deepEqual(changes, ['project-a']);
});

test('migration 7→8 preserva tarefas e cria revisões e evidências vazias', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-review-migration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'legacy.sqlite');
  const raw = new DatabaseSync(filename);
  try {
    raw.exec('PRAGMA foreign_keys = ON');
    migrate(raw, MIGRATIONS.slice(0, 7));
    raw.prepare('INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('legacy', 'Legado', '/legado', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    raw.prepare("INSERT INTO tasks (id, project_id, title, description, acceptance, state, version, created_by, created_at, updated_at) VALUES ('t', 'legacy', 'Antiga', '', 'Aceite', 'in_progress', 3, 'user', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
  } finally { raw.close(); }
  const store = createOperationalStore({ filename });
  try {
    assert.equal(store.listTasks('legacy')[0].state, 'in_progress');
    assert.deepEqual(store.listReviews('legacy'), []);
    assert.deepEqual(store.listEvidence('legacy'), []);
  } finally { store.close(); }
});

test('segurança: .git forjado na worktree não engana o retrato nem executa fsmonitor', async (t) => {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-review-forge-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repo = path.join(directory, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'um\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '--quiet', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  const worktree = path.join(directory, 'wt');
  git(repo, 'worktree', 'add', '--quiet', '-b', 'atlas/task-12345678', worktree, base);
  const realHead = git(worktree, 'rev-parse', 'HEAD');
  // O agente troca o arquivo .git da worktree por um repositório próprio com fsmonitor.
  const marker = path.join(directory, 'executou.txt');
  // Git (inclusive o Git for Windows) executa o fsmonitor por sh; caminhos com barra normal.
  const hook = path.join(directory, 'hook.sh').replaceAll('\\', '/');
  fs.writeFileSync(hook, `#!/bin/sh\necho x > "${marker.replaceAll('\\', '/')}"\n`, { mode: 0o755 });
  fs.rmSync(path.join(worktree, '.git'));
  git(worktree, 'init', '--quiet', '--initial-branch=atlas/task-12345678');
  git(worktree, 'config', 'core.fsmonitor', hook);
  fs.writeFileSync(path.join(worktree, 'falso.txt'), 'x\n');
  git(worktree, 'add', 'falso.txt');
  git(worktree, 'commit', '--quiet', '-m', 'forjado');
  if (fs.existsSync(marker)) fs.rmSync(marker);
  // Com o ponteiro trocado, o Git não reconhece mais a worktree pelo repositório principal...
  const snapshot = await collectGitEvidence({ repositoryPath: repo, path: worktree, branch: 'atlas/task-12345678', baseCommit: base });
  // ...e o retrato continua vindo do diretório administrativo legítimo.
  assert.equal(snapshot.headCommit, realHead);
  assert.equal(snapshot.commits, 0);
  assert.equal(fs.existsSync(marker), false, 'fsmonitor do repositório forjado não pode executar no processo do ATLAS');
  // Controle positivo: o `git status` ingênuo dentro da worktree executa o hook forjado.
  git(worktree, 'status', '--porcelain');
  assert.equal(fs.existsSync(marker), true, 'o teste precisa conseguir detectar a execução do hook');
});

test('segurança: worktree sem registro no repositório principal é recusada', async (t) => {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-review-unregistered-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repo = path.join(directory, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'um\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '--quiet', '-m', 'base');
  fs.mkdirSync(path.join(repo, '.git', 'worktrees'), { recursive: true });
  const other = path.join(directory, 'outro');
  fs.mkdirSync(other);
  await assert.rejects(collectGitEvidence({ repositoryPath: repo, path: other, branch: 'x', baseCommit: git(repo, 'rev-parse', 'HEAD') }), /não está registrada no repositório principal/);
});

test('regressão: aceite recusa quando a worktree mudou ou não pode ser conferida', (t) => {
  const { store, request, git: snapshot } = harness(t);
  const review = request();
  assert.throws(() => store.decideReview({ projectId: 'project-a', reviewId: review.id, decision: 'accept', currentGit: { ...snapshot, headCommit: 'ddddddd' } }), /A worktree mudou desde o pedido de revisão \(HEAD bbbbbbb → ddddddd\)/);
  assert.throws(() => store.decideReview({ projectId: 'project-a', reviewId: review.id, decision: 'accept', currentGit: { ...snapshot, uncommittedFiles: 3 } }), /A worktree mudou/);
  assert.throws(() => store.decideReview({ projectId: 'project-a', reviewId: review.id, decision: 'accept', currentGit: { unavailable: 'x' } }), /Não foi possível conferir a worktree agora/);
  assert.throws(() => store.decideReview({ projectId: 'project-a', reviewId: review.id, decision: 'accept' }), /Não foi possível conferir/);
  assert.equal(store.listReviews('project-a')[0].state, 'pending', 'recusas não decidem a revisão');
  assert.equal(store.decideReview({ projectId: 'project-a', reviewId: review.id, decision: 'changes', note: 'Pedir nova revisão.' }).task.state, 'in_progress');
});

test('regressão: IPC de aceite coleta o retrato de novo antes de concluir', async (t) => {
  const { store, request, task, git: snapshot } = harness(t);
  store.recordWorktree({ projectId: 'project-a', requestId: null, taskId: task.id, repositoryPath: '/fixture/project-a', path: '/fixture/wt', branch: 'atlas/task-12345678', baseCommit: 'aaaaaaa' });
  const review = request();
  const handlers = new Map();
  const collected = [];
  let current = { ...snapshot, headCommit: 'eeeeeee' };
  const projectHost = { ready: Promise.resolve(), isAllowedCwd: () => true, getProjectForCwd: () => ({ id: 'project-a', name: 'A', path: '/fixture/project-a' }) };
  createTaskHost({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, projectHost, store, isMainSender: () => true, collectGitEvidence: async (worktree) => { collected.push(worktree.path); return current; } });
  const accept = () => handlers.get('task:review-decide')({}, { cwd: '/fixture/project-a', reviewId: review.id, decision: 'accept' });
  await assert.rejects(accept(), /A worktree mudou/);
  current = snapshot;
  assert.equal((await accept()).task.state, 'done');
  assert.deepEqual(collected, ['/fixture/wt', '/fixture/wt']);
  assert.equal(store.listEvents('project-a').find((item) => item.type === 'task.completed').payload.acceptedHeadCommit, 'bbbbbbb');
});
