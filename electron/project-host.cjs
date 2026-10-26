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
      const roots = await Promise.all(authorizedRoots.map(async (root) => {
        try {
          return await fs.promises.realpath(root);
        } catch {
          return null;
        }
      }));
      authorizedRoots = [...new Set(roots.filter(Boolean))];
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
    const root = await fs.promises.realpath(result.filePaths[0]);
    if (!authorizedRoots.includes(root)) authorizedRoots.push(root);
    saveRoots();
    await scanRoot(root);
    return [...projects.values()];
  });

  return {
    ready,
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
