import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createTerminalHost } = require('../electron/terminal-host.cjs');
const { createOperationalStore } = require('../electron/operational-store.cjs');

function fixture() {
  const handlers = new Map();
  const sender = {};
  const records = new Map();
  const host = createTerminalHost({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }),
    projectHost: {
      ready: Promise.resolve(),
      isAllowedCwd: (cwd) => cwd === '/worktree',
      getProjectForCwd: () => ({ id: 'project-1' }),
    },
    transport: {
      spawn({ cwd }) {
        const record = { id: `pty-${records.size + 1}`, cwd, exit: null, closing: false };
        records.set(record.id, record);
        return record;
      },
    },
    getShellPath: () => 'powershell.exe',
  });
  return { host, records, invoke: (channel, request) => handlers.get(channel)({ sender }, request) };
}

test('fechamento salva apenas terminais vivos e a abertura os recria uma vez, com o nome e a pasta', async () => {
  const store = createOperationalStore({ filename: ':memory:' });
  try {
    const before = fixture();
    const live = await before.invoke('terminal:create', { name: 'Trabalho', cwd: '/worktree' });
    const closed = await before.invoke('terminal:create', { name: 'Já encerrado', cwd: '/worktree' });
    const closing = await before.invoke('terminal:create', { name: 'Encerrando', cwd: '/worktree' });
    before.records.get(closed.id).exit = { exitCode: 0 };
    before.records.get(closing.id).closing = true;
    store.markAppClosed(before.host.snapshotForQuit());

    const after = fixture();
    after.host.restoreTerminals(store.takeRestorableTerminals());
    const { terminals, failed } = await after.invoke('terminal:list');
    assert.deepEqual(failed, []);
    assert.equal(terminals.length, 1);
    assert.deepEqual({
      sessionId: terminals[0].sessionId,
      name: terminals[0].name,
      cwd: terminals[0].cwd,
      projectId: terminals[0].projectId,
    }, { sessionId: live.sessionId, name: 'Trabalho', cwd: '/worktree', projectId: 'project-1' });
    assert.equal(after.records.get(terminals[0].id).cwd, '/worktree');
    assert.deepEqual(store.takeRestorableTerminals(), []);
    assert.equal((await after.invoke('terminal:list')).terminals.length, 1);
    assert.equal(after.records.size, 1);
  } finally {
    store.close();
  }
});

test('pasta desautorizada é relatada e não impede a retomada de outro PowerShell', async () => {
  const { host, invoke, records } = fixture();
  host.restoreTerminals([
    { sessionId: 'invalid', name: 'Desautorizado', cwd: '/fora' },
    { sessionId: 'valid', name: 'Trabalho', cwd: '/worktree' },
  ]);
  const { terminals, failed } = await invoke('terminal:list');
  assert.deepEqual(terminals.map((item) => item.sessionId), ['valid']);
  assert.deepEqual(failed.map((item) => item.name), ['Desautorizado']);
  assert.match(failed[0].error, /autorizada/);
  assert.equal(records.size, 1);
});
