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

  it('gives both controls a visible focus ring', () => {
    // Every affordance here is a button and the mount wires the keyboard, so a
    // control with no focus-visible rule is unreachable for a keyboard user on
    // a host that resets the UA outline.
    for (const control of ['.ig-picker-choice', '.ig-picker-flip']) {
      assert.match(css, new RegExp(`\\${control}:focus-visible`), control);
    }
  });

  it('lays the statement out as a flex row, so a host can reorder it', () => {
    // render.ts calls its subject-phrase-object order a DEFAULT a host may
    // bypass. The CSS order property reorders flex children and does nothing to
    // inline text, so laying this out any other way would make that claim true
    // only in principle. Enforced rather than restated.
    assert.match(css, /\.ig-picker-direction\s*\{[^}]*display:\s*flex/);
  });

  it('marks the current kind on the row rather than only on the control', () => {
    // A host restyling the button keeps the distinction, and the attribute the
    // rule keys on is the one render.ts writes.
    assert.match(css, /\.ig-picker-kind\[data-current='true'\]/);
  });
});
