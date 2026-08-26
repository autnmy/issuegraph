import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { THEME_TOKENS } from '@issuegraph/viewer';

import { AUDIT_SEVERITY_ATTRIBUTE } from './surface.ts';
import { auditStylesheet } from './styles.ts';

describe('the structural stylesheet', () => {
  /** Every `var(--…)` name the stylesheet references. */
  function referencedTokens(css: string): string[] {
    return [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] as string);
  }

  it('contains no literal colour', () => {
    assert.equal(/#[0-9A-Fa-f]{3,8}\b/.exec(auditStylesheet), null, 'a hex colour');
    assert.equal(/\brgba?\(/.exec(auditStylesheet), null, 'an rgb() colour');
    assert.equal(/\bhsla?\(/.exec(auditStylesheet), null, 'an hsl() colour');
    assert.equal(
      /:\s*(?:red|blue|green|black|white|grey|gray)\b/.exec(auditStylesheet),
      null,
      'a named colour',
    );
  });

  it('contains no fixed pixel length', () => {
    // `0` is unitless and carries no scale, which is why it is the one length
    // allowed to appear literally.
    assert.equal(/\d+(?:\.\d+)?px/.exec(auditStylesheet), null, 'a px length');
  });

  it('references only properties something actually sets', () => {
    // A `var()` naming a property no theme sets resolves to nothing and the
    // rule silently does not apply — the failure that reads as a styling bug
    // for weeks. ONE source, deliberately: the viewer's theme, which any host
    // installing the viewer already has. An earlier draft added tokens of its
    // own and a function to default them, which reintroduced exactly this
    // failure for a host that installed one stylesheet and not the other.
    const referenced = referencedTokens(auditStylesheet);
    assert.ok(referenced.length > 0, 'the stylesheet references no tokens at all');
    assert.deepEqual(
      referenced.filter((token) => !THEME_TOKENS.includes(token)),
      [],
    );
  });

  it('scopes every rule to this package, so a host page is untouched', () => {
    // The viewer scopes on an `.ig-` class because it owns what it draws. The
    // bar lands on a row the VIEWER rendered, so it is scoped by this package's
    // own namespaced attribute instead — which bounds it to elements a host
    // stamped on purpose. Both are accepted; nothing else is.
    const selectors = auditStylesheet
      .split('}')
      .map((block) => block.split('{')[0]?.trim() ?? '')
      .filter((selector) => selector !== '');
    assert.ok(selectors.length > 0, 'no rules were scanned, so this proves nothing');
    for (const selector of selectors) {
      assert.match(
        selector,
        new RegExp(`(^|[\\s,])\\.ig-|\\[${AUDIT_SEVERITY_ATTRIBUTE}`),
        `"${selector}" is scoped to neither an ig- class nor the audit attribute`,
      );
    }
  });

  it('names no font family outside the type tokens', () => {
    for (const match of auditStylesheet.matchAll(/font-family:\s*([^;]+);/g)) {
      assert.match(match[1] as string, /^var\(--ig-font-(ui|mono)\)$/);
    }
  });
});
