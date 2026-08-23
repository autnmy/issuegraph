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

import { DEFAULT_CONCURRENCY_CAP, type ExplainedRow, explainOrder, slotCount } from './order.ts';
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

test('a together group is PLACED as a unit, not split across the two treatments', () => {
  // Group a parked issue with a spine issue. The parked member's hold
  // propagates to its groupmate (§6.2 rule 5), so the groupmate is held by the
  // EXECUTOR family — and an executor-derived hold must never render inline.
  const document = seedDocument();
  const grouped = explainOrder(
    { issues: document.issues, edges: [...document.edges, makeEdge('together-with', '11', '4')] },
    seedHolds(),
  );
  for (const ref of ['11', '4']) {
    const member = grouped.find((each) => each.issue.ref === ref);
    assert.ok(member, `no row for ${ref}`);
    assert.equal(member.placement, 'footer', `${ref} should be in the footer with its group`);
  }
  // The invariant behind it, stated as an invariant rather than as two cases:
  // nothing in the spine carries an executor-derived hold.
  for (const each of grouped.filter((row) => row.placement === 'spine')) {
    assert.ok(
      !each.holds.some((hold) => hold.family === 'executor'),
      `${each.issue.ref} renders an executor-derived hold inline`,
    );
  }
});

test('INVARIANT: the returned rows never step backward in rank', () => {
  // `OrderRow.rank` is a POSITION, rendered in ascending order, so a consumer
  // walking the array must never see it decrease. Together members share a
  // rank, which is why the test is non-decreasing rather than strictly
  // increasing.
  const check = (rows: readonly ExplainedRow[], what: string): void => {
    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1];
      const current = rows[i];
      assert.ok(previous && current);
      assert.ok(
        current.rank >= previous.rank,
        `${what}: rank stepped back from ${previous.rank} (${previous.issue.ref}) to ${current.rank} (${current.issue.ref})`,
      );
    }
  };

  check(rows(), 'the seed');

  const document = seedDocument();
  // The reviewer's own scenario: group two equally-prioritised issues that the
  // newest-first tiebreak separates. Handing the group its first member's rank
  // while leaving both sorted individually is what made the array step back.
  check(
    explainOrder(
      { issues: document.issues, edges: [...document.edges, makeEdge('together-with', '14', '4')] },
      seedHolds(),
    ),
    'a together group whose members the tiebreak separates',
  );
  // And with three members spread across the tier.
  check(
    explainOrder(
      {
        issues: document.issues,
        edges: [
          ...document.edges,
          makeEdge('together-with', '14', '4'),
          makeEdge('together-with', '4', '13'),
        ],
      },
      seedHolds(),
    ),
    'a three-member together group',
  );
});

test('a together group whose members the tiebreak separates stays contiguous', () => {
  const document = seedDocument();
  const grouped = explainOrder(
    { issues: document.issues, edges: [...document.edges, makeEdge('together-with', '14', '4')] },
    seedHolds(),
  );
  const positions = ['14', '4'].map((ref) => grouped.findIndex((each) => each.issue.ref === ref));
  assert.ok(positions.every((at) => at >= 0), 'both members should be present');
  assert.equal(Math.abs(positions[0]! - positions[1]!), 1, 'the unit should be adjacent');
  const ranks = new Set(['14', '4'].map((ref) => grouped.find((each) => each.issue.ref === ref)!.rank));
  assert.equal(ranks.size, 1, 'one candidate, one rank');
});

test('a together group propagates its urgency THROUGH its blockers', () => {
  // #4 is the spec default tier. Group it with P0 #1 — the group is then a P0
  // schedulable unit — and block #4 on the otherwise-unremarkable #14. The
  // blocker must inherit the GROUP's urgency, not #4's declared tier: taking
  // the group maximum after the dependency walk left it at P2, so the real
  // critical path could sort behind unrelated work.
  const document = seedDocument();
  const promoted = explainOrder(
    {
      issues: document.issues,
      edges: [
        ...document.edges,
        makeEdge('together-with', '4', '1'),
        makeEdge('blocked-by', '4', '14'),
      ],
    },
    seedHolds(),
  );
  const blocker = promoted.find((each) => each.issue.ref === '14');
  assert.ok(blocker);
  assert.equal(
    blocker.effectivePriority,
    0,
    'a blocker of a P0 together unit must be the most urgent thing in the system',
  );
});

test('effective priority does not depend on the order a cycle is walked', () => {
  // #1 (P0) is made to depend on the seeded #12/#13 cycle. Both members are
  // transitive dependencies of a P0, so BOTH must be promoted — a memoised walk
  // cached whichever it reached first at its declared tier.
  const document = seedDocument();
  const withCycleDependency = {
    issues: document.issues,
    edges: [...document.edges, makeEdge('blocked-by', '1', '12')],
  };
  const rowsOf = (edges: readonly ReturnType<typeof makeEdge>[]): Map<string, number> =>
    new Map(
      explainOrder({ issues: document.issues, edges }, seedHolds()).map((each) => [
        each.issue.ref,
        each.effectivePriority,
      ]),
    );

  const forward = rowsOf(withCycleDependency.edges);
  assert.equal(forward.get('12'), 0, '#12 is a transitive dependency of a P0');
  assert.equal(forward.get('13'), 0, '#13 is one too, through its cycle partner');

  // The same graph with the edge list reversed must give the same answer.
  const reversed = rowsOf([...withCycleDependency.edges].reverse());
  for (const ref of ['12', '13', '1']) {
    assert.equal(reversed.get(ref), forward.get(ref), `${ref} depends on traversal order`);
  }
});

test('a ready together group is ONE scheduler slot, not one per member', () => {
  // Group two issues that are both ready and both inside the cap. Counting rows
  // would report two running from one slot, so the header would claim more work
  // in flight than the cap allows — contradicting the stations beneath it.
  const document = seedDocument();
  const grouped = explainOrder(
    { issues: document.issues, edges: [...document.edges, makeEdge('together-with', '3', '2')] },
    seedHolds(),
  );
  const running = grouped.filter((each) => each.station === 'filled');
  assert.ok(running.length > slotCount(running), 'the fixture does not exercise a shared slot');
  assert.ok(
    slotCount(running) <= DEFAULT_CONCURRENCY_CAP,
    `${slotCount(running)} slots running exceeds the cap of ${DEFAULT_CONCURRENCY_CAP}`,
  );

  // And the invariant, over the whole spine rather than over this fixture: the
  // filled stations never occupy more slots than the cap.
  for (const edges of [document.edges, [...document.edges, makeEdge('together-with', '3', '2')]]) {
    const all = explainOrder({ issues: document.issues, edges }, seedHolds());
    assert.ok(
      slotCount(all.filter((each) => each.station === 'filled')) <= DEFAULT_CONCURRENCY_CAP,
      'filled stations exceed the concurrency cap',
    );
  }
});

test('a serialize group is admitted on an ACTIVE claim, not on any hold', () => {
  // #11 is parked, which is not a claim: nothing is running, so nothing is
  // excluded. Reading every executor hold as a claim held a serialize partner
  // over work that no worker had.
  const document = seedDocument();
  const serialized = explainOrder(
    { issues: document.issues, edges: [...document.edges, makeEdge('serialize-with', '4', '11')] },
    seedHolds(),
  );
  const partner = serialized.find((each) => each.issue.ref === '4');
  assert.ok(partner);
  assert.ok(
    !partner.holds.some((hold) => hold.label === 'serialized'),
    'a parked partner held the group even though nothing is running',
  );
});

test('a claim expands across the claimed unit before serialize admission', () => {
  // Claiming #6 atomically claims its whole together unit (§4.3.7), so
  // serializing with any member of that unit excludes you — even a member
  // nobody claimed directly.
  const document = seedDocument();
  const serialized = explainOrder(
    {
      issues: document.issues,
      edges: [
        ...document.edges,
        makeEdge('together-with', '6', '7'),
        makeEdge('serialize-with', '4', '7'),
      ],
    },
    seedHolds(),
  );
  const partner = serialized.find((each) => each.issue.ref === '4');
  assert.ok(partner);
  assert.ok(
    partner.holds.some((hold) => hold.label === 'serialized'),
    'the claim did not expand across the together unit, so the group admitted two workers',
  );
});

test('a reference to a duplicate resolves to its canonical', () => {
  // #10 is a duplicate of #4 and is never worked. A dependency written against
  // #10 therefore has to LAND on #4 — otherwise #4 never inherits the
  // dependent'"'"'s urgency, and closing #4 would not unblock anything.
  const document = seedDocument();
  const resolved = explainOrder(
    { issues: document.issues, edges: [...document.edges, makeEdge('blocked-by', '1', '10')] },
    seedHolds(),
  );
  const canonical = resolved.find((each) => each.issue.ref === '4');
  assert.ok(canonical);
  assert.equal(
    canonical.effectivePriority,
    0,
    'the canonical did not inherit the urgency of the issue blocked by its duplicate',
  );

  const dependent = resolved.find((each) => each.issue.ref === '1');
  assert.ok(dependent);
  assert.ok(
    dependent.holds.some((hold) => hold.detail.includes('blocked by 4')),
    'the dependency stayed attached to the duplicate instead of the canonical',
  );
  assert.ok(
    !dependent.holds.some((hold) => hold.detail.includes('blocked by 10')),
    'the dependency is still reported against a duplicate that is never worked',
  );
});

test('a chain of duplicates resolves to the far canonical, not one hop', () => {
  const document = seedDocument();
  const chained = explainOrder(
    {
      issues: [...document.issues, { ref: '15', title: 'Renaming that flag again', state: 'open' }],
      edges: [
        ...document.edges,
        makeEdge('duplicate-of', '15', '10'),
        makeEdge('blocked-by', '1', '15'),
      ],
    },
    seedHolds(),
  );
  const canonical = chained.find((each) => each.issue.ref === '4');
  assert.ok(canonical);
  assert.equal(canonical.effectivePriority, 0, 'the closure stopped one hop short of the canonical');
});
