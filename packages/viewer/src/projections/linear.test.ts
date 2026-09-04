import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeDocument } from '../document.ts';
import { renderMarkup } from '../element.ts';
import { ROW_BADGE_BUDGET } from '../parts.ts';
import { denseRowDocument, denseUnitDocument, fixtureDocument, heldTogetherDocument } from '../testing/fixtures.ts';
import { EDGE_ORDER } from '../vocabulary.ts';
import { linearScene } from './linear.ts';

function render(input = fixtureDocument, options = {}): string {
  return renderMarkup(linearScene(normalizeDocument(input).document, options).root);
}

/** The `<li>` markup for one key, so an assertion cannot match a neighbour's. */
function row(markup: string, key: string): string {
  const start = markup.indexOf(`data-ig-key="${key}"`);
  assert.notEqual(start, -1, `no row for ${key}`);
  const open = markup.lastIndexOf('<li', start);
  return markup.slice(open, markup.indexOf('</li>', start) + 5);
}

describe('the linear projection', () => {
  it('renders slots in the order supplied and never re-sorts them', () => {
    const markup = render();
    const positions = ['102', '101', '103'].map((key) => markup.indexOf(`data-ig-key="${key}"`));

    assert.ok(positions.every((position) => position !== -1));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  });

  it('prints a rank for a ranked slot', () => {
    assert.match(row(render(), '102'), /class="ig-rank"[^>]*>1</);
  });

  it('prints an em dash and a dashed station for a graph-held slot, in place', () => {
    // The rule this projection exists for: the hold stays at the rank the work
    // would have taken, so "why isn't my P1 running" is answerable there.
    const markup = render();
    const held = row(markup, '101');

    assert.match(held, /class="ig-rank"[^>]*>—</);
    assert.match(held, /data-fill="dashed"/);
    assert.ok(
      markup.indexOf('data-ig-key="101"') < markup.indexOf('data-ig-key="103"'),
      'the held slot lost its position in the order',
    );
    assert.match(held, /blocked by 102, which is open/);
  });

  it('moves a tracker-held slot to the footer and gives it no rank', () => {
    const markup = render();
    const footerAt = markup.indexOf('ig-footer');
    const trackerHeld = markup.indexOf('data-ig-key="105"');

    assert.notEqual(footerAt, -1);
    assert.ok(trackerHeld > footerAt, 'a tracker-held slot stayed in the ranked list');
    assert.equal(/class="ig-rank"/.test(row(markup, '105')), false);
    assert.match(row(markup, '105'), /claimed by another run/);
  });

  it('renders a duplicate in the footer naming its canonical', () => {
    const markup = render();
    assert.ok(markup.indexOf('data-ig-key="106"') > markup.indexOf('ig-footer'));
    assert.match(row(markup, '106'), /duplicate of 105 — never worked/);
  });

  it('renders a together unit as one row naming both members', () => {
    const markup = render();
    const unit = row(markup, '103');

    assert.match(unit, /Split the invoice writer · Split the invoice reader/);
    assert.equal(markup.includes('data-ig-key="104"'), false, '104 rendered as its own row');
  });

  it("carries a partner's relationships onto the unit's one row", () => {
    // A together unit is ONE row and its partners get no row of their own, so
    // reading only the lead's edges dropped every relationship a partner owned.
    // Here the unit is held and what holds it is the PARTNER's `blocked-by`:
    // the row said "held" and silently withheld the reason.
    const markup = render(heldTogetherDocument);
    const unit = row(markup, '1');

    assert.match(unit, /data-edge="blocked-by"[^>]*aria-label="blocked by 3"/);
  });

  it('renders an edge internal to a unit once, not once per member', () => {
    // Both endpoints of `1 together-with 2` are members, so the edge is in TWO
    // `edgesOf` entries — the failure mode of aggregating across members, and
    // the reason the fix dedupes on the edge rather than on the member.
    const unit = row(render(heldTogetherDocument), '1');
    const together = unit.match(/data-edge="together-with"/g) ?? [];

    assert.equal(together.length, 1, `together-with rendered ${together.length} times`);
  });

  it('draws a row past the badge budget as the budget plus one chip naming the rest', () => {
    // `blocked-by` is a list field, so a dense document badges every incident
    // edge on both endpoint rows with nothing to stop it — the same explosion
    // the graph refuses, in two projections that have no refusal to reach.
    const omitted = 25;
    const hub = row(render(denseRowDocument(ROW_BADGE_BUDGET + omitted - 1)), 'hub');
    const drawn = hub.match(/data-edge="/g) ?? [];

    assert.equal(drawn.length, ROW_BADGE_BUDGET, `drew ${String(drawn.length)} badges`);
    assert.match(hub, new RegExp(`data-omitted="${String(omitted)}"[^>]*>\\+${String(omitted)} more relationships<`));
    // THE NAME IS THE VISIBLE TEXT. ARIA prohibits naming a generic span, so an
    // attribute name could be ignored and a reader would hear a bare "+25 more".
    assert.equal(/data-omitted="25"[^>]*aria-label/.test(hub), false, 'the chip carries an aria-label');
  });

  it('spends the budget in field order, so blocked-by survives the cut', () => {
    // The hub's `decomposed-from` is declared FIRST but sits SECOND in the
    // format's field order, behind `blocked-by`, so a cut in declaration order would keep it and a
    // cut in field order drops it: the one relationship a reader asking "why
    // is this held" wants is the one that has to survive.
    const hub = row(render(denseRowDocument(ROW_BADGE_BUDGET)), 'hub');

    assert.equal((hub.match(/data-edge="blocked-by"/g) ?? []).length, ROW_BADGE_BUDGET);
    assert.equal(hub.includes('data-edge="decomposed-from"'), false, 'decomposed-from survived the cut');
    assert.match(hub, /data-omitted="1"[^>]*>\+1 more relationship</);
  });

  it('draws no chip for a row at or under the budget', () => {
    // At the budget exactly, the decomposed-from edge is the twelfth badge —
    // every relationship fits and a chip would claim an omission that never
    // happened.
    const hub = row(render(denseRowDocument(ROW_BADGE_BUDGET - 1)), 'hub');

    assert.equal((hub.match(/data-edge="/g) ?? []).length, ROW_BADGE_BUDGET);
    assert.equal(hub.includes('data-omitted'), false, 'a chip was drawn with nothing omitted');
  });

  it('gives the overflow chip no edge identity', () => {
    // The chip names no single edge, so it must not enter the pointer set as
    // if it did — a click on it would otherwise select "N edges".
    const hub = row(render(denseRowDocument(ROW_BADGE_BUDGET + 5)), 'hub');
    const chip = hub.slice(hub.indexOf('data-omitted'), hub.indexOf('</span>', hub.indexOf('data-omitted')));

    assert.equal(chip.includes('data-ig-group'), false);
  });

  it('bounds the badges a dense document draws by its rows, not its edges', () => {
    // EXACT, not an upper bound: the hub draws the budget, every other row
    // draws the one incoming badge it owns (`1` draws two, its blocked-by and
    // the decomposed-from), and the legend draws one badge per field. An
    // inequality here was satisfied by the unbudgeted render too.
    const count = 400;
    const markup = render(denseRowDocument(count));
    const badges = (markup.match(/data-edge="/g) ?? []).length;

    assert.equal(badges, ROW_BADGE_BUDGET + count + 1 + EDGE_ORDER.length);
    assert.match(row(markup, 'hub'), new RegExp(`data-omitted="${String(count + 1 - ROW_BADGE_BUDGET)}"`));
  });

  it('counts an omitted intra-unit edge once, after the dedupe', () => {
    // A together unit is one row with two keys, so the unit edge sits in BOTH
    // members' `edgesOf` entries. Counting before the dedupe would report that
    // one edge as two omissions; the partner's own blocked-by is a third.
    const unit = row(render(denseUnitDocument(ROW_BADGE_BUDGET)), 'hub');

    assert.equal((unit.match(/data-edge="blocked-by"/g) ?? []).length, ROW_BADGE_BUDGET);
    assert.match(unit, /data-omitted="3"/);
  });

  it('renders a promotion in the spec notation, naming the dependent', () => {
    assert.match(row(render(), '102'), /P3 -&gt; 0.*inherited from 101/s);
  });

  it('renders the other two provenance forms', () => {
    const markup = render();
    assert.match(row(markup, '101'), /matched ordered query 1/);
    assert.match(row(markup, '103'), /priority tier P2/);
  });

  it('links an issue only when the host supplied a URL', () => {
    const markup = render();
    assert.match(row(markup, '102'), /<a class="ig-link" href="https:\/\/example.test\/issues\/102"/);
    assert.equal(/<a /.test(row(markup, '103')), false, 'a link was invented for a URL-less issue');
  });

  it('gives every row an accessible name carrying the title and the key', () => {
    const markup = render();
    for (const key of ['102', '101', '103', '105', '106']) {
      assert.match(row(markup, key), /aria-label="[^"]+"/);
    }
    assert.match(row(markup, '102'), /aria-label="Backfill the ledger — 102 — rank 1"/);
  });

  it('marks the readiness station filled, hollow and dashed as the slot demands', () => {
    const markup = render();
    assert.match(row(markup, '102'), /data-fill="filled"/);
    assert.match(row(markup, '103'), /data-fill="hollow"/);
    assert.match(row(markup, '101'), /data-fill="dashed"/);
  });

  it('renders an empty state rather than an empty container', () => {
    const markup = render({ issues: [], edges: [], order: { slots: [], excluded: [] }, cycles: [] });
    assert.match(markup, /class="ig-empty"/);
    assert.match(markup, /Nothing is in the order right now/);
  });

  it('counts isolated issues into one chip instead of rendering them', () => {
    // 110 is in no slot and on no edge: 248 such dots carry no information, so
    // the design collapses them to a count.
    assert.match(render(), /1 issue is in no slot and declare/);
  });

  it('is deterministic — two renders of one document agree byte for byte', () => {
    assert.equal(render(), render());
  });

  it('publishes a focus order that follows the order, not the markup', () => {
    const scene = linearScene(normalizeDocument(fixtureDocument).document);
    assert.deepEqual([...scene.focusOrder], ['102', '101', '103', '105', '106']);
  });

  it('uses plain list semantics so a deep-link chip inside a row stays legal', () => {
    // `role="option"` forbids a focusable descendant, and every row carries a
    // link. Selection is announced with `aria-current`, which any element may
    // carry, rather than with a role that makes the link a violation.
    const markup = render();
    assert.equal(/role="listbox"/.test(markup), false);
    assert.equal(/role="option"/.test(markup), false);
    assert.match(markup, /<a class="ig-link"/);
    assert.match(markup, /aria-current="/);
  });

  it('names a duplicate with the vocabulary label rather than a second spelling', () => {
    assert.match(row(render(), '106'), /duplicate of 105 — never worked/);
  });

  it('marks the selected row and gives the focused row the tab stop', () => {
    const markup = render(fixtureDocument, { selected: '101', focused: '103' });
    assert.match(row(markup, '101'), /aria-current="true"/);
    assert.match(row(markup, '103'), /tabindex="0"/);
    assert.match(row(markup, '102'), /tabindex="-1"/);
  });
});
