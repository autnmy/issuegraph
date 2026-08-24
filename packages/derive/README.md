# @issuegraph/derive

Turn an [Issuegraph](https://github.com/autnmy/issuegraph) model into the **order you should work in** — and refuse a `blocked-by` edge that would make that order impossible.

One layer above [`@issuegraph/reader`](../reader). The reader answers what the graph *is* — ready set, effective priority, serialize and together components, duplicates, cycles. This answers what *order follows from it*, with every row carrying the reasons it sits where it does.

```sh
npm install @issuegraph/derive
```

## The order

```ts
import { deriveIssueOrder } from '@issuegraph/derive';

const derived = deriveIssueOrder({
  issues,                                   // the same NodeInput[] buildModel takes
  config: { baseRanking: { source: 'config', order: myRankedRows } },
});

derived.slots;        // every position, in order
derived.rankOf;       // key -> rank, or null when held
derived.priority;     // key -> declared/effective/promoted-by, in the spec's notation
derived.excluded;     // duplicates, and the canonical each defers to
derived.provenance;   // decomposed-from edges, which order nothing
derived.diagnostics;  // anomalies worth surfacing to a groomer
derived.wouldCycle;   // bound to this node set, so a refusal costs no round-trip
```

**Your ranking is the input, not something this computes.** Whatever already orders your backlog — mapped labels, issue types, saved queries, a tie-break of your own — is supplied through `baseRanking` and never re-derived here. Hosts routinely evaluate that in a database; a second engine beside it would be a mirror whose input space drifts.

**Frontmatter modifies that ranking; it never replaces it.** One sort with a swappable secondary key:

```
(effectivePriority ASC, baseRankingPosition ASC, issueNumber ASC)
```

At zero adoption every effective priority equals its declared priority, so the primary key collapses to the band your ranking already produced and the output **is** your ranking. Getting this backwards makes the package useless to anyone who has not adopted the format — which is everyone at first. Frontmatter only ever moves an issue between bands, out of the order, or into a held slot.

## What a slot is

A **together unit occupies one slot**, not one per member (§4.3.7) — the group is one piece of work, and it advances only when every member can.

A **held slot keeps its position and carries `rank: null`.** It is not moved to the end, and it never carries a number: *"why isn't my P1 running"* has to be answerable at the rank the work would have taken, and a claim-time selector that simply drops held work deletes exactly that. `holdReasons` names each failed condition.

`promotedBy` names the neighbour the urgency arrived through — along **both** paths §6.3 relaxes, `blocked-by` *and* `together-with`, since a P3 grouped with a P0 is genuinely promoted and a blocked-by-only index would report that with nothing to show for it. It reads **exactly** the edges the model read — an edge naming a duplicate is attributed to its canonical, and a duplicate's own edges are ignored. Over-refusing is safe for a pre-write guard and wrong for provenance: it would name a cause that did not act.

**Group sizes are computed, never read.** No issue writes its group down (§4.3.4, §4.3.7). Both sizes count live candidates only, so a serialize partner that shipped stops counting, exactly as a closed together member does.

## The cycle refusal

```ts
import { wouldCycleOnBlockedBy } from '@issuegraph/derive';

wouldCycleOnBlockedBy(issues, from, to, { homeRepo });   // true = refuse the write
```

Synchronous by signature — no client, no handle, no promise — which is what makes *zero round-trips* a property of the contract rather than of an optimization. An edge that closes a cycle produces a component no member of which can ever be ready (§6.6), and once written nobody can unstick it.

**Duplicates resolve the model's way.** §4.3.3 makes an edge naming a duplicate name its *canonical*, and the walk follows the same resolution — through `Model.duplicateCanonical`, not a second duplicate-chain walk. Skip it and the guard fails open: with `#30` duplicating `#10`, the model reads *"#20 blocked-by #30"* as *"#20 blocked-by #10"*, so `#10 blocked-by #20` closes a cycle a raw walk never finds.

**That applies to the two arguments as well as to the stored edges**, and each is walked under *both* spellings — the key as given and its canonical. Resolving only the stored edges leaves `from` and `to` in a different key space from the edges they are compared against, so `#20 blocked-by #30` where `#30` duplicates `#20` is a self-dependency the probe never sees. Replacing the raw spelling instead of adding to it would *remove* refusals, because a duplicate still has outgoing edges under its own key (see the third divergence). Both is monotone: it can only refuse more.

Three deliberate divergences from `model.cycles`, all fail-safe:

- **It walks closed nodes too.** `model.cycles` filters to open ones, because a closed blocker does not block *today*. This is a question about the future: the edge outlives the current states, and a reopened issue makes the cycle real.
- **A target outside the supplied set answers `false`, not a refusal.** A documented precondition: both endpoints must be present for the answer to mean anything. Failing closed would make a paged editor refuse every edge to an issue it has not loaded.
- **An edge declared *by* a duplicate is kept.** `buildModel` drops a duplicate's own edges; matching it here is the one place copying the model would make this guard *weaker*. Note the asymmetry: resolving a target **adds** reachability and is adopted, filtering a declarer **removes** it and is not. A groomer who clears the `duplicate-of` brings the edge back — with the cycle already written.

## Where it plugs in

The two entry points are exactly the two ports [`@issuegraph/store`](../store) declares and deliberately does not implement — `OrderDeriver` and `EdgeGuard`. The store owns *when* the order is recomputed; this owns *what* it is.

## Purity

No fetching, no mutation, no persistence, no clock, and **nothing stored between calls**. That is why two clients reading the same issue bodies derive the same order without coordinating, and why the result cannot go stale.

It is pinned mechanically rather than asserted: the tests read the modules' own syntax tree for a dependency outside a four-entry allowlist and for module-scope mutable state, and pin freshness and reference identity so a memo returning the stored model fails — which a compare-by-value test alone would let through, since returning the identical object satisfies every deep-equal.

`DerivedIssueOrder` is an **in-process value, not a payload.** `wouldCycle` is a live closure and two fields are `Map`s, so `JSON.stringify` silently drops the function and flattens the maps to `{}`. Project it explicitly at any serialization boundary rather than handing it over whole.

## Versioning

`0.x`, and unstable — it tracks a draft specification, so a minor bump may break you. Pin exactly if that matters.

---

Apache-2.0 · stewarded by [Autonomy LLC](https://github.com/autnmy).
