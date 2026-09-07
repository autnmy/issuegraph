import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { THEME_TOKENS } from '@issuegraph/viewer';

import { pickerStylesheet } from './styles.ts';

/** The stylesheet with its comments removed — a comment is not a declaration. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('the picker stylesheet carries structure, never a value', () => {
  const css = withoutComments(pickerStylesheet);

  it('references only tokens the theme actually defines', () => {
    // A var(--ig-…) the theme does not resolve is a silent nothing: the
    // declaration is dropped, so the picker loses its look on exactly the host
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

  it('gives its control a visible focus ring', () => {
    // Every affordance here is a button and the mount wires the keyboard, so a
    // control with no focus-visible rule is unreachable for a keyboard user on
    // a host that resets the UA outline.
    //
    // ONE CONTROL, WHERE THERE WERE TWO. The flip left with §17b's statement;
    // `workspace/styles.test.ts` carries the same claim for it now, and it has
    // to — that control is the one §17b calls the guard against the most common
    // encoding mistake.
    assert.match(css, /\.ig-picker-choice:focus-visible/);
  });

  it('carries no rule for markup it no longer draws', () => {
    // THE DEAD-SELECTOR CHECK THIS SHEET LACKS, written for the one deletion
    // that could leave one. `.ig-picker-ref` was written only by the direction
    // statement, so it is a peer of the two obvious rules rather than a
    // survivor — and unlike the workspace sheet, nothing here asserts
    // markup/stylesheet agreement, so a rule with no element would ship silently.
    for (const gone of ['.ig-picker-direction', '.ig-picker-ref', '.ig-picker-flip']) {
      assert.equal(css.includes(gone), false, gone);
    }
  });

  it('marks the current kind on the row rather than only on the control', () => {
    // A host restyling the button keeps the distinction, and the attribute the
    // rule keys on is the one render.ts writes.
    assert.match(css, /\.ig-picker-kind\[data-current='true'\]/);
  });
});
