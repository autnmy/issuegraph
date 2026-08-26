# @issuegraph/editor

Everything that **mutates** an [Issuegraph](https://github.com/autnmy/issuegraph) document: the edit affordances, drawn as overlays on [`@issuegraph/viewer`](../viewer) and dispatched through [`@issuegraph/store`](../store).

> **Publishable from `0.1.0`.** The package was `private` until the change that assembles the workspace fixed its exports; that change has landed, so the manifest joins its siblings and the next release carries it. Publishing itself stays a deliberate act — `publish.yml` runs on a release or a manual dispatch, never on a push.

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
| **encoding refused** | `blocks-own-edges` | its edges are incomplete until it parses, and it reads as merely unencoded |
| **stale blocker** | `misleading` | a closed blocker already satisfies readiness; clearing is bookkeeping |

Severity, and the "keep as history" affordance the last row alone carries, are **data on a frozen class table** — so no render site picks either, and a fifth class is a compile error until the table says what it costs.

```ts
import { auditOverlay, renderAuditHeader, auditRowAttributes } from '@issuegraph/editor';

const overlay = auditOverlay({ document, graph, encodingRefused });

renderAuditHeader(overlay);          // the persistent count and its filter toggle
auditRowAttributes(overlay, ref);    // {} for a clean row; the severity mark for a flagged one
```

`auditDocument` is exported too, for a host that wants the findings without a surface. **`auditOverlay` runs the audit rather than accepting one**, deliberately: taking a finding list made this a public boundary for values the compiler never checked, and every field, invariant and mutability escape then had to be defended one at a time. A host that persisted findings re-audits to draw them — which is the right way round anyway, since the audit is pure and cheap and a persisted finding may not describe the document being drawn.

**Two of the four rest on a reader, and it is a required port.** `graph` carries `Model.cycles` and `Model.duplicateCanonical` straight off `buildModel`, in the *store's* own reference spelling — the host builds the model, so the host owns the translation between an opaque store reference and a normalised model key. It is required rather than optional because a host with no reader must not quietly receive a thinner audit and read it as a complete one.

**It is the reader's answer specifically, not the write guard.** `@issuegraph/derive`'s `wouldCycleOnBlockedBy` is a *pre-write* refusal, and its divergences all lean fail-safe for a write that is about to happen: it spans closed nodes, and it does not exempt a together unit's internal `blocked-by` edges. Over-refusing is the recoverable direction before a write and simply a false finding in an audit — §6.6 says internal edges *"stay advisory … they would make every group carrying its own ordering read as stuck"*. Reading the guard as an edge-on-cycle test flags every ordinary together group that carries its own ordering.

**Duplicate resolution is transitive, and both classes need it.** With `a duplicate-of b`, `b duplicate-of c` and `c` closed, the reader excludes *both* `a` and `b`, so both references are dead — and testing each edge's immediate target reports `b` while missing `a`, because `b` is open. §4.3.3 also reads a `blocked-by` naming a duplicate as naming its **canonical**, so the same resolution decides a stale blocker.

**A finding about a closed issue is finished history.** Two of the four classes name a harm that needs an open subject — a dead duplicate ref claims work is tracked nowhere, and a stale blocker claims readiness is satisfied — so on a closed one they would report the ordinary end of a lifecycle as a defect, permanently. The other two have no such precondition and deliberately keep none: §6.6 already restricts cycles to open nodes, and an encoding refusal is a fact about a *declaration*, which the model reads from closed nodes too.

**A refused declaration is not a discharged blocker, and a partial parse is not an absent one.** Two shortfalls that pull the same way. The reader keeps a dependent unready when the thing its edge resolved to was under-read — the declaration it could not read may carry a `duplicate-of` redirecting that edge at an **open** canonical — so a closed-but-refused target is excluded from the stale-blocker class rather than presented as dischargeable bookkeeping. And a dropped *field* returns non-null data carrying the surviving relationships, so the refusal says the edges are **incomplete and untrusted**, never that there are none.

**"Long-closed" is not available here.** A document carries no timestamp, so every closed blocker is reported — the safe direction for a finding whose whole severity is `misleading`, and one a host can narrow with a date it does have.

**Ambient, and the list of things it is not.** A persistent header count that never moves and never animates, a `--ig-stroke` gold left-bar on affected rail rows, and a filter — not a mode, because *"a mode you must enter is a mode you forget"*. No modals, toasts, red banners, badge animation, or **auto-fix**: every finding is a judgment call, so the surface offers navigation and never a remedy. That prohibition is asserted over the emitted markup and the stylesheet bytes rather than stated here alone.

**The bar is CSS on this package's own attribute, not an element drawn into a viewer row.** Layer 1's markup primitive is deliberately not on its public surface, so an overlay drawn from out here would have to re-implement HTML escaping — duplication with an injection shape rather than a mirror that merely drifts. `auditRowAttributes` answers what a row carries, `auditStylesheet` draws the bar from it, and the exchange is data.

## The three equivalent create paths

§17b asks for three ways to create an edge — **canvas** (drag to a target, picker at the drop point), **inspector** (`+ add` → type → issue search) and **keyboard** (`R` → `1`–`5` → search → `⏎`) — and is explicit that they are *equivalent*, not a primary path with two shortcuts. That matters at size rather than in principle: the canvas is a **local** instrument, so at any real backlog most targets are off it, and the inspector is *the only path* to those. A design where drag is the real path stops working at the size it was built for.

**Equivalence is a property of the shape here, not a promise a test keeps.** The three gather the same three facts in different orders:

```
canvas      source → target → kind
inspector   source → kind   → target
keyboard    source → kind   → target
```

So the draft is modelled as a **set of slots, not a sequence of steps** — each filled by its own command, in any order, with the `create` proposal emitted on whichever transition completes the set. There is exactly one emitter, and none of the three paths is named in the code at all.

```ts
import { IDLE_CREATE_DRAFT, createReducer, keyIntent, pickerPlacement } from '@issuegraph/editor';

let { draft, proposal } = createReducer(IDLE_CREATE_DRAFT, { kind: 'begin', source: '530' });
({ draft, proposal } = createReducer(draft, { kind: 'type', edgeKind: 'blocked-by' }));
({ draft, proposal } = createReducer(draft, { kind: 'target', ref: '602' }));
// proposal → { op: 'create', kind: 'blocked-by', from: '530', to: '602' }
```

**The draft carries no path identity**, deliberately. A `source` filled by a drag and one filled by `R` are the same fact, and a field recording which arrived would be a place for the paths to grow apart. What genuinely differs between them is where the picker is *drawn*, and that is geometry — `pickerPlacement`, from measured bounds — rather than state.

**Direction is the gather order**, `from` = source. Nothing infers it: §17b states direction and offers a flip, and the picker re-derives after the edit lands, so a wrong guess is one act from correct. That is the same reasoning `picker/view.ts` records for retyping across the directed/symmetric split.

**The keyboard is a full loop with no pointer step.** `keyIntent` is a pure key map — a key **press** and a context in, an intent out, no DOM — exactly as the viewer's `navigation.ts` is, so the whole map is exhaustively testable on a runtime with no DOM at all. The digits read `EDGE_FIELDS` from `@issuegraph/core` rather than restating it, so a sixth field gets a `6` for free and the picker and the keyboard cannot disagree. `⌫` binds **both** `Backspace` and `Delete`, because the key §17b draws as `⌫` reports differently across keyboards and binding one would make "no pointer" false on the other. An unbound key answers `none` and is left to the host.

### `none` means someone else owns this press

The map's whole contract, and the thing to get right when wiring it. A host's handler is "reduce a non-`none` intent, and `preventDefault()` it" — so every press the map claims wrongly is a keystroke stolen from its real owner:

```ts
element.addEventListener('keydown', (event) => {
  const intent = keyIntent(event, {
    focused,
    match,
    selectedEdge,
    // Which of the create flow's own interactions is the keyboard in?
    // Only the shell can see this.
    interaction: activeInteraction(),   // 'canvas' | 'target-search' | 'elsewhere'
  });
  if (intent.kind === 'none') return;   // someone else's key — let it through
  event.preventDefault();
  // …reduce the intent
});
```

**It asks about *our* interaction, not about who else might own the key** — and that is the design decision worth reading, because it replaced the obvious one. Four review rounds each found a different owner the map had failed to anticipate: the platform's `Cmd+R`, the target search's digits, an input method's `⏎`, then an unrelated editable control's `Escape`. Every fix was correct and every one invited the next, because they answered an unanswerable question. *Who else might own this press?* is an inventory of the **host's** widgets — unbounded from in here, and one entry longer every time a host grows a control.

So `CreateInteraction` enumerates **this design's own flow**, which §17b fixes at three states, and the host says which one it is in:

| state | what reaches the map |
|---|---|
| `canvas` | every binding |
| `target-search` | only `⏎` and `Escape` |
| `elsewhere` | nothing |

`elsewhere` is what closes the set: it is *everything that is not our own search box* — an inline title, a filter, a modal, a control this package has never heard of. A fifth widget adds no code here, and `Escape` is surrendered along with the rest, because that control needs `Escape` to cancel its own edit.

Which bindings reach `target-search` is **data on the binding table**, so no call site decides it and a sixth binding is a compile error until the table answers. `⏎` and `Escape` reach it because the search box is focused at exactly the moment `⏎` must commit the target — the middle of `R → digit → search → ⏎`. Its printable keys do not: most issue references carry a digit, so a map that claimed `1`–`5` there would eat nearly every query, and `⌫` deletes a *character* rather than the reader's selected edge.

`interaction` is **required, not optional**. Every default is wrong for some host, and the plausible one — assume the canvas — is the one that steals keystrokes.

**Three press-level facts stay on `KeyPress`**, and they are bounded in a way the widget list never was: all are fields on the event itself, and `KeyboardEvent`'s shape is fixed by the platform rather than by how many controls a host has. They answer **two** questions — who owns the press, and whether it is a fresh act at all.

*Who owns it:*

- **A modified chord.** `KeyPress` is structurally a subset of `KeyboardEvent`, so the event goes straight in — a bare key name cannot tell `R` from `Cmd+R`, and the handler above would hijack reload, new-tab and tab-selection. `Ctrl`, `Meta` and `Alt` answer `none` before the table is consulted. `Shift` is deliberately *not* among them: §17b names its bindings in capitals and `Shift+r` is how a keyboard reports `R`, so treating shift as a modifier would unbind the design itself.
- **`isComposing`.** While an input method is composing, `⏎` confirms the candidate and `Escape` cancels the composition. It cannot be folded into the table: the IME owns exactly the two bindings that *reach* the target search, which is also the only place composition happens.

*Whether it is a fresh act:*

- **`repeat`.** Every binding here is a one-shot command, so a held key is one decision however many events the OS repeat delay produces. Emitting a proposal per event breaks the one-act/one-`Proposal` contract the store is built on — and the store makes that visible rather than harmless: a pending delete keeps its edge drawn and selection is client state, so the queued proposals settle into `unknown-edge` records once the first lands. It is blanket rather than a per-binding flag because there is no repeatable binding here to distinguish — `R`, `1`–`5`, `⏎`, `⌫` and `T` are all discrete commands, none a continuous motion like an arrow key.

**`T` opens the picker; it does not emit a retype.** The proposals come from `pickerView`, which already owns them — a second emitter out here would be free to disagree about what a retype is.

**A `together-with` edge needs no special case.** The viewer gives its connector an *edge* identity precisely because an enclosure has no line to click, so by the time a selection arrives here it is an ordinary edge id and `⌫` and `T` work on it unchanged.

**Validity stays in the store.** These modules emit intent; `structuralRefusal` owns `self-edge`, `duplicate-edge` and `unknown-issue`. A second validity rule out here is exactly what `picker/view.ts` refused, and for the same reason.

## The three-zone workspace

The assembly leaf: the rail on the left, the canvas in the centre, the inspector on the right, and the ambient audit count in the header. `renderWorkspace` composes each zone through the entry point that already owns it, so nothing below is re-derived here.

**Positions are fixed, and that is §17f rather than a layout preference.** The rail answers *"what gets worked next"* for the whole backlog and must never refuse; the canvas answers *"what surrounds this issue"* and refuses above its budget. Assembling them must not average the two — so the grid gives each zone its own track, and a large document grows the canvas's refusal instead of squeezing the rail out.

**The rail is virtualised, which is what lets it stay complete.** Those read as opposites and are not: the MODEL holds every slot and `addressOf` answers for every rank in the order, while the WINDOW bounds only how many rows are drawn. A reader looking at rows 1–50 of 312 can still ask what is at rank 287 and get an answer. Windowing is therefore a rail *requirement* — the alternative, a rail that paginates, has stopped answering its question.

The window is an **offset**, not a rank, because a held slot has `rank: null` and ranks are not a coordinate you can slice on. Every out-of-range value is clamped rather than refused: this reads a scroll position, and taking the rail down over a rounding error is the one thing it may not do.

**A spacer at each end carries the height of the rows that were not drawn**, so the scroll container is as tall as the order rather than as tall as the window — otherwise native scrolling stops at the end of the first window and a host has no offset to turn into the next `start`. The pitch is the whole outer row box — `--ig-row-height` plus the slot's `--ig-space-tight` margin — because sizing on the height alone undercounts every omitted row by the gap and puts the tail of the order out of reach. What stays approximate is only variable row height: a row carrying holds is taller than a bare one, so the scrollbar is proportional rather than exact, and measuring that needs a mount this package does not have.

**The issues and edges are windowed alongside the slots**, down to exactly what the drawn rows need. Keeping the whole issue list is the obvious thing and it is wrong: the linear projection renders a count of the keys that appear in no slot and on no edge, so every edgeless issue outside the window was reported to the reader as *isolated* — the rail describing the reader's scroll position as though it were the document.

**Selection is one value, shared, never copied.** §17b makes `selected` the only edge state that also filters the inspector, so the workspace owns exactly one `WorkspaceSelection` and each zone reads it. It is a discriminated union rather than two nullable fields for a reason worth stating: `{ issue, edge }` can represent *both at once*, which is not a state this design has — every reader would need a rule for it, and the bug would surface as two zones disagreeing about what is selected rather than as a type error.

A selection naming a **member** of a `together-with` unit resolves to that unit's lead, because the unit is one row and `ViewerSlot.lead` is documented as the detail surface's subject — the projections canonicalize the same way before drawing, so all three zones name one issue for one selection.

An edge selection **filters** the relationship list rather than opening a different panel, so the reader's frame of reference never jumps. Clearing returns to *nothing selected* rather than to a wider list — `none` is a selection with no subject, so there is no list to widen to, and the control is named `clearSelection` for exactly that reason. It also resolves to no viewer key, because `selected` renders `aria-current` on a *node* and an edge is not one.

The selection reaches the **canvas** too, through an additive `selected` on `ScaleLadderOptions`. Without it the canvas drew the selected issue as ordinary while the rail marked it current — the single selection disagreeing with itself between two zones on every render, which is precisely what holding one value was supposed to make impossible.

**The audit is ambient.** A persistent count in the header and a 2px left-bar on affected rail rows — no modal, no auto-fix, no animation, and a filter rather than a mode. The bar is applied by walking the rail's `ElementSpec` tree and adding `data-ig-audit` to the keyed rows, never by splicing the rendered string: `scene.root` is data and `KEY_ATTRIBUTE` is published, so this is a pure transform over a public value and no attribute in this package is escaped by anything but `renderMarkup`.

`auditFiltered` is the toggle's state, and the workspace holds it: the header draws a `button` with `aria-pressed`, so without somewhere to keep that the control could never complete the action it advertised. The filter narrows the rail **before** the window, or it would narrow only the rows the window had already reached and read as doing nothing on a long backlog. It narrows the rail and nothing else — §17a gives the audit a filter for focus, and the canvas answers a different question.

Ranking a unit's members is `heaviestRow`'s job, in the audit module, **because the weights live there**. The shortcut — take the first matching entry in `overlay.rows` — is wrong in a way that looks right: those rows are sorted by `ref`, lexicographically, so a `stale-blocker` on `a` masks a `cycle` on `b`. A row's severity is the heaviest across its **members**, not its lead. A `together-with` unit is one row and several refs, and a finding can name a member that does not lead — read off the lead alone, an affected unit renders clean, which is the audit failing silently on exactly the rows where an encoding error is hardest to see.

**Dark only.** The pass-2 brief carries "light + dark" over from pass 1; light was cut after that pass. There is no forked token set and no `prefers-color-scheme` block — the palette is the viewer's, reached through its custom properties.

## Status

The first-pass review queue lands as its own change. Wiring the published `data-ig-command` controls to real listeners remains a **mount's** job and therefore a host's: this package renders, and every control says what it does as data so the host can read it, reduce, and render again.

## Licence

Apache-2.0
