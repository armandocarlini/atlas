import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { appearanceTokens } from '../src/appearance.js';

const require = createRequire(import.meta.url);
const { OVERLAY_HEIGHT, OVERLAY_HEIGHTS, DEFAULT_OVERLAY, windowChrome, mainWindowChrome, sanitizeOverlay, registerWindowChrome } = require('../electron/window-chrome.cjs');

test('Windows e Linux trocam a barra nativa pelos controles sobre a barra do ATLAS', () => {
  for (const platform of ['win32', 'linux']) {
    const chrome = mainWindowChrome(platform);
    assert.equal(chrome.options.titleBarStyle, 'hidden');
    assert.deepEqual(chrome.options.titleBarOverlay, { ...DEFAULT_OVERLAY, height: OVERLAY_HEIGHT });
    assert.deepEqual(chrome.query, { chrome: 'overlay' });
  }
});

test('macOS mantém a barra nativa, sem overlay nem marca na URL', () => {
  assert.deepEqual(mainWindowChrome('darwin'), { options: {}, query: {} });
});

test('os controles ficam 1px abaixo da barra de 36px para o filete inferior continuar visível', () => {
  assert.equal(OVERLAY_HEIGHT, 35);
});

test('a cor inicial dos controles é a superfície e a tinta do tema padrão', () => {
  const tokens = appearanceTokens({ background: '#09090a', color: '#e6dcc8' });
  assert.equal(DEFAULT_OVERLAY.color, tokens['--surface']);
  assert.equal(DEFAULT_OVERLAY.symbolColor, tokens['--text']);
});

test('só cores hexadecimais completas chegam ao overlay', () => {
  assert.deepEqual(sanitizeOverlay({ color: '#ABCDEF', symbolColor: '#123456' }), { color: '#abcdef', symbolColor: '#123456', height: OVERLAY_HEIGHT });
  for (const request of [null, 'x', {}, { color: '#abc', symbolColor: '#123456' }, { color: 'red', symbolColor: '#123456' },
    { color: '#abcdef', symbolColor: 'url(javascript:1)' }, { color: '#abcdef', symbolColor: 0x123456 }, { color: '#abcdef;', symbolColor: '#123456' }]) {
    assert.equal(sanitizeOverlay(request), null, JSON.stringify(request));
  }
});

function fakeIpc() {
  const handlers = new Map();
  return { handlers, handle: (channel, handler) => handlers.set(channel, handler) };
}

function fakeWindow() {
  const calls = [];
  return { calls, webContents: {}, isDestroyed: () => false, setTitleBarOverlay: (overlay) => calls.push(overlay) };
}

test('pop-up de terminal e Acompanhamento também perdem a barra nativa, com controles de 31px', () => {
  for (const kind of ['terminal', 'panels']) {
    const chrome = windowChrome(kind, 'win32');
    assert.equal(chrome.options.titleBarStyle, 'hidden');
    assert.equal(chrome.options.titleBarOverlay.height, 31, `${kind}: barra de 32px menos o filete`);
    assert.deepEqual(chrome.query, { chrome: 'overlay' });
  }
  assert.deepEqual(OVERLAY_HEIGHTS, { main: 35, terminal: 31, panels: 31 });
  assert.deepEqual(windowChrome('terminal', 'darwin'), { options: {}, query: {} }, 'macOS mantém a barra nativa');
  assert.deepEqual(windowChrome('desconhecida', 'win32'), { options: {}, query: {} }, 'janela sem barra prevista fica nativa');
});


function register(entries, platform = 'win32') {
  const ipcMain = fakeIpc();
  registerWindowChrome({ ipcMain, platform, findWindow: (sender) => entries.find((entry) => entry.window.webContents === sender) || null });
  return ipcMain.handlers.get('window-chrome:set-overlay');
}

test('cada janela do ATLAS recolore só os próprios controles, na altura dela', () => {
  const main = fakeWindow();
  const popup = fakeWindow();
  const panels = fakeWindow();
  const handler = register([{ window: main, kind: 'main' }, { window: popup, kind: 'terminal' }, { window: panels, kind: 'panels' }]);
  assert.equal(handler({ sender: main.webContents }, { color: '#202020', symbolColor: '#ffffff' }), true);
  assert.equal(handler({ sender: popup.webContents }, { color: '#2A2A2A', symbolColor: '#ffffff' }), true);
  assert.equal(handler({ sender: panels.webContents }, { color: '#303030', symbolColor: '#000000' }), true);
  assert.deepEqual(main.calls, [{ color: '#202020', symbolColor: '#ffffff', height: 35 }]);
  assert.deepEqual(popup.calls, [{ color: '#2a2a2a', symbolColor: '#ffffff', height: 31 }]);
  assert.deepEqual(panels.calls, [{ color: '#303030', symbolColor: '#000000', height: 31 }]);
});

test('remetente desconhecido, cor inválida, janela fechada ou macOS são recusados sem erro', () => {
  const main = fakeWindow();
  const handler = register([{ window: main, kind: 'main' }]);
  assert.equal(handler({ sender: {} }, { color: '#202020', symbolColor: '#ffffff' }), false, 'webContents de fora do ATLAS');
  assert.equal(handler({ sender: main.webContents }, { color: 'red', symbolColor: '#ffffff' }), false);
  assert.equal(main.calls.length, 0);
  const closed = { ...fakeWindow(), isDestroyed: () => true };
  assert.equal(register([{ window: closed, kind: 'terminal' }])({ sender: closed.webContents }, { color: '#202020', symbolColor: '#ffffff' }), false);
  const strange = fakeWindow();
  assert.equal(register([{ window: strange, kind: 'outra' }])({ sender: strange.webContents }, { color: '#202020', symbolColor: '#ffffff' }), false);
  const mac = fakeWindow();
  assert.equal(register([{ window: mac, kind: 'main' }], 'darwin')({ sender: mac.webContents }, { color: '#202020', symbolColor: '#ffffff' }), false);
  assert.equal(closed.calls.length + strange.calls.length + mac.calls.length, 0);
});
