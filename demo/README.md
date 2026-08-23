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

| the package supplies | the host supplies |
|---|---|
| the document, the write loop, the edge states, the change summary | the data source, the order deriver, the cycle guard, every pixel |

## What it is not

**It is not the viewer.** The ordered spine, its arcs and its layout maths belong
to the viewer package, and drawing them here would make this a second
implementation of the grammar that package exists to have one of. This is a list,
and a list is enough to reach every state the port has to express.

**The order deriver here is not the reference derivation.** The store takes the
deriver as a port with *no default*, deliberately: a default would be a second
implementation of the selection order. `src/order.ts` is what a host writes on
the other side of that port — small, and reading SPEC.md §6.2, §6.3 and §6.4
directly. When the reference derivation is published, that file is deleted and
this demo imports it instead.

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
| `src/order.ts` | the host's order deriver and the rich rows the page renders |
| `src/source.ts` | the in-memory adapter, with the two unhappy outcomes armable |
| `src/render.ts` | plain DOM; every value a CSS custom property |
| `src/main.ts` | the wiring, and the cycle guard |
| `serve.mjs` | a dependency-free static server for the repository root |

`src/*.test.ts` is where the coverage claim above is **executable** rather than
written down: a seed drifts, and an edit that quietly drops the last
`together-with` would leave this page running and no longer demonstrating the
thing it exists to demonstrate.

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
