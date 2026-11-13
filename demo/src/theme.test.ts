/**
 * The theming promise, enforced instead of restated.
 *
 * The README, the page footer and `styles.css` itself all say a host can
 * retheme this demo by redeclaring one block of custom properties. That was
 * once an overclaim: the token block existed, and the rules underneath it went
 * on hard-coding font sizes, paddings, borders, radii and grid tracks — so a
 * host following the instructions could change the colours and nothing else.
 *
 * A promise a reader has to verify by hand is a promise that drifts, and the
 * drift is invisible: nothing fails, the page still renders, and the sentence
 * goes on being printed. So the rule is a test. It reads the stylesheet, splits
 * off the blocks that DEFINE custom properties, and asserts that no rule
 * outside them carries a length literal.
 *
 * It deliberately does not try to parse CSS. Everything it needs is decidable
 * on a line: a declaration either sets a custom property or it does not, and a
 * value either contains a dimension or it does not.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const stylesheet = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');

/** A number followed by a CSS length or angle unit — the thing a theme owns. */
const DIMENSION = /(^|[\s(,:/])-?\d*\.?\d+(px|rem|em|ch|ex|vh|vw|vmin|vmax|pt|pc|cm|mm|in|deg)\b/;

/**
 * Values a rule may carry literally, because they are STRUCTURE rather than
 * theme: a host retheming the page does not redefine what "fill the row" means.
 * Unitless numbers (`0`, `1fr`, `100%`, `999`) are not dimensions and never
 * reach the test above.
 */
const STRUCTURAL = /^(0|auto|none|inherit|initial|unset)$/;

interface Declaration {
  readonly line: number;
  readonly text: string;
}

/**
 * Every declaration that is NOT inside a custom-property definition block.
 *
 * The token blocks are exactly the `:root` selectors, which is where this file
 * declares its theme; anything else is a rule a host should not have to edit.
 */
function rulesOutsideTheTokenBlocks(): Declaration[] {
  const found: Declaration[] = [];
  let inTokens = false;
  let depth = 0;
  stylesheet.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\/\*.*?\*\//g, '').trim();
    if (line === '') return;
    if (line.endsWith('{')) {
      depth += 1;
      // A `:root` selector at any nesting — including inside the media query —
      // opens a token block.
      if (line.includes(':root')) inTokens = true;
      return;
    }
    if (line.startsWith('}')) {
      depth -= 1;
      if (depth <= 0) {
        inTokens = false;
        depth = Math.max(depth, 0);
      }
      return;
    }
    if (inTokens) return;
    found.push({ line: index + 1, text: line });
  });
  return found;
}

test('no rule outside the token blocks carries a length literal', () => {
  const offenders = rulesOutsideTheTokenBlocks().filter((declaration) => {
    const [, ...rest] = declaration.text.split(':');
    const value = rest.join(':').replace(/;$/, '').trim();
    if (value === '' || STRUCTURAL.test(value)) return false;
    return DIMENSION.test(value);
  });

  assert.deepEqual(
    offenders.map((each) => `styles.css:${each.line}  ${each.text}`),
    [],
    'these rules hard-code a dimension, so a host cannot retheme by redeclaring the token block alone',
  );
});

test('CONTROL: the guard actually reads the stylesheet and can fail', () => {
  // A test that scans nothing passes just as loudly as one that scans
  // everything, so prove both halves: there ARE rules outside the token
  // blocks, and the pattern DOES match a dimension when one is present.
  const rules = rulesOutsideTheTokenBlocks();
  assert.ok(rules.length > 20, `only ${rules.length} rules were scanned; the split is wrong`);
  assert.ok(DIMENSION.test('padding: 9px var(--gap)'), 'the pattern misses a plain px value');
  assert.ok(DIMENSION.test('font-size: 1.2rem'), 'the pattern misses a fractional value');
  assert.ok(!DIMENSION.test('var(--pad-row-y) var(--gap)'), 'the pattern flags a tokenised value');
  assert.ok(!DIMENSION.test('1 / -1'), 'the pattern flags a unitless grid line');
});

test('the token blocks actually define the dimensions the rules use', () => {
  // The other half of the promise: every custom property a rule references has
  // to be declared, or "redeclare the block" reaches nothing.
  const declared = new Set([...stylesheet.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
  const used = new Set([...stylesheet.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], 'these properties are used but never declared');
});

import { themeFor } from './workspace.ts';
import { COLOR_TOKENS, defaultTheme } from '@issuegraph/viewer';
import { OVERLAY_TREATMENTS } from '@issuegraph/editor';
import { describe } from "node:test";

describe("more tests", function () {
test("the Light theme draws the three edit states in the viewer's tested light hues", () => {
  // These are the values paperTheme in packages/viewer/src/acceptance.test.ts
  // tests for its light palette. Without them the Light workspace falls back to
  // the dark theme's pale state hues, which almost vanish on the light page.
  const light = themeFor('paper');
  assert.deepEqual(
    {
      '--ig-state-invalid': light.colors['--ig-state-invalid'],
      '--ig-state-failed': light.colors['--ig-state-failed'],
      '--ig-state-conflict': light.colors['--ig-state-conflict'],
    },
    {
      '--ig-state-invalid': '#5A0000',
      '--ig-state-failed': '#3D0F00',
      '--ig-state-conflict': '#5C4300',
    },
  );
});

test('the Light theme overrides every colour token the viewer defines', () => {
  // The Light theme extends the dark default, so a token it leaves out keeps a
  // dark-theme value. Walking the viewer's own token list means a colour token
  // added to the viewer later fails here until the Light theme sets it.
  const light = themeFor('paper');
  assert.deepEqual(
    COLOR_TOKENS.filter((token) => light.colors[token] === defaultTheme.colors[token]),
    [],
    'the Light theme inherits a dark-theme colour',
  );
});

test('asking for the Light theme again gives the same hues and never rewrites the Dark theme', () => {
  // themeFor feeds both the first mount and every later theme switch, so the
  // workspace asks for a theme many times. Each answer must be the same, and
  // building the Light theme must not write its hues into the shared default.
  const STATE_TOKENS_FOR_THIS_CHECK = ['--ig-state-invalid', '--ig-state-failed', '--ig-state-conflict'] as const;
  const first = themeFor('paper');
  const second = themeFor('paper');
  assert.deepEqual(second.colors, first.colors, 'a second Light request returned different colours');

  assert.equal(themeFor('default'), defaultTheme, 'the Dark workspace is not the packages default theme');
  for (const token of STATE_TOKENS_FOR_THIS_CHECK) {
    assert.notEqual(
      defaultTheme.colors[token],
      second.colors[token],
      `${token} is the same in Dark and Light, so one theme overwrote the other or Light never set it`,
    );
  }
});

test("the Light theme's state hues clear 3:1 on every surface at full strength and at the editor's opacity", () => {
  // A test-local copy of the WCAG contrast maths, as the editor's grammar test
  // keeps one: the viewer ships no contrast function on purpose. The editor
  // draws some states faded, so what lands on screen is the hue composited
  // over the surface, not the hue as written.
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };
  const luminance = (hex: string): number => {
    const value = Number.parseInt(hex.slice(1), 16);
    return 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255);
  };
  const ratioOf = (a: string, b: string): number => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (high + 0.05) / (low + 0.05);
  };
  const drawnOver = (fg: string, bg: string, alpha: number): string => {
    const f = Number.parseInt(fg.slice(1), 16);
    const b = Number.parseInt(bg.slice(1), 16);
    const mix = (shift: number): number => Math.round(alpha * ((f >> shift) & 255) + (1 - alpha) * ((b >> shift) & 255));
    return `#${[mix(16), mix(8), mix(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  };

  const light = themeFor('paper');
  const stateTokens = ['--ig-state-invalid', '--ig-state-failed', '--ig-state-conflict'] as const;
  const surfaces = ['--ig-bg', '--ig-surface', '--ig-surface-2'] as const;
  const failures: string[] = [];

  for (const token of stateTokens) {
    const opacities = Object.values(OVERLAY_TREATMENTS)
      .filter((treatment) => treatment.hueToken === token)
      .map((treatment) => treatment.opacity ?? 1);
    // Without this, a token no treatment names would only be measured at full
    // strength, and the faded check would pass without measuring anything.
    assert.ok(opacities.length > 0, `no editor treatment paints with ${token}`);
    for (const alpha of [1, ...opacities]) {
      for (const surface of surfaces) {
        const bg = light.colors[surface];
        const ratio = ratioOf(drawnOver(light.colors[token], bg, alpha), bg);
        if (ratio < 3) failures.push(`${token} at ${String(alpha)} on ${surface}: ${ratio.toFixed(2)}:1`);
      }
    }
  }

  assert.deepEqual(failures, [], 'these Light state hues fall below the 3:1 non-text minimum');
});
});

describe("more tests 2", function () {
test('U1 R1: themeFor paper overrides every COLOR_TOKENS entry of defaultTheme', () => {
  // The Light theme extends the dark default, so any colour token it leaves out
  // silently keeps a hue chosen for a dark page. Checking the whole token list
  // makes a token added later fail here until the Light theme sets it.
  const paper = themeFor('paper');
  const inherited = COLOR_TOKENS.filter((token) => paper.colors[token] === defaultTheme.colors[token]);
  assert.deepEqual(inherited, [], 'the Light theme inherits these colours from the dark default theme');
});

test("U1 KTD1: themeFor paper sets the viewer's tested light state hues", () => {
  // These are the light state values the viewer's own acceptance test renders
  // with, which the demo's Light theme copies.
  const { colors } = themeFor('paper');
  assert.deepEqual(
    {
      '--ig-state-invalid': colors['--ig-state-invalid'],
      '--ig-state-failed': colors['--ig-state-failed'],
      '--ig-state-conflict': colors['--ig-state-conflict'],
    },
    {
      '--ig-state-invalid': '#5A0000',
      '--ig-state-failed': '#3D0F00',
      '--ig-state-conflict': '#5C4300',
    },
  );
});

test('U1 R1: themeFor paper state hues clear 3:1 on every surface at full strength', () => {
  // A test-only copy of the WCAG contrast maths: the viewer ships no contrast
  // function, and the lint rules refuse imports past a package's entry point.
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };
  const luminance = (hex: string): number => {
    const value = Number.parseInt(hex.slice(1), 16);
    return (
      0.2126 * channel((value >> 16) & 255) +
      0.7152 * channel((value >> 8) & 255) +
      0.0722 * channel(value & 255)
    );
  };
  const contrastRatio = (a: string, b: string): number => {
    const first = luminance(a);
    const second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };

  const { colors } = themeFor('paper');
  const states = ['--ig-state-invalid', '--ig-state-failed', '--ig-state-conflict'] as const;
  const surfaces = ['--ig-bg', '--ig-surface', '--ig-surface-2'] as const;
  const failing: string[] = [];
  for (const state of states) {
    for (const surface of surfaces) {
      const ratio = contrastRatio(colors[state], colors[surface]);
      if (ratio < 3) failing.push(`${state} on ${surface}: ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failing, [], 'these Light state hues are below the 3:1 non-text minimum');
});

test('U1 R1: themeFor paper state hues clear 3:1 on every surface at the opacity OVERLAY_TREATMENTS draws them', () => {
  // The editor draws some states faded, so what lands on the page is the hue
  // blended into the surface, not the hue itself. This measures the blend.
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };
  const luminance = (hex: string): number => {
    const value = Number.parseInt(hex.slice(1), 16);
    return (
      0.2126 * channel((value >> 16) & 255) +
      0.7152 * channel((value >> 8) & 255) +
      0.0722 * channel(value & 255)
    );
  };
  const contrastRatio = (a: string, b: string): number => {
    const first = luminance(a);
    const second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };
  const over = (fg: string, bg: string, alpha: number): string => {
    const f = Number.parseInt(fg.slice(1), 16);
    const b = Number.parseInt(bg.slice(1), 16);
    const mix = (shift: number): number =>
      Math.round(alpha * ((f >> shift) & 255) + (1 - alpha) * ((b >> shift) & 255));
    return `#${[mix(16), mix(8), mix(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  };

  const { colors } = themeFor('paper');
  const stateTokens: readonly string[] = ['--ig-state-invalid', '--ig-state-failed', '--ig-state-conflict'];
  const surfaces = ['--ig-bg', '--ig-surface', '--ig-surface-2'] as const;
  const drawn = Object.entries(OVERLAY_TREATMENTS).filter(
    ([, treatment]) => treatment.hueToken !== null && stateTokens.includes(treatment.hueToken),
  );
  // Without at least one state drawing a state hue, the loop below would
  // measure nothing and pass.
  assert.ok(drawn.length > 0, 'no overlay treatment paints with a state hue');

  const failing: string[] = [];
  for (const [state, treatment] of drawn) {
    const hue = colors[treatment.hueToken as keyof typeof colors];
    const alpha = treatment.opacity ?? 1;
    for (const surface of surfaces) {
      const bg = colors[surface];
      const ratio = contrastRatio(over(hue, bg, alpha), bg);
      if (ratio < 3) {
        failing.push(`${state} (${String(treatment.hueToken)} at ${String(alpha)}) on ${surface}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failing, [], 'these Light state hues fall below 3:1 once drawn at their opacity');
});
});

describe("more tests 3", function () {
test("themeFor('paper') gives each edit state its own light hue, not another state's", () => {
  // Three dark hues that clear the contrast bar would still pass a contrast
  // check if two of them were swapped, yet "refused" would then draw in the
  // "conflict" colour. So each token is held to the value the viewer's tested
  // light palette gives that same state.
  const colors = themeFor('paper').colors;
  const expected = {
    '--ig-state-invalid': '#5A0000',
    '--ig-state-failed': '#3D0F00',
    '--ig-state-conflict': '#5C4300',
  } as const;
  for (const [token, value] of Object.entries(expected)) {
    assert.equal(
      colors[token as keyof typeof expected].toUpperCase(),
      value,
      `${token} in the Light theme is not the viewer's tested light value`,
    );
  }
});

test("asking for the Light theme first, and twice, leaves themeFor('default') the untouched defaultTheme", () => {
  // A Light theme built by writing into defaultTheme's own colours would turn
  // the Dark workspace light as soon as a reader toggled once. Asking in the
  // order a page toggle does (Light, Light again, then Dark) exposes that.
  const first = themeFor('paper');
  const second = themeFor('paper');
  const dark = themeFor('default');

  assert.deepEqual(second.colors, first.colors, 'asking for the Light theme twice changed it');
  assert.equal(dark, defaultTheme, 'the Dark workspace is not the packages default theme');
  assert.notEqual(first.colors, defaultTheme.colors, 'the Light theme shares the Dark theme colour object');
  const shared = COLOR_TOKENS.filter((token) => first.colors[token] === dark.colors[token]);
  assert.deepEqual(shared, [], 'the Light and Dark themes carry the same value for these tokens');
});

test("themeFor('paper') sets the three state tokens under their exact names, with no stray colour key", () => {
  // A misspelled token name is silent: the stylesheet never reads the extra
  // property, and the real one keeps the dark hue it inherits. So the Light
  // theme must name exactly the viewer's colour tokens, and the three state
  // tokens must no longer hold the dark theme's values.
  const colors = themeFor('paper').colors;
  assert.deepEqual(Object.keys(colors).sort(), [...COLOR_TOKENS].sort(), 'the Light theme names a colour token the viewer does not define');
  for (const token of ['--ig-state-invalid', '--ig-state-failed', '--ig-state-conflict'] as const) {
    assert.notEqual(colors[token], defaultTheme.colors[token], `${token} still inherits the dark theme's hue`);
  }
});
});

/**
 * The Dark workspace is the packages' default theme, so this page must not
 * restyle the packages from its own stylesheet: a `--ig-*` property set here,
 * or a rule on one of the packages' `.ig-` classes, would change the Dark
 * workspace without passing through a theme. The one exception is the loading
 * pulse, which the packages leave to the host on `.ig-skeleton-block`.
 */
const HOST_STYLED_PACKAGE_CLASS = 'ig-skeleton-block';

/** Comments are prose, and the sheet's prose names `--ig-*` tokens it does not set. */
function withoutCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function packagePropertiesSetIn(css: string): string[] {
  return [...withoutCssComments(css).matchAll(/(?:^|[{;\s])(--ig-[\w-]+)\s*:/gm)].map(([, name]) => name ?? '');
}

function packageClassesSelectedIn(css: string): string[] {
  return [...withoutCssComments(css).matchAll(/([^{};]+)\{/g)].flatMap(([, selector]) =>
    [...(selector ?? '').matchAll(/\.(ig-[\w-]+)/g)].map(([, name]) => name ?? ''),
  );
}

test('the demo stylesheet sets no --ig-* property and styles no package class but the loading pulse', () => {
  assert.deepEqual(packagePropertiesSetIn(stylesheet), [], 'styles.css sets a package token outside any theme');
  assert.deepEqual(
    packageClassesSelectedIn(stylesheet).filter((name) => name !== HOST_STYLED_PACKAGE_CLASS),
    [],
    'styles.css restyles a package class',
  );
});

test('CONTROL: the package-styling check finds the loading pulse rule and a planted token', () => {
  // A scan that reads no selectors passes as loudly as one that reads them all,
  // so prove it sees the one package class this sheet does style, and that
  // both patterns match what they are meant to catch.
  assert.ok(
    packageClassesSelectedIn(stylesheet).includes(HOST_STYLED_PACKAGE_CLASS),
    'the selector scan does not see the .ig-skeleton-block rule',
  );
  const planted = '/* --ig-bg: prose */ .page .ig-node:hover { --ig-bg: #000; color: var(--ig-text); }';
  assert.deepEqual(packagePropertiesSetIn(planted), ['--ig-bg']);
  assert.deepEqual(packageClassesSelectedIn(planted), ['ig-node']);
});
