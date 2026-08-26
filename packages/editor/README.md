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

## Status

Landing separately, each on its own change: the edge mutation-state overlays, the type picker and direction sentence, the three equivalent create paths, the re-evaluate surface, the ambient audit, the first-pass review queue, and the three-zone workspace that assembles them, wires the commands to a DOM and fixes this package's exports.

## Licence

Apache-2.0
