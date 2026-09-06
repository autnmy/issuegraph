# The demo sandbox

Live at **<https://issuegraph.org/demo/>**: `@issuegraph/viewer` and
`@issuegraph/editor` running on an in-memory backlog. **No tracker, no app
installation, no auth, no backend.** Every edit is client-side and saved
nowhere; reload and the seed comes back.

**The page lands on the design's own scenario** — the §16a frame of
`Descant Dashboard.dc.html` in the design kit — and loads the dense backlog
only when asked. See [The seed](#the-seed) for what that means and why.

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

`@issuegraph/editor` renders, and since `0.3.0` it mounts: `mountWorkspace`
wires the published `data-ig-command` controls to listeners, restores focus
across every redraw, routes the keyboard, runs the canvas drag and subscribes
to the store. That shell used to be this page's — 930 lines, nine review rounds
— and it moved into the package because a second host was about to write it
again. What this page supplies is what the specification puts with a host:

| file | what it is |
|---|---|
| `src/document.ts` | the projection of the explained order onto the viewer's `ViewerDocument`, plus the audit's input — from ONE derivation, so the audit's duplicate resolution and the store's cannot disagree |
| `src/workspace.ts` | the sandbox: `mountWorkspace` over the store and that projection, plus the chrome the sandbox owns — the writes log, the versions line, the theme, canvas and document toggles, the armed outcome and the reset |
| `src/order.ts` | the projection onto `@issuegraph/derive`, and the host's base ranking as an explicit input to it |
| `src/seed.ts` | the comp, the dense layer and the scenario table, below |
| `src/source.ts` | the in-memory adapter, with the two unhappy outcomes armable |
| `serve.mjs` | a dependency-free static server for the repository root |

**The sandbox's chrome shares the command attribute and its own listener.** A
`data-ig-command` inside the mounted element is the mount's; one outside it —
the masthead toggles, the writes log's `retry` and `discard` — is read by one
delegated click on the sandbox root, which hands the mount's own commands to
`handle.dispatch` and keeps `theme`, `canvas`, `scenario` and `reset` for itself.

**`textContent`, everywhere.** Every string this page writes is host chrome
built with `createElement` and `textContent`, because a title is data an
adapter supplied. The one `innerHTML` assignment — the packages' own rendered
output, escaped by `renderMarkup` — is the mount's now, not this page's.

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
  on latest**, which is the store's `retryOnLatest` — one reserved operation
  that re-reads the document and then re-dispatches the edit against it.
- **Both hold families**, both drawn where the viewer puts them: a graph-derived
  hold inline at its would-be rank showing `—`, an executor-derived one in the
  footer group with no rank slot.
- **The change summary** after a write lands — `diffOrder`'s facets, through the
  editor's `summaryOf` — and the order reading **held** while a write is in
  flight. Optimistic rendering is allowed; optimistic re-ordering is not.
- **Two themes and a version stamp**, below.

## The seed

Two layers behind one control, pinned by three tests.

**The landing state is the comp.** Load the page and, before any interaction,
the workspace shows the scenario the design's **§16a** frame (the list view) and
**§16b** frame (the graph view) were drawn against — `Descant Dashboard.dc.html`
in the `design_handoff_issue_relationships` kit — with the same issues, numbers,
priorities, relationships and holds: the auth thread around `#488` (`Extract
session store adapter`, `P3 → 0`), the `#512` / `#514` unit at one rank, the
`#501` / `#503` serialize group, `#530` held inline by `#602`, `#520` on the
spec default tier, `#487` behind it, and the runner-held footer (`#533`
claimed, `#541` parked). The frame is the specification; `seed.ts` reads its
rows off it and `seed.test.ts` pins that the derivation lands on them.

It is the comp because fidelity cannot be judged against a backlog the design
never drew. This page is the only place the packages are seen at full size, so
it is the only place a fidelity claim can be made — and beside a generic
backlog every difference is arguable, while beside the comp "does this match
the frame" is a glance. It is also the coverage seed: every edge type, both
hold families, all three readiness stations and all three rank-provenance
forms are reachable in it without editing anything, which `order.test.ts` and
`source.test.ts` pin, enumerating from the vocabulary rather than from a list
beside it.

**Where the comp and the frame read differently**, on purpose, so the next
reader does not have to infer it:

- The frame prints rank `2` on the blocked unit with a hollow station, "ready
  once #488 closes". The viewer prints `—`: a held slot never carries a
  number, and the spec's `ready` (§6.2) holds a unit whose `blocked-by` is
  open. So the frame's ranks 3–6 read 2–5 on screen. That is a question for
  the §16 fidelity pass, and this comp is what makes it visible.
- The frame draws one hollow station, on `#503`, and attributes it to the
  serialize group ("waits for #501"), with "4 ready now · cap 2" in the
  header. This host's concurrency cap (`DEFAULT_CONCURRENCY_CAP`, 2) is what
  decides hollow, so `#503`, `#520`, `#487` and `#505` are all hollow — ready,
  after an earlier rank frees a slot — and six rows are ready. The serialize
  group holds nobody, because nobody in it is claimed.
- `#602` carries a `P2 → 1` promotion chip in the footer: it blocks the P1
  `#530`, and §6.3 promotes it. The frame's left gutter prints no priority.
- The frame prints a priority only on the spine rows. The `now` row, the
  footer group, the duplicate and the closed origin are undeclared here for
  that reason, and read as the default tier where a tier is printed at all.
  `#505`, which the frame does not draw, is declared P3 so it ranks last.
- `#602` is "open · not eligible" in the frame — outside the order because no
  pick-order query reaches it. This host has no ordered queries, so it is the
  host's own hold (`not eligible`) and sits in the footer group rather than
  the graph's left gutter.
- `#499` is the frame's `now` row, "Review · 12m". It is an active claim in
  the hold table (so the graph excludes it) and the scenario's `running` job, so
  the viewer draws it in the NOW row above the order and the footer omits it.
- `#488`'s `✓ verified` chip is not drawn: the store carries no evidence field.
- The frame's "group of 3" on `#501` names only `#501` and `#503`. The third
  member, `#505`, is ranked below the drawn rows — the frame says "19 more
  ranked · scroll" — because groups are computed, never written down, and a
  count of three needs a third issue to exist.
- The base ranking is the frames' own order, written down (`COMP_ORDER`),
  because the derivation takes a host's ordering as an input and this host
  cannot run the pick order the frames were drawn against.
- The comp ships no unresolvable reference — the frames draw none — so the
  `unresolvable` chip (§6.7) lives in the dense layer, on one generated issue.

**The dense layer** (#100 onward) loads from the **Document** control — "the
big backlog" — and is generated deterministically: the same document on every
load, so a screenshot is a reproduction. `seed.test.ts` pins what it has to
contain, against the package constants that decide it: a component past
`GRAPH_NODE_BUDGET` on its own, a component small enough to draw, a capsule
flagged as a cycle, a finding for each audit class, more slots than a rail
window, closed origins for the tree, and an edge-free majority (the design's
own sample was 248 of 312). It stays reachable in one click because a defect
that only shows at three hundred is exactly the kind an embedding host would
otherwise be the first to meet; it is no longer the front door because the
first paint was the stress test — the canvas refusing at the node budget —
rather than the product. Loading it keeps the comp's rows at the head of their
tiers and lets the generated issues fall in behind them.

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
