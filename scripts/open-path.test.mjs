import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createOpenPathHost, parseOpenArgument, canonicalDirectory, hasGitRepository } = require('../electron/open-path-host.cjs');
const { createProjectHost } = require('../electron/project-host.cjs');

function fixture(t) {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-open-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('argumento --atlas-open: presente, com aspas, ausente', () => {
  assert.equal(parseOpenArgument(['electron.exe', '.', '--atlas-open=C:\\Projetos\\Meu App']), 'C:\\Projetos\\Meu App');
  assert.equal(parseOpenArgument(['atlas.exe', '--atlas-open="C:\\Com Espaço\\ação"']), 'C:\\Com Espaço\\ação');
  assert.equal(parseOpenArgument(['atlas.exe', '--outra=1']), null);
  assert.equal(parseOpenArgument(['atlas.exe', '--atlas-open=']), '');
});

test('caminho é canonicalizado e validado sem shell, com espaços, Unicode e caracteres especiais', (t) => {
  const directory = fixture(t);
  const special = path.join(directory, "Pasta & Ação (1) [teste] 'x' %PATH% ^ !");
  fs.mkdirSync(special);
  assert.equal(canonicalDirectory(special), fs.realpathSync.native(special));
  assert.equal(canonicalDirectory(path.join(special, '..', path.basename(special))), fs.realpathSync.native(special));
  assert.throws(() => canonicalDirectory('relativo\\pasta'), /precisa ser absoluto/);
  assert.throws(() => canonicalDirectory(path.join(directory, 'inexistente')), /não existe/);
  const file = path.join(directory, 'arquivo.txt');
  fs.writeFileSync(file, 'x');
  assert.throws(() => canonicalDirectory(file), /não é uma pasta/);
  assert.throws(() => canonicalDirectory('C:\\x\0y'), /inválido/);
  assert.throws(() => canonicalDirectory(''), /inválido/);
});

test('detecção de Git só olha a raiz da pasta, sem rodar Git', (t) => {
  const directory = fixture(t);
  assert.equal(hasGitRepository(directory), false);
  fs.mkdirSync(path.join(directory, '.git'));
  assert.equal(hasGitRepository(directory), true);
  const child = path.join(directory, 'sub');
  fs.mkdirSync(child);
  assert.equal(hasGitRepository(child), false, 'repositório acima da pasta não é descoberto');
});

function hostHarness(t, projects = []) {
  const handlers = new Map();
  const notices = [];
  let focused = 0;
  const authorized = [];
  const projectHost = {
    ready: Promise.resolve(),
    getProjectContaining: (cwd) => projects.find((project) => cwd === project.path || cwd.startsWith(`${project.path}${path.sep}`)) || null,
    getProjectsInside: () => [],
    isAllowedCwd: (cwd) => projects.some((project) => project.path === cwd),
    authorizeRoot: async (root) => { authorized.push(root); projects.push({ id: 'novo', name: path.basename(root), path: root }); return projects; },
  };
  const host = createOpenPathHost({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, projectHost, isMainSender: (event) => event.sender === 'main', notify: (request) => notices.push(request.kind), focusMain: () => { focused += 1; } });
  const invoke = (name, payload, sender = 'main') => handlers.get(name)({ sender }, payload);
  return { host, invoke, notices, authorized, get focused() { return focused; } };
}

test('projeto existente abre sem duplicar; subpasta abre o projeto na raiz', async (t) => {
  const directory = fixture(t);
  const sub = path.join(directory, 'src', 'componentes');
  fs.mkdirSync(sub, { recursive: true });
  const context = hostHarness(t, [{ id: 'p1', name: 'Projeto', path: directory }]);
  await context.host.handleArgv(['atlas.exe', `--atlas-open=${directory}`]);
  assert.deepEqual(await context.invoke('open-path:take'), { kind: 'known', path: directory, cwd: directory, projectId: 'p1', projectName: 'Projeto' });
  assert.equal(await context.invoke('open-path:take'), null, 'pedido é consumido uma vez');
  await context.host.handleArgv(['atlas.exe', `--atlas-open=${sub}`]);
  assert.equal((await context.invoke('open-path:take')).cwd, directory);
  assert.deepEqual(context.authorized, []);
  assert.equal(context.focused, 2, 'instância existente recebe foco');
});

test('pasta nova exige confirmação; só a janela principal autoriza e o pedido vale uma vez', async (t) => {
  const directory = fixture(t);
  const context = hostHarness(t);
  await context.host.handleArgv(['atlas.exe', `--atlas-open=${directory}`]);
  const request = await context.invoke('open-path:take');
  assert.equal(request.kind, 'new');
  assert.equal(request.path, directory);
  assert.equal(request.git, false);
  assert.deepEqual(context.authorized, [], 'nada é cadastrado antes da confirmação');
  await assert.rejects(context.invoke('open-path:authorize', { id: request.id }, 'popup'), /Janela não autorizada/);
  await assert.rejects(context.invoke('open-path:authorize', { id: 'forjado' }), /não encontrado/);
  const result = await context.invoke('open-path:authorize', { id: request.id });
  assert.equal(result.path, directory);
  assert.deepEqual(context.authorized, [directory]);
  await assert.rejects(context.invoke('open-path:authorize', { id: request.id }), /já resolvido/);
});

test('cancelar descarta o pedido; caminho inválido vira aviso sem cadastro', async (t) => {
  const directory = fixture(t);
  const context = hostHarness(t);
  await context.host.handleArgv(['atlas.exe', `--atlas-open=${directory}`]);
  const request = await context.invoke('open-path:take');
  assert.equal(await context.invoke('open-path:dismiss', { id: request.id }), true);
  await assert.rejects(context.invoke('open-path:authorize', { id: request.id }), /não encontrado/);
  await context.host.handleArgv(['atlas.exe', `--atlas-open=${path.join(directory, 'nada')}`]);
  const error = await context.invoke('open-path:take');
  assert.equal(error.kind, 'error');
  assert.match(error.message, /não existe/);
  assert.equal(await context.host.handleArgv(['atlas.exe']), null, 'sem argumento não há pedido');
  assert.deepEqual(context.authorized, []);
  assert.equal(await context.invoke('open-path:take', undefined, 'popup'), null);
});

test('project host cadastra raiz e encontra projeto que contém subpasta', async (t) => {
  const directory = fixture(t);
  const root = path.join(directory, 'Projeto Ação');
  fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
  const userData = path.join(directory, 'user-data');
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'atlas-projects.json'), JSON.stringify({ roots: [] }));
  const host = createProjectHost({ app: { getPath: () => userData }, dialog: {}, ipcMain: { handle: () => {} }, getMainWindow: () => null, store: null });
  await host.ready;
  assert.equal(host.getProjectContaining(path.join(root, 'a', 'b')), null);
  await host.authorizeRoot(root);
  assert.equal(host.getProjectContaining(path.join(root, 'a', 'b')).path, root);
  assert.equal(host.getProjectContaining(`${root} irmão`), null, 'prefixo de nome não conta como contido');
  assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'atlas-projects.json'), 'utf8')).roots.includes(root), true);
  await host.authorizeRoot(root);
  assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'atlas-projects.json'), 'utf8')).roots.filter((item) => item === root).length, 1, 'sem duplicação');
});

test('regressão: projetos aninhados abrem o mais específico', async (t) => {
  const directory = fixture(t);
  const outer = path.join(directory, 'externo');
  const inner = path.join(outer, 'Projeto interno');
  fs.mkdirSync(path.join(inner, 'sub pasta'), { recursive: true });
  const userData = path.join(directory, 'user-data');
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'atlas-projects.json'), JSON.stringify({ roots: [outer, inner] }));
  const host = createProjectHost({ app: { getPath: () => userData }, dialog: {}, ipcMain: { handle: () => {} }, getMainWindow: () => null, store: null });
  await host.ready;
  assert.equal(host.getProjectContaining(path.join(inner, 'sub pasta')).path, inner);
  assert.equal(host.getProjectContaining(outer).path, outer);
});

test('regressão: subpasta cujo nome começa com .. continua dentro do projeto', async (t) => {
  const directory = fixture(t);
  const root = path.join(directory, 'proj');
  fs.mkdirSync(path.join(root, '..cache'), { recursive: true });
  const userData = path.join(directory, 'user-data');
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'atlas-projects.json'), JSON.stringify({ roots: [root] }));
  const host = createProjectHost({ app: { getPath: () => userData }, dialog: {}, ipcMain: { handle: () => {} }, getMainWindow: () => null, store: null });
  await host.ready;
  assert.equal(host.getProjectContaining(path.join(root, '..cache')).path, root);
  assert.deepEqual(host.getProjectsInside(directory).map((item) => item.path), [root]);
  assert.deepEqual(host.getProjectsInside(root), [], 'o próprio projeto não conta como aninhado');
});

test('regressão: raiz de unidade é recusada e pasta com projetos dentro é avisada', async (t) => {
  const directory = fixture(t);
  const context = hostHarness(t);
  await context.host.handleArgv(['atlas.exe', `--atlas-open=${path.parse(directory).root}`]);
  const refused = await context.invoke('open-path:take');
  assert.equal(refused.kind, 'error');
  assert.match(refused.message, /raiz de uma unidade/);
  const handlers = new Map();
  const inner = { id: 'p', name: 'Interno', path: path.join(directory, 'interno') };
  const projectHost = { ready: Promise.resolve(), getProjectContaining: () => null, getProjectsInside: () => [inner], isAllowedCwd: () => false, authorizeRoot: async () => [] };
  const host = createOpenPathHost({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, projectHost, isMainSender: () => true });
  await host.handleArgv(['atlas.exe', `--atlas-open=${directory}`]);
  assert.deepEqual((await handlers.get('open-path:take')({})).nested, ['Interno']);
});

test('regressão: segunda instância sem caminho só traz a janela para frente', async (t) => {
  const context = hostHarness(t);
  assert.equal(await context.host.handleArgv(['atlas.exe']), null);
  assert.equal(context.focused, 1);
});

test('regressão: raiz autorizada durante uma varredura não se perde', async (t) => {
  const directory = fixture(t);
  const first = path.join(directory, 'primeiro');
  const second = path.join(directory, 'segundo');
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  const userData = path.join(directory, 'user-data');
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'atlas-projects.json'), JSON.stringify({ roots: [first] }));
  const host = createProjectHost({ app: { getPath: () => userData }, dialog: {}, ipcMain: { handle: () => {} }, getMainWindow: () => null, store: null });
  await host.ready;
  const scanning = host.refresh();
  await host.authorizeRoot(second);
  await scanning;
  await host.refresh();
  assert.equal(host.isAllowedCwd(second), true);
  assert(JSON.parse(fs.readFileSync(path.join(userData, 'atlas-projects.json'), 'utf8')).roots.includes(second));
});
