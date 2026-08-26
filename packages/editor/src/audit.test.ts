import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { wouldCycleOnBlockedBy } from '@issuegraph/derive';
import type { DeriveIssueOrderInput } from '@issuegraph/derive';
import { makeEdge } from '@issuegraph/store';
import type { EdgeKind, GraphDocument, IssueRef, StoredIssue } from '@issuegraph/store';

import { AUDIT_CLASSES, AUDIT_CLASS_SPECS, auditDocument } from './audit.ts';
import type { AuditClass, AuditFinding, CycleProbe } from './audit.ts';

/**
 * The reader's node shape, reached through the surface the editor already
 * imports rather than by adding a dependency on `@issuegraph/reader`. It is
 * needed only here: the package itself never builds one, which is the whole
 * point of taking the probe as a port.
 */
type NodeInput = DeriveIssueOrderInput['issues'][number];

function issue(ref: IssueRef, state: StoredIssue['state'] = 'open'): StoredIssue {
  return { ref, title: `issue ${ref}`, state };
}

function documentOf(
  issues: readonly StoredIssue[],
  edges: readonly (readonly [EdgeKind, IssueRef, IssueRef])[],
): GraphDocument {
  return { issues, edges: edges.map(([kind, from, to]) => makeEdge(kind, from, to)) };
}

/**
 * The document as `@issuegraph/derive` reads it.
 *
 * REFS PASS THROUGH AS OPAQUE IDS, with no repo and no home repo — which makes
 * `nodeKey` and `refKey` identity functions, so the derive walk keys on exactly
 * the strings the store holds. That is the translation the package itself
 * refuses to do; doing it in a fixture, where the refs are chosen, costs
 * nothing and keeps the production path free of a second statement of §4.2.
 */
function asNodes(document: GraphDocument): readonly NodeInput[] {
  return document.issues.map((held) => ({
    id: held.ref,
    repo: null,
    open: held.state === 'open',
    labels: [],
    assigneeCount: 0,
    data: {
      blockedBy: document.edges
        .filter((edge) => edge.kind === 'blocked-by' && edge.from === held.ref)
        .map((edge) => ({ repo: null, id: edge.to })),
      decomposedFrom: null,
      duplicateOf: null,
      serializeWith: null,
      togetherWith: null,
      priority: null,
      evidence: null,
    },
    declarationRead: 'read',
  }));
}

/** The real thing from `@issuegraph/derive`, bound to one document. */
function realProbe(document: GraphDocument): CycleProbe {
  const nodes = asNodes(document);
  return (from, to) => wouldCycleOnBlockedBy(nodes, from, to);
}

function kindsOf(findings: readonly AuditFinding[]): readonly AuditClass[] {
  return findings.map((found) => found.kind);
}

function only(findings: readonly AuditFinding[], kind: AuditClass): readonly AuditFinding[] {
  return findings.filter((found) => found.kind === kind);
}

describe('the four finding classes', () => {
  it('reports a blocked-by cycle, naming every member', () => {
    // A -> B -> C -> A. Each edge reads "from is blocked-by to".
    const document = documentOf(
      [issue('a'), issue('b'), issue('c')],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'b', 'c'],
        ['blocked-by', 'c', 'a'],
      ],
    );
    const found = only(auditDocument({ document, wouldCycle: realProbe(document) }), 'cycle');
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]?.members, ['a', 'b', 'c']);
    assert.equal(found[0]?.severity, 'blocks-work');
  });

  it('reports a cycle longer than three, which a pairwise check would miss', () => {
    // Explicitly longer than 3: a detector that only recognised a mutual pair,
    // or a triangle, passes the test above and fails this one.
    const document = documentOf(
      [issue('a'), issue('b'), issue('c'), issue('d'), issue('e')],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'b', 'c'],
        ['blocked-by', 'c', 'd'],
        ['blocked-by', 'd', 'e'],
        ['blocked-by', 'e', 'a'],
      ],
    );
    const found = only(auditDocument({ document, wouldCycle: realProbe(document) }), 'cycle');
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]?.members, ['a', 'b', 'c', 'd', 'e']);
  });

  it('leaves an acyclic chain alone', () => {
    const document = documentOf(
      [issue('a'), issue('b'), issue('c')],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'b', 'c'],
      ],
    );
    assert.deepEqual(
      only(auditDocument({ document, wouldCycle: realProbe(document) }), 'cycle'),
      [],
    );
  });

  it('reports a blocked-by whose target is closed as a stale blocker', () => {
    const document = documentOf(
      [issue('a'), issue('b', 'closed')],
      [['blocked-by', 'a', 'b']],
    );
    const found = only(auditDocument({ document, wouldCycle: realProbe(document) }), 'stale-blocker');
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]?.members, ['a', 'b']);
    assert.equal(found[0]?.severity, 'misleading');
  });

  it('does not call an OPEN blocker stale, nor one the document does not hold', () => {
    // The second half is the paging boundary: an unresolved target is UNKNOWN,
    // not closed, and reporting it would state as bookkeeping something that is
    // really "this issue has not been loaded".
    const document = documentOf(
      [issue('a'), issue('b')],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'a', 'elsewhere'],
      ],
    );
    assert.deepEqual(
      only(auditDocument({ document, wouldCycle: realProbe(document) }), 'stale-blocker'),
      [],
    );
  });

  it('reports a duplicate-of whose canonical is closed as a dead duplicate ref', () => {
    const document = documentOf(
      [issue('a'), issue('b', 'closed')],
      [['duplicate-of', 'a', 'b']],
    );
    const found = only(
      auditDocument({ document, wouldCycle: realProbe(document) }),
      'dead-duplicate-ref',
    );
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]?.members, ['a', 'b']);
    assert.equal(found[0]?.severity, 'dangerous');
  });

  it('leaves a duplicate-of pointing at an open canonical alone', () => {
    const document = documentOf([issue('a'), issue('b')], [['duplicate-of', 'a', 'b']]);
    assert.deepEqual(
      only(auditDocument({ document, wouldCycle: realProbe(document) }), 'dead-duplicate-ref'),
      [],
    );
  });

  it('reports an issue whose declaration the reader refused', () => {
    // The class that is not a relationship finding: without it, `b` is
    // indistinguishable from an issue that legitimately declares nothing, which
    // §17e says most issues do.
    const document = documentOf([issue('a'), issue('b')], []);
    const findings = auditDocument({
      document,
      wouldCycle: realProbe(document),
      encodingRefused: [{ ref: 'b', diagnostic: 'no `---` pair delimits the block' }],
    });
    const found = only(findings, 'encoding-refused');
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]?.members, ['b']);
    assert.equal(found[0]?.severity, 'blocks-own-edges');
    assert.match(found[0]?.detail ?? '', /no `---` pair delimits the block/);
  });

  it('reports a refusal for an issue the document does not carry', () => {
    // A refusal is a fact the HOST asserted about an issue it read. Filtering to
    // the loaded set would drop findings on exactly the issues a paging boundary
    // has not reached, which is the quiet direction.
    const document = documentOf([issue('a')], []);
    const found = only(
      auditDocument({
        document,
        wouldCycle: realProbe(document),
        encodingRefused: [{ ref: 'unloaded' }],
      }),
      'encoding-refused',
    );
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]?.members, ['unloaded']);
  });

  it('reports one refusal per issue however many times the host states it', () => {
    const document = documentOf([issue('a')], []);
    const found = only(
      auditDocument({
        document,
        wouldCycle: realProbe(document),
        encodingRefused: [{ ref: 'a' }, { ref: 'a', diagnostic: 'again' }],
      }),
      'encoding-refused',
    );
    assert.equal(found.length, 1);
  });

  it('reports every class from one document, in the order §17d states them', () => {
    const document = documentOf(
      [issue('a'), issue('b'), issue('c'), issue('closed-1', 'closed'), issue('closed-2', 'closed')],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'b', 'a'],
        ['blocked-by', 'c', 'closed-1'],
        ['duplicate-of', 'c', 'closed-2'],
      ],
    );
    const findings = auditDocument({
      document,
      wouldCycle: realProbe(document),
      encodingRefused: [{ ref: 'a' }],
    });
    assert.deepEqual(kindsOf(findings), [
      'cycle',
      'stale-blocker',
      'dead-duplicate-ref',
      'encoding-refused',
    ]);
  });
});

describe('cycle detection composes @issuegraph/derive rather than re-deriving it', () => {
  it('finds nothing when the probe finds nothing, even on a document that cycles', () => {
    // THE LOAD-BEARING TEST. The document below contains a plain three-cycle,
    // and a detector with a walk of its own would report it whatever the probe
    // said. This asserts the walk is NOT here: with the port answering false,
    // the class yields nothing.
    const document = documentOf(
      [issue('a'), issue('b'), issue('c')],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'b', 'c'],
        ['blocked-by', 'c', 'a'],
      ],
    );
    const never: CycleProbe = () => false;
    assert.deepEqual(only(auditDocument({ document, wouldCycle: never }), 'cycle'), []);
  });

  it('asks the probe once per blocked-by edge, and about nothing else', () => {
    // The other direction: the port is asked exactly the question it answers —
    // "would this blocked-by close a loop" — for the blocked-by edges and no
    // others. A `duplicate-of` reaching the cycle probe would be a category
    // error the probe cannot refuse.
    const document = documentOf(
      [issue('a'), issue('b'), issue('c', 'closed')],
      [
        ['blocked-by', 'a', 'b'],
        ['duplicate-of', 'a', 'c'],
      ],
    );
    const asked: (readonly [IssueRef, IssueRef])[] = [];
    auditDocument({
      document,
      wouldCycle: (from, to) => {
        asked.push([from, to]);
        return false;
      },
    });
    assert.deepEqual(asked, [['a', 'b']]);
  });

  it('agrees with derive on a cycle that only the duplicate resolution reveals', () => {
    // §4.3.3 makes an edge naming a duplicate name its CANONICAL instead, so
    // this graph cycles only once that rule is applied — which is precisely the
    // rule a second implementation out here would have had to restate. The
    // fixture's own nodes therefore declare the duplicate, and the probe is
    // derive's.
    const nodes: readonly NodeInput[] = [
      node('x', { blockedBy: ['y'] }),
      node('y', { blockedBy: ['z'] }),
      node('z', { duplicateOf: 'x' }),
    ];
    // `y blocked-by z` reads as `y blocked-by x`, so `x blocked-by y` closes it.
    assert.equal(wouldCycleOnBlockedBy(nodes, 'x', 'y'), true);

    const document: GraphDocument = {
      issues: [issue('x'), issue('y'), issue('z')],
      edges: [makeEdge('blocked-by', 'x', 'y'), makeEdge('blocked-by', 'y', 'z')],
    };
    const found = only(
      auditDocument({
        document,
        wouldCycle: (from, to) => wouldCycleOnBlockedBy(nodes, from, to),
      }),
      'cycle',
    );
    assert.equal(found.length, 1);
    // `z` IS NAMED, THOUGH THE LOOP IS x -> y -> x ONCE THE DUPLICATE RESOLVES.
    // Both edges lie on it, and the one an owner has to edit to break it is
    // `y blocked-by z` — which they cannot find if the finding names only the
    // resolved endpoints. The component is the set of issues the finding is
    // about, not the shortest walk through it.
    assert.deepEqual(found[0]?.members, ['x', 'y', 'z']);
  });
});

/** A node with only the fields a fixture cares about; the rest are inert. */
function node(
  id: string,
  declared: { blockedBy?: readonly string[]; duplicateOf?: string },
): NodeInput {
  return {
    id,
    repo: null,
    open: true,
    labels: [],
    assigneeCount: 0,
    data: {
      blockedBy: (declared.blockedBy ?? []).map((ref) => ({ repo: null, id: ref })),
      decomposedFrom: null,
      duplicateOf: declared.duplicateOf === undefined ? null : { repo: null, id: declared.duplicateOf },
      serializeWith: null,
      togetherWith: null,
      priority: null,
      evidence: null,
    },
    declarationRead: 'read',
  };
}

describe('severity travels on the finding', () => {
  it('carries the class table onto every finding it produces', () => {
    // "Severity is data on the finding, not a colour chosen at the render site."
    // Asserted against the table rather than against four literals, so a class
    // added later is covered without this test being edited.
    const document = documentOf(
      [issue('a'), issue('b'), issue('closed-1', 'closed'), issue('closed-2', 'closed')],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'b', 'a'],
        ['blocked-by', 'a', 'closed-1'],
        ['duplicate-of', 'b', 'closed-2'],
      ],
    );
    const findings = auditDocument({
      document,
      wouldCycle: realProbe(document),
      encodingRefused: [{ ref: 'a' }],
    });
    assert.equal(new Set(kindsOf(findings)).size, AUDIT_CLASSES.length, 'not every class fired');
    for (const found of findings) {
      const spec = AUDIT_CLASS_SPECS[found.kind];
      assert.equal(found.severity, spec.severity);
      assert.equal(found.keepAsHistory, spec.keepAsHistory);
    }
  });

  it('offers "keep as history" on stale-blocker and on nothing else', () => {
    // Over the WHOLE table, so a fifth class cannot arrive carrying the
    // affordance by accident.
    const offered = AUDIT_CLASSES.filter((kind) => AUDIT_CLASS_SPECS[kind].keepAsHistory);
    assert.deepEqual(offered, ['stale-blocker']);
  });

  it('states every class exactly once, and weights them uniquely', () => {
    // The weights decide which finding speaks for a row carrying several, so a
    // tie would make that answer depend on iteration order.
    const weights = AUDIT_CLASSES.map((kind) => AUDIT_CLASS_SPECS[kind].weight);
    assert.equal(new Set(weights).size, weights.length);
    assert.equal(new Set(AUDIT_CLASSES).size, AUDIT_CLASSES.length);
  });
});

describe('the detector is pure and total', () => {
  it('returns the same findings for the same document, whatever order the edges arrive in', () => {
    const forwards = documentOf(
      [issue('a'), issue('b'), issue('closed-1', 'closed')],
      [
        ['blocked-by', 'a', 'closed-1'],
        ['blocked-by', 'b', 'closed-1'],
      ],
    );
    const backwards = documentOf(
      [issue('b'), issue('a'), issue('closed-1', 'closed')],
      [
        ['blocked-by', 'b', 'closed-1'],
        ['blocked-by', 'a', 'closed-1'],
      ],
    );
    assert.deepEqual(
      auditDocument({ document: forwards, wouldCycle: realProbe(forwards) }),
      auditDocument({ document: backwards, wouldCycle: realProbe(backwards) }),
    );
  });

  it('finds nothing in an empty document', () => {
    const document: GraphDocument = { issues: [], edges: [] };
    assert.deepEqual(auditDocument({ document, wouldCycle: realProbe(document) }), []);
  });

  it('reports what it can see when an edge names an issue the document lacks', () => {
    // An audit that threw on the data it is auditing would be worse than one
    // that reports what it can.
    const document = documentOf([issue('a')], [['blocked-by', 'a', 'gone']]);
    assert.deepEqual(auditDocument({ document, wouldCycle: () => false }), []);
  });
});
