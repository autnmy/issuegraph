/**
 * The seed's two claims, executable.
 *
 * THE LANDING STATE IS THE §16a COMP. `seed.ts` says the page lands on the
 * scenario the design's frames were drawn against — the same issues, numbers,
 * ranks, priorities, readiness states and relationships. Each of those is a
 * property of the seed AND of the derivation over it, and a careless edit to
 * either quietly turns the comp back into an argument. So the frame's rows are
 * pinned here, row for row, against what the derivation produces from the seed
 * rather than against what the seed declares.
 *
 * THE DENSE LAYER STILL REACHES EVERYTHING IT EXISTED FOR. It moved behind a
 * control, and `seed.ts` says it exists so the packages are exercised at the
 * size they are built for: a canvas that refuses, capsules to focus, a
 * component too large even when focused, an audit with something to find, a
 * rail longer than its window. Each is pinned against the package constants
 * that decide it rather than against numbers copied from them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_FIELDS } from '@issuegraph/core';
import { type GraphDocument, makeEdge } from '@issuegraph/store';
import { auditDocument, scaleLadder, INITIAL_SCALE_STATE, RAIL_WINDOW } from '@issuegraph/editor';
import { GRAPH_NODE_BUDGET } from '@issuegraph/viewer';

import { projectDocument } from './document.ts';
import { type ExplainedRow, explainDocument } from './order.ts';
import {
  COMP_ORDER,
  DEFAULT_SCENARIO,
  DENSE_FIRST_REF,
  adoptionFor,
  adoptionSeed,
  DENSE_ISOLATED_COUNT,
  DENSE_LARGEST_COMPONENT,
  SCENARIOS,
  type ScenarioName,
  UNRESOLVABLE_REF,
  backlogSeed,
  compSeed,
  denseSeed,
} from './seed.ts';

/** One scenario, derived and projected the way the page does it. */
function load(name: ScenarioName) {
  const scenario = SCENARIOS[name];
  const document = scenario.document();
  const explained = explainDocument(document, scenario.holds, scenario.ranking);
  return { document, explained, ...projectDocument(explained, document) };
}

function rowFor(rows: readonly ExplainedRow[], ref: string): ExplainedRow {
  const found = rows.find((row) => row.issue.ref === ref);
  assert.ok(found !== undefined, `no row for #${ref}`);
  return found;
}

describe('the landing state is the §16a comp', () => {
  const comp = load('comp');

  it('lands on the comp, and the backlog is the comp with the dense layer beneath it', () => {
    assert.equal(DEFAULT_SCENARIO, 'comp');
    assert.deepEqual(SCENARIOS.comp.document(), compSeed());
    const backlog = SCENARIOS.backlog.document();
    assert.deepEqual(backlog.issues.slice(0, comp.document.issues.length), comp.document.issues);
    assert.deepEqual(backlog, backlogSeed());
  });

  it('lists every comp issue in the frames’ order exactly once', () => {
    // The base ranking is the host's own `ORDER BY`, and a reference it does
    // not list sorts last within its tier with a diagnostic — a row that would
    // then be placed by an accident of numbering rather than by the frame.
    assert.deepEqual([...COMP_ORDER].sort(), comp.document.issues.map((issue) => issue.ref).sort());
    assert.equal(new Set(COMP_ORDER).size, COMP_ORDER.length);
  });

  it('runs the spine top to bottom as §16a draws it', () => {
    // The frame, top to bottom: #488 · the unit · #501 · #503 · #530 · #520 ·
    // #487 — then the serialize group's third member, which the frame says
    // exists ("group of 3") and places below the drawn rows ("19 more ranked").
    const spine = comp.explained.rows.filter((row) => row.placement === 'spine');
    assert.deepEqual(
      spine.map((row) => row.issue.ref),
      ['488', '512', '514', '501', '503', '530', '520', '487', '505'],
    );
    // The viewer numbers READY slots only, so where the frame prints `2` on
    // the blocked unit the viewer prints `—` and the numbering closes up. That
    // is the viewer's own rule — "printing one would claim work is queued that
    // nothing can start" — and the spec's `ready` (§6.2) agrees with it; the
    // frame's hollow station on a blocked unit is the one place the two read
    // differently, and the comp is what makes that a glance rather than an
    // argument. Pinned as the viewer draws it.
    assert.deepEqual(
      comp.viewer.order.slots.map((slot) => [slot.rank, slot.members.join('+')]),
      [
        [1, '488'],
        [null, '512+514'],
        [2, '501'],
        [3, '503'],
        [null, '530'],
        [4, '520'],
        [5, '487'],
        [6, '505'],
        // The footer, in the derivation's order: #602 first, promoted to P1
        // by the #530 it blocks; the rest on the default tier.
        [null, '602'],
        [null, '499'],
        [null, '533'],
        [null, '541'],
      ],
    );
  });

  it('promotes #488 from P3 to the unit’s P0, in the spec notation, naming the dependent', () => {
    const row = rowFor(comp.explained.rows, '488');
    assert.equal(row.issue.priority, 3);
    assert.equal(row.effectivePriority, 0);
    assert.deepEqual(row.provenance, { form: 'promoted', declared: 3, effective: 0, from: '512' });
    const drawn = comp.viewer.issues.find((issue) => issue.key === '488')?.provenance;
    assert.ok(drawn?.kind === 'promotion');
    assert.match(drawn.notation, /P3.*0/);
    assert.deepEqual(drawn.promotedBy, ['512']);
    assert.equal(row.station, 'filled', 'rank 1 is ready now');
  });

  it('holds the unit at ONE slot behind #488, with the duplicate excluded beside it', () => {
    const unit = comp.viewer.order.slots.find((slot) => slot.members.includes('512'));
    assert.ok(unit !== undefined);
    assert.deepEqual([...unit.members].sort(), ['512', '514']);
    assert.equal(unit.ready, false);
    // One cause, stated once per member: #512's own blocker, and the same one
    // relayed to #514 as its groupmate's — a unit is ready as a whole or not.
    assert.ok(unit.holds.length > 0);
    for (const hold of unit.holds) {
      assert.equal(hold.family, 'graph');
      assert.match(hold.reason, /blocked by 488/);
    }
    for (const ref of ['512', '514']) {
      assert.equal(rowFor(comp.explained.rows, ref).togetherGroupSize, 2);
      assert.equal(rowFor(comp.explained.rows, ref).station, 'dashed');
    }
    assert.deepEqual(comp.viewer.order.excluded, [{ key: '455', canonical: '512', reason: 'duplicate-of' }]);
  });

  it('computes the serialize group of three without any issue writing it down', () => {
    // Groups are never written down (§6.1): the document holds two edges, and
    // the frame's "group of 3" is the reader's answer over them.
    const written = comp.document.edges.filter((edge) => edge.kind === 'serialize-with');
    assert.equal(written.length, 2);
    for (const ref of ['501', '503', '505']) {
      assert.equal(rowFor(comp.explained.rows, ref).serializeGroupSize, 3, `#${ref}`);
      assert.equal(rowFor(comp.explained.rows, ref).ready, true, `#${ref} — nobody in the group is claimed`);
    }
    // #501 goes first and #503 waits for it: rank 3 is hollow, after rank 1's slot.
    assert.equal(rowFor(comp.explained.rows, '501').station, 'filled');
    assert.equal(rowFor(comp.explained.rows, '503').station, 'hollow');
  });

  it('holds #530 inline at its would-be rank, behind a blocker the order never reaches', () => {
    const held = rowFor(comp.explained.rows, '530');
    assert.equal(held.placement, 'spine');
    assert.equal(held.showRank, false);
    assert.deepEqual(held.holds.map((hold) => [hold.family, hold.label]), [['graph', 'blocked']]);
    // The blocker is open and outside the order: the frame's "open · not
    // eligible". A pick order this host cannot run is stood in for by the
    // host's own hold table, so it lands in the footer, not on the spine.
    const blocker = rowFor(comp.explained.rows, '602');
    assert.equal(blocker.issue.state, 'open');
    assert.equal(blocker.placement, 'footer');
    assert.ok(blocker.holds.some((hold) => hold.family === 'executor' && hold.label === 'not eligible'));
  });

  it('declares a priority only where the frame draws one', () => {
    // The frame prints a tier on the spine rows and none on the `now` row, the
    // footer group, the duplicate or the closed origin. The one row the frame
    // does not draw, #505, is declared P3 so it ranks below everything drawn.
    const declared = comp.document.issues.filter((issue) => issue.priority !== undefined).map((issue) => issue.ref);
    assert.deepEqual(declared.sort(), ['488', '501', '503', '505', '512', '514', '530']);
  });

  it('reads the two undeclared spine rows as the spec default tier, #520 ahead of #487', () => {
    for (const ref of ['520', '487']) {
      const row = rowFor(comp.explained.rows, ref);
      assert.equal(row.issue.priority, undefined);
      assert.deepEqual(row.provenance, { form: 'default-tier', priority: 2 });
    }
    assert.ok(rowFor(comp.explained.rows, '520').rank < rowFor(comp.explained.rows, '487').rank);
  });

  it('collapses the runner-held rows into the footer with no rank slot', () => {
    // The frame's `now` row and its footer group, "held by the runner, not
    // the graph". The viewer has no `now` station, so #499 is an active claim
    // like #533 and sits with it.
    const footer = comp.explained.rows.filter(
      (row) => row.placement === 'footer' && row.issue.state === 'open' && !row.holds.some((hold) => hold.label === 'duplicate'),
    );
    assert.deepEqual(
      footer.map((row) => [row.issue.ref, row.holds.find((hold) => hold.family === 'executor')?.label]).sort(),
      [
        ['499', 'working'],
        ['533', 'claimed'],
        ['541', 'parked'],
        ['602', 'not eligible'],
      ],
    );
    for (const row of footer) assert.equal(row.showRank, false, `#${row.issue.ref}`);
  });

  it('keeps the closed split origin out of the order and reachable by provenance', () => {
    const origin = comp.document.issues.find((issue) => issue.ref === '470');
    assert.equal(origin?.state, 'closed');
    assert.ok(!comp.viewer.order.slots.some((slot) => slot.members.includes('470')));
    assert.ok(comp.document.edges.some((edge) => edge.kind === 'decomposed-from' && edge.from === '488' && edge.to === '470'));
  });

  it('carries every edge type in the comp alone', () => {
    const kinds = new Set(comp.document.edges.map((edge) => edge.kind));
    assert.deepEqual([...kinds].sort(), [...EDGE_FIELDS].sort());
  });
});

describe('the seed is deterministic and layered', () => {
  const seeded = backlogSeed();

  it('produces the same document on every call', () => {
    assert.deepEqual(backlogSeed(), seeded);
    assert.deepEqual(compSeed(), compSeed());
  });

  it('keeps the comp’s numbers above the dense layer’s range, with no reference shared', () => {
    const comp = compSeed();
    const dense = denseSeed();
    const denseLast = Math.max(...dense.issues.map((issue) => Number(issue.ref)));
    for (const issue of dense.issues) assert.ok(Number(issue.ref) >= DENSE_FIRST_REF, issue.ref);
    for (const issue of comp.issues) assert.ok(Number(issue.ref) > denseLast, issue.ref);
    assert.equal(seeded.issues.length, comp.issues.length + dense.issues.length);
  });

  it('issues no reference twice and points every dense edge at a seeded issue', () => {
    const refs = new Set(seeded.issues.map((issue) => issue.ref));
    assert.equal(refs.size, seeded.issues.length);
    for (const edge of denseSeed().edges) {
      assert.ok(refs.has(edge.from), `${edge.id} from`);
      if (edge.to === UNRESOLVABLE_REF) continue;
      assert.ok(refs.has(edge.to), `${edge.id} to`);
    }
    assert.ok(!refs.has(UNRESOLVABLE_REF), 'the unresolvable reference resolves');
  });

  it('keeps the comp’s rows at the head of their tiers when the backlog loads', () => {
    // The backlog is the comp with the dense layer BENEATH it: within a tier
    // the frames' rows come first, and the generated issues fall in behind
    // them. A dense row ahead of a comp row of the same effective priority
    // would mean the ranking had stopped listing the comp first.
    const { explained } = load('backlog');
    const spine = explained.rows.filter((row) => row.placement === 'spine');
    const comp = new Set(compSeed().issues.map((issue) => issue.ref));
    assert.deepEqual(spine.slice(0, 3).map((row) => row.issue.ref), ['488', '512', '514']);
    spine.forEach((row, index) => {
      if (!comp.has(row.issue.ref)) return;
      for (const earlier of spine.slice(0, index)) {
        if (comp.has(earlier.issue.ref)) continue;
        assert.ok(
          earlier.effectivePriority < row.effectivePriority,
          `dense #${earlier.issue.ref} sits ahead of comp #${row.issue.ref} in one tier`,
        );
      }
    });
  });
});

describe('the dense layer reaches the surfaces the sandbox exists for', () => {
  const { document: seeded, viewer, audit } = load('backlog');

  it('is a few hundred issues, most of them edge-free', () => {
    assert.ok(seeded.issues.length >= 250, String(seeded.issues.length));
    const onAnEdge = new Set(seeded.edges.flatMap((edge) => [edge.from, edge.to]));
    const isolated = seeded.issues.filter((issue) => !onAnEdge.has(issue.ref));
    assert.ok(isolated.length >= DENSE_ISOLATED_COUNT, String(isolated.length));
  });

  it('carries every edge type in the dense layer alone', () => {
    const kinds = new Set(denseSeed().edges.map((edge) => edge.kind));
    assert.deepEqual([...kinds].sort(), [...EDGE_FIELDS].sort());
  });

  it('makes the canvas refuse at the top and still refuse on its largest component', () => {
    const top = scaleLadder(viewer, INITIAL_SCALE_STATE);
    assert.notEqual(top.tier, 'direct', `tier ${top.tier} for ${String(top.nodeCount)} nodes`);
    assert.ok(top.nodeCount > GRAPH_NODE_BUDGET);
    const largest = [...top.capsules].sort((a, b) => b.size - a.size)[0];
    assert.ok(largest !== undefined);
    assert.ok(largest.size >= DENSE_LARGEST_COMPONENT, String(largest.size));
    const focused = scaleLadder(viewer, { ...INITIAL_SCALE_STATE, focus: largest.lead });
    assert.notEqual(focused.tier, 'direct', 'the largest component draws when it should refuse');
  });

  it('draws the comp directly, so the landing state is never a refusal', () => {
    const comp = load('comp');
    const top = scaleLadder(comp.viewer, INITIAL_SCALE_STATE);
    assert.equal(top.tier, 'direct', `the comp landed on tier ${top.tier}`);
    assert.ok(top.nodeCount <= GRAPH_NODE_BUDGET);
  });

  it('offers a component small enough to draw when focused', () => {
    const top = scaleLadder(viewer, INITIAL_SCALE_STATE);
    const small = top.capsules.find((capsule) => capsule.size <= GRAPH_NODE_BUDGET);
    assert.ok(small !== undefined, 'every component is past budget, so focus never draws');
    assert.equal(scaleLadder(viewer, { ...INITIAL_SCALE_STATE, focus: small.lead }).tier, 'direct');
  });

  it('flags a cycle on a capsule, so the cycle flag is reachable without editing', () => {
    const top = scaleLadder(viewer, INITIAL_SCALE_STATE);
    assert.ok(top.capsules.some((capsule) => capsule.hasCycle));
  });

  it('gives the audit every class to find', () => {
    const kinds = new Set(auditDocument(audit).map((finding) => finding.kind));
    for (const kind of ['cycle', 'dead-duplicate-ref', 'stale-blocker'] as const) {
      assert.ok(kinds.has(kind), `no ${kind} finding`);
    }
  });

  it('holds one issue on an unresolvable reference, as blocking (§6.7)', () => {
    const { explained } = load('backlog');
    const held = explained.rows.filter((row) => row.holds.some((hold) => hold.label === 'unresolvable'));
    assert.equal(held.length, 1, 'the dense layer no longer ships an unresolvable reference');
    assert.equal(held[0]?.ready, false);
    assert.equal(held[0]?.placement, 'spine');
  });

  it('is longer than one rail window', () => {
    assert.ok(viewer.order.slots.length > RAIL_WINDOW * 2, String(viewer.order.slots.length));
  });

  it('has closed origins for the tree projection and promotions for the rail', () => {
    const closed = new Set(seeded.issues.filter((issue) => issue.state === 'closed').map((issue) => issue.ref));
    assert.ok(
      seeded.edges.some((edge) => edge.kind === 'decomposed-from' && closed.has(edge.to)),
      'no decomposed-from edge points at a closed origin',
    );
    assert.ok(viewer.issues.some((issue) => issue.provenance?.kind === 'promotion'));
  });
});

describe('the adoption count is measured, never remembered', () => {
  it('counts only the issues that CARRY a declaration, not the ones pointed at', () => {
    // `StoredEdge` keeps its pair directed even for the symmetric kinds so the
    // issue carrying the frontmatter field stays known. A target declares
    // nothing — counting both ends roughly doubles the figure and credits
    // adoption to issues with no block at all.
    const document: GraphDocument = {
      issues: [
        { ref: '1', title: 'A', state: 'open' },
        { ref: '2', title: 'B', state: 'open' },
        { ref: '3', title: 'C', state: 'open' },
        { ref: '4', title: 'D', state: 'open' },
      ],
      edges: [makeEdge('blocked-by', '1', '2'), makeEdge('serialize-with', '1', '3')],
    };
    const adoption = adoptionFor({ ...SCENARIOS.backlog, adoption: { counted: true } }, document, false);
    assert.deepEqual(adoption?.counts, { declaring: 1, total: 4 });
  });

  it('answers the document it is given, so an edit moves the count', () => {
    // The chip's whole job is telling "no edges shown" from "no edges declared".
    // A figure captured when the module loaded describes a backlog that no
    // longer exists the moment a visitor adds or deletes a relationship.
    const scenario = { ...SCENARIOS.backlog, adoption: { counted: true } };
    const issues = [
      { ref: '1', title: 'A', state: 'open' as const },
      { ref: '2', title: 'B', state: 'open' as const },
    ];
    assert.deepEqual(adoptionFor(scenario, { issues, edges: [] }, false)?.counts, { declaring: 0, total: 2 });
    assert.deepEqual(
      adoptionFor(scenario, { issues, edges: [makeEdge('blocked-by', '1', '2')] }, false)?.counts,
      { declaring: 1, total: 2 },
    );
  });

  it('gives the day-one document its sentence and no count, and takes the sentence back on a dismiss', () => {
    const document = adoptionSeed();
    const stated = adoptionFor(SCENARIOS.adoption, document, false);
    assert.equal(stated?.counts, undefined, 'the day-one panel double-stated its adoption');
    assert.ok(stated?.note?.text.includes('pick order'));
    assert.equal(adoptionFor(SCENARIOS.adoption, document, true), undefined);
  });

  it('withdraws the day-one sentence the moment a relationship lands', () => {
    // The line is the host's WORDING and the document's CLAIM. The sandbox is
    // editable, so a visitor can falsify the claim — and a sentence saying no
    // issue declares relationships, printed under a relationship, is worse than
    // no sentence at all.
    const document = adoptionSeed();
    const [first, second] = document.issues;
    assert.ok(first !== undefined && second !== undefined);
    const declared: GraphDocument = {
      issues: document.issues,
      edges: [makeEdge('blocked-by', first.ref, second.ref)],
    };
    assert.equal(adoptionFor(SCENARIOS.adoption, declared, false), undefined);
  });
});
