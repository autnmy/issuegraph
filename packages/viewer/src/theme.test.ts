import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EDGE_TOKENS as EDGES,
  SURFACE_TOKENS as SURFACES,
  TEXT_TOKENS as TEXT,
  contrastRatio,
} from './testing/contrast.ts';
import {
  COLOR_TOKENS,
  METRIC_TOKENS,
  THEME_TOKENS,
  TYPE_TOKENS,
  defaultTheme,
  extendTheme,
  themeCss,
} from './theme.ts';


describe('the theme contract', () => {
  it('lists exactly the tokens the theme supplies, in both directions', () => {
    const supplied = [
      ...Object.keys(defaultTheme.colors),
      ...Object.keys(defaultTheme.type),
      ...Object.keys(defaultTheme.metrics),
    ].sort();

    assert.deepEqual(supplied, [...THEME_TOKENS].sort());
  });

  it('composes THEME_TOKENS from its three groups with no overlap', () => {
    const groups = [...COLOR_TOKENS, ...TYPE_TOKENS, ...METRIC_TOKENS];
    assert.equal(new Set(groups).size, groups.length);
    assert.deepEqual([...THEME_TOKENS].sort(), [...groups].sort());
  });

  it('names every token in the reserved prefix', () => {
    for (const token of THEME_TOKENS) assert.match(token, /^--ig-[a-z0-9-]+$/);
  });
});

describe('the default theme meets WCAG AA', () => {
  it('clears 4.5:1 for every text colour on every surface', () => {
    for (const text of TEXT) {
      for (const surface of SURFACES) {
        const ratio = contrastRatio(defaultTheme.colors[text], defaultTheme.colors[surface]);
        assert.ok(
          ratio >= 4.5,
          `${text} on ${surface} measures ${ratio.toFixed(2)}:1, below the 4.5:1 minimum`,
        );
      }
    }
  });

  it('clears the 3:1 non-text bar for every edge hue on every surface', () => {
    // An edge is a line and a badge outline — a graphical object, so 1.4.11's
    // 3:1 applies rather than the 4.5:1 text minimum. Stating the DIFFERENT bar
    // explicitly is what stops the looser number leaking onto text later.
    for (const edge of EDGES) {
      for (const surface of SURFACES) {
        const ratio = contrastRatio(defaultTheme.colors[edge], defaultTheme.colors[surface]);
        assert.ok(
          ratio >= 3,
          `${edge} on ${surface} measures ${ratio.toFixed(2)}:1, below the 3:1 non-text minimum`,
        );
      }
    }
  });

  it('keeps the muted text token at the value that measures, not the one that reads well', () => {
    // The tight one: it carries sentence-length copy at the small size, and a
    // predecessor of this value failed AA at 4.04-4.39:1. Pinned so a future
    // "just darken it a shade" has to fail a test rather than a user.
    const ratio = contrastRatio(
      defaultTheme.colors['--ig-text-muted'],
      defaultTheme.colors['--ig-surface'],
    );
    assert.ok(ratio >= 4.5, `muted text measures ${ratio.toFixed(2)}:1`);
  });

  it('states every colour as a hex value the ratio test can read', () => {
    for (const token of COLOR_TOKENS) {
      assert.match(defaultTheme.colors[token], /^#[0-9A-Fa-f]{6}$/, token);
    }
  });
});

describe('themeCss', () => {
  it('emits one rule of custom properties and nothing else', () => {
    const css = themeCss(defaultTheme, '.host');
    const body = css.slice(css.indexOf('{') + 1, css.lastIndexOf('}'));
    const declarations = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');

    assert.ok(css.startsWith('.host {'));
    assert.equal(declarations.length, THEME_TOKENS.length);
    for (const declaration of declarations) assert.match(declaration, /^--ig-[a-z0-9-]+: .+;$/);
  });

  it('defaults to :root', () => {
    assert.ok(themeCss(defaultTheme).startsWith(':root {'));
  });

  it('gives metrics a px unit, which is the one place a number becomes CSS', () => {
    assert.match(themeCss(defaultTheme), /--ig-row-height: 44px;/);
  });
});

describe('extendTheme', () => {
  it('overrides only what it is given', () => {
    const second = extendTheme(defaultTheme, { colors: { '--ig-bg': '#FFFFFF' } });

    assert.equal(second.colors['--ig-bg'], '#FFFFFF');
    assert.equal(second.colors['--ig-text'], defaultTheme.colors['--ig-text']);
    assert.equal(second.metrics['--ig-row-height'], defaultTheme.metrics['--ig-row-height']);
  });

  it('leaves the base untouched', () => {
    extendTheme(defaultTheme, { colors: { '--ig-bg': '#FFFFFF' } });
    assert.equal(defaultTheme.colors['--ig-bg'], '#0B0D0F');
  });

  it('accepts a whole-palette override, which is what a second theme is', () => {
    const inverted = extendTheme(defaultTheme, {
      colors: Object.fromEntries(
        COLOR_TOKENS.map((token) => [token, '#123456']),
      ) as Record<(typeof COLOR_TOKENS)[number], string>,
    });

    for (const token of COLOR_TOKENS) assert.equal(inverted.colors[token], '#123456');
    assert.notEqual(themeCss(inverted), themeCss(defaultTheme));
  });
});
