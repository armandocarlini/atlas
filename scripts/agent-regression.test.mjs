import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createOperationalStore } = require('../electron/operational-store.cjs');
const { collectGitEvidence, collectChangedPaths } = require('../electron/git-evidence.cjs');
const { createMcpHost } = require('../electron/mcp-host.cjs');
const { createRegressionRunner, testRelatedFiles } = require('../electron/regression-runner.cjs');
const bridgePath = require.resolve('../electron/atlas-mcp-bridge.cjs');

const node = `"${process.execPath}"`;
const script = (code) => `${node} -e "${code}"`;

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=ATLAS Teste', '-c', 'user.email=teste@atlas.invalid', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

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

// Repositório e worktree reais da tarefa; o diff toca um teste e o package.json.
async function harness(t, { worktree: withWorktree = true, onReviewRequested } = {}) {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-agent-regression-')));
  const store = createOperationalStore({ filename: path.join(directory, 'atlas.sqlite') });
  const closers = [];
  t.after(async () => { for (const close of closers.reverse()) await close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const repo = path.join(directory, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"scripts":{"test":"node --test"}}\n');
  fs.writeFileSync(path.join(repo, 'a.js'), 'module.exports = 1;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  const worktreePath = path.join(directory, 'wt');
  git(repo, 'worktree', 'add', '--quiet', '-b', 'atlas/task-12345678', worktreePath, base);
  fs.writeFileSync(path.join(worktreePath, 'package.json'), '{"scripts":{"test":"exit 0"}}\n');
  fs.mkdirSync(path.join(worktreePath, 'src'));
  fs.writeFileSync(path.join(worktreePath, 'src', 'a.test.js'), 'test\n');
  fs.writeFileSync(path.join(worktreePath, 'a.js'), 'module.exports = 2;\n');
  git(worktreePath, 'add', '.');
  git(worktreePath, 'commit', '--quiet', '-m', 'tarefa');

  store.registerProject({ id: 'project-a', name: 'project-a', path: repo });
  const runs = {};
  for (const [id, role] of [['principal', 'orchestrator'], ['agente', 'agent']]) {
    runs[id] = store.startSession({ id, projectId: 'project-a', name: `sessao-${id}`, adapterId: 'opencode', cli: 'OpenCode', version: '1.19.5', cwd: repo, origin: 'user', createdAt: new Date().toISOString(), role });
  }
  const task = store.createTask({ projectId: 'project-a', title: 'Tarefa', acceptance: 'Passa', idempotencyKey: 'tarefa-agent-regression' });
  const handoff = store.offerHandoff({ projectId: 'project-a', fromSessionId: 'principal', toSessionId: 'agente', taskId: task.id, objective: 'Fazer.', idempotencyKey: 'oferta-agent-regression' });
  store.acceptHandoff({ projectId: 'project-a', handoffId: handoff.id, sessionId: 'agente', runId: runs.agente.id });
  if (withWorktree) store.recordWorktree({ projectId: 'project-a', requestId: null, taskId: task.id, repositoryPath: repo, path: worktreePath, branch: 'atlas/task-12345678', baseCommit: base });

  const runner = createRegressionRunner({ store, logsDir: path.join(directory, 'logs'), onError: (error) => { throw error; } });
  closers.push(() => runner.shutdown());
  // Mesma ligação do main.cjs.
  const host = createMcpHost({
    store,
    onReviewRequested: onReviewRequested || ((request) => {
      const run = store.enqueueRegressionRun(request);
      if (run?.state === 'queued') runner.notify();
      return run;
    }),
  });
  await host.listen();
  closers.push(() => host.close());
  const agentToken = host.register({ projectId: 'project-a', sessionId: 'agente', role: 'agent' });
  host.bindRun(agentToken, runs.agente.id);
  const principalToken = host.register({ projectId: 'project-a', sessionId: 'principal', role: 'orchestrator' });
  host.bindRun(principalToken, runs.principal.id);
  const agent = startBridge(t, host.endpoint, agentToken);
  const principal = startBridge(t, host.endpoint, principalToken);
  await agent.initialize();
  await principal.initialize();
  const configure = (command, enabled = true) => store.setRegressionSuite({ projectId: 'project-a', enabled, command, timeoutSeconds: 600, expectedVersion: store.getRegressionSuite('project-a')?.version ?? null });
  const requestReview = () => agent.call('tasks_request_review', { taskId: task.id, summary: 'Pronto.', commands: [{ command: 'npm test', exitCode: 0 }] });
  const suiteEvidence = () => store.listEvidence('project-a').find((item) => item.kind === 'regression_run');
  return { store, runner, agent, principal, task, repo, worktreePath, configure, requestReview, suiteEvidence };
}

test('pedido de revisão dispara a suíte na worktree; agentes veem só o estado', async (t) => {
  const { store, runner, principal, configure, requestReview, suiteEvidence } = await harness(t);
  configure(script("console.log('suite-ok')"));
  const asked = await requestReview();
  assert.equal(asked.isError, false, asked.text);
  assert.equal(asked.value.state, 'in_review');
  assert.equal(asked.value.regression, 'queued', 'a resposta ao agente não espera a suíte');
  assert.match(asked.value.note, /suíte de regressão/);
  await runner.idle;

  const evidence = suiteEvidence();
  assert.equal(evidence.source, 'system');
  assert.equal(evidence.reviewId, asked.value.reviewId);
  assert.equal(evidence.payload.state, 'passed');
  assert.equal(evidence.payload.worktreeChanged, false, 'a suíte não alterou a worktree');
  assert.deepEqual(evidence.payload.testFiles, { total: 2, files: ['package.json', 'src/a.test.js'] }, 'aviso: o diff toca arquivos de teste');
  assert.match(fs.readFileSync(evidence.payload.logPath, 'utf8'), /suite-ok/);

  const listed = (await principal.call('tasks_list', {})).value.tasks[0];
  assert.equal(listed.lastReview.regression, 'passed');
  assert.doesNotMatch(JSON.stringify(listed), /suite-ok|console\.log|regression-logs/, 'sem comando nem log para os agentes');
  assert.equal(store.getTask('project-a', listed.id).state, 'in_review', 'suíte verde não conclui a tarefa');
});

test('suíte que altera a worktree: o aviso aparece e o aceite explica a recusa', async (t) => {
  const { store, runner, worktreePath, configure, requestReview, suiteEvidence } = await harness(t);
  configure(script("require('fs').writeFileSync('gerado-pelo-teste.txt','x')"));
  const asked = await requestReview();
  await runner.idle;
  assert.equal(suiteEvidence().payload.state, 'passed');
  assert.equal(suiteEvidence().payload.worktreeChanged, true);
  assert(fs.existsSync(path.join(worktreePath, 'gerado-pelo-teste.txt')));
  const worktree = store.listWorktrees('project-a')[0];
  const currentGit = await collectGitEvidence(worktree);
  assert.throws(
    () => store.decideReview({ projectId: 'project-a', reviewId: asked.value.reviewId, decision: 'accept', currentGit }),
    /A worktree mudou.*A suíte de regressão alterou a worktree ao rodar/,
  );
  const changes = store.decideReview({ projectId: 'project-a', reviewId: asked.value.reviewId, decision: 'changes', note: 'Ignore o arquivo gerado.' });
  assert.equal(changes.task.state, 'in_progress', 'pedir ajustes continua possível');
});

test('suíte vermelha só informa: o usuário ainda conclui', async (t) => {
  const { store, runner, principal, configure, requestReview, suiteEvidence } = await harness(t);
  configure(script('process.exit(1)'));
  const asked = await requestReview();
  await runner.idle;
  assert.equal(suiteEvidence().payload.state, 'failed');
  assert.equal((await principal.call('tasks_list', {})).value.tasks[0].lastReview.regression, 'failed');
  const currentGit = await collectGitEvidence(store.listWorktrees('project-a')[0]);
  const { task } = store.decideReview({ projectId: 'project-a', reviewId: asked.value.reviewId, decision: 'accept', currentGit });
  assert.equal(task.state, 'done');
});

test('suíte desligada não roda; sem worktree fica "não executada"', async (t) => {
  const off = await harness(t);
  off.configure(script("console.log('x')"), false);
  const asked = await off.requestReview();
  assert.equal(asked.value.regression, null);
  assert.match(asked.value.note, /^Revisão pedida\. Só o usuário/);
  assert.deepEqual(off.store.listRegressionRuns('project-a'), []);

  const bare = await harness(t, { worktree: false });
  bare.configure(script("console.log('x')"));
  const skipped = await bare.requestReview();
  assert.equal(skipped.value.regression, 'skipped');
  assert.equal(bare.suiteEvidence().payload.state, 'skipped');
  assert.equal((await bare.principal.call('tasks_list', {})).value.tasks[0].lastReview.regression, 'skipped');
});

test('falha ao enfileirar não desfaz a revisão gravada', async (t) => {
  const { store, requestReview } = await harness(t, { onReviewRequested: () => { throw new Error('fila indisponível'); } });
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  t.after(() => { console.error = original; });
  const asked = await requestReview();
  console.error = original;
  assert.equal(asked.isError, false, asked.text);
  assert.equal(asked.value.regression, null);
  assert.equal(store.listReviews('project-a')[0].state, 'pending');
  assert.match(logged.join('\n'), /fila indisponível/);
});

test('caminhos alterados: commits, sem commit, novos e renomeados; filtro de arquivos de teste', async (t) => {
  const { store, worktreePath } = await harness(t);
  fs.writeFileSync(path.join(worktreePath, 'novo.spec.ts'), 'x\n');
  git(worktreePath, 'mv', 'a.js', 'b.js');
  const paths = await collectChangedPaths(store.listWorktrees('project-a')[0]);
  assert.deepEqual([...paths].sort(), ['a.js', 'b.js', 'novo.spec.ts', 'package.json', 'src/a.test.js'].sort());
  assert.deepEqual(testRelatedFiles(['src/app.js', 'tests/x.js', 'pkg/package.json', 'a_test.go', 'test_a.py', 'vitest.config.ts', 'README.md', 'docs\\test\\a.md', 'contest.js']),
    ['tests/x.js', 'pkg/package.json', 'a_test.go', 'test_a.py', 'vitest.config.ts', 'docs\\test\\a.md']);
});
