import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { THEME_TOKENS } from '@issuegraph/viewer';

import { renderScaleLadder } from './render.ts';
import { scaleLadderStylesheet } from './styles.ts';
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
    const document = documentOf({ components: componentsSumming(70, 5), isolated: 2 });
    const markup = renderScaleLadder(document, {
      state: { focus: null, query: 'issue', isolatedOpen: true },
    }).markup;
    const emitted = new Set([...markup.matchAll(/class="([^"]+)"/g)].flatMap((match) => (match[1] ?? '').split(' ')));

    const styled = [...css.matchAll(/\.(ig-[a-z0-9-]+)/g)].map((match) => match[1] ?? '');
    assert.ok(styled.length > 0, 'the stylesheet declares no rules at all');
    const orphans = [...new Set(styled)].filter((name) => !emitted.has(name));
    assert.deepEqual(orphans, [], 'a rule for a class this package never renders');
  });
});
