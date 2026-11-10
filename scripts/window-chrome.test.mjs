import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { appearanceTokens } from '../src/appearance.js';

const require = createRequire(import.meta.url);
const { OVERLAY_HEIGHT, DEFAULT_OVERLAY, mainWindowChrome, sanitizeOverlay, registerWindowChrome } = require('../electron/window-chrome.cjs');

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

test('só a janela principal recolore os controles, e só com cores válidas', () => {
  const ipcMain = fakeIpc();
  const main = fakeWindow();
  registerWindowChrome({ ipcMain, getMainWindow: () => main, platform: 'win32' });
  const handler = ipcMain.handlers.get('window-chrome:set-overlay');
  assert.equal(handler({ sender: main.webContents }, { color: '#202020', symbolColor: '#ffffff' }), true);
  assert.deepEqual(main.calls, [{ color: '#202020', symbolColor: '#ffffff', height: OVERLAY_HEIGHT }]);
  assert.equal(handler({ sender: {} }, { color: '#202020', symbolColor: '#ffffff' }), false, 'pop-up não recolore a principal');
  assert.equal(handler({ sender: main.webContents }, { color: 'red', symbolColor: '#ffffff' }), false);
  assert.equal(main.calls.length, 1);
});

test('sem overlay (macOS) ou sem janela, o pedido é recusado sem erro', () => {
  const mac = fakeIpc();
  const main = fakeWindow();
  registerWindowChrome({ ipcMain: mac, getMainWindow: () => main, platform: 'darwin' });
  assert.equal(mac.handlers.get('window-chrome:set-overlay')({ sender: main.webContents }, { color: '#202020', symbolColor: '#ffffff' }), false);
  assert.equal(main.calls.length, 0);
  const closed = fakeIpc();
  registerWindowChrome({ ipcMain: closed, getMainWindow: () => null, platform: 'win32' });
  assert.equal(closed.handlers.get('window-chrome:set-overlay')({ sender: {} }, { color: '#202020', symbolColor: '#ffffff' }), false);
});
