import assert from 'node:assert/strict';
import test from 'node:test';
import { appearanceTokens, contrastRatio, isPreviousDefaultTheme, visibleAccent } from '../src/appearance.js';

test('WCAG reference contrast is 21:1 for black and white', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
});

test('interface text remains readable on light, dark and middle gray backgrounds', () => {
  for (const background of ['#080a0b', '#000000', '#111722', '#eef1f4', '#f7f4ed', '#777777', '#747474', '#18222b']) {
    for (const color of ['#f2994a', '#ffffff', '#000000', '#777777', '#35b6c9']) {
      const tokens = appearanceTokens({ background, color });
      for (const surface of ['--bg', '--surface', '--surface-raised', '--surface-hover']) {
        for (const foreground of ['--text', '--muted', '--faint', '--accent-text', '--success', '--warning', '--danger']) {
          assert(contrastRatio(tokens[foreground], tokens[surface]) >= 4.5, `${background} ${color}: ${foreground} on ${surface}`);
        }
      }
    }
  }
});

test('primary action remains readable on hover with a custom gray accent', () => {
  const tokens = appearanceTokens({ background: '#eef1f4', color: '#777777' });
  assert(contrastRatio(tokens['--accent-ink'], tokens['--accent-bright']) >= 4.5);
});

test('identity default: ivory accent on obsidian keeps the chosen fill and a warm readable ink', () => {
  const tokens = appearanceTokens({ background: '#09090a', color: '#e6dcc8' });
  assert.equal(tokens['--accent'], '#e6dcc8');
  assert(contrastRatio(tokens['--accent-ink'], tokens['--accent']) >= 4.5);
  for (const surface of ['--bg', '--surface', '--surface-raised', '--surface-hover']) assert(contrastRatio(tokens['--gold'], tokens[surface]) >= 4.5, surface);
});

test('an accent that disappears into the background is shifted only in the fill', () => {
  for (const [background, color] of [['#f7f4ed', '#e6dcc8'], ['#eef1f4', '#ffffff'], ['#09090a', '#000000'], ['#080a0b', '#0b0d0e']]) {
    const fill = visibleAccent(color, background);
    assert(contrastRatio(fill, background) >= 1.8, `${color} on ${background}`);
    const tokens = appearanceTokens({ background, color });
    assert.equal(tokens['--accent'], fill);
    assert(contrastRatio(tokens['--accent-ink'], tokens['--accent']) >= 4.5);
    assert(contrastRatio(tokens['--accent-ink'], tokens['--accent-bright']) >= 4.5, `hover ${color} on ${background}`);
  }
  assert.equal(visibleAccent('#f2994a', '#080a0b'), '#f2994a');
  assert.equal(visibleAccent('#f2994a', '#f7f4ed'), '#f2994a');
});

test('only the untouched previous default moves to the new identity', () => {
  assert.equal(isPreviousDefaultTheme({ name: 'Laranja', color: '#f2994a', background: '#080a0b' }), true);
  assert.equal(isPreviousDefaultTheme({ name: 'Laranja', color: '#f2994a', background: '#000000' }), false);
  assert.equal(isPreviousDefaultTheme({ name: 'Grafite', color: '#f2994a', background: '#080a0b' }), false);
  assert.equal(isPreviousDefaultTheme({ name: 'Personalizada', color: '#f2994a', background: '#080a0b' }), false);
  assert.equal(isPreviousDefaultTheme(null), false);
});
