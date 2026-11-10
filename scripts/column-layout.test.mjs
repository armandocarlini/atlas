import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLUMN_LIMITS,
  RAIL_WIDTH,
  defaultColumnWidth,
  dividerColumns,
  dividerRange,
  keyboardResize,
  navigationMode,
  normalizeColumnWidths,
  panelsMode,
  resizeAtDivider,
  resolveColumnWidths,
  snapColumnWidth,
  stepColumnWidth,
  terminalsMode,
  visibleColumns,
} from '../src/column-layout.js';

test('largura da Navegação define completa, compacta e só ícones', () => {
  assert.equal(navigationMode(248), 'full');
  assert.equal(navigationMode(200), 'full');
  assert.equal(navigationMode(199), 'compact');
  assert.equal(navigationMode(130), 'compact');
  assert.equal(navigationMode(129), 'icons');
  assert.equal(navigationMode(RAIL_WIDTH), 'icons');
  assert.equal(navigationMode(undefined), 'full');
});

test('Painéis estreitos viram abas de ícones e, abaixo do mínimo, trilho', () => {
  assert.equal(panelsMode(320), 'full');
  assert.equal(panelsMode(319), 'narrow');
  assert.equal(panelsMode(250), 'narrow');
  assert.equal(panelsMode(249), 'icons');
  assert.equal(panelsMode(RAIL_WIDTH), 'icons');
});

test('Terminais compactam a barra abaixo de 560px de coluna', () => {
  assert.equal(terminalsMode(559), 'compact');
  assert.equal(terminalsMode(560), 'full');
  assert.equal(terminalsMode(null), 'full');
});

test('arraste abaixo de ~130px encaixa a Navegação no trilho de ícones', () => {
  assert.equal(snapColumnWidth('left', 129), RAIL_WIDTH);
  assert.equal(snapColumnWidth('left', 60), RAIL_WIDTH);
  assert.equal(snapColumnWidth('left', 130), 130);
  assert.equal(snapColumnWidth('left', 4000), COLUMN_LIMITS.left.max);
});

test('Painéis entre 200 e 250px voltam ao mínimo; abaixo de 200 viram trilho', () => {
  assert.equal(snapColumnWidth('right', 249), 250);
  assert.equal(snapColumnWidth('right', 200), 250);
  assert.equal(snapColumnWidth('right', 199), RAIL_WIDTH);
  assert.equal(snapColumnWidth('right', 300.4), 300);
});

test('larguras salvas inválidas são ignoradas; o formato antigo vira padrão', () => {
  assert.deepEqual(normalizeColumnWidths(undefined), { left: null, right: null });
  assert.deepEqual(normalizeColumnWidths({ left: 'x', right: -5 }), { left: null, right: null });
  assert.deepEqual(normalizeColumnWidths({ left: 100, right: 210 }), { left: RAIL_WIDTH, right: 250 });
  assert.deepEqual(normalizeColumnWidths({ left: 300, right: 400 }), { left: 300, right: 400 });
});

test('padrões seguem a largura da janela como as antigas media queries', () => {
  assert.equal(defaultColumnWidth('left', 1920), 260);
  assert.equal(defaultColumnWidth('left', 1440), 248);
  assert.equal(defaultColumnWidth('left', 1180), 220);
  assert.equal(defaultColumnWidth('left', 940), 200);
  assert.equal(defaultColumnWidth('right', 1440), 292);
  assert.equal(defaultColumnWidth('right', 940), 250);
});

test('colunas ocultas não participam das divisórias', () => {
  assert.deepEqual(visibleColumns(['right', 'center', 'left'], { right: true }), ['center', 'left']);
  assert.deepEqual(visibleColumns(['left', 'right', 'center'], {}), ['left', 'right', 'center']);
});

test('janela folgada mantém as larguras desejadas e Terminais ficam com o resto', () => {
  const result = resolveColumnWidths({ widths: { left: 300, right: 320 }, available: 1440 });
  assert.deepEqual(result, { left: 300, right: 320, center: 820 });
});

test('janela estreita cede Painéis, depois Navegação até compacta e ícones, sem mexer no salvo', () => {
  const widths = { left: 300, right: 400 };
  assert.deepEqual(resolveColumnWidths({ widths, available: 900 }), { left: 290, right: 250, center: 360 });
  assert.deepEqual(resolveColumnWidths({ widths, available: 760 }), { left: 150, right: 250, center: 360 });
  assert.deepEqual(resolveColumnWidths({ widths, available: 700 }), { left: RAIL_WIDTH, right: 250, center: 394 });
  assert.deepEqual(resolveColumnWidths({ widths, available: 560 }), { left: RAIL_WIDTH, right: RAIL_WIDTH, center: 448 });
  assert.deepEqual(widths, { left: 300, right: 400 });
});

test('coluna oculta não consome espaço', () => {
  assert.deepEqual(resolveColumnWidths({ hidden: { right: true }, widths: { left: 300 }, available: 900 }), { left: 300, center: 600 });
});

test('entre lateral e Terminais, só a lateral muda e Terminais mantêm o mínimo', () => {
  const visible = ['left', 'center', 'right'];
  const start = { left: 248, right: 292 };
  assert.deepEqual(resizeAtDivider({ visible, index: 0, start, delta: 40, available: 1440 }), { left: 288 });
  assert.deepEqual(resizeAtDivider({ visible, index: 1, start, delta: -40, available: 1440 }), { right: 332 });
  assert.deepEqual(resizeAtDivider({ visible, index: 0, start, delta: 2000, available: 1000 }), { left: 1000 - 360 - 292 });
  assert.deepEqual(resizeAtDivider({ visible, index: 0, start, delta: -130, available: 1440 }), { left: RAIL_WIDTH });
});

test('a ordem atual decide o lado: Navegação à direita cresce ao arrastar para a esquerda', () => {
  const visible = ['right', 'center', 'left'];
  assert.deepEqual(dividerColumns(visible, 1), { before: 'center', after: 'left', controls: ['left'], sign: -1 });
  assert.deepEqual(resizeAtDivider({ visible, index: 1, start: { left: 248, right: 292 }, delta: -52, available: 1440 }), { left: 300 });
});

test('entre duas laterais, uma cede para a outra', () => {
  const visible = ['left', 'right', 'center'];
  const start = { left: 248, right: 292 };
  assert.deepEqual(resizeAtDivider({ visible, index: 0, start, delta: 30, available: 1440 }), { left: 278, right: 262 });
  const squeezed = resizeAtDivider({ visible, index: 0, start, delta: 60, available: 1440 });
  assert.equal(squeezed.right, 250, 'Painéis param no mínimo antes de virar trilho');
  assert.deepEqual(resizeAtDivider({ visible, index: 0, start, delta: 200, available: 1440 }), { left: 448, right: RAIL_WIDTH }, 'Terminais absorvem a sobra do encaixe');
});

test('teclado move a divisória, atravessa os encaixes e Home/End vão aos limites', () => {
  const visible = ['left', 'center', 'right'];
  const start = { left: 248, right: 292 };
  assert.deepEqual(keyboardResize({ visible, index: 0, start, key: 'ArrowRight', available: 1440 }), { left: 264 });
  assert.deepEqual(keyboardResize({ visible, index: 0, start, key: 'ArrowLeft', shift: true, available: 1440 }), { left: 184 });
  assert.deepEqual(keyboardResize({ visible, index: 0, start: { ...start, left: RAIL_WIDTH }, key: 'ArrowRight', available: 1440 }), { left: 130 });
  assert.deepEqual(keyboardResize({ visible, index: 0, start, key: 'Home', available: 1440 }), { left: RAIL_WIDTH });
  assert.deepEqual(keyboardResize({ visible, index: 0, start, key: 'End', available: 1440 }), { left: 560 });
  assert.deepEqual(keyboardResize({ visible, index: 1, start, key: 'ArrowLeft', available: 1440 }), { right: 308 });
  assert.deepEqual(keyboardResize({ visible, index: 1, start: { ...start, right: RAIL_WIDTH }, key: 'ArrowLeft', available: 1440 }), { right: 250 });
  assert.equal(keyboardResize({ visible, index: 0, start, key: 'Enter', available: 1440 }), null);
});

test('stepColumnWidth não prende a coluna no trilho', () => {
  assert.equal(stepColumnWidth('left', RAIL_WIDTH, 16), 130);
  assert.equal(stepColumnWidth('right', RAIL_WIDTH, 16), 250);
  assert.equal(stepColumnWidth('left', 130, -16), RAIL_WIDTH);
});

test('faixa da divisória informa a coluna controlada e seus limites', () => {
  assert.deepEqual(dividerRange({ visible: ['left', 'center', 'right'], index: 0, start: { left: 248, right: 292 }, available: 1440 }), { column: 'left', min: RAIL_WIDTH, max: 560, now: 248 });
  assert.equal(dividerRange({ visible: ['left', 'center'], index: 1, start: {}, available: 1000 }), null);
});
