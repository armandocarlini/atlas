// Smoke do pacote Windows (marco 6b).
//   node scripts/smoke-installer.mjs            valida release/win-unpacked sem instalar nada.
//   node scripts/smoke-installer.mjs --install  instala em silêncio numa pasta temporária,
//     valida o app instalado e desinstala. Instalar grava a entrada de desinstalação e os
//     atalhos do usuário atual, então só roda na CI ou com --allow-local-install.
// O app empacotado sempre usa perfil, projeto e home do Kimi de fixture.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { MIGRATIONS } = require('../electron/operational-store.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const installMode = process.argv.includes('--install');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (process.platform !== 'win32') {
  console.log('SKIP instalador: somente Windows');
  process.exit(0);
}
if (installMode && process.env.CI !== 'true' && !process.argv.includes('--allow-local-install')) {
  console.error('A instalação real só roda na CI ou com --allow-local-install.');
  process.exit(1);
}

async function until(check, label, timeout = 30000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try { const result = await check(); if (result) return result; } catch (error) { last = error; }
    await delay(200);
  }
  throw new Error(`Timeout: ${label}${last ? ` (${last.message})` : ''}`);
}

function registryValue(key) {
  try {
    return execFileSync('reg.exe', ['query', key, '/ve'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}
const OPEN_KEYS = ['HKCU\\Software\\Classes\\Directory\\shell\\ATLAS.Open', 'HKCU\\Software\\Classes\\Directory\\Background\\shell\\ATLAS.Open'];

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-installer-'));
const project = path.join(fixture, 'Projeto Instalação');
const profile = path.join(fixture, 'profile');
const kimiHome = path.join(fixture, 'kimi-home');
for (const directory of [project, profile, kimiHome]) fs.mkdirSync(directory);
fs.writeFileSync(path.join(profile, 'atlas-projects.json'), JSON.stringify({ roots: [fs.realpathSync.native(project)] }));
let child = null;

function checkLayout(appDirectory) {
  const unpacked = path.join(appDirectory, 'resources', 'app.asar.unpacked');
  for (const file of [
    'ATLAS.exe',
    'resources/app.asar',
    'resources/app.asar.unpacked/electron/atlas-mcp-bridge.cjs',
    'resources/app.asar.unpacked/node_modules/node-pty/prebuilds/win32-x64/conpty.node',
    'resources/app.asar.unpacked/node_modules/node-pty/prebuilds/win32-x64/conpty/conpty.dll',
  ]) assert(fs.existsSync(path.join(appDirectory, file)), `arquivo ausente no pacote: ${file}`);
  // O patch de ordem de saída do ConPTY (postinstall) precisa estar no pacote.
  assert.match(fs.readFileSync(path.join(unpacked, 'node_modules/node-pty/lib/windowsTerminal.js'), 'utf8'), /atlas_native_exit/);
  console.log('PASS pacote: app.asar, node-pty nativo com patch ConPTY e ponte MCP fora do asar');
}

// A ponte roda como o Kimi a inicia: o executável do ATLAS em modo Node.
async function checkBridge(exe, appDirectory) {
  const bridge = path.join(appDirectory, 'resources', 'app.asar.unpacked', 'electron', 'atlas-mcp-bridge.cjs');
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.ATLAS_MCP_ENDPOINT;
  delete env.ATLAS_MCP_TOKEN;
  const bridgeProcess = spawn(exe, [bridge], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  bridgeProcess.stdout.setEncoding('utf8');
  bridgeProcess.stdout.on('data', (chunk) => { output += chunk; });
  bridgeProcess.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } })}\n`);
  bridgeProcess.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  try {
    const replies = await until(() => {
      const lines = output.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      return lines.length >= 2 ? lines : null;
    }, 'resposta da ponte MCP', 15000);
    assert.equal(replies.find((reply) => reply.id === 1).result.serverInfo.name, 'atlas');
    assert.deepEqual(replies.find((reply) => reply.id === 2).result.tools, [], 'fora de uma run do ATLAS a ponte não expõe ferramentas');
  } finally {
    bridgeProcess.kill();
  }
  console.log('PASS ponte MCP empacotada: inicia pelo executável em modo Node e fica inerte sem token');
}

async function connect(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const requests = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = requests.get(message.id);
    if (!request) return;
    requests.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    requests.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  return { ws, call, evaluate };
}

async function checkApp(exe) {
  const port = Number(process.env.ATLAS_SMOKE_PORT || 9353);
  const env = { ...process.env, KIMI_CODE_HOME: kimiHome };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  child = spawn(exe, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-8000); });
  child.stdout.resume();
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    const page = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((item) => item.type === 'page' && item.url.startsWith('file:')), 'janela principal do app empacotado');
    assert.match(page.url, /app\.asar[\\/]dist[\\/]index\.html/, 'renderer carregado do pacote, sem servidor de desenvolvimento');
    const cdp = await connect(page.webSocketDebuggerUrl);
    await until(() => cdp.evaluate('document.querySelector(".app-shell, #root > *") !== null'), 'interface renderizada');
    const cwd = fs.realpathSync.native(project);
    const output = await cdp.evaluate(`(async () => {
      const desktop = window.atlasDesktop;
      const terminal = await desktop.createTerminal({ cwd: ${JSON.stringify(cwd)}, cols: 100, rows: 30 });
      let text = '';
      const off = desktop.onTerminalData(terminal.id, (payload) => { text += payload.data; });
      const snapshot = await desktop.attachTerminal(terminal.id);
      text = snapshot.scrollback + text;
      desktop.writeTerminal(terminal.id, "Write-Output ('ATLAS' + '_PKG_' + (Get-Location).Path.Length)\\r");
      const start = Date.now();
      while (!/ATLAS_PKG_\\d+/.test(text) && Date.now() - start < 20000) await new Promise((resolve) => setTimeout(resolve, 100));
      off();
      desktop.closePty(terminal.id);
      return { text, cwd: terminal.cwd };
    })()`);
    assert.equal(output.cwd, cwd);
    assert.match(output.text, new RegExp(`ATLAS_PKG_${cwd.length}`), 'PowerShell real pelo node-pty empacotado, na pasta Unicode do projeto');
    console.log('PASS app empacotado: renderer do asar, projeto autorizado e PowerShell real por ConPTY');
    // Regressão: dentro do asar a ponte não pode ser iniciada pelo CLI do agente.
    const integration = await cdp.evaluate('window.atlasDesktop.getKimiIntegration()');
    const entry = JSON.parse(integration.entryText).mcpServers.atlas;
    const canonical = (file) => fs.realpathSync.native(file).toLowerCase();
    assert.equal(canonical(entry.command), canonical(exe));
    assert.equal(canonical(entry.args[0]), canonical(path.join(path.dirname(exe), 'resources', 'app.asar.unpacked', 'electron', 'atlas-mcp-bridge.cjs')));
    assert(fs.existsSync(entry.args[0]));
    assert.equal(integration.state, 'absent', 'status lido da home de fixture, sem gravar');
    console.log('PASS integração MCP empacotada aponta para a ponte fora do asar');
    const version = await cdp.call('Browser.getVersion');
    assert.match(version.product, /Chrome/);
    cdp.ws.close();
    // Fecha como o usuário: a janela principal encerra o app e o banco é fechado.
    const browser = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
    const control = await connect(browser);
    control.call('Browser.close').catch(() => {});
    await Promise.race([exited, delay(15000).then(() => { throw new Error('o app não encerrou'); })]);
    child = null;
  } catch (error) {
    if (stderr) console.error(stderr);
    throw error;
  }
  const database = new DatabaseSync(path.join(profile, 'atlas.sqlite'), { readOnly: true });
  try {
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.at(-1).version);
  } finally {
    database.close();
  }
  console.log('PASS perfil isolado: banco SQLite criado no perfil de fixture com todas as migrations');
}

async function main() {
  if (!installMode) {
    const appDirectory = path.join(release, 'win-unpacked');
    assert(fs.existsSync(appDirectory), 'Gere o pacote antes: npm run dist:win');
    checkLayout(appDirectory);
    await checkBridge(path.join(appDirectory, 'ATLAS.exe'), appDirectory);
    await checkApp(path.join(appDirectory, 'ATLAS.exe'));
    return;
  }
  const setup = fs.readdirSync(release).find((name) => /^ATLAS-Setup-.+\.exe$/.test(name));
  assert(setup, 'Gere o instalador antes: npm run dist:win');
  const before = OPEN_KEYS.map(registryValue);
  // /D precisa ser o último argumento e sem aspas: a pasta de destino não pode ter espaços.
  const target = path.join(fixture, 'instalado');
  assert(!/\s/.test(target), 'pasta temporária com espaços não serve para /D');
  execFileSync(path.join(release, setup), ['/S', `/D=${target}`], { windowsHide: true, timeout: 300000 });
  await until(() => fs.existsSync(path.join(target, 'ATLAS.exe')) && fs.existsSync(path.join(target, 'Uninstall ATLAS.exe')), 'instalação silenciosa');
  assert.deepEqual(OPEN_KEYS.map(registryValue), before, 'instalação silenciosa não grava a entrada do Explorador sem consentimento');
  console.log('PASS instalação silenciosa por usuário, sem administrador e sem entrada do Explorador');
  checkLayout(target);
  await checkBridge(path.join(target, 'ATLAS.exe'), target);
  await checkApp(path.join(target, 'ATLAS.exe'));
  execFileSync(path.join(target, 'Uninstall ATLAS.exe'), ['/S'], { windowsHide: true, timeout: 300000 });
  // O desinstalador se copia para a pasta temporária e termina de forma assíncrona.
  await until(() => !fs.existsSync(path.join(target, 'ATLAS.exe')), 'desinstalação', 120000);
  assert(fs.existsSync(path.join(profile, 'atlas.sqlite')), 'desinstalar não apaga dados do usuário');
  assert.deepEqual(OPEN_KEYS.map(registryValue), before);
  console.log('PASS desinstalação silenciosa: arquivos removidos, dados e registro preservados');
}

try {
  await main();
  console.log('PASS smoke do instalador');
} finally {
  if (child) child.kill();
  await delay(500);
  const real = fs.realpathSync.native(fixture);
  assert(path.basename(real).startsWith('atlas-installer-'));
  await fs.promises.rm(real, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
