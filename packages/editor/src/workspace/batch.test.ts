/**
 * The batch Inspector's ask (#249), with no DOM: which writes each offer plans,
 * what the confirm counts, and where the reader is after each command.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GraphDocument } from '@issuegraph/store';

import { IDLE_BATCH, activeMatch, batchControlled, offerPlan, offerRefusals } from './batch.ts';
import { INITIAL_HOST_STATE, reduceHost } from './host.ts';

const SET = ['a', 'b', 'c'] as const;

describe('each offer maps to planBatch (#249)', () => {
  it('serializes a set of 3 as a star from the first issue added: 2 writes, each member pointing at it', () => {
    const outcome = offerPlan('serialize', SET);
    if (!outcome.ok) throw new Error('the plan refused a set of 3');
    assert.equal(outcome.plan.count, 2);
    assert.deepEqual(outcome.plan.proposals, [
      { op: 'create', kind: 'serialize-with', from: 'b', to: 'a' },
      { op: 'create', kind: 'serialize-with', from: 'c', to: 'a' },
    ]);
  });

  it('makes a set of 3 one unit the same way, as together-with', () => {
    const outcome = offerPlan('unit', SET);
    if (!outcome.ok) throw new Error('the plan refused a set of 3');
    assert.deepEqual(
      outcome.plan.proposals.map((proposal) => (proposal.op === 'create' ? [proposal.kind, proposal.from, proposal.to] : [])),
      [
        ['together-with', 'b', 'a'],
        ['together-with', 'c', 'a'],
      ],
    );
  });

  it('blocks all 3 by the one issue: 3 writes, each member carrying blocked-by', () => {
    const outcome = offerPlan('blocked-by', SET, 'z');
    if (!outcome.ok) throw new Error('the plan refused a set of 3');
    assert.equal(outcome.plan.count, 3);
    assert.deepEqual(
      outcome.plan.proposals.map((proposal) => (proposal.op === 'create' ? [proposal.kind, proposal.from, proposal.to] : [])),
      [
        ['blocked-by', 'a', 'z'],
        ['blocked-by', 'b', 'z'],
        ['blocked-by', 'c', 'z'],
      ],
    );
  });

  it('leaves the one issue out of the members when it is in the set, so no issue is blocked by itself', () => {
    const outcome = offerPlan('blocked-by', SET, 'b');
    if (!outcome.ok) throw new Error('the plan refused');
    assert.equal(outcome.plan.count, 2);
  });

  it('reports the plan’s refusal for an offer it refuses, and none for a set of 2 or more', () => {
    assert.deepEqual([...offerRefusals(SET).keys()], []);
    // A set of one: the symmetric offers have no member to write an edge to.
    assert.deepEqual(
      [...offerRefusals(['a'])].map(([offer, refusal]) => [offer, refusal.reason]),
      [
        ['serialize', 'no-members'],
        ['unit', 'no-members'],
      ],
    );
  });
});

describe('the ask, step by step (#249)', () => {
  it('confirms a symmetric offer straight away, with the plan whose count the dialog states', () => {
    const step = batchControlled(IDLE_BATCH, 'batch-offer', undefined, 'serialize', SET);
    assert.equal(step?.send, null);
    assert.equal(step?.batch.step, 'confirm');
    assert.equal(step?.batch.step === 'confirm' ? step.batch.plan.count : -1, 2);
  });

  it('asks for the one issue first for "blocked by", keeps the query, and confirms on a pick', () => {
    const asking = batchControlled(IDLE_BATCH, 'batch-offer', undefined, 'blocked-by', SET);
    assert.deepEqual(asking?.batch, { step: 'target', query: '', active: 0 });
    const typed = batchControlled(asking?.batch ?? IDLE_BATCH, 'batch-query', undefined, 'rel', SET);
    assert.deepEqual(typed?.batch, { step: 'target', query: 'rel', active: 0 });
    const moved = batchControlled(typed?.batch ?? IDLE_BATCH, 'batch-move', undefined, 'down', SET);
    assert.deepEqual(moved?.batch, { step: 'target', query: 'rel', active: 1 });
    const picked = batchControlled(typed?.batch ?? IDLE_BATCH, 'batch-target', 'z', undefined, SET);
    assert.equal(picked?.batch.step === 'confirm' ? picked.batch.plan.count : -1, 3);
  });

  it('sends the plan on confirm and goes idle; Cancel goes idle and sends nothing', () => {
    const confirming = batchControlled(IDLE_BATCH, 'batch-offer', undefined, 'unit', SET)?.batch ?? IDLE_BATCH;
    const sent = batchControlled(confirming, 'batch-confirm', undefined, undefined, SET);
    assert.equal(sent?.batch, IDLE_BATCH);
    assert.equal(sent?.send?.count, 2);
    const cancelled = batchControlled(confirming, 'batch-cancel', undefined, undefined, SET);
    assert.deepEqual(cancelled, { batch: IDLE_BATCH, send: null });
  });

  it('confirms nothing that is not being confirmed, and picks nothing outside the search', () => {
    assert.deepEqual(batchControlled(IDLE_BATCH, 'batch-confirm', undefined, undefined, SET), { batch: IDLE_BATCH, send: null });
    assert.deepEqual(batchControlled(IDLE_BATCH, 'batch-target', 'z', undefined, SET), { batch: IDLE_BATCH, send: null });
    assert.deepEqual(batchControlled(IDLE_BATCH, 'batch-offer', undefined, 'retype', SET), { batch: IDLE_BATCH, send: null });
  });

  it('wraps the highlighted match over the matches, either way', () => {
    assert.deepEqual([activeMatch(0, 3), activeMatch(3, 3), activeMatch(-1, 3), activeMatch(5, 0)], [0, 0, 2, -1]);
  });

  it('has no batch to ask about under two issues, and is not asked about other commands', () => {
    assert.deepEqual(batchControlled(IDLE_BATCH, 'batch-offer', undefined, 'serialize', ['a']), { batch: IDLE_BATCH, send: null });
    assert.equal(batchControlled(IDLE_BATCH, 'clear', undefined, undefined, SET), null);
  });
});

describe('the host reducer sends a confirmed batch as one effect (#249)', () => {
  const document: GraphDocument = {
    issues: ['a', 'b', 'c', 'd'].map((ref) => ({ ref, title: `Issue ${ref}`, state: 'open' as const })),
    edges: [],
  };
  const onSet = { ...INITIAL_HOST_STATE, selection: { kind: 'issues' as const, keys: ['a', 'b', 'c'] } };

  it('emits batch-propose with each proposal’s carrier, and goes idle', () => {
    const asked = reduceHost(onSet, { kind: 'control', name: 'batch-offer', value: 'serialize' }, document);
    assert.equal(asked.state.batch.step, 'confirm');
    const sent = reduceHost(asked.state, { kind: 'control', name: 'batch-confirm' }, document);
    assert.equal(sent.state.batch.step, 'idle');
    assert.deepEqual(
      sent.effects.map((effect) => (effect.kind === 'batch-propose' ? [effect.plan.count, effect.carriers] : effect.kind)),
      [[2, ['b', 'c']]],
    );
  });

  it('drops the ask when the selection moves, since it was about the set', () => {
    const asked = reduceHost(onSet, { kind: 'control', name: 'batch-offer', value: 'blocked-by' }, document);
    assert.equal(asked.state.batch.step, 'target');
    const moved = reduceHost(asked.state, { kind: 'point', key: 'd' }, document);
    assert.equal(moved.state.batch.step, 'idle');
  });

  it('hands Retry and Discard to the shell, which holds the batch', () => {
    assert.deepEqual(reduceHost(onSet, { kind: 'control', name: 'batch-retry' }, document).effects, [{ kind: 'batch-retry' }]);
    assert.deepEqual(reduceHost(onSet, { kind: 'control', name: 'batch-discard' }, document).effects, [{ kind: 'batch-discard' }]);
  });
});
