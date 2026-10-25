const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const pty = require('node-pty');

const SCROLLBACK_LIMIT = 512 * 1024;

function createTerminalHost({ ipcMain, getMainWindow, getPopupPtyId, projectHost }) {
  const terminals = new Map();

  function isMainSender(event) {
    const window = getMainWindow();
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents);
  }

  function canAccess(event, terminalId) {
    return isMainSender(event) || getPopupPtyId(event.sender) === terminalId;
  }

  function targets(terminalId) {
    const result = [];
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) result.push(mainWindow.webContents);
    return { main: mainWindow, result };
  }

  function send(record, channel, payload) {
    const { main } = targets(record.id);
    if (main && !main.webContents.isDestroyed()) main.webContents.send(channel, payload);
    if (typeof record.getPopupWebContents === 'function') {
      const popup = record.getPopupWebContents();
      if (popup && !popup.isDestroyed()) popup.send(channel, payload);
    }
  }

  function getPowerShellPath() {
    if (process.platform !== 'win32') throw new Error('O primeiro terminal PTY deste marco está disponível apenas no Windows.');
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (!fs.existsSync(executable)) throw new Error(`PowerShell não encontrado em ${executable}`);
    return executable;
  }

  ipcMain.handle('terminal:defaults', async (event) => {
    if (!isMainSender(event)) return null;
    await projectHost.ready;
    return { cwd: projectHost.getDefaultCwd(), shell: 'Windows PowerShell' };
  });

  ipcMain.handle('terminal:create', async (event, request = {}) => {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a criar terminais.');
    await projectHost.ready;
    const cwd = request.cwd || projectHost.getDefaultCwd();
    if (!projectHost.isAllowedCwd(cwd)) throw new Error('Selecione uma pasta autorizada ou uma worktree descoberta.');
    const cols = Number.isInteger(request.cols) ? Math.min(500, Math.max(20, request.cols)) : 100;
    const rows = Number.isInteger(request.rows) ? Math.min(200, Math.max(5, request.rows)) : 30;
    const shell = getPowerShellPath();
    const id = randomUUID();
    const process = pty.spawn(shell, ['-NoLogo'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      // The bundled ConPTY closes the session without racing a console-list helper.
      useConptyDll: true,
      env: { ...global.process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    const record = {
      id,
      process,
      cwd,
      shell,
      sequence: 0,
      scrollback: '',
      exit: null,
      closing: false,
      getPopupWebContents: null,
    };
    terminals.set(id, record);

    process.onData((data) => {
      record.sequence += 1;
      record.scrollback = (record.scrollback + data).slice(-SCROLLBACK_LIMIT);
      send(record, 'terminal:data', { terminalId: id, sequence: record.sequence, data });
    });
    process.onExit(({ exitCode, signal }) => {
      record.exit = { exitCode, signal };
      send(record, 'terminal:exit', { terminalId: id, ...record.exit });
    });

    return { id, cwd, shell: 'Windows PowerShell' };
  });

  ipcMain.handle('terminal:attach', (event, terminalId) => {
    const record = terminals.get(terminalId);
    if (!record || !canAccess(event, terminalId)) throw new Error('Terminal não encontrado ou não autorizado.');
    return {
      cwd: record.cwd,
      shell: record.shell,
      scrollback: record.scrollback,
      cursor: record.sequence,
      exit: record.exit,
    };
  });

  ipcMain.on('terminal:write', (event, { terminalId, data } = {}) => {
    const record = terminals.get(terminalId);
    if (!record || record.exit || record.closing || !canAccess(event, terminalId) || typeof data !== 'string') return;
    record.process.write(data);
  });

  ipcMain.on('terminal:resize', (event, { terminalId, cols, rows } = {}) => {
    const record = terminals.get(terminalId);
    if (!record || record.exit || !canAccess(event, terminalId)) return;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || rows < 5 || cols > 500 || rows > 200) return;
    try {
      record.process.resize(cols, rows);
    } catch { /* O processo pode terminar entre a validação e o resize. */ }
  });

  ipcMain.on('terminal:close', (event, { terminalId } = {}) => {
    const record = terminals.get(terminalId);
    if (!record || !canAccess(event, terminalId)) return;
    closeTerminal(record);
  });

  function closeTerminal(record) {
    if (record.exit || record.closing) return;
    record.closing = true;
    try { record.process.kill(); } catch { record.closing = false; }
  }

  return {
    setPopupResolver(terminalId, resolver) {
      const record = terminals.get(terminalId);
      if (record) record.getPopupWebContents = resolver;
    },
    has: (terminalId) => terminals.has(terminalId),
    killAll() {
      for (const record of terminals.values()) {
        closeTerminal(record);
      }
      terminals.clear();
    },
  };
}

module.exports = { createTerminalHost };
