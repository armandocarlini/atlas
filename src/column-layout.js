// Larguras das colunas do workspace (Navegação, Terminais, Painéis).
// Funções puras: a interface mede a área disponível e decide aqui largura, limites e modo.

export const COLUMN_IDS = ['left', 'center', 'right'];
export const SIDE_COLUMNS = ['left', 'right'];
export const RAIL_WIDTH = 56;
export const KEYBOARD_STEP = 16;
export const KEYBOARD_STEP_LARGE = 64;

// left: completa a partir de 200px, compacta entre 130 e 200, só ícones abaixo de 130 (encaixa em 56).
// right: completa a partir de 250px; abaixo de 200 encaixa no trilho de ícones, entre 200 e 250 volta a 250.
// center: Terminais nunca ficam abaixo de 360px enquanto houver espaço.
export const COLUMN_LIMITS = {
  left: { full: 200, compact: 130, max: 560 },
  right: { full: 250, snap: 200, narrow: 320, max: 640 },
  center: { min: 360, compact: 560 },
};

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export function navigationMode(width) {
  if (!finite(width) || width >= COLUMN_LIMITS.left.full) return 'full';
  return width >= COLUMN_LIMITS.left.compact ? 'compact' : 'icons';
}

export function panelsMode(width) {
  if (!finite(width) || width >= COLUMN_LIMITS.right.narrow) return 'full';
  return width >= COLUMN_LIMITS.right.full ? 'narrow' : 'icons';
}

export function terminalsMode(width) {
  return finite(width) && width < COLUMN_LIMITS.center.compact ? 'compact' : 'full';
}

export function columnMode(column, width) {
  if (column === 'left') return navigationMode(width);
  if (column === 'right') return panelsMode(width);
  return terminalsMode(width);
}

// Largura padrão por largura da janela (as antigas media queries das colunas).
export function defaultColumnWidth(column, viewportWidth = 1440) {
  const viewport = finite(viewportWidth) ? viewportWidth : 1440;
  if (column === 'left') return viewport >= 1600 ? 260 : viewport > 1180 ? 248 : viewport > 940 ? 220 : 200;
  if (column === 'right') return viewport >= 1600 ? 320 : viewport > 1180 ? 292 : viewport > 940 ? 260 : 250;
  return null;
}

// Encaixa uma largura pedida (arraste ou teclado) num estado válido da coluna.
export function snapColumnWidth(column, width) {
  if (!finite(width)) return null;
  const value = Math.round(width);
  if (column === 'left') {
    if (value < COLUMN_LIMITS.left.compact) return RAIL_WIDTH;
    return Math.min(value, COLUMN_LIMITS.left.max);
  }
  if (column === 'right') {
    if (value < COLUMN_LIMITS.right.snap) return RAIL_WIDTH;
    if (value < COLUMN_LIMITS.right.full) return COLUMN_LIMITS.right.full;
    return Math.min(value, COLUMN_LIMITS.right.max);
  }
  return null;
}

// Largura salva válida ou null (padrão). Aceita o formato antigo de 'atlas-docks', que não tinha larguras.
export function normalizeColumnWidths(saved) {
  const result = { left: null, right: null };
  if (!saved || typeof saved !== 'object') return result;
  for (const column of SIDE_COLUMNS) {
    const value = saved[column];
    if (finite(value) && value > 0) result[column] = snapColumnWidth(column, value);
  }
  return result;
}

export function visibleColumns(order = COLUMN_IDS, hidden = {}) {
  return order.filter((column) => column === 'center' || !hidden[column]);
}

function shrinkSteps(widths) {
  // Ordem de cessão quando a janela não comporta as larguras desejadas.
  return [
    ['right', COLUMN_LIMITS.right.full, false],
    ['left', COLUMN_LIMITS.left.full, false],
    ['left', COLUMN_LIMITS.left.compact, false],
    ['left', RAIL_WIDTH, true],
    ['right', RAIL_WIDTH, true],
  ].filter(([column]) => column in widths);
}

// Larguras efetivas das laterais visíveis: as desejadas (salvas ou padrão), cedidas até caber
// Terminais com o mínimo. As salvas não mudam; ao alargar a janela, voltam.
export function resolveColumnWidths({ order = COLUMN_IDS, hidden = {}, widths = {}, available, viewport } = {}) {
  const sides = visibleColumns(order, hidden).filter((column) => column !== 'center');
  const effective = {};
  for (const column of sides) effective[column] = snapColumnWidth(column, widths[column] ?? defaultColumnWidth(column, viewport ?? available));
  if (!finite(available)) return { ...effective, center: null };
  const used = () => Object.values(effective).reduce((sum, value) => sum + value, 0);
  let overflow = used() + COLUMN_LIMITS.center.min - available;
  for (const [column, floor, snap] of shrinkSteps(effective)) {
    if (overflow <= 0) break;
    const current = effective[column];
    if (current <= floor) continue;
    const next = snap ? floor : Math.max(floor, current - overflow);
    effective[column] = next;
    overflow -= current - next;
  }
  return { ...effective, center: Math.max(0, available - used()) };
}

function maxSideWidth(column, available, otherSides) {
  const room = finite(available) ? available - COLUMN_LIMITS.center.min - otherSides : Infinity;
  return Math.max(RAIL_WIDTH, Math.min(COLUMN_LIMITS[column].max, room));
}

function fitSide(column, width, max) {
  const snapped = snapColumnWidth(column, Math.min(width, max));
  return snapped > max ? RAIL_WIDTH : snapped;
}

// Divisória entre visible[index] e visible[index + 1]. Lateral com Terminais: só a lateral muda.
// Duas laterais vizinhas: uma cede para a outra e Terminais ficam como estão.
function sidePairRanges({ before, after }, total) {
  const expandedMin = (column) => column === 'left' ? COLUMN_LIMITS.left.compact : COLUMN_LIMITS.right.full;
  const expandedLow = Math.max(expandedMin(before), total - COLUMN_LIMITS[after].max);
  const expandedHigh = Math.min(COLUMN_LIMITS[before].max, total - expandedMin(after));
  const remainder = total - RAIL_WIDTH;
  const ranges = [];

  // A faixa expandida divide o total sem encaixes. Cada trilho viável acrescenta um ponto isolado.
  if (snapColumnWidth(after, remainder) === remainder) ranges.push([RAIL_WIDTH, RAIL_WIDTH]);
  if (expandedLow <= expandedHigh) ranges.push([expandedLow, expandedHigh]);
  if (remainder > RAIL_WIDTH && snapColumnWidth(before, remainder) === remainder) ranges.push([remainder, remainder]);
  return ranges;
}

function fitSidePair({ before, after }, total, width, ranges) {
  let target = snapColumnWidth(before, width);
  if (target !== RAIL_WIDTH && snapColumnWidth(after, total - width) === RAIL_WIDTH) target = total - RAIL_WIDTH;
  let fitted = ranges[0][0];
  for (const [min, max] of ranges) {
    const candidate = Math.max(min, Math.min(max, target));
    if (Math.abs(candidate - target) < Math.abs(fitted - target)) fitted = candidate;
  }
  return fitted;
}

function sidePairWidths({ before, after }, total, width) {
  return { [before]: width, [after]: total - width };
}

export function dividerColumns(visible, index) {
  const before = visible[index];
  const after = visible[index + 1];
  if (!before || !after) return null;
  if (before === 'center') return { before, after, controls: [after], sign: -1 };
  if (after === 'center') return { before, after, controls: [before], sign: 1 };
  return { before, after, controls: [before, after], sign: 1 };
}

export function resizeAtDivider({ visible, index, start, delta, available }) {
  const divider = dividerColumns(visible, index);
  if (!divider || !finite(delta)) return {};
  const sides = visible.filter((column) => column !== 'center');
  if (divider.controls.length === 1) {
    const [column] = divider.controls;
    const others = sides.filter((item) => item !== column).reduce((sum, item) => sum + (start[item] || 0), 0);
    return { [column]: fitSide(column, start[column] + divider.sign * delta, maxSideWidth(column, available, others)) };
  }
  const { before, after } = divider;
  const total = start[before] + start[after];
  const ranges = sidePairRanges(divider, total);
  if (!ranges.length) return {};
  return sidePairWidths(divider, total, fitSidePair(divider, total, start[before] + delta, ranges));
}

// Passo do teclado: atravessa os encaixes (do trilho para compacta ou completa, e de volta).
export function stepColumnWidth(column, current, step) {
  const next = snapColumnWidth(column, current + step);
  if (next !== current || !step) return next;
  if (step > 0) {
    if (column === 'left' && current < COLUMN_LIMITS.left.compact) return COLUMN_LIMITS.left.compact;
    if (column === 'right' && current < COLUMN_LIMITS.right.full) return COLUMN_LIMITS.right.full;
  }
  return next;
}

export function keyboardResize({ visible, index, start, key, shift = false, available }) {
  const divider = dividerColumns(visible, index);
  if (!divider) return null;
  const size = shift ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
  const [primary] = divider.controls;
  const direction = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  if (divider.controls.length === 2) {
    const total = start[divider.before] + start[divider.after];
    const ranges = sidePairRanges(divider, total);
    if (!ranges.length) return null;
    let width;
    if (key === 'Home') width = ranges[0][0];
    else if (key === 'End') width = ranges.at(-1)[1];
    else if (direction) {
      const current = start[primary];
      const target = stepColumnWidth(primary, current, direction * size);
      width = fitSidePair(divider, total, target, ranges);
      // Se a seta encontra um vão entre encaixes, avança até a próxima faixa.
      if (width === current) {
        width = direction > 0
          ? ranges.find(([min]) => min > current)?.[0] ?? current
          : ranges.findLast(([, max]) => max < current)?.[1] ?? current;
      }
    } else return null;
    return sidePairWidths(divider, total, width);
  }
  const sides = visible.filter((column) => column !== 'center');
  const others = sides.filter((item) => item !== primary).reduce((sum, item) => sum + (start[item] || 0), 0);
  const max = maxSideWidth(primary, available, others);
  let target;
  if (direction) target = stepColumnWidth(primary, start[primary], divider.sign * direction * size);
  else if (key === 'Home') target = RAIL_WIDTH;
  else if (key === 'End') target = max;
  else return null;
  const delta = divider.sign * (Math.min(target, max) - start[primary]);
  return resizeAtDivider({ visible, index, start, delta, available });
}

export function dividerRange({ visible, index, start, available }) {
  const divider = dividerColumns(visible, index);
  if (!divider) return null;
  const [primary] = divider.controls;
  if (divider.controls.length === 2) {
    const ranges = sidePairRanges(divider, start[divider.before] + start[divider.after]);
    if (!ranges.length) return null;
    return { column: primary, min: ranges[0][0], max: ranges.at(-1)[1], now: start[primary] };
  }
  const sides = visible.filter((column) => column !== 'center');
  const others = sides.filter((item) => item !== primary).reduce((sum, item) => sum + (start[item] || 0), 0);
  return { column: primary, min: RAIL_WIDTH, max: maxSideWidth(primary, available, others), now: start[primary] };
}
