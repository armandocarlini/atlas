import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Continuidade ao reabrir o ATLAS (docs/planos/PLANO_CONTINUIDADE_SESSOES.md): o agent host
// retoma as sessões que estavam em execução no último fechamento, sem pedir confirmação.
const { createAgentHost } = createRequire(import.meta.url)('../electron/agent-host.cjs');
const { createOperationalStore } = createRequire(import.meta.url)('../electron/operational-store.cjs');

const KIMI = { id: 'kimi-code', name: 'Kimi Code', command: 'kimi', spawnArgs: [], executable: 'C:\\cli\\kimi.exe', version: '2.5.2', status: 'available', error: null };
const OPENCODE = { id: 'opencode', name: 'OpenCode', command: 'opencode', spawnArgs: [], executable: 'C:\\npm\\opencode.cmd', version: '2.2.6', status: 'available', error: null };
const CLAUDE = { id: 'claude-code', name: 'Claude Code', command: 'claude', spawnArgs: [], modelEntry: 'free', executable: 'C:\\cli\\claude.exe', version: '2.1.322', status: 'available', error: null };
const claudeProfile = { instructions: 'C:\\perfil\\claude-orchestrator.md', instructionsAuto: 'C:\\perfil\\auto.md', settings: 'C:\\perfil\\settings.json', mcpConfig: 'C:\\perfil\\mcp.json' };
const projectRecords = [{ id: 'project-a', name: 'Fixture', path: 'C:\\projeto' }];

function harness({ store, adapters, allowedCwds = ['C:\\projeto'], models = async () => [], onPersistenceError = () => {}, resumeGrace = async () => {} }) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler), on: () => {} };
  const projectHost = {
    ready: Promise.resolve(),
    getDefaultCwd: () => allowedCwds[0],
    isAllowedCwd: (cwd) => allowedCwds.some((allowed) => allowed.toLowerCase() === String(cwd).toLowerCase()),
    getProjectForCwd: () => projectRecords[0],
    getProjects: () => projectRecords,
  };
  const spawns = [];
  const records = [];
  const transport = {
    close: (record) => { record.closed = true; },
    spawn(request) {
      spawns.push(request);
      let exitCallback = null;
      const record = { id: `pty-${spawns.length}`, meta: request.meta, process: { onExit: (callback) => { exitCallback = callback; }, write: () => {}, kill: () => {} }, emitExit: (exitCode, signal = null) => exitCallback?.({ exitCode, signal }) };
      records.push(record);
      return record;
    },
  };
  const host = createAgentHost({
    ipcMain, projectHost, transport, store, onPersistenceError, claudeProfile,
    orchestratorProfile: '/fixture/atlas-orchestrator.md',
    isMainSender: (event) => event.sender === 'main',
    listModelsImpl: models,
    resumeGrace,
    discover: async () => adapters,
  });
  const mainEvent = { sender: 'main' };
  const create = (request) => handlers.get('agent:create')(mainEvent, { cwd: 'C:\\projeto', ...request });
  const openPrincipal = (request) => handlers.get('agent:open-orchestrator')(mainEvent, { cwd: 'C:\\projeto', ...request });
  return { handlers, host, spawns, records, mainEvent, create, openPrincipal };
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-restore-'));
  const filename = path.join(directory, 'state.sqlite');
  let store = createOperationalStore({ filename });
  store.registerProject(projectRecords[0]);
  t.after(() => {
    if (!store.closed) store.close();
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith('atlas-restore-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return {
    get store() { return store; },
    // Reinício: o banco reabre e reconcilia o que ficou ativo, como o main.cjs.
    restart() { store.close(); store = createOperationalStore({ filename }); store.reconcileRuns(); return store; },
  };
}

// Fecha o app como o main.cjs: para de gravar saídas, marca as runs e só então mata os processos.
function closeApp(app, store) {
  app.host.prepareShutdown();
  store.markAppClosed();
  app.records.forEach((record) => record.emitExit(1, null));
}

const nothing = { restored: [], fresh: [], failed: [] };
const names = (items) => items.map((item) => item.name).sort();
const opencodeModels = async (adapter) => (adapter.id === 'opencode' ? ['nvidia/deep'] : []);

test('reabrir retoma cada sessão com o mesmo CLI, modelo e pasta, e a conversa certa', async (t) => {
  const state = fixture(t);
  const errors = [];
  const first = harness({ store: state.store, adapters: [CLAUDE, OPENCODE, KIMI], models: opencodeModels, onPersistenceError: (error) => errors.push(error) });
  const claude = await first.create({ adapterId: 'claude-code', model: 'claude-opus-5-5', name: 'revisor' });
  const conversation = first.spawns[0].args.at(-1);
  await first.create({ adapterId: 'opencode', model: 'nvidia/deep', name: 'oc-antigo' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await first.create({ adapterId: 'opencode', model: 'nvidia/deep', name: 'oc-recente' });
  await first.create({ adapterId: 'kimi-code', name: 'kimi' });
  closeApp(first, state.store);
  assert.deepEqual(errors, [], 'saídas forçadas do fechamento não viram erro nem "falhou"');
  assert(state.store.listRuns('project-a').every((run) => run.state === 'lost' && run.reason === 'application_closed'));

  const second = harness({ store: state.restart(), adapters: [CLAUDE, OPENCODE, KIMI], models: opencodeModels });
  const result = await second.host.restoreSessions();
  const argsOf = (name) => second.spawns[Number(second.host.listAgents().find((agent) => agent.name === name && agent.state === 'running').ptyId.slice(4)) - 1].args;
  assert.deepEqual(argsOf('revisor'), ['--model', 'claude-opus-5-5', '--resume', conversation], 'Claude Code volta à mesma conversa');
  assert.deepEqual(argsOf('oc-recente'), ['--model', 'nvidia/deep', '--continue'], 'a mais recente da pasta pega a conversa');
  assert.deepEqual(argsOf('oc-antigo'), ['--model', 'nvidia/deep'], 'a outra do mesmo CLI e pasta abre conversa nova');
  assert.deepEqual(argsOf('kimi'), ['--continue']);
  assert.deepEqual(names(result.restored), ['kimi', 'oc-recente', 'revisor']);
  assert.deepEqual(names(result.fresh), ['oc-antigo']);
  assert.deepEqual(result.failed, []);
  const revived = second.host.listAgents().find((agent) => agent.id === claude.id);
  assert.deepEqual([revived.state, revived.runAttempt, revived.cwd, revived.model], ['running', 2, 'C:\\projeto', 'claude-opus-5-5'], 'mesma sessão, nova run');
  assert.deepEqual(second.handlers.get('agent:restore-status')(second.mainEvent), { pending: false, result });
  assert.deepEqual(second.handlers.get('agent:restore-status')({ sender: 'popup' }), { pending: false, result: null }, 'só a janela principal consulta');
  assert.deepEqual(await second.host.restoreSessions(), nothing, 'tentativa única: nada é relançado de novo');
  assert.equal(second.spawns.length, 4);
});

test('modelo trocado dentro do CLI volta como o modelo da sessão retomada', async (t) => {
  const state = fixture(t);
  const first = harness({ store: state.store, adapters: [OPENCODE], models: async () => ['nvidia/deep', 'nvidia/fast'] });
  const agent = await first.create({ adapterId: 'opencode', model: 'nvidia/deep', name: 'oc' });
  await first.handlers.get('agent:declare-model')(first.mainEvent, { sessionId: agent.id, model: 'nvidia/fast' });
  closeApp(first, state.store);
  const second = harness({ store: state.restart(), adapters: [OPENCODE], models: async () => ['nvidia/deep', 'nvidia/fast'] });
  await second.host.restoreSessions();
  assert.deepEqual(second.spawns[0].args, ['--model', 'nvidia/fast', '--continue']);
});

test('falha ao retomar uma sessão não impede as outras e não é repetida', async (t) => {
  const state = fixture(t);
  const first = harness({ store: state.store, adapters: [CLAUDE, KIMI] });
  await first.create({ adapterId: 'kimi-code', name: 'kimi' });
  await first.create({ adapterId: 'claude-code', name: 'claude' });
  closeApp(first, state.store);
  const missingKimi = { ...KIMI, status: 'missing', error: 'Kimi Code não encontrado no PATH.' };
  const second = harness({ store: state.restart(), adapters: [CLAUDE, missingKimi] });
  const result = await second.host.restoreSessions();
  assert.deepEqual(names(result.restored), ['claude']);
  assert.deepEqual(result.failed.map((item) => [item.name, item.error]), [['kimi', 'Kimi Code não encontrado no PATH.']]);
  const third = harness({ store: state.restart(), adapters: [CLAUDE, KIMI] });
  assert.deepEqual(await third.host.restoreSessions(), nothing, 'o CLI que falhou não é relançado a cada abertura');
});

test('sessão encerrada pelo usuário, pasta desautorizada e queda do app não voltam', async (t) => {
  const state = fixture(t);
  const first = harness({ store: state.store, adapters: [KIMI] });
  await first.create({ adapterId: 'kimi-code', name: 'terminou' });
  first.records[0].emitExit(0, null);
  await first.create({ adapterId: 'kimi-code', name: 'aberta' });
  first.host.prepareShutdown();
  state.store.markAppClosed();
  first.records[1].emitExit(1, null);
  const second = harness({ store: state.restart(), adapters: [KIMI], allowedCwds: ['C:\\outra'] });
  const result = await second.host.restoreSessions();
  assert.deepEqual(result.failed.map((item) => item.name), ['aberta'], 'pasta desautorizada: falha honesta, sem PTY');
  assert.equal(second.spawns.length, 0);
  // Queda: run ativa sem fechamento do app vira application_restarted e não volta.
  const crashed = harness({ store: state.restart(), adapters: [KIMI] });
  await crashed.create({ adapterId: 'kimi-code', name: 'queda' });
  const afterCrash = harness({ store: state.restart(), adapters: [KIMI] });
  assert.deepEqual(await afterCrash.host.restoreSessions(), nothing);
});

test('principal volta com o mesmo CLI e o perfil somente leitura, retomando a conversa', async (t) => {
  const state = fixture(t);
  const first = harness({ store: state.store, adapters: [CLAUDE, KIMI] });
  await first.openPrincipal({ adapterId: 'claude-code', model: 'claude-opus-5-5' });
  const launched = first.spawns[0].args;
  const conversation = launched[launched.indexOf('--session-id') + 1];
  closeApp(first, state.store);
  const second = harness({ store: state.restart(), adapters: [CLAUDE, KIMI] });
  const result = await second.host.restoreSessions();
  assert.deepEqual(names(result.restored), ['Principal']);
  const args = second.spawns[0].args;
  assert(args.includes('--restricted') && args.includes('--strict-mcp-config'), 'perfil da principal preservado');
  assert.deepEqual(args.slice(-2), ['--resume', conversation]);
  const principal = await second.openPrincipal({});
  assert.equal(principal.state, 'running', 'a interface encontra a principal retomada, sem pedir escolha');
  assert.equal(second.spawns.length, 1, 'abrir a principal não lança outra');
});

test('principal no Kimi volta com conversa nova: --agent-file não combina com retomada', async (t) => {
  const state = fixture(t);
  const first = harness({ store: state.store, adapters: [KIMI] });
  await first.openPrincipal({ adapterId: 'kimi-code' });
  closeApp(first, state.store);
  const second = harness({ store: state.restart(), adapters: [KIMI] });
  const result = await second.host.restoreSessions();
  assert.deepEqual(names(result.fresh), ['Principal']);
  assert.deepEqual(second.spawns[0].args, ['--agent-file', '/fixture/atlas-orchestrator.md']);
});

test('fechar e reabrir a janela (macOS) volta a gravar as saídas das runs novas', async (t) => {
  const state = fixture(t);
  const app = harness({ store: state.store, adapters: [KIMI] });
  app.host.prepareShutdown();
  app.host.resumeRecording();
  const agent = await app.create({ adapterId: 'kimi-code', name: 'depois' });
  app.records[0].emitExit(0, null);
  const run = state.store.listRuns('project-a').find((item) => item.id === agent.runId);
  assert.equal(run.state, 'succeeded');
});

test('retomada que morre com erro logo ao abrir volta uma vez com conversa nova', async (t) => {
  const state = fixture(t);
  const first = harness({ store: state.store, adapters: [CLAUDE, KIMI] });
  await first.create({ adapterId: 'claude-code', name: 'sem-conversa' });
  await first.create({ adapterId: 'kimi-code', name: 'ok' });
  const conversation = first.spawns[0].args.at(-1);
  closeApp(first, state.store);
  // Durante a carência: o Claude não acha a conversa (nunca gravada) e sai com erro;
  // o Kimi sai com 0 (o usuário encerrou), o que não é falha de retomada.
  let second = null;
  second = harness({ store: state.restart(), adapters: [CLAUDE, KIMI], resumeGrace: async () => {
    // A retomada começa pela sessão mais recente: o Kimi (pty-1), depois o Claude (pty-2).
    second.records[1].emitExit(1, null);
    second.records[0].emitExit(0, null);
  } });
  const result = await second.host.restoreSessions();
  assert.deepEqual(second.spawns[1].args, ['--resume', conversation]);
  assert.equal(second.spawns.length, 3, 'só a retomada com erro é relançada');
  assert.equal(second.spawns[2].args[0], '--session-id');
  assert.notEqual(second.spawns[2].args[1], conversation, 'conversa nova com ID novo');
  const revived = second.host.listAgents().find((agent) => agent.name === 'sem-conversa' && agent.state === 'running');
  assert(revived, 'a sessão volta a rodar');
  assert.equal(state.store.getSession(revived.id).conversation_id, second.spawns[2].args[1], 'o ID novo fica salvo para a próxima vez');
  assert.deepEqual(names(result.restored), ['ok']);
  assert.deepEqual(names(result.fresh), ['sem-conversa']);
});
