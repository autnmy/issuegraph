import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { edgeId } from '../model.ts';
import type { Mutation, Proposal } from '../mutation.ts';
import { createScriptedSource } from './scripted.ts';
import { applyEdit, threeOpenIssues, withEdge } from '../testing/fixtures.ts';

function edit(proposal: Proposal, mutationId = 'm1'): Mutation {
  return { ...proposal, mutationId };
}

const create = edit({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });

test('it does not settle until it is told to, which is its whole reason to exist', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  let settled = false;
  const dispatched = source.dispatch(create).then(() => {
    settled = true;
  });

  // A microtask boundary: enough for anything that was going to resolve on its
  // own to have done so.
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(
    source.pending().map((entry) => entry.mutationId),
    ['m1'],
  );

  source.settleNext('applied');
  await dispatched;
  assert.equal(settled, true);
  assert.deepEqual(source.pending(), []);
});

test('every outcome the port defines is producible from the script', async () => {
  const outcomes: string[] = [];

  const applied = createScriptedSource(threeOpenIssues(), applyEdit);
  const first = applied.dispatch(create);
  applied.settleNext('applied');
  outcomes.push((await first).outcome);

  const unchanged = createScriptedSource(threeOpenIssues(), applyEdit);
  const second = unchanged.dispatch(create);
  unchanged.settleNext({ outcome: 'unchanged' });
  outcomes.push((await second).outcome);

  const rejected = createScriptedSource(threeOpenIssues(), applyEdit);
  const third = rejected.dispatch(create);
  rejected.settleNext({ outcome: 'rejected', reason: 'the issue is locked' });
  outcomes.push((await third).outcome);

  const conflicted = createScriptedSource(threeOpenIssues(), applyEdit);
  const fourth = conflicted.dispatch(create);
  conflicted.settleNext({ outcome: 'conflict', upstream: withEdge(threeOpenIssues(), 'duplicate-of', '3', '1') });
  outcomes.push((await fourth).outcome);

  assert.deepEqual(outcomes, ['applied', 'unchanged', 'rejected', 'conflict']);
});

test('an applied settlement advances the document, and a rejected one does not', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const landing = source.dispatch(create);
  source.settleNext('applied');
  await landing;
  assert.deepEqual(
    source.current().edges.map((edge) => edge.id),
    [edgeId('blocked-by', '1', '2')],
  );

  const refused = source.dispatch(edit({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' }, 'm2'));
  source.settleNext({ outcome: 'rejected', reason: 'no' });
  await refused;
  assert.equal(source.current().edges.length, 1);
});

test('a scripted conflict returns an upstream that genuinely differs', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const dispatched = source.dispatch(create);
  const upstream = withEdge(threeOpenIssues(), 'duplicate-of', '3', '1');
  source.settleNext({ outcome: 'conflict', upstream });
  const result = await dispatched;
  assert.equal(result.outcome, 'conflict');
  if (result.outcome !== 'conflict') return;
  assert.notDeepEqual(
    result.upstream.edges.map((edge) => edge.id),
    source.current().edges.map((edge) => edge.id),
  );
});

test('a scripted throw rejects the dispatch promise', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const dispatched = source.dispatch(create);
  source.throwNext(new Error('the adapter fell over'));
  await assert.rejects(dispatched, /fell over/);
});

test('settlements can be taken out of order by naming the edit', async () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  const first = source.dispatch(create);
  const second = source.dispatch(edit({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' }, 'm2'));

  source.settle('m2', 'applied');
  assert.equal((await second).outcome, 'applied');
  assert.deepEqual(
    source.pending().map((entry) => entry.mutationId),
    ['m1'],
  );

  source.settle('m1', { outcome: 'unchanged' });
  assert.equal((await first).outcome, 'unchanged');
});

test('settling nothing throws rather than passing quietly', () => {
  const source = createScriptedSource(threeOpenIssues(), applyEdit);
  assert.throws(() => source.settleNext('applied'), /nothing is waiting/);
  assert.throws(() => source.settle('m9', 'applied'), /m9 is not waiting/);
});

test('neither adapter imports the store — the dependency runs one way', () => {
  // The seam is that the store depends on the PORT and the adapters implement
  // it. An adapter reaching back into the store would make the port decorative,
  // and nothing else in this repository would notice.
  for (const file of ['memory.ts', 'scripted.ts']) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    assert.ok(!/from\s+'\.\.\/store\.ts'/.test(source), `${file} imports the store`);
  }
});
