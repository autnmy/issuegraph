import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  METRIC_TOKENS,
  THEME_TOKENS,
  defaultTheme,
  renderViewer,
  viewerStylesheet,
} from '@issuegraph/viewer';

import { diffOrder } from '@issuegraph/store';

import { auditStylesheet } from '../audit/styles.ts';
import { AUDIT_SEVERITY_ATTRIBUTE } from '../audit/surface.ts';
import { INITIAL_SCALE_STATE } from '../scale/commands.ts';
import { ZONES, renderWorkspace } from './render.ts';
import { reevaluateStylesheet } from '../reevaluate/styles.ts';
import { workspaceStylesheet } from './styles.ts';
import { WORKSPACE_WORDS, backlogOf } from '../testing/workspace.ts';
import { WORDS as CHANGE_WORDS, editOf, orderOf } from '../testing/reevaluate.ts';

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

/**
 * The same backlog with one issue taken OUT of the order and excluded.
 *
 * Its own constant because BOTH directions of the accounting need it: the
 * workspace renders an `.ig-footer-row` only here, and layer 1's footer classes
 * are only `COMPOSED` from a document that has one. Built by removing the key
 * from the slots as well as adding the exclusion — an issue in both places is
 * ranked, so it draws as a slot and no footer row appears at all.
 */
const WITH_AN_EXCLUSION = {
  ...DOCUMENT,
  order: {
    slots: DOCUMENT.order.slots.filter((slot) => slot.lead !== 'i0006'),
    excluded: [{ key: 'i0006', reason: 'duplicate-of' as const, canonical: 'i0003' }],
  },
};

/**
 * §17a's rail footer words, local for the reason `rail-footer.test.ts` records:
 * putting `rail` on the shared fixture would suppress the ladder's isolated
 * chip and move two committed a11y baselines as a side effect.
 */
const RAIL_WORDS = { isolated: 'carrying no edges', show: 'reveal', hide: 'fold away' };

const RENDERS = [
  renderWorkspace(DOCUMENT, { words: WORKSPACE_WORDS }),
  renderWorkspace(DOCUMENT, { words: WORKSPACE_WORDS, selection: { kind: 'issue', key: 'i0005' } }),
  renderWorkspace(DOCUMENT, { words: WORKSPACE_WORDS, selection: { kind: 'issue', key: 'i0001' } }),
  renderWorkspace(DOCUMENT, {
    words: WORKSPACE_WORDS,
    selection: { kind: 'edge', edgeId: 'blocked-by|i0001|i0002' },
  }),
  // A ROW THE ORDER EXCLUDES, which renders as an `.ig-footer-row` rather than
  // an `.ig-slot`. §17c can place a chip on one — an edit that turns an issue
  // into a duplicate takes it out of the order while its projection keeps it —
  // so without this render the rule that tints it looks orphaned, and the
  // earlier revision that named only `.ig-slot` went unnoticed.
  renderWorkspace(WITH_AN_EXCLUSION, { words: WORKSPACE_WORDS }),
  // §17c LIVE, on BOTH row shapes. Without a change and the vocabulary for it,
  // no summary, no dismiss control and no placed chip is emitted at all — so
  // every §17c rule in this sheet reads as orphaned in the accounting below,
  // and the rule that tints a footer row was added while nothing rendered one.
  renderWorkspace(WITH_AN_EXCLUSION, {
    words: { ...WORKSPACE_WORDS, change: CHANGE_WORDS },
    change: diffOrder(
      orderOf(['i0001', 'i0002', 'i0003', 'i0004', 'i0005', 'i0006']),
      orderOf(['i0002', 'i0001', 'i0003', 'i0004', 'i0005']),
      editOf(),
    ),
    orderStatus: 'held',
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
        // THE TWO #135 MOVED UP FROM LAYER 1's PANEL HEADER. Both are drawn
        // here and nowhere else now, so without them on this render their
        // rules read as orphaned — the same reason the identity and the
        // first-pass entry are on it.
        adoption: { counts: { declaring: 64, total: 312 } },
        freshness: { asOf: '14:32', age: '2m ago', refresh: '↻' },
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
  // §17f'S CAPTION WITH A FOCUS RESOLVED. Every render above leaves the canvas
  // unfocused, so the caption's focus clause — the label and the key it names —
  // was styled and never emitted, and this pair of tests is the only thing that
  // notices a rule for a class nothing draws.
  renderWorkspace(DOCUMENT, {
    words: WORKSPACE_WORDS,
    scale: { ...INITIAL_SCALE_STATE, focus: 'i0001' },
  }),
  // §17a'S RAIL FOOTER, SHUT AND OPEN. It draws only when the host has worded
  // it, so every render above leaves all four of its rules looking orphaned —
  // and the list's rule needs the second render, because the entries are not
  // emitted until the control has opened them. `WORKSPACE_WORDS` deliberately
  // carries no `rail` member (see `rail-footer.test.ts` for why the shared
  // fixture stays out of this), so the words are supplied here.
  renderWorkspace(DOCUMENT, { words: { ...WORKSPACE_WORDS, rail: RAIL_WORDS } }),
  renderWorkspace(DOCUMENT, {
    words: { ...WORKSPACE_WORDS, rail: RAIL_WORDS },
    scale: { ...INITIAL_SCALE_STATE, isolatedOpen: true },
  }),
  // §17d'S FINDINGS PANEL. It draws only for an audit that FOUND something, so
  // without this render the panel's own classes are emitted by nothing here —
  // and the share this sheet declares over `.ig-audit-panel` would look like a
  // rule for a class the workspace never draws, which is exactly what the pair
  // of tests below exists to catch.
  renderWorkspace(DOCUMENT, {
    words: WORKSPACE_WORDS,
    audit: {
      document: {
        issues: ['i0001', 'i0002'].map((ref) => ({ ref, title: `issue ${ref}`, state: 'open' as const })),
        edges: [
          { id: 'blocked-by|i0001|i0002', kind: 'blocked-by' as const, from: 'i0001', to: 'i0002' },
          { id: 'blocked-by|i0002|i0001', kind: 'blocked-by' as const, from: 'i0002', to: 'i0001' },
        ],
      },
      // A two-cycle, which is the cheapest finding to declare: the graph port is
      // the HOST's answer, so it is stated rather than derived here.
      graph: { cycles: [['i0001', 'i0002']], duplicateCanonical: () => null },
    },
  }),
  // §17d'S FOURTH CLASS, WHICH THE PANEL ABOVE CANNOT REACH. `renderAuditPanel`
  // lists the three RELATIONSHIP findings; an encoding refusal is drawn outside
  // it by `audit/refused.ts`, and only a host that REPORTS one makes it appear —
  // no document shape produces a refusal, because a refusal is a fact about a
  // raw body this package never sees. Without this render every class the block
  // emits is styled by a rule nothing draws, which is the orphan the pair of
  // tests below exists to catch.
  //
  // THE RESOLVER IS SUPPLIED SO BOTH CONTROLS DRAW. The link is withheld without
  // one, so a render that omitted it would leave `.ig-audit-refused-open` and
  // `.ig-audit-refused-away` looking orphaned in exactly the same way.
  renderWorkspace(DOCUMENT, {
    words: WORKSPACE_WORDS,
    issueUrl: (ref) => `https://example.invalid/${ref}`,
    audit: {
      document: {
        issues: ['i0001'].map((ref) => ({ ref, title: `issue ${ref}`, state: 'open' as const })),
        edges: [],
      },
      graph: { cycles: [], duplicateCanonical: () => null },
      encodingRefused: [
        { ref: 'i0001', diagnostic: 'unparseable YAML at line 3', sourceLine: 'blocked-by: [231, 234' },
      ],
    },
  }),
];

/** Every class THIS package's workspace emits, across those states. */
const EMITTED: ReadonlySet<string> = new Set(RENDERS.flatMap((result) => classesIn(result.markup)));

/** The classes the COMPOSED leaves emit over the same document, from those leaves. */
const COMPOSED: ReadonlySet<string> = new Set([
  ...classesIn(renderViewer(DOCUMENT, { projection: 'linear' }).markup),
  ...classesIn(renderViewer(DOCUMENT, { projection: 'graph' }).markup),
  // The footer group and its rows are layer 1's, drawn only for a document that
  // excludes something — so they are COMPOSED rather than this sheet's to style.
  ...classesIn(renderViewer(WITH_AN_EXCLUSION, { projection: 'linear' }).markup),
  // The ladder's chrome and the audit header ship their own stylesheets, which
  // `renderWorkspace` installs alongside this one.
  'ig-ladder',
  'ig-ladder-isolated',
  // The list that chip opens. It appears here now that a render above opens it,
  // and it is the LADDER's to style (`scaleLadderStylesheet`) even though the
  // control that opens it has moved to the rail — see `railFooter` for why the
  // virtualized rail cannot hold the list itself.
  'ig-isolated-list',
  'ig-chip',
  // EVERY CLASS `auditStylesheet` STYLES, DERIVED FROM THAT SHEET rather than
  // listed here — the idiom `reevaluateStylesheet` below already uses, and for
  // the reason this file's other direction exists: a hand list goes on passing
  // after the leaf stops styling a class, and §17d now has two surfaces' worth
  // of them (the ambient header, the findings panel, and the refused block).
  //
  // `.ig-audit-region` IS DELIBERATELY NOT AMONG THEM, and cannot be: it is not
  // in that sheet at all. It is the wrapper `renderWorkspace` draws around the
  // two audit surfaces so #177's "exactly one bounded sibling" survives the
  // second one, so its share is THIS sheet's to declare and the accounting
  // above should say so.
  //
  // COMMENTS STRIPPED FIRST, AND THAT IS NOT TIDINESS. These sheets QUOTE their
  // own selectors in prose — `audit/styles.ts` names `.ig-inspector` while
  // explaining what it does NOT style — so a raw scan admits classes the leaf
  // never styles into the allowlist for "styled by someone else", and
  // `.ig-inspector` is a class THIS sheet owns. `audit/styles.test.ts` records
  // paying for the same mistake in the other direction.
  ...[...withoutComments(auditStylesheet).matchAll(/\.(ig-[a-z0-9-]+)/g)].map(
    (match) => match[1] ?? '',
  ),
  // AND ONE THAT SHEET DELIBERATELY DOES NOT STYLE. `renderAuditHeader` emits
  // `.ig-audit-label` beside the count as a hook a host can target; its type and
  // colour come from `.ig-audit-toggle`, the button it sits inside, so a rule of
  // its own would restate an inherited value. The hand list this derivation
  // replaced carried it silently — deriving is what asked the question.
  'ig-audit-label',
  // §17c's summary, its dismiss control and its placed chips. Their rules live
  // in `reevaluateStylesheet`, which `renderWorkspace` installs alongside this
  // one — so they are that leaf's to style, exactly like the ladder chrome and
  // the audit header above. DERIVED FROM THAT SHEET rather than listed here,
  // because a hand list is the thing this file's other direction exists to
  // avoid: a class the leaf stops styling would go on passing.
  ...[...withoutComments(reevaluateStylesheet).matchAll(/\.(ig-[a-z0-9-]+)/g)].map(
    (match) => match[1] ?? '',
  ),
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

    // BOTH BUTTONS THAT SIT ON A BASELINE ROW, not just the one that was caught.
    // `+ add` joined them when §17a moved it onto the relationships header, which
    // is a baseline row for the same reason — and it arrived carrying the very
    // `align-self` this test exists to keep off such a row, because it was still
    // in the create step's COLUMN rule. Scanning only the control that was
    // wrong once leaves the next one to be found by eye.
    const relationships = css.match(/\.ig-inspector-relationships-head\s*\{([^}]*)\}/)?.[1];
    assert.ok(relationships !== undefined, 'nothing lays out the relationships header row');
    assert.match(relationships, /align-items:\s*baseline/);

    for (const rule of [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)]) {
      const [, selector = '', body = ''] = rule;
      if (!/align-self/.test(body)) continue;
      for (const control of ['.ig-inspector-clear', '.ig-inspector-addbutton']) {
        if (!selector.includes(control)) continue;
        assert.fail(`${control} overrides its row's baseline: ${selector.trim()}`);
      }
    }
  });

  it('lands the kind digit at the row\u2019s end, and keeps the header row apart', () => {
    // THE SAME CLASS OF DEFECT THE BASELINE TEST ABOVE EXISTS FOR, on the layout
    // this change reverses. §17a puts the digit in a chip at the row's end, and
    // three declarations carry that between them: the row is a flex container,
    // the chip does not grow, and its auto margin is what consumes the slack.
    // Drop any one and the chip slides back beside the glyph with every markup
    // test still green — the markup order is unchanged by such an edit.
    const option = css.match(/\.ig-kind-option\s*\{([^}]*)\}/)?.[1];
    assert.ok(option !== undefined, 'nothing lays out a kind row');
    assert.match(option, /display:\s*flex/);
    // CENTRED RATHER THAN ON A BASELINE, because a bordered chip has padding of
    // its own and sits low against the glyph and the word on a baseline.
    assert.match(option, /align-items:\s*center/);

    const digit = css.match(/\.ig-kind-digit\s*\{([^}]*)\}/)?.[1];
    assert.ok(digit !== undefined, 'nothing draws the digit chip');
    assert.match(digit, /margin-left:\s*auto/);
    assert.match(digit, /flex:\s*0 0 auto/);
    assert.match(digit, /border:/);

    // AND THE HEADER ROW SEPARATES ITS TWO CHILDREN. `+ add` sits opposite the
    // heading; without this it collapses against it.
    const head = css.match(/\.ig-inspector-relationships-head\s*\{([^}]*)\}/)?.[1];
    assert.ok(head !== undefined, 'nothing lays out the relationships header row');
    assert.match(head, /display:\s*flex/);
    assert.match(head, /justify-content:\s*space-between/);

    // THE CONTROL KEEPS THE FOCUS RING IT LEFT THE FILL BEHIND FOR. It is out of
    // the shared quiet-button treatment now, and a control that loses its ring
    // on the way out is an accessibility regression the fill change would hide.
    const ring = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].some(
      ([, selector = '', body = '']) =>
        selector.includes('.ig-inspector-addbutton:focus-visible') && /outline:/.test(body),
    );
    assert.ok(ring, 'the add control has no focus ring');
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

/**
 * A TOKEN IN THE WRONG POSITION IS DROPPED SILENTLY, and the sheet stays green.
 *
 * `--ig-tint-fill` and `--ig-tint-border` are PERCENTAGES — 8% and 30% — for
 * `color-mix` to consume. Handed to `background` or `border-color` directly they
 * are invalid, the browser drops the declaration, and the element renders with
 * no fill and no border. That shipped once here: the edit-mode pill drew as bare
 * text, and every existing check passed, because nothing about it was a hex
 * literal and the class was styled.
 */
describe('the tint tokens are only used where they mean something', () => {
  const css = withoutComments(workspaceStylesheet);

  it('never hands a percentage token to a property that wants a colour', () => {
    for (const token of ['--ig-tint-fill', '--ig-tint-border']) {
      for (const use of css.matchAll(new RegExp(`[^;{}]*var\\(${token}\\)[^;{}]*`, 'g'))) {
        assert.match(
          use[0],
          /color-mix\(/,
          `${token} is used outside color-mix, where it is invalid and dropped: ${use[0].trim()}`,
        );
      }
    }
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

/**
 * #177's other half: the zone stays ONE scroll track.
 *
 * `.ig-chrome` is a third sibling `mountWorkspace` appends to this zone, and it
 * was clipped the one time the zone was made a multi-pane layout — a flex
 * column with `overflow: hidden`, each sibling scrolling itself. The audit's
 * share is declared on the REGION that holds §17d's two surfaces, which needs no
 * such layout, so this test is the guard that the layout does not come back:
 * while the zone is a single `overflow-y: auto` track, there is no arrangement
 * in which a sibling that declares no share of its own can be cut off.
 */
describe("the inspector zone stays one track, so the mount's chrome cannot be clipped", () => {
  const zone = /\.ig-zone\[data-zone='inspector'\]\s*\{([^}]*)\}/.exec(
    withoutComments(workspaceStylesheet),
  )?.[1];

  it('scrolls as a single track', () => {
    assert.ok(zone !== undefined, 'the inspector zone rule is gone');
    assert.match(zone, /overflow-y:\s*auto\s*;/);
  });

  it('is not a multi-pane layout', () => {
    // THE THREE DECLARATIONS THAT MADE THE PANES, named individually so the
    // failure says which one came back. `display: flex` plus a hidden overflow
    // is what stopped the zone scrolling its own children; a height cap on the
    // zone would strand them the same way from the other side.
    assert.ok(zone !== undefined);
    assert.equal(/display:\s*flex/.test(zone), false, 'the zone became a flex container again');
    assert.equal(/overflow(?:-y)?:\s*hidden/.test(zone), false, 'the zone stopped scrolling');
    assert.equal(/max-height/.test(zone), false, 'the zone capped itself');
  });

  const shareRules = ((): string[] => {
    // ALL OF THEM, NOT THE FIRST. The cascade is how a green test is wrong about
    // a property: a later rule setting `max-height: none` silently wins and a
    // check that stops at the first match never sees it.
    const css = withoutComments(workspaceStylesheet);
    const found: string[] = [];
    for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = (match[1] ?? '').split(',').map((one) => one.trim());
      if (selectors.includes(".ig-zone[data-zone='inspector'] .ig-audit-region")) found.push(match[2] ?? '');
    }
    return found;
  })();

  it('declares the audit region\'s share exactly once, and scoped to this zone', () => {
    // SCOPED IS THE POINT, not incidental. `renderAuditPanel`,
    // `renderEncodingRefusedBlock` and `auditStylesheet` are all public exports,
    // so a consumer can draw either surface outside `renderWorkspace` — and an
    // unqualified cap would hide findings behind an inner scrollbar there, with
    // half the container empty and no selection detail to reserve the space for.
    // The share is true only inside this zone, so it is declared only there.
    assert.deepEqual(shareRules.length, 1, `the sheet has ${shareRules.length} rules for the region's share`);
    assert.equal(
      /\n\.ig-audit-region\s*\{/.test(withoutComments(workspaceStylesheet)),
      false,
      'the share was declared unscoped, so it reaches a standalone region too',
    );
  });

  it('bounds the audit region at half the column', () => {
    // A PERCENTAGE, because a fixed cap cannot know how tall the column it
    // divides happens to be — that was the first of #175's four attempts. And
    // the VALUE, because a percentage alone is not the ruling: `max-height: 95%`
    // is proportional, passes a shape check, and restores the defect in full.
    const share = shareRules[0];
    assert.ok(share !== undefined, 'the audit region declares no share of the column');
    const bound = /max-height:\s*([^;]+);/.exec(share)?.[1]?.trim();
    assert.ok(bound !== undefined, 'the share rule sets no cap');
    assert.equal(bound, '50%', `#177 gives the audit half the column; this gives it ${bound}`);
  });

  it('bounds the audit ONCE, however many surfaces it holds', () => {
    // #177's RULE IS "EXACTLY ONE SIBLING OF THIS ZONE IS BOUNDED", AND §17d NOW
    // HAS TWO SURFACES. `audit/refused.ts` draws the fourth class outside the
    // findings list, so bounding each of them at half the column would let the
    // two take ALL of it between them and push the selection detail entirely
    // below the fold — worse than the state #177 fixed rather than a smaller
    // version of it. The bound moved up to the region that holds both; neither
    // leaf may re-declare one, in either stylesheet.
    const sheets: readonly (readonly [string, string])[] = [
      ['workspace', withoutComments(workspaceStylesheet)],
      ['audit', withoutComments(auditStylesheet)],
    ];
    for (const [name, css] of sheets) {
      for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selectors = (match[1] ?? '').split(',').map((one) => one.trim());
        const sized = selectors.some(
          (one) => one.endsWith('.ig-audit-panel') || one.endsWith('.ig-audit-refused'),
        );
        if (!sized) continue;
        assert.equal(
          /max-height/.test(match[2] ?? ''),
          false,
          `${name} sheet sizes a leaf: ${match[1] ?? ''}`,
        );
      }
    }
  });

  it('measures that share on the box it actually draws, and scrolls past it', () => {
    // BORDER-BOX IS NOT INHERITED AND IS SILENT WHEN ABSENT. The universal reset
    // in this codebase is scoped to `.ig-viewer` descendants and this panel is a
    // sibling of the rail's viewer, so without the declaration the half is
    // measured on the content box and the padding and border push the drawn box
    // past it — wrong by one padding pair and a stroke, and nothing looks broken.
    //
    // The scrolling is on the REGION rather than a list inside it: a list has no
    // horizontal padding, so a scroll container there computes overflow-x to
    // auto and clips the focus ring on every card control.
    const share = shareRules[0];
    assert.ok(share !== undefined);
    assert.match(share, /box-sizing:\s*border-box\s*;/);
    assert.match(share, /overflow(?:-y)?:\s*auto\b/);
  });

  it('lets the region scroll rather than squeezing the surfaces inside it', () => {
    // MEASURED IN A BROWSER, NOT REASONED ABOUT. Both audit leaves declare
    // `min-height: 0` — correct for each of them, because each was once the
    // scroll container itself — and in a bounded flex column that is precisely
    // the licence to lay them out shorter than their content. With a refusal and
    // five findings the block was drawn 54px tall around 131px of content, and
    // because a leaf's own overflow is visible it PAINTED OVER the panel beneath
    // it. Nothing threw, no test failed, and the markup was correct: the two
    // surfaces were simply drawn on top of each other.
    //
    // So the region's members do not shrink, and the overflow the region already
    // declares is what absorbs the difference.
    const css = withoutComments(workspaceStylesheet);
    const members: string[] = [];
    for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = (match[1] ?? '').split(',').map((one) => one.trim());
      if (selectors.includes(".ig-zone[data-zone='inspector'] .ig-audit-region > *")) {
        members.push(match[2] ?? '');
      }
    }
    assert.equal(members.length, 1, `the sheet has ${members.length} rules for the region's members`);
    // THE VALUE, not the property: `flex-shrink: 1` is the default and restores
    // the defect in full while passing any check that only asks whether the
    // declaration is present.
    const shrink = /flex-shrink:\s*([^;]+);/.exec(members[0] ?? '')?.[1]?.trim();
    assert.equal(shrink, '0', `the region's members shrink again (flex-shrink: ${String(shrink)})`);
  });

  it('gives the selection detail no share to be squeezed out of', () => {
    // `.ig-inspector` and the chrome both stay unbounded members of the track:
    // only the audit region declares a share. A cap here would be attempt one
    // arriving on the other sibling.
    const inspector = /\.ig-inspector\s*\{([^}]*)\}/.exec(withoutComments(workspaceStylesheet))?.[1];
    assert.ok(inspector !== undefined, 'the inspector rule is gone');
    assert.equal(/max-height/.test(inspector), false);
    assert.equal(/overflow/.test(inspector), false);
  });
});
