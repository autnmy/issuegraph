import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderMarkup } from '@issuegraph/viewer';

import type { EncodingRefusal } from './findings.ts';
import type { AuditWords } from './panel.ts';
import { renderEncodingRefusedBlock } from './refused.ts';
import type { EncodingRefusedBlockOptions } from './refused.ts';
import { AUDIT_SEVERITY_ATTRIBUTE } from './surface.ts';

/**
 * Words no renderer would write.
 *
 * The fixture rule `testing/workspace.ts` records: a word that reads like the
 * one the package would have hard-coded makes its own pin vacuous, because the
 * fixture and the hardcode are then the same string. So none of these is the
 * frame's own English.
 */
const WORDS: AuditWords = {
  heading: 'things wrong with the encoding',
  classes: {
    cycle: 'a loop',
    'stale-blocker': 'closed blocker',
    'dead-duplicate-ref': 'dead canonical',
    'encoding-refused': 'unreadable',
  },
  titles: {
    cycle: 'these wait on each other for ever',
    'stale-blocker': 'this waits on something finished',
    'dead-duplicate-ref': 'this is filed against something gone',
    'encoding-refused': 'this declaration could not be read',
  },
  show: 'go and look',
  refusedHeading: 'could not be read',
  refusedOpen: 'see it upstream',
  refusedRewrite: 'fix it here',
};

function markupOf(
  refusals: readonly EncodingRefusal[],
  options: Partial<Omit<EncodingRefusedBlockOptions, 'words'>> = {},
): string {
  const spec = renderEncodingRefusedBlock(refusals, {
    words: WORDS,
    known: options.known ?? new Set(refusals.map((refusal) => refusal.ref)),
    issueUrl: options.issueUrl,
  });
  assert.ok(spec !== null, 'the fixture drew no block, so this proves nothing');
  return renderMarkup(spec);
}

const REFUSAL: EncodingRefusal = {
  ref: 'i0001',
  diagnostic: 'unparseable YAML at line 3',
  sourceLine: 'blocked-by: [231, 234',
};

describe('the encoding-refused block', () => {
  it('draws nothing when the host reported no refusal', () => {
    // `null` RATHER THAN AN EMPTY BLOCK, the call `renderAuditPanel` makes one
    // leaf over: a heading over an empty region is not a control, and this
    // column's space belongs to the selection.
    assert.equal(renderEncodingRefusedBlock([], { words: WORDS, known: new Set() }), null);
  });

  it('draws the ref, the reader’s words and the line it stopped on', () => {
    const markup = markupOf([REFUSAL]);
    assert.match(markup, new RegExp(`<h2 class="ig-audit-refused-heading">${WORDS.refusedHeading}</h2>`));
    // AND THE SECTION IS NAMED. An unnamed `section` carries no landmark role at
    // all, so a reader navigating by landmark cannot reach the block.
    assert.match(markup, new RegExp(`<section class="ig-audit-refused" aria-label="${WORDS.refusedHeading}"`));
    assert.match(markup, new RegExp(`<span class="ig-audit-refused-ref">${REFUSAL.ref}</span>`));
    assert.match(markup, /<span class="ig-audit-refused-diagnostic">unparseable YAML at line 3</);
    assert.match(markup, /<span class="ig-audit-refused-source">blocked-by: \[231, 234</);
    // THE CHIP IS THE CLASS'S, so the hue rule in `styles.ts` keyed on
    // `encoding-refused` still lands on something now the panel stopped drawing
    // this class.
    assert.match(markup, /<span class="ig-audit-chip" data-ig-audit-kind="encoding-refused">unreadable</);
  });

  it('omits a reason the host did not record', () => {
    // BOTH FIELDS ARE OPTIONAL BECAUSE THIS PACKAGE NEVER SEES A BODY. An empty
    // mono box under the ref would tell a reader something is missing from their
    // ISSUE rather than from the host's report.
    const bare = markupOf([{ ref: 'i0001' }]);
    assert.equal(bare.includes('ig-audit-refused-reason'), false, bare);
    assert.match(bare, /ig-audit-refused-ref/, 'the card itself was dropped');

    const partial = markupOf([{ ref: 'i0001', diagnostic: 'no --- pair delimits the block' }]);
    assert.match(partial, /ig-audit-refused-diagnostic/);
    assert.equal(partial.includes('ig-audit-refused-source'), false, partial);
  });

  it('keeps one card for a ref the host reported twice', () => {
    // THE RULE `encodingRefusedFindings` APPLIES, repeated here and pinned here.
    // A host reporting one issue twice has ONE refusal, so it has one finding
    // and must have one card — the arithmetic the ambient count rests on. Two
    // cards would put the block's total one ahead of the audit's.
    const markup = markupOf([
      { ref: 'i0001', diagnostic: 'first' },
      { ref: 'i0001', diagnostic: 'second' },
      { ref: 'i0002' },
    ]);
    assert.equal([...markup.matchAll(/<li class="ig-audit-refused-card"/g)].length, 2, markup);
    // FIRST OCCURRENCE WINS, the model's own rule for a repeated key.
    assert.match(markup, />first</);
    assert.equal(markup.includes('>second<'), false, markup);
  });

  it('escapes a source line, which is raw body text', () => {
    // A BODY CAN CARRY ANYTHING, MARKUP INCLUDED, and this is the one value on
    // the surface that is a verbatim quotation of it. Nothing in this module
    // writes a tag: the spec goes through `renderMarkup`, which owns the
    // escaping — and this is the pin that fails if a later revision reaches for
    // string concatenation the way `renderAuditHeader` legitimately does for a
    // number.
    const markup = markupOf([
      {
        ref: 'i0001',
        diagnostic: 'unexpected " & <em>',
        sourceLine: 'blocked-by: ["<script>alert(1)</script>',
      },
    ]);
    assert.equal(markup.includes('<script'), false, markup);
    assert.equal(markup.includes('<em>'), false, markup);
    assert.match(markup, /&lt;script&gt;alert\(1\)/);
    assert.match(markup, /&amp;/);
  });

  it('never puts the rail’s severity attribute on anything it draws', () => {
    // `styles.ts` ends with an UNQUALIFIED `[data-ig-audit]` rule, on purpose —
    // it lands on a row the VIEWER rendered and this layer may not rewrite that
    // row's class. So an element out here wearing the same attribute picks up
    // the rail's 2px gold left-bar whatever hue its class was given. `panel.ts`
    // records the same trap; this block is one attribute away from it too.
    const markup = markupOf([REFUSAL], { issueUrl: () => 'https://example.invalid/i0001' });
    // THE `=` IS PART OF THE NEEDLE: `data-ig-audit-kind` CONTAINS
    // `data-ig-audit`, so a bare substring test passes on the very attribute the
    // chip is supposed to carry and proves nothing either way.
    assert.equal(markup.includes(`${AUDIT_SEVERITY_ATTRIBUTE}="`), false, markup);
    assert.match(markup, /data-ig-audit-kind="encoding-refused"/);
  });

  describe('the outward link', () => {
    it('is withheld when the host can name no URL', () => {
      // NEVER ADVERTISE A MOVE THAT CANNOT BE MADE — `navigableMember`'s rule,
      // one surface over. A host with no resolver and a resolver with no answer
      // are the same position: there is nowhere to send the reader.
      assert.equal(markupOf([REFUSAL]).includes('ig-audit-refused-open'), false);
      assert.equal(
        markupOf([REFUSAL], { issueUrl: () => null }).includes('ig-audit-refused-open'),
        false,
      );
      assert.equal(
        markupOf([REFUSAL], { issueUrl: () => '' }).includes('ig-audit-refused-open'),
        false,
      );
    });

    it('leaves the document safely when it is drawn', () => {
      const markup = markupOf([REFUSAL], { issueUrl: (ref) => `https://example.invalid/${ref}` });
      const tag = /<a[^>]*class="ig-audit-refused-open"[^>]*>/.exec(markup)?.[0];
      assert.ok(tag !== undefined, markup);
      assert.match(tag, /href="https:\/\/example\.invalid\/i0001"/);
      assert.match(tag, /target="_blank"/);
      // BOTH, and they are different guarantees: `noopener` denies the new
      // context a handle back to this one, `noreferrer` denies it the address.
      assert.match(tag, /rel="[^"]*noreferrer[^"]*"/);
      assert.match(tag, /rel="[^"]*noopener[^"]*"/);
      // THE VISIBLE LABEL IS THE HOST'S WORD and the arrow is the package's
      // glyph, hidden from a reader the anchor already tells.
      assert.match(markup, new RegExp(`>${WORDS.refusedOpen}<`));
      assert.match(markup, /<span class="ig-audit-refused-away" aria-hidden="true">↗<\/span>/);
    });

    it('refuses a scheme that would run in the host’s origin', () => {
      // AN `href` IS A SCRIPT-EXECUTION SINK AND ESCAPING DOES NOT CLOSE IT.
      // `renderMarkup` escapes attribute TEXT and has no opinion about schemes,
      // so a resolver answering `javascript:` would ship one — from a host's
      // own value, in the host's own origin.
      const script = markupOf([REFUSAL], { issueUrl: () => 'javascript:alert(1)' });
      assert.equal(script.includes('ig-audit-refused-open'), false, script);

      // AND THE OBFUSCATED FORM, WHICH IS WHY THE ALLOWLIST IS THE VIEWER'S AND
      // NOT A LOCAL ONE. The URL parser strips every ASCII tab, newline and
      // carriage return from ANYWHERE in the input before it reads a scheme, so
      // this reaches the browser as `javascript:` while a naive scan finds no
      // scheme at all, reads the value as relative, and links it.
      const tabbed = markupOf([REFUSAL], { issueUrl: () => 'java\tscript:alert(1)' });
      assert.equal(tabbed.includes('ig-audit-refused-open'), false, tabbed);

      const data = markupOf([REFUSAL], { issueUrl: () => 'data:text/html,<script>1</script>' });
      assert.equal(data.includes('ig-audit-refused-open'), false, data);
    });
  });

  describe('the rewrite control', () => {
    it('reveals the issue and cannot declare a relationship', () => {
      const markup = markupOf([REFUSAL]);
      const tag = /<button[^>]*class="ig-audit-refused-rewrite"[^>]*>/.exec(markup)?.[0];
      assert.ok(tag !== undefined, markup);
      assert.match(tag, /data-ig-command="reveal-issue"/);
      assert.match(tag, /data-ig-target="i0001"/);
      // THE SAFETY PROPERTY, NOT AN IMPLEMENTATION DETAIL. `select-issue` is a
      // POINTER: with a relationship draft awaiting its target, `host.ts` reads
      // a pointer as CHOOSING that target and emits the create proposal — so
      // this control would have declared a relationship, from the surface whose
      // stated rule is that it never offers a remedy.
      assert.equal(markup.includes('select-issue'), false, markup);
    });

    it('is withheld for a ref the drawn surface does not carry', () => {
      // THE PAGING CASE `findings.ts` SUPPORTS ON PURPOSE: a refusal is a fact
      // the HOST asserted about an issue it read, so it may name a ref outside
      // the loaded page, and `surface.ts` deliberately gives that ref no row.
      // A control targeting it advertises a move the mount reconciles straight
      // back away.
      const markup = markupOf([REFUSAL], { known: new Set() });
      assert.equal(markup.includes('ig-audit-refused-rewrite'), false, markup);
      // THE FINDING IS STILL DRAWN. Dropping it would lose the refusal on
      // exactly the issues paging has not reached — and SPEC's whole reason for
      // this class is that such an issue otherwise looks merely unencoded.
      assert.match(markup, /ig-audit-refused-card/);
      assert.match(markup, /ig-audit-refused-source/);
    });

    it('still offers the outward link for a ref with no row', () => {
      // LEAVING THE APPLICATION DOES NOT NEED A LOCAL ROW, so this is the one
      // move an otherwise inert card can still make.
      const markup = markupOf([REFUSAL], {
        known: new Set(),
        issueUrl: (ref) => `https://example.invalid/${ref}`,
      });
      assert.match(markup, /ig-audit-refused-open/);
      assert.equal(markup.includes('ig-audit-refused-rewrite'), false, markup);
    });
  });

  it('is reachable from the keyboard even when every card is inert', () => {
    // EVERY CONTROL HERE IS CONDITIONAL, so a block whose refusals all name
    // unloaded issues, with no resolver supplied, has NO focusable descendant —
    // and browsers disagree about putting a generic container in the tab order.
    // `panel.ts` met this and declared the stop rather than depending on which
    // engine is running; this is the same answer one leaf over.
    const markup = markupOf([REFUSAL], { known: new Set() });
    assert.equal(markup.includes('<button'), false, markup);
    assert.equal(markup.includes('<a '), false, markup);
    assert.match(markup, /<section class="ig-audit-refused"[^>]*tabindex="0"/);
  });

  it('names each control by something that cannot collide', () => {
    // IN A SCREEN READER'S BUTTON LIST THE CARD IS GONE AND THE NAME IS ALL A
    // READER HAS. Two cards drawing one host word yield two controls a reader
    // cannot tell apart — the collision `panel.ts` records three revisions of.
    // The ref is appended, never interpolated, and is unique per card because
    // the block deduplicates by it.
    const markup = markupOf([REFUSAL, { ref: 'i0002' }], {
      issueUrl: (ref) => `https://example.invalid/${ref}`,
    });
    // THE CONTROLS ONLY. The section carries an `aria-label` too — its heading,
    // which names the LANDMARK rather than a move — so a sweep of every
    // `aria-label` on the block would be asking a different question.
    const names = [...markup.matchAll(/<(?:a|button)[^>]*aria-label="([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    assert.equal(names.length, 4, markup);
    assert.equal(new Set(names).size, names.length, names.join(' | '));
    assert.ok(names.includes(`${WORDS.refusedRewrite} i0001`), names.join(' | '));
    assert.ok(names.includes(`${WORDS.refusedOpen} i0002`), names.join(' | '));
    // AND IT ADDS NO ENGLISH: the ref is already the card's visible head line.
    for (const name of names) {
      assert.ok(
        name.endsWith('i0001') || name.endsWith('i0002'),
        `a name says more than the word and the ref: ${name}`,
      );
    }
  });
});
