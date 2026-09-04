# @issuegraph/viewer

Render an [Issuegraph](https://github.com/autnmy/issuegraph) document as a **work order** — the ordered spine with readiness stations, the five edge treatments, and three projections over one normalised document.

The innermost UI layer, and the whole of its contract:

```
in     { issues, edges, order } + a projection choice
out    onSelect, onHover
never  fetching, mutation, auth, persistence, or a host's vocabulary
```

```sh
npm install @issuegraph/viewer
```

Framework-free and bundler-free. One runtime dependency ([`@issuegraph/core`](../core), for the format's field names), no CSS import, and an entry that loads on a bare Node runtime.

## Two entry points

```ts
import { renderViewer, mountViewer } from '@issuegraph/viewer';

// Pure: markup and styles, for server rendering and for tests.
const { markup, styles, scene, diagnostics } = renderViewer(document, { projection: 'graph' });

// The DOM shell: the same tree as nodes, plus the two callbacks.
const handle = mountViewer(container, document, {
  projection: 'linear',
  onSelect: (key) => console.log('selected', key),
  onHover: (key) => console.log('hovered', key),
});

handle.setProjection('tree');   // the subject survives; only the representation changes
handle.destroy();               // removes every listener it added
```

`mountViewer` reaches no global — it builds into `container.ownerDocument` — which is why the package loads where there is no DOM.

## The document

Plain and JSON-safe, so it crosses a wire. It is structurally a projection of what [`@issuegraph/derive`](../derive) returns, which a host maps across in a few lines:

```ts
const document = {
  issues: [{ key: '102', title: 'Backfill the ledger', url: '…', open: true, priority: 3 }],
  edges: [{ field: 'blocked-by', from: '101', to: '102' }],
  order: {
    slots: [{ rank: 1, lead: '102', members: ['102'], ready: true, holds: [] }],
    excluded: [{ key: '106', canonical: '105', reason: 'duplicate-of' }],
  },
};
```

**The order is an input, never something this computes.** `@issuegraph/derive` owns the derivation; a second implementation here would be a mirror whose input space drifts. Everything the viewer draws was given to it — including titles and deep links, because knowing a tracker's URL shape is exactly the knowledge this layer must not carry.

`normalizeDocument` never throws. A hand-built document is untrusted input, so a dangling edge is dropped with a diagnostic rather than taking the render down.

**A deep link is checked, not just escaped.** `url` is the one field that becomes an executable surface in the DOM, so only `http:`, `https:`, `mailto:` and relative values are linked — a `javascript:` or `data:` value is dropped with a diagnostic. Escaping the attribute would not have stopped it.

## The three projections

| projection | question it answers |
|---|---|
| `linear` | what gets worked next — the order as rows. Complete at any size. |
| `graph` | what surrounds this issue — the spine with gutters and arcs. Bounded; see below. |
| `tree` | where this work came from — the `decomposed-from` hierarchy. |

**Held slots keep their position.** A hold the graph itself imposes renders *inline at the rank the work would have taken*, with `—` for the rank and a dashed station, because "why isn't my P1 running" has to be answerable in place. A hold the runner or tracker imposes is not a fact about the work, earns no rank slot, and collapses into a footer group with duplicates. A hold's optional `code` and `subject` — the reader's machine-readable cause and the issue it names — are published as `data-code` and `data-subject` beside `data-family`, and omitted rather than emptied when the host stated neither; the viewer interprets neither and renders `reason` verbatim as before.

**The rail sits on the canvas, not above it.** Ranks and readiness stations are HTML — SVG text is not selectable, not reflowable and announces poorly — but they are the labels *for* the spine nodes, so each row is positioned at the coordinates the layout computed for its own node. One stage carries both at the layout's own size, so one SVG unit is one CSS pixel and the two cannot drift; it scrolls rather than shrinking, because shrinking would silently break that alignment.

**The graph refuses rather than degrades.** Past 60 nodes it stops drawing and shows connected components as capsules — size, blocking count, cycle flag, chain depth — and past 300 it shows clusters only. Each refusal names the next move. A refusal with a route forward reads as competence; a hairball reads as a bug.

**A row's badges are budgeted; the order is not.** The linear and tree projections draw every row at any size — that is the promise the refusal routes a reader to — so what they bound is the relationships *per row*: past `ROW_BADGE_BUDGET` (12) a row draws the first twelve in the format's field order, `blocked-by` first, and one `+N more relationships` chip carrying `data-omitted`, its name in its visible text because ARIA prohibits naming a generic span. Nothing is cut silently, and the chip carries no edge identity because it names no single edge; an omitted edge is still selectable, since the drawn-check answers from the document before it consults the markup.

## The edge grammar

Every relationship is separable on **four** channels — dash, terminal marker, glyph, and hue — so removing colour entirely leaves all five distinguishable. That is asserted as a property of the table, not claimed about the rendering.

| field | dash | terminal | glyph | ordering effect |
|---|---|---|---|---|
| `blocked-by` | solid | filled arrow | `⊘` | strict, directed |
| `serialize-with` | double | none | `⇄` | exclusive, unordered |
| `together-with` | enclosure | enclosure | `⧉` | shares one rank |
| `duplicate-of` | dotted | hollow circle | `≡` | never worked |
| `decomposed-from` | dashed | tee bar | `⑃` | none — provenance only |

The `together-with` **connector** lives in this layer, declared deliberately: a click target cannot be added from outside without the viewer knowing where members are.

**Two identities, not one.** Every focusable element carries `data-ig-key`, and exactly one element per key does — otherwise focus lands on whichever the renderer emitted first. Everything that names an **edge** — an ordinary edge path, its terminal marker, and a `together-with` enclosure and connector — carries `data-ig-group` instead, so it stays out of the focus index while remaining clickable: `mountViewer` reads both, so a pointer on either is answered.

**They name different subjects, and a host must not assume an issue key.** The enclosure names its **slot** — its `data-ig-group` is the slot's lead, so clicking it selects the unit. Every **edge** mark names the edge itself, with the identity `edgeIdentity` derives, which is exactly the `id` `@issuegraph/store` gives the matching `StoredEdge` — so `findEdge(document, key)` resolves it. That covers all five relationships: the four drawn as arcs, on both the stroke and the arrowhead that caps it, and `together-with` on its connector. One connector is drawn per declared `together-with` edge rather than per adjacent member, because a group is joined by pointing at any existing member (§4.3.7) and a star would otherwise publish a pair the document never declared.

So `onSelect` reports **either** an issue key or an edge identity. Distinguish them the way you already hold your data — an issue key is a key in the document you passed in — rather than by parsing the string. Selecting an edge deliberately does **not** move the keyboard tab stop: `navigable` lists issues, and focus is left where the reader put it.

## Theming

**Every colour, type and spacing value is a CSS custom property.** The shipped palette is the *default theme*, not the styling — a host retheming it forks nothing.

```ts
import { defaultTheme, extendTheme, renderViewer, viewerStylesheet } from '@issuegraph/viewer';

const paper = extendTheme(defaultTheme, {
  colors: {
    '--ig-bg': '#FBFAF7',
    '--ig-surface': '#FFFFFF',
    '--ig-surface-2': '#F2F0EA',
    '--ig-line': '#D9D4C7',
    '--ig-text': '#1B1A17',
    '--ig-text-body': '#3B3A35',
    '--ig-text-muted': '#5E5B52',
    '--ig-accent': '#0A5B8A',
    '--ig-focus': '#0A5B8A',
    '--ig-station-ready': '#0A5B8A',
    '--ig-station-pending': '#5E5B52',
    '--ig-station-held': '#8A857A',
    '--ig-edge-blocked-by': '#A32020',
    '--ig-edge-serialize-with': '#7A5A00',
    '--ig-edge-together-with': '#0A5B8A',
    '--ig-edge-duplicate-of': '#6B2E9E',
    '--ig-edge-decomposed-from': '#A31257',
  },
});

const { markup, styles } = renderViewer(document, { theme: paper });
```

That exact theme is the one `acceptance.test.ts` uses, so the example cannot drift from what is tested.

**Geometry is theme data too.** `metrics` are numbers, in CSS pixels, and they are what the layout maths reads — so retheming the row height moves the drawing and the stylesheet together rather than only one of them.

**The proof that theming is real**: rendering the same document under two themes produces **byte-identical markup** and different styles. If any colour reached the markup, that equality would fail.

**CSS ships as a string, not a `.css` file.** An entry that imports CSS cannot be loaded by a bare Node runtime, and a string means no consumer needs a bundler. Install `viewerStylesheet` once and `themeCss(theme)` per theme.

## Accessibility

- **WCAG AA, measured.** Every text token clears 4.5:1 against all three surfaces and every edge hue clears the 3:1 non-text bar — asserted against the palette, for the default theme *and* the documented second one.
- **Colour-blind safe**, by the four-channel rule above.
- **Keyboard navigable.** `↑` `↓` walk the order, `←` `→` traverse to gutter neighbours, `Enter` or `Space` selects, `Home` and `End` jump to the ends. Movement never wraps: the ends of the order are the ends of the work.
- **Rank order, never geometric.** The graph places boxes where the geometry puts them and publishes its traversal in *rank* order; recovering an order from coordinates is what the design forbids, and `navigate` cannot see a coordinate.
- **No graph-theory literacy assumed.** The tree is a nested list announced as one; every relationship carries a written label alongside its glyph.
- **A nested control keeps its own keyboard.** `keydown` bubbles, so Enter or Space on a row's deep-link chip follows the link rather than selecting the row — a link a keyboard cannot follow is not exposed. Movement keys stay the viewer's, so a reader can still arrow away from a link.
- **The canvas is a group, not a picture.** `role="img"` would flatten every descendant into one image node and hide the roles and labels that make gutter and held nodes reachable at all.
- **Plain list semantics, deliberately.** Rows carry a deep-link chip, and `role="option"` / `role="treeitem"` forbid a focusable descendant — so selection is announced with `aria-current` and hierarchy with nesting, which leaves the link legal instead of making it a violation.

Navigation is a pure reducer (`navigate`), so the whole key map is testable without a DOM — and the shell has nothing left to get wrong except wiring.

## What this package will not do

Fetch, mutate, authenticate, persist, or derive the order. It is layer 1 of a three-layer seam: the **editor** owns everything that mutates and composes this through its public surface, and a host's **chrome** — shell, nav, brand, freshness, links out — stays the host's.

The seam test is the acceptance test: strip the editor and the chrome, and the viewer still renders a correct, legible order.

## Versioning

`0.x`, and unstable. This tracks a draft specification, so breaking changes before `1.0` are expected and a minor bump may break you — pin exactly if that matters.

---

Stewarded by [Autonomy LLC](https://github.com/autnmy). Apache-2.0.
