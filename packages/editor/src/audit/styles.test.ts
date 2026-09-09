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
 * What the leaf still owns after #177, and what it deliberately does not.
 *
 * The panel's SHARE of the inspector column — the half-height cap and the
 * scrolling that goes with it — is declared by `workspace/styles.ts`, scoped to
 * the zone, because it is a fact about three siblings sharing one track rather
 * than a fact about the panel. `renderAuditPanel` and this stylesheet are both
 * public exports, so a consumer can draw the panel outside `renderWorkspace`;
 * a cap here would hide findings behind an inner scrollbar with half the
 * container empty and no selection detail to reserve the space for.
 *
 * These tests hold that boundary from this side: the leaf sizes nothing, and it
 * styles the focus of the tab stop its own markup carries.
 */
describe('the panel sizes nothing, and rings the stop its markup declares', () => {
  /**
   * The sheet with its comments removed.
   *
   * WITHOUT THIS EVERY TEST BELOW IS A FALSE GREEN, and it is not a theoretical
   * one — a review round proved it by mutation. Rule bodies are found by
   * matching a selector and a brace, and this file's prose QUOTES declarations
   * verbatim while explaining them, so a comment containing a selector and a
   * brace is enough for an assertion to pass against a rule that is empty. That
   * is the shape of the defect #122 found behind a green test, one file over.
   */
  const css = auditStylesheet.replace(/\/\*[\s\S]*?\*\//g, '');

  /**
   * Every rule body whose selector list names exactly this selector.
   *
   * ALL OF THEM, NOT THE FIRST, because the cascade is the other way a green
   * test can be wrong about a property: a later rule silently wins and a check
   * that stops at the first match never sees it.
   */
  function rulesFor(name: string): string[] {
    const found: string[] = [];
    for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = (match[1] ?? '').split(',').map((one) => one.trim());
      if (selectors.includes(name)) found.push(match[2] ?? '');
    }
    return found;
  }

  it('declares no height, no cap and no scrolling of its own', () => {
    // THE BOUNDARY, FROM THIS SIDE. A consumer drawing the panel on its own
    // gets it at its content height, exactly as before #177 — the share is the
    // composition's to impose, and only where its reason holds.
    const panelRules = rulesFor('.ig-audit-panel');
    assert.deepEqual(panelRules.length, 1, `the sheet has ${panelRules.length} rules for .ig-audit-panel`);
    const panel = panelRules[0] as string;
    assert.equal(/max-height\s*:/.test(panel), false, 'the leaf capped itself again');
    assert.equal(/(^|;)\s*height\s*:/.test(panel), false, 'the leaf sized itself');
    assert.equal(/overflow(?:-x|-y)?\s*:/.test(panel), false, 'the leaf made itself a scroll container');
  });

  it('leaves the list unbounded too, so the cap cannot creep back in here', () => {
    // Three caps were tried on the LIST before #177 — a fixed length, a share
    // of a flex column, that share measured on the right box — and each was
    // right about the previous one's defect while the column stayed the thing
    // that could not be bounded from in here. It still cannot: the list has no
    // padding, so a scroll container here clips the focus ring on every card
    // control, an outline being ink overflow rather than scrollable overflow.
    const listRules = rulesFor('.ig-audit-list');
    assert.deepEqual(listRules.length, 1, 'the list is declared more than once');
    const list = listRules[0] as string;
    assert.equal(/overflow(?:-x|-y)?\s*:/.test(list), false, 'the list became a scroll container');
    assert.equal(/max-height\s*:/.test(list), false, 'the cap landed on the list');
  });

  it('draws a focus ring for the tab stop its markup carries', () => {
    // UNSCOPED, UNLIKE THE SIZING, because the tabindex is in this leaf's own
    // markup and travels into every composition. A focusable element that shows
    // nothing on focus is a stop a keyboard reader lands on blind, wherever it
    // is drawn. Inset, because drawn outward the ring sits on the panel's border
    // box against the zone's edge, where it is the first thing clipped — the
    // viewer's own reason for the same negative offset.
    const ring = rulesFor('.ig-audit-panel:focus-visible')[0];
    assert.ok(ring !== undefined, 'the panel is a tab stop with no focus treatment');
    assert.match(ring, /outline:\s*var\(--ig-focus-ring\) solid var\(--ig-focus\)\s*;/);
    assert.match(ring, /outline-offset:\s*calc\(var\(--ig-focus-ring\) \* -1\)\s*;/);
  });
});
