import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  METRIC_TOKENS,
  THEME_TOKENS,
  defaultTheme,
  renderViewer,
  viewerStylesheet,
} from '@issuegraph/viewer';

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
  // A HEADER WITH EVERY FACT THE HOST CAN STATE. Each member of §17a's header
  // is omitted when its fact is absent, so a render with no host facts leaves
  // all of them looking orphaned in the "no rule without a class" direction.
  renderWorkspace(
    {
      ...DOCUMENT,
      host: {
        identity: 'acme/widgets',
        firstPass: 'First pass',
      },
    },
    { words: WORKSPACE_WORDS },
  ),
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
  // AN ISSUE ON THE RECEIVING END OF TWO DIRECTED EDGES. `i0006` is the `to` of
  // the duplicate and the decomposition, so this is the only render that draws
  // the inbound marker — and the inbound row is also the one that draws NO
  // remove control, so without it the slot's two exclusive occupants are never
  // both on screen.
  renderWorkspace(DOCUMENT, { words: WORKSPACE_WORDS, selection: { kind: 'issue', key: 'i0006' } }),
  // THE CREATE PATH'S SECOND STEP. `+ add` is drawn by the render above; the
  // numbered kind list needs a live draft with no kind chosen yet, which no
  // render reaches by selecting alone.
  renderWorkspace(DOCUMENT, {
    words: WORKSPACE_WORDS,
    selection: { kind: 'issue', key: 'i0001' },
    draft: { source: 'i0001', target: null, kind: null },
  }),
  // THE SAME STEP UNDER A PANEL THAT IS NOT ITS SOURCE. A draft can outlive the
  // selection it began under, and the step is drawn anyway — it carries the only
  // pointer cancel there is — with a line naming whose draft it is. That line is
  // reached by no other render here.
  renderWorkspace(DOCUMENT, {
    words: WORKSPACE_WORDS,
    selection: { kind: 'issue', key: 'i0003' },
    draft: { source: 'i0001', target: null, kind: null },
  }),
  // A REFUSED EDIT, IN THE ROW IT WOULD HAVE BEEN. The capsule replaces a row
  // rather than joining the list, so it needs a refusal naming an edge the
  // subject actually has — and `phantom`, which is what makes it a capsule at
  // all rather than a reason attached to the row.
  renderWorkspace(DOCUMENT, {
    words: WORKSPACE_WORDS,
    selection: { kind: 'issue', key: 'i0001' },
    refusals: [{ edgeId: 'blocked-by|i0001|i0002', code: 'would-cycle', carrier: 'i0001', phantom: true }],
  }),
  // AND THE OTHER SHAPE OF THE SAME FACT. A refusal about an edge that EXISTS
  // keeps its row and attaches the reason to it, which is a different rule
  // (`.ig-relationship[data-ig-code]`) that no other render here reaches.
  renderWorkspace(DOCUMENT, {
    words: WORKSPACE_WORDS,
    selection: { kind: 'issue', key: 'i0001' },
    refusals: [{ edgeId: 'blocked-by|i0001|i0002', code: 'duplicate-edge', carrier: 'i0001', phantom: false }],
  }),
  // §17b's TWO RECOVERY CARDS, WITH THE DIFFERENCE OPEN. Both states at once
  // because they take different hues and different border grammar, and the open
  // difference because its lists are drawn by nothing else here — a closed card
  // would leave every `.ig-recovery-diff*` rule styling markup no render emits,
  // which is exactly what this suite refuses.
  renderWorkspace(DOCUMENT, {
    words: WORKSPACE_WORDS,
    selection: { kind: 'issue', key: 'i0001' },
    diffOpen: 'm-conflict',
    recoveries: [
      {
        kind: 'failed',
        mutationId: 'm-failed',
        edgeId: 'blocked-by|i0001|i0002',
        carrier: 'i0001',
        reason: 'the tracker was unreachable',
      },
      {
        kind: 'conflict',
        mutationId: 'm-conflict',
        edgeId: 'blocked-by|i0001|i0003',
        carrier: 'i0001',
        // A REFRESH ERROR TOO, so its own rule is reached. It is the state a
        // reader lands in when `retry on latest` cannot even read.
        refreshError: 'the tracker did not answer',
        diff: {
          upstreamOnly: [
            { id: 'blocked-by|i0001|i0004', kind: 'blocked-by', from: 'i0001', to: 'i0004' },
          ],
          mineOnly: [
            { id: 'blocked-by|i0001|i0003', kind: 'blocked-by', from: 'i0001', to: 'i0003' },
          ],
          mineRemoved: [
            { id: 'blocked-by|i0001|i0005', kind: 'blocked-by', from: 'i0001', to: 'i0005' },
          ],
          carrierReversed: [
            {
              id: 'serialize-with|i0001|i0006',
              mine: { id: 'serialize-with|i0001|i0006', kind: 'serialize-with', from: 'i0001', to: 'i0006' },
              upstream: { id: 'serialize-with|i0001|i0006', kind: 'serialize-with', from: 'i0006', to: 'i0001' },
            },
          ],
          issuesChanged: [
            {
              ref: 'i0001',
              mine: { ref: 'i0001', title: 'as I have it', state: 'open' },
              upstream: { ref: 'i0001', title: 'as they have it', state: 'open' },
            },
          ],
        },
      },
    ],
  }),
  // AN OPEN DIFFERENCE WITH NOTHING ON THIS PANEL. Reachable and worth its own
  // render: the upstream change can be somewhere else in the backlog entirely,
  // and the card says so rather than opening onto a blank.
  renderWorkspace(DOCUMENT, {
    words: WORKSPACE_WORDS,
    selection: { kind: 'issue', key: 'i0001' },
    diffOpen: 'm-elsewhere',
    recoveries: [
      {
        kind: 'conflict',
        mutationId: 'm-elsewhere',
        edgeId: 'blocked-by|i0001|i0003',
        carrier: 'i0001',
        refreshError: null,
        diff: { upstreamOnly: [], mineOnly: [], mineRemoved: [], issuesChanged: [], carrierReversed: [] },
      },
    ],
  }),
  // THE UNPLACED REGION. A recovery whose carrier is `null` belongs to no panel
  // and is drawn under its own heading on every one — the only render here that
  // reaches that heading.
  renderWorkspace(DOCUMENT, {
    words: WORKSPACE_WORDS,
    selection: { kind: 'issue', key: 'i0001' },
    recoveries: [
      {
        kind: 'failed',
        mutationId: 'm-nowhere',
        edgeId: 'blocked-by|gone|alsogone',
        carrier: null,
        reason: 'the tracker refused it',
      },
    ],
  }),
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

  it('sizes the spacer by the row PITCH layer 1 actually draws', () => {
    // The pitch has to be the sum of everything between one row's top and the
    // next's, and layer 1 decides what that is. It used to be a min-height plus
    // a margin, and sizing the spacer on the height alone undercut every
    // omitted row by the gap — 44 of a 50px pitch — so a host dividing its
    // scroll position by the measured pitch could not reach the tail of the
    // order at all.
    //
    // §16 SEPARATES ITS ROWS WITH THE PANEL'S OWN HAIRLINES, so there is no
    // margin left to add: the pitch is the floor. Kept as an assertion with a
    // POSITIVE CONTROL on layer 1 below, so a row that grows a gap again fails
    // here rather than silently reintroducing the undercount.
    const rule = css.match(/\.ig-rail-spacer\s*\{([^}]*)\}/)?.[1];
    assert.ok(rule !== undefined, 'nothing sizes the spacer');
    assert.ok(rule.includes('--ig-row-min-height'), 'the pitch omits the row floor');
    // The count is a factor, or the spacer is one row tall whatever it omits.
    assert.match(rule, /\*\s*var\(--ig-rail-rows/);

    const viewerCss = withoutComments(viewerStylesheet);
    const slot = viewerCss.match(/\.ig-slot\s*\{([^}]*)\}/)?.[1];
    assert.ok(slot !== undefined, 'layer 1 no longer styles .ig-slot');
    assert.match(slot, /min-height:\s*var\(--ig-row-min-height\)/);
    assert.equal(
      /margin-bottom/.test(slot),
      false,
      'a row carries a margin again, so the spacer pitch is short by it',
    );
  });

  it('lets the head’s baseline reach the control sitting on it', () => {
    // A COMMENT THAT DESCRIBED THE OPPOSITE OF THE CASCADE. `.ig-inspector-head`
    // is a baseline row and says in terms that this is so a caps heading and a
    // sentence-case button sit on one optical line — while the button was in a
    // shared quiet-button rule declaring `align-self: flex-start`, which beats
    // the container's `align-items` and left it top-aligned. The alignment
    // belongs to the two buttons in the create step, a COLUMN, where without it
    // they stretch to the panel's full width.
    const head = css.match(/\.ig-inspector-head\s*\{([^}]*)\}/)?.[1];
    assert.ok(head !== undefined, 'nothing lays out the panel heading row');
    assert.match(head, /align-items:\s*baseline/);

    for (const rule of [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)]) {
      const [, selector = '', body = ''] = rule;
      if (!selector.includes('.ig-inspector-clear') || !/align-self/.test(body)) continue;
      assert.fail(`the clear control overrides the head's baseline: ${selector.trim()}`);
    }
  });

  it('rings every control in the relationship row, and rings them alike', () => {
    // THE CLAIM THE PICKER'S SHEET USED TO CARRY FOR THE FLIP, moved here with
    // the control. §17b calls direction the most common encoding mistake, so
    // the control that corrects it is the last one that should be invisible to
    // a keyboard reader on a host that resets the UA outline.
    //
    // AND RINGS THEM ALIKE. The offset is asserted to be one value across the
    // three, because the flip arrived from another sheet carrying that sheet's
    // hairline offset — a difference no test could see, and one that reads on
    // screen as a rendering fault rather than as a distinction.
    const offsets = new Set<string>();
    for (const control of ['select', 'remove', 'flip']) {
      const rule = css.match(
        new RegExp(`\\.ig-relationship-${control}:focus-visible\\s*\\{([^}]*)\\}`),
      )?.[1];
      assert.ok(rule !== undefined, `.ig-relationship-${control} has no focus ring`);
      assert.match(rule, /outline:/, control);
      const offset = rule.match(/outline-offset:\s*([^;]+);/)?.[1]?.trim();
      // ASSERTED PRESENT, NOT DEFAULTED. Collapsing a missing offset to '' would
      // let all three lose the declaration together and still agree, which is
      // the one way this case could pass while the rings it exists for got worse.
      assert.ok(offset !== undefined, `.ig-relationship-${control} rings with no offset`);
      offsets.add(offset);
    }
    assert.equal(offsets.size, 1, `the row's controls ring at different offsets: ${[...offsets]}`);
  });

  it('wraps the relationship row rather than pushing its controls out of the zone', () => {
    // §17b's STATEMENT INHERITED '.ig-picker-direction''s WRAPPING, and this is
    // the case that says so. That rule wrapped because a qualified reference is
    // long, and a statement whose object is cut off says something other than
    // what the format holds. The statement is this row now, and the inspector is
    // a fixed 40-character track with no horizontal scroll — so without a wrap
    // an 'owner/repo#602' pair pushes the slot and the flip clean out of the
    // zone, and the control §17b calls the guard against the most common
    // encoding mistake becomes unreachable.
    //
    // BOTH CONTAINERS, because wrapping one leaves the other overflowing: the
    // row wraps its trailing controls, the statement wraps its reference pair.
    for (const selector of ['\\.ig-relationship', '\\.ig-relationship-select,\\s*\\.ig-relationship-name']) {
      const rule = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1];
      assert.ok(rule !== undefined, `no rule for ${selector}`);
      assert.match(rule, /flex-wrap:\s*wrap/, selector);
    }
  });

  it('pushes the row\u2019s trailing controls out by the statement, not by a margin', () => {
    // WHAT ACTUALLY PUTS §17b's FLIP AT THE ROW'S END. The flip carries no
    // margin of its own — see the rule's own comment — so the position is this
    // declaration plus the draw order. Without it the control would sit against
    // the statement rather than where frame 17b draws it, and every assertion
    // about the markup would stay green.
    const select = css.match(/\.ig-relationship-select,\s*\.ig-relationship-name\s*\{([^}]*)\}/)?.[1];
    assert.ok(select !== undefined, 'nothing lays out the relationship row\u2019s statement');
    assert.match(select, /flex:\s*1/);
    const flip = css.match(/\.ig-relationship-flip\s*\{([^}]*)\}/)?.[1];
    assert.ok(flip !== undefined, 'the flip has no rule');
    assert.equal(/margin-left:\s*auto/.test(flip), false, 'an inert margin came back');
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

  /**
   * THE ASSERTION THE ONE ABOVE WAS MISSING, and the reason #122 found a 330px
   * cyan block behind a green test.
   *
   * Matching the rule proves a declaration is present; it says nothing about
   * what the declaration RESOLVES to. This rule spent its whole life reading
   * `--ig-spine-width` (330, §16b's spine card width) and `--ig-accent` (the
   * cyan the panel spends on operator numbers), and the test above passed on
   * every run. A pin that is green about a string is not green about the
   * property the design fixes.
   *
   * So this one reads the tokens out of the theme and checks the VALUES §17d
   * names: 2px, and the palette's own gold.
   */
  it('resolves the bar to §17d’s 2px gold, not merely to a declaration', () => {
    const bar = css.match(
      new RegExp(`\\[data-zone='rail'\\] \\[${AUDIT_SEVERITY_ATTRIBUTE}\\]\\s*\\{([^}]*)\\}`),
    )?.[1];
    assert.ok(bar !== undefined);

    const shadow = /box-shadow:\s*inset\s+var\((--[a-z0-9-]+)\)[^;]*?var\((--[a-z0-9-]+)\)/.exec(bar);
    assert.ok(shadow !== null, 'the bar no longer reads its width and hue from theme tokens');
    const [, widthToken = '', hueToken = ''] = shadow;

    // The theme is grouped (colors / type / metrics / effects), so a token is
    // looked up across the groups rather than off the root.
    const valueOf = (token: string): string | number | undefined => {
      for (const group of Object.values(defaultTheme)) {
        const found: unknown = (group as Record<string, unknown>)[token];
        if (typeof found === 'string' || typeof found === 'number') return found;
      }
      return undefined;
    };

    assert.equal(
      valueOf(widthToken),
      2,
      `§17d fixes the bar at 2px; ${widthToken} is ${String(valueOf(widthToken))}`,
    );
    assert.equal(
      valueOf(hueToken),
      valueOf('--ig-edge-serialize-with'),
      `§17d's bar is the palette's gold; ${hueToken} is ${String(valueOf(hueToken))}`,
    );

    // The cyan accent is spent once, on the number an operator acts on. An
    // ambient mark wearing it competes with that and stops being ambient.
    assert.notEqual(hueToken, '--ig-accent');
  });

  /**
   * ONE MARK FOR ALL FOUR SEVERITIES. §17d names a single ambient treatment and
   * puts the severity distinction in the findings list, which is host-side.
   *
   * The variant this replaces keyed on `misleading` — the LEAST urgent of the
   * four, whose own doc comment says "clearing is bookkeeping, not urgency" —
   * and gave it the invalid-state colour while every other finding, the cycle
   * that stops work included, drew in cyan. Exactly inverted.
   */
  it('draws one ambient mark, with no per-severity override', () => {
    assert.equal(
      new RegExp(`\\[${AUDIT_SEVERITY_ATTRIBUTE}='[a-z-]+'\\]`).test(css),
      false,
      'a per-severity bar override is back; §17d states one ambient treatment',
    );
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
