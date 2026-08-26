import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { THEME_TOKENS } from '@issuegraph/viewer';

import { firstPassStylesheet } from './styles.ts';

/** The stylesheet with its comments removed — a comment is not a declaration. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('the first-pass stylesheet carries structure, never a value', () => {
  const css = withoutComments(firstPassStylesheet);

  it('references only tokens the theme actually defines', () => {
    // A var(--ig-…) the theme does not resolve is a silent nothing: the
    // declaration is dropped, so this surface loses its look on exactly the
    // host that installed a second theme correctly.
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

  it('gives every control a visible focus ring', () => {
    // The queue is KEYBOARD-FIRST, so a control with no focus-visible rule is
    // unreachable for the exact reader this surface is built for on any host
    // that resets the UA outline.
    for (const control of ['.ig-firstpass-answer', '.ig-firstpass-undo']) {
      assert.match(css, new RegExp(`\\${control}:focus-visible`), control);
    }
  });

  it('lays the statement out as a flex row, so a host can reorder it', () => {
    // render.ts calls its subject-kind-object order a DEFAULT a host may
    // bypass. The CSS order property reorders flex children and does nothing to
    // inline text, so laying this out any other way would make that claim true
    // only in principle. Enforced rather than restated.
    assert.match(css, /\.ig-firstpass-statement\s*\{[^}]*display:\s*flex/);
  });

  it('draws no progress track, fill or width driven by the counts', () => {
    // §17e: "100% encoded is never the goal and the workspace never implies it
    // is." A bar implies a target by its geometry whatever the words beside it
    // say, so the absence of one is the design rather than an omission.
    const progressRules = [...css.matchAll(/\.ig-firstpass-progress[^{]*\{([^}]*)\}/g)]
      .map((match) => match[1] ?? '')
      .join('\n');
    assert.ok(progressRules.length > 0, 'the progress line is not styled at all');
    for (const property of ['width', 'background', 'transform', 'flex-basis']) {
      assert.equal(
        new RegExp(`\\b${property}\\s*:`).test(progressRules),
        false,
        `${property} on the progress line would draw a bar`,
      );
    }
  });

  it('weights the one answer that writes', () => {
    // Consent starts before the keystroke: the irreversible option is the one
    // the eye should land on. The rule keys on the attribute render.ts writes.
    assert.match(css, /\.ig-firstpass-answer\[data-ig-answer='apply'\]/);
  });

  it('reaches into no viewer class of its own', () => {
    // It ADDS selectors rather than redefining them — the same contract the
    // picker's, the ladder's and the overlay's sheets keep.
    assert.equal(/\.ig-(station|edge|spine|row)\b/.test(css), false);
  });
});
