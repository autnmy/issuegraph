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

import { EDGE_CARDINALITY, EDGE_FIELDS } from '@issuegraph/core';
import type { EdgeKind, GraphDocument } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';

import {
  DEFAULT_CONCURRENCY_CAP,
  type ExplainedRow,
  cardinalityConflict,
  createDeriver,
  explainOrder,
  introducesCycle,
  slotCount,
  writtenOrInFlight,
} from './order.ts';
import { seedDocument, seedHolds } from './seed.ts';

/** The document an added edge would produce — what the store hands a guard. */
function withEdge(document: GraphDocument, kind: EdgeKind, from: string, to: string): GraphDocument {
  return { issues: document.issues, edges: [...document.edges, makeEdge(kind, from, to)] };
}

/** What the guard answers for `from --kind--> to` against this document. */
function guarded(document: GraphDocument, kind: EdgeKind, from: string, to: string): boolean {
  return introducesCycle(document, withEdge(document, kind, from, to));
}

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

test('blocking INSIDE a together unit is advisory, so it is not a cycle', () => {
  // #12 and #13 block each other. Group them, and those edges become internal
  // to one unit — advisory under §4.3.7, because a group is claimed and worked
  // as a whole. Readiness already ignored them; cycle detection did not, so the
  // page went on calling a perfectly well-formed group stuck.
  const document = seedDocument();
  const grouped = explainOrder(
    { issues: document.issues, edges: [...document.edges, makeEdge('together-with', '12', '13')] },
    seedHolds(),
  );
  for (const ref of ['12', '13']) {
    const member = grouped.find((each) => each.issue.ref === ref);
    assert.ok(member);
    assert.ok(
      !member.holds.some((hold) => hold.label === 'cycle'),
      `${ref} is still reported cyclic on an edge the rules make advisory`,
    );
    assert.ok(
      !member.holds.some((hold) => hold.label === 'blocked'),
      `${ref} is still reported blocked by its own groupmate`,
    );
  }

  // CONTROL: ungrouped, the same two edges ARE a cycle. Without this the test
  // above passes just as well against a build that never detects one.
  for (const ref of ['12', '13']) {
    const member = explainOrder(document, seedHolds()).find((each) => each.issue.ref === ref);
    assert.ok(member?.holds.some((hold) => hold.label === 'cycle'), `${ref} control failed`);
  }
});

test('the cycle guard sees cycles that exist only after duplicate resolution', () => {
  // #10 is a duplicate of #4. With #4 blocked-by #2 already landed, adding
  // `#2 blocked-by #10` closes #4 → #2 → #4 once references resolve — invisible
  // to a walk over raw endpoints, because raw #10 has no path to #2.
  const document = seedDocument();
  const landed = {
    issues: document.issues,
    edges: [...document.edges, makeEdge('blocked-by', '4', '2')],
  };
  assert.equal(
    guarded(landed, 'blocked-by', '2', '10'),
    true,
    'the guard missed a cycle that exists after duplicate resolution',
  );

  // CONTROL: an edge that closes nothing is still allowed, so the guard is not
  // simply refusing everything.
  assert.equal(guarded(landed, 'blocked-by', '14', '9'), false, 'the guard refuses an innocent edge');
});

test('a cycle THROUGH a together unit is seen, because the unit is one node', () => {
  // Opposite sides of the cycle touch different members: `#9 blocked-by #4`
  // and `#4 blocked-by #7`, with {7,9} a together group. The schedulable-unit
  // graph is {7,9} → 4 → {7,9} and all three are stuck, but a member-level walk
  // cannot cross from #7 to #9, so excluding internal edges is not enough —
  // the unit has to BE one node.
  const document = seedDocument();
  const edges = [...document.edges, makeEdge('blocked-by', '9', '4'), makeEdge('blocked-by', '4', '7')];
  const stuck = explainOrder({ issues: document.issues, edges }, seedHolds());
  for (const ref of ['4', '7', '9']) {
    const member = stuck.find((each) => each.issue.ref === ref);
    assert.ok(member, `no row for ${ref}`);
    assert.ok(
      member.holds.some((hold) => hold.label === 'cycle'),
      `${ref} is in the deadlock and is not reported as stuck`,
    );
  }

  // The guard has to refuse the edit that closes it, for the same reason and
  // through the same graph.
  const landed = { issues: document.issues, edges: [...document.edges, makeEdge('blocked-by', '9', '4')] };
  assert.equal(
    guarded(landed, 'blocked-by', '4', '7'),
    true,
    'the guard let through an edge that deadlocks a whole unit',
  );

  // CONTROL: without the group, the same two edges are NOT a cycle — #4 blocks
  // #9 and #7 blocks #4, which is an ordinary chain.
  const ungrouped = {
    issues: document.issues,
    edges: [
      ...document.edges.filter((edge) => edge.kind !== 'together-with'),
      makeEdge('blocked-by', '9', '4'),
    ],
  };
  assert.equal(guarded(ungrouped, 'blocked-by', '4', '7'), false, 'the control chain reads as a cycle');
});

test('a unit-level blocker is reported once, not once per groupmate', () => {
  // The contraction gives every member the unit's blockers directly, so
  // propagating a groupmate's `blocked` hold on top would state one dependency
  // twice — in its own words and in the groupmate's.
  const document = seedDocument();
  const blocked = explainOrder(
    { issues: document.issues, edges: [...document.edges, makeEdge('blocked-by', '9', '14')] },
    seedHolds(),
  );
  for (const ref of ['7', '9']) {
    const member = blocked.find((each) => each.issue.ref === ref);
    assert.ok(member);
    const blockedHolds = member.holds.filter((hold) => hold.label === 'blocked');
    assert.equal(blockedHolds.length, 1, `${ref} reports its unit's one blocker ${blockedHolds.length} times`);
    assert.ok(blockedHolds[0]?.detail.includes('14'));
  }
});

test('the cycle guard is unit-level at BOTH ends of the edge', () => {
  // Copying a unit's adjacency onto its members makes every member the same
  // SOURCE of an edge; it does not make every member the same DESTINATION. So
  // the arrival test has to compare units too, or the same cycle approached
  // from the other end walks straight past it.
  const document = seedDocument();

  // Orientation A: the path leaves the unit. Land `#9 blocked-by #4`, then
  // `#4 blocked-by #7`.
  const a = { issues: document.issues, edges: [...document.edges, makeEdge('blocked-by', '9', '4')] };
  assert.equal(guarded(a, 'blocked-by', '4', '7'), true, 'orientation A missed');

  // Orientation B: the path ARRIVES at a different member. Land
  // `#4 blocked-by #9`, then `#7 blocked-by #4` — `reaches` gets to #9, which
  // is not #7 by reference but is #7 by unit.
  const b = { issues: document.issues, edges: [...document.edges, makeEdge('blocked-by', '4', '9')] };
  assert.equal(guarded(b, 'blocked-by', '7', '4'), true, 'orientation B missed');

  // A member naming its own groupmate is an internal edge, never a cycle.
  assert.equal(guarded(document, 'blocked-by', '7', '9'), false, 'an internal edge read as a cycle');

  // CONTROL: an edge that closes nothing is still allowed in both fixtures, so
  // the guard is not simply refusing everything once a group exists.
  assert.equal(guarded(a, 'blocked-by', '14', '3'), false, 'the guard refuses an innocent edge');
  assert.equal(guarded(b, 'blocked-by', '14', '3'), false, 'the guard refuses an innocent edge');
});

test("the store's order carries only rows that are IN the order", () => {
  const document = seedDocument();
  const derive = createDeriver(seedHolds());
  const rows = derive(document);
  const explained = explainOrder(document, seedHolds());

  const footer = explained.filter((each) => each.placement === 'footer').map((each) => each.issue.ref);
  assert.ok(footer.length > 0, 'the seed does not exercise the footer');
  for (const ref of footer) {
    assert.ok(!rows.some((row) => row.ref === ref), `${ref} is in the footer and in the order`);
  }
  assert.equal(rows.length, explained.length - footer.length);

  // The point of the filter: an issue LEAVING the order must be absent from the
  // next order, so the store can report it as `left` rather than as a move to a
  // footer rank it never occupied.
  const nowDuplicate = derive({
    issues: document.issues,
    edges: [...document.edges, makeEdge('duplicate-of', '3', '2')],
  });
  assert.ok(rows.some((row) => row.ref === '3'), 'the control failed: #3 should start in the order');
  assert.ok(!nowDuplicate.some((row) => row.ref === '3'), '#3 stayed in the order after becoming a duplicate');
});

test('a cycle closed by COLLAPSING vertices is guarded, with no new dependency', () => {
  // The edit that closes this cycle adds no `blocked-by` at all: it makes #3 a
  // duplicate of #4, and duplicate resolution turns the chain #4 → #2 → #3 into
  // #4 → #2 → #4. A guard keyed on the mutation's kind cannot see it, which is
  // why the question is asked of the two documents instead.
  const document = seedDocument();
  const chain = {
    issues: document.issues,
    edges: [
      ...document.edges.filter((edge) => !(edge.kind === 'duplicate-of' && edge.from === '10')),
      makeEdge('blocked-by', '4', '2'),
      makeEdge('blocked-by', '2', '3'),
    ],
  };
  assert.equal(
    guarded(chain, 'duplicate-of', '3', '4'),
    true,
    'a collapsing edit closed a cycle and the guard did not see it',
  );

  // The same collapse where no cycle results is still allowed — the guard is
  // refusing the cycle, not the kind.
  assert.equal(guarded(chain, 'duplicate-of', '14', '9'), false, 'an innocent collapse was refused');

  // And `together-with` collapses too, so it is asked the same question.
  assert.equal(guarded(chain, 'together-with', '3', '4'), true, 'a together collapse was missed');
});

test('an EXISTING cycle does not refuse unrelated edits', () => {
  // The seed contains the #12/#13 cycle deliberately (§6.6 surfaces one rather
  // than refusing it). Comparing counts instead of sets would make every edit
  // made while it stands look like it introduced a cycle.
  const document = seedDocument();
  assert.ok(cyclicMembersPresent(document), 'the seed no longer carries a cycle to test against');
  assert.equal(guarded(document, 'blocked-by', '4', '3'), false, 'an unrelated edit was refused');
});

function cyclicMembersPresent(document: GraphDocument): boolean {
  return explainOrder(document, seedHolds()).some((row) =>
    row.holds.some((hold) => hold.label === 'cycle'),
  );
}

test('a single-valued field refuses a second outgoing edge', () => {
  const document = seedDocument();
  // #10 is already `duplicate-of #4`, and `duplicate-of` holds one reference.
  const conflict = cardinalityConflict(document, 'duplicate-of', '10');
  assert.ok(conflict, 'the existing single-valued edge was not found');
  assert.equal(conflict.to, '4');

  // `blocked-by` is the one list field, so it never conflicts — #1 already has
  // two and a third is legitimate.
  assert.equal(cardinalityConflict(document, 'blocked-by', '1'), undefined);

  // An issue with no such edge yet is free to write one.
  assert.equal(cardinalityConflict(document, 'duplicate-of', '14'), undefined);

  // Enumerated from the vocabulary rather than by hand, so a field whose
  // cardinality changes in the spec fails here instead of going unchecked.
  for (const field of EDGE_FIELDS) {
    const expected = EDGE_CARDINALITY[field] === 'single';
    const twice = {
      issues: document.issues,
      edges: [...document.edges, makeEdge(field, '14', '9')],
    };
    assert.equal(
      cardinalityConflict(twice, field, '14') !== undefined,
      expected,
      `${field} cardinality is read as ${EDGE_CARDINALITY[field]} and behaves otherwise`,
    );
  }
});

test('every member of a cycle is found, including one that joins it later', () => {
  // #12 and #13 already block each other. Wire #14 into that component:
  // `#12 blocked-by #14` and `#14 blocked-by #13`. A walk that marks a node
  // done on the way out finishes #12 and #13 first and never revisits them, so
  // #14 comes back clean although it is plainly in the same component.
  const document = seedDocument();
  const joined = {
    issues: document.issues,
    edges: [...document.edges, makeEdge('blocked-by', '12', '14'), makeEdge('blocked-by', '14', '13')],
  };
  const rowsOf = explainOrder(joined, seedHolds());
  for (const ref of ['12', '13', '14']) {
    const member = rowsOf.find((each) => each.issue.ref === ref);
    assert.ok(member, `no row for ${ref}`);
    assert.ok(
      member.holds.some((hold) => hold.label === 'cycle'),
      `${ref} is in the component and is not reported cyclic`,
    );
  }

  // And the guard refuses the edit that pulls #14 in.
  const before = {
    issues: document.issues,
    edges: [...document.edges, makeEdge('blocked-by', '12', '14')],
  };
  assert.equal(guarded(before, 'blocked-by', '14', '13'), true, 'the guard missed the join');

  // CONTROL: an issue with a one-way path into the cycle is NOT in it — a test
  // that called everything reachable cyclic would pass the assertions above.
  const oneWay = {
    issues: document.issues,
    edges: [...document.edges, makeEdge('blocked-by', '14', '12')],
  };
  const outside = explainOrder(oneWay, seedHolds()).find((each) => each.issue.ref === '14');
  assert.ok(outside);
  assert.ok(
    !outside.holds.some((hold) => hold.label === 'cycle'),
    'an issue merely depending on a cycle was reported as being in it',
  );
});

test('a duplicate with no resolvable canonical is still never worked', () => {
  // Two issues pointing `duplicate-of` at each other resolve to nothing — each
  // walk returns to where it started. Deriving "is a duplicate" from the
  // canonical map therefore came back empty, and both re-entered the spine as
  // ordinary work while still carrying the field. §6.2 rule 2 excludes an issue
  // that IS a duplicate; it does not make that conditional on the reader being
  // able to name what it duplicates.
  const document = seedDocument();
  const mutual = {
    issues: document.issues,
    edges: [...document.edges, makeEdge('duplicate-of', '2', '3'), makeEdge('duplicate-of', '3', '2')],
  };
  const rowsOf = explainOrder(mutual, seedHolds());
  for (const ref of ['2', '3']) {
    const member = rowsOf.find((each) => each.issue.ref === ref);
    assert.ok(member, `no row for ${ref}`);
    assert.equal(member.placement, 'footer', `${ref} re-entered the order`);
    assert.ok(member.holds.some((hold) => hold.label === 'duplicate'), `${ref} lost its duplicate hold`);
  }

  // CONTROL: the issue POINTED AT is not itself a duplicate, so the fix does
  // not simply mark everything it touches.
  const canonicalRow = explainOrder(document, seedHolds()).find((each) => each.issue.ref === '4');
  assert.ok(canonicalRow);
  assert.equal(canonicalRow.placement, 'spine', 'the canonical was excluded along with its duplicate');
});

test('a CLOSED member of a together unit does not hold its open groupmates', () => {
  // A together group closes member by member (§4.3.7) and readiness is
  // evaluated over the members still open, so a closed member is no longer part
  // of the schedulable unit. Contracting over ALL members copied its
  // dependencies onto the ones that are left — holding live work on a
  // dependency that belongs to finished work.
  const document = seedDocument();
  const withClosedMember = {
    issues: document.issues,
    edges: [
      ...document.edges,
      makeEdge('blocked-by', '8', '2'), // #8 is CLOSED in the seed
      makeEdge('together-with', '8', '4'),
    ],
  };
  const live = explainOrder(withClosedMember, seedHolds()).find((each) => each.issue.ref === '4');
  assert.ok(live);
  assert.ok(
    !live.holds.some((hold) => hold.label === 'blocked'),
    "an open member is held by its CLOSED groupmate's dependency",
  );

  // CONTROL: the same shape with an OPEN member does hold #4 — otherwise this
  // test passes against a build that has stopped contracting at all.
  const withOpenMember = {
    issues: document.issues,
    edges: [
      ...document.edges,
      makeEdge('blocked-by', '14', '2'),
      makeEdge('together-with', '14', '4'),
    ],
  };
  const held = explainOrder(withOpenMember, seedHolds()).find((each) => each.issue.ref === '4');
  assert.ok(held);
  assert.ok(
    held.holds.some((hold) => hold.label === 'blocked'),
    'the control failed: an open groupmate should hold the unit',
  );
});

test('cardinality counts an IN-FLIGHT create, not only a landed one', () => {
  // The decision this pins is WHICH EDGES COUNT, which used to be made inline
  // in the page where nothing could test it — and that is how a landed-only
  // reading survived being written. Two creates inside one settle window each
  // saw a document with no landed value, and both were allowed.
  const landed = [makeEdge('blocked-by', '1', '2')];
  const pendingEdge = makeEdge('decomposed-from', '1', '3');
  const projected = [
    { ...landed[0]!, states: [] as const, writes: [] as const },
    { ...pendingEdge, states: ['pending-write'] as const, writes: ['m1'] as const },
    // Neither of these is a value the field holds: one was never written, the
    // other was refused upstream.
    { ...makeEdge('duplicate-of', '1', '9'), states: ['invalid'] as const, writes: ['m2'] as const },
    { ...makeEdge('serialize-with', '1', '14'), states: ['failed'] as const, writes: ['m3'] as const },
  ];

  const weighed = writtenOrInFlight(landed, projected);
  assert.ok(weighed.some((edge) => edge.id === pendingEdge.id), 'the in-flight create was not counted');
  assert.ok(
    !weighed.some((edge) => edge.kind === 'duplicate-of'),
    'an invalid edge was counted as a value the field holds',
  );
  assert.ok(
    !weighed.some((edge) => edge.kind === 'serialize-with'),
    'a failed edge was counted as a value the field holds',
  );
  assert.equal(weighed.filter((edge) => edge.id === landed[0]?.id).length, 1, 'a landed edge was doubled');

  // And the rule reading it now sees the conflict the page must refuse.
  const document = { issues: seedDocument().issues, edges: weighed };
  const conflict = cardinalityConflict(document, 'decomposed-from', '1');
  assert.ok(conflict, 'an in-flight value was not counted against the field');
  assert.equal(conflict.to, '3');
});
