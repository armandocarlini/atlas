const { contextBridge, ipcRenderer } = require('electron');

const query = new URLSearchParams(window.location.search);
const windowKind = query.get('window') || 'main';

function subscribe(channel, callback, filter = () => true) {
  const listener = (_event, payload) => {
    if (filter(payload)) callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('atlasDesktop', {
  isDesktop: true,
  windowKind,
  sessionId: query.get('session'),
  openPanels: () => ipcRenderer.invoke('panels:open'),
  closePanels: () => ipcRenderer.invoke('panels:close'),
  onPanelsClosed: (callback) => subscribe('panels:closed', callback),
  listProjects: () => ipcRenderer.invoke('project:list'),
  addProject: () => ipcRenderer.invoke('project:add'),
  refreshProjects: () => ipcRenderer.invoke('project:refresh'),
  getTerminalDefaults: () => ipcRenderer.invoke('terminal:defaults'),
  createTerminal: (request) => ipcRenderer.invoke('terminal:create', request),
  attachTerminal: (terminalId) => ipcRenderer.invoke('terminal:attach', terminalId),
  writeTerminal: (terminalId, data) => ipcRenderer.send('terminal:write', { terminalId, data }),
  resizeTerminal: (terminalId, cols, rows) => ipcRenderer.send('terminal:resize', { terminalId, cols, rows }),
  closePty: (terminalId) => ipcRenderer.send('terminal:close', { terminalId }),
  onTerminalData: (terminalId, callback) => subscribe('terminal:data', callback, (payload) => payload?.terminalId === terminalId),
  onTerminalExit: (terminalId, callback) => subscribe('terminal:exit', callback, (payload) => payload?.terminalId === terminalId),
  openTerminalWindow: (sessionId, ptyId) => ipcRenderer.invoke('terminal-window:open', { sessionId, ptyId }),
  closeTerminalWindow: (sessionId) => ipcRenderer.invoke('terminal-window:close', { sessionId }),
  onTerminalWindowClosed: (callback) => subscribe('terminal-window:closed', callback),
});
