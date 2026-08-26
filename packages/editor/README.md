# @issuegraph/editor

Everything that **mutates** an [Issuegraph](https://github.com/autnmy/issuegraph) document: the edit affordances, drawn as overlays on [`@issuegraph/viewer`](../viewer) and dispatched through [`@issuegraph/store`](../store).

> **Not published yet.** The package is `private` until the change that assembles the workspace fixes its exports. It builds, typechecks, lints and tests with the rest of the workspace, so the seam it exists to keep is enforced from the first commit.

Layer 2 of three, and the whole of its contract:

```
composes  @issuegraph/viewer   layer 1 — the node, edge and badge grammar
composes  @issuegraph/store            — the document, the edit set, the port
never     fetching, auth, persistence, or a write of its own
```

## Why an editor can be published at all

Editing was never what made a layer unpublishable. The write path is already an open-source library, and the visual grammar encodes no read-only-ness. What editing drags in — auth, the network, the fail-or-conflict state machine — is **host-shaped, and injected**:

```ts
// The editor proposes. The store dispatches. The host writes.
proposal  →  @issuegraph/store  →  DataSource (yours)
```

An edit is a `Proposal` — `create`, `delete`, `retype`, `flip`, and no more, so one user act is one round trip and one undo entry. The store holds it, renders it optimistically, and **refuses to re-evaluate the selection order until the write lands**. A failed edit must never leave the order looking changed.

## The seam, and why this package tests it

Layer 1 and layer 2 used to be one codebase, where the boundary was enforced by construction. Now that both ship as packages, the design's own words are that it *"stops being enforced by construction and becomes discipline — layer 2 composes layer 1 through its public surface and never reaches past it."*

Discipline that nothing checks is a comment, so it is checked in two places:

- **The seam** — an ESLint rule (`SIBLING_SUBPATHS` in the repository's `eslint.config.mjs`) refuses any import of a sibling `@issuegraph/*` package that is not its **bare specifier**, and `require()` is banned outright because it is the one call that walks past every import rule in that file. Reaching into `@issuegraph/viewer/src/…` fails lint rather than a code review that might not happen. If something is needed that a sibling does not export, the answer is to export it deliberately: a published package can add an export later and can never take one back.
- **The purity claim** — the same config bans the reaches that would break "no fetching, no auth, no persistence" — `fetch`, storage, `document.cookie`, `eval`, dynamic `import`, and any `node:` builtin — for this package and the viewer, and for neither of the packages that legitimately read files. `src/purity.test.ts` keeps the half no static rule can do: it loads every shipped module with the browser globals removed, which catches a computed access like `globalThis['fet' + 'ch']`.

Both are proved rather than asserted: `scripts/eslint-rules.test.mjs` runs each rule against source written to break it and asserts the exact rule id, with controls in the other direction — ordinary code reports nothing, and a non-rendering package may still read a file.

## The one declared crossing

The `together-with` **connector** lives in the viewer, not here.

A `together-with` edge has to be individually selectable, retypeable and deletable, and an enclosure has no edge to click — so the connector is a hit target, and only the layer that computes the layout knows where its endpoints are. Adding it from out here would mean re-deriving positions layer 1 already has, which is the drifting second implementation the package split exists to avoid.

It is written down as a **declared** crossing rather than discovered later. Treat it as the precedent for declaring a crossing, never as permission for more.

## The scale ladder

The first surface to land, and the one that explains what layer 2 is for.

The canvas is a **local** instrument — it answers "what surrounds this issue" — while the order list is complete at any size. So past its budget the canvas **refuses rather than degrades**: a refusal with a route forward reads as competence; a hairball reads as a bug.

| Nodes | Behaviour |
|---|---|
| ≤ `GRAPH_NODE_BUDGET` | draw the neighbourhood |
| up to `CLUSTER_ONLY_BUDGET` | component **capsules** — size, `blocked-by` count, chain depth, cycle flag |
| beyond it | capsules truncated, and **search leads** |

Both thresholds are the viewer's own exports, read rather than restated, so the ladder and the canvas cannot disagree about what "past budget" means.

```ts
import { renderScaleLadder, scaleReducer, INITIAL_SCALE_STATE } from '@issuegraph/editor';

let state = INITIAL_SCALE_STATE;
let { markup, styles, ladder } = renderScaleLadder(document, { state });

// Every control publishes what it does: `data-ig-command`, plus `data-ig-target`
// for a focus. Read them, reduce, render again.
state = scaleReducer(state, { kind: 'focus', key: ladder.capsules[0].lead });
```

**Why this is here and not in the viewer.** Layer 1 already decides the same three tiers and draws a refusal — deliberately an *informational* one, because that package does not narrow: it renders exactly what it is given, so a control it published could never finish the action it advertised. Narrowing is the host's, and this is the host. What lands here is only the half layer 1 refused to own: a component the reader can choose, a search that reaches one, and a chip that opens the issues the canvas leaves out.

**"Isolated" here means edge-free**, which is *not* `NormalizedDocument.isolated` — that field means "in no slot **and** on no edge", and in a grooming view every issue holds an order position, so it is empty however many relationship-free issues the backlog has. Isolated issues are the majority (248 of 312 in the design's own sample) and are excluded from the canvas by default; the chip states the count, because the count is the information they carry, and opens them **as a list**.

**`ladder.canvas` is the canvas zone's document, never the rail's.** Narrowing the canvas is not narrowing the order. The complete order rail is rendered from the whole document by the workspace that assembles the zones.

## The ambient audit

Four findings about an *encoding*, as a pure detector plus a surface that never nags.

| Finding | Severity | Note |
|---|---|---|
| **cycle** | `blocks-work` | the only one that stops work outright — no member can ever be ready |
| **dead duplicate ref** | `dangerous` | excluded from the order while nothing tracks its work: looks handled, isn't |
| **encoding refused** | `blocks-own-edges` | until it parses the issue has no edges, and reads as merely unencoded |
| **stale blocker** | `misleading` | a closed blocker already satisfies readiness; clearing is bookkeeping |

Severity, and the "keep as history" affordance the last row alone carries, are **data on a frozen class table** — so no render site picks either, and a fifth class is a compile error until the table says what it costs.

```ts
import { auditDocument, auditOverlay, renderAuditHeader, auditRowAttributes } from '@issuegraph/editor';

const findings = auditDocument({ document, graph, encodingRefused });
const overlay = auditOverlay(findings);

renderAuditHeader(overlay);          // the persistent count and its filter toggle
auditRowAttributes(overlay, ref);    // {} for a clean row; the severity mark for a flagged one
```

**Two of the four rest on a reader, and it is a required port.** `graph` carries `Model.cycles` and `Model.duplicateCanonical` straight off `buildModel`, in the *store's* own reference spelling — the host builds the model, so the host owns the translation between an opaque store reference and a normalised model key. It is required rather than optional because a host with no reader must not quietly receive a thinner audit and read it as a complete one.

**It is the reader's answer specifically, not the write guard.** `@issuegraph/derive`'s `wouldCycleOnBlockedBy` is a *pre-write* refusal, and its divergences all lean fail-safe for a write that is about to happen: it spans closed nodes, and it does not exempt a together unit's internal `blocked-by` edges. Over-refusing is the recoverable direction before a write and simply a false finding in an audit — §6.6 says internal edges *"stay advisory … they would make every group carrying its own ordering read as stuck"*. Reading the guard as an edge-on-cycle test flags every ordinary together group that carries its own ordering.

**Duplicate resolution is transitive, and both classes need it.** With `a duplicate-of b`, `b duplicate-of c` and `c` closed, the reader excludes *both* `a` and `b`, so both references are dead — and testing each edge's immediate target reports `b` while missing `a`, because `b` is open. §4.3.3 also reads a `blocked-by` naming a duplicate as naming its **canonical**, so the same resolution decides a stale blocker.

**"Long-closed" is not available here.** A document carries no timestamp, so every closed blocker is reported — the safe direction for a finding whose whole severity is `misleading`, and one a host can narrow with a date it does have.

**Ambient, and the list of things it is not.** A persistent header count that never moves and never animates, a `--ig-stroke` gold left-bar on affected rail rows, and a filter — not a mode, because *"a mode you must enter is a mode you forget"*. No modals, toasts, red banners, badge animation, or **auto-fix**: every finding is a judgment call, so the surface offers navigation and never a remedy. That prohibition is asserted over the emitted markup and the stylesheet bytes rather than stated here alone.

**The bar is CSS on this package's own attribute, not an element drawn into a viewer row.** Layer 1's markup primitive is deliberately not on its public surface, so an overlay drawn from out here would have to re-implement HTML escaping — duplication with an injection shape rather than a mirror that merely drifts. `auditRowAttributes` answers what a row carries, `auditStylesheet` draws the bar from it, and the exchange is data.

## Status

Landing separately, each on its own change: the edge mutation-state overlays, the type picker and direction sentence, the three equivalent create paths, the re-evaluate surface, the first-pass review queue, and the three-zone workspace that assembles them, wires the commands to a DOM and fixes this package's exports.

## Licence

Apache-2.0
