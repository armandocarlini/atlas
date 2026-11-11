// Trilhas redimensionáveis dos terminais (Grade e Principal + agentes).
// Funções puras: tamanhos em frações, convertidos para px só durante o arraste.

// Mínimo de ~40 colunas x 8 linhas de terminal: célula do Cascadia Code 13px (~7,8 x 16,25 px),
// mais o cabeçalho de 32px e o respiro do xterm.
export const TERMINAL_MIN = { width: 320, height: 170 };
export const GRID_COLUMN_TARGET = 560;
export const GRID_MAX_COLUMNS = 3;
export const SIDEBAR_SPLIT = [2, 1];
export const TRACK_KEYBOARD_STEP = 16;
export const TRACK_KEYBOARD_STEP_LARGE = 64;
export const RESIZABLE_LAYOUTS = ['grid', 'sidebar'];

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

// A Grade decide as colunas pela largura do contêiner, não pela janela.
export function gridShape(count, width) {
  if (!count) return { columns: 0, rows: 0 };
  const byWidth = finite(width) ? Math.floor(width / GRID_COLUMN_TARGET) : 1;
  const columns = Math.max(1, Math.min(count, GRID_MAX_COLUMNS, byWidth));
  return { columns, rows: Math.ceil(count / columns) };
}

// Posição de cada terminal na Grade. O último de uma linha incompleta ocupa o resto da linha.
export function gridPlacement(count, columns) {
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const last = index === count - 1;
    const span = last ? columns - column : 1;
    return { row, column, span };
  });
}

// Divisórias verticais da Grade: em cada linha, só onde um terminal termina e outro começa.
export function gridColumnBoundaries(count, columns) {
  const placement = gridPlacement(count, columns);
  const boundaries = [];
  for (let boundary = 0; boundary < columns - 1; boundary += 1) {
    const rows = placement.filter((item) => item.column + item.span - 1 === boundary).map((item) => item.row);
    if (rows.length) boundaries.push({ index: boundary, rows });
  }
  return boundaries;
}

export function sidebarShape(count, width) {
  if (count < 2 || (finite(width) && width < TERMINAL_MIN.width * 2)) return { split: false, columns: 1, rows: Math.max(count, 0) };
  return { split: true, columns: 2, rows: count - 1 };
}

export function equalTracks(count) {
  return Array.from({ length: Math.max(0, count) }, () => 1);
}

function validTracks(tracks, count) {
  return Array.isArray(tracks) && tracks.length === count && tracks.every((value) => finite(value) && value > 0);
}

export function normalizeTracks(tracks, count, fallback = null) {
  if (validTracks(tracks, count)) {
    const total = tracks.reduce((sum, value) => sum + value, 0);
    return tracks.map((value) => value / total * count);
  }
  return validTracks(fallback, count) ? normalizeTracks(fallback, count) : equalTracks(count);
}

export function shapeKey(layout, shape) {
  if (layout === 'sidebar') return shape.split ? `stack${shape.rows}` : 'single';
  return `${shape.columns}x${shape.rows}`;
}

// Tamanhos salvos por layout e por forma: quando um terminal abre, fecha ou é ocultado, a forma
// muda e a Grade volta a trilhas iguais (ou às salvas daquela forma).
export function tracksFor(saved, layout, shape) {
  const entry = saved?.[layout]?.[shapeKey(layout, shape)];
  if (layout === 'sidebar') {
    if (!shape.split) return { columns: [1], rows: equalTracks(shape.rows) };
    return { columns: normalizeTracks(entry?.columns, 2, SIDEBAR_SPLIT), rows: normalizeTracks(entry?.rows, shape.rows) };
  }
  return { columns: normalizeTracks(entry?.columns, shape.columns), rows: normalizeTracks(entry?.rows, shape.rows) };
}

export function saveTracks(saved, layout, shape, tracks) {
  const current = saved && typeof saved === 'object' ? saved : {};
  return { ...current, [layout]: { ...(current[layout] || {}), [shapeKey(layout, shape)]: { columns: [...tracks.columns], rows: [...tracks.rows] } } };
}

export function normalizeTrackSizes(saved) {
  if (!saved || typeof saved !== 'object') return {};
  const result = {};
  for (const layout of RESIZABLE_LAYOUTS) {
    const shapes = saved[layout];
    if (!shapes || typeof shapes !== 'object') continue;
    for (const [key, entry] of Object.entries(shapes)) {
      if (!/^(\d+x\d+|stack\d+)$/.test(key)) continue;
      const columns = Array.isArray(entry?.columns) && entry.columns.every((value) => finite(value) && value > 0) ? entry.columns : null;
      const rows = Array.isArray(entry?.rows) && entry.rows.every((value) => finite(value) && value > 0) ? entry.rows : null;
      if (columns && rows) result[layout] = { ...(result[layout] || {}), [key]: { columns, rows } };
    }
  }
  return result;
}

// Move a fronteira entre as trilhas index e index + 1 em px, respeitando o mínimo das duas.
export function resizeTracks(sizes, index, delta, min) {
  if (!Array.isArray(sizes) || index < 0 || index >= sizes.length - 1 || !finite(delta)) return sizes;
  const pair = sizes[index] + sizes[index + 1];
  const floor = Math.min(min, pair / 2);
  const before = Math.max(floor, Math.min(pair - floor, sizes[index] + delta));
  const next = [...sizes];
  next[index] = before;
  next[index + 1] = pair - before;
  return next;
}

export function tracksToTemplate(tracks, min = 0) {
  return tracks.map((value) => `minmax(${min}px, ${Number(value.toFixed(4))}fr)`).join(' ');
}

export function columnTracksToTemplate(tracks) {
  return tracksToTemplate(tracks, tracks.length > 1 ? TERMINAL_MIN.width : 0);
}

export function pixelTracks(template) {
  if (typeof template !== 'string') return [];
  return template.trim().split(/\s+/).map((value) => Number.parseFloat(value)).filter((value) => finite(value));
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

// Divisórias entre trilhas de terminais, como numa planilha: cada uma move a fronteira entre duas
// colunas ou duas linhas inteiras. Posições em px, relativas ao contêiner da Grade.
export function trackBoundaries({ layout, shape, count, pixels }) {
  if (!shape || pixels.columns.length !== shape.columns || pixels.rows.length !== shape.rows) return [];
  const columnOffsets = boundaryOffsets(pixels.columns);
  const rowOffsets = boundaryOffsets(pixels.rows);
  const rowTop = (row) => sum(pixels.rows.slice(0, row));
  const width = sum(pixels.columns);
  const items = [];
  if (layout === 'grid') {
    for (const boundary of gridColumnBoundaries(count, shape.columns)) {
      const first = boundary.rows[0];
      const last = boundary.rows.at(-1);
      items.push({ axis: 'columns', index: boundary.index, left: columnOffsets[boundary.index], top: rowTop(first), size: rowTop(last + 1) - rowTop(first) });
    }
    rowOffsets.forEach((top, index) => items.push({ axis: 'rows', index, left: 0, top, size: width }));
    return items;
  }
  if (shape.split) {
    items.push({ axis: 'columns', index: 0, left: columnOffsets[0], top: 0, size: sum(pixels.rows) });
    rowOffsets.forEach((top, index) => items.push({ axis: 'rows', index, left: pixels.columns[0], top, size: pixels.columns[1] }));
    return items;
  }
  rowOffsets.forEach((top, index) => items.push({ axis: 'rows', index, left: 0, top, size: width }));
  return items;
}

export function boundaryOffsets(sizes) {
  const offsets = [];
  let total = 0;
  for (let index = 0; index < sizes.length - 1; index += 1) {
    total += sizes[index];
    offsets.push(total);
  }
  return offsets;
}
