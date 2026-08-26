import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diffOrder } from '@issuegraph/store';
import { THEME_TOKENS } from '@issuegraph/viewer';

import { renderReevaluate } from './render.ts';
import { reevaluateStylesheet } from './styles.ts';
import { WORDS, editOf, orderOf, railOf } from '../testing/reevaluate.ts';

/** The stylesheet with its comments removed — a comment is not a declaration. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function classesIn(markup: string): string[] {
  return [...markup.matchAll(/class="([^"]+)"/g)].flatMap((match) => (match[1] ?? '').split(' '));
}

/** A settled render with no change at all: the rail, and nothing this leaf adds. */
const RAIL_ONLY = renderReevaluate(railOf(['a', 'b']), { words: WORDS }).markup;

/**
 * Every class this package can emit.
 *
 * The union of SEVERAL renders, not one, because the surface's states exclude
 * each other: an edit either moved something or it did not, and a rail is
 * either held or settled. One render would leave half the stylesheet looking
 * orphaned and the test would fail on rules that are perfectly alive.
 */
const EMITTED: ReadonlySet<string> = (() => {
  const moved = diffOrder(
    orderOf(['a', 'b', 'c', 'gone'], ['b']),
    orderOf(['b', 'a', 'c', 'new']),
    editOf(),
  );
  const still = orderOf(['a', 'b']);
  return new Set(
    [
      renderReevaluate(railOf(['b', 'a', 'c', 'new']), { words: WORDS, change: moved }).markup,
      renderReevaluate(railOf(['b', 'a', 'c', 'new']), {
        words: WORDS,
        change: moved,
        status: 'held',
      }).markup,
      renderReevaluate(railOf(['a', 'b']), {
        words: WORDS,
        change: diffOrder(still, orderOf(['a', 'b']), editOf()),
      }).markup,
      RAIL_ONLY,
    ].flatMap(classesIn),
  );
})();

describe('the re-evaluate stylesheet carries structure, never a value', () => {
  const css = withoutComments(reevaluateStylesheet);
  const styled = new Set([...css.matchAll(/\.(ig-[a-z0-9-]+)/g)].map((match) => match[1] ?? ''));

  it('references only tokens the theme actually defines', () => {
    // A `var(--ig-…)` the theme does not resolve is a silent nothing: the
    // declaration is dropped, so the surface loses its look on exactly the host
    // that installed a second theme correctly.
    const referenced = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]);
    assert.ok(referenced.length > 0, 'the stylesheet references no tokens at all');
    assert.deepEqual(
      referenced.filter((token) => token === undefined || !THEME_TOKENS.includes(token)),
      [],
    );
  });

  it('writes no literal colour and no fixed length', () => {
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'a literal colour');
    assert.equal(/\brgba?\(/.test(css), false, 'a literal colour function');
    assert.equal(/\b\d+(\.\d+)?(px|rem|em|pt)\b/.test(css), false, 'a fixed length');
  });

  it('declares no animation and no transition', () => {
    // The design rejected the animated re-sort — rows moving under the cursor
    // mean the next edit targets the wrong thing — and the toast, because the
    // only evidence the edit worked disappears before it is read. A stylesheet
    // is where both could creep back in without touching a line of TypeScript.
    assert.equal(/\banimation\b/.test(css), false, 'an animation');
    assert.equal(/\btransition\b/.test(css), false, 'a transition');
    assert.equal(/@keyframes/.test(css), false, 'a keyframes block');
  });

  it('styles the selectors this package actually renders, and no others', () => {
    // Derived from the rendered markup rather than from a list kept by hand, so
    // a rule for a class nothing emits cannot survive here.
    assert.ok(styled.size > 0, 'the stylesheet declares no rules at all');
    assert.deepEqual([...styled].filter((name) => !EMITTED.has(name)), []);
  });

  it('leaves nothing this surface adds unstyled', () => {
    // The other direction, which the ladder's suite does not check and which
    // this one needs: a class emitted with no rule of its own is unstyled on a
    // host that installs this stylesheet and not the ladder's. The rail's own
    // classes are excluded — they are layer 1's to style, and `rail.styles`
    // ships alongside this file. `ig-reevaluate` is this leaf's root and is
    // present in every render, including the rail-only one, so it is added back
    // rather than treated as the rail's.
    const railClasses = new Set(classesIn(RAIL_ONLY).filter((name) => name !== 'ig-reevaluate'));
    assert.deepEqual(
      [...EMITTED].filter(
        (name) => name.startsWith('ig-') && !railClasses.has(name) && !styled.has(name),
      ),
      [],
    );
  });
});
