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
} from './model.ts';
import type { InvalidReason, Mutation, MutationId, Proposal } from './mutation.ts';
import type { DataSource, DispatchResult, EdgeGuard, OrderDeriver, OrderRow } from './source.ts';
import { type OrderChange, diffOrder } from './change.ts';
import { sameValue } from './equality.ts';
import { type ProjectedEdge, type WriteRecord, anyPending, project } from './write.ts';
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
  /**
   * Why the order could not be recomputed, when the injected deriver threw.
   *
   * `order.rows` is then the last order that WAS derived — stale, and labelled
   * as such, on the same principle as the held order: a rail that cannot vouch
   * for a ranking says so rather than showing a half-computed one.
   */
  readonly orderError?: string;
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
  /**
   * Re-read the document from the source, keeping unsettled edits.
   *
   * Queued behind anything already in flight, and resolves once it has had its
   * turn — a refresh that overtook a dispatch could be overwritten by that
   * dispatch's answer, which was computed before it.
   */
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
  let orderError: string | undefined;
  let sequence = 0;
  /**
   * The edit the summary would belong to.
   *
   * A summary is written when a write LANDS, which can be after a newer edit
   * has already started — and the contract is that a summary lasts until the
   * next edit. Without this, a host shows the previous edit's blast radius
   * beside the one the user is making now.
   */
  let currentProposal: MutationId | undefined;
  /** Bumped every time `landed` actually changes. See the conflict record's `landedAt`. */
  let landedGeneration = 0;
  /**
   * ONE AUTHORITATIVE OPERATION AT A TIME, and the rest queued.
   *
   * Both things that can produce a document — a `dispatch` answering `applied`
   * and a `hydrate` — return a full authoritative snapshot, and the port gives
   * neither of them a version. So two in flight cannot be ordered by anything
   * the store can observe: whichever answers second wins, and if that is the
   * older one it silently rolls an edge back out of the document, after which
   * the order derives from a backlog missing a real relationship.
   *
   * Serialising only the writes would leave the mixed pair — a refresh landing
   * between a write going out and its answer coming back — which is the same
   * defect through a different door. So the queue carries both kinds. Rather
   * than add a version to the port that no adapter asked for, the store simply
   * never creates the situation.
   *
   * A queued edit still renders `pending-write` immediately; only the round
   * trip waits.
   */
  type Task =
    | { readonly kind: 'dispatch'; readonly mutation: Mutation; readonly queuedAt: number }
    | { readonly kind: 'load'; readonly first: boolean; readonly done: () => void };
  const queue: Task[] = [];
  let draining = false;

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
    const adopted = {
      issues: sameValue(landed.issues, next.issues) ? landed.issues : next.issues,
      edges: sameEdgeSet(landed.edges, next.edges) ? landed.edges : next.edges,
    };
    // Bumped only on a real change, so a rehydrate that returns the same
    // document does not invalidate a conflict snapshot that is still current.
    if (adopted.issues !== landed.issues || adopted.edges !== landed.edges) {
      landedGeneration += 1;
    }
    landed = adopted;
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

    // One comparison for every slice. Nothing here names a field, so a field
    // added to any of these shapes is compared without this block changing.
    const projected = sameValue(published.projected, nextProjected) ? published.projected : nextProjected;
    const order =
      published.order.status === nextOrderStatus && sameValue(published.order.rows, rows)
        ? published.order
        : { rows, status: nextOrderStatus };
    const writes = sameValue(published.writes, records) ? published.writes : records;
    const selected = sameValue(published.selection, selection) ? published.selection : selection;

    const unchanged =
      published.status === status &&
      published.hydrationError === hydrationError &&
      published.issues === landed.issues &&
      published.landed === landed.edges &&
      published.projected === projected &&
      published.order === order &&
      published.writes === writes &&
      published.lastChange === lastChange &&
      published.orderError === orderError &&
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
      ...(orderError === undefined ? {} : { orderError }),
      selection: selected,
    });
    // Isolated, and for the same reason as the guard and the deriver: a host
    // callback that throws must not break the store. Rethrown asynchronously so
    // it still surfaces as an unhandled error rather than being swallowed.
    for (const listener of listeners) {
      try {
        listener();
      } catch (thrown) {
        queueMicrotask(() => {
          throw thrown;
        });
      }
    }
  }

  /**
   * Recompute the order from `landed`, and record what moved.
   *
   * A deriver that throws is a HOST callback failing, and the write it followed
   * has already landed — so this cannot become a failed write and must not
   * escape into the dispatch queue, where it would strand every edit behind it.
   * The previously derived rows stand, `orderError` says why they are stale, and
   * no change summary is emitted for an order nobody computed.
   */
  function reDerive(cause: Mutation | undefined): void {
    const previous = rows;
    let next: readonly OrderRow[];
    try {
      next = derive(landed);
    } catch (thrown) {
      orderError = messageOf(thrown);
      return;
    }
    // RECOVERING FROM A STALE BASELINE EMITS NO SUMMARY. While `orderError`
    // stood, the published rows were the ones from before the edit that broke
    // the deriver — so diffing the recovered order against them would credit
    // that edit's movement to this one. There is no baseline that would make
    // the attribution true, so none is claimed.
    const recovering = orderError !== undefined;
    orderError = undefined;
    rows = next;
    // Only for the edit that is still the current one. A landing that a newer
    // proposal has already overtaken has no summary to publish — the newer edit
    // owns that slot, and will fill it when it lands.
    const overtaken = cause !== undefined && cause.mutationId !== currentProposal;
    if (cause !== undefined && !recovering && !overtaken) lastChange = diffOrder(previous, rows, cause);
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

  /**
   * Why this edit cannot happen — structurally, then by the injected guard.
   *
   * A guard that throws reached no verdict, and an unknown verdict is not
   * permission to write: it refuses, fail-closed, with the thrown message as
   * the reason. Letting it escape would strand the whole dispatch queue behind
   * an edit that stayed pending for ever.
   */
  function refusalFor(mutation: Mutation): InvalidReason | undefined {
    const structural = structuralRefusal(landed, mutation);
    if (structural !== undefined) return structural;
    if (guard === undefined) return undefined;
    try {
      return guard({ mutation, current: landed, next: nextDocument(landed, mutation) });
    } catch (thrown) {
      return { code: 'guard-failed', message: messageOf(thrown) };
    }
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
        adopt(result.document);
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
          landedAt: landedGeneration,
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
    // The summary is evidence for ONE edit, and the contract is that it lasts
    // until the next edit or an explicit dismissal. Clearing it here is what
    // makes that true: left standing, a host would show the previous edit's
    // blast radius beside the edit the user is making now.
    lastChange = undefined;
    currentProposal = mutation.mutationId;
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
    queue.push({ kind: 'dispatch', mutation, queuedAt: landedGeneration });
    void drain();
    return { mutationId: mutation.mutationId, settled };
  }

  /**
   * Run the queue, one dispatch at a time.
   *
   * An edit that WAITED is re-checked before it goes out, because `landed` may
   * have moved under it — a sibling edit can delete the relationship this one
   * retypes, and dispatching against a document that no longer admits it would
   * defeat "refused before any write". An edit that did not wait keeps the
   * verdict `start` already reached, so the guard is called once per edit in
   * the ordinary case and twice only when the document genuinely moved.
   */
  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        if (next.kind === 'load') {
          await runLoad(next.first);
          next.done();
          continue;
        }
        const refusal = next.queuedAt === landedGeneration ? undefined : refusalFor(next.mutation);
        if (refusal !== undefined) {
          putRecord({
            mutationId: next.mutation.mutationId,
            mutation: next.mutation,
            state: 'invalid',
            reason: refusal,
          });
          settle(next.mutation.mutationId);
          publish();
          continue;
        }
        await dispatch(next.mutation);
      }
    } finally {
      draining = false;
    }
  }

  /** Queue a read of the document, behind whatever is already in flight. */
  function load(first: boolean): Promise<void> {
    return new Promise<void>((resolve) => {
      queue.push({ kind: 'load', first, done: resolve });
      void drain();
    });
  }

  /** A handle for a call that had nothing to act on. Already settled. */
  function noop(mutationId: MutationId): ProposalHandle {
    return { mutationId, settled: Promise.resolve() };
  }

  /** Read the document. Only ever called from the queue. */
  async function runLoad(first: boolean): Promise<void> {
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
      // Adopt the recorded snapshot ONLY while nothing has landed since it was
      // taken. If something has, `landed` came from a later full authoritative
      // answer and already knows everything this snapshot did — adopting the
      // older one would remove the edit that landed in between.
      if (record.landedAt === landedGeneration) {
        adopt(record.upstream);
        reDerive(undefined);
      }
      return start(record.mutation);
    },

    discardMine(mutationId) {
      const record = recordFor(mutationId);
      if (record === undefined || record.state === 'pending') return;
      // Same staleness rule as `retryOnLatest`: discarding your own edit must
      // never roll back somebody else's that landed while you were deciding.
      if (record.state === 'conflict' && record.landedAt === landedGeneration) {
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
