import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { auditInterface } from './audit-interface.mjs';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = path.join(root, '.atlas-smoke-results');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-smoke-'));
const repository = path.join(fixture, 'Repositório Validação');
const worktree = path.join(fixture, 'Worktree Revisão');
const profile = path.join(fixture, 'profile');
const extraProject = path.join(fixture, 'Projeto adicional');
// A integração MCP grava no mcp.json do Kimi: o smoke nunca usa a home real.
const kimiHome = path.join(fixture, 'kimi-home');
const kimiMcp = path.join(kimiHome, 'mcp.json');
// A integração do Gemini grava no settings.json da home dele: também só na fixture.
const geminiHome = path.join(fixture, 'gemini-home');
fs.mkdirSync(resultsDir, { recursive: true });
fs.mkdirSync(profile);
fs.mkdirSync(kimiHome);
fs.writeFileSync(kimiMcp, JSON.stringify({ mcpServers: { github: { command: 'gh-mcp', args: ['--fixture'] } } }, null, 2));
fs.mkdirSync(extraProject);
fs.writeFileSync(path.join(resultsDir, 'result.json'), JSON.stringify({ passed: false, status: 'running', fixture }));
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git(fixture, 'init', '--bare', 'origin.git');
git(fixture, 'clone', path.join(fixture, 'origin.git'), repository);
git(repository, 'checkout', '-b', 'main');
fs.writeFileSync(path.join(repository, 'tracked.txt'), 'initial\n');
fs.writeFileSync(path.join(repository, 'unchanged.txt'), 'stable\n');
git(repository, 'add', '.');
git(repository, '-c', 'user.name=ATLAS Smoke', '-c', 'user.email=smoke@atlas.invalid', 'commit', '-m', 'Initial fixture');
git(repository, 'push', '-u', 'origin', 'main');
git(repository, 'worktree', 'add', '-b', 'feature/revisao', worktree);
fs.writeFileSync(path.join(repository, 'tracked.txt'), 'committed locally\n');
git(repository, 'add', '.');
git(repository, '-c', 'user.name=ATLAS Smoke', '-c', 'user.email=smoke@atlas.invalid', 'commit', '-m', 'Ahead of upstream');
fs.writeFileSync(path.join(worktree, 'tracked.txt'), 'modified\n');
fs.writeFileSync(path.join(worktree, 'staged.txt'), 'staged\n');
git(worktree, 'add', 'staged.txt');
fs.writeFileSync(path.join(worktree, 'não rastreado.txt'), 'untracked\n');
const touched = new Date(Date.now() + 60000);
fs.utimesSync(path.join(worktree, 'unchanged.txt'), touched, touched);
const indexPath = git(worktree, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
const indexBefore = fs.readFileSync(indexPath);
const gitBefore = git(worktree, '--no-optional-locks', 'status', '--porcelain=v2', '--branch');
const { discoverRepositories } = createRequire(import.meta.url)('../electron/git-discovery.cjs');
const discovery = await discoverRepositories(fixture);
assert.equal(discovery.errors.length, 0);
assert.equal(discovery.repositories.length, 1);
const discovered = discovery.repositories[0];
assert.equal(discovered.worktrees.length, 2);
assert.deepEqual(discovered.branches.map((item) => item.name).sort(), ['feature/revisao', 'main']);
assert.equal(discovered.worktrees.find((item) => item.branch === 'main').status.ahead, 1);
assert.deepEqual(['staged', 'modified', 'untracked'].map((key) => discovered.worktrees.find((item) => item.branch === 'feature/revisao').status[key]), [1, 1, 1]);
assert.equal(git(worktree, '--no-optional-locks', 'status', '--porcelain=v2', '--branch'), gitBefore);
assert.deepEqual(fs.readFileSync(indexPath), indexBefore);
console.log('PASS Git real: Unicode, branches, worktrees, upstream/ahead e alterações sem modificar o índice');
if (process.argv.includes('--git-only')) {
  const fixtureReal = fs.realpathSync(fixture);
  assert.equal(path.dirname(fixtureReal).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
  assert(path.basename(fixtureReal).startsWith('atlas-smoke-'));
  await fs.promises.rm(fixtureReal, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  process.exit(0);
}

const port = process.env.ATLAS_SMOKE_PORT || '9333';
// Simulate a previous process crash using only this run's isolated profile.
const { createOperationalStore, MIGRATIONS } = createRequire(import.meta.url)('../electron/operational-store.cjs');
const { idFor } = createRequire(import.meta.url)('../electron/git-discovery.cjs');
const seed = createOperationalStore({ filename: path.join(profile, 'atlas.sqlite') });
const projectId = idFor(fs.realpathSync(fixture));
seed.registerProject({ id: projectId, name: path.basename(fixture), path: fs.realpathSync(fixture) });
seed.startSession({ id: 'history-fixture', projectId, name: 'histórico-fixture', adapterId: 'fixture', cli: 'Fixture Agent', version: '1.0.0', cwd: fs.realpathSync(fixture), origin: 'user', createdAt: new Date(Date.now() - 60000).toISOString() });
const extraProjectId = idFor(fs.realpathSync(extraProject));
seed.registerProject({ id: extraProjectId, name: path.basename(extraProject), path: fs.realpathSync(extraProject) });
seed.startSession({ id: 'reauthorized-fixture', projectId: extraProjectId, name: 'histórico-reauthorized', adapterId: 'fixture', cli: 'Fixture Agent', version: '1.0.0', cwd: fs.realpathSync(extraProject), origin: 'user', createdAt: new Date(Date.now() - 60000).toISOString() });
// Histórico do Kimi Code no projeto extra: é ali que o aviso de integração deve aparecer.
seed.startSession({ id: 'reauthorized-fixture-2', projectId: extraProjectId, name: 'histórico-extra', adapterId: 'kimi-code', cli: 'Kimi Code', version: '1.0.0', cwd: fs.realpathSync(extraProject), origin: 'user', createdAt: new Date(Date.now() - 55000).toISOString() });
seed.sendMessage({ projectId: extraProjectId, fromSessionId: 'reauthorized-fixture', toSessionId: 'reauthorized-fixture-2', kind: 'discovery', subject: 'Descoberta da fixture', body: 'Mensagem persistida antes do crash simulado.', idempotencyKey: 'fixture-msg-0001' });
seed.close();
const endpoint = `http://127.0.0.1:${port}`;
const electron = createRequire(import.meta.url)('electron');
const controlPort = Number(port) + 1;
const controlToken = randomUUID();
// Chave de fixture no registro do usuário para a entrada do Explorador; removida ao final.
const explorerRoot = `HKCU\\Software\\ATLAS-Smoke-${randomUUID()}`;
const openFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-smoke-open-'));
const env = { ...process.env, ATLAS_EXPLORER_ROOT: explorerRoot, ATLAS_SMOKE_PROFILE: profile, ATLAS_SMOKE_PROJECT: extraProject, ATLAS_SMOKE_CONTROL_PORT: String(controlPort), ATLAS_SMOKE_TOKEN: controlToken, ATLAS_SMOKE_NO_CLI: '1', KIMI_CODE_HOME: kimiHome, GEMINI_CLI_HOME: geminiHome };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
// Codex can inject its bundled PowerShell modules; exercise Windows' own modules.
for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
const child = spawn(electron, [path.join(root, 'scripts/smoke-app.cjs'), `--remote-debugging-port=${port}`], { cwd: fixture, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const childExit = new Promise((resolve) => child.once('exit', resolve));
const connections = [];
const pids = [];
let createdTaskId = null;
let offeredTaskId = null;
let blockedTaskId = null;
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
async function until(check, label, timeout = 15000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try { const result = await check(); if (result) return result; } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(`Timeout: ${label}${last ? ` (${last.message})` : ''}`);
}
const pages = async () => (await fetch(`${endpoint}/json/list`)).json();
async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const requests = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = requests.get(message.id);
    if (!request) return;
    requests.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 10000);
    requests.set(requestId, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  const connection = { ws, call, evaluate, page };
  connections.push(connection);
  return connection;
}
async function click(cdp, selector, text) {
  assert(await cdp.evaluate(`(() => { const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(item => ${text ? `item.textContent.trim() === ${JSON.stringify(text)}` : 'true'}); if (!element) return false; element.click(); return true; })()`), `Missing ${selector} ${text || ''}`);
  await delay(120);
}
// Selects controlados pelo React precisam do setter nativo e do evento change.
async function choose(cdp, scope, name, value) {
  assert(await cdp.evaluate(`(() => { const select = document.querySelector(${JSON.stringify(`${scope} select[name=${name}]`)}); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)}); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === ${JSON.stringify(value)}; })()`), `Missing option ${value} in ${scope} ${name}`);
  await delay(120);
}
async function key(cdp, keyName, options = {}) {
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, ...options });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, ...options, text: undefined });
}
async function command(cdp, selector, input) {
  const session = new URL(cdp.page.url).searchParams.get('session');
  await native('focus', session ? { session } : {});
  await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  for (const char of input) await key(cdp, char, { text: char });
  await key(cdp, 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
}
async function screenshot(cdp, name) {
  const params = new URL(cdp.page.url).searchParams;
  const target = params.get('session') ? { session: params.get('session') } : params.get('window') === 'panels' ? { kind: 'panels' } : {};
  await native('focus', target);
  await cdp.call('Page.bringToFront');
  await until(() => cdp.evaluate(`document.visibilityState === 'visible'`), `janela visível para captura ${name}`);
  await cdp.evaluate(`new Promise(resolve => requestAnimationFrame(() => resolve(true)))`);
  const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(resultsDir, `${name}.png`), Buffer.from(data, 'base64'));
}

try {
  const main = await connect(await until(async () => (await pages()).find((item) => !item.url.includes('window=')), 'main window'));
  await until(() => main.evaluate(`Boolean(document.querySelector('.app-shell'))`), 'React ready');
  await until(() => main.evaluate(`Boolean(document.querySelector('.session-history'))`), 'persisted session restored');
  assert.equal(await main.evaluate(`document.querySelectorAll('.origin-badge.demo').length`), 0, 'Desktop must not show illustrative agent cards');
  // Sem CLI padrão: a principal só inicia depois de o usuário escolher CLI e modelo.
  await until(() => main.evaluate(`document.querySelector('.orchestrator-choice-note')?.innerText.includes('ainda não foi iniciada')`), 'principal aguarda a escolha do agente');
  // Painel do Atlas: a principal parada aparece em "Espera você".
  await until(() => main.evaluate(`[...document.querySelectorAll('.atlas-decision.principal')].some(item => item.innerText.includes('Iniciar a sessão principal'))`), 'painel mostra a principal parada');
  // Regressão: sem sessão Kimi no projeto, nada de aviso do Kimi (só o indicador discreto).
  assert.equal(await main.evaluate(`document.querySelectorAll('.integration-notice').length`), 0, 'Kimi notice only with a Kimi session');
  assert.equal(await main.evaluate(`document.querySelectorAll('.session-history').length`), 1, 'Unauthorized project history must remain hidden');
  const restoredHistory = await main.evaluate(`(() => { const history = document.querySelector('.session-history'); const card = history.closest('.session-card'); return { text: history.innerText, inputs: card.querySelectorAll('input, textarea').length, popup: [...card.querySelectorAll('button')].some(item => item.textContent === 'Pop-up'), tokens: Boolean(card.querySelector('.token-count')) }; })()`);
  assert(restoredHistory.text.includes('resultado incerto'));
  assert(restoredHistory.text.includes(fixture));
  assert.equal(restoredHistory.inputs, 0);
  assert.equal(restoredHistory.popup, false);
  assert.equal(restoredHistory.tokens, false);
  assert.equal((await native('terminals')).length, 0, 'Restoring history must not spawn a process');
  await main.evaluate(`document.querySelector('.session-history').closest('.session-card').querySelector('[title="Alternar foco"]').click()`);
  await screenshot(main, 'session-history');
  const historyAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(historyAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in restored history');
  await main.evaluate(`document.querySelector('.session-history').closest('.session-card').querySelector('[title="Alternar foco"]').click()`);
  console.log('PASS histórico restaurado como lost, sem PTY, composer ou métricas fictícias');
  await native('focus');
  await click(main, '.add-project');
  await until(() => main.evaluate(`window.atlasDesktop.listAgents().then(items => items.length === 3)`), 'history loaded after project authorization without reload');
  console.log('PASS autorizar projeto restaura histórico adicional sem recarregar a UI');
  await until(() => main.evaluate(`document.querySelectorAll('.worktree-item').length >= 2`), 'Git discovery UI');
  await until(() => main.evaluate(`!document.querySelector('.discovery-heading button').disabled`), 'project loading finished');
  await main.evaluate(`[...document.querySelectorAll('.project-tab')].find(item => item.textContent.startsWith('Projeto adicional')).click()`);
  await until(() => native('defaults-resolved'), 'delayed defaults resolved');
  await delay(150);
  assert(await main.evaluate(`document.querySelector('.project-tab.active').textContent.startsWith('Projeto adicional')`), 'Initial hydration overwrote the selected project');
  assert(await main.evaluate(`document.querySelector('.workspace-path span').textContent === ${JSON.stringify(extraProject)}`), 'Initial hydration overwrote the selected directory');
  console.log('PASS seleção do projeto preservada durante inicialização tardia');
  await click(main, '[title="Modo de foco"]');
  assert.equal(await main.evaluate(`document.querySelectorAll('.session-card').length`), 1, 'Focus must select a session in the current project');
  assert((await main.evaluate(`document.querySelector('.session-history').innerText`)).includes(extraProject));
  await click(main, '[title="Exibir grid"]');
  await until(() => main.evaluate(`Boolean(document.querySelector('.persistent-tasks button:not(:disabled)'))`), 'task project ready');
  assert(await main.evaluate(`document.querySelector('.persistent-tasks button').getBoundingClientRect().width > 0`), 'New task control must be visible to the user');
  await click(main, '.persistent-tasks button', 'Nova tarefa');
  assert.equal(await main.evaluate(`document.activeElement.name`), 'title');
  await key(main, ',', { code: 'Comma', windowsVirtualKeyCode: 188, modifiers: 2 });
  assert.equal(await main.evaluate(`document.querySelectorAll('[role=dialog]').length`), 1, 'Appearance shortcut must not stack modal focus traps');
  assert.equal(await main.evaluate(`document.activeElement.name`), 'title');
  assert(await main.evaluate(`document.querySelector('.task-modal button[type=submit]').disabled`), 'Empty task must not submit');
  await key(main, 'Tab', { code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await main.evaluate(`document.activeElement.name`), 'description', 'Textarea must participate in modal focus');
  await main.evaluate(`(() => { for (const [name, value] of Object.entries({ title: 'Tarefa real · smoke', description: 'Escopo da fixture', acceptance: 'Preservar após recarregar e reabrir o banco' })) { const field = document.querySelector('.task-modal [name=' + name + ']'); Object.getOwnPropertyDescriptor(name === 'title' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value').set.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  const taskModalAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(taskModalAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in task modal');
  await screenshot(main, 'task-modal');
  await main.evaluate(`document.querySelector('.task-modal form').requestSubmit()`);
  await until(() => main.evaluate(`!document.querySelector('.task-modal') && document.querySelector('.persistent-tasks').innerText.includes('Tarefa real · smoke')`), 'task created in panel');
  const createdTasks = await native('invoke', { channel: 'task:list', args: [{ cwd: extraProject }] });
  assert.equal(createdTasks.items.length, 1);
  createdTaskId = createdTasks.items[0].id;
  assert.equal(createdTasks.items[0].state, 'backlog');
  console.log('PASS criar tarefa real: foco, textarea, validação, contraste e backlog persistente');
  await main.evaluate(`[...document.querySelectorAll('.inspector-tabs button')].find(item => item.textContent.trim().startsWith('Mensagens')).click()`);
  await until(() => main.evaluate(`document.querySelector('.messages-panel')?.innerText.includes('Descoberta da fixture')`), 'persisted message listed in panel');
  const messagesText = await main.evaluate(`document.querySelector('.messages-panel').innerText`);
  assert(messagesText.includes('histórico-reauthorized') && messagesText.includes('histórico-extra'), 'Message route shows real session names');
  assert(messagesText.includes('1 não lida'), 'Unread count announced as text');
  assert.equal(await main.evaluate(`document.querySelectorAll('.messages-panel .scope-note').length`), 0, 'Desktop must not mark real messages as illustrative');
  assert(await main.evaluate(`[...document.querySelectorAll('.inspector-tabs button')].find(item => item.textContent.trim().startsWith('Mensagens')).textContent.includes('1')`), 'Unread badge on messages tab');
  await main.evaluate(`[...document.querySelectorAll('button.message-card')].find(item => item.innerText.includes('Descoberta da fixture')).click()`);
  await until(() => main.evaluate(`document.querySelector('.messages-panel')?.innerText.includes('0 não lidas')`), 'message marked read');
  const readMessages = await native('invoke', { channel: 'message:list', args: [{ cwd: extraProject }] });
  assert.equal(readMessages.items.length, 1);
  assert(readMessages.items[0].readAt, 'Read state persisted by the main process');
  await main.evaluate(`[...document.querySelectorAll('.inspector-tabs button')].find(item => item.textContent.trim().startsWith('Tarefas')).click()`);
  console.log('PASS mensagem real listada com rota, badge de não lida e leitura persistida');
  const integrationFile = () => JSON.parse(fs.readFileSync(kimiMcp, 'utf8'));
  await until(() => main.evaluate(`document.querySelector('.integration-status')?.innerText.includes('não conectadas')`), 'integration status in subbar');
  assert(await main.evaluate(`document.querySelector('.integration-notice')?.innerText.includes('não estão conectadas')`), 'Notice explains missing integration');
  await assert.rejects(native('invoke', { channel: 'integration:kimi-mcp-install', args: [{}] }), /Confirme/);
  assert.deepEqual(Object.keys(integrationFile().mcpServers), ['github'], 'Nothing is written without consent');
  await click(main, '.integration-notice button', 'Revisar e conectar');
  await until(() => main.evaluate(`Boolean(document.querySelector('.integration-modal'))`), 'consent dialog open');
  const consent = await main.evaluate(`(() => { const dialog = document.querySelector('.integration-modal'); return { focused: document.activeElement.textContent.trim(), inDialog: dialog.contains(document.activeElement), path: dialog.querySelector('.integration-path').textContent, entry: dialog.querySelector('.integration-entry').textContent, primary: dialog.querySelector('.button.primary')?.textContent.trim(), modal: dialog.getAttribute('aria-modal') }; })()`);
  assert.equal(consent.focused, 'Fechar', 'Safe action receives initial focus');
  assert(consent.inDialog);
  assert.equal(consent.modal, 'true');
  assert.equal(consent.path, kimiMcp, 'Dialog shows the exact file');
  assert(consent.entry.includes('atlas-mcp-bridge.cjs') && consent.entry.includes('ELECTRON_RUN_AS_NODE'), 'Dialog shows the exact entry');
  assert.equal(consent.primary, 'Conectar');
  for (let index = 0; index < 6; index += 1) {
    await key(main, 'Tab', { code: 'Tab', windowsVirtualKeyCode: 9 });
    assert(await main.evaluate(`document.querySelector('.integration-modal').contains(document.activeElement)`), 'Focus stays in the consent dialog');
  }
  const consentAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(consentAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in consent dialog');
  await screenshot(main, 'integration-consent');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('.integration-modal')`), 'Escape cancels consent');
  assert.deepEqual(Object.keys(integrationFile().mcpServers), ['github'], 'Cancel writes nothing');
  await click(main, '.integration-notice button', 'Revisar e conectar');
  await click(main, '.integration-modal .button.primary', 'Conectar');
  await until(() => main.evaluate(`!document.querySelector('.integration-modal') && document.querySelector('.integration-status').innerText.includes('conectadas') && !document.querySelector('.integration-status').innerText.includes('não')`), 'integration installed');
  assert.equal(await main.evaluate(`document.querySelectorAll('.integration-notice').length`), 0, 'Notice disappears once connected');
  const installed = integrationFile();
  assert.deepEqual(installed.mcpServers.github, { command: 'gh-mcp', args: ['--fixture'] }, 'Other servers preserved');
  assert.equal(path.basename(installed.mcpServers.atlas.args[0]), 'atlas-mcp-bridge.cjs');
  assert.deepEqual(installed.mcpServers.atlas.env, { ELECTRON_RUN_AS_NODE: '1' });
  await click(main, '.integration-status .link-button', 'Gerenciar');
  await until(() => main.evaluate(`Boolean(document.querySelector('.integration-modal .button.danger'))`), 'manage dialog offers removal');
  await click(main, '.integration-modal .button.danger', 'Remover integração');
  await until(() => main.evaluate(`!document.querySelector('.integration-modal') && document.querySelector('.integration-status').innerText.includes('não conectadas')`), 'integration removed');
  assert.deepEqual(integrationFile(), { mcpServers: { github: { command: 'gh-mcp', args: ['--fixture'] } } }, 'Removal deletes only the ATLAS entry');
  assert.equal(await main.evaluate(`document.querySelectorAll('.integration-notice').length`), 0, 'Removing does not nag the user again');
  console.log('PASS consentimento da integração MCP: conteúdo exato, foco, cancelar, conectar e remover sem tocar outros servidores');
  const target = `.worktree-item[title=${JSON.stringify(worktree)}]`;
  await click(main, target);
  await until(() => main.evaluate(`document.querySelector('.persistent-tasks').innerText.includes('Nenhuma tarefa criada')`), 'task scope changed');
  assert(!(await main.evaluate(`document.querySelector('.persistent-tasks').innerText`)).includes('Tarefa real · smoke'));
  await main.evaluate(`[...document.querySelectorAll('.inspector-tabs button')].find(item => item.textContent.trim().startsWith('Mensagens')).click()`);
  await until(() => main.evaluate(`document.querySelector('.messages-panel')?.innerText.includes('Nenhuma mensagem')`), 'message scope changed');
  assert(!(await main.evaluate(`document.querySelector('.messages-panel').innerText`)).includes('Descoberta da fixture'));
  await main.evaluate(`[...document.querySelectorAll('.inspector-tabs button')].find(item => item.textContent.trim().startsWith('Tarefas')).click()`);
  console.log('PASS tarefas e mensagens isoladas ao trocar projeto/worktree');
  await click(main, target);
  async function createTerminal(name) {
    await native('focus');
    await click(main, target);
    await click(main, '.toolbar-actions button', 'Terminal');
    await until(() => main.evaluate(`document.querySelector('select[name=cwd]').value === ${JSON.stringify(worktree)}`), 'selected worktree in terminal dialog');
    await main.evaluate(`(() => { const field = document.querySelector('input[name=name]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(field, ${JSON.stringify(name)}); field.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.modal form').requestSubmit(); })()`);
    await until(() => main.evaluate(`[...document.querySelectorAll('.session-card')].some(item => item.querySelector('h3')?.textContent === ${JSON.stringify(name)})`), name);
    return (await native('terminals')).at(-1);
  }
  const first = await createTerminal('smoke-um');
  const second = await createTerminal('smoke-dois');
  const card = (name) => `[...document.querySelectorAll('.session-card')].find(item => item.querySelector('h3')?.textContent === ${JSON.stringify(name)})`;
  const focus = async (name) => { await main.evaluate(`${card(name)}.querySelector('[title="Alternar foco"]').click()`); await delay(200); };
  const input = '.real-terminal .xterm-helper-textarea';
  const raw = async (id) => main.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(id)}).then(item => item.scrollback)`);
  const output = async (marker, id = first.id) => until(async () => (await raw(id)).includes(marker), marker);
  await focus('smoke-um');
  await command(main, input, `Write-Output ('ATLAS_' + 'UNICODE_OK · continuação'); Write-Output ('CWD:' + (Get-Location).Path); Write-Output ('PID:' + $PID)`);
  await output('ATLAS_UNICODE_OK · continuação');
  await output(`CWD:${worktree}`);
  const firstPid = Number((await raw(first.id)).match(/PID:(\d+)/)?.[1]);
  pids.push(firstPid);
  assert(firstPid > 0);
  // A saída PID pode chegar antes de o PSReadLine redesenhar o próximo prompt.
  // Não injete o comando de dimensões durante essa transição de edição de linha.
  await until(async () => {
    const text = (await raw(first.id)).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trimEnd();
    return text.endsWith('>') && text.slice(-300).includes('PS ');
  }, 'PowerShell pronto após o primeiro comando');
  await command(main, input, `Write-Output ('SIZE:' + $Host.UI.RawUI.WindowSize.Width + 'x' + $Host.UI.RawUI.WindowSize.Height)`);
  await until(async () => /SIZE:\d+x\d+/.test(await raw(first.id)), 'initial PTY dimensions');
  const before = (await raw(first.id)).match(/SIZE:(\d+x\d+)/g).at(-1);
  await native('resize', { width: 1180, height: 780 });
  await delay(400);
  await command(main, input, `Write-Output ('RESIZED:' + $Host.UI.RawUI.WindowSize.Width + 'x' + $Host.UI.RawUI.WindowSize.Height)`);
  await until(async () => /RESIZED:\d+x\d+/.test(await raw(first.id)), 'resized PTY dimensions');
  assert.notEqual(before.slice(5), (await raw(first.id)).match(/RESIZED:(\d+x\d+)/)[1]);
  await command(main, input, 'Start-Sleep -Seconds 30');
  await delay(300);
  await key(main, 'c', { code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2 });
  await delay(700);
  await command(main, input, `Write-Output ('ATLAS_' + 'INTERRUPT_OK')`);
  await output('ATLAS_INTERRUPT_OK');
  console.log('PASS PTY: teclado Unicode, diretório da worktree, resize real e Ctrl+C');
  await click(main, '[title="Exibir grid"]');
  await focus('smoke-dois');
  await command(main, input, `Write-Output ('ATLAS_' + 'SECOND_OK'); Write-Output ('PID:' + $PID)`);
  await output('ATLAS_SECOND_OK', second.id);
  const secondPid = Number((await raw(second.id)).match(/PID:(\d+)/)?.[1]);
  pids.push(secondPid);
  assert(secondPid > 0 && secondPid !== firstPid);
  assert(!(await raw(first.id)).includes('ATLAS_SECOND_OK'));
  assert(!(await raw(second.id)).includes('ATLAS_UNICODE_OK'));
  console.log('PASS dois terminais com processos e streams independentes');
  // Paleta de comandos: abre com o foco dentro do terminal (o xterm não pode engolir o atalho),
  // filtra, leva ao terminal escolhido e fecha com Esc.
  await main.evaluate(`document.querySelector(${JSON.stringify(input)}).focus()`);
  await key(main, 'P', { code: 'KeyP', windowsVirtualKeyCode: 80, modifiers: 10 });
  await until(() => main.evaluate(`Boolean(document.querySelector('.command-palette input'))`), 'palette opened from terminal focus');
  for (const char of 'ir smoke-um') await key(main, char, { text: char });
  await until(() => main.evaluate(`[...document.querySelectorAll('.command-palette li[role=option]')].map(item => item.textContent).join('|').startsWith('Ir para smoke-um')`), 'palette filtered to terminal');
  await key(main, 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13 });
  // Com smoke-dois em Foco, "Ir para smoke-um" leva o Foco para smoke-um.
  await until(() => main.evaluate(`!document.querySelector('.command-palette') && ${card('smoke-um')}?.classList.contains('selected') && ${card('smoke-um')}.classList.contains('focused') && !${card('smoke-dois')}`), 'palette moved focus to the chosen terminal');
  await key(main, 'F1', { code: 'F1', windowsVirtualKeyCode: 112 });
  await until(() => main.evaluate(`Boolean(document.querySelector('.command-palette'))`), 'palette opened with F1');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('.command-palette')`), 'palette closed with Escape');
  assert(!(await raw(first.id)).includes('ir smoke-um'), 'Palette typing must not reach the PTY');
  console.log('PASS paleta de comandos: atalho com foco no terminal, busca, Foco no escolhido e Esc');
  // Volta ao estado anterior: grade e smoke-dois em Foco, como o restante do roteiro espera.
  await focus('smoke-um');
  await focus('smoke-dois');
  await main.evaluate(`[...${card('smoke-dois')}.querySelectorAll('button')].find(item => item.textContent === 'Pop-up').click()`);
  const popupPage = await until(async () => (await pages()).find((item) => item.url.includes('window=terminal')), 'popup');
  const popup = await connect(popupPage);
  await until(() => popup.evaluate(`Boolean(document.querySelector('.terminal-view'))`), 'popup terminal');
  await click(main, '.title-actions button', 'Aparência');
  await main.evaluate(`(() => { const field = document.querySelector('input[aria-label="Escolher cor de fundo personalizada"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, '#18222b'); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(() => popup.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#18222b'`), 'custom background synced to terminal popup');
  await click(main, '.appearance-content footer button', 'Concluir');
  await native('focus', { session: new URL(popupPage.url).searchParams.get('session') });
  await command(popup, input, `Write-Output ('ATLAS_' + 'POPUP_OK'); Write-Output ('PID:' + $PID)`);
  await output('ATLAS_POPUP_OK', second.id);
  assert.equal(Number((await raw(second.id)).match(/PID:(\d+)/g).at(-1).slice(4)), secondPid);
  assert(await main.evaluate(`Boolean(document.querySelector('.detached-terminal-placeholder'))`));
  await click(popup, 'button', 'Reintegrar');
  await until(() => main.evaluate(`Boolean(document.querySelector('.real-terminal .terminal-view'))`), 'reattach');
  await native('focus');
  await until(() => main.evaluate(`document.querySelector('.real-terminal').innerText.includes('ATLAS_POPUP_OK')`), 'scrollback reattached');
  console.log('PASS pop-up nativo, mesmo PID e histórico preservado ao reintegrar');
  await click(main, '[data-column-id=right] .detach-control', 'Pop-up');
  const panelPage = await until(async () => (await pages()).find((item) => item.url.includes('window=panels')), 'panel popup');
  const panel = await connect(panelPage);
  await until(() => panel.evaluate(`Boolean(document.querySelector('.native-inspector'))`), 'panel ready');
  await main.evaluate(`[...document.querySelectorAll('.project-tab')].find(item => item.textContent.startsWith('Projeto adicional')).click()`);
  await until(() => panel.evaluate(`document.querySelector('.persistent-tasks')?.innerText.includes('Tarefa real · smoke')`), 'task snapshot synced to popup');
  assert.equal(await panel.evaluate(`document.querySelectorAll('.persistent-tasks button').length`), 1, 'Popup lists task selection but cannot create tasks');
  await click(main, target);
  await until(() => panel.evaluate(`document.querySelector('.persistent-tasks')?.innerText.includes('Nenhuma tarefa criada')`), 'popup task scope follows main');
  assert((await native('windows')).find((item) => item.url.includes('window=panels')).alwaysOnTop);
  assert.equal(await panel.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`), '#18222b');
  await native('resize', { kind: 'panels', width: 420, height: 700 });
  // Em escala fracionária (ex.: 125%), o Windows converte DIP em pixels físicos com
  // arredondamento, então getBounds não devolve exatamente 420x700. Persistimos e
  // comparamos os limites realmente observados, validando a restauração pelo aplicativo.
  const panelsBounds = async () => (await native('windows')).find((item) => item.url.includes('window=panels'))?.bounds;
  const panelsResized = await until(panelsBounds, 'panels bounds after resize');
  await click(panel, '.inspector-tabs button', 'Evidências');
  await click(panel, 'button', 'Reintegrar');
  await until(() => main.evaluate(`Boolean(document.querySelector('[data-column-id=right]'))`), 'panels reattached');
  assert.equal(await main.evaluate(`document.querySelector('.inspector-tabs button.active').textContent.trim()`), 'Evidências');
  await click(main, '[data-column-id=right] .detach-control', 'Pop-up');
  await until(async () => (await pages()).find((item) => item.url.includes('window=panels')), 'panels reopened');
  const panelsReopened = await until(panelsBounds, 'panels bounds after reopen');
  assert(Math.abs(panelsReopened.width - panelsResized.width) <= 8, `largura restaurada: ${panelsReopened.width} vs ${panelsResized.width}`);
  assert(Math.abs(panelsReopened.height - panelsResized.height) <= 8, `altura restaurada: ${panelsReopened.height} vs ${panelsResized.height}`);
  assert(Math.abs(panelsResized.width - 420) <= 8, `redimensionamento aplicado: ${panelsResized.width}`);
  await main.evaluate(`window.atlasDesktop.closePanels()`);
  await until(() => main.evaluate(`Boolean(document.querySelector('[data-column-id=right]'))`), 'panels restored');
  console.log('PASS acompanhamento sempre no topo, tema sincronizado, aba e dimensões preservadas');
  await click(main, '[data-column-id=left] .detach-control', 'Ocultar');
  await click(main, '[data-column-id=right] .detach-control', 'Ocultar');
  assert.equal(await main.evaluate(`document.querySelectorAll('[data-column-id]').length`), 1);
  await click(main, '[title="Exibir grid"]');
  await main.evaluate(`window.atlasDesktop.closePty(${JSON.stringify(first.id)})`);
  await until(() => main.evaluate(`[...document.querySelectorAll('.session-state')].some(item => item.textContent.includes('encerrado'))`), 'visible exit status');
  await main.call('Page.reload');
  await until(() => main.evaluate(`document.querySelectorAll('.session-history').length === 1`), 'project history restored once after reload');
  await until(() => main.evaluate(`document.querySelector('.app-shell') && document.querySelectorAll('[data-column-id]').length === 1 && getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#18222b'`), 'layout and custom background persisted after reload');
  await until(() => main.evaluate(`window.atlasDesktop.listProjects().then(items => items.some(item => item.path === ${JSON.stringify(extraProject)}))`), 'authorized project restored');
  // UI sessions are intentionally not persisted yet; PTYs are still closed below by id.
  await main.evaluate(`window.atlasDesktop.closePty(${JSON.stringify(first.id)}); window.atlasDesktop.closePty(${JSON.stringify(second.id)})`);
  await screenshot(main, 'terminals-focused');
  await click(main, '.toolbar-actions button', 'Navegação');
  await click(main, '.toolbar-actions button', 'Painéis');
  await until(() => main.evaluate(`[...document.querySelectorAll('.project-tab')].some(item => item.textContent.startsWith('Projeto adicional'))`), 'project tabs hydrated');
  await main.evaluate(`[...document.querySelectorAll('.project-tab')].find(item => item.textContent.startsWith('Projeto adicional')).click()`);
  await click(main, '.inspector-tabs button', 'Tarefas');
  await until(() => main.evaluate(`document.querySelector('.persistent-tasks')?.innerText.includes('Tarefa real · smoke')`), 'task restored after renderer reload');
  assert((await main.evaluate(`document.querySelector('.persistent-tasks').innerText`)).includes('Preservar após recarregar e reabrir o banco'));
  await screenshot(main, 'task-persisted');
  await main.evaluate(`[...document.querySelectorAll('.inspector-tabs button')].find(item => item.textContent.trim().startsWith('Mensagens')).click()`);
  await until(() => main.evaluate(`document.querySelector('.messages-panel')?.innerText.includes('Descoberta da fixture')`), 'message persisted after renderer reload');
  assert(await main.evaluate(`document.querySelector('.messages-panel')?.innerText.includes('lida em')`), 'read state persisted after renderer reload');
  await main.evaluate(`[...document.querySelectorAll('.inspector-tabs button')].find(item => item.textContent.trim().startsWith('Tarefas')).click()`);
  console.log('PASS ocultar e restaurar as duas colunas');
  await click(main, '.toolbar-actions button', 'Sessão');
  await until(() => main.evaluate(`[...document.querySelectorAll('select[name=cli] option')].some(item => item.textContent.includes('Kimi Code'))`), 'adapters listed in session modal');
  const adapterOption = await main.evaluate(`[...document.querySelectorAll('select[name=cli] option')].map(item => ({ text: item.textContent, value: item.value, disabled: item.disabled }))`);
  fs.writeFileSync(path.join(resultsDir, 'session-modal-adapters.json'), JSON.stringify(adapterOption, null, 2));
  // Só adaptadores detectados no PATH, com versão ou "não encontrado"; nunca os cards de demonstração.
  assert(adapterOption.slice(1).every((item) => /\d+\.\d+\.\d+|não encontrado/.test(item.text)), 'modal desktop não deve listar CLIs fictícios');
  assert.deepEqual(adapterOption.map((item) => item.value), ['', 'kimi-code', 'opencode', 'claude-code', 'codex', 'gemini'], 'placeholder e adaptadores na ordem do ATLAS');
  assert.deepEqual(adapterOption.slice(0, 3).map((item) => item.disabled), [true, false, false], 'placeholder desabilitado, Kimi e OpenCode da fixture disponíveis');
  assert.equal(await main.evaluate(`document.querySelector('.modal select[name=cli]').value`), '', 'nenhum CLI pré-selecionado');
  assert(await main.evaluate(`document.querySelector('.modal button[type=submit]').disabled`), 'criar exige a escolha');
  // Claude Code não lista modelos: campo de texto opcional, validado no formato aceito pelo ATLAS.
  if (adapterOption.find((item) => item.value === 'claude-code')?.disabled === false) {
    const submitDisabled = () => main.evaluate(`document.querySelector('.modal button[type=submit]').disabled`);
    const typeModel = async (value) => {
      await main.evaluate(`(() => { const field = document.querySelector('.modal input[name=model]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await delay(120);
    };
    await choose(main, '.modal', 'cli', 'claude-code');
    await until(() => main.evaluate(`Boolean(document.querySelector('.modal input[name=model][type=text]'))`), 'free model entry for Claude Code');
    assert(!(await submitDisabled()), 'modelo vazio usa a configuração do Claude Code');
    await typeModel('opus & calc');
    assert(await submitDisabled(), 'modelo fora do formato bloqueia a criação');
    assert.equal(await main.evaluate(`document.querySelector('.modal input[name=model]').getAttribute('aria-invalid')`), 'true');
    assert(await main.evaluate(`document.querySelector('#model-entry-help')?.getAttribute('role') === 'alert'`), 'erro do modelo anunciado');
    await typeModel('claude-opus-5-5');
    assert(!(await submitDisabled()), 'modelo digitado válido libera a criação');
    const claudeModelAudit = await main.evaluate(`(${auditInterface.toString()})()`);
    assert.equal(claudeModelAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in Claude Code model entry');
    await screenshot(main, 'session-claude-model');
    console.log('PASS Claude Code: modelo digitado opcional e validado no cartão');
  }
  // Regressão: a lista lenta do OpenCode chega depois da troca para o Kimi e não pode desfazê-la.
  await choose(main, '.modal', 'cli', 'opencode');
  await choose(main, '.modal', 'cli', 'kimi-code');
  await until(() => main.evaluate(`document.querySelector('.modal .agent-choice')?.innerText.includes('Nenhum modelo identificado no Kimi Code')`), 'Kimi sem modelos usa a própria configuração');
  await delay(1800);
  assert.equal(await main.evaluate(`document.querySelector('.modal select[name=cli]').value`), 'kimi-code', 'resposta atrasada não troca o CLI escolhido');
  assert.equal(await main.evaluate(`Boolean(document.querySelector('.modal select[name=model]'))`), false);
  assert.equal(await main.evaluate(`document.querySelector('.modal button[type=submit]').disabled`), false);
  await choose(main, '.modal', 'cli', 'opencode');
  assert(await main.evaluate(`document.querySelector('.modal button[type=submit]').disabled`), 'carregando modelos não vale como escolha');
  await until(() => main.evaluate(`document.querySelectorAll('.modal select[name=model] option').length === 3`), 'modelos do CLI escolhido');
  assert.equal(await main.evaluate(`document.querySelector('.modal select[name=model]').value`), '', 'nenhum modelo pré-selecionado');
  assert(await main.evaluate(`document.querySelector('.modal button[type=submit]').disabled`), 'criar exige o modelo');
  await choose(main, '.modal', 'model', 'fixture/modelo-rapido');
  assert.equal(await main.evaluate(`document.querySelector('.modal button[type=submit]').disabled`), false);
  const choiceAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(choiceAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in agent choice');
  await screenshot(main, 'session-modal');
  await click(main, '.modal button[type=submit]');
  await until(() => main.evaluate(`document.querySelector('.modal [role=alert]')?.innerText.includes('Não foi possível iniciar o OpenCode')`), 'falha honesta ao iniciar o CLI escolhido');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('.modal-backdrop')`), 'session modal closed');
  // Principal: mesma escolha explícita; a falha de início fica no modal, sem sessão fictícia.
  await click(main, '.orchestrator-choice-note button', 'Escolher agente');
  await until(() => main.evaluate(`Boolean(document.querySelector('#orchestrator-choice-title'))`), 'escolha da principal aberta');
  assert.equal(await main.evaluate(`document.querySelector('.modal select[name=cli]').value`), '', 'principal sem CLI pré-selecionado');
  // Chave "Principal só coordena": ligada por padrão; desligada, o aviso explica o que muda.
  const modeSwitch = "document.querySelector('.modal input[name=coordinate-only]')";
  await until(() => main.evaluate(`${modeSwitch} && !${modeSwitch}.disabled`), 'modo da principal carregado');
  assert.deepEqual(await main.evaluate(`[${modeSwitch}.checked, ${modeSwitch}.getAttribute('role'), ${modeSwitch}.getAttribute('aria-describedby')]`), [true, 'switch', 'orchestrator-mode-help'], 'só coordena ligada por padrão');
  await main.evaluate(`${modeSwitch}.click()`);
  await until(() => main.evaluate(`document.querySelector('#orchestrator-mode-help')?.innerText.includes('não passam pela revisão de tarefa')`), 'aviso do modo auto');
  assert(await main.evaluate(`document.querySelector('#orchestrator-mode-help').innerText.includes('.env')`), 'aviso diz que o shell lê o .env');
  const modeAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(modeAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in orchestrator mode warning');
  await screenshot(main, 'orchestrator-mode-auto');
  await main.evaluate(`${modeSwitch}.click()`);
  assert(await main.evaluate(`${modeSwitch}.checked`));
  await choose(main, '.modal', 'cli', 'opencode');
  await until(() => main.evaluate(`document.querySelectorAll('.modal select[name=model] option').length === 3`), 'modelos para a principal');
  await choose(main, '.modal', 'model', 'fixture/modelo-forte');
  await screenshot(main, 'orchestrator-choice');
  await click(main, '.modal button[type=submit]');
  await until(() => main.evaluate(`document.querySelector('.modal [role=alert]')?.innerText.includes('Não foi possível iniciar o OpenCode')`), 'falha honesta ao iniciar a principal');
  assert.equal(await main.evaluate(`[...document.querySelectorAll('.session-card h3')].some(item => item.textContent === 'ORQUESTRADOR')`), false, 'nenhuma principal fictícia');
  await click(main, '.modal button', 'Cancelar');
  await until(() => main.evaluate(`!document.querySelector('.modal-backdrop')`), 'orchestrator choice closed');
  assert.equal((await native('invoke', { channel: 'agent:orchestrator-mode', args: [{ cwd: extraProject }] })).mode, 'coordinate', 'modo escolhido salvo no projeto');
  console.log('PASS escolha explícita de CLI e modelo para sessão e principal, sem padrão e com falha honesta');
  console.log('PASS chave "Principal só coordena": ligada por padrão, aviso do modo auto com contraste e escolha salva no projeto');

  // Gemini: a ponte não entra por run; o mesmo consentimento grava no settings.json da home de fixture.
  const geminiSettings = path.join(geminiHome, '.gemini', 'settings.json');
  fs.mkdirSync(path.dirname(geminiSettings), { recursive: true });
  fs.writeFileSync(geminiSettings, JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }));
  const geminiStatus = "[...document.querySelectorAll('.integration-status')].find((item) => item.innerText.includes('no Gemini'))";
  await until(() => main.evaluate(`${geminiStatus}?.innerText.includes('não conectadas')`), 'gemini integration status after detection');
  await main.evaluate(`${geminiStatus}.querySelector('.link-button').click()`);
  await until(() => main.evaluate("document.querySelector('.integration-modal #integration-title')?.textContent.includes('Gemini')"), 'gemini consent dialog open');
  const geminiConsent = await main.evaluate("(() => { const dialog = document.querySelector('.integration-modal'); return { inDialog: dialog.contains(document.activeElement), path: dialog.querySelector('.integration-path').textContent, entry: dialog.querySelector('.integration-entry').textContent, summary: dialog.querySelector('#integration-summary').textContent }; })()");
  assert(geminiConsent.inDialog, 'focus moves into the Gemini dialog');
  assert.equal(geminiConsent.path, geminiSettings, 'Dialog shows the exact Gemini settings file');
  assert(geminiConsent.entry.includes('$ATLAS_MCP_TOKEN') && geminiConsent.entry.includes('$ATLAS_MCP_ENDPOINT'), 'Entry carries only references to the run token');
  assert(geminiConsent.summary.includes('arquivo de configurações do Gemini'));
  const geminiAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(geminiAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in Gemini consent dialog');
  await screenshot(main, 'integration-consent-gemini');
  await click(main, '.integration-modal .button.primary', 'Conectar');
  await until(() => main.evaluate(`!document.querySelector('.integration-modal') && ${geminiStatus}?.innerText.includes('conectadas') && !${geminiStatus}.innerText.includes('não')`), 'gemini integration installed');
  const geminiInstalled = JSON.parse(fs.readFileSync(geminiSettings, 'utf8'));
  assert.deepEqual(geminiInstalled.security, { auth: { selectedType: 'oauth-personal' } }, 'Other Gemini settings preserved');
  assert.deepEqual(geminiInstalled.mcpServers.atlas.env, { ELECTRON_RUN_AS_NODE: '1', ATLAS_MCP_ENDPOINT: '$ATLAS_MCP_ENDPOINT', ATLAS_MCP_TOKEN: '$ATLAS_MCP_TOKEN' });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(kimiMcp, 'utf8')).mcpServers), ['github'], 'Kimi configuration untouched');
  await main.evaluate(`${geminiStatus}.querySelector('.link-button').click()`);
  await until(() => main.evaluate("Boolean(document.querySelector('.integration-modal .button.danger'))"), 'gemini manage dialog offers removal');
  await click(main, '.integration-modal .button.danger', 'Remover integração');
  await until(() => main.evaluate(`!document.querySelector('.integration-modal') && ${geminiStatus}?.innerText.includes('não conectadas')`), 'gemini integration removed');
  const geminiRemoved = JSON.parse(fs.readFileSync(geminiSettings, 'utf8'));
  assert.equal(geminiRemoved.mcpServers.atlas, undefined, 'Removal deletes the ATLAS entry');
  assert.deepEqual(geminiRemoved.security, { auth: { selectedType: 'oauth-personal' } });
  console.log('PASS consentimento do Gemini: settings.json exato, só referências ao token, conectar e remover preservando o restante');
  // Funções de agente (v0.2): Orquestrador e cinco padrão nascem sem CLI nem modelo;
  // a escolha salva só preenche e volta preenchida ao editar.
  await until(() => main.evaluate(`document.querySelector('.functions-pending')?.textContent === '6 a configurar'`), 'aviso de funções a configurar');
  await click(main, '.workspace-settings', 'Funções de agente6 a configurar');
  await until(() => main.evaluate(`document.querySelectorAll('.functions-modal .function-row').length === 6`), 'Orquestrador e cinco funções padrão');
  assert.deepEqual(await main.evaluate(`[...document.querySelectorAll('.functions-modal .function-row strong')].map(item => item.textContent)`), ['Orquestrador', 'Planejar', 'Explorar', 'Implementar', 'Revisar', 'Testes']);
  assert.equal(await main.evaluate(`[...document.querySelectorAll('.functions-modal .function-row-choice.pending')].length`), 6, 'todas nascem não configuradas');
  await click(main, '.functions-modal .function-row', 'RevisarRevisa um diff ou uma branch em busca de bugs, riscos e desvios do plano.Não configurada');
  await until(() => main.evaluate(`Boolean(document.querySelector('.function-editor'))`), 'editor da função');
  assert.equal(await main.evaluate(`Boolean(document.querySelector('.function-editor input[name=name]'))`), false, 'nome fixo na função padrão');
  assert.equal(await main.evaluate(`[...document.querySelectorAll('.function-editor button')].some(item => item.textContent === 'Apagar função')`), false, 'função padrão não se apaga');
  assert.equal(await main.evaluate(`document.querySelector('.function-editor select[name=cli]').value`), '', 'sem CLI pré-selecionado pelo ATLAS');
  await choose(main, '.function-editor', 'cli', 'opencode');
  await until(() => main.evaluate(`document.querySelectorAll('.function-editor select[name=model] option').length === 3`), 'modelos para a função');
  await choose(main, '.function-editor', 'model', 'fixture/modelo-forte');
  const functionsAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(functionsAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in agent functions');
  await screenshot(main, 'agent-function-editor');
  await click(main, '.function-editor button[type=submit]', 'Salvar');
  await until(() => main.evaluate(`[...document.querySelectorAll('.functions-modal .function-row')].some(item => item.innerText.includes('Revisar') && item.innerText.includes('OpenCode · fixture/modelo-forte'))`), 'função salva com CLI e modelo');
  await until(() => main.evaluate(`document.querySelector('.functions-pending')?.textContent === '5 a configurar'`), 'aviso atualizado');
  // Regressão: a escolha salva volta preenchida ao editar, após a lista do CLI chegar.
  await click(main, '.functions-modal .function-row', 'RevisarRevisa um diff ou uma branch em busca de bugs, riscos e desvios do plano.OpenCode · fixture/modelo-forte');
  await until(() => main.evaluate(`document.querySelector('.function-editor select[name=model]')?.value === 'fixture/modelo-forte'`), 'modelo salvo preenchido');
  await click(main, '.function-editor button', 'Cancelar');
  // Função do usuário: criar sem CLI e apagar com confirmação.
  await click(main, '.functions-modal footer button', 'Nova função');
  await main.evaluate(`(() => { for (const [name, value] of Object.entries({ slug: 'documentar', name: 'Documentar' })) { const field = document.querySelector('.function-editor [name=' + name + ']'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  assert.equal(await main.evaluate(`document.querySelector('.function-editor button[type=submit]').disabled`), false, `criar habilitado: ${await main.evaluate(`JSON.stringify([...document.querySelectorAll('.function-editor input')].map(item => [item.name, item.value]))`)}`);
  await click(main, '.function-editor button[type=submit]', 'Criar função');
  await until(() => main.evaluate(`!document.querySelector('.function-editor') || document.querySelector('.function-editor [role=alert]')?.innerText`), 'criação respondida').then((value) => assert.equal(value, true, `erro ao criar: ${value}`));
  await until(() => main.evaluate(`[...document.querySelectorAll('.functions-modal .function-row strong')].some(item => item.textContent === 'Documentar')`), 'função do usuário criada');
  await click(main, '.functions-modal .function-row', 'DocumentarSem descrição.Não configurada');
  await click(main, '.function-editor button', 'Apagar função');
  await until(() => main.evaluate(`Boolean(document.querySelector('.function-delete-confirm'))`), 'confirmação antes de apagar');
  await click(main, '.function-delete-confirm button', 'Apagar');
  await until(() => main.evaluate(`!document.querySelector('.function-editor') && ![...document.querySelectorAll('.functions-modal .function-row strong')].some(item => item.textContent === 'Documentar')`), 'função do usuário apagada');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('.modal-backdrop')`), 'funções fechadas');
  console.log('PASS funções de agente: padrão sem modelo, escolha salva preenchida, função do usuário criada e apagada');
  // Sessão manual: "Usar função" só preenche com o que foi salvo; sem função, nada vem escolhido.
  await click(main, '.toolbar-actions button', 'Sessão');
  await until(() => main.evaluate(`Boolean(document.querySelector('.modal select[name=function]'))`), 'sessão manual oferece funções');
  assert.equal(await main.evaluate(`document.querySelector('.modal select[name=function]').value`), '', 'nenhuma função pré-selecionada');
  assert.equal(await main.evaluate(`[...document.querySelectorAll('.modal select[name=function] option')].some(item => item.value === 'orquestrador')`), false);
  await choose(main, '.modal', 'function', 'revisar');
  await until(() => main.evaluate(`document.querySelector('.modal select[name=model]')?.value === 'fixture/modelo-forte'`), 'sessão manual preenchida pela função');
  assert.equal(await main.evaluate(`document.querySelector('.modal button[type=submit]').disabled`), false);
  await choose(main, '.modal', 'function', '');
  assert.equal(await main.evaluate(`document.querySelector('.modal select[name=cli]').value`), '', 'sem função volta a ficar sem escolha');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('.modal-backdrop')`), 'sessão manual fechada');
  console.log('PASS sessão manual usa função só para preencher CLI e modelo');
  await until(() => main.evaluate(`!document.querySelector('.modal-backdrop')`), 'session modal closed');
  console.log('PASS modal de sessão lista somente adaptadores detectados');
  // Pedidos de agente semeados pela principal da fixture com o app aberto; o CLI
  // escolhido na aprovação não inicia na fixture e a falha fica honesta e registrada.
  const liveStore = createOperationalStore({ filename: path.join(profile, 'atlas.sqlite') });
  try {
    liveStore.startSession({ id: 'smoke-orchestrator', projectId: extraProjectId, name: 'ORQUESTRADOR-fixture', adapterId: 'fixture', cli: 'Fixture Agent', version: '1.0.0', cwd: fs.realpathSync(extraProject), origin: 'user', createdAt: new Date().toISOString(), role: 'orchestrator' });
    liveStore.requestAgent({ projectId: extraProjectId, requestedBy: 'smoke-orchestrator', name: 'revisor-recusado', purpose: 'Pedido que o usuário vai recusar.', idempotencyKey: 'smoke-request-0001' });
    liveStore.requestAgent({ projectId: extraProjectId, requestedBy: 'smoke-orchestrator', name: 'revisor-sem-cli', purpose: 'Pedido aprovado sem CLI disponível na fixture.\nSegunda linha preservada.', idempotencyKey: 'smoke-request-0002', functionSlug: 'revisar' });
  } finally {
    liveStore.close();
  }
  await native('send', { channel: 'agent-request:changed', payload: { projectId: extraProjectId } });
  await until(() => main.evaluate(`document.querySelectorAll('.agent-request').length === 2`), 'pending agent requests shown');
  const requestCards = await main.evaluate(`[...document.querySelectorAll('.agent-request')].map(item => item.innerText)`);
  assert(requestCards[0].includes('Novo agente: revisor-recusado') && requestCards[0].includes('Pedido de ORQUESTRADOR-fixture'), 'Request names requester and agent');
  assert(requestCards[1].includes('Segunda linha preservada') && requestCards[1].includes('Vale até') && requestCards[1].includes('Política: até 2 agentes'), 'Request shows purpose, validity and policy');
  assert(requestCards.every((text) => text.includes('sem flags de autonomia')), 'Request states how the agent starts');
  // Painel do Atlas: cada pedido pendente espera o usuário e leva ao próprio cartão.
  const panelRequests = await main.evaluate(`[...document.querySelectorAll('.atlas-decision.request strong')].map(item => item.textContent)`);
  assert(panelRequests.includes('Novo agente: revisor-recusado') && panelRequests.length === 2, `Panel lists pending requests: ${panelRequests}`);
  await main.evaluate(`[...document.querySelectorAll('.atlas-decision.request')].find(item => item.innerText.includes('revisor-recusado')).click()`);
  await until(() => main.evaluate(`document.activeElement?.closest('.agent-request')?.innerText.includes('revisor-recusado')`), 'painel leva ao cartão do pedido');
  const requestAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(requestAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in agent requests');
  await screenshot(main, 'agent-requests');
  await main.evaluate(`[...document.querySelectorAll('.agent-request')].find(item => item.innerText.includes('revisor-recusado')).querySelector('button.secondary').click()`);
  await until(() => main.evaluate(`document.querySelectorAll('.agent-request').length === 1`), 'rejected request removed');
  // v0.2: a principal pediu a função Revisar; o cartão vem com o CLI e o modelo salvos nela.
  assert.equal(await main.evaluate(`document.querySelector('.agent-request select[name=function]').value`), 'revisar', 'função sugerida pela principal');
  assert(await main.evaluate(`[...document.querySelectorAll('.agent-request select[name=function] option')].some(item => item.textContent === 'Revisar (escolhida pela principal)')`));
  assert.equal(await main.evaluate(`[...document.querySelectorAll('.agent-request select[name=function] option')].some(item => item.value === 'orquestrador')`), false, 'a função da principal não vale para agentes');
  await until(() => main.evaluate(`document.querySelector('.agent-request select[name=model]')?.value === 'fixture/modelo-forte'`), 'cartão preenchido pela função');
  assert.equal(await main.evaluate(`document.querySelector('.agent-request select[name=cli]').value`), 'opencode');
  assert.equal(await main.evaluate(`document.querySelector('.agent-request button.primary').disabled`), false, 'escolha completa vinda da função');
  assert.equal(await main.evaluate(`document.querySelector('.agent-request').innerText.includes('Alterado em relação')`), false);
  // Sem função, nada vem preenchido; voltar à função preenche de novo.
  await choose(main, '.agent-request', 'function', '');
  assert(await main.evaluate(`document.querySelector('.agent-request button.primary').disabled`), 'sem função, aprovar exige escolher CLI e modelo');
  assert.equal(await main.evaluate(`document.querySelector('.agent-request select[name=cli]').value`), '');
  assert(await main.evaluate(`document.querySelector('.agent-request').innerText.includes('Alterado em relação à função escolhida pela principal')`), 'troca de função sinalizada');
  await choose(main, '.agent-request', 'function', 'revisar');
  await until(() => main.evaluate(`document.querySelector('.agent-request select[name=model]')?.value === 'fixture/modelo-forte'`), 'função preenche de novo');
  // Trocar o modelo da sugestão é permitido e fica sinalizado.
  await choose(main, '.agent-request', 'model', 'fixture/modelo-rapido');
  await until(() => main.evaluate(`document.querySelector('.agent-request').innerText.includes('Alterado em relação ao que está salvo na função')`), 'troca de modelo sinalizada');
  await screenshot(main, 'agent-request-function');
  await main.evaluate(`document.querySelector('.agent-request button.primary').click()`);
  await until(() => main.evaluate(`document.querySelector('.agent-request [role=alert]')?.innerText.includes('Não foi possível iniciar o OpenCode')`), 'honest spawn failure inline');
  const decided = await native('invoke', { channel: 'agent-request:list', args: [{ cwd: extraProject }] });
  assert.deepEqual(decided.items.map((item) => [item.name, item.state]), [['revisor-recusado', 'rejected'], ['revisor-sem-cli', 'failed']]);
  assert.match(decided.items[1].error, /Não foi possível iniciar o OpenCode/);
  assert.equal(decided.items[1].sessionId, null, 'No fictitious session for a failed spawn');
  assert.equal(await main.evaluate(`[...document.querySelectorAll('.session-card h3')].some(item => item.textContent === 'revisor-sem-cli')`), false);
  await click(main, '.agent-request button', 'Dispensar');
  await until(() => main.evaluate(`document.querySelectorAll('.agent-request').length === 0`), 'failed request dismissed');
  assert.equal(await main.evaluate(`document.querySelectorAll('.atlas-decision.request').length`), 0, 'Decided requests leave the panel');
  console.log('PASS pedidos de agente da principal: conteúdo, validade, política, recusa, falha honesta sem CLI e Painel do Atlas');
  // Delegação semeada como a principal e um agente da fixture fariam pela ponte MCP:
  // uma oferta aberta e uma tarefa aceita e bloqueada. O usuário cancela e devolve.
  const delegationStore = createOperationalStore({ filename: path.join(profile, 'atlas.sqlite') });
  try {
    const agentRun = delegationStore.startSession({ id: 'smoke-agente', projectId: extraProjectId, name: 'agente-fixture', adapterId: 'opencode', model: 'fixture/modelo-forte', functionSlug: 'implementar', functionOverridden: false, cli: 'Fixture Agent', version: '1.0.0', cwd: fs.realpathSync(extraProject), origin: 'orchestrator', createdAt: new Date().toISOString() });
    offeredTaskId = delegationStore.createTask({ projectId: extraProjectId, title: 'Delegada aberta', acceptance: 'Oferta visível', idempotencyKey: 'smoke-delegation-task-01' }).id;
    blockedTaskId = delegationStore.createTask({ projectId: extraProjectId, title: 'Delegada bloqueada', acceptance: 'Bloqueio visível', idempotencyKey: 'smoke-delegation-task-02' }).id;
    delegationStore.offerHandoff({ projectId: extraProjectId, fromSessionId: 'smoke-orchestrator', toSessionId: 'smoke-agente', taskId: offeredTaskId, objective: 'Revisar a divergência ANSI.\nSegunda linha do objetivo.', nextSteps: 'Escrever a regressão primeiro.', idempotencyKey: 'smoke-delegation-offer-01' });
    const accepted = delegationStore.offerHandoff({ projectId: extraProjectId, fromSessionId: 'smoke-orchestrator', toSessionId: 'smoke-agente', taskId: blockedTaskId, objective: 'Corrigir o resize.', idempotencyKey: 'smoke-delegation-offer-02' });
    delegationStore.acceptHandoff({ projectId: extraProjectId, handoffId: accepted.id, sessionId: 'smoke-agente', runId: agentRun.id });
    delegationStore.updateTask({ projectId: extraProjectId, taskId: blockedTaskId, sessionId: 'smoke-agente', runId: agentRun.id, kind: 'blocked', note: 'Falta o fixture de terminal.' });
  } finally {
    delegationStore.close();
  }
  await native('send', { channel: 'task:changed', payload: { projectId: extraProjectId } });
  const queueItem = (title) => `[...document.querySelectorAll('.task-queue .queue-item')].find(item => item.innerText.includes(${JSON.stringify(title)}))`;
  await until(() => main.evaluate(`Boolean(${queueItem('Delegada bloqueada')})`), 'delegated tasks listed');
  assert.match(await main.evaluate(`${queueItem('Delegada aberta')}.innerText`), /Pronta/);
  assert.match(await main.evaluate(`${queueItem('Delegada bloqueada')}.innerText`), /Bloqueada · agente-fixture/);
  await main.evaluate(`${queueItem('Delegada aberta')}.click()`);
  await until(() => main.evaluate(`document.querySelector('.task-assignment')?.innerText.includes('Oferecida a agente-fixture')`), 'open offer shown');
  const offerText = await main.evaluate(`document.querySelector('.task-assignment').innerText`);
  assert(offerText.includes('Segunda linha do objetivo.') && offerText.includes('Escrever a regressão primeiro.') && offerText.includes('Aguardando o agente aceitar'), 'Offer shows objective, next steps and pending state');
  // Regressão: avisos do workspace eram espremidos na linha 1fr da grade e se sobrepunham.
  const notices = await main.evaluate(`[...document.querySelectorAll('.workspace-notices > *')].map(item => { const rect = item.getBoundingClientRect(); return { name: item.className, top: rect.top, bottom: rect.bottom, height: rect.height, scroll: item.scrollHeight }; })`);
  assert(notices.length >= 2, `Expected stacked workspace notices, got ${JSON.stringify(notices)}`);
  for (const [index, notice] of notices.entries()) {
    assert(notice.height > 0 && notice.scroll <= notice.height + 1, `Workspace notice clipped: ${JSON.stringify(notice)}`);
    if (index) assert(notice.top >= notices[index - 1].bottom - 1, `Workspace notices overlap: ${JSON.stringify(notices)}`);
  }
  await screenshot(main, 'task-offer');
  await click(main, '.task-assignment button', 'Cancelar oferta');
  await until(() => main.evaluate(`document.querySelector('.task-assignment')?.innerText.includes('Sem execução atribuída')`), 'offer canceled');
  await main.evaluate(`${queueItem('Delegada bloqueada')}.click()`);
  await until(() => main.evaluate(`document.querySelector('.task-assignment')?.innerText.includes('Falta o fixture de terminal.')`), 'blocked task shown');
  assert((await main.evaluate(`document.querySelector('.task-assignment').innerText`)).includes('Responsável: agente-fixture'));
  const delegationAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(delegationAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in task delegation');
  await screenshot(main, 'task-blocked');
  await click(main, '.task-assignment button', 'Devolver tarefa');
  await until(() => main.evaluate(`${queueItem('Delegada bloqueada')}?.innerText.includes('Pronta') && document.querySelector('.task-assignment')?.innerText.includes('Sem execução atribuída')`), 'task released to ready');
  console.log('PASS delegação de tarefa: oferta, responsável, bloqueio, cancelamento e devolução pelo usuário');
  // Pedido com worktree em projeto sem repositório Git: o cartão explica a recusa antes da decisão.
  const worktreeStore = createOperationalStore({ filename: path.join(profile, 'atlas.sqlite') });
  try {
    worktreeStore.requestAgent({ projectId: extraProjectId, requestedBy: 'smoke-orchestrator', name: 'executor-worktree', purpose: 'Executar a tarefa em worktree.', taskId: blockedTaskId, worktree: true, idempotencyKey: 'smoke-worktree-request-01' });
  } finally {
    worktreeStore.close();
  }
  await native('send', { channel: 'agent-request:changed', payload: { projectId: extraProjectId } });
  await until(() => main.evaluate(`document.querySelector('.agent-request')?.innerText.includes('executor-worktree')`), 'worktree request shown');
  const worktreeCard = await main.evaluate(`document.querySelector('.agent-request').innerText`);
  assert(worktreeCard.includes('Tarefa: Delegada bloqueada') && worktreeCard.includes('não tem repositório Git') && worktreeCard.includes('na worktree da tarefa'), `Worktree request explains plan: ${worktreeCard}`);
  // Revisão cruzada: a mesma IA que já trabalhou na tarefa (outra função) gera aviso, sem bloquear.
  assert.equal(await main.evaluate(`document.querySelectorAll('.agent-request-same-ai').length`), 0, 'sem escolha, sem aviso');
  await choose(main, '.agent-request', 'cli', 'opencode');
  await until(() => main.evaluate(`[...document.querySelectorAll('.agent-request select[name=model] option')].some((item) => item.value === 'fixture/modelo-forte')`), 'modelos no cartão');
  await choose(main, '.agent-request', 'model', 'fixture/modelo-forte');
  await until(() => main.evaluate(`document.querySelector('.agent-request-same-ai')?.innerText.includes('Mesma IA que já trabalhou nesta tarefa como Implementar')`), 'aviso de mesma IA');
  assert((await main.evaluate(`document.querySelector('.agent-request-same-ai').innerText`)).includes('OpenCode · fixture/modelo-forte'));
  assert(!(await main.evaluate(`[...document.querySelectorAll('.agent-request button')].find((item) => item.textContent.trim() === 'Aprovar e iniciar').disabled`)), 'o aviso não bloqueia a aprovação');
  const sameAiAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(sameAiAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in same-AI warning');
  await screenshot(main, 'agent-request-same-ai');
  console.log('PASS revisão cruzada: cartão avisa a mesma IA que já trabalhou na tarefa, sem bloquear');
  await click(main, '.agent-request button', 'Recusar');
  await until(() => main.evaluate(`document.querySelectorAll('.agent-request').length === 0`), 'worktree request rejected');
  console.log('PASS pedido com worktree mostra tarefa e recusa honesta sem repositório Git');
  // Suíte de regressão configurada pelo usuário na subbarra do projeto. A sugestão
  // vem do package.json da fixture e só entra no campo pelo botão.
  fs.writeFileSync(path.join(extraProject, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } }));
  const setField = (selector, value) => main.evaluate(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until(() => main.evaluate(`document.querySelector('.regression-status')?.innerText.includes('desligada')`), 'regression suite status in subbar');
  await click(main, '.regression-status button', 'Configurar');
  await until(() => main.evaluate(`Boolean(document.querySelector('.regression-modal [name=command]'))`), 'regression dialog loaded');
  const suiteDialog = await main.evaluate(`(() => { const dialog = document.querySelector('.regression-modal'); return { modal: dialog.getAttribute('aria-modal'), inDialog: dialog.contains(document.activeElement), command: dialog.querySelector('[name=command]').value, save: dialog.querySelector('button[type=submit]').disabled, checked: [...dialog.querySelectorAll('[name=timeout-mode]')].some(item => item.checked), text: dialog.innerText }; })()`);
  assert.equal(suiteDialog.modal, 'true');
  assert(suiteDialog.inDialog, 'Focus moves into the regression dialog');
  assert.equal(suiteDialog.command, '', 'Suggestion is never filled without the user');
  assert(suiteDialog.save && !suiteDialog.checked, 'No default timeout: save waits for a choice');
  assert(suiteDialog.text.includes('com as suas permissões') && suiteDialog.text.includes('Usar sugestão: npm test'), `Dialog warns and offers the suggestion: ${suiteDialog.text}`);
  await click(main, '.regression-help button', 'Usar sugestão: npm test');
  await main.evaluate(`document.querySelector('.regression-modal [name=enabled]').click()`);
  await main.evaluate(`document.querySelector('.regression-modal [name=timeout-mode][value=limit]').click()`);
  await setField('.regression-modal [name=timeout-amount]', '0');
  await until(() => main.evaluate(`document.querySelector('.regression-modal .field-error')?.innerText.includes('1 minuto a 24 horas')`), 'invalid timeout explained');
  assert(await main.evaluate(`document.querySelector('.regression-modal button[type=submit]').disabled`), 'Invalid timeout must not save');
  await setField('.regression-modal [name=timeout-amount]', '10');
  await until(() => main.evaluate(`!document.querySelector('.regression-modal button[type=submit]').disabled`), 'valid suite can be saved');
  const suiteAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(suiteAudit.filter((item) => item.ratio < 4.5).length, 0, `Low contrast in regression dialog: ${JSON.stringify(suiteAudit.filter((item) => item.ratio < 4.5))}`);
  await screenshot(main, 'regression-suite-dialog');
  await main.evaluate(`document.querySelector('.regression-modal form').requestSubmit()`);
  await until(() => main.evaluate(`!document.querySelector('.regression-modal') && document.querySelector('.regression-status')?.innerText.includes('ligada · 10 min')`), 'regression suite saved');
  const savedSuite = await main.evaluate(`window.atlasDesktop.getRegressionSuite({ cwd: ${JSON.stringify(extraProject)} })`);
  assert.deepEqual([savedSuite.suite.enabled, savedSuite.suite.command, savedSuite.suite.timeoutSeconds], [true, 'npm test', 600]);
  console.log('PASS suíte de regressão: diálogo modal, sugestão só por escolha, sem prazo padrão e validação');
  // Revisão semeada como o agente e o host fariam pela ponte MCP; o usuário pede
  // ajustes, recebe nova revisão e conclui. Só a decisão dele leva a done.
  const reviewStore = createOperationalStore({ filename: path.join(profile, 'atlas.sqlite') });
  const reviewRunId = () => reviewStore.listRuns(extraProjectId).find((run) => run.session_id === 'smoke-agente' && run.state === 'running').id;
  const snapshot = { worktreePath: 'C:\\fixture\\wt', expectedBranch: 'atlas/task-smoke001', branch: 'atlas/task-smoke001', baseCommit: 'a1b2c3d4e5', headCommit: 'f6e7d8c9b0', commits: 2, diff: { files: 3, insertions: 41, deletions: 7 }, uncommittedFiles: 1 };
  try {
    const offerForReview = reviewStore.offerHandoff({ projectId: extraProjectId, fromSessionId: 'smoke-orchestrator', toSessionId: 'smoke-agente', taskId: offeredTaskId, objective: 'Concluir com revisão.', idempotencyKey: 'smoke-review-offer-01' });
    reviewStore.acceptHandoff({ projectId: extraProjectId, handoffId: offerForReview.id, sessionId: 'smoke-agente', runId: reviewRunId() });
    const firstReview = reviewStore.requestReview({ projectId: extraProjectId, taskId: offeredTaskId, sessionId: 'smoke-agente', runId: reviewRunId(), summary: 'Regressão escrita e correção aplicada.', commands: [{ command: 'npm test', exitCode: 0 }, { command: 'npm run lint', exitCode: 1 }], git: snapshot });
    // Na fila, sem executor notificado: o usuário vai parar antes de começar.
    reviewStore.enqueueRegressionRun({ projectId: extraProjectId, taskId: offeredTaskId, reviewId: firstReview.id, worktreePath: snapshot.worktreePath });
  } finally {
    reviewStore.close();
  }
  await native('send', { channel: 'task:changed', payload: { projectId: extraProjectId } });
  await until(() => main.evaluate(`${queueItem('Delegada aberta')}?.innerText.includes('Em revisão')`), 'task in review listed');
  await main.evaluate(`${queueItem('Delegada aberta')}.click()`);
  await until(() => main.evaluate(`document.querySelector('.task-assignment')?.innerText.includes('Verificado pelo ATLAS no Git')`), 'review evidence shown');
  const reviewText = await main.evaluate(`document.querySelector('.task-assignment').innerText`);
  assert(reviewText.includes('Declarado pelo agente') && reviewText.includes('npm run lint') && reviewText.includes('exit 1'), 'Agent declaration with exit codes');
  assert(reviewText.includes('2 desde a1b2c3d4 até f6e7d8c9') && reviewText.includes('3 arquivos, +41 −7') && reviewText.includes('1 arquivos fora dos commits'), `System Git snapshot shown: ${reviewText}`);
  const reviewAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(reviewAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in task review');
  await screenshot(main, 'task-review');
  const queuedSuite = await main.evaluate(`document.querySelector('.task-assignment').innerText`);
  assert(queuedSuite.includes('Suíte de regressão (verificada pelo ATLAS)') && queuedSuite.includes('Na fila') && queuedSuite.includes('Suíte: na fila'), `Queued suite shown in review: ${queuedSuite}`);
  await click(main, '.regression-evidence button', 'Parar suíte');
  await until(() => main.evaluate(`document.querySelector('.regression-evidence')?.innerText.includes('Parada por você') && document.querySelector('.review-suite-state')?.innerText === 'Suíte: parada'`), 'queued suite stopped by the user');
  await click(main, '.review-actions button', 'Pedir ajustes');
  await main.evaluate(`(() => { const field = document.querySelector('.review-decision textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Corrigir o lint antes de concluir.'); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click(main, '.review-actions button', 'Enviar pedido de ajustes');
  await until(() => main.evaluate(`${queueItem('Delegada aberta')}?.innerText.includes('Em andamento') && document.querySelector('.task-assignment')?.innerText.includes('Corrigir o lint antes de concluir.')`), 'changes requested back to agent');
  const secondReviewStore = createOperationalStore({ filename: path.join(profile, 'atlas.sqlite') });
  try {
    const runId = secondReviewStore.listRuns(extraProjectId).find((run) => run.session_id === 'smoke-agente' && run.state === 'running').id;
    const secondReview = secondReviewStore.requestReview({ projectId: extraProjectId, taskId: offeredTaskId, sessionId: 'smoke-agente', runId, summary: 'Lint corrigido.', commands: [{ command: 'npm run lint', exitCode: 0 }], git: { unavailable: 'Tarefa sem worktree registrada pelo ATLAS.' } });
    // Resultado final como o executor gravaria: vermelho, com arquivos de teste no diff.
    const suiteRun = secondReviewStore.enqueueRegressionRun({ projectId: extraProjectId, taskId: offeredTaskId, reviewId: secondReview.id, worktreePath: snapshot.worktreePath });
    secondReviewStore.startRegressionRun({ id: suiteRun.id, logPath: path.join(profile, 'regression-logs', 'fixture.log') });
    secondReviewStore.finishRegressionRun({ id: suiteRun.id, state: 'failed', exitCode: 1, logBytes: 2048, logSha256: 'ab'.repeat(32), logTruncated: false, logTail: 'not ok 1 - soma\n  expected 2, got 3', worktreeChanged: false, testFiles: { total: 2, files: ['package.json', 'src/soma.test.js'] } });
  } finally {
    secondReviewStore.close();
  }
  await native('send', { channel: 'task:changed', payload: { projectId: extraProjectId } });
  await until(() => main.evaluate(`document.querySelector('.task-assignment')?.innerText.includes('Lint corrigido.')`), 'second review shown');
  await until(() => main.evaluate(`document.querySelector('.review-suite-state')?.innerText === 'Suíte: falhou (exit 1)'`), 'failed suite next to accept');
  const failedSuite = await main.evaluate(`document.querySelector('.regression-evidence').innerText`);
  assert(failedSuite.includes('Falhou (exit 1)') && failedSuite.includes('2 arquivos ligados aos testes') && failedSuite.includes('src/soma.test.js') && failedSuite.includes('2.0 KB'), `Failed suite details: ${failedSuite}`);
  assert.deepEqual(await main.evaluate(`[...document.querySelectorAll('.regression-evidence button')].map(item => item.textContent)`), ['Mostrar na pasta', 'Abrir log completo']);
  await main.evaluate(`document.querySelector('.regression-log summary').click()`);
  await until(() => main.evaluate(`document.querySelector('.regression-log pre')?.textContent.includes('expected 2, got 3')`), 'log tail loaded on demand');
  const suiteReviewAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(suiteReviewAudit.filter((item) => item.ratio < 4.5).length, 0, `Low contrast in regression evidence: ${JSON.stringify(suiteReviewAudit.filter((item) => item.ratio < 4.5))}`);
  await screenshot(main, 'task-review-regression');
  // Só informa: a suíte vermelha não bloqueia o aceite.
  await click(main, '.review-actions button', 'Aceitar e concluir');
  await until(() => main.evaluate(`${queueItem('Delegada aberta')}?.innerText.includes('Concluída') && document.querySelector('.task-assignment')?.innerText.includes('Concluída por você')`), 'task done after user review');
  await click(main, '.inspector-tabs button', 'Evidências');
  await until(() => main.evaluate(`document.querySelectorAll('.evidence-review').length === 2`), 'real evidence listed');
  assert(!(await main.evaluate(`document.querySelector('.evidence-panel').innerText`)).includes('ilustrativas'), 'Desktop evidence is real, not illustrative');
  await screenshot(main, 'task-evidence');
  await click(main, '.inspector-tabs button', 'Tarefas');
  console.log('PASS revisão de tarefa: declaração do agente, retrato Git do sistema, ajustes e conclusão só pelo usuário');
  console.log('PASS suíte na revisão: parar na fila, falha com exit, aviso de arquivos de teste, log sob demanda e aceite livre');
  // "Abrir no ATLAS" por uma segunda instância real, como o Explorador faria.
  const openWith = async (target) => {
    const second = spawn(electron, [path.join(root, 'scripts/smoke-app.cjs'), `--atlas-open=${target}`], { cwd: fixture, env: { ...env, ATLAS_SMOKE_SECOND_INSTANCE: '1' }, stdio: 'ignore', windowsHide: true });
    await new Promise((resolve) => second.on('exit', resolve));
  };
  const activeTab = () => main.evaluate(`document.querySelector('.project-tab.active')?.textContent || ''`);
  await main.evaluate(`[...document.querySelectorAll('.project-tab')].find(item => !item.textContent.startsWith('Projeto adicional') && !item.textContent.startsWith('Início'))?.click()`);
  await until(async () => !(await activeTab()).startsWith('Projeto adicional'), 'other project selected before opening');
  const nested = path.join(extraProject, 'sub pasta ação & cia');
  fs.mkdirSync(nested, { recursive: true });
  await openWith(nested);
  await until(async () => (await activeTab()).startsWith('Projeto adicional'), 'subfolder opens the containing project');
  assert.equal(await main.evaluate(`document.querySelectorAll('.integration-modal').length`), 0, 'Known project opens without confirmation');
  const fresh = path.join(openFixture, 'Novo projeto ação & cia (1)');
  fs.mkdirSync(fresh);
  await openWith(fresh);
  await until(() => main.evaluate(`document.querySelector('.integration-modal')?.innerText.includes('Cadastrar Novo projeto ação & cia (1) como projeto?')`), 'confirmation for new folder');
  const openText = await main.evaluate(`document.querySelector('.integration-modal').innerText`);
  assert(openText.includes(fs.realpathSync.native(fresh)) && openText.includes('não executa git init'), `Open modal explains scope and Git: ${openText}`);
  const openAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(openAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in open folder modal');
  await screenshot(main, 'open-folder');
  await click(main, '.integration-modal button', 'Cadastrar e abrir');
  await until(async () => (await activeTab()).startsWith('Novo projeto ação & cia (1)'), 'new folder registered and opened');
  await openWith(path.join(openFixture, 'não existe'));
  await until(() => main.evaluate(`document.body.innerText.includes('Não foi possível abrir a pasta recebida')`), 'invalid path reported');
  // Regressão: um segundo pedido substitui o modal e descarta o primeiro, sem cadastrar nenhum.
  const firstPending = path.join(openFixture, 'Pendente A');
  const secondPending = path.join(openFixture, 'Pendente B');
  fs.mkdirSync(firstPending);
  fs.mkdirSync(secondPending);
  await openWith(firstPending);
  await until(() => main.evaluate(`document.querySelector('.integration-modal')?.innerText.includes('Cadastrar Pendente A')`), 'first pending modal');
  await openWith(secondPending);
  await until(() => main.evaluate(`document.querySelector('.integration-modal')?.innerText.includes('Cadastrar Pendente B')`), 'second request replaces modal');
  await click(main, '.integration-modal button', 'Cancelar');
  await until(() => main.evaluate(`!document.querySelector('.integration-modal')`), 'modal closed after cancel');
  assert.equal(await main.evaluate(`[...document.querySelectorAll('.project-tab')].some(item => item.textContent.startsWith('Pendente'))`), false, 'No pending folder registered');
  console.log('PASS Abrir no ATLAS: segunda instância, subpasta abre o projeto, pasta nova com confirmação, substituição de pedido e caminho inválido');
  await click(main, '.title-actions button', 'Aparência');
  await until(() => main.evaluate(`document.querySelector('.explorer-integration')?.innerText.includes('Não adicionada')`), 'explorer integration status');
  await click(main, '.explorer-integration button', 'Adicionar ao Explorador');
  assert((await main.evaluate(`document.querySelector('.explorer-integration').innerText`)).includes(`${explorerRoot}\\Directory\\shell\\ATLAS.Open`), 'Consent shows exact registry keys');
  assert.throws(() => execFileSync('reg.exe', ['query', explorerRoot], { stdio: 'ignore', windowsHide: true }), undefined, 'Nothing written before confirmation');
  await click(main, '.explorer-integration button', 'Confirmar e adicionar');
  await until(() => main.evaluate(`document.querySelector('.explorer-integration')?.innerText.includes('Ativa no menu de pastas')`), 'explorer entry installed');
  assert(execFileSync('reg.exe', ['query', `${explorerRoot}\\Directory\\Background\\shell\\ATLAS.Open\\command`, '/ve'], { encoding: 'utf8', windowsHide: true }).includes('"--atlas-open=%V"'));
  await screenshot(main, 'explorer-integration');
  await click(main, '.explorer-integration button', 'Remover do Explorador');
  await click(main, '.explorer-integration button', 'Confirmar e remover');
  await until(() => main.evaluate(`document.querySelector('.explorer-integration')?.innerText.includes('Não adicionada')`), 'explorer entry removed');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await main.evaluate(`document.querySelector('.appearance-modal')?.closest('.modal-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  console.log('PASS entrada do Explorador adicionada e removida por consentimento em chave de fixture');
  await click(main, '.title-actions button', 'Aparência');
  await click(main, '.background-presets button', 'Névoa');
  assert.equal(await main.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`), '#eef1f4');
  const modalAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  fs.writeFileSync(path.join(resultsDir, 'audit-light-modal.json'), JSON.stringify(modalAudit, null, 2));
  await screenshot(main, 'appearance-light');
  await click(main, '.appearance-content footer button', 'Concluir');
  const lightAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  fs.writeFileSync(path.join(resultsDir, 'audit-light-cockpit.json'), JSON.stringify(lightAudit, null, 2));
  await screenshot(main, 'cockpit-light');
  await click(main, '.title-actions button', 'Aparência');
  const keyboardFocusInModal = await main.evaluate(`document.querySelector('[role=dialog]').contains(document.activeElement)`);
  await main.evaluate(`document.querySelector('.appearance-content footer button').focus()`);
  await key(main, 'Tab', { code: 'Tab', windowsVirtualKeyCode: 9 });
  const keyboardFocusTrapped = await main.evaluate(`document.querySelector('[role=dialog]').contains(document.activeElement)`);
  await click(main, '.background-presets button', 'Grafite');
  await click(main, '.appearance-content footer button', 'Concluir');
  await native('resize', { width: 1440, height: 900 });
  await screenshot(main, 'cockpit-dark');
  const darkAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  fs.writeFileSync(path.join(resultsDir, 'audit-dark-cockpit.json'), JSON.stringify(darkAudit, null, 2));
  await native('resize', { width: 940, height: 700 });
  await delay(250);
  const canHideNavigationAtMinimumWidth = await main.evaluate(`document.querySelector('[data-column-id=left] .detach-control').getBoundingClientRect().width > 0`);
  const canCreateAndReopenAtMinimumWidth = await main.evaluate(`[...document.querySelectorAll('.toolbar-actions button')].filter(item => item.textContent === 'Terminal').every(item => item.getBoundingClientRect().width > 0)`);
  await screenshot(main, 'cockpit-compact');
  await native('resize', { width: 1440, height: 900 });
  await click(main, '[title="Exibir grid"]');
  await until(async () => (await main.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(first.id)}).then(item => item.exit)`)) && (await main.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(second.id)}).then(item => item.exit)`)), 'PTY exits');
  console.log('PASS aparência clara/escura, fundo personalizado, persistência e saída dos PTYs');
  assert(keyboardFocusInModal && keyboardFocusTrapped, 'Modal must receive focus and keep Tab inside it');
  assert(canHideNavigationAtMinimumWidth, 'Navigation must be collapsible at minimum window width');
  assert(canCreateAndReopenAtMinimumWidth, 'Terminal controls must remain available at minimum window width');
  assert.equal([...modalAudit, ...lightAudit, ...darkAudit].filter((item) => item.ratio < 4.5).length, 0, 'Low contrast text: inspect audit JSON files');
} catch (error) {
  fs.writeFileSync(path.join(resultsDir, 'result.json'), JSON.stringify({ passed: false, fixture, error: error.message, checkedAt: new Date().toISOString() }, null, 2));
  for (const connection of connections.filter((item) => item.ws.readyState === WebSocket.OPEN)) {
    await screenshot(connection, 'failure').catch(() => {});
    console.error(await connection.evaluate(`({ visibility: document.visibilityState, selected: document.querySelector('.worktree-item.active')?.title, select: document.querySelector('select[name=cwd]')?.value, options: [...document.querySelectorAll('select[name=cwd] option')].map(item => item.value), focused: document.activeElement?.outerHTML?.slice(0, 100), terminalText: [...document.querySelectorAll('.real-terminal')].map(item => item.innerText.slice(-1800)) })`).catch(() => null));
  }
  const created = await native('terminals').catch(() => []);
  for (const terminal of created) console.error(await connections[0]?.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(terminal.id)}).then(item => ({ ...item, scrollback: item.scrollback.slice(-1200) }))`).catch(() => null));
  console.error(stderr);
  throw error;
} finally {
  connections.forEach((item) => item.ws.close());
  await native('quit').catch(() => child.kill());
  child.stdin.end();
  try { execFileSync('reg.exe', ['delete', explorerRoot, '/f'], { stdio: 'ignore', windowsHide: true }); } catch { /* chave de fixture já ausente */ }
}
await until(() => pids.every((pid) => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }), 'child PowerShell processes stopped');
let exitTimer;
await Promise.race([childExit, new Promise((_, reject) => { exitTimer = setTimeout(() => reject(new Error('Electron test process did not exit')), 15000); })]).finally(() => clearTimeout(exitTimer));
assert(!stderr.includes('AttachConsole failed'), 'Closing an exited PTY must not kill the same console again');
const persisted = new DatabaseSync(path.join(profile, 'atlas.sqlite'), { readOnly: true });
try {
  assert.equal(persisted.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  const paths = persisted.prepare('SELECT path FROM projects').all().map((item) => item.path);
  assert(paths.includes(fs.realpathSync(fixture)), 'Initial project must persist in SQLite');
  assert(paths.includes(fs.realpathSync(extraProject)), 'Authorized project must persist in SQLite');
  assert.equal(persisted.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(persisted.prepare('SELECT state FROM agent_runs WHERE session_id = ?').get('history-fixture').state, 'lost');
  const persistedTask = persisted.prepare('SELECT title, acceptance, state FROM tasks WHERE id = ?').get(createdTaskId);
  assert.equal(persistedTask.title, 'Tarefa real · smoke');
  assert.equal(persistedTask.acceptance, 'Preservar após recarregar e reabrir o banco');
  assert.equal(persistedTask.state, 'backlog');
  const persistedMessage = persisted.prepare('SELECT subject FROM messages').get();
  assert.equal(persistedMessage.subject, 'Descoberta da fixture');
  assert(persisted.prepare('SELECT read_at FROM message_deliveries').get().read_at, 'Message read state must persist in SQLite');
  const delegated = persisted.prepare('SELECT id, state, assigned_session_id, claim_epoch FROM tasks WHERE id IN (?, ?) ORDER BY title').all(offeredTaskId, blockedTaskId);
  assert.deepEqual(delegated.map((item) => [item.state, item.assigned_session_id, item.claim_epoch]), [['done', 'smoke-agente', 1], ['ready', null, 2]]);
  assert.deepEqual(persisted.prepare('SELECT state, resolved_by FROM handoffs ORDER BY created_at, rowid').all().map((item) => [item.state, item.resolved_by]), [['canceled', 'user'], ['accepted', 'agent:smoke-agente'], ['accepted', 'agent:smoke-agente']]);
  assert.deepEqual(persisted.prepare('SELECT state FROM reviews ORDER BY created_at, rowid').all().map((item) => item.state), ['changes_requested', 'accepted']);
  assert.deepEqual(persisted.prepare("SELECT kind, count(*) AS total FROM evidence WHERE source = 'system' GROUP BY kind ORDER BY kind").all().map((item) => [item.kind, item.total]), [['git_snapshot', 2], ['regression_run', 2]]);
  assert.deepEqual(persisted.prepare('SELECT state, exit_code AS exitCode FROM regression_runs ORDER BY created_at, rowid').all().map((item) => [item.state, item.exitCode]), [['cancelled', null], ['failed', 1]]);
  assert.deepEqual({ ...persisted.prepare('SELECT enabled, command, timeout_seconds AS timeoutSeconds FROM regression_suites').get() }, { enabled: 1, command: 'npm test', timeoutSeconds: 600 });
} finally {
  persisted.close();
}
console.log('PASS projetos persistidos pelo processo principal em SQLite íntegro');
// Only remove this run's freshly created directory, after verifying its exact parent.
const fixtureReal = fs.realpathSync(fixture);
const tempReal = fs.realpathSync(os.tmpdir());
assert.equal(path.dirname(fixtureReal).toLowerCase(), tempReal.toLowerCase());
assert(path.basename(fixtureReal).startsWith('atlas-smoke-'));
await fs.promises.rm(fixtureReal, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
const openFixtureReal = fs.realpathSync(openFixture);
assert.equal(path.dirname(openFixtureReal).toLowerCase(), tempReal.toLowerCase());
assert(path.basename(openFixtureReal).startsWith('atlas-smoke-open-'));
await fs.promises.rm(openFixtureReal, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
fs.writeFileSync(path.join(resultsDir, 'result.json'), JSON.stringify({ passed: true, pids, fixtureRemoved: true, checkedAt: new Date().toISOString() }, null, 2));
console.log('PASS limpeza dos processos PowerShell e da fixture temporária');
