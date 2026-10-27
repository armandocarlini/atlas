const fs = require('node:fs');
const path = require('node:path');
const { discoverRepositories, idFor } = require('./git-discovery.cjs');

// Projetos são publicados assim que as raízes autorizadas são lidas; a varredura
// Git de cada um segue em paralelo e avisa a interface ao terminar. Um projeto
// grande (muitas worktrees) não segura a janela nem os demais projetos.
function createProjectHost({ app, dialog, ipcMain, getMainWindow, store, onChange = () => {}, discover = discoverRepositories }) {
  const settingsFile = path.join(app.getPath('userData'), 'atlas-projects.json');
  const initialRoot = process.cwd();
  const projects = new Map();
  // Varredura mais recente pedida por raiz: resultado antigo não sobrescreve um novo.
  const generations = new Map();
  const rootScans = new Map();
  let authorizedRoots = [];
  let scanPromise = null;

  function isMainSender(event) {
    const window = getMainWindow();
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents);
  }

  function readRoots() {
    let saved = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (Array.isArray(parsed.roots)) saved = parsed.roots.filter((root) => typeof root === 'string');
    } catch { /* A ausência do arquivo é o estado inicial esperado. */ }
    return [...new Set([initialRoot, ...saved].map((root) => path.resolve(root)))];
  }

  function saveRoots() {
    const savedRoots = authorizedRoots.filter((root) => path.resolve(root) !== path.resolve(initialRoot));
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    const temporary = `${settingsFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ roots: savedRoots }, null, 2));
    fs.renameSync(temporary, settingsFile);
  }

  function placeholder(root) {
    const id = idFor(root);
    if (!projects.has(id)) projects.set(id, { id, name: path.basename(root), path: root, repositories: [], errors: [], truncated: false, scannedAt: null, scanning: true });
    return projects.get(id);
  }

  function scanRoot(root) {
    const generation = (generations.get(root) || 0) + 1;
    generations.set(root, generation);
    const project = { id: idFor(root), name: path.basename(root), path: root, repositories: [], errors: [], truncated: false, scannedAt: null, scanning: false };
    store?.registerProject(project);
    const scan = (async () => {
      try {
        const result = await discover(root);
        Object.assign(project, result, { scannedAt: new Date().toISOString() });
      } catch (error) {
        project.errors = [{ path: root, message: error.message }];
      }
      if (generations.get(root) !== generation) return projects.get(project.id) || project;
      projects.set(project.id, project);
      onChange(project);
      return project;
    })();
    rootScans.set(root, scan);
    return scan;
  }

  async function scanAll() {
    if (scanPromise) return scanPromise;
    scanPromise = (async () => {
      const snapshot = [...authorizedRoots];
      const roots = await Promise.all(snapshot.map(async (root) => {
        try {
          return await fs.promises.realpath(root);
        } catch {
          return null;
        }
      }));
      // Raízes autorizadas enquanto a varredura rodava continuam valendo.
      const added = authorizedRoots.filter((root) => !snapshot.includes(root));
      authorizedRoots = [...new Set([...roots.filter(Boolean), ...added])];
      const result = await Promise.all(authorizedRoots.map(scanRoot));
      return result;
    })().finally(() => { scanPromise = null; });
    return scanPromise;
  }

  const inside = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };

  // Raízes lidas e projetos publicados (ainda sem worktrees): basta para abrir a janela.
  // A varredura de cada raiz já começa aqui, para que `readyFor` espere só a dela.
  let initialScan = null;
  const rootsReady = (async () => {
    const resolved = await Promise.all(readRoots().map((root) => fs.promises.realpath(root).catch(() => null)));
    authorizedRoots = [...new Set(resolved.filter(Boolean))];
    for (const root of authorizedRoots) placeholder(root);
    initialScan = Promise.all(authorizedRoots.map(scanRoot));
    scanPromise = initialScan.finally(() => { scanPromise = null; });
  })();
  // Varredura inicial completa, para quem depende de todas as worktrees descobertas.
  const ready = rootsReady.then(() => initialScan);

  const normalize = (value) => (process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value));

  // Espera só o projeto que contém o diretório. Fora das raízes (por exemplo uma
  // worktree ao lado do repositório), espera a varredura inicial completa.
  async function readyFor(cwd) {
    await rootsReady;
    if (typeof cwd === 'string') {
      const target = normalize(cwd);
      const root = authorizedRoots.find((item) => inside(normalize(item), target));
      if (root && rootScans.has(root)) {
        await rootScans.get(root);
        return;
      }
    }
    await ready;
  }

  // Lista imediata: projetos ainda em varredura vêm com `scanning: true` e são
  // atualizados por `onChange` quando terminam.
  ipcMain.handle('project:list', async (event) => {
    if (!isMainSender(event)) return [];
    await rootsReady;
    return [...projects.values()];
  });

  ipcMain.handle('project:refresh', async (event) => {
    if (!isMainSender(event)) return [];
    await ready;
    return scanAll();
  });

  ipcMain.handle('project:add', async (event) => {
    if (!isMainSender(event)) return null;
    await rootsReady;
    const window = getMainWindow();
    const result = await dialog.showOpenDialog(window, {
      title: 'Autorizar pasta de projeto no ATLAS',
      buttonLabel: 'Abrir projeto',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return authorizeRoot(await fs.promises.realpath(result.filePaths[0]));
  });

  // Cadastro de pasta já canonicalizada, pelo diálogo ou por "Abrir no ATLAS" confirmado.
  async function authorizeRoot(root) {
    await rootsReady;
    if (!authorizedRoots.includes(root)) authorizedRoots.push(root);
    saveRoots();
    await scanRoot(root);
    return [...projects.values()];
  }

  return {
    ready,
    rootsReady,
    readyFor,
    authorizeRoot,
    // Projetos já autorizados dentro do caminho: aviso antes de cadastrar uma pasta mais ampla.
    getProjectsInside: (cwd) => {
      const normalize = (value) => (process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value));
      return [...projects.values()].filter((project) => inside(normalize(cwd), normalize(project.path)) && normalize(cwd) !== normalize(project.path));
    },
    // Projeto cuja pasta (ou worktree descoberta) contém o caminho: abrir sem duplicar.
    getProjectContaining: (cwd) => {
      const target = process.platform === 'win32' ? path.resolve(cwd).toLowerCase() : path.resolve(cwd);
      const normalize = (value) => (process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value));
      // Projetos podem ser aninhados: vence o caminho mais específico (mais longo).
      let best = null;
      let bestLength = -1;
      for (const project of projects.values()) {
        const candidates = [project.path, ...project.repositories.flatMap((repository) => repository.worktrees.filter((worktree) => !worktree.statusError).map((worktree) => worktree.path))];
        for (const candidate of candidates) {
          const normalized = normalize(candidate);
          if (inside(normalized, target) && normalized.length > bestLength) {
            best = project;
            bestLength = normalized.length;
          }
        }
      }
      return best;
    },
    // Nova varredura somente leitura, por exemplo depois de criar uma worktree aprovada.
    // Uma varredura já em andamento pode ter começado antes da mudança: espere e repita.
    refresh: async () => {
      if (scanPromise) await scanPromise.catch(() => {});
      return scanAll();
    },
    // Revarre um único projeto, por exemplo depois de criar a worktree de uma tarefa.
    refreshRoot: async (root) => {
      await rootsReady;
      const target = normalize(root);
      const match = authorizedRoots.find((item) => normalize(item) === target);
      if (!match) throw new Error('Projeto fora das pastas autorizadas.');
      return scanRoot(match);
    },
    getProjects: () => [...projects.values()],
    getDefaultCwd: () => authorizedRoots[0] || initialRoot,
    getProjectForCwd: (cwd) => {
      const equal = (left, right) => process.platform === 'win32'
        ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
        : path.resolve(left) === path.resolve(right);
      const all = [...projects.values()];
      return all.find((project) => equal(project.path, cwd))
        || all.find((project) => project.repositories.some((repository) => repository.worktrees.some((worktree) => !worktree.statusError && equal(worktree.path, cwd))));
    },
    isAllowedCwd: (cwd) => {
      if (typeof cwd !== 'string') return false;
      const requested = path.resolve(cwd);
      const allowed = new Set(authorizedRoots.map((root) => path.resolve(root)));
      for (const project of projects.values()) {
        for (const repository of project.repositories) {
          for (const worktree of repository.worktrees) {
            if (!worktree.statusError) allowed.add(path.resolve(worktree.path));
          }
        }
      }
      return process.platform === 'win32'
        ? [...allowed].some((directory) => directory.toLowerCase() === requested.toLowerCase())
        : allowed.has(requested);
    },
  };
}

// Espera só o projeto do diretório; duplos de teste podem expor apenas `ready`.
function waitForCwd(projectHost, cwd) {
  return projectHost.readyFor ? projectHost.readyFor(cwd) : projectHost.ready;
}

module.exports = { createProjectHost, waitForCwd };
