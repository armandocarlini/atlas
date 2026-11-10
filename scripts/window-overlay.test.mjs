import assert from 'node:assert/strict';
import test from 'node:test';
import { cssColorToHex, effectiveBackground, OVERLAY_BARS } from '../src/window-overlay.js';

test('cor calculada do navegador vira hex para os controles da janela', () => {
  assert.equal(cssColorToHex('rgb(18, 18, 18)'), '#121212');
  assert.equal(cssColorToHex('rgba(236, 229, 216, 1)'), '#ece5d8');
  assert.equal(cssColorToHex('rgb(255 128 0)'), '#ff8000');
  assert.equal(cssColorToHex('rgb(255 128 0 / 100%)'), '#ff8000');
});

test('fundo transparente ou valor inválido não vira cor', () => {
  for (const value of ['rgba(0, 0, 0, 0)', 'rgba(10, 10, 10, .5)', 'rgb(0 0 0 / 40%)', 'transparent', '', null, 'url(x)', 'rgb(1,2)']) {
    assert.equal(cssColorToHex(value), null, String(value));
  }
});

test('barra transparente herda o primeiro fundo opaco dos ancestrais', () => {
  const root = { nodeType: 1, parentElement: null, bg: 'rgb(9, 9, 10)' };
  const shell = { nodeType: 1, parentElement: root, bg: 'rgba(0, 0, 0, 0)' };
  const bar = { nodeType: 1, parentElement: shell, bg: 'rgba(0, 0, 0, 0)' };
  const style = (node) => ({ backgroundColor: node.bg });
  assert.equal(effectiveBackground(bar, style, '#121212'), '#09090a');
  assert.equal(effectiveBackground({ ...bar, bg: 'rgb(32, 32, 32)' }, style, '#121212'), '#202020');
  assert.equal(effectiveBackground(null, style, '#121212'), '#121212', 'sem barra, o token da superfície');
});

test('cada janela aponta para a própria barra', () => {
  assert.deepEqual(Object.keys(OVERLAY_BARS), ['main', 'terminal', 'panels']);
});
