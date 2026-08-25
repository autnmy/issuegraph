/**
 * What this file tests, and what it deliberately does not.
 *
 * `demo/src/order.ts` no longer DERIVES an order — `@issuegraph/derive` does,
 * and that package carries its own tests, its own fixture-parity pin against
 * the reference prototype's seed, and its own mechanical purity proofs. Testing
 * the ready set, effective priority or the selection sort here would be a second
 * test suite for a derivation this file does not contain, and it would go stale
 * against the package rather than against the demo.
 *
 * So this suite covers the SEAM and nothing else. Three jobs:
 *
 *  1. THE PROJECTION IN. The store's document has to arrive at the derivation
 *     as the same graph. Anything lost on the way in is an absence rendered as
 *     a value — a dropped edge does not fail, it produces a plausible order for
 *     a backlog that is not this one.
 *  2. THE PROJECTION OUT, pinned against the derivation IN BOTH DIRECTIONS. The
 *     chips a row shows are the demo's own words; whether the row may start is
 *     the derivation's verdict. A row held with no blocking chip is a station
 *     that says "held" with no reason a visitor can read, and a ready row
 *     carrying one is the same lie inverted. That pin is what caught the one
 *     real defect this rework surfaced (§6.7 generalized from `serialize-with`
 *     to both group fields), so it is the load-bearing test here.
 *  3. THE COVERAGE CLAIM, which is the milestone's own done-when and survives
 *     the swap unchanged: every edge type, both hold families, all three
 *     readiness stations and all three rank-provenance forms are reachable in
 *     the seed without editing anything first.
 *
 * POPULATIONS ARE ENUMERATED FROM THE VOCABULARY (`EDGE_FIELDS`,
 * `EDGE_CARDINALITY`), never from a hand-written list that can go one member
 * short. A sixth edge field fails here instead of going undemonstrated.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EDGE_CARDINALITY,
  EDGE_FIELDS,
  PRIORITY_MAX,
  PRIORITY_MIN,
  type Priority,
} from '@issuegraph/core';
import { nodeKey, priorityLabelValue } from '@issuegraph/reader';
import type { GraphDocument, StoredEdge, StoredIssue } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';

import {
  type ExplainedRow,
  type Hold,
  createDeriver,
  explainOrder,
  introducesCycle,
  slotCount,
} from './order.ts';
import { seedDocument, seedHolds } from './seed.ts';

const PRIORITIES: readonly Priority[] = [0, 1, 2, 3];

function blocks(hold: Hold): boolean {
  return hold.blocking !== false;
}

function open(ref: string, priority?: Priority): StoredIssue {
  return priority === undefined
    ? { ref, title: `issue ${ref}`, state: 'open' }
    : { ref, title: `issue ${ref}`, state: 'open', priority };
}

function document(issues: readonly StoredIssue[], edges: readonly StoredEdge[]): GraphDocument {
  return { issues, edges };
}

function rowFor(rows: readonly ExplainedRow[], ref: string): ExplainedRow {
  const found = rows.find((row) => row.issue.ref === ref);
  assert.ok(found !== undefined, `no row for #${ref}`);
  return found;
}

// ---------------------------------------------------------------------------
// 1. The projection IN
// ---------------------------------------------------------------------------

test('the two key spaces are identical, so no translation layer can drift', () => {
  // The demo's `IssueRef` is opaque and its document is one repository's, so
  // `nodeKey` folds every node to the reference the demo already holds. Every
  // model answer in `order.ts` is looked up by `IssueRef` on the strength of
  // this; if it stopped holding, every lookup would silently miss and the page
  // would render an order for a graph nobody declared.
  for (const issue of seedDocument().issues) {
    assert.equal(nodeKey({ id: issue.ref, repo: null }), issue.ref);
  }
});

test('the priority label the demo writes is the one the reader reads', () => {
  // §4.3.5 makes a tracker's own convention canonical over the frontmatter
  // field, and a mapped label is how the demo's declared priority reaches the
  // model. A spelling the reader does not recognise would not fail — it would
  // present as "every issue is in the spec's default tier", which is a
  // plausible page.
  for (const priority of PRIORITIES) {
    assert.equal(priorityLabelValue([`P${String(priority)}`]), priority);
  }
  // Enumerated from the vocabulary's own bounds, so widening the range fails
  // here rather than leaving a tier unexercised.
  assert.deepEqual(
    PRIORITIES,
    Array.from({ length: PRIORITY_MAX - PRIORITY_MIN + 1 }, (_, i) => PRIORITY_MIN + i),
  );
});

test('every edge kind reaches the derivation, and none is silently dropped', () => {
  // A kind lost in the projection produces no error: the order simply comes
  // back as though the relationship had never been written. So each is asserted
  // to CHANGE something the page renders, enumerated from `EDGE_FIELDS`.
  const issues = [open('1', 1), open('2', 1), open('3', 1)];
  const bare = explainOrder(document(issues, []));
  const unchanged: string[] = [];
  for (const kind of EDGE_FIELDS) {
    const rows = explainOrder(document(issues, [makeEdge(kind, '1', '2')]));
    const same = JSON.stringify(rows) === JSON.stringify(bare);
    if (same) unchanged.push(kind);
  }
  // `decomposed-from` is PROVENANCE, never an ordering arrow (§4.3), so it is
  // the one kind whose presence must change nothing. Asserting the set rather
  // than skipping it makes that a claim the suite checks in both directions: a
  // future kind that silently changes nothing shows up here.
  assert.deepEqual(unchanged, ['decomposed-from']);
});

test('a second declaration of a single-valued field is ignored, not merged', () => {
  // §4.3.4 and §4.3.7: a writer joins a group by pointing at any ONE existing
  // member, so the group fields are single-valued and `blocked-by` is the only
  // list. The demo's adapter refuses to write a second; the projection has to
  // agree, or a document assembled another way would quietly express a graph
  // the format cannot.
  const issues = [open('1', 1), open('2', 1), open('3', 1)];
  for (const kind of EDGE_FIELDS) {
    if (EDGE_CARDINALITY[kind] !== 'single') continue;
    const first = explainOrder(document(issues, [makeEdge(kind, '1', '2')]));
    const both = explainOrder(
      document(issues, [makeEdge(kind, '1', '2'), makeEdge(kind, '1', '3')]),
    );
    assert.equal(
      JSON.stringify(both),
      JSON.stringify(first),
      `a second ${kind} from one issue changed the order`,
    );
  }
});

test('blocked-by is the only list field, and every entry of it blocks', () => {
  assert.deepEqual(
    EDGE_FIELDS.filter((kind) => EDGE_CARDINALITY[kind] === 'list'),
    ['blocked-by'],
  );
  const issues = [open('1', 1), open('2', 1), open('3', 1)];
  const rows = explainOrder(
    document(issues, [makeEdge('blocked-by', '1', '2'), makeEdge('blocked-by', '1', '3')]),
  );
  const held = rowFor(rows, '1');
  assert.equal(held.ready, false);
  assert.equal(
    held.holds.filter((hold) => hold.label === 'blocked').length,
    2,
    'a blocked-by list was collapsed to one entry on the way in',
  );
});

// ---------------------------------------------------------------------------
// 2. The projection OUT, pinned against the derivation
// ---------------------------------------------------------------------------

/**
 * The pin, in both directions, over one document.
 *
 * Readiness is `IssueOrderSlot.ready` and the chips are the demo's wording for
 * it. Neither direction is optional: a held row with no blocking chip renders a
 * dashed station and no readable reason, and a ready row carrying one hands the
 * store a `ready` `OrderRow` with `holdReasons`, which its own contract forbids.
 */
function assertChipsAgree(doc: GraphDocument, holds = seedHolds(), label = ''): void {
  for (const row of explainOrder(doc, holds)) {
    if (row.placement !== 'spine') continue;
    const blocking = row.holds.filter(blocks);
    if (row.ready) {
      assert.equal(
        blocking.length,
        0,
        `${label}#${row.issue.ref} is ready and carries blocking chips: ${JSON.stringify(blocking)}`,
      );
    } else {
      assert.ok(
        blocking.length > 0,
        `${label}#${row.issue.ref} is held with no blocking chip — the station says held and says why nowhere`,
      );
    }
  }
}

test('the chips agree with the derivation on the seed', () => {
  assertChipsAgree(seedDocument());
});

test('the chips agree with the derivation on every single-edge document', () => {
  // The seed is one graph. This sweeps every relationship kind against a
  // RESOLVABLE and an UNRESOLVABLE target, which is where the two readings come
  // apart: §6.7 gives `blocked-by` and `serialize-with` explicit treatments and
  // is silent about `together-with`, whose declarer the reader refuses (§4.3.7,
  // a unit cannot be claimed atomically around a member it cannot identify).
  // Generalizing §6.7 across both group fields is exactly the defect this
  // sweep found.
  const issues = [open('1', 1), open('2', 1)];
  for (const kind of EDGE_FIELDS) {
    for (const target of ['2', '404']) {
      assertChipsAgree(
        document(issues, [makeEdge(kind, '1', target)]),
        [],
        `${kind} -> #${target}: `,
      );
    }
  }
});

test('the chips agree with the derivation while an executor holds an issue', () => {
  // Both flavours of executor hold, against a serialize group and a together
  // unit — the two places §6.2's rules 4 and 5 interact with a host's own
  // holds, and the only channel a claim reaches the model through.
  const issues = [open('1', 1), open('2', 1), open('3', 1)];
  const edges = [makeEdge('serialize-with', '1', '2'), makeEdge('together-with', '2', '3')];
  for (const active of [true, false]) {
    for (const ref of ['1', '2', '3']) {
      assertChipsAgree(
        document(issues, edges),
        [{ ref, label: 'claimed', detail: 'held by a worker', active }],
        `${active ? 'claim' : 'park'} on #${ref}: `,
      );
    }
  }
});

test('an unresolvable serialize-with links nothing; an unresolvable together-with refuses', () => {
  // The asymmetry stated directly, because the sweep above would also pass if
  // BOTH were blocking. §6.7 is explicit that a `serialize-with` reference that
  // cannot be resolved contributes no linkage — so it excludes nothing, and the
  // chip is a note rather than a hold.
  const issues = [open('1', 1)];
  const serialize = rowFor(
    explainOrder(document(issues, [makeEdge('serialize-with', '1', '404')])),
    '1',
  );
  assert.equal(serialize.ready, true);
  assert.equal(serialize.holds.filter(blocks).length, 0);
  assert.equal(serialize.holds.length, 1, 'it is surfaced for grooming, not dropped');

  const together = rowFor(
    explainOrder(document(issues, [makeEdge('together-with', '1', '404')])),
    '1',
  );
  assert.equal(together.ready, false);
  assert.ok(together.holds.some(blocks), 'the refusal was drawn as a note');
});

test('the store never sees a footer row, and never a ready row with reasons', () => {
  // Two contract points of `OrderDeriver`/`OrderRow` at once. The footer is not
  // in the order — the store computes `entered` and `left` by comparing one
  // order against the next, so a row that was never a candidate reads as a move
  // — and `holdReasons` is documented as empty when ready.
  const rows = createDeriver(seedHolds())(seedDocument());
  const footer = explainOrder(seedDocument(), seedHolds())
    .filter((row) => row.placement === 'footer')
    .map((row) => row.issue.ref);
  assert.ok(footer.length > 0, 'the seed no longer exercises the footer');
  for (const row of rows) {
    assert.ok(!footer.includes(row.ref), `#${row.ref} is a footer row and reached the store`);
    if (row.ready) assert.deepEqual(row.holdReasons, []);
  }
});

test('the ranks the store is handed never go backwards', () => {
  // `OrderRow.rank` is documented as a position rendered in ascending order.
  // A together unit shares one rank, so the array is non-decreasing rather than
  // strictly increasing — which is the property to assert, since a strict one
  // would fail on a correct unit.
  const ranks = createDeriver(seedHolds())(seedDocument()).map((row) => row.rank);
  for (let i = 1; i < ranks.length; i += 1) {
    assert.ok((ranks[i] ?? 0) >= (ranks[i - 1] ?? 0), `rank went backwards at ${String(i)}`);
  }
});

// ---------------------------------------------------------------------------
// 3. The coverage claim — the milestone's own done-when
// ---------------------------------------------------------------------------

test('every edge type is reachable in the seed without editing anything', () => {
  // Enumerated from the vocabulary, not from a list beside it: a sixth edge
  // field fails here rather than going undemonstrated.
  const kinds = new Set(seedDocument().edges.map((edge) => edge.kind));
  for (const field of EDGE_FIELDS) {
    assert.ok(kinds.has(field), `the seed no longer exercises ${field}`);
  }
});

test('both hold families are reachable, and they are drawn in different places', () => {
  const rows = explainOrder(seedDocument(), seedHolds());
  const families = new Set(rows.flatMap((row) => row.holds.map((hold) => hold.family)));
  assert.deepEqual([...families].sort(), ['executor', 'graph']);

  // The distinction the demo states it never blurs: a graph-derived hold sits
  // INLINE at its would-be rank showing no number; an executor-derived one
  // collapses into the footer group, which earns no rank slot at all.
  //
  // OVER CANDIDATES ONLY, and that qualification is the rule rather than a
  // convenience. The spine is the ORDER, and a closed issue is not in it — it
  // is not a candidate at all (§6.2), so the footer is where it belongs
  // whichever family its `closed` hold is drawn from. Asserting otherwise
  // demands that the page rank work nobody can do.
  const candidate = (row: ExplainedRow): boolean =>
    row.issue.state === 'open' &&
    !row.holds.some((hold) => hold.family === 'executor' && blocks(hold));

  const graphHeld = rows.filter(
    (row) =>
      candidate(row) && !row.ready && row.holds.some((hold) => hold.family === 'graph' && blocks(hold)),
  );
  assert.ok(graphHeld.length > 0, 'no graph-derived hold on a candidate in the seed');
  for (const row of graphHeld) {
    assert.equal(row.placement, 'spine', `#${row.issue.ref} left the spine`);
    assert.equal(row.showRank, false, `#${row.issue.ref} showed a rank it cannot occupy`);
  }
  for (const row of rows) {
    if (candidate(row)) continue;
    assert.equal(row.placement, 'footer', `#${row.issue.ref} stayed in the spine`);
    assert.equal(row.showRank, false, `#${row.issue.ref} earned a rank slot it has no claim to`);
  }
});

test('all three readiness stations are reachable in the seed', () => {
  const rows = explainOrder(seedDocument(), seedHolds());
  const stations = new Set(rows.map((row) => row.station));
  assert.deepEqual([...stations].sort(), ['dashed', 'filled', 'hollow']);

  // A hollow station is a SEQUENCING statement, never a hold: it names the rank
  // whose completion frees its slot, and that rank must exist and be earlier.
  for (const row of rows.filter((each) => each.station === 'hollow')) {
    assert.ok(row.ready, `#${row.issue.ref} is hollow and not ready`);
    assert.ok(row.readyAfterRank !== undefined, `#${row.issue.ref} names no rank`);
    assert.ok((row.readyAfterRank ?? 0) < row.rank);
  }
});

test('all three rank-provenance forms are reachable in the seed', () => {
  const forms = new Set(
    explainOrder(seedDocument(), seedHolds()).map((row) => row.provenance.form),
  );
  assert.deepEqual([...forms].sort(), ['declared', 'default-tier', 'promoted']);
});

test('a promotion names the dependent it inherited from, in the spec notation', () => {
  // §6.3: urgency flows backward along blocked-by. The seed's #2 and #3 are
  // declared P3 and block a P0, so both are promoted — and the derivation is
  // what says so, including WHO it arrived through.
  const rows = explainOrder(seedDocument(), seedHolds());
  const promoted = rows.filter((row) => row.provenance.form === 'promoted');
  assert.ok(promoted.length >= 2, 'the seed no longer exercises promotion');
  for (const row of promoted) {
    const { provenance } = row;
    // Bound to a local so the discriminant narrows: reading `row.provenance`
    // again is a fresh property access, which TypeScript will not narrow.
    assert.ok(provenance.form === 'promoted');
    assert.ok(provenance.effective < provenance.declared);
    assert.ok(
      rows.some((each) => each.issue.ref === provenance.from),
      'a promotion named a dependent that is not in the document',
    );
  }
});

test('a serialize footprint includes the unit itself, so a unit alone is not serialized', () => {
  // The derivation's `serializeGroupSize` is the union over a slot's MEMBERS'
  // serialize components, and each component includes its own member — so a
  // together unit of two with no `serialize-with` edge reads 2, exactly as a
  // lone issue reads 1. That is the number `render.ts` decides a "serialized"
  // badge from, and comparing it against 1 drew the badge on a pair nothing
  // serializes. The property the comparison rests on is asserted here, where a
  // test can reach it.
  const rows = explainOrder(seedDocument(), seedHolds());

  const unit = rows.filter((row) => row.togetherGroupSize > 1);
  assert.ok(unit.length > 1, 'the seed no longer exercises a together unit');
  for (const row of unit) {
    assert.equal(
      row.serializeGroupSize,
      row.togetherGroupSize,
      `#${row.issue.ref} is in a unit with no serialize edge, so its footprint is the unit`,
    );
  }

  // The control: a row that IS serialized reaches beyond its own membership,
  // so the comparison separates the two cases rather than suppressing both.
  const serialized = rows.filter(
    (row) => row.serializeGroupSize > Math.max(row.togetherGroupSize, 1),
  );
  assert.ok(serialized.length > 0, 'the seed no longer exercises a serialize group');
  for (const row of serialized) {
    assert.ok(row.holds.some((hold) => hold.label === 'serialized') || row.placement === 'footer');
  }
});

test('a together unit is ONE slot, counted once against the cap', () => {
  // §4.3.7: a together group enters selection as a single unit — one candidate,
  // one claim. Counting its members would report more work running than the
  // concurrency cap allows, in a header sitting directly above the stations
  // that contradict it.
  const rows = explainOrder(seedDocument(), seedHolds());
  const unit = rows.filter((row) => row.togetherGroupSize > 1);
  assert.ok(unit.length > 1, 'the seed no longer exercises a together unit');
  assert.equal(new Set(unit.map((row) => row.rank)).size, 1, 'the unit took more than one rank');
  assert.equal(slotCount(unit), 1);
});

// ---------------------------------------------------------------------------
// The cycle guard
// ---------------------------------------------------------------------------

test('a new blocked-by cycle is refused, and an ordinary edge is not', () => {
  const issues = [open('1', 1), open('2', 1), open('3', 1)];
  const current = document(issues, [makeEdge('blocked-by', '1', '2')]);
  assert.equal(
    introducesCycle(current, document(issues, [...current.edges, makeEdge('blocked-by', '2', '1')])),
    true,
  );
  assert.equal(
    introducesCycle(current, document(issues, [...current.edges, makeEdge('blocked-by', '2', '3')])),
    false,
  );
});

test('a cycle that already exists is surfaced, never re-refused', () => {
  // §6.6: a cycle is detected on read and surfaced for grooming, because
  // write-time rejection pushes writers into describing the dependency in
  // prose. The seed ships one for exactly that reason, so an unrelated edit on
  // top of it must still be allowed.
  const seed = seedDocument();
  const cyclic = explainOrder(seed, seedHolds()).filter((row) =>
    row.holds.some((hold) => hold.label === 'cycle'),
  );
  assert.ok(cyclic.length > 1, 'the seed no longer ships a cycle');
  assert.equal(
    introducesCycle(seed, document(seed.issues, [...seed.edges, makeEdge('blocked-by', '4', '2')])),
    false,
  );
});

test('a cycle closed by COLLAPSING vertices is refused, with no new dependency', () => {
  // This is why the guard is asked of two DOCUMENTS rather than of the edit. A
  // cycle needs no new dependency to appear: `duplicate-of` collapses vertices,
  // so the last edit here adds no `blocked-by` at all and still closes
  // #4 -> #2 -> #4. Extending the guard kind by kind is a list that is always
  // one entry short.
  const issues = [open('2', 1), open('3', 1), open('4', 1)];
  const current = document(issues, [
    makeEdge('blocked-by', '4', '2'),
    makeEdge('blocked-by', '2', '3'),
  ]);
  assert.equal(
    introducesCycle(
      current,
      document(issues, [...current.edges, makeEdge('duplicate-of', '3', '4')]),
    ),
    true,
  );
});

test('KNOWN GAP: a cycle through a together unit is not refused (issuegraph#43)', () => {
  // The demo used to contract a together unit to one vertex before searching,
  // and refused this. The published derivation does not contract, so the swap
  // narrowed the refusal — and the state is a REAL deadlock: #1 waits on the
  // unit, the unit waits on #1, and `Model.cycles` reports nothing.
  //
  // PINNED RATHER THAN PATCHED, on purpose. Re-adding contraction here would
  // rebuild the second reading of the ordering rules this file exists to have
  // removed, and it would disagree with every other consumer of the package.
  // The finding belongs to the package and is filed as
  // https://github.com/autnmy/issuegraph/issues/43; when it lands, this test
  // fails and the demo is revisited rather than the gap being rediscovered.
  const issues = [open('1', 1), open('2', 1), open('3', 1)];
  const current = document(issues, [
    makeEdge('together-with', '2', '3'),
    makeEdge('blocked-by', '1', '2'),
  ]);
  assert.equal(
    introducesCycle(current, document(issues, [...current.edges, makeEdge('blocked-by', '3', '1')])),
    false,
    'the package now contracts together units — remove this pin and delete the gap note',
  );
  // The control: the same shape with no unit is refused, so this test cannot
  // pass against a build whose guard detects nothing at all.
  const flat = document(issues, [makeEdge('blocked-by', '1', '2')]);
  assert.equal(
    introducesCycle(flat, document(issues, [...flat.edges, makeEdge('blocked-by', '2', '1')])),
    true,
  );
});
