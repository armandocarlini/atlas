const fs = require('node:fs');
const path = require('node:path');
const { waitForCwd } = require('./project-host.cjs');

function getPowerShellPath() {
  if (process.platform !== 'win32') throw new Error('O primeiro terminal PTY deste marco está disponível apenas no Windows.');
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!fs.existsSync(executable)) throw new Error(`PowerShell não encontrado em ${executable}`);
  return executable;
}

function createTerminalHost({ ipcMain, getMainWindow, projectHost, transport }) {
  function isMainSender(event) {
    const window = getMainWindow();
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents);
  }

  ipcMain.handle('terminal:defaults', async (event) => {
    if (!isMainSender(event)) return null;
    await (projectHost.rootsReady || projectHost.ready);
    return { cwd: projectHost.getDefaultCwd(), shell: 'Windows PowerShell' };
  });

  ipcMain.handle('terminal:create', async (event, request = {}) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a criar terminais.');
    await waitForCwd(projectHost, request.cwd);
    const cwd = request.cwd || projectHost.getDefaultCwd();
    if (!projectHost.isAllowedCwd(cwd)) throw new Error('Selecione uma pasta autorizada ou uma worktree descoberta.');
    const cols = Number.isInteger(request.cols) ? Math.min(500, Math.max(20, request.cols)) : 100;
    const rows = Number.isInteger(request.rows) ? Math.min(200, Math.max(5, request.rows)) : 30;
    const shell = getPowerShellPath();
    const record = transport.spawn({
      file: shell,
      args: ['-NoLogo'],
      cwd,
      cols,
      rows,
      meta: { kind: 'shell', shell },
    });
    return { id: record.id, cwd, shell: 'Windows PowerShell' };
  });

  return { isMainSender };
}

module.exports = { createTerminalHost };
