import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TERMINAL_MIN,
  boundaryOffsets,
  gridColumnBoundaries,
  gridPlacement,
  gridShape,
  normalizeTrackSizes,
  normalizeTracks,
  pixelTracks,
  resizeTracks,
  saveTracks,
  shapeKey,
  sidebarShape,
  trackBoundaries,
  tracksFor,
  tracksToTemplate,
} from '../src/track-layout.js';

test('a Grade escolhe as colunas pela largura do contêiner', () => {
  assert.deepEqual(gridShape(0, 1200), { columns: 0, rows: 0 });
  assert.deepEqual(gridShape(3, 500), { columns: 1, rows: 3 });
  assert.deepEqual(gridShape(3, 1200), { columns: 2, rows: 2 });
  assert.deepEqual(gridShape(5, 1800), { columns: 3, rows: 2 });
  assert.deepEqual(gridShape(2, 3000), { columns: 2, rows: 1 }, 'nunca mais colunas do que terminais');
});

test('último terminal de linha incompleta ocupa o resto da linha', () => {
  assert.deepEqual(gridPlacement(3, 2), [{ row: 0, column: 0, span: 1 }, { row: 0, column: 1, span: 1 }, { row: 1, column: 0, span: 2 }]);
  assert.deepEqual(gridPlacement(4, 2).map((item) => item.span), [1, 1, 1, 1]);
});

test('divisórias verticais só existem nas linhas em que há fronteira', () => {
  assert.deepEqual(gridColumnBoundaries(3, 2), [{ index: 0, rows: [0] }]);
  assert.deepEqual(gridColumnBoundaries(4, 2), [{ index: 0, rows: [0, 1] }]);
  assert.deepEqual(gridColumnBoundaries(5, 3), [{ index: 0, rows: [0, 1] }, { index: 1, rows: [0] }]);
  assert.deepEqual(gridColumnBoundaries(2, 1), []);
});

test('Principal + agentes divide em duas colunas só com espaço para as duas', () => {
  assert.deepEqual(sidebarShape(3, 1000), { split: true, columns: 2, rows: 2 });
  assert.deepEqual(sidebarShape(3, TERMINAL_MIN.width * 2 - 1), { split: false, columns: 1, rows: 3 });
  assert.deepEqual(sidebarShape(1, 1000), { split: false, columns: 1, rows: 1 });
});

test('tamanhos salvos por layout e forma; forma nova volta a trilhas iguais', () => {
  const shape = gridShape(4, 1200);
  let saved = saveTracks({}, 'grid', shape, { columns: [3, 1], rows: [1, 1] });
  assert.deepEqual(tracksFor(saved, 'grid', shape), { columns: [1.5, 0.5], rows: [1, 1] });
  assert.deepEqual(tracksFor(saved, 'grid', gridShape(3, 500)), { columns: [1], rows: [1, 1, 1] }, 'um terminal a menos muda a forma');
  saved = saveTracks(saved, 'sidebar', sidebarShape(3, 1000), { columns: [3, 1], rows: [1, 3] });
  assert.deepEqual(tracksFor(saved, 'sidebar', sidebarShape(3, 1000)), { columns: [1.5, 0.5], rows: [0.5, 1.5] });
  assert.deepEqual(tracksFor({}, 'sidebar', sidebarShape(4, 1000)).columns, [4 / 3, 2 / 3], 'principal começa com 2/3');
  assert.equal(shapeKey('sidebar', sidebarShape(1, 1000)), 'single');
});

test('tamanhos salvos corrompidos são descartados', () => {
  assert.deepEqual(normalizeTrackSizes(null), {});
  assert.deepEqual(normalizeTrackSizes({ grid: { '2x2': { columns: [1, 'x'], rows: [1, 1] }, bad: { columns: [1], rows: [1] } }, other: {} }), {});
  assert.deepEqual(normalizeTrackSizes({ grid: { '2x1': { columns: [1, 2], rows: [1] } } }), { grid: { '2x1': { columns: [1, 2], rows: [1] } } });
  assert.deepEqual(normalizeTracks([1, 0], 2), [1, 1]);
});

test('fronteira entre trilhas respeita o mínimo de ~40x8 células nas duas', () => {
  assert.deepEqual(resizeTracks([500, 500], 0, 100, 320), [600, 400]);
  assert.deepEqual(resizeTracks([500, 500], 0, 400, 320), [680, 320]);
  assert.deepEqual(resizeTracks([500, 500], 0, -400, 320), [320, 680]);
  assert.deepEqual(resizeTracks([300, 300], 0, 50, 320), [300, 300], 'sem espaço para o mínimo, divide ao meio');
  assert.deepEqual(resizeTracks([400, 400, 400], 1, 50, 170), [400, 450, 350]);
  assert.deepEqual(resizeTracks([400, 400], 1, 50, 170), [400, 400], 'índice sem vizinha não muda nada');
});

test('divisórias da Grade, de Principal + agentes e da pilha estreita em px', () => {
  const grid = trackBoundaries({ layout: 'grid', shape: gridShape(3, 1200), count: 3, pixels: { columns: [700, 500], rows: [300, 200] } });
  assert.deepEqual(grid, [
    { axis: 'columns', index: 0, left: 700, top: 0, size: 300 },
    { axis: 'rows', index: 0, left: 0, top: 300, size: 1200 },
  ], 'a divisória vertical não atravessa o terminal que ocupa a linha inteira');
  const sidebar = trackBoundaries({ layout: 'sidebar', shape: sidebarShape(3, 1200), count: 3, pixels: { columns: [800, 400], rows: [250, 250] } });
  assert.deepEqual(sidebar, [
    { axis: 'columns', index: 0, left: 800, top: 0, size: 500 },
    { axis: 'rows', index: 0, left: 800, top: 250, size: 400 },
  ]);
  const stacked = trackBoundaries({ layout: 'sidebar', shape: sidebarShape(2, 500), count: 2, pixels: { columns: [500], rows: [300, 300] } });
  assert.deepEqual(stacked, [{ axis: 'rows', index: 0, left: 0, top: 300, size: 500 }]);
  assert.deepEqual(trackBoundaries({ layout: 'grid', shape: gridShape(4, 1200), count: 4, pixels: { columns: [600], rows: [] } }), [], 'medida desatualizada não desenha divisórias');
});

test('conversões de trilhas para CSS e de volta', () => {
  assert.equal(tracksToTemplate([1.5, 0.5], 0), 'minmax(0px, 1.5fr) minmax(0px, 0.5fr)');
  assert.deepEqual(pixelTracks('612.5px 300px'), [612.5, 300]);
  assert.deepEqual(pixelTracks(undefined), []);
  assert.deepEqual(boundaryOffsets([100, 200, 300]), [100, 300]);
});
