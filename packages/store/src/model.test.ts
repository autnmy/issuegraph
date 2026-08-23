import assert from 'node:assert/strict';
import { test } from 'node:test';

import { edgeId, findEdge, hasIssue, makeEdge, sameEdgeSet, sameIssueList } from './model.ts';
import { mixedIssues, threeOpenIssues, withEdge } from './testing/fixtures.ts';

test('a directed edge keeps its direction in its identity', () => {
  assert.notEqual(edgeId('blocked-by', '1', '2'), edgeId('blocked-by', '2', '1'));
  assert.notEqual(edgeId('decomposed-from', '1', '2'), edgeId('decomposed-from', '2', '1'));
  assert.notEqual(edgeId('duplicate-of', '1', '2'), edgeId('duplicate-of', '2', '1'));
});

test('a symmetric edge has one identity however it is written', () => {
  // §4.3.4 and §4.3.7: the group is the connected component treated as
  // undirected, so the two spellings are one relationship and an editor must
  // not show them as two.
  assert.equal(edgeId('serialize-with', '1', '2'), edgeId('serialize-with', '2', '1'));
  assert.equal(edgeId('together-with', '1', '2'), edgeId('together-with', '2', '1'));
});

test('the kind participates in identity, so a retype is a different edge', () => {
  assert.notEqual(edgeId('blocked-by', '1', '2'), edgeId('duplicate-of', '1', '2'));
});

test('a qualified cross-repository reference survives identity unparsed', () => {
  // §4.2 admits `owner/repo#123`. The store treats a reference as opaque, so
  // the endpoints must come back exactly as they went in.
  const edge = makeEdge('blocked-by', 'owner/repo#9', '1');
  assert.equal(edge.from, 'owner/repo#9');
  assert.equal(edge.to, '1');
  assert.equal(edge.id, edgeId('blocked-by', 'owner/repo#9', '1'));
});

test('a reference cannot forge another edge identity through the separator', () => {
  // The separator is escaped by `encodeURIComponent`, so a reference containing
  // one cannot be read as two.
  const forged = edgeId('blocked-by', '1|2', '3');
  const genuine = edgeId('blocked-by', '1', '2|3');
  assert.notEqual(forged, genuine);
});

test('findEdge and hasIssue read the document they are given', () => {
  const document = withEdge(threeOpenIssues(), 'blocked-by', '1', '2');
  const id = edgeId('blocked-by', '1', '2');
  assert.equal(findEdge(document, id)?.kind, 'blocked-by');
  assert.equal(findEdge(document, edgeId('blocked-by', '2', '1')), undefined);
  assert.ok(hasIssue(document, '1'));
  assert.ok(!hasIssue(document, '99'));
  assert.ok(hasIssue(mixedIssues(), 'owner/repo#9'));
});

test('sameEdgeSet compares as a set, so a reordering is not a change', () => {
  const a = [makeEdge('blocked-by', '1', '2'), makeEdge('duplicate-of', '3', '1')];
  const b = [a[1], a[0]].filter((edge) => edge !== undefined);
  assert.ok(sameEdgeSet(a, b));
  assert.ok(!sameEdgeSet(a, [...a, makeEdge('blocked-by', '2', '3')]));
  assert.ok(!sameEdgeSet(a, [makeEdge('blocked-by', '1', '2'), makeEdge('blocked-by', '3', '1')]));
});

test('sameIssueList notices a changed field, not only a changed length', () => {
  const document = threeOpenIssues();
  assert.ok(sameIssueList(document.issues, threeOpenIssues().issues));
  const closedOne = document.issues.map((issue, index) =>
    index === 0 ? { ...issue, state: 'closed' as const } : issue,
  );
  assert.ok(!sameIssueList(document.issues, closedOne));
  assert.ok(!sameIssueList(document.issues, document.issues.slice(1)));
});
