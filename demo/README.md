# The demo sandbox

Live at **<https://issuegraph.org/demo/>**: `@issuegraph/viewer` and
`@issuegraph/editor` running on a dense in-memory backlog. **No tracker, no app
installation, no auth, no backend.** Every edit is client-side and saved
nowhere; reload and the seed comes back.

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

Two reasons, and the second is the newer one.

**If the demo needs a tracker, the data-source port is not a port.** A seam only
ever driven by one real adapter is a seam by assertion. So this page drives
`@issuegraph/store` — the published package, unmodified, loaded in the browser
from the `exports` entry its own manifest declares — through an adapter that has
no tracker behind it at all.

**If a defect only shows up inside a host, nobody can tell whose it is.** The
viewer and the editor are about to be embedded in a product, next to that
product's own chrome, on that product's own backlog. A surface that runs both
packages with no host chrome, on a document dense enough to reach every tier
and every refusal, is where a defect is reproduced as the package's own — and
where the theming contract the embed relies on is shown to work rather than
described.

Everything on this page that is not a package is **host** work, and that split
is the demonstration:

| the packages supply | the host supplies |
|---|---|
| the document, the write loop, the edge states, the change summary (`store`) — the selection order, the readiness verdict, effective priority, the cycle walk (`derive`, over `reader`) — the work order, its three projections and the edge grammar (`viewer`) — the rail, the scale ladder, the inspector, the audit, the picker, the create draft and the key map (`editor`) | the data source, the executor holds, the concurrency cap, the base ranking, the words, the theme, and every listener |

## What the packages leave to a host, and where it is

`@issuegraph/editor` renders. Its README says the rest in one sentence:
*"wiring the published `data-ig-command` controls to real listeners remains a
mount's job and therefore a host's."* This page is that mount, in three files
with one seam between them:

| file | what it is |
|---|---|
| `src/document.ts` | the projection of the explained order onto the viewer's `ViewerDocument`, plus the audit's input — from ONE derivation, so the audit's duplicate resolution and the store's cannot disagree |
| `src/host.ts` | every decision, as a reducer with no DOM: what a command does to the shared selection, the create draft, the scale state, the rail window, the theme; and which effects the shell performs against the store |
| `src/workspace.ts` | the shell: one delegated listener per event, `renderWorkspace` into a container, and the chrome the packages do not draw |
| `src/order.ts` | the projection onto `@issuegraph/derive` — unchanged from the list demo this page replaced |
| `src/seed.ts` | the coverage seed and the dense layer, below |
| `src/source.ts` | the in-memory adapter, with the two unhappy outcomes armable |
| `serve.mjs` | a dependency-free static server for the repository root |

**The reducer is the demonstration of the editor's design, not a convenience.**
The editor ships its state as reducers — `selectionReducer`, `scaleReducer`,
`createReducer` — and its keyboard as a pure key map, so that a host's own
decisions can be tested the same way: `host.test.ts` drives all three create
paths to one proposal and every picker edit to the picker's own proposal, under
`node --test`, with no DOM anywhere.

**`innerHTML`, once, on purpose.** The old list wrote every string with
`textContent`, because a title is data an adapter supplied. That rule stands —
the host's chrome is built with `createElement` and `textContent` — and what is
assigned as markup is only the packages' own rendered output, escaped by
`renderMarkup`: the same bytes a server-rendered host would send.

## What you can reach from the page

- **The three-zone workspace**: the virtualised rail on the left (complete at
  any size; the window follows the scroll), the scale ladder in the centre, the
  inspector on the right, the ambient audit count in the header with its filter.
- **The three projections.** The rail is the linear one; the canvas is the graph
  — refusing at the top with component capsules, drawing a component when
  focused, and refusing again on the one component that is past budget on its
  own; and the **tree** toggle swaps the canvas for the `decomposed-from`
  hierarchy under its closed origins.
- **Every edit path.** Create by the inspector (`+ add` → kind → search), by the
  keyboard (`R` → `1`–`5` → search → `⏎`), and by the canvas (drag a node onto
  another; the kind chooser opens at the drop point). Retype and flip from the
  picker on a selected edge, delete from its button or `⌫`, `Esc` to cancel.
- **Every edge state.** `pending-write` on any edit; `invalid` from a refusal the
  adapter never sees (a self-edge, a duplicate, a would-be cycle); `failed` and
  `conflict` by arming what the tracker answers next. A conflict offers **retry
  on latest**, which is the store's `rehydrate` then `retry` — composed by the
  host, because the store deliberately offers no retry-on-latest of its own.
- **Both hold families**, both drawn where the viewer puts them: a graph-derived
  hold inline at its would-be rank showing `—`, an executor-derived one in the
  footer group with no rank slot.
- **The change summary** after a write lands — `diffOrder`'s facets, through the
  editor's `summaryOf` — and the order reading **held** while a write is in
  flight. Optimistic rendering is allowed; optimistic re-ordering is not.
- **Two themes and a version stamp**, below.

## The seed

Two layers, pinned by two tests.

**The coverage seed** (#1–#14) is hand-written so every edge type, both hold
families, all three readiness stations and all three rank-provenance forms are
reachable without editing anything. `order.test.ts` and `source.test.ts` pin
that, enumerating from the vocabulary rather than from a list beside it.

**The dense layer** (#100 onward) is generated deterministically — the same
document on every load, so a screenshot is a reproduction — and `seed.test.ts`
pins what it has to contain, against the package constants that decide it: a
component past `GRAPH_NODE_BUDGET` on its own, a component small enough to
draw, a capsule flagged as a cycle, a finding for each audit class, more slots
than a rail window, closed origins for the tree, and an edge-free majority (the
design's own sample was 248 of 312).

**One divergence is known and pinned, not patched.** A `blocked-by` cycle
running *through* a `together-with` unit is a real deadlock that `Model.cycles`
reports nowhere ([#43](https://github.com/autnmy/issuegraph/issues/43)). The
dense layer carries one so it stays visible on the page, and `order.test.ts`
pins the gap with a control.

## Theming

**The workspace is themed by the viewer's own custom properties.** The default
palette and the paper one — the exact theme the viewer's README documents and
its acceptance test renders — are installed from `themeCss`, and switching
between them changes no markup. That is the contract an embedding host relies
on, shown rather than claimed.

**The chrome around it follows the same rule.** Every colour, dimension, radius,
weight and tracking used in `styles.css` is a custom property in the two token
blocks at the top of the file, one per theme, and `src/theme.test.ts` fails the
build if a length literal reappears in a rule or a property is used without
being declared. The hue is never load-bearing: each kind button carries its
digit and its phrase, so the page reads identically with colour removed.

## The version stamp

The page states which package versions it runs, read off each package's
manifest **at build time** by `scripts/stamp-demo-versions.ts` into a
gitignored `src/versions.ts`. Not at run time: the browser cannot import a
sibling's `package.json` without reaching past the seam the lint config
refuses, and not by hand, because a hand-kept list is wrong the release after
it was written.

## How it is deployed

`.github/workflows/pages.yml` builds the workspace on every push to `main`,
runs `scripts/assemble-site.mjs`, and deploys the result. The assembly copies an
allowlist — the landing page, this page, its styles and `dist`, each package's
`dist`, and the reader's `yaml` browser build — **at the same paths the import
map already uses**, so issuegraph.org and `serve.mjs` serve one page. Its test
asserts every import-map target and every script and stylesheet the pages
reference exists in the assembled tree, which is what makes "the sandbox cannot
silently break" a property of CI rather than a hope.

## What it is not

- **It is not the first-pass review queue.** That surface takes a candidate port
  the host fills from evidence — two bodies naming one path, a comment linking an
  issue — and a sandbox with no tracker has no evidence to offer it.
- **It does not draw write states on the canvas.** `renderWorkspace` takes no
  projected edges, so a pending, failed or conflicting write shows in the writes
  panel above the workspace rather than as an overlay on the drawn edge. That is
  a gap in the package, not a choice here, and it is filed upstream.
- **It is not published.** `private: true`, and it lives outside `packages/` on
  purpose — that directory is what the isolation guard, the consumer smoke test
  and the lint config all read as "this ships". The demo is a **consumer**.
