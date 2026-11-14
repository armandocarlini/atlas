import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { auditGlyphs, auditInterface, focusIndicator } from './audit-interface.mjs';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = path.join(root, '.atlas-smoke-results');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-smoke-'));
const repository = path.join(fixture, 'Repositório Validação');
const worktree = path.join(fixture, 'Worktree Revisão');
const profile = path.join(fixture, 'profile');
const extraProject = path.join(fixture, 'Projeto adicional');
const quietProject = path.join(fixture, 'Projeto sem novidades');
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
fs.mkdirSync(quietProject);
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
// Continuidade: sessão aberta quando o app foi fechado. Ela volta sozinha na abertura;
// na fixture o CLI não existe, e a falha tem que ser honesta e não repetir.
seed.startSession({ id: 'restore-fixture', projectId, name: 'retomar-fixture', adapterId: 'claude-code', cli: 'Claude Code', version: '1.0.0', cwd: fs.realpathSync(fixture), origin: 'user', createdAt: new Date(Date.now() - 70000).toISOString() });
seed.markAppClosed();
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
const env = { ...process.env, ATLAS_EXPLORER_ROOT: explorerRoot, ATLAS_SMOKE_PROFILE: profile, ATLAS_SMOKE_PROJECT: extraProject, ATLAS_SMOKE_QUIET_PROJECT: quietProject, ATLAS_SMOKE_NODE: process.execPath, ATLAS_SMOKE_CONTROL_PORT: String(controlPort), ATLAS_SMOKE_TOKEN: controlToken, ATLAS_SMOKE_NO_CLI: '1', KIMI_CODE_HOME: kimiHome, GEMINI_CLI_HOME: geminiHome };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
// Codex can inject its bundled PowerShell modules; exercise Windows' own modules.
for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
const launchApp = () => spawn(electron, [path.join(root, 'scripts/smoke-app.cjs'), `--remote-debugging-port=${port}`], { cwd: fixture, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const child = launchApp();
const childExit = new Promise((resolve) => child.once('exit', resolve));
const connections = [];
const pids = [];
let createdTaskId = null;
let offeredTaskId = null;
let blockedTaskId = null;
let terminalBeforeRestart;
let restoreClipboard = false;
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
async function chooseTerminalLayout(cdp, value) {
  // Na barra compacta (coluna de Terminais estreita), o layout fica no menu ⋯.
  await until(() => cdp.evaluate(`Boolean(document.querySelector('[aria-label="Layout dos terminais"], .toolbar-overflow-trigger'))`), 'controle de layout');
  if (await cdp.evaluate(`!document.querySelector('[aria-label="Layout dos terminais"]')`)) {
    await cdp.evaluate(`document.querySelector('.toolbar-overflow-trigger').click()`);
    await until(() => cdp.evaluate(`Boolean(document.querySelector('[aria-label="Layout dos terminais"]'))`), 'layout no menu ⋯');
  }
  assert(await cdp.evaluate(`(() => { const select = document.querySelector('[aria-label="Layout dos terminais"]'); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)}); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === ${JSON.stringify(value)}; })()`), `Missing terminal layout ${value}`);
  await delay(200);
}
async function ensureStatus(cdp) {
  await cdp.evaluate(`document.querySelector('.workspace-status-trigger[aria-expanded=false]')?.click()`);
  await until(() => cdp.evaluate(`Boolean(document.querySelector('#workspace-status'))`), 'project status open');
}
async function ensurePanels(cdp) {
  await cdp.evaluate(`(() => { const button = document.querySelector('.workspace-panel-toggle[data-panel=right]'); if (button?.getAttribute('aria-expanded') === 'false') button.click(); })()`);
  await until(() => cdp.evaluate(`Boolean(document.querySelector('[data-column-id=right]'))`), 'right panels open');
}
async function sessionAction(cdp, cardExpression, action) {
  assert(await cdp.evaluate(`(() => { const trigger = (${cardExpression})?.querySelector('.session-menu-trigger'); if (!trigger) return false; trigger.click(); return true; })()`), `Missing session actions for ${action}`);
  assert(await cdp.evaluate(`(() => { const button = (${cardExpression})?.querySelector('[data-action=${action}]'); if (!button) return false; button.click(); return true; })()`), `Missing session action ${action}`);
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
// Barra única nas janelas secundárias: controles do sistema sobre a barra do ATLAS, sem cobrir ações.
async function assertOverlayBar(cdp, selector, label) {
  if (process.platform !== 'win32') return;
  const bar = await until(() => cdp.evaluate(`(() => {
    const overlay = navigator.windowControlsOverlay;
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!overlay?.visible || !element) return null;
    const area = overlay.getTitlebarAreaRect();
    const rect = element.getBoundingClientRect();
    const region = (node) => getComputedStyle(node).getPropertyValue('-webkit-app-region');
    const controls = [...element.querySelectorAll('button, select')].filter((node) => node.getBoundingClientRect().width > 0);
    return { classed: document.documentElement.classList.contains('window-overlay'), top: rect.top, height: rect.height, areaHeight: area.height, areaRight: area.x + area.width, controlsRight: Math.max(0, ...controls.map((node) => node.getBoundingClientRect().right)), region: region(element), controlRegions: controls.map(region) };
  })()`), `barra única em ${label}`);
  assert.equal(bar.classed, true, `${label}: janela marcada com overlay`);
  assert.equal(bar.top, 0, `${label}: a barra do ATLAS é a primeira e única`);
  assert.equal(bar.height, 32, `${label}: barra de 32px`);
  assert.equal(bar.areaHeight, 31, `${label}: controles 1px abaixo da barra`);
  assert(bar.controlsRight <= bar.areaRight, `${label}: ações sob os controles da janela: ${JSON.stringify(bar)}`);
  assert.equal(bar.region, 'drag', `${label}: a barra arrasta a janela`);
  assert(bar.controlRegions.length > 0 && bar.controlRegions.every((region) => region === 'no-drag'), `${label}: botões continuam clicáveis`);
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
  const briefingCounter = '.briefing-counter';
  const briefingVisible = "Boolean(document.querySelector('.briefing:not([hidden])'))";
  const escape = () => key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  const openBriefing = async () => {
    await main.evaluate(`document.querySelector('${briefingCounter}').click()`);
    await until(() => main.evaluate(briefingVisible), 'contador abre o Briefing');
  };
  const closeBriefing = async () => {
    await native('focus');
    await until(() => main.evaluate('document.hasFocus()'), 'janela principal recebe o foco');
    await escape();
    await until(() => main.evaluate(`!${briefingVisible}`), 'Escape volta aos terminais');
  };
  const captureBriefing = async (name) => {
    await until(() => main.evaluate(`!document.querySelector('.toast')`), 'aviso temporário fechado antes da captura');
    await screenshot(main, name);
  };
  await until(() => main.evaluate(`Boolean(document.querySelector('[data-project-id="${projectId}"].briefing-card'))`), 'Briefing abre com cartão do projeto autorizado');
  await closeBriefing();
  await openBriefing();
  await closeBriefing();
  const newSession = '.toolbar-actions [aria-label="Nova sessão de agente"]';
  const newTerminal = '.toolbar-actions [aria-label="Abrir terminal PowerShell"]';
  const appearance = '.title-actions [aria-label="Aparência e configurações"]';
  const hideNavigation = '[data-column-id=left] .detach-control[aria-label="Ocultar navegação"]';
  const hidePanels = '[data-column-id=right] .detach-control[aria-label="Ocultar painéis"]';
  const popOutPanels = '[data-column-id=right] [aria-label="Destacar painéis em pop-up"]';
  if (process.platform === 'win32') {
    // Barra única: a barra nativa sai e os controles da janela ficam sobre a barra do ATLAS,
    // sem cobrir as ações dela; os botões continuam clicáveis dentro da área de arraste.
    const chrome = await until(() => main.evaluate(`(() => {
      const overlay = navigator.windowControlsOverlay;
      if (!overlay?.visible) return null;
      const area = overlay.getTitlebarAreaRect();
      const bar = document.querySelector('.titlebar');
      const buttons = [...bar.querySelectorAll('.title-actions button')];
      const style = (element) => getComputedStyle(element).getPropertyValue('-webkit-app-region') || getComputedStyle(element).webkitAppRegion;
      return { classed: document.documentElement.classList.contains('window-overlay'), areaRight: area.x + area.width, areaHeight: area.height, top: bar.getBoundingClientRect().top, height: bar.getBoundingClientRect().height, actionsRight: Math.max(...buttons.map(item => item.getBoundingClientRect().right)), barRegion: style(bar), buttonRegions: buttons.map(style) };
    })()`), 'controles da janela sobre a barra do ATLAS');
    assert.equal(chrome.classed, true, 'janela principal marcada com overlay');
    assert.equal(chrome.top, 0, 'a barra do ATLAS é a primeira e única barra');
    assert.equal(chrome.height, 36);
    assert.equal(chrome.areaHeight, 35, 'controles 1px abaixo da barra para o filete continuar visível');
    assert(chrome.actionsRight <= chrome.areaRight, `ações da barra sob os controles da janela: ${JSON.stringify(chrome)}`);
    assert.equal(chrome.barRegion, 'drag', 'a barra arrasta a janela');
    assert(chrome.buttonRegions.every((region) => region === 'no-drag'), 'botões da barra continuam clicáveis');
    const brand = await main.evaluate(`(() => {
      const mark = document.querySelector('.brand .atlas-statue-mark');
      const word = document.querySelector('.brand .atlas-wordmark');
      return { border: getComputedStyle(mark).borderLeftWidth, name: word?.getAttribute('aria-label'), width: word?.getBoundingClientRect().width };
    })()`);
    assert.equal(brand.border, '0px', 'a estátua não tem filete à esquerda');
    assert(brand.name === 'ATLAS' && brand.width > 0, 'o lettering vetorial é visível e tem nome acessível');
    assert.equal(await main.evaluate(`window.atlasDesktop.setTitleBarOverlay({ color: 'red', symbolColor: '#ffffff' })`), false, 'cor inválida recusada');
    console.log('PASS barra única: controles da janela sobre a barra do ATLAS');
  }
  // Seleções no material do ATLAS: base-select mantém o <select> nativo e abre pelo teclado.
  assert.equal(await main.evaluate(`getComputedStyle(document.querySelector('.terminal-layout-select')).appearance`), 'base-select', 'select usa base-select');
  await native('focus');
  const layoutBefore = await main.evaluate(`document.querySelector('.terminal-layout-select').value`);
  assert(await main.evaluate(`(() => { const select = document.querySelector('.terminal-layout-select'); select.focus(); return document.activeElement === select; })()`), 'layout recebe foco depois de sair do Briefing');
  await key(main, ' ', { code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
  await until(() => main.evaluate(`document.querySelector('.terminal-layout-select').matches(':open')`), 'lista do layout aberta pelo teclado');
  await delay(250);
  await screenshot(main, 'select-picker');
  const picker = await main.evaluate(`(() => { const option = document.querySelector('.terminal-layout-select option:checked'); const style = getComputedStyle(option); const mark = getComputedStyle(option, '::checkmark'); return { weight: style.fontWeight, radius: style.borderRadius, height: option.getBoundingClientRect().height, mark: mark.backgroundColor }; })()`);
  assert.equal(picker.weight, '600', 'opção escolhida em peso maior');
  assert(picker.height >= 30, `opção com alvo de 30px: ${picker.height}`);
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('.terminal-layout-select').matches(':open') && document.activeElement === document.querySelector('.terminal-layout-select')`), 'Escape fecha a lista e devolve o foco');
  assert.equal(await main.evaluate(`document.querySelector('.terminal-layout-select').value`), layoutBefore, 'Escape não troca o layout');
  console.log('PASS seleções com lista do ATLAS, teclado e Escape');
  // Abertura: histórico sem processo não reabre como terminal; o projeto sem sessões vivas
  // mostra a escolha de função, e o histórico continua na árvore.
  await until(() => main.evaluate(`Boolean(document.querySelector('.start-launcher')) && Boolean(document.getElementById('tree-session-history-fixture'))`), 'tela inicial com escolha de função');
  // A sessão aberta no último fechamento foi retomada sozinha; sem o CLI na fixture, falha honesta.
  const restoreStatus = await until(async () => { const status = await main.evaluate(`window.atlasDesktop.getRestoreStatus()`); return status?.pending === false && status.result ? status : null; }, 'retomada da sessão aberta no último fechamento');
  assert.deepEqual(restoreStatus.result.restored, []);
  assert.deepEqual(restoreStatus.result.failed.map((item) => item.name), ['retomar-fixture']);
  assert.match(restoreStatus.result.failed[0].error, /Claude Code/);
  const restoredRun = await native('invoke', { channel: 'agent:list' });
  assert.equal(restoredRun.find((item) => item.id === 'restore-fixture')?.archived, true, 'falhou: continua no histórico, sem PTY');
  console.log('PASS sessão aberta no último fechamento é retomada sozinha, com falha honesta sem o CLI');
  assert.equal(await main.evaluate(`document.querySelectorAll('.session-card').length`), 0, 'histórico não abre como card na abertura');
  assert.equal(await main.evaluate(`document.querySelectorAll('.session-history').length`), 0, 'nenhum "resultado incerto" na abertura');
  assert.equal(await main.evaluate(`document.querySelector('.titlebar-context small').textContent`), 'Nenhuma sessão aberta');
  assert.equal(await main.evaluate(`document.querySelectorAll('.origin-badge.demo').length`), 0, 'Desktop must not show illustrative agent cards');
  // Sem CLI padrão: a principal só inicia depois de o usuário escolher CLI e modelo.
  await until(() => main.evaluate(`document.querySelector('.start-choice.principal')?.innerText.includes('ainda não iniciada')`), 'principal aguarda a escolha do agente');
  assert.equal(await main.evaluate(`Boolean(document.querySelector('.orchestrator-choice-note'))`), false, 'aviso da principal não duplica a tela inicial');
  await until(() => main.evaluate(`document.querySelectorAll('.start-choice:not(.principal)').length === 5`), 'cinco funções padrão na tela inicial');
  assert.deepEqual(await main.evaluate(`[...document.querySelectorAll('.start-choice:not(.principal) strong')].map(item => item.textContent)`), ['Planejar', 'Explorar', 'Implementar', 'Revisar', 'Testes']);
  await screenshot(main, 'start-launcher');
  const launcherAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(launcherAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in start launcher');
  // Cada função só abre o diálogo com ela escolhida; nada inicia sem confirmação.
  await click(main, '.start-choice[data-function=planejar]');
  await until(() => main.evaluate(`document.querySelector('.modal select[name=function]')?.value === 'planejar'`), 'diálogo aberto com a função escolhida');
  assert.equal(await main.evaluate(`document.querySelector('.modal select[name=cli]')?.value ?? ''`), '', 'função não configurada não escolhe CLI');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('.modal-backdrop')`), 'diálogo da função fechado');
  await click(main, newSession);
  await until(() => main.evaluate(`document.querySelector('.modal select[name=function]')?.value === ''`), 'botão Sessão não herda a função anterior');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('.modal-backdrop')`), 'diálogo de sessão fechado');
  await click(main, '.start-launcher-secondary button', 'Terminal');
  await until(() => main.evaluate(`document.querySelector('#new-session-title')?.textContent === 'Abrir terminal'`), 'terminal pela tela inicial');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('.modal-backdrop')`), 'diálogo do terminal fechado');
  assert.equal((await native('terminals')).length, 0, 'tela inicial não inicia processo');
  console.log('PASS abertura sem histórico como terminal: escolha de função, principal e terminal sob confirmação');
  // O histórico abre pela árvore, só para leitura.
  await main.evaluate(`document.getElementById('tree-session-history-fixture').click()`);
  await until(() => main.evaluate(`Boolean(document.querySelector('.session-history'))`), 'histórico aberto pela árvore');
  // Ícone da sessão: CLI desconhecido não ganha marca inventada; histórico tem selo de encerrada.
  assert.deepEqual(await main.evaluate(`(() => { const glyph = document.querySelector('[data-session-id=history-fixture] .session-header .session-glyph'); return [glyph?.dataset.cli, glyph?.classList.contains('tone-ended'), glyph?.innerText.trim()]; })()`), ['agent', true, 'Agente, encerrada']);
  // Fila "Precisam de mim": acima de Projetos, fora da rolagem da árvore, com os itens vindos do
  // processo principal. Na abertura só o projeto da fixture está autorizado: a run dele da queda
  // simulada entra como run_failed, e as do Projeto adicional (ainda não autorizado) não entram.
  // Iniciar a principal aparece como ação do cartão, fora das pendências.
  await openBriefing();
  await until(() => main.evaluate(`document.querySelectorAll('.attention-item[data-kind=run_failed]').length === 1`), 'run da queda simulada na fila');
  const attentionMoreFor = (text) => `[...document.querySelectorAll('.attention-item')].find(item => item.innerText.includes(${JSON.stringify(text)}))?.querySelector('.attention-more')`;
  const attentionSnapshot = () => main.evaluate(`(() => {
    const section = document.querySelector('.briefing-counter');
    const heading = document.querySelector('.workspace-tree > .workspace-tree-heading');
    return {
      title: section.querySelector('span').textContent,
      label: section.getAttribute('aria-label'),
      above: section.getBoundingClientRect().bottom <= heading.getBoundingClientRect().top + 1,
      outsideScroll: !section.closest('.workspace-tree-scroll'),
      items: [...document.querySelectorAll('.briefing .attention-item')].map(item => ({ kind: item.dataset.kind, project: item.querySelector('.attention-project').textContent, title: item.querySelector('strong').textContent, name: item.querySelector('.attention-open').getAttribute('aria-label'), menu: Boolean(item.querySelector('.attention-more')) })),
      counters: Object.fromEntries([...document.querySelectorAll('.workspace-tree .tree-project-name')].map(item => [item.querySelector('span').textContent, item.querySelector('.tree-attention [aria-hidden]')?.textContent || '0'])),
      oldSection: Boolean(document.querySelector('.tree-decisions')),
    };
  })()`);
  {
    const fixtureName = path.basename(fixture);
    const queue = await attentionSnapshot();
    assert.equal(queue.title, 'Precisam de mim');
    assert.match(queue.label, /1 item precisa de você/, 'contagem anunciada com contexto');
    assert(queue.above, 'fila acima do cabeçalho Projetos');
    assert(queue.outsideScroll, 'fila fora da rolagem da árvore');
    assert.equal(queue.oldSection, false, '"Espera você" saiu de dentro do projeto');
    assert.deepEqual(queue.items.map((item) => [item.kind, item.project]), [['run_failed', fixtureName]]);
    assert(!queue.items.some((item) => item.project === 'Projeto adicional'), 'projeto fora das pastas autorizadas não entra na fila');
    assert(queue.items.every((item) => item.name.startsWith(`${item.project} · ${item.title}`)), `nome acessível completo: ${JSON.stringify(queue.items)}`);
    assert.equal(queue.counters[fixtureName], '1', 'contador do projeto vem da fila global');
    const queueAudit = await main.evaluate(`(${auditInterface.toString()})()`);
    assert.equal(queueAudit.filter((item) => item.ratio < 4.5).length, 0, `Low contrast in attention queue: ${JSON.stringify(queueAudit.filter((item) => item.ratio < 4.5))}`);
    await captureBriefing('briefing-pendencias');
    // Menu por teclado: o foco entra no primeiro item; End vai a Dispensar; Escape devolve o foco.
    await main.evaluate(`(() => { const button = ${attentionMoreFor('histórico-fixture')}; button.focus(); button.click(); })()`);
    await until(() => main.evaluate(`document.activeElement?.getAttribute('role') === 'menuitem' && document.activeElement.textContent === 'Adiar 1 hora'`), 'menu abre com foco no primeiro item');
    assert.deepEqual(await main.evaluate(`[...document.querySelectorAll('.attention-menu [role=menuitem]')].map(item => item.textContent)`), ['Adiar 1 hora', 'Adiar 4 horas', 'Adiar até amanhã', 'Dispensar']);
    await key(main, 'End', { code: 'End', windowsVirtualKeyCode: 35 });
    assert.equal(await main.evaluate(`document.activeElement.textContent`), 'Dispensar');
    await key(main, 'ArrowDown', { code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    assert.equal(await main.evaluate(`document.activeElement.textContent`), 'Adiar 1 hora', 'setas circulam');
    await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(() => main.evaluate(`!document.querySelector('.attention-menu') && document.activeElement === ${attentionMoreFor('histórico-fixture')}`), 'Escape fecha o menu e devolve o foco');
    assert(await main.evaluate(briefingVisible), 'Escape no menu mantém o Briefing aberto');
    await key(main, 'F1', { code: 'F1', windowsVirtualKeyCode: 112 });
    await until(() => main.evaluate(`Boolean(document.activeElement?.closest('.command-palette'))`), 'paleta aberta com foco');
    await escape();
    await until(() => main.evaluate(`!document.querySelector('.command-palette')`), 'Escape fecha a paleta');
    assert(await main.evaluate(briefingVisible), 'Escape no diálogo mantém o Briefing aberto');
    // Dispensar pelo teclado: grava no host e o item sai; o contador do projeto acompanha.
    await main.evaluate(`${attentionMoreFor('histórico-fixture')}.click()`);
    await until(() => main.evaluate(`Boolean(document.querySelector('.attention-menu'))`), 'menu reaberto');
    await key(main, 'End', { code: 'End', windowsVirtualKeyCode: 35 });
    await main.evaluate(`document.activeElement.click()`);
    await until(() => main.evaluate(`![...document.querySelectorAll('.attention-item')].some(item => item.innerText.includes('histórico-fixture'))`), 'item dispensado sai da fila');
    await until(async () => (await attentionSnapshot()).counters[fixtureName] === '0', 'contador do projeto acompanha a fila');
    assert.deepEqual((await native('invoke', { channel: 'attention:list' })).hidden, { snoozed: 0, dismissed: 1 }, 'dispensar gravado no host');
    console.log('PASS fila Precisam de mim: acima de Projetos, só projetos autorizados, contador, menu por teclado e dispensar');
  }
  await closeBriefing();
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
  await sessionAction(main, `document.querySelector('.session-history').closest('.session-card')`, 'focus');
  await screenshot(main, 'session-history');
  const historyAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(historyAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in restored history');
  await sessionAction(main, `document.querySelector('.session-history').closest('.session-card')`, 'focus');
  console.log('PASS histórico restaurado como lost, sem PTY, composer ou métricas fictícias');
  await native('focus');
  await click(main, '[aria-label="Autorizar pasta de projeto"]');
  await until(() => main.evaluate(`window.atlasDesktop.listAgents().then(items => items.length === 4)`), 'history loaded after project authorization without reload');
  console.log('PASS autorizar projeto restaura histórico adicional sem recarregar a UI');
  await until(() => main.evaluate(`document.querySelectorAll('.tree-worktree').length >= 2`), 'Git discovery UI');
  await until(() => main.evaluate(`!document.querySelector('[aria-label="Atualizar estado Git"]').disabled`), 'project loading finished');
  await main.evaluate(`[...document.querySelectorAll('.tree-project-name')].find(item => item.textContent.startsWith('Projeto adicional')).click()`);
  await until(() => native('defaults-resolved'), 'delayed defaults resolved');
  await delay(150);
  assert(await main.evaluate(`document.querySelector('.tree-project-name[aria-current=page]').textContent.startsWith('Projeto adicional')`), 'Initial hydration overwrote the selected project');
  assert(await main.evaluate(`document.querySelector('.tree-project-name[aria-current=page]').closest('.tree-project-row').querySelector('.tree-expander').getAttribute('aria-expanded') === 'true'`), 'Selecting a project must reveal its repositories and sessions');
  assert(await main.evaluate(`document.querySelector('.workspace-path span').textContent === ${JSON.stringify(extraProject)}`), 'Initial hydration overwrote the selected directory');
  console.log('PASS seleção do projeto preservada durante inicialização tardia');
  // Projeto autorizado agora: as runs dele da queda simulada entram na fila sem recarregar a UI,
  // ao lado dos itens do outro projeto; adiar tira o item e fica registrado no host.
  {
    const fixtureName = path.basename(fixture);
    await openBriefing();
    await until(async () => (await attentionSnapshot()).items.filter((item) => item.kind === 'run_failed' && item.project === 'Projeto adicional').length === 2, 'runs do projeto recém-autorizado na fila');
    const queue = await attentionSnapshot();
    assert.equal(queue.items.some((item) => item.kind === 'principal_start'), false, 'iniciar a principal fica fora da fila');
    assert.equal(queue.counters['Projeto adicional'], '2', 'contador do projeto ativo');
    assert.equal(queue.counters[fixtureName], '0', 'contador do outro projeto vem da mesma fila');
    await main.evaluate(`${attentionMoreFor('histórico-extra')}.click()`);
    await until(() => main.evaluate(`document.activeElement?.textContent === 'Adiar 1 hora'`), 'menu de adiar');
    await main.evaluate(`document.activeElement.click()`);
    await until(() => main.evaluate(`![...document.querySelectorAll('.attention-item')].some(item => item.innerText.includes('histórico-extra'))`), 'item adiado sai da fila');
    assert.deepEqual((await native('invoke', { channel: 'attention:list' })).hidden, { snoozed: 1, dismissed: 1 }, 'adiar gravado no host');
    console.log('PASS fila com os dois projetos depois de autorizar, contadores por projeto e adiar');
  }
  await closeBriefing();
  assert.equal(await main.evaluate(`document.querySelectorAll('.session-card').length`), 0, 'histórico do projeto adicional não abre sozinho');
  {
    await native('choose-quiet-project');
    await click(main, '[aria-label="Autorizar pasta de projeto"]');
    await openBriefing();
    await until(() => main.evaluate(`document.querySelector('.briefing-quiet')?.innerText.includes('Projeto sem novidades')`), 'projeto sem novidades em uma linha');
    await captureBriefing('briefing-sem-novidades');
    const worker = await native('invoke', { channel: 'agent:create', args: [{ cwd: fixture, adapterId: 'gemini', name: 'Revisor da fixture', functionSlug: 'revisar' }] });
    const waitForPty = (terminalId) => until(async () => {
      const { scrollback } = await native('invoke', { channel: 'terminal:attach', args: [terminalId] });
      return scrollback.includes('Briefing fixture pronta');
    }, 'processo de teste habilitou colagem protegida');
    await waitForPty(worker.ptyId);
    await native('send', { channel: 'attention:changed', payload: { projectId } });
    const card = `document.querySelector('.briefing-card[data-project-id="${projectId}"]')`;
    const receiver = `${card}.querySelector('select')`;
    const composer = `${card}.querySelector('textarea')`;
    await until(() => main.evaluate(`Boolean(${receiver})`), 'compositor para agente sem principal');
    assert.equal(await main.evaluate(`${receiver}.value`), '');
    const typeText = (text) => main.evaluate(`(() => {
      const input = ${composer};
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await typeText('Validação do Briefing');
    const enter = () => key(main, 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13 });
    await enter();
    assert.equal(await main.evaluate(`${composer}.value`), 'Validação do Briefing');
    assert(await main.evaluate(`${card}.querySelector('button[type=submit]').disabled`));
    assert(!await main.evaluate(`${card}.querySelector('.briefing-terminal')`));
    await captureBriefing('briefing-sem-principal');
    const principal = await native('invoke', { channel: 'agent:open-orchestrator', args: [{ cwd: fixture, adapterId: 'gemini', startNewRun: true }] });
    await waitForPty(principal.ptyId);
    await native('send', { channel: 'attention:changed', payload: { projectId } });
    await until(() => main.evaluate(`[...${receiver}.options].some(option => option.value === ${JSON.stringify(principal.id)})`), 'principal disponível');
    assert.equal(await main.evaluate(`${receiver}.value`), '', 'principal nova não altera o destino de um rascunho');
    await closeBriefing();
    await openBriefing();
    assert.equal(await main.evaluate(`${composer}.value`), 'Validação do Briefing', 'rascunho preservado ao voltar');
    await main.call('Page.reload');
    await until(() => main.evaluate(briefingVisible), 'Briefing com principal após recarregar');
    await until(() => main.evaluate(`[...document.querySelectorAll('.tree-project-name')].some(item => item.textContent.startsWith('Projeto adicional'))`), 'árvore hidratada após recarregar');
    await until(() => main.evaluate(`${receiver}.value === ${JSON.stringify(principal.id)}`), 'principal é destino inicial');
    await native('focus');
    await until(() => main.evaluate('document.hasFocus()'), 'janela principal recebe foco após recarregar');
    await main.evaluate(`${card}.focus()`);
    await until(() => main.evaluate(`${card}.querySelector('.briefing-terminal')?.dataset.terminalId === ${JSON.stringify(principal.ptyId)}`), 'cartão focado mostra o PTY da principal');
    const chooseReceiver = (id) => main.evaluate(`(() => {
      const select = ${receiver};
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(id)});
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await chooseReceiver(worker.id);
    await until(() => main.evaluate(`${card}.querySelector('.briefing-terminal')?.dataset.terminalId === ${JSON.stringify(worker.ptyId)}`), 'trocar destino troca o PTY');
    await typeText('Validação do Briefing');
    await main.evaluate(`${composer}.focus()`);
    await enter();
    await until(async () => {
      const { scrollback } = await native('invoke', { channel: 'terminal:attach', args: [worker.ptyId] });
      return scrollback.includes('Recebido pela fixture: Validação do Briefing');
    }, 'Enter depois da colagem chegou ao PTY de destino');
    await until(() => main.evaluate(`${composer}.value === '' && ${card}.querySelector('.briefing-receipt').textContent.includes('Enviado a Revisor da fixture')`), 'compositor limpo e envio anunciado');
    assert(!(await native('invoke', { channel: 'terminal:attach', args: [principal.ptyId] })).scrollback.includes('Validação do Briefing'));
    await native('resize', { width: 940, height: 700 });
    await until(() => main.evaluate(`getComputedStyle(${card}.querySelector('.briefing-card-body')).flexDirection === 'column'`), 'terminal passa para baixo em janela estreita');
    await main.evaluate(`${card}.scrollIntoView({ block: 'start' })`);
    await captureBriefing('briefing-janela-estreita');
    await native('resize', { width: 1440, height: 900 });
    const terminalInput = `${card}.querySelector('.briefing-terminal .xterm-helper-textarea')`;
    const focusBriefingTerminal = async () => {
      await native('focus');
      await until(() => main.evaluate(`(() => {
        if (!${terminalInput}) ${card}.focus();
        const input = ${terminalInput};
        input?.focus();
        return input && document.hasFocus() && document.activeElement === input;
      })()`), 'foco no terminal do Briefing');
    };
    await focusBriefingTerminal();
    await escape();
    assert(await main.evaluate(briefingVisible), 'Escape no terminal mantém o Briefing aberto');
    await until(async () => {
      const { scrollback } = await native('invoke', { channel: 'terminal:attach', args: [worker.ptyId] });
      return scrollback.includes('Esc recebido pela fixture');
    }, 'Escape recebido pelo processo no PTY selecionado');
    await key(main, 'Tab', { code: 'Tab', windowsVirtualKeyCode: 9 });
    await until(() => main.evaluate(`document.activeElement !== ${terminalInput}`), 'Tab sai do terminal');
    assert(await main.evaluate(briefingVisible), 'Tab mantém o Briefing aberto');
    await focusBriefingTerminal();
    await key(main, 'B', { code: 'KeyB', windowsVirtualKeyCode: 66, modifiers: 10 });
    await until(() => main.evaluate(`!${briefingVisible}`), 'Ctrl+Shift+B fecha com foco no terminal');
    await openBriefing();
    await main.evaluate(`${composer}.focus()`);
    assert(await main.evaluate(`document.activeElement === ${composer}`), 'foco na caixa de texto');
    await closeBriefing();
    await openBriefing();
    const receiptText = `${card}.querySelector('.briefing-receipt')?.textContent || ''`;
    assert.match(await main.evaluate(receiptText), /Enviado a Revisor da fixture/);
    await chooseReceiver(principal.id);
    assert.equal(await main.evaluate(receiptText), '', 'trocar destinatário limpa a confirmação');
    await chooseReceiver(worker.id);
    assert.equal(await main.evaluate(receiptText), '', 'voltar ao destinatário anterior não restaura a confirmação');
    await typeText('Segunda mensagem da fixture');
    await enter();
    await until(() => main.evaluate(`(${receiptText}).includes('Enviado a Revisor da fixture')`), 'segunda confirmação exibida');
    const orphanStore = createOperationalStore({ filename: path.join(profile, 'atlas.sqlite') });
    let orphanTask;
    try {
      orphanTask = orphanStore.createTask({ projectId, title: 'Tarefa interrompida da fixture', acceptance: 'Exibir a perda do claim', idempotencyKey: 'briefing-orphan-task' });
      const handoff = orphanStore.offerHandoff({ projectId, taskId: orphanTask.id, fromSessionId: principal.id, toSessionId: worker.id, objective: 'Validar a perda do claim.', idempotencyKey: 'briefing-orphan-offer' });
      orphanStore.acceptHandoff({ projectId, handoffId: handoff.id, sessionId: worker.id, runId: worker.runId });
    } finally {
      orphanStore.close();
    }
    const stopFixtureAgent = async (session) => {
      await native('invoke', { channel: 'terminal:stop', args: [session.ptyId] });
      await until(async () => {
        const view = await native('invoke', { channel: 'briefing:get' });
        return !view.briefing.find((entry) => entry.projectId === projectId).agora.sessoes.some(({ id }) => id === session.id);
      }, 'sessão encerrada saiu do Briefing');
    };
    await stopFixtureAgent(worker);
    await until(() => main.evaluate(`![...${receiver}.options].some(option => option.value === ${JSON.stringify(worker.id)})`), 'destinatário encerrado saiu do seletor');
    assert.equal(await main.evaluate(receiptText), '', 'encerrar destinatário limpa a confirmação');
    const orphan = `${card}.querySelector('[data-kind=task_orphaned]')`;
    await until(() => main.evaluate(`${orphan}?.innerText.includes('Tarefa sem responsável: Tarefa interrompida da fixture')`), 'cartão mantém a tarefa sem responsável');
    assert.match(await main.evaluate(`${orphan}.innerText`), /Revisor da fixture \(Revisar, Gemini\) foi encerrada por você.*continua em andamento, sem responsável/);
    await main.evaluate(`[...${orphan}.querySelectorAll('button')].find(button => button.textContent === 'Retomar sessão').click()`);
    await until(() => main.evaluate(`document.querySelector('#new-session-title')?.textContent === 'Retomar sessão'`), 'retomada pede confirmação');
    await until(() => main.evaluate(`document.querySelector('.modal select[name=cli] option:checked')?.value === 'gemini' && !document.querySelector('.modal button[type=submit]').disabled`), 'CLI original detectado e confirmação pronta');
    await escape();
    await until(() => main.evaluate(`!document.querySelector('.modal-backdrop') && ${briefingVisible}`), 'cancelar retomada preserva o Briefing');
    await main.evaluate(`[...${orphan}.querySelectorAll('button')].find(button => button.textContent === 'Já resolvi').click()`);
    await until(() => main.evaluate(`!${orphan}`), 'Já resolvi dispensa o item');
    assert.equal((await native('invoke', { channel: 'task:list', args: [{ cwd: fixture }] })).items.find((task) => task.id === orphanTask.id).state, 'in_progress', 'dispensar preserva a tarefa');
    await stopFixtureAgent(principal);
    const otherItems = (await native('invoke', { channel: 'attention:list' })).items;
    assert(otherItems.every((item) => item.projectId !== projectId), 'encerramento pelo usuário fica fora da fila do host');
    for (const { id } of otherItems) {
      await native('invoke', { channel: 'attention:snooze', args: [{ itemId: id, until: new Date(Date.now() + 15000).toISOString() }] });
    }
    await until(() => main.evaluate(`(() => {
      const currentProject = document.querySelector('.tree-project-name[aria-current=page]');
      return currentProject?.textContent.includes(${JSON.stringify(path.basename(fixture))})
        && ${card}.innerText.includes('Principal encerrada')
        && document.querySelector('.briefing-counter b').textContent === '0';
    })()`), 'principal encerrada pelo usuário e contador global zero');
    assert.equal(await main.evaluate(`${card}.querySelector('.briefing-state').dataset.needsUser`), 'false');
    assert.equal(await main.evaluate(`Boolean(${card}.querySelector('.attention-items'))`), false);
    assert(await main.evaluate(`[...${card}.querySelectorAll('button')].some(button => button.textContent === 'Iniciar a principal')`));
    assert.equal((await attentionSnapshot()).counters[path.basename(fixture)], '0', 'projeto sem pendência na árvore');
    await closeBriefing();
    for (const session of [worker, principal]) {
      await native('invoke', { channel: 'agent:remove', args: [session.id] });
    }
    // Os handlers foram chamados pela fixture, fora do fluxo de remoção do renderer.
    // Recarregue para que as sessões descartadas não interfiram nos testes dos terminais.
    await main.call('Page.reload');
    await until(() => main.evaluate(briefingVisible), 'Briefing depois de remover os PTYs da fixture');
    await closeBriefing();
    await until(() => main.evaluate(`[...document.querySelectorAll('.tree-project-name')].some(item => item.textContent.startsWith('Projeto adicional'))`), 'projetos carregados sem os PTYs descartados');
    assert(!(await native('invoke', { channel: 'agent:list' })).some((session) => session.id === worker.id || session.id === principal.id));
    console.log('PASS Briefing: abertura, Escape, contador, principal encerrada, limpeza da confirmação, PTY real com fixture e janela estreita');
  }
  await main.evaluate(`[...document.querySelectorAll('.tree-project-name')].find(item => item.textContent.startsWith('Projeto adicional')).click()`);
  await until(() => main.evaluate(`Boolean(document.getElementById('tree-session-reauthorized-fixture'))`), 'árvore do projeto adicional expandida');
  await main.evaluate(`document.getElementById('tree-session-reauthorized-fixture').click()`);
  await until(() => main.evaluate(`Boolean(document.querySelector('[data-session-id=reauthorized-fixture]'))`), 'histórico do projeto adicional aberto pela árvore');
  // Histórico de um CLI com marca publicada: a árvore mostra o ícone oficial, com selo de encerrada.
  assert.deepEqual(await main.evaluate(`(() => { const glyph = document.querySelector('#tree-session-reauthorized-fixture-2 .session-glyph'); return [glyph?.dataset.cli, Boolean(glyph?.querySelector('svg path[d]')), glyph?.classList.contains('tone-ended')]; })()`), ['kimi-code', true, true]);
  await chooseTerminalLayout(main, 'spotlight');
  assert.equal(await main.evaluate(`document.querySelectorAll('.session-card').length`), 1, 'Focus must select a session in the current project');
  assert((await main.evaluate(`document.querySelector('.session-history').innerText`)).includes(extraProject));
  await chooseTerminalLayout(main, 'grid');
  // Selecionar uma sessão em outro projeto deve navegar até ela.
  await main.evaluate(`document.getElementById('tree-session-history-fixture').click()`);
  await until(() => main.evaluate(`Boolean(document.querySelector('[data-session-id=history-fixture]')) && !document.querySelector('.tree-project-name[aria-current=page]').textContent.startsWith('Projeto adicional')`), 'tree session changes active project');
  await main.evaluate(`document.getElementById('tree-session-reauthorized-fixture').click()`);
  await until(() => main.evaluate(`document.querySelector('.tree-project-name[aria-current=page]').textContent.startsWith('Projeto adicional')`), 'tree session returns to project');
  await ensurePanels(main);
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
  await main.evaluate(`[...document.querySelectorAll('.msg-card')].find(item => item.innerText.includes('Descoberta da fixture')).querySelector('.msg-mark').click()`);
  await until(() => main.evaluate(`document.querySelector('.messages-panel')?.innerText.includes('0 não lidas')`), 'message marked read');
  const readMessages = await native('invoke', { channel: 'message:list', args: [{ cwd: extraProject }] });
  assert.equal(readMessages.items.length, 1);
  assert(readMessages.items[0].readAt, 'Read state persisted by the main process');
  await main.evaluate(`[...document.querySelectorAll('.inspector-tabs button')].find(item => item.textContent.trim().startsWith('Tarefas')).click()`);
  console.log('PASS mensagem real listada com rota, badge de não lida e leitura persistida');
  const integrationFile = () => JSON.parse(fs.readFileSync(kimiMcp, 'utf8'));
  await ensureStatus(main);
  await until(() => main.evaluate(`document.querySelector('.integration-status')?.innerText.includes('não conectadas')`), 'integration status in project status');
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
  assert(await main.evaluate(`Boolean(document.querySelector('#workspace-status'))`), 'Escape in consent preserves the underlying status panel');
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
  const target = `.tree-worktree[data-worktree-path=${JSON.stringify(worktree)}]`;
  // Na Navegação estreita, branch e alterações saem da linha e ficam no title.
  const worktreeTitle = await main.evaluate(`document.querySelector(${JSON.stringify(target)})?.title`);
  assert(worktreeTitle.includes('feature/revisao') && worktreeTitle.includes('3 alterações') && worktreeTitle.includes(worktree), `title completo da worktree: ${worktreeTitle}`);
  await click(main, target);
  await until(() => main.evaluate(`document.querySelector('.persistent-tasks')?.innerText.includes('Tarefa interrompida da fixture')`), 'task scope follows the worktree project');
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
    await click(main, newTerminal);
    await until(() => main.evaluate(`document.querySelector('select[name=cwd]').value === ${JSON.stringify(worktree)}`), 'selected worktree in terminal dialog');
    await main.evaluate(`(() => { const field = document.querySelector('input[name=name]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(field, ${JSON.stringify(name)}); field.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.modal form').requestSubmit(); })()`);
    await until(() => main.evaluate(`[...document.querySelectorAll('.session-card')].some(item => item.querySelector('h3')?.textContent === ${JSON.stringify(name)})`), name);
    return (await native('terminals')).at(-1);
  }
  const first = await createTerminal('smoke-um');
  const second = await createTerminal('smoke-dois');
  const card = (name) => `[...document.querySelectorAll('.session-card')].find(item => item.querySelector('h3')?.textContent === ${JSON.stringify(name)})`;
  const focus = async (name) => { await sessionAction(main, card(name), 'focus'); await delay(120); };
  const input = '.real-terminal .xterm-helper-textarea';
  const raw = async (id) => main.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(id)}).then(item => item.scrollback)`);
  const output = async (marker, id = first.id) => until(async () => (await raw(id)).includes(marker), marker);
  // Espera a saída do terminal parar: uma linha nova rolaria a tela entre medir e arrastar.
  const quiet = async (name, id) => {
    let last = null;
    await until(async () => {
      const current = await raw(id);
      const stable = current === last;
      last = current;
      if (!stable) await delay(250);
      return stable;
    }, `saída de ${name} parada`);
    await main.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
  };
  // Arrasta o mouse de verdade (CDP) do começo de uma linha até o fim de outra.
  const dragSelect = async (name, fromText, toText, id = name === 'smoke-um' ? first.id : second.id, allowPartialRow = false) => {
    await quiet(name, id);
    const points = await main.evaluate(`(() => {
      const rows = [...${card(name)}.querySelectorAll('.xterm-rows > div')];
      const textRect = (text) => {
        const row = rows.findLast((item) => ${allowPartialRow} ? item.textContent.includes(text) : item.textContent.trim() === text);
        if (!row) return null;
        const range = document.createRange();
        if (${allowPartialRow}) {
          const boundary = (offset) => {
            const nodes = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = nodes.nextNode())) {
              if (offset <= node.length) return [node, offset];
              offset -= node.length;
            }
            throw new Error('Texto fora da linha do terminal');
          };
          const start = row.textContent.indexOf(text);
          range.setStart(...boundary(start));
          range.setEnd(...boundary(start + text.length));
        } else {
          range.selectNodeContents(row);
        }
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
        return { left: rects[0].left, right: rects.at(-1).right, middle: rects[0].top + rects[0].height / 2 };
      };
      const from = textRect(${JSON.stringify(fromText)});
      const to = textRect(${JSON.stringify(toText)});
      return from && to ? { from: { x: from.left + 1, y: from.middle }, to: { x: to.right - 2, y: to.middle } } : null;
    })()`);
    assert(points, `linhas para selecionar em ${name}: ${fromText} → ${toText}`);
    await main.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.from.x, y: points.from.y });
    await main.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: points.from.x, y: points.from.y, button: 'left', buttons: 1, clickCount: 1 });
    await main.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (points.from.x + points.to.x) / 2, y: (points.from.y + points.to.y) / 2, button: 'left', buttons: 1 });
    await delay(16);
    await main.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.to.x, y: points.to.y, button: 'left', buttons: 1 });
    await delay(16);
    await main.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: points.to.x, y: points.to.y, button: 'left', buttons: 0, clickCount: 1 });
    return points;
  };
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
  await chooseTerminalLayout(main, 'grid');
  await focus('smoke-dois');
  await command(main, input, `Write-Output ('ATLAS_' + 'SECOND_OK'); Write-Output ('PID:' + $PID)`);
  await output('ATLAS_SECOND_OK', second.id);
  const secondPid = Number((await raw(second.id)).match(/PID:(\d+)/)?.[1]);
  pids.push(secondPid);
  assert(secondPid > 0 && secondPid !== firstPid);
  assert(!(await raw(first.id)).includes('ATLAS_SECOND_OK'));
  assert(!(await raw(second.id)).includes('ATLAS_UNICODE_OK'));
  // Terminal sem agente: ícone de terminal com selo de ativa, no cabeçalho e na árvore.
  const terminalGlyph = await main.evaluate(`(() => { const glyph = ${card('smoke-dois')}.querySelector('.session-header .session-glyph'); const badge = getComputedStyle(glyph.querySelector('.session-glyph-badge')); return { cli: glyph.dataset.cli, active: glyph.classList.contains('tone-active'), svg: getComputedStyle(glyph.querySelector('svg')).display, badge: badge.backgroundColor, success: getComputedStyle(document.documentElement).getPropertyValue('--success').trim(), tree: document.querySelector('.tree-session[data-state="ativa"] .session-glyph')?.dataset.cli }; })()`);
  assert.equal(terminalGlyph.cli, 'terminal');
  assert.equal(terminalGlyph.active, true);
  assert.notEqual(terminalGlyph.svg, 'none', 'ícone visível');
  assert.equal(terminalGlyph.tree, 'terminal', 'árvore usa o mesmo ícone');
  console.log('PASS dois terminais com processos e streams independentes');

  // Copiar e colar (docs/ROADMAP.md, T0): um eco em smoke-dois liga a colagem protegida e
  // imprime em hexadecimal os bytes que recebe; assim cada caminho é conferido byte a byte.
  // Usa o clipboard real do Windows. O smoke restaura os formatos originais no finally.
  if (process.platform === 'win32') {
    await native('save-clipboard');
    restoreClipboard = true;
    const clipDir = path.join(fixture, 'clipboard');
    fs.mkdirSync(clipDir, { recursive: true });
    const echoScript = path.join(clipDir, 'echo-input.cjs');
    const fileA = path.join(clipDir, 'um arquivo.txt');
    const fileB = path.join(clipDir, 'dois.txt');
    fs.writeFileSync(fileA, 'a');
    fs.writeFileSync(fileB, 'b');
    fs.writeFileSync(echoScript, `process.stdout.write('\\x1b[?2004hECHO_' + 'READY\\r\\n');
process.stdin.setRawMode(true);
process.stdin.on('data', (data) => {
  process.stdout.write('HEX:' + data.toString('hex') + ':END\\r\\n');
  if (data.includes(3)) { process.stdout.write('\\x1b[?2004lECHO_' + 'DONE\\r\\n'); process.exit(0); }
  // A marca volta ao fim da tela: sempre há uma linha "ECHO_READY" visível para selecionar.
  process.stdout.write('ECHO_' + 'READY\\r\\n');
});
`);
    const hex = (text) => Buffer.from(text, 'utf8').toString('hex');
    const bracketed = (text) => `HEX:${hex(`\x1b[200~${text}\x1b[201~`)}:END`;
    const setClipboard = (script) => execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { stdio: 'ignore' });
    const received = async () => [...(await raw(second.id)).matchAll(/HEX:[0-9a-f]*:END/g)].map((match) => match[0]);
    // Junta o que o eco recebeu desde a marca: o ConPTY pode entregar uma colagem em mais de uma leitura.
    const receivedSince = async (count) => (await received()).slice(count).map((item) => item.slice(4, -4)).join('');
    const expectBytes = async (count, text, label) => until(async () => (await receivedSince(count)) === hex(text), label);
    const terminalOf = (name) => `${card(name)}.querySelector('.terminal-view-shell')`;
    const noticeOf = (name) => main.evaluate(`${terminalOf(name)}.querySelector('.terminal-notice')?.textContent || ''`);
    const focusInput = (name) => main.evaluate(`${card(name)}.querySelector('.xterm-helper-textarea').focus()`);
    // Captura só depois da entrada do elemento flutuante (opacidade final, sem animação em curso).
    // A saída do aviso espera no atraso dela: animação que ainda não começou não conta.
    const settled = (expression, label) => until(() => main.evaluate(`(() => {
      const element = ${expression};
      if (!element) return false;
      const started = (animation) => animation.currentTime >= (animation.effect?.getTiming().delay || 0);
      return element.getAnimations().every((animation) => animation.playState === 'finished' || !started(animation)) && getComputedStyle(element).opacity === '1';
    })()`), label);
    const clipboardText = async () => (await native('invoke', { channel: 'clipboard:read-paste' })).text.replace(/\r\n/g, '\n');

    await chooseTerminalLayout(main, 'grid');
    await until(() => main.evaluate(`Boolean(${card('smoke-um')} && ${card('smoke-dois')})`), 'grade com os dois terminais');
    await native('focus');
    await focusInput('smoke-dois');
    for (const char of `node '${echoScript}'`) await key(main, char, { text: char });
    await key(main, 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await output('ECHO_READY', second.id);
    // O ATLAS acompanha o modo de colagem protegida que o programa ligou.
    await until(() => main.evaluate(`window.atlasDesktop.getTerminalInputMode(${JSON.stringify(second.id)}).then((mode) => mode?.bracketedPaste === true)`), 'colagem protegida detectada no PTY');

    // 1. Copiar ao selecionar: log de duas linhas em smoke-um, aviso discreto e anunciado.
    await focusInput('smoke-um');
    await command(main, input, `Write-Output ('COPIA_' + 'L1'); Write-Output ('COPIA_' + 'L2')`);
    await output('COPIA_L2');
    await quiet('smoke-um', first.id);
    await until(() => main.evaluate(`[...${card('smoke-um')}.querySelectorAll('.xterm-rows > div')].some((row) => row.textContent.trim() === 'COPIA_L2')`), 'log visível em smoke-um');
    await dragSelect('smoke-um', 'COPIA_L1', 'COPIA_L2');
    await until(async () => (await clipboardText()) === 'COPIA_L1\nCOPIA_L2', 'seleção copiada ao soltar o mouse');
    await until(async () => /^1[78] caracteres copiados$/.test(await noticeOf('smoke-um')), 'aviso "N caracteres copiados"');
    const live = await main.evaluate(`(() => { const region = ${terminalOf('smoke-um')}.querySelector('.terminal-notice-region'); return { live: region.getAttribute('aria-live'), role: region.getAttribute('role') }; })()`);
    assert.deepEqual(live, { live: 'polite', role: 'status' }, 'aviso anunciado ao leitor de tela');
    // 6. Barra flutuante junto da seleção, dentro do terminal.
    const barBox = await until(() => main.evaluate(`(() => {
      const bar = ${terminalOf('smoke-um')}.querySelector('.terminal-selection-bar');
      if (!bar || getComputedStyle(bar).visibility === 'hidden') return null;
      const box = bar.getBoundingClientRect();
      const shell = ${terminalOf('smoke-um')}.getBoundingClientRect();
      const selected = [...${card('smoke-um')}.querySelectorAll('.xterm-rows > div')].filter((row) => /^COPIA_L[12]$/.test(row.textContent.trim())).map((row) => row.getBoundingClientRect());
      return {
        inside: box.left >= shell.left && box.right <= shell.right && box.top >= shell.top && box.bottom <= shell.bottom,
        covers: selected.some((row) => box.bottom > row.top + 1 && box.top < row.bottom - 1),
        // Cada botão tem ao menos um ícone visível ("Colar em outra sessão" tem também o chevron).
        icons: [...bar.querySelectorAll(':scope > button')].map((button) => [...button.querySelectorAll('svg')].some((icon) => getComputedStyle(icon).display !== 'none')),
        labels: [...bar.querySelectorAll('button')].map((item) => item.textContent.trim()),
      };
    })()`), 'barra de seleção visível');
    assert(barBox.inside, 'barra dentro do terminal');
    assert.equal(barBox.covers, false, 'barra não cobre as linhas selecionadas');
    assert.deepEqual(barBox.icons, [true, true, true], 'cada botão da barra tem ícone visível');
    assert.deepEqual(barBox.labels, ['Responder', 'Reescrever', 'Colar em outra sessão']);
    await settled(`${terminalOf('smoke-um')}.querySelector('.terminal-selection-bar')`, 'barra assentada');
    await screenshot(main, 'terminal-selection-bar');
    await until(async () => !(await noticeOf('smoke-um')), 'aviso some sozinho', 4000);

    // Colar em outra sessão: a citação chega à entrada do eco, protegida e sem Enter.
    let mark = (await received()).length;
    await main.evaluate(`${terminalOf('smoke-um')}.querySelector('.terminal-selection-bar [aria-haspopup=menu]').click()`);
    await until(() => main.evaluate(`[...${terminalOf('smoke-um')}.querySelectorAll('.terminal-send-menu [role=menuitem]')].map((item) => item.textContent).join('|') === 'smoke-dois'`), 'lista de sessões para enviar');
    await settled(`${terminalOf('smoke-um')}.querySelector('.terminal-send-menu')`, 'lista assentada');
    await screenshot(main, 'terminal-send-menu');
    await main.evaluate(`${terminalOf('smoke-um')}.querySelector('.terminal-send-menu [role=menuitem]').click()`);
    await expectBytes(mark, '\x1b[200~> COPIA_L1\r> COPIA_L2\r\x1b[201~', 'citação colada na outra sessão');
    assert(!(await raw(second.id)).includes('HEX:0d:END'), 'nenhum Enter separado chegou à outra sessão');
    await until(() => main.evaluate(`!${terminalOf('smoke-um')}.querySelector('.terminal-selection-bar')`), 'barra some ao limpar a seleção');

    // Sem colagem protegida (o Windows PowerShell não liga o modo 2004), Responder com várias
    // linhas não chega ao shell: aviso com o motivo e "Copiar" no lugar.
    const shellMode = await main.evaluate(`window.atlasDesktop.getTerminalInputMode(${JSON.stringify(first.id)})`);
    if (shellMode && !shellMode.bracketedPaste) {
      const before = await raw(first.id);
      await dragSelect('smoke-um', 'COPIA_L1', 'COPIA_L2');
      await until(() => main.evaluate(`Boolean(${terminalOf('smoke-um')}.querySelector('.terminal-selection-bar'))`), 'barra para a recusa');
      await main.evaluate(`${terminalOf('smoke-um')}.querySelector('.terminal-selection-bar button').click()`);
      const refusal = await until(() => main.evaluate(`(() => { const notice = ${terminalOf('smoke-um')}.querySelector('.terminal-notice.has-action'); return notice ? { text: notice.textContent, button: notice.querySelector('button')?.textContent } : null; })()`), 'aviso de recusa com ação');
      assert.match(refusal.text, /^Não colado: este terminal executaria cada linha/, 'o aviso explica o motivo');
      assert.equal(refusal.button, 'Copiar');
      await settled(`${terminalOf('smoke-um')}.querySelector('.terminal-notice.has-action')`, 'aviso de recusa assentado');
      await screenshot(main, 'terminal-multiline-refused');
      await main.evaluate(`${terminalOf('smoke-um')}.querySelector('.terminal-notice.has-action button').click()`);
      await until(async () => (await clipboardText()) === '> COPIA_L1\n> COPIA_L2\n', '"Copiar" copia a citação recusada');
      await delay(300);
      assert.equal((await raw(first.id)).slice(before.length).includes('COPIA_L1'), false, 'nenhuma linha chegou ao PowerShell');
      // Um clique no terminal limpa a seleção (e a barra), como no Windows Terminal.
      const blank = await main.evaluate(`(() => { const box = ${card('smoke-um')}.querySelector('.xterm-screen').getBoundingClientRect(); return { x: box.left + box.width - 12, y: box.bottom - 6 }; })()`);
      await main.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...blank, button: 'left', buttons: 1, clickCount: 1 });
      await main.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...blank, button: 'left', buttons: 0, clickCount: 1 });
      await until(() => main.evaluate(`!${terminalOf('smoke-um')}.querySelector('.terminal-selection-bar')`), 'clique limpa a seleção');
    }
    // Ctrl+V e o menu Colar também recusam várias linhas no shell sem modo 2004.
    if (shellMode && !shellMode.bracketedPaste) {
      const marker = 'ATLAS_PASTE_SEM_ENTER';
      await native('invoke', { channel: 'clipboard:write-text', args: [`# ${marker}_1\r\n# ${marker}_2`] });
      const before = (await raw(first.id)).length;
      const refusalKey = () => main.evaluate(`${terminalOf('smoke-um')}.querySelector('.terminal-notice.has-action')?.textContent || ''`);
      await focusInput('smoke-um');
      await key(main, 'v', { code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
      await until(async () => /^Não colado: este terminal executaria cada linha/.test(await refusalKey()), 'Ctrl+V recusa colagem multilinha sem modo 2004');
      assert(!(await raw(first.id)).slice(before).includes(marker), 'Ctrl+V não enviou texto ao shell');
      await main.evaluate(`${terminalOf('smoke-um')}.querySelector('.terminal-notice.has-action button').click()`);
      await until(async () => !(await refusalKey()), 'aviso anterior substituído pelo aviso de cópia');
      await key(main, 'F10', { code: 'F10', windowsVirtualKeyCode: 121, modifiers: 8 });
      await until(() => main.evaluate(`Boolean(${terminalOf('smoke-um')}.querySelector('.terminal-context-menu'))`), 'menu para colagem multilinha sem modo 2004');
      await main.evaluate(`[...${terminalOf('smoke-um')}.querySelectorAll('.terminal-context-menu [role=menuitem]')].find((item) => item.querySelector('span').textContent === 'Colar').click()`);
      await until(async () => /^Não colado: este terminal executaria cada linha/.test(await refusalKey()), 'menu Colar recusa colagem multilinha sem modo 2004');
      assert(!(await raw(first.id)).slice(before).includes(marker), 'menu Colar não enviou texto ao shell');
      await main.evaluate(`${terminalOf('smoke-um')}.querySelector('.terminal-notice.has-action button').click()`);
      await until(async () => !(await refusalKey()), 'aviso do menu substituído pelo aviso de cópia');
      await main.evaluate(`(() => {
        const data = new DataTransfer();
        data.setData('text/plain', ${JSON.stringify(`# ${marker}_1\r\n# ${marker}_2`)});
        const input = ${terminalOf('smoke-um')}.querySelector('.xterm-helper-textarea');
        input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      })()`);
      await until(async () => /^Não colado: este terminal executaria cada linha/.test(await refusalKey()), 'evento nativo também recusa colagem multilinha');
      assert(!(await raw(first.id)).slice(before).includes(marker), 'evento nativo não enviou texto ao shell');
    }
    // O clipboard volta ao log copiado, para os passos de Ctrl+V abaixo.
    await native('invoke', { channel: 'clipboard:write-text', args: ['COPIA_L1\r\nCOPIA_L2'] });

    // 3. Ctrl+V: texto multilinha vai como uma colagem protegida.
    await focusInput('smoke-dois');
    mark = (await received()).length;
    await key(main, 'v', { code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
    await expectBytes(mark, '\x1b[200~COPIA_L1\rCOPIA_L2\x1b[201~', 'Ctrl+V cola o log multilinha protegido');
    mark = (await received()).length;
    await key(main, 'V', { code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 10 });
    await expectBytes(mark, '\x1b[200~COPIA_L1\rCOPIA_L2\x1b[201~', 'Ctrl+Shift+V também cola');

    // 4. Arquivos copiados no Explorer: literais do PowerShell, sem expansão de nomes maliciosos.
    setClipboard(`Set-Clipboard -Path '${fileA}','${fileB}'`);
    mark = (await received()).length;
    await key(main, 'v', { code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
    await expectBytes(mark, `\x1b[200~'${fileA}' '${fileB}'\x1b[201~`, 'Ctrl+V com arquivos cola os caminhos');
    // Imagem: num terminal que não é do Claude Code vai o ^V de um terminal comum; o ESC v
    // (Alt+V, o atalho do Claude Code no Windows) digitaria um "v" no PowerShell.
    setClipboard('Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $image = New-Object System.Drawing.Bitmap 4,4; [System.Windows.Forms.Clipboard]::SetImage($image)');
    mark = (await received()).length;
    await key(main, 'v', { code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
    await expectBytes(mark, '\x16', 'imagem fora do Claude Code repassa o ^V');
    // Arrastar do Explorer: o mesmo formato, sem Enter.
    const dropAt = await main.evaluate(`(() => { const box = ${terminalOf('smoke-dois')}.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
    mark = (await received()).length;
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await main.call('Input.dispatchDragEvent', { type, ...dropAt, data: { items: [], files: [fileA], dragOperationsMask: 1 } });
    }
    await expectBytes(mark, `\x1b[200~'${fileA}'\x1b[201~`, 'arquivo arrastado vira caminho literal do PowerShell');
    assert.equal(await main.evaluate(`${terminalOf('smoke-dois')}.classList.contains('dropping')`), false, 'destaque de soltar some');

    // 2. Ctrl+C com seleção copia e não interrompe; o menu de contexto oferece as ações.
    await dragSelect('smoke-dois', 'ECHO_READY', 'ECHO_READY');
    await until(() => main.evaluate(`Boolean(${terminalOf('smoke-dois')}.querySelector('.terminal-selection-bar'))`), 'seleção no eco ativa');
    const selection = await main.evaluate(`(() => { const box = ${terminalOf('smoke-dois')}.querySelector('.xterm-screen').getBoundingClientRect(); return { x: box.left + 30, y: box.top + 10 }; })()`);
    await main.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...selection, button: 'right', buttons: 2, clickCount: 1 });
    await main.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...selection, button: 'right', buttons: 0, clickCount: 1 });
    const menuItems = await until(() => main.evaluate(`(() => { const menu = ${terminalOf('smoke-dois')}.querySelector('.terminal-context-menu'); return menu ? [...menu.querySelectorAll('[role=menuitem]')].map((item) => item.textContent + (item.disabled ? ':off' : '')) : null; })()`), 'menu de contexto');
    assert.deepEqual(menuItems, ['CopiarCtrl+C', 'ColarCtrl+V', 'Selecionar tudo', 'Responder', 'Reescrever', 'Colar em smoke-um'], 'botão direito mantém a seleção e oferece as ações');
    assert.equal(await main.evaluate(`document.activeElement?.textContent`), 'CopiarCtrl+C', 'foco no primeiro item');
    await settled(`${terminalOf('smoke-dois')}.querySelector('.terminal-context-menu')`, 'menu assentado');
    await screenshot(main, 'terminal-context-menu');
    await key(main, 'ArrowDown', { code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await key(main, 'ArrowDown', { code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await key(main, 'ArrowDown', { code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    assert.equal(await main.evaluate(`document.activeElement?.textContent`), 'Responder', 'setas percorrem o menu');
    mark = (await received()).length;
    // Com `text`, como um teclado real: é o caractere que ativa o botão focado.
    await key(main, 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await expectBytes(mark, '\x1b[200~> ECHO_READY\r\x1b[201~', 'Responder cola a citação no próprio terminal');
    assert(await main.evaluate(`!${terminalOf('smoke-dois')}.querySelector('.terminal-context-menu') && document.activeElement?.classList.contains('xterm-helper-textarea')`), 'menu fecha e o foco volta ao terminal');
    // Shift+F10 abre o mesmo menu pelo teclado; Escape fecha sem chegar ao PTY.
    mark = (await received()).length;
    await key(main, 'F10', { code: 'F10', windowsVirtualKeyCode: 121, modifiers: 8 });
    await until(() => main.evaluate(`document.activeElement?.closest('.terminal-context-menu') && document.activeElement.textContent === 'ColarCtrl+V'`), 'Shift+F10 abre o menu; sem seleção, Copiar fica desabilitado');
    await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
    assert(await main.evaluate(`!${terminalOf('smoke-dois')}.querySelector('.terminal-context-menu') && document.activeElement?.classList.contains('xterm-helper-textarea')`), 'Escape fecha o menu e devolve o foco');
    await delay(300);
    assert.equal(await receivedSince(mark), '', 'Shift+F10 e Escape do menu não chegam ao PTY');
    // F6 com seleção leva à barra; setas, seta para baixo na lista e Escape, sem nada no PTY.
    await dragSelect('smoke-dois', 'ECHO_READY', 'ECHO_READY');
    await until(() => main.evaluate(`Boolean(${terminalOf('smoke-dois')}.querySelector('.terminal-selection-bar'))`), 'seleção para a barra por teclado');
    await focusInput('smoke-dois');
    mark = (await received()).length;
    const focused = () => main.evaluate(`document.activeElement?.textContent || document.activeElement?.className || ''`);
    await key(main, 'F6', { code: 'F6', windowsVirtualKeyCode: 117 });
    await until(async () => (await focused()) === 'Responder', 'F6 leva o foco ao primeiro botão da barra');
    await key(main, 'ArrowRight', { code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    assert.equal(await focused(), 'Reescrever');
    await key(main, 'End', { code: 'End', windowsVirtualKeyCode: 35 });
    assert.equal(await focused(), 'Colar em outra sessão');
    await key(main, 'ArrowDown', { code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await until(async () => (await focused()) === 'smoke-um', 'seta para baixo abre a lista com foco na sessão');
    await settled(`${terminalOf('smoke-dois')}.querySelector('.terminal-send-menu')`, 'lista por teclado assentada');
    await screenshot(main, 'terminal-selection-bar-keyboard');
    await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(async () => (await focused()) === 'Colar em outra sessão' && !(await main.evaluate(`Boolean(${terminalOf('smoke-dois')}.querySelector('.terminal-send-menu'))`)), 'Escape fecha a lista e volta ao botão');
    await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(() => main.evaluate(`document.activeElement?.classList.contains('xterm-helper-textarea')`), 'Escape devolve o foco ao terminal');
    assert(await main.evaluate(`Boolean(${terminalOf('smoke-dois')}.querySelector('.terminal-selection-bar'))`), 'a seleção e a barra continuam');
    await delay(300);
    assert.equal(await receivedSince(mark), '', 'F6, setas e Escape da barra não chegam ao PTY');
    await key(main, 'F6', { code: 'F6', windowsVirtualKeyCode: 117 });
    await until(async () => (await focused()) === 'Responder', 'F6 de novo volta à barra');
    await key(main, 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await expectBytes(mark, '\x1b[200~> ECHO_READY\r\x1b[201~', 'Responder pelo teclado cola a citação');
    assert(await main.evaluate(`document.activeElement?.classList.contains('xterm-helper-textarea')`), 'depois da ação, o foco volta ao terminal');
    // Sem seleção, F6 é do programa.
    mark = (await received()).length;
    await key(main, 'F6', { code: 'F6', windowsVirtualKeyCode: 117 });
    await until(async () => (await receivedSince(mark)) === hex('\x1b[17~'), 'F6 sem seleção vai para o programa');
    // Revisão: Reescrever cola exatamente a seleção (aqui, duas linhas), sem aparar nada.
    await dragSelect('smoke-dois', `HEX:${hex('\x1b[17~')}:END`, 'ECHO_READY');
    const exact = await until(async () => {
      const text = (await native('invoke', { channel: 'clipboard:read-paste' })).text;
      return text.includes('ECHO_READY') && text.includes('HEX:') ? text : null;
    }, 'seleção de duas linhas copiada');
    mark = (await received()).length;
    await main.evaluate(`[...${terminalOf('smoke-dois')}.querySelectorAll('.terminal-selection-bar > button')].find((button) => button.textContent.trim() === 'Reescrever').click()`);
    await expectBytes(mark, `\x1b[200~${exact.replace(/\r?\n/g, '\r')}\x1b[201~`, 'Reescrever cola exatamente a seleção');
    // Ctrl+C com seleção: copia e não interrompe o eco.
    await dragSelect('smoke-dois', 'ECHO_READY', 'ECHO_READY');
    await until(() => main.evaluate(`Boolean(${terminalOf('smoke-dois')}.querySelector('.terminal-selection-bar'))`), 'seleção no eco');
    setClipboard(`Set-Clipboard -Value 'antes'`);
    mark = (await received()).length;
    await focusInput('smoke-dois');
    await key(main, 'c', { code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2 });
    await until(async () => (await clipboardText()) === 'ECHO_READY', 'Ctrl+C com seleção copia');
    await delay(300);
    assert.equal(await receivedSince(mark), '', 'Ctrl+C com seleção não envia interrupção');
    // Sem seleção, o Ctrl+C seguinte volta a ser interrupção.
    await key(main, 'c', { code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2 });
    await output('ECHO_DONE', second.id);
    await until(() => main.evaluate(`window.atlasDesktop.getTerminalInputMode(${JSON.stringify(second.id)}).then((mode) => mode?.bracketedPaste === false)`), 'colagem protegida desligada ao sair do eco');
    console.log('PASS copiar ao selecionar, Ctrl+C/Ctrl+V, arquivos, imagem, arrastar, menu de contexto e barra de seleção');
  }

  await chooseTerminalLayout(main, 'grid');
  await until(() => main.evaluate(`Boolean(${card('smoke-um')} && ${card('smoke-dois')})`), 'grid restores both terminals');
  const terminalSpace = await main.evaluate(`(() => { const cockpit = document.querySelector('.cockpit').getBoundingClientRect(); const grid = document.querySelector('.session-grid').getBoundingClientRect(); return { bottom: cockpit.bottom - grid.bottom, height: grid.height, available: cockpit.bottom - grid.top }; })()`);
  assert(terminalSpace.bottom <= 4 && terminalSpace.height >= terminalSpace.available - 4, 'Grid fills remaining workspace without tabs');
  const terminalDensity = await main.evaluate(`(() => { const grid = document.querySelector('.session-grid'); const style = getComputedStyle(grid); const cards = [...grid.querySelectorAll('.session-card')]; return { gap: style.gap, padding: style.padding, borders: cards.map(item => getComputedStyle(item).borderWidth), radii: cards.map(item => getComputedStyle(item).borderRadius), adjacent: cards.every((item, index) => index === cards.length - 1 || Math.abs(item.getBoundingClientRect().bottom - cards[index + 1].getBoundingClientRect().top) < 1) }; })()`);
  assert.equal(terminalDensity.gap, '0px', 'Terminal panes must not have gaps');
  assert.equal(terminalDensity.padding, '0px', 'Terminal grid must not have inset padding');
  assert(terminalDensity.borders.every((value) => value === '0px') && terminalDensity.radii.every((value) => value === '0px'), 'Terminal panes must be square and borderless');
  assert(terminalDensity.adjacent, 'Terminal rows must touch directly');
  const panelsBeforeMenu = await main.evaluate(`document.querySelector('.workspace-panel-toggle[data-panel=right]').getAttribute('aria-expanded')`);
  await main.evaluate(`${card('smoke-um')}.querySelector('.session-menu-trigger').click()`);
  await until(() => main.evaluate(`Boolean(${card('smoke-um')}.querySelector('.session-menu-popover'))`), 'session actions open');
  await screenshot(main, 'session-actions');
  await main.evaluate(`${card('smoke-um')}.querySelector('.session-menu-trigger').focus()`);
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  assert(await main.evaluate(`!document.querySelector('.session-menu-popover') && document.activeElement === ${card('smoke-um')}.querySelector('.session-menu-trigger')`), 'Escape closes only the menu and restores its trigger focus');
  assert.equal(await main.evaluate(`document.querySelector('.workspace-panel-toggle[data-panel=right]').getAttribute('aria-expanded')`), panelsBeforeMenu, 'Menu Escape must not toggle underlying panels');
  const controlOrder = () => main.evaluate(`[...document.querySelectorAll('.toolbar-actions :is(button, select)')].map(item => item.dataset.panel || item.getAttribute('aria-label'))`);
  const controlsBefore = await controlOrder();
  assert.deepEqual(controlsBefore, ['left', 'right', 'Layout dos terminais', 'Estado do projeto', 'Abrir terminal PowerShell', 'Nova sessão de agente']);
  await main.evaluate(`document.querySelector('.workspace-panel-toggle[data-panel=left]').focus()`);
  await key(main, ' ', { code: 'Space', windowsVirtualKeyCode: 32 });
  await until(() => main.evaluate(`!document.getElementById('atlas-navigation') && document.activeElement.getAttribute('aria-label') === 'Mostrar navegação' && document.activeElement.getAttribute('aria-pressed') === 'false'`), 'teclado oculta navegação e mantém o foco');
  await key(main, ' ', { code: 'Space', windowsVirtualKeyCode: 32 });
  await until(() => main.evaluate(`Boolean(document.getElementById('atlas-navigation')) && document.activeElement.getAttribute('aria-label') === 'Ocultar navegação' && document.activeElement.getAttribute('aria-pressed') === 'true'`), 'teclado mostra navegação');
  await click(main, '.workspace-panel-toggle[data-panel=right]');
  await click(main, '.workspace-panel-toggle[data-panel=right]');
  assert.deepEqual(await controlOrder(), controlsBefore, 'Panel toggles must not insert, remove or reorder toolbar controls');
  await sessionAction(main, card('smoke-um'), 'hide');
  await until(() => main.evaluate(`!${card('smoke-um')} && [...document.querySelectorAll('.tree-session')].some(item => item.dataset.state === 'oculta' && item.innerText.includes('smoke-um'))`), 'hidden terminal remains in tree');
  assert.equal(await main.evaluate(`[...document.querySelectorAll('.tree-session')].find(item => item.dataset.state === 'oculta' && item.innerText.includes('smoke-um')).querySelector('.session-glyph').classList.contains('tone-hidden')`), true, 'selo de oculta na árvore');
  assert.equal(await main.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(first.id)}).then(item => item.exit)`), null, 'Hiding must not close the PTY');
  await main.evaluate(`[...document.querySelectorAll('.tree-session')].find(item => item.dataset.state === 'oculta' && item.innerText.includes('smoke-um')).click()`);
  await until(() => main.evaluate(`Boolean(${card('smoke-um')}?.querySelector('.terminal-view'))`), 'terminal restored from tree');
  await until(async () => (await main.evaluate(`${card('smoke-um')}?.querySelector('.real-terminal')?.innerText`))?.includes('ATLAS_UNICODE_OK'), 'in-memory scrollback restored');
  assert.equal(Number((await raw(first.id)).match(/PID:(\d+)/g).at(-1).slice(4)), firstPid, 'Restore keeps the same shell PID');
  assert.equal((await native('terminals')).length, 2, 'Restore must not create another PTY');

  await chooseTerminalLayout(main, 'spotlight');
  assert.equal(await main.evaluate(`document.querySelectorAll('.session-grid .session-card').length`), 1, 'Spotlight renders one terminal');
  assert.equal(await main.evaluate(`document.querySelectorAll('.terminal-subtabs [role=tab]').length`), 3, 'Spotlight keeps all visible sessions in subtabs');
  await click(main, hidePanels);
  await native('resize', { width: 1440, height: 900 });
  await chooseTerminalLayout(main, 'sidebar');
  const sidebarWidths = await main.evaluate(`(() => { const cards = [...document.querySelectorAll('.session-grid .session-card')]; return cards.map(item => item.getBoundingClientRect().width); })()`);
  assert.equal(sidebarWidths.length, 3, 'Sidebar layout renders all terminals');
  assert(sidebarWidths[0] > sidebarWidths[1], 'Sidebar layout gives the selected terminal more space');
  await screenshot(main, 'workspace-sidebar');
  await ensurePanels(main);
  await chooseTerminalLayout(main, 'tabs');
  assert.equal(await main.evaluate(`document.querySelectorAll('.session-grid .session-card').length`), 1, 'Tabs render one terminal');
  await main.evaluate(`document.querySelector('.terminal-subtabs [aria-selected=true]').focus()`);
  await key(main, 'ArrowRight', { code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await until(() => main.evaluate(`document.querySelector('.terminal-subtabs [aria-selected=true]')?.textContent === 'smoke-dois' && Boolean(${card('smoke-dois')})`), 'keyboard changes terminal tab');
  await screenshot(main, 'workspace-tabs');

  await chooseTerminalLayout(main, 'grid');
  await until(() => main.evaluate(`document.querySelectorAll('.session-grid .session-card').length === 3`), 'all sessions back in grid');
  while (await main.evaluate(`document.querySelectorAll('.session-grid .session-card').length > 0`)) {
    await sessionAction(main, `document.querySelector('.session-grid .session-card')`, 'hide');
  }
  await until(() => main.evaluate(`document.querySelector('.sessions-hidden-empty')?.innerText.includes('processos continuam')`), 'all-hidden empty state');
  const hiddenExits = await main.evaluate(`Promise.all(${JSON.stringify([first.id, second.id])}.map(id => window.atlasDesktop.attachTerminal(id).then(item => item.exit)))`);
  assert.deepEqual(hiddenExits, [null, null], 'All PTYs survive hiding every card');
  await click(main, '.sessions-hidden-empty button', 'Restaurar sessões');
  // Restaurar traz os terminais vivos; o histórico ocultado foi fechado e continua só na árvore.
  await until(() => main.evaluate(`document.querySelectorAll('.session-grid .session-card').length === 2`), 'restore all sessions');
  assert.equal(await main.evaluate(`document.querySelectorAll('.session-history').length`), 0, 'histórico fechado não volta com Restaurar');
  assert.equal(await main.evaluate(`Boolean(document.getElementById('tree-session-history-fixture'))`), true, 'histórico fechado continua na árvore');
  assert.equal(Number((await raw(first.id)).match(/PID:(\d+)/g).at(-1).slice(4)), firstPid);
  assert.equal(Number((await raw(second.id)).match(/PID:(\d+)/g).at(-1).slice(4)), secondPid);
  await focus('smoke-dois');
  console.log('PASS layouts, subtabs por teclado e ocultação com mesmo PID e scrollback');

  // Colunas redimensionáveis: ponteiro 1:1, teclado, encaixes, modos estreitos, PTY e persistência.
  await native('resize', { width: 1440, height: 900 });
  await ensurePanels(main);
  // O passo anterior deixou smoke-dois em Destaque: volta à Grade para achar smoke-um.
  await chooseTerminalLayout(main, 'grid');
  await until(() => main.evaluate(`Boolean(${card('smoke-um')})`), 'smoke-um na Grade');
  await focus('smoke-um');
  const navSeparator = '.column-resizer[aria-label="Largura de Navegação"]';
  const panelSeparator = '.column-resizer[aria-label="Largura de Painéis"]';
  const columnWidth = (column) => main.evaluate(`Math.round(document.querySelector('[data-column-id=${column}]').getBoundingClientRect().width)`);
  const plain = (text) => text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trimEnd();
  const ptySize = async (marker) => {
    await until(async () => plain(await raw(first.id)).endsWith('>'), `prompt antes de ${marker}`);
    await command(main, input, `Write-Output ('${marker}:' + $Host.UI.RawUI.WindowSize.Width + 'x' + $Host.UI.RawUI.WindowSize.Height)`);
    return until(async () => (await raw(first.id)).match(new RegExp(`${marker}:(\\d+x\\d+)`))?.[1], marker);
  };
  async function drag(selector, dx) {
    const start = await main.evaluate(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
    await main.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y });
    await main.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 8; step += 1) {
      await main.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + dx * step / 8, y: start.y, button: 'left', buttons: 1 });
      await delay(16);
    }
    await main.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + dx, y: start.y, button: 'left', buttons: 0, clickCount: 1 });
    await delay(200);
  }
  const doubleClick = (selector) => main.evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  assert.equal(await main.evaluate(`document.querySelectorAll('.column-resizer[role=separator]').length`), 2, 'uma divisória entre cada par de colunas visíveis');
  const navStart = await columnWidth('left');
  const panelStart = await columnWidth('right');
  assert.deepEqual([navStart, panelStart], [248, 292], 'larguras padrão em 1440px');
  const sizeBefore = await ptySize('COLS_A');
  await drag(navSeparator, 120);
  assert(Math.abs(await columnWidth('left') - (navStart + 120)) <= 1, 'arraste acompanha o ponteiro');
  assert.equal(await columnWidth('right'), panelStart, 'entre lateral e Terminais, só a lateral muda');
  const sizeDragged = await ptySize('COLS_B');
  assert.notEqual(sizeDragged, sizeBefore, `o PTY recebe o tamanho final ao soltar (${sizeBefore} → ${sizeDragged})`);
  await main.evaluate(`document.querySelector(${JSON.stringify(navSeparator)}).focus()`);
  await key(main, 'ArrowLeft', { code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  const navKeyboard = await columnWidth('left');
  assert(Math.abs(navKeyboard - (navStart + 104)) <= 1, `seta move 16px: ${navKeyboard}`);
  assert.equal(await main.evaluate(`document.querySelector(${JSON.stringify(navSeparator)}).getAttribute('aria-valuenow')`), String(navKeyboard));
  await drag(navSeparator, 160 - navKeyboard);
  assert.equal(await main.evaluate(`document.querySelector('[data-column-id=left]').dataset.mode`), 'compact');
  const compactTree = await main.evaluate(`(() => { const item = [...document.querySelectorAll('.tree-session')].find(node => node.innerText.includes('smoke-um')); const small = item.querySelector('.tree-label small'); return { smallDisplay: getComputedStyle(small).display, smallWidth: small.getBoundingClientRect().width, text: item.textContent, title: item.title, count: getComputedStyle(document.querySelector('.tree-project-name small')).display }; })()`);
  // Revisão: a linha secundária sai da vista, não do leitor de tela (fica no nome do botão).
  assert(compactTree.smallDisplay !== 'none' && compactTree.smallWidth <= 1, `linha secundária oculta só visualmente na compacta: ${JSON.stringify(compactTree)}`);
  assert(compactTree.text.includes('PowerShell') && compactTree.text.includes('ativa'), `CLI e estado no nome acessível da compacta: ${compactTree.text}`);
  await main.call('DOM.enable');
  await main.call('Accessibility.enable');
  const compactName = await main.call('Accessibility.getPartialAXTree', { backendNodeId: (await main.call('DOM.describeNode', { objectId: (await main.call('Runtime.evaluate', { expression: `[...document.querySelectorAll('.tree-session')].find(node => node.innerText.includes('smoke-um'))` })).result.objectId })).node.backendNodeId, fetchRelatives: false });
  const announced = compactName.nodes.find((node) => node.role?.value === 'button')?.name?.value || '';
  assert(announced.includes('PowerShell') && announced.includes('ativa'), `leitor de tela anuncia CLI e estado na compacta: ${announced}`);
  assert(compactTree.title.includes('PowerShell') && compactTree.title.includes('ativa') && compactTree.title.includes('feature/revisao'), `title completo na compacta: ${compactTree.title}`);
  assert.notEqual(compactTree.count, 'none', 'contadores continuam visíveis');
  await screenshot(main, 'columns-nav-compact');
  await drag(navSeparator, -60);
  assert.equal(await columnWidth('left'), 56, 'abaixo de ~130px a Navegação encaixa no trilho de ícones');
  const rail = await main.evaluate(`(() => { const project = document.querySelector('.rail-project.active'); const sessions = [...document.querySelectorAll('.rail-session')]; return { project: project?.getAttribute('aria-label'), sessions: sessions.map(item => item.getAttribute('aria-label')), hide: document.querySelector('[data-column-id=left] .detach-control')?.getBoundingClientRect().width }; })()`);
  assert(rail.project?.includes('sessões'), `projeto com selo de sessões: ${rail.project}`);
  assert(rail.sessions.some((label) => label.includes('smoke-um') && label.includes('PowerShell') &&label.includes('feature/revisao')), `sessões com nome, CLI e worktree: ${rail.sessions}`);
  assert(rail.hide > 0, 'ocultar a Navegação continua acessível no trilho');
  await main.evaluate(`document.querySelector('.rail-project.active').focus(); document.querySelector('.rail-project.active').click()`);
  await until(() => main.evaluate(`Boolean(document.querySelector('#navigation-flyout .tree-worktree')) && document.querySelector('#navigation-flyout').contains(document.activeElement)`), 'flyout com a árvore completa e foco dentro');
  await until(() => main.evaluate(`document.querySelector('#navigation-flyout').getAnimations().every(item => item.playState === 'finished')`), 'entrada do flyout concluída');
  await screenshot(main, 'columns-nav-icons');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('#navigation-flyout') && document.activeElement?.classList.contains('rail-project')`), 'Esc fecha o flyout e devolve o foco');
  // No trilho, a fila continua acessível: botão com a contagem no nome e o mesmo flyout.
  {
    const queueButton = await main.evaluate(`(() => { const button = document.querySelector('.navigation-rail .rail-queue'); return { label: button?.getAttribute('aria-label') || '', badge: button?.querySelector('.rail-attention')?.textContent }; })()`);
    assert.match(queueButton.label, /^Precisam de mim: \d+ (item precisa|itens precisam) de você$/, `botão da fila no trilho: ${queueButton.label}`);
    assert.equal(queueButton.label.match(/\d+/)[0], queueButton.badge, 'selo e nome acessível com a mesma contagem');
    assert(await main.evaluate(`[...document.querySelectorAll('.rail-project')].some(item => item.getAttribute('aria-label').includes('de você'))`), 'projeto no trilho anuncia os itens da fila');
    await main.evaluate(`document.querySelector('.navigation-rail .rail-queue').focus(); document.querySelector('.navigation-rail .rail-queue').click()`);
    await until(() => main.evaluate(`document.querySelectorAll('.briefing .attention-item').length > 0 && document.activeElement?.id === 'briefing-title'`), 'trilho abre o Briefing com foco no título');
    await closeBriefing();
    await until(() => main.evaluate(`document.activeElement?.classList.contains('rail-queue')`), 'Esc devolve o foco ao contador');
  }
  const activateFocusedButton = (selector) => main.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button) return false;
    button.focus();
    if (document.activeElement !== button) return false;
    button.click();
    return true;
  })()`);
  assert(await activateFocusedButton('.navigation-rail [aria-label="Expandir navegação"]'), 'botão de expansão da Navegação recebe foco e é ativado');
  await until(() => main.evaluate(`document.activeElement?.matches('[data-column-id="left"]:not([data-mode="icons"]) .column-drag-bar .detach-control')`), 'expandir a Navegação transfere o foco');
  await doubleClick(navSeparator);
  await until(async () => (await columnWidth('left')) === navStart, 'duplo clique volta ao padrão');
  assert.equal(await ptySize('COLS_C'), sizeBefore, 'PTY volta ao tamanho original com a largura padrão');
  await drag(panelSeparator, panelStart - 280);
  assert.equal(await main.evaluate(`document.querySelector('[data-column-id=right]').dataset.mode`), 'narrow');
  const narrowTabs = await main.evaluate(`[...document.querySelectorAll('.inspector-tabs button')].map(item => ({ icon: getComputedStyle(item.querySelector('.inspector-tab-icon')).display, label: item.querySelector('.inspector-tab-label').getBoundingClientRect().width, name: item.getAttribute('aria-label') }))`);
  assert(narrowTabs.every((tab) => tab.icon !== 'none' && tab.label <= 1 && tab.name), `abas viram ícones com nome acessível: ${JSON.stringify(narrowTabs)}`);
  await screenshot(main, 'columns-panels-narrow');
  await drag(panelSeparator, 120);
  assert.equal(await columnWidth('right'), 56, 'Painéis abaixo do mínimo viram trilho');
  assert(await main.evaluate(`Boolean(document.querySelector('[data-column-id=right] .detach-control[aria-label="Ocultar painéis"]'))`), 'ocultar Painéis continua no trilho');
  await main.evaluate(`document.querySelector('.rail-panel[data-panel=task]').click()`);
  await until(() => main.evaluate(`Boolean(document.querySelector('#panels-overlay .overlay-inspector .persistent-tasks')) && document.querySelector('#panels-overlay').contains(document.activeElement)`), 'painel sobreposto aos terminais');
  // A entrada anima opacidade e translateX; mede e captura depois que a animação termina.
  await until(() => main.evaluate(`document.querySelector('#panels-overlay').getAnimations().every(item => item.playState === 'finished')`), 'entrada do painel concluída');
  await screenshot(main, 'columns-panels-icons');
  const overlayBox = await main.evaluate(`(() => { const box = document.querySelector('#panels-overlay').getBoundingClientRect(); const rail = document.querySelector('[data-column-id=right]').getBoundingClientRect(); return { right: box.right, railLeft: rail.left }; })()`);
  assert(Math.abs(overlayBox.right - overlayBox.railLeft) <= 1, `o painel abre encostado no trilho, sobre os terminais: ${JSON.stringify(overlayBox)}`);
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('#panels-overlay')`), 'Esc fecha o painel sobreposto');
  assert.deepEqual(await main.evaluate(`JSON.parse(localStorage.getItem('atlas-docks')).widths`), { left: null, right: 56 }, 'larguras salvas em atlas-docks');
  await main.evaluate(`document.querySelector('.rail-panel[data-panel="task"]').click()`);
  await until(() => main.evaluate(`Boolean(document.querySelector('#panels-overlay'))`), 'painel aberto para expandir');
  assert(await activateFocusedButton('#panels-overlay [aria-label="Expandir painéis"]'), 'botão de expansão de Painéis recebe foco e é ativado');
  await until(() => main.evaluate(`!document.querySelector('#panels-overlay') && document.activeElement?.matches('#atlas-panels .inspector-tabs button.active')`), 'expandir o painel transfere o foco à aba aberta');
  await doubleClick(panelSeparator);
  await until(async () => (await columnWidth('right')) === panelStart, 'Painéis voltam ao padrão');
  await native('resize', { width: 940, height: 700 });
  await until(() => main.evaluate(`document.querySelector('.cockpit-toolbar').dataset.mode === 'compact'`), 'barra compacta em coluna estreita');
  const narrowDefaults = { left: await columnWidth('left'), right: await columnWidth('right'), viewport: await main.evaluate('window.innerWidth') };
  assert(narrowDefaults.left >= 200 && narrowDefaults.right >= 250, `padrões estreitos mantêm Navegação e Painéis completos: ${JSON.stringify(narrowDefaults)}`);
  await main.evaluate(`document.querySelector('.toolbar-overflow-trigger').click()`);
  await until(() => main.evaluate(`document.querySelectorAll('#toolbar-overflow-popover :is(button, select)').length === 5`), 'controles no menu ⋯');
  await screenshot(main, 'columns-terminals-compact');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('#toolbar-overflow-popover') && document.activeElement?.classList.contains('toolbar-overflow-trigger')`), 'Esc fecha o menu ⋯ e devolve o foco');
  await native('resize', { width: 1440, height: 900 });
  await drag(navSeparator, 40);
  await main.evaluate(`document.querySelector('.cockpit').focus()`);
  await key(main, 'F1', { code: 'F1', windowsVirtualKeyCode: 112 });
  await until(() => main.evaluate(`Boolean(document.querySelector('.command-palette input'))`), 'paleta aberta');
  // "restaurar layout" também casa com "Restaurar sessões ocultas" (grupo Layout).
  for (const char of 'layout padrao') await key(main, char, { text: char });
  await until(() => main.evaluate(`document.querySelector('.command-palette [role=option][aria-selected=true]')?.textContent === 'Restaurar layout padrão'`), 'Restaurar layout padrão selecionado na paleta');
  await key(main, 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13 });
  await until(() => main.evaluate(`!document.querySelector('.command-palette')`), 'paleta fechada');
  // A paleta fecha antes de executar o comando e o efeito grava as larguras depois.
  await until(() => main.evaluate(`(() => {
    const { left, right } = JSON.parse(localStorage.getItem('atlas-docks')).widths;
    return left === null && right === null;
  })()`), 'Restaurar layout zera as larguras persistidas');
  assert.equal(await columnWidth('left'), navStart);
  await ensurePanels(main);
  await focus('smoke-dois');
  console.log('PASS colunas redimensionáveis: arraste, teclado, encaixes, modos compacto e só ícones, flyouts, PTY e persistência');

  // Terminais redimensionáveis: trilhas compartilhadas na Grade e em Principal + agentes.
  async function dragBy(selector, dx, dy) {
    const start = await main.evaluate(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
    await main.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y });
    await main.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 8; step += 1) {
      await main.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + dx * step / 8, y: start.y + dy * step / 8, button: 'left', buttons: 1 });
      await delay(16);
    }
    await main.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + dx, y: start.y + dy, button: 'left', buttons: 0, clickCount: 1 });
    await delay(200);
  }
  const cardBoxes = () => main.evaluate(`[...document.querySelectorAll('.session-grid .session-card')].map(item => { const rect = item.getBoundingClientRect(); return { name: item.dataset.sessionName, width: Math.round(rect.width), height: Math.round(rect.height), left: Math.round(rect.left), top: Math.round(rect.top) }; })`);
  const savedTracks = () => main.evaluate(`JSON.parse(localStorage.getItem('atlas-terminal-workspace')).tracks`);
  const verticalTrack = '.track-resizer.vertical';
  const horizontalTrack = '.track-resizer.horizontal';
  await chooseTerminalLayout(main, 'grid');
  await click(main, '.workspace-panel-toggle[data-panel=left]');
  await main.evaluate(`(() => { const button = document.querySelector('.workspace-panel-toggle[data-panel=right]'); if (button.getAttribute('aria-expanded') === 'true') button.click(); })()`);
  await until(() => main.evaluate(`document.querySelectorAll(${JSON.stringify(verticalTrack)}).length === 1 && !document.querySelector(${JSON.stringify(horizontalTrack)})`), 'Grade larga: dois terminais lado a lado com uma divisória vertical');
  const gridBefore = await cardBoxes();
  assert(Math.abs(gridBefore[0].width - gridBefore[1].width) <= 2 && gridBefore[0].top === gridBefore[1].top, `trilhas iguais lado a lado: ${JSON.stringify(gridBefore)}`);
  const trackSizeBefore = await ptySize('TRACK_A');
  await dragBy(verticalTrack, 200, 0);
  const gridDragged = await cardBoxes();
  assert(Math.abs(gridDragged[0].width - (gridBefore[0].width + 200)) <= 2 && Math.abs(gridDragged[1].width - (gridBefore[1].width - 200)) <= 2, `fronteira acompanha o ponteiro: ${JSON.stringify(gridDragged)}`);
  assert(gridDragged[1].left - (gridDragged[0].left + gridDragged[0].width) <= 1, 'terminais continuam contíguos');
  assert.notEqual(await ptySize('TRACK_B'), trackSizeBefore, 'PTY recebe o tamanho final ao soltar a divisória');
  await dragBy(verticalTrack, 4000, 0);
  const gridLimit = await cardBoxes();
  assert(gridLimit[1].width >= 318, `mínimo de ~40 colunas no terminal que cede: ${JSON.stringify(gridLimit)}`);
  assert.equal(Object.keys((await savedTracks()).grid || {}).join(), '2x1', 'tamanhos salvos por layout e forma');
  await main.evaluate(`document.querySelector(${JSON.stringify(verticalTrack)}).focus()`);
  await key(main, 'ArrowLeft', { code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  const gridKeyboard = await cardBoxes();
  assert(Math.abs(gridKeyboard[0].width - (gridLimit[0].width - 16)) <= 2, `seta move a fronteira 16px: ${JSON.stringify(gridKeyboard)}`);
  assert.equal(await main.evaluate(`document.querySelector(${JSON.stringify(verticalTrack)}).getAttribute('aria-valuenow')`), String(gridKeyboard[0].width));
  await screenshot(main, 'tracks-grid');
  // Ocultar um terminal muda a forma; restaurar devolve os tamanhos salvos daquela forma.
  // A proporção salva vale enquanto as duas trilhas puderem respeitar o mínimo.
  const share = (boxes) => boxes[0].width / (boxes[0].width + boxes[1].width);
  const savedGrid = (await savedTracks()).grid['2x1'];
  const fitsSavedGrid = async () => {
    const boxes = await cardBoxes();
    if (boxes.length !== 2) return false;
    const width = await main.evaluate("document.querySelector('.session-grid').clientWidth");
    const firstWidth = Math.max(320, Math.min(width - 320, width * share(gridKeyboard)));
    return Math.abs(boxes[0].width - firstWidth) <= 2 && boxes.every((box) => box.width >= 318);
  };
  await click(main, '.workspace-panel-toggle[data-panel=left]');
  await until(fitsSavedGrid, 'ao mostrar a Navegação, as trilhas mantêm o mínimo');
  assert.deepEqual((await savedTracks()).grid['2x1'], savedGrid, 'janela estreita preserva a proporção salva');
  await sessionAction(main, card('smoke-dois'), 'hide');
  await until(() => main.evaluate(`document.querySelectorAll('.session-grid .session-card').length === 1 && !document.querySelector('.track-resizer')`), 'um terminal: sem divisórias e ocupando tudo');
  await main.evaluate(`[...document.querySelectorAll('.tree-session')].find(item => item.dataset.state === 'oculta' && item.innerText.includes('smoke-dois')).click()`);
  await until(() => main.evaluate(`document.querySelectorAll('.session-grid .session-card').length === 2`), 'terminal restaurado');
  await until(fitsSavedGrid, 'forma 2x1 volta com os tamanhos salvos e o mínimo');
  await click(main, '.workspace-panel-toggle[data-panel=left]');
  await until(async () => Math.abs(share(await cardBoxes()) - share(gridKeyboard)) < 0.01, 'a proporção volta quando há espaço');
  await click(main, '.workspace-panel-toggle[data-panel=left]');
  await until(fitsSavedGrid, 'Grade volta a respeitar o mínimo ao mostrar a Navegação');
  await main.evaluate(`document.querySelector(${JSON.stringify(verticalTrack)}).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await until(async () => { const boxes = await cardBoxes(); return Math.abs(boxes[0].width - boxes[1].width) <= 2; }, 'duplo clique divide igualmente');
  // Linhas: com Navegação e Painéis visíveis em 1180px, a Grade empilha os terminais.
  await ensurePanels(main);
  await native('resize', { width: 1180, height: 780 });
  // Espera o layout de 1180px assentar (em 1440px a Grade já estava empilhada).
  await until(async () => (await columnWidth('left')) === 220 && (await columnWidth('right')) === 260, 'colunas no padrão de 1180px');
  await until(() => main.evaluate(`document.querySelectorAll(${JSON.stringify(horizontalTrack)}).length === 1 && !document.querySelector(${JSON.stringify(verticalTrack)})`), 'Grade estreita: terminais empilhados com divisória horizontal');
  await until(async () => { const boxes = await cardBoxes(); return boxes[0].width === (await main.evaluate(`document.querySelector('.session-grid').clientWidth`)) && Math.abs(boxes[1].top - (boxes[0].top + boxes[0].height)) <= 1; }, 'Grade assentada em 1180px');
  const rowsBefore = await cardBoxes();
  await dragBy(horizontalTrack, 0, 80);
  const rowsDragged = await cardBoxes();
  const rowsGrid = await main.evaluate(`(() => { const grid = document.querySelector('.session-grid'); const separator = document.querySelector(${JSON.stringify(horizontalTrack)}).getBoundingClientRect(); return { height: grid.clientHeight, rows: getComputedStyle(grid).gridTemplateRows, separatorTop: separator.top }; })()`);
  assert(Math.abs(rowsDragged[0].height - (rowsBefore[0].height + 80)) <= 2 && Math.abs(rowsDragged[1].top - (rowsDragged[0].top + rowsDragged[0].height)) <= 1, `linhas acompanham o ponteiro e se tocam: ${JSON.stringify({ rowsBefore, rowsDragged, rowsGrid })}`);
  await dragBy(horizontalTrack, 0, 4000);
  assert((await cardBoxes())[1].height >= 168, 'mínimo de ~8 linhas no terminal que cede');
  // Principal + agentes: divisória entre o principal e a pilha.
  await native('resize', { width: 1440, height: 900 });
  await click(main, '.workspace-panel-toggle[data-panel=right]');
  await chooseTerminalLayout(main, 'sidebar');
  await until(() => main.evaluate(`document.querySelectorAll(${JSON.stringify(verticalTrack)}).length === 1`), 'divisória entre o principal e os agentes');
  assert.equal(await main.evaluate(`document.querySelector(${JSON.stringify(verticalTrack)}).getAttribute('aria-label')`), 'Divisão entre a principal e os agentes');
  const sidebarBefore = await cardBoxes();
  assert(sidebarBefore[0].width > sidebarBefore[1].width * 1.8, `principal começa com ~2/3: ${JSON.stringify(sidebarBefore)}`);
  await dragBy(verticalTrack, -150, 0);
  const sidebarDragged = await cardBoxes();
  assert(Math.abs(sidebarDragged[0].width - (sidebarBefore[0].width - 150)) <= 2, `principal cede para a pilha: ${JSON.stringify(sidebarDragged)}`);
  assert((await savedTracks()).sidebar?.stack1, 'Principal + agentes salvo à parte');
  await screenshot(main, 'tracks-sidebar');
  for (const layout of ['spotlight', 'tabs']) {
    await chooseTerminalLayout(main, layout);
    assert.equal(await main.evaluate(`document.querySelectorAll('.track-resizer').length`), 0, `${layout} não tem divisórias`);
  }
  await chooseTerminalLayout(main, 'sidebar');
  await until(async () => Math.abs((await cardBoxes())[0].width - sidebarDragged[0].width) <= 2, 'tamanhos de Principal + agentes preservados ao voltar');
  await main.evaluate(`document.querySelector('.cockpit').focus()`);
  await key(main, 'F1', { code: 'F1', windowsVirtualKeyCode: 112 });
  await until(() => main.evaluate(`Boolean(document.querySelector('.command-palette input'))`), 'paleta aberta');
  for (const char of 'layout padrao') await key(main, char, { text: char });
  await until(() => main.evaluate(`document.querySelector('.command-palette [role=option][aria-selected=true]')?.textContent === 'Restaurar layout padrão'`), 'Restaurar layout padrão selecionado na paleta');
  await key(main, 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13 });
  await until(() => main.evaluate(`!document.querySelector('.command-palette')`), 'paleta fechada');
  // A gravação no localStorage acontece num efeito depois do render: espera por ela.
  await until(async () => Object.keys(await savedTracks()).length === 0, 'tamanhos zerados gravados');
  assert.deepEqual(await savedTracks(), {}, 'Restaurar layout zera os tamanhos dos terminais');
  await ensurePanels(main);
  await focus('smoke-dois');
  console.log('PASS terminais redimensionáveis: Grade em colunas e linhas, Principal + agentes, mínimos, teclado, reajuste ao ocultar, PTY e persistência');

  // Lacunas do layout: Grade com 3 colunas, pilha de agentes, laterais vizinhas reordenadas,
  // throttle do PTY no arraste e contraste/foco no tema claro e em forced-colors.
  {
    const third = await createTerminal('smoke-tres');
    const ptyOf = { 'smoke-um': first.id, 'smoke-dois': second.id, 'smoke-tres': third.id };
    await native('resize', { width: 1440, height: 900 });
    await chooseTerminalLayout(main, 'grid');
    const setColumn = async (panel, visible) => {
      const shown = () => main.evaluate(`Boolean(document.querySelector('[data-column-id=${panel}]'))`);
      if ((await shown()) !== visible) await click(main, `.workspace-panel-toggle[data-panel=${panel}]`);
      await until(async () => (await shown()) === visible, `${panel} ${visible ? 'visível' : 'oculta'}`);
    };
    // Arraste lento (30ms por passo), para medir quantos resizes o PTY recebe enquanto dura.
    async function slowDrag(selector, dx, dy, steps = 24, pause = 30) {
      const start = await main.evaluate(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
      await main.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
      await main.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
      const began = Date.now();
      for (let step = 1; step <= steps; step += 1) {
        await main.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + dx * step / steps, y: start.y + dy * step / steps, button: 'left', buttons: 1 });
        await delay(pause);
      }
      await main.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + dx, y: start.y + dy, button: 'left', buttons: 0, clickCount: 1 });
      const elapsed = Date.now() - began;
      await delay(400);
      return elapsed;
    }

    // 1. Três colunas: a Grade decide pela largura do contêiner (3 x 560px). A tela de quem roda o
    // teste pode não caber 1800px; a emulação de viewport dá a largura sem depender do monitor.
    await setColumn('left', false);
    await setColumn('right', false);
    await main.call('Emulation.setDeviceMetricsOverride', { width: 1800, height: 900, deviceScaleFactor: 1, mobile: false });
    try {
      await until(() => main.evaluate(`document.querySelector('.session-grid').clientWidth >= 1680 && document.querySelectorAll('.track-resizer.vertical').length === 2`), 'Grade com 3 colunas a partir de 1680px');
      const three = await cardBoxes();
      assert.equal(three.length, 3, 'três terminais na Grade');
      assert(three.every((box) => Math.abs(box.top - three[0].top) <= 1), `três colunas na mesma linha: ${JSON.stringify(three)}`);
      assert(Math.max(...three.map((box) => box.width)) - Math.min(...three.map((box) => box.width)) <= 2, `colunas iguais: ${JSON.stringify(three)}`);
      // 4. Throttle: durante o arraste, cada PTY recebe no máximo um resize a cada 120ms (mais o
      // final ao soltar); sem throttle seriam ~24, um por passo.
      const boundary = '.track-resizer[aria-label="Divisão entre as colunas de terminais 2 e 3"]';
      const before = await native('resize-counts');
      const elapsed = await slowDrag(boundary, -150, 0);
      const after = await native('resize-counts');
      const dragged = await cardBoxes();
      assert(Math.abs(dragged[0].width - three[0].width) <= 2, `a primeira coluna não muda: ${JSON.stringify(dragged)}`);
      assert(Math.abs(dragged[1].width - (three[1].width - 150)) <= 2 && Math.abs(dragged[2].width - (three[2].width + 150)) <= 2, `a fronteira 2|3 acompanha o ponteiro: ${JSON.stringify(dragged)}`);
      assert(Object.keys((await savedTracks()).grid || {}).includes('3x1'), 'forma 3x1 salva');
      const delta = (name) => (after[ptyOf[name]] || 0) - (before[ptyOf[name]] || 0);
      const ceiling = Math.ceil(elapsed / 120) + 2;
      assert.equal(delta(three[0].name), 0, 'o terminal que não mudou de largura não recebe resize');
      for (const box of three.slice(1)) {
        const count = delta(box.name);
        assert(count >= 1 && count <= ceiling && count < 24, `throttle em ${box.name}: ${count} resizes em ${elapsed}ms (teto ${ceiling})`);
      }
      console.log(`  resizes do PTY no arraste de ${elapsed}ms: ${three.slice(1).map((box) => `${box.name}=${delta(box.name)}`).join(', ')} (teto ${ceiling})`);
      await screenshot(main, 'tracks-grid-3');
    } finally {
      await main.call('Emulation.clearDeviceMetricsOverride');
    }

    // 2. Principal + agentes com três terminais: divisória entre os agentes empilhados.
    await chooseTerminalLayout(main, 'sidebar');
    const agentsBoundary = '.track-resizer[aria-label="Divisão entre os agentes 1 e 2"]';
    await until(() => main.evaluate(`document.querySelectorAll('.track-resizer.horizontal').length === 1 && document.querySelectorAll('.track-resizer.vertical').length === 1 && Boolean(document.querySelector(${JSON.stringify(agentsBoundary)}))`), 'pilha de dois agentes com divisória');
    const split = (boxes) => {
      const principal = boxes.reduce((wide, box) => (box.width > wide.width ? box : wide));
      return { principal, agents: boxes.filter((box) => box !== principal).sort((a, b) => a.top - b.top) };
    };
    const stackBefore = split(await cardBoxes());
    assert(Math.abs(stackBefore.agents[1].top - (stackBefore.agents[0].top + stackBefore.agents[0].height)) <= 1, `agentes empilhados e contíguos: ${JSON.stringify(stackBefore)}`);
    await dragBy(agentsBoundary, 0, 70);
    const stackDragged = split(await cardBoxes());
    assert(Math.abs(stackDragged.agents[0].height - (stackBefore.agents[0].height + 70)) <= 2 && Math.abs(stackDragged.agents[1].height - (stackBefore.agents[1].height - 70)) <= 2, `a divisória entre agentes acompanha o ponteiro: ${JSON.stringify({ stackBefore, stackDragged })}`);
    assert(Math.abs(stackDragged.principal.height - stackBefore.principal.height) <= 1 && Math.abs(stackDragged.principal.width - stackBefore.principal.width) <= 1, 'a principal não muda');
    assert(Math.abs(stackDragged.agents[1].top - (stackDragged.agents[0].top + stackDragged.agents[0].height)) <= 1, 'agentes continuam contíguos');
    assert((await savedTracks()).sidebar?.stack2?.rows, 'pilha de dois agentes salva à parte');
    await main.evaluate(`document.querySelector(${JSON.stringify(agentsBoundary)}).focus()`);
    await key(main, 'ArrowUp', { code: 'ArrowUp', windowsVirtualKeyCode: 38 });
    const stackKeyboard = split(await cardBoxes());
    assert(Math.abs(stackKeyboard.agents[0].height - (stackDragged.agents[0].height - 16)) <= 2, `seta para cima move a divisória 16px: ${JSON.stringify(stackKeyboard)}`);
    await screenshot(main, 'tracks-sidebar-stack');
    // Integração: arrastar para selecionar texto no agente estreito não promove o terminal.
    await setColumn('left', true);
    let settledBoxes = null;
    await until(async () => {
      const boxes = JSON.stringify(await cardBoxes());
      const stable = boxes === settledBoxes;
      settledBoxes = boxes;
      if (!stable) await delay(300);
      return stable;
    }, 'layout assentado com a Navegação');
    const narrowName = split(JSON.parse(settledBoxes)).agents.reduce((thin, box) => (box.width < thin.width ? box : thin)).name;
    const narrowShell = `${card(narrowName)}.querySelector('.terminal-view-shell')`;
    assert(await main.evaluate(`${narrowShell}.getBoundingClientRect().width <= 480`), `agente empilhado estreito: ${settledBoxes}`);
    const narrowId = ptyOf[narrowName];
    const marker = 'ATLAS_STACK_SELECT';
    const lead = split(JSON.parse(settledBoxes)).principal.name;
    await command(main, `.session-card[data-session-name=${JSON.stringify(narrowName)}] .xterm-helper-textarea`, `Write-Output ('ATLAS_' + 'STACK_SELECT')`);
    await output(marker, narrowId);
    await until(() => main.evaluate(`[...${card(narrowName)}.querySelectorAll('.xterm-rows > div')].some((line) => line.textContent.includes(${JSON.stringify(marker)}))`), 'texto visível no agente empilhado');
    {
      await dragSelect(narrowName, marker, marker, narrowId, true);
      await until(async () => (await native('invoke', { channel: 'clipboard:read-paste' })).text === marker, 'seleção com mouse copiada no terminal estreito');
      assert.equal(split(await cardBoxes()).principal.name, lead, 'selecionar texto não promove o terminal empilhado');
      const narrowLayout = await until(() => main.evaluate(`(() => {
        const shell = ${narrowShell};
        const bar = shell.querySelector('.terminal-selection-bar');
        const notice = shell.querySelector('.terminal-notice');
        if (!bar || !notice || getComputedStyle(bar).visibility === 'hidden') return null;
        const box = (element) => element.getBoundingClientRect();
        const inside = (element) => box(element).left >= box(shell).left - 0.5 && box(element).right <= box(shell).right + 0.5 && box(element).top >= box(shell).top - 0.5 && box(element).bottom <= box(shell).bottom + 0.5;
        return {
          shellWidth: Math.round(box(shell).width),
          barInside: inside(bar),
          noticeInside: inside(notice),
          labelsHidden: [...bar.querySelectorAll(':scope > button > span')].every((span) => span.getBoundingClientRect().width <= 1),
          names: [...bar.querySelectorAll(':scope > button')].map((button) => button.textContent.trim()),
        };
      })()`), 'barra e aviso no terminal estreito', 4000);
      assert(narrowLayout.barInside && narrowLayout.noticeInside, `barra e aviso dentro do terminal estreito: ${JSON.stringify(narrowLayout)}`);
      assert(narrowLayout.labelsHidden, `terminal estreito mostra só os ícones: ${JSON.stringify(narrowLayout)}`);
      assert.deepEqual(narrowLayout.names, ['Responder', 'Reescrever', 'Colar em outra sessão'], 'os nomes continuam acessíveis');
      await screenshot(main, 'selection-bar-narrow');
    }
    await main.call('Emulation.clearDeviceMetricsOverride');

    // 3. Laterais vizinhas: Painéis arrastados para antes dos Terminais ficam ao lado da Navegação,
    // e a divisória entre as duas troca largura entre elas sem mexer nos Terminais.
    await chooseTerminalLayout(main, 'grid');
    await setColumn('left', true);
    await setColumn('right', true);
    const grip = await main.evaluate(`(() => { const bar = document.querySelector('[data-column-id=right] .column-drag-bar').getBoundingClientRect(); const center = document.querySelector('[data-column-id=center]').getBoundingClientRect(); return { from: { x: bar.left + bar.width / 2, y: bar.top + bar.height / 2 }, to: { x: center.left + 40, y: center.top + center.height / 2 } }; })()`);
    await main.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...grip.from });
    await main.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...grip.from, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 12; step += 1) {
      await main.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip.from.x + (grip.to.x - grip.from.x) * step / 12, y: grip.from.y + (grip.to.y - grip.from.y) * step / 12, button: 'left', buttons: 1 });
      await delay(20);
    }
    await main.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...grip.to, button: 'left', buttons: 0, clickCount: 1 });
    const domOrder = () => main.evaluate(`[...document.querySelectorAll('.workspace-body [data-column-id]')].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map((item) => item.dataset.columnId)`);
    await until(async () => JSON.stringify(await domOrder()) === JSON.stringify(['left', 'right', 'center']), 'Painéis reordenados para junto da Navegação');
    assert.deepEqual(await main.evaluate(`JSON.parse(localStorage.getItem('atlas-docks')).order`), ['left', 'right', 'center'], 'ordem salva');
    const neighbors = '.column-resizer[aria-label="Divisão entre Navegação e Painéis"]';
    await until(() => main.evaluate(`Boolean(document.querySelector(${JSON.stringify(neighbors)}))`), 'divisória entre as duas laterais');
    // Revisão: o DOM (e o Tab) segue a ordem da tela, não a do CSS `order`.
    const domSequence = await main.evaluate(`[...document.querySelectorAll('.workspace-body > [data-column-id], .workspace-body > .column-resizer')].map((item) => ({ id: item.dataset.columnId || item.getAttribute('aria-label'), left: Math.round(item.getBoundingClientRect().left) }))`);
    assert.deepEqual(domSequence.map((item) => item.id), ['left', 'Divisão entre Navegação e Painéis', 'right', 'Largura de Painéis', 'center'], `colunas e divisórias no DOM na ordem da tela: ${JSON.stringify(domSequence)}`);
    assert(domSequence.every((item, index) => index === 0 || item.left >= domSequence[index - 1].left), `posições crescentes na ordem do DOM: ${JSON.stringify(domSequence)}`);
    await main.evaluate(`document.querySelector(${JSON.stringify(neighbors)}).focus()`);
    await key(main, 'Tab', { code: 'Tab', windowsVirtualKeyCode: 9 });
    assert(await main.evaluate(`Boolean(document.activeElement?.closest('[data-column-id=right]'))`), 'Tab depois da divisória entre as laterais vai para Painéis, que estão à direita dela');
    const widths = async () => ({ left: await columnWidth('left'), right: await columnWidth('right'), center: await columnWidth('center') });
    const sidesBefore = await widths();
    await dragBy(neighbors, -40, 0);
    const sidesDragged = await widths();
    assert(Math.abs(sidesDragged.left - (sidesBefore.left - 40)) <= 1 && Math.abs(sidesDragged.right - (sidesBefore.right + 40)) <= 1, `uma lateral cede para a outra: ${JSON.stringify({ sidesBefore, sidesDragged })}`);
    assert(Math.abs(sidesDragged.center - sidesBefore.center) <= 1, 'Terminais ficam como estão');
    await main.evaluate(`document.querySelector(${JSON.stringify(neighbors)}).focus()`);
    await key(main, 'ArrowRight', { code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    const sidesKeyboard = await widths();
    assert(Math.abs(sidesKeyboard.left - (sidesDragged.left + 16)) <= 1 && Math.abs(sidesKeyboard.right - (sidesDragged.right - 16)) <= 1 && Math.abs(sidesKeyboard.center - sidesDragged.center) <= 1, `teclado troca 16px entre as laterais: ${JSON.stringify(sidesKeyboard)}`);
    await screenshot(main, 'columns-neighbors');

    // 5. Contraste e foco visível em trilhos, flyouts e menu ⋯: tema claro e forced-colors.
    await click(main, appearance);
    await click(main, '.background-presets button', 'Névoa');
    await click(main, '.appearance-content footer button', 'Concluir');
    await until(() => main.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#eef1f4'`), 'tema claro');
    const shrinkTo = async (column, separator) => {
      const width = await columnWidth(column);
      await drag(separator, column === 'left' ? 90 - width : width - 90);
      await until(async () => (await columnWidth(column)) === 56, `${column} no trilho`);
    };
    const navToRail = '.column-resizer[aria-label="Largura de Navegação"], .column-resizer[aria-label="Divisão entre Navegação e Painéis"]';
    // Volta à ordem padrão antes dos trilhos: cada lateral encosta nos Terminais.
    await main.evaluate(`document.querySelector('.cockpit').focus()`);
    await key(main, 'F1', { code: 'F1', windowsVirtualKeyCode: 112 });
    await until(() => main.evaluate(`Boolean(document.querySelector('.command-palette input'))`), 'paleta aberta');
    for (const char of 'layout padrao') await key(main, char, { text: char });
    await until(() => main.evaluate(`document.querySelector('.command-palette [role=option][aria-selected=true]')?.textContent === 'Restaurar layout padrão'`), 'Restaurar layout padrão');
    await key(main, 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13 });
    // O layout padrão também oculta Painéis: a ordem confere pelo que foi salvo.
    await until(() => main.evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('atlas-docks')).order) === '["left","center","right"]'`), 'ordem padrão de volta');
    await ensurePanels(main);
    await until(async () => JSON.stringify(await domOrder()) === JSON.stringify(['left', 'center', 'right']), 'Painéis de volta à direita');
    assert(await main.evaluate(`!document.querySelector(${JSON.stringify(navToRail.split(', ')[1])})`), 'sem laterais vizinhas, sem divisória entre elas');
    await shrinkTo('left', navSeparator);
    await shrinkTo('right', panelSeparator);
    const scoped = (root) => main.evaluate(`(${auditInterface.toString()})(${root})`);
    const glyphs = (selector) => main.evaluate(`(${auditGlyphs.toString()})(${JSON.stringify(selector)})`);
    // Foco pelo teclado: uma tecla antes faz o Chromium tratar o foco programático como de teclado
    // (:focus-visible). Mede depois da transição de 150ms do indicador das divisórias.
    const keyboardFocus = async (expression) => {
      await key(main, 'Shift', { code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
      const measured = await main.evaluate(`new Promise((resolve) => {
        const element = ${expression};
        if (!element) return resolve({ kind: 'missing' });
        element.focus();
        setTimeout(() => {
          const active = document.activeElement;
          const indicator = (${focusIndicator.toString()})(element);
          resolve(active === element ? indicator : { ...indicator, movedTo: active ? active.tagName + '.' + String(active.className).replaceAll(' ', '.') : 'nada' });
        }, 250);
      })`);
      assert(!measured.movedTo, `o foco ficou em ${expression}: ${JSON.stringify(measured)}`);
      return measured;
    };
    // Coluna de Terminais estreita (menu ⋯): a janela não desce de 940px, então a largura vem da
    // emulação de viewport.
    const narrowViewport = () => main.call('Emulation.setDeviceMetricsOverride', { width: 640, height: 700, deviceScaleFactor: 1, mobile: false });
    const focusTargets = {
      'trilho de Navegação': `document.querySelector('.navigation-rail .rail-project')`,
      'trilho de Painéis': `document.querySelector('.panels-rail .rail-panel')`,
      'divisória de coluna': `document.querySelector(${JSON.stringify(navSeparator)})`,
      'divisória de terminais': `document.querySelector('.track-resizer')`,
    };
    const checkFocus = async (scheme) => {
      for (const [label, expression] of Object.entries(focusTargets)) {
        const indicator = await keyboardFocus(expression);
        assert(indicator.kind !== 'none' && indicator.ratio >= 3, `${scheme}: foco visível em ${label}: ${JSON.stringify(indicator)}`);
      }
    };
    const checkContrast = async (scheme) => {
      const glyphFindings = await glyphs('.navigation-rail .rail-button, .panels-rail .rail-button, .toolbar-overflow-trigger');
      assert.deepEqual(glyphFindings, [], `${scheme}: ícones dos trilhos com 3:1`);
      for (const root of [`document.querySelector('[data-column-id=left]')`, `document.querySelector('[data-column-id=right]')`]) {
        assert.deepEqual(await scoped(root), [], `${scheme}: texto dos trilhos com 4.5:1`);
      }
    };
    await checkContrast('tema claro');
    await checkFocus('tema claro');
    // Flyout da Navegação: conteúdo legível e foco visível dentro dele.
    await main.evaluate(`document.querySelector('.rail-project.active').click()`);
    await until(() => main.evaluate(`Boolean(document.querySelector('#navigation-flyout')) && document.querySelector('#navigation-flyout').getAnimations().every((item) => item.playState === 'finished')`), 'flyout aberto');
    // O flyout repete a árvore da Navegação, cujas linhas secundárias usam 9px desde antes (estilo da
    // árvore na main): aqui conta o contraste; o tamanho fica registrado para o mantenedor decidir.
    const flyoutFindings = await scoped(`document.querySelector('#navigation-flyout')`);
    assert.deepEqual(flyoutFindings.filter((item) => item.ratio < 4.5), [], 'tema claro: texto do flyout com 4.5:1');
    const smallText = flyoutFindings.filter((item) => item.ratio >= 4.5);
    if (smallText.length) console.log(`  flyout: ${smallText.length} textos abaixo de 10px (árvore da Navegação, 9px), contraste ≥ ${Math.min(...smallText.map((item) => item.ratio))}:1`);
    const flyoutFocus = await keyboardFocus(`document.querySelector('#navigation-flyout :is(button, [tabindex="0"], a[href])')`);
    assert(flyoutFocus.kind !== 'none' && flyoutFocus.ratio >= 3, `tema claro: foco visível no flyout: ${JSON.stringify(flyoutFocus)}`);
    await screenshot(main, 'rails-light-flyout');
    // Revisão: com o foco dentro do flyout, o resize fecha o painel e o foco vai para um destino
    // seguro (o botão de origem ou a área dos terminais), nunca para o body.
    await native('resize', { width: 1400, height: 900 });
    await until(() => main.evaluate(`!document.querySelector('#navigation-flyout')`), 'resize fecha o flyout');
    const afterResize = await until(() => main.evaluate(`(() => { const active = document.activeElement; if (!active || active === document.body) return null; return { rail: active.classList.contains('rail-project'), workspace: active.id === 'terminal-workspace' }; })()`), 'foco num destino seguro depois do resize');
    assert(afterResize.rail || afterResize.workspace, `foco no botão do trilho ou na área dos terminais: ${JSON.stringify(afterResize)}`);
    await native('resize', { width: 1440, height: 900 });
    // Menu ⋯ na coluna de Terminais estreita.
    await native('resize', { width: 940, height: 700 }); await doubleClick(navSeparator); await doubleClick(panelSeparator);
    await until(() => main.evaluate(`document.querySelector('.cockpit-toolbar')?.dataset.mode === 'compact' && Boolean(document.querySelector('.toolbar-overflow-trigger'))`), 'barra compacta com menu ⋯');
    const triggerFocus = await keyboardFocus(`document.querySelector('.toolbar-overflow-trigger')`);
    assert(triggerFocus.kind !== 'none' && triggerFocus.ratio >= 3, `tema claro: foco visível no gatilho ⋯: ${JSON.stringify(triggerFocus)}`);
    await main.evaluate(`document.querySelector('.toolbar-overflow-trigger').click()`);
    await until(() => main.evaluate(`Boolean(document.querySelector('#toolbar-overflow-popover'))`), 'menu ⋯ aberto');
    assert.deepEqual(await scoped(`document.querySelector('#toolbar-overflow-popover')`), [], 'tema claro: texto do menu ⋯ com 4.5:1');
    const menuFocus = await keyboardFocus(`document.querySelector('#toolbar-overflow-popover .session-menu-item')`);
    assert(menuFocus.kind !== 'none' && menuFocus.ratio >= 3, `tema claro: foco visível no menu ⋯: ${JSON.stringify(menuFocus)}`);
    await screenshot(main, 'overflow-menu-light');
    await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
    await native('resize', { width: 1440, height: 900 });
    // Espera o layout de 1440px assentar (larguras padrão, depois do duplo clique em 940px).
    await until(async () => (await columnWidth('left')) === 248 && (await columnWidth('right')) === 292, 'larguras padrão em 1440px');
    await shrinkTo('left', navSeparator);
    await shrinkTo('right', panelSeparator);
    // forced-colors (Alto Contraste do Windows): indicadores com cores do sistema.
    await main.call('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    try {
      await until(() => main.evaluate(`matchMedia('(forced-colors: active)').matches`), 'forced-colors ativo');
      await until(async () => (await columnWidth('left')) === 56 && (await columnWidth('right')) === 56, 'trilhos mantidos em 1440px');
      await checkFocus('forced-colors');
      assert.deepEqual(await glyphs('.navigation-rail .rail-button, .panels-rail .rail-button'), [], 'forced-colors: ícones dos trilhos com 3:1');
      await screenshot(main, 'rails-forced-colors');
      await native('resize', { width: 940, height: 700 }); await doubleClick(navSeparator); await doubleClick(panelSeparator);
      await until(() => main.evaluate(`Boolean(document.querySelector('.toolbar-overflow-trigger'))`), 'menu ⋯ em forced-colors');
      await main.evaluate(`document.querySelector('.toolbar-overflow-trigger').click()`);
      await until(() => main.evaluate(`Boolean(document.querySelector('#toolbar-overflow-popover'))`), 'menu ⋯ aberto em forced-colors');
      const forcedMenu = await keyboardFocus(`document.querySelector('#toolbar-overflow-popover .session-menu-item')`);
      assert(forcedMenu.kind !== 'none' && forcedMenu.ratio >= 3, `forced-colors: foco visível no menu ⋯: ${JSON.stringify(forcedMenu)}`);
      await screenshot(main, 'overflow-menu-forced-colors');
      await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
    } finally {
      await main.call('Emulation.setEmulatedMedia', { features: [] });
      await main.call('Emulation.clearDeviceMetricsOverride');
      await native('resize', { width: 1440, height: 900 });
    }
    console.log('PASS lacunas do layout: Grade com 3 colunas, pilha de agentes, laterais vizinhas, throttle do PTY e contraste/foco em tema claro e forced-colors');

    // Volta ao estado que o restante do roteiro espera: tema escuro, layout padrão, dois terminais.
    await click(main, appearance);
    await click(main, '.background-presets button', 'Obsidiana');
    await click(main, '.appearance-content footer button', 'Concluir');
    await main.evaluate(`document.querySelector('.cockpit').focus()`);
    await key(main, 'F1', { code: 'F1', windowsVirtualKeyCode: 112 });
    await until(() => main.evaluate(`Boolean(document.querySelector('.command-palette input'))`), 'paleta aberta');
    for (const char of 'layout padrao') await key(main, char, { text: char });
    await until(() => main.evaluate(`document.querySelector('.command-palette [role=option][aria-selected=true]')?.textContent === 'Restaurar layout padrão'`), 'Restaurar layout padrão');
    await key(main, 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13 });
    await until(async () => (await columnWidth('left')) === 248, 'larguras padrão de volta');
    await chooseTerminalLayout(main, 'grid');
    await sessionAction(main, card('smoke-tres'), 'stop');
    await click(main, '.modal form button[type=submit]', 'Encerrar');
    await until(() => main.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(third.id)}).then((item) => Boolean(item.exit))`), 'smoke-tres encerrado');
    await sessionAction(main, card('smoke-tres'), 'remove');
    await click(main, '.modal form button[type=submit]', 'Excluir');
    await until(() => main.evaluate(`!(${card('smoke-tres')})`), 'smoke-tres excluído');
    await ensurePanels(main);
    await focus('smoke-dois');
  }

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
  await sessionAction(main, card('smoke-dois'), 'popup');
  const popupPage = await until(async () => (await pages()).find((item) => item.url.includes('window=terminal')), 'popup');
  const popup = await connect(popupPage);
  await until(() => popup.evaluate(`Boolean(document.querySelector('.terminal-view'))`), 'popup terminal');
  await assertOverlayBar(popup, '.native-terminal-shell .session-header', 'pop-up de terminal');
  console.log('PASS barra única no pop-up de terminal');
  await click(main, appearance);
  await main.evaluate(`(() => { const field = document.querySelector('input[aria-label="Escolher cor de fundo personalizada"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, '#18222b'); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(() => popup.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#18222b'`), 'custom background synced to terminal popup');
  await click(main, '.appearance-content footer button', 'Concluir');
  await native('focus', { session: new URL(popupPage.url).searchParams.get('session') });
  await command(popup, input, `Write-Output ('ATLAS_' + 'POPUP_OK'); Write-Output ('PID:' + $PID)`);
  await output('ATLAS_POPUP_OK', second.id);
  assert.equal(Number((await raw(second.id)).match(/PID:(\d+)/g).at(-1).slice(4)), secondPid);
  assert(await main.evaluate(`Boolean(document.querySelector('.detached-terminal-placeholder'))`));
  await sessionAction(popup, `document.querySelector('.session-card')`, 'popup');
  await until(() => main.evaluate(`Boolean(document.querySelector('.real-terminal .terminal-view'))`), 'reattach');
  await native('focus');
  await until(() => main.evaluate(`document.querySelector('.real-terminal').innerText.includes('ATLAS_POPUP_OK')`), 'scrollback reattached');
  console.log('PASS pop-up nativo, mesmo PID e histórico preservado ao reintegrar');
  await click(main, popOutPanels);
  const panelPage = await until(async () => (await pages()).find((item) => item.url.includes('window=panels')), 'panel popup');
  const panel = await connect(panelPage);
  await until(() => panel.evaluate(`Boolean(document.querySelector('.native-inspector'))`), 'panel ready');
  await assertOverlayBar(panel, '.native-inspector > .column-drag-bar', 'Acompanhamento');
  console.log('PASS barra única no Acompanhamento');
  await main.evaluate(`[...document.querySelectorAll('.tree-project-name')].find(item => item.textContent.startsWith('Projeto adicional')).click()`);
  await until(() => panel.evaluate(`document.querySelector('.persistent-tasks')?.innerText.includes('Tarefa real · smoke')`), 'task snapshot synced to popup');
  assert.equal(await panel.evaluate(`document.querySelectorAll('.persistent-tasks button').length`), 1, 'Popup lists task selection but cannot create tasks');
  await click(main, target);
  await until(() => panel.evaluate(`document.querySelector('.persistent-tasks')?.innerText.includes('Tarefa interrompida da fixture')`), 'popup task scope follows main');
  assert((await native('windows')).find((item) => item.url.includes('window=panels')).alwaysOnTop);
  assert.equal(await panel.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`), '#18222b');
  await native('resize', { kind: 'panels', width: 420, height: 700 });
  // Em escala fracionária (ex.: 125%), o Windows converte DIP em pixels físicos com
  // arredondamento, então getBounds não devolve exatamente 420x700. Persistimos e
  // comparamos os limites realmente observados, validando a restauração pelo aplicativo.
  const panelsBounds = async () => (await native('windows')).find((item) => item.url.includes('window=panels'))?.bounds;
  const panelsResized = await until(panelsBounds, 'panels bounds after resize');
  await click(panel, '.inspector-tabs button', 'Evidências');
  await click(panel, '[aria-label="Reintegrar painéis ao ATLAS"]');
  await until(() => main.evaluate(`Boolean(document.querySelector('[data-column-id=right]'))`), 'panels reattached');
  assert.equal(await main.evaluate(`document.querySelector('.inspector-tabs button.active').textContent.trim()`), 'Evidências');
  await click(main, popOutPanels);
  await until(async () => (await pages()).find((item) => item.url.includes('window=panels')), 'panels reopened');
  const panelsReopened = await until(panelsBounds, 'panels bounds after reopen');
  assert(Math.abs(panelsReopened.width - panelsResized.width) <= 8, `largura restaurada: ${panelsReopened.width} vs ${panelsResized.width}`);
  assert(Math.abs(panelsReopened.height - panelsResized.height) <= 8, `altura restaurada: ${panelsReopened.height} vs ${panelsResized.height}`);
  assert(Math.abs(panelsResized.width - 420) <= 8, `redimensionamento aplicado: ${panelsResized.width}`);
  await main.evaluate(`window.atlasDesktop.closePanels()`);
  await until(() => main.evaluate(`Boolean(document.querySelector('[data-column-id=right]'))`), 'panels restored');
  console.log('PASS acompanhamento sempre no topo, tema sincronizado, aba e dimensões preservadas');
  await click(main, hideNavigation);
  await click(main, hidePanels);
  assert.equal(await main.evaluate(`document.querySelectorAll('[data-column-id]').length`), 1);
  await chooseTerminalLayout(main, 'grid');
  await sessionAction(main, card('smoke-um'), 'stop');
  assert.equal(await main.evaluate(`document.activeElement.textContent`), 'Cancelar', 'a confirmação começa na opção segura');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.getElementById('session-action-title') && document.activeElement === ${card('smoke-um')}.querySelector('.session-menu-trigger')`), 'Escape cancela e devolve o foco');
  assert.equal(await main.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(first.id)}).then(item => item.exit)`), null, 'cancelar preserva o processo');
  await sessionAction(main, card('smoke-um'), 'stop');
  await click(main, '.modal form button[type=submit]', 'Encerrar');
  await until(() => main.evaluate(`${card('smoke-um')}?.querySelector('.session-header').title.includes('encerrado pelo usuário')`), 'terminal encerrado pelo menu');
  assert(await main.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(first.id)}).then(item => item.exit?.stoppedByUser)`));
  await sessionAction(main, card('smoke-um'), 'remove');
  await click(main, '.modal form button[type=submit]', 'Excluir');
  await until(() => main.evaluate(`!${card('smoke-um')}`), 'terminal excluído do workspace');
  await assert.rejects(main.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(first.id)})`), /Terminal não encontrado/);
  console.log('PASS encerrar PowerShell, cancelar por teclado e excluir terminal encerrado');
  await main.call('Page.reload');
  await until(() => main.evaluate(briefingVisible), 'Briefing após recarregar');
  await closeBriefing();
  // Depois de recarregar, nenhum histórico volta aberto e cada sessão aparece uma vez na árvore.
  await until(() => main.evaluate(`Boolean(document.querySelector('.app-shell')) && document.querySelectorAll('.session-history').length === 0 && document.querySelectorAll('#tree-session-history-fixture').length <= 1 && window.atlasDesktop.listAgents().then(items => new Set(items.map(item => item.id)).size === items.length)`), 'project history restored once after reload');
  await until(() => main.evaluate(`document.querySelector('.app-shell') && document.querySelectorAll('[data-column-id]').length === 1 && getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#18222b'`), 'layout and custom background persisted after reload');
  await until(() => main.evaluate(`window.atlasDesktop.listProjects().then(items => items.some(item => item.path === ${JSON.stringify(extraProject)}))`), 'authorized project restored');
  await until(() => main.evaluate(`[...document.querySelectorAll('.session-card h3')].some(item => item.textContent === 'smoke-dois')`), 'terminal continua conectado após recarregar a interface');
  assert.equal(await main.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(second.id)}).then(item => item.exit)`), null);
  assert.equal(await main.evaluate(`window.atlasDesktop.listTerminals().then(({ terminals }) => terminals.some(item => item.name === 'smoke-um'))`), false);
  await main.evaluate(`window.atlasDesktop.closePty(${JSON.stringify(second.id)})`);
  await screenshot(main, 'terminals-focused');
  await click(main, '.workspace-panel-toggle[data-panel=left]');
  await click(main, '.workspace-panel-toggle[data-panel=right]');
  await until(() => main.evaluate(`[...document.querySelectorAll('.tree-project-name')].some(item => item.textContent.startsWith('Projeto adicional'))`), 'project tabs hydrated');
  await main.evaluate(`[...document.querySelectorAll('.tree-project-name')].find(item => item.textContent.startsWith('Projeto adicional')).click()`);
  await click(main, '.inspector-tabs button', 'Tarefas');
  await until(() => main.evaluate(`document.querySelector('.persistent-tasks')?.innerText.includes('Tarefa real · smoke')`), 'task restored after renderer reload');
  assert((await main.evaluate(`document.querySelector('.persistent-tasks').innerText`)).includes('Preservar após recarregar e reabrir o banco'));
  await screenshot(main, 'task-persisted');
  await main.evaluate(`[...document.querySelectorAll('.inspector-tabs button')].find(item => item.textContent.trim().startsWith('Mensagens')).click()`);
  await until(() => main.evaluate(`document.querySelector('.messages-panel')?.innerText.includes('Descoberta da fixture')`), 'message persisted after renderer reload');
  assert(await main.evaluate(`document.querySelector('.messages-panel')?.innerText.includes('lida em')`), 'read state persisted after renderer reload');
  await main.evaluate(`[...document.querySelectorAll('.inspector-tabs button')].find(item => item.textContent.trim().startsWith('Tarefas')).click()`);
  console.log('PASS ocultar e restaurar as duas colunas');
  await click(main, newSession);
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
  await main.evaluate(`(document.querySelector('.orchestrator-choice-note button') || document.querySelector('.start-choice.principal')).click()`);
  await until(() => main.evaluate(`Boolean(document.querySelector('#orchestrator-choice-title'))`), 'escolha da principal aberta');
  assert.equal(await main.evaluate(`document.querySelector('.modal select[name=cli]').value`), '', 'principal sem CLI pré-selecionado');
  // Chave "Principal só coordena": ligada por padrão; desligada, o aviso explica o que muda.
  const modeSwitch = "document.querySelector('.modal input[name=coordinate-only]')";
  await until(() => main.evaluate(`${modeSwitch} && !${modeSwitch}.disabled`), 'modo da principal carregado');
  assert.deepEqual(await main.evaluate(`[${modeSwitch}.checked, ${modeSwitch}.getAttribute('role'), ${modeSwitch}.getAttribute('aria-describedby')]`), [true, 'switch', 'orchestrator-mode-help'], 'só coordena ligada por padrão');
  await main.evaluate(`${modeSwitch}.click()`);
  await until(() => main.evaluate(`document.querySelector('#orchestrator-mode-help')?.innerText.includes('arquivos fora do projeto e acesso à web')`), 'aviso das permissões nativas');
  assert(await main.evaluate(`document.querySelector('#orchestrator-mode-help').innerText.includes('permissões do CLI')`), 'aviso identifica quem controla o acesso');
  const modeAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(modeAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in orchestrator mode warning');
  await screenshot(main, 'orchestrator-mode-auto');
  await main.evaluate(`${modeSwitch}.click()`);
  assert(await main.evaluate(`${modeSwitch}.checked`));
  await choose(main, '.modal', 'cli', 'codex');
  await until(() => main.evaluate(`document.querySelector('#orchestrator-mode-help').innerText.includes('Desligue “Principal só coordena”')`), 'Codex orienta a trocar de modo');
  assert(await main.evaluate(`document.querySelector('.modal button[type=submit]').disabled`));
  await main.evaluate(`${modeSwitch}.click()`);
  await until(() => main.evaluate(`!document.querySelector('.modal button[type=submit]').disabled`), 'Codex pode iniciar com permissões nativas');
  await main.evaluate(`${modeSwitch}.click()`);
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
  await ensureStatus(main);
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
  assert.deepEqual(await main.evaluate(`[...document.getElementById('atlas-navigation').children].map(item => item.classList.contains('workspace-tree'))`), [true], 'a navegação fica livre das ações de preferências');
  await click(main, '.title-actions [aria-label="Paleta de comandos"]');
  await until(() => main.evaluate(`document.querySelector('#palette-functions small')?.textContent === '6 a configurar'`), 'aviso de funções a configurar na paleta');
  assert.deepEqual(await main.evaluate(`['reset-layout', 'appearance', 'functions'].map(id => document.querySelector('#palette-' + id + ' span')?.textContent)`), ['Restaurar layout padrão', 'Aparência e configurações', 'Funções de agente']);
  await click(main, '#palette-functions');
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
  assert.equal(await main.evaluate(`document.querySelectorAll('.functions-modal .function-row-choice.pending').length`), 5, 'contagem de funções pendentes após salvar');
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
  await click(main, '.title-actions [aria-label="Paleta de comandos"]');
  await until(() => main.evaluate(`document.querySelector('#palette-functions small')?.textContent === '5 a configurar'`), 'aviso atualizado na paleta');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('.command-palette')`), 'paleta fechada');
  console.log('PASS funções de agente: padrão sem modelo, escolha salva preenchida, função do usuário criada e apagada');
  // Sessão manual: "Usar função" só preenche com o que foi salvo; sem função, nada vem escolhido.
  await click(main, newSession);
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
  // Tela inicial: a função configurada chega ao diálogo com CLI e modelo preenchidos, sem iniciar.
  // O projeto adicional só tem histórico: depois de recarregar, ele abre na tela inicial.
  await main.evaluate(`[...document.querySelectorAll('.tree-project-name')].find(item => item.textContent.startsWith('Projeto adicional')).click()`);
  await until(() => main.evaluate(`Boolean(document.querySelector('.start-choice[data-function=revisar]'))`), 'tela inicial no projeto só com histórico');
  {
    assert((await main.evaluate(`document.querySelector('.start-choice[data-function=revisar]').innerText`)).includes('OpenCode · fixture/modelo-forte'), 'tela inicial mostra CLI e modelo da função');
    const before = (await native('terminals')).length;
    await click(main, '.start-choice[data-function=revisar]');
    await until(() => main.evaluate(`document.querySelector('.modal select[name=function]')?.value === 'revisar' && document.querySelector('.modal select[name=model]')?.value === 'fixture/modelo-forte'`), 'diálogo preenchido pela função da tela inicial');
    await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(() => main.evaluate(`!document.querySelector('.modal-backdrop')`), 'diálogo da função configurada fechado');
    assert.equal((await native('terminals')).length, before, 'escolher a função não inicia o agente');
    console.log('PASS tela inicial preenche CLI e modelo pela função, sem iniciar');
  }
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
  // O smoke grava direto no banco: o aviso que o main emitiria junto com o dos pedidos vai à mão.
  await native('send', { channel: 'attention:changed', payload: { projectId: extraProjectId } });
  await until(() => main.evaluate(`document.querySelectorAll('.agent-request').length === 2`), 'pending agent requests shown');
  const requestCards = await main.evaluate(`[...document.querySelectorAll('.agent-request')].map(item => item.innerText)`);
  assert(requestCards[0].includes('Novo agente: revisor-recusado') && requestCards[0].includes('Pedido de ORQUESTRADOR-fixture'), 'Request names requester and agent');
  assert(requestCards[1].includes('Segunda linha preservada') && requestCards[1].includes('Vale até') && requestCards[1].includes('Política: até 2 agentes'), 'Request shows purpose, validity and policy');
  assert(requestCards.every((text) => text.includes('sem flags de autonomia')), 'Request states how the agent starts');
  // Fila "Precisam de mim": cada pedido pendente espera o usuário e leva ao próprio cartão,
  // mesmo a partir de outro projeto: troca de projeto, espera a carga dele e só então abre.
  await openBriefing();
  await until(() => main.evaluate(`document.querySelectorAll('.attention-item[data-kind=request_pending]').length === 2`), 'pedidos pendentes na fila');
  const panelRequests = await main.evaluate(`[...document.querySelectorAll('.attention-item[data-kind=request_pending] strong')].map(item => item.textContent)`);
  assert(panelRequests.includes('Novo agente: revisor-recusado') && panelRequests.length === 2, `Queue lists pending requests: ${panelRequests}`);
  await main.evaluate(`[...document.querySelectorAll('.attention-item[data-kind=request_pending]')].find(item => item.innerText.includes('revisor-recusado')).querySelector('.attention-more').click()`);
  await until(() => main.evaluate(`Boolean(document.querySelector('.attention-menu'))`), 'menu do pedido');
  assert.deepEqual(await main.evaluate(`[...document.querySelectorAll('.attention-menu [role=menuitem]')].map(item => item.textContent)`), ['Adiar 1 hora', 'Adiar 4 horas', 'Adiar até amanhã'], 'pedido pendente não se dispensa');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('.attention-menu')`), 'menu do pedido fechado');
  await main.evaluate(`[...document.querySelectorAll('.tree-project-name')].find(item => !item.textContent.startsWith('Projeto adicional')).click()`);
  await until(() => main.evaluate(`document.querySelectorAll('.agent-request').length === 0 && !document.querySelector('.tree-project-name[aria-current=page]').textContent.startsWith('Projeto adicional')`), 'outro projeto ativo, sem os cartões do adicional');
  await openBriefing();
  {
    // Os pedidos do adicional continuam visíveis com outro projeto ativo.
    const fixtureName = path.basename(fixture);
    const queue = await attentionSnapshot();
    assert.equal(queue.counters[fixtureName], '0', 'projeto ativo sem principal não ganha pendência');
    assert(queue.items.every((item) => item.project === 'Projeto adicional'), `pendências pertencem ao projeto adicional: ${JSON.stringify(queue.items)}`);
    assert.equal(queue.items.filter((item) => item.kind === 'request_pending' && item.project === 'Projeto adicional').length, 2, 'pedidos do outro projeto continuam na fila');
  }
  await main.evaluate(`[...document.querySelectorAll('.attention-item[data-kind=request_pending]')].find(item => item.innerText.includes('revisor-recusado')).querySelector('.attention-open').click()`);
  await until(() => main.evaluate(`document.querySelector('.tree-project-name[aria-current=page]').textContent.startsWith('Projeto adicional') && document.activeElement?.closest('.agent-request')?.innerText.includes('revisor-recusado')`), 'fila troca de projeto e leva ao cartão do pedido');
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
  await openBriefing();
  assert.equal(await main.evaluate(`document.querySelectorAll('.attention-item[data-kind=request_pending]').length`), 0, 'Decided requests leave the queue');
  // O pedido que falhou continua na fila (vem do banco); abrir mostra de novo o cartão com o motivo.
  await until(() => main.evaluate(`[...document.querySelectorAll('.attention-item[data-kind=request_failed]')].some(item => item.innerText.includes('revisor-sem-cli') && item.innerText.includes('Não foi possível iniciar o OpenCode'))`), 'pedido que falhou na fila com o motivo');
  await main.evaluate(`[...document.querySelectorAll('.attention-item[data-kind=request_failed]')].find(item => item.innerText.includes('revisor-sem-cli')).querySelector('.attention-open').click()`);
  await until(() => main.evaluate(`document.activeElement?.closest('.agent-request')?.innerText.includes('revisor-sem-cli') && document.querySelector('.agent-request [role=alert]')?.innerText.includes('Não foi possível iniciar o OpenCode')`), 'fila reabre o cartão do pedido que falhou');
  await click(main, '.agent-request button', 'Dispensar');
  await openBriefing();
  await main.evaluate(`[...document.querySelectorAll('.attention-item[data-kind=request_failed]')].find(item => item.innerText.includes('revisor-sem-cli')).querySelector('.attention-more').click()`);
  await until(() => main.evaluate(`[...document.querySelectorAll('.attention-menu [role=menuitem]')].at(-1)?.textContent === 'Dispensar'`), 'pedido que falhou pode ser dispensado');
  await main.evaluate(`[...document.querySelectorAll('.attention-menu [role=menuitem]')].at(-1).click()`);
  await until(() => main.evaluate(`document.querySelectorAll('.attention-item[data-kind=request_failed]').length === 0`), 'pedido que falhou dispensado da fila');
  await closeBriefing();
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
  await native('send', { channel: 'attention:changed', payload: { projectId: extraProjectId } });
  const queueItem = (title) => `[...document.querySelectorAll('.task-queue .queue-item')].find(item => item.innerText.includes(${JSON.stringify(title)}))`;
  await until(() => main.evaluate(`Boolean(${queueItem('Delegada bloqueada')})`), 'delegated tasks listed');
  assert.match(await main.evaluate(`${queueItem('Delegada aberta')}.innerText`), /Pronta/);
  assert.match(await main.evaluate(`${queueItem('Delegada bloqueada')}.innerText`), /Bloqueada · agente-fixture/);
  // Tarefa bloqueada na fila: de outro projeto, abrir troca de projeto, espera as tarefas e
  // seleciona a tarefa certa no painel; o resumo soma a bloqueada.
  {
    const blockedItem = `[...document.querySelectorAll('.attention-item[data-kind=task_blocked]')].find(item => item.innerText.includes('Delegada bloqueada'))`;
    await openBriefing();
    await until(() => main.evaluate(`Boolean(${blockedItem}) && ${blockedItem}.innerText.includes('Falta o fixture de terminal.')`), 'tarefa bloqueada na fila com o motivo');
    assert.equal((await native('invoke', { channel: 'attention:list' })).projects.find((project) => project.projectId === extraProjectId).blocked.count, 1, 'resumo soma a bloqueada');
    await closeBriefing();
    await main.evaluate(`${queueItem('Delegada aberta')}.click()`);
    await main.evaluate(`[...document.querySelectorAll('.tree-project-name')].find(item => !item.textContent.startsWith('Projeto adicional')).click()`);
    await until(() => main.evaluate(`!document.querySelector('.tree-project-name[aria-current=page]').textContent.startsWith('Projeto adicional') && !${queueItem('Delegada bloqueada')}`), 'outro projeto ativo, sem as tarefas do adicional');
    await openBriefing();
    await main.evaluate(`${blockedItem}.querySelector('.attention-open').click()`);
    await until(() => main.evaluate(`document.querySelector('.tree-project-name[aria-current=page]').textContent.startsWith('Projeto adicional') && document.activeElement === ${queueItem('Delegada bloqueada')} && document.querySelector('.task-assignment')?.innerText.includes('Falta o fixture de terminal.')`), 'fila troca de projeto e seleciona a tarefa bloqueada');
    console.log('PASS fila abre pedido e tarefa de outro projeto só depois da carga dele');
  }
  await main.evaluate(`${queueItem('Delegada aberta')}.click()`);
  await until(() => main.evaluate(`document.querySelector('.task-assignment')?.innerText.includes('Oferecida a agente-fixture')`), 'open offer shown');
  const offerText = await main.evaluate(`document.querySelector('.task-assignment').innerText`);
  assert(offerText.includes('Segunda linha do objetivo.') && offerText.includes('Escrever a regressão primeiro.') && offerText.includes('Aguardando o agente aceitar'), 'Offer shows objective, next steps and pending state');
  // Regressão: avisos do workspace eram espremidos na linha 1fr da grade e se sobrepunham.
  // Com uma sessão aberta (o histórico, pela árvore), o aviso da principal volta a aparecer
  // em vez da tela inicial, e os dois avisos precisam empilhar sem se cobrir.
  await main.evaluate(`document.getElementById('tree-session-reauthorized-fixture').click()`);
  await until(() => main.evaluate(`Boolean(document.querySelector('[data-session-id=reauthorized-fixture]')) && Boolean(document.querySelector('.workspace-notices .orchestrator-choice-note')) && !document.querySelector('.start-launcher')`), 'aviso da principal com sessão aberta');
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
  await ensureStatus(main);
  // Política de agentes (item 5 da v0.2): padrão da v0.1, diálogo acessível, modo
  // autônomo com aviso e volta ao assistido. Sem pedidos pendentes nesta hora.
  assert.equal(await main.evaluate(`document.querySelectorAll('.agent-request').length`), 0);
  await until(() => main.evaluate(`document.querySelector('.agent-policy-status')?.innerText.includes('assistido · até 2 ativos')`), 'agent policy status');
  const openPolicy = async () => {
    await ensureStatus(main);
    await click(main, '.agent-policy-status button', 'Configurar');
    await until(() => main.evaluate(`Boolean(document.querySelector('.agent-policy-modal [name=agent-policy-mode]'))`), 'agent policy dialog loaded');
    assert.equal(await main.evaluate(`Boolean(document.querySelector('#workspace-status'))`), false, 'o estado do projeto não fica por cima do diálogo');
  };
  await openPolicy();
  const policyDialog = await main.evaluate(`(() => { const dialog = document.querySelector('.agent-policy-modal'); return { modal: dialog.getAttribute('aria-modal'), focused: document.activeElement?.value, active: dialog.querySelector('[name=max-active]').value, pending: dialog.querySelector('[name=max-pending]').value, options: dialog.querySelector('[name=max-active]').options.length, warning: Boolean(dialog.querySelector('.regression-warning')) }; })()`);
  assert.deepEqual(policyDialog, { modal: 'true', focused: 'assisted', active: '2', pending: '3', options: 6, warning: false });
  await main.evaluate(`document.querySelector('.agent-policy-modal [value=autonomous]').click()`);
  await choose(main, '.agent-policy-modal', 'max-active', '4');
  await until(() => main.evaluate(`Boolean(document.querySelector('.agent-policy-modal .regression-warning'))`), 'autonomous warning');
  const policyAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  assert.equal(policyAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in agent policy dialog');
  await screenshot(main, 'agent-policy-autonomous');
  await click(main, '.agent-policy-modal button', 'Salvar');
  await until(() => main.evaluate(`!document.querySelector('.agent-policy-modal')`), 'agent policy dialog closed');
  await ensureStatus(main);
  await until(() => main.evaluate(`document.querySelector('.agent-policy-status.autonomous')?.innerText.includes('autônomo controlado · até 4 ativos')`), 'autonomous status');
  // Volta ao assistido: o resto do smoke decide pedidos no cartão.
  await openPolicy();
  assert.equal(await main.evaluate(`document.querySelector('.agent-policy-modal [name=max-active]').value`), '4', 'a política salva volta ao reabrir');
  await main.evaluate(`document.querySelector('.agent-policy-modal [value=assisted]').click()`);
  await click(main, '.agent-policy-modal button', 'Salvar');
  await until(() => main.evaluate(`!document.querySelector('.agent-policy-modal')`), 'agent policy dialog closed again');
  await ensureStatus(main);
  await until(() => main.evaluate(`document.querySelector('.agent-policy-status:not(.autonomous)')?.innerText.includes('assistido · até 4 ativos')`), 'assisted status');
  console.log('PASS política de agentes: padrão da v0.1, diálogo com foco e contraste, autônomo com aviso, persistência e volta ao assistido');

  // Sessão externa (item 5 da v0.2, fase 2): anexada pela paleta, conectada por uma
  // ponte real com o endpoint e o token do comando, e desanexada no card.
  await main.evaluate(`document.querySelector('.cockpit').focus()`);
  await key(main, 'F1', { code: 'F1', windowsVirtualKeyCode: 112 });
  await until(() => main.evaluate(`Boolean(document.querySelector('.command-palette input'))`), 'paleta aberta para anexar');
  for (const char of 'sessao externa') await key(main, char, { text: char });
  await until(() => main.evaluate(`document.querySelector('.command-palette [role=option][aria-selected=true]')?.textContent === 'Anexar sessão externa'`), 'Anexar sessão externa na paleta');
  await key(main, 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13 });
  await until(() => main.evaluate(`document.querySelectorAll('.external-modal [name=external-cli] option').length > 0`), 'CLIs no diálogo de sessão externa');
  const externalDialog = await main.evaluate(`(() => { const dialog = document.querySelector('.external-modal'); return { modal: dialog.getAttribute('aria-modal'), focused: document.activeElement?.name }; })()`);
  assert.deepEqual(externalDialog, { modal: 'true', focused: 'external-name' });
  await main.evaluate(`(() => { const field = document.querySelector('.external-modal [name=external-name]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'externa-smoke'); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click(main, '.external-modal button', 'Anexar');
  await until(() => main.evaluate(`document.querySelector('[aria-label="Sessão externa externa-smoke"] .external-state')?.innerText.includes('Aguardando conexão')`), 'card da sessão externa aguardando');
  const externalAgent = (await native('invoke', { channel: 'agent:list' })).find((agent) => agent.name === 'externa-smoke' && !agent.archived);
  assert.equal(externalAgent.external, true);
  assert.equal(externalAgent.ptyId, null, 'o ATLAS não abre processo para a sessão externa');
  const { command: externalCommand } = await native('invoke', { channel: 'agent:external-command', args: [externalAgent.id] });
  const externalEndpoint = /\$env:ATLAS_MCP_ENDPOINT = '([^']*)'/.exec(externalCommand)[1];
  const externalToken = /\$env:ATLAS_MCP_TOKEN = '([^']*)'/.exec(externalCommand)[1];
  const shownCommand = await main.evaluate(`document.querySelector('[aria-label="Sessão externa externa-smoke"] .external-command').textContent`);
  assert(shownCommand.includes('••••••••') && !shownCommand.includes(externalToken), 'o card não mostra o token');
  const externalBridge = spawn(process.execPath, [path.join(root, 'electron', 'atlas-mcp-bridge.cjs')], { env: { ...process.env, ATLAS_MCP_ENDPOINT: externalEndpoint, ATLAS_MCP_TOKEN: externalToken }, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    externalBridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke-externa', version: '0' } } })}\n`);
    await until(() => main.evaluate(`document.querySelector('[aria-label="Sessão externa externa-smoke"] .external-state')?.innerText.includes('Conectada ao ATLAS')`), 'sessão externa conectada pela ponte');
    const externalAudit = await main.evaluate(`(${auditInterface.toString()})()`);
    assert.equal(externalAudit.filter((item) => item.ratio < 4.5).length, 0, 'Low contrast in external session card');
    await screenshot(main, 'external-session');
    await click(main, '[aria-label="Sessão externa externa-smoke"] button', 'Desanexar');
    await until(() => main.evaluate(`!document.querySelector('[aria-label="Sessão externa externa-smoke"]')`), 'card da sessão externa sai da área de trabalho');
    const detachedAgent = (await native('invoke', { channel: 'agent:list' })).find((agent) => agent.id === externalAgent.id);
    assert.deepEqual([detachedAgent.archived, detachedAgent.external, detachedAgent.runState], [true, true, 'succeeded'], 'a sessão desanexada fica no histórico');
    await assert.rejects(native('invoke', { channel: 'agent:external-command', args: [externalAgent.id] }), /já desanexada/);
  } finally {
    externalBridge.kill();
  }
  await ensureStatus(main);
  console.log('PASS sessão externa: paleta, diálogo, card sem terminal e sem token, ponte real conectada e desanexar');
  // Suíte de regressão configurada pelo usuário no estado do projeto. A sugestão
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
  await until(() => main.evaluate(`!document.querySelector('.regression-modal')`), 'regression dialog closed');
  // Abrir o diálogo fecha o estado do projeto, que não fica por cima do modal.
  assert.equal(await main.evaluate(`Boolean(document.querySelector('#workspace-status'))`), false, 'estado do projeto fechado ao configurar');
  await ensureStatus(main);
  await until(() => main.evaluate(`document.querySelector('.regression-status')?.innerText.includes('ligada · 10 min')`), 'regression suite saved');
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
    const second = spawn(electron, [path.join(root, 'scripts/smoke-app.cjs'), `--atlas-open=${target}`], { cwd: fixture, env: { ...env, ATLAS_SMOKE_SECOND_INSTANCE: '1' }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let secondError = '';
    second.stderr.on('data', (data) => { secondError = (secondError + data).slice(-2000); });
    await new Promise((resolve, reject) => {
      second.once('error', reject);
      second.once('close', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Segunda instância falhou (${code ?? signal}): ${secondError}`));
      });
    });
  };
  const activeTab = () => main.evaluate(`document.querySelector('.tree-project-name[aria-current=page]')?.textContent || ''`);
  await main.evaluate(`[...document.querySelectorAll('.tree-project-name')].find(item => !item.textContent.startsWith('Projeto adicional') && !item.textContent.startsWith('Início'))?.click()`);
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
  assert.equal(await main.evaluate(`[...document.querySelectorAll('.tree-project-name')].some(item => item.textContent.startsWith('Pendente'))`), false, 'No pending folder registered');
  console.log('PASS Abrir no ATLAS: segunda instância, subpasta abre o projeto, pasta nova com confirmação, substituição de pedido e caminho inválido');
  await click(main, appearance);
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
  await click(main, appearance);
  await click(main, '.background-presets button', 'Névoa');
  assert.equal(await main.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`), '#eef1f4');
  const modalAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  fs.writeFileSync(path.join(resultsDir, 'audit-light-modal.json'), JSON.stringify(modalAudit, null, 2));
  await screenshot(main, 'appearance-light');
  await click(main, '.appearance-content footer button', 'Concluir');
  const lightAudit = await main.evaluate(`(${auditInterface.toString()})()`);
  fs.writeFileSync(path.join(resultsDir, 'audit-light-cockpit.json'), JSON.stringify(lightAudit, null, 2));
  await screenshot(main, 'cockpit-light');
  await click(main, appearance);
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
  // Coluna de Terminais estreita: os controles de visualização ficam no menu ⋯.
  const visibleGlyphs = await main.evaluate(`['.palette-trigger svg', document.querySelector('.toolbar-overflow-trigger') ? '.toolbar-overflow-trigger svg' : '.workspace-layout-control svg'].map(selector => document.querySelector(selector)?.getBoundingClientRect().width)`);
  const panelSeams = await main.evaluate(`[
    ['.sidebar', 'borderRightWidth'], ['.inspector.dock-right', 'borderLeftWidth'],
    ['.cockpit-toolbar', 'borderBottomWidth'], ['.inspector-dockbar', 'borderBottomWidth'],
    ...[...document.querySelectorAll('.workspace-body .column-drag-bar')].map(item => [item, 'borderBottomWidth'])
  ].map(([target, property]) => getComputedStyle(typeof target === 'string' ? document.querySelector(target) : target)[property])`);
  const reachable = (scope) => main.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${scope} :is(button, select)`)})].filter(item => {
    const { left, top, width, height } = item.getBoundingClientRect();
    return width >= 24 && height >= 24 && item.contains(document.elementFromPoint(left + width / 2, top + height / 2));
  }).length`);
  let reachableControls = await reachable('.toolbar-actions');
  if (await main.evaluate(`Boolean(document.querySelector('.toolbar-overflow-trigger'))`)) {
    await main.evaluate(`document.querySelector('.toolbar-overflow-trigger').click()`);
    await until(() => main.evaluate(`Boolean(document.querySelector('#toolbar-overflow-popover'))`), 'menu ⋯ aberto');
    // O gatilho do menu não é um controle da barra completa: conta o que ele guarda.
    reachableControls = reachableControls - 1 + await reachable('#toolbar-overflow-popover');
    await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  }
  await screenshot(main, 'cockpit-compact');
  await native('resize', { width: 1440, height: 900 });
  await chooseTerminalLayout(main, 'grid');
  await until(() => main.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(second.id)}).then(item => item.exit)`), 'PTY exit');
  console.log('PASS aparência clara/escura, fundo personalizado, persistência e saída dos PTYs');
  assert(keyboardFocusInModal && keyboardFocusTrapped, 'Modal must receive focus and keep Tab inside it');
  assert(canHideNavigationAtMinimumWidth, 'Navigation must be collapsible at minimum window width');
  assert(visibleGlyphs.every((width) => width > 0), 'Os ícones da paleta e do layout devem permanecer visíveis');
  assert(panelSeams.every((width) => width === '0px'), 'As junções das colunas usam superfícies, sem filetes');
  assert.equal(reachableControls, controlsBefore.length, 'Todos os controles da barra precisam ficar acessíveis na largura mínima');
  assert.equal([...modalAudit, ...lightAudit, ...darkAudit].filter((item) => item.ratio < 4.5).length, 0, 'Low contrast text: inspect audit JSON files');
  await main.evaluate(`[...document.querySelectorAll('.tree-project-name')].find(item => item.textContent.startsWith('Projeto adicional')).click()`);
  await click(main, '#tree-session-reauthorized-fixture-2');
  const archivedCard = `document.querySelector('[data-session-id=reauthorized-fixture-2]')`;
  await until(() => main.evaluate(`Boolean(${archivedCard}?.querySelector('.session-history'))`), 'histórico a excluir aberto');
  await sessionAction(main, archivedCard, 'remove');
  assert(await main.evaluate(`document.getElementById('session-action-detail').innerText.includes('Tarefas e mensagens vinculadas continuam disponíveis')`));
  await click(main, '.modal form button[type=submit]', 'Excluir');
  await until(() => main.evaluate(`!document.getElementById('tree-session-reauthorized-fixture-2')`), 'histórico sai da árvore');
  assert.equal((await native('invoke', { channel: 'agent:list' })).some((item) => item.id === 'reauthorized-fixture-2'), false);
  console.log('PASS excluir histórico de agente sem apagar mensagem vinculada');
  terminalBeforeRestart = await createTerminal('PowerShell a retomar');
  await main.evaluate(`window.atlasDesktop.writeTerminal(${JSON.stringify(terminalBeforeRestart.id)}, "Write-Output ('PID:' + $PID)\\r")`);
  await output('PID:', terminalBeforeRestart.id);
  pids.push(await until(async () => Number((await raw(terminalBeforeRestart.id)).match(/PID:(\d+)/)?.[1]), 'PID do PowerShell antes de fechar'));
} catch (error) {
  fs.writeFileSync(path.join(resultsDir, 'result.json'), JSON.stringify({ passed: false, fixture, error: error.message, checkedAt: new Date().toISOString() }, null, 2));
  for (const connection of connections.filter((item) => item.ws.readyState === WebSocket.OPEN)) {
    await screenshot(connection, 'failure').catch(() => {});
    console.error(await connection.evaluate(`({ visibility: document.visibilityState, selected: document.querySelector('.tree-worktree.active')?.title, select: document.querySelector('select[name=cwd]')?.value, options: [...document.querySelectorAll('select[name=cwd] option')].map(item => item.value), focused: document.activeElement?.outerHTML?.slice(0, 100), terminalText: [...document.querySelectorAll('.real-terminal')].map(item => item.innerText.slice(-1800)) })`).catch(() => null));
  }
  const created = await native('terminals').catch(() => []);
  for (const terminal of created) console.error(await connections[0]?.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(terminal.id)}).then(item => ({ ...item, scrollback: item.scrollback.slice(-1200) }))`).catch(() => null));
  console.error(stderr);
  throw error;
} finally {
  try {
    if (restoreClipboard) await native('restore-clipboard');
  } finally {
    connections.forEach((item) => item.ws.close());
    await native('quit').catch(() => child.kill());

    child.stdin.end();
    try { execFileSync('reg.exe', ['delete', explorerRoot, '/f'], { stdio: 'ignore', windowsHide: true }); } catch { /* chave de fixture já ausente */ }
  }
}
await until(() => pids.every((pid) => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }), 'child PowerShell processes stopped');
async function waitForExit(exited) {
  let timer;
  await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Electron test process did not exit')), 15000); })]).finally(() => clearTimeout(timer));
}
await waitForExit(childExit);
assert(!stderr.includes('AttachConsole failed'), 'Closing an exited PTY must not kill the same console again');
const persisted = new DatabaseSync(path.join(profile, 'atlas.sqlite'), { readOnly: true });
try {
  assert.equal(persisted.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  const paths = persisted.prepare('SELECT path FROM projects').all().map((item) => item.path);
  assert(paths.includes(fs.realpathSync(fixture)), 'Initial project must persist in SQLite');
  assert(paths.includes(fs.realpathSync(extraProject)), 'Authorized project must persist in SQLite');
  assert.equal(persisted.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(persisted.prepare('SELECT state FROM agent_runs WHERE session_id = ?').get('history-fixture').state, 'lost');
  // Tentativa única: a retomada que falhou ficou registrada e não criou outra run.
  const restoreRuns = persisted.prepare('SELECT restored_at FROM agent_runs WHERE session_id = ?').all('restore-fixture');
  assert.equal(restoreRuns.length, 1);
  assert(restoreRuns[0].restored_at, 'tentativa de retomada gravada');
  const persistedTask = persisted.prepare('SELECT title, acceptance, state FROM tasks WHERE id = ?').get(createdTaskId);
  assert.equal(persistedTask.title, 'Tarefa real · smoke');
  assert.equal(persistedTask.acceptance, 'Preservar após recarregar e reabrir o banco');
  assert.equal(persistedTask.state, 'backlog');
  const persistedMessage = persisted.prepare('SELECT subject FROM messages').get();
  assert.equal(persistedMessage.subject, 'Descoberta da fixture');
  assert(persisted.prepare('SELECT removed_at FROM sessions WHERE id = ?').get('reauthorized-fixture-2').removed_at, 'histórico excluído e vínculo preservado no banco');
  assert(persisted.prepare('SELECT read_at FROM message_deliveries').get().read_at, 'Message read state must persist in SQLite');
  const delegated = persisted.prepare('SELECT id, state, assigned_session_id, claim_epoch FROM tasks WHERE id IN (?, ?) ORDER BY title').all(offeredTaskId, blockedTaskId);
  assert.deepEqual(delegated.map((item) => [item.state, item.assigned_session_id, item.claim_epoch]), [['done', 'smoke-agente', 1], ['ready', null, 2]]);
  assert.deepEqual(persisted.prepare('SELECT state, resolved_by FROM handoffs WHERE project_id = ? ORDER BY created_at, rowid').all(extraProjectId).map((item) => [item.state, item.resolved_by]), [['canceled', 'user'], ['accepted', 'agent:smoke-agente'], ['accepted', 'agent:smoke-agente']]);
  assert.deepEqual(persisted.prepare('SELECT state FROM reviews ORDER BY created_at, rowid').all().map((item) => item.state), ['changes_requested', 'accepted']);
  assert.deepEqual(persisted.prepare("SELECT kind, count(*) AS total FROM evidence WHERE source = 'system' GROUP BY kind ORDER BY kind").all().map((item) => [item.kind, item.total]), [['git_snapshot', 2], ['regression_run', 2]]);
  assert.deepEqual(persisted.prepare('SELECT state, exit_code AS exitCode FROM regression_runs ORDER BY created_at, rowid').all().map((item) => [item.state, item.exitCode]), [['cancelled', null], ['failed', 1]]);
  assert.deepEqual({ ...persisted.prepare('SELECT enabled, command, timeout_seconds AS timeoutSeconds FROM regression_suites').get() }, { enabled: 1, command: 'npm test', timeoutSeconds: 600 });
} finally {
  persisted.close();
}
console.log('PASS projetos persistidos pelo processo principal em SQLite íntegro');

const reopened = launchApp();
const reopenedExit = new Promise((resolve) => reopened.once('exit', resolve));
reopened.stdout.resume();
reopened.stderr.resume();
try {
  const page = await until(async () => (await pages()).find((item) => item.type === 'page' && !item.url.includes('window=')), 'janela principal reaberta');
  const main = await connect(page);
  await until(() => main.evaluate(`Boolean(document.querySelector('.briefing:not([hidden])'))`), 'Briefing após reabrir');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`[...document.querySelectorAll('.session-card h3')].some(item => item.textContent === 'PowerShell a retomar')`), 'card do PowerShell reaberto');
  const { terminals, failed } = await main.evaluate('window.atlasDesktop.listTerminals()');
  assert.deepEqual(failed, []);
  assert.equal(terminals.length, 1, 'PowerShell encerrado pelo usuário não reabre');
  const [terminal] = terminals;
  assert.equal(terminal.sessionId, terminalBeforeRestart.sessionId);
  assert.notEqual(terminal.id, terminalBeforeRestart.id, 'reabre em um novo PTY');
  assert.equal(terminal.cwd, worktree);
  await main.evaluate(`window.atlasDesktop.writeTerminal(${JSON.stringify(terminal.id)}, "Write-Output ('CWD:' + (Get-Location).Path); Write-Output ('PID:' + $PID)\\r")`);
  const buffer = await until(async () => {
    const { scrollback } = await main.evaluate(`window.atlasDesktop.attachTerminal(${JSON.stringify(terminal.id)})`);
    return scrollback.includes(`CWD:${worktree}`) && /PID:\d+/.test(scrollback) ? scrollback : null;
  }, 'PowerShell executa na mesma pasta');
  pids.push(Number(buffer.match(/PID:(\d+)/)[1]));
  console.log('PASS PowerShell reabre sozinho na mesma worktree após fechar e abrir o ATLAS');
} finally {
  connections.forEach((item) => item.ws.close());
  await native('quit').catch(() => reopened.kill());
  reopened.stdin.end();
  await waitForExit(reopenedExit);
}
await until(() => pids.every((pid) => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }), 'PowerShell reaberto foi encerrado');
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
