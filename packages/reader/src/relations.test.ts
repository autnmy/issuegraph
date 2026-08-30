import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Frontmatter } from './frontmatter.ts';
import {
  buildModel,
  evaluateReadiness,
  resolveSerializeGroup,
  resolveTogetherUnit,
  type NodeInput,
} from './model.ts';

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
  overrides: Omit<Partial<NodeInput>, 'data'> & { data?: Partial<Frontmatter> | null } = {},
): NodeInput {
  const { data, ...rest } = overrides;
  return {
    id: String(id),
    open: true,
    labels: [],
    assigneeCount: 0,
    declarationRead: 'read',
    ...rest,
    data: data === null ? null : { ...EMPTY, ...(data ?? {}) },
  };
}

const ref = (n: string | number, repo: string | null = null) => ({ repo, id: String(n) });

describe('the three questions are individually callable (#83 DW1)', () => {
  test('readiness answers for one candidate without a model', () => {
    const nodes = [node(1), node(2, { data: { blockedBy: [ref(1)] } })];
    assert.deepEqual(evaluateReadiness(nodes, '1'), { ready: true, reasons: [] });
    assert.equal(evaluateReadiness(nodes, '2').ready, false);
  });

  test('a serialize group always contains the subject, so a lone issue reads 1', () => {
    assert.deepEqual(resolveSerializeGroup([node(1)], '1'), ['1']);
    const linked = [node(1, { data: { serializeWith: ref(2) } }), node(2), node(3)];
    assert.deepEqual(resolveSerializeGroup(linked, '1'), ['1', '2']);
    assert.deepEqual(resolveSerializeGroup(linked, '2'), ['1', '2']);
    assert.deepEqual(resolveSerializeGroup(linked, '3'), ['3']);
  });

  test('a together unit resolves transitively, and a closed member has left it', () => {
    const open = [
      node(1, { data: { togetherWith: ref(2) } }),
      node(2, { data: { togetherWith: ref(3) } }),
      node(3),
    ];
    assert.deepEqual(resolveTogetherUnit(open, '1'), ['1', '2', '3']);
    const closed = [
      node(1, { data: { togetherWith: ref(2) } }),
      node(2, { open: false, closedStateReason: 'completed', data: { togetherWith: ref(3) } }),
      node(3),
    ];
    assert.deepEqual(resolveTogetherUnit(closed, '1'), ['1']);
  });

  /**
   * THE TWO EMPTY-LOOKING CASES, asserted TOGETHER because the contract is the
   * difference between them and a test that checks either one alone cannot see
   * it. Raised on this PR: the JSDoc had promised `[key]` for both, which would
   * let a consumer treat an unknown issue as a schedulable unit of one.
   */
  test('carried-but-unlinked is a unit of one; not-carried is no unit at all', () => {
    const nodes = [node(1), node(2)];
    assert.deepEqual(resolveTogetherUnit(nodes, '1'), ['1'], 'carried, in no unit');
    assert.deepEqual(resolveTogetherUnit(nodes, '99'), [], 'not carried');
    // The sibling draws the same line, and the two must not drift apart.
    assert.deepEqual(resolveSerializeGroup(nodes, '1'), ['1'], 'carried, in no group');
    assert.deepEqual(resolveSerializeGroup(nodes, '99'), [], 'not carried');
    // ...and both agree with the model they were extracted from.
    const model = buildModel(nodes);
    assert.deepEqual(resolveTogetherUnit(nodes, '99'), model.togetherComponent('99'));
    assert.deepEqual(resolveSerializeGroup(nodes, '99'), model.serializeComponent('99'));
  });

  test('an unknown key is refused, never admitted', () => {
    assert.deepEqual(evaluateReadiness([node(1)], '99'), {
      ready: false,
      reasons: ['unknown node'],
    });
    assert.deepEqual(resolveSerializeGroup([node(1)], '99'), []);
    assert.deepEqual(resolveTogetherUnit([node(1)], '99'), []);
  });
});

describe('closure and claim state are INPUTS (#14 boundary rule)', () => {
  test('flipping only `open` on the blocker flips readiness — nothing is fetched', () => {
    const blocked = node(2, { data: { blockedBy: [ref(1)] } });
    assert.equal(evaluateReadiness([node(1), blocked], '2').ready, false);
    assert.equal(
      evaluateReadiness([node(1, { open: false, closedStateReason: 'completed' }), blocked], '2')
        .ready,
      true,
    );
  });

  test("a serialize peer's assignee blocks; the subject's own does not (§6.8)", () => {
    const pair = (subjectAssignees: number, peerAssignees: number): NodeInput[] => [
      node(1, { assigneeCount: subjectAssignees, data: { serializeWith: ref(2) } }),
      node(2, { assigneeCount: peerAssignees }),
    ];
    assert.equal(evaluateReadiness(pair(3, 0), '1').ready, true);
    assert.equal(evaluateReadiness(pair(0, 1), '1').ready, false);
    assert.deepEqual(evaluateReadiness(pair(0, 1), '1').reasons, [
      'serialize group member 2 is actively claimed',
    ]);
  });
});

/**
 * THE ANTI-DRIFT TEST, and the reason the split is an extraction rather than a
 * second implementation. `Model.readiness` and `evaluateReadiness` are supposed
 * to be one code path reached two ways; this is what would notice if they ever
 * stopped being that.
 *
 * It sweeps EVERY key rather than a chosen one, because a divergence introduced
 * later will not be in the case whoever wrote it was thinking about.
 */
describe('the standalone answers and the model agree, key by key', () => {
  const corpus: NodeInput[] = [
    node(1, { labels: ['P0'] }),
    node(2, { data: { blockedBy: [ref(1)] } }),
    node(3, { data: { serializeWith: ref(4) } }),
    node(4, { assigneeCount: 1 }),
    node(5, { labels: ['P3'], data: { togetherWith: ref(6) } }),
    node(6, { data: { blockedBy: [ref(2)] } }),
    node(7, { data: { duplicateOf: ref(1) } }),
    node(8, { open: false, closedStateReason: 'not_planned' }),
    node(9, { data: { blockedBy: [ref(8)] } }),
    node(10, { declarationRead: 'under-read', data: { blockedBy: [ref(1)] } }),
    node(11, { data: { blockedBy: [ref(99)] } }),
    node(12, { repo: 'other/repo', data: { serializeWith: ref(3, 'acme/tracker') } }),
  ];

  const model = buildModel(corpus, { homeRepo: 'acme/tracker' });
  const options = { homeRepo: 'acme/tracker' } as const;

  for (const key of model.keys) {
    test(`${key}: readiness, serialize group and together unit all match`, () => {
      assert.deepEqual(evaluateReadiness(corpus, key, options), model.readiness(key));
      assert.deepEqual(resolveSerializeGroup(corpus, key, options), model.serializeComponent(key));
      assert.deepEqual(resolveTogetherUnit(corpus, key, options), model.togetherComponent(key));
    });
  }
});

/**
 * THE COST PROPERTY — the whole reason #83 exists, asserted STRUCTURALLY rather
 * than as a duration, because a timing assertion on a shared machine is a flake
 * generator and proves nothing about which work was skipped.
 *
 * `labels` is the probe because it is read by exactly one layer: `buildModel`'s
 * declared-priority pass calls `priorityLabelValue(node.labels)` once per node,
 * and no part of readiness or component resolution touches the field at all. So
 * a labels read is a witness that the priority layer ran — and its ABSENCE is a
 * witness that a single question did not pay for one.
 */
describe('a single question does not build the layers it never consults', () => {
  function counted(nodes: readonly NodeInput[]): { nodes: NodeInput[]; reads: () => number } {
    let reads = 0;
    const wrapped = nodes.map((n) => {
      const labels = n.labels;
      return Object.defineProperties({ ...n }, {
        labels: {
          get() {
            reads++;
            return labels;
          },
          enumerable: true,
        },
      }) as NodeInput;
    });
    return { nodes: wrapped, reads: () => reads };
  }

  const corpus = Array.from({ length: 50 }, (_, i) => node(i + 1, { labels: ['P2'] }));

  test('buildModel resolves declared priority for every node', () => {
    const { nodes, reads } = counted(corpus);
    buildModel(nodes);
    assert.ok(reads() >= corpus.length, `expected >= ${corpus.length} label reads, saw ${reads()}`);
  });

  test('the three entry points resolve no priority at all', () => {
    for (const call of [evaluateReadiness, resolveSerializeGroup, resolveTogetherUnit]) {
      const { nodes, reads } = counted(corpus);
      call(nodes, '1');
      assert.equal(reads(), 0, `${call.name} read labels ${reads()} times`);
    }
  });
});

/**
 * `Model.diagnostics` IS CONSUMER-VISIBLE OUTPUT, so the extraction must not
 * reorder it. `deriveIssueOrder` copies the array unchanged and the CLI prints
 * it as JSON, so a consumer reading it sequentially — or a snapshot asserting
 * it — would see a refactor that is supposed to be invisible.
 *
 * Every other diagnostic assertion in this repository uses `.some(...)`, which
 * is order-blind by construction. So nothing caught the reordering this pins;
 * it was raised in review on this PR, against a corpus carrying both a
 * priority-carrier disagreement and a relationship anomaly.
 *
 * THE EXPECTED ORDER IS MEASURED, NOT REASONED. It was read off `buildModel` at
 * `bdf1dd6` — the commit before this extraction — using this exact corpus.
 */
describe('diagnostics keep their pre-extraction order', () => {
  const nodes: NodeInput[] = [
    node(1, { labels: ['P0'], data: { priority: 3 } }),
    node(2, { data: { blockedBy: [ref(404)] } }),
    node(3, { open: false, closedStateReason: 'not_planned' }),
    node(4, { data: { blockedBy: [ref(3)] } }),
    node(5, { data: { blockedBy: [ref(6)] } }),
    node(6, { data: { blockedBy: [ref(5)] } }),
  ];

  test('phase order is priority, then edges, then cycles, then readiness', () => {
    assert.deepEqual(buildModel(nodes).diagnostics, [
      '1: priority label p0 disagrees with frontmatter 3',
      '2: blocked-by 404 is unresolvable in this node set; treated as blocking',
      'blocked-by cycle: 5 -> 6',
      '4: unblocked by non-completed closure of 3; re-check its premise',
    ]);
  });

  test('the corpus really does exercise all four phases', () => {
    // Guards the assertion above against becoming vacuous if a future change
    // stops one phase emitting: three of the four would still pass in order.
    assert.equal(buildModel(nodes).diagnostics.length, 4);
  });
});
