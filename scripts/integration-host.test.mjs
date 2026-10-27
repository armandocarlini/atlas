import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createIntegrationHost } = require('../electron/integration-host.cjs');

function harness(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-integration-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const handlers = new Map();
  createIntegrationHost({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    isMainSender: (event) => event.sender === 'main',
    execPath: '/opt/atlas/electron',
    bridgePath: '/opt/atlas/electron/atlas-mcp-bridge.cjs',
    env: { KIMI_CODE_HOME: home },
  });
  // ipcMain.handle converte exceções síncronas em rejeições; o harness faz o mesmo.
  const call = async (name, request, sender = 'main') => handlers.get(name)({ sender }, request);
  return { home, call, file: path.join(home, 'mcp.json') };
}

test('estado mostra arquivo e conteúdo exato que será gravado', async (t) => {
  const { call, file } = harness(t);
  const status = await call('integration:kimi-mcp-status');
  assert.equal(status.state, 'absent');
  assert.equal(status.file, file);
  assert.deepEqual(JSON.parse(status.entryText), { mcpServers: { atlas: { command: '/opt/atlas/electron', args: ['/opt/atlas/electron/atlas-mcp-bridge.cjs'], env: { ELECTRON_RUN_AS_NODE: '1' } } } });
  assert.equal(fs.existsSync(file), false);
});

test('instalar e remover exigem confirmação explícita e janela principal', async (t) => {
  const { call, file } = harness(t);
  await assert.rejects(call('integration:kimi-mcp-install', {}), /Confirme/);
  await assert.rejects(call('integration:kimi-mcp-install', { confirm: 'true' }), /Confirme/);
  await assert.rejects(call('integration:kimi-mcp-install', { confirm: true }, 'popup'), /não autorizada/);
  await assert.rejects(call('integration:kimi-mcp-status', undefined, 'popup'), /não autorizada/);
  assert.equal(fs.existsSync(file), false);
  assert.equal((await call('integration:kimi-mcp-install', { confirm: true })).state, 'installed');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.atlas.command, '/opt/atlas/electron');
  await assert.rejects(call('integration:kimi-mcp-remove', {}), /Confirme/);
  assert.equal((await call('integration:kimi-mcp-remove', { confirm: true })).state, 'absent');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mcpServers: {} });
});

test('JSON inválido do usuário vira erro acionável sem escrita', async (t) => {
  const { call, file } = harness(t);
  fs.writeFileSync(file, '{ quebrado');
  const status = await call('integration:kimi-mcp-status');
  assert.equal(status.state, 'invalid');
  assert.match(status.error, /não é JSON válido/);
  await assert.rejects(call('integration:kimi-mcp-install', { confirm: true }), /não é JSON válido/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ quebrado');
});
