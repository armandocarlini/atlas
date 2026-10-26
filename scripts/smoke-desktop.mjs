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
fs.mkdirSync(resultsDir, { recursive: true });
fs.mkdirSync(profile);
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
const endpoint = `http://127.0.0.1:${port}`;
const electron = createRequire(import.meta.url)('electron');
const controlPort = Number(port) + 1;
const controlToken = randomUUID();
const env = { ...process.env, ATLAS_SMOKE_PROFILE: profile, ATLAS_SMOKE_PROJECT: extraProject, ATLAS_SMOKE_CONTROL_PORT: String(controlPort), ATLAS_SMOKE_TOKEN: controlToken };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
// Codex can inject its bundled PowerShell modules; exercise Windows' own modules.
for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
const child = spawn(electron, [path.join(root, 'scripts/smoke-app.cjs'), `--remote-debugging-port=${port}`], { cwd: fixture, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const childExit = new Promise((resolve) => child.once('exit', resolve));
const connections = [];
const pids = [];
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
  const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(resultsDir, `${name}.png`), Buffer.from(data, 'base64'));
}

try {
  const main = await connect(await until(async () => (await pages()).find((item) => !item.url.includes('window=')), 'main window'));
  await until(() => main.evaluate(`Boolean(document.querySelector('.app-shell'))`), 'React ready');
  await native('focus');
  await click(main, '.add-project');
  await until(() => main.evaluate(`document.querySelectorAll('.worktree-item').length >= 2`), 'Git discovery UI');
  await until(() => main.evaluate(`!document.querySelector('.discovery-heading button').disabled`), 'project loading finished');
  await main.evaluate(`[...document.querySelectorAll('.project-tab')].find(item => item.textContent.startsWith('Projeto adicional')).click()`);
  await until(() => native('defaults-resolved'), 'delayed defaults resolved');
  await delay(150);
  assert(await main.evaluate(`document.querySelector('.project-tab.active').textContent.startsWith('Projeto adicional')`), 'Initial hydration overwrote the selected project');
  assert(await main.evaluate(`document.querySelector('.workspace-path span').textContent === ${JSON.stringify(extraProject)}`), 'Initial hydration overwrote the selected directory');
  console.log('PASS seleção do projeto preservada durante inicialização tardia');
  const target = `.worktree-item[title=${JSON.stringify(worktree)}]`;
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
  await until(() => main.evaluate(`document.querySelector('.app-shell') && document.querySelectorAll('[data-column-id]').length === 1 && getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#18222b'`), 'layout and custom background persisted after reload');
  await until(() => main.evaluate(`window.atlasDesktop.listProjects().then(items => items.some(item => item.path === ${JSON.stringify(extraProject)}))`), 'authorized project restored');
  // UI sessions are intentionally not persisted yet; PTYs are still closed below by id.
  await main.evaluate(`window.atlasDesktop.closePty(${JSON.stringify(first.id)}); window.atlasDesktop.closePty(${JSON.stringify(second.id)})`);
  await screenshot(main, 'terminals-focused');
  await click(main, '.toolbar-actions button', 'Navegação');
  await click(main, '.toolbar-actions button', 'Painéis');
  console.log('PASS ocultar e restaurar as duas colunas');
  await click(main, '.toolbar-actions button', 'Sessão');
  await until(() => main.evaluate(`[...document.querySelectorAll('select[name=cli] option')].some(item => item.textContent.includes('Kimi Code'))`), 'adapters listed in session modal');
  await screenshot(main, 'session-modal');
  const adapterOption = await main.evaluate(`[...document.querySelectorAll('select[name=cli] option')].map(item => ({ text: item.textContent, disabled: item.disabled }))`);
  fs.writeFileSync(path.join(resultsDir, 'session-modal-adapters.json'), JSON.stringify(adapterOption, null, 2));
  assert(adapterOption.every((item) => item.text !== 'Claude Code'), 'modal desktop não deve listar CLIs fictícios');
  await key(main, 'Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => main.evaluate(`!document.querySelector('.modal-backdrop')`), 'session modal closed');
  console.log('PASS modal de sessão lista somente adaptadores detectados');
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
}
await until(() => pids.every((pid) => { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }), 'child PowerShell processes stopped');
let exitTimer;
await Promise.race([childExit, new Promise((_, reject) => { exitTimer = setTimeout(() => reject(new Error('Electron test process did not exit')), 15000); })]).finally(() => clearTimeout(exitTimer));
assert(!stderr.includes('AttachConsole failed'), 'Closing an exited PTY must not kill the same console again');
const persisted = new DatabaseSync(path.join(profile, 'atlas.sqlite'), { readOnly: true });
try {
  assert.equal(persisted.prepare('PRAGMA user_version').get().user_version, 1);
  const paths = persisted.prepare('SELECT path FROM projects').all().map((item) => item.path);
  assert(paths.includes(fs.realpathSync(fixture)), 'Initial project must persist in SQLite');
  assert(paths.includes(fs.realpathSync(extraProject)), 'Authorized project must persist in SQLite');
  assert.equal(persisted.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
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
fs.writeFileSync(path.join(resultsDir, 'result.json'), JSON.stringify({ passed: true, pids, fixtureRemoved: true, checkedAt: new Date().toISOString() }, null, 2));
console.log('PASS limpeza dos processos PowerShell e da fixture temporária');
