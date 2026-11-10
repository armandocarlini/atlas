// Barra única na janela principal: a barra nativa do sistema sai e os controles de
// minimizar, maximizar e fechar passam a ser desenhados sobre a barra do ATLAS
// (Window Controls Overlay). Pop-ups e Acompanhamento continuam janelas normais.

// Altura dos controles do sistema. Um pixel a menos que a barra de 36px, para o
// filete inferior da barra continuar visível também sob os controles.
const OVERLAY_HEIGHT = 35;
// Superfície e tinta do tema padrão (marfim sobre obsidiana); o renderer as
// substitui pelas cores do tema salvo assim que monta.
const DEFAULT_OVERLAY = Object.freeze({ color: '#121212', symbolColor: '#ece5d8' });
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function usesOverlay(platform = process.platform) {
  return platform === 'win32' || platform === 'linux';
}

function mainWindowChrome(platform = process.platform) {
  if (!usesOverlay(platform)) return { options: {}, query: {} };
  return {
    options: { titleBarStyle: 'hidden', titleBarOverlay: { ...DEFAULT_OVERLAY, height: OVERLAY_HEIGHT } },
    query: { chrome: 'overlay' },
  };
}

function sanitizeOverlay(request) {
  if (!request || typeof request !== 'object') return null;
  const { color, symbolColor } = request;
  if (typeof color !== 'string' || typeof symbolColor !== 'string') return null;
  if (!HEX_COLOR.test(color) || !HEX_COLOR.test(symbolColor)) return null;
  return { color: color.toLowerCase(), symbolColor: symbolColor.toLowerCase(), height: OVERLAY_HEIGHT };
}

function registerWindowChrome({ ipcMain, getMainWindow, platform = process.platform }) {
  ipcMain.handle('window-chrome:set-overlay', (event, request) => {
    const window = getMainWindow();
    if (!usesOverlay(platform) || !window || window.isDestroyed() || event.sender !== window.webContents) return false;
    const overlay = sanitizeOverlay(request);
    if (!overlay) return false;
    window.setTitleBarOverlay(overlay);
    return true;
  });
}

module.exports = { OVERLAY_HEIGHT, DEFAULT_OVERLAY, usesOverlay, mainWindowChrome, sanitizeOverlay, registerWindowChrome };
