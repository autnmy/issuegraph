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
  number: number,
  overrides: Omit<Partial<NodeInput>, "data"> & { data?: Partial<Frontmatter> | null } = {},
): NodeInput {
  const { data, ...rest } = overrides;
  return {
    number,
    open: true,
    labels: [],
    assigneeCount: 0,
    ...rest,
    data: data === null ? null : { ...EMPTY, ...(data ?? {}) },
  };
}

const ref = (n: number, repo: string | null = null) => ({ repo, number: n });

describe("buildModel readiness (SPEC 6.2)", () => {
  test("an open node with no frontmatter is ready", () => {
    const m = buildModel([node(1, { data: null })]);
    assert.deepEqual(m.readiness("1"), { ready: true, reasons: [] });
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
    assert.deepEqual(m.readiness("77"), { ready: false, reasons: ["unknown node"] });
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
    assert.deepEqual(unit(1).readiness("1"), { ready: true, reasons: [] }, "after its own claim");
    assert.deepEqual(unit(1).readiness("2"), { ready: true, reasons: [] }, "from the other member");
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

  test("does not resolve somebody else's serialize-with", () => {
    const m = buildModel([node(1, { data: { serializeWith: ref(40) } })], {
      declarerOnlyNodes: [declarer(40)],
    });
    assert.equal(m.readiness("1").ready, false);
    assertIncludes(m.readiness("1").reasons.join(" "), "serialize-with 40 is unresolvable");
    // And the union did NOT happen: the component is the declarer alone.
    assert.deepEqual(m.serializeComponent("1"), ["1"]);
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
