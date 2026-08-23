/**
 * Shared fixtures for this package's tests.
 *
 * `src/testing/` is excluded from the build alongside the tests themselves, so
 * nothing here reaches `dist`: a package that published its own test
 * scaffolding would be a package whose consumers could depend on it.
 *
 * The fixture deriver's own capacity to move is pinned in `store.test.ts`,
 * beside the assertion that depends on it — a deriver that never moved would
 * make "the order does not move while a write is pending" vacuously true.
 */

import type { EdgeKind, GraphDocument, StoredIssue } from '../model.ts';
import { makeEdge } from '../model.ts';
import type { Mutation } from '../mutation.ts';
import type { OrderRow } from '../source.ts';

function issue(ref: string, state: StoredIssue['state'] = 'open'): StoredIssue {
  return { ref, title: `Issue ${ref}`, state };
}

/**
 * Three open issues and nothing else.
 *
 * Deliberately edge-free: every test that needs a relationship creates it,
 * which means the test also states the edit that produced it rather than
 * inheriting one from a fixture nobody re-reads.
 */
export function threeOpenIssues(): GraphDocument {
  return { issues: [issue('1'), issue('2'), issue('3')], edges: [] };
}

/** The same three, plus a closed one and a cross-repository reference (§4.2). */
export function mixedIssues(): GraphDocument {
  return {
    issues: [issue('1'), issue('2'), issue('3'), issue('4', 'closed'), issue('owner/repo#9')],
    edges: [],
  };
}

/** A document with one relationship already in it. */
export function withEdge(document: GraphDocument, kind: EdgeKind, from: string, to: string): GraphDocument {
  return { issues: document.issues, edges: [...document.edges, makeEdge(kind, from, to)] };
}

/**
 * A deliberately trivial selection order: ready issues first, then by reference.
 *
 * It is NOT the reference derivation — that is its own package, and writing a
 * real one here would be the second implementation this store's injected
 * deriver exists to avoid. It only has to move when a `blocked-by` lands, which
 * is all the store's own claims are about.
 */
export function simpleDeriver(document: GraphDocument): readonly OrderRow[] {
  const closed = new Set(
    document.issues.filter((candidate) => candidate.state === 'closed').map((candidate) => candidate.ref),
  );
  const rows = document.issues
    .filter((candidate) => candidate.state === 'open')
    .map((candidate) => {
      const holdReasons = document.edges
        .filter((edge) => edge.kind === 'blocked-by' && edge.from === candidate.ref)
        .map((edge) => edge.to)
        .filter((ref) => !closed.has(ref))
        .map((ref) => `blocked by ${ref}`);
      return { ref: candidate.ref, ready: holdReasons.length === 0, holdReasons };
    });
  rows.sort(
    (left, right) =>
      Number(right.ready) - Number(left.ready) || (left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0),
  );
  return rows.map((row, rank) => ({ ...row, rank }));
}

/**
 * Apply an edit the way a well-behaved tracker would.
 *
 * The scripted source takes this as its `apply`, so the two adapters agree on
 * what an edit MEANS while differing on when — and only when — it settles.
 */
export function applyEdit(document: GraphDocument, mutation: Mutation): GraphDocument {
  switch (mutation.op) {
    case 'create':
      return {
        issues: document.issues,
        edges: [...document.edges, makeEdge(mutation.kind, mutation.from, mutation.to)],
      };
    case 'delete':
      return { issues: document.issues, edges: document.edges.filter((edge) => edge.id !== mutation.edgeId) };
    case 'retype': {
      const target = document.edges.find((edge) => edge.id === mutation.edgeId);
      if (target === undefined) return document;
      return {
        issues: document.issues,
        edges: [
          ...document.edges.filter((edge) => edge.id !== mutation.edgeId),
          makeEdge(mutation.nextKind, target.from, target.to),
        ],
      };
    }
    case 'flip': {
      const target = document.edges.find((edge) => edge.id === mutation.edgeId);
      if (target === undefined) return document;
      return {
        issues: document.issues,
        edges: [
          ...document.edges.filter((edge) => edge.id !== mutation.edgeId),
          makeEdge(target.kind, target.to, target.from),
        ],
      };
    }
  }
}
