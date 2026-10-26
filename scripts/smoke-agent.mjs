// Smoke real e opt-in do adaptador Kimi Code: inicia o CLI de verdade em um
// PTY do ATLAS, envia apenas comandos de barra (/status e /exit) e verifica o
// encerramento limpo. Nenhum prompt é enviado ao modelo e nenhum token é
// consumido. O KIMI_CODE_HOME é isolado na fixture temporária.
//
// Uso: npm run smoke:agent
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = path.join(root, '.atlas-smoke-results');
fs.mkdirSync(resultsDir, { recursive: true });

if (process.platform !== 'win32') {
  console.error('SKIP: o smoke de agente deste marco exige Windows.');
  process.exit(0);
}
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('ERRO: rode `npm run build` antes do smoke de agente.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const { discoverAdapters } = require('../electron/agent-adapters.cjs');
const [kimi] = await discoverAdapters();
if (kimi.status !== 'available') {
  console.error(`ERRO: ${kimi.error}`);
  process.exit(1);
}
console.log(`Adaptador detectado: ${kimi.name} ${kimi.version} (${kimi.executable})`);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-agent-smoke-'));
const profile = path.join(fixture, 'profile');
const kimiHome = path.join(fixture, 'kimi-home');
fs.mkdirSync(profile);
fs.mkdirSync(kimiHome);
fs.writeFileSync(path.join(resultsDir, 'agent-result.json'), JSON.stringify({ passed: false, status: 'running', fixture }));

const port = process.env.ATLAS_SMOKE_AGENT_PORT || '9444';
const controlPort = Number(port) + 1;
const controlToken = randomUUID();
const electron = require('electron');
const env = {
  ...process.env,
  ATLAS_SMOKE_PROFILE: profile,
  ATLAS_SMOKE_PROJECT: fixture,
  ATLAS_SMOKE_CONTROL_PORT: String(controlPort),
  ATLAS_SMOKE_TOKEN: controlToken,
  KIMI_CODE_HOME: kimiHome,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;

const child = spawn(electron, [path.join(root, 'scripts/smoke-app.cjs'), `--remote-debugging-port=${port}`], { cwd: fixture, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let stderr = '';
child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-12000); });
child.stdout.resume();

async function native(action, fields = {}) {
  const response = await fetch(`http://127.0.0.1:${controlPort}`, { method: 'POST', headers: { Authorization: controlToken }, body: JSON.stringify({ action, ...fields }), signal: AbortSignal.timeout(10000) });
  const reply = await response.json();
  if (reply.error) throw new Error(reply.error);
  return reply.result;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 60000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try { const result = await check(); if (result) return result; } catch (error) { last = error; }
    await delay(150);
  }
  throw new Error(`Timeout: ${label}${last ? ` (${last.message})` : ''}`);
}

let exitCode = 1;
try {
  await until(async () => {
    try { return await native('windows'); } catch { return null; }
  }, 'control server', 30000);

  const adapters = await native('invoke', { channel: 'agent:list-adapters' });
  const detected = adapters.find((adapter) => adapter.id === 'kimi-code');
  assert.equal(detected.status, 'available');
  assert.equal(detected.version, kimi.version);
  console.log('PASS agent:list-adapters detecta o Kimi Code via IPC');

  const agent = await native('invoke', { channel: 'agent:create', args: [{ adapterId: 'kimi-code', name: 'smoke-kimi', cwd: fixture }] });
  assert.equal(agent.state, 'running');
  assert.equal(agent.cwd, fixture);
  assert.ok(agent.ptyId);
  console.log('PASS agent:create inicia o CLI real na pasta autorizada');

  const attach = () => native('invoke', { channel: 'terminal:attach', args: [agent.ptyId] });
  // O Kimi Code pede confiança para pastas novas. A fixture é temporária e o
  // KIMI_CODE_HOME é isolado, então o smoke confirma "Trust and continue".
  let trustAnswered = false;
  await until(async () => {
    const scrollback = (await attach()).scrollback;
    if (!trustAnswered && scrollback.includes('Trust this folder?')) {
      trustAnswered = true;
      await native('invoke', { channel: 'terminal:write', args: [{ terminalId: agent.ptyId, data: '\r' }] });
      return false;
    }
    return scrollback.includes('Welcome to Kimi Code!');
  }, 'confiança da pasta e TUI do Kimi Code inicializada', 90000);
  console.log('PASS TUI nativa do harness renderizada no PTY (confiança da fixture confirmada)');

  const before = (await attach()).scrollback.length;
  await native('invoke', { channel: 'terminal:write', args: [{ terminalId: agent.ptyId, data: '/status\r' }] });
  await until(async () => {
    const delta = (await attach()).scrollback.slice(before);
    return delta.includes('Directory') && delta.includes(fixture) && delta.includes('Permissions');
  }, 'status exibe diretório e permissões');
  console.log('PASS /status respondido pelo harness sem prompt ao modelo');

  await native('invoke', { channel: 'terminal:write', args: [{ terminalId: agent.ptyId, data: '/exit\r' }] });
  await until(async () => {
    const agents = await native('invoke', { channel: 'agent:list' });
    return agents.find((item) => item.id === agent.id)?.state === 'exited';
  }, 'estado exited após /exit');
  const finalSnapshot = await attach();
  assert.equal(finalSnapshot.exit.exitCode, 0);
  console.log('PASS /exit encerra o CLI com código 0 e estado exited');

  assert.ok(fs.existsSync(path.join(kimiHome, 'workspaces.json')) || fs.readdirSync(kimiHome).length > 0, 'KIMI_CODE_HOME isolado recebeu os arquivos da sessão');
  console.log('PASS KIMI_CODE_HOME isolado usado pelo CLI');

  fs.writeFileSync(path.join(resultsDir, 'agent-result.json'), JSON.stringify({ passed: true, version: kimi.version, fixture: null }, null, 2));
  exitCode = 0;
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  try {
    const agents = await native('invoke', { channel: 'agent:list' });
    for (const item of agents) {
      const snapshot = await native('invoke', { channel: 'terminal:attach', args: [item.ptyId] });
      const plain = snapshot.scrollback.replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1B[()][0-9A-B]/g, '');
      console.error(`--- scrollback de ${item.name} (estado ${item.state}, exit ${JSON.stringify(item.exit)}, ${snapshot.scrollback.length} bytes):`);
      console.error(plain.slice(-1500));
    }
  } catch (diagnosticError) {
    console.error(`Diagnóstico indisponível: ${diagnosticError.message}`);
  }
  if (stderr) console.error(stderr.slice(-2000));
  fs.writeFileSync(path.join(resultsDir, 'agent-result.json'), JSON.stringify({ passed: false, error: error.message, fixture }, null, 2));
} finally {
  try { await native('quit'); } catch { /* O aplicativo pode já ter encerrado. */ }
  await delay(500);
  child.kill();
  await delay(500);
  if (exitCode === 0) await fs.promises.rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  else console.error(`Fixture preservada para diagnóstico: ${fixture}`);
}
process.exit(exitCode);
