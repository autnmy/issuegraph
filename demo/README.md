# The in-memory demo

A live Issuegraph backlog running on a data source that holds one document in a
variable. **No tracker, no app installation, no auth, no backend.** Edits are
client-side and saved nowhere; reload and the seed comes back.

```sh
pnpm install
pnpm run build
pnpm --filter @issuegraph/demo run serve   # then open http://127.0.0.1:8000/demo/
```

Nothing above reads a credential of any kind, and the server is `node:http` with
no dependencies — a demo whose build step pulled a server off the registry first
would be answering a weaker question than the one being asked.

---

## Why this exists

**If the demo needs a tracker, the data-source port is not a port.** A seam only
ever driven by one real adapter is a seam by assertion. So this page is the
proof: it drives `@issuegraph/store` — the published package, unmodified, loaded
in the browser from the `exports` entry its own manifest declares — through an
adapter that has no tracker behind it at all.

Everything on this page that is not the store is **host** work, and that split is
the demonstration:

| the packages supply | the host supplies |
|---|---|
| the document, the write loop, the edge states, the change summary (`store`) — the selection order, the readiness verdict, effective priority, the cycle walk (`derive`, over `reader`) | the data source, the executor holds, the concurrency cap, the base ranking, every pixel |

## What it is not

**It is not the viewer.** The ordered spine, its arcs and its layout maths belong
to the viewer package, and drawing them here would make this a second
implementation of the grammar that package exists to have one of. This is a list,
and a list is enough to reach every state the port has to express.

**It does not derive an order.** The store takes the deriver as a port with *no
default*, deliberately: a default would be a second implementation of the
selection order. So a host has to supply one — and this host supplies
`@issuegraph/derive`. `src/order.ts` is a **projection** in both directions: the
store's document onto the derivation's node input, and the derivation's slots
onto the stations this page draws.

It used to be the other thing. Until `@issuegraph/derive` published there was
nothing to import, so this file carried its own union-find, duplicate-chain walk,
cycle search, effective-priority fixed point and selection sort, read off SPEC.md
§6.2, §6.3 and §6.4. Its review measured what that cost: **31 findings across
fifteen rounds, the largest cluster in exactly those algorithms**, and two of the
last three rounds were regressions introduced while patching earlier ones. That
is the argument for the port having no default, stated as evidence rather than as
a design note.

What is still the host's is still here, because the specification puts it here:
the **executor holds** (§6.8 — hold semantics must never be encoded as format
fields, so the format never learns why an executor declines ready work), the
**concurrency cap** (§6.5 — dispatch policy is out of scope), and the **base
ranking** (`derive` takes a host's own ordering as an input and never computes
one). Those are inputs to a derivation, not a derivation.

**One divergence is known and pinned, not patched.** The old hand-rolled deriver
contracted a `together-with` unit to a single vertex before searching for cycles;
the published one does not, so a `blocked-by` cycle running *through* a unit is no
longer refused — and it is a real deadlock that `Model.cycles` reports nowhere.
Re-adding contraction here would rebuild the second reading this rework removed,
and would disagree with every other consumer of the package. So the demo adopts
the package's answer, `order.test.ts` pins the gap with a control, and the finding
is filed against the package as
[#43](https://github.com/autnmy/issuegraph/issues/43). When it lands, that test
fails and this demo is revisited.

## What you can reach from the page

Everything, without editing anything first — which is what the seed is for.

- **All five edge types.** `blocked-by ⊘` · `serialize-with ⇄` ·
  `together-with ⧉` · `duplicate-of ≡` · `decomposed-from ⑃`. Two of them have
  never been used in anger anywhere, so this seed is the first place either is
  exercised at all.
- **Both hold families, never given one treatment.** *Graph-derived* (blocked,
  serialized, cycle, unresolvable) sits **inline at its would-be rank** showing
  `—`, because "why isn't my P1 running" has to be answerable in place.
  *Executor-derived* (claimed, parked) and duplicates collapse into a **footer
  group with no rank slot**: they are not facts about the work.
- **All three readiness stations.** `●` ready inside the concurrency cap · `○`
  ready but beyond it, naming the rank that frees its slot · `◌` held. The
  stations read parallelism, not the graph.
- **All three rank-provenance forms.** A declared priority · the spec's default
  tier · and an effective-priority promotion, written in the spec's own notation
  (`P3 → 0`) naming the dependent it inherited from.
- **All five edge states.** `selected` by clicking an edge · `pending-write` on
  any edit · and `invalid`, `failed` and `conflict` from the controls: arm what
  the tracker answers next, then write an edge. An armed outcome fires **once**
  and disarms itself, so the retry it offers can actually land.

Watch the order while a write is in flight: it says **held** and does not move.
Optimistic rendering is allowed; optimistic re-ordering is not.

## Layout

| file | what it is |
|---|---|
| `src/seed.ts` | the seeded backlog, chosen for coverage rather than realism |
| `src/order.ts` | the projection onto `@issuegraph/derive`, and the rich rows the page renders |
| `src/source.ts` | the in-memory adapter, with the two unhappy outcomes armable |
| `src/render.ts` | plain DOM; every value a CSS custom property |
| `src/main.ts` | the wiring, and the cycle guard |
| `serve.mjs` | a dependency-free static server for the repository root |

`src/*.test.ts` is where the coverage claim above is **executable** rather than
written down: a seed drifts, and an edit that quietly drops the last
`together-with` would leave this page running and no longer demonstrating the
thing it exists to demonstrate.

`src/order.test.ts` covers the **seam** and deliberately nothing else — the
projection in, the projection out, and the coverage claim. Testing the ready set
or the selection sort here would be a second test suite for a derivation this
demo does not contain. The load-bearing test is the one that pins every hold chip
against `IssueOrderSlot.ready` in both directions: a row held with no blocking
chip is a station that says "held" and says why nowhere. That pin is what caught
the one real defect this swap surfaced — §6.7 names `blocked-by` and
`serialize-with`, and the demo had generalized it across both group fields, while
the reader refuses the declarer of an unresolvable `together-with` (§4.3.7: a unit
cannot be claimed atomically around a member it cannot identify).

## Theming

Every colour, dimension, radius, weight and tracking lives in the custom-property
blocks at the top of `styles.css`. **No rule outside those blocks carries a
length literal**, so retheming this page means redeclaring them and touching no
markup, no script and no rule.

That is enforced rather than promised: `src/theme.test.ts` reads the stylesheet
and fails the build if a dimension reappears in a rule, and checks the other
direction too — every property a rule references must be declared, or
"redeclare the block" reaches nothing. The guard exists because this claim was
once an overclaim, and the drift was invisible: the token block was there, the
rules hard-coded their sizes anyway, and the sentence went on being printed.

The hue is never load-bearing: every edge carries a glyph and its written kind,
so the page reads identically with colour removed.

## It is not published

`private: true`, and it lives outside `packages/` on purpose — that directory is
what the isolation guard, the consumer smoke test and the lint config all read as
"this ships". The demo is a **consumer**.
