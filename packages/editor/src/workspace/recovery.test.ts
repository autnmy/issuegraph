import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type EdgeKind,
  type GraphDocument,
  type StoredIssue,
  edgeId,
  makeEdge,
} from '@issuegraph/store';

import { conflictDiff, diffIsEmpty, diffWithin } from './recovery.ts';

const issue = (ref: string, over: Partial<StoredIssue> = {}): StoredIssue => ({
  ref,
  title: `issue ${ref}`,
  state: 'open',
  ...over,
});

// TYPED AT THE TUPLE, so the fixture needs no cast — the repository bans them,
// and `as never` here would also let a typo for a kind through silently.
const documentOf = (
  issues: readonly StoredIssue[],
  edges: readonly (readonly [EdgeKind, string, string])[],
): GraphDocument => ({
  issues,
  edges: edges.map(([kind, from, to]) => makeEdge(kind, from, to)),
});

describe('conflictDiff holds the two sides apart', () => {
  it('reconstructs the reader’s own edit, which the landed document cannot carry', () => {
    // THE POINT OF THE WHOLE FUNCTION. `landed` is what the source CONFIRMED,
    // and the write ledger's founding rule is that a failed write is marked and
    // never reverted — so the conflicting edit is nowhere in it. A card built
    // by reading `landed` would show the reader everything except the one
    // relationship they are being asked to resolve.
    const landed = documentOf([issue('a'), issue('b')], []);
    const upstream = documentOf([issue('a'), issue('b')], []);

    const diff = conflictDiff(landed, upstream, {
      op: 'create',
      kind: 'blocked-by',
      from: 'a',
      to: 'b',
      mutationId: 'm1',
    });

    assert.deepEqual(
      diff.mineOnly.map((edge) => edge.id),
      [edgeId('blocked-by', 'a', 'b')],
    );
  });

  it('reports what moved upstream, and not the reader’s own edge', () => {
    const landed = documentOf([issue('a'), issue('b'), issue('c')], []);
    const upstream = documentOf(
      [issue('a'), issue('b'), issue('c')],
      [['blocked-by', 'b', 'c']],
    );

    const diff = conflictDiff(landed, upstream, {
      op: 'create',
      kind: 'blocked-by',
      from: 'a',
      to: 'b',
      mutationId: 'm1',
    });

    assert.deepEqual(
      diff.upstreamOnly.map((edge) => edge.id),
      [edgeId('blocked-by', 'b', 'c')],
    );
    assert.deepEqual(
      diff.mineOnly.map((edge) => edge.id),
      [edgeId('blocked-by', 'a', 'b')],
    );
  });

  it('says upstream got there first when it already holds the reader’s edge', () => {
    // `mineOnly` is EMPTY and `upstreamOnly` HOLDS THE EDGE, and that pair is
    // the honest reading: somebody else added the relationship the reader was
    // adding. Reporting it on neither side would leave the card blank on a
    // conflict that is entirely explicable, and reporting it on both would ask
    // the reader to resolve a disagreement that does not exist.
    const landed = documentOf([issue('a'), issue('b')], []);
    const upstream = documentOf([issue('a'), issue('b')], [['blocked-by', 'a', 'b']]);

    const diff = conflictDiff(landed, upstream, {
      op: 'create',
      kind: 'blocked-by',
      from: 'a',
      to: 'b',
      mutationId: 'm1',
    });

    assert.deepEqual(diff.mineOnly, [], 'the reader’s side is not a difference');
    assert.deepEqual(
      diff.upstreamOnly.map((edge) => edge.id),
      [edgeId('blocked-by', 'a', 'b')],
    );
  });

  it('does not report a symmetric edge written the other way round as a difference', () => {
    // `edgeId` SORTS A SYMMETRIC FIELD'S ENDPOINTS, so these two spellings are
    // ONE identity. A field-by-field compare of `{kind, from, to}` would report
    // a difference here and the card would invent an upstream change nobody
    // made. This is the property that makes `edge.id` the right key — NOT any
    // claim about how a reference is spelled, which `edgeId` deliberately keeps
    // distinct.
    assert.equal(
      edgeId('serialize-with', 'a', 'b'),
      edgeId('serialize-with', 'b', 'a'),
      'the fixture assumes a symmetric field',
    );
    const landed = documentOf([issue('a'), issue('b')], [['serialize-with', 'a', 'b']]);
    const upstream = documentOf([issue('a'), issue('b')], [['serialize-with', 'b', 'a']]);

    const diff = conflictDiff(landed, upstream, {
      op: 'create',
      kind: 'blocked-by',
      from: 'a',
      to: 'b',
      mutationId: 'm1',
    });

    assert.deepEqual(diff.upstreamOnly, []);
  });

  it('keeps two distinct spellings of a reference distinct', () => {
    // The other half of the same rule, pinned so nobody "fixes" the identity to
    // fold encodings together: two distinct references must not collide.
    assert.notEqual(
      edgeId('blocked-by', 'owner/repo#9', 'x'),
      edgeId('blocked-by', 'owner%2Frepo%239', 'x'),
    );
  });
});

describe('conflictDiff answers §17b’s stated cause: the body changed upstream', () => {
  it('reports a title that moved, which no edge difference could show', () => {
    // SPEC §17b's conflict is "body changed upstream". The store carries issues
    // on the held document precisely so this is not lost, and an edges-only
    // diff would come back empty for the commonest conflict there is — and the
    // card would then say "upstream changed elsewhere", which is false.
    const landed = documentOf([issue('a'), issue('b')], []);
    const upstream = documentOf([issue('a', { title: 'renamed upstream' }), issue('b')], []);

    const diff = conflictDiff(landed, upstream, {
      op: 'create',
      kind: 'blocked-by',
      from: 'a',
      to: 'b',
      mutationId: 'm1',
    });

    assert.deepEqual(diff.issuesChanged, [
      { ref: 'a', mine: issue('a'), upstream: issue('a', { title: 'renamed upstream' }) },
    ]);
  });

  it('reports a state change and an issue that only one side holds', () => {
    const landed = documentOf([issue('a'), issue('gone')], []);
    const upstream = documentOf([issue('a', { state: 'closed' }), issue('new')], []);

    const diff = conflictDiff(landed, upstream, {
      op: 'delete',
      edgeId: 'nothing',
      mutationId: 'm1',
    });

    const byRef = new Map(diff.issuesChanged.map((change) => [change.ref, change]));
    assert.equal(byRef.get('a')?.upstream?.state, 'closed');
    assert.equal(byRef.get('gone')?.upstream, null, 'an issue upstream dropped');
    assert.equal(byRef.get('new')?.mine, null, 'an issue upstream added');
  });

  it('says nothing about an issue both sides agree on', () => {
    const landed = documentOf([issue('a')], []);
    const upstream = documentOf([issue('a')], []);
    const diff = conflictDiff(landed, upstream, {
      op: 'delete',
      edgeId: 'nothing',
      mutationId: 'm1',
    });
    assert.deepEqual(diff.issuesChanged, []);
    assert.equal(diffIsEmpty(diff), true);
  });
});

describe('diffWithin narrows to what a panel may state', () => {
  it('keeps a partner’s edge when the panel speaks for the whole together unit', () => {
    // THE CASE A SINGLE CARRIER WOULD LOSE. `panelScope` entitles an issue
    // panel by its own key AND every together-unit partner canonicalized onto
    // it, so the lead's panel is the one allowed to state a partner's conflict.
    // Narrowing by the lead's key alone would drop the partner's edge from the
    // only panel entitled to draw it — and the card would show an empty diff
    // beside a conflict that is entirely about that edge.
    const landed = documentOf([issue('lead'), issue('partner'), issue('far')], []);
    const upstream = documentOf(
      [issue('lead'), issue('partner'), issue('far')],
      [
        ['blocked-by', 'partner', 'far'],
        ['blocked-by', 'far', 'far2'],
      ],
    );
    const diff = conflictDiff(landed, upstream, {
      op: 'delete',
      edgeId: 'nothing',
      mutationId: 'm1',
    });

    const unit = diffWithin(diff, new Set(['lead', 'partner']));
    assert.deepEqual(
      unit.upstreamOnly.map((edge) => edge.id),
      [edgeId('blocked-by', 'partner', 'far')],
    );

    const leadOnly = diffWithin(diff, new Set(['lead']));
    assert.deepEqual(leadOnly.upstreamOnly, [], 'the fixture would pass under either rule');
  });

  it('keeps an issue change only for an issue in the set', () => {
    const landed = documentOf([issue('a'), issue('b')], []);
    const upstream = documentOf([issue('a', { title: 'moved' }), issue('b', { title: 'moved' })], []);
    const diff = conflictDiff(landed, upstream, {
      op: 'delete',
      edgeId: 'nothing',
      mutationId: 'm1',
    });

    assert.deepEqual(
      diffWithin(diff, new Set(['a'])).issuesChanged.map((change) => change.ref),
      ['a'],
    );
  });

  it('narrowing to nothing is empty, and says so', () => {
    const landed = documentOf([issue('a')], []);
    const upstream = documentOf([issue('a', { title: 'moved' })], []);
    const diff = conflictDiff(landed, upstream, {
      op: 'delete',
      edgeId: 'nothing',
      mutationId: 'm1',
    });
    assert.equal(diffIsEmpty(diff), false);
    assert.equal(diffIsEmpty(diffWithin(diff, new Set(['elsewhere']))), true);
  });
});

describe('a difference that removes, and one that only turns around', () => {
  it('reports a conflicted DELETE as a removal rather than as nothing at all', () => {
    // MEASURED BEFORE THE FIX: this diff was wholly empty, so the card rendered
    // `diffEmpty` — some form of "the change upstream was elsewhere" — which is
    // a FALSE STATEMENT on this input. `drawn` is empty for a delete by design
    // and `upstreamOnly` is empty because both sides still hold the edge, so
    // neither of the original two sides could ever carry it.
    const landed = documentOf([issue('a'), issue('b')], [['blocked-by', 'a', 'b']]);
    const upstream = documentOf([issue('a'), issue('b')], [['blocked-by', 'a', 'b']]);

    const diff = conflictDiff(landed, upstream, {
      op: 'delete',
      edgeId: edgeId('blocked-by', 'a', 'b'),
      mutationId: 'm1',
    });

    assert.deepEqual(
      diff.mineRemoved.map((edge) => edge.id),
      [edgeId('blocked-by', 'a', 'b')],
    );
    assert.equal(diffIsEmpty(diff), false, 'a conflicted delete claimed nothing differs');
  });

  it('reports a retype as removing the edge it replaces', () => {
    const landed = documentOf([issue('a'), issue('b')], [['blocked-by', 'a', 'b']]);
    const upstream = documentOf([issue('a'), issue('b')], [['blocked-by', 'a', 'b']]);

    const diff = conflictDiff(landed, upstream, {
      op: 'retype',
      edgeId: edgeId('blocked-by', 'a', 'b'),
      nextKind: 'duplicate-of',
      mutationId: 'm1',
    });

    assert.deepEqual(
      diff.mineRemoved.map((edge) => edge.id),
      [edgeId('blocked-by', 'a', 'b')],
    );
    assert.deepEqual(
      diff.mineOnly.map((edge) => edge.id),
      [edgeId('duplicate-of', 'a', 'b')],
    );
  });

  it('sees a symmetric relationship whose declaring end moved upstream', () => {
    // `edgeId` SORTS SYMMETRIC ENDPOINTS, so these are ONE identity and a join
    // on the id alone reads "nothing changed". `sameEdgeSet` in the store spells
    // out the cost: "a rehydrate that reverses the carrier reads as 'nothing
    // changed' — after which a retype writes the OPPOSITE direction, which §17b
    // names as the most common encoding mistake there is."
    const landed = documentOf([issue('a'), issue('b')], [['serialize-with', 'a', 'b']]);
    const upstream = documentOf([issue('a'), issue('b')], [['serialize-with', 'b', 'a']]);

    const diff = conflictDiff(landed, upstream, {
      op: 'delete',
      edgeId: 'nothing',
      mutationId: 'm1',
    });

    assert.deepEqual(diff.upstreamOnly, [], 'the identity join still holds');
    assert.equal(diff.carrierReversed.length, 1);
    assert.equal(diff.carrierReversed[0]?.mine.from, 'a');
    assert.equal(diff.carrierReversed[0]?.upstream.from, 'b');
    assert.equal(diffIsEmpty(diff), false);
  });

  it('narrows both new sides with the rest', () => {
    const landed = documentOf([issue('a'), issue('b')], [['blocked-by', 'a', 'b']]);
    const upstream = documentOf([issue('a'), issue('b')], [['blocked-by', 'a', 'b']]);
    const diff = conflictDiff(landed, upstream, {
      op: 'delete',
      edgeId: edgeId('blocked-by', 'a', 'b'),
      mutationId: 'm1',
    });
    assert.equal(diffIsEmpty(diffWithin(diff, new Set(['a']))), false);
    assert.equal(diffIsEmpty(diffWithin(diff, new Set(['elsewhere']))), true);
  });
});
