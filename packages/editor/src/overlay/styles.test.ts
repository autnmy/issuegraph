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

  it('gives a badge-only relationship a state a reader can SEE', () => {
    // `together-with` is drawn as no line at all — it shares a rank rather than
    // ordering anything, and layer 1 draws the unit as one card with its members
    // listed inside — so the chip that names it is its entire representation.
    // The marks this module clones from a stroke cannot be cloned from a span,
    // and the stroke rules paint a property a span does not have: an in-flight
    // or refused together-edge read exactly like a settled one, with the state
    // visible only to a screen reader.
    for (const state of ['invalid', 'failed', 'conflict', 'pending-write', 'selected']) {
      assert.match(
        edgeOverlayStylesheet,
        new RegExp(`\\.ig-badge\\[data-ig-state~='${state}'\\]`),
        `a badge says nothing visible about ${state}`,
      );
    }
  });

  it('outranks the hue layer 1 paints an edge with, rather than tying it', () => {
    // THE ONE CLAIM IN THIS FILE THAT IS ABOUT THE CASCADE, so it is the one
    // claim `node:test` cannot check by rendering — there is no cascade here to
    // ask. It is checked as the arithmetic instead, and the arithmetic is the
    // thing that was wrong.
    //
    // A drawn path carries `class="ig-edge" data-edge=<kind>`, which the viewer
    // hues with `.ig-edge[data-edge='blocked-by']` — one class and one
    // attribute, (0,2,0). A bare `[data-ig-state~='conflict']` is (0,1,0) and
    // loses, whatever order the sheets are concatenated in. That is not a
    // hypothetical: measured in a browser, a conflicted edge computed
    // `--ig-edge-blocked-by` and never `--ig-state-conflict`.
    //
    // So each state rule must reach at least one class and TWO attributes, and
    // this asserts the shape rather than a specificity number, because the shape
    // is what a later edit would drop.
    for (const state of ['invalid', 'failed', 'conflict'] as const) {
      const rule = new RegExp(`\\.ig-edge\\[data-edge\\]\\[data-ig-state~='${state}'\\]`);
      assert.match(
        css,
        rule,
        `${state} paints the edge at a specificity the relationship hue outranks`,
      );
    }
  });

  it('leaves no bare state rule that a qualified one has replaced', () => {
    // The failure this file already had was a rule that EXISTED and never
    // applied, so the absence is worth pinning: a bare `[data-ig-state~=…]`
    // carrying a stroke is dead on both the elements that can match it — it
    // loses the cascade on a path, and a span has no stroke.
    //
    // Written against the declaration rather than the selector alone, because
    // `.ig-badge[data-ig-state~=…]` is a legitimate bare-attribute rule and
    // paints border and ink, which a badge does use.
    const bareStroke = /(^|[\s,{}])\[data-ig-state~='[a-z-]+'\]\s*\{[^}]*stroke\s*:/;
    assert.equal(bareStroke.test(css), false, 'a bare state rule cannot paint a stroke');
  });
});
