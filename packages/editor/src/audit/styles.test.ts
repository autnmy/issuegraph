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

/**
 * #177's ruling, pinned.
 *
 * The inspector zone is one scroll track holding three siblings — this panel,
 * the selection detail, and the chrome `mountWorkspace` appends. Four attempts
 * on #175 failed to divide it, and each failure is a property one of these
 * tests holds. They are written against the DECLARATIONS rather than against a
 * measured layout on purpose: `node --test` has no layout engine, so a pixel
 * offset is not observable here, and the mechanism — a bound that is a share of
 * the column and is the same declaration whatever the finding count — is.
 */
describe("the panel's share of the inspector column", () => {
  /**
   * The sheet with its comments removed.
   *
   * WITHOUT THIS EVERY TEST BELOW IS A FALSE GREEN, and it is not a theoretical
   * one — a review round proved it by mutation. The rule bodies are found by
   * matching a selector and a brace, and this file's own prose QUOTES the three
   * declarations verbatim while explaining them, so a comment containing
   * `.ig-audit-panel {` is enough for every assertion here to pass while the
   * real rule is empty. That is exactly the shape of the defect #122 found
   * behind a green test, one file over.
   */
  const css = auditStylesheet.replace(/\/\*[\s\S]*?\*\//g, '');

  /**
   * Every rule body whose selector list names exactly this class.
   *
   * ALL OF THEM, NOT THE FIRST, because the cascade is the other way a green
   * test can be wrong about a property: a later rule setting `max-height: none`
   * silently wins and a check that stops at the first match never sees it. The
   * arity is asserted rather than the last body taken — one rule per class is
   * this sheet's own shape, and two is a finding either way.
   */
  function rulesFor(name: string): string[] {
    const found: string[] = [];
    for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = (match[1] ?? '').split(',').map((one) => one.trim());
      if (selectors.includes(name)) found.push(match[2] ?? '');
    }
    return found;
  }

  const panelRules = rulesFor('.ig-audit-panel');
  const panel = panelRules[0];

  it('declares the panel exactly once, so nothing later overrides the share', () => {
    assert.deepEqual(panelRules.length, 1, `the sheet has ${panelRules.length} rules for .ig-audit-panel`);
  });

  it('bounds the panel at half the column', () => {
    // ATTEMPT 1 RETURNING IS HALF OF WHAT THIS CATCHES. A fixed cap was tried
    // first and was most of a short workspace's column: a length cannot know
    // how tall the column it divides happens to be, so the share is a
    // percentage. The VALUE is pinned too, because a percentage alone is not
    // the ruling — `max-height: 95%` is proportional, passes a shape check, and
    // restores the defect in full.
    assert.ok(panel !== undefined, 'the panel rule is gone');
    const bound = /max-height:\s*([^;]+);/.exec(panel)?.[1]?.trim();
    assert.ok(bound !== undefined, 'the panel declares no share of the column');
    assert.equal(bound, '50%', `#177 gives the panel half the column; this gives it ${bound}`);
  });

  it('measures that share on the box it actually draws', () => {
    // NOT INHERITED, AND SILENT WHEN ABSENT. There IS a universal reset in this
    // codebase and it does not reach here: `viewer/src/styles.ts` scopes it to
    // `.ig-viewer` descendants and this panel is a sibling of the rail's viewer
    // rather than inside it. So without this the share is measured on the
    // CONTENT box and the panel's own padding and border push the drawn box
    // past it. Nothing looks broken; the bound is wrong by a padding and a
    // stroke.
    assert.ok(panel !== undefined);
    assert.match(panel, /box-sizing:\s*border-box\s*;/);
  });

  it('scrolls itself past the share, so no finding is unreachable', () => {
    // THE PANEL, NOT THE LIST INSIDE IT. Scrolling `.ig-audit-list` instead
    // would pin this panel's head, and that is the wrong trade twice: §17d's
    // ambient count is the WORKSPACE HEADER's, which is outside this zone and
    // already never moves; and the list has no horizontal padding, so making it
    // the scroll container computes its overflow-x to auto and clips the focus
    // ring on every card control — an outline is ink overflow, so it is cut
    // rather than scrolled to.
    //
    // The shorthand is accepted beside the longhand: `overflow: auto` sets the
    // same property, and a test that reds on it would be about spelling.
    assert.ok(panel !== undefined);
    assert.match(panel, /overflow(?:-y)?:\s*auto\b/);

    const listRules = rulesFor('.ig-audit-list');
    assert.deepEqual(listRules.length, 1, 'the list is declared more than once');
    const list = listRules[0] as string;
    assert.equal(/overflow(?:-x|-y)?\s*:/.test(list), false, 'the list became a second scroll container');
    assert.equal(/max-height\s*:/.test(list), false, 'the cap moved back onto the list');
  });
});
