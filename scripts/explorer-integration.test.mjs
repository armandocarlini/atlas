import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { createExplorerIntegration, createExplorerHost, openCommand } = require('../electron/explorer-integration.cjs');
const { parseOpenArgument } = require('../electron/open-path-host.cjs');

// Registro em memória que entende os comandos de reg.exe usados pela integração.
function fakeRegistry() {
  const values = new Map();
  const calls = [];
  async function reg(args) {
    calls.push(args);
    const [verb, key] = args;
    if (verb === 'add') {
      const name = args.includes('/ve') ? '' : args[args.indexOf('/v') + 1];
      values.set(`${key.toLowerCase()}|${name}`, args[args.indexOf('/d') + 1]);
      return '';
    }
    if (verb === 'query') {
      const value = values.get(`${key.toLowerCase()}|`);
      if (value === undefined) throw new Error('ERROR: The system was unable to find the specified registry key or value.');
      return `\r\n${key}\r\n    (Default)    REG_SZ    ${value}\r\n`;
    }
    if (verb === 'delete') {
      const prefix = key.toLowerCase();
      const before = values.size;
      for (const item of [...values.keys()]) if (item.startsWith(`${prefix}|`) || item.startsWith(`${prefix}\\`)) values.delete(item);
      if (before === values.size) throw new Error('não encontrada');
      return '';
    }
    throw new Error(`verbo inesperado ${verb}`);
  }
  // Leitura do valor padrão como o PowerShell faz: null sem chave, '' sem valor.
  async function readDefault(key) {
    const prefix = key.toLowerCase();
    const value = values.get(`${prefix}|`);
    if (value !== undefined) return value;
    return [...values.keys()].some((item) => item.startsWith(`${prefix}\\`)) ? '' : null;
  }
  return { reg, readDefault, values, calls };
}

const EXE = 'C:\\Program Files\\ATLAS\\ATLAS.exe';

test('comando do Explorador entrega a pasta como um único argumento, sem shell', () => {
  assert.equal(openCommand({ execPath: EXE }), '"C:\\Program Files\\ATLAS\\ATLAS.exe" "--atlas-open=%V"');
  assert.equal(openCommand({ execPath: 'C:\\e\\electron.exe', appPath: 'C:\\dev\\atlas' }), '"C:\\e\\electron.exe" "C:\\dev\\atlas" "--atlas-open=%V"');
  assert.throws(() => openCommand({ execPath: 'C:\\x"y.exe' }), /inválido/);
  // Raiz de unidade: a barra final escapa a aspa na linha de comando do Windows.
  assert.equal(parseOpenArgument(['ATLAS.exe', '--atlas-open=D:"']), 'D:\\');
  assert.equal(parseOpenArgument(['ATLAS.exe', '--atlas-open=\\\\servidor\\pasta"']), '\\\\servidor\\pasta\\', 'regressão: raiz de compartilhamento');
});

test('status, instalação nas duas entradas, atualização e remoção idempotente', async () => {
  const registry = fakeRegistry();
  const integration = createExplorerIntegration({ execPath: EXE, root: 'HKCU\\Software\\Teste', reg: registry.reg, readDefault: registry.readDefault, platform: 'win32' });
  assert.equal((await integration.getStatus()).state, 'absent');
  const installed = await integration.install();
  assert.equal(installed.state, 'installed');
  assert.deepEqual(installed.keys, ['HKCU\\Software\\Teste\\Directory\\shell\\ATLAS.Open', 'HKCU\\Software\\Teste\\Directory\\Background\\shell\\ATLAS.Open']);
  assert.equal(registry.values.get('hkcu\\software\\teste\\directory\\shell\\atlas.open|'), 'Abrir no ATLAS');
  assert.equal(registry.values.get('hkcu\\software\\teste\\directory\\background\\shell\\atlas.open\\command|'), '"C:\\Program Files\\ATLAS\\ATLAS.exe" "--atlas-open=%V"');
  assert(registry.calls.every((args) => args.every((item) => typeof item === 'string')), 'argumentos em vetor, sem linha de shell');
  const moved = createExplorerIntegration({ execPath: 'D:\\Outro\\ATLAS.exe', root: 'HKCU\\Software\\Teste', reg: registry.reg, readDefault: registry.readDefault, platform: 'win32' });
  assert.equal((await moved.getStatus()).state, 'outdated');
  assert.equal((await moved.install()).state, 'installed');
  assert.equal((await integration.remove()).state, 'absent');
  assert.equal((await integration.remove()).state, 'absent', 'remover de novo não falha');
});

test('fora do Windows a integração é indisponível e não chama reg.exe', async () => {
  const registry = fakeRegistry();
  const integration = createExplorerIntegration({ execPath: '/usr/bin/atlas', reg: registry.reg, readDefault: registry.readDefault, platform: 'linux' });
  assert.equal((await integration.getStatus()).state, 'unsupported');
  await assert.rejects(integration.install(), /só existe no Windows/);
  assert.deepEqual(registry.calls, []);
});

test('IPC exige janela principal e confirmação explícita', async () => {
  const registry = fakeRegistry();
  const handlers = new Map();
  createExplorerHost({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, isMainSender: (event) => event.sender === 'main', integration: createExplorerIntegration({ execPath: EXE, root: 'HKCU\\Software\\Teste', reg: registry.reg, readDefault: registry.readDefault, platform: 'win32' }) });
  const invoke = (name, payload, sender = 'main') => handlers.get(name)({ sender }, payload);
  assert.throws(() => invoke('explorer:install', { confirm: true }, 'popup'), /Janela não autorizada/);
  assert.throws(() => invoke('explorer:install', {}), /Confirme na interface/);
  assert.throws(() => invoke('explorer:remove', { confirm: 'sim' }), /Confirme na interface/);
  assert.deepEqual(registry.calls, [], 'nada gravado sem confirmação');
  assert.equal((await invoke('explorer:install', { confirm: true })).state, 'installed');
});

test('reg.exe real em chave de fixture isolada (somente Windows)', { skip: process.platform !== 'win32' }, async (t) => {
  const root = `HKCU\\Software\\ATLAS-Test-${randomUUID()}`;
  t.after(() => { try { execFileSync('reg.exe', ['delete', root, '/f'], { windowsHide: true, stdio: 'ignore' }); } catch { /* já removida */ } });
  // Regressão: caminho com acento não pode depender da página de código do reg.exe.
  const integration = createExplorerIntegration({ execPath: 'C:\\Usuários\\João\\ATLAS Ação\\ATLAS.exe', root });
  assert.equal((await integration.getStatus()).state, 'absent');
  assert.equal((await integration.install()).state, 'installed');
  const query = execFileSync('reg.exe', ['query', `${root}\\Directory\\shell\\ATLAS.Open\\command`, '/ve'], { encoding: 'utf8', windowsHide: true });
  assert(query.includes('"--atlas-open=%V"'));
  assert.equal((await integration.remove()).state, 'absent');
});
