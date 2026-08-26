import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CLUSTER_ONLY_BUDGET, GRAPH_NODE_BUDGET } from '@issuegraph/viewer';

import { componentKey, componentsSumming, documentOf, isolatedKey } from '../testing/documents.ts';
import { INITIAL_SCALE_STATE } from './commands.ts';
import { scaleLadder } from './ladder.ts';

const relatedDocument = (total: number, cap = 20) =>
  documentOf({ components: componentsSumming(total, cap) });

describe('the tier is decided by the viewer\'s own budgets', () => {
  it('draws at the budget and refuses one past it', () => {
    // THE BOUNDARIES, NOT A SAMPLE EITHER SIDE OF THEM. An off-by-one here puts
    // the ladder and the canvas into disagreement about the same document — the
    // canvas would draw a refusal under a ladder claiming it drew, or the
    // reverse — and only the boundary cases can catch it.
    assert.equal(scaleLadder(relatedDocument(GRAPH_NODE_BUDGET)).tier, 'direct');
    assert.equal(scaleLadder(relatedDocument(GRAPH_NODE_BUDGET + 1)).tier, 'capsules');
    assert.equal(scaleLadder(relatedDocument(CLUSTER_ONLY_BUDGET)).tier, 'capsules');
    assert.equal(scaleLadder(relatedDocument(CLUSTER_ONLY_BUDGET + 1)).tier, 'clusters');
  });

  it('publishes the budgets it used rather than restating the numbers', () => {
    const ladder = scaleLadder(relatedDocument(10));
    assert.deepEqual(ladder.budgets, {
      node: GRAPH_NODE_BUDGET,
      clusterOnly: CLUSTER_ONLY_BUDGET,
    });
  });

  it('counts what the canvas would DRAW, so isolated issues do not push it over', () => {
    // Isolated issues are excluded from the canvas by design, so a backlog that
    // is mostly relationship-free draws directly however large it is. This is
    // the case the design calls the majority — 248 of 312.
    const document = documentOf({ components: componentsSumming(20, 5), isolated: 500 });
    const ladder = scaleLadder(document);
    assert.equal(ladder.nodeCount, 20);
    assert.equal(ladder.tier, 'direct');
    assert.equal(ladder.isolated.count, 500);
  });
});

describe('the capsules describe the components', () => {
  it('carries size, blocking count, chain depth and the cycle flag', () => {
    const document = documentOf({ components: [40, 30], cycleIn: 1 });
    const ladder = scaleLadder(document);
    assert.equal(ladder.tier, 'capsules');
    assert.equal(ladder.capsules.length, 2);

    const [largest, second] = ladder.capsules;
    assert.ok(largest !== undefined && second !== undefined);
    assert.equal(largest.size, 40);
    // A chain of n members carries n-1 `blocked-by` edges, so its depth is n-1.
    assert.equal(largest.blockedByEdges, 39);
    assert.equal(largest.chainDepth, 39);
    assert.equal(largest.hasCycle, false);

    assert.equal(second.size, 30);
    assert.equal(second.hasCycle, true);
    // The closing edge is counted, and the cycle does not inflate the depth.
    assert.equal(second.blockedByEdges, 30);
    assert.equal(second.chainDepth, 29);
  });

  it('offers a lead that focuses that component', () => {
    const document = documentOf({ components: [40, 30] });
    const ladder = scaleLadder(document);
    const capsule = ladder.capsules[0];
    assert.ok(capsule !== undefined);
    const focused = scaleLadder(document, { ...INITIAL_SCALE_STATE, focus: capsule.lead });
    assert.equal(focused.nodeCount, capsule.size);
    assert.deepEqual([...focused.canvas.issues].map((issue) => issue.key).sort(), [...capsule.members].sort());
  });

  it('truncates past the cluster-only budget and says how many it left out', () => {
    const document = documentOf({ components: componentsSumming(CLUSTER_ONLY_BUDGET + 1, 5) });
    const ladder = scaleLadder(document);
    assert.equal(ladder.tier, 'clusters');
    assert.equal(ladder.capsules.length, 12);
    assert.ok(ladder.capsulesOmitted > 0);
  });

  it('lists every component on the capsules tier, and none while one is focused', () => {
    const document = documentOf({ components: [40, 30] });
    assert.equal(scaleLadder(document).capsules.length, 2);
    const focused = scaleLadder(document, { ...INITIAL_SCALE_STATE, focus: componentKey(0, 1) });
    assert.deepEqual([...focused.capsules], []);
    assert.equal(focused.capsulesOmitted, 0);
  });
});

describe('every refusal names its reason and offers a route', () => {
  it('does so on both refusing tiers, and on a focused component that still refuses', () => {
    const cases = [
      { name: 'capsules', ladder: scaleLadder(relatedDocument(GRAPH_NODE_BUDGET + 1)) },
      { name: 'clusters', ladder: scaleLadder(relatedDocument(CLUSTER_ONLY_BUDGET + 1, 5)) },
      {
        name: 'focused-over-budget',
        ladder: scaleLadder(documentOf({ components: [GRAPH_NODE_BUDGET + 1] }), {
          ...INITIAL_SCALE_STATE,
          focus: componentKey(0, 1),
        }),
      },
    ];
    for (const { name, ladder } of cases) {
      const refusal = ladder.refusal;
      assert.ok(refusal !== null, `${name} did not refuse`);
      assert.match(refusal.reason, /budget/, name);
      assert.match(refusal.reason, new RegExp(String(refusal.nodeCount)), name);
      assert.ok(refusal.routes.length > 0, `${name} refused with no route forward`);
      assert.ok(
        refusal.routes.every((route) => route.label.trim() !== ''),
        `${name} offered an unlabelled route`,
      );
    }
  });

  it('offers search on every refusal, and a way back once focused', () => {
    const document = documentOf({ components: [GRAPH_NODE_BUDGET + 1] });
    const open = scaleLadder(document);
    assert.ok(open.refusal?.routes.some((route) => route.kind === 'search'));
    assert.equal(open.refusal?.routes.some((route) => route.kind === 'clear-focus'), false);

    const focused = scaleLadder(document, { ...INITIAL_SCALE_STATE, focus: componentKey(0, 1) });
    assert.ok(focused.refusal?.routes.some((route) => route.kind === 'clear-focus'));
  });

  it('never refuses on the direct tier', () => {
    const ladder = scaleLadder(relatedDocument(GRAPH_NODE_BUDGET));
    assert.equal(ladder.refusal, null);
    assert.equal(ladder.search, null);
  });

  it('says the order list is unaffected, because narrowing the canvas is not narrowing the order', () => {
    const refusal = scaleLadder(relatedDocument(GRAPH_NODE_BUDGET + 1)).refusal;
    assert.ok(refusal?.routes.some((route) => route.kind === 'order-rail'));
  });
});

describe('the isolated chip', () => {
  it('counts issues with no relationship, which is NOT the viewer\'s own isolated set', () => {
    // Every issue here holds an order position, which is what empties
    // `NormalizedDocument.isolated` — the field means "in no slot AND on no
    // edge". Reusing it would report 0 beside 30 relationship-free issues.
    const document = documentOf({ components: [4], isolated: 30 });
    const ladder = scaleLadder(document);
    assert.equal(ladder.isolated.count, 30);
    assert.match(ladder.isolated.label, /30 isolated issues/);
  });

  it('is singular for one, and carries nothing until it is opened', () => {
    const document = documentOf({ components: [4], isolated: 1 });
    const closed = scaleLadder(document);
    assert.match(closed.isolated.label, /1 isolated issue,/);
    assert.equal(closed.isolated.open, false);
    assert.deepEqual([...closed.isolated.issues], []);

    const opened = scaleLadder(document, { ...INITIAL_SCALE_STATE, isolatedOpen: true });
    assert.equal(opened.isolated.open, true);
    assert.deepEqual([...opened.isolated.issues].map((issue) => issue.key), [isolatedKey(1)]);
  });

  it('keeps isolated issues off the canvas', () => {
    const document = documentOf({ components: [4], isolated: 30 });
    const canvasKeys = scaleLadder(document).canvas.issues.map((issue) => issue.key);
    assert.equal(canvasKeys.length, 4);
    assert.equal(canvasKeys.includes(isolatedKey(1)), false);
  });
});

describe('search-to-focus', () => {
  const searchable = documentOf({
    components: componentsSumming(CLUSTER_ONLY_BUDGET + 1, 5),
    isolated: 3,
    titles: { [componentKey(0, 2)]: 'Backfill the ledger' },
  });

  it('is available above the cluster-only budget, where capsules alone cannot lead', () => {
    const ladder = scaleLadder(searchable);
    assert.equal(ladder.tier, 'clusters');
    assert.ok(ladder.search !== null);
  });

  it('matches on title and on key, and hands back a lead that focuses', () => {
    const ladder = scaleLadder(searchable, { ...INITIAL_SCALE_STATE, query: 'backfill the' });
    const match = ladder.search?.matches[0];
    assert.ok(match !== undefined);
    assert.equal(match.key, componentKey(0, 2));

    const focused = scaleLadder(searchable, { ...INITIAL_SCALE_STATE, focus: match.lead });
    assert.equal(focused.tier, 'direct');
    assert.ok(focused.canvas.issues.some((issue) => issue.key === match.key));

    const byKey = scaleLadder(searchable, { ...INITIAL_SCALE_STATE, query: componentKey(0, 2) });
    assert.ok(byKey.search?.matches.some((found) => found.key === componentKey(0, 2)));
  });

  it('never offers an isolated issue, because there is no component to focus', () => {
    const ladder = scaleLadder(searchable, { ...INITIAL_SCALE_STATE, query: 'iso-' });
    assert.deepEqual([...(ladder.search?.matches ?? [])], []);
  });

  it('caps the list and says how many it left out', () => {
    const ladder = scaleLadder(searchable, { ...INITIAL_SCALE_STATE, query: 'issue c' });
    assert.equal(ladder.search?.matches.length, 20);
    assert.ok((ladder.search?.omitted ?? 0) > 0);
  });

  it('finds nothing for an empty query rather than everything', () => {
    const ladder = scaleLadder(searchable, { ...INITIAL_SCALE_STATE, query: '   ' });
    assert.deepEqual([...(ladder.search?.matches ?? [])], []);
    assert.equal(ladder.search?.omitted, 0);
  });
});

describe('narrowing', () => {
  it('keeps the focused component\'s edges and order positions, and drops the rest', () => {
    const document = documentOf({ components: [40, 30] });
    const ladder = scaleLadder(document, { ...INITIAL_SCALE_STATE, focus: componentKey(1, 1) });
    const keys = new Set(ladder.canvas.issues.map((issue) => issue.key));
    assert.equal(keys.size, 30);
    assert.ok(ladder.canvas.edges.every((edge) => keys.has(edge.from) && keys.has(edge.to)));
    assert.ok(
      ladder.canvas.order.slots.every((slot) => slot.members.every((member) => keys.has(member))),
    );
    assert.equal(ladder.canvas.order.slots.length, 30);
  });

  it('reports a focus this document places in no component instead of quietly widening', () => {
    // A stale focus — the issue closed, or the document changed underneath the
    // reader — must not render as an unfocused canvas that still claims a
    // focus. An absence rendered as a value licenses exactly that conclusion.
    const document = documentOf({ components: [4] });
    const ladder = scaleLadder(document, { ...INITIAL_SCALE_STATE, focus: 'gone-99' });
    assert.equal(ladder.focus, null);
    assert.equal(ladder.nodeCount, 4);
    assert.ok(ladder.diagnostics.some((line) => line.includes('gone-99')));
  });

  it('carries the viewer\'s own diagnostics through', () => {
    const document = documentOf({ components: [4] });
    const withDangling = {
      ...document,
      edges: [...document.edges, { field: 'blocked-by', from: componentKey(0, 1), to: 'nope' } as const],
    };
    assert.ok(scaleLadder(withDangling).diagnostics.some((line) => line.includes('nope')));
  });
});
