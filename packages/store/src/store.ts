/**
 * The store: the one stateful module, and the only place IO happens.
 *
 * Everything it decides is decided by the pure modules beside it — validity,
 * the write ledger and projection, the order diff. What lives here is the state
 * itself, the calls into the injected data source, and the notification.
 *
 * **The rule the structure exists to enforce:** the selection order is derived
 * from `landed` and from nothing else. `projected` — the landed document plus
 * every unsettled edit — is built in one place and is not in scope where the
 * deriver is called, so an optimistic edge cannot reach the order by anyone
 * forgetting a filter.
 */

import {
  type EdgeId,
  type GraphDocument,
  type StoredEdge,
  type StoredIssue,
  sameEdgeSet,
  sameIssueList,
} from './model.ts';
import type { InvalidReason, Mutation, MutationId, Proposal } from './mutation.ts';
import type { DataSource, DispatchResult, EdgeGuard, OrderDeriver, OrderRow } from './source.ts';
import { type OrderChange, diffOrder, sameOrder } from './change.ts';
import {
  type ProjectedEdge,
  type WriteRecord,
  anyPending,
  project,
  sameProjection,
  sameRecords,
} from './write.ts';
import { nextDocument, structuralRefusal } from './validity.ts';

/** Where hydration has got to. A failure is a state, not an exception. */
export type HydrationStatus = 'idle' | 'hydrating' | 'ready' | 'failed';

/**
 * Whether the order describes everything the user has done.
 *
 * `held` means at least one edit is in flight, so the rows shown are the ones
 * from before it — held still and labelled, which the design prefers to a
 * half-computed order the rail cannot vouch for.
 */
export type OrderStatus = 'settled' | 'held';

/** The order, and whether it is currently telling the whole story. */
export interface OrderView {
  readonly rows: readonly OrderRow[];
  readonly status: OrderStatus;
}

/** Everything a host renders from. Frozen, and stable while nothing changes. */
export interface StoreSnapshot {
  readonly status: HydrationStatus;
  /**
   * Why the last load failed, when it did. A failed *rehydrate* sets this while
   * leaving `status` at `ready`: the previous document is still good, and
   * reporting the store as unloaded because a refresh blipped would throw away
   * a working surface.
   */
  readonly hydrationError?: string;
  readonly issues: readonly StoredIssue[];
  /** What the data source has confirmed. The only input to the order. */
  readonly landed: readonly StoredEdge[];
  /** What to draw: `landed` plus every unsettled edit, each carrying its states. */
  readonly projected: readonly ProjectedEdge[];
  readonly order: OrderView;
  /** Edits still carrying a state: pending, invalid, failed or conflicted. */
  readonly writes: readonly WriteRecord[];
  /** What the last landed edit did to the order. Cleared only by a call. */
  readonly lastChange?: OrderChange;
  readonly selection: readonly EdgeId[];
}

/** A proposal the store has taken on, and a promise for its settlement. */
export interface ProposalHandle {
  readonly mutationId: MutationId;
  /**
   * Resolves when this edit stops being `pending` — landed, refused, failed or
   * conflicted. It never rejects: a failure is a state on the snapshot, and a
   * host that has to `catch` to find out is a host that can forget to.
   */
  readonly settled: Promise<void>;
}

/** What the host supplies. Only `source` and `derive` are required. */
export interface StoreConfig {
  readonly source: DataSource;
  /**
   * The selection order. Required: a store cannot invent an order, and a
   * default would be a second implementation of one.
   */
  readonly derive: OrderDeriver;
  /** Refusals that need the graph — a `blocked-by` that would cycle. */
  readonly guard?: EdgeGuard;
}

/** The store's public surface. */
export interface Store {
  getSnapshot(): StoreSnapshot;
  subscribe(listener: () => void): () => void;
  /** Load the document. Safe to call once; use `rehydrate` afterwards. */
  hydrate(): Promise<void>;
  /** Re-read the document from the source, keeping unsettled edits. */
  rehydrate(): Promise<void>;
  /** Propose an edit. Renders immediately; the order does not move yet. */
  propose(proposal: Proposal): ProposalHandle;
  /** Re-dispatch an unsettled edit, unchanged, against the document as it stands. */
  retry(mutationId: MutationId): ProposalHandle;
  /** Adopt the conflicting upstream document, then re-dispatch the same edit. */
  retryOnLatest(mutationId: MutationId): ProposalHandle;
  /**
   * Drop an unsettled edit's overlay. The only call that removes the user's
   * work — and on a conflict it also adopts the upstream document, which is the
   * "discard mine" half of the choice the design offers.
   */
  discardMine(mutationId: MutationId): void;
  /** Set the selected edges. Selection is client state; it writes nothing. */
  select(edgeIds: readonly EdgeId[]): void;
  /** Clear the change summary. The only thing that does, besides the next edit. */
  dismissChange(): void;
}

// Frozen because every store starts on this one object, and a shared mutable
// default is a cross-instance leak waiting for the first caller who sorts in
// place.
const EMPTY_DOCUMENT: GraphDocument = Object.freeze({
  issues: Object.freeze([]),
  edges: Object.freeze([]),
});
const NO_PROJECTION: readonly ProjectedEdge[] = Object.freeze([]);

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * Create a store over one data source.
 *
 * Nothing is loaded until `hydrate()` is called, so a host can construct the
 * store during render and start the load where it wants to.
 */
export function createStore(config: StoreConfig): Store {
  const { source, derive, guard } = config;

  let landed: GraphDocument = EMPTY_DOCUMENT;
  let status: HydrationStatus = 'idle';
  let hydrationError: string | undefined;
  let records: readonly WriteRecord[] = [];
  let selection: readonly EdgeId[] = [];
  let rows: readonly OrderRow[] = [];
  let lastChange: OrderChange | undefined;
  let sequence = 0;

  const listeners = new Set<() => void>();
  const settlers = new Map<MutationId, () => void>();

  const initial: StoreSnapshot = {
    status,
    issues: landed.issues,
    landed: landed.edges,
    projected: NO_PROJECTION,
    order: { rows, status: 'settled' },
    writes: records,
    selection,
  };
  let published: StoreSnapshot = Object.freeze(initial);

  /**
   * Adopt a document, reusing the arrays already held where the new ones say
   * the same thing.
   *
   * Not an optimisation: `landed` is what everything downstream compares
   * against, so an adapter returning an equal-but-fresh array on every call
   * would make every slice of the snapshot look changed and defeat the "update
   * only if something changed" rule at its source rather than at its edge.
   */
  function adopt(next: GraphDocument): void {
    landed = {
      issues: sameIssueList(landed.issues, next.issues) ? landed.issues : next.issues,
      edges: sameEdgeSet(landed.edges, next.edges) ? landed.edges : next.edges,
    };
  }

  /**
   * Rebuild the snapshot, reusing every slice that has not changed, and notify
   * only if the result differs from what is already published.
   *
   * Per-slice reuse rather than one all-or-nothing comparison, so a host
   * memoising on `snapshot.order.rows` is not re-rendered by an unrelated
   * selection change — and `getSnapshot()` returns the identical reference when
   * nothing at all moved, which is what `useSyncExternalStore` requires.
   */
  function publish(): void {
    const nextProjected = project(landed, records, new Set(selection));
    const nextOrderStatus: OrderStatus = anyPending(records) ? 'held' : 'settled';

    const projected = sameProjection(published.projected, nextProjected)
      ? published.projected
      : nextProjected;
    const order =
      published.order.status === nextOrderStatus && sameOrder(published.order.rows, rows)
        ? published.order
        : { rows, status: nextOrderStatus };
    const writes = sameRecords(published.writes, records) ? published.writes : records;
    const selected =
      published.selection.length === selection.length &&
      published.selection.every((id, at) => id === selection[at])
        ? published.selection
        : selection;

    const unchanged =
      published.status === status &&
      published.hydrationError === hydrationError &&
      published.issues === landed.issues &&
      published.landed === landed.edges &&
      published.projected === projected &&
      published.order === order &&
      published.writes === writes &&
      published.lastChange === lastChange &&
      published.selection === selected;
    if (unchanged) return;

    // Optional keys are omitted rather than set to `undefined`, because
    // `exactOptionalPropertyTypes` is on and a host testing `'lastChange' in
    // snapshot` must not find an empty one.
    published = Object.freeze({
      status,
      ...(hydrationError === undefined ? {} : { hydrationError }),
      issues: landed.issues,
      landed: landed.edges,
      projected,
      order,
      writes,
      ...(lastChange === undefined ? {} : { lastChange }),
      selection: selected,
    });
    for (const listener of listeners) listener();
  }

  /** Recompute the order from `landed`, and record what moved. */
  function reDerive(cause: Mutation | undefined): void {
    const previous = rows;
    rows = derive(landed);
    if (cause !== undefined) lastChange = diffOrder(previous, rows, cause);
  }

  function recordFor(mutationId: MutationId): WriteRecord | undefined {
    return records.find((record) => record.mutationId === mutationId);
  }

  function putRecord(next: WriteRecord): void {
    records = recordFor(next.mutationId) === undefined
      ? [...records, next]
      : records.map((record) => (record.mutationId === next.mutationId ? next : record));
  }

  function dropRecord(mutationId: MutationId): void {
    records = records.filter((record) => record.mutationId !== mutationId);
  }

  function settle(mutationId: MutationId): void {
    const resolve = settlers.get(mutationId);
    settlers.delete(mutationId);
    resolve?.();
  }

  function refusalFor(mutation: Mutation): InvalidReason | undefined {
    const structural = structuralRefusal(landed, mutation);
    if (structural !== undefined) return structural;
    if (guard === undefined) return undefined;
    return guard({ mutation, current: landed, next: nextDocument(landed, mutation) });
  }

  async function dispatch(mutation: Mutation): Promise<void> {
    let result: DispatchResult;
    try {
      result = await source.dispatch(mutation);
    } catch (thrown) {
      // A crashing adapter must not leave the edit pending for ever, and must
      // not look like a success. It is the same fact as a rejection — the write
      // did not land — so it gets the same state and the same retry.
      putRecord({
        mutationId: mutation.mutationId,
        mutation,
        state: 'failed',
        reason: messageOf(thrown),
      });
      settle(mutation.mutationId);
      publish();
      return;
    }

    switch (result.outcome) {
      case 'applied': {
        adopt({ issues: landed.issues, edges: result.edges });
        dropRecord(mutation.mutationId);
        reDerive(mutation);
        break;
      }
      case 'unchanged': {
        // Nothing upstream differed, so nothing is adopted and the order is NOT
        // re-derived: re-deriving here would emit a change summary for a write
        // that changed nothing, which is exactly what this arm exists to avoid.
        // The overlay goes, because the edit is settled.
        dropRecord(mutation.mutationId);
        break;
      }
      case 'rejected': {
        putRecord({
          mutationId: mutation.mutationId,
          mutation,
          state: 'failed',
          reason: result.reason,
        });
        break;
      }
      case 'conflict': {
        putRecord({
          mutationId: mutation.mutationId,
          mutation,
          state: 'conflict',
          upstream: result.upstream,
        });
        break;
      }
    }
    settle(mutation.mutationId);
    publish();
  }

  /**
   * Refuse or dispatch, and put the record in the ledger either way.
   *
   * A refusal is recorded and NEVER dispatched — "refused before any write" is
   * a fact about the adapter not being called, not just about the colour of the
   * edge, and that is what the tests assert.
   */
  function start(mutation: Mutation): ProposalHandle {
    const settled = new Promise<void>((resolve) => settlers.set(mutation.mutationId, resolve));
    const refusal = refusalFor(mutation);
    if (refusal !== undefined) {
      putRecord({ mutationId: mutation.mutationId, mutation, state: 'invalid', reason: refusal });
      settle(mutation.mutationId);
      publish();
      return { mutationId: mutation.mutationId, settled };
    }

    putRecord({ mutationId: mutation.mutationId, mutation, state: 'pending' });
    publish();
    void dispatch(mutation);
    return { mutationId: mutation.mutationId, settled };
  }

  /** A handle for a call that had nothing to act on. Already settled. */
  function noop(mutationId: MutationId): ProposalHandle {
    return { mutationId, settled: Promise.resolve() };
  }

  async function load(first: boolean): Promise<void> {
    if (first) {
      status = 'hydrating';
      hydrationError = undefined;
      publish();
    }
    try {
      const document = await source.hydrate();
      adopt(document);
      status = 'ready';
      hydrationError = undefined;
      reDerive(undefined);
    } catch (thrown) {
      hydrationError = messageOf(thrown);
      // A failed refresh keeps the last good document and stays `ready`; only a
      // first load that never produced one reports `failed`.
      if (first) status = 'failed';
    }
    publish();
  }

  return {
    getSnapshot: () => published,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    hydrate: () => load(true),
    rehydrate: () => load(false),

    propose(proposal) {
      sequence += 1;
      // A per-store counter, not a random identifier: identities only have to
      // be unique within one store, and a deterministic one keeps every test
      // that reads a mutation id reproducible.
      return start({ ...proposal, mutationId: `m${sequence}` });
    },

    retry(mutationId) {
      const record = recordFor(mutationId);
      if (record === undefined || record.state === 'pending') return noop(mutationId);
      return start(record.mutation);
    },

    retryOnLatest(mutationId) {
      const record = recordFor(mutationId);
      if (record === undefined || record.state !== 'conflict') return noop(mutationId);
      // Adopt upstream FIRST, then re-run the edit against it. The mutation
      // itself needs no rewriting: three of the four operations name an edge by
      // its content-derived identity and a `create` names its endpoints, so
      // nothing in it is invalidated by the adoption. What can change is whether
      // it is still POSSIBLE — an edge somebody else deleted, a duplicate
      // somebody else created — and `start` re-runs the refusal check for that.
      adopt(record.upstream);
      reDerive(undefined);
      return start(record.mutation);
    },

    discardMine(mutationId) {
      const record = recordFor(mutationId);
      if (record === undefined || record.state === 'pending') return;
      if (record.state === 'conflict') {
        adopt(record.upstream);
        reDerive(undefined);
      }
      dropRecord(mutationId);
      publish();
    },

    select(edgeIds) {
      selection = [...edgeIds];
      publish();
    },

    dismissChange() {
      lastChange = undefined;
      publish();
    },
  };
}
