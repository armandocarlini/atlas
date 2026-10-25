const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createProjectHost } = require('./project-host.cjs');
const { createTerminalHost } = require('./terminal-host.cjs');

let mainWindow = null;
let panelWindow = null;
let projectHost = null;
let terminalHost = null;
let boundsSaveTimer = null;
const terminalWindows = new Map();

const stateFile = () => path.join(app.getPath('userData'), 'atlas-window-state.json');

function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeWindowState(patch) {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify({ ...readWindowState(), ...patch }, null, 2));
}

function readBounds(kind, fallback) {
  const state = readWindowState();
  const saved = kind.startsWith('terminal:') ? state.terminals?.[kind.slice(9)] : state[kind];
  if (!saved) return fallback;
  return {
    x: Number.isFinite(saved.x) ? saved.x : undefined,
    y: Number.isFinite(saved.y) ? saved.y : undefined,
    width: Math.max(fallback.minWidth || 320, Math.min(Number(saved.width) || fallback.width, 1800)),
    height: Math.max(fallback.minHeight || 420, Math.min(Number(saved.height) || fallback.height, 1400)),
  };
}

function loadRenderer(window, query = {}) {
  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    const url = new URL(devServer);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    window.loadURL(url.toString());
    return;
  }
  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
}

function createSecureWindow(options, query) {
  const window = new BrowserWindow({
    show: false,
    backgroundColor: '#080a0b',
    autoHideMenuBar: true,
    ...options,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show();
  });
  loadRenderer(window, query);
  return window;
}

function getMainWindow() {
  return mainWindow;
}

function getPopupEntry(webContents) {
  return [...terminalWindows.values()].find((entry) => !entry.window.isDestroyed() && entry.window.webContents === webContents);
}

function createMainWindow() {
  mainWindow = createSecureWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 640,
    title: 'ATLAS',
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (panelWindow && !panelWindow.isDestroyed()) panelWindow.close();
    for (const entry of terminalWindows.values()) {
      if (!entry.window.isDestroyed()) entry.window.close();
    }
    terminalHost?.killAll();
  });
}

function persistPanelBounds() {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  writeWindowState({ panels: { ...panelWindow.getBounds(), alwaysOnTop: true } });
}

function createPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show();
    panelWindow.focus();
    return;
  }

  panelWindow = createSecureWindow({
    ...readBounds('panels', { width: 380, height: 660, minWidth: 320, minHeight: 420 }),
    minWidth: 320,
    minHeight: 420,
    title: 'ATLAS — Acompanhamento',
    alwaysOnTop: true,
    maximizable: false,
  }, { window: 'panels' });
  panelWindow.setAlwaysOnTop(true);
  panelWindow.on('move', () => {
    clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(persistPanelBounds, 250);
  });
  panelWindow.on('resize', () => {
    clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(persistPanelBounds, 250);
  });
  panelWindow.on('close', persistPanelBounds);
  panelWindow.on('closed', () => {
    clearTimeout(boundsSaveTimer);
    panelWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('panels:closed');
  });
}

function createTerminalWindow(sessionId, ptyId) {
  const existing = terminalWindows.get(sessionId);
  if (existing && !existing.window.isDestroyed()) {
    existing.window.show();
    existing.window.focus();
    return;
  }

  const key = `terminal:${sessionId}`;
  const window = createSecureWindow({
    ...readBounds(key, { width: 920, height: 620, minWidth: 480, minHeight: 320 }),
    minWidth: 480,
    minHeight: 320,
    title: 'ATLAS — Terminal',
  }, { window: 'terminal', session: sessionId });
  const entry = { window, ptyId, saveTimer: null };
  terminalWindows.set(sessionId, entry);

  const saveBounds = () => {
    if (window.isDestroyed()) return;
    const terminals = { ...(readWindowState().terminals || {}), [sessionId]: window.getBounds() };
    writeWindowState({ terminals });
  };
  const scheduleSave = () => {
    clearTimeout(entry.saveTimer);
    entry.saveTimer = setTimeout(saveBounds, 250);
  };
  window.on('move', scheduleSave);
  window.on('resize', scheduleSave);
  window.on('close', saveBounds);
  window.on('closed', () => {
    clearTimeout(entry.saveTimer);
    terminalWindows.delete(sessionId);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal-window:closed', { sessionId });
  });

  if (ptyId) {
    terminalHost?.setPopupResolver(ptyId, () => {
      const current = terminalWindows.get(sessionId);
      return current && !current.window.isDestroyed() ? current.window.webContents : null;
    });
  }
}

ipcMain.handle('panels:open', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  createPanelWindow();
  return true;
});

ipcMain.handle('panels:close', (event) => {
  const allowed = [mainWindow, panelWindow].some((window) => window && !window.isDestroyed() && event.sender === window.webContents);
  if (!allowed) return false;
  if (panelWindow && !panelWindow.isDestroyed()) panelWindow.close();
  return true;
});

ipcMain.handle('terminal-window:open', (event, { sessionId, ptyId = null } = {}) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || typeof sessionId !== 'string') return false;
  if (ptyId && !terminalHost?.has(ptyId)) return false;
  createTerminalWindow(sessionId, ptyId);
  return true;
});

ipcMain.handle('terminal-window:close', (event, { sessionId } = {}) => {
  const popup = getPopupEntry(event.sender);
  const isMain = mainWindow && event.sender === mainWindow.webContents;
  const id = sessionId || [...terminalWindows.entries()].find(([, entry]) => entry === popup)?.[0];
  if ((!isMain && !popup) || !id) return false;
  if (popup && popup !== terminalWindows.get(id)) return false;
  const entry = terminalWindows.get(id);
  if (entry && !entry.window.isDestroyed()) entry.window.close();
  return true;
});

app.whenReady().then(() => {
  projectHost = createProjectHost({ app, dialog, ipcMain, getMainWindow });
  terminalHost = createTerminalHost({
    ipcMain,
    getMainWindow,
    projectHost,
    getPopupPtyId: (webContents) => getPopupEntry(webContents)?.ptyId || null,
  });
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => terminalHost?.killAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
