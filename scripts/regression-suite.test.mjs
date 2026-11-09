import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createOperationalStore, closeOperationalStore, migrate, MIGRATIONS } = require('../electron/operational-store.cjs');
const { createRegressionRunner, suiteEnv, shellInvocation, readableTail } = require('../electron/regression-runner.cjs');
const { createRegressionSuiteHost, suggestCommand, insideLogs } = require('../electron/regression-suite-host.cjs');

// Comandos da fixture: o próprio Node, sem caracteres que o cmd ou o sh interpretem.
const node = `"${process.execPath}"`;
const script = (code) => `${node} -e "${code}"`;

function harness(t, { reviews = 1 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-regression-'));
  const filename = path.join(directory, 'regression.sqlite');
  const store = createOperationalStore({ filename });
  const closers = [];
  t.after(() => { for (const close of closers) close(); if (!store.closed) store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  for (const id of ['project-a', 'project-b']) store.registerProject({ id, name: id, path: path.join(directory, id) });
  const runs = {};
  const session = (id, role = 'agent') => { runs[id] = store.startSession({ id, projectId: 'project-a', name: `sessao-${id}`, adapterId: 'kimi-code', cli: 'Kimi Code', version: '2.3.3', cwd: directory, origin: 'user', createdAt: new Date().toISOString(), role }); };
  session('principal', 'orchestrator');
  session('agente');
  const worktree = fs.mkdtempSync(path.join(directory, 'wt-'));
  const items = [];
  for (let index = 0; index < reviews; index += 1) {
    const task = store.createTask({ projectId: 'project-a', title: `Tarefa ${index}`, acceptance: 'Passa', idempotencyKey: `tarefa-regressao-${index}` });
    const handoff = store.offerHandoff({ projectId: 'project-a', fromSessionId: 'principal', toSessionId: 'agente', taskId: task.id, objective: 'Fazer.', idempotencyKey: `oferta-regressao-${index}` });
    store.acceptHandoff({ projectId: 'project-a', handoffId: handoff.id, sessionId: 'agente', runId: runs.agente.id });
    const review = store.requestReview({ projectId: 'project-a', taskId: task.id, sessionId: 'agente', runId: runs.agente.id, summary: 'Pronto.', commands: [], git: { unavailable: 'fixture' } });
    items.push({ task, review });
  }
  const logsDir = path.join(directory, 'logs');
  const configure = (command, timeoutSeconds = null) => store.setRegressionSuite({ projectId: 'project-a', enabled: true, command, timeoutSeconds, expectedVersion: store.getRegressionSuite('project-a')?.version ?? null });
  const enqueue = (index = 0, worktreePath = worktree) => store.enqueueRegressionRun({ projectId: 'project-a', taskId: items[index].task.id, reviewId: items[index].review.id, worktreePath });
  const runner = (options = {}) => createRegressionRunner({ store, logsDir, onError: (error) => { throw error; }, ...options });
  const evidenceOf = (reviewId) => store.listEvidence('project-a').filter((item) => item.reviewId === reviewId && item.kind === 'regression_run');
  return { closers, store, filename, directory, worktree, items, logsDir, configure, enqueue, runner, evidenceOf };
}

test('migration 13 amplia a evidência sem perder linhas nem ordem', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-regression-migration-'));
  const opened = [];
  // Fecha os bancos antes de apagar a pasta: no Windows, arquivo aberto não sai.
  t.after(() => { for (const db of opened) db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const filename = path.join(directory, 'v12.sqlite');
  const raw = new DatabaseSync(filename, { enableForeignKeyConstraints: true });
  migrate(raw, MIGRATIONS.filter((item) => item.version <= 12));
  const at = new Date().toISOString();
  raw.prepare("INSERT INTO projects VALUES ('p', 'p', '/p', ?, ?)").run(at, at);
  raw.prepare("INSERT INTO tasks (id, project_id, title, description, acceptance, state, created_by, created_at, updated_at, version) VALUES ('t', 'p', 't', '', 'a', 'backlog', 'user', ?, ?, 1)").run(at, at);
  for (const [id, kind] of [['e2', 'git_snapshot'], ['e1', 'agent_report']]) {
    raw.prepare("INSERT INTO evidence (id, project_id, task_id, kind, source, payload, created_at) VALUES (?, 'p', 't', ?, 'system', '{}', ?)").run(id, kind, at);
  }
  assert.throws(() => raw.prepare("INSERT INTO evidence (id, project_id, task_id, kind, source, payload, created_at) VALUES ('x', 'p', 't', 'regression_run', 'system', '{}', ?)").run(at), /CHECK/);
  raw.close();

  const store = createOperationalStore({ filename });
  opened.push(store);
  assert.deepEqual(store.listEvidence('p').map((item) => item.id), ['e2', 'e1'], 'mesma ordem de inserção');
  const migrated = new DatabaseSync(filename);
  opened.push(migrated);
  assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.at(-1).version, 'banco migrado até a última versão');
  migrated.prepare("INSERT INTO evidence (id, project_id, task_id, kind, source, payload, created_at) VALUES ('r', 'p', 't', 'regression_run', 'system', '{}', ?)").run(at);
  assert.throws(() => migrated.prepare("INSERT INTO evidence (id, project_id, task_id, kind, source, payload, created_at) VALUES ('o', 'p', 't', 'outro', 'system', '{}', ?)").run(at), /CHECK/);
  assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
});

test('configuração: só com comando e prazo explícitos, sem padrão e com controle de versão', (t) => {
  const { store } = harness(t, { reviews: 0 });
  assert.equal(store.getRegressionSuite('project-a'), null, 'sem configuração, a suíte fica desligada');
  const base = { projectId: 'project-a', enabled: true, command: 'npm test' };
  assert.throws(() => store.setRegressionSuite({ ...base }), /escolha um prazo/, 'prazo ausente não vira padrão');
  assert.throws(() => store.setRegressionSuite({ ...base, timeoutSeconds: 59 }), /1 minuto a 24 horas/);
  assert.throws(() => store.setRegressionSuite({ ...base, timeoutSeconds: 86401 }), /1 minuto a 24 horas/);
  assert.throws(() => store.setRegressionSuite({ ...base, timeoutSeconds: 90.5 }), /1 minuto a 24 horas/);
  assert.throws(() => store.setRegressionSuite({ ...base, timeoutSeconds: null, command: 'npm test\nrm -rf x' }), /uma linha só/);
  assert.throws(() => store.setRegressionSuite({ ...base, timeoutSeconds: null, command: 'npm‮ test' }), /uma linha só/);
  assert.throws(() => store.setRegressionSuite({ ...base, timeoutSeconds: null, command: '   ' }), /Comando/);
  assert.throws(() => store.setRegressionSuite({ ...base, timeoutSeconds: null, command: 'x'.repeat(301) }), /300/);
  assert.throws(() => store.setRegressionSuite({ ...base, enabled: 'sim', timeoutSeconds: null }), /ligada/);
  assert.throws(() => store.setRegressionSuite({ ...base, projectId: 'nada', timeoutSeconds: null }), /Projeto não encontrado/);

  const created = store.setRegressionSuite({ ...base, timeoutSeconds: null });
  assert.deepEqual({ enabled: created.enabled, command: created.command, timeoutSeconds: created.timeoutSeconds, version: created.version }, { enabled: true, command: 'npm test', timeoutSeconds: null, version: 1 });
  assert.throws(() => store.setRegressionSuite({ ...base, timeoutSeconds: 600 }), /mudou desde que foi aberta/, 'edição sem a versão lida');
  const updated = store.setRegressionSuite({ ...base, enabled: false, timeoutSeconds: 86400, expectedVersion: 1 });
  assert.equal(updated.version, 2);
  assert.equal(updated.enabled, false);
  assert.equal(updated.timeoutSeconds, 86400);
  assert.equal(store.getRegressionSuite('project-b'), null, 'por projeto');
  const configured = store.listEvents('project-a').filter((item) => item.type === 'regression.configured');
  assert.equal(configured.length, 2);
  assert.equal(configured[1].payload.actor, 'user');
});

test('enfileirar: desligada não roda; sem worktree vira "não executada", nunca sucesso', (t) => {
  const { store, items, configure, enqueue, evidenceOf } = harness(t, { reviews: 2 });
  assert.equal(enqueue(0), null, 'sem configuração');
  configure('npm test');
  store.setRegressionSuite({ projectId: 'project-a', enabled: false, command: 'npm test', timeoutSeconds: null, expectedVersion: 1 });
  assert.equal(enqueue(0), null, 'desligada');
  store.setRegressionSuite({ projectId: 'project-a', enabled: true, command: 'npm run verify', timeoutSeconds: 600, expectedVersion: 2 });

  const skipped = enqueue(0, null);
  assert.equal(skipped.state, 'skipped');
  assert.match(skipped.error, /não tem worktree/);
  assert.equal(evidenceOf(items[0].review.id)[0].payload.state, 'skipped');
  assert.equal(evidenceOf(items[0].review.id)[0].source, 'system');

  const queued = enqueue(1);
  assert.equal(queued.state, 'queued');
  assert.equal(queued.command, 'npm run verify', 'comando e prazo do momento do pedido');
  assert.equal(queued.timeoutSeconds, 600);
  assert.throws(() => enqueue(1), /UNIQUE/, 'uma execução por revisão');
  assert.equal(evidenceOf(items[1].review.id).length, 0, 'evidência só no resultado final');
});

test('executa na worktree: passou, log completo em arquivo com SHA-256 e sem credenciais do ATLAS', async (t) => {
  const { store, worktree, items, configure, enqueue, runner, evidenceOf, logsDir } = harness(t);
  configure(script("console.log(require('path').basename(process.cwd()));console.log(process.env.ATLAS_MCP_TOKEN||'sem-token');console.error('\\x1b[31mvermelho\\x1b[0m')"));
  enqueue();
  const changes = [];
  const instance = runner({ env: { ...process.env, ATLAS_MCP_TOKEN: 'segredo-da-run', atlas_mcp_endpoint: 'pipe', OPENCODE_CONFIG_CONTENT: '{}' }, onChange: (projectId) => changes.push(projectId) });
  await instance.notify();
  const [run] = store.listRegressionRuns('project-a');
  assert.equal(run.state, 'passed');
  assert.equal(run.exitCode, 0);
  assert.equal(run.logTail, undefined, 'a lista não carrega o trecho do log');
  const full = store.getRegressionRun(run.id);
  const content = fs.readFileSync(full.logPath);
  assert(full.logPath.startsWith(path.join(logsDir, 'project-a')), 'log na pasta de logs, separado por projeto');
  assert.equal(full.logBytes, content.length);
  assert.equal(full.logSha256, createHash('sha256').update(content).digest('hex'));
  assert.equal(full.logTruncated, false);
  const text = content.toString('utf8');
  assert.match(text, new RegExp(path.basename(worktree)), 'cwd é a worktree');
  assert.match(text, /sem-token/);
  assert.doesNotMatch(text, /segredo-da-run/);
  assert.match(full.logTail, /vermelho/);
  assert.doesNotMatch(full.logTail, /\x1b/, 'trecho legível, sem ANSI');
  const [evidence] = evidenceOf(items[0].review.id);
  assert.equal(evidence.payload.state, 'passed');
  assert.equal(evidence.payload.logSha256, full.logSha256);
  assert.equal(evidence.payload.logTail, undefined, 'o trecho não vai na evidência');
  assert(Number.isInteger(evidence.payload.durationMs));
  assert(changes.length >= 2 && changes.every((id) => id === 'project-a'));
});

test('exit diferente de zero é falha, com o exit code', async (t) => {
  const { store, configure, enqueue, runner } = harness(t);
  configure(script('process.exit(3)'));
  enqueue();
  await runner().notify();
  const [run] = store.listRegressionRuns('project-a');
  assert.equal(run.state, 'failed');
  assert.equal(run.exitCode, 3);
});

test('prazo esgotado encerra a árvore de processos e grava timeout', async (t) => {
  const { store, configure, enqueue, runner } = harness(t);
  configure(script('setTimeout(()=>{},60000)'), 60);
  enqueue();
  const started = Date.now();
  await runner({ secondMs: 5 }).notify();
  const [run] = store.listRegressionRuns('project-a');
  assert.equal(run.state, 'timeout');
  assert.match(run.error, /Prazo de 60 s/);
  assert(Date.now() - started < 20000, 'não esperou o processo terminar sozinho');
});

test('usuário para a suíte rodando e a que está na fila; nada vira sucesso', async (t) => {
  const { store, items, configure, enqueue, runner, evidenceOf } = harness(t, { reviews: 2 });
  configure(script("console.log('inicio');setTimeout(()=>{},60000)"));
  const first = enqueue(0);
  const second = enqueue(1);
  const instance = runner();
  const done = instance.notify();
  while (store.getRegressionRun(first.id).state !== 'running') await new Promise((resolve) => setTimeout(resolve, 20));

  const stillQueued = store.cancelRegressionRun({ projectId: 'project-a', id: second.id });
  assert.equal(stillQueued.state, 'cancelled', 'na fila: parada imediata');
  assert.equal(stillQueued.logPath, null, 'nunca começou');
  assert.throws(() => store.cancelRegressionRun({ projectId: 'project-b', id: first.id }), /não encontrada neste projeto/);

  const flagged = store.cancelRegressionRun({ projectId: 'project-a', id: first.id });
  assert.equal(flagged.cancelRequested, true);
  instance.cancel(first.id);
  await done;
  assert.equal(store.getRegressionRun(first.id).state, 'cancelled');
  assert.throws(() => store.cancelRegressionRun({ projectId: 'project-a', id: first.id }), /já terminou/);
  assert.deepEqual([items[0], items[1]].map((item) => evidenceOf(item.review.id)[0].payload.state), ['cancelled', 'cancelled']);
});

test('parada pedida entre o início e o spawn encerra o processo assim que ele nasce', async (t) => {
  const { store, configure, enqueue, runner } = harness(t);
  configure(script('setTimeout(()=>{},60000)'));
  const queued = enqueue();
  const { spawn } = await import('node:child_process');
  const started = Date.now();
  await runner({
    spawnImpl: (...args) => {
      store.cancelRegressionRun({ projectId: 'project-a', id: queued.id });
      return spawn(...args);
    },
  }).notify();
  assert.equal(store.getRegressionRun(queued.id).state, 'cancelled');
  assert(Date.now() - started < 20000, 'não esperou o processo terminar sozinho');
});

test('uma execução por vez, na ordem da fila', async (t) => {
  const { store, configure, enqueue, runner } = harness(t, { reviews: 3 });
  configure(script("console.log(Date.now());setTimeout(()=>console.log(Date.now()),150)"));
  enqueue(0); enqueue(1); enqueue(2);
  const instance = runner();
  await Promise.all([instance.notify(), instance.notify()]);
  const runs = store.listRegressionRuns('project-a');
  assert.deepEqual(runs.map((run) => run.state), ['passed', 'passed', 'passed']);
  const spans = runs.map((run) => fs.readFileSync(run.logPath, 'utf8').trim().split(/\s+/).map(Number));
  for (let index = 1; index < spans.length; index += 1) assert(spans[index][0] >= spans[index - 1][1], 'a seguinte começa depois da anterior terminar');
});

test('teto de segurança corta o arquivo com marca visível e conta todos os bytes', async (t) => {
  const { store, configure, enqueue, runner } = harness(t);
  configure(script("process.stdout.write('a'.repeat(5000))"));
  enqueue();
  await runner({ maxLogBytes: 1000, tailBytes: 100 }).notify();
  const [listed] = store.listRegressionRuns('project-a');
  const run = store.getRegressionRun(listed.id);
  assert.equal(run.state, 'passed', 'o corte do log não muda o resultado do comando');
  assert.equal(run.logTruncated, true);
  assert.equal(run.logBytes, 5000, 'bytes produzidos pela suíte');
  const content = fs.readFileSync(run.logPath, 'utf8');
  assert.equal(content.indexOf('[ATLAS] log cortado em 1000 bytes'), 1001);
  assert.equal(run.logSha256, createHash('sha256').update(content).digest('hex'), 'SHA-256 do arquivo gravado');
  assert.equal(run.logTail, 'a'.repeat(100));
});

test('sem como gravar o log ou iniciar o shell: erro, nunca sucesso', async (t) => {
  const { store, directory, configure, enqueue, runner } = harness(t, { reviews: 2 });
  configure(script('process.exit(0)'));
  enqueue(0);
  const blocked = path.join(directory, 'arquivo-no-lugar-da-pasta');
  fs.writeFileSync(blocked, '');
  await runner({ logsDir: blocked }).notify();
  const [first] = store.listRegressionRuns('project-a');
  assert.equal(first.state, 'error');
  assert.match(first.error, /arquivo de log/);

  enqueue(1);
  await runner({ spawnImpl: () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); } }).notify();
  const second = store.listRegressionRuns('project-a')[1];
  assert.equal(second.state, 'error');
  assert.match(second.error, /shell não iniciou: ENOENT/);
});

test('processo filho que segura os pipes não prende o resultado do shell', async (t) => {
  const { store, configure, enqueue, runner } = harness(t);
  configure(script("require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},4000)'],{stdio:'inherit'}).unref();console.log('saiu')"));
  enqueue();
  const started = Date.now();
  await runner().notify();
  const [run] = store.listRegressionRuns('project-a');
  assert.equal(run.state, 'passed');
  assert(Date.now() - started < 3800, 'terminou pelo shell, sem esperar o neto');
});

test('fechamento ou reinício durante a suíte: interrompida, sem gravar sucesso', async (t) => {
  const { closers, store, filename, items, configure, enqueue, runner } = harness(t, { reviews: 2 });
  configure(script('setTimeout(()=>{},60000)'));
  const running = enqueue(0);
  const queued = enqueue(1);
  const instance = runner();
  const done = instance.notify();
  while (store.getRegressionRun(running.id).state !== 'running') await new Promise((resolve) => setTimeout(resolve, 20));
  instance.shutdown();
  await done;
  assert.equal(store.getRegressionRun(running.id).state, 'running', 'o executor não grava depois do fechamento');
  closeOperationalStore(store);
  const reopened = createOperationalStore({ filename });
  closers.push(() => reopened.close());
  assert.equal(reopened.getRegressionRun(running.id).state, 'interrupted');
  assert.equal(reopened.getRegressionRun(queued.id).state, 'interrupted');
  assert.match(reopened.getRegressionRun(running.id).error, /fechado antes/);
  assert.equal(reopened.reconcileRegressionRuns(), 0, 'nada é repetido sozinho');
  assert.deepEqual(items.map((item) => reopened.listEvidence('project-a').find((row) => row.reviewId === item.review.id && row.kind === 'regression_run').payload.state), ['interrupted', 'interrupted']);
});

test('ambiente, shell e trecho legível', () => {
  assert.deepEqual(suiteEnv({ PATH: 'x', ATLAS_MCP_TOKEN: 't', Atlas_Other: 'o', OPENCODE_CONFIG_CONTENT: '{}', opencode_config_content: '{}', HOME: 'h' }), { PATH: 'x', HOME: 'h' });
  assert.deepEqual(shellInvocation('npm test', 'win32', { ComSpec: 'C:\\Windows\\cmd.exe' }), { file: 'C:\\Windows\\cmd.exe', args: ['/d', '/s', '/c', '"npm test"'], options: { windowsVerbatimArguments: true, windowsHide: true } });
  assert.deepEqual(shellInvocation('npm test', 'linux', {}), { file: '/bin/sh', args: ['-c', 'npm test'], options: { detached: true } });
  assert.equal(readableTail(Buffer.from('\x1b[1mok\x1b[0m\r\nlinha\u202e\x07\tfim')), 'ok\nlinha\tfim');
});

test('host: sugestão só com scripts.test, log só dentro da pasta de logs e janela autorizada', async (t) => {
  const { store, directory, configure, enqueue, runner, logsDir } = harness(t);
  const read = (manifest) => () => JSON.stringify(manifest);
  assert.equal(suggestCommand('/p', read({ scripts: { test: 'vitest' } })), 'npm test');
  assert.equal(suggestCommand('/p', read({ scripts: { build: 'vite' } })), null);
  assert.equal(suggestCommand('/p', () => '{inválido'), null);
  assert.equal(suggestCommand('/p', () => { throw new Error('ENOENT'); }), null);

  configure(script("console.log('ok')"));
  enqueue();
  const instance = runner();
  await instance.notify();
  const [run] = store.listRegressionRuns('project-a');
  const outside = path.join(directory, 'fora.log');
  fs.writeFileSync(outside, 'x');
  assert.equal(insideLogs(logsDir, outside), null);
  assert.equal(insideLogs(logsDir, path.join(logsDir, '..', 'fora.log')), null);
  assert.equal(insideLogs(logsDir, run.logPath), fs.realpathSync(run.logPath));

  const handlers = new Map();
  const opened = [];
  const projects = { 'project-a': { id: 'project-a', path: path.join(directory, 'project-a') }, 'project-b': { id: 'project-b', path: path.join(directory, 'project-b') } };
  const projectHost = { ready: Promise.resolve(), rootsReady: Promise.resolve(), isAllowedCwd: (cwd) => cwd in projects, getProjectForCwd: (cwd) => projects[cwd], waitForCwd: async () => {} };
  const changes = [];
  createRegressionSuiteHost({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    projectHost, store, runner: instance, logsDir,
    shell: { openPath: async (file) => { opened.push(['open', file]); return ''; }, showItemInFolder: (file) => opened.push(['reveal', file]) },
    isMainSender: (event) => event.main === true, onChange: (id) => changes.push(id),
    readFile: read({ scripts: { test: 'node --test' } }),
  });
  const call = (channel, request, main = true) => handlers.get(channel)({ main }, request);
  await assert.rejects(call('regression-suite:get', { cwd: 'project-a' }, false), /Janela não autorizada/);
  const current = await call('regression-suite:get', { cwd: 'project-a' });
  assert.equal(current.suggestion, 'npm test');
  assert.equal(current.suite.version, 1);
  const saved = await call('regression-suite:set', { cwd: 'project-a', enabled: false, command: 'npm test', timeoutSeconds: 120, expectedVersion: 1 });
  assert.equal(saved.enabled, false);
  assert.deepEqual(changes, ['project-a']);
  await assert.rejects(call('regression-run:get', { cwd: 'project-b', id: run.id }), /não encontrada neste projeto/);
  assert.match((await call('regression-run:get', { cwd: 'project-a', id: run.id })).logTail, /ok/);
  await call('regression-run:open-log', { cwd: 'project-a', id: run.id });
  await call('regression-run:open-log', { cwd: 'project-a', id: run.id, reveal: true });
  assert.deepEqual(opened.map(([kind]) => kind), ['open', 'reveal']);
  fs.rmSync(run.logPath);
  await assert.rejects(call('regression-run:open-log', { cwd: 'project-a', id: run.id }), /não foi encontrado/);
  await assert.rejects(call('regression-run:cancel', { cwd: 'project-a', id: run.id }), /já terminou/);
});
