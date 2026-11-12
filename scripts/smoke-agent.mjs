// Smoke real e opt-in do adaptador Kimi Code: inicia o CLI de verdade em um
// PTY do ATLAS, envia apenas comandos locais (/title, /model, /status, /exit) e verifica o
// encerramento limpo. Nenhum prompt é enviado ao modelo e nenhum token é
// consumido. O KIMI_CODE_HOME é isolado na fixture temporária.
//
// Uso: npm run smoke:agent
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = path.join(root, '.atlas-smoke-results');
const configuredModel = process.argv.includes('--configured-model');
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
const { profileSnapshot, assertPrincipalProfile } = require('./kimi-profile-state.cjs');
const { publishSmokeResult } = require('./smoke-completion.cjs');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-agent-smoke-'));
const profile = path.join(fixture, 'profile');
const kimiHome = path.join(fixture, 'kimi-home');
fs.mkdirSync(profile);
fs.mkdirSync(kimiHome);
// O CLI real é uma dependência do smoke, não um alvo de atualização.
process.env.KIMI_CODE_NO_AUTO_UPDATE = '1';
if (!configuredModel) process.env.KIMI_CODE_HOME = kimiHome;
const [kimi] = await discoverAdapters();
if (kimi.status !== 'available') {
  console.error(`ERRO: ${kimi.error}`);
  process.exit(1);
}
console.log(`Adaptador detectado: ${kimi.name} ${kimi.version} (${kimi.executable})`);

// O provedor da fixture nunca atende uma conversa. Qualquer tentativa de
// consultar o modelo torna o teste vermelho, mesmo que o CLI se recupere.
let modelRequests = 0;
let provider = null;
let fixtureConfig = null;
if (!configuredModel) {
  provider = createServer((_request, response) => {
    modelRequests += 1;
    response.writeHead(500).end('Nenhum prompt pode ser enviado neste smoke.');
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  fixtureConfig = `default_model = "fixture-a"\ntelemetry = false\n[providers.fixture]\ntype = "openai"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\napi_key = "fixture-only"\n[models.fixture-a]\nprovider = "fixture"\nmodel = "fixture-a"\nmax_context_size = 32000\ncapabilities = ["tool_use"]\n[models.fixture-b]\nprovider = "fixture"\nmodel = "fixture-b"\nmax_context_size = 32000\ncapabilities = ["tool_use"]\n`;
  fs.writeFileSync(path.join(kimiHome, 'config.toml'), fixtureConfig);
}
// A fixture é um repositório Git com commit para o pedido com worktree por tarefa.
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=ATLAS Smoke', '-c', 'user.email=smoke@atlas.invalid', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
git(fixture, 'init', '--quiet', '--initial-branch=main');
fs.writeFileSync(path.join(fixture, 'LEIA.md'), 'fixture do smoke real\n');
fs.writeFileSync(path.join(fixture, '.gitignore'), 'profile/\nkimi-home/\n');
git(fixture, 'add', 'LEIA.md', '.gitignore');
git(fixture, 'commit', '--quiet', '-m', 'Fixture inicial');
const worktreesRoot = `${fixture}.atlas-worktrees`;
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
if (configuredModel) {
  if (process.env.KIMI_CODE_HOME) env.KIMI_CODE_HOME = process.env.KIMI_CODE_HOME;
  else delete env.KIMI_CODE_HOME;
}
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;

let stderr = '';
function launch() {
  const process = spawn(electron, [path.join(root, 'scripts/smoke-app.cjs'), `--remote-debugging-port=${port}`], { cwd: fixture, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  process.stderr.on('data', (data) => { stderr = (stderr + data).slice(-12000); });
  process.stdout.resume();
  return process;
}
let child = launch();

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
    assert.equal(modelRequests, 0, 'O CLI tentou consultar o provedor fictício.');
    try { const result = await check(); if (result) return result; } catch (error) { last = error; }
    await delay(150);
  }
  throw new Error(`Timeout: ${label}${last ? ` (${last.message})` : ''}`);
}

async function callMain(method, params) {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find((item) => item.url.includes('index.html') && !item.url.includes('window='));
  if (!page) throw new Error('Renderer principal ainda não disponível.');
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const finish = (error, value) => { clearTimeout(timer); socket.close(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error('Timeout CDP da principal')), 10000);
    socket.onerror = () => finish(new Error('Falha CDP da principal'));
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method, params }));
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== 1) return;
      if (message.error) finish(new Error('Falha CDP na fixture'));
      else finish(null, message.result);
    };
  });
}

async function evaluateMain(expression) {
  const result = await callMain('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error('Falha ao avaliar renderer da fixture');
  return result.result.value;
}

async function openSessionActions(cardExpression) {
  assert(await evaluateMain(`(() => { const trigger = (${cardExpression})?.querySelector('.session-menu-trigger'); if (!trigger) return false; if (trigger.getAttribute('aria-expanded') === 'false') trigger.click(); return true; })()`), 'ações da sessão disponíveis');
}

async function clickSessionAction(cardExpression, action) {
  await openSessionActions(cardExpression);
  assert(await evaluateMain(`(() => { const button = (${cardExpression})?.querySelector('[data-action=${action}]'); if (!button) return false; button.click(); return true; })()`), `ação ${action} disponível`);
}

// Escolha de CLI e modelo pela interface, como o usuário faz: selects controlados
// pelo React recebem o setter nativo e o evento change.
async function chooseInUi(scope, name, value) {
  const ok = await evaluateMain(`(() => { const select = document.querySelector(${JSON.stringify(`${scope} select[name=${name}]`)}); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)}); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === ${JSON.stringify(value)}; })()`);
  if (!ok) throw new Error(`Opção ${value} ausente em ${scope} ${name}`);
}

async function chooseKimi(scope) {
  await until(() => evaluateMain(`[...document.querySelectorAll(${JSON.stringify(`${scope} select[name=cli] option`)})].some(item => item.value === 'kimi-code' && !item.disabled)`), `Kimi Code em ${scope}`);
  await chooseInUi(scope, 'cli', 'kimi-code');
  if (kimiModel) {
    await until(() => evaluateMain(`Boolean(document.querySelector(${JSON.stringify(`${scope} select[name=model]`)}))`), `modelos em ${scope}`);
    await chooseInUi(scope, 'model', kimiModel);
  }
}

async function typeInPrincipal(prompt) {
  await native('focus');
  await evaluateMain(`${principalCard}.querySelector('.xterm-helper-textarea').focus()`);
  for (const character of prompt) {
    await callMain('Input.dispatchKeyEvent', { type: 'keyDown', key: character, text: character });
    await callMain('Input.dispatchKeyEvent', { type: 'keyUp', key: character });
  }
  await callMain('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await callMain('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}

let exitCode = 1;
let failureMessage = null;
let modelDiagnostic = '';
let kimiModel = null;
const principalCard = `document.querySelector('.session-card[data-session-name=ORQUESTRADOR]')`;
const plainOutput = (value) => value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');

async function sendCommand(session, command) {
  await native('invoke', { channel: 'terminal:write', args: [{ terminalId: session.ptyId, data: command }] });
  await delay(200);
  await native('invoke', { channel: 'terminal:write', args: [{ terminalId: session.ptyId, data: '\r' }] });
}


async function materializeSession(session, title) {
  // O modo com provedor real é outro opt-in; não lê seus journals nesta etapa.
  if (configuredModel) return null;
  let trusted = false;
  await until(async () => {
    const output = (await native('invoke', { channel: 'terminal:attach', args: [session.ptyId] })).scrollback;
    if (!trusted && output.includes('Trust this folder?')) {
      trusted = true;
      await native('invoke', { channel: 'terminal:write', args: [{ terminalId: session.ptyId, data: '\r' }] });
      return false;
    }
    return output.includes('Welcome to Kimi Code!');
  }, `TUI antes de criar ${title}`, 90000);
  await sendCommand(session, `/title ${title}`);
  const snapshot = await until(() => profileSnapshot(kimiHome, title), `sessão interna ${title}`);
  assert.equal(snapshot.title, title);
  assert.equal(snapshot.model, kimiModel);
  if (session.role === 'orchestrator') assertPrincipalProfile(snapshot);
  else assert.equal(snapshot.profileName, 'agent');
  return snapshot;
}

async function switchTuiModel(session, previous, { declareInUi = false } = {}) {
  await sendCommand(session, '/model');
  await until(async () => {
    const screen = plainOutput((await native('invoke', { channel: 'terminal:attach', args: [session.ptyId] })).scrollback);
    // O rodapé de atalhos é truncado em cards estreitos. A presença do diálogo
    // e da opção confirma o seletor; a troca por Alt+S é verificada no journal.
    return screen.includes('Select a model') && screen.includes('fixture-b');
  }, 'seletor de modelos do Kimi');
  await native('invoke', { channel: 'terminal:write', args: [{ terminalId: session.ptyId, data: 'fixture-b' }] });
  await delay(200);
  await native('invoke', { channel: 'terminal:write', args: [{ terminalId: session.ptyId, data: '\x1bs' }] });
  const changed = await until(() => {
    const current = profileSnapshot(kimiHome, previous.title);
    return current?.model === 'fixture-b' && current;
  }, 'modelo escolhido na TUI persistido no journal');
  assert.equal(changed.sessionKey, previous.sessionKey);
  assert.equal(changed.profileName, previous.profileName);
  assert.deepEqual(changed.activeToolNames, previous.activeToolNames);
  assert.deepEqual(changed.subagents, previous.subagents);
  if (session.role === 'orchestrator') assertPrincipalProfile(changed);
  const after = (await native('invoke', { channel: 'agent:list' })).find(item => item.id === session.id);
  assert.equal(after.state, 'running');
  assert.equal(after.ptyId, session.ptyId);
  assert.equal(after.runId, session.runId);
  await until(async () => (await native('invoke', { channel: 'agent:list' })).find(item => item.id === session.id)?.atlasTools === true, 'MCP permanece após trocar modelo', 30000);
  if (declareInUi) {
    const named = `document.querySelector('.session-card[data-session-name=${session.name}]')`;
    await clickSessionAction(named, 'model');
    await until(() => evaluateMain(`Boolean(document.querySelector('.model-switch-modal select[name="declared-model"]'))`), 'painel de troca de modelo carregado');
    assert(await evaluateMain(`document.querySelector('.model-switch-modal').innerText.includes('Alt+S')`));
    assert(await evaluateMain(`document.querySelector('.model-switch-modal button[type=submit]').disabled`), 'modelo vazio não pode ser informado');
    await chooseInUi('.model-switch-modal', 'declared-model', 'fixture-b');
    await evaluateMain(`document.querySelector('.model-switch-modal form').requestSubmit()`);
    await until(() => evaluateMain(`!document.querySelector('.model-switch-modal')`), 'modelo informado pelo painel');
    await until(() => evaluateMain(`${named}.querySelector('.session-header').title.includes('informado por você; iniciou com fixture-a')`), 'card identifica modelo como informado pelo usuário');
  } else {
    await native('invoke', { channel: 'agent:declare-model', args: [{ sessionId: session.id, model: 'fixture-b' }] });
  }
  const declared = (await native('invoke', { channel: 'agent:list' })).find(item => item.id === session.id);
  assert.equal(declared.model, 'fixture-a');
  assert.equal(declared.currentModel, 'fixture-b');
  assert.equal(declared.runId, session.runId);
  assert.equal(declared.ptyId, session.ptyId);
  console.log(`PASS troca nativa no Kimi (${session.role}): sessão, run, PTY, perfil e MCP preservados; modelo informado${declareInUi ? ' pelo painel' : ''}`);
}
try {
  await until(async () => {
    try { return (await native('windows')).some((item) => !item.url.includes('window=')); } catch { return false; }
  }, 'control server', 30000);

  const adapters = await native('invoke', { channel: 'agent:list-adapters' });
  const detected = adapters.find((adapter) => adapter.id === 'kimi-code');
  assert.equal(detected.status, 'available');
  assert.equal(detected.version, kimi.version);
  console.log('PASS agent:list-adapters detecta o Kimi Code via IPC');

  // Consentimento da integração MCP. No modo padrão a home é isolada; com o
  // provedor configurado a home é a do usuário, então o smoke só lê o estado.
  const integrationBefore = await native('invoke', { channel: 'integration:kimi-mcp-status' });
  if (!configuredModel) {
    assert.equal(integrationBefore.file, path.join(kimiHome, 'mcp.json'), 'integração restrita ao KIMI_CODE_HOME isolado');
    assert.equal(integrationBefore.state, 'absent');
    const installed = await native('invoke', { channel: 'integration:kimi-mcp-install', args: [{ confirm: true }] });
    assert.equal(installed.state, 'installed');
    console.log('PASS consentimento grava a entrada atlas somente no KIMI_CODE_HOME isolado');
  }
  const integrationActive = !configuredModel || integrationBefore.state === 'installed';

  // Sem CLI padrão: a principal nasce só com o CLI e o modelo escolhidos.
  assert.equal((await native('invoke', { channel: 'agent:open-orchestrator', args: [{ cwd: fixture }] })).needsChoice, true);
  kimiModel = (await native('invoke', { channel: 'agent:list-models', args: [{ adapterId: 'kimi-code' }] })).models[0] ?? null;
  if (!configuredModel) assert.equal(kimiModel, 'fixture-a', 'modelo escolhido explicitamente entre aliases da home de fixture');
  const principal = await native('invoke', { channel: 'agent:open-orchestrator', args: [{ cwd: fixture, adapterId: 'kimi-code', model: kimiModel }] });
  assert.equal(principal.role, 'orchestrator');
  const principalAttach = () => native('invoke', { channel: 'terminal:attach', args: [principal.ptyId] });
  let principalTrusted = false;
  await until(async () => {
    const output = (await principalAttach()).scrollback;
    if (!principalTrusted && output.includes('Trust this folder?')) {
      principalTrusted = true;
      await native('invoke', { channel: 'terminal:write', args: [{ terminalId: principal.ptyId, data: '\r' }] });
      return false;
    }
    return output.includes('Welcome to Kimi Code!');
  }, 'perfil principal aceito pelo Kimi Code', 90000);
  assert.equal((await native('invoke', { channel: 'agent:open-orchestrator', args: [{ cwd: fixture }] })).id, principal.id);
  const principalNative = await materializeSession(principal, 'atlas-principal-1');
  console.log('PASS principal real com perfil de leitura, identidade única e TUI interativa');

  if (configuredModel) {
    const start = (await principalAttach()).scrollback.length;
    await sendCommand(principal, '/status');
    await until(async () => (await principalAttach()).scrollback.slice(start).includes('Permissions'), 'status da principal configurada');
    if (/Model\s+not set/i.test(plainOutput((await principalAttach()).scrollback.slice(start)))) throw new Error('Modelo não configurado no Kimi para a validação de conversa.');
    const beforeReply = (await principalAttach()).scrollback.length;
    const prompt = 'Reply only ATLAS, ORCHESTRATOR and OK joined with underscores. No tools.';
    await until(() => evaluateMain(`Boolean(${principalCard}?.querySelector('.xterm-helper-textarea'))`), 'xterm principal montado');
    await typeInPrincipal(prompt);
    const modelResult = await until(async () => {
      const reply = plainOutput((await principalAttach()).scrollback.slice(beforeReply));
      const rendered = await evaluateMain(`${principalCard}?.querySelector('.real-terminal')?.innerText || ''`);
      modelDiagnostic = `${rendered}\n${reply}`;
      if (/401 Unauthorized|429 Too Many|Insufficient Balance|APIError|Authentication failed/i.test(modelDiagnostic)) return { error: 'O provedor recusou a conversa; verifique credenciais/quota do Kimi.' };
      return rendered.includes('ATLAS_ORCHESTRATOR_OK') ? { passed: true } : null;
    }, 'resposta curta do modelo na principal', 60000);
    if (modelResult.error) throw new Error(modelResult.error);
    console.log('PASS conversa real na principal com provedor já configurado e um único prompt curto');
  }

  const agent = await native('invoke', { channel: 'agent:create', args: [{ adapterId: 'kimi-code', model: kimiModel, name: 'smoke-kimi', cwd: fixture }] });
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
  const manualNative = await materializeSession(agent, 'atlas-manual');
  console.log('PASS TUI nativa do harness renderizada no PTY (confiança da fixture confirmada)');
  if (integrationActive) {
    await until(async () => (await native('invoke', { channel: 'agent:list' })).find((item) => item.id === agent.id)?.atlasTools === true, 'handshake da ponte MCP do ATLAS na sessão manual', 30000);
    console.log('PASS Kimi real inicia a ponte MCP do ATLAS e o handshake chega ao host com o token da run');
  }

  // O painel nativo trunca diretórios que não cabem. Dê espaço ao caminho longo
  // da fixture e mantenha a asserção do diretório completo, sem aceitar reticências.
  const statusSize = await attach();
  await native('invoke', { channel: 'terminal:resize', args: [{ terminalId: agent.ptyId, cols: Math.max(statusSize.cols || 80, fixture.length + 40), rows: statusSize.rows || 40 }] });
  const before = (await attach()).scrollback.length;
  await sendCommand(agent, '/status');
  await until(async () => {
    const delta = (await attach()).scrollback.slice(before);
    return delta.includes('Directory') && delta.includes(fixture) && delta.includes('Permissions');
  }, 'status exibe diretório e permissões');
  await native('invoke', { channel: 'terminal:resize', args: [{ terminalId: agent.ptyId, cols: statusSize.cols || 80, rows: statusSize.rows || 40 }] });
  console.log('PASS /status respondido pelo harness sem prompt ao modelo');

  await callMain('Page.reload', {});
  const manualCard = `document.querySelector('.session-card[data-session-name=smoke-kimi]')`;
  await until(() => evaluateMain(`Boolean(${principalCard}) && Boolean(${manualCard})`), 'cards principal e manual após reload');
  if (integrationActive) await until(() => evaluateMain(`${manualCard}.querySelector('.session-header').title.includes('ATLAS conectado')`), 'indicação ATLAS conectado na sessão manual');
  if (!configuredModel) await switchTuiModel(agent, manualNative, { declareInUi: true });
  await openSessionActions(manualCard);
  assert(await evaluateMain(`Boolean(${manualCard}.querySelector('[data-action=discovery]'))`), 'sessão manual deve oferecer envio de descoberta');
  await openSessionActions(principalCard);
  assert(await evaluateMain(`!${principalCard}.querySelector('[data-action=discovery]')`), 'principal não envia descoberta para si mesma');
  await clickSessionAction(manualCard, 'discovery');
  await until(() => evaluateMain(`document.activeElement?.name === 'subject'`), 'modal de descoberta com foco no assunto');
  assert(await evaluateMain(`document.querySelector('.modal button[type=submit]').disabled`), 'descoberta vazia não deve enviar');
  await evaluateMain(`(() => { for (const [name, value] of Object.entries({ subject: 'Descoberta real do smoke', body: 'Sequência ANSI de resize diverge entre ConPTY e WinPTY.' })) { const field = document.querySelector('.modal [name=' + name + ']'); Object.getOwnPropertyDescriptor(name === 'subject' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value').set.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await evaluateMain(`document.querySelector('.modal form').requestSubmit()`);
  await until(() => evaluateMain(`!document.querySelector('.modal-backdrop')`), 'descoberta enviada pelo modal');
  const sentMessages = await native('invoke', { channel: 'message:list', args: [{ cwd: fixture }] });
  assert.equal(sentMessages.items.length, 1);
  assert.equal(sentMessages.items[0].subject, 'Descoberta real do smoke');
  assert.equal(sentMessages.items[0].fromSessionId, agent.id);
  assert.equal(sentMessages.items[0].toSessionId, principal.id);
  assert.equal(sentMessages.items[0].readAt, null);
  await evaluateMain(`[...document.querySelectorAll('.inspector-tabs button')].find(item => item.textContent.trim().startsWith('Mensagens')).click()`);
  await until(() => evaluateMain(`document.querySelector('.messages-panel')?.innerText.includes('Descoberta real do smoke')`), 'descoberta listada no painel');
  assert(await evaluateMain(`document.querySelector('.messages-panel').innerText.includes('1 não lida')`), 'contagem de não lidas');
  await evaluateMain(`[...document.querySelectorAll('.msg-card')].find(item => item.innerText.includes('Descoberta real do smoke')).querySelector('.msg-mark').click()`);
  await until(() => evaluateMain(`document.querySelector('.messages-panel')?.innerText.includes('0 não lidas')`), 'descoberta marcada como lida');
  console.log('PASS descoberta real entre sessões: modal, persistência, painel e leitura');

  await sendCommand(agent, '/exit');
  await until(async () => {
    const agents = await native('invoke', { channel: 'agent:list' });
    return agents.find((item) => item.id === agent.id)?.state === 'exited';
  }, 'estado exited após /exit');
  const finalSnapshot = await attach();
  assert.equal(finalSnapshot.exit.exitCode, 0);
  console.log('PASS /exit encerra o CLI com código 0 e estado exited');
  if (integrationActive) {
    assert.equal((await native('invoke', { channel: 'agent:list' })).find((item) => item.id === agent.id).atlasTools, false, 'token revogado com a saída da run');
    console.log('PASS saída da run revoga o token e desconecta as ferramentas do ATLAS');
  }

  if (!configuredModel) {
    assert.ok(fs.existsSync(path.join(kimiHome, 'workspaces.json')) || fs.readdirSync(kimiHome).length > 0, 'KIMI_CODE_HOME isolado recebeu os arquivos da sessão');
    console.log('PASS KIMI_CODE_HOME isolado usado pelo CLI');
  }

  await until(() => evaluateMain(`Boolean(${principalCard})`), 'card principal no projeto');
  await clickSessionAction(principalCard, 'popup');
  await until(async () => (await native('windows')).some((item) => item.url.includes('window=terminal')), 'pop-up da principal');
  await sendCommand(principal, '/exit');
  await until(async () => { await openSessionActions(principalCard); return evaluateMain(`Boolean(${principalCard}.querySelector('[data-action=restart]'))`); }, 'principal encerrada no pop-up');
  await callMain('Page.reload', {});
  await until(async () => { await openSessionActions(principalCard); return evaluateMain(`Boolean(${principalCard}.querySelector('[data-action=restart]'))`); }, 'principal encerrada após reload com pop-up nativo aberto');
  await clickSessionAction(principalCard, 'restart');
  await until(() => evaluateMain(`Boolean(document.querySelector('#orchestrator-choice-title'))`), 'escolha do agente para a nova execução');
  await chooseKimi('.modal');
  await until(() => evaluateMain(`document.querySelector('.modal button[type=submit]')?.disabled === false`), 'escolha completa da principal');
  await evaluateMain(`document.querySelector('.modal button[type=submit]').click()`);
  const rerun = await until(async () => (await native('invoke', { channel: 'agent:list' })).find((item) => item.id === principal.id && item.ptyId !== principal.ptyId && item.state === 'running'), 'nova run principal');
  await until(async () => !(await native('windows')).some((item) => item.url.includes('window=terminal')), 'pop-up antigo fechado antes da nova run');
  await until(() => evaluateMain(`Boolean(${principalCard}.querySelector('.real-terminal .xterm-helper-textarea')) && !${principalCard}.querySelector('.detached-terminal-placeholder')`), 'novo PTY reintegrado');
  assert.equal(await evaluateMain(`Boolean(${principalCard}.querySelector('.terminal-error'))`), false);
  assert.equal(rerun.id, principal.id);
  assert.equal(rerun.runAttempt, 2);
  const rerunNative = await materializeSession(rerun, 'atlas-principal-2');
  if (!configuredModel) assert.notEqual(rerunNative.sessionKey, principalNative.sessionKey, 'nova run cria outra sessão interna do CLI');
  console.log('PASS nova execução após saída em pop-up reintegra e conecta PTY novo sem perder identidade');
  if (integrationActive) {
    await until(async () => (await native('invoke', { channel: 'agent:list' })).find((item) => item.id === principal.id)?.atlasTools === true, 'ponte MCP na nova run da principal', 30000);
    await until(() => evaluateMain(`${principalCard}.querySelector('.session-header').title.includes('ATLAS conectado')`), 'indicação ATLAS conectado na principal');
    console.log('PASS nova run da principal carrega a ponte MCP do ATLAS com perfil mcp__atlas__*');
    if (!configuredModel) await switchTuiModel(rerun, rerunNative);
  }

  // Pedido da principal real semeado no banco do perfil isolado (sem prompt ao
  // modelo); o caminho MCP do pedido é coberto pelos testes com ponte e host reais.
  const { createOperationalStore } = require('../electron/operational-store.cjs');
  const liveStore = createOperationalStore({ filename: path.join(profile, 'atlas.sqlite') });
  let seededRequest;
  try {
    seededRequest = liveStore.requestAgent({ projectId: rerun.projectId, requestedBy: principal.id, name: 'agente-da-principal', purpose: 'Agente pedido pela principal no smoke real.', idempotencyKey: 'smoke-agent-request-01' });
  } finally {
    liveStore.close();
  }
  await native('send', { channel: 'agent-request:changed', payload: { projectId: rerun.projectId } });
  await until(() => evaluateMain(`document.querySelector('.agent-request')?.innerText.includes('Novo agente: agente-da-principal')`), 'pedido da principal exibido para decisão');
  await chooseKimi('.agent-request');
  await until(() => evaluateMain(`document.querySelector('.agent-request button.primary')?.disabled === false`), 'escolha completa no pedido');
  await evaluateMain(`document.querySelector('.agent-request button.primary').click()`);
  const delegated = await until(async () => (await native('invoke', { channel: 'agent:list' })).find((item) => item.name === 'agente-da-principal' && item.state === 'running'), 'agente aprovado iniciado', 30000);
  assert.equal(delegated.origin, 'orchestrator');
  assert.equal(delegated.role, 'agent');
  assert.equal(delegated.cwd, fixture);
  const fulfilled = (await native('invoke', { channel: 'agent-request:list', args: [{ cwd: fixture }] })).items.find((item) => item.id === seededRequest.id);
  assert.equal(fulfilled.state, 'fulfilled');
  assert.equal(fulfilled.sessionId, delegated.id);
  const delegatedCard = `document.querySelector('.session-card[data-session-name=agente-da-principal]')`;
  await until(() => evaluateMain(`${delegatedCard}?.querySelector('.session-header').title.includes('orquestrador')`), 'card do agente aprovado com origem orquestrador');

  await until(() => evaluateMain(`document.querySelectorAll('.agent-request').length === 0`), 'pedido resolvido sai da fila');
  const delegatedAttach = () => native('invoke', { channel: 'terminal:attach', args: [delegated.ptyId] });
  let delegatedTrusted = false;
  await until(async () => {
    const output = (await delegatedAttach()).scrollback;
    if (!delegatedTrusted && output.includes('Trust this folder?')) {
      delegatedTrusted = true;
      await native('invoke', { channel: 'terminal:write', args: [{ terminalId: delegated.ptyId, data: '\r' }] });
      return false;
    }
    return output.includes('Welcome to Kimi Code!');
  }, 'TUI do agente aprovado', 90000);
  await materializeSession(delegated, 'atlas-approved');
  if (integrationActive) await until(async () => (await native('invoke', { channel: 'agent:list' })).find((item) => item.id === delegated.id)?.atlasTools === true, 'ponte MCP no agente aprovado', 30000);
  await sendCommand(delegated, '/exit');
  await until(async () => (await native('invoke', { channel: 'agent:list' })).find((item) => item.id === delegated.id)?.state === 'exited', 'agente aprovado encerrado');
  console.log('PASS pedido da principal aprovado pela interface inicia o Kimi real com origem orchestrator e ponte conectada');

  // Pedido ligado a uma tarefa com worktree: a aprovação cria a worktree Git real
  // ao lado da fixture e o Kimi nasce nela.
  const worktreeStore = createOperationalStore({ filename: path.join(profile, 'atlas.sqlite') });
  let worktreeRequest;
  let worktreeTask;
  try {
    worktreeTask = worktreeStore.createTask({ projectId: rerun.projectId, title: 'Tarefa em worktree', acceptance: 'Trabalho isolado na branch da tarefa', idempotencyKey: 'smoke-agent-task-wt-01' });
    worktreeRequest = worktreeStore.requestAgent({ projectId: rerun.projectId, requestedBy: principal.id, name: 'executor-worktree', purpose: 'Executar a tarefa em worktree.', taskId: worktreeTask.id, worktree: true, idempotencyKey: 'smoke-agent-request-wt-01' });
  } finally {
    worktreeStore.close();
  }
  const expectedBranch = `atlas/task-${worktreeTask.id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
  await native('send', { channel: 'agent-request:changed', payload: { projectId: rerun.projectId } });
  await until(() => evaluateMain(`document.querySelector('.agent-request')?.innerText.includes(${JSON.stringify(expectedBranch)})`), 'pedido com worktree mostra a branch planejada');
  await chooseKimi('.agent-request');
  await until(() => evaluateMain(`document.querySelector('.agent-request button.primary')?.disabled === false`), 'escolha completa no pedido');
  await evaluateMain(`document.querySelector('.agent-request button.primary').click()`);
  const isolated = await until(async () => (await native('invoke', { channel: 'agent:list' })).find((item) => item.name === 'executor-worktree' && item.state === 'running'), 'agente iniciado na worktree', 60000);
  const worktreePath = fs.realpathSync(path.join(worktreesRoot, `task-${expectedBranch.slice('atlas/task-'.length)}`));
  assert.equal(path.resolve(isolated.cwd).toLowerCase(), worktreePath.toLowerCase());
  assert.equal(git(worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'), expectedBranch);
  assert.equal(git(fixture, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'repositório principal intocado');
  const worktreeFulfilled = (await native('invoke', { channel: 'agent-request:list', args: [{ cwd: fixture }] })).items.find((item) => item.id === worktreeRequest.id);
  assert.equal(worktreeFulfilled.state, 'fulfilled');
  assert.equal(worktreeFulfilled.worktree.branch, expectedBranch);
  let isolatedTrusted = false;
  await until(async () => {
    const output = (await native('invoke', { channel: 'terminal:attach', args: [isolated.ptyId] })).scrollback;
    if (!isolatedTrusted && output.includes('Trust this folder?')) {
      isolatedTrusted = true;
      await native('invoke', { channel: 'terminal:write', args: [{ terminalId: isolated.ptyId, data: '\r' }] });
      return false;
    }
    return output.includes('Welcome to Kimi Code!');
  }, 'TUI do agente na worktree', 90000);
  await materializeSession(isolated, 'atlas-worktree');
  if (integrationActive) await until(async () => (await native('invoke', { channel: 'agent:list' })).find(item => item.id === isolated.id)?.atlasTools === true, 'ponte MCP no agente da worktree', 30000);
  await sendCommand(isolated, '/exit');
  await until(async () => (await native('invoke', { channel: 'agent:list' })).find((item) => item.id === isolated.id)?.state === 'exited', 'agente da worktree encerrado');
  console.log('PASS pedido com worktree aprovado cria a worktree Git real da tarefa e inicia o Kimi nela');

  await native('quit');
  await until(() => child.exitCode !== null, 'primeiro Electron encerrado', 15000);
  child = launch();
  await until(async () => {
    try { return (await native('windows')).some((item) => !item.url.includes('window=')); } catch { return false; }
  }, 'Electron reaberto no mesmo perfil', 30000);
  const restored = (await native('invoke', { channel: 'agent:list' })).find((item) => item.id === agent.id);
  assert(restored, 'Sessão preservada após reinício');
  assert.equal(restored.archived, true);
  assert.equal(restored.runState, 'succeeded');
  assert.equal(restored.exit.exitCode, 0);
  assert.equal(restored.ptyId, null);
  assert.equal(restored.cwd, fixture);
  if (!configuredModel) assert.equal(restored.currentModel, 'fixture-b', 'modelo informado da sessão manual preservado após reinício');
  // Continuidade (docs/planos/PLANO_CONTINUIDADE_SESSOES.md): a principal que estava aberta
  // volta sozinha, numa nova run da mesma sessão. No Kimi, com conversa nova (--agent-file
  // não combina com --continue).
  const restoredPrincipal = await until(async () => {
    const item = await native('invoke', { channel: 'agent:open-orchestrator', args: [{ cwd: fixture }] });
    return item?.state === 'running' ? item : null;
  }, 'principal retomada ao reabrir', 60000);
  assert.equal(restoredPrincipal.id, principal.id);
  assert.notEqual(restoredPrincipal.ptyId, null);
  assert(restoredPrincipal.runAttempt > rerun.runAttempt, 'nova run da mesma sessão');
  if (!configuredModel) assert.equal(restoredPrincipal.model, 'fixture-b', 'modelo informado é o da principal retomada');
  const restoreStatus = await native('invoke', { channel: 'agent:restore-status' });
  assert.deepEqual(restoreStatus.result.fresh.map((item) => item.name), ['Principal']);
  const persistedMessages = await native('invoke', { channel: 'message:list', args: [{ cwd: fixture }] });
  assert.equal(persistedMessages.items.length, 1);
  assert.equal(persistedMessages.items[0].subject, 'Descoberta real do smoke');
  assert(persistedMessages.items[0].readAt, 'Leitura da descoberta preservada após reinício');
  console.log('PASS reinício real do Electron preserva identidade, saída do Kimi e mensagens, e retoma a principal que estava aberta');
  if (!configuredModel) {
    assert.equal((await native('invoke', { channel: 'integration:kimi-mcp-status' })).state, 'installed', 'integração preservada após reinício');
    assert.equal(path.basename(JSON.parse(fs.readFileSync(path.join(kimiHome, 'mcp.json'), 'utf8')).mcpServers.atlas.args[0]), 'atlas-mcp-bridge.cjs');
    console.log('PASS integração MCP permanece instalada após reinício');
  }
  const restoredDelegated = (await native('invoke', { channel: 'agent:list' })).find((item) => item.id === delegated.id);
  assert.equal(restoredDelegated?.origin, 'orchestrator', 'origem do agente aprovado preservada após reinício');
  const restoredRequest = (await native('invoke', { channel: 'agent-request:list', args: [{ cwd: fixture }] })).items.find((item) => item.id === seededRequest.id);
  assert.equal(restoredRequest.state, 'fulfilled');
  console.log('PASS pedido atendido e origem do agente preservados após reinício');

  assert.equal(modelRequests, 0, 'Nenhum pedido ao provedor fictício.');
  if (!configuredModel) {
    assert.equal(fs.readFileSync(path.join(kimiHome, 'config.toml'), 'utf8'), fixtureConfig);
    console.log('PASS provedor de fixture sem chamadas e configuração de modelos intacta');
  }
  exitCode = 0;
} catch (error) {
  failureMessage = error.message;
  console.error(`FAIL: ${error.message}`);
  if (configuredModel && modelDiagnostic) console.error(JSON.stringify({ promptEcho: modelDiagnostic.includes('Reply only'), permissionQuestion: /Allow this|Approve this|Do you want to allow/i.test(modelDiagnostic), setupQuestion: /login|select.*model|configure/i.test(modelDiagnostic), providerError: /quota|rate limit|APIError|authentication|Error:/i.test(modelDiagnostic), pasteMode: /paste|pasted/i.test(modelDiagnostic), renderedCharacters: modelDiagnostic.length }));
  try {
    if (configuredModel) throw new Error('Saída de diagnóstico do perfil configurado omitida para preservar dados locais.');
    const agents = await native('invoke', { channel: 'agent:list' });
    for (const item of agents) {
      if (!item.ptyId) continue;
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
  if (provider) await new Promise(resolve => provider.close(resolve));
  if (modelRequests !== 0) exitCode = 1;
  if (exitCode === 0) {
    const resolved = fs.realpathSync(fixture);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert(path.basename(resolved).startsWith('atlas-agent-smoke-'));
    await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    // Worktrees criadas pela aprovação ficam ao lado da fixture, também em diretório temporário.
    if (fs.existsSync(worktreesRoot)) {
      const worktrees = fs.realpathSync(worktreesRoot);
      assert.equal(path.dirname(worktrees).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
      assert(path.basename(worktrees).startsWith('atlas-agent-smoke-') && path.basename(worktrees).endsWith('.atlas-worktrees'));
      await fs.promises.rm(worktrees, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
  else console.error(`Fixture preservada para diagnóstico: ${fixture}`);
}
publishSmokeResult(path.join(resultsDir, 'agent-result.json'), { passed: exitCode === 0, version: kimi.version, conversation: configuredModel, fixture: exitCode === 0 ? null : fixture, ...(failureMessage ? { error: failureMessage } : {}) }, modelRequests);
process.exit(exitCode);
