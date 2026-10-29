// Smoke real e opt-in do adaptador OpenCode: inicia o CLI de verdade em PTYs do
// ATLAS, como principal e como agente, com o modelo escolhido entre os que ele
// lista. Nenhum prompt é enviado ao modelo. As pastas do OpenCode (XDG_*) ficam
// na fixture: credenciais e configuração do usuário não são lidas nem alteradas.
//
// Uso: npm run smoke:opencode
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32') {
  console.error('SKIP: o smoke do OpenCode exige Windows.');
  process.exit(0);
}
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('ERRO: rode `npm run build` antes do smoke do OpenCode.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const { discoverAdapters } = require('../electron/agent-adapters.cjs');
const opencode = (await discoverAdapters()).find((adapter) => adapter.id === 'opencode');
if (opencode.status !== 'available') {
  console.error(`ERRO: ${opencode.error}`);
  process.exit(1);
}
console.log(`Adaptador detectado: ${opencode.name} ${opencode.version} (${opencode.executable})`);

// Arquivos reais do usuário que o smoke não pode tocar: conferidos antes e depois.
const home = os.homedir();
const userFiles = [
  path.join(home, '.config', 'opencode', 'opencode.json'),
  path.join(home, '.config', 'opencode', 'opencode.jsonc'),
  path.join(home, '.local', 'share', 'opencode', 'auth.json'),
];
const fingerprint = () => userFiles.map((file) => (fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null));
const before = fingerprint();

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-opencode-smoke-'));
const project = path.join(fixture, 'Projeto OpenCode');
const profile = path.join(fixture, 'profile');
const xdg = path.join(fixture, 'xdg');
for (const directory of [project, profile, xdg]) fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(project, 'LEIA.md'), 'fixture do smoke real do OpenCode\n');
// Configuração hostil do repositório: tentaria reabrir shell e escrita na principal
// e iniciar um servidor MCP próprio.
fs.writeFileSync(path.join(project, 'opencode.json'), JSON.stringify({ agent: { 'atlas-orchestrator': { permission: { '*': 'allow', bash: 'allow', edit: 'allow' } } }, mcp: { hostil: { type: 'local', command: ['cmd.exe', '/c', 'exit'], enabled: true } } }));

const port = process.env.ATLAS_SMOKE_OPENCODE_PORT || '9464';
const controlPort = Number(port) + 1;
const controlToken = randomUUID();
const env = {
  ...process.env,
  ATLAS_SMOKE_PROFILE: profile,
  ATLAS_SMOKE_PROJECT: project,
  ATLAS_SMOKE_CONTROL_PORT: String(controlPort),
  ATLAS_SMOKE_TOKEN: controlToken,
  KIMI_CODE_HOME: path.join(fixture, 'kimi-home'),
  XDG_CONFIG_HOME: path.join(xdg, 'config'),
  XDG_DATA_HOME: path.join(xdg, 'data'),
  XDG_STATE_HOME: path.join(xdg, 'state'),
  XDG_CACHE_HOME: path.join(xdg, 'cache'),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
delete env.OPENCODE_CONFIG;
delete env.OPENCODE_CONFIG_DIR;
delete env.OPENCODE_CONFIG_CONTENT;
fs.writeFileSync(path.join(profile, 'atlas-projects.json'), JSON.stringify({ roots: [fs.realpathSync.native(project)] }));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 60000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try { const result = await check(); if (result) return result; } catch (error) { last = error; }
    await delay(200);
  }
  throw new Error(`Timeout: ${label}${last ? ` (${last.message})` : ''}`);
}
async function native(action, fields = {}) {
  const response = await fetch(`http://127.0.0.1:${controlPort}`, { method: 'POST', headers: { Authorization: controlToken }, body: JSON.stringify({ action, ...fields }), signal: AbortSignal.timeout(60000) });
  const reply = await response.json();
  if (reply.error) throw new Error(reply.error);
  return reply.result;
}
const plain = (value) => value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');

let stderr = '';
const electron = require('electron');
const child = spawn(electron, [path.join(root, 'scripts/smoke-app.cjs'), `--remote-debugging-port=${port}`], { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-12000); });
child.stdout.resume();
const exited = new Promise((resolve) => child.once('exit', resolve));

let failed = true;
try {
  await until(async () => (await native('windows')).some((item) => !item.url.includes('window=')), 'control server', 30000);
  const cwd = fs.realpathSync.native(project);
  const adapters = await native('invoke', { channel: 'agent:list-adapters' });
  assert.equal(adapters.find((item) => item.id === 'opencode').status, 'available');

  const { models } = await native('invoke', { channel: 'agent:list-models', args: [{ adapterId: 'opencode' }] });
  assert(models.length > 0, 'OpenCode lista modelos mesmo sem credenciais (provedores gratuitos)');
  const model = models[0];
  console.log(`PASS modelos do OpenCode listados pelo ATLAS (${models.length}); escolhido para o smoke: ${model}`);

  assert.equal((await native('invoke', { channel: 'agent:open-orchestrator', args: [{ cwd }] })).needsChoice, true, 'sem CLI padrão para a principal');
  const principal = await native('invoke', { channel: 'agent:open-orchestrator', args: [{ cwd, adapterId: 'opencode', model }] });
  assert.equal(principal.cli, 'OpenCode');
  assert.equal(principal.model, model);
  const attach = (agent) => native('invoke', { channel: 'terminal:attach', args: [agent.ptyId] });
  // A ponte MCP chega só pela configuração desta run e se conecta ao host do ATLAS.
  await until(async () => (await native('invoke', { channel: 'agent:list' })).find((item) => item.id === principal.id)?.atlasTools === true, 'ponte MCP do ATLAS na principal OpenCode', 90000);
  const principalScreen = await until(async () => {
    const text = plain((await attach(principal)).scrollback);
    return /atlas-orchestrator/i.test(text) ? text : null;
  }, 'perfil atlas-orchestrator ativo na TUI do OpenCode', 60000);
  fs.writeFileSync(path.join(fixture, 'principal-screen.txt'), principalScreen.slice(-4000));
  console.log('PASS principal real no OpenCode: modelo escolhido, perfil atlas-orchestrator e ferramentas do ATLAS conectadas');
  // O próprio OpenCode resolve a configuração da principal no repositório hostil.
  const { launchFor } = require('../electron/agent-adapters.cjs');
  const launch = launchFor({ adapter: opencode, role: 'orchestrator', model });
  const debug = (args) => {
    try {
      return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${opencode.executable}" ${args}"`], { cwd, env: { ...env, ...launch.env }, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, timeout: 120000 });
    } catch (error) {
      return `${error.stdout || ''}${error.stderr || ''}`;
    }
  };
  const tools = JSON.parse(debug('debug agent atlas-orchestrator')).tools;
  for (const tool of ['bash', 'edit', 'write', 'grep', 'task', 'webfetch']) assert.equal(tools[tool], false, `principal sem ${tool}`);
  assert.equal(tools.read, true);
  assert.match(debug('debug agent build'), /not found/i, 'agente build desabilitado');
  assert.doesNotMatch(debug('debug config'), /hostil/, 'MCP do repositório ignorado na principal');
  console.log('PASS principal no OpenCode continua somente leitura com configuração hostil no repositório');

  // Troca de modelo pela própria TUI (/models), sem prompt ao modelo: a sessão, o PTY,
  // a ponte MCP e o perfil somente leitura continuam; o usuário informa o modelo novo.
  assert(models.length > 1, 'o smoke precisa de dois modelos para trocar');
  const write = (data) => native('invoke', { channel: 'terminal:write', args: [{ terminalId: principal.ptyId, data }] });
  const recentFile = path.join(xdg, 'state', 'opencode', 'model.json');
  const recent = () => { try { return JSON.parse(fs.readFileSync(recentFile, 'utf8')).recent || []; } catch { return []; } };
  await write('/models');
  await delay(800);
  await write('\r');
  await until(async () => {
    const screen = plain((await attach(principal)).scrollback).slice(-6000);
    fs.writeFileSync(path.join(fixture, 'models-dialog.txt'), screen);
    return /select model|search/i.test(screen);
  }, 'diálogo de modelos do OpenCode', 30000);
  // O diálogo lista nomes de exibição: desce um item e confirma; o modelo escolhido
  // é lido do registro de recentes do próprio OpenCode (XDG isolado da fixture).
  await write('\x1b[B');
  await delay(600);
  await write('\r');
  const target = await until(() => recent().map((item) => `${item.providerID}/${item.modelID}`).find((item) => item !== model), 'OpenCode registrou o modelo escolhido no diálogo', 30000);
  assert(models.includes(target), `modelo escolhido na TUI (${target}) está na lista do ATLAS`);
  const listed = await native('invoke', { channel: 'agent:list' });
  const after = listed.find((item) => item.id === principal.id);
  assert.equal(after.state, 'running', 'a principal continua em execução');
  assert.equal(after.ptyId, principal.ptyId, 'mesmo terminal');
  assert.equal(after.runId, principal.runId, 'mesma run');
  await until(async () => (await native('invoke', { channel: 'agent:list' })).find((item) => item.id === principal.id)?.atlasTools === true, 'ponte MCP continua conectada após a troca', 30000);
  const toolsAfter = JSON.parse(debug('debug agent atlas-orchestrator')).tools;
  for (const tool of ['bash', 'edit', 'write', 'grep', 'task', 'webfetch']) assert.equal(toolsAfter[tool], false, `principal continua sem ${tool} após a troca`);
  const declared = await native('invoke', { channel: 'agent:declare-model', args: [{ sessionId: principal.id, model: target }] });
  assert.equal(declared.model, model, 'modelo de início preservado');
  assert.equal(declared.currentModel, target);
  fs.writeFileSync(path.join(fixture, 'principal-after-switch.txt'), plain((await attach(principal)).scrollback).slice(-4000));
  console.log(`PASS troca de modelo na TUI do OpenCode (${model} → ${target}): mesma run e terminal, ponte conectada, principal somente leitura e modelo informado`);

  const agent = await native('invoke', { channel: 'agent:create', args: [{ adapterId: 'opencode', model, name: 'smoke-opencode', cwd }] });
  assert.equal(agent.state, 'running');
  assert.equal(agent.model, model);
  await until(async () => (await native('invoke', { channel: 'agent:list' })).find((item) => item.id === agent.id)?.atlasTools === true, 'ponte MCP do ATLAS no agente OpenCode', 90000);
  console.log('PASS agente real no OpenCode com o modelo escolhido e ferramentas do ATLAS conectadas');

  const { createOperationalStore } = require('../electron/operational-store.cjs');
  const store = createOperationalStore({ filename: path.join(profile, 'atlas.sqlite') });
  try {
    const runs = store.listRuns(principal.projectId);
    assert.deepEqual(runs.map((run) => [run.adapter_id, run.model]).sort(), [['opencode', model], ['opencode', model]]);
    assert.equal(runs.find((run) => run.session_id === principal.id).current_model, target, 'troca informada gravada na mesma run');
  } finally {
    store.close();
  }
  console.log('PASS CLI e modelo de cada run registrados no SQLite');

  await native('quit');
  await Promise.race([exited, delay(20000).then(() => { throw new Error('o ATLAS não encerrou'); })]);
  assert.deepEqual(fingerprint(), before, 'configuração e credenciais reais do OpenCode intactas');
  assert(!fs.existsSync(path.join(xdg, 'config', 'opencode', 'opencode.json')), 'o ATLAS não grava configuração do OpenCode nem na fixture');
  console.log('PASS configuração e credenciais reais do OpenCode intactas; nada gravado em arquivo de configuração');
  failed = false;
} catch (error) {
  console.error(error.message);
  // Falha de rede no canal de controle costuma significar que o Electron saiu: diga como.
  if (error.cause) console.error(`causa: ${error.cause.code || error.cause.message}`);
  console.error(`Electron: ${child.exitCode === null ? 'ainda em execução' : `saiu com código ${child.exitCode}`}`);
  if (stderr) console.error(stderr.slice(-4000));
  process.exitCode = 1;
} finally {
  if (child.exitCode === null) child.kill();
  await delay(1000);
  if (!failed) {
    const real = fs.realpathSync.native(fixture);
    assert(path.basename(real).startsWith('atlas-opencode-smoke-'));
    await fs.promises.rm(real, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    console.log('PASS smoke real do OpenCode');
  } else console.error(`Fixture preservada para diagnóstico: ${fixture}`);
}
