import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diffOrder } from '@issuegraph/store';
import { THEME_TOKENS, renderViewer, viewerStylesheet } from '@issuegraph/viewer';

import { renderReevaluate } from './render.ts';
import { reevaluateStylesheet } from './styles.ts';
import { WORDS, editOf, orderOf, railOf, unitRailOf } from '../testing/reevaluate.ts';

/** The stylesheet with its comments removed — a comment is not a declaration. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function classesIn(markup: string): string[] {
  return [...markup.matchAll(/class="([^"]+)"/g)].flatMap((match) => (match[1] ?? '').split(' '));
}

/**
 * Every document these renders are taken over, in one place.
 *
 * BOTH sets below are derived from this SAME list — what this surface emits,
 * and what layer 1 emits underneath it. Deriving them from different documents
 * is what made an earlier version wrong in both directions at once: a rail with
 * no edges draws no badges, so layer 1's badge classes looked like this
 * package's and reported as unstyled, while a state this surface renders only
 * for a multi-member unit had no render at all and its rules looked orphaned.
 */
const DOCUMENTS = [
  { document: railOf(['b', 'a', 'c', 'new']), change: undefined, status: undefined },
  {
    document: railOf(['b', 'a', 'c', 'new']),
    change: diffOrder(
      orderOf(['a', 'b', 'c', 'gone'], ['b']),
      orderOf(['b', 'a', 'c', 'new']),
      editOf(),
    ),
    status: undefined,
  },
  {
    document: railOf(['b', 'a', 'c', 'new']),
    change: diffOrder(
      orderOf(['a', 'b', 'c', 'gone'], ['b']),
      orderOf(['b', 'a', 'c', 'new']),
      editOf(),
    ),
    status: 'held' as const,
  },
  {
    // An edit that landed and moved nothing renders a different summary shape.
    document: railOf(['a', 'b']),
    change: diffOrder(orderOf(['a', 'b']), orderOf(['a', 'b']), editOf()),
    status: undefined,
  },
  {
    // A chip speaking for TWO members, the only shape that names them.
    document: unitRailOf(),
    change: diffOrder(
      orderOf(['lead', 'partner', 'other']),
      orderOf(['other', 'lead', 'partner']),
      editOf(),
    ),
    status: undefined,
  },
];

/**
 * Every class this package can emit.
 *
 * The union of SEVERAL renders, not one, because the surface's states exclude
 * each other: an edit either moved something or it did not, a rail is either
 * held or settled, and a chip speaks for one member or several. One render
 * would leave most of the stylesheet looking orphaned.
 */
const EMITTED: ReadonlySet<string> = new Set(
  DOCUMENTS.flatMap(({ document, change, status }) =>
    classesIn(
      renderReevaluate(document, {
        words: WORDS,
        ...(change === undefined ? {} : { change }),
        ...(status === undefined ? {} : { status }),
      }).markup,
    ),
  ),
);

/** The classes LAYER 1 emits, over those same documents, taken from layer 1. */
const RAIL_CLASSES: ReadonlySet<string> = new Set(
  DOCUMENTS.flatMap(({ document }) =>
    classesIn(renderViewer(document, { projection: 'linear' }).markup),
  ),
);

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

  it('greys the held rail with a property the rail\'s own colours cannot beat', () => {
    // THE POSITIVE CONTROL FIRST: this only matters because layer 1 sets colours
    // on its own descendants, and a specified value beats an inherited one. If
    // that ever stops being true this assertion fails loudly rather than leaving
    // the rule below looking over-built.
    const viewerCss = withoutComments(viewerStylesheet);
    assert.match(viewerCss, /\.ig-title\s*\{[^}]*color:/, 'layer 1 no longer colours .ig-title');
    assert.match(viewerCss, /\.ig-station[^{]*\{[^}]*background:/, 'layer 1 no longer fills stations');

    const held = css.match(/\.ig-reevaluate\[data-order='held'\][^{]*\{([^}]*)\}/)?.[1];
    assert.ok(held !== undefined, 'nothing greys the held rail');
    // A subtree-wide property, so a descendant layer 1 colours later is covered
    // by construction. Enumerating the descendants to override is the
    // one-spelling-at-a-time class this repository has already paid for.
    assert.match(held, /filter:/);
    assert.equal(/(^|;)\s*color:/.test(held), false, 'a bare colour the descendants override');
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
    // ships alongside this file.
    assert.ok(RAIL_CLASSES.size > 0, 'the rail emitted no classes at all');
    assert.deepEqual(
      [...EMITTED].filter(
        (name) => name.startsWith('ig-') && !RAIL_CLASSES.has(name) && !styled.has(name),
      ),
      [],
    );
  });
});
