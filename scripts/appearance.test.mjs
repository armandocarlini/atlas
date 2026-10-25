import assert from 'node:assert/strict';
import test from 'node:test';
import { appearanceTokens, contrastRatio } from '../src/appearance.js';

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
