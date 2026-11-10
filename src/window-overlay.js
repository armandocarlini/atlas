// Barra única: os controles da janela usam a cor real da barra em que ficam (a principal,
// o cabeçalho do pop-up de terminal ou a faixa do Acompanhamento), e não um token fixo.

export const OVERLAY_BARS = {
  main: '.titlebar',
  terminal: '.native-terminal-shell .session-header',
  panels: '.native-inspector > .column-drag-bar',
};

// 'rgb(18, 18, 18)' ou 'rgba(18, 18, 18, 1)' → '#121212'. Transparente ou inválida → null.
export function cssColorToHex(value) {
  const match = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:[\s,/]+(\d*\.?\d+)(%?))?\s*\)$/i.exec(String(value || '').trim());
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1);
  if (alpha < 1) return null;
  return `#${match.slice(1, 4).map((channel) => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, '0')).join('')}`;
}

// Primeiro fundo opaco subindo do elemento até a raiz; sem nenhum, o fallback.
export function effectiveBackground(element, getStyle, fallback) {
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    const color = cssColorToHex(getStyle(node).backgroundColor);
    if (color) return color;
  }
  return fallback;
}
