# @issuegraph/editor

Everything that **mutates** an [Issuegraph](https://github.com/autnmy/issuegraph) document: the edit affordances, drawn as overlays on [`@issuegraph/viewer`](../viewer) and dispatched through [`@issuegraph/store`](../store).

> **Not published yet.** The package is `private` while its surface is empty. It builds, typechecks, lints and tests with the rest of the workspace so the seam it exists to keep is enforced from the first commit — but a package with no API is not one anybody should be able to install. It goes public with the change that assembles the workspace and fixes its exports.

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

## Status

The surface is deliberately empty. Landing separately, each on its own change: the edge mutation-state overlays, the type picker and direction sentence, the three equivalent create paths, the re-evaluate surface, the ambient audit, the scale ladder, the first-pass review queue, and the three-zone workspace that assembles them and fixes this package's exports.

## Licence

Apache-2.0
