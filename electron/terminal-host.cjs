const fs = require('node:fs');
const path = require('node:path');
const { waitForCwd } = require('./project-host.cjs');

function getPowerShellPath() {
  if (process.platform !== 'win32') throw new Error('O primeiro terminal PTY deste marco está disponível apenas no Windows.');
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!fs.existsSync(executable)) throw new Error(`PowerShell não encontrado em ${executable}`);
  return executable;
}

function createTerminalHost({ ipcMain, getMainWindow, projectHost, transport, getShellPath = getPowerShellPath }) {
  const terminals = new Map();
  let shuttingDown = false;
  let restoration = Promise.resolve([]);

  function isMainSender(event) {
    const window = getMainWindow();
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents);
  }

  ipcMain.handle('terminal:defaults', async (event) => {
    if (!isMainSender(event)) return null;
    await (projectHost.rootsReady || projectHost.ready);
    return { cwd: projectHost.getDefaultCwd(), shell: 'Windows PowerShell' };
  });

  async function startTerminal(request, sessionId) {
    await waitForCwd(projectHost, request.cwd);
    if (shuttingDown) throw new Error('O ATLAS está fechando.');
    const cwd = request.cwd || projectHost.getDefaultCwd();
    if (!projectHost.isAllowedCwd(cwd)) throw new Error('Selecione uma pasta autorizada ou uma worktree descoberta.');
    const project = projectHost.getProjectForCwd(cwd);
    if (!project) throw new Error('Projeto não encontrado para a pasta autorizada.');
    const cols = Number.isInteger(request.cols) ? Math.min(500, Math.max(20, request.cols)) : 100;
    const rows = Number.isInteger(request.rows) ? Math.min(200, Math.max(5, request.rows)) : 30;
    const shell = getShellPath();
    const record = transport.spawn({
      file: shell,
      args: ['-NoLogo'],
      cwd,
      cols,
      rows,
      meta: { kind: 'shell', shell },
    });
    const details = {
      id: record.id, sessionId: sessionId ?? record.id, projectId: project.id, cwd,
      name: typeof request.name === 'string' ? request.name.trim() || 'terminal-local' : 'terminal-local',
      shell: 'Windows PowerShell',
    };
    terminals.set(details.sessionId, { details, record });
    return details;
  }

  ipcMain.handle('terminal:create', (event, request = {}) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a criar terminais.');
    return startTerminal(request);
  });

  ipcMain.handle('terminal:list', async (event) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a listar terminais.');
    const failed = await restoration;
    return {
      terminals: [...terminals.values()].map(({ details, record }) => ({ ...details, exit: record.exit, stopping: record.closing && !record.exit })),
      failed,
    };
  });

  ipcMain.handle('terminal:remove', (event, sessionId) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a excluir terminais.');
    const terminal = terminals.get(sessionId);
    if (!terminal) return false;
    if (!terminal.record.exit) throw new Error('Encerre o terminal antes de excluí-lo.');
    transport.forget(terminal.record.id);
    return terminals.delete(sessionId);
  });

  return {
    isMainSender,
    snapshotForQuit() {
      shuttingDown = true;
      const snapshot = [];
      for (const { details: { sessionId, cwd, name }, record } of terminals.values()) {
        if (!record.exit && !record.closing) snapshot.push({ sessionId, cwd, name });
      }
      terminals.clear();
      return snapshot;
    },
    restoreTerminals(saved) {
      shuttingDown = false;
      restoration = (async () => {
        const failed = [];
        for (const { sessionId, name, cwd } of saved) {
          try {
            await startTerminal({ name, cwd }, sessionId);
          } catch (error) {
            failed.push({ name, error: error.message });
          }
        }
        return failed;
      })();
    },
  };
}

module.exports = { createTerminalHost };
