import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { viewerStylesheet } from './styles.ts';
import { THEME_TOKENS } from './theme.ts';

/** Every `var(--…)` name the stylesheet references. */
function referencedTokens(css: string): string[] {
  return [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] as string);
}

/** The stylesheet with its comments removed — a comment is not a declaration. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('the structural stylesheet', () => {
  it('references only tokens the theme supplies', () => {
    // The other direction of the theme contract: a `var()` naming a token no
    // theme sets resolves to nothing, and the affected rule silently does not
    // apply — the failure mode that looks like a styling bug for weeks.
    const unknown = referencedTokens(viewerStylesheet).filter(
      (token) => !THEME_TOKENS.includes(token),
    );
    assert.deepEqual(unknown, []);
  });

  it('contains no literal colour', () => {
    // R5 asserted against the bytes: every colour is the theme's to decide, so
    // finding one here means a value escaped the custom properties.
    const css = withoutComments(viewerStylesheet);
    assert.equal(/#[0-9A-Fa-f]{3,8}\b/.exec(css), null, 'a hex colour');
    assert.equal(/\brgba?\(/.exec(css), null, 'an rgb() colour');
    assert.equal(/\bhsla?\(/.exec(css), null, 'an hsl() colour');
    assert.equal(/:\s*(?:red|blue|green|black|white|grey|gray)\b/.exec(css), null, 'a named colour');
  });

  it('contains no fixed pixel length', () => {
    // Spacing is the theme's too. `0` is unitless and carries no scale, which
    // is why it is the one length allowed to appear literally.
    const css = withoutComments(viewerStylesheet);
    assert.equal(/\d+(?:\.\d+)?px/.exec(css), null, 'a px length');
  });

  it('names no font family outside the type tokens', () => {
    const css = withoutComments(viewerStylesheet);
    for (const match of css.matchAll(/font-family:\s*([^;]+);/g)) {
      assert.match(match[1] as string, /^var\(--ig-font-(ui|mono)\)$/);
    }
  });

  it('scopes every rule under the viewer, so a host page is untouched', () => {
    const selectors = withoutComments(viewerStylesheet)
      .split('}')
      .map((block) => block.split('{')[0]?.trim() ?? '')
      .filter((selector) => selector !== '');

    for (const selector of selectors) {
      assert.match(
        selector,
        /(^|[\s,])\.ig-/,
        `"${selector}" is not scoped to a viewer class`,
      );
    }
  });

  it('sets no stroke-dasharray for an edge — the vocabulary owns that channel', () => {
    // One source for the pattern channel. A dash set here and a dash set in
    // `vocabulary.ts` is two, and the colour-blind-safety claim rests on it.
    const css = withoutComments(viewerStylesheet);
    for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = (match[1] ?? '').trim();
      const body = match[2] ?? '';
      if (!/stroke-dasharray/.test(body)) continue;
      assert.ok(
        !/\.ig-edge|\.ig-enclosure|\.ig-connector/.test(selector),
        `${selector} sets stroke-dasharray, which the edge vocabulary owns`,
      );
    }
  });
});
