import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { edgeIdentity } from '@issuegraph/core';

import { normalizeDocument } from '../document.ts';
import { renderMarkup } from '../element.ts';
import { ROW_BADGE_BUDGET } from '../parts.ts';
import { type Receding, recedingOf } from '../recede.ts';
import { renderViewer } from '../render.ts';
import {
  denseRowDocument,
  denseUnitDocument,
  fixtureDocument,
  heldButRankedDocument,
  heldTogetherDocument,
  twoUnitDocument,
} from '../testing/fixtures.ts';
import { linearScene } from './linear.ts';

function render(input = fixtureDocument, options = {}): string {
  return renderMarkup(linearScene(normalizeDocument(input).document, options).root);
}

/**
 * The `<li>` markup for one key, so an assertion cannot match a neighbour's.
 *
 * IT BALANCES THE TAGS NOW. A together unit's row contains a nested list — one
 * `<li>` per member, which is how §16a draws it — so slicing to the FIRST
 * closing tag cut the row off in the middle of its own contents and every
 * assertion about what follows it silently passed on a truncated string.
 */
function row(markup: string, key: string): string {
  const start = markup.indexOf(`data-ig-key="${key}"`);
  assert.notEqual(start, -1, `no row for ${key}`);
  const open = markup.lastIndexOf('<li', start);
  let depth = 0;
  for (let at = open; at < markup.length; at += 1) {
    if (markup.startsWith('<li', at)) depth += 1;
    else if (markup.startsWith('</li>', at)) {
      depth -= 1;
      if (depth === 0) return markup.slice(open, at + 5);
    }
  }
  return markup.slice(open);
}

/** Only the relationship BADGES on a row — never a legend sample's own line. */
function edgeBadgesIn(markup: string): readonly string[] {
  return markup.match(/class="ig-badge" data-edge="/g) ?? [];
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
    // THE REASON IS ON SCREEN, not in a tooltip: it is the one thing a footer
    // entry exists to say, and a `title` is invisible until hovered and never
    // reached on touch. It stays in the accessible name too.
    assert.match(row(markup, '105'), /aria-label="[^"]*claimed by another run"/);
    assert.match(row(markup, '105'), /<p class="ig-footer-why">claimed by another run<\/p>/);
    assert.equal(/ title="claimed by another run"/.test(row(markup, '105')), false, 'the reason is drawn twice');
  });

  it('renders a duplicate in the footer naming its canonical', () => {
    const markup = render();
    assert.ok(markup.indexOf('data-ig-key="106"') > markup.indexOf('ig-footer'));
    assert.match(row(markup, '106'), /<span class="ig-badge" data-hold="duplicate">duplicate<\/span>/);
    assert.match(row(markup, '106'), /<p class="ig-footer-why">The original gets worked instead\.<\/p>/);
    assert.match(row(markup, '106'), /aria-label="[^"]*duplicate of 105, which gets worked instead"/);
  });

  it('renders a together unit as one row naming both members', () => {
    const markup = render();
    const unit = row(markup, '103');

    // ONE LINE EACH, INSIDE AN ENCLOSURE. Joining the titles with a separator —
    // which is what shipped — made a two-issue unit read as one issue with a
    // long title, and the unit is the one place the design draws an enclosure
    // to say the opposite.
    // SENTENCE CASE IN THE WORDS (#288): the sheet no longer capitalises the label.
    // NO GLYPH AND NO NOTE (#293): the export's label is the words alone, with
    // the count in a span of its own so it can be set regular and muted.
    assert.match(unit, /<div class="ig-unit-mark"><span class="ig-unit-pill">One unit · <span class="ig-unit-num">2<\/span> issues<\/span><\/div>/);
    // THE IDENTITY GOES THROUGH `identity`, so a member with a URL keeps the
    // deep-link chip §16e calls "the only external link". The fixture's unit
    // has none, so both draw as plain keys — the linked case is asserted below.
    assert.match(unit, /<li class="ig-unit-member"><span class="ig-title">Split the invoice writer<\/span><span class="ig-id"><span class="ig-id">103<\/span> · P2<\/span><\/li>/);
    assert.match(unit, /<li class="ig-unit-member"><span class="ig-title">Split the invoice reader<\/span><span class="ig-id"><span class="ig-id">104<\/span> · P2<\/span><\/li>/);
    assert.equal(markup.includes('data-ig-key="104"'), false, '104 rendered as its own row');
  });

  it('keeps the deep-link chip on EVERY member of a unit', () => {
    // The lead had one before this row shape existed, and printing the key as
    // plain text took it away from the lead and gave the partners none either —
    // so a unit was the one row in the panel from which no issue could be
    // opened at all. §16e calls that chip the only external link there is.
    const linked = {
      ...fixtureDocument,
      issues: fixtureDocument.issues.map((issue) =>
        issue.key === '103' || issue.key === '104'
          ? { ...issue, url: `https://example.test/issues/${issue.key}` }
          : issue,
      ),
    };
    const unit = row(render(linked), '103');
    for (const key of ['103', '104']) {
      assert.match(
        unit,
        new RegExp(`<a class="ig-link" href="https://example.test/issues/${key}"`),
        `${key} lost its deep link`,
      );
    }
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
    const drawn = edgeBadgesIn(hub);

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
    // COUNTED ON THE BADGE CLASS. The legend draws a SAMPLE of each edge now —
    // the real line, at the real dash and terminal, because the claim this
    // package makes is that hue is one of four channels and five outlined chips
    // showed neither of the other two. Those samples carry `data-edge` on the
    // path and the marker, so a bare attribute count reads the legend as
    // badges.
    const badges = edgeBadgesIn(markup).length;

    assert.equal(badges, ROW_BADGE_BUDGET + count + 1);
    assert.match(row(markup, 'hub'), new RegExp(`data-omitted="${String(count + 1 - ROW_BADGE_BUDGET)}"`));
  });

  it('counts an omitted intra-unit edge once, after the dedupe', () => {
    // A together unit is one row with two keys, so the unit edge sits in BOTH
    // members' `edgesOf` entries. Counting before the dedupe would report that
    // one edge as two omissions; the partner's own blocked-by is a third.
    const unit = row(render(denseUnitDocument(ROW_BADGE_BUDGET)), 'hub');

    assert.equal((unit.match(/class="ig-badge" data-edge="blocked-by"/g) ?? []).length, ROW_BADGE_BUDGET);
    assert.match(unit, /data-omitted="3"/);
  });

  it('renders a promotion in the spec notation, naming the dependent', () => {
    // The named parts are lifted to the brightest ink, which is what §16a does
    // and what makes the sentence scannable — so they are spans now, not bare
    // text.
    assert.match(
      row(render(), '102'),
      /Priority raised <span class=\"ig-id\">P3 -&gt; 0<\/span><span> because it blocks <span class=\"ig-id\">101<\/span>/,
    );
    // And the same fact as a chip on the badge row, which is where a reader
    // scanning a column of rows meets it.
    assert.match(row(render(), '102'), /<span class="ig-badge" data-priority="promoted">P3 -&gt; 0<\/span>/);
  });

  it('renders the other two provenance forms', () => {
    const markup = render();
    // THE LABEL IS A KEY A READER COPIES, so it is the mono `.ig-copy-key`, not
    // the sans `.ig-id` an issue number or a tier takes (#254).
    assert.match(row(markup, '101'), /Picked by query 1 · <span class="ig-copy-key">label:P1<\/span>/);
    // NEUTRAL. This arm means only that no ordering query matched and the issue
    // stayed in its tier; it does NOT mean the priority was absent, and §16a's
    // own row — which happens to be one where it was — is not a licence to say
    // so about every row that reaches this arm.
    assert.match(row(markup, '103'), /No query matched, so it goes by its priority, <span class="ig-id">P2<\/span>/);
    assert.match(row(markup, '103'), /<span class="ig-badge" data-priority="tier">P2<\/span>/);
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

  /**
   * THE FACT A SCREEN READER CANNOT AFFORD TO LOSE. `slotLabel` read the
   * position as `rank === null ? 'held, no rank' : 'rank N'`, which inferred
   * HELD from the ABSENCE OF A RANK. Sound while `@issuegraph/derive` assigned
   * `ready ? rank : null`; wrong since `RULINGS.md` §1, which is the case this
   * fixture is. The old expression announced the held unit as plain `rank 2`
   * and dropped the word held — silently, and only on the row the whole
   * feature exists to draw. §16a's row says both at once and so must the name.
   */
  it('announces a held slot as held EVEN WHEN it now carries a rank', () => {
    const markup = render(heldButRankedDocument);

    // The unit is held AND placed: both facts, from `ready` and `rank`.
    assert.match(row(markup, '1'), /aria-label="Lead · Partner — 1, 2 — held, rank 2"/);
    // The station agrees with the name rather than with the number beside it.
    assert.match(row(markup, '1'), /data-fill="dashed"/);
    assert.match(row(markup, '1'), /class="ig-rank"[^>]*>2</);
    // A ready slot says nothing about holds.
    assert.match(row(markup, '3'), /aria-label="Blocker — 3 — rank 1"/);
    // The other arm keeps the phrase it always had, and adds the position it
    // would have taken when the host worked one out.
    assert.match(
      row(markup, '4'),
      /aria-label="Waiting on elsewhere — 4 — held, no rank, would be rank 3"/,
    );
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
    assert.match(render(), /1 more issue has no relationships and no place/);
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
    assert.match(row(render(), '106'), /aria-label="[^"]*duplicate of 105, which gets worked instead"/);
  });

  it('marks the selected row and gives the focused row the tab stop', () => {
    const markup = render(fixtureDocument, { selected: '101', focused: '103' });
    assert.match(row(markup, '101'), /aria-current="true"/);
    assert.match(row(markup, '103'), /tabindex="0"/);
    assert.match(row(markup, '102'), /tabindex="-1"/);
  });

  it('carries relationships on EVERY footer row shape, whichever holds the edge', () => {
    // A footer row is the only mark either projection makes for its issue — the
    // list draws no arc at all, and the graph draws no node for anything down
    // here — so an edge whose ends are both in this group had nothing left to
    // represent it and disappeared entirely while both issues stayed visible.
    // It arrived once per row shape: the aside row, then the tracker-held one.
    // One rule now, asserted over all three.
    const bothHeld = {
      issues: [
        { key: 'h1', title: 'Claimed, and blocked', open: true, priority: 2 as const },
        { key: 'h2', title: 'Claimed, and blocking', open: true, priority: 2 as const },
        { key: 'dup', title: 'A duplicate that also blocks', open: true, priority: 2 as const },
        { key: 'canon', title: 'The canonical', open: true, priority: 2 as const },
      ],
      edges: [
        { field: 'blocked-by' as const, from: 'h1', to: 'h2' },
        { field: 'blocked-by' as const, from: 'dup', to: 'h2' },
      ],
      order: {
        slots: [
          {
            rank: null,
            lead: 'h1',
            members: ['h1'],
            ready: false,
            holds: [{ family: 'tracker' as const, reason: 'claimed', label: 'claimed' }],
          },
          {
            rank: null,
            lead: 'h2',
            members: ['h2'],
            ready: false,
            holds: [{ family: 'tracker' as const, reason: 'claimed', label: 'claimed' }],
          },
        ],
        excluded: [{ key: 'dup', canonical: 'canon', reason: 'duplicate-of' as const }],
      },
      cycles: [],
    };
    const markup = render(bothHeld);

    assert.match(row(markup, 'h1'), /data-edge="blocked-by"/, 'a held row lost its relationship');
    assert.match(row(markup, 'h2'), /data-edge="blocked-by"/, 'a held row lost its relationship');
    assert.match(row(markup, 'dup'), /data-edge="blocked-by"/, 'an exclusion lost its relationship');
  });
});

describe('the linear projection, with the footer detached', () => {
  // THE DEFECT THIS OPTION CLOSES: a host that virtualizes rows composes
  // `spacer + root + spacer`, so a footer inside the root landed directly under
  // the VISIBLE rows — mid-scroll, with the rest of the order still below it.
  // The group is handed back on `scene.footer` for the host to place after its
  // extent, and nothing else about the scene may move.
  const document = normalizeDocument(fixtureDocument).document;

  /** The inline `<section class="ig-footer">` of a rendered root, whole. */
  function footerSection(markup: string): string {
    const start = markup.indexOf('<section class="ig-footer"');
    assert.notEqual(start, -1, 'no inline footer to compare against');
    const end = markup.indexOf('</section>', start);
    return markup.slice(start, end + '</section>'.length);
  }

  it('leaves the root without the group and hands every entry back on scene.footer', () => {
    const scene = linearScene(document, { detachFooter: true });
    const root = renderMarkup(scene.root);

    assert.equal(root.includes('ig-footer'), false, 'the detached group is still drawn in the root');
    assert.ok(scene.footer !== null, 'a document with footer entries detached no footer');
    const footer = renderMarkup(scene.footer);
    // 105 is the tracker-held slot and 106 the duplicate: one of each family.
    assert.match(footer, /<section class="ig-footer"/);
    assert.match(row(footer, '105'), /class="ig-footer-row"/);
    assert.match(row(footer, '106'), /class="ig-footer-row"/);
    assert.equal(root.includes('data-ig-key="105"'), false);
    assert.equal(root.includes('data-ig-key="106"'), false);
  });

  it('detaches the SAME group the root would have drawn, byte for byte', () => {
    const inline = footerSection(renderMarkup(linearScene(document).root));
    const detached = linearScene(document, { detachFooter: true }).footer;
    assert.ok(detached !== null);
    assert.ok(renderMarkup(detached).includes(inline), 'the detached group differs from the inline one');
  });

  it('draws the default exactly as before and says it detached nothing', () => {
    const before = linearScene(document);
    const declined = linearScene(document, { detachFooter: false });

    assert.equal(before.footer, null);
    assert.equal(declined.footer, null);
    assert.equal(renderMarkup(declined.root), renderMarkup(before.root));
    assert.match(renderMarkup(before.root), /<section class="ig-footer"/);
  });

  it('keeps the traversal identical, because the order did not move', () => {
    const options = { selected: '105', focused: '106' };
    const inline = linearScene(document, options);
    const detached = linearScene(document, { ...options, detachFooter: true });

    assert.deepEqual([...detached.focusOrder], [...inline.focusOrder]);
    assert.deepEqual([...detached.navigable], [...inline.navigable]);
    assert.deepEqual([...detached.focusOrder], ['102', '101', '103', '105', '106']);
    // The tab stop and the selection still land on the footer rows they named.
    assert.ok(detached.footer !== null);
    const footer = renderMarkup(detached.footer);
    assert.match(row(footer, '105'), /aria-current="true"/);
    assert.match(row(footer, '106'), /tabindex="0"/);
  });

  it('wraps the group in the root class and the attributes its rules read, and no others', () => {
    // The group's type, box sizing, focus ring and §17j's density block hang
    // off `.ig-viewer`; outside the root it needs one to hang off.
    const scene = linearScene(document, { detachFooter: true, frame: false, density: 'dense', dockLegend: true });
    assert.ok(scene.footer !== null);
    const footer = renderMarkup(scene.footer);
    const wrapper = footer.slice(0, footer.indexOf('>') + 1);

    assert.match(wrapper, /^<div class="ig-viewer ig-linear"/);
    assert.match(wrapper, /data-frame="none"/);
    assert.match(wrapper, /data-density="dense"/);
    assert.match(wrapper, /data-ig-detached="footer"/);
    // No legend lives in here to dock, and the importing outline is the panel's.
    assert.equal(/data-legend=/.test(wrapper), false);
    assert.equal(/data-ig-condition=/.test(wrapper), false);
  });

  it('detaches nothing from a document with no footer entries', () => {
    const bare = {
      ...fixtureDocument,
      order: {
        slots: fixtureDocument.order.slots.filter((slot) => slot.lead !== '105'),
        excluded: [],
      },
    };
    const scene = linearScene(normalizeDocument(bare).document, { detachFooter: true });
    assert.equal(scene.footer, null);
    assert.equal(renderMarkup(scene.root).includes('ig-footer'), false);
  });
});

/** The recede stamp of each list row, ranked and footer, by the key the row carries. */
function listRowStamps(markup: string): Map<string, boolean> {
  const stamps = new Map<string, boolean>();
  for (const [tag] of markup.matchAll(/<li class="(?:ig-slot|ig-footer-row)"[^>]*>/g)) {
    const key = /data-ig-key="([^"]*)"/.exec(tag)?.[1];
    if (key !== undefined && !stamps.has(key)) stamps.set(key, tag.includes('data-recede="true"'));
  }
  return stamps;
}

describe('the linear projection recedes what a selection does not touch', () => {
  it('renders a selection that resolves to nothing byte for byte as the bare list, however it is spelled', () => {
    const bare = render(fixtureDocument);
    const bareViewer = renderViewer(fixtureDocument, { projection: 'linear' }).markup;
    assert.equal(bare.includes('data-recede'), false, 'the bare list carries a recede stamp');
    assert.equal(bareViewer.includes('data-recede'), false, 'the bare list carries a recede stamp');
    const real = edgeIdentity('blocked-by', '101', '102');
    // Without these two the loop below passes on a list that ignores the selection.
    assert.match(render(fixtureDocument, { selected: '102' }), /data-recede="true"/, "selecting '102' receded no list row");
    assert.match(render(fixtureDocument, { selectedEdge: real }), /data-recede="true"/, 'selecting a relationship receded no list row');

    // The issue: "With an issue or a relationship selected, list-projection rows that `recedingOf` gives are stamped `data-recede="true"`, and every other row carries no stamp"
    // A selection that names nothing in the document recedes nothing, so no row
    // is stamped and the list draws exactly as it does with nothing selected.
    // The values below break out of an attribute, a tag or a CSS attribute
    // selector, or are a real identity swapped or with one byte added.
    const hostile = [
      '"><script>alert(1)</script>',
      "'] , * { display: none } [x='",
      '</svg><img src=x onerror=alert(1)>',
      'a|b|c|d',
      `${real}"`,
      `${real}]`,
    ];
    const unresolved: readonly { selected?: string | null; selectedEdge?: string | null }[] = [
      { selected: null, selectedEdge: null },
      { selected: 'nowhere' },
      { selected: '102"' },
      { selectedEdge: 'not|an|edge' },
      // blocked-by is directed, so the swapped identity names no relationship.
      { selectedEdge: edgeIdentity('blocked-by', '102', '101') },
      { selected: '"><li data-recede="true">', selectedEdge: `x"'<]|y` },
      ...hostile.flatMap((value) => [{ selectedEdge: value }, { selected: value, selectedEdge: value }]),
    ];
    for (const options of unresolved) {
      assert.equal(render(fixtureDocument, options), bare, JSON.stringify(options));
      assert.equal(renderViewer(fixtureDocument, { projection: 'linear', ...options }).markup, bareViewer, JSON.stringify(options));
    }
  });

  it('renderViewer adds only the constant recede stamp to list rows, and no copy of the selection', () => {
    const bare = renderViewer(fixtureDocument, { projection: 'linear' }).markup;
    const receding = renderViewer(fixtureDocument, {
      projection: 'linear',
      selectedEdge: edgeIdentity('blocked-by', '101', '102'),
    }).markup;

    // The issue: "With an issue or a relationship selected, list-projection rows that `recedingOf` gives are stamped `data-recede="true"`, and every other row carries no stamp"
    const values = [...receding.matchAll(/data-recede="([^"]*)"/g)].map((match) => match[1]);
    assert.ok(values.length > 0, 'a resolving relationship stamped no list row');
    assert.deepEqual([...new Set(values)], ['true']);

    // Removing every stamp gives back the bare list byte for byte, so the
    // selection value is never written into the list's markup anywhere else.
    assert.equal(receding.replaceAll(' data-recede="true"', ''), bare);
  });

  it('stamps each list row, ranked and footer, exactly when recedingOf gives its key for a selected issue', () => {
    const normalized = normalizeDocument(fixtureDocument).document;
    const markup = renderMarkup(linearScene(normalized, { selected: '102' }).root);
    const receding = recedingOf(normalized, { key: '102', edge: null });
    const stamps = listRowStamps(markup);

    // The issue: "With an issue or a relationship selected, list-projection rows that `recedingOf` gives are stamped `data-recede="true"`, and every other row carries no stamp"
    for (const [key, stamped] of stamps) {
      assert.equal(stamped, receding.keys.has(key), `the list row of ${key} disagrees with recedingOf`);
    }
    // 102 shares both its lines with 101 and none with the unit 103, the footer slot 105 or the
    // exclusion 106, so this reaches a ranked row, a held row, a unit row, a footer slot and an exclusion.
    assert.deepEqual(
      ['102', '101', '103', '105', '106'].map((key) => [key, stamps.get(key)]),
      [
        ['102', false],
        ['101', false],
        ['103', true],
        ['105', true],
        ['106', true],
      ],
    );
    // A stamp is the constant "true" on the row itself, never "false" and never on anything inside a row.
    const values = [...markup.matchAll(/data-recede="([^"]*)"/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(values)], ['true']);
    assert.equal(values.length, [...stamps.values()].filter(Boolean).length, 'a stamp landed on something other than a list row');
  });

  it("recedes the list by the selected member '104' while the row of its lead '103' stays current and keeps the tab stop", () => {
    const normalized = normalizeDocument(fixtureDocument).document;
    const draw = (selected: string): string => renderMarkup(linearScene(normalized, { selected }).root);
    const rowTag = (markup: string, key: string): string => {
      const tag = [...markup.matchAll(/<li class="(?:ig-slot|ig-footer-row)"[^>]*>/g)]
        .map(([found]) => found)
        .find((found) => found.includes(`data-ig-key="${key}"`));
      assert.ok(tag !== undefined, `no list row was drawn for ${key}`);
      return tag;
    };
    const byMember = draw('104');
    const byLead = draw('103');

    assert.match(rowTag(byMember, '103'), /data-unit="true"/, "the row of '103' is not the unit row, so this proves nothing");
    // The issue: "`linearScene` in packages/viewer/src/projections/linear.ts calls `recedingOf` with the selection as given, before `atStations` (packages/viewer/src/parts.ts) moves a selected unit member to its lead, exactly as packages/viewer/src/projections/graph.ts already does, and stamps each receded row."
    const receding = recedingOf(normalized, { key: '104', edge: null });
    const stamps = listRowStamps(byMember);
    assert.ok(stamps.size > 0, 'the list drew no row');
    for (const [key, stamped] of stamps) assert.equal(stamped, receding.keys.has(key), `row ${key}`);
    // 105 touches the lead 103 over serialize-with and touches 104 by nothing, so it recedes for the
    // member and stays for the lead.
    assert.match(rowTag(byMember, '105'), /data-recede="true"/, "the row of 105 was kept, so the list receded by the lead '103'");
    assert.equal(rowTag(byLead, '105').includes('data-recede'), false, "selecting '103' receded its serialize-with partner 105");
    assert.equal(rowTag(byMember, '103').includes('data-recede'), false, 'the unit row of the selected member receded');
    assert.match(rowTag(byMember, '103'), /aria-current="true"/, 'the unit row no longer marks the selection on its lead');
    // Apart from the stamps, selecting the member draws what selecting the lead draws: the same
    // current row and the same tab stop.
    assert.equal(byMember.replaceAll(' data-recede="true"', ''), byLead.replaceAll(' data-recede="true"', ''));
  });

  it('stamps the list from a receding it is handed rather than from the selection beside it, and still marks the selected row', () => {
    // This is how a host whose list draws only part of its document recedes the list by the whole document.
    const normalized = normalizeDocument(fixtureDocument).document;
    const handed: Receding = recedingOf(normalized, { key: '105', edge: null });
    const markup = renderMarkup(linearScene(normalized, { selected: '102', receding: handed }).root);
    const stamps = listRowStamps(markup);
    assert.ok(stamps.size > 0, 'the list drew no row, so this proves nothing');
    for (const [key, stamped] of stamps) {
      assert.equal(stamped, handed.keys.has(key), `the list row of ${key} disagrees with the receding it was handed`);
    }
    // 102 touches nothing 105 touches, so its row recedes only when the handed receding wins.
    assert.equal(stamps.get('102'), true, "the row of the selected '102' was kept, so the selection won over the handed receding");
    assert.equal(stamps.get('105'), false, 'the row of 105 receded under a receding that keeps it');
    assert.match(row(markup, '102'), /aria-current="true"/, 'the receding moved the selection mark');

    const nothing = recedingOf(normalized, { key: null, edge: null });
    const quiet = renderMarkup(linearScene(normalized, { selected: '102', receding: nothing }).root);
    assert.equal(quiet.includes('data-recede'), false, 'a handed receding that recedes nothing still stamped a row');
  });

  it('an order list given an issue and a relationship together recedes by the issue alone', () => {
    const edge = edgeIdentity('decomposed-from', '103', '107');
    const draw = (options: { selected?: string; selectedEdge?: string }): string =>
      renderViewer(fixtureDocument, { projection: 'linear', ...options }).markup;
    const byIssue = draw({ selected: '102' });
    assert.match(byIssue, /data-recede="true"/, "selecting '102' receded no row");
    assert.notEqual(draw({ selectedEdge: edge }), byIssue, 'the relationship recedes the rows the issue does, so this proves nothing');

    // The issue: "The list's stamps equal the graph's for the same selection, including a selected unit member, in `renderViewer` and in `mountViewer`"
    // The graph recedes by the issue and ignores a relationship passed beside it, so the list must too.
    assert.equal(draw({ selected: '102', selectedEdge: edge }), byIssue);
  });

  it('an order list recomputes its recede on every scene, so a selection leaves no stamp on the next scene of the same document', () => {
    // One normalized document shared by every scene, so a recede result kept
    // between scenes would show up in a later one.
    const normalized = normalizeDocument(fixtureDocument).document;
    const draw = (options: { selected?: string | null; selectedEdge?: string | null }): string =>
      renderMarkup(linearScene(normalized, options).root);
    const relationship = edgeIdentity('serialize-with', '103', '105');

    const bare = draw({});
    const byKey = draw({ selected: '102' });
    const byEdge = draw({ selectedEdge: relationship });
    assert.equal(bare.includes('data-recede'), false, 'the bare list carries a stamp');
    assert.match(byKey, /data-recede="true"/, "selecting '102' receded no row");
    assert.match(byEdge, /data-recede="true"/, 'selecting a relationship receded no row');

    // The issue: "With nothing selected, list markup is byte-identical to before"
    assert.equal(draw({}), bare, 'a bare scene after selections kept a stamp');
    assert.equal(draw({ selected: null, selectedEdge: null }), bare, 'explicit nulls after selections kept a stamp');
    assert.equal(draw({ selected: 'nowhere' }), bare, 'an unknown key after selections kept a stamp');
    assert.equal(draw({ selectedEdge: edgeIdentity('blocked-by', '102', '101') }), bare, 'a swapped identity after selections kept a stamp');
    assert.equal(draw({ selected: '102' }), byKey, 'repeating an issue selection changed what recedes');
    assert.equal(draw({ selectedEdge: relationship }), byEdge, 'repeating a relationship selection changed what recedes');
  });
});

describe('a selected set in the list', () => {
  const slotTag = (markup: string, key: string): string => {
    const tag = new RegExp(`<li class="ig-slot" data-ig-key="${key}"[^>]*>`).exec(markup)?.[0];
    assert.ok(tag !== undefined, `no list row was drawn for ${key}`);
    return tag;
  };

  it('marks every member of a set holding members of two units, on their unit rows', () => {
    const markup = render(twoUnitDocument, { selected: ['22', '12'] });
    for (const key of ['11', '21']) assert.match(slotTag(markup, key), /aria-current="true"/, `the unit row ${key}`);
    for (const key of ['31', '32', '33', '34']) assert.match(slotTag(markup, key), /aria-current="false"/, `the row ${key}`);
  });

  it('recedes by the set as given, never the lead-substituted one', () => {
    const normalized = normalizeDocument(twoUnitDocument).document;
    const asGiven = recedingOf(normalized, { key: ['22', '12'], edge: null });
    const byLeads = recedingOf(normalized, { key: ['21', '11'], edge: null });
    // The fixture is only a proof while the two answers differ.
    assert.notDeepEqual([...asGiven.keys].sort(), [...byLeads.keys].sort());
    const stamps = listRowStamps(render(twoUnitDocument, { selected: ['22', '12'] }));
    assert.ok(stamps.size > 0, 'the list drew no row');
    for (const [key, stamped] of stamps) assert.equal(stamped, asGiven.keys.has(key), `row ${key}`);
    assert.equal(stamps.get('33'), true, "33 touches only the lead 11, so it recedes");
    assert.equal(stamps.get('31'), false, '31 blocks the member 12, so it stays');
  });

  it('puts the tab stop on the most recently added member it draws', () => {
    const scene = linearScene(normalizeDocument(twoUnitDocument).document, { selected: ['31', '22'] });
    assert.match(renderMarkup(scene.root), /<li class="ig-slot" data-ig-key="21"[^>]*tabindex="0"/);
    // Two members of one unit around a member of another: the last added is 11.
    const shared = linearScene(normalizeDocument(twoUnitDocument).document, { selected: ['12', '22', '11'] });
    assert.match(renderMarkup(shared.root), /<li class="ig-slot" data-ig-key="11"[^>]*tabindex="0"/);
  });
});
