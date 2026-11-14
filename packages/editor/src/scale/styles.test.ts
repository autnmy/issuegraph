import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { THEME_TOKENS, viewerStylesheet } from '@issuegraph/viewer';

import { renderScaleLadder } from './render.ts';
import { scaleLadderStylesheet } from './styles.ts';
import { TAG_BACK, TAG_TYPE, countTypeMisses, declaredOn, regressionsOf, typeMisses } from '../testing/counts.ts';
import { componentsSumming, documentOf } from '../testing/documents.ts';

/** The stylesheet with its comments removed — a comment is not a declaration. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('the chrome stylesheet carries structure, never a value', () => {
  const css = withoutComments(scaleLadderStylesheet);

  it('references only tokens the theme actually defines', () => {
    // A `var(--ig-…)` the theme does not resolve is a silent nothing: the
    // declaration is simply dropped, so the surface loses its look on exactly
    // the host that installed a second theme correctly.
    const referenced = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]);
    assert.ok(referenced.length > 0, 'the stylesheet references no tokens at all');
    assert.deepEqual(
      referenced.filter((token) => token === undefined || !THEME_TOKENS.includes(token)),
      [],
    );
  });

  it('writes no literal colour and no fixed length', () => {
    // Either one is a value the host cannot re-theme, which is the whole claim
    // the viewer's stylesheet makes and the reason a second theme works at all.
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'a literal colour');
    assert.equal(/\brgba?\(/.test(css), false, 'a literal colour function');
    assert.equal(/\b\d+(\.\d+)?(px|rem|em|pt)\b/.test(css), false, 'a fixed length');
  });

  it('styles the selectors this package actually renders, and no others', () => {
    // A rule for a class nothing emits is dead, and a class emitted with no rule
    // is unstyled on a dark-only surface. Both are caught by deriving the answer
    // from the rendered markup rather than from a list kept by hand.
    //
    // BOTH ARMS OF THE ISOLATED BLOCK, because they render different elements.
    // With the chip drawn here the button names the list; with the chip
    // suppressed — which is what the workspace does, having moved the control to
    // its rail footer — the label becomes a caption instead. Rendering only the
    // first arm reported the caption's rule as dead when it is the one the
    // composed surface actually uses.
    const document = documentOf({ components: componentsSumming(70, 5), isolated: 2 });
    const state = { focus: null, query: 'issue', isolatedOpen: true };
    const markup = [
      renderScaleLadder(document, { state }).markup,
      renderScaleLadder(document, { state, isolatedChip: false }).markup,
      // A STUCK COMPONENT, so the cycle's tag is drawn and its rule is not
      // reported as dead (#288).
      renderScaleLadder(documentOf({ components: componentsSumming(70, 5), isolated: 2, cycleIn: 0 }), { state }).markup,
    ].join('');
    const emitted = new Set([...markup.matchAll(/class="([^"]+)"/g)].flatMap((match) => (match[1] ?? '').split(' ')));

    const styled = [...css.matchAll(/\.(ig-[a-z0-9-]+)/g)].map((match) => match[1] ?? '');
    assert.ok(styled.length > 0, 'the stylesheet declares no rules at all');
    const orphans = [...new Set(styled)].filter((name) => !emitted.has(name));
    assert.deepEqual(orphans, [], 'a rule for a class this package never renders');
  });
});

describe('the isolated list says what it is a list of', () => {
  const document = documentOf({ components: componentsSumming(70, 5), isolated: 2 });
  const state = { focus: null, query: 'issue', isolatedOpen: true };

  it('captions the list with the host word when the control is somewhere else', () => {
    // §17a MOVES THE CONTROL TO THE RAIL FOOTER, and what was left in the canvas
    // was an unlabelled column of issues in a zone that had been drawing a graph
    // a moment earlier: a reader who scrolled to it met a list with nothing
    // saying what it was a list OF.
    const markup = renderScaleLadder(document, { state, isolatedChip: false }).markup;
    assert.match(markup, /class="ig-isolated-caption"/);
    assert.match(markup, /class="ig-isolated-list"/);
  });

  it('never draws the word twice, because exactly one of the two carries it', () => {
    // NO NEW WORD IS INVENTED: the caption is the same string the chip would
    // have carried, so the guard that matters is that they are alternatives.
    const withChip = renderScaleLadder(document, { state }).markup;
    assert.match(withChip, /data-ig-command="close-isolated"/, 'the chip is the control here');
    assert.equal(
      /class="ig-isolated-caption"/.test(withChip),
      false,
      'the chip already names the list, so a caption above it says it twice',
    );
  });

  it('draws no caption over a list that is shut', () => {
    // A caption is part of the disclosure, not a standing label: with the list
    // closed and no chip drawn here, `isolatedSpec` returns nothing at all.
    const shut = renderScaleLadder(document, {
      state: { focus: null, query: 'issue', isolatedOpen: false },
      isolatedChip: false,
    }).markup;
    assert.equal(/class="ig-isolated-caption"/.test(shut), false);
  });
});

describe('the counts this sheet draws are body text with tabular figures (#254)', () => {
  // A capsule card's member count and its blocked count. A stuck card's cycle
  // stands in the blocked slot but is a tag, not a count (#288), pinned below.
  const COUNTS = ['.ig-capsule-size', '.ig-capsule-load'];

  it('sets the body sans, the body size and tabular figures on each, alone and over the viewer sheet', () => {
    assert.deepEqual(countTypeMisses(scaleLadderStylesheet, COUNTS), []);
    assert.deepEqual(countTypeMisses(`${viewerStylesheet}\n${scaleLadderStylesheet}`, COUNTS), []);
  });

  it('fails a later rule that puts the mono face or a smaller size back', () => {
    const css = `${viewerStylesheet}\n${scaleLadderStylesheet}`;
    for (const target of COUNTS) {
      for (const later of regressionsOf(css, target)) {
        assert.notDeepEqual(countTypeMisses(later, [target]), [], `${target} passed with its old type put back`);
      }
    }
  });
});

describe('a stuck capsule\u2019s cycle is a tag in the error state, not a count (#288)', () => {
  // The export draws the loop as a tag: the small role at medium weight in the
  // error state. It used to share the blocked count's class and layer 1's badge,
  // so it read as a third tally.
  const css = `${viewerStylesheet}\n${scaleLadderStylesheet}`;

  it('draws the cycle in its own class, with neither the count\u2019s class nor a badge\u2019s', () => {
    const markup = renderScaleLadder(documentOf({ components: [40, 30], cycleIn: 1 })).markup;
    assert.match(markup, /<span class="ig-capsule-loop">Loop<\/span>/);
    assert.equal(/class="ig-capsule-load ig-badge"/.test(markup), false, 'the cycle still wears the count and the badge');
  });

  it('sets the tag role and the failed state\u2019s colour, over the viewer sheet', () => {
    assert.deepEqual(typeMisses(css, ['.ig-capsule-loop'], TAG_TYPE), []);
    // READ WHERE THE TAG SITS, so a rule for some other card's children does not
    // stand in for it.
    const inside = ['.ig-ladder', '.ig-refusal', '.ig-list', '.ig-capsule-cell', '.ig-capsule-enter'];
    assert.equal(declaredOn(css, '.ig-capsule-loop', 'color', inside)?.value, 'var(--ig-state-failed)');
    assert.equal(declaredOn(css, '.ig-capsule-loop', 'font-variant-numeric'), undefined, 'the tag took a count\u2019s figures');
  });

  it('fails a later rule that puts the mono face or a smaller size on the tag', () => {
    for (const later of regressionsOf(css, '.ig-capsule-loop', TAG_BACK)) {
      assert.notDeepEqual(typeMisses(later, ['.ig-capsule-loop'], TAG_TYPE), [], 'the tag passed with its old type put back');
    }
  });
});
