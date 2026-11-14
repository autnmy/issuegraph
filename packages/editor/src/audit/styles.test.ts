import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { THEME_TOKENS, viewerStylesheet } from '@issuegraph/viewer';

import { AUDIT_SEVERITY_ATTRIBUTE, AUDIT_WORST_ATTRIBUTE } from './surface.ts';
import { auditStylesheet } from './styles.ts';
import { countTypeMisses, declaredOn, regressionsOf, typeMisses } from '../testing/counts.ts';

describe('the structural stylesheet', () => {
  /** Every `var(--…)` name the stylesheet references. */
  function referencedTokens(css: string): string[] {
    return [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] as string);
  }

  it('contains no literal colour', () => {
    assert.equal(/#[0-9A-Fa-f]{3,8}\b/.exec(auditStylesheet), null, 'a hex colour');
    assert.equal(/\brgba?\(/.exec(auditStylesheet), null, 'an rgb() colour');
    assert.equal(/\bhsla?\(/.exec(auditStylesheet), null, 'an hsl() colour');
    assert.equal(
      /:\s*(?:red|blue|green|black|white|grey|gray)\b/.exec(auditStylesheet),
      null,
      'a named colour',
    );
  });

  it('contains no fixed pixel length', () => {
    // `0` is unitless and carries no scale, which is why it is the one length
    // allowed to appear literally.
    assert.equal(/\d+(?:\.\d+)?px/.exec(auditStylesheet), null, 'a px length');
  });

  it('references only properties something actually sets', () => {
    // A `var()` naming a property no theme sets resolves to nothing and the
    // rule silently does not apply — the failure that reads as a styling bug
    // for weeks. ONE source, deliberately: the viewer's theme, which any host
    // installing the viewer already has. An earlier draft added tokens of its
    // own and a function to default them, which reintroduced exactly this
    // failure for a host that installed one stylesheet and not the other.
    const referenced = referencedTokens(auditStylesheet);
    assert.ok(referenced.length > 0, 'the stylesheet references no tokens at all');
    assert.deepEqual(
      referenced.filter((token) => !THEME_TOKENS.includes(token)),
      [],
    );
  });

  it('scopes every rule to this package, so a host page is untouched', () => {
    // The viewer scopes on an `.ig-` class because it owns what it draws. The
    // bar lands on a row the VIEWER rendered, so it is scoped by this package's
    // own namespaced attribute instead — which bounds it to elements a host
    // stamped on purpose. Both are accepted; nothing else is.
    const selectors = auditStylesheet
      .split('}')
      .map((block) => block.split('{')[0]?.trim() ?? '')
      .filter((selector) => selector !== '');
    assert.ok(selectors.length > 0, 'no rules were scanned, so this proves nothing');
    for (const selector of selectors) {
      assert.match(
        selector,
        new RegExp(`(^|[\\s,])\\.ig-|\\[${AUDIT_SEVERITY_ATTRIBUTE}`),
        `"${selector}" is scoped to neither an ig- class nor the audit attribute`,
      );
    }
  });

  it('names no font family outside the type tokens', () => {
    for (const match of auditStylesheet.matchAll(/font-family:\s*([^;]+);/g)) {
      assert.match(match[1] as string, /^var\(--ig-font-(ui|mono)\)$/);
    }
  });
});

/**
 * What the leaf still owns after #177, and what it deliberately does not.
 *
 * The audit's SHARE of the inspector column — the half-height cap and the
 * scrolling that goes with it — is declared by `workspace/styles.ts`, scoped to
 * the zone, because it is a fact about three siblings sharing one track rather
 * than a fact about either audit surface. Since §17d's fourth class moved to
 * `./refused.ts` that share sits on the REGION holding both, so neither leaf
 * carries it. `renderAuditPanel`, `renderEncodingRefusedBlock` and this
 * stylesheet are all public exports, so a consumer can draw either surface
 * outside `renderWorkspace`; a cap here would hide findings behind an inner
 * scrollbar with half the container empty and no selection detail to reserve
 * the space for.
 *
 * These tests hold that boundary from this side: the leaf sizes nothing, and it
 * styles the focus of the tab stop its own markup carries.
 */
describe('the leaves size nothing, and ring the stops their markup declares', () => {
  /**
   * The sheet with its comments removed.
   *
   * WITHOUT THIS EVERY TEST BELOW IS A FALSE GREEN, and it is not a theoretical
   * one — a review round proved it by mutation. Rule bodies are found by
   * matching a selector and a brace, and this file's prose QUOTES declarations
   * verbatim while explaining them, so a comment containing a selector and a
   * brace is enough for an assertion to pass against a rule that is empty. That
   * is the shape of the defect #122 found behind a green test, one file over.
   */
  const css = auditStylesheet.replace(/\/\*[\s\S]*?\*\//g, '');

  /**
   * Every rule body whose selector list names exactly this selector.
   *
   * ALL OF THEM, NOT THE FIRST, because the cascade is the other way a green
   * test can be wrong about a property: a later rule silently wins and a check
   * that stops at the first match never sees it.
   */
  function rulesFor(name: string): string[] {
    const found: string[] = [];
    for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = (match[1] ?? '').split(',').map((one) => one.trim());
      if (selectors.includes(name)) found.push(match[2] ?? '');
    }
    return found;
  }

  /**
   * BOTH SURFACES, BECAUSE §17d HAS TWO NOW. `./refused.ts` draws the fourth
   * class outside the findings list, and every rule below is as true of it as of
   * the panel — a leaf that sized itself would be wrong in every composition but
   * one, and a leaf that scrolled would nest a second scroller inside the region
   * that already scrolls. Written as a table so a third surface inherits the
   * boundary instead of being reviewed into it.
   */
  const SURFACES: readonly (readonly [string, string])[] = [
    ['.ig-audit-panel', '.ig-audit-list'],
    ['.ig-audit-refused', '.ig-audit-refused-list'],
  ];

  for (const [surface, list] of SURFACES) {
    it(`${surface} declares no height, no cap and no scrolling of its own`, () => {
      // THE BOUNDARY, FROM THIS SIDE. A consumer drawing either surface on its
      // own gets it at its content height, exactly as before #177 — the share is
      // the composition's to impose, and only where its reason holds.
      const rules = rulesFor(surface);
      assert.deepEqual(rules.length, 1, `the sheet has ${rules.length} rules for ${surface}`);
      const body = rules[0] as string;
      assert.equal(/max-height\s*:/.test(body), false, 'the leaf capped itself again');
      assert.equal(/(^|;)\s*height\s*:/.test(body), false, 'the leaf sized itself');
      assert.equal(/overflow(?:-x|-y)?\s*:/.test(body), false, 'the leaf made itself a scroll container');
    });

    it(`${list} stays unbounded, so the cap cannot creep back in here`, () => {
      const rules = rulesFor(list);
      assert.deepEqual(rules.length, 1, `${list} is declared more than once`);
      const body = rules[0] as string;
      assert.equal(/overflow(?:-x|-y)?\s*:/.test(body), false, 'the list became a scroll container');
      assert.equal(/max-height\s*:/.test(body), false, 'the cap landed on the list');
    });

    it(`${surface} draws a focus ring for the tab stop its markup carries`, () => {
      // UNSCOPED, UNLIKE THE SIZING, because the tabindex is in the leaf's own
      // markup and travels into every composition. A focusable element that
      // shows nothing on focus is a stop a keyboard reader lands on blind — and
      // for the refused block that stop is often the ONLY one it has, since both
      // of its controls are conditional. Inset, because drawn outward the ring
      // sits on the border box against the zone's edge where it is the first
      // thing clipped — the viewer's own reason for the same negative offset.
      const ring = rulesFor(`${surface}:focus-visible`)[0];
      assert.ok(ring !== undefined, `${surface} is a tab stop with no focus treatment`);
      assert.match(ring, /outline:\s*var\(--ig-focus-ring\) solid var\(--ig-focus\)\s*;/);
      assert.match(ring, /outline-offset:\s*calc\(var\(--ig-focus-ring\) \* -1\)\s*;/);
    });
  }

  it('leaves the list unbounded too, so the cap cannot creep back in here', () => {
    // Three caps were tried on the LIST before #177 — a fixed length, a share
    // of a flex column, that share measured on the right box — and each was
    // right about the previous one's defect while the column stayed the thing
    // that could not be bounded from in here. It still cannot: the list has no
    // padding, so a scroll container here clips the focus ring on every card
    // control, an outline being ink overflow rather than scrollable overflow.
    const listRules = rulesFor('.ig-audit-list');
    assert.deepEqual(listRules.length, 1, 'the list is declared more than once');
    const list = listRules[0] as string;
    assert.equal(/overflow(?:-x|-y)?\s*:/.test(list), false, 'the list became a scroll container');
    assert.equal(/max-height\s*:/.test(list), false, 'the cap landed on the list');
  });

  it('draws a focus ring for the tab stop its markup carries', () => {
    // UNSCOPED, UNLIKE THE SIZING, because the tabindex is in this leaf's own
    // markup and travels into every composition. A focusable element that shows
    // nothing on focus is a stop a keyboard reader lands on blind, wherever it
    // is drawn. Inset, because drawn outward the ring sits on the panel's border
    // box against the zone's edge, where it is the first thing clipped — the
    // viewer's own reason for the same negative offset.
    const ring = rulesFor('.ig-audit-panel:focus-visible')[0];
    assert.ok(ring !== undefined, 'the panel is a tab stop with no focus treatment');
    assert.match(ring, /outline:\s*var\(--ig-focus-ring\) solid var\(--ig-focus\)\s*;/);
    assert.match(ring, /outline-offset:\s*calc\(var\(--ig-focus-ring\) \* -1\)\s*;/);
  });
});

describe('the counts this sheet draws are body text with tabular figures (#254)', () => {
  // The header's finding count: a count, read as a number, so it does not keep
  // the mono face an issue key is copied in. The panel's count left this list
  // with #293: it sits inside the panel title and takes the title's size, so
  // the heading is one size; its sans and figures are pinned with the title.
  const COUNTS = ['.ig-audit-count'];

  it('sets the body sans, the body size and tabular figures on each, alone and over the viewer sheet', () => {
    assert.deepEqual(countTypeMisses(auditStylesheet, COUNTS), []);
    assert.deepEqual(countTypeMisses(`${viewerStylesheet}\n${auditStylesheet}`, COUNTS), []);
  });

  it('fails a later rule that puts the mono face or a smaller size back', () => {
    const css = `${viewerStylesheet}\n${auditStylesheet}`;
    for (const target of COUNTS) {
      for (const later of regressionsOf(css, target)) {
        assert.notDeepEqual(countTypeMisses(later, [target]), [], `${target} passed with its old type put back`);
      }
    }
  });
});

describe('the problems panel head is one title with the count inside it (#288)', () => {
  // The export draws one panel title, the count and then the host's words, in
  // the sans at medium weight in text colour. It was an uppercase mono label in
  // gold with a gold count beside it. Since #293 the theme carries the export's
  // panel-title step and its line, and the title takes both.
  const css = `${viewerStylesheet}\n${auditStylesheet}`;
  const TITLE: Readonly<Record<string, string>> = {
    'font-family': 'var(--ig-font-ui)',
    'font-size': 'var(--ig-font-size-panel-title)',
    'font-weight': 'var(--ig-weight-medium)',
    'line-height': 'var(--ig-panel-title-line)',
  };

  it('sets the title in the sans at medium weight in text colour, with no capitals or tracking', () => {
    assert.deepEqual(typeMisses(css, ['.ig-audit-panel-heading'], TITLE), []);
    // The colour is read where the title sits: inside the panel and its head,
    // so a rule for a selected graph card's children does not stand in for it.
    const inside = ['.ig-audit-panel', '.ig-audit-panel-head'];
    assert.equal(declaredOn(css, '.ig-audit-panel-heading', 'color', inside)?.value, 'var(--ig-text)');
    assert.equal(declaredOn(css, '.ig-audit-panel-heading', 'text-transform'), undefined, 'the title is still capitalised');
    assert.equal(declaredOn(css, '.ig-audit-panel-heading', 'letter-spacing'), undefined, 'the title is still tracked');
  });

  it('gives the refused block’s heading, the panel’s peer, the same type', () => {
    assert.deepEqual(typeMisses(css, ['.ig-audit-refused-heading'], TITLE), []);
    assert.equal(declaredOn(css, '.ig-audit-refused-heading', 'text-transform'), undefined, 'the peer heading is still capitalised');
  });

  it('draws the count in the title’s own ink and size, not gold, in the sans with tabular figures', () => {
    const inside = ['.ig-audit-panel', '.ig-audit-panel-head', '.ig-audit-panel-heading'];
    assert.equal(declaredOn(css, '.ig-audit-panel-count', 'color', inside)?.value, 'inherit');
    // ONE SIZE IN THE HEADING (#293): a count a step below the words it leads
    // would be two sizes in one title.
    assert.equal(declaredOn(css, '.ig-audit-panel-count', 'font-size', inside)?.value, 'inherit');
    assert.equal(declaredOn(css, '.ig-audit-panel-count', 'font-family', inside)?.value, 'var(--ig-font-ui)');
    assert.equal(declaredOn(css, '.ig-audit-panel-count', 'font-variant-numeric', inside)?.value, 'tabular-nums');
  });

  it('fails a later rule that puts the mono face or the small size back on the title', () => {
    for (const later of regressionsOf(css, '.ig-audit-panel-heading')) {
      assert.notDeepEqual(typeMisses(later, ['.ig-audit-panel-heading'], TITLE), [], 'the title passed with its old type put back');
    }
  });
});

describe('the header count leads with the dot of the worst problem (#293)', () => {
  // The export draws the problems button with the state dot of the worst
  // problem, coloured by that problem's state: a loop is the error state, a
  // duplicate of a closed issue and an unreadable block the attention state,
  // and a closed blocker the neutral state, a ring.
  const css = `${viewerStylesheet}\n${auditStylesheet}`;
  const inside = ['.ig-audit', '.ig-audit-toggle'];
  const dot = (kind: string): string => `.ig-audit-dot[${AUDIT_WORST_ATTRIBUTE}='${kind}']`;

  it('draws a dot the export\u2019s size, round', () => {
    assert.equal(declaredOn(css, '.ig-audit-dot', 'block-size', inside)?.value, 'var(--ig-space-snug)');
    assert.equal(declaredOn(css, '.ig-audit-dot', 'inline-size', inside)?.value, 'var(--ig-space-snug)');
    assert.equal(declaredOn(css, '.ig-audit-dot', 'border-radius', inside)?.value, '50%');
  });

  it('colours it by the worst class\u2019s state', () => {
    assert.equal(declaredOn(css, dot('cycle'), 'background', inside)?.value, 'var(--ig-state-failed)');
    assert.equal(declaredOn(css, dot('dead-duplicate-ref'), 'background', inside)?.value, 'var(--ig-state-conflict)');
    assert.equal(declaredOn(css, dot('encoding-refused'), 'background', inside)?.value, 'var(--ig-state-conflict)');
    assert.equal(declaredOn(css, dot('stale-blocker'), 'background', inside), undefined, 'the neutral dot is filled');
    assert.equal(
      declaredOn(css, dot('stale-blocker'), 'box-shadow', inside)?.value,
      'inset 0 0 0 var(--ig-stroke) var(--ig-station-pending)',
    );
  });

  it('sets the dot twelve from its count and the words in text ink, muted only for a closed blocker', () => {
    assert.equal(declaredOn(css, '.ig-audit-dot', 'margin-inline-end', inside)?.value, 'var(--ig-space-tight)');
    assert.match(css, /\.ig-audit-toggle \{[^}]*color: var\(--ig-text\);/);
    assert.equal(
      declaredOn(css, `.ig-audit-toggle[${AUDIT_WORST_ATTRIBUTE}='stale-blocker']`, 'color', ['.ig-audit'])?.value,
      'var(--ig-text-muted)',
    );
    assert.equal(/\.ig-audit-toggle\[aria-pressed/.test(css), false, 'a dead pressed rule is back');
  });

  it('keeps the rail bar off the dot, which carries no severity attribute', () => {
    // The rail's gold bar is an unqualified rule on the severity attribute; a
    // dot wearing it would draw that bar whatever its class.
    assert.notEqual(AUDIT_WORST_ATTRIBUTE, AUDIT_SEVERITY_ATTRIBUTE);
    assert.equal(declaredOn(css, dot('cycle'), 'box-shadow', inside), undefined);
  });
});
