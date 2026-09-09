import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Proposal } from '@issuegraph/store';

import type { BatchSettlement } from '../firstpass/batch.ts';
import { bulkAfterSelectionChange } from './host.ts';
import {
  type BulkOffer,
  phaseMembers,
  staleAgainst,
  type BulkState,
  BULK_OFFERS,
  INITIAL_BULK,
  bulkReducer,
  offerFor,
  resumeSend,
  sendBatch,
} from './bulk.ts';

const SERIALIZE = BULK_OFFERS[0] as BulkOffer;
const TOGETHER = BULK_OFFERS[1] as BulkOffer;
const BLOCKED = BULK_OFFERS[2] as BulkOffer;

const SIX = Object.freeze(['901', '902', '903', '904', '905', '906']);

function chosen(offer: BulkOffer, target: string | null = null): BulkState {
  const picked = bulkReducer(INITIAL_BULK, { kind: 'choose-offer', offer }).state;
  return target === null ? picked : bulkReducer(picked, { kind: 'set-target', target }).state;
}

function planned(offer: BulkOffer, members: readonly string[], target: string | null = null): BulkState {
  return bulkReducer(chosen(offer, target), { kind: 'confirm', members }).state;
}

describe('§17e: the three offers reach planBatch', () => {
  it('names exactly the three §17e draws, and nothing self-extends into it', () => {
    // THE SET IS FIXED ON PURPOSE. `duplicate-of` and `decomposed-from` are the
    // kinds SPEC refuses to put on a one-keystroke bulk path — "a wrong
    // `duplicate-of` silently removes real work from the order" — so a list
    // that grew a row whenever core learned a field would be a feature, not a
    // safeguard. This is the pin that would fail if someone derived it.
    assert.deepEqual(
      BULK_OFFERS.map((offer) => offer.kind),
      ['serialize-with', 'together-with', 'blocked-by'],
    );
    assert.equal(offerFor('duplicate-of'), undefined);
    assert.equal(offerFor('decomposed-from'), undefined);
  });

  it('anchors a symmetric star INSIDE the selection, so six issues are five writes', () => {
    // §17e's frame reads "6 issues = 6 writes", which is exact for the DIRECTED
    // offer — six members all pointing at a seventh target. A symmetric star
    // has to be centred on a member, because `serialize-with` and
    // `together-with` are single-valued and the only star the format can hold
    // is every member pointing at one existing member.
    const state = planned(SERIALIZE, SIX);
    assert.equal(state.phase.kind, 'planned');
    if (state.phase.kind !== 'planned') return;
    assert.equal(state.phase.plan.count, 5);
    assert.equal(state.phase.plan.anchor, '901');
    // THE ANCHOR IS NOT AN ARM OF ITS OWN STAR. Left in, `planBatch` would
    // build an edge from the anchor to itself, which the store then refuses one
    // arm at a time after the other four have already gone out.
    assert.equal(
      state.phase.plan.proposals.some(
        (proposal) => proposal.op === 'create' && proposal.from === proposal.to,
      ),
      false,
    );
  });

  it('builds the directed star against a LITERAL, not against planBatch as its own oracle', () => {
    // ASSERTED AGAINST THE EDGES THEMSELVES. Comparing this to `planBatch`'s
    // answer for the same request would pass however the block built the
    // request, which is the half this test exists to check.
    const state = planned(BLOCKED, SIX, '700');
    assert.equal(state.phase.kind, 'planned');
    if (state.phase.kind !== 'planned') return;
    const expected: readonly Proposal[] = SIX.map((member) => ({
      op: 'create',
      kind: 'blocked-by',
      from: member,
      to: '700',
    }));
    assert.deepEqual(state.phase.plan.proposals, expected);
    // SIX ISSUES, SIX WRITES — the frame's own arithmetic, on the one offer it
    // is exact for.
    assert.equal(state.phase.plan.count, 6);
  });

  it('ships all six as one unit through together-with', () => {
    const state = planned(TOGETHER, SIX);
    assert.equal(state.phase.kind, 'planned');
    if (state.phase.kind !== 'planned') return;
    assert.equal(state.phase.plan.kind, 'together-with');
    assert.equal(state.phase.plan.count, 5);
  });

  it('waits for the directed offer\'s target rather than refusing without it', () => {
    // A MISSING TARGET IS A STEP NOT TAKEN, not a refusal. Refusing here would
    // report `direction-required` — a contract violation — for a reader who has
    // simply not typed yet.
    const state = bulkReducer(chosen(BLOCKED), { kind: 'confirm', members: SIX }).state;
    assert.equal(state.phase.kind, 'offering');
  });
});

describe('§17e: a refusal is drawn, not thrown', () => {
  it('answers no-members as a value when the selection collapses to one issue', () => {
    // THE ONE REFUSAL THIS BLOCK CAN CONSTRUCT. A symmetric star takes its
    // anchor out of the members, so a selection of exactly one leaves nothing
    // to write — which is what a set of two `together-with` partners
    // canonicalizes down to.
    const state = planned(SERIALIZE, ['901']);
    assert.equal(state.phase.kind, 'refused');
    if (state.phase.kind !== 'refused') return;
    assert.equal(state.phase.refusal.reason, 'no-members');
  });

  it('keeps the target search open after a refusal, so a typo is fixed in place', () => {
    const refused = planned(SERIALIZE, ['901']);
    const retyped = bulkReducer(refused, { kind: 'set-target', target: '700' }).state;
    assert.equal(retyped.phase.kind, 'offering');
  });

  it('throws for no input at all', () => {
    for (const offer of BULK_OFFERS) {
      assert.doesNotThrow(() => planned(offer, []));
      assert.doesNotThrow(() => planned(offer, SIX, '700'));
    }
  });
});

describe('§17e: the batch is resumable if some fail', () => {
  function writing(): { readonly state: BulkState; readonly proposals: readonly Proposal[] } {
    const sent = sendBatch(planned(BLOCKED, SIX, '700'));
    return { state: sent.state, proposals: sent.proposals };
  }

  it('sends every proposal exactly once, and only from `planned`', () => {
    const { state, proposals } = writing();
    assert.equal(state.phase.kind, 'writing');
    assert.equal(proposals.length, 6);
    // A SECOND SEND FROM `writing` EMITS NOTHING, which is what stops a double
    // write when a control outlives the state that drew it by one render.
    assert.deepEqual(sendBatch(state).proposals, []);
  });

  it('offers resumeBatch\'s remainder, asserted against a literal', () => {
    const { state, proposals } = writing();
    const settlements: readonly BatchSettlement[] = proposals
      .slice(0, 4)
      .map((proposal) => ({ proposal, settled: 'landed' as const }));
    const settled = bulkReducer(state, { kind: 'settle', settlements }).state;
    assert.equal(settled.phase.kind, 'partial');
    if (settled.phase.kind !== 'partial') return;
    assert.deepEqual(settled.phase.remainder.proposals, proposals.slice(4));
    assert.equal(settled.phase.remainder.count, 2);
  });

  it('keeps an UNMENTIONED proposal owed, which is the fail-safe direction', () => {
    // `batch.ts`'s stated rule: re-offering a landed write costs one refusal
    // from the store's duplicate rule; dropping an unlanded one loses a
    // relationship silently and nothing downstream would ever surface it.
    const { state, proposals } = writing();
    const settled = bulkReducer(state, {
      kind: 'settle',
      settlements: [{ proposal: proposals[0] as Proposal, settled: 'landed' }],
    }).state;
    assert.equal(settled.phase.kind, 'partial');
    if (settled.phase.kind !== 'partial') return;
    assert.equal(settled.phase.remainder.count, 5);
  });

  it('lands, and `landed` is its own phase rather than a return to idle', () => {
    // Returning a successful six-write confirm to the screen the reader started
    // from gives them no way to tell the write happened, and re-offering the
    // same button is the one thing a bulk write must not do.
    const { state, proposals } = writing();
    const settlements: readonly BatchSettlement[] = proposals.map((proposal) => ({
      proposal,
      settled: 'landed' as const,
    }));
    const settled = bulkReducer(state, { kind: 'settle', settlements }).state;
    assert.equal(settled.phase.kind, 'landed');
    if (settled.phase.kind !== 'landed') return;
    assert.equal(settled.phase.writes, 6);
  });

  it('narrows again on a second partial failure rather than re-sending the original', () => {
    const { state, proposals } = writing();
    const first = bulkReducer(state, {
      kind: 'settle',
      settlements: proposals.slice(0, 4).map((proposal) => ({ proposal, settled: 'landed' as const })),
    }).state;
    const resumed = resumeSend(first);
    assert.equal(resumed.proposals.length, 2);
    const second = bulkReducer(resumed.state, {
      kind: 'settle',
      settlements: [{ proposal: proposals[4] as Proposal, settled: 'landed' }],
    }).state;
    assert.equal(second.phase.kind, 'partial');
    if (second.phase.kind !== 'partial') return;
    assert.equal(second.phase.remainder.count, 1);
  });

  it('lets a permanently-refused remainder be dismissed', () => {
    // `resumeBatch` keeps every proposal it was not TOLD landed, so a member
    // the store will refuse for ever produces the identical remainder on every
    // retry. Without this exit the block would offer that resume for ever.
    const { state, proposals } = writing();
    const stuck = bulkReducer(state, {
      kind: 'settle',
      settlements: proposals.map((proposal) => ({ proposal, settled: 'failed' as const })),
    }).state;
    assert.equal(stuck.phase.kind, 'partial');
    assert.equal(bulkReducer(stuck, { kind: 'dismiss' }).state.phase.kind, 'idle');
  });
});

describe('§17e: the reducer is total', () => {
  it('leaves a phase alone for a command that does not belong to it', () => {
    // A control can outlive the state that drew it by one render, and a reducer
    // is not the place to adjudicate that.
    const idle = INITIAL_BULK;
    assert.equal(bulkReducer(idle, { kind: 'confirm', members: SIX }).state.phase.kind, 'idle');
    assert.equal(bulkReducer(idle, { kind: 'settle', settlements: [] }).state.phase.kind, 'idle');
    assert.deepEqual(sendBatch(idle).proposals, []);
    assert.deepEqual(resumeSend(idle).proposals, []);
  });

  it('emits no proposals from any command but a send', () => {
    // A caller that dispatches `result.proposals` unconditionally must never be
    // handed a partial batch.
    const states = [INITIAL_BULK, chosen(SERIALIZE), planned(SERIALIZE, SIX)];
    for (const state of states) {
      for (const command of [
        { kind: 'choose-offer', offer: TOGETHER } as const,
        { kind: 'set-target', target: '700' } as const,
        { kind: 'confirm', members: SIX } as const,
        { kind: 'dismiss' } as const,
      ]) {
        assert.deepEqual(bulkReducer(state, command).proposals, []);
      }
    }
  });
});

describe('§17e: a stale offer cannot outlive the selection it was chosen for', () => {
  it('drops an unsent offer, plan or refusal when the selection moves', () => {
    // THE SELECTION IS THE BATCH'S SUBJECT. Without this a reader could plan a
    // batch over six issues, add a seventh, and press send: the plan on screen
    // is the OLD membership and `BatchPlan.count` states the old number, so the
    // confirm would be lying about what it is about — the one property §17e
    // asks this surface for.
    for (const before of [INITIAL_BULK, chosen(SERIALIZE), planned(SERIALIZE, SIX), planned(SERIALIZE, ['901'])]) {
      assert.equal(bulkAfterSelectionChange(before).phase.kind, 'idle');
    }
  });

  it('keeps a phase that has already dispatched, and that asymmetry is the point', () => {
    // A selection change cannot un-send a write. Dropping a `partial` would
    // silently discard a remainder the reader is owed, which is the lost
    // relationship `batch.ts`'s fail-safe direction exists to prevent.
    const sent = sendBatch(planned(BLOCKED, SIX, '700'));
    assert.equal(bulkAfterSelectionChange(sent.state).phase.kind, 'writing');
    const partial = bulkReducer(sent.state, {
      kind: 'settle',
      settlements: [{ proposal: sent.proposals[0] as Proposal, settled: 'landed' }],
    }).state;
    assert.equal(bulkAfterSelectionChange(partial).phase.kind, 'partial');
    const landed = bulkReducer(sent.state, {
      kind: 'settle',
      settlements: sent.proposals.map((proposal) => ({ proposal, settled: 'landed' as const })),
    }).state;
    assert.equal(bulkAfterSelectionChange(landed).phase.kind, 'landed');
  });
});

describe('§17e: a target inside the selection is not an arm of its own star', () => {
  it('drops it on the directed route too, so the count is honest at plan time', () => {
    // `all blocked by #901` with #901 among the six is an ordinary thing to
    // reach for. Left in, `planBatch` builds an edge from the anchor to itself
    // and `structuralRefusal` rejects that one arm AFTER the others have gone
    // out — so the confirm would have stated six and written five.
    const state = planned(BLOCKED, SIX, '901');
    assert.equal(state.phase.kind, 'planned');
    if (state.phase.kind !== 'planned') return;
    assert.equal(state.phase.plan.count, 5);
    assert.equal(
      state.phase.plan.proposals.some(
        (proposal) => proposal.op === 'create' && proposal.from === proposal.to,
      ),
      false,
    );
  });
});

describe('§17e: a phase speaks for the set that produced it', () => {
  it('carries the membership onto every phase that has planned or sent', () => {
    const plan = planned(SERIALIZE, SIX);
    assert.deepEqual(phaseMembers(plan.phase), SIX);
    const sent = sendBatch(plan);
    assert.deepEqual(phaseMembers(sent.state.phase), SIX);
    const settled = bulkReducer(sent.state, {
      kind: 'settle',
      settlements: [{ proposal: sent.proposals[0] as Proposal, settled: 'landed' }],
    }).state;
    assert.equal(settled.phase.kind, 'partial');
    assert.deepEqual(phaseMembers(settled.phase), SIX);
    const whole = bulkReducer(sent.state, {
      kind: 'settle',
      settlements: sent.proposals.map((proposal) => ({ proposal, settled: 'landed' as const })),
    }).state;
    assert.deepEqual(phaseMembers(whole.phase), SIX);
  });

  it('answers null for a phase that has not planned yet', () => {
    assert.equal(phaseMembers(INITIAL_BULK.phase), null);
    assert.equal(phaseMembers(chosen(SERIALIZE).phase), null);
    assert.equal(phaseMembers(planned(SERIALIZE, ['901']).phase), null, 'a refusal owns no membership');
  });
});

describe('§17e: an unsent plan goes stale when its EFFECTIVE membership moves', () => {
  it('reports a plan whose canonicalized set changed under it', () => {
    // The ORDER can regroup a selected issue into a `together-with` unit between
    // planning and sending. The raw selection never moves, so nothing in the
    // reducer's own vocabulary could invalidate it — the confirm would then be
    // rendered from the new effective set while `send-batch` dispatched the old
    // plan, including a write for a member that is no longer its own issue.
    const plan = planned(SERIALIZE, SIX).phase;
    assert.equal(staleAgainst(plan, SIX), false);
    assert.equal(staleAgainst(plan, ['901', '902', '903', '904', '905']), true);
    assert.equal(staleAgainst(plan, ['906', '905', '904', '903', '902', '901']), true);
  });

  it('never calls a DISPATCHED phase stale, because it is not re-sendable', () => {
    // Those phases speak for their own membership rather than for whatever is
    // selected when they are drawn, so "does it match the screen" is not a
    // question about them.
    const sent = sendBatch(planned(SERIALIZE, SIX));
    assert.equal(staleAgainst(sent.state.phase, ['999']), false);
    assert.equal(staleAgainst(INITIAL_BULK.phase, ['999']), false);
  });
});
