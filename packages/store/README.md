# @issuegraph/store

A framework-free client store for an [Issuegraph](https://github.com/autnmy/issuegraph)
document, and the data-source port a host plugs its own tracker in through.

**The package fetches nothing, authenticates nothing and persists nothing.** It holds the
document, renders edits optimistically, dispatches every one of them outward, and refuses to
re-evaluate the selection order until a write has actually landed.

```
npm install @issuegraph/store
```

Apache-2.0. `0.x`, and the API is unstable until `1.0` — a published package is a public
commitment, and this one is not making it yet.

---

## The five-minute version

```ts
import { createMemorySource, createStore } from '@issuegraph/store';

const store = createStore({
  source: createMemorySource({
    issues: [
      { ref: '1', title: 'Ship the thing', state: 'open' },
      { ref: '2', title: 'Build the thing', state: 'open' },
    ],
    edges: [],
  }),
  derive: myOrderDeriver, // see "The deriver" below
});

await store.hydrate();

const handle = store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
// The edge is already drawn, marked `pending-write`.
// The order has NOT moved, and reports `status: 'held'`.

await handle.settled;
// Now the order has re-derived, and `snapshot.lastChange` says what moved.
```

Read state with `getSnapshot()` and react to it with `subscribe(listener)` — the pair
`useSyncExternalStore` wants, so a React host needs no adapter and a non-React host is not
asked to pretend it is one.

**Every array reachable from a snapshot is frozen** — nested ones included, so a conflict
record's `upstream.edges` and an edge's `states` are as protected as `landed`. They are the
store's own state, so a `.sort()` on one would reorder that state with no dispatch and no
notification; `[...rows].sort()` is the form to use. The store copies before freezing, so
handing it an array never freezes an adapter out of its own storage. The *elements* are left
as you made them — the store owns which edges and rows it holds, you own what each one is.

---

## The data-source port

One interface, two methods. Everything else an adapter needs — a token, a retry policy, a
rate limiter, a cache — stays on its own side of it.

```ts
interface DataSource {
  hydrate(): Promise<GraphDocument>;
  dispatch(mutation: Mutation): Promise<DispatchResult>;
}
```

`dispatch` answers with one of four outcomes:

| outcome | what it means | what the store does |
|---|---|---|
| `applied` | the edit landed; carries the **whole** resulting document | adopts it, re-derives the order, emits a change summary |
| `unchanged` | the edit changed nothing; carries the **whole** document | adopts it, re-derives, emits **no** summary |
| `rejected` | the write was refused; carries a reason | marks the edge `failed` and offers `retry` |
| `conflict` | the document moved upstream mid-edit; carries the current one | marks the edge `conflict` and holds **both** versions |

Three contracts an adapter has to honour:

- **`applied` and `unchanged` both carry the authoritative full document — issues included —
  not a patch.** A partial answer would need merge rules, and merge rules are where an
  optimistic store goes wrong. Both, because both are the same kind of claim about the
  document; they differ only in whether *this* edit caused the difference, which is what
  decides whether a change summary is emitted. `unchanged` matters more than it looks: an
  adapter often has nothing to apply precisely *because* your store is out of date — another
  client got there first — and a bare "nothing to do" would leave you without an edge that
  genuinely exists. An adapter that changed no issues returns the ones it holds.
- **The store dispatches once per mutation and never retries on its own.** A retry is a user
  act, so nothing here assumes an idempotency you have not been given.
- **The store runs one authoritative operation at a time**, queueing the rest, so `dispatch`
  is never re-entered and never overlaps a `hydrate`. Both answer with an unversioned
  authoritative document, and two of those in flight cannot be ordered by anything the store
  can observe — whichever answers second wins, and if that is the older one it silently rolls
  an edge back out. Rather than push a version onto every adapter, the store declines to
  create the situation. A queued edit still renders `pending-write` immediately; only the
  round trip waits, and `rehydrate()` resolves once it has had its turn.

Because of that last one, an edit reaches the adapter some time *after* it is proposed.
`createScriptedSource` exposes `whenPending(mutationId?)` for exactly this — await the
hand-off rather than guessing how many microtasks separate the two.

Two adapters ship with the package. `createMemorySource` holds a document in a variable and
applies every edit — it is the reference implementation, and the one a demo runs on with no
tracker at all. `createScriptedSource` settles only when told to, which is what lets a test
observe the store mid-flight and induce a rejection or a conflict on purpose; write your own
adapter's tests against it.

---

## The deriver, and why you supply it

```ts
type OrderDeriver = (document: GraphDocument) => readonly OrderRow[];
```

Required, with no default. The selection order is its own concern with its own package, and a
default here would be a second implementation of it — which is exactly the duplication this
package family exists to remove.

The division of labour: **the store owns *when* the order is recomputed; the deriver owns
*what* it is.**

An optional `EdgeGuard` sits beside it for refusals that need to see the graph — a
`blocked-by` that would close a cycle:

```ts
type EdgeGuard = (context: { mutation; current; next }) => InvalidReason | undefined;
```

---

## The order can be trusted, structurally

The store keeps two edge sets:

- **`landed`** — what the data source has confirmed. **The only input to the deriver.**
- **`projected`** — `landed` plus every unsettled edit, each carrying its states. What a
  viewer draws.

Optimistic rendering is allowed; optimistic **re-ordering** is not. The rail's whole value is
being what a picker will actually do, and an order reflecting an unlanded edit is a ranking
that exists nowhere. Keeping the two sets apart makes that a property of the structure rather
than a rule every reader has to remember.

While any edit is in flight, `order.status` is `'held'` and the rows are the previous ones,
unchanged — a stale-but-labelled order beats a half-computed one. Same principle if your
deriver throws: the last order that *was* derived stands, and `orderError` says why it is
stale.

## Host callbacks that throw cannot break the store

Three of them — the deriver, the guard, and a subscriber — and one rule for all three, because
they are all your code and the store already reads a throwing *adapter* as a rejection.

A guard that throws reached **no verdict**, and an unknown verdict is not permission to write:
the edit is refused `invalid` with code `guard-failed`. A deriver that throws follows a write
that already landed, so it cannot become a failed write; the order goes stale with
`orderError` set. A subscriber that throws is isolated and rethrown asynchronously, so it
still surfaces without taking the notification loop down.

None of them may escape into the dispatch queue, where they would strand every edit behind
them with the order held for ever.

## Edge states are overlays, not variants

An edge always keeps its kind. State is carried beside it, as a list, because the five states
are orthogonal and combine:

`selected` · `pending-write` · `invalid` · `failed` · `conflict`

`invalid` is **refused before any write** — the adapter is never called. Two things produce
it, split by what the answer needs to see:

- the store itself, for what is visible in the edit — a self-edge, a reference the document
  does not hold, an exact duplicate, a retype to the kind the edge already has, a flip on a
  symmetric relationship, and a second reference on a single-valued field (`cardinality`:
  every relationship field but `blocked-by` holds one, §4.3 — the one writer rule of the
  format that needs no graph walk, so it is refused here rather than once per host);
- your `EdgeGuard`, for anything needing the graph.

## A failed write is marked, never reverted

The user's work stays on the canvas. `retry` re-dispatches it, and on a conflict you get the
two single-step resolutions below. **Nothing auto-merges, nothing auto-reverts, and nothing
times out** — `discardMine` is the only call that removes an optimistic edit, and a person has
to make it.

### Resolving a conflict

A conflict's `upstream` is **for display, and is never adopted** — it is the "view diff" half
of the choice, and a reading of the past: a conflict can sit on screen for as long as a person
takes to read it.

The store ships the two single-step resolutions and **not** the composite:

```ts
store.discardMine(id);   // drop the overlay; adopts nothing
store.retry(id);         // re-dispatch, unchanged
```

**"Retry on latest" is yours to compose**, and the two lines are the point:

```ts
await store.rehydrate();
if (store.getSnapshot().hydrationError) return;                 // do not retry unconfirmed
if (store.getSnapshot().writes.some((w) => w.mutationId === id)) store.retry(id);
```

That is deliberate, and it is the one place this package asks you to write something it could
have written for you. Both calls above read state and act on it with no `await` in between, so
neither can be overtaken. The composite has an `await` in the middle, and everything that can
happen during it — the read failing, the user discarding, the user pressing again — is a
decision about *user intent* that the caller holding the await can make and the store cannot.
What a store-owned version would need — a resolution reservation, or cancellation on the
port — and why it belongs with the editor layer instead, is
[issue #7](https://github.com/autnmy/issuegraph/issues/7). The adapter is the authority on the current document; the store asks it
rather than keeping a guess about how stale its own copy has become.

`lastChange` belongs to the edit that is **current when it lands**. Two edits proposed before
the first settles means the first's summary would otherwise be written after the second began,
and a host would show the previous edit's blast radius beside the current one.

## Two smaller contracts worth knowing

- **Issue references are opaque.** The format admits both `123` and `owner/repo#123`
  (§4.2); normalising between them is the reader's job. This store compares references and
  never parses one, so an adapter must emit canonical identifiers.
- **Edge identity is derived, not assigned.** It is a pure function of kind and endpoints,
  with the two symmetric kinds (§4.3.4, §4.3.7) sorting theirs — so `A serialize-with B` and
  `B serialize-with A` are one edge. That is what lets the store recognise the edge your
  adapter returns as the one it drew.

---

## What this package does not do

Rendering of any kind, including the wording of the change summary — the counts ship as
numbers so a host writes the sentence in its own language. Undo, multi-select batching, the
first-pass review queue, audit findings and graph clustering all compose on top of it rather
than living in it.
