import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EDGE_TOKENS as EDGES,
  GHOSTED_STATE_TOKENS as GHOSTED,
  GHOST_ALPHA,
  STATE_TOKENS as STATES,
  SURFACE_TOKENS as SURFACES,
  TEXT_TOKENS as TEXT,
  composite,
  contrastRatio,
} from './testing/contrast.ts';
import {
  COLOR_TOKENS,
  EFFECT_TOKENS,
  METRIC_TOKENS,
  THEME_TOKENS,
  TYPE_TOKENS,
  defaultTheme,
  extendTheme,
  themeCss,
  resolveTheme,
  type ColorToken,
  type MetricToken,
  type Theme,
  type TypeToken,
} from './theme.ts';
import { fitLabel } from './layout.ts';
import { renderViewer } from './render.ts';
import { viewerStylesheet } from './styles.ts';
import { fixtureDocument } from './testing/fixtures.ts';
import { paperTheme } from './acceptance.test.ts';


describe('the theme contract', () => {
  it('lists exactly the tokens the theme supplies, in both directions', () => {
    const supplied = [
      ...Object.keys(defaultTheme.colors),
      ...Object.keys(defaultTheme.type),
      ...Object.keys(defaultTheme.metrics),
      ...Object.keys(defaultTheme.effects),
    ].sort();

    assert.deepEqual(supplied, [...THEME_TOKENS].sort());
  });

  it('composes THEME_TOKENS from its four groups with no overlap', () => {
    const groups = [...COLOR_TOKENS, ...TYPE_TOKENS, ...METRIC_TOKENS, ...EFFECT_TOKENS];
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

  it('holds every edit-state hue to that same non-text bar', () => {
    // A state hue that does not clear it is a real defect and not a cosmetic
    // one: the ghost, the ✕ and the conflict's pair are the ONLY evidence a
    // write went wrong, and an overlay drawn at reduced opacity starts from
    // this ratio rather than improving on it.
    for (const state of STATES) {
      for (const surface of SURFACES) {
        const ratio = contrastRatio(defaultTheme.colors[state], defaultTheme.colors[surface]);
        assert.ok(
          ratio >= 3,
          `${state} on ${surface} measures ${ratio.toFixed(2)}:1, below the 3:1 non-text minimum`,
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

describe('the second documented theme keeps up with the first', () => {
  it('overrides EVERY colour token, so a new one cannot be forgotten', () => {
    // THE CLASS, not the instance. Three state tokens were added to the dark
    // theme and not to this one, so a host following the documented light
    // palette kept dark-optimised hues and the mutation states were close to
    // invisible on white. Any token added from here on fails this test until
    // the light theme answers for it.
    const overridden = Object.entries(paperTheme.colors)
      .filter(([token, value]) => value !== defaultTheme.colors[token as ColorToken])
      .map(([token]) => token);
    assert.deepEqual(
      COLOR_TOKENS.filter((token) => !overridden.includes(token)),
      [],
      'the light theme inherits a dark-theme colour',
    );
  });

  it('clears the non-text bar for every state hue at full strength, on both themes', () => {
    for (const [name, theme] of [['dark', defaultTheme], ['light', paperTheme]] as const) {
      for (const state of STATES) {
        for (const surface of SURFACES) {
          const bg = theme.colors[surface];
          const ratio = contrastRatio(theme.colors[state], bg);
          assert.ok(ratio >= 3, `${name}: ${state} on ${surface} measures ${ratio.toFixed(2)}:1`);
        }
      }
    }
  });

  it('keeps the GHOSTED state hues legible once they are faded', () => {
    // A FLOOR, deliberately, rather than a mirror of a consumer's table — see
    // `GHOSTED_STATE_TOKENS`. It covers only the tokens meant to be faded: a
    // conflict draws two held versions at full strength, so holding its hue to
    // a fade it never receives would reject a perfectly good value.
    for (const [name, theme] of [['dark', defaultTheme], ['light', paperTheme]] as const) {
      for (const state of GHOSTED) {
        for (const surface of SURFACES) {
          const bg = theme.colors[surface];
          const ratio = contrastRatio(composite(theme.colors[state], bg, GHOST_ALPHA), bg);
          assert.ok(
            ratio >= 3,
            `${name}: ${state} ghosted onto ${surface} measures ${ratio.toFixed(2)}:1`,
          );
        }
      }
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

describe('a theme built against an earlier version', () => {
  /** A complete `Theme` a 0.1.0 consumer could have built and stored. */
  function withoutNewestMetric(): Theme {
    const metrics: Record<string, number> = { ...defaultTheme.metrics };
    delete metrics['--ig-label-char-width'];
    return { ...defaultTheme, metrics } as unknown as Theme;
  }

  it('does not turn a missing metric into NaN geometry', () => {
    // A missing metric does not fail loudly: it reads `undefined`, arithmetic
    // yields `NaN`, and every comparison against `NaN` is false — so a fitting
    // check silently passes everything. Measured before the fallback: a
    // 60-character title came back WHOLE with an ellipsis appended, which is
    // worse overflow than the defect `--ig-label-char-width` was added to fix.
    const drawn = fitLabel(withoutNewestMetric(), 'W'.repeat(60), 211.2);

    assert.ok([...drawn].length < 30, `a stale theme kept ${String([...drawn].length)} of 60 characters`);
    assert.ok(drawn.endsWith('\u2026'));
  });

  it('never emits an undefined custom property', () => {
    // `themeCss` wrote a literal `undefinedpx`, which is not a value any
    // browser reads — so the host installed a stylesheet with a hole in it.
    const css = themeCss(withoutNewestMetric());

    assert.equal(/undefined/.test(css), false, css);
    assert.match(css, /--ig-label-char-width: 6px;/);
  });

  it('fills colours and type the same way, not just metrics', () => {
    // The token that prompted this was a metric; the rule is about a THEME
    // being older than the package, which is not specific to one group.
    const colors: Record<string, string> = { ...defaultTheme.colors };
    delete colors['--ig-accent'];
    const filled = resolveTheme({ ...defaultTheme, colors } as unknown as Theme);

    assert.equal(filled.colors['--ig-accent'], defaultTheme.colors['--ig-accent']);
  });
});

/**
 * The tokens added so the theme can express §16 of the design canvas.
 *
 * Held as one list because every assertion below is about the CLASS — what a
 * newly added token must do, and what it must not disturb — rather than about
 * any one of them. A token added later and left out of this list fails
 * `accounts for every type and metric token as either shipped or expansion`
 * below, which is the guard that keeps the list from quietly falling behind
 * the groups it is derived from — the tests that iterate `EXPANSION` itself
 * cannot see a token that is missing from it.
 */
const EXPANSION: readonly string[] = Object.freeze([
  '--ig-font-size-micro',
  '--ig-font-size-pill',
  '--ig-weight-regular',
  '--ig-weight-medium',
  '--ig-weight-strong',
  '--ig-weight-heavy',
  '--ig-tracking-label',
  '--ig-tracking-group',
  '--ig-tracking-pill',
  '--ig-tracking-badge',
  '--ig-space-micro',
  '--ig-space-snug',
  '--ig-space-loose',
  '--ig-space-wide',
  '--ig-radius-small',
  '--ig-radius-large',
  '--ig-row-min-height',
  '--ig-row-padding-block',
  '--ig-band-rail',
  '--ig-tint-fill',
  '--ig-tint-border',
  '--ig-tint-wash',
  '--ig-tint-unit',
  '--ig-elevation-raised',
  '--ig-elevation-overlay',
]);

describe('the vocabulary the §16 design needs', () => {
  it('carries a weight, a tracking, a spacing scale, an elevation and a growable row', () => {
    // THE SHOPPING LIST FROM THE ISSUE, asserted as capability rather than as
    // names — the design cannot be drawn at all without each of these, and
    // "the theme has more tokens now" is not the property that matters.
    const has = (token: string): boolean => THEME_TOKENS.includes(token);

    assert.ok(TYPE_TOKENS.some((token) => token.startsWith('--ig-weight-')), 'no weight token');
    assert.ok(TYPE_TOKENS.some((token) => token.startsWith('--ig-tracking-')), 'no tracking token');
    assert.ok(
      METRIC_TOKENS.filter((token) => token.startsWith('--ig-space')).length >= 6,
      'the spacing scale is still under six steps',
    );
    assert.ok(
      new Set(TYPE_TOKENS.filter((token) => token.startsWith('--ig-weight-'))).size >= 4,
      '§16b draws its station rank numbers at a weight §16a does not use',
    );
    assert.ok(EFFECT_TOKENS.some((token) => token.startsWith('--ig-elevation-')), 'no elevation');
    assert.ok(EFFECT_TOKENS.some((token) => token.startsWith('--ig-tint-')), 'no tint');
    assert.ok(has('--ig-row-min-height') && has('--ig-row-padding-block'), 'the row cannot grow');
  });

  it('supplies a default for every one of them', () => {
    for (const token of EXPANSION) {
      assert.ok(THEME_TOKENS.includes(token), `${token} is not in any group`);
    }
  });

  it('emits each one, and lets a host override each one', () => {
    // Done-when 3, and it is one test rather than three because a token is
    // only genuinely themeable when all three hold at once: it reaches the
    // CSS, `extendTheme` composes it, and the override is what lands.
    const marked = extendTheme(defaultTheme, {
      type: Object.fromEntries(
        TYPE_TOKENS.map((token) => [token, 'TYPE-OVERRIDE']),
      ) as Record<TypeToken, string>,
      metrics: Object.fromEntries(
        METRIC_TOKENS.map((token) => [token, 999]),
      ) as Record<MetricToken, number>,
      effects: Object.fromEntries(
        EFFECT_TOKENS.map((token) => [token, 'EFFECT-OVERRIDE']),
      ) as Record<(typeof EFFECT_TOKENS)[number], string>,
    });
    const css = themeCss(marked);

    for (const token of TYPE_TOKENS) assert.match(css, new RegExp(`${token}: TYPE-OVERRIDE;`));
    for (const token of METRIC_TOKENS) assert.match(css, new RegExp(`${token}: 999px;`));
    for (const token of EFFECT_TOKENS) assert.match(css, new RegExp(`${token}: EFFECT-OVERRIDE;`));
    // And the base is untouched, so an override is not a mutation.
    assert.equal(defaultTheme.metrics['--ig-space-wide'], 20);
  });

  it('gives an effect no px unit, because none of them is a length', () => {
    // `themeCss` appends `px` to every METRIC, and a proportion or a whole
    // box-shadow with `px` glued to its end is a declaration the browser
    // discards silently. This is the assertion that keeps a future tint or
    // elevation out of the metric group.
    const css = themeCss(defaultTheme);
    for (const token of EFFECT_TOKENS) {
      const declaration = new RegExp(`${token}: ([^;]+);`).exec(css);
      assert.ok(declaration !== null, `${token} is not emitted`);
      assert.equal(
        /px$/.test(declaration[1] as string),
        false,
        `${token} was emitted as "${String(declaration[1])}", which ends in a unit it has no use for`,
      );
    }
  });

  it('lets only the two elevations name a colour, and every other effect none', () => {
    // The issue's constraint, executable: a tint is applied by the consumer
    // against a colour token that already exists, so a literal colour in one
    // would be a palette entry hiding in a group nothing measures for
    // contrast. ASSERTED OVER THE WHOLE GROUP rather than over the tokens
    // named `--ig-tint-*`: a filtered assertion is silent about exactly the
    // token a future author adds under a new name, which is the one case worth
    // catching. The elevations are the declared exception — see the group's
    // own comment — and naming them here is what makes a THIRD colour-bearing
    // effect fail rather than pass by resemblance.
    const mayCarryColour = ['--ig-elevation-raised', '--ig-elevation-overlay'];
    const colour = /#[0-9A-Fa-f]{3,8}|\brgba?\(|\bhsla?\(/;

    for (const token of EFFECT_TOKENS) {
      const value = defaultTheme.effects[token];
      if (mayCarryColour.includes(token)) {
        assert.match(value, colour, `${token} is declared as an elevation but names no colour`);
        continue;
      }
      assert.equal(colour.test(value), false, `${token} names a colour: "${value}"`);
      assert.match(value, /^\d+(?:\.\d+)?%$/, `${token} is not a proportion`);
    }
  });
});

describe('a host that sets none of the new tokens renders as it did before', () => {
  /**
   * Every type and metric token that shipped BEFORE the expansion, with the
   * value it shipped with.
   *
   * A NAME LIST WOULD NOT BE THE PIN. Byte-identical rendering survives a
   * rename being caught and a value being changed being missed, and the second
   * is the likelier accident when a scale is added around existing steps —
   * `--ig-space` is exactly the kind of token a six-step scale invites someone
   * to "regularise". Colours are absent because the contrast suite already
   * measures each of them against a bar.
   */
  const SHIPPED: Readonly<Record<string, string | number>> = Object.freeze({
    '--ig-font-ui': 'Geist, ui-sans-serif, system-ui, sans-serif',
    '--ig-font-mono': "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
    '--ig-font-size': '13px',
    '--ig-font-size-small': '11px',
    '--ig-line-height': '1.45',
    '--ig-space': 12,
    '--ig-space-tight': 6,
    '--ig-radius': 6,
    '--ig-row-height': 44,
    '--ig-station-size': 12,
    '--ig-station-halo': 4,
    '--ig-stroke': 1.5,
    '--ig-stroke-connector': 1.6,
    '--ig-terminal-length': 9,
    '--ig-terminal-width': 8,
    '--ig-gutter-width': 208,
    '--ig-spine-width': 360,
    '--ig-char-width': 7.8,
    '--ig-label-char-width': 6,
    '--ig-focus-ring': 2,
  });

  it('keeps every token that shipped before, at the value it shipped with', () => {
    for (const [token, value] of Object.entries(SHIPPED)) {
      const actual =
        typeof value === 'number'
          ? defaultTheme.metrics[token as MetricToken]
          : defaultTheme.type[token as TypeToken];
      assert.equal(actual, value, `${token} changed`);
    }
  });

  it('accounts for every type and metric token as either shipped or expansion', () => {
    // The other direction: a token that is in neither list is one nobody
    // decided about, and this test is how it gets noticed.
    const unaccounted = [...TYPE_TOKENS, ...METRIC_TOKENS, ...EFFECT_TOKENS].filter(
      (token) => !(token in SHIPPED) && !EXPANSION.includes(token),
    );
    assert.deepEqual(unaccounted, []);
  });

  it('leaves the stylesheet reading none of the new tokens', () => {
    // WHY THIS IS THE BYTE-IDENTITY PROOF and not a snapshot. A custom
    // property changes nothing until something reads it, so a default host's
    // rendering can only move if the stylesheet or the markup names a new
    // token. Recomposing §16 against these tokens is the NEXT issue, and this
    // assertion is what will fail first when it starts — deliberately.
    const referenced = [...viewerStylesheet.matchAll(/var\((--[a-z0-9-]+)/g)].map(
      (match) => match[1] as string,
    );
    assert.deepEqual(referenced.filter((token) => EXPANSION.includes(token)), []);
  });

  it('leaves the rendered markup naming none of them either', () => {
    // The stylesheet is one of the two places a token can be read; the layout
    // writes properties inline onto elements, which is the other.
    for (const projection of ['linear', 'graph', 'tree'] as const) {
      const { markup } = renderViewer(fixtureDocument, { projection });
      for (const token of EXPANSION) {
        assert.equal(markup.includes(token), false, `${token} reached the ${projection} markup`);
      }
    }
  });
});
