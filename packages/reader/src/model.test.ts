import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildModel, declarerOnlyNode, priorityLabelValue, type NodeInput } from './model.ts';
import type { Frontmatter } from './frontmatter.ts';

/**
 * `haystack.includes(needle)` as an assertion that survives
 * `noUncheckedIndexedAccess` and says what it saw when it fails. An
 * `assert.ok(x.includes(y))` on a possibly-absent element does not typecheck,
 * and widening it with `?.` would let an ABSENT value pass as a non-match
 * without saying so.
 */
function assertIncludes(haystack: string | undefined, needle: string): void {
  assert.ok(
    haystack !== undefined && haystack.includes(needle),
    `expected ${JSON.stringify(haystack)} to contain ${JSON.stringify(needle)}`,
  );
}

const EMPTY: Frontmatter = {
  blockedBy: [],
  decomposedFrom: null,
  duplicateOf: null,
  serializeWith: null,
  togetherWith: null,
  priority: null,
  evidence: null,
};

function node(
  id: string | number,
  overrides: Omit<Partial<NodeInput>, "data"> & { data?: Partial<Frontmatter> | null } = {},
): NodeInput {
  const { data, ...rest } = overrides;
  return {
    id: String(id),
    open: true,
    labels: [],
    assigneeCount: 0,
    // The default the field is REQUIRED to stop a producer omitting: a test that
    // says nothing about the axis is testing a fully-read declaration, which is
    // also the negative control every other test in this file now carries.
    declarationRead: "read",
    ...rest,
    data: data === null ? null : { ...EMPTY, ...(data ?? {}) },
  };
}

const ref = (n: string | number, repo: string | null = null) => ({ repo, id: String(n) });

describe("buildModel readiness (SPEC 6.2)", () => {
  test("an open node with no frontmatter is ready", () => {
    const m = buildModel([node(1, { data: null })]);
    assert.deepEqual(m.readiness("1"), { ready: true, reasons: [], holds: [] });
  });

  test("open blocked-by blocks; closure of the blocker unblocks", () => {
    const blocked = node(2, { data: { blockedBy: [ref(1)] } });
    assert.equal(buildModel([node(1), blocked]).readiness("2").ready, false);
    const m = buildModel([node(1, { open: false, closedStateReason: "completed" }), blocked]);
    assert.equal(m.readiness("2").ready, true);
  });

  test("a non-completed closure unblocks but surfaces a re-groom diagnostic", () => {
    const m = buildModel([
      node(1, { open: false, closedStateReason: "not_planned" }),
      node(2, { data: { blockedBy: [ref(1)] } }),
    ]);
    assert.equal(m.readiness("2").ready, true);
    assert.equal(m.diagnostics.some((d) => d.includes("non-completed closure")), true);
  });

  test("an unresolvable blocked-by ref blocks fail-safe with a diagnostic", () => {
    const m = buildModel([node(2, { data: { blockedBy: [ref(999)] } })]);
    const r = m.readiness("2");
    assert.equal(r.ready, false);
    assertIncludes(r.reasons[0], "unresolvable");
    assert.equal(m.diagnostics.some((d) => d.includes("999")), true);
  });

  test("a duplicate is never ready and resolves transitively to its canonical", () => {
    const m = buildModel([
      node(1),
      node(2, { data: { duplicateOf: ref(1) } }),
      node(3, { data: { duplicateOf: ref(2) } }),
    ]);
    assert.equal(m.readiness("3").ready, false);
    assert.equal(m.duplicateCanonical("3"), "1");
    assert.equal(m.duplicateCanonical("1"), null);
  });

  test("a duplicate chain ending outside the node set still marks the node duplicate", () => {
    const m = buildModel([node(2, { data: { duplicateOf: ref(500) } })]);
    assert.equal(m.readiness("2").ready, false);
    assert.equal(m.duplicateCanonical("2"), "500");
  });

  test("serialize admission: an actively-claimed member holds the whole component out", () => {
    const a = node(1, { assigneeCount: 1 });
    const b = node(2, { data: { serializeWith: ref(1) } });
    const c = node(3, { data: { serializeWith: ref(2) } }); // chain joins one component
    const m = buildModel([a, b, c]);
    assert.deepEqual(m.serializeComponent("3"), ["1", "2", "3"]);
    assert.equal(m.readiness("2").ready, false);
    assert.equal(m.readiness("3").ready, false);
    const released = buildModel([node(1), b, c]);
    assert.equal(released.readiness("2").ready, true);
  });

  test("together units are ready as a whole or not at all, over boundary-crossing edges only", () => {
    const external = node(9);
    const a = node(1, { data: { togetherWith: ref(2) } });
    const b = node(2, { data: { blockedBy: [ref(9)] } });
    const m = buildModel([external, a, b]);
    assert.deepEqual(m.togetherComponent("1"), ["1", "2"]);
    assert.equal(m.readiness("1").ready, false); // member 2 blocked externally
    assertIncludes(m.readiness("1").reasons[0], "together member 2");

    // Internal blocked-by (member on member) is advisory, never a readiness input.
    const a2 = node(1, { data: { togetherWith: ref(2) } });
    const b2 = node(2, { data: { blockedBy: [ref(1)] } });
    const m2 = buildModel([a2, b2]);
    assert.equal(m2.readiness("1").ready, true);
    assert.equal(m2.readiness("2").ready, true);

    // A closed member leaves the unit.
    const m3 = buildModel([
      node(1, { data: { togetherWith: ref(2) } }),
      node(2, { open: false, closedStateReason: "completed", data: { blockedBy: [ref(9)] } }),
      node(9),
    ]);
    assert.equal(m3.readiness("1").ready, true);
  });

  test("an unknown key reports unready with an unknown-node reason", () => {
    const m = buildModel([node(1)]);
    assert.deepEqual(m.readiness("77"), {
      ready: false,
      reasons: ["unknown node"],
      holds: [{ code: "unknown-node", text: "unknown node" }],
    });
  });
});

describe("declared and effective priority (SPEC 4.3.5 / 6.3)", () => {
  test("labels are canonical over the frontmatter value, with a disagreement diagnostic", () => {
    const m = buildModel([node(1, { labels: ["P1"], data: { priority: 3 } })]);
    const p = m.declaredPriority("1");
    assert.deepEqual(p, {
      value: 1,
      source: "label",
      labelValue: 1,
      frontmatterValue: 3,
      disagreement: true,
    });
    assert.equal(m.diagnostics.some((d) => d.includes("disagrees")), true);
  });

  test("several priority labels resolve to the MOST URGENT of them", () => {
    // Found by a mutation probe rather than by reading: turning the fold from
    // `min` to `max` left every test in this suite green, so the rule that
    // several labels resolve to the lowest was documented and unpinned. Both
    // orders are exercised, because a fold that simply keeps the FIRST label it
    // sees passes one of them by luck.
    const ascending = buildModel([node(1, { labels: ["P1", "P3"] })]);
    assert.equal(ascending.declaredPriority("1").value, 1);
    const descending = buildModel([node(1, { labels: ["P3", "P1"] })]);
    assert.equal(descending.declaredPriority("1").value, 1);
    assert.equal(priorityLabelValue(["p2", "P0", "P3"]), 0);
  });

  test("frontmatter is the fallback; default is 2", () => {
    const m = buildModel([node(1, { data: { priority: 0 } }), node(2)]);
    const fromFrontmatter = m.declaredPriority("1");
    assert.equal(fromFrontmatter.value, 0);
    assert.equal(fromFrontmatter.source, "frontmatter");
    const fromDefault = m.declaredPriority("2");
    assert.equal(fromDefault.value, 2);
    assert.equal(fromDefault.source, "default");
  });

  test("a together unit shares the highest priority among its members (SPEC 6.3)", () => {
    // "A together group's effective priority is the highest over its members."
    // Read in BOTH directions, because a relaxation that only walks one way
    // settles the component on whichever member the worklist happened to pop
    // first.
    const m = buildModel([
      node(1, { labels: ["p0"], data: { togetherWith: ref(2) } }),
      node(2, { labels: ["p3"] }),
    ]);
    assert.equal(m.effectivePriority("1"), 0);
    assert.equal(m.effectivePriority("2"), 0);
    assert.equal(m.declaredPriority("2").value, 3, "the DECLARED value is untouched");
  });

  test("a together unit's urgency reaches the blockers of its raised member", () => {
    // The half a two-pass implementation loses: #2 is only urgent BECAUSE of
    // the unit, so a blocked-by pass that ran before the together fold — or
    // after it, without re-relaxing — leaves #3 at its declared priority while
    // it sits on the unit's critical path.
    const m = buildModel([
      node(1, { labels: ["p0"], data: { togetherWith: ref(2) } }),
      node(2, { labels: ["p3"], data: { blockedBy: [ref(3)] } }),
      node(3, { labels: ["p3"] }),
    ]);
    assert.equal(m.effectivePriority("2"), 0);
    assert.equal(m.effectivePriority("3"), 0);
  });

  test("a closed together member neither lends the unit urgency nor takes any", () => {
    // Closed members leave the unit (SPEC 4.3.7) — so a finished P0 must not
    // keep its open partner at P0, and an open P0 must not drag a finished
    // partner's number down. Enforced at the UNION, which admits an edge only
    // when both endpoints are open, so this pins the rule rather than any one
    // guard: a probe that deletes a guard downstream of the union breaks
    // nothing, and this test still fails if the union starts admitting them.
    const m = buildModel([
      node(1, { labels: ["p0"], open: false, closedStateReason: "completed", data: { togetherWith: ref(2) } }),
      node(2, { labels: ["p3"] }),
      node(3, { labels: ["p0"], data: { togetherWith: ref(4) } }),
      node(4, { labels: ["p3"], open: false, closedStateReason: "completed" }),
    ]);
    assert.equal(m.effectivePriority("2"), 3);
    assert.equal(m.effectivePriority("4"), 3);
    assert.equal(m.effectivePriority("3"), 0);
  });

  test("importance flows backward: a p3 blocker of a p0 dependent is effectively p0", () => {
    const m = buildModel([
      node(1, { labels: ["p3"] }),
      node(2, { labels: ["p0"], data: { blockedBy: [ref(1)] } }),
    ]);
    assert.equal(m.effectivePriority("1"), 0);
    assert.equal(m.effectivePriority("2"), 0);
  });

  test("propagates through chains but not from closed dependents", () => {
    const m = buildModel([
      node(1, { labels: ["p3"] }),
      node(2, { labels: ["p2"], data: { blockedBy: [ref(1)] } }),
      node(3, { labels: ["p0"], data: { blockedBy: [ref(2)] } }),
    ]);
    assert.equal(m.effectivePriority("1"), 0);

    const closedDependent = buildModel([
      node(1, { labels: ["p3"] }),
      node(2, { open: false, closedStateReason: "completed", labels: ["p0"], data: { blockedBy: [ref(1)] } }),
    ]);
    assert.equal(closedDependent.effectivePriority("1"), 3);
  });

  test("terminates and reports blocked-by cycles among open nodes", () => {
    const m = buildModel([
      node(1, { labels: ["p1"], data: { blockedBy: [ref(2)] } }),
      node(2, { data: { blockedBy: [ref(1)] } }),
    ]);
    assert.ok(m.cycles.length > 0);
    assert.equal(m.effectivePriority("2"), 1);
    assert.equal(m.readiness("1").ready, false);
    assert.equal(m.diagnostics.some((d) => d.includes("cycle")), true);
  });
});

describe("overlapping cycles (SPEC 6.6 stuck groups)", () => {
  test("reports every member of overlapping cycles as one SCC", () => {
    // 1 -> 2 -> 1 and 2 -> 3 -> 2 overlap at 2: one SCC {1,2,3}.
    const m = buildModel([
      node(1, { data: { blockedBy: [ref(2)] } }),
      node(2, { data: { blockedBy: [ref(1), ref(3)] } }),
      node(3, { data: { blockedBy: [ref(2)] } }),
    ]);
    assert.equal(m.cycles.length, 1);
    assert.deepEqual(m.cycles[0], ["1", "2", "3"]);
  });

  test("reports a cycle that runs THROUGH a together unit", () => {
    // §4.3.7 makes a together group ONE schedulable unit, so the search runs
    // over units rather than over issues. Without that contraction this state
    // was a permanent deadlock reported NOWHERE: #2 waits on its partner #3,
    // #3 waits on #1, #1 waits on #2, and every readiness sentence named an
    // ordinary open blocker while `cycles` and `diagnostics` were both empty.
    // §6.6's whole argument for detect-on-read is that a groomer can see the
    // cycle, and that argument fails for a cycle with no surface.
    const m = buildModel([
      node(1, { data: { blockedBy: [ref(2)] } }),
      node(2, { data: { togetherWith: ref(3) } }),
      node(3, { data: { blockedBy: [ref(1)] } }),
    ]);
    // REPORTED AS ISSUE KEYS, every open member of every unit in the group —
    // a groomer needs issues it can open, not a vertex name.
    assert.deepEqual(m.cycles, [["1", "2", "3"]]);
    assert.equal(m.diagnostics.some((d) => d.includes("cycle")), true);
  });

  test("does NOT report a unit whose only circularity is internal", () => {
    // The other side of the same rule, and the reason the contraction drops
    // internal edges: §4.3.7 says a member-blocking-member edge is advisory and
    // never a readiness input, because it "would deadlock the group against
    // itself". Counting it would report every unit carrying its own ordering as
    // stuck — a false stuck group on a shape the spec blesses.
    const m = buildModel([
      node(1, { data: { togetherWith: ref(2) } }),
      node(2, { data: { blockedBy: [ref(1)] } }),
    ]);
    assert.deepEqual(m.cycles, []);
  });

  test("reports a self-loop on a MEMBER of a multi-issue unit", () => {
    // The distinction the contraction turns on: `#1 blocked-by #1` is not
    // "advisory ordering between two members", it is an issue blocking itself.
    // Readiness already treats it as load-bearing — its exemption is guarded on
    // `b !== k` — so exempting it here reported nothing while BOTH issues were
    // permanently unready: empty `cycles`, empty `diagnostics`, and a unit that
    // can never start. That is this section's own defect, one case over.
    const m = buildModel([
      node(1, { data: { blockedBy: [ref(1)], togetherWith: ref(2) } }),
      node(2),
    ]);
    assert.deepEqual(m.cycles, [["1", "2"]]);
    assert.equal(m.readiness("1").ready, false);
    assert.equal(m.readiness("2").ready, false);
  });

  test("still reports a self-loop, which contraction must not swallow", () => {
    // A singleton's unit IS itself, so "drop edges inside the unit" would erase
    // §6.6's own self-loop case. The drop is therefore conditioned on the unit
    // having more than one member, and this is what pins that condition.
    const m = buildModel([node(9, { data: { blockedBy: [ref(9)] } })]);
    assert.deepEqual(m.cycles, [["9"]]);
  });

  test("reports a plain 3-ring whose middle nodes have no direct back-edge", () => {
    const m = buildModel([
      node(1, { data: { blockedBy: [ref(2)] } }),
      node(2, { data: { blockedBy: [ref(3)] } }),
      node(3, { data: { blockedBy: [ref(1)] } }),
    ]);
    assert.equal(m.cycles.length, 1);
    assert.deepEqual(m.cycles[0], ["1", "2", "3"]);
  });

  test("reports a self-loop and keeps acyclic chains clean", () => {
    const m = buildModel([
      node(1, { data: { blockedBy: [ref(1)] } }),
      node(2, { data: { blockedBy: [ref(3)] } }),
      node(3),
    ]);
    assert.equal(m.cycles.length, 1);
    assert.deepEqual(m.cycles[0], ["1"]);
  });
});

describe("scale and closed-node contracts", () => {
  test("a closed blocker keeps its declared priority", () => {
    const m = buildModel([
      node(1, { open: false, closedStateReason: "completed", labels: ["p3"] }),
      node(2, { labels: ["p0"], data: { blockedBy: [ref(1)] } }),
    ]);
    assert.equal(m.effectivePriority("1"), 3);
    assert.equal(m.readiness("2").ready, true);
  });

  test("builds a 6000-node open chain without overflowing and propagates EP", () => {
    const nodes = [node(1, { labels: ["p0"], data: { blockedBy: [ref(2)] } })];
    for (let i = 2; i < 6000; i++) {
      nodes.push(node(i, { labels: ["p3"], data: { blockedBy: [ref(i + 1)] } }));
    }
    nodes.push(node(6000, { labels: ["p3"] }));
    const m = buildModel(nodes);
    assert.deepEqual(m.cycles, []);
    assert.equal(m.effectivePriority("6000"), 0);
    assert.equal(m.readiness("6000").ready, true);
    assert.equal(m.readiness("1").ready, false);
  });
});

describe("model purity", () => {
  test("repeated calls never grow diagnostics", () => {
    const m = buildModel([
      node(1, { open: false, closedStateReason: "not_planned" }),
      node(2, { data: { blockedBy: [ref(1)] } }),
    ]);
    const before = m.diagnostics.length;
    m.readiness("2");
    m.readiness("2");
    m.duplicateCanonical("2");
    assert.equal(m.diagnostics.length, before);
  });

  test("bare refs resolve relative to the SOURCE node's repo", () => {
    const m = buildModel([
      node(4, { repo: "autnmy/issuegraph" }),
      node(5, { repo: "autnmy/issuegraph", data: { blockedBy: [ref(4)] } }),
    ]);
    // 5's bare ref to 4 means autnmy/issuegraph#4 — present and open.
    const r = m.readiness("autnmy/issuegraph#5");
    assert.equal(r.ready, false);
    assertIncludes(r.reasons[0], "autnmy/issuegraph#4 is open");
    assert.equal(m.diagnostics.some((d) => d.includes("unresolvable")), false);
  });

  test("duplicate chains resolve each hop in its own repo", () => {
    const m = buildModel([
      node(1, { repo: "autnmy/issuegraph", data: { duplicateOf: ref(2) } }),
      node(2, { repo: "autnmy/issuegraph" }),
    ]);
    assert.equal(m.duplicateCanonical("autnmy/issuegraph#1"), "autnmy/issuegraph#2");
  });

  test("diagnoses a duplicate chain that leaves the node set", () => {
    const m = buildModel([node(2, { data: { duplicateOf: ref(500) } })]);
    assert.equal(m.duplicateCanonical("2"), "500");
    assert.equal(m.diagnostics.some((d) => d.includes("leaves the node set")), true);
  });

  test("resolves long duplicate chains with memoization intact", () => {
    const nodes = [];
    for (let i = 1; i < 3000; i++) nodes.push(node(i, { data: { duplicateOf: ref(i + 1) } }));
    nodes.push(node(3000));
    const m = buildModel(nodes);
    assert.equal(m.duplicateCanonical("1"), "3000");
    assert.equal(m.duplicateCanonical("2999"), "3000");
    assert.equal(m.duplicateCanonical("3000"), null);
  });

  test("a together member closed non-completed still surfaces its re-groom signal", () => {
    const m = buildModel([
      node(1, { data: { togetherWith: ref(2), blockedBy: [ref(2)] } }),
      node(2, { open: false, closedStateReason: "not_planned" }),
    ]);
    assert.equal(m.readiness("1").ready, true); // closed member left the unit; closure unblocks
    assert.equal(m.diagnostics.some((d) => d.includes("non-completed closure")), true);
  });

  test("every duplicate-cycle member stays a duplicate, including self-refs", () => {
    const m = buildModel([
      node(1, { data: { duplicateOf: ref(2) } }),
      node(2, { data: { duplicateOf: ref(1) } }),
    ]);
    assert.notEqual(m.duplicateCanonical("1"), null);
    assert.notEqual(m.duplicateCanonical("2"), null);
    assert.equal(m.readiness("1").ready, false);
    assert.equal(m.readiness("2").ready, false);

    const self = buildModel([node(9, { data: { duplicateOf: ref(9) } })]);
    assert.notEqual(self.duplicateCanonical("9"), null);
    assert.equal(self.readiness("9").ready, false);
  });

  test("a closed member does not bridge two open together members", () => {
    const m = buildModel([
      node(1, { data: { togetherWith: ref(2) } }),
      node(2, { open: false, closedStateReason: "completed" }),
      node(3, { data: { togetherWith: ref(2), blockedBy: [ref(8)] } }),
      node(8),
    ]);
    // 1 and 3 both linked only via closed 2: separate active units.
    assert.ok(!m.togetherComponent("1").includes("3"));
    assert.equal(m.readiness("1").ready, true); // 3's external blocker is not 1's problem
    assert.equal(m.readiness("3").ready, false);
  });

  test("repo casing differences do not break ref resolution", () => {
    const m = buildModel([
      node(4, { repo: "Autnmy/Issuegraph" }),
      node(2, { data: { blockedBy: [ref(4, "autnmy/issuegraph")] } }),
    ]);
    // Ref-side variance too: a mixed-case REF must land on the same key.
    const refSide = buildModel([
      node(4, { repo: "autnmy/issuegraph" }),
      node(2, { data: { blockedBy: [ref(4, "AUTNMY/Issuegraph")] } }),
    ]);
    assert.equal(refSide.readiness("2").ready, false);
    assert.equal(refSide.diagnostics.some((d) => d.includes("unresolvable")), false);
    assert.equal(m.readiness("2").ready, false);
    assertIncludes(m.readiness("2").reasons[0], "autnmy/issuegraph#4 is open");
    assert.equal(m.diagnostics.some((d) => d.includes("unresolvable")), false);
  });

  test("qualified refs naming the home repo resolve to bare home keys", () => {
    const m = buildModel(
      [node(1), node(2, { data: { blockedBy: [ref(1, "Acme/App")] } })],
      { homeRepo: "acme/app" },
    );
    assert.equal(m.readiness("2").ready, false);
    assertIncludes(m.readiness("2").reasons[0], "blocked-by 1 is open");
    assert.equal(m.diagnostics.some((d) => d.includes("unresolvable")), false);
  });

  test("a together unit survives its OWN atomic claim across a shared serialize edge", () => {
    // A together unit is claimed atomically (SPEC 4.3.7), so every member is
    // assigned as the unit is taken. Where the unit also shares a serialize
    // component, each member would read its partner's assignment as a
    // conflicting claim and the unit would go unready the instant it was
    // claimed — post-claim re-verification then fails on a unit nobody else is
    // touching. `NodeInput.assigneeCount` already names this case as the reason
    // self-exclusion exists; the exclusion was narrower than its own rationale.
    const unit = (assigneeCount: number) =>
      buildModel([
        node(1, { assigneeCount, data: { togetherWith: ref(2), serializeWith: ref(2) } }),
        node(2, { assigneeCount }),
      ]);
    assert.equal(unit(0).readiness("1").ready, true, "unclaimed");
    assert.deepEqual(unit(1).readiness("1"), { ready: true, reasons: [], holds: [] }, "after its own claim");
    assert.deepEqual(unit(1).readiness("2"), { ready: true, reasons: [], holds: [] }, "from the other member");
  });

  test("CONTROL: an OUTSIDE claim in the same serialize component still refuses the unit", () => {
    // The exclusion must cover the unit and stop there. Without this the fix
    // above reads as correct while having disabled the serialize edge for any
    // node that happens to belong to a together unit — which is the failure the
    // edge exists to prevent, arriving through the fix for a different one.
    const m = buildModel([
      node(1, { data: { togetherWith: ref(2), serializeWith: ref(3) } }),
      node(2),
      node(3, { assigneeCount: 1 }),
    ]);
    assertIncludes(m.readiness("1").reasons.join(" "), "serialize group member 3 is actively claimed");
  });

  test("a duplicate contributes no relationship edges, so it cannot refuse live work", () => {
    // Stale metadata on an ignored issue must not reach the canonical work.
    // #2 is a duplicate carrying `together-with: 3`; reading that edge unioned
    // it with #3, and #2's permanent duplicate unreadiness then made #3 — real,
    // canonical, unrelated work — unselectable.
    const m = buildModel([node(1), node(2, { data: { duplicateOf: ref(1), togetherWith: ref(3) } }), node(3)]);
    assert.deepEqual(m.readiness("3"), { ready: true, reasons: [], holds: [] });
    assert.deepEqual(m.togetherComponent("3"), ["3"]);
    // The duplicate is still a duplicate: its own duplicate-of is read, which
    // is the one edge the guard must not drop.
    assert.deepEqual(m.readiness("2"), {
      ready: false,
      reasons: ["duplicate-of another issue"],
      holds: [{ code: "duplicate", text: "duplicate-of another issue" }],
    });
    assert.equal(m.duplicateCanonical("2"), "1");
  });

  test("a duplicate's blocked-by and serialize-with are ignored too", () => {
    // The same rule on the other two edge types, because a guard that only
    // covered together-with would read as fixed while leaving two ways in.
    const blocking = buildModel([node(1), node(2, { data: { duplicateOf: ref(1), blockedBy: [ref(3)] } }), node(3)]);
    assert.deepEqual(blocking.readiness("3"), { ready: true, reasons: [], holds: [] });

    const claimed = buildModel([
      node(1),
      node(2, { assigneeCount: 1, data: { duplicateOf: ref(1), serializeWith: ref(3) } }),
      node(3),
    ]);
    assert.deepEqual(claimed.readiness("3"), { ready: true, reasons: [], holds: [] });
  });

  test("SPEC 6.7 treats the three unresolvable references differently, and so must this", () => {
    // The section is explicit and the three arms are not interchangeable:
    // blocked-by MUST block (unknown state is not "closed"); serialize-with
    // "contributes no linkage but is likewise surfaced"; together-with is not
    // named, and refusing its declarer stays the fail-safe reading because a
    // unit is ready as a whole or not at all (SPEC 4.3.7).
    //
    // Written as one test because the three arms are one rule read three ways,
    // and pinning any of them alone lets another drift into its behaviour —
    // which is how the serialize arm ended up with the blocked-by arm's.

    // blocked-by: BLOCKS.
    const blocking = buildModel([node(1, { data: { blockedBy: [ref(40)] } })]);
    assert.equal(blocking.readiness("1").ready, false);
    assertIncludes(blocking.readiness("1").reasons.join(" "), "blocked-by 40 is unresolvable");

    // serialize-with: NO LINKAGE, and nobody is refused — not the declarer, not
    // its component. This is the arm that used to refuse both.
    const serial = buildModel([node(1, { data: { serializeWith: ref(40) } }), node(2, { data: { serializeWith: ref(1) } })]);
    assert.deepEqual(serial.readiness("1"), { ready: true, reasons: [], holds: [] }, "the declarer");
    assert.deepEqual(serial.readiness("2"), { ready: true, reasons: [], holds: [] }, "its component peer");
    assert.deepEqual(serial.serializeComponent("1"), ["1", "2"], "no linkage to the missing target");
    // "...but are likewise surfaced" — silence here would be the other failure,
    // and a reader with no signal cannot groom what it could not resolve.
    assert.equal(
      serial.diagnostics.some((d) => d.includes("serialize-with 40 is unresolvable")),
      true,
      "surfaced",
    );

    // together-with: refuses its DECLARER, and only its declarer.
    const unit = buildModel([node(1, { data: { serializeWith: ref(2) } }), node(2, { data: { togetherWith: ref(40) } })]);
    assert.deepEqual(unit.readiness("1"), { ready: true, reasons: [], holds: [] });
    assertIncludes(unit.readiness("2").reasons.join(" "), "together-with 40 is unresolvable");
  });

  test("an edge POINTING AT a duplicate resolves to its canonical", () => {
    // The other half of "a duplicate is not in the relationship graph". The
    // outgoing guard stops a duplicate DECLARING; without this, a canonical
    // issue naming a duplicate as its target still pulled it in and inherited
    // its permanent unreadiness.
    const m = buildModel([node(1), node(2, { data: { duplicateOf: ref(1) } }), node(3, { data: { togetherWith: ref(2) } })]);
    assert.deepEqual(m.readiness("3"), { ready: true, reasons: [], holds: [] });
    assert.deepEqual(m.togetherComponent("3"), ["1", "3"], "resolved to the canonical, not dropped");

    // RESOLVED, NOT IGNORED, and blocked-by is why: the work named by a
    // duplicate is still open under another number, so dropping the edge would
    // UNDER-block — the one direction this model never resolves toward.
    const blocked = buildModel([node(1), node(2, { data: { duplicateOf: ref(1) } }), node(3, { data: { blockedBy: [ref(2)] } })]);
    assert.equal(blocked.readiness("3").ready, false);
    assertIncludes(blocked.readiness("3").reasons.join(" "), "blocked-by 1 is open");

    // ...and it clears when the CANONICAL closes, not when the duplicate does.
    const done = buildModel([
      node(1, { open: false, closedStateReason: "completed" }),
      node(2, { data: { duplicateOf: ref(1) } }),
      node(3, { data: { blockedBy: [ref(2)] } }),
    ]);
    assert.deepEqual(done.readiness("3"), { ready: true, reasons: [], holds: [] });
  });

  test("a claimed singleton stays READY — assignment is eligibility, not readiness", () => {
    // Pins the declined round-7 finding: SPEC 6.8 composes ready AND eligible;
    // folding claim state into readiness would break post-claim re-verification.
    const m = buildModel([node(1, { assigneeCount: 1 })]);
    assert.equal(m.readiness("1").ready, true);
  });

  test("duplicate cycles normalize their targets against the home repo", () => {
    const m = buildModel(
      [
        node(1, { data: { duplicateOf: ref(2, "Acme/App") } }),
        node(2, { data: { duplicateOf: ref(1) } }),
      ],
      { homeRepo: "acme/app" },
    );
    // Value-exact: the cycle entry's fallback must land on the BARE home key,
    // not a phantom qualified key no node carries.
    assert.equal(m.duplicateCanonical("1"), "2");
    assert.notEqual(m.duplicateCanonical("2"), null);
    assert.equal(m.readiness("1").ready, false);
    assert.equal(m.readiness("2").ready, false);
  });

  test("cross-repo nodes key correctly", () => {
    const m = buildModel([
      node(4, { repo: "autnmy/issuegraph" }),
      node(2, { data: { blockedBy: [ref(4, "autnmy/issuegraph")] } }),
    ]);
    assert.equal(m.readiness("2").ready, false);
    assertIncludes(m.readiness("2").reasons[0], "autnmy/issuegraph#4");
  });
});

// A declarer-only node is how an EVENTUALLY-CONSISTENT source joins the model
// (#7389 r1). It may DECLARE — its own frontmatter unions components, adds
// blockers, carries its claim — and it may never ANSWER: no other node's
// reference resolves to it, so a reference the strongly-consistent read left
// unresolvable stays unresolvable. The whole point is that adding such nodes is
// MONOTONE on refusals: it can add reasons, never remove one.
describe("declarer-only nodes declare but never answer", () => {
  const declarer = (n: number, overrides: Parameters<typeof node>[1] = {}) =>
    declarerOnlyNode(node(n, overrides));

  test("is not a selectable candidate: out of keys, and never ready", () => {
    // The tier may add constraints and may never satisfy one. A weak node that
    // LOOKS open and ready is the shape a behind copy produces, and exposing it
    // by enumeration lets a scheduler dispatch work whose only evidence is the
    // eventually-consistent source.
    const m = buildModel([node(1)], { declarerOnlyNodes: [declarer(40)] });
    assert.deepEqual(m.keys, ["1"], "enumeration");
    assert.equal(m.readiness("40").ready, false, "and by direct lookup");
    // Still VISIBLE, just not selectable — a caller holding the key already
    // knows where it came from.
    assert.notEqual(m.readiness("40").reasons.length, 0);
    assert.equal(m.declaredPriority("40").value, 2);
  });

  test("a unit containing a weak member is not ready, from either side", () => {
    // §4.3.7 makes the claim atomic, so a unit is selectable only if every
    // member is. A weak member is by definition not — and the refusal has to
    // reach the FULL node, because that is the key a scheduler holds.
    const weak = declarerOnlyNode(node(40, { data: { togetherWith: ref(1) } }));
    const m = buildModel([node(1)], { declarerOnlyNodes: [weak] });
    assert.deepEqual(m.togetherComponent("1"), ["1", "40"], "the weak node's own edge still unions");
    assert.equal(m.readiness("1").ready, false, "the full node it would be claimed with");
    assert.equal(m.readiness("40").ready, false, "and the weak member itself");
  });

  test("REGRESSION: a weak node's duplicate-of never satisfies somebody's blocked-by", () => {
    // The sharpest form of the contract, and the way it was broken: adding the
    // weak node REMOVED a refusal. Its stale `duplicate-of` carried the
    // reference onto a closed canonical, and a blocked-by that was blocking
    // without it came back satisfied. Adding weak input must only ever be
    // neutral or stricter — never looser.
    const weak = declarerOnlyNode(node(40, { data: { duplicateOf: ref(9) } }));
    const nodes = [
      node(1, { data: { blockedBy: [ref(40)] } }),
      node(9, { open: false, closedStateReason: "completed" }),
    ];
    const without = buildModel(nodes);
    const with_ = buildModel(nodes, { declarerOnlyNodes: [weak] });
    assert.equal(without.readiness("1").ready, false, "blocking without the weak node");
    assert.deepEqual(
      with_.readiness("1"),
      without.readiness("1"),
      "adding a weak node must not change the answer",
    );
  });

  test("does not resolve somebody else's serialize-with", () => {
    const m = buildModel([node(1, { data: { serializeWith: ref(40) } })], {
      declarerOnlyNodes: [declarer(40)],
    });
    // The UNION is what this test is about: the weak tier may add constraints
    // and may never satisfy one, so the reference stays unresolved and the
    // component is the declarer alone. Observed through the diagnostic rather
    // than through readiness — SPEC 6.7 gives an unresolvable serialize-with no
    // linkage and no refusal, so a readiness assertion here would be pinning
    // the wrong half and would go green again the moment that rule regressed.
    assert.deepEqual(m.serializeComponent("1"), ["1"]);
    assert.equal(
      m.diagnostics.some((d) => d.includes("serialize-with 40 is unresolvable")),
      true,
    );
  });

  test("does not resolve somebody else's blocked-by", () => {
    const m = buildModel([node(2, { data: { blockedBy: [ref(40)] } })], {
      declarerOnlyNodes: [declarer(40)],
    });
    assertIncludes(m.readiness("2").reasons.join(" "), "blocked-by 40 is unresolvable");
  });

  test("does not resolve somebody else's together-with", () => {
    const m = buildModel([node(1, { data: { togetherWith: ref(40) } })], {
      declarerOnlyNodes: [declarer(40)],
    });
    assertIncludes(m.readiness("1").reasons.join(" "), "together-with 40 is unresolvable");
    assert.deepEqual(m.togetherComponent("1"), ["1"]);
  });

  test("does not carry somebody else's duplicate-of chain any further", () => {
    // The chain leaves the RESOLVABLE node set at 40 whether or not the weak
    // tier holds it — so the canonical is 40 either way and the node stays a
    // duplicate. Pinned because "same answer" is a conclusion, not an accident:
    // a future edit that let the chain walk INTO the weak tier would move the
    // canonical off a copy.
    const m = buildModel([node(1, { data: { duplicateOf: ref(40) } })], {
      declarerOnlyNodes: [declarer(40, { data: { duplicateOf: ref(41) } }), declarer(41)],
    });
    assert.equal(m.duplicateCanonical("1"), "40");
  });

  test("STILL declares: its own serialize-with unions, and its claim refuses the component", () => {
    // The opposite direction — the reverse edge this tier exists to carry. Here
    // the weak node is the DECLARER and the full node is the target, so the ref
    // resolves and the component forms.
    const m = buildModel([node(1)], {
      declarerOnlyNodes: [declarer(40, { assigneeCount: 1, data: { serializeWith: ref(1) } })],
    });
    assert.deepEqual(m.serializeComponent("1"), ["1", "40"]);
    assertIncludes(m.readiness("1").reasons.join(" "), "serialize group member 40 is actively claimed");
  });

  test("loses the key dedupe to a full node, whatever the argument order", () => {
    const m = buildModel([node(40, { open: false, closedStateReason: "completed" })], {
      declarerOnlyNodes: [declarer(40, { open: true })],
    });
    // The full node decided `open`, so the dependent is released — the weak
    // copy claiming otherwise changed nothing.
    const m2 = buildModel(
      [node(40, { open: false, closedStateReason: "completed" }), node(2, { data: { blockedBy: [ref(40)] } })],
      { declarerOnlyNodes: [declarer(40, { open: true })] },
    );
    assert.equal(m.readiness("40").ready, false); // closed
    assert.equal(m2.readiness("2").ready, true);
  });

  test("never turns a self-block into an exempt together-internal edge", () => {
    // `blocked-by: <self>` is a groomed-graph defect and it BLOCKS. Joining a
    // together component must not change that — otherwise merely being NAMED by
    // a weak declarer would release the node.
    const selfBlocked = node(1, { data: { blockedBy: [ref(1)] } });
    assert.equal(buildModel([selfBlocked]).readiness("1").ready, false);
    const m = buildModel([selfBlocked], {
      declarerOnlyNodes: [declarer(40, { data: { togetherWith: ref(1) } })],
    });
    assert.deepEqual(m.togetherComponent("1"), ["1", "40"]);
    assert.equal(m.readiness("1").ready, false);
  });
});

describe("under-read declarations", () => {
  test("an under-read node is refused where a fully-read one is admitted", () => {
    // THE ACCEPTANCE, and it is stated as a PAIR on purpose: a test that only
    // shows the refusal cannot distinguish "the axis works" from "this fixture
    // was unready anyway". The two nodes differ in exactly one field.
    const m = buildModel([
      node(1, { declarationRead: "read" }),
      node(2, { declarationRead: "under-read" }),
    ]);
    assert.deepEqual(m.readiness("1"), { ready: true, reasons: [], holds: [] });
    assert.equal(m.readiness("2").ready, false);
    assertIncludes(m.readiness("2").reasons[0], "own issuegraph declaration was not fully read");
  });

  test("the FIELD-DROP shape is refused too — non-null data that looks complete", () => {
    // The row readers miss. `blocked-by: [123, "a ref"]` yields a node gated
    // on `#123` alone; `data` is non-null and reads as a finished declaration,
    // so nothing but this axis can tell it from one.
    const m = buildModel([
      node(1, { open: false, closedStateReason: "completed" }),
      node(2, { data: { blockedBy: [ref(1)] }, declarationRead: "under-read" }),
    ]);
    // Its only DECLARED blocker is closed, so without the axis it reads ready.
    assert.equal(m.readiness("2").ready, false);
    assert.equal(
      m.diagnostics.some((d) => d.includes("2: its own issuegraph declaration was not fully read")),
      true,
    );
  });

  test("the UNUSABLE-BLOCK shape raises the diagnostic too, past the data guard", () => {
    // `data: null` short-circuits the edge loop, so a diagnostic emitted after
    // that guard would miss half the population. Delimited-but-unusable is that
    // half.
    const m = buildModel([node(1, { data: null, declarationRead: "under-read" })]);
    assert.equal(m.readiness("1").ready, false);
    assert.equal(
      m.diagnostics.some((d) => d.includes("1: its own issuegraph declaration was not fully read")),
      true,
    );
  });

  test("a serialize peer's under-read declaration refuses the whole component", () => {
    // A dropped `serialize-with` means the component's true extent is unknown,
    // so admitting #1 may admit it beside a sibling the edge forbids.
    const m = buildModel([
      node(1, { data: { serializeWith: ref(2) } }),
      node(2, { declarationRead: "under-read" }),
    ]);
    assert.deepEqual(m.serializeComponent("1"), ["1", "2"]);
    assert.equal(m.readiness("1").ready, false);
    assertIncludes(
      m.readiness("1").reasons.find((r) => r.includes("serialize group member")),
      "the component's true extent is unknown",
    );
  });

  test("a fully-read serialize component is still admitted", () => {
    // The negative control for the scan above: the same shape, one field apart.
    const m = buildModel([
      node(1, { data: { serializeWith: ref(2) } }),
      node(2),
    ]);
    assert.deepEqual(m.serializeComponent("1"), ["1", "2"]);
    assert.deepEqual(m.readiness("1"), { ready: true, reasons: [], holds: [] });
  });

  test("an under-read together member refuses the unit, with no rule of its own", () => {
    // `readiness` runs every open member through `baseReasons`, so the member's
    // own refusal is what refuses the unit. No second mechanism.
    const m = buildModel([
      node(1, { data: { togetherWith: ref(2) } }),
      node(2, { declarationRead: "under-read" }),
    ]);
    assert.deepEqual(m.togetherComponent("1"), ["1", "2"]);
    assert.equal(m.readiness("1").ready, false);
    assertIncludes(
      m.readiness("1").reasons.find((r) => r.includes("together member")),
      "own issuegraph declaration was not fully read",
    );
  });

  test("an under-read node stays REFERENCEABLE and stays in keys", () => {
    // It is refused for SELECTION, not demoted to the weak tier, and the two are
    // genuinely different dispositions: a reference to it still RESOLVES — the
    // reason below names `blocked-by 1`, not "unresolvable" — while a weak node
    // would have left the reference unresolvable and the dependent blocked for a
    // different stated cause. Keeping it referenceable is what stops the axis
    // spilling into the declarer-only tier's contract.
    //
    // AN EARLIER REVISION OF THIS TEST ASSERTED THE DEPENDENT WAS READY, which
    // was the defect codex raised on this PR's first head: `targetKey` resolves
    // the edge through the target's `duplicate-of`, so an under-read target can
    // stop the edge at a closed duplicate instead of a still-open canonical. The
    // referenceable half was right; the unblocks half was the bug, written down
    // as an expectation. Recorded here because a test that pins a defect is
    // worse than no test.
    const m = buildModel([
      node(1, { open: false, closedStateReason: "completed", declarationRead: "under-read" }),
      node(2, { data: { blockedBy: [ref(1)] } }),
    ]);
    assert.equal(m.keys.includes("1"), true);
    const r = m.readiness("2");
    assert.equal(r.ready, false);
    assertIncludes(r.reasons[0], "blocked-by 1 is closed but its own declaration was under-read");
    assert.equal(r.reasons.some((x) => x.includes("unresolvable")), false);
  });

  test("a CLOSED under-read blocker blocks — its dropped duplicate-of may redirect the edge", () => {
    // `targetKey` resolves a blocked-by ref THROUGH the target's `duplicate-of`,
    // so an under-read target can silently stop the edge at a closed duplicate
    // instead of carrying it to a canonical that is still open. Measured on this
    // PR's own review: one field apart, opposite verdicts.
    const m = buildModel([
      node(3), // the canonical, OPEN — where the edge SHOULD land
      node(2, {
        open: false,
        closedStateReason: "duplicate",
        declarationRead: "under-read", // its `duplicate-of: 3` was dropped
      }),
      node(1, { data: { blockedBy: [ref(2)] } }),
    ]);
    assert.equal(m.readiness("1").ready, false);
    assertIncludes(
      m.readiness("1").reasons.find((r) => r.includes("blocked-by 2")),
      "its own declaration was under-read",
    );
  });

  test("CONTROL: the same shape with the duplicate-of PARSED blocks on the canonical", () => {
    // The paired control, and it is what makes the test above mean anything: it
    // shows the refusal above restores the verdict a fully-read declaration
    // would have produced, rather than inventing a new one.
    const m = buildModel([
      node(3),
      node(2, { open: false, closedStateReason: "duplicate", data: { duplicateOf: ref(3) } }),
      node(1, { data: { blockedBy: [ref(2)] } }),
    ]);
    assert.equal(m.readiness("1").ready, false);
    assertIncludes(m.readiness("1").reasons[0], "blocked-by 3 is open");
  });

  test("CONTROL: a closed FULLY-READ blocker still unblocks", () => {
    // The negative control for the refusal: the axis must not turn every closed
    // blocker into a block, or it would stall the ordinary case.
    const m = buildModel([
      node(2, { open: false, closedStateReason: "completed" }),
      node(1, { data: { blockedBy: [ref(2)] } }),
    ]);
    assert.deepEqual(m.readiness("1"), { ready: true, reasons: [], holds: [] });
  });

  test("an under-read blocker keeps its non-completed-closure re-groom diagnostic", () => {
    // The two facts are independent — closure reason comes from the tracker, read
    // extent from the declaration — so chaining them would drop the SECTION 5.3
    // surface for exactly the nodes least well understood.
    const m = buildModel([
      node(2, { open: false, closedStateReason: "not_planned", declarationRead: "under-read" }),
      node(1, { data: { blockedBy: [ref(2)] } }),
    ]);
    assert.equal(m.readiness("1").ready, false);
    assert.equal(
      m.diagnostics.some((d) => d.includes("1: unblocked by non-completed closure of 2")),
      true,
    );
  });

  test("a CLOSED under-read together target refuses the declarer — the unit is not provably dissolved", () => {
    // "A closed member has left the unit" is read off the TARGET'S declaration,
    // and for this target it was not fully read: a dropped `duplicate-of` stops
    // the edge at a closed duplicate instead of carrying it to a canonical that
    // may still be an open member. The union never happens, so `readiness` has
    // no member to evaluate and the declarer would report ready ALONE.
    const m = buildModel([
      node(3), // the canonical, OPEN — the member the unit should have had
      node(2, { open: false, closedStateReason: "duplicate", declarationRead: "under-read" }),
      node(1, { data: { togetherWith: ref(2) } }),
    ]);
    assert.equal(m.readiness("1").ready, false);
    assertIncludes(
      m.readiness("1").reasons.find((r) => r.includes("together-with 2")),
      "is closed but its own declaration was under-read",
    );
  });

  test("CONTROL: a closed FULLY-READ together target still leaves the unit", () => {
    // The negative control: the guard must not turn every closed member into a
    // refusal, or §4.3.7's "closed members leave the unit" would stop working.
    const m = buildModel([
      node(2, { open: false, closedStateReason: "completed" }),
      node(1, { data: { togetherWith: ref(2) } }),
    ]);
    assert.deepEqual(m.readiness("1"), { ready: true, reasons: [], holds: [] });
  });

  test("BOUNDS THE CLASS: serialize-with has no closed-target hole", () => {
    // The property: an edge kind needs an under-read guard exactly when it reads
    // the TARGET'S `open` flag to DISCHARGE the edge. `serialize-with` unions
    // whatever the state, so closure discharges nothing and the component scan
    // covers it. Pinned so a future refactor that makes serialize skip closed
    // targets — reintroducing the hole — fails here rather than in the field.
    const m = buildModel([
      node(3, { assigneeCount: 1 }), // the canonical: open AND claimed
      node(2, { open: false, closedStateReason: "duplicate", declarationRead: "under-read" }),
      node(1, { data: { serializeWith: ref(2) } }),
    ]);
    assert.deepEqual(m.serializeComponent("1"), ["1", "2"]); // unioned despite being closed
    assert.equal(m.readiness("1").ready, false);
  });

  test("THE BOUNDARY: a dropped EDGE hides a peer the model cannot name", () => {
    // The one case no refusal here can close, pinned so it stays a DECLARED
    // limit rather than an unstated one. When the dropped field is itself an
    // edge, the relationship never enters edge collection, so the peer is an
    // ordinary singleton indistinguishable from any other node.
    const hidden = buildModel([
      node(1, { declarationRead: "under-read" }), // its `together-with: 2` was dropped
      node(2), // the peer, unnameable from here
    ]);
    assert.equal(hidden.readiness("1").ready, false); // the declarer IS refused
    assert.deepEqual(hidden.readiness("2"), { ready: true, reasons: [], holds: [] }); // the peer is not
    assert.deepEqual(hidden.togetherComponent("2"), ["2"]);

    // SHARP CONTROL — the same node under-read, but with the edge SURVIVING the
    // parse. This is what makes the case above a statement about the DROPPED
    // FIELD rather than about under-read declarations in general.
    const visible = buildModel([
      node(1, { declarationRead: "under-read", data: { togetherWith: ref(2) } }),
      node(2),
    ]);
    assert.equal(visible.readiness("2").ready, false);
    assertIncludes(visible.readiness("2").reasons[0], "together member 1 is not ready");

    // And the seam that makes the host's policy expressible in BOTH cases.
    assert.deepEqual(hidden.underReadKeys, ["1"]);
    assert.deepEqual(visible.underReadKeys, ["1"]);
  });

  test("underReadKeys is sorted, input-order stable, and empty in the ordinary case", () => {
    assert.deepEqual(buildModel([node(1), node(2)]).underReadKeys, []);
    const a = buildModel([
      node(3, { declarationRead: "under-read" }),
      node(1, { declarationRead: "under-read" }),
      node(2),
    ]);
    const b = buildModel([
      node(1, { declarationRead: "under-read" }),
      node(2),
      node(3, { declarationRead: "under-read" }),
    ]);
    assert.deepEqual(a.underReadKeys, ["1", "3"]);
    assert.deepEqual(a.underReadKeys, b.underReadKeys);
  });

  test("underReadKeys includes the declarer-only tier, unlike keys", () => {
    // A weak node may add constraints, and an under-read weak node is a
    // constraint nobody could read — a host composing the strict policy needs
    // that as much as the full-node case.
    const m = buildModel([node(1)], {
      declarerOnlyNodes: [declarerOnlyNode(node(40, { declarationRead: "under-read" }))],
    });
    assert.equal(m.keys.includes("40"), false);
    assert.deepEqual(m.underReadKeys, ["40"]);
  });

  test("effective priority is deliberately untouched by the axis", () => {
    // Recorded as a decision, not left to look like an oversight: the axis
    // refuses, and there is nothing here to refuse. A P3 blocking a P0 still
    // comes back 0 whatever either node's declaration read.
    const m = buildModel([
      node(1, { labels: ["p3"], declarationRead: "under-read" }),
      node(2, { labels: ["p0"], data: { blockedBy: [ref(1)] }, declarationRead: "under-read" }),
    ]);
    assert.equal(m.effectivePriority("1"), 0);
  });
});

describe("priorityInheritors (SPEC 6.3) — the closure, not a neighbourhood", () => {
  // The set every consumer of effective priority used to re-derive by hand, and
  // got wrong twice in two different ways. Each test below names the shape that
  // a short answer misses, so a probe narrowing the walk fails by name rather
  // than by an aggregate count.

  test("reaches a blocker across a together edge", () => {
    // A together-with B, B blocked-by C. A's OWN blocked-by list is empty, so a
    // derivation reading only that reports "A is unready and there is nothing
    // to work instead" — and the tier advances past C, which is the priority
    // inversion the set exists to prevent.
    const m = buildModel([
      node(1, { labels: ["p0"], data: { togetherWith: ref(2) } }),
      node(2, { data: { blockedBy: [ref(3)] } }),
      node(3, { labels: ["p3"] }),
    ]);
    assert.deepEqual(m.priorityInheritors("1"), ["2", "3"]);
    assert.equal(m.effectivePriority("3"), 0); // the fold agrees: 3 really does inherit
  });

  test("reaches every hop of a blocked-by chain, not just the first", () => {
    // A blocked-by B blocked-by C. A one-hop walk returns only B — which is
    // itself unready — so the tier is handed nothing selectable and can still
    // advance past C.
    const m = buildModel([
      node(1, { labels: ["p0"], data: { blockedBy: [ref(2)] } }),
      node(2, { data: { blockedBy: [ref(3)] } }),
      node(3, { labels: ["p3"] }),
    ]);
    assert.deepEqual(m.priorityInheritors("1"), ["2", "3"]);
    assert.equal(m.effectivePriority("3"), 0);
  });

  test("composes the two: a chain hanging off a together partner", () => {
    const m = buildModel([
      node(1, { labels: ["p0"], data: { togetherWith: ref(2) } }),
      node(2, { data: { blockedBy: [ref(3)] } }),
      node(3, { data: { blockedBy: [ref(4)] } }),
      node(4, { labels: ["p3"] }),
    ]);
    assert.deepEqual(m.priorityInheritors("1"), ["2", "3", "4"]);
    assert.equal(m.effectivePriority("4"), 0);
  });

  test("stops at a closed node instead of propagating through it", () => {
    // The fold refuses to relax through a closed node, so the inheritor set
    // must refuse the same edge: #3 sits behind a finished #2 and does not
    // inherit. A walk that ignored `open` would offer the tier work that is
    // not on the critical path at all.
    const m = buildModel([
      node(1, { labels: ["p0"], data: { blockedBy: [ref(2)] } }),
      node(2, { open: false, closedStateReason: "completed", data: { blockedBy: [ref(3)] } }),
      node(3, { labels: ["p3"] }),
    ]);
    assert.deepEqual(m.priorityInheritors("1"), []);
    assert.equal(m.effectivePriority("3"), 3);
  });

  test("a closed key inherits nothing to anyone", () => {
    const m = buildModel([
      node(1, { labels: ["p0"], open: false, closedStateReason: "completed", data: { blockedBy: [ref(2)] } }),
      node(2, { labels: ["p3"] }),
    ]);
    assert.deepEqual(m.priorityInheritors("1"), []);
  });

  test("terminates on a blocked-by cycle and reports its members", () => {
    const m = buildModel([
      node(1, { labels: ["p1"], data: { blockedBy: [ref(2)] } }),
      node(2, { data: { blockedBy: [ref(1)] } }),
    ]);
    assert.deepEqual(m.priorityInheritors("1"), ["2"]);
    assert.deepEqual(m.priorityInheritors("2"), ["1"]);
  });

  test("traverses THROUGH a declarer-only node but never returns one", () => {
    // Both halves in one fixture, because they fail in opposite directions and
    // a test asserting only one passes while the other is broken. #2 is weak:
    // it must be absent from the result (a weak node may never arrive by
    // enumeration), and #3 behind it must still be present (the fold walks
    // through #2, so stopping there would hide real work).
    //
    // THE EDGE RUNS THROUGH `together`, AND IT HAS TO. A weak node is never
    // `referenceable`, so nothing can name it as a blocked-by target — a
    // fixture pointing #1's `blocked-by` at #2 exercises the UNRESOLVABLE-ref
    // path instead and passes for the wrong reason. What a weak node CAN do is
    // declare its own `together-with` at a strong node, which unions it into
    // that node's component: the declarer needs no referenceability, only the
    // target does. That is the one way a weak node lands on a strong node's
    // relaxation path, and it is therefore the only shape that tests this rule.
    const m = buildModel([node(1, { labels: ["p0"] }), node(3, { labels: ["p3"] })], {
      declarerOnlyNodes: [declarerOnlyNode(node(2, { data: { togetherWith: ref(1), blockedBy: [ref(3)] } }))],
    });
    assert.deepEqual(m.priorityInheritors("1"), ["3"]);
    // Two controls, so neither half can pass vacuously: #2 really is unioned
    // into #1's component (it was filtered, not unreached), and the fold really
    // does carry #1's urgency through it to #3.
    assert.deepEqual(m.togetherComponent("1"), ["1", "2"]);
    assert.equal(m.effectivePriority("3"), 0);
  });

  test("does not widen to serialize edges (SPEC 6.7)", () => {
    // The fold does not relax over serialize, so neither does this. A sibling
    // in the same serialize component is a sequencing constraint, not work that
    // inherits the key's urgency.
    const m = buildModel([
      node(1, { labels: ["p0"], data: { serializeWith: ref(2) } }),
      node(2, { labels: ["p3"] }),
    ]);
    assert.deepEqual(m.priorityInheritors("1"), []);
    assert.deepEqual(m.serializeComponent("1"), ["1", "2"]);
  });

  test("offers a duplicate's CANONICAL, never the duplicate itself (SPEC 4.3.3)", () => {
    // The set names work a tier may take, and a duplicate is the one thing
    // nobody may work. Refs normalize through the duplicate closure before they
    // reach `blockersOf`, so this is inherited rather than re-decided here —
    // which is exactly why it is worth pinning: a future walk that read raw
    // refs instead would start handing out unworkable issues silently.
    const m = buildModel([
      node(1, { labels: ["p0"], data: { blockedBy: [ref(2)] } }),
      node(2, { data: { duplicateOf: ref(3) } }),
      node(3, { labels: ["p3"] }),
    ]);
    assert.deepEqual(m.priorityInheritors("1"), ["3"]);
    assert.equal(m.duplicateCanonical("2"), "3");
  });

  test("emits nothing for a duplicate-of CYCLE, which has no canonical to offer", () => {
    // The case the normalization above does NOT cover, and the reason the walk
    // needs its own duplicate test rather than trusting the edge loop. A cycle
    // has no canonical, so the closure answers with another still-duplicate
    // key and the ref normalizes to a node that permanently fails readiness.
    // Without the guard this returns ["2"] — one alternative, and the only one
    // the tier was offered, which reads as work that exists.
    const m = buildModel([
      node(10, { labels: ["p0"], data: { blockedBy: [ref(1)] } }),
      node(1, { data: { duplicateOf: ref(2) } }),
      node(2, { data: { duplicateOf: ref(1) } }),
    ]);
    assert.deepEqual(m.priorityInheritors("10"), []);
    // The controls: the edge really did resolve to a duplicate, and that node
    // really is unworkable — so the empty answer is a refusal, not a miss.
    assert.equal(m.duplicateCanonical("2"), "1");
    assert.equal(m.readiness("2").ready, false);
  });

  test("emits nothing for a SELF duplicate-of", () => {
    const m = buildModel([
      node(10, { labels: ["p0"], data: { blockedBy: [ref(1)] } }),
      node(1, { data: { duplicateOf: ref(1) } }),
    ]);
    assert.deepEqual(m.priorityInheritors("10"), []);
    assert.equal(m.readiness("1").ready, false);
  });

  test("emits nothing for a duplicate-of chain that LEAVES the node set", () => {
    // PINNED FOR THE OUTCOME, NOT FOR THE GUARD — and saying so is the point,
    // because this passes with the duplicate guard removed. #1 normalizes to
    // #999, which is not in the node set, so the edge is dropped as an
    // unresolvable blocked-by long before the walk runs. Different mechanism,
    // same requirement: the tier is never handed a target nobody can work.
    const m = buildModel([
      node(10, { labels: ["p0"], data: { blockedBy: [ref(1)] } }),
      node(1, { data: { duplicateOf: ref(999) } }),
    ]);
    assert.deepEqual(m.priorityInheritors("10"), []);
    assert.equal(m.readiness("1").ready, false);
  });

  test("answers empty for a key the model does not hold", () => {
    const m = buildModel([node(1, { labels: ["p0"] })]);
    assert.deepEqual(m.priorityInheritors("999"), []);
    assert.deepEqual(m.priorityInheritors("1"), []);
  });

  test("never includes the key itself, even inside a together component", () => {
    const m = buildModel([
      node(1, { labels: ["p0"], data: { togetherWith: ref(2) } }),
      node(2, { labels: ["p3"] }),
    ]);
    assert.deepEqual(m.priorityInheritors("1"), ["2"]);
    assert.deepEqual(m.priorityInheritors("2"), ["1"]);
  });

  test("the fold and the walk agree on cross-repo keys", () => {
    // The relation is defined once, so a qualified blocker inherits under the
    // same key the fold relaxed it under.
    const m = buildModel(
      [
        node(1, { labels: ["p0"], data: { blockedBy: [ref(7, "other/repo")] } }),
        node(7, { repo: "other/repo", labels: ["p3"] }),
      ],
      { homeRepo: "home/repo" },
    );
    assert.deepEqual(m.priorityInheritors("1"), ["other/repo#7"]);
    assert.equal(m.effectivePriority("other/repo#7"), 0);
  });
});

describe("serializeHorizonTruncated — an unresolvable serialize-with is EXPOSED, not refused (SPEC 6.7)", () => {
  test("reports the truncation for every KNOWN member of the component", () => {
    // The reader states the fact; a consumer that owns its horizon composes the
    // refusal (§6.8 shape). Every known member reports it, because the unknown
    // extent belongs to the component.
    const m = buildModel([
      node(1, { data: { serializeWith: ref(40) } }),
      node(2, { data: { serializeWith: ref(1) } }),
    ]);
    assert.equal(m.serializeHorizonTruncated("1"), true);
    assert.equal(m.serializeHorizonTruncated("2"), true);
    // ...and readiness stays clean, which is the whole §6.7 point.
    assert.equal(m.readiness("1").ready, true);
    assert.equal(m.readiness("2").ready, true);
  });

  test("is still SURFACED as a diagnostic — no linkage is not no diagnostic", () => {
    const m = buildModel([node(1, { data: { serializeWith: ref(40) } })]);
    assert.ok(m.diagnostics.some((d) => d.includes("serialize-with 40 is unresolvable")));
  });

  test("does not report a truncation that is not there — the over-shoot probe", () => {
    // A fully resolvable component, and an UNRELATED unresolvable link, must
    // both read false: a predicate that is true everywhere would restore the
    // old blanket refusal at the consumer instead of at the reader.
    const resolvable = buildModel([node(1, { data: { serializeWith: ref(2) } }), node(2)]);
    assert.equal(resolvable.serializeHorizonTruncated("1"), false);
    assert.equal(resolvable.serializeHorizonTruncated("2"), false);

    // An unresolvable TOGETHER link is not a serialize-horizon fact.
    const togetherOnly = buildModel([
      node(1, { data: { togetherWith: ref(40), serializeWith: ref(2) } }),
      node(2),
    ]);
    assert.equal(togetherOnly.serializeHorizonTruncated("2"), false);

    // And an unresolvable BLOCKED-BY is not one either — it already blocks.
    const blocked = buildModel([node(1, { data: { blockedBy: [ref(40)], serializeWith: ref(2) } }), node(2)]);
    assert.equal(blocked.serializeHorizonTruncated("2"), false);
  });

  test("a declarer-only target does not resolve the edge, so the declarer is truncated", () => {
    // The weakest tier declares, it never answers — an edge at a weak node is
    // as unresolved as one at nothing, and the horizon report has to say so.
    const m = buildModel([node(1, { data: { serializeWith: ref(40) } })], {
      declarerOnlyNodes: [declarerOnlyNode(node(40))],
    });
    assert.equal(m.serializeHorizonTruncated("1"), true);
  });

  test("a duplicate declarer's unresolvable serialize-with contributes nothing", () => {
    // A duplicate declares no relationship edges (§4.3.3), so its dangling
    // `serialize-with` is not a truncation of anyone's component either.
    const m = buildModel([
      node(1, { data: { duplicateOf: ref(2), serializeWith: ref(40) } }),
      node(2, { data: { serializeWith: ref(3) } }),
      node(3),
    ]);
    assert.equal(m.serializeHorizonTruncated("2"), false);
    assert.equal(m.serializeHorizonTruncated("3"), false);
  });

  test("answers false for a key the model does not hold", () => {
    const m = buildModel([node(1, { data: { serializeWith: ref(40) } })]);
    assert.equal(m.serializeHorizonTruncated("999"), false);
  });
});

describe("decomposed-from provenance the node set cannot resolve", () => {
  test("diagnoses an origin the set does not hold", () => {
    const m = buildModel([node(1, { data: { decomposedFrom: ref(99) } })]);
    assert.ok(m.diagnostics.some((d) => d.includes("decomposed-from 99 is unresolvable")));
    assert.ok(m.diagnostics.some((d) => d.includes("provenance only, so no readiness effect")));
  });

  test("says nothing when the origin IS in the set", () => {
    const m = buildModel([node(1, { data: { decomposedFrom: ref(2) } }), node(2)]);
    assert.equal(m.diagnostics.some((d) => d.includes("decomposed-from")), false);
  });

  test("has NO readiness effect — provenance is not a scheduling edge", () => {
    // The whole reason this stays a diagnostic. Routing it through the refusal
    // ledger would start refusing declarers over a field that has never gated
    // anything, turning a report into a behaviour change.
    const m = buildModel([node(1, { data: { decomposedFrom: ref(99) } })]);
    assert.deepEqual(m.readiness("1"), { ready: true, reasons: [], holds: [] });
  });

  test("does not resolve against the declarer-only tier", () => {
    // Same rule the other four ref sites follow: the weakest tier declares, it
    // never answers.
    const m = buildModel([node(1, { data: { decomposedFrom: ref(40) } })], {
      declarerOnlyNodes: [declarerOnlyNode(node(40))],
    });
    assert.ok(m.diagnostics.some((d) => d.includes("decomposed-from 40 is unresolvable")));
  });

  test("resolves a bare ref against the declarer's own repo", () => {
    // A cross-repo node's bare `decomposed-from: 5` names ITS repo's #5, not
    // the home repo's — the same source-repo rule every other ref follows.
    const m = buildModel(
      [node(1, { repo: "other/repo", data: { decomposedFrom: ref(5) } }), node(5)],
      { homeRepo: "home/repo" },
    );
    assert.ok(m.diagnostics.some((d) => d.includes("decomposed-from other/repo#5 is unresolvable")));
  });

  test("a duplicate declarer emits no provenance diagnostic", () => {
    // A duplicate's declaration is ignored in favour of its canonical
    // (§4.3.3), provenance included.
    const m = buildModel([node(1, { data: { duplicateOf: ref(2), decomposedFrom: ref(99) } }), node(2)]);
    assert.equal(m.diagnostics.some((d) => d.includes("decomposed-from")), false);
  });
});
