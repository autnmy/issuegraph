import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clustersOf } from './clusters.ts';
import { type NormalizedDocument, normalizeDocument } from './document.ts';

function pairs(count: number): NormalizedDocument {
  const issues = [];
  const edges = [];
  for (let i = 0; i < count; i += 1) {
    issues.push(
      { key: `x${i}`, title: `X ${i}`, open: true, priority: 2 as const },
      { key: `y${i}`, title: `Y ${i}`, open: true, priority: 2 as const },
    );
    edges.push({ field: 'blocked-by' as const, from: `x${i}`, to: `y${i}` });
  }
  return normalizeDocument({ issues, edges, order: { slots: [], excluded: [] } }).document;
}

describe('clustersOf', () => {
  it('summarises without rescanning the edge array once per component', () => {
    // COUNTED, NOT TIMED, and that is the whole reliability of this test. The
    // defect is quadratic COST, and a stopwatch assertion for it is a coin flip
    // on a loaded CI box — too generous and the old code passes, too tight and
    // the new code fails for reasons that have nothing to do with the code.
    // Reading the edge array is the unit of work being multiplied, so counting
    // the reads measures the pathology itself and gives the same answer on every
    // machine: the old code took one pass PER COMPONENT, so 3,000 disconnected
    // pairs meant ~3,000 full scans — about nine million checks to produce a
    // SUMMARY, and the refusal that exists to protect the browser from a document
    // too big to draw became the thing that froze it.
    const document = pairs(3000);
    let reads = 0;
    const counted = new Proxy(document, {
      get(target, property, receiver) {
        if (property === 'edges') reads += 1;
        return Reflect.get(target, property, receiver);
      },
    }) as NormalizedDocument;

    const clusters = clustersOf(counted);

    assert.equal(clusters.length, 3000, 'the fixture should be 3000 disconnected components');
    // A small CONSTANT, not a ratio: two reads are structural (one to group the
    // components, one to build the adjacency) and the bound leaves room for
    // another without licensing a per-component one.
    assert.ok(reads <= 4, `read document.edges ${reads} times for ${clusters.length} components`);
  });

  it('does not count the edge that closes a cycle as chain depth', () => {
    // The discovery pass refuses to follow a back-edge; the collecting pass
    // walked the same adjacency and had no way to tell one, so it counted that
    // edge against a memo never written and every cycle came out one edge long.
    // `chainDepth` is documented as the longest ACYCLIC chain, and it is printed
    // beside the cycle badge — an invented finite depth there is a number a
    // reader takes at face value.
    const cycle = (keys: readonly string[]): number => {
      const issues = keys.map((key) => ({ key, title: key, open: true, priority: 2 as const }));
      const edges = keys.map((key, index) => ({
        field: 'blocked-by' as const,
        from: key,
        to: keys[(index + 1) % keys.length] as string,
      }));
      const document = normalizeDocument({ issues, edges, order: { slots: [], excluded: [] } })
        .document;
      const cluster = clustersOf(document)[0];
      assert.equal(cluster?.hasCycle, true, 'the fixture should be cyclic');
      return cluster?.chainDepth ?? -1;
    };

    assert.equal(cycle(['a', 'b']), 1, 'a two-node cycle has a one-edge acyclic chain');
    assert.equal(cycle(['x', 'y', 'z']), 2, 'a three-node cycle has a two-edge acyclic chain');
  });

  it('still measures an acyclic chain in full', () => {
    // The other half: skipping back-edges must not shorten a chain that has none.
    const keys = ['p', 'q', 'r'];
    const document = normalizeDocument({
      issues: keys.map((key) => ({ key, title: key, open: true, priority: 2 as const })),
      edges: [
        { field: 'blocked-by' as const, from: 'p', to: 'q' },
        { field: 'blocked-by' as const, from: 'q', to: 'r' },
      ],
      order: { slots: [], excluded: [] },
    }).document;

    const cluster = clustersOf(document)[0];
    assert.equal(cluster?.hasCycle, false);
    assert.equal(cluster?.chainDepth, 2);
  });

  it('counts each component’s blocking edges exactly, not approximately', () => {
    // The cheap count has to be the SAME number the scan produced — a faster
    // summary that reports a different edge count is not a fix.
    const document = pairs(50);
    const clusters = clustersOf(document);

    const scanned = clusters.map((cluster) => {
      const membership = new Set(cluster.members);
      return document.edges.filter(
        (edge) => edge.field === 'blocked-by' && membership.has(edge.from),
      ).length;
    });

    assert.deepEqual(
      clusters.map((cluster) => cluster.blockedByEdges),
      scanned,
    );
    assert.equal(
      clusters.reduce((total, cluster) => total + cluster.blockedByEdges, 0),
      50,
    );
  });
});
