const rgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const hex = (channels) => `#${channels.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
export const mixColor = (base, tint, amount) => hex(rgb(base).map((value, index) => value * (1 - amount) + rgb(tint)[index] * amount));
const luminance = (color) => rgb(color).map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
export function contrastRatio(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + .05) / (dark + .05);
}
// Tinta quente (marfim e grafite) da identidade do ATLAS; o contraste decide qual usar.
export const INK_DARK = '#14120f';
export const INK_LIGHT = '#ece5d8';
// Ouro do logo: marcas, rótulos de seção e estados do Atlas. Ajustado para leitura em cada fundo.
export const BRAND_GOLD = '#c8a76b';
export function contrastInk(background) {
  const choices = [INK_DARK, INK_LIGHT];
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
// Um destaque quase igual ao fundo (marfim sobre Papel, por exemplo) some nos preenchimentos.
// Nesse caso o preenchimento escurece ou clareia na direção do texto; a escolha salva continua a mesma.
export function visibleAccent(color, background, ink = contrastInk(background)) {
  for (let step = 0; step <= 100; step += 2) {
    const candidate = mixColor(color, ink, step / 100);
    if (contrastRatio(candidate, background) >= 1.8) return candidate;
  }
  return ink;
}
export function appearanceTokens({ background, color: chosen }) {
  const ink = contrastInk(background);
  const color = visibleAccent(chosen, background, ink);
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
    '--accent-bright': mixColor(color, accentInk === INK_DARK || accentInk === '#000000' ? '#ffffff' : '#000000', .12),
    '--accent-soft': `${color}18`,
    '--accent-text': readableColor(color, surfaces, 5.5),
    '--success': readableColor('#4ecb8d', surfaces, 5.5),
    '--warning': readableColor('#f2b84b', surfaces, 5.5),
    '--danger': readableColor('#ef6363', surfaces, 5.5),
    '--review': readableColor('#a685f2', surfaces, 5.5),
    '--gold': readableColor(BRAND_GOLD, surfaces, 4.5),
    '--gold-line': `${BRAND_GOLD}4d`,
  };
}

// Até a identidade nova, o padrão era laranja sobre grafite, gravado a cada abertura.
// Só quem ficou exatamente nesse padrão passa ao novo; qualquer outra escolha é mantida.
export function isPreviousDefaultTheme(saved) {
  return saved?.name === 'Laranja' && saved.color?.toLowerCase() === '#f2994a' && saved.background?.toLowerCase() === '#080a0b';
}
