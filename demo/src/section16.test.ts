/**
 * The §16 comparison page, read rather than looked at.
 *
 * The page exists so a state can be judged against its frame, and the readings
 * that judgement rests on — which state each panel reproduces, what its stamp
 * says, whether the stale one keeps the refresh its frame draws — are decisions
 * this file makes and could silently lose. So they are asserted here.
 *
 * THIS IS ALSO WHERE THE SENTENCES LIVE. The package may not carry a product's
 * words, so every string the §16g states print is the host's; a package test
 * can only pin that host text passes through, and pinning WHICH text is the
 * host's job — which is this file.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderViewer } from '@issuegraph/viewer';

import { PANELS, panelDocument } from './section16.ts';
import { ADOPTION_SIZE } from './seed.ts';

function markupOf(id: string): string {
  const panel = PANELS.get(id);
  assert.ok(panel !== undefined, `no such panel: ${id}`);
  const { markup, diagnostics } = renderViewer(panelDocument(id), {
    projection: panel.projection,
    compact: panel.compact,
    switchable: true,
  });
  // EVERY READ GOES THROUGH THE DIAGNOSTIC. A fidelity page is worthless if the
  // panel it draws contradicts its own host facts, and the viewer already says
  // so — this page once drew "Nothing is eligible right now" over eleven ranked
  // rows with a green suite, because the assertions read the sentences and
  // ignored the answer sitting beside them.
  assert.deepEqual(diagnostics, [], `${id} contradicts its own host facts`);
  return markup;
}

describe('the §16 comparison page', () => {
  it('draws every §16g state and §16h beside the four §16a/§16b frames', () => {
    assert.deepEqual(
      [...PANELS.keys()],
      [
        's16a-rail',
        's16a-column',
        's16b-column',
        's16b-expanded',
        's16g-importing',
        's16g-empty',
        's16g-error',
        's16g-fresh',
        's16g-stale',
        's16h-adoption',
      ],
    );
  });

  it('prints the first-import frame’s own three sentences', () => {
    const markup = markupOf('s16g-importing');
    assert.ok(markup.includes('data-ig-condition="importing"'));
    assert.ok(markup.includes('Building the local index'));
    assert.ok(markup.includes('ranks will change as the rest arrive'));
    assert.ok(markup.includes('412 of ~1,200 issues · relationships resolve last'));
  });

  it('prints the empty frame’s sentence over an order that really is empty', () => {
    const markup = markupOf('s16g-empty');
    assert.ok(markup.includes('Nothing is eligible right now'));
    assert.ok(markup.includes('The pipeline stays armed'));
    assert.ok(markup.includes('data-ig-command="review-pick-order"'));
    // THE FRAME DRAWS AN EMPTY CARD. `empty` is the one state that contradicts a
    // populated order rather than qualifying it, so the host shows what it says
    // it has — no rows, no NOW band, no tally claiming otherwise.
    assert.deepEqual(panelDocument('s16g-empty').order.slots, []);
    assert.ok(!markup.includes('ig-slot'), 'the empty panel drew order rows');
    assert.ok(!markup.includes('ig-now'), 'the empty panel drew a running job');
    assert.ok(!markup.includes('ig-empty'), 'the empty panel drew the package’s own sentence too');
  });

  it('prints the error frame’s assurance and offers Retry', () => {
    const markup = markupOf('s16g-error');
    assert.ok(markup.includes('The index could not be read'));
    assert.ok(markup.includes('continues on its last known order'));
    assert.ok(markup.includes('data-ig-command="retry:index"'));
  });

  it('dates the states that are NOT current from their own last successful read', () => {
    // An order the panel calls "the last one that could be read" is not current,
    // and an import that has not finished has not finished reading — so a fresh
    // stamp beside either sentence would have the panel's two halves disagreeing.
    const fresh = markupOf('s16g-fresh');
    assert.ok(fresh.includes('as of <span class="ig-id">14:30</span>'), 'the current panel lost its stamp');
    assert.ok(fresh.includes('data-stale="false"'));
    assert.ok(markupOf('s16g-importing').includes('14:28'), 'the importing panel is dated as if fully read');
    assert.ok(markupOf('s16g-error').includes('09:30'), 'the error panel is dated as if it had just read');
  });

  it('draws the stale stamp gold, with the word, and with the refresh its frame draws', () => {
    // The stale half of §16g's freshness card is drawn WITH the inline refresh:
    // the affordance is part of what the state is. Rebuilding the freshness
    // object from a list of fields to keep dropped `stale` silently once; both
    // are pinned so it cannot happen twice.
    const stale = markupOf('s16g-stale');
    assert.ok(stale.includes('data-stale="true"'), 'the stale panel is not stale');
    assert.ok(stale.includes(' · stale'), 'the stale panel never says the word');
    assert.ok(stale.includes('data-ig-command="refresh"'), 'the stale panel lost the refresh its frame draws');
  });

  it('keeps every other panel free of a refresh nothing can perform', () => {
    for (const id of PANELS.keys()) {
      if (id === 's16g-stale') continue;
      assert.ok(!markupOf(id).includes('data-ig-command="refresh"'), `${id} offers a refresh on a fixed clock`);
    }
  });

  it('draws §16h complete and calm: the day-one panel explains itself', () => {
    const markup = markupOf('s16h-adoption');
    // Real P0-P3 variety from the mapped labels, named by the ordered query
    // that matched — not the flat tier read the tile forbids.
    for (const label of ['label:P0', 'label:P1', 'label:P2', 'label:P3']) {
      assert.ok(markup.includes(label), `§16h never names ${label}`);
    }
    assert.ok(markup.includes('matched ordered query 1'), '§16h lost its ordered-query provenance');
    assert.ok(!markup.includes('ranked in tier'), '§16h fell back to a tier read');
    // Complete: no empty slot, no missing affordance, no relationship badge.
    assert.ok(!markup.includes('ig-empty'), '§16h drew an empty state');
    assert.ok(markup.includes('ig-toggle'), '§16h hid the projection toggle');
    assert.deepEqual(markup.match(/class="ig-badge" data-edge="/g) ?? [], [], '§16h drew a relationship badge');
    // One quiet line, with its link and its dismiss — and exactly one.
    assert.equal(markup.split('class="ig-adoption"').length - 1, 1, '§16h drew more than one adoption line');
    assert.ok(markup.includes('so ordering is entirely your pick order.'));
    // A SHORT LINK BESIDE THE SENTENCE, not the sentence wearing an underline.
    assert.ok(markup.includes('<a class="ig-adoption-link" href="https://issuegraph.org/" rel="noreferrer">'));
    assert.ok(!markup.includes('<a class="ig-adoption-link" href="https://issuegraph.org/" rel="noreferrer">No issue'));
    assert.ok(markup.includes('data-ig-command="dismiss:adoption"'), '§16h drew a line nobody can dismiss');
    // At the design's own scale, and under the graph's node budget.
    assert.equal(panelDocument('s16h-adoption').order.slots.length, ADOPTION_SIZE);
  });

  it('leaves the four original frames exactly as they were', () => {
    // THE COMP IS THE FIDELITY REFERENCE, so nothing this change added may reach
    // it. An adoption chip in that header — a fourth chip neither §16a nor §16b
    // draws, stating a backlog size the comp does not have — would make the
    // comparison surface disagree with what it exists to be compared against.
    for (const id of ['s16a-rail', 's16a-column', 's16b-column', 's16b-expanded']) {
      const markup = markupOf(id);
      assert.ok(!markup.includes('data-ig-condition'), `${id} gained a condition`);
      assert.ok(!markup.includes('ig-notice'), `${id} gained a notice`);
      assert.ok(!markup.includes('data-count="adoption"'), `${id} gained an adoption chip`);
      assert.ok(!markup.includes('ig-adoption'), `${id} gained an adoption line`);
    }
  });
});
