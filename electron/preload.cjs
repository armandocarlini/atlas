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
  listAdapters: () => ipcRenderer.invoke('agent:list-adapters'),
  onProjectChanged: (callback) => subscribe('project:changed', callback),
  listAgentModels: (request) => ipcRenderer.invoke('agent:list-models', request),
  createAgent: (request) => ipcRenderer.invoke('agent:create', request),
  listAgents: () => ipcRenderer.invoke('agent:list'),
  openOrchestrator: (request) => ipcRenderer.invoke('agent:open-orchestrator', request),
  listTasks: (request) => ipcRenderer.invoke('task:list', request),
  createTask: (request) => ipcRenderer.invoke('task:create', request),
  cancelHandoff: (request) => ipcRenderer.invoke('task:cancel-handoff', request),
  releaseTask: (request) => ipcRenderer.invoke('task:release', request),
  decideReview: (request) => ipcRenderer.invoke('task:review-decide', request),
  onTasksChanged: (callback) => subscribe('task:changed', callback),
  sendMessage: (request) => ipcRenderer.invoke('message:send', request),
  listMessages: (request) => ipcRenderer.invoke('message:list', request),
  markMessageRead: (request) => ipcRenderer.invoke('message:mark-read', request),
  onAtlasToolsConnection: (callback) => subscribe('agent:atlas-tools', callback),
  getKimiIntegration: () => ipcRenderer.invoke('integration:kimi-mcp-status'),
  installKimiIntegration: (request) => ipcRenderer.invoke('integration:kimi-mcp-install', request),
  removeKimiIntegration: (request) => ipcRenderer.invoke('integration:kimi-mcp-remove', request),
  listAgentRequests: (request) => ipcRenderer.invoke('agent-request:list', request),
  approveAgentRequest: (request) => ipcRenderer.invoke('agent-request:approve', request),
  rejectAgentRequest: (request) => ipcRenderer.invoke('agent-request:reject', request),
  onAgentRequestsChanged: (callback) => subscribe('agent-request:changed', callback),
  listAgentFunctions: () => ipcRenderer.invoke('agent-function:list'),
  createAgentFunction: (request) => ipcRenderer.invoke('agent-function:create', request),
  updateAgentFunction: (request) => ipcRenderer.invoke('agent-function:update', request),
  deleteAgentFunction: (request) => ipcRenderer.invoke('agent-function:delete', request),
  onAgentFunctionsChanged: (callback) => subscribe('agent-function:changed', callback),
  takeOpenPath: () => ipcRenderer.invoke('open-path:take'),
  authorizeOpenPath: (request) => ipcRenderer.invoke('open-path:authorize', request),
  dismissOpenPath: (request) => ipcRenderer.invoke('open-path:dismiss', request),
  onOpenPathRequested: (callback) => subscribe('open-path:requested', callback),
  getExplorerIntegration: () => ipcRenderer.invoke('explorer:status'),
  installExplorerIntegration: (request) => ipcRenderer.invoke('explorer:install', request),
  removeExplorerIntegration: (request) => ipcRenderer.invoke('explorer:remove', request),
});
