const rgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const hex = (channels) => `#${channels.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
export const mixColor = (base, tint, amount) => hex(rgb(base).map((value, index) => value * (1 - amount) + rgb(tint)[index] * amount));
const luminance = (color) => rgb(color).map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
export function contrastRatio(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + .05) / (dark + .05);
}
export function contrastInk(background) {
  const choices = ['#111315', '#f5f6f7'];
  const preferred = choices.sort((a, b) => contrastRatio(b, background) - contrastRatio(a, background))[0];
  if (contrastRatio(preferred, background) >= 4.5) return preferred;
  return contrastRatio('#000000', background) > contrastRatio('#ffffff', background) ? '#000000' : '#ffffff';
}
export function readableColor(color, backgrounds, minimum = 4.5) {
  const target = contrastInk(backgrounds[0]);
  for (let step = 0; step <= 100; step += 1) {
    const candidate = mixColor(color, target, step / 100);
    if (backgrounds.every((background) => contrastRatio(candidate, background) >= minimum)) return candidate;
  }
  return target;
}
export function appearanceTokens({ background, color }) {
  const ink = contrastInk(background);
  const accentInk = contrastInk(color);
  const surface = (amount) => {
    while (amount > 0 && contrastRatio(ink, mixColor(background, ink, amount)) < 4.5) amount -= .005;
    return mixColor(background, ink, Math.max(0, amount));
  };
  const surfaces = [background, surface(.04), surface(.08), surface(.13)];
  return {
    '--bg': background, '--terminal-bg': background, '--text': ink,
    '--surface': surfaces[1], '--surface-raised': surfaces[2], '--surface-hover': surfaces[3],
    '--muted': readableColor(mixColor(background, ink, .76), surfaces),
    '--faint': readableColor(mixColor(background, ink, .68), surfaces),
    '--border': mixColor(background, ink, .2), '--border-soft': mixColor(background, ink, .11),
    '--accent': color, '--accent-ink': accentInk,
    '--accent-bright': mixColor(color, accentInk === '#111315' || accentInk === '#000000' ? '#ffffff' : '#000000', .12),
    '--accent-soft': `${color}18`,
    '--accent-text': readableColor(color, surfaces, 5.5),
    '--success': readableColor('#4ecb8d', surfaces, 5.5),
    '--warning': readableColor('#f2b84b', surfaces, 5.5),
    '--danger': readableColor('#ef6363', surfaces, 5.5),
    '--review': readableColor('#a685f2', surfaces, 5.5),
  };
}
