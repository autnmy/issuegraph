import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_STATES } from '@issuegraph/store';
import { THEME_TOKENS } from '@issuegraph/viewer';

import { edgeOverlayStylesheet } from './styles.ts';

/** The stylesheet with its comments removed — a comment is not a declaration. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('the overlay stylesheet carries structure, never a value', () => {
  const css = withoutComments(edgeOverlayStylesheet);

  it('references only tokens the theme actually defines', () => {
    // A `var(--ig-…)` the theme does not resolve is a silent nothing: the
    // declaration is dropped, so the overlay loses its look on exactly the host
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

  it('declares no opacity, so every alpha is measurable in the grammar', () => {
    // THE RULE THIS FILE STATED AND THEN BROKE. State opacities were moved to
    // the treatment table so the composited-contrast check could read them; the
    // halo was then styled here at 0.35 because it is not a state — and it was
    // the one alpha that check could not see, and the one below the 3:1 bar.
    //
    // Enforced rather than restated: an alpha in CSS is an alpha nothing
    // measures.
    assert.equal(
      /(^|[^-\w])opacity\s*:/.test(css),
      false,
      'an opacity here is invisible to the composited-contrast check',
    );
  });

  it('never selects a terminal marker', () => {
    // The terminal is one of the four redundant channels the type identity
    // rests on. `render.ts` refuses to touch the ELEMENT; this refuses to reach
    // it by selector, which is the other way the same channel could be lost.
    assert.equal(/\.ig-terminal\b/.test(css), false);
  });

  it('gives every state the stylesheet is responsible for a rule', () => {
    // `selected` and `pending-write` are drawn by ADDED marks — the halo and
    // the marching clone — so they are matched by their own classes rather than
    // by the state attribute. Every state that paints the EDGE ITSELF must have
    // an attribute rule, or it renders untreated.
    for (const state of ['invalid', 'failed', 'conflict'] as const) {
      assert.ok(
        css.includes(`[data-ig-state~='${state}']`),
        `${state} paints the edge and has no rule`,
      );
    }
    // Pinned so the loop above cannot silently stop covering the state set.
    assert.equal(EDGE_STATES.length, 5);
  });

  it('matches the state attribute with ~=, so composed states still match', () => {
    // The attribute carries a SPACE-SEPARATED list — `selected pending-write` —
    // so `=` would match only an edge in exactly one state, and every composed
    // edge would render untreated. That is the composition case the whole
    // grammar exists for, failing silently in CSS.
    const attributeRules = [...css.matchAll(/\[data-ig-state(.)=/g)].map((match) => match[1]);
    assert.ok(attributeRules.length > 0);
    assert.deepEqual([...new Set(attributeRules)], ['~']);
  });

  it('drops the motion and keeps the signal under reduced motion', () => {
    assert.ok(css.includes('prefers-reduced-motion'));
    // The dash pattern and the opacity are what say "in flight"; only the
    // movement is negotiable.
    assert.ok(css.includes('stroke-dasharray'));
  });

  it('lets marks be drawn over without swallowing a click', () => {
    // Every added mark is decoration sitting on top of the line. Without this
    // the halo would intercept the pointer and an edge would stop being
    // clickable exactly when it is selected.
    assert.match(css, /\.ig-overlay\s*\{[^}]*pointer-events:\s*none/);
  });
});
