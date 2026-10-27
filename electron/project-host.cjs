const fs = require('node:fs');
const path = require('node:path');
const { discoverRepositories, idFor } = require('./git-discovery.cjs');

function createProjectHost({ app, dialog, ipcMain, getMainWindow, store }) {
  const settingsFile = path.join(app.getPath('userData'), 'atlas-projects.json');
  const initialRoot = process.cwd();
  const projects = new Map();
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

  async function scanRoot(root) {
    const project = { id: idFor(root), name: path.basename(root), path: root, repositories: [], errors: [], truncated: false, scannedAt: null };
    store?.registerProject(project);
    try {
      const result = await discoverRepositories(root);
      Object.assign(project, result, { scannedAt: new Date().toISOString() });
    } catch (error) {
      project.errors = [{ path: root, message: error.message }];
    }
    projects.set(project.id, project);
    return project;
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

  const ready = (async () => {
    authorizedRoots = readRoots();
    await scanAll();
  })();

  ipcMain.handle('project:list', async (event) => {
    if (!isMainSender(event)) return [];
    await ready;
    return scanAll();
  });

  ipcMain.handle('project:refresh', async (event) => {
    if (!isMainSender(event)) return [];
    await ready;
    return scanAll();
  });

  ipcMain.handle('project:add', async (event) => {
    if (!isMainSender(event)) return null;
    await ready;
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
    await ready;
    if (!authorizedRoots.includes(root)) authorizedRoots.push(root);
    saveRoots();
    await scanRoot(root);
    return [...projects.values()];
  }

  const inside = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };

  return {
    ready,
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

module.exports = { createProjectHost };
