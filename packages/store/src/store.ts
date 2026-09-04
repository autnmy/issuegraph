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
  /**
   * Re-read the document from the source, then re-dispatch an unsettled edit,
   * unchanged, against what that read confirmed — as ONE queued operation.
   *
   * The edit is reserved synchronously: it is `pending` from this call on, so
   * `discardMine` and a second press are no-ops until it settles, exactly as
   * they are for `retry`. A refresh that fails restores the record as it was
   * and dispatches nothing; `hydrationError` says why. See the README's
   * "Resolving a conflict".
   */
  retryOnLatest(mutationId: MutationId): ProposalHandle;

  /**
   * Drop an unsettled edit's overlay. The only call that removes the user's
   * work, and it adopts nothing. See the README's "Resolving a conflict".
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

/**
 * Take ownership of a list the store is about to publish: copy it, then freeze.
 *
 * The arrays a snapshot hands out ARE the store's state — `landed` and `issues`
 * arrive from the adapter, `order.rows` from the deriver — and `Object.freeze`
 * on the snapshot object protects none of them. A consumer calling `.sort()` on
 * one (the common slip; `[...list].sort()` is the careful form) would reorder
 * store state with no dispatch, no re-derivation and no notification, and the
 * next order would derive from a document nobody wrote.
 *
 * COPIED BEFORE FREEZING, not frozen in place, because these arrive from the
 * host: freezing an adapter's own array would freeze it out of its own storage
 * for handing one over.
 *
 * THE CONTAINERS ONLY. The elements stay as the host made them — the store owns
 * which edges and rows it holds, the host owns what each one is — because
 * freezing those would reach into objects an adapter or a deriver may still be
 * using. `readonly` in the types is what discourages touching them; nothing at
 * runtime can promise it without taking objects that are not ours.
 */
function own<T>(list: readonly T[]): readonly T[] {
  return Object.freeze([...list]);
}

/** A host-supplied document the store is taking on: its containers become ours. */
function ownDocument(document: GraphDocument): GraphDocument {
  return Object.freeze({ issues: own(document.issues), edges: own(document.edges) });
}

/**
 * Rows from the injected deriver, with their nested container taken on too.
 *
 * `holdReasons` is the deriver's array, so it is copied for the same reason the
 * top-level list is: the store must be able to freeze what it publishes without
 * freezing a host out of its own storage.
 */
function ownRows(rows: readonly OrderRow[]): readonly OrderRow[] {
  return own(rows.map((row) => ({ ...row, holdReasons: own(row.holdReasons) })));
}

/**
 * Freeze every array reachable from a published value.
 *
 * `own` at each entry point covers the containers the store adopts directly,
 * and that is exactly as far as it went — one level, when the predicate was
 * never one level. Arrays nested inside published values (a conflict document's
 * edges, an edge's state list, a row's hold reasons) are reachable from
 * `getSnapshot()` just the same, and a consumer splicing one of those changes
 * store state as surely as splicing `landed` would.
 *
 * ARRAYS ONLY: objects are walked but not frozen. That is the boundary the
 * store can honestly keep — it owns which edges and rows it holds, the host
 * owns what each one IS — and freezing the contents would seize objects an
 * adapter or a deriver may still be using.
 *
 * Not short-circuited on an already-frozen array: `own` freezes a container
 * without touching what is inside it, so stopping at the first frozen array
 * would skip exactly the nested ones this exists to reach.
 */
function freezeArrays(value: unknown): void {
  if (Array.isArray(value)) {
    Object.freeze(value);
    for (const item of value) freezeArrays(item);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) freezeArrays(nested);
  }
}
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
  /**
   * THE NEWEST AUTHORITATIVE DOCUMENT THE SOURCE HAS ANSWERED WITH, which is
   * `landed` except after a `conflict`.
   *
   * A conflict carries the document as the source holds it, and the store
   * adopts none of it — the order must not move for an edit that did not land,
   * and the README's "Resolving a conflict" says why the upstream is for
   * display. But it is also the one thing the store has been TOLD about the
   * source's document since it last read one, and it is strictly newer than
   * `landed`. Validating against `landed` after it arrives means checking an
   * edit against a document the source has just said it no longer holds: a
   * queued edit whose legality depends on the upstream's change — the very
   * edge it added closing a cycle with this one — is admitted by a guard shown
   * the pre-conflict graph, and lands against a source that has moved
   * ([#12](https://github.com/autnmy/issuegraph/issues/12)).
   *
   * So the GUARD reads THIS document, and nothing else does. The deriver and
   * the projection keep reading `landed`, which is what keeps "optimistic
   * re-ordering is not allowed" a property of the structure. The structural
   * refusals keep reading `landed` too, for a different reason: they ask
   * questions the source answers for itself — a duplicate comes back
   * `unchanged`, a vanished edge comes back `rejected` or `unchanged` — and the
   * answer is adopted, so a dispatch the store lets through is what repairs
   * its copy. Refusing those against a document the snapshot cannot show would
   * draw an edge the user can see as `unknown-edge`, with nothing to do but
   * wait for a re-read nothing prompts. A cycle is the question the source
   * does NOT answer — an adapter applies what it is handed — which is why the
   * guard is the one reader that must not be shown the stale copy. Every
   * `adopt` sets both documents; only the conflict arm moves this one alone.
   * The queue runs one authoritative operation at a time, so this is monotone
   * in the order the source answered — no freshness counter, which is the
   * bookkeeping #7 records as wrong three times over.
   */
  let newest: GraphDocument = EMPTY_DOCUMENT;
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
   *
   * `resolve` is retry-on-latest: a read and a re-dispatch as ONE task, so a
   * read that fails stops the dispatch behind it, and nothing can be queued
   * between the two. `prior` is the record as it stood when the resolution was
   * reserved, restored verbatim when the read fails.
   */
  type Task =
    | { readonly kind: 'dispatch'; readonly mutation: Mutation }
    | { readonly kind: 'resolve'; readonly mutation: Mutation; readonly prior: WriteRecord }
    | { readonly kind: 'load'; readonly first: boolean; readonly done: (ok: boolean) => void };
  /** The two tasks an edit can enter the queue as. */
  type EditTask = Exclude<Task, { kind: 'load' }>;
  const queue: Task[] = [];
  let draining = false;

  const listeners = new Set<() => void>();
  const settlers = new Map<MutationId, () => void>();

  const initial: StoreSnapshot = {
    status,
    issues: landed.issues,
    landed: landed.edges,
    projected: NO_PROJECTION,
    order: Object.freeze({ rows: ownRows(rows), status: 'settled' }),
    writes: own(records),
    selection: own(selection),
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
      issues: sameValue(landed.issues, next.issues) ? landed.issues : own(next.issues),
      edges: sameEdgeSet(landed.edges, next.edges) ? landed.edges : own(next.edges),
    };
    landed = adopted;
    // An authoritative answer supersedes a conflict's upstream: what landed is
    // now the newest thing the source has said.
    newest = adopted;
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
    // CALL THIS ONLY ONCE THE OPERATION IS FULLY COMMITTED. Subscribers run
    // synchronously and may call straight back into the store, so anything left
    // undone at this point can be overtaken by the re-entrant call — which is
    // how a follow-up edit once jumped the queue ahead of the edit that
    // triggered it. Every other call site already commits first; keep it that
    // way rather than making each one rediscover the rule.
    const nextProjected = project(landed, records, new Set(selection));
    const nextOrderStatus: OrderStatus = anyPending(records) ? 'held' : 'settled';

    // One comparison for every slice. Nothing here names a field, so a field
    // added to any of these shapes is compared without this block changing.
    const projected = sameValue(published.projected, nextProjected)
      ? published.projected
      : own(nextProjected);
    // The rows keep their identity across a status-only change. Rebuilding the
    // view is cheap; handing a host a new array when the ranking did not move
    // defeats whatever it memoised on, and the status flips on every write.
    const orderRows = sameValue(published.order.rows, rows) ? published.order.rows : rows;
    const order =
      published.order.status === nextOrderStatus && published.order.rows === orderRows
        ? published.order
        : Object.freeze({ rows: orderRows, status: nextOrderStatus });
    const writes = sameValue(published.writes, records) ? published.writes : own(records);
    const selected = sameValue(published.selection, selection) ? published.selection : own(selection);

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
    freezeArrays(published);
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
    rows = ownRows(next);
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
   * The structural check reads `landed` and the guard reads `newest` — the
   * document the source most recently answered with, which a conflict can
   * make newer than anything landed. The split is deliberate and the note on
   * `newest` says why: the source corrects a structural mistake with an answer
   * the store adopts, and a cycle it never corrects at all.
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
      return guard({ mutation, current: newest, next: nextDocument(newest, mutation) });
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
        // Adopted like `applied`, because it is the same kind of claim about the
        // document — and often said BECAUSE the store is out of date, which is
        // exactly when not adopting it loses an edge that genuinely exists.
        //
        // Re-derived with NO cause: whatever moved was somebody else's doing, so
        // attributing it to this edit would be wrong. `adopt` no-ops when the
        // document already matches, so the ordinary case changes nothing.
        adopt(result.document);
        dropRecord(mutation.mutationId);
        reDerive(undefined);
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
        // Taken on rather than retained by reference: it is exposed through
        // `snapshot.writes`, so a consumer must not be able to edit the
        // adapter's own arrays through it.
        const upstream = ownDocument(result.upstream);
        putRecord({ mutationId: mutation.mutationId, mutation, state: 'conflict', upstream });
        // NOT adopted — `landed` and the order stay where they are. But it is
        // the newest document the source has answered with, so it is what the
        // guard is next shown, until an answer that lands replaces it.
        newest = upstream;
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
  function start(task: EditTask): ProposalHandle {
    const { mutation } = task;
    // The summary is evidence for ONE edit, and the contract is that it lasts
    // until the next edit or an explicit dismissal. Clearing it here is what
    // makes that true: left standing, a host would show the previous edit's
    // blast radius beside the edit the user is making now.
    lastChange = undefined;
    currentProposal = mutation.mutationId;
    const settled = new Promise<void>((resolve) => settlers.set(mutation.mutationId, resolve));
    // THE VERDICT IS REACHED AGAINST THE DOCUMENT THE EDIT WILL BE DISPATCHED
    // AGAINST. For a direct dispatch that is `landed` as it stands, so a refused
    // edit is recorded here and never enters the queue. For a resolve it is the
    // document the refresh will confirm, which does not exist yet — asking now
    // would refuse or admit the edit on the very copy the user asked to look
    // past. Its verdict waits for the queue's re-check, where every edit is
    // asked again anyway.
    const refusal = task.kind === 'dispatch' ? refusalFor(mutation) : undefined;
    if (refusal !== undefined) {
      putRecord({ mutationId: mutation.mutationId, mutation, state: 'invalid', reason: refusal });
      settle(mutation.mutationId);
      publish();
      return { mutationId: mutation.mutationId, settled };
    }

    // THIS IS THE RESERVATION, for a resolve as much as for a dispatch. A
    // `pending` record is one `discardMine` and `retry` decline to touch, so
    // from here until the edit settles nothing can act on it — including across
    // the refresh a resolve is about to wait on. That is what lets the store
    // own a resolution that spans an await: the intent was captured before it.
    putRecord({ mutationId: mutation.mutationId, mutation, state: 'pending' });
    // ENQUEUE BEFORE NOTIFYING. `publish` runs subscribers synchronously, so a
    // subscriber proposing a follow-up re-enters here — and if the queue does
    // not yet hold this edit, the nested one takes its place in line and goes
    // out first. Two edits on the same edge then apply in the reverse of the
    // order the user made them.
    queue.push(task);
    publish();
    void drain();
    return { mutationId: mutation.mutationId, settled };
  }

  /**
   * Run the queue, one authoritative operation at a time — dispatches and
   * document reads alike, since both answer with a document.
   *
   * An edit that WAITED is re-checked before it goes out, because the document
   * may have moved under it — a sibling edit can delete the relationship this
   * one retypes, and a sibling's CONFLICT can carry an upstream that closes a
   * cycle with it — and dispatching against a document that no longer admits
   * it would defeat "refused before any write". Every edit is re-checked here
   * whether or not it waited; the comment at the check says why. A resolve is
   * checked here for the FIRST time, against the document its read confirmed.
   */
  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        if (next.kind === 'load') {
          const ok = await runLoad(next.first);
          publish();
          next.done(ok);
          continue;
        }
        if (next.kind === 'resolve') {
          const ok = await runLoad(false);
          if (!ok) {
            // THE READ FAILED, SO NOTHING IS CONFIRMED, and the edit does not
            // go out: the `continue` below is what makes the two halves one
            // operation. The record goes back to exactly what it was when the
            // resolution was reserved — a conflict keeps its `upstream` for
            // view-diff — and `hydrationError`, set by the read, says why. Not
            // downgraded to `failed`: that would throw away the one document
            // the user can still compare against.
            putRecord(next.prior);
            settle(next.mutation.mutationId);
          }
          // ONE TRANSITION, whichever way the read went. The restore rides the
          // same publish as the read's outcome, so no subscriber can observe
          // "refresh failed, edit still in flight" as a state of its own.
          publish();
          if (!ok) continue;
        }
        // ALWAYS re-checked, not only when something is known to have moved.
        // For a resolve this is the FIRST check, and against the document the
        // read just confirmed — which is the point of resolving.
        // Knowing that needs bookkeeping about document freshness, and every
        // version of that bookkeeping this store has had was wrong in a way
        // nobody could see. `refusalFor` is pure and cheap; asking it twice
        // costs a great deal less than being wrong about when to ask.
        const refusal = refusalFor(next.mutation);
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
  function load(first: boolean): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      queue.push({ kind: 'load', first, done: resolve });
      void drain();
    });
  }

  /** A handle for a call that had nothing to act on. Already settled. */
  function noop(mutationId: MutationId): ProposalHandle {
    return { mutationId, settled: Promise.resolve() };
  }

  /**
   * Read the document. Only ever called from the queue. Resolves `true` when
   * the read succeeded.
   *
   * PUBLISHES NOTHING AT THE END, on purpose: the caller decides what else
   * belongs in the same transition. A resolve whose read failed restores its
   * record before publishing, so the outcome of the read and the restored edit
   * arrive together. (The `hydrating` publish on a first load is a transition
   * of its own, before the read starts.)
   */
  async function runLoad(first: boolean): Promise<boolean> {
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
      return false;
    }
    return true;
  }

  return {
    getSnapshot: () => published,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    hydrate: async () => {
      await load(true);
    },
    rehydrate: async () => {
      await load(false);
    },

    propose(proposal) {
      sequence += 1;
      // A per-store counter, not a random identifier: identities only have to
      // be unique within one store, and a deterministic one keeps every test
      // that reads a mutation id reproducible.
      return start({ kind: 'dispatch', mutation: { ...proposal, mutationId: `m${sequence}` } });
    },

    retry(mutationId) {
      const record = recordFor(mutationId);
      if (record === undefined || record.state === 'pending') return noop(mutationId);
      return start({ kind: 'dispatch', mutation: record.mutation });
    },

    retryOnLatest(mutationId) {
      const record = recordFor(mutationId);
      if (record === undefined || record.state === 'pending') return noop(mutationId);
      return start({ kind: 'resolve', mutation: record.mutation, prior: record });
    },

    /**
     * Single-step on purpose: it reads the record and acts on it with no
     * `await` in between, so nothing can change underneath it. The resolution
     * that has to refresh first gets the same property by reserving the edit
     * BEFORE its refresh — the record is `pending` from that call on, which is
     * exactly the state this declines to touch.
     */
    discardMine(mutationId) {
      const record = recordFor(mutationId);
      if (record === undefined || record.state === 'pending') return;
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
