// Runs in the renderer to measure actual text colors, including color-mix and alpha.
// `root` limita a auditoria a uma região (trilho, flyout, menu); o padrão é a página toda.
export function auditInterface(root = document.body) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((value) => value / 255); };
  const blend = (front, back) => front.slice(0, 3).map((value, index) => value * front[3] + back[index] * (1 - front[3]));
  const luminance = (rgb) => rgb.slice(0, 3).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const background = (element) => {
    const layers = [];
    for (let item = element; item; item = item.parentElement) layers.unshift(rgba(getComputedStyle(item).backgroundColor));
    return layers.reduce((result, layer) => blend(layer, result), [1, 1, 1]);
  };
  const findings = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const element = node.parentElement;
    if (!node.textContent.trim() || !element || element.closest('.terminal-window, [inert], script, style')) continue;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (!rect.width || !rect.height || rect.top >= innerHeight || rect.bottom <= 0 || style.visibility !== 'visible') continue;
    const bg = background(element);
    const fg = blend(rgba(style.color), bg);
    const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    const ratio = (light + .05) / (dark + .05);
    if (ratio < 4.5 || parseFloat(style.fontSize) < 10) findings.push({ text: node.textContent.trim().slice(0, 65), selector: `${element.tagName.toLowerCase()}.${String(element.className).replaceAll(' ', '.')}`, ratio: +ratio.toFixed(2), size: style.fontSize, color: style.color });
  }
  return findings;
}

// Controles só de ícone (trilhos, menu ⋯): o ícone precisa de 3:1 contra o fundo real (WCAG
// 1.4.11, contraste de componentes). Devolve os que ficam abaixo. A marca oficial de um CLI
// (Claude Code, Gemini...) fica de fora: é logotipo na cor oficial, decisão do mantenedor
// (design-system/atlas/MASTER.md), e o nome do CLI está no texto do controle (aria-label/title).
export function auditGlyphs(selector, minimum = 3) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((value) => value / 255); };
  const blend = (front, back) => front.slice(0, 3).map((value, index) => value * front[3] + back[index] * (1 - front[3]));
  const luminance = (rgb) => rgb.slice(0, 3).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const background = (element) => {
    const layers = [];
    for (let item = element; item; item = item.parentElement) layers.unshift(rgba(getComputedStyle(item).backgroundColor));
    return layers.reduce((result, layer) => blend(layer, result), [1, 1, 1]);
  };
  const ratio = (a, b) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + .05) / (dark + .05); };
  return [...document.querySelectorAll(selector)].flatMap((control) => {
    const icon = control.querySelector('svg');
    if (!icon || !icon.getBoundingClientRect().width || getComputedStyle(icon).display === 'none') return [];
    if (icon.closest('.session-glyph')?.style.getPropertyValue('--mark-color')) return [];
    const bg = background(control);
    const value = ratio(blend(rgba(getComputedStyle(icon).color), bg), bg);
    return value < minimum ? [{ label: control.getAttribute('aria-label') || control.title || control.textContent.trim(), ratio: +value.toFixed(2) }] : [];
  });
}

// Foco visível: anel (outline) de 2px declarados com 3:1 contra o fundo, ou o indicador próprio
// das divisórias (::after opaco). Roda com o elemento já focado pelo teclado. A interface usa
// zoom de .8, então 2px declarados aparecem como 1.6px no estilo computado.
export function focusIndicator(element) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((value) => value / 255); };
  const blend = (front, back) => front.slice(0, 3).map((value, index) => value * front[3] + back[index] * (1 - front[3]));
  const luminance = (rgb) => rgb.slice(0, 3).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const background = (node) => {
    const layers = [];
    for (let item = node; item; item = item.parentElement) layers.unshift(rgba(getComputedStyle(item).backgroundColor));
    return layers.reduce((result, layer) => blend(layer, result), [1, 1, 1]);
  };
  const ratio = (a, b) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + .05) / (dark + .05); };
  const style = getComputedStyle(element);
  // Anel para dentro (offset negativo) fica sobre o próprio controle; para fora, sobre o pai.
  const bg = background(parseFloat(style.outlineOffset) < 0 ? element : element.parentElement || element);
  if (element.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1.5) {
    return { kind: 'outline', width: style.outlineWidth, ratio: +ratio(blend(rgba(style.outlineColor), bg), bg).toFixed(2), focusVisible: true };
  }
  const after = getComputedStyle(element, '::after');
  if (after.content !== 'none' && after.opacity === '1') {
    return { kind: 'line', ratio: +ratio(blend(rgba(after.backgroundColor), bg), bg).toFixed(2), focusVisible: element.matches(':focus-visible') };
  }
  return { kind: 'none', ratio: 0, focusVisible: element.matches(':focus-visible') };
}
