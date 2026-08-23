/**
 * The demo's coverage claim, made executable.
 *
 * "Every edge type, hold family and mutation state is reachable in it" is the
 * milestone's done-when, and a seed drifts: an edit that quietly drops the last
 * `together-with` leaves the demo still running and no longer demonstrating the
 * thing it exists to demonstrate. So the claim is a test rather than a sentence
 * in a README, and it enumerates the populations from the vocabulary rather than
 * from a hand-written list that can go one member short.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EDGE_FIELDS } from '@issuegraph/core';
import type { EdgeKind } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';

import { DEFAULT_CONCURRENCY_CAP, type ExplainedRow, explainOrder } from './order.ts';
import { seedDocument, seedHolds } from './seed.ts';

function rows(): readonly ExplainedRow[] {
  return explainOrder(seedDocument(), seedHolds());
}

function row(ref: string): ExplainedRow {
  const found = rows().find((candidate) => candidate.issue.ref === ref);
  assert.ok(found, `the seed has no issue ${ref}`);
  return found;
}

test('the seed declares every edge type the format has', () => {
  const declared = new Set<EdgeKind>(seedDocument().edges.map((edge) => edge.kind));
  // Enumerated from the vocabulary, so a sixth field added to the spec fails
  // here rather than going undemonstrated.
  for (const field of EDGE_FIELDS) {
    assert.ok(declared.has(field), `the seed declares no ${field} edge`);
  }
});

test('both hold families are reachable, and they are never one treatment', () => {
  const families = new Set(rows().flatMap((each) => each.holds.map((hold) => hold.family)));
  assert.deepEqual([...families].sort(), ['executor', 'graph']);

  // Graph-derived: inline in the spine at its would-be rank.
  const blocked = row('5');
  assert.equal(blocked.placement, 'spine');
  assert.ok(blocked.holds.some((hold) => hold.family === 'graph' && hold.label === 'serialized'));

  // Executor-derived: the collapsed footer group, with no rank slot at all.
  const parked = row('11');
  assert.equal(parked.placement, 'footer');
  assert.equal(parked.showRank, false);
  assert.ok(parked.holds.some((hold) => hold.family === 'executor' && hold.label === 'parked'));
});

test('all three readiness stations are reachable', () => {
  const stations = new Set(rows().map((each) => each.station));
  assert.deepEqual([...stations].sort(), ['dashed', 'filled', 'hollow']);
});

test('a station reads parallelism: filled inside the cap, hollow beyond it', () => {
  const spine = rows().filter((each) => each.placement === 'spine');
  const readySlots = [...new Set(spine.filter((each) => each.ready).map((each) => each.rank))].sort(
    (a, b) => a - b,
  );
  assert.ok(readySlots.length > DEFAULT_CONCURRENCY_CAP, 'the seed cannot exercise the cap');

  const filled = spine.filter((each) => each.station === 'filled');
  assert.equal(
    new Set(filled.map((each) => each.rank)).size,
    DEFAULT_CONCURRENCY_CAP,
    'exactly one filled station per slot inside the cap',
  );
  for (const each of filled) assert.equal(each.ready, true);

  // A hollow station is READY. It names the slot whose completion frees its own,
  // which is a sequencing statement rather than a hold.
  for (const each of spine.filter((candidate) => candidate.station === 'hollow')) {
    assert.equal(each.ready, true, 'a hollow station must be ready');
    assert.deepEqual(each.holds, [], 'a hollow station carries no hold');
    const slot = readySlots.indexOf(each.rank);
    assert.equal(each.readyAfterRank, readySlots[slot - DEFAULT_CONCURRENCY_CAP]);
  }
});

test('a graph-derived hold is dashed and sits inline at its would-be rank', () => {
  // The design is explicit: blocked and serialized draw a DASHED station with
  // the rank shown as an em dash, and they stay in the spine, because "why
  // isn't my P1 running" must be answerable in place.
  for (const ref of ['1', '5']) {
    const held = row(ref);
    assert.equal(held.station, 'dashed', `${ref} should be dashed`);
    assert.equal(held.placement, 'spine', `${ref} should stay inline`);
    assert.equal(held.showRank, false, `${ref} should show no rank`);
  }
});

test('all three rank-provenance forms are reachable', () => {
  const forms = new Set(rows().map((each) => each.provenance.form));
  assert.deepEqual([...forms].sort(), ['declared', 'default-tier', 'promoted']);
});

test('effective priority flows backward along a blocking edge', () => {
  // #2 is declared P3 and blocks a P0, so it IS the most urgent thing in the
  // system — §6.3, rendered as `P3 → 0` naming the dependent.
  const promoted = row('2');
  assert.deepEqual(promoted.provenance, {
    form: 'promoted',
    declared: 3,
    effective: 0,
    from: '1',
  });
  assert.ok(promoted.rank < row('4').rank, 'a promoted P3 outranks an unpromoted default tier');
});

test('an unresolved priority falls to the spec default tier, not to zero', () => {
  assert.deepEqual(row('4').provenance, { form: 'default-tier', priority: 2 });
});

test('a together group shares one rank and is ready as a unit', () => {
  const first = row('7');
  const second = row('9');
  assert.equal(first.rank, second.rank, 'a together group shares one rank');
  assert.equal(first.togetherGroupSize, 2);
  assert.equal(first.ready, second.ready);
});

test('a together group is held as a unit too', () => {
  // The group is ready in the seed; hold ONE member and the other inherits it,
  // which is §6.2 rule 5 and is the half a seed alone cannot show.
  const document = seedDocument();
  const held = explainOrder(document, [
    ...seedHolds(),
    { ref: '7', label: 'claimed', detail: 'another worker holds this issue' },
  ]);
  const groupmate = held.find((each) => each.issue.ref === '9');
  assert.ok(groupmate);
  assert.equal(groupmate.ready, false);
  assert.ok(
    groupmate.holds.some((hold) => hold.detail.includes('7')),
    'the groupmate names the member that is held',
  );
});

test('an unresolvable reference blocks rather than being ignored', () => {
  const unresolvable = row('14');
  assert.equal(unresolvable.ready, false);
  assert.equal(unresolvable.station, 'dashed');
  assert.ok(unresolvable.holds.some((hold) => hold.label === 'unresolvable'));
});

test('a blocked-by cycle is surfaced as stuck, on both members', () => {
  for (const ref of ['12', '13']) {
    const member = row(ref);
    assert.equal(member.ready, false);
    assert.ok(member.holds.some((hold) => hold.label === 'cycle'), `${ref} is not reported cyclic`);
  }
});

test('a duplicate is never worked, and the closure is transitive', () => {
  assert.equal(row('10').placement, 'footer');
  // A duplicate OF a duplicate is still a duplicate (§6.1's closure).
  const document = seedDocument();
  const chained = explainOrder(
    { issues: [...document.issues, { ref: '15', title: 'Yet another rename', state: 'open' }],
      edges: [...document.edges, makeEdge('duplicate-of', '15', '10')] },
    seedHolds(),
  );
  const far = chained.find((each) => each.issue.ref === '15');
  assert.ok(far);
  assert.equal(far.placement, 'footer');
  assert.ok(far.holds.some((hold) => hold.label === 'duplicate'));
});

test('decomposed-from carries provenance and no ordering effect', () => {
  // #7 is decomposed from a closed parent and is still ready: provenance must
  // not block, and the closed parent must not take a rank slot.
  assert.equal(row('7').ready, true);
  assert.equal(row('8').placement, 'footer');
});

test('the spine is ordered by effective priority, newest first within a tier', () => {
  const spine = rows().filter((each) => each.placement === 'spine');
  for (let i = 1; i < spine.length; i += 1) {
    const previous = spine[i - 1];
    const current = spine[i];
    assert.ok(previous && current);
    assert.ok(
      previous.effectivePriority < current.effectivePriority ||
        (previous.effectivePriority === current.effectivePriority &&
          (previous.rank === current.rank || Number(previous.issue.ref) > Number(current.issue.ref))),
      `${previous.issue.ref} should not precede ${current.issue.ref}`,
    );
  }
});
