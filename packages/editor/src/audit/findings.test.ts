import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildModel } from '@issuegraph/reader';
import type { NodeInput } from '@issuegraph/reader';
import { makeEdge } from '@issuegraph/store';
import type { EdgeKind, GraphDocument, IssueRef, StoredIssue } from '@issuegraph/store';

import { AUDIT_CLASSES, AUDIT_CLASS_SPECS, auditDocument } from './findings.ts';
import type { AuditClass, AuditFinding, AuditGraph } from './findings.ts';

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
 * The document as `@issuegraph/reader` reads it.
 *
 * REFS PASS THROUGH AS OPAQUE IDS, with no repo and no home repo — which makes
 * `nodeKey` and `refKey` identity functions, so the model keys on exactly the
 * strings the store holds. That translation is the HOST's, which is why it
 * lives in a fixture here and not in the package: a host builds the model, so
 * it is the only party holding both spellings.
 */
function asNodes(document: GraphDocument): readonly NodeInput[] {
  const single = (kind: EdgeKind, from: IssueRef): { repo: null; id: string } | null => {
    const edge = document.edges.find((held) => held.kind === kind && held.from === from);
    return edge === undefined ? null : { repo: null, id: edge.to };
  };
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
      decomposedFrom: single('decomposed-from', held.ref),
      duplicateOf: single('duplicate-of', held.ref),
      serializeWith: single('serialize-with', held.ref),
      togetherWith: single('together-with', held.ref),
      priority: null,
      evidence: null,
    },
    declarationRead: 'read',
  }));
}

/**
 * The real read-time answers, from `@issuegraph/reader`'s own model.
 *
 * NOT `@issuegraph/derive`'s `wouldCycleOnBlockedBy`, and every test in the
 * "composes the reader" block below exists to hold that line: the derive
 * function is a pre-write guard whose divergences lean fail-safe for a write,
 * which is the wrong direction for a statement about what a backlog IS.
 */
function graphOf(document: GraphDocument): AuditGraph {
  const model = buildModel(asNodes(document));
  return { cycles: model.cycles, duplicateCanonical: model.duplicateCanonical };
}

function kindsOf(findings: readonly AuditFinding[]): readonly AuditClass[] {
  return findings.map((found) => found.kind);
}

function only(findings: readonly AuditFinding[], kind: AuditClass): readonly AuditFinding[] {
  return findings.filter((found) => found.kind === kind);
}

function audit(document: GraphDocument): readonly AuditFinding[] {
  return auditDocument({ document, graph: graphOf(document) });
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
    const found = only(audit(document), 'cycle');
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
    const found = only(audit(document), 'cycle');
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
    assert.deepEqual(only(audit(document), 'cycle'), []);
  });

  it('reports a blocked-by whose target is closed as a stale blocker', () => {
    const document = documentOf([issue('a'), issue('b', 'closed')], [['blocked-by', 'a', 'b']]);
    const found = only(audit(document), 'stale-blocker');
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
    assert.deepEqual(only(audit(document), 'stale-blocker'), []);
  });

  it('reports a duplicate-of whose canonical is closed as a dead duplicate ref', () => {
    const document = documentOf([issue('a'), issue('b', 'closed')], [['duplicate-of', 'a', 'b']]);
    const found = only(audit(document), 'dead-duplicate-ref');
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]?.members, ['a', 'b']);
    assert.equal(found[0]?.severity, 'dangerous');
  });

  it('leaves a duplicate-of pointing at an open canonical alone', () => {
    const document = documentOf([issue('a'), issue('b')], [['duplicate-of', 'a', 'b']]);
    assert.deepEqual(only(audit(document), 'dead-duplicate-ref'), []);
  });

  it('reports an issue whose declaration the reader refused', () => {
    // The class that is not a relationship finding: without it, `b` is
    // indistinguishable from an issue that legitimately declares nothing, which
    // §17e says most issues do.
    const document = documentOf([issue('a'), issue('b')], []);
    const findings = auditDocument({
      document,
      graph: graphOf(document),
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
        graph: graphOf(document),
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
        graph: graphOf(document),
        encodingRefused: [{ ref: 'a' }, { ref: 'a', diagnostic: 'again' }],
      }),
      'encoding-refused',
    );
    assert.equal(found.length, 1);
  });

  it('reports every class from one document, in the order §17d states them', () => {
    const document = documentOf(
      [
        issue('a'),
        issue('b'),
        issue('c'),
        issue('d'),
        issue('closed-1', 'closed'),
        issue('closed-2', 'closed'),
      ],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'b', 'a'],
        ['blocked-by', 'c', 'closed-1'],
        // THE TWO EDGES SIT ON DIFFERENT ISSUES ON PURPOSE. A duplicate
        // contributes no relationship edges (4.3.3), so hanging the duplicate-of
        // on the same issue as the blocked-by silently suppresses the
        // stale-blocker and the fixture stops exercising the class it was written
        // for.
        ['duplicate-of', 'd', 'closed-2'],
      ],
    );
    const findings = auditDocument({
      document,
      graph: graphOf(document),
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

describe('the cycle class is the reader’s read-time answer, not a write guard', () => {
  it('reports nothing the model reports nothing for, even on a document with blocked-by edges', () => {
    // THE LOAD-BEARING TEST. A detector with a walk of its own would report the
    // three-cycle below whatever the port said. With the port empty, the class
    // yields nothing — so the walk is provably not here.
    const document = documentOf(
      [issue('a'), issue('b'), issue('c')],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'b', 'c'],
        ['blocked-by', 'c', 'a'],
      ],
    );
    const silent: AuditGraph = { cycles: [], duplicateCanonical: () => null };
    assert.deepEqual(only(auditDocument({ document, graph: silent }), 'cycle'), []);
  });

  it('does NOT call a together unit’s own internal ordering a cycle', () => {
    // §6.6: internal blocked-by edges "stay advisory ... they would make every
    // group carrying its own ordering read as stuck". The pre-write guard in
    // `@issuegraph/derive` deliberately does NOT exempt them — correct before a
    // write, wrong as a statement about what the backlog IS — so reading that
    // guard as an edge-on-cycle test lights up every ordinary together group.
    const document = documentOf(
      [issue('a'), issue('b')],
      [
        ['together-with', 'a', 'b'],
        ['blocked-by', 'a', 'b'],
      ],
    );
    assert.deepEqual(only(audit(document), 'cycle'), []);
  });

  it('still reports the deadlock the contraction is what reveals', () => {
    // The other side of that line, and §6.6's own worked example: #1 blocked-by
    // #2, #3 blocked-by #1, #2 together-with #3 can never start, yet every
    // issue reports an ordinary open blocker. Exempting internal edges must not
    // cost this.
    const document = documentOf(
      [issue('1'), issue('2'), issue('3')],
      [
        ['blocked-by', '1', '2'],
        ['blocked-by', '3', '1'],
        ['together-with', '2', '3'],
      ],
    );
    const found = only(audit(document), 'cycle');
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]?.members, ['1', '2', '3']);
  });

  it('does not call a cycle through a CLOSED issue stuck', () => {
    // The guard spans closed nodes on purpose — an edge outlives today's states
    // — while §6.6 is a statement about now. A closed member does not block, so
    // the rest can be ready and `blocks-work` would be false.
    const document = documentOf(
      [issue('a'), issue('b'), issue('c', 'closed')],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'b', 'c'],
        ['blocked-by', 'c', 'a'],
      ],
    );
    assert.deepEqual(only(audit(document), 'cycle'), []);
  });
});

describe('duplicate chains resolve transitively', () => {
  it('reports every dead reference in a chain, not only the last hop', () => {
    // `a -> b -> c` with `c` closed: the reader excludes BOTH `a` and `b` from
    // the order, so both references are dead. Testing each edge's immediate
    // target reports `b` and misses `a`, because `b` itself is open — a silent
    // miss in the one class whose point is work that looks handled and is not.
    const document = documentOf(
      [issue('a'), issue('b'), issue('c', 'closed')],
      [
        ['duplicate-of', 'a', 'b'],
        ['duplicate-of', 'b', 'c'],
      ],
    );
    const found = only(audit(document), 'dead-duplicate-ref');
    assert.deepEqual(
      found.map((one) => one.members),
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    );
    assert.match(found[0]?.detail ?? '', /duplicate-of c \(through b\)/);
  });

  it('calls a blocker that duplicates a closed issue stale', () => {
    // §4.3.3 reads `blocked-by b` as `blocked-by c` when `b` duplicates `c`, so
    // the effective blocker is closed and readiness is already satisfied.
    const document = documentOf(
      [issue('a'), issue('b'), issue('c', 'closed')],
      [
        ['blocked-by', 'a', 'b'],
        ['duplicate-of', 'b', 'c'],
      ],
    );
    const found = only(audit(document), 'stale-blocker');
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]?.members, ['a', 'b']);
    assert.match(found[0]?.detail ?? '', /blocked-by c \(via b, which duplicates it\)/);
  });
});

describe('a refused declaration is not a discharged blocker', () => {
  it('does not call a closed BUT UNDER-READ blocker stale', () => {
    // The reader keeps a dependent unready when the thing its edge resolved to
    // was under-read, because the declaration it could not read may carry a
    // `duplicate-of` redirecting the edge at an OPEN canonical. Calling that
    // stale presents a live fail-safe constraint as disposable bookkeeping —
    // the worst direction for the one class whose whole message is "clearing
    // this is bookkeeping".
    const document = documentOf([issue('a'), issue('b', 'closed')], [['blocked-by', 'a', 'b']]);
    const findings = auditDocument({
      document,
      graph: graphOf(document),
      encodingRefused: [{ ref: 'b' }],
    });
    assert.deepEqual(only(findings, 'stale-blocker'), []);
    // ...and it still says what IS wrong with `b`, so nothing is lost.
    assert.equal(only(findings, 'encoding-refused').length, 1);
  });

  it('still calls a closed, fully-read blocker stale', () => {
    // The control: without it the test above passes on a detector that
    // suppressed every stale blocker.
    const document = documentOf([issue('a'), issue('b', 'closed')], [['blocked-by', 'a', 'b']]);
    const findings = auditDocument({
      document,
      graph: graphOf(document),
      encodingRefused: [{ ref: 'somebody-else' }],
    });
    assert.equal(only(findings, 'stale-blocker').length, 1);
  });

  it('does not claim a refused issue has NO edges', () => {
    // A dropped FIELD returns non-null data carrying the surviving
    // relationships, so "the issue has no edges" is false for the commonest
    // refusal there is — and an audit that overstates what it found is the
    // same defect as one that understates it.
    const document = documentOf([issue('a'), issue('b')], [['blocked-by', 'a', 'b']]);
    const found = only(
      auditDocument({
        document,
        graph: graphOf(document),
        encodingRefused: [{ ref: 'a' }],
      }),
      'encoding-refused',
    );
    assert.equal(/has no edges/.test(found[0]?.detail ?? ''), false);
    assert.match(found[0]?.detail ?? '', /incomplete and cannot be trusted/);
  });
});

describe('a finding about a CLOSED issue is finished history, not a defect', () => {
  it('does not flag a closed duplicate whose canonical has since closed', () => {
    // The normal end of a lifecycle: closed as a duplicate, then the canonical
    // work completed. Nothing is hidden and nothing is untracked, so a
    // `dangerous` finding here would sit on completed history for ever.
    const document = documentOf(
      [issue('a', 'closed'), issue('b', 'closed')],
      [['duplicate-of', 'a', 'b']],
    );
    assert.deepEqual(only(audit(document), 'dead-duplicate-ref'), []);
  });

  it('still flags an OPEN duplicate of a closed canonical — the control', () => {
    // Without this the test above passes on a detector that stopped reporting
    // the class at all.
    const document = documentOf(
      [issue('a'), issue('b', 'closed')],
      [['duplicate-of', 'a', 'b']],
    );
    assert.equal(only(audit(document), 'dead-duplicate-ref').length, 1);
  });

  it('does not call a closed issue\'s blocker stale', () => {
    // The sibling instance of the same class: "readiness is already satisfied"
    // says nothing about an issue that is not waiting to start.
    const document = documentOf(
      [issue('a', 'closed'), issue('b', 'closed')],
      [['blocked-by', 'a', 'b']],
    );
    assert.deepEqual(only(audit(document), 'stale-blocker'), []);
  });

  it('reports a duplicate the document does not carry, because unknown is not closed', () => {
    // An absent issue is UNKNOWN, and an unknown must not silence a `dangerous`
    // finding — the mirror of the rule on the target side, where only a proven
    // closure raises one.
    const document = documentOf([issue('b', 'closed')], [['duplicate-of', 'ghost', 'b']]);
    assert.equal(only(audit(document), 'dead-duplicate-ref').length, 1);
  });
});

describe('an unknowable target yields no verdict, in BOTH classes that read one', () => {
  // The shared resolution's whole reason to exist: both classes ask the same
  // three questions of an edge, and each was found missing a different one a
  // round apart. These run the same shape through both.
  it('does not call a duplicate of a closed-but-UNDER-READ canonical dead', () => {
    // `b`'s dropped `duplicate-of` may redirect the chain at an OPEN canonical,
    // in which case `a`'s work IS tracked and "tracked nowhere" is false.
    const document = documentOf([issue('a'), issue('b', 'closed')], [['duplicate-of', 'a', 'b']]);
    const findings = auditDocument({
      document,
      graph: graphOf(document),
      encodingRefused: [{ ref: 'b' }],
    });
    assert.deepEqual(only(findings, 'dead-duplicate-ref'), []);
    assert.equal(only(findings, 'encoding-refused').length, 1);
  });

  it('still calls a duplicate of a closed, fully-read canonical dead', () => {
    // The control: without it the test above passes on a detector that stopped
    // reporting the class at all.
    const document = documentOf([issue('a'), issue('b', 'closed')], [['duplicate-of', 'a', 'b']]);
    const findings = auditDocument({
      document,
      graph: graphOf(document),
      encodingRefused: [{ ref: 'somebody-else' }],
    });
    assert.equal(only(findings, 'dead-duplicate-ref').length, 1);
  });

  it('still reports both classes when only the DECLARER was refused', () => {
    // The scope of the suppression, pinned in the other direction. A refusal
    // costs knowledge of where the edge POINTS, so the declarer's own refusal
    // says nothing about whether the issue on the other end is closed.
    // Two declarers, because a duplicate contributes no relationship edges —
    // one issue carrying both would suppress its own stale-blocker for an
    // unrelated reason and prove nothing about refusals.
    const document = documentOf(
      [issue('a'), issue('b'), issue('closed-1', 'closed'), issue('closed-2', 'closed')],
      [
        ['blocked-by', 'a', 'closed-1'],
        ['duplicate-of', 'b', 'closed-2'],
      ],
    );
    const findings = auditDocument({
      document,
      graph: graphOf(document),
      encodingRefused: [{ ref: 'a' }, { ref: 'b' }],
    });
    assert.equal(only(findings, 'stale-blocker').length, 1);
    assert.equal(only(findings, 'dead-duplicate-ref').length, 1);
  });
});

describe('an edge the reader never reads holds nothing', () => {
  it('does not call a DUPLICATE\'s blocked-by stale', () => {
    // §4.3.3: a duplicate contributes no relationship edges, and `buildModel`
    // skips such a node outright — an issue nobody may work cannot block one.
    // So this edge decides no readiness, and "readiness is already satisfied"
    // is a claim about an edge that decides nothing.
    const document = documentOf(
      [issue('a'), issue('canonical'), issue('gone', 'closed')],
      [
        ['duplicate-of', 'a', 'canonical'],
        ['blocked-by', 'a', 'gone'],
      ],
    );
    assert.deepEqual(only(audit(document), 'stale-blocker'), []);
  });

  it('still calls a NON-duplicate\'s blocked-by stale — the control', () => {
    const document = documentOf(
      [issue('a'), issue('gone', 'closed')],
      [['blocked-by', 'a', 'gone']],
    );
    assert.equal(only(audit(document), 'stale-blocker').length, 1);
  });

  it('still reports a duplicate-of declared by a duplicate, which is its premise', () => {
    // The rule is per class, not blanket. The reader walks a duplicate's own
    // `duplicate-of` directly, ahead of the skip — and a class about duplicates
    // that ignored every duplicate would report nothing at all.
    const document = documentOf(
      [issue('a'), issue('closed-canonical', 'closed')],
      [['duplicate-of', 'a', 'closed-canonical']],
    );
    assert.equal(only(audit(document), 'dead-duplicate-ref').length, 1);
  });
});

describe('an absent declarer is unknown, and the two classes want opposite defaults', () => {
  it('does not call an ABSENT issue\'s blocker stale', () => {
    // The message runs "you can clear this". On a declarer the document does
    // not carry, nobody has established there is live work waiting at all — and
    // a partial or paged document is exactly where that arises — so the finding
    // would invite deleting a constraint on no evidence.
    const document = documentOf([issue('gone', 'closed')], [['blocked-by', 'absent', 'gone']]);
    assert.deepEqual(only(audit(document), 'stale-blocker'), []);
  });

  it('still calls a PRESENT open issue\'s blocker stale — the control', () => {
    const document = documentOf(
      [issue('a'), issue('gone', 'closed')],
      [['blocked-by', 'a', 'gone']],
    );
    assert.equal(only(audit(document), 'stale-blocker').length, 1);
  });

  it('DOES report an absent declarer\'s dead duplicate ref', () => {
    // The asymmetry, pinned. This class warns that live work is tracked
    // nowhere: a false alarm on an issue nobody loaded costs a look, while
    // silence hides exactly what the class exists for.
    const document = documentOf(
      [issue('canonical', 'closed')],
      [['duplicate-of', 'absent', 'canonical']],
    );
    assert.equal(only(audit(document), 'dead-duplicate-ref').length, 1);
  });
});

describe('a weak target may add a constraint and never satisfy one', () => {
  it('does not resolve a blocker through a target the document does not carry', () => {
    // The reader canonicalizes a reference only when its target is
    // REFERENCEABLE, and a declarer-only node is not: it is in the key map and
    // explicitly does not become referenceable, because a weak node may add
    // constraints and may never satisfy one. `a blocked-by weak`, `weak
    // duplicate-of done`, `done` closed leaves `a` blocked by an UNRESOLVABLE
    // ref — and reporting it stale invites removing an active fail-safe
    // constraint.
    const document = documentOf([issue('a'), issue('done', 'closed')], [['blocked-by', 'a', 'weak']]);
    const graph: AuditGraph = {
      cycles: [],
      // The model answers for a weak key it holds; the audit must not ask about
      // one the document does not carry.
      duplicateCanonical: (ref) => (ref === 'weak' ? 'done' : null),
    };
    assert.deepEqual(
      auditDocument({ document, graph }).filter((one) => one.kind === 'stale-blocker'),
      [],
    );
  });

  it('still resolves through a target the document DOES carry — the control', () => {
    // The full-node case, which is what `referenceable` admits and what the
    // reader really does canonicalize.
    const document = documentOf(
      [issue('a'), issue('dup'), issue('done', 'closed')],
      [
        ['blocked-by', 'a', 'dup'],
        ['duplicate-of', 'dup', 'done'],
      ],
    );
    const found = audit(document).filter((one) => one.kind === 'stale-blocker');
    assert.equal(found.length, 1);
    assert.match(found[0]?.detail ?? '', /blocked-by done \(via dup, which duplicates it\)/);
  });
});

describe('severity travels on the finding', () => {
  it('carries the class table onto every finding it produces', () => {
    // "Severity is data on the finding, not a colour chosen at the render site."
    // Asserted against the table rather than against four literals, so a class
    // added later is covered without this test being edited.
    // The duplicate-of sits on `c`, NOT on a cycle member: §4.3.3 excludes a
    // duplicate from the order and `buildModel` drops its own edges, so a
    // duplicated cycle member is no longer in the cycle graph at all — the
    // fixture would quietly stop exercising the class it was written for.
    const document = documentOf(
      [
        issue('a'),
        issue('b'),
        issue('c'),
        issue('closed-1', 'closed'),
        issue('closed-2', 'closed'),
      ],
      [
        ['blocked-by', 'a', 'b'],
        ['blocked-by', 'b', 'a'],
        ['blocked-by', 'a', 'closed-1'],
        ['duplicate-of', 'c', 'closed-2'],
      ],
    );
    const findings = auditDocument({
      document,
      graph: graphOf(document),
      encodingRefused: [{ ref: 'a' }],
    });
    assert.equal(new Set(kindsOf(findings)).size, AUDIT_CLASSES.length, 'not every class fired');
    for (const found of findings) {
      const spec = AUDIT_CLASS_SPECS[found.kind];
      assert.equal(found.severity, spec.severity);
      assert.equal(found.keepAsHistory, spec.keepAsHistory);
      assert.equal(Object.isFrozen(found), true);
      assert.equal(Object.isFrozen(found.members), true);
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
    assert.deepEqual(audit(forwards), audit(backwards));
  });

  it('finds nothing in an empty document', () => {
    const document: GraphDocument = { issues: [], edges: [] };
    assert.deepEqual(audit(document), []);
  });

  it('reports what it can see when an edge names an issue the document lacks', () => {
    // An audit that threw on the data it is auditing would be worse than one
    // that reports what it can.
    const document = documentOf([issue('a')], [['blocked-by', 'a', 'gone']]);
    assert.deepEqual(audit(document), []);
  });

  it('draws no finding for a stuck group the reader reports empty', () => {
    // A finding naming nobody would add to the header count while giving a
    // reader nothing to navigate to.
    const document = documentOf([issue('a')], []);
    const empty: AuditGraph = { cycles: [[]], duplicateCanonical: () => null };
    assert.deepEqual(auditDocument({ document, graph: empty }), []);
  });
});
