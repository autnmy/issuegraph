/**
 * The ports. Everything the host supplies, and nothing this package implements.
 *
 * Three of them, and each exists because the alternative would put something in
 * the package that cannot be there:
 *
 * - {@link DataSource} — auth, network and persistence. A package that fetched
 *   would be a client for one tracker with a pluggable skin.
 * - {@link OrderDeriver} — the selection order. Writing one here would make a
 *   second implementation of the thing the reference packages exist to have one
 *   of. The store owns *when* the order is recomputed; the deriver owns *what*
 *   it is.
 * - {@link EdgeGuard} — refusals that need to see the graph, cycles above all.
 *   Same reason: the walk belongs with the derivation, not beside it.
 */

import type { GraphDocument, IssueRef } from './model.ts';
import type { InvalidReason, Mutation } from './mutation.ts';

/**
 * What the host plugs its tracker in through.
 *
 * Two methods, deliberately. Anything an adapter needs beyond them — a token, a
 * retry policy, a rate limiter, a cache — stays on its own side of this
 * interface, where the store cannot see it and does not have to model it.
 *
 * **The store dispatches once per mutation and never retries on its own.** A
 * retry is a user act (the `retry` on a failed edge), so an adapter must not
 * assume an idempotency it has not been given.
 *
 * **It also runs ONE AUTHORITATIVE OPERATION AT A TIME**, queueing the rest.
 * `hydrate` and an `applied` `dispatch` both answer with a full authoritative
 * document and this interface gives neither a version, so two in flight cannot
 * be ordered by anything the store can observe: the later answer arriving
 * first, then the earlier one, silently rolls an edge back out — after which
 * the order derives from a backlog missing a real relationship. Adding a
 * version here would push bookkeeping onto every adapter, so the store declines
 * to create the situation instead. An adapter may therefore assume its
 * `dispatch` is never re-entered, and never overlapped by a `hydrate`.
 */
export interface DataSource {
  /** The whole document. Called on `hydrate()` and again on `rehydrate()`. */
  hydrate(): Promise<GraphDocument>;
  /** Perform one edit. Resolving with an outcome; rejecting is read as `rejected`. */
  dispatch(mutation: Mutation): Promise<DispatchResult>;
}

/**
 * How a dispatch settled.
 *
 * Four arms. `applied` and `unchanged` are both authoritative statements about
 * the document and both carry one; they differ only in whether this edit caused
 * the difference, which is what decides whether a change summary is emitted.
 * Collapsing them would attribute somebody else's movement to this edit;
 * letting `unchanged` carry nothing left the store unable to act on a perfectly
 * good answer.
 */
export type DispatchResult =
  | {
      /**
       * The edit landed. `document` is the AUTHORITATIVE state afterwards, not
       * a patch and not a slice: a partial answer would need merge rules, and
       * merge rules are exactly where an optimistic store goes wrong. The
       * document is small enough to be client-side by construction, so sending
       * all of it removes the whole class.
       *
       * A WHOLE DOCUMENT, ISSUES INCLUDED — not an edge set. When this answered
       * with edges alone, "what the store holds is newer" was true of edges and
       * false of issues, so the store's freshness question had two dimensions
       * and only one of them was tracked: a conflict snapshot skipped as stale
       * threw away the only copy of the issue updates it carried. One kind of
       * authoritative answer collapses that back to one question. An adapter
       * that changed no issues simply returns the ones it holds.
       */
      readonly outcome: 'applied';
      readonly document: GraphDocument;
    }
  | {
      /**
       * The edit changed nothing, and `document` is the AUTHORITATIVE state —
       * the same contract as `applied`, because this is the same kind of claim.
       *
       * It carries one for a reason that is easy to miss: "nothing to do" is
       * often said precisely BECAUSE the store is out of date. Another client
       * creates the same edge, this edit arrives, the adapter has nothing to
       * apply — and a bare `unchanged` would leave the store without an edge
       * that genuinely exists, ranking a backlog missing a real relationship.
       *
       * The store adopts it and re-derives, but emits NO change summary: the
       * movement, if any, was somebody else's and this edit did not cause it.
       */
      readonly outcome: 'unchanged';
      readonly document: GraphDocument;
    }
  | {
      /** The write was refused upstream. Nothing changed there. */
      readonly outcome: 'rejected';
      readonly reason: string;
    }
  | {
      /**
       * The issue changed upstream mid-edit. `upstream` is the authoritative
       * document as it now stands, which is what lets the store offer
       * retry-on-latest and a diff without ever merging the two versions.
       */
      readonly outcome: 'conflict';
      readonly upstream: GraphDocument;
    };

/** One row of the selection order, as the deriver computed it. */
export interface OrderRow {
  readonly ref: IssueRef;
  /** 0-based position. The rail renders these in ascending order. */
  readonly rank: number;
  /** Whether the issue may be started now (§6.2). */
  readonly ready: boolean;
  /** Why it may not, in the deriver's own words. Empty when ready. */
  readonly holdReasons: readonly string[];
}

/**
 * The selection order for a document.
 *
 * Required, not defaulted. A store cannot invent an order, and a default would
 * be the second derivation this port exists to avoid.
 */
export type OrderDeriver = (document: GraphDocument) => readonly OrderRow[];

/** What a guard is shown. Both documents, so it need not recompute either. */
export interface EdgeGuardContext {
  readonly mutation: Mutation;
  /** The landed document, before the edit. */
  readonly current: GraphDocument;
  /** The document the edit would produce, if it landed. */
  readonly next: GraphDocument;
}

/**
 * A refusal that needs the graph — a `blocked-by` that would cycle, above all.
 *
 * Optional: the store's own structural refusals run either way, and a host
 * without a graph-aware guard still cannot create a self-edge or a duplicate.
 * A guard's refusal is identical in effect to a structural one — the edge is
 * drawn `invalid` and **is never dispatched**.
 */
export type EdgeGuard = (context: EdgeGuardContext) => InvalidReason | undefined;
