/**
 * The in-memory adapter: a whole data source with no tracker behind it.
 *
 * It exists to make BYO-DataSource a fact rather than a claim. A seam that only
 * one real adapter has ever driven is a seam by assertion, and a demo that
 * needs an app installation, an auth flow and a backend proves nothing about
 * whether the port is a port. This one holds a document in a variable, applies
 * every edit to it, and answers immediately.
 *
 * It is a reference implementation, not a test double: it is the adapter a
 * public demo runs on, and the shortest correct answer to "what does an adapter
 * have to do?".
 */

import {
  type GraphDocument,
  type StoredEdge,
  findEdge,
  makeEdge,
  sameEdgeSet,
} from '../model.ts';
import type { Mutation } from '../mutation.ts';
import type { DataSource, DispatchResult } from '../source.ts';

/** An in-memory data source, plus a window onto what it currently holds. */
export interface MemorySource extends DataSource {
  /** The document as it stands. For a demo's "reset" button, and for tests. */
  current(): GraphDocument;
}

/**
 * Apply an edit to a document, or report that it changes nothing.
 *
 * Returns `undefined` for a no-op — a delete of an edge that is not there, a
 * create of one that already is. The store has its own refusals for those, but
 * an adapter cannot assume it is talking to this store, and answering
 * `unchanged` is both truthful and what a real tracker would say.
 */
function applied(document: GraphDocument, mutation: Mutation): readonly StoredEdge[] | undefined {
  switch (mutation.op) {
    case 'create': {
      const edge = makeEdge(mutation.kind, mutation.from, mutation.to);
      if (findEdge(document, edge.id) !== undefined) return undefined;
      return [...document.edges, edge];
    }
    case 'delete': {
      if (findEdge(document, mutation.edgeId) === undefined) return undefined;
      return document.edges.filter((edge) => edge.id !== mutation.edgeId);
    }
    case 'retype': {
      const edge = findEdge(document, mutation.edgeId);
      if (edge === undefined) return undefined;
      const next = makeEdge(mutation.nextKind, edge.from, edge.to);
      const kept = document.edges.filter((other) => other.id !== edge.id);
      if (kept.some((other) => other.id === next.id)) return kept;
      return [...kept, next];
    }
    case 'flip': {
      const edge = findEdge(document, mutation.edgeId);
      if (edge === undefined) return undefined;
      const next = makeEdge(edge.kind, edge.to, edge.from);
      const kept = document.edges.filter((other) => other.id !== edge.id);
      if (kept.some((other) => other.id === next.id)) return kept;
      return [...kept, next];
    }
  }
}

/**
 * A data source holding one document in memory.
 *
 * Every edit applies and nothing ever fails, which is the point: this is the
 * happy path with no infrastructure at all. Inducing failure and conflict is
 * {@link ../adapters/scripted.ts createScriptedSource}'s job, and keeping the
 * two apart is what makes them two adapters rather than one with a switch.
 */
export function createMemorySource(seed: GraphDocument): MemorySource {
  let document: GraphDocument = { issues: [...seed.issues], edges: [...seed.edges] };

  return {
    current: () => document,

    hydrate: () => Promise.resolve(document),

    dispatch(mutation: Mutation): Promise<DispatchResult> {
      const edges = applied(document, mutation);
      if (edges === undefined || sameEdgeSet(document.edges, edges)) {
        return Promise.resolve({ outcome: 'unchanged' });
      }
      document = { issues: document.issues, edges };
      return Promise.resolve({ outcome: 'applied', document });
    },
  };
}
