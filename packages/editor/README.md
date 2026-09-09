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
| up to `CLUSTER_ONLY_BUDGET` | component **capsules** — size, `blocked-by` count, chain depth, cycle flag (the host's `ViewerDocument.cycles`, the same reader answer the audit reads) |
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

**Direction is the gather order**, `from` = source. Nothing infers it: §17b states direction and offers a flip — both on the selected relationship's own row, drawn by `renderWorkspace`, so a host that wires the published attributes without mounting gets them too — and `pickerView` re-derives after the edit lands, so a wrong guess is one act from correct. That is the same reasoning `picker/view.ts` records for retyping across the directed/symmetric split.

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
    // 'canvas' | 'kind-chooser' | 'target-search' | 'add-control' | 'elsewhere'
    interaction: activeInteraction(),
  });
  if (intent.kind === 'none') return;   // someone else's key — let it through
  event.preventDefault();
  // …reduce the intent
});
```

**It asks about *our* interaction, not about who else might own the key** — and that is the design decision worth reading, because it replaced the obvious one. Four review rounds each found a different owner the map had failed to anticipate: the platform's `Cmd+R`, the target search's digits, an input method's `⏎`, then an unrelated editable control's `Escape`. Every fix was correct and every one invited the next, because they answered an unanswerable question. *Who else might own this press?* is an inventory of the **host's** widgets — unbounded from in here, and one entry longer every time a host grows a control.

So `CreateInteraction` enumerates **this design's own flow** — one state per step of it — and the host says which one it is in:

| state | what reaches the map |
|---|---|
| `canvas` | every binding |
| `kind-chooser` | `R`, the digits `1`–`5`, and `Escape` — **not** `⏎` |
| `target-search` | only `⏎` and `Escape` |
| `add-control` | only `R` |
| `elsewhere` | nothing |

`elsewhere` is what closes the set: it is *everything that is not one of our own steps* — an inline title, a filter, a modal, a control this package has never heard of. Another widget adds no code here, and `Escape` is surrendered along with the rest, because that control needs `Escape` to cancel its own edit.

**The set is closed by the flow, not by a count.** It has grown twice, both times because a step of *this* flow was missing from it rather than because the closure argument failed — see `kind-chooser` and `add-control` below. What has never moved is the invariant that matters: no state here names a host's widget.

**`kind-chooser` is a fact about the DRAFT, not about focus** — a source gathered and no kind yet, with a focused text box excluded so a search box keeps its own digits. It was folded into `canvas` until [#152](https://github.com/autnmy/issuegraph/issues/152), on the assumption that focus stays on the row a draft was begun from; activating the add control *replaces* that control with the kind list, so focus lands wherever the host's restore puts it, and where a filter has emptied the list there is no row to land on at all. `canvas` answers only for a focused row, so the chooser's own digits were handed back at the one step whose entire purpose is to be answered with a digit.

`⏎` is withheld there deliberately, and it is the reason this is a state rather than an alias for `canvas`: `commit-target` fires on `match`, a target query survives a restarted draft, and a `⏎` at the kind step would commit a target before any kind was chosen — while also being taken from the kind button under focus.

**`add-control` is the SAME shape, one control over.** §17b gives the create flow three equivalent entries — canvas, keyboard, and the inspector's `+ add` — and the third one's control was `elsewhere`, so `R` was inert at exactly the position that *draws* `R` as its hint ([#173](https://github.com/autnmy/issuegraph/issues/173)). **A host must report this state for that to work**: report `elsewhere` while your add control has focus and `R` stays inert there, whatever version you are on.

The test that decides whether a control gets its own state — and stops the list growing on taste — is **does this control draw a key the map reads**. The kind chooser passes it because its digits are `KIND_KEYS`; the add control passes it because it draws `RELATE_KEY` itself. A control that tells the reader to press a key cannot be a control that key is refused by. A filter, a remove button, and every control that draws no key stay `elsewhere`.

It admits **`R` and nothing else**, which follows from the same sentence rather than from caution: `⌫` there would delete a selected edge the reader is not looking at, and a digit would fill a kind slot on a draft that has not begun. And unlike `kind-chooser` it *is* a fact about focus — legitimately, because at the begin step there is no draft yet, so the missing fact is the **subject** to begin from, which the control publishes on `data-ig-target`. `mountWorkspace` answers both states itself and asks the draft first, so once a draft begins `kind-chooser` takes over.

Which bindings survive `kind-chooser`, `target-search` and `add-control` is **data on the binding table**, so no call site decides it and a sixth binding is a compile error until the table answers. `⏎` and `Escape` reach it because the search box is focused at exactly the moment `⏎` must commit the target — the middle of `R → digit → search → ⏎`. Its printable keys do not: most issue references carry a digit, so a map that claimed `1`–`5` there would eat nearly every query, and `⌫` deletes a *character* rather than the reader's selected edge.

`interaction` is **required, not optional**. Every default is wrong for some host, and the plausible one — assume the canvas — is the one that steals keystrokes.

**Three press-level facts stay on `KeyPress`**, and they are bounded in a way the widget list never was: all are fields on the event itself, and `KeyboardEvent`'s shape is fixed by the platform rather than by how many controls a host has. They answer **two** questions — who owns the press, and whether it is a fresh act at all.

*Who owns it:*

- **A modified chord.** `KeyPress` is structurally a subset of `KeyboardEvent`, so the event goes straight in — a bare key name cannot tell `R` from `Cmd+R`, and the handler above would hijack reload, new-tab and tab-selection. `Ctrl`, `Meta` and `Alt` answer `none` before the table is consulted. `Shift` is deliberately *not* among them: §17b names its bindings in capitals and `Shift+r` is how a keyboard reports `R`, so treating shift as a modifier would unbind the design itself.
- **`isComposing`.** While an input method is composing, `⏎` confirms the candidate and `Escape` cancels the composition. It cannot be folded into the table: the IME owns exactly the two bindings that *reach* the target search, which is also the only place composition happens.

*Whether it is a fresh act:*

- **`repeat`.** Every binding here is a one-shot command, so a held key is one decision however many events the OS repeat delay produces. Emitting a proposal per event breaks the one-act/one-`Proposal` contract the store is built on — and the store makes that visible rather than harmless: a pending delete keeps its edge drawn and selection is client state, so the queued proposals settle into `unknown-edge` records once the first lands. It is blanket rather than a per-binding flag because there is no repeatable binding here to distinguish — `R`, `1`–`5`, `⏎`, `⌫` and `T` are all discrete commands, none a continuous motion like an arrow key.

**`T` opens the picker; it does not emit a retype.** The proposals come from `pickerView`, which already owns them — a second emitter out here would be free to disagree about what a retype is.

**A `together-with` edge needs no special case.** The viewer gives its connector an *edge* identity precisely because an enclosure has no line to click, so by the time a selection arrives here it is an ordinary edge id and `⌫` and `T` work on it unchanged.

**Validity stays in the store.** These modules emit intent; `structuralRefusal` owns `self-edge`, `duplicate-edge`, `unknown-issue` and `cardinality`. A second validity rule out here is exactly what `picker/view.ts` refused, and for the same reason.

## The three-zone workspace

The assembly leaf: the rail on the left, the canvas in the centre, the inspector on the right, and the ambient audit count in the header. `renderWorkspace` composes each zone through the entry point that already owns it, so nothing below is re-derived here.

**Positions are fixed, and that is §17f rather than a layout preference.** The rail answers *"what gets worked next"* for the whole backlog and must never refuse; the canvas answers *"what surrounds this issue"* and refuses above its budget. Assembling them must not average the two — so the grid gives each zone its own track, and a large document grows the canvas's refusal instead of squeezing the rail out.

**The canvas zone leads with a caption, and only where it is true.** Refusing loudly is the easy half of §17f; the quiet decline is the `direct` tier, where the ladder narrows to one component, draws it successfully, and would otherwise say nothing about the rest — leaving a canvas of 6 issues out of 312 indistinguishable from a backlog that has 6. So the row states the focused key and the ratio there, and nowhere else: above the budget there is no canvas to describe and the refusal already carries its own count. Its words are the host's (`WorkspaceWords.canvas`), and the `edit mode` pill beside them is separately optional, because markup served without `mountWorkspace` is not editable and must not claim to be.

**The rail is virtualised, which is what lets it stay complete.** Those read as opposites and are not: the MODEL holds every slot and `addressOf` answers for every rank in the order, while the WINDOW bounds only how many rows are drawn. A reader looking at rows 1–50 of 312 can still ask what is at rank 287 and get an answer. Windowing is therefore a rail *requirement* — the alternative, a rail that paginates, has stopped answering its question.

The window is an **offset**, not a rank, because a held slot has `rank: null` and ranks are not a coordinate you can slice on. Every out-of-range value is clamped rather than refused: this reads a scroll position, and taking the rail down over a rounding error is the one thing it may not do.

**A spacer at each end carries the height of the rows that were not drawn**, so the scroll container is as tall as the order rather than as tall as the window — otherwise native scrolling stops at the end of the first window and a host has no offset to turn into the next `start`. The pitch is the whole outer row box — `--ig-row-height` plus the slot's `--ig-space-tight` margin — because sizing on the height alone undercounts every omitted row by the gap and puts the tail of the order out of reach. What stays approximate is only variable row height: a row carrying holds is taller than a bare one, so the scrollbar is proportional rather than exact, and measuring that needs a mount this package does not have.

**The issues and edges are windowed alongside the slots**, down to exactly what the drawn rows need. Keeping the whole issue list is the obvious thing and it is wrong: the linear projection renders a count of the keys that appear in no slot and on no edge, so every edgeless issue outside the window was reported to the reader as *isolated* — the rail describing the reader's scroll position as though it were the document.

**A hold's holder is a control.** The inspector lists the selected issue's holds with `data-code` and `data-subject` mirroring layer 1's `holdLine`, and renders a `subject` — the open blocker, the claimed peer, the unready member, routinely not among the members drawn — as a `select-issue` button naming it — when the document carries that key; an unresolvable reference names an issue no document has, and gets the attribute but no control — so the holder becomes a deep link into the one selection below rather than a name in a sentence.

**Selection is one value, shared, never copied.** §17b makes `selected` the only edge state that also filters the inspector, so the workspace owns exactly one `WorkspaceSelection` and each zone reads it. It is a discriminated union rather than two nullable fields for a reason worth stating: `{ issue, edge }` can represent *both at once*, which is not a state this design has — every reader would need a rule for it, and the bug would surface as two zones disagreeing about what is selected rather than as a type error.

A selection naming a **member** of a `together-with` unit resolves to that unit's lead, because the unit is one row and `ViewerSlot.lead` is documented as the detail surface's subject — the projections canonicalize the same way before drawing, so all three zones name one issue for one selection.

**The selection names one KIND of thing, and any number of issues.** `WorkspaceSelection` is still `none | issue | edge`, and the issue arm carries a non-empty ordered tuple whose first entry is the *anchor*. That is a widening rather than a second selection: the failure the union's shape exists to prevent is holding an issue **and** an edge at once — two answers to "what is selected", so each zone is free to pick a different one — and a list of issues has one answer and one payload. Cardinality is not ambiguity. `selectedKey` keeps its signature and answers the anchor, so every reader behaves identically at N=1; `selectedKeys` and `isMultiSelection` are what a reader asks when the whole set matters. The anchor is positional rather than its own field, because an `{anchor, members}` pair can represent an anchor that is not among its own members, which is the same uninhabitable cell in a different shape.

**§17e's multi-select is what the set is for.** `shift-click` and `⇧↓` dispatch `extend-issue`, a toggle within the set; `select-issue` still replaces, so a plain click on a member collapses to that member. At N>1 the inspector draws the bulk block in place of the detail panel — a set has no single subject — and the rail and the canvas mark every member through **one** keyed walk (`marks.ts`), so they cannot disagree about the set. The anchor keeps layer 1's `aria-current`, which names *the* current item and would be wrong on six rows; every member says its membership in its own accessible name instead, the same mechanism §17c's delta chip uses on those rows. Above §17f's `direct` tier the canvas draws capsules with no keys, so it marks nothing and the block **states how many it could not show** rather than letting the zones quietly disagree.

**The three offers reach `planBatch`, and the counts are the plan's.** `BULK_OFFERS` is §17e's fixed three — `serialize-with`, `together-with`, `blocked-by` — and deliberately does *not* self-extend from `EdgeKind`: `duplicate-of` and `decomposed-from` are the kinds SPEC refuses to put on a one-keystroke bulk path. Whether a kind is symmetric is still read from `isSymmetricEdgeField`. A symmetric star centres on a member, so six selected issues are **five** writes, and the confirm states both numbers — `BatchPlan.count` for the writes, the canonicalized member count for the issues — because five alone under a header saying six reads as though an issue was dropped. A refusal is drawn, never thrown. `bulkReducer` holds the lifecycle, `landed` is its own phase rather than a return to `idle`, and `partial` carries `resumeBatch`'s remainder with an exit, because a permanently-refused proposal produces the identical remainder on every retry.

An edge selection **filters** the relationship list rather than opening a different panel, so the reader's frame of reference never jumps. Clearing returns to *nothing selected* rather than to a wider list — `none` is a selection with no subject, so there is no list to widen to, and the control is named `clearSelection` for exactly that reason. It also resolves to no viewer key, because `selected` renders `aria-current` on a *node* and an edge is not one — the canvas reads it through `selectedEdge` instead, below.

The selection reaches the **canvas** too, through two additive options on `ScaleLadderOptions` — one per kind, because the union has two payloads and the viewer's `selected` can only answer for one of them. `selected` takes the issue key and becomes `aria-current` on a node; `selectedEdge` takes the edge identity and draws `OVERLAY_TREATMENTS.selected` — the halo that is *"the only state that is not about a write"* — on the line itself. Without them the canvas drew the selected subject as ordinary while the other zones marked it: the single selection disagreeing with itself between zones on every render, which is precisely what holding one value was supposed to make impossible.

**The ladder applies that overlay itself rather than publishing its scene.** Exposing the scene would leave two ways to obtain the canvas's markup — `result.markup`, and a re-render of the decorated scene — with the first silently wrong whenever an edge is selected. It ships `edgeOverlayStylesheet` alongside for the same reason: a canvas that can draw a class while its sheet is a caller's to remember is a mark that renders as nothing on the host that did everything else right.

**Originating one is layer 1's half.** Every edge mark the graph draws — the stroke, its terminal, and a `together-with` connector — carries `edgeIdentity(...)` on `data-ig-group`, so `onSelect` reports an edge identity that `findEdge` resolves and a host turns into `select-edge`. Before that, four of the five relationships could not be pointed at on the canvas at all.

**The audit is ambient.** A persistent count in the header and a 2px left-bar on affected rail rows — no modal, no auto-fix, no animation, and a filter rather than a mode. The bar is applied by walking the rail's `ElementSpec` tree and adding `data-ig-audit` to the keyed rows, never by splicing the rendered string: `scene.root` is data and `KEY_ATTRIBUTE` is published, so this is a pure transform over a public value and no attribute in this package is escaped by anything but `renderMarkup`.

`auditFiltered` is the toggle's state, and the workspace holds it: the header draws a `button` with `aria-pressed`, so without somewhere to keep that the control could never complete the action it advertised. The filter narrows the rail **before** the window, or it would narrow only the rows the window had already reached and read as doing nothing on a long backlog. It narrows the rail and nothing else — §17a gives the audit a filter for focus, and the canvas answers a different question.

Ranking a unit's members is `heaviestRow`'s job, in the audit module, **because the weights live there**. The shortcut — take the first matching entry in `overlay.rows` — is wrong in a way that looks right: those rows are sorted by `ref`, lexicographically, so a `stale-blocker` on `a` masks a `cycle` on `b`. A row's severity is the heaviest across its **members**, not its lead. A `together-with` unit is one row and several refs, and a finding can name a member that does not lead — read off the lead alone, an affected unit renders clean, which is the audit failing silently on exactly the rows where an encoding error is hardest to see.

**An unsettled write the reader can act on gets a card.** §17b draws `failed` as a ghost with a ✕ and `conflict` as a doubled line, and gives each a set of resolutions: `retry` and `discard mine` for a failure, plus `view diff` and `retry on latest` for a conflict — and **never** an auto-merge. `WorkspaceOptions.recoveries` is the narrow input those cards need: the state, the reason or the difference, and the panel it belongs on. Not the write ledger, which carries a mutation and an entire second document per conflict.

**The buttons are read from `OVERLAY_TREATMENTS`, which is what makes the prohibition structural.** A card emits one control per affordance the grammar table declares for its state, through a mapping declared `satisfies Record<OverlayAffordance, string>` — so a fourth affordance is a compile error rather than a control that renders and does nothing, and since `OverlayAffordance` has no `merge` member no table entry can produce one. Be exact about what that buys: **no merge button can be drawn**. The behavioural guarantee is one layer down, in a store with no merge call and a `HostEffect` with no merge arm.

`retry` and `retryOnLatest` are separate words because they are separate calls. The second re-reads and **adopts the upstream document as the new base** before dispatching again, so the order can move on the press — a single word would make one card understate what its button does.

**Every card control carries `data-ig-target` naming its write.** The reducer's `retry` and `discard` arms emit no effect without it, so an omitted attribute leaves three controls that render, read correctly and do nothing. `view-diff` is a `control` case beside them rather than a command arm of its own, because the shell turns every `data-ig-command` into a `control` and an arm outside that shape has no route from a button.

**The difference is narrowed by the panel's key set, not by the carrier.** An issue panel speaks for every member of its slot, so a together unit's lead states a partner's conflict — and scoping the difference to the carrier alone would drop the partner's own edge from the one panel entitled to show it. The reader's side of that difference is rebuilt from the mutation through `edgeChangeFor`, because the landed document by contract does not carry an unlanded edit. It covers **issues as well as edges**: §17b's stated cause is that the body changed upstream, and an edges-only difference is empty for the commonest conflict there is.

**A recovery with no panel is still drawn.** Where a refusal whose carrier is `null` is dropped — there is nowhere to state it, and the cost is a sentence — a recovery in that position keeps the reader's only retry and discard, so it goes in a region at the foot of the panel under a heading that says why it is not on a relationship.

**Not yet drawn: the gold double line.** §17b's conflict *treatment* is a doubled line holding both versions, and `second-version` is a mark for whoever computed the layout. The card is the *affordance* surface; the treatment is [#102](https://github.com/autnmy/issuegraph/issues/102).

**Dark only.** The pass-2 brief carries "light + dark" over from pass 1; light was cut after that pass. There is no forked token set and no `prefers-color-scheme` block — the palette is the viewer's, reached through its custom properties.

## The mount

`mountWorkspace` is the shell a host actually consumes — the entry point [`mountViewer`](../viewer) already is for layer 1, in the same shape:

```ts
import { mountWorkspace } from '@issuegraph/editor';

const handle = mountWorkspace(element, {
  store,      // @issuegraph/store — built by the host, with its own DataSource and OrderDeriver
  project,    // (snapshot) => { viewer: ViewerDocument; audit?: AuditInput } — the host's projection
  words,      // MountWords: WorkspaceWords plus the picker's and the chrome's
  theme?, themeSelector?,
  canvas?: 'neighbourhood' | 'tree',
});
handle.update({ theme });          // new options, redrawn in place; the selection and the focus survive
handle.dispatch({ kind: 'point', key: '12' });   // a command from the host's own chrome
handle.state;                      // the selection, the draft, the scale, the rail window
handle.destroy();                  // every listener off, the nodes it built removed
```

**It was the demo's, and it ships because a second host was about to write it again.** `renderWorkspace` publishes every control as `data-ig-command` and the viewer publishes its identities as data, so wiring them to listeners was documented as a mount's job and therefore a host's. The in-repo demo was that mount: a 930-line shell and a 387-line reducer, nine review rounds to get right, and every finding in the shell. The design's layer rule puts the interaction shell in layer 2, not in a host, so it moved here as `workspace/mount.ts` and `workspace/host.ts`, unchanged in what it does.

**The reducer is pure and the shell is thin, and that split is the test strategy.** `host.ts` composes `selectionReducer`, `scaleReducer`, `createReducer` and `pickerView`, and adds only what those leave to a mount — the one shared selection, when a draft begins and ends, the rail's scroll offset, the drag that becomes a draft — so every decision runs under `node --test` with no DOM. `mount.ts` is one delegated listener per event, an `innerHTML` assignment of the package's own escaped markup, and the chrome the panels leave to a mount: the add button, the kind chooser, the target search, the delete button, all built with `createElement` and `textContent`. It is driven through jsdom, because a DOM double written for it would be a second place the shell could be wrong about the first.

**It touches the element it is given and nothing else.** The document comes from `element.ownerDocument`; a pointer release outside the element is heard on that document rather than on a window; an element is recognised by what it can do rather than by `instanceof` against a global. So the module imports on a runtime with no DOM, and `purity.test.ts` still loads it with the browser globals removed. It installs one `<style>` inside the element carrying every sheet the surface needs — the viewer's, the theme's, the ladder's, the overlays', the picker's, the workspace's and its own `mountStylesheet` — so a host installs nothing by hand.

**The canvas draws each edge's write states.** `renderWorkspace` and `renderScaleLadder` take `projected` — the store's own `ProjectedEdge` list — and the ladder attaches an overlay per edge the tier draws: `pending-write`'s dash, an `invalid` or `failed` cross, a `conflict`'s second version, composed with the selection halo on the same line. The mount passes `snapshot.projected` and reconciles the viewer document the host projected with it — the unsettled edges are added, and a landed edge the store hides behind a pending retype or flip is dropped — because the host projects the **order** from the landed document, which must not move for an edit that did not land, while what to **draw** is the store's projection by the store's own contract. The order's status is published on the surface as `data-order="held"` while a write is in flight, in the store's vocabulary, so a host says so without this package inventing the sentence.

**The first pass is composed, and the scanner is not.** `MountWorkspaceOptions.firstPass` takes one bundle — a `CandidateSource`, the queue's `FirstPassWords`, and three strings the mount draws itself (`exit`, `scanning`, `scanFailed`) — all of it or none, because a scan with no words cannot be drawn and words with no scan have nothing to draw. Supplied, §17a's entry opens a modal over the three zones: the scan, then the queue, then whatever the reader answers. Absent, the mount withholds the command and the entry is inert — the button is drawn *inside* the surface the mount rewrites on every render, so unlike a control a host draws beside the element, it cannot be intercepted from outside. Why no default scanner: the evidence §17e asks for lives in issue bodies, comments and the host's own index, which is the tracker's world and precisely what `@issuegraph/store` refuses to fetch; a heuristic in here would be one vendor's idea of a duplicate, shipped with no way to replace it. `demo/src/firstpass.ts` is a worked example of the host half.

**Consent and progress are properties of the shape.** Nothing but an `apply` builds a `Proposal` — opening, drawing, rejecting and skipping emit nothing because there is no arm on which they could — and the mount is pinned at the composed level: a drawn queue writes nothing, a whole queue answered `N`/`S` writes nothing, and one `Y` writes exactly one edge. The denominator is the candidates the host found and never the backlog size, and the mount hands the renderer a `QueueState`, a type that does not hold the backlog size at all. `⌫` steps the queue back and calls the store's own `discardMine`; it does **not** propose a compensating `delete`, so a create that already landed stays landed — the store has no undo for one, and inventing a second retraction path is what `firstpass/queue.ts` refuses in terms.

**Closing re-scans, and remembers.** A queue held across a close would go on asking about relationships the reader has since made, so it is dropped — but the candidates already applied or rejected ride outside the phase and filter the next scan, or forty rejections would come back on the next open. A `skip` is *not* filtered: §17e's `S` is "not now", and the deferred set is what a second pass is built from. Each scan carries a generation, so a slow scan answering after a close-and-reopen cannot beat the fresh one.

**Words are the host's, as everywhere here.** `MountWords` extends `WorkspaceWords` with the picker's vocabulary and the chrome's five strings; `keys` is the one optional entry. A command the reducer does not know changes nothing, so a host's own chrome may publish `data-ig-command` on the same attribute outside the element and read it from its own listener — the demo's theme switch does exactly that, and hands the writes log's `retry` and `discard` to `handle.dispatch`.

## Status

The first-pass review queue is composed from `0.6.0`: §17a's `First pass →` entry opens it, and a host supplies the one thing this package refuses to — a `CandidateSource`. §17e's multi-select bulk path is not composed yet ([#140](https://github.com/autnmy/issuegraph/issues/140)); `planBatch` and `resumeBatch` ship and are tested, and what they still need is a workspace that can hold a selection SET. The mount is this package's from `0.3.0`; what a host still supplies is what the specification puts there — the data source, the order, the executor holds, the words, the theme — and every listener is the mount's.

## Licence

Apache-2.0
