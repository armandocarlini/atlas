// Test-only entry point: isolated preferences and native window controls.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const http = require('node:http');

if (!process.env.ATLAS_SMOKE_PROFILE) throw new Error('Missing isolated smoke profile');
app.setPath('userData', process.env.ATLAS_SMOKE_PROFILE);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [process.env.ATLAS_SMOKE_PROJECT] });
const terminals = [];
let defaultsResolved = false;
const ipcHandlers = new Map();
const ipcListeners = new Map();
const registerOn = ipcMain.on.bind(ipcMain);
ipcMain.on = (channel, handler) => {
  ipcListeners.set(channel, handler);
  return registerOn(channel, handler);
};
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  ipcHandlers.set(channel, handler);
  return register(channel, async (...args) => {
  const result = await handler(...args);
  if (channel === 'terminal:defaults') {
    // Exercise selecting a project while initial hydration is still pending.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    defaultsResolved = true;
  }
  if (channel === 'terminal:create') terminals.push(result);
  return result;
  });
};

const server = http.createServer(async (request, response) => {
  if (request.headers.authorization !== process.env.ATLAS_SMOKE_TOKEN) {
    response.writeHead(403).end();
    return;
  }
  let body = '';
  for await (const chunk of request) body += chunk;
  const command = JSON.parse(body);
  try {
    const windows = BrowserWindow.getAllWindows();
    const window = windows.find((candidate) => command.session
      ? candidate.webContents.getURL().includes(`session=${command.session}`)
      : command.kind === 'panels' ? candidate.webContents.getURL().includes('window=panels')
        : !candidate.webContents.getURL().includes('window='));
    let result = null;
    if (command.action === 'windows') result = windows.map((item) => ({ url: item.webContents.getURL(), bounds: item.getBounds(), alwaysOnTop: item.isAlwaysOnTop() }));
    if (command.action === 'terminals') result = terminals;
    if (command.action === 'defaults-resolved') result = defaultsResolved;
    if (command.action === 'focus') { window.restore(); window.show(); window.focus(); }
    if (command.action === 'resize') { window.setSize(command.width, command.height); result = window.getContentBounds(); }
    if (command.action === 'invoke') {
      // Invoca um handler IPC como se fosse a janela principal (somente teste).
      const mainWindow = windows.find((candidate) => !candidate.webContents.getURL().includes('window='));
      const event = { sender: mainWindow.webContents };
      const target = ipcHandlers.get(command.channel) || ipcListeners.get(command.channel);
      if (!target) throw new Error(`Canal IPC não registrado: ${command.channel}`);
      result = await target(event, ...(command.args || []));
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ result }));
    if (command.action === 'quit') setImmediate(() => app.quit());
  } catch (error) {
    response.end(JSON.stringify({ error: error.message }));
  }
}).listen(Number(process.env.ATLAS_SMOKE_CONTROL_PORT), '127.0.0.1');
app.on('will-quit', () => server.close());
if (process.env.ATLAS_SMOKE_NO_CLI === '1') {
  const adapters = require('../electron/agent-adapters.cjs');
  adapters.discoverAdapters = async () => adapters.ADAPTERS.map((adapter) => ({ ...adapter, status: 'unavailable', executable: null, version: null, error: 'CLI ausente na fixture determinística.' }));
}
require('../electron/main.cjs');
