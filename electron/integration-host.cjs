const path = require('node:path');
const config = require('./kimi-mcp-config.cjs');

// IPC da integração MCP do ATLAS com o Kimi Code. Instalar ou remover exige
// confirmação explícita vinda do diálogo de consentimento da janela principal.
function createIntegrationHost({ ipcMain, isMainSender, execPath = process.execPath, bridgePath = path.join(__dirname, config.BRIDGE_FILE), env = process.env }) {
  const entry = config.atlasEntry({ execPath, bridgePath });
  const entryText = JSON.stringify({ mcpServers: { [config.SERVER_NAME]: entry } }, null, 2);

  function describe(status) {
    return { state: status.state, file: status.file, serverName: status.serverName, error: status.error || null, entryText };
  }

  function guard(event, request, action) {
    if (!isMainSender(event)) throw new Error('Janela não autorizada a alterar a integração do Kimi.');
    if (action && request?.confirm !== true) throw new Error(`Confirme no diálogo antes de ${action} a integração.`);
  }

  ipcMain.handle('integration:kimi-mcp-status', (event) => {
    guard(event);
    return describe(config.getStatus({ home: config.kimiHome(env), entry }));
  });
  ipcMain.handle('integration:kimi-mcp-install', (event, request) => {
    guard(event, request, 'conectar');
    return describe(config.install({ home: config.kimiHome(env), entry }));
  });
  ipcMain.handle('integration:kimi-mcp-remove', (event, request) => {
    guard(event, request, 'remover');
    return describe(config.remove({ home: config.kimiHome(env), entry }));
  });

  return { entry };
}

module.exports = { createIntegrationHost };
