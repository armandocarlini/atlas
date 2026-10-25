// Runs in the renderer to measure actual text colors, including color-mix and alpha.
export function auditInterface() {
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
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
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
