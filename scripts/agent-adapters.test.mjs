import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const { ADAPTERS, discoverAdapters, parseVersion, resolveOnPath } = createRequire(import.meta.url)('../electron/agent-adapters.cjs');

const kimi = ADAPTERS.find((adapter) => adapter.id === 'kimi-code');

test('descoberta encontra o executável no PATH e lê a versão com execFile', async () => {
  const calls = [];
  const [adapter] = await discoverAdapters({
    env: { PATH: 'C:\\cli;C:\\outros', PATHEXT: '.EXE;.CMD' },
    platform: 'win32',
    existsSync: (candidate) => candidate === 'C:\\cli\\kimi.exe',
    execFileImpl: async (file, args) => {
      calls.push({ file, args });
      return { stdout: '2.3.2\n', stderr: '' };
    },
  });
  assert.equal(adapter.status, 'available');
  assert.equal(adapter.executable, 'C:\\cli\\kimi.exe');
  assert.equal(adapter.version, '2.3.2');
  assert.deepEqual(calls, [{ file: 'C:\\cli\\kimi.exe', args: ['--version'] }]);
});

test('descoberta prefere .exe a shims .cmd no Windows', () => {
  const resolved = resolveOnPath('kimi', {
    env: { PATH: 'C:\\cli', PATHEXT: '.CMD;.EXE' },
    platform: 'win32',
    existsSync: () => true,
  });
  assert.equal(resolved, 'C:\\cli\\kimi.exe');
});

test('descoberta resolve executável sem extensão no POSIX', async () => {
  const [adapter] = await discoverAdapters({
    env: { PATH: '/usr/local/bin:/usr/bin' },
    platform: 'linux',
    existsSync: (candidate) => candidate === '/usr/bin/kimi',
    execFileImpl: async (file) => {
      assert.equal(file, '/usr/bin/kimi');
      return { stdout: '2.3.2\n', stderr: '' };
    },
  });
  assert.equal(adapter.status, 'available');
  assert.equal(adapter.executable, '/usr/bin/kimi');
});

test('adaptador ausente do PATH fica indisponível com erro acionável', async () => {
  const [adapter] = await discoverAdapters({
    env: { PATH: 'C:\\vazio', PATHEXT: '.EXE' },
    platform: 'win32',
    existsSync: () => false,
    execFileImpl: async () => { throw new Error('não deve ser chamado'); },
  });
  assert.equal(adapter.status, 'unavailable');
  assert.equal(adapter.executable, null);
  assert.match(adapter.error, /não está no PATH/);
});

test('timeout do --version gera erro acionável', async () => {
  const [adapter] = await discoverAdapters({
    env: { PATH: 'C:\\cli', PATHEXT: '.EXE' },
    platform: 'win32',
    existsSync: () => true,
    execFileImpl: async () => {
      const error = new Error('timed out');
      error.killed = true;
      error.signal = 'SIGTERM';
      throw error;
    },
  });
  assert.equal(adapter.status, 'unavailable');
  assert.match(adapter.error, /não respondeu em 5s/);
  assert.match(adapter.error, /kimi\.exe/);
});

test('saída com código de erro vira indisponibilidade explicada', async () => {
  const [adapter] = await discoverAdapters({
    env: { PATH: 'C:\\cli', PATHEXT: '.EXE' },
    platform: 'win32',
    existsSync: () => true,
    execFileImpl: async () => {
      const error = new Error('failed');
      error.code = 3;
      throw error;
    },
  });
  assert.equal(adapter.status, 'unavailable');
  assert.match(adapter.error, /código 3/);
});

test('parseVersion extrai semver de saída com ruído', () => {
  assert.equal(parseVersion('kimi 2.3.2-beta.1\noutra linha'), '2.3.2-beta.1');
  assert.equal(parseVersion('sem versão'), 'sem versão');
});

test('o adaptador kimi não recebe flags de autonomia nem prompt inicial', () => {
  assert.deepEqual(kimi.spawnArgs, []);
  assert.deepEqual(kimi.versionArgs, ['--version']);
});
