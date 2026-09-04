import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diffOrder } from '@issuegraph/store';
import type { ViewerDocument } from '@issuegraph/viewer';
import { renderViewer } from '@issuegraph/viewer';

import { CHANGE_FACETS, reevaluateView, summaryOf } from './view.ts';
import { editOf, orderOf, railOf } from '../testing/reevaluate.ts';

/** The scene the rail produced, which is what placement is asked about. */
function sceneOf(document: ViewerDocument) {
  return renderViewer(document, { projection: 'linear' }).scene;
}

describe('the summary is the counts, with the zeroes taken out', () => {
  it('reports every facet that happened, in the declared order', () => {
    // Built by the store's own diff rather than as a literal, so the fixture
    // cannot outlive the computation it stands for.
    const change = diffOrder(
      orderOf(['a', 'b', 'c', 'gone'], ['b']),
      orderOf(['b', 'a', 'c', 'new']),
      editOf(),
    );
    const summary = summaryOf(change);

    assert.deepEqual(
      summary.parts.map((part) => part.facet),
      ['moved', 'promoted', 'entered', 'left'],
    );
    assert.equal(summary.parts.every((part) => part.count > 0), true);
    assert.equal(summary.unchanged, false);
    assert.equal(summary.mutationId, 'm1');
    assert.equal(summary.op, 'create');
  });

  it('orders the parts by CHANGE_FACETS and not by how the deltas arrived', () => {
    const change = diffOrder(orderOf(['a', 'b'], ['a']), orderOf(['b', 'a']), editOf());
    const facets = summaryOf(change).parts.map((part) => part.facet);
    // A subsequence of the declared order, whatever the deltas' own sequence.
    assert.deepEqual(facets, CHANGE_FACETS.filter((facet) => facets.includes(facet)));
  });

  it('calls an edit that moved nothing UNCHANGED rather than empty', () => {
    // The finding an owner auditing an encoding most needs. Reporting it as the
    // absence of a change would hide it, so it gets its own name here and its
    // own rendering downstream.
    const same = orderOf(['a', 'b', 'c']);
    const summary = summaryOf(diffOrder(same, orderOf(['a', 'b', 'c']), editOf()));
    assert.deepEqual([...summary.parts], []);
    assert.equal(summary.unchanged, true);
  });
});

describe('a chip is placed on the row that represents its issue', () => {
  it('keys each chip to the drawn row, and reports no diagnostic', () => {
    const document = railOf(['a', 'b', 'c']);
    const change = diffOrder(orderOf(['a', 'b', 'c']), orderOf(['b', 'a', 'c']), editOf());
    const view = reevaluateView(change, sceneOf(document), 'settled');

    assert.deepEqual(
      view.chips.map((chip) => chip.key).sort(),
      ['a', 'b'],
    );
    // Only the rows that changed. `c` did not move and gets nothing at all.
    assert.equal(view.chips.some((chip) => chip.key === 'c'), false);
    assert.deepEqual([...view.diagnostics], []);
  });

  it('places a together-with PARTNER on its lead\'s row', () => {
    // The partner has no row of its own — the unit is one station keyed by its
    // lead — so a placement that used `delta.ref` directly would find no row
    // and lose a real change.
    const document: ViewerDocument = {
      issues: ['lead', 'partner', 'other'].map((key) => ({
        key,
        title: `Issue ${key}`,
        open: true,
        priority: 2,
      })),
      edges: [{ field: 'together-with', from: 'lead', to: 'partner' }],
      order: {
        slots: [
          { rank: 1, lead: 'lead', members: ['lead', 'partner'], ready: true, holds: [] },
          { rank: 2, lead: 'other', members: ['other'], ready: true, holds: [] },
        ],
        excluded: [],
      },
      cycles: [],
    };
    const scene = sceneOf(document);
    assert.equal(scene.stationOf.get('partner'), 'lead', 'the fixture must exercise a partner');

    const change = diffOrder(
      orderOf(['partner', 'other'], ['partner']),
      orderOf(['partner', 'other']),
      editOf(),
    );
    const view = reevaluateView(change, scene, 'settled');

    assert.deepEqual(view.chips.map((chip) => chip.key), ['lead']);
    assert.deepEqual(view.chips[0]?.deltas.map((delta) => delta.ref), ['partner']);
    assert.deepEqual([...view.diagnostics], []);
  });

  it('gives a together unit ONE chip when BOTH its members change', () => {
    // The collision this grouping exists to prevent. The store's order carries
    // a row per ref, so a unit that moves produces a delta for every member —
    // and all of them resolve to the one key the rail drew. Ungrouped, that is
    // two chips stacked on the same row by any mount that positions by key.
    const document: ViewerDocument = {
      issues: ['lead', 'partner', 'other'].map((key) => ({
        key,
        title: `Issue ${key}`,
        open: true,
        priority: 2,
      })),
      edges: [{ field: 'together-with', from: 'lead', to: 'partner' }],
      order: {
        slots: [
          { rank: 1, lead: 'other', members: ['other'], ready: true, holds: [] },
          { rank: 2, lead: 'lead', members: ['lead', 'partner'], ready: true, holds: [] },
        ],
        excluded: [],
      },
      cycles: [],
    };
    const change = diffOrder(
      orderOf(['lead', 'partner', 'other']),
      orderOf(['other', 'lead', 'partner']),
      editOf(),
    );
    const view = reevaluateView(change, sceneOf(document), 'settled');

    // `other` first: the chips follow the order the change reported its deltas,
    // and `diffOrder` walks the NEXT order, in which `other` is now rank 0.
    assert.deepEqual(view.chips.map((chip) => chip.key), ['other', 'lead']);
    const unit = view.chips.find((chip) => chip.key === 'lead');
    assert.deepEqual(unit?.deltas.map((delta) => delta.ref), ['lead', 'partner']);
    assert.deepEqual([...view.diagnostics], []);
  });

  it('reports a change it cannot place, rather than dropping it', () => {
    // An absence rendered as a value licenses a false conclusion, and the false
    // conclusion here is "nothing happened to that issue".
    const change = diffOrder(orderOf(['a', 'ghost']), orderOf(['ghost', 'a']), editOf());
    const view = reevaluateView(change, sceneOf(railOf(['a'])), 'settled');

    assert.deepEqual(view.chips.map((chip) => chip.key), ['a']);
    assert.equal(view.diagnostics.length, 1);
    assert.match(view.diagnostics[0] ?? '', /ghost/);
  });

  it('does NOT report a row that left the order as unplaceable', () => {
    // Its absence from the rail is the fact it is reporting. The count still
    // reaches the summary, which is where the reader learns it happened.
    const change = diffOrder(orderOf(['a', 'b']), orderOf(['a']), editOf());
    const view = reevaluateView(change, sceneOf(railOf(['a'])), 'settled');

    assert.deepEqual([...view.diagnostics], []);
    assert.equal(
      view.chips.some((chip) => chip.deltas.some((delta) => delta.presence === 'left')),
      false,
    );
    assert.equal(summaryOf(change).parts.some((part) => part.facet === 'left'), true);
  });
});

describe('the view says whether the order is still telling the whole story', () => {
  it('carries `held` straight from the status, with or without a change', () => {
    const scene = sceneOf(railOf(['a']));
    assert.equal(reevaluateView(undefined, scene, 'held').held, true);
    assert.equal(reevaluateView(undefined, scene, 'settled').held, false);
  });

  it('reports NO summary when nothing has landed since the last dismissal', () => {
    // Absent is not the same fact as `unchanged`: one is "no edit to report",
    // the other is "an edit landed and moved nothing".
    const view = reevaluateView(undefined, sceneOf(railOf(['a'])), 'settled');
    assert.equal(view.summary, null);
    assert.deepEqual([...view.chips], []);
  });
});
