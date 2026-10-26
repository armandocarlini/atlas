import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { createAgentHost } = createRequire(import.meta.url)('../electron/agent-host.cjs');
const { createOperationalStore } = createRequire(import.meta.url)('../electron/operational-store.cjs');

function createHarness({ allowedCwds = ['C:\\projeto'], adapters, store, onPersistenceError, projectRecords = [] } = {}) {
  const handlers = new Map();
  const listeners = new Map();
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    on: (channel, handler) => listeners.set(channel, handler),
  };
  const projectHost = {
    ready: Promise.resolve(),
    getDefaultCwd: () => allowedCwds[0],
    isAllowedCwd: (cwd) => allowedCwds.some((allowed) => allowed.toLowerCase() === String(cwd).toLowerCase()),
    getProjectForCwd: () => ({ id: 'project-a' }),
    getProjects: () => projectRecords,
  };
  const spawns = [];
  const records = [];
  const transport = {
    records,
    close: (record) => { record.closed = true; },
    spawn(request) {
      spawns.push(request);
      let exitCallback = null;
      const record = {
        id: `pty-${spawns.length}`,
        meta: request.meta,
        process: {
          onExit: (callback) => { exitCallback = callback; },
          write: () => {},
          kill: () => {},
        },
        emitExit: (exitCode = 0, signal = null) => exitCallback?.({ exitCode, signal }),
      };
      records.push(record);
      return record;
    },
  };
  const mainEvent = { sender: 'main' };
  const host = createAgentHost({
    ipcMain,
    projectHost,
    transport,
    store,
    onPersistenceError,
    isMainSender: (event) => event.sender === 'main',
    discover: async () => adapters || [{
      id: 'kimi-code',
      name: 'Kimi Code',
      command: 'kimi',
      versionArgs: ['--version'],
      spawnArgs: [],
      executable: 'C:\\cli\\kimi.exe',
      version: '2.3.2',
      status: 'available',
      error: null,
    }],
  });
  return { handlers, projectHost, transport, spawns, host, mainEvent };
}

test('agent:create gera identidade no processo principal e inicia o PTY do adaptador', async () => {
  const { handlers, spawns, mainEvent } = createHarness();
  const agent = await handlers.get('agent:create')(mainEvent, { adapterId: 'kimi-code', name: '  investigação  ', cwd: 'C:\\projeto' });
  assert.equal(agent.name, 'investigação');
  assert.equal(agent.origin, 'user');
  assert.equal(agent.state, 'running');
  assert.equal(agent.cli, 'Kimi Code');
  assert.equal(agent.version, '2.3.2');
  assert.equal(agent.ptyId, 'pty-1');
  assert.match(agent.id, /^[0-9a-f-]{36}$/);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].file, 'C:\\cli\\kimi.exe');
  assert.deepEqual(spawns[0].args, []);
  assert.equal(spawns[0].cwd, 'C:\\projeto');
  assert.equal(spawns[0].meta.kind, 'agent');
});

test('agent:create rejeita cwd fora das pastas autorizadas', async () => {
  const { handlers, spawns, mainEvent } = createHarness();
  await assert.rejects(
    handlers.get('agent:create')(mainEvent, { adapterId: 'kimi-code', cwd: 'C:\\Windows\\System32' }),
    /pasta autorizada/,
  );
  assert.equal(spawns.length, 0);
});

test('agent:create rejeita adaptador desconhecido ou indisponível', async () => {
  const { handlers, mainEvent, spawns } = createHarness({
    adapters: [{
      id: 'kimi-code', name: 'Kimi Code', command: 'kimi', spawnArgs: [], executable: null,
      version: null, status: 'unavailable', error: 'Kimi Code não está no PATH. Instale o CLI e reabra o ATLAS.',
    }],
  });
  await assert.rejects(handlers.get('agent:create')(mainEvent, { adapterId: 'inexistente', cwd: 'C:\\projeto' }), /Adaptador desconhecido/);
  await assert.rejects(handlers.get('agent:create')(mainEvent, { adapterId: 'kimi-code', cwd: 'C:\\projeto' }), /não está no PATH/);
  assert.equal(spawns.length, 0);
});

test('agent:create usa o diretório padrão e nome gerado quando omitidos', async () => {
  const { handlers, spawns, mainEvent } = createHarness();
  const agent = await handlers.get('agent:create')(mainEvent, { adapterId: 'kimi-code', name: '   ' });
  assert.equal(agent.cwd, 'C:\\projeto');
  assert.equal(agent.name, 'kimi-code-1');
  assert.equal(spawns[0].cwd, 'C:\\projeto');
});

test('estado operacional vai apenas de running para exited', async () => {
  const { handlers, transport, mainEvent } = createHarness();
  const agent = await handlers.get('agent:create')(mainEvent, { adapterId: 'kimi-code', cwd: 'C:\\projeto' });
  assert.equal(agent.state, 'running');
  const listed = handlers.get('agent:list')(mainEvent);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].state, 'running');
  // Simula o encerramento do processo real.
  transport.records[0].emitExit(0, null);
  const after = handlers.get('agent:list')(mainEvent);
  assert.equal(after[0].state, 'exited');
  assert.equal(after[0].exit.exitCode, 0);
});

test('agent:create limita o tamanho do nome e recusa tipos inválidos', async () => {
  const { handlers, mainEvent } = createHarness();
  const longName = 'x'.repeat(200);
  const agent = await handlers.get('agent:create')(mainEvent, { adapterId: 'kimi-code', name: longName, cwd: 'C:\\projeto' });
  assert.equal(agent.name.length, 60);
  const numeric = await handlers.get('agent:create')(mainEvent, { adapterId: 'kimi-code', name: 42, cwd: 'C:\\projeto' });
  assert.equal(numeric.name, 'kimi-code-2');
});

test('janelas que não são a principal não criam nem listam agentes', async () => {
  const { handlers } = createHarness();
  const popupEvent = { sender: 'popup' };
  await assert.rejects(handlers.get('agent:create')(popupEvent, { adapterId: 'kimi-code', cwd: 'C:\\projeto' }), /não autorizada/);
  assert.deepEqual(handlers.get('agent:list')(popupEvent), []);
  assert.deepEqual(await handlers.get('agent:list-adapters')(popupEvent), []);
});

test('falha no spawn vira erro acionável sem registrar o agente', async () => {
  const { handlers, transport, mainEvent } = createHarness();
  transport.spawn = () => { throw new Error('ConPTY indisponível'); };
  await assert.rejects(
    handlers.get('agent:create')(mainEvent, { adapterId: 'kimi-code', cwd: 'C:\\projeto' }),
    /Não foi possível iniciar o Kimi Code: ConPTY indisponível/,
  );
  assert.deepEqual(handlers.get('agent:list')(mainEvent), []);
});

test('agente persiste sessão, run e saída em SQLite e conserva histórico ao reabrir', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-agent-store-'));
  const filename = path.join(directory, 'agents.sqlite');
  let store = createOperationalStore({ filename });
  t.after(() => {
    store.close();
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith('atlas-agent-store-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  store.registerProject({ id: 'project-a', name: 'Fixture', path: '/fixtures/project-a' });
  const { handlers, transport, mainEvent } = createHarness({ store });
  const agent = await handlers.get('agent:create')(mainEvent, { adapterId: 'kimi-code' });
  assert.equal(store.listSessions('project-a')[0].id, agent.id);
  assert.equal(store.listRuns('project-a')[0].id, agent.runId);
  transport.records[0].emitExit(0, 0);
  store.close();
  store = createOperationalStore({ filename });
  assert.equal(store.reconcileRuns(), 0);
  assert.equal(store.listRuns('project-a')[0].state, 'succeeded');
  assert.equal(store.listSessions('project-a')[0].id, agent.id);
});

test('falha na persistência encerra PTY e não apresenta sessão criada', async () => {
  const { handlers, transport, mainEvent } = createHarness({
    store: { startSession: () => { throw new Error('disco indisponível'); } },
  });
  await assert.rejects(handlers.get('agent:create')(mainEvent, { adapterId: 'kimi-code' }), /persistir.*disco indisponível/);
  assert.equal(transport.records[0].closed, true);
  assert.deepEqual(handlers.get('agent:list')(mainEvent), []);
});

test('projeto ausente impede spawn mesmo com pasta autorizada', async () => {
  const { handlers, projectHost, spawns, mainEvent } = createHarness({ store: {} });
  projectHost.getProjectForCwd = () => null;
  await assert.rejects(handlers.get('agent:create')(mainEvent, { adapterId: 'kimi-code' }), /Projeto não encontrado/);
  assert.equal(spawns.length, 0);
});

test('falha ao persistir saída é reportada; callback tardio após fechar banco é seguro', async () => {
  const errors = [];
  const store = {
    closed: false,
    startSession: () => ({ id: 'run-a', version: 1 }),
    finishRun: () => { throw new Error('disco indisponível'); },
  };
  const { handlers, transport, mainEvent } = createHarness({ store, onPersistenceError: (error) => errors.push(error) });
  await handlers.get('agent:create')(mainEvent, { adapterId: 'kimi-code' });
  transport.records[0].emitExit(0, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /persistir a saída.*disco indisponível/);
  store.closed = true;
  transport.records[0].emitExit(0, 0);
  assert.equal(errors.length, 1);
});

test('agent:list restaura histórico autorizado sem PTY e sem duplicar agente ativo', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-history-'));
  const store = createOperationalStore({ filename: path.join(directory, 'history.sqlite') });
  t.after(() => {
    store.close();
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith('atlas-history-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const projectRecords = [{ id: 'project-a', name: 'Fixture', path: 'C:\\projeto' }];
  store.registerProject(projectRecords[0]);
  const first = createHarness({ store, projectRecords });
  const agent = await first.handlers.get('agent:create')(first.mainEvent, { adapterId: 'kimi-code' });
  assert.equal(first.host.listAgents().length, 1);
  assert.equal(first.host.listAgents()[0].ptyId, 'pty-1');
  store.reconcileRuns();
  const reopened = createHarness({ store, projectRecords });
  const [history] = reopened.handlers.get('agent:list')(reopened.mainEvent);
  assert.equal(history.id, agent.id);
  assert.equal(history.runId, agent.runId);
  assert.equal(history.archived, true);
  assert.equal(history.ptyId, null);
  assert.equal(history.runState, 'lost');
  assert.equal(history.exit, null);
  assert.equal(reopened.spawns.length, 0);
  assert.deepEqual(reopened.handlers.get('agent:list')({ sender: 'popup' }), []);
  const unauthorized = createHarness({ store, projectRecords, allowedCwds: ['C:\\outro'] });
  assert.deepEqual(unauthorized.host.listAgents(), []);
  // A project remains authorized while an old linked worktree can be unavailable.
  reopened.projectHost.isAllowedCwd = (cwd) => cwd === 'C:\\projeto';
  store.startSession({ id: 'private-session', projectId: 'project-a', name: 'Hidden', adapterId: 'kimi-code', cli: 'Kimi Code', version: '2.3.2', cwd: 'C:\\old-worktree', origin: 'user', createdAt: new Date().toISOString() });
  assert.equal(reopened.host.listAgents().length, 1);
});
