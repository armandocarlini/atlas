const { randomUUID } = require('node:crypto');
const pty = require('node-pty');

const SCROLLBACK_LIMIT = 512 * 1024;

// Transporte PTY compartilhado entre terminais de shell e sessões de agente.
// Mantém scrollback apenas em memória, sequencia os chunks e roteia a saída
// para a janela principal e para um eventual pop-up nativo.
function createPtyTransport({ getMainWindow }) {
  const records = new Map();

  function send(record, channel, payload) {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channel, payload);
    if (typeof record.getPopupWebContents === 'function') {
      const popup = record.getPopupWebContents();
      if (popup && !popup.isDestroyed()) popup.send(channel, payload);
    }
  }

  function spawn({ file, args, cwd, cols = 100, rows = 30, env = {}, meta = {} }) {
    const id = randomUUID();
    const process = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      // The bundled ConPTY closes the session without racing a console-list helper.
      useConptyDll: true,
      env: { ...global.process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...env },
    });
    const record = {
      id,
      process,
      cwd,
      meta,
      sequence: 0,
      scrollback: '',
      exit: null,
      closing: false,
      getPopupWebContents: null,
    };
    records.set(id, record);

    process.onData((data) => {
      record.sequence += 1;
      record.scrollback = (record.scrollback + data).slice(-SCROLLBACK_LIMIT);
      send(record, 'terminal:data', { terminalId: id, sequence: record.sequence, data });
    });
    process.onExit(({ exitCode, signal }) => {
      record.exit = { exitCode, signal };
      send(record, 'terminal:exit', { terminalId: id, ...record.exit });
    });
    return record;
  }

  function close(record) {
    if (record.exit || record.closing) return;
    record.closing = true;
    try { record.process.kill(); } catch { record.closing = false; }
  }

  return {
    spawn,
    close,
    get: (id) => records.get(id),
    has: (id) => records.has(id),
    setPopupResolver(id, resolver) {
      const record = records.get(id);
      if (record) record.getPopupWebContents = resolver;
    },
    killAll() {
      for (const record of records.values()) close(record);
      records.clear();
    },
  };
}

// Registra os canais de transporte (attach/write/resize/close) uma única vez.
// Valem para qualquer PTY do registro: shells e sessões de agente.
function registerTransportChannels({ ipcMain, transport, isMainSender, getPopupPtyId }) {
  function canAccess(event, terminalId) {
    return isMainSender(event) || getPopupPtyId(event.sender) === terminalId;
  }

  ipcMain.handle('terminal:attach', (event, terminalId) => {
    const record = transport.get(terminalId);
    if (!record || !canAccess(event, terminalId)) throw new Error('Terminal não encontrado ou não autorizado.');
    return {
      cwd: record.cwd,
      shell: record.meta.shell || record.meta.cli || 'terminal',
      scrollback: record.scrollback,
      cursor: record.sequence,
      exit: record.exit,
    };
  });

  ipcMain.on('terminal:write', (event, { terminalId, data } = {}) => {
    const record = transport.get(terminalId);
    if (!record || record.exit || record.closing || !canAccess(event, terminalId) || typeof data !== 'string') return;
    record.process.write(data);
  });

  ipcMain.on('terminal:resize', (event, { terminalId, cols, rows } = {}) => {
    const record = transport.get(terminalId);
    if (!record || record.exit || !canAccess(event, terminalId)) return;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || rows < 5 || cols > 500 || rows > 200) return;
    try {
      record.process.resize(cols, rows);
    } catch { /* O processo pode terminar entre a validação e o resize. */ }
  });

  ipcMain.on('terminal:close', (event, { terminalId } = {}) => {
    const record = transport.get(terminalId);
    if (!record || !canAccess(event, terminalId)) return;
    transport.close(record);
  });
}

module.exports = { createPtyTransport, registerTransportChannels };
