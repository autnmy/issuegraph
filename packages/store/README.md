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
| `applied` | the edit landed; carries the **whole** resulting edge set | adopts it, re-derives the order, emits a change summary |
| `unchanged` | nothing upstream differed | clears the pending write, adopts nothing, re-derives nothing |
| `rejected` | the write was refused; carries a reason | marks the edge `failed` and offers `retry` |
| `conflict` | the document moved upstream mid-edit; carries the current one | marks the edge `conflict` and holds **both** versions |

Two contracts an adapter has to honour:

- **`applied` carries the authoritative full edge set, not a patch.** A partial answer would
  need merge rules, and merge rules are where an optimistic store goes wrong.
- **The store dispatches once per mutation and never retries on its own.** A retry is a user
  act, so nothing here assumes an idempotency you have not been given.

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
unchanged — a stale-but-labelled order beats a half-computed one.

## Edge states are overlays, not variants

An edge always keeps its kind. State is carried beside it, as a list, because the five states
are orthogonal and combine:

`selected` · `pending-write` · `invalid` · `failed` · `conflict`

`invalid` is **refused before any write** — the adapter is never called. Two things produce
it, split by what the answer needs to see:

- the store itself, for what is visible in the edit — a self-edge, a reference the document
  does not hold, an exact duplicate, a retype to the kind the edge already has, a flip on a
  symmetric relationship;
- your `EdgeGuard`, for anything needing the graph.

## A failed write is marked, never reverted

The user's work stays on the canvas. `retry` re-dispatches it; on a conflict,
`retryOnLatest` adopts the upstream document and re-dispatches against it. **Nothing
auto-merges, nothing auto-reverts, and nothing times out** — `discardMine` is the only call
that removes an optimistic edit, and a person has to make it.

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
