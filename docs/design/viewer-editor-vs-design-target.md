# The viewer and the editor against their design target

**Measured 2026-09-19 · side-issuegraph-ux-1 · no code changed**

This is a read of what ships against what design drew. It answers one question the
owner asked: why does the running thing look so little like the target, and what
would most help — another implementation sweep, or more from design first.

The short answer is at the bottom. It is **neither one alone**: one sweep would fix
most of what is wrong, and four questions must come back from design before a
second sweep can be correct. Both lists are here.

---

## 1. What was measured, and against what

| | |
|---|---|
| Implementation | `demo/` on this branch, built from `packages/viewer@0.8.2` and `packages/editor@0.21.0` |
| Design frames | `Descant Dashboard.dc.html`, tiles `17a`–`17h` and `16a`–`16i` |
| Reference prototype | `Relationship Editor Prototype.dc.html` |
| Written spec | the kit's `SPEC.md` and `START_HERE.md`, **including the 2026-08-22 amendment** |
| Kit | `~/GitHub/autnmy/descant-design-kits/` (canonical); §16/§17 tiles verified identical to the 2026-08-18 copy |
| Viewport | 1440 × 900 for every capture, both sides |

### Which kit, and why it stopped mattering

This was measured first against the only copy then on the machine —
`~/Downloads/design_handoff_issue_relationships/`, dated **2026-08-18** — because
the path issue [#122](https://github.com/autnmy/issuegraph/issues/122) names as the
source of truth, `~/GitHub/autnmy/descant-design-kits/`, did not exist. #122 calls
any `~/Downloads/` copy stale and points at a "2026-08-22 amendment" that appeared
in no file in it. The owner ruled: use it, carry on.

**The canonical repo was then cloned, and the two were compared. Every `§16` and
`§17` tile is identical, character for character** — all seventeen, by normalised
text diff of the extracted tile markup. `Relationship Editor Prototype.dc.html` is
byte-identical. So **nothing in section 3 below moves.** The frames this report
measures are the frames design shipped.

What the canonical kit does add is the **2026-08-22 amendment**, in `START_HERE.md`
and `SPEC.md` §17g. It is architecture, not visuals — and the implementation
already meets it. That is [section 2b](#2b-the-2026-08-22-amendment-already-met).

### Reproducing it

```bash
pnpm install && pnpm run build && node demo/serve.mjs
```

Then open `http://127.0.0.1:8000/demo/` and, in a second tab, the two `.dc.html`
files from the kit over any static server. Screenshots at 1440 × 900 are in
[`evidence/2026-09-19/`](./evidence/2026-09-19/).

---

## 2. The headline, before the table

Three numbers carry most of the owner's complaint.

**A rail row is 53 pixels in the frame and 134–408 pixels in the implementation.**
Every frame row is exactly 53px and exactly four lines: rank · title · one
metadata line · one delta chip. Implementation rows run 8 to 22 lines and average
**217px — 4.1× the frame, and 7.7× on the worst row.** Six frame rows occupy
318px. Eight implementation rows occupy **1,733px inside a 570px zone**, so three
rows are visible at a time.

**The rail carries a 229px legend.** There are two identical relationship legends
on one screen — one in the rail zone, one in the canvas zone. The rail's eats 40%
of that zone's visible height. The frame has no legend in the workspace at all.

**The product starts 518 pixels down the page.** The demo's own sandbox chrome —
theme, canvas, state, document and outcome controls with four explanatory
paragraphs — is 478px, and the workspace header is another 40. At 900px that
leaves 382px, so what a visitor actually sees is one and a half rail rows and the
word "Pick a row". The frame fits the entire workspace — header, three zones, all
six rows, the graph, and the full inspector — in 900px with room left over.

Put together: **the implementation renders every fact the design asked for, and
renders all of them at once, at full length, everywhere.** Design's layout is a
scannable index (rail) pointing at one explanation (inspector). The
implementation has turned the rail into a stack of explanations and left the
inspector to repeat them. That is what "confusing as hell" is measuring. It is not
a missing-features problem. It is a **hierarchy** problem, and hierarchy is the one
thing the frames encode that prose cannot.

---

## 2b. The 2026-08-22 amendment — already met

The canonical kit carries an owner amendment the 2026-08-18 copy does not. It
retires the premise that these were features inside Descant's dashboard: **layers 1
*and* 2 — viewer core and editor — ship as OSS packages in `autnmy/issuegraph`**,
and only layer 3 (shell, nav, brand) stays Descant's. It names two contracts the
original kit did not, and restates one rule as load-bearing.

**Every one of them is already satisfied.** Recorded here because it is the half of
this report that is good news, and because it changes what the gaps in section 3
mean.

| Amendment requirement | Status | Evidence |
|---|---|---|
| **Don't target `apps/dashboard`'s stack** — "cannot assume a consumer runs shadcn, Tailwind v4, Next 15 or the App Router" | **met** | the packages are framework-free TypeScript emitting HTML strings; `check:isolation` and the ESLint import rules enforce it mechanically |
| **BYO-Theme** — the package *ships* a theme, it does not *have* one; all values exposed as CSS custom properties, editor included | **met** | `packages/viewer/src/theme.ts`; the demo retimes the whole workspace, editor and all, with its `default` / `paper` toggle |
| **BYO-DataSource** — client store, host pipes a source in through an adapter; no fetching, no auth, no mutation of its own | **met** | `@issuegraph/store` takes the deriver and the source as ports; the demo runs on an in-memory backlog |
| **The demo is the proof the port is real** — "no GitHub App, no auth, no backend" | **met** | `node demo/serve.mjs` from a clean checkout, no credentials |
| **A failure does not silently revert the UI** — it is *marked*, per §17b | **met** | armed a reject: the edge stays, marked `✕ This edit was refused` with `retry` / `discard mine` |
| **Conflict offers view diff / retry on latest / discard mine, never auto-merge** | **met** | armed a conflict: all three offered, no merge |
| **Optimistic rendering yes, optimistic re-ordering no** | **met** | through pending, refused and conflicted writes the subject held `WHY RANK 4` — the order never moved on an unlanded edit |

One small inconsistency found while testing: the in-flight writes strip offers
`retry on latest` and `discard mine` on a conflict but omits `view diff`, which the
inspector does show. One missing control, `packages/editor/src/overlay/render.ts`.

**Why this matters to the recommendation.** The architecture design asked for in
August is built and provably working, including the parts that are easiest to fake
and hardest to retrofit. What is wrong is downstream of all of it. That is the
difference between a sweep and a rebuild, and it is now measured rather than
assumed.

---

## 3. The gap table

> **Status 2026-09-20, after `28a83a5` merged to `main`.** Rows **1, 2, 7, 33,
> 42 and 51** are **CLOSED** and say so in place; row **3** is **PARTIAL**. Every
> other row is **unchanged** — the sweep touched the rail, the audit filter, the
> capsules and the zone tracks, and nothing else. The inspector, the edit flow,
> the re-evaluate surface and the audit cards are untouched code.
>
> The closed rows were re-verified against the source rather than against the
> commit messages, and that re-read is what caught row 3: the provenance line is
> *hidden* at rail density, not *expandable*. §17j asks for expand-on-demand and
> only the inline half is done. A commit comment of mine claimed otherwise and
> has been corrected.

Class key — **MS** missing spec (design never drew or described it) · **SI** spec
ignored (design is clear, implementation differs) · **SA** spec ambiguous (frame
and prose disagree, or the frame is internally inconsistent) · **BU** behaviour
undefined (the state exists at runtime and design never said what it does).
A struck class (`~~SI~~`) means the gap is closed; the class records what it was.

**Two cells I could not settle from the source and have not rewritten:**

- **Row 10** (`as of … agorefresh`, no space). The markup emits no whitespace
  text node, but `.ig-workspace-refresh` carries `margin-left:
  var(--ig-space-tight)`. Whether the gap is real needs a rendered measurement,
  not a read — the original observation came from extracted text, which drops
  CSS gaps. Left standing, marked here as **unconfirmed**.
- **Row 12** (`WHY RANK` clauses, "three fragments"). Today's `whyRankSpec`
  emits at most two spans, the holds having become a `<ul>`. Whether the third
  fragment ever existed would need the original capture. The 2px separator is
  still real and still the defect; the count may not be.

### 3.1 Workspace shell (§17a)

| # | Element | Design target | Implementation | Class |
|---|---|---|---|---|
| 1 | Rail row height | 53px, uniform, 4 lines | **CLOSED `28a83a5`** — 53px, every row, now strip included. Was 134–408px, variable, 8–22 lines | ~~SI~~ |
| 2 | Rail row content | rank · title · **one** metadata line · delta chip | **CLOSED `28a83a5`** — line 2 is one `.ig-row-meta` run (`488 · P3 → 0 · ⊘ blocks 512`). Was every badge on its own line plus a `↳` sentence per rule | ~~SI~~ |
| 3 | Provenance placement | in the inspector, under `WHY RANK n`; §16f makes it `→ expand` on a row | **PARTIAL `28a83a5`** — no longer inline on the row (`display: none` at rail density), but **there is no expand affordance**, so a rail reader reaches it only through the inspector. §16f's `→ expand` does not exist | **SI** |
| 4 | Rail heading | `WORK ORDER` | `ORDER PREVIEW` — which is §16's name for the read-only surface | **SI** |
| 5 | Rail header controls | `filter` control + total count `312` | three count chips (`8 ranked`, `6 ready now · cap 2`, `6 held`), no filter control | **SI** |
| 6 | Relationship legend | not present in the workspace | present **twice** — 229px in the rail, 88px in the canvas | **MS** |
| 7 | `NOW` block | ~~not present~~ **`16a` draws it** — my original cell was wrong, see [3b](#3b-design-answered--and-two-of-my-four-questions-were-my-own-misreading) | **CLOSED `28a83a5`** — a 53px first row of the rail carrying a `now` mark and no rank number. It never printed a rank; what was wrong was its 83px height | ~~MS~~ |
| 8 | Zone proportions | ≈ 390 / 575 / 330 (30 / 45 / 25) | 312 / 758 / 312 (22 / 54 / 22) — narrowest rail carrying the most content | **SI** |
| 9 | Header counts | `312 open` · `64 encoded` · `◆ 3 encoding problems` | `297 open · 126 encoded` present at scale; audit chip reads `6 audit` with no `◆` | **SI** |
| 10 | Freshness + refresh | `as of 14:32` then a separate `↻` control | `as of 22:26 · 59s agorefresh` — **no space before the control** | **SI** |
| 11 | Solid-cyan budget | one primary action (`First pass →`) plus the active view toggle | also spent on the `NOW` badge and the `ready now · cap 2` count chip, so the primary action no longer leads | **SI** |

### 3.2 Inspector (§17a) — the largest single gap

| # | Element | Design target | Implementation | Class |
|---|---|---|---|---|
| 12 | The `WHY RANK` sentence | one punctuated sentence: *"Matched query 1 (`label:P0`). Held until #488 closes, then worked with #514 as one unit."* | three unpunctuated fragments separated by a **2px margin**, so they collide on screen: `…ranked in tier P0worked as one unit with 514` | **SI** |
| 13 | Heading when held | frame always says `WHY RANK n` | says `WHY HELD`, because derive gives a held slot no rank | **SA** — see Q1 |
| 14 | Deep-link chip | `descant-web #512 ↗` pill, described in §16f as *the only external link* and *one predictable target in both views* | absent; the inspector prints a bare `512`. The only `open in GitHub` on screen belongs to the encoding-refused block | **SI** |
| 15 | `ADD RELATIONSHIP` list | standing, always visible under the relationship list | hidden behind `+ add`; at rest the zone shows one hint string instead | **SI** |
| 16 | Kind key numbers | `blocked-by 1 · serialize-with 2 · together-with 3 · duplicate-of 4 · decomposed-from 5` | `blocked by 1 · decomposed from 2 · duplicate of 3 · serialized with 4 · together with 5` — **four of five keys bound to a different type** | **SI** |
| 17 | Kind labels | the spec's own field names (`blocked-by`, `serialize-with`) | prose forms (`blocked by`, `serialized with`), which no longer match the YAML the user is editing | **SI** |
| 18 | Close control | `✕` | a text button reading `clear the selection` | **SI** |
| 19 | Encoding-refused block | §17d draws it inside the audit panel | permanently pinned above the inspector, in red, at the top of the right column — the loudest thing on screen before anything is selected | **SA** — see Q3 |

### 3.3 Edit interactions (§17b)

| # | Element | Design target | Implementation | Class |
|---|---|---|---|---|
| 20 | Direction sentence | `#530` `is blocked by` `#602` | present and correct — `#520 is blocked by …` | — ok |
| 21 | Flip control | `⇅ flip` beside the sentence, because *"which way round" is the single most common encoding mistake* | **no flip control anywhere in the create flow** | **SI** |
| 22 | Canvas create path | select source → drag from edge port → picker at drop point | not reachable in the demo; the canvas draws §16's three-column spine, which has no edge ports | **SI** |
| 23 | Keyboard `R` | opens the picker from a selected issue | did not open the picker from a focused rail row in this run; `+ add` works. (CHANGELOG records one fix in this area already) | **SI** |
| 24 | Edge mutation states, on a graph edge | five overlays — selected / pending-write / invalid / failed / conflict | all five exist in `overlay/`; not reachable as *edge* overlays in the demo, because its canvas draws §16's column spine and not a graph with edges to overlay | **BU** — see Q4 |
| 24b | The same states in the rail and inspector | design does not draw them outside the canvas | **implemented and correct** — pending, refused and conflicted all render with their controls, and the order does not move. See [2b](#2b-the-2026-08-22-amendment-already-met) | — ok |
| 24c | Conflict controls in the writes strip | `view diff` · `retry on latest` · `discard mine` | the strip offers two; `view diff` appears only in the inspector | **SI** |

### 3.4 The re-evaluate loop (§17c)

| # | Element | Design target | Implementation | Class |
|---|---|---|---|---|
| 25 | Change summary, line 1 | **the cause**: *"You added `#488 blocks #512` — 3 rows moved"* | no cause, no total; reads only `1 newly held` | **SI** |
| 26 | Change summary, line 2 | the breakdown: *"1 newly promoted · 1 newly held · 1 pushed down"* | the breakdown is the whole summary | **SI** |
| 27 | `undo` | beside `dismiss` | `dismiss` only | **SI** |
| 28 | Summary placement | a full-width band above the rail | appended to the far right of the workspace header, after `First pass →` | **SI** |
| 29 | Delta chips | `▲5` `▼2` `→ held` `→ ready` | `newly held` as text; the `▲n` / `▼n` rank-delta forms were not produced | **SI** |

### 3.5 Audit (§17d)

| # | Element | Design target | Implementation | Class |
|---|---|---|---|---|
| 30 | Header count | persistent, quiet, `◆ 3 encoding problems` | present; reads `6 audit`, no `◆` glyph | **SI** |
| 31 | Gold 2px left-bar on flagged rail rows | required | **implemented and correct** — `#E2B912`, 2px inset. But it reached only 2 of 6 findings: the cycle members carry no bar | **SI** (partial) |
| 32 | Audit toggle state | a toggle | `aria-pressed` did not track across clicks in this run | **SI** |
| 33 | Filtered rail | §17a: the rail *"must never refuse or paginate away from an answer"* | **CLOSED `28a83a5`** — reads `No flagged rows match. / 8 issues are ranked / clear the filter`, the denominator from `host.counts.ranked`. Was the §16i zero | ~~SA~~ |
| 34 | Finding card headline | specific per finding — *"#533 is blocked by an issue closed 4 months ago"* | generic per class — *"This waits on an issue that is already closed."* — so every card of a class is identical at a glance | **SI** |
| 35 | Finding card rationale | a paragraph explaining why it matters | absent | **SI** |
| 36 | Finding card remedies | `Remove the edge` · `Keep as history` · `Repoint or clear` | `show me` only. CHANGELOG records this as deliberate, citing §17d's *"navigation and never a remedy"* — **but the frame draws the remedies** | **SA** — see Q3 |
| 37 | Cycle walk line | `#544 → #551 → #560 → #544` | one card shows the walk, another shows a `·`-joined set — inconsistent between cards | **SI** |
| 38 | Panel placement | its own panel | inside the inspector zone, above the inspector | **SA** — see Q3 |

### 3.6 Scale (§17f)

| # | Element | Design target | Implementation | Class |
|---|---|---|---|---|
| 39 | Refusal above budget | refuse and say so | **correct** — *"141 related issues is past this canvas's budget of 60, so it is not drawing them."* | — ok |
| 40 | Search-to-focus | `⌕ focus an issue` | **present** | — ok |
| 41 | Capsule tail | 4 capsules + `+ 5 more · 2–7 issues each` | all 13 drawn | **SI** |
| 42 | Capsule name | identify by **anchor** — `around #488 · Extract session store adapter`; never a generated phrase (`RULINGS.md` §4) | **CLOSED `28a83a5`** — renders `around 315 · Backfill the audit count`, and the anchor is now the **highest-ranked member**. Was one member's bare title, picked by `members.sort()` — the alphabetically first key | ~~SA~~ |
| 43 | `nothing can start` on a cyclic capsule | required | **correct** | — ok |
| 44 | Isolated count chip | `248 isolated · open as list` on the canvas | in the rail footer (`5 with no relationships · show`), not on the canvas | **SI** |
| 45 | Canvas filter chips | `has relationships · held only · problems only · label…` | absent | **SI** |
| 46 | Refusal copy | one sentence with the next move | three sentences, two of them explaining the rail's behaviour rather than offering a move | **SI** |

### 3.7 Canvas projection (§17a / §17f)

| # | Element | Design target | Implementation | Class |
|---|---|---|---|---|
| 47 | What the canvas draws below budget | a **focused neighbourhood** — free-positioned node cards with SVG edges, `focus: #512 · 1 hop · 6 of 312 shown` | §16b's three-column ordered spine, labelled `EXPLAINS THE ORDER` / `THE WORK ORDER ↓` / `NOT WORKED` | **SI** |
| 48 | Graph / List toggle | `⛓ Graph  ☰ List` on the canvas toolbar | absent from the workspace; the demo host offers `neighbourhood` / `tree` in its own chrome instead | **SI** |
| 49 | Focus statement | `focus: #512 · 1 hop · 6 of 312 shown` | `10 of 15 drawn` — the count without the focus or the hop radius | **SI** |
| 50 | Isolated-issues chip on canvas | `248 isolated issues hidden · list them` | absent from the canvas | **SI** |

### 3.8 Together-with

| # | Element | Design target | Implementation | Class |
|---|---|---|---|---|
| 51 | A together unit in the rail | one row, one rank, containing a box; at 390px a `⧉ n` marker inline with the lead's title (`RULINGS.md` §1, `17j`) | **CLOSED `28a83a5`** — 53px, `⧉ 2` marker with the lead's title; the enclosure survives only above 430px. Was a 408px boxed enclosure | ~~SA~~ |
| 52 | Cyan hairline connector | the kit's one amendment: a 1.6px cyan hairline between members, so a together-edge is individually clickable | the enclosure is drawn; no separate connector hit target | **SI** |

---

## 3b. Design answered — and two of my four questions were my own misreading

**Claude Design ruled on all four on 2026-09-20, and added the density pass.** The
authority is `RULINGS.md` on branch `design/issuegraph-rulings-density` (commit
`e6ce0e9`) in `descant-design-kits`, with frames `17i`, `17j`, `17k`. Captures:
[`evidence/2026-09-20/`](./evidence/2026-09-20/).

**Section 4 below is left standing as it was asked, and it is wrong in two places.
Those two are corrected here rather than quietly edited, because the owner
forwarded that section to Design and a question that turned out to be a reading
failure should not be silently converted into a question that was always sound.**

### Q1 was not a contradiction in the frames. I misread the rail's third track.

I wrote *"The frame contradicts itself"* because `#512` showed rank `2` while
`#530` showed `—`. **The rail has three tracks — `30px` rank · `1fr` issue · `auto`
delta — and the `—` I read as `#512`'s rank is its delta chip**, meaning *unchanged
this re-evaluate*. Its rank is `2`, in track one. There was no contradiction to
find.

The rule, which `16a` already drew: **a held issue keeps its rank when its blocker
is inside the previewed order, and loses it when the blocker is outside** — and
when it loses it, the would-be rank prints beside the id. `#512` keeps rank 2
because `#488` is rank 1. `#530` shows `—` and `#530 · would be rank 4`, because
`#602` is *"still open, and not in this order"*.

Same for the together-unit. `16a` rank 2 is **one ranked row** holding
`⧉ ONE UNIT · 2 ISSUES` with `#512` and `#514` inside it. I had extracted `16a`'s
text on the first pass and used it only to prove the tiles matched — I never read
it as the answer to §17's rail, because I had filed it as "the read-only preview,
a different surface".

### Q4b was not an undrawn element. `16a` draws the now strip.

I wrote that the `NOW` block was *"not present"* in any frame and that the
implementation had *"invented"* it. **`16a`'s first row is
`NOW · Fix flaky auth integration test · autnmy/descant-web#499 · Review · 12m ·
working`.** Showing it is correct. Design's ruling is about its *shape*: a raised
first row of the rail, above rank 1, **carrying no rank number** — because run
state appears exactly twice and never earns a rank slot.

### What stands

**Q2, Q3 and Q4a were real.** Design confirmed the audit-filter empty state is a
genuine defect of mine, ruled the audit panel's zone and kept the remedies, and
called the capsule-name catch *"correct — `auth & session` is placeholder copy,
not a field"*. Every measurement in section 3 stands; the re-classed rows are
marked in [section 5c](#5c-what-the-rulings-changed--the-current-work-order).

### The pattern, named because it is the point

Three of my four questions were answered in a kit I had open. Design put it
plainly: *"not a criticism of the calls you made — the reasoning in those code
comments was sound. It is a note that the kit was not being read as the authority
before decisions got made."*

That is the same shape as the defect I documented in the code: **the confirming
evidence was already on screen and was not re-examined, because it had been filed
under the wrong question.** Read the kit as the authority before deciding, and
cite it when you do.

---

## 4. What design must answer

Four questions. Each one blocks a decision an implementer cannot make alone, and
three of them the implementer has already had to guess at — the guesses are in the
code with comments explaining them, which is why they are worth resolving rather
than re-litigating.

### Q1 — Does a held issue keep a rank number, and is a together unit one row or a box?

**The frame contradicts itself and contradicts the prose.** In frame `17a`:

- `#512` is `⊘ blocked` and the rank column shows **`2`**.
- `#530` is `blocked-by #602` and the rank column shows **`—`** with a `→ held` chip.

Both are blocked by an open issue. Both are equally not-ready by the reader rules.
One has a number and one does not. Meanwhile §16d says a graph-derived hold renders
*"inline at would-be rank, dashed station, **rank shows `—`**"*.

The implementation chose `—` for both, and its own source says why
(`packages/editor/src/workspace/inspector.ts`): derive assigns `ready ? rank : null`,
so a held slot has no rank to print, and frame `17a`'s state is *unrepresentable* in
the model. That is a reasonable call. It is still a call design should be making.

The same question decides item 51. `START_HERE.md` says a together-group is "one
rank as a compound station"; frame `17a` draws `#512` as a plain row and mentions
`#514` only in the inspector sentence. The implementation followed the prose and
built a 408px enclosure — **7.7× the frame's row height, the single largest row on
screen.**

**What design needs to say:**
1. Does a held row print its would-be rank as a number, or an em dash? If a number,
   what is it a number *of*, given it is not a position in the ready order?
2. Draw a together unit in the rail at 53px. If it cannot be done at 53px, say what
   the rail shows and where the second member's title goes.
3. Is `→ held` a delta chip (it only appears when readiness *changed*) or a
   permanent state badge? The frame shows it on one held row and not the other,
   which reads like a delta — but then `#512` should have one too.

### Q2 — What does the audit filter do to the rail?

§17a is absolute: the order rail is *"always present, always complete"* and
*"must never refuse or paginate away from an answer"*. §17d says an audit **filter**
exists for focus.

Those two collide, and the implementation lands on the wrong side of it: turn the
filter on and the rail reads **"Nothing is in the order right now"** while eight
issues are ranked. The sentence is false, and it is the one surface the design says
must always be true.

**What design needs to say:** when the filter is on and no flagged issue is in the
order, what does the rail show? Three candidates, and design should pick one:
the full rail with flagged rows marked and others dimmed; the rail filtered but
headed "3 of 312 shown — filtered to audit findings" so the absence is explained;
or the filter refuses to engage and says why. Also: does the filter apply to the
footer group (claimed / parked / duplicate) as well as the ranked rows? Two of the
six findings in the demo are footer rows, which is the only reason any gold bar
appears at all.

### Q3 — Where does the audit live, and does it offer remedies?

Three sub-questions that have to be answered together.

**(a) Which zone?** §17a fixes three zones — rail, canvas, inspector. §17d draws
the findings panel as its own surface with no workspace header around it. So the
panel has no home. The implementation put it in the inspector zone, above the
inspector, which means at six findings the inspector is pushed below the fold — and
the encoding-refused block sits there *permanently*, in red, dominating the right
column before the reader has selected anything.

**(b) Remedies or navigation only?** §17d's prose says the surface *"offers
navigation and never a remedy"* and forbids auto-fix. The frame draws three
remedies: `Remove the edge`, `Keep as history`, `Repoint or clear`. The
implementation shipped `Show the loop` and filed the other three, citing the prose.
The frame and the prose cannot both be followed.

**(c) What does a finding card lead with?** The frame's headline is the specific
fact — *"#533 is blocked by an issue closed 4 months ago"*. The implementation
leads with a generic class sentence and demotes the specifics to line two, so six
findings read as six copies of three sentences.

**What design needs to say:** which zone owns the audit panel and what it does to
the other zones' heights; whether remedies ship; and the card's line order, with an
example of six findings stacked so the repetition is visible.

### Q4 — Two things the running system does that design never described

**(a) A cluster capsule's name.** Frame `17f` names capsules semantically —
`auth & session`, `poller & webhooks`, `replay guards`, `billing surfaces`. Those
names are not derivable from the graph. The implementation substitutes one member
issue's title, which reads as if that issue is the group. Design should say where a
group name comes from: a derivable rule (largest member, the blocking root), an
owner-supplied label, or no name at all and the capsule leads with its counts.

**(b) The `NOW` block, and runner state generally.** The implementation opens the
rail with a cyan `NOW` banner showing the in-flight issue, its status and elapsed
time. Nothing like it is in any frame. §16d is the nearest rule and it points the
other way: runner-derived state goes to a *"collapsed footer group, no rank slot"*,
because *"they aren't facts about the work, so they don't earn one"*. A `NOW` banner
at the top of the rail is the most prominent slot on the surface.

Design should say whether the workspace shows what is running at all, and if so
where. It is a real question — a grooming surface that cannot say "this one is
being worked right now" may be worse — but the answer is design's, and right now
the implementation has answered it unilaterally and put it in the best seat on the
page.

**One more, smaller.** §17b draws the five mutation states as overlays **on a graph
edge**. They are built (`packages/editor/src/overlay/`), and as edge overlays they
are unreachable today because the demo's canvas draws the §16 spine rather than a
graph — that resolves itself when gap 47 does.

But the implementation already had to answer a question design never asked: **what a
pending, failed or conflicted edit looks like in the rail and the inspector**, which
is where a user meets it when no graph is on screen. It answered well — the tests in
[2b](#2b-the-2026-08-22-amendment-already-met) pass — so this is not a gap. It is an
undrawn surface that now has a de-facto design. Design should look at it and either
bless it or draw it, because the 2026-08-22 amendment made failure and conflict
feedback explicitly load-bearing, and right now the only spec for two thirds of it is
the running code.

---

## 5. What a sweep would fix, with files

Everything here is unambiguous: design is clear and the implementation differs.
None of it waits on section 4. Ordered by how much of the owner's complaint each
one removes.

### Tier 1 — the hierarchy. This is most of the complaint.

| Gap | Change | File |
|---|---|---|
| 1, 2, 3 | Collapse the rail row to the frame's four lines: rank · title · one metadata line · delta chip. Every badge after the first folds into that one line or drops. The `↳` provenance lines come off the row entirely — §16f makes provenance `→ expand`, and the inspector already renders it under `WHY RANK n`. Target: **53px, uniform.** | `packages/editor/src/workspace/rail.ts`, `packages/viewer/src/projections/linear.ts` |
| 6 | Remove the legend from both the rail and the canvas zones, or move one copy to a disclosure. Two legends on one screen is 317px spent twice on the same nine symbols. | `packages/viewer/src/styles.ts`, `packages/viewer/src/render.ts` (`.ig-legend`) |
| 8 | Re-proportion the zones toward the frame's 30 / 45 / 25. The rail is currently the narrowest zone and carries the most text. | `packages/editor/src/workspace/styles.ts` (`.ig-workspace` `grid-template-columns`) |
| — | Collapse the demo's own sandbox chrome behind a disclosure so the workspace is above the fold. **This is the demo host's, not the packages'** — but it is what a visitor to the demo actually sees, so it belongs in the same sweep. | `demo/index.html`, `demo/styles.css` |

### Tier 2 — the inspector

| Gap | Change | File |
|---|---|---|
| 12 | Two parts. First, the clause separator: `.ig-why-rank-sentence > * + *` sets `margin-left: var(--ig-space-micro)` = **2px**, narrower than a word space, so clauses collide. Second, and the real fix: the frame's version is punctuated prose with connectives, which no margin can supply. Compose the sentence with its connectives in `WorkspaceWords`. | `packages/editor/src/workspace/styles.ts:665`, `packages/editor/src/workspace/render.ts:1714` (`whyRankSpec`) |
| 14 | Add the `owner/repo#N ↗` deep-link chip to the inspector head. §16f calls it *the only external link* and *one predictable target*; `viewer/src/parts.ts` already has the pieces. | `packages/editor/src/workspace/render.ts` |
| 15 | Render `ADD RELATIONSHIP` standing, not behind `+ add`. | `packages/editor/src/workspace/render.ts` |
| 16 | **Rebind the kind keys to the frame's order**: `1 blocked-by · 2 serialize-with · 3 together-with · 4 duplicate-of · 5 decomposed-from`. Four of five are currently wrong, so anyone trained on the design picks the wrong type. | `packages/editor/src/picker/words.ts`, `packages/editor/src/create/keys.ts` |
| 17 | Use the spec's field names as labels, not prose forms — the user is editing YAML that says `serialize-with`. | `packages/editor/src/picker/words.ts` |
| 18 | `✕` for close. | `packages/editor/src/workspace/render.ts` |

### Tier 3 — the loop and the chrome

| Gap | Change | File |
|---|---|---|
| 25, 26, 27 | Give the change summary its first line — the cause and the total: *"You added `#488 blocks #512` — 3 rows moved"* — with the breakdown beneath and an `undo` beside `dismiss`. Cause-in-the-summary is §17c's stated whole point. | `packages/editor/src/reevaluate/words.ts`, `packages/editor/src/reevaluate/render.ts` |
| 29 | Emit `▲n` / `▼n` rank-delta chips, not only the categorical ones. | `packages/editor/src/reevaluate/parts.ts` |
| 4, 5 | Rail heading `WORK ORDER`; add the `filter` control §17a requires. (The count chips can stay — they are better than the frame's bare `312`.) | `packages/editor/src/workspace/rail.ts` |
| 10 | Put a space between the freshness stamp and `refresh`. Currently renders `59s agorefresh`. | `packages/editor/src/workspace/styles.ts` |
| 9, 30 | `◆` glyph on the audit count; word it `N encoding problems`. | `packages/editor/src/audit/surface.ts` |
| 32 | Make `aria-pressed` track the audit toggle. | `packages/editor/src/audit/surface.ts` |
| 11 | Take solid cyan off the `NOW` badge and the count chips; leave it to `First pass →` and the active toggle. | `packages/editor/src/workspace/styles.ts` |
| 21 | Add the `⇅ flip` control beside the direction sentence. | `packages/editor/src/picker/render.ts` |
| 24c | Add `view diff` to the conflict controls in the writes strip; the inspector already has it. | `packages/editor/src/overlay/render.ts` |
| 34, 35, 37 | Finding cards lead with the specific fact; add the rationale paragraph; draw the cycle as a walk on every card, not a set on some. | `packages/editor/src/audit/panel.ts` |
| 41, 44, 45, 49 | Collapse the capsule tail to `+ n more`; move the isolated chip onto the canvas; add the canvas filter chips; state `focus: #N · 1 hop · n of m shown`. | `packages/editor/src/scale/render.ts` |
| 47, 48 | The larger one: the canvas draws §16's three-column spine where §17a wants a focused neighbourhood with a `Graph / List` toggle. This is a projection change, not a restyle — size it before scheduling it. | `packages/viewer/src/projections/graph.ts`, `packages/editor/src/workspace/render.ts` |

---

## 5c. What the rulings changed — the current work order

**Status 2026-09-20: the hold is lifted. Design answered all four and added the
density pass.** Section 5b below is superseded and kept as the record of what was
blocked. The authority for every row here is `RULINGS.md`, cited per item.

### Held rank — the shape of the one ruling still unbuilt

I said in an earlier report that this was blocked on a question about `16a`'s own
figures: the tile shows `#503` at rank **4** and `#530` as *"would be rank 4"*,
which read as two rows claiming one position. **It is not a collision and there
is no question to ask.** A would-be rank is the position the slot *would take*
if it became ready — `#530` is P1, and arriving among the P1s it would land at 4
and push `#503` to 5. Self-consistent, and I misread it. Recorded because I
raised it as a blocker and it is not one.

What remains is genuinely larger than the sweeps above, and it is not a
rendering change:

1. **A held slot must sometimes carry a real rank.** `RULINGS.md` §1 keeps
   `#512` at rank 2 because its blocker `#488` is rank 1 — *inside* the previewed
   order. `@issuegraph/derive` assigns `ready ? (rank += 1) : null`, so the
   number does not exist to render. Producing it means ranking held-but-locally-
   blocked slots, which is a change to a published package whose ordering is
   SPEC-governed.
2. **A would-be rank for the other case.** When the blocker is *outside* the
   order, the slot shows `—` plus `would be rank N` beside the id — a second,
   different number the host must also compute.
3. Only then is there anything for the viewer to draw, behind a new optional
   field on `ViewerSlot`.

So it is one ruling and three changes, the first two in the host's derivation.
Sized here rather than started, because folding a derive-semantics change into a
presentation sweep is how the two get reviewed as one thing.

### Re-classed — these were not gaps in the implementation

| # | Was | Now | Authority |
|---|---|---|---|
| 7 | `MS` — "the `NOW` block is in no frame" | **not a gap.** Showing it is correct; `16a` draws it. The real defect is narrower: it must be a raised **first row of the rail carrying no rank number**, not a cyan banner | `RULINGS.md` §4, `16a` |
| 13 | `SA` — heading when held | **not a gap.** A held row keeps `WHY RANK n` when its blocker is inside the order; `WHY HELD` is right only in the rankless case | `RULINGS.md` §1 |
| 51 | `SA` — together unit, row or box | **resolved: one row, one rank.** The implementation's shape is right; its **408px height** is the defect. At `390px` the unit is a `⧉ 2` marker inline with the title | `RULINGS.md` §1, `17j` |
| 42 | `SA` — capsule name | **confirmed a real gap** — the only one of the four. Identify by **anchor**: `around #488 · Extract session store adapter`. Never a generated phrase | `RULINGS.md` §4 |
| 33 | `SA` — audit filter empties the rail | **confirmed my defect.** No collision in the spec: the filter hides rows, never the order | `RULINGS.md` §2 |
| 19, 38 | `SA` — audit panel's zone | **decided: not a fourth zone.** A transient `520px` overlay anchored to the header count, over the **canvas**, Escape to dismiss, never over the rail | `RULINGS.md` §3 |
| 36 | `SA` — remedies or navigation only | **remedies are required**; only auto-fix is forbidden. Keep all three | `RULINGS.md` §3 |
| 1, 2, 3 | `SI` — rail row density | **unchanged, and now fully specified** — see the row contract | `RULINGS.md`, `17j` |

### The row contract — `17j`, and the whole of Tier 1

```
390px rail · 53px row · identical at 6, 60 and 312 issues
tracks:  30px rank+dot  ·  1fr issue  ·  auto delta
height:  9 pad + 17 title + 3 gap + 15 meta + 9 pad = 53px, divider inclusive
line 1:  title, 17px, truncates, never wraps
line 2:  mono meta, 15px — #512 · P0 · ⊘ #488
```

**Provenance never renders inline in the rail.** It is expand-on-demand here, and
inline only in `16a`'s wider panel. *"Same row, two densities."*

**Drop order** as the `1fr` track narrows — §18's settings rail is `330px`, so
steps 1–3 apply there by default:

1. evidence / verification chips (`✓ verified`)
2. relationship badges past the first → `+n`; the first is the one causing the hold
3. the priority token `P0` — but a promotion `P3 → 0` **stays**, it is not
   recoverable from the rank
4. the delta chip's *number* (`▲5` → `▲`); the slot never collapses
5. the title truncates — always last, never dropped

**Never dropped at any width:** rank number · readiness dot · issue number · hold
glyph (`⊘ ⇄ ⧉ ≡ ⑃`) · gold audit left-bar. *The glyph is one of the four redundant
channels the colour-blind-safety claim rests on.*

### Placement — `17k`

> **The rail never yields. The canvas yields first. The inspector yields in between.**

| Width | Layout |
|---|---|
| ≥ 1360 | `390 / 1fr / 330` |
| 1120–1359 | rail unchanged; inspector becomes a `330` overlay over the canvas |
| < 1120 | rail unchanged; canvas collapses to a strip; inspector returns inline |

**The one implementation consequence:** the same row renders at `390` in the
workspace and `330` in §18's settings rail, so **it must take its width from its
container** — not a viewport media query, not a host prop. A package that reads the
window cannot be dropped into someone else's settings page, which is the whole
BYO-Theme / BYO-DataSource premise.

### The finding to carry

> At 6, 60 and 312 issues **the rail is identical**. What changes is *around* it —
> virtualisation appears, the runner-hold footer grows, filter chips stop being
> optional, the canvas starts refusing. *"If you are making the rail denser as the
> backlog grows, you are compressing the surface that was never the problem."*

---

## 5b. Which of those waited on Design *(superseded by 5c; kept as the record)*

**Status 2026-09-19: the owner has taken section 4's questions to Design and the
sweep is on hold until they answer.** That is the right call and it is what this
document was for. This section exists so the sweep can be *ordered* the moment the
answers land, instead of re-read from the top.

Of the ~40 actionable items in section 5, **eleven are at risk** from one of the four
questions and the rest are not. A question's answer can only move the items under it.

| Question | Items it can move | Why |
|---|---|---|
| **Q1** — held rank, together-unit row | **1, 2, 51, 52**, and the heading in **13** | These *are* the rail row shape. Do not touch row geometry until Q1 lands, or the row gets rebuilt twice. |
| **Q2** — the audit filter's effect on the rail | **33**, and the control in **5** | If Design says the filter refuses to engage rather than emptying the rail, the control itself changes. |
| **Q3** — audit zone, remedies, card line order | **19, 34, 35, 36, 38**, and possibly **8** | Q3 decides whether the audit keeps a share of the inspector zone, which is an input to the zone proportions. |
| **Q4** — capsule name, the `NOW` block | **7, 42** | Both are elements Design has not ruled on at all; one may be deleted outright. |

**Everything else can be swept on Design's existing frames, today, with no risk of
rework.** That includes the whole of Tier 2 except the `WHY HELD` heading, and all of
Tier 3 except the audit-card items. Named, so nobody has to re-derive it:

> **3** provenance off the rail row · **4** `WORK ORDER` heading · **6** the doubled
> legend · **9** header counts · **10** the missing space before `refresh` · **11** the
> solid-cyan budget · **12** the `WHY RANK` sentence · **14** the deep-link chip ·
> **15** standing `ADD RELATIONSHIP` · **16** the key numbers · **17** the field-name
> labels · **18** `✕` · **21** `⇅ flip` · **24c** `view diff` in the writes strip ·
> **25–28** the change summary's cause, total and `undo` · **29** `▲n`/`▼n` chips ·
> **30** the `◆` glyph · **32** `aria-pressed` · **37** the cycle walk · **39–41**,
> **44–46** the scale surface · **47–50** the canvas projection.

Two of those deserve a flag even inside the safe set. **16** — the kind key numbers —
is the one item here that actively trains the wrong reflex every day it ships, and it
is a four-line change. **12** is two lines of CSS plus a words change, and it is the
single most visible defect in the product: two clauses colliding mid-word in the
inspector's headline sentence.

**47** is the one item in the safe set that is a build rather than a fix — the canvas
draws §16's column spine where §17a wants a focused neighbourhood. Size it separately
from the sweep.

---

## 6. Recommendation

> **Decided 2026-09-19, after this was written.** The owner took section 4's
> questions to Claude Design and put the sweep on hold until they answer. The
> recommendation below is left as written, because its reasoning is still the input
> to what gets ordered when the answers land — and because a recommendation edited
> to agree with the decision that followed it is worth nothing to the next reader.
> [Section 5c](#5c-what-the-rulings-changed--the-current-work-order) says which items
> the hold actually binds: eleven of about forty.

**Order the sweep now. Send design the four questions in parallel. Do not wait on
design to start.**

Reasons, in order.

**The complaint is mostly Tier 1, and Tier 1 needs nothing from design.** Row
height, the doubled legend, zone proportions and the demo's chrome are four changes
against a frame that is already unambiguous. They are the difference between three
visible rows and sixteen. Nothing in section 4 touches them, and a second kit
revision will not change a 53px row.

**The gaps are not missing features.** Almost everything design asked for exists in
the source — the five mutation states, the gold audit bar (correct to the hex), the
scale refusal, search-to-focus, the direction sentence, `WHY RANK n`. The team built
the parts and lost the hierarchy. That is a sweep, not a rebuild, and it is why more
design detail on *what* to build would not have helped: design's error, where it
made one, was not under-specifying the parts.

**Section 2b is the strongest evidence for that.** The 2026-08-22 amendment's
contracts — BYO-Theme, BYO-DataSource, a demo that runs with no backend, a failed
write that is marked and never silently reverted, a conflict that never auto-merges,
an order that does not move on an unlanded edit — are the expensive, structural,
easy-to-fake half of this build, and all of them hold under test. Nobody should
re-open the architecture on the strength of how the rail looks.

**But the four questions are real, and three have already been answered
unilaterally.** The held-rank rule, the together-unit row, the audit's zone, the
`NOW` block — an implementer hit each one, found the frame and the prose disagreeing,
picked one, and wrote a paragraph in the source explaining the choice. Those
paragraphs are good engineering and bad process: the product now has four design
decisions made by whoever was nearest. They should go back to design, and they
should go now, because Q1 and Q3 change the rail row and the right-hand column —
exactly what Tier 1 is about to touch.

**So: sweep Tier 1 and 2 immediately; hold Q1's row shape and Q3's audit placement
open, and land them in a second, much smaller pass when design answers.** Tier 3 can
ride either. Gap 47 — the canvas projection — should be sized separately; it is the
one item in this document that is a build rather than a fix.

**What would most help from design, in one line:** not more parts, but a **density
and placement pass** — the frames drawn at three backlog sizes (6 rows, 60, 312)
with the row shape held to 53px, so the implementation can see what design expects
to give up when the content does not fit. Every gap in section 3.1 is a place where
the implementation had content design's frame never showed it, and chose to show all
of it.

---

*Measured by side-issuegraph-ux-1 against `viewer@0.8.2` / `editor@0.21.0` and the
`descant-design-kits` kit including its 2026-08-22 amendment. Screenshots:
[`evidence/2026-09-19/`](./evidence/2026-09-19/). No implementation change was made.*
