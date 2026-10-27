const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { waitForCwd } = require('./project-host.cjs');

// "Abrir no ATLAS" (marco 6a). O caminho chega como argumento de processo
// (`--atlas-open=<pasta>`), na primeira instância ou na segunda, que só repassa
// o pedido. Ele é validado e canonicalizado aqui e nunca entra em linha de shell.
// Pasta nova só vira projeto com a confirmação do usuário; o ATLAS não roda `git init`.
const OPEN_FLAG = '--atlas-open=';

function parseOpenArgument(argv = []) {
  const argument = argv.find((item) => typeof item === 'string' && item.startsWith(OPEN_FLAG));
  if (argument === undefined) return null;
  let value = argument.slice(OPEN_FLAG.length);
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  // Raiz de unidade ou de compartilhamento pelo Explorador: `"--atlas-open=C:\"` chega
  // como `C:"`, porque a barra final escapa a aspa na linha de comando do Windows.
  else if (value.indexOf('"') === value.length - 1 && value.length > 1) value = `${value.slice(0, -1)}\\`;
  return value;
}

function canonicalDirectory(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error('caminho vazio ou inválido.');
  if (!path.isAbsolute(value)) throw new Error('o caminho precisa ser absoluto.');
  let resolved;
  try {
    resolved = fs.realpathSync.native(path.resolve(value));
  } catch {
    throw new Error('a pasta não existe ou não está acessível.');
  }
  if (!fs.statSync(resolved).isDirectory()) throw new Error('o caminho não é uma pasta.');
  return resolved;
}

// Só leitura no sistema de arquivos e sem rodar Git: a pasta é a raiz de um repositório?
// A descoberta procura repositórios dentro da pasta autorizada, nunca acima dela.
function hasGitRepository(directory) {
  return fs.existsSync(path.join(directory, '.git'));
}

function createOpenPathHost({ ipcMain, projectHost, isMainSender, notify = () => {}, focusMain = () => {}, isGitRepository = hasGitRepository }) {
  const pending = new Map();
  let latest = null;

  function publish(request) {
    latest = request;
    focusMain();
    notify(request);
  }

  async function handleArgv(argv) {
    const raw = parseOpenArgument(argv);
    if (raw === null) {
      focusMain();
      return null;
    }
    let resolved;
    try {
      resolved = canonicalDirectory(raw);
    } catch (error) {
      publish({ kind: 'error', message: `Não foi possível abrir a pasta recebida: ${error.message}` });
      return latest;
    }
    await waitForCwd(projectHost, resolved);
    const project = projectHost.getProjectContaining(resolved);
    if (project) {
      // Subpasta de um projeto abre o projeto; pasta autorizada (raiz ou worktree) vira o diretório ativo.
      const cwd = projectHost.isAllowedCwd(resolved) ? resolved : project.path;
      publish({ kind: 'known', path: resolved, cwd, projectId: project.id, projectName: project.name });
      return latest;
    }
    const root = path.parse(resolved).root.toLowerCase();
    if (root === resolved.toLowerCase() || root === `${resolved}${path.sep}`.toLowerCase()) {
      publish({ kind: 'error', message: 'Não foi possível abrir a pasta recebida: a raiz de uma unidade ou compartilhamento é ampla demais para virar projeto.' });
      return latest;
    }
    const id = randomUUID();
    pending.set(id, resolved);
    const nested = projectHost.getProjectsInside(resolved).map((project) => project.name);
    publish({ kind: 'new', id, path: resolved, name: path.basename(resolved) || resolved, git: isGitRepository(resolved), nested });
    return latest;
  }

  // O renderer busca o pedido mais recente: o aviso pode chegar antes de a janela carregar.
  ipcMain.handle('open-path:take', (event) => {
    if (!isMainSender(event)) return null;
    const request = latest;
    latest = null;
    return request;
  });

  ipcMain.handle('open-path:authorize', async (event, request) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a cadastrar projetos.');
    const id = request && typeof request.id === 'string' ? request.id : '';
    const directory = pending.get(id);
    if (!directory) throw new Error('Pedido de abertura não encontrado ou já resolvido.');
    pending.delete(id);
    const projects = await projectHost.authorizeRoot(directory);
    return { path: directory, projects };
  });

  ipcMain.handle('open-path:dismiss', (event, request) => {
    if (!isMainSender(event)) return false;
    return pending.delete(request?.id);
  });

  return { handleArgv };
}

module.exports = { createOpenPathHost, parseOpenArgument, canonicalDirectory, hasGitRepository, OPEN_FLAG };
