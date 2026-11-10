// Barra única em todas as janelas: a barra nativa do sistema sai e os controles de
// minimizar, maximizar e fechar passam a ser desenhados sobre a barra do ATLAS
// (Window Controls Overlay). Na principal, sobre a barra de 36px; no pop-up de terminal,
// sobre o cabeçalho da sessão; no Acompanhamento, sobre a faixa do painel (32px).

// Altura dos controles do sistema por janela. Um pixel a menos que a barra, para o
// filete inferior continuar visível também sob os controles.
const OVERLAY_HEIGHTS = Object.freeze({ main: 35, terminal: 31, panels: 31 });
const OVERLAY_HEIGHT = OVERLAY_HEIGHTS.main;
// Superfície e tinta do tema padrão (marfim sobre obsidiana); o renderer as substitui
// pela cor real da barra de cada janela assim que monta.
const DEFAULT_OVERLAY = Object.freeze({ color: '#121212', symbolColor: '#ece5d8' });
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function usesOverlay(platform = process.platform) {
  return platform === 'win32' || platform === 'linux';
}

function windowChrome(kind = 'main', platform = process.platform) {
  const height = OVERLAY_HEIGHTS[kind];
  if (!usesOverlay(platform) || !height) return { options: {}, query: {} };
  return {
    options: { titleBarStyle: 'hidden', titleBarOverlay: { ...DEFAULT_OVERLAY, height } },
    query: { chrome: 'overlay' },
  };
}

const mainWindowChrome = (platform = process.platform) => windowChrome('main', platform);

function sanitizeOverlay(request, height = OVERLAY_HEIGHT) {
  if (!request || typeof request !== 'object') return null;
  const { color, symbolColor } = request;
  if (typeof color !== 'string' || typeof symbolColor !== 'string') return null;
  if (!HEX_COLOR.test(color) || !HEX_COLOR.test(symbolColor)) return null;
  return { color: color.toLowerCase(), symbolColor: symbolColor.toLowerCase(), height };
}

// findWindow(sender) devolve { window, kind } só para janelas do próprio ATLAS.
function registerWindowChrome({ ipcMain, findWindow, platform = process.platform }) {
  ipcMain.handle('window-chrome:set-overlay', (event, request) => {
    if (!usesOverlay(platform)) return false;
    const entry = findWindow(event.sender);
    const height = OVERLAY_HEIGHTS[entry?.kind];
    if (!entry?.window || entry.window.isDestroyed() || !height) return false;
    const overlay = sanitizeOverlay(request, height);
    if (!overlay) return false;
    entry.window.setTitleBarOverlay(overlay);
    return true;
  });
}

module.exports = { OVERLAY_HEIGHT, OVERLAY_HEIGHTS, DEFAULT_OVERLAY, usesOverlay, windowChrome, mainWindowChrome, sanitizeOverlay, registerWindowChrome };
