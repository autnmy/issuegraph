import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_FIELDS, SYMMETRIC_EDGE_FIELDS, isSymmetricEdgeField } from '@issuegraph/core';
import type { Proposal } from '@issuegraph/store';

import { type BatchPlan, planBatch, resumeBatch } from './batch.ts';

const ANCHOR = '900';
const MEMBERS = Object.freeze(['901', '902', '903']);

/** The plan a request produces, or a failure naming the refusal instead. */
function planOf(request: Parameters<typeof planBatch>[0]): BatchPlan {
  const outcome = planBatch(request);
  if (!outcome.ok) throw new Error(`refused: ${outcome.refusal.reason}`);
  return outcome.plan;
}

describe('N issues become N writes, and the confirm states the count', () => {
  it('plans one edge per member', () => {
    const plan = planOf({ anchor: ANCHOR, members: MEMBERS, kind: 'together-with' });
    assert.equal(plan.proposals.length, 3);
    assert.equal(plan.count, 3);
  });

  it('cannot state a count that differs from what it will write', () => {
    // §17e requires the confirm to state the count. Deriving it at the render
    // site would be a second place that number lives; this asserts the one.
    for (const size of [1, 2, 7, 40]) {
      const plan = planOf({
        anchor: ANCHOR,
        members: Array.from({ length: size }, (_u, i) => String(1000 + i)),
        kind: 'serialize-with',
      });
      assert.equal(plan.count, plan.proposals.length);
      assert.equal(plan.count, size);
    }
  });

  it('touches the anchor on every edge', () => {
    const plan = planOf({ anchor: ANCHOR, members: MEMBERS, kind: 'together-with' });
    for (const proposal of plan.proposals) {
      assert.equal(proposal.op, 'create');
      assert.ok(
        proposal.op === 'create' && (proposal.from === ANCHOR || proposal.to === ANCHOR),
        'an edge that does not touch the anchor is not part of this star',
      );
    }
  });
});

describe('symmetric applies at once; directed needs one pick', () => {
  it('plans every symmetric field with no direction at all', () => {
    // Read from the FORMAT via `isSymmetricEdgeField`, so a sixth field added
    // to core is covered here the day core learns about it. Iterating
    // SYMMETRIC_EDGE_FIELDS rather than naming two keeps that true.
    for (const kind of SYMMETRIC_EDGE_FIELDS) {
      const plan = planOf({ anchor: ANCHOR, members: MEMBERS, kind });
      assert.equal(plan.count, 3, kind);
    }
  });

  it('refuses every directed field that arrives without its direction', () => {
    const directed = EDGE_FIELDS.filter((field) => !isSymmetricEdgeField(field));
    assert.ok(directed.length > 0, 'the format has no directed fields to test');
    for (const kind of directed) {
      const outcome = planBatch({ anchor: ANCHOR, members: MEMBERS, kind });
      assert.equal(outcome.ok, false, kind);
      assert.deepEqual(outcome.ok === false ? outcome.refusal : null, {
        reason: 'direction-required',
        kind,
      });
    }
  });

  it('refuses a direction on a symmetric field rather than ignoring it', () => {
    // Accepting and dropping it would let a host grow a direction control that
    // silently does nothing.
    for (const kind of SYMMETRIC_EDGE_FIELDS) {
      const outcome = planBatch({
        anchor: ANCHOR,
        members: MEMBERS,
        kind,
        direction: 'from-anchor',
      });
      assert.equal(outcome.ok, false, kind);
      assert.deepEqual(outcome.ok === false ? outcome.refusal : null, {
        reason: 'direction-not-applicable',
        kind,
      });
    }
  });

  it('points the whole batch the way the one pick said', () => {
    // The two directions are opposite facts about the same selection, which is
    // exactly why the pick is required rather than inferred.
    const away = planOf({
      anchor: ANCHOR,
      members: ['901'],
      kind: 'blocked-by',
      direction: 'from-anchor',
    });
    const toward = planOf({
      anchor: ANCHOR,
      members: ['901'],
      kind: 'blocked-by',
      direction: 'to-anchor',
    });
    assert.deepEqual(away.proposals, [
      { op: 'create', kind: 'blocked-by', from: ANCHOR, to: '901' },
    ]);
    assert.deepEqual(toward.proposals, [
      { op: 'create', kind: 'blocked-by', from: '901', to: ANCHOR },
    ]);
  });
});

describe('a request that does not name a batch is refused as a value', () => {
  it('refuses an empty selection', () => {
    const outcome = planBatch({ anchor: ANCHOR, members: [], kind: 'together-with' });
    assert.deepEqual(outcome.ok === false ? outcome.refusal : null, { reason: 'no-members' });
  });

  it('builds no partial plan when it refuses', () => {
    const outcome = planBatch({ anchor: ANCHOR, members: MEMBERS, kind: 'blocked-by' });
    assert.equal(outcome.ok, false);
    assert.equal('plan' in outcome, false);
  });
});

describe('a partially-failed batch is resumable', () => {
  const plan = planOf({ anchor: ANCHOR, members: MEMBERS, kind: 'together-with' });

  /** Settlements standing for a run where the middle write failed. */
  function settlements(failedIndexes: readonly number[]): {
    readonly proposal: Proposal;
    readonly settled: 'landed' | 'failed';
  }[] {
    return plan.proposals.map((proposal, index) => ({
      // RE-CREATED rather than passed through, so the comparison is exercised
      // structurally — which is how a settlement genuinely comes back from a
      // host, possibly across a serialization boundary.
      proposal: structuredClone(proposal),
      settled: failedIndexes.includes(index) ? 'failed' : 'landed',
    }));
  }

  it('owes exactly the writes that did not land', () => {
    const resumed = resumeBatch(plan, settlements([1]));
    assert.equal(resumed?.count, 1);
    assert.deepEqual(resumed?.proposals, [plan.proposals[1]]);
  });

  it('owes several when several failed', () => {
    const resumed = resumeBatch(plan, settlements([0, 2]));
    assert.deepEqual(resumed?.proposals, [plan.proposals[0], plan.proposals[2]]);
    assert.equal(resumed?.count, 2);
  });

  it('is `null` — not an empty plan — when everything landed', () => {
    // An empty plan would render a confirm stating a count of zero.
    assert.equal(resumeBatch(plan, settlements([])), null);
  });

  it('still owes a proposal no settlement mentions', () => {
    // The fail-safe direction: re-offering a landed write costs one refusal
    // from the store's duplicate rule, while dropping an unlanded one loses a
    // relationship with nothing downstream to surface it.
    const resumed = resumeBatch(plan, [{ proposal: plan.proposals[0]!, settled: 'landed' }]);
    assert.equal(resumed?.count, 2);
  });

  it('carries the kind and anchor through, so the resumed confirm reads the same', () => {
    const resumed = resumeBatch(plan, settlements([2]));
    assert.equal(resumed?.kind, 'together-with');
    assert.equal(resumed?.anchor, ANCHOR);
  });

  it('resumes a resumed plan, which is what a second failure needs', () => {
    const once = resumeBatch(plan, settlements([0, 2]));
    assert.ok(once !== null);
    const twice = resumeBatch(once, [{ proposal: once.proposals[0]!, settled: 'landed' }]);
    assert.deepEqual(twice?.proposals, [plan.proposals[2]]);
  });
});
