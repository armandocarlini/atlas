const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  // O atalho de colar imagem repassado ao CLI depende do sistema (src/terminal-clipboard.js).
  platform: process.platform,
  // 'overlay': a barra nativa saiu e os controles da janela ficam sobre a barra do ATLAS
  // (principal, pop-up de terminal e Acompanhamento).
  windowChrome: query.get('chrome') === 'overlay' ? 'overlay' : 'native',
  setTitleBarOverlay: (colors) => ipcRenderer.invoke('window-chrome:set-overlay', colors),
  sessionId: query.get('session'),
  openPanels: () => ipcRenderer.invoke('panels:open'),
  closePanels: () => ipcRenderer.invoke('panels:close'),
  onPanelsClosed: (callback) => subscribe('panels:closed', callback),
  listProjects: () => ipcRenderer.invoke('project:list'),
  addProject: () => ipcRenderer.invoke('project:add'),
  refreshProjects: () => ipcRenderer.invoke('project:refresh'),
  getTerminalDefaults: () => ipcRenderer.invoke('terminal:defaults'),
  createTerminal: (request) => ipcRenderer.invoke('terminal:create', request),
  listTerminals: () => ipcRenderer.invoke('terminal:list'),
  attachTerminal: (terminalId) => ipcRenderer.invoke('terminal:attach', terminalId),
  writeTerminal: (terminalId, data) => ipcRenderer.send('terminal:write', { terminalId, data }),
  resizeTerminal: (terminalId, cols, rows) => ipcRenderer.send('terminal:resize', { terminalId, cols, rows }),
  pasteTerminal: (terminalId, text) => ipcRenderer.invoke('terminal:paste', { terminalId, text }),
  getTerminalInputMode: (terminalId) => ipcRenderer.invoke('terminal:input-mode', terminalId),
  // Clipboard dos terminais: o renderer lê só o que a colagem usa e grava só texto.
  readClipboardForPaste: () => ipcRenderer.invoke('clipboard:read-paste'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  // Arquivo arrastado do Explorer: só o caminho, nunca o conteúdo.
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ''; } catch { return ''; }
  },
  closePty: (terminalId) => ipcRenderer.send('terminal:close', { terminalId }),
  stopPty: (terminalId) => ipcRenderer.invoke('terminal:stop', terminalId),
  removeTerminal: (sessionId) => ipcRenderer.invoke('terminal:remove', sessionId),
  onPtyExit: (callback) => subscribe('terminal:exit', callback),
  onTerminalData: (terminalId, callback) => subscribe('terminal:data', callback, (payload) => payload?.terminalId === terminalId),
  onTerminalExit: (terminalId, callback) => subscribe('terminal:exit', callback, (payload) => payload?.terminalId === terminalId),
  openTerminalWindow: (sessionId, ptyId) => ipcRenderer.invoke('terminal-window:open', { sessionId, ptyId }),
  closeTerminalWindow: (sessionId) => ipcRenderer.invoke('terminal-window:close', { sessionId }),
  onTerminalWindowClosed: (callback) => subscribe('terminal-window:closed', callback),
  listAdapters: () => ipcRenderer.invoke('agent:list-adapters'),
  onProjectChanged: (callback) => subscribe('project:changed', callback),
  listAgentModels: (request) => ipcRenderer.invoke('agent:list-models', request),
  createAgent: (request) => ipcRenderer.invoke('agent:create', request),
  setAgentFunction: (request) => ipcRenderer.invoke('agent:set-function', request),
  declareAgentModel: (request) => ipcRenderer.invoke('agent:declare-model', request),
  getRegressionSuite: (request) => ipcRenderer.invoke('regression-suite:get', request),
  setRegressionSuite: (request) => ipcRenderer.invoke('regression-suite:set', request),
  getRegressionRun: (request) => ipcRenderer.invoke('regression-run:get', request),
  cancelRegressionRun: (request) => ipcRenderer.invoke('regression-run:cancel', request),
  openRegressionLog: (request) => ipcRenderer.invoke('regression-run:open-log', request),
  listAgents: () => ipcRenderer.invoke('agent:list'),
  removeAgent: (sessionId) => ipcRenderer.invoke('agent:remove', sessionId),
  // Retomada ao reabrir: estado (pendente ou resultado) e aviso de quando termina.
  getRestoreStatus: () => ipcRenderer.invoke('agent:restore-status'),
  onAgentsRestored: (callback) => subscribe('agent:restored', callback),
  openOrchestrator: (request) => ipcRenderer.invoke('agent:open-orchestrator', request),
  getOrchestratorMode: (request) => ipcRenderer.invoke('agent:orchestrator-mode', request),
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
  getGeminiIntegration: () => ipcRenderer.invoke('integration:gemini-mcp-status'),
  installGeminiIntegration: (request) => ipcRenderer.invoke('integration:gemini-mcp-install', request),
  removeGeminiIntegration: (request) => ipcRenderer.invoke('integration:gemini-mcp-remove', request),
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
