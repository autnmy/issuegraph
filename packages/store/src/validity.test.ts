import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type GraphDocument, edgeId, makeEdge } from './model.ts';
import type { Mutation, Proposal } from './mutation.ts';
import { edgeChangeFor, nextDocument, resultingEdge, structuralRefusal } from './validity.ts';
import { threeOpenIssues, withEdge } from './testing/fixtures.ts';

function mutation(proposal: Proposal): Mutation {
  return { ...proposal, mutationId: 'm1' };
}

function refusalCode(document: GraphDocument, proposal: Proposal): string | undefined {
  return structuralRefusal(document, mutation(proposal))?.code;
}

test('an ordinary create is not refused', () => {
  assert.equal(refusalCode(threeOpenIssues(), { op: 'create', kind: 'blocked-by', from: '1', to: '2' }), undefined);
});

test('a self-edge is refused', () => {
  assert.equal(refusalCode(threeOpenIssues(), { op: 'create', kind: 'blocked-by', from: '1', to: '1' }), 'self-edge');
});

test('an endpoint the document does not hold is refused', () => {
  assert.equal(refusalCode(threeOpenIssues(), { op: 'create', kind: 'blocked-by', from: '1', to: '99' }), 'unknown-issue');
  assert.equal(refusalCode(threeOpenIssues(), { op: 'create', kind: 'blocked-by', from: '99', to: '1' }), 'unknown-issue');
});

test('an exact duplicate is refused, and a different kind between the same pair is not', () => {
  const document = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  assert.equal(refusalCode(document, { op: 'create', kind: 'blocked-by', from: '1', to: '2' }), 'duplicate-edge');
  assert.equal(refusalCode(document, { op: 'create', kind: 'duplicate-of', from: '1', to: '2' }), undefined);
  // The reverse of a DIRECTED edge is a different relationship, so it is allowed.
  assert.equal(refusalCode(document, { op: 'create', kind: 'blocked-by', from: '2', to: '1' }), undefined);
});

test('the reverse of a SYMMETRIC edge is the same edge, so it is refused as a duplicate', () => {
  const document = withEdge(threeOpenIssues(), 'serialize-with', '1', '2');
  assert.equal(refusalCode(document, { op: 'create', kind: 'serialize-with', from: '2', to: '1' }), 'duplicate-edge');
});

test('an edit naming an edge the document does not hold is refused', () => {
  const missing = edgeId('blocked-by', '1', '2');
  for (const proposal of [
    { op: 'delete', edgeId: missing },
    { op: 'retype', edgeId: missing, nextKind: 'duplicate-of' },
    { op: 'flip', edgeId: missing },
  ] as const) {
    assert.equal(refusalCode(threeOpenIssues(), proposal), 'unknown-edge', proposal.op);
  }
});

test('a retype to the kind the edge already has is refused rather than dispatched', () => {
  const document = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const id = edgeId('blocked-by', '1', '2');
  assert.equal(refusalCode(document, { op: 'retype', edgeId: id, nextKind: 'blocked-by' }), 'unchanged-kind');
});

test('a retype that would collide with an existing edge is refused', () => {
  const document = withEdge(withEdge(threeOpenIssues(), 'blocked-by', '1', '2'), 'duplicate-of', '1', '2');
  const id = edgeId('blocked-by', '1', '2');
  assert.equal(refusalCode(document, { op: 'retype', edgeId: id, nextKind: 'duplicate-of' }), 'duplicate-edge');
});

test('flipping a symmetric edge is refused: there is no direction to flip', () => {
  for (const kind of ['serialize-with', 'together-with'] as const) {
    const document = withEdge(threeOpenIssues(), kind, '1', '2');
    assert.equal(refusalCode(document, { op: 'flip', edgeId: edgeId(kind, '1', '2') }), 'symmetric-edge');
  }
});

test('flipping a directed edge is allowed, and refused when it would collide', () => {
  const one = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  assert.equal(refusalCode(one, { op: 'flip', edgeId: edgeId('blocked-by', '1', '2') }), undefined);
  const both = withEdge(one, 'blocked-by', '2', '1');
  assert.equal(refusalCode(both, { op: 'flip', edgeId: edgeId('blocked-by', '1', '2') }), 'duplicate-edge');
});

test('flipping a self-edge that reached the document anyway is refused', () => {
  // `create` cannot produce one, but hydration can hand the store whatever the
  // tracker holds — including an encoding mistake somebody wrote by hand.
  const self = makeEdge('blocked-by', '1', '1');
  const document: GraphDocument = { issues: threeOpenIssues().issues, edges: [self] };
  assert.equal(refusalCode(document, { op: 'flip', edgeId: self.id }), 'self-edge');
});

test('every refusal carries a sentence, not only a code', () => {
  const refusal = structuralRefusal(
    threeOpenIssues(),
    mutation({ op: 'create', kind: 'blocked-by', from: '1', to: '1' }),
  );
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /itself/);
});

test('resultingEdge names what each operation produces', () => {
  const document = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const id = edgeId('blocked-by', '1', '2');
  assert.equal(resultingEdge(document, mutation({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' }))?.kind, 'duplicate-of');
  assert.equal(resultingEdge(document, mutation({ op: 'delete', edgeId: id })), undefined);
  assert.equal(resultingEdge(document, mutation({ op: 'retype', edgeId: id, nextKind: 'duplicate-of' }))?.kind, 'duplicate-of');
  const flipped = resultingEdge(document, mutation({ op: 'flip', edgeId: id }));
  assert.equal(flipped?.from, '2');
  assert.equal(flipped?.to, '1');
});

test('a pending delete MARKS its edge and hides nothing', () => {
  // Deliberate: the design draws a failed write as a ghost with a terminal, and
  // there is no ghost left to draw if an optimistic delete has already taken the
  // edge off the canvas.
  const document = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const id = edgeId('blocked-by', '1', '2');
  const change = edgeChangeFor(document, mutation({ op: 'delete', edgeId: id }));
  assert.deepEqual(change.hidden, []);
  assert.deepEqual(change.drawn, []);
  assert.deepEqual(change.marked, [id]);
});

test('a pending retype hides the old edge and draws the new one', () => {
  const document = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const id = edgeId('blocked-by', '1', '2');
  const change = edgeChangeFor(document, mutation({ op: 'retype', edgeId: id, nextKind: 'duplicate-of' }));
  assert.deepEqual(change.hidden, [id]);
  assert.deepEqual(
    change.drawn.map((edge) => edge.kind),
    ['duplicate-of'],
  );
  assert.deepEqual(change.marked, [edgeId('duplicate-of', '1', '2')]);
});

test('nextDocument produces the document each operation would land', () => {
  const document = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const id = edgeId('blocked-by', '1', '2');

  const created = nextDocument(document, mutation({ op: 'create', kind: 'duplicate-of', from: '3', to: '1' }));
  assert.equal(created.edges.length, 2);

  const deleted = nextDocument(document, mutation({ op: 'delete', edgeId: id }));
  assert.deepEqual(deleted.edges, []);

  const retyped = nextDocument(document, mutation({ op: 'retype', edgeId: id, nextKind: 'duplicate-of' }));
  assert.deepEqual(
    retyped.edges.map((edge) => edge.kind),
    ['duplicate-of'],
  );

  const flipped = nextDocument(document, mutation({ op: 'flip', edgeId: id }));
  assert.deepEqual(
    flipped.edges.map((edge) => [edge.from, edge.to]),
    [['2', '1']],
  );

  // The issues are carried through untouched: no operation edits an issue.
  assert.equal(created.issues, document.issues);
});
