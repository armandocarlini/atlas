const path = require('node:path');
const config = require('./kimi-mcp-config.cjs');

// IPC da integração MCP do ATLAS com o Kimi Code e o Gemini CLI. Instalar ou
// remover exige confirmação explícita vinda do diálogo de consentimento da janela principal.
function createIntegrationHost({ ipcMain, isMainSender, execPath = process.execPath, bridgePath = config.bridgePathFor(__dirname), env = process.env }) {
  const entry = config.atlasEntry({ execPath, bridgePath });
  const targets = {
    kimi: { name: 'Kimi', entry, location: () => ({ home: config.kimiHome(env) }) },
    gemini: { name: 'Gemini', entry: config.geminiEntry({ execPath, bridgePath }), location: () => ({ file: config.geminiSettingsFile(env) }) },
  };

  for (const [cli, target] of Object.entries(targets)) {
    const entryText = JSON.stringify({ mcpServers: { [config.SERVER_NAME]: target.entry } }, null, 2);
    const describe = (status) => ({ state: status.state, file: status.file, serverName: status.serverName, error: status.error || null, entryText });
    const guard = (event, request, action) => {
      if (!isMainSender(event)) throw new Error(`Janela não autorizada a alterar a integração do ${target.name}.`);
      if (action && request?.confirm !== true) throw new Error(`Confirme no diálogo antes de ${action} a integração.`);
    };
    const args = () => ({ ...target.location(), entry: target.entry });
    ipcMain.handle(`integration:${cli}-mcp-status`, (event) => {
      guard(event);
      return describe(config.getStatus(args()));
    });
    ipcMain.handle(`integration:${cli}-mcp-install`, (event, request) => {
      guard(event, request, 'conectar');
      return describe(config.install(args()));
    });
    ipcMain.handle(`integration:${cli}-mcp-remove`, (event, request) => {
      guard(event, request, 'remover');
      return describe(config.remove(args()));
    });
  }

  return { entry };
}

module.exports = { createIntegrationHost };
