// Test-only entry point: isolated preferences and native window controls.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const http = require('node:http');
const path = require('node:path');

if (!process.env.ATLAS_SMOKE_PROFILE) throw new Error('Missing isolated smoke profile');
app.setPath('userData', process.env.ATLAS_SMOKE_PROFILE);
// O pop-up "sempre no topo" encobre a janela principal; com a detecção de oclusão
// do Windows o Chromium para de produzir quadros nela e Page.captureScreenshot fica
// esperando (o CDP timeout intermitente visto duas vezes logo após esse passo). Só no smoke.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
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

// Segunda instância de "Abrir no ATLAS": só repassa argumentos e encerra, sem porta de controle.
const secondInstance = process.env.ATLAS_SMOKE_SECOND_INSTANCE === '1';
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
    // Reenvia um aviso do processo principal à janela (somente teste).
    if (command.action === 'send') window.webContents.send(command.channel, command.payload);
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
});
// Smokes ficam ociosos enquanto rodam CLIs reais; o keep-alive padrão (5 s) fechava o
// socket que o fetch seguinte reaproveitava, e a chamada falhava com ECONNRESET.
server.keepAliveTimeout = 10 * 60 * 1000;
server.headersTimeout = server.keepAliveTimeout + 1000;
if (!secondInstance) server.listen(Number(process.env.ATLAS_SMOKE_CONTROL_PORT), '127.0.0.1');
app.on('will-quit', () => server.close());
if (process.env.ATLAS_SMOKE_NO_CLI === '1') {
  const adapters = require('../electron/agent-adapters.cjs');
  // CLIs "detectados" com executáveis inexistentes: a escolha de CLI e modelo é
  // exercitada de verdade e o início falha de forma honesta, sem modelo real. A
  // lista do OpenCode demora para reproduzir respostas fora de ordem.
  adapters.discoverAdapters = async () => adapters.ADAPTERS.map((adapter) => ({ ...adapter, status: 'available', executable: path.join(process.env.ATLAS_SMOKE_PROFILE, 'cli-ausente', `${adapter.command}.exe`), version: '0.0.0-fixture', error: null }));
  adapters.listModels = async (adapter) => {
    if (adapter.id !== 'opencode') return [];
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return ['fixture/modelo-rapido', 'fixture/modelo-forte'];
  };
}
require('../electron/main.cjs');
