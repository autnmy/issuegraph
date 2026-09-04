import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { METRIC_TOKENS, THEME_TOKENS, renderViewer, viewerStylesheet } from '@issuegraph/viewer';

import { AUDIT_SEVERITY_ATTRIBUTE } from '../audit/surface.ts';
import { ZONES, renderWorkspace } from './render.ts';
import { workspaceStylesheet } from './styles.ts';
import { WORKSPACE_WORDS, backlogOf } from '../testing/workspace.ts';

/**
 * Every `calc(...)` body in the sheet, matched on BALANCED parentheses.
 *
 * Not a regular expression: a depth-limited pattern is the shape that fails
 * OPEN. The first version here allowed one level of nesting, which was enough
 * for `calc(var(--a) * 40)` and not for
 * `calc((var(--a) + var(--b)) * var(--c))` — so the moment the spacer grew a
 * grouped sum, the guard would have matched nothing at that site and reported
 * clean on the one expression it most needed to read.
 */
function calcExpressions(css: string): string[] {
  const found: string[] = [];
  for (let at = css.indexOf('calc('); at !== -1; at = css.indexOf('calc(', at + 1)) {
    const open = at + 'calc'.length;
    let depth = 0;
    for (let cursor = open; cursor < css.length; cursor += 1) {
      if (css[cursor] === '(') depth += 1;
      else if (css[cursor] === ')') {
        depth -= 1;
        if (depth === 0) {
          found.push(css.slice(open + 1, cursor));
          break;
        }
      }
    }
  }
  return found;
}

/** The stylesheet with its comments removed — a comment is not a declaration. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function classesIn(markup: string): string[] {
  return [...markup.matchAll(/class="([^"]+)"/g)].flatMap((match) => (match[1] ?? '').split(' '));
}

/**
 * Every state this surface renders, in one place.
 *
 * The states exclude each other — nothing is selected, or an issue is, or an
 * edge is; a slot is held or it is ready — so one render would leave most of
 * the stylesheet looking orphaned. Both sets below are derived from this SAME
 * list, which is what stops the two directions being wrong at once.
 */
const DOCUMENT = backlogOf(6, {
  held: ['i0005'],
  edges: [
    ['blocked-by', 'i0001', 'i0002'],
    ['duplicate-of', 'i0003', 'i0006'],
    ['serialize-with', 'i0001', 'i0003'],
    ['together-with', 'i0002', 'i0004'],
    ['decomposed-from', 'i0004', 'i0006'],
  ],
});

const RENDERS = [
  renderWorkspace(DOCUMENT, { words: WORKSPACE_WORDS }),
  renderWorkspace(DOCUMENT, { words: WORKSPACE_WORDS, selection: { kind: 'issue', key: 'i0005' } }),
  renderWorkspace(DOCUMENT, { words: WORKSPACE_WORDS, selection: { kind: 'issue', key: 'i0001' } }),
  renderWorkspace(DOCUMENT, {
    words: WORKSPACE_WORDS,
    selection: { kind: 'edge', edgeId: 'blocked-by|i0001|i0002' },
  }),
  // A WINDOW WITH ROWS ON BOTH SIDES OF IT. The spacers only render when the
  // window is narrower than the order, so without this render their rule looks
  // orphaned and the "no unstyled class" direction never sees them at all.
  renderWorkspace(DOCUMENT, { words: WORKSPACE_WORDS, rail: { start: 2, count: 2 } }),
  // A HOLD THAT NAMES ITS HOLDER. The inspector draws the subject as a control
  // only when the host supplied one, so without this render its rule looks
  // orphaned in the "no rule without a class" direction.
  renderWorkspace(
    {
      ...DOCUMENT,
      order: {
        ...DOCUMENT.order,
        slots: DOCUMENT.order.slots.map((slot) =>
          slot.lead === 'i0005'
            ? {
                ...slot,
                holds: [
                  {
                    family: 'graph' as const,
                    reason: 'blocked-by i0006 is open',
                    code: 'blocked-by-open',
                    subject: 'i0006',
                  },
                ],
              }
            : slot,
        ),
      },
      cycles: [],
    },
    { words: WORKSPACE_WORDS, selection: { kind: 'issue', key: 'i0005' } },
  ),
];

/** Every class THIS package's workspace emits, across those states. */
const EMITTED: ReadonlySet<string> = new Set(RENDERS.flatMap((result) => classesIn(result.markup)));

/** The classes the COMPOSED leaves emit over the same document, from those leaves. */
const COMPOSED: ReadonlySet<string> = new Set([
  ...classesIn(renderViewer(DOCUMENT, { projection: 'linear' }).markup),
  ...classesIn(renderViewer(DOCUMENT, { projection: 'graph' }).markup),
  // The ladder's chrome and the audit header ship their own stylesheets, which
  // `renderWorkspace` installs alongside this one.
  'ig-ladder',
  'ig-ladder-isolated',
  'ig-chip',
  'ig-audit',
  'ig-audit-toggle',
  'ig-audit-count',
  'ig-audit-label',
  // The canvas's selection halo. `renderScaleLadder` draws it when an edge is
  // selected and ships `edgeOverlayStylesheet` with it, and `renderWorkspace`
  // installs that sheet alongside this one — so these are styled, by the leaf
  // that owns them, exactly like the ladder chrome above.
  'ig-overlay',
  'ig-overlay-halo',
]);

describe('the workspace stylesheet carries structure, never a value', () => {
  const css = withoutComments(workspaceStylesheet);

  it('references only properties something actually resolves', () => {
    // A `var(--ig-…)` nothing resolves is a silent nothing: the declaration is
    // dropped, so the surface loses its look on exactly the host that installed
    // a second theme correctly.
    //
    // TWO RESOLVERS, NOT ONE. Most come from the theme. The rest are LOCAL —
    // set inline by this package's own renderer on the element that needs them,
    // the same way layer 1 carries `--ig-stage-w` and `--ig-row-x`. Those are
    // derived from the rendered markup rather than allowed by a hand-written
    // exemption, so a `var()` for a property nothing sets is still caught.
    const setInline = new Set(
      RENDERS.flatMap((result) => [...result.markup.matchAll(/(--[a-z0-9-]+)\s*:/g)]).map(
        (match) => match[1] ?? '',
      ),
    );
    assert.ok(setInline.size > 0, 'the renderer sets no local properties at all');

    const referenced = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]);
    assert.ok(referenced.length > 0, 'the stylesheet references no tokens at all');
    assert.deepEqual(
      referenced.filter(
        (token) => token === undefined || !(THEME_TOKENS.includes(token) || setInline.has(token)),
      ),
      [],
    );
  });

  it('writes no literal colour and no fixed length', () => {
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'a literal colour');
    assert.equal(/\brgba?\(/.test(css), false, 'a literal colour function');
    assert.equal(/\b\d+(\.\d+)?(px|rem|em|pt)\b/.test(css), false, 'a fixed length');
  });

  it('declares no animation and no transition', () => {
    // §17a: the audit is ambient, and a count that animates is a count demanding
    // attention it has not earned. This is where it could creep back in without
    // touching a line of TypeScript.
    assert.equal(/\banimation\b/.test(css), false, 'an animation');
    assert.equal(/\btransition\b/.test(css), false, 'a transition');
    assert.equal(/@keyframes/.test(css), false, 'a keyframes block');
  });

  it('is dark only: one palette, and no second one behind a media query', () => {
    // Light was cut after pass 1. A forked token set is the drifting second
    // implementation the package split exists to remove, and a
    // `prefers-color-scheme` block is how one arrives without anyone deciding to
    // add it.
    assert.equal(/prefers-color-scheme/.test(css), false, 'a second palette');
    assert.equal(/color-scheme\s*:/.test(css), false, 'a scheme declaration');
  });

  it('never multiplies one length by another, anywhere in the sheet', () => {
    // THE CLASS, not the one expression that had it. `themeCss` renders every
    // METRIC token with `px`, so multiplying two of them yields `7.8px * 6px` —
    // not a length, and CSS discards a declaration it cannot parse. The failure
    // is silent by construction: nothing errors, the rule is simply absent, and
    // the layout it was holding up quietly falls back.
    //
    // The metric list comes from the viewer, so a token promoted to a length
    // later is covered without editing this test. A local custom property the
    // renderer sets inline — `--ig-rail-rows` — is a unitless count and is
    // correctly not a metric, which is what makes the spacer's own calc legal.
    const metrics: ReadonlySet<string> = new Set(METRIC_TOKENS);
    const calcs = calcExpressions(css);
    assert.ok(calcs.length > 0, 'the stylesheet contains no calc() at all');

    for (const expression of calcs) {
      if (!expression.includes('*')) continue;
      // SPLIT ON SPACED OPERATORS ONLY. CSS requires whitespace around `+` and
      // `-` inside calc precisely because a bare hyphen is part of an
      // identifier — and a first version of this guard split on `[+-]`, which
      // shattered every `--ig-…` name, left no factor holding a whole `var()`,
      // counted zero lengths and passed on the very expression it was written
      // for. It ran, it was green, and it proved nothing.
      for (const product of expression.split(/\s[+-]\s/)) {
        if (!product.includes('*')) continue;
        const lengths = product
          .split('*')
          .filter((factor) => [...factor.matchAll(/var\((--[a-z0-9-]+)/g)]
            .some((match) => metrics.has(match[1] ?? '')));
        assert.ok(
          lengths.length <= 1,
          `calc(${expression}) multiplies ${String(lengths.length)} lengths together`,
        );
      }
    }
  });

  it('sizes the spacer by the whole row PITCH, not the row height', () => {
    // A .ig-slot is min-height plus margin-bottom, so row-to-row is the sum.
    // Sized on the height alone the spacer undercut every omitted row by the
    // gap — 44 of a 50px pitch on the default theme — and a host dividing its
    // scroll position by the measured pitch could not reach the tail of the
    // order at all. Systematic and exactly correctable, unlike the variable
    // row-height approximation that remains.
    const rule = css.match(/\.ig-rail-spacer\s*\{([^}]*)\}/)?.[1];
    assert.ok(rule !== undefined, 'nothing sizes the spacer');
    for (const token of ['--ig-row-height', '--ig-space-tight']) {
      assert.ok(rule.includes(token), `the pitch omits ${token}`);
    }
    // The count is a factor, or the spacer is one row tall whatever it omits.
    assert.match(rule, /\*\s*var\(--ig-rail-rows/);

    // POSITIVE CONTROL on layer 1, so this only claims what is still true of
    // it: if the slot ever stops carrying that margin, this fails loudly
    // rather than leaving the rule above looking over-built.
    const viewerCss = withoutComments(viewerStylesheet);
    const slot = viewerCss.match(/\.ig-slot\s*\{([^}]*)\}/)?.[1];
    assert.ok(slot !== undefined, 'layer 1 no longer styles .ig-slot');
    assert.match(slot, /margin-bottom:\s*var\(--ig-space-tight\)/);
    assert.match(slot, /min-height:\s*var\(--ig-row-height\)/);
  });

  it('gives each zone a fixed area rather than letting content negotiate it', () => {
    // §17f: the rail is complete at any backlog size and the canvas refuses
    // above its budget, and assembling them must not average the two. A large
    // document has to grow the canvas's refusal, never squeeze the rail out.
    assert.match(css, /grid-template-areas:/);
    for (const zone of ZONES) {
      assert.match(css, new RegExp(`\\[data-zone='${zone}'\\]`), zone);
    }
  });

  it('draws the audit bar from the mark, and only inside the rail', () => {
    const bar = css.match(
      new RegExp(`\\[data-zone='rail'\\] \\[${AUDIT_SEVERITY_ATTRIBUTE}\\]\\s*\\{([^}]*)\\}`),
    )?.[1];
    assert.ok(bar !== undefined, 'nothing draws the ambient left-bar');
    // An inset shadow, not a border: a border changes the row's box, so every
    // marked row would shift against its neighbours — a layout jump the eye
    // reads as movement, on the surface that may least afford one.
    assert.match(bar, /box-shadow:\s*inset/);
    assert.equal(/(^|;)\s*border(-\w+)?:/.test(bar), false, 'a border that would shift the row');
  });
});

describe('the stylesheet and the markup account for each other', () => {
  const css = withoutComments(workspaceStylesheet);
  const styled = new Set([...css.matchAll(/\.(ig-[a-z0-9-]+)/g)].map((match) => match[1] ?? ''));

  it('styles the selectors this package actually renders, and no others', () => {
    // Derived from the rendered markup rather than from a list kept by hand, so
    // a rule for a class nothing emits cannot survive here.
    assert.ok(styled.size > 0, 'the stylesheet declares no rules at all');
    assert.deepEqual([...styled].filter((name) => !EMITTED.has(name)), []);
  });

  it('leaves nothing this surface adds unstyled', () => {
    // The other direction: a class emitted with no rule of its own is unstyled
    // on a host that installs this stylesheet. The composed leaves' own classes
    // are excluded — they are those leaves' to style, and their sheets ship
    // alongside this one.
    assert.ok(COMPOSED.size > 0, 'the composed leaves emitted no classes at all');
    assert.deepEqual(
      [...EMITTED].filter(
        (name) => name.startsWith('ig-') && !COMPOSED.has(name) && !styled.has(name),
      ),
      [],
    );
  });
});
