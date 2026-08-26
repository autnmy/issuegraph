import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type GraphDocument,
  type OrderRow,
  type ScriptedSource,
  type Store,
  type WriteRecord,
  createScriptedSource,
  createStore,
  nextDocument,
} from '@issuegraph/store';

import { renderPicker } from './render.ts';
import { pickerView } from './view.ts';
import { OBJECT, PICKER_WORDS, SUBJECT, documentWith, onlyEdge } from '../testing/picker.ts';

/** Rank by reference, so the store has an order without a second derivation here. */
const byRef = (document: GraphDocument): readonly OrderRow[] =>
  [...document.issues]
    .sort((left, right) => left.ref.localeCompare(right.ref))
    .map((issue, rank) => ({ ref: issue.ref, rank, ready: true, holdReasons: [] }));

async function harness(
  seed: GraphDocument,
): Promise<{ source: ScriptedSource; store: Store }> {
  const source = createScriptedSource(seed, nextDocument);
  const store = createStore({ source, derive: byRef });
  await store.hydrate();
  return { source, store };
}

/**
 * The refusal code on the one edit the store is holding.
 *
 * Narrowed rather than reached for: `WriteRecord.reason` is an `InvalidReason`
 * on a refusal and a plain string on a failure, so asking for a code without
 * establishing WHICH state produced it would read a message's characters as a
 * code on the day the two got confused.
 */
function soleRefusalCode(records: readonly WriteRecord[]): string {
  assert.equal(records.length, 1);
  const record = records[0];
  assert.ok(record !== undefined);
  if (record.state !== 'invalid') {
    throw new Error(`expected a refusal, got a ${record.state} record`);
  }
  return record.reason.code;
}

describe('the picker never touches a DataSource', () => {
  it('builds and renders the whole surface with the source untouched', async () => {
    // The structural half: `renderPicker` takes a DOCUMENT and an edge id, so
    // there is no port in scope for it to reach. This drives the whole surface
    // beside a live source and asserts the source saw nothing — which is the
    // behavioural half, and the one that would fail if a future edit here
    // reached for a store.
    const seed = documentWith('blocked-by');
    const { source } = await harness(seed);
    const edge = onlyEdge(seed);

    const before = source.pending().length;
    const result = renderPicker(seed, edge.id, { words: PICKER_WORDS });
    assert.equal(result.view.options.length, 5);
    assert.equal(source.pending().length, before);
    assert.equal(before, 0);
  });
});

describe('retype and flip each emit exactly one Proposal', () => {
  it('hands the source one dispatch for a retype, counted rather than asserted', async () => {
    const seed = documentWith('blocked-by');
    const { source, store } = await harness(seed);
    const view = pickerView(seed, onlyEdge(seed).id);

    const chosen = view.options.find((option) => option.kind === 'duplicate-of');
    assert.ok(chosen !== undefined);
    store.propose(chosen.proposal);
    await source.whenPending();

    // ONE. A retype composed as a delete plus a create would show two here,
    // which is exactly what the store's closed operation set exists to prevent
    // and what this surface must not undo.
    assert.equal(source.pending().length, 1);
    assert.equal(source.pending()[0]?.mutation.op, 'retype');
  });

  it('hands the source one dispatch for a flip', async () => {
    const seed = documentWith('blocked-by');
    const { source, store } = await harness(seed);
    const view = pickerView(seed, onlyEdge(seed).id);

    assert.ok(view.flip !== null);
    store.propose(view.flip.proposal);
    await source.whenPending();

    assert.equal(source.pending().length, 1);
    assert.equal(source.pending()[0]?.mutation.op, 'flip');
  });

  it('reverses the pair when the flip lands', async () => {
    // The proposal is one operation AND it does the thing the statement said it
    // would — a single dispatch that reversed nothing would satisfy the count
    // above and still be wrong.
    const seed = documentWith('blocked-by');
    const { source, store } = await harness(seed);
    const view = pickerView(seed, onlyEdge(seed).id);

    assert.ok(view.flip !== null);
    const handle = store.propose(view.flip.proposal);
    await source.whenPending();
    source.settleNext('applied');
    await handle.settled;

    const landed = store.getSnapshot().landed;
    assert.equal(landed.length, 1);
    assert.equal(landed[0]?.from, OBJECT);
    assert.equal(landed[0]?.to, SUBJECT);
  });
});

describe('an invalid proposal is refused before dispatch, by the STORE', () => {
  it('refuses a retype to the kind the edge already has, and dispatches nothing', async () => {
    // The picker deliberately OFFERS this option — pre-filtering it here would
    // be a second validity rule living in the editor. The refusal is the
    // store's `structuralRefusal`, and the edit never reaches the source.
    const seed = documentWith('blocked-by');
    const { source, store } = await harness(seed);
    const view = pickerView(seed, onlyEdge(seed).id);

    const current = view.options.find((option) => option.current);
    assert.ok(current !== undefined);
    assert.equal(current.kind, 'blocked-by');

    const handle = store.propose(current.proposal);
    await handle.settled;

    assert.deepEqual([...source.pending()], []);
    assert.equal(soleRefusalCode(store.getSnapshot().writes), 'unchanged-kind');
  });

  it('refuses a flip of a symmetric edge, which is why the picker offers none', async () => {
    // The picker's own answer is the absence of the control — `render.test.ts`
    // drives that for all five kinds. This asserts the OTHER end holds too, so
    // a host that built a flip by hand is refused rather than dispatching an
    // edit the format cannot express.
    const seed = documentWith('serialize-with');
    const { source, store } = await harness(seed);
    const edge = onlyEdge(seed);
    assert.equal(pickerView(seed, edge.id).flip, null);

    const handle = store.propose({ op: 'flip', edgeId: edge.id });
    await handle.settled;

    assert.deepEqual([...source.pending()], []);
    assert.equal(soleRefusalCode(store.getSnapshot().writes), 'symmetric-edge');
  });
});
