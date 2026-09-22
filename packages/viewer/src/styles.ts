/**
 * The structural stylesheet.
 *
 * It carries layout, weight and state — never a value. Every colour, size and
 * spacing here is a `var(--ig-…)` reference resolved by whatever theme the host
 * installs, which is what makes "supply a second theme through custom
 * properties" a real capability rather than a claim. `styles.test.ts` scans
 * this string for a literal colour or a fixed pixel length and fails on either,
 * so the rule is enforced against the bytes rather than remembered.
 *
 * Shipped as a string, not a `.css` file: an entry that imports CSS cannot be
 * loaded by a bare Node runtime (`ERR_UNKNOWN_FILE_EXTENSION`), and this
 * package's floor is checked by a smoke test that imports the built entry. A
 * string also means no consumer needs a bundler to use it.
 *
 * THE VIEWER DRAWS THE PANEL, and that is a decision this file records rather
 * than a detail. §16a is one bordered surface with a header bar, hairline-
 * separated rows and a footer group on a second ground; §9097's done-when read
 * "§16 IS that test — the viewer with no editor attached", so the thing a host
 * mounts with no chrome of its own has to BE the frame. Rows therefore carry no
 * border and no radius of their own — they are separated by the panel's own
 * hairlines — and a host that wants the panel suppressed overrides the four
 * properties on `.ig-viewer`.
 */

/**
 * §17j's rail density, written once and emitted under two keys.
 *
 * ## Why this is a function and not a block
 *
 * The density has to be reachable two ways — by the container's width, which is
 * §17j's own rule, and by a consumer who disagrees with the crossover this
 * package picked. CSS cannot express "this condition OR that selector" across
 * an `@container` boundary: a rule inside the query cannot also be a rule
 * outside it, so the declarations would have to be written twice. The
 * stylesheet is already a template literal, so they are written once here and
 * interpolated twice instead.
 *
 * `scope` is a selector the whole block hangs off, and every rule below is
 * RELATIVE to it. The original block carried its own `.ig-viewer` prefixes on
 * about half its rules; those are gone, because the scope supplies one and two
 * would never match.
 *
 * ## What it does to specificity, which is a gain rather than a risk
 *
 * Every selector here gains the scope's two compound units, so each dense rule
 * beats the base rule it overrides by SPECIFICITY rather than by source order.
 * One of these already had to be hand-scoped for exactly that reason — the
 * together-unit row, where a container query adds no specificity and the base
 * rule further down the file won, leaving the unit row drawn with nothing in
 * it. That hazard is now closed for the whole block rather than at one site.
 */
function railDensity(scope: string): string {
  return `
${scope} .ig-slot {
  align-items: center;
  grid-template-columns: var(--ig-rank-column-dense) 1fr auto;
  min-height: var(--ig-row-height-dense);
  padding-block: var(--ig-row-padding-block-dense);
}

/* TWO LINES, AND NEITHER WRAPS. A wrapping title is what turns a 53px row
   into a 106px one, so the truncation is not cosmetic — it is what makes the
   height a property of the row rather than of its longest title. */
${scope} .ig-slot .ig-row-head {
  gap: 0;
}

${scope} .ig-slot .ig-title {
  line-height: var(--ig-row-title-line);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* STEP 5 OF THE DROP ORDER, AND IT IS LAST FOR A REASON '17j' STATES:
   *"A row without a title is not a row."* Everything above leaves first. */
${scope} .ig-slot .ig-row-body {
  gap: var(--ig-row-line-gap);
  min-width: 0;
}

/* LINE 2, AND IT DOES NOT WRAP. '17j' draws it as one mono run —
   '#512 . P0 . blocked-by #488' — so the chips sit ON the identity's line
   rather than under it. 'nowrap' is what makes the 53px a property of the
   ROW: one long title or one extra badge would otherwise buy a second line
   and double the height, which is exactly how this rail reached 408px. */
${scope} .ig-slot .ig-row-meta {
  align-items: center;
  display: flex;
  flex-wrap: nowrap;
  gap: var(--ig-space-tight);
  line-height: var(--ig-row-meta-line);
  min-width: 0;
  overflow: hidden;
}

/* The chips keep their own row semantics and stop wrapping, so what does not
   fit is clipped rather than stacked. The drop order above decides WHICH
   chips are there to clip; this only decides they stay on the line. */
${scope} .ig-slot .ig-row-meta .ig-badges {
  flex-wrap: nowrap;
  min-width: 0;
}

/* The issue number never shrinks away — '17j' lists it among the five things
   never dropped at any width. The title truncates first and the chips clip;
   the number holds its ground. */
${scope} .ig-slot .ig-row-meta .ig-id {
  flex: none;
}

/* AT RAIL DENSITY LINE 2 IS TEXT, NOT PILLS — and this is read off the frame
   rather than inferred from the height. '17j' draws the meta line as a single
   mono run, '#512 . P0 . blocked-by #488': no outlines, no fills, just the
   glyph and the words. §16a's wider panel is where they are chips.

   IT IS ALSO WHAT MAKES 53px REACHABLE. A bordered chip is its padding plus
   its stroke plus its line box, so a line of them cannot be 15px however the
   line-height is set — the flex row grows to its tallest item and the row
   followed it to 74px. Removing the chrome removes the reason.

   THE FOUR REDUNDANT CHANNELS SURVIVE THIS, which is the thing worth
   checking before doing it: dash, terminal and glyph are untouched, and hue
   moves from the border to the text it was outlining. '17j' names the hold
   GLYPH among the five things never dropped, and it is still drawn. */
${scope} .ig-slot .ig-row-meta .ig-badge {
  background: none;
  border: 0;
  border-radius: 0;
  padding: 0;
  /* AND THE TEXT INSIDE A CHIP DOES NOT WRAP EITHER. Stopping the ROW from
     wrapping is not enough: a chip squeezed by its neighbours wraps its own
     label instead, and 'signals disagree' at 84px became two 15px lines and
     took the row to 67px while every sibling sat at 53. One row in seven,
     which is exactly the kind of thing that survives a review and does not
     survive a measurement. What does not fit is clipped, per the drop
     order. */
  white-space: nowrap;
}

/* AND THE SWAP, AT RAIL DENSITY. '17j' draws a together unit here as a
   marker inline with an ordinary title at the ordinary 53px, so the head
   comes back and the enclosure stands down. One row, one rank, in both
   densities - RULINGS.md section 1 - drawn the way each width can afford. */
/* SCOPED WITH '.ig-viewer' SO ORDER CANNOT DECIDE THIS. A container query
   adds no specificity, so this rule and the wide-density one it overrides
   were an even 0,3,0 and the LATER of the two won — which put the base rule,
   written further down the file, in charge of both densities and left the
   unit row showing nothing but its em dash. Measured, not spotted: every row
   was 53px and one of them was empty. The extra class makes the override win
   on specificity, where it does not depend on where anyone adds a rule
   later. */
${scope} .ig-slot[data-unit='true'] > .ig-row-body > .ig-row-head {
  display: flex;
}

${scope} .ig-slot[data-unit='true'] .ig-unit-mark,
${scope} .ig-slot[data-unit='true'] .ig-unit {
  display: none;
}

/* The marker itself: the glyph and the count, on the title's line. It is a
   COUNT and not a pill here because 53px has no room for one, and because
   the pill's words are already the accessible name's. */
${scope} .ig-unit-count {
  color: var(--ig-edge-together-with);
  display: inline;
  font-family: var(--ig-font-mono);
  margin-right: var(--ig-space-tight);
}

/* THE FOOTER ROWS TOO, AND THIS IS THE POPULATION THE ROW FIX MISSED.
   A footer entry is deliberately ONE LINE and shorter than a ranked row -
   16a gives it no rank, no station and no explanation block, because it is
   not a fact about the work. That part was right. What was not governed is
   its TITLE: it wrapped, and the excluded row carrying a canonical reference
   ran to 73px while its siblings sat at 36. A footer row taller than a
   ranked row inverts the whole point of the group.

   THE DEFECT IS THE ONE ALREADY FIXED ON .ig-slot, ONE ROW KIND OVER: a
   title with nothing stopping it wrapping takes the row with it. Fixed at
   the class this time rather than at the site - the rail renders three row
   kinds and the first pass governed two. */
${scope} .ig-footer-row .ig-title {
  line-height: var(--ig-row-title-line);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

${scope} .ig-footer-row .ig-badges {
  flex-wrap: nowrap;
  min-width: 0;
  overflow: hidden;
}

/* AND THE CHIPS LOSE THEIR CHROME HERE TOO, which is what actually makes a
   footer entry ONE LINE. 16a draws it as "a label chip, a title and an
   identity, on one line"; a bordered chip is padding plus stroke plus line
   box, so a row carrying any relationship badge stood at 36px against 22px
   for one carrying none - and the badge block, not the title, was the last
   thing driving it.

   MEASURED IN TWO PASSES, WHICH IS THE POINT. Stopping after the title fix
   left the footer group at two heights and looked finished: the row that had
   been 73px was down to 36 and matched its siblings, so the obvious check
   passed. It was the SECOND measurement - why 22 and why 36 - that found the
   badges. A class is not fixed until nothing in it varies for a reason you
   have not named. */
${scope} .ig-footer-row .ig-badge {
  background: none;
  border: 0;
  border-radius: 0;
  padding: 0;
  white-space: nowrap;
}

/* THE THIRD AND LAST MEMBER OF THE CLASS: the identity. An excluded row
   carries TWO - its own, and the canonical it defers to ('455 -> 512') - and
   the second wrapped, which is why that row alone stood at 30px when the
   others reached 17. Same defect as the title and the chips, third element,
   found by asking the same question a third time rather than by stopping at
   the first uniform-looking answer. */
${scope} .ig-footer-row .ig-id {
  white-space: nowrap;
}

/* THE NOW STRIP AT RAIL DENSITY. '17j' draws it as the first row of the rail
   at all three backlog sizes, in the same rhythm as the rows beneath it -
   RULINGS.md section 4: "a single now strip as the first row of the rail,
   above rank 1, on a raised surface, carrying no rank number".

   THE RANK SLOT IS ALREADY RIGHT AND IS NOT TOUCHED HERE: the strip carries a
   'now' mark where a rank would be, never a number, which is the half of
   section 4 the build already had. What was wrong was only its height. */
${scope} .ig-now-row {
  min-height: var(--ig-row-height-dense);
  padding-block: var(--ig-row-padding-block-dense);
}

${scope} .ig-now-row .ig-row-head {
  gap: 0;
  min-width: 0;
}

${scope} .ig-now-row .ig-title {
  line-height: var(--ig-row-title-line);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

${scope} .ig-now-row .ig-id {
  line-height: var(--ig-row-meta-line);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* HIDDEN HERE, AND NOT YET EXPANDABLE — WHICH IS HALF OF WHAT 17j ASKS FOR.
   The tile says: "The provenance line never renders inline here. In the rail
   it is expand-on-demand; in 16a's wider panel it is inline. Same row, two
   densities."

   THE INLINE HALF IS DONE AND THE ON-DEMAND HALF IS NOT. There is no
   row-level expand affordance at this density — 16f's right-arrow "expand
   provenance" does not exist — so a rail reader reaches the explanation
   through the inspector's WHY RANK block rather than through the row. The
   information is one selection away, not lost, but this comment previously
   claimed "expand-on-demand" and that was an overclaim about a control
   nothing draws.

   The markup stays whole so the wider container still renders it inline and
   so the accessible name is unchanged; what the rail declines is spending
   53px of every row on it. The missing affordance is filed, not forgotten. */
${scope} .ig-slot .ig-provenance,
${scope} .ig-slot .ig-hold,
${scope} .ig-slot .ig-caveat {
  display: none;
}

/* AND THE ON-DEMAND HALF, WHICH IS WHAT 17j ACTUALLY ASKED FOR. A row the
   reader opened with 16f's right-arrow draws its provenance again.

   THE 53px IS NOT BROKEN BY THIS, it is spent deliberately: an open row is
   taller because the reader asked it to be, and closing it returns the row to
   the rhythm. That is the difference between a row that grows because nothing
   governs it - the defect this sweep removed - and one that grows because
   somebody pressed a key.

   ONLY THE PROVENANCE COMES BACK. Holds and caveats stay down: 17j names the
   provenance line and nothing else, and the holds are already in the
   inspector's WHY RANK block as controls rather than prose. */
${scope} .ig-slot[aria-expanded='true'] {
  min-height: var(--ig-row-height-dense);
}

${scope} .ig-slot[aria-expanded='true'] .ig-provenance {
  display: block;
}
`;
}

export const viewerStylesheet = `
.ig-viewer {
  background: var(--ig-bg);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius-large);
  color: var(--ig-text-body);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  line-height: var(--ig-line-height);
  overflow: hidden;
  position: relative;
}

/* THE FRAME IS THE STANDALONE CASE'S, AND A CONTAINER CAN DECLINE IT.
   Alone in a host's page the viewer is a card and draws its own edge. Composed
   into a surface that already rules its own zones off, that edge lands beside
   the container's and the seam reads as a doubled hairline — so the container
   passes frame: false and takes responsibility for every line on the
   surface. See SceneOptions.frame for why this is an option rather than a
   host stylesheet unsetting the properties above. */
.ig-viewer[data-frame='none'] {
  border: 0;
  border-radius: 0;
}

/* THE LEGEND DOCKS AGAINST THE CONTAINER'S SCROLLPORT, NOT THIS ROOT'S.
   See SceneOptions.dockLegend for why only a container can ask for this.

   THE overflow LINE IS THE WHOLE MECHANISM AND LOOKS LIKE A TIDY-UP. A sticky
   element positions against its nearest SCROLLPORT, and an ancestor with
   overflow: hidden is one — so with the root left as it is above, the legend
   sticks to a box that never scrolls, which is the box it already sat at the
   bottom of. Nothing moves, nothing errors, and the declaration below reads as
   though it works. Lifting the clip hands the legend the container's scroller
   instead, which is the only one that scrolls.

   WHICH IS ALSO WHY THIS IS SAFE ONLY WITH THE FRAME DECLINED. The clip exists
   so a drawn radius cuts its own corners; a root that has stopped clipping must
   not be drawing one. The rule above and this one are written to be passed
   together, and the workspace passes both.

   NO z-index, DELIBERATELY. The legend is the root's last child, so it already
   paints over the order it overlaps; a layer number here would be a claim about
   a stacking order this package does not own. */
.ig-viewer[data-legend='docked'] {
  overflow: visible;
}

/* bottom: 0 IS A DEFAULT THE CONTAINER OVERRIDES, not a fixed position. A
   container with something of its own already pinned to that edge — the
   grooming workspace's rail footer — sets this element's bottom to clear it,
   from a height it measures rather than from a number either package wrote
   down and both would have to keep true. */
.ig-viewer[data-legend='docked'] > .ig-legend {
  position: sticky;
  bottom: 0;
}

.ig-viewer *,
.ig-viewer *::before,
.ig-viewer *::after {
  box-sizing: border-box;
}

.ig-viewer :focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: calc(var(--ig-focus-ring) * -1);
}

/* THE ROW'S DENSITY IS READ FROM THIS BOX, AND THAT IS §17j's CLOSING RULE
   RATHER THAN A PREFERENCE. The same row renders at 390px in the workspace
   rail and at 330px in §18's settings rail, so it *"must take its width from
   its container and pick its drop step from that — not from a viewport media
   query, and not from a prop the host sets. A package that reads the window
   cannot be dropped into someone else's settings page, which is the whole BYO
   premise."*

   A viewport query would have been the obvious reach and it is precisely
   wrong: it answers a question about the WINDOW when the row's question is
   about the COLUMN it was given. Two rails of different widths on one screen
   is not an edge case here — §17a's rail and §18's settings rail are that
   screen.

   "NOT FROM A PROP THE HOST SETS" IS ABOUT THE DEFAULT, AND data-density DOES
   NOT BREAK IT. What §17j refuses is a package that CANNOT work out its own
   density — one that draws a wrong row until a host wires something up, which
   is how a drop-in stops being a drop-in. This box still answers that question
   on its own and nothing has to be passed for it to be right. What the
   attribute adds is the ability to DISAGREE, which is a different thing: the
   crossover this package picked is a default, the host is the only party that
   knows about print, a user preference or its own breakpoints, and an override
   nobody uses costs the drop-in case nothing. See the crossover comment below
   for why the number needs no ruling once it is a default. */
.ig-list {
  container-name: ig-rail;
  container-type: inline-size;
  list-style: none;
  margin: 0;
  padding: 0;
}

/* ── the panel header ──────────────────────────────────────────────────── */

/* Present only when the host stated a fact; a document with none draws no
   header at all, which is what keeps the pure-graph markup unchanged. */
.ig-header {
  background: var(--ig-surface-2);
  border-bottom: var(--ig-stroke) solid var(--ig-line);
  display: flex;
  flex-direction: column;
  gap: var(--ig-space);
  margin: 0;
  padding: var(--ig-space-loose) var(--ig-space-wide);
}

.ig-header-lead {
  align-items: center;
  display: inline-flex;
  gap: var(--ig-space-snug);
}

/* The segmented projection toggle §16a and §16b both draw. One rounded outline
   around two buttons, the pressed one filled with the accent. */
.ig-toggle {
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  display: inline-flex;
  overflow: hidden;
}

.ig-toggle-option {
  align-items: center;
  background: none;
  border: 0;
  color: var(--ig-text-body);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: var(--ig-font-size-small);
  gap: var(--ig-space-tight);
  padding: var(--ig-space-micro) var(--ig-space-snug);
}

.ig-toggle-option[aria-pressed='true'] {
  background: var(--ig-accent);
  color: var(--ig-bg);
  font-weight: var(--ig-weight-strong);
}

.ig-header-top {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space);
  justify-content: space-between;
}

/* The panel's own name, at the tracking the frame gives a frame-level label. */
.ig-header-label {
  color: var(--ig-accent);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-small);
  letter-spacing: var(--ig-tracking-label);
  text-transform: uppercase;
}

/* THE COUNTS ARE CHIPS, NOT A SENTENCE. The frame gives each tally its own
   outline and tints only the one a reader acts on — "how many could run right
   now, against the cap" — so the accent is spent once instead of on a whole
   line of muted prose. */
.ig-counts {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space-snug);
  margin: 0;
}

.ig-count-chip {
  background: var(--ig-bg);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  color: var(--ig-text-body);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-small);
  font-variant-numeric: tabular-nums;
  padding: var(--ig-space-micro) var(--ig-space-snug);
}

.ig-count-chip[data-count='ready'] {
  background: color-mix(in srgb, var(--ig-accent) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-accent) var(--ig-tint-border), transparent);
  color: var(--ig-text);
}

.ig-freshness {
  align-items: center;
  color: var(--ig-text-muted);
  display: inline-flex;
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-small);
  font-variant-numeric: tabular-nums;
  gap: var(--ig-space-tight);
  margin: 0;
}

/* STALE GOES GOLD, as the design draws it. The gold this palette already holds
   is the conflict state's — "the document moved upstream" — and a stale mirror
   is that fact about the whole document, so the state hue is reused rather
   than a token added for one word. No new token: the theme's token list is
   the contract every host theme has to fill. */
.ig-freshness[data-stale='true'] {
  color: var(--ig-state-conflict);
}

/* A control the viewer publishes and does not wire: the UA button reset, so it
   reads as the inline control the frame draws beside the stamp. */
.ig-refresh,
.ig-size {
  background: none;
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  color: var(--ig-text);
  cursor: pointer;
  font: inherit;
  padding: var(--ig-space-micro) var(--ig-space-snug);
}

.ig-refresh:hover,
.ig-size:hover {
  border-color: var(--ig-accent);
  color: var(--ig-accent);
}

/* ── the panel-level notice ────────────────────────────────────────────── */

/* WHAT THE HOST SAYS IS TRUE OF THE WHOLE PANEL, drawn between the NOW row and
   the order it qualifies. Its own surface, so it reads as a statement about the
   panel rather than as a row that lost its rank. */
.ig-notice {
  align-items: flex-start;
  background: var(--ig-surface-2);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  display: flex;
  gap: var(--ig-space-snug);
  justify-content: space-between;
  padding: var(--ig-space-snug) var(--ig-space-loose);
}

.ig-notice-text {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-micro);
}

.ig-notice-head {
  align-items: center;
  color: var(--ig-text);
  display: flex;
  gap: var(--ig-space-tight);
  margin: 0;
}

.ig-notice-body {
  color: var(--ig-text-body);
  margin: 0;
}

/* A COUNT, SO IT SITS ON THE FIGURE FACE. A progress figure is read as a number,
   and the proportional face makes its digits wander the way a rank column's do. */
.ig-notice-progress {
  color: var(--ig-text-muted);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-small);
  font-variant-numeric: tabular-nums;
  margin: 0;
}

/* THE SAME CONTROL RESET THE REFRESH BUTTON TAKES, and for the same reason: it
   is published and not wired, so it must look like the inline control the frame
   draws rather than like a UA button. The anchor arm gets it too — a host that
   routes instead of acting should not get a different-looking affordance. */
.ig-notice-action {
  background: none;
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  color: var(--ig-text);
  cursor: pointer;
  font: inherit;
  padding: var(--ig-space-micro) var(--ig-space-snug);
  text-decoration: none;
  white-space: nowrap;
}

.ig-notice-action:hover {
  border-color: var(--ig-accent);
  color: var(--ig-accent);
}

/* GOLD ON FIRST IMPORT, and gold is the conflict state's hue — the same reuse
   the stale stamp already makes, for the same reason: the token list is the
   contract every host theme has to fill, so a token added for one state is a
   theme every host has to revisit.

   AND NOTHING FOR THE ERROR ARM. The design makes exactly one panel-level outline
   claim, and it is this one; an error is drawn calm on purpose, because its own
   sentence is that settings are safe and the pipeline is still running. A
   failure-hued outline around the whole panel would say the opposite. */
.ig-viewer[data-ig-condition='importing'] {
  outline: var(--ig-stroke) solid var(--ig-state-conflict);
  outline-offset: var(--ig-space-micro);
}

.ig-notice[data-ig-condition='importing'] .ig-notice-head {
  color: var(--ig-state-conflict);
}

.ig-notice[data-ig-condition='error'] .ig-notice-head {
  color: var(--ig-state-failed);
}

/* ── the adoption line ─────────────────────────────────────────────────── */

/* ONE QUIET LINE, which is the whole of what the design asks for here: the
   day-one panel has to read complete and calm, and a block explaining what the
   reader is missing is the opposite of calm. */
.ig-adoption {
  align-items: center;
  color: var(--ig-text-muted);
  display: flex;
  font-size: var(--ig-font-size-small);
  gap: var(--ig-space-tight);
  margin: 0;
}

/* THE SENTENCE IS NOT THE LINK. Underlining the whole line made the quietest
   element on the panel its loudest; the link is a short label beside it. */
.ig-adoption-text {
  color: var(--ig-text-muted);
}

.ig-adoption-link {
  color: var(--ig-text-muted);
  margin-left: auto;
  text-decoration: underline;
  white-space: nowrap;
}

.ig-adoption-link:hover {
  color: var(--ig-accent);
}

/* PUBLISHED, NOT PERFORMED. The viewer never removes its own line; the host
   re-renders without the note. */
.ig-adoption-dismiss {
  background: none;
  border: 0;
  color: var(--ig-text-muted);
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-decoration: underline;
}

.ig-adoption-dismiss:hover {
  color: var(--ig-accent);
}

/* ── working now ───────────────────────────────────────────────────────── */

.ig-now {
  /* THE NOW STRIP IS PART OF THE RAIL'S RHYTHM, so it reads the same container
     the rows do. It is its own list element, so without this the density rules
     scoped to 'ig-rail' simply did not reach it and the strip stood 83px tall
     beside 53px rows - 57% taller than everything under it, in the one slot
     17j gives the top of the rail. */
  container-name: ig-rail;
  container-type: inline-size;
  list-style: none;
  margin: 0;
  padding: 0;
}

/* A BAND, NOT A CARD. The frame runs it full-bleed across the panel with a
   wash and an accent rail down its leading edge — the same treatment the shell
   gives anything in flight — so it reads as a state of the panel rather than
   as the first row of the order. */
.ig-now-row {
  background: color-mix(in srgb, var(--ig-accent) var(--ig-tint-wash), transparent);
  border-bottom: var(--ig-stroke) solid var(--ig-line);
  box-shadow: inset var(--ig-band-rail) 0 0 var(--ig-accent);
  column-gap: var(--ig-space);
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  padding: var(--ig-space) var(--ig-space-wide);
}

.ig-now-mark {
  background: var(--ig-accent);
  border-radius: var(--ig-radius-small);
  color: var(--ig-bg);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-pill);
  font-weight: var(--ig-weight-strong);
  letter-spacing: var(--ig-tracking-pill);
  padding: var(--ig-space-micro) var(--ig-space-tight);
  text-transform: uppercase;
}

.ig-now-phase {
  align-items: center;
  color: var(--ig-accent);
  display: inline-flex;
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-small);
  gap: var(--ig-space-tight);
  white-space: nowrap;
}

/* The pulse is the frame's, and it is the one moving thing in the panel. */
.ig-now-pulse {
  background: var(--ig-accent);
  block-size: var(--ig-space-tight);
  border-radius: 50%;
  display: inline-block;
  inline-size: var(--ig-space-tight);
}

/* ── the order ─────────────────────────────────────────────────────────── */

/* TWO COLUMNS, WHICH IS THE FRAME'S GRID EXACTLY. The rank track holds the
   figure and the readiness dot stacked, and everything else is one body
   column, so a row has exactly two children and nothing can auto-place into
   the rank track and set its width. That was a real defect: a single
   relationship badge left unplaced widened the rank column for the whole list
   and squeezed every title to pay for it. */
.ig-slot {
  border-bottom: var(--ig-stroke) solid var(--ig-line);
  column-gap: var(--ig-space);
  display: grid;
  grid-template-columns: var(--ig-rank-column) 1fr;
  min-height: var(--ig-row-min-height);
  padding: var(--ig-row-padding-block) var(--ig-space-wide);
}

/* ── §17j's RAIL DENSITY ───────────────────────────────────────────────────

   THE 53px ROW, AND THE ORDER THINGS LEAVE IT. '17j' fixes both, and the
   reason it fixes the second is that the build *"showed everything because
   nothing told it what to give up"*. This is that instruction.

       9 pad + 17 title + 3 gap + 15 meta + 9 pad = 53px, divider inclusive
       tracks: 30px rank · 1fr issue · auto delta

   THE FINDING THIS ENCODES, which is the one to keep: at 6, 60 and 312 issues
   the rail is IDENTICAL. What changes is around it — virtualisation appears,
   the runner-hold footer grows, filter chips stop being optional, the canvas
   starts refusing. *"If you are making the rail denser as the backlog grows,
   you are compressing the surface that was never the problem."* So nothing
   here keys off the backlog size, and nothing ever should.

   430 IS THIS PACKAGE'S DEFAULT, NOT A CLAIM ABOUT THE DESIGN, AND A CONSUMER
   CAN TAKE IT OVER. That is the whole posture of this package — sensible
   defaults, everything overridable — and it is why this number needed no
   ruling in the end. '17j' gives two anchors and no crossover: the workspace
   rail is 390, §18's settings rail is 330 where steps 1-3 apply "by default",
   and §16a's panel, which keeps provenance inline, is wider than either and
   carries no published figure anywhere. 430 sits above the rail and below that
   panel. A host that does nothing gets it and gets correct behaviour; a host
   that disagrees sets data-density on the viewer root and this condition stops
   deciding for them.

   SO THE OPEN QUESTION IS CLOSED RATHER THAN WAITING. An earlier revision of
   this comment filed the distance between 390 and 430 as needing a width for
   §16a's panel. It does not: a DEFAULT only has to be reasonable, and the
   figure would only have mattered if this were the single crossover every
   consumer had to live with. It is not, so it is not blocking.

   IT CANNOT BE A TOKEN, AND THE NEXT PERSON WILL TRY. Making the threshold a
   theme property is the obvious reach, and it does not work: a container
   condition takes a length and only a length. Measured in a browser — a
   max-width condition written as a literal applies, and the same condition
   naming a custom property PARSES INTO A RULE THAT MATCHES AT NO WIDTH AT ALL,
   while CSS.supports() reports that same condition as supported. It fails
   silently in both directions: the rule is not dropped, it is simply never
   satisfied, and the one API that could have warned agrees it is fine. That is
   a CSS limitation rather than a decision, and it is why the escape hatch below
   is a selector rather than a property.

   '17k' MAKES THE LOWER ANCHOR EXACT, which is worth keeping. It fixes the
   three workspace layouts under one rule — "the rail never yields" — so the
   workspace draws its rail at 390 at every width it supports and no amount of
   resizing moves it across this threshold. Before that it fell to 312 below
   1360, so 430 had to clear two numbers and only one was '17j's. The editor's
   sheet pins that relationship rather than restating it: see its test "keeps
   the workspace rail on the dense side of layer 1's crossover". */
@container ig-rail (max-width: 430px) {
${railDensity('.ig-viewer:not([data-density])')}
}

/* THE ESCAPE HATCH ITSELF, AND IT IS THE SAME BLOCK WITH A DIFFERENT KEY.
   Emitted a second time under an attribute that carries no width at all, so
   a consumer who sets it gets the dense row wherever they want it. The
   scopes above and below are mutually exclusive by construction — one is
   :not([data-density]) and the other names a value — so nothing here
   depends on which of them a browser reads first.

   THE OTHER DIRECTION NEEDS NO RULES. data-density='wide' matches neither
   scope, so the row falls back to the base density this sheet declares
   above, at any container width. */
${railDensity(".ig-viewer[data-density='dense']")}

/* STEPS 1-3 OF THE DROP ORDER, AT §18's 330px SETTINGS RAIL, which '17j'
   names as the width where they apply by default.

   THE SELECTORS ARE THE MARKUP'S OWN ATTRIBUTES, not class guesses: evidence
   is 'data-evidence', a relationship is 'data-edge', a priority is
   'data-priority' with 'query' / 'tier' / 'promoted'. Three of these were
   written from memory first and two were wrong — the parts publish
   'data-evidence="verified"', never a 'data-ig-badge'. */

/* STEP 1 — evidence and verification chips. '17j': *"Reassurance, not an
   answer to any question the rail is asked."* */
@container ig-rail (max-width: 360px) {
  .ig-slot .ig-badge[data-evidence] {
    display: none;
  }
}

/* STEP 2 — relationship badges past the FIRST, which is kept because it is
   the one causing the hold. Scoped to 'data-edge' so it counts relationships
   and not the priority, evidence and readiness chips that share '.ig-badge';
   a positional 'nth-of-type' would have hidden whichever chip happened to sit
   second, which is not what the rule says at all. The '+n more' chip carries
   what left, and it already exists — 'data-omitted'. */
@container ig-rail (max-width: 345px) {
  .ig-slot .ig-badge[data-edge] ~ .ig-badge[data-edge] {
    display: none;
  }
}

/* STEP 3 — the priority token. A DECLARED TIER goes, because '17j' says it is
   *"recoverable from the rank itself"*. A PROMOTION stays: 'P3 → 0' is the
   one form the rank cannot give back, and it is rank provenance rather than a
   restatement. A matched query stays for the same reason — it names WHICH
   query, which no rank encodes. */
@container ig-rail (max-width: 335px) {
  .ig-slot .ig-badge[data-priority='tier'] {
    display: none;
  }
}

/* THE ONE ROW GROUND THE FRAME DRAWS, and it is not a stripe. A together unit
   is the compound station, and the tint says so; the other ranked rows carry
   no background at all. */
.ig-slot[data-unit='true'] {
  background: color-mix(in srgb, var(--ig-accent) var(--ig-tint-unit), transparent);
}

/* A HELD ROW IS HATCHED, NOT DASHED. It keeps its position in the sequence —
   "why isn't my P1 running" is answerable in place — so it must read as
   unavailable without leaving the grid the rows above and below hang off. A
   dashed border around one row breaks that alignment; a ground does not. */
.ig-slot[data-held='true'] {
  background-image: repeating-linear-gradient(
    135deg,
    color-mix(in srgb, var(--ig-text) var(--ig-tint-unit), transparent) 0 var(--ig-space-tight),
    transparent var(--ig-space-tight) calc(var(--ig-space-tight) * 2)
  );
}

.ig-slot[aria-current='true'] {
  box-shadow: inset var(--ig-band-rail) 0 0 var(--ig-accent);
}

/* A CANVAS-OWNED NODE IS SELECTABLE TOO, and only the rail rows had a selected
   look — so clicking a gutter, excluded or tracker-held node set aria-current on
   the group and changed nothing a reader could see. A pointer does not normally
   raise :focus-visible either, so those selections had no visible state at all
   on the channel most likely to make them. Same accent the rail uses, so one
   selection reads the same whichever surface drew it. */
.ig-node-group[aria-current='true'] .ig-node {
  stroke: var(--ig-accent);
  stroke-width: calc(var(--ig-stroke) * 2);
}

/* The rank track: figure over dot, centred, so the title column starts at one
   x on every row whether or not the row has a number to print. */
.ig-rank-cell {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-rank {
  color: var(--ig-text);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-rank);
  font-variant-numeric: tabular-nums;
  font-weight: var(--ig-weight-strong);
  line-height: 1;
}

.ig-rank[data-held='true'] {
  color: var(--ig-text-muted);
  font-weight: var(--ig-weight-regular);
}

.ig-row-body {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-snug);
  min-width: 0;
}

/* The title, the identity and the two-line pair they form: 2px apart, which is
   what makes them read as one object rather than as two rows of metadata. */
.ig-row-head {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-micro);
  min-width: 0;
}

/* A UNIT AT THE WIDE DENSITY IS ITS ENCLOSURE, which is what §16a draws: the
   pill, the note, and a member list. The ordinary head the row also carries is
   the RAIL's way of drawing the same unit, so it stands down here rather than
   printing the lead's title above a box that already opens with it. */
.ig-slot[data-unit='true'] > .ig-row-body > .ig-row-head {
  display: none;
}

.ig-unit-count {
  display: none;
}

/* LINE 2 AT THE WIDE DENSITY. §16a's panel draws the same sequence — identity
   then chips — and simply has room, so here it WRAPS rather than clipping and
   the provenance turnstile stays inline beneath it. Same markup, two
   densities; the rail's rules are in the container query above. */
.ig-row-meta {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space-tight);
  min-width: 0;
}

/* ── readiness stations ────────────────────────────────────────────────── */

.ig-station {
  block-size: var(--ig-station-size);
  border: var(--ig-stroke) solid var(--ig-station-held);
  border-radius: 50%;
  display: inline-block;
  inline-size: var(--ig-station-size);
}

.ig-station[data-fill='filled'] {
  background: var(--ig-station-ready);
  border-color: var(--ig-station-ready);
}

.ig-station[data-fill='hollow'] {
  background: transparent;
  border-color: var(--ig-station-pending);
}

.ig-station[data-fill='dashed'] {
  background: transparent;
  border-style: dashed;
  border-color: var(--ig-station-held);
}

/* ── titles, identity, provenance ──────────────────────────────────────── */

/* NOTHING TRUNCATES. The ellipsis this rule used to carry, against a FIXED row
   height, is the direct cause of the frame's titles arriving on screen as
   "Retype the ca…" — a panel whose job is to say what the work is, declining
   to say what the work is. A row grows instead; --ig-row-min-height is a
   floor, not a height. anywhere covers the one case wrapping cannot: an
   unbroken token wider than the column, which would otherwise overflow the
   panel rather than the line. */
.ig-title {
  color: var(--ig-text);
  font-size: var(--ig-font-size-row);
  overflow-wrap: anywhere;
}

.ig-slot[data-held='true'] .ig-title,
.ig-footer .ig-title {
  color: var(--ig-text-body);
}

/* A held row's CONTENT recedes, not its position. The frame dims the body and
   leaves the rank track at full strength, so the row still reads as occupying
   the slot it would have taken. */
.ig-slot[data-held='true'] .ig-row-body {
  opacity: 0.72;
}

/* The isolated-issue tally sits directly on the panel, outside the padded
   groups, so it carries the panel's own inset rather than none. */
.ig-count {
  margin: 0;
  padding: var(--ig-space) var(--ig-space-wide);
}

.ig-id,
.ig-count {
  color: var(--ig-text-muted);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-small);
  font-variant-numeric: tabular-nums;
}

.ig-link {
  color: inherit;
  text-decoration: none;
}

.ig-link:hover {
  color: var(--ig-accent);
  text-decoration: underline;
}

/* THE PROVENANCE LINE IS NOT MUTED. It is the answer to "why is this here",
   which is the panel's whole reason to exist, so the frame gives it body text
   and lifts the named parts to the brightest ink on the page. Muting the whole
   sentence — which is what shipped — files the explanation under decoration. */
.ig-provenance,
.ig-hold,
.ig-caveat {
  align-items: baseline;
  color: var(--ig-text-body);
  display: flex;
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-small);
  gap: var(--ig-space-tight);
  margin: 0;
}

.ig-provenance .ig-id,
.ig-hold .ig-id,
.ig-caveat .ig-id {
  color: var(--ig-text);
}

/* The turnstile the frame puts in front of every explanation, so the line reads
   as subordinate to the row above it without being dimmed. */
.ig-turn {
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-micro);
  flex: 0 0 auto;
}

.ig-strike {
  text-decoration: line-through;
}

/* ── edge badges ───────────────────────────────────────────────────────── */

.ig-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space-tight);
}

/* A TINTED CHIP, NOT A BARE OUTLINE. The frame fills every relationship chip
   with its own hue at a low alpha inside a heavier border of the same hue;
   drawn as an outline alone the badge row reads as a row of empty boxes, and
   the hue channel carries a third of the weight the design gives it. The two
   alphas are the theme's, so a host retinting a relationship retints its chip. */
.ig-badge {
  align-items: center;
  background: var(--ig-surface-2);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius-small);
  color: var(--ig-text);
  display: inline-flex;
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-micro);
  gap: var(--ig-space-tight);
  padding: var(--ig-space-micro) var(--ig-space-tight);
}

/* THE HUE IS A BORDER AND A FILL HERE, NOT A TEXT COLOUR — the theme holds the
   edge hues to the 3:1 NON-TEXT bar, and says so where it defines them, so
   painting badge LABELS with them contradicts the palette's own claim. It was
   not merely theoretical: at this size duplicate-of measured 3.98:1 on
   --ig-surface and decomposed-from 4.37:1, both under the 4.5:1 the text test
   asserts for every text colour. The label takes --ig-text, which that test
   already proves on all three surfaces, and the hue keeps the non-text use it
   was measured for. This is a DELIBERATE DEPARTURE from the frame, which tints
   its chip labels; the frame's own colour-blind-safety clause says hue is one
   of four redundant channels, and here it is carried by two of them.
   NO CHANNEL IS LOST. The dash pattern and the glyph are untouched, and the
   vocabulary test independently proves all five stay distinguishable with hue
   removed ENTIRELY, which is the stronger claim. */
/* WRITTEN OUT PER EDGE RATHER THAN THROUGH ONE INTERMEDIATE PROPERTY. A
   an intermediate --ig-badge-hue set here and read here would be a property no
   theme and no layout declares, and styles.test.ts refuses those on purpose:
   the whole point of that guard is that every var() in this file names
   something a host or the layout actually sets. */
.ig-badge[data-edge='blocked-by'] {
  background: color-mix(in srgb, var(--ig-edge-blocked-by) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-edge-blocked-by) var(--ig-tint-border), transparent);
  border-style: solid;
}

.ig-badge[data-edge='serialize-with'] {
  background: color-mix(in srgb, var(--ig-edge-serialize-with) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-edge-serialize-with) var(--ig-tint-border), transparent);
  border-style: double;
}

.ig-badge[data-edge='together-with'] {
  background: color-mix(in srgb, var(--ig-edge-together-with) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-edge-together-with) var(--ig-tint-border), transparent);
  border-style: solid;
}

.ig-badge[data-edge='duplicate-of'] {
  background: color-mix(in srgb, var(--ig-edge-duplicate-of) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-edge-duplicate-of) var(--ig-tint-border), transparent);
  border-style: dotted;
}

.ig-badge[data-edge='decomposed-from'] {
  background: color-mix(in srgb, var(--ig-edge-decomposed-from) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-edge-decomposed-from) var(--ig-tint-border), transparent);
  border-style: dashed;
}

/* A PROMOTION IS THE ONE CHIP THE FRAME ACCENTS. It is the most interesting
   event the panel can show — a low tier pulled to the top because it blocks a
   high one — and the design spends its accent on exactly that. */
.ig-badge[data-priority='promoted'] {
  background: color-mix(in srgb, var(--ig-accent) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-accent) var(--ig-tint-border), transparent);
}

.ig-badge[data-evidence='verified'] {
  background: color-mix(in srgb, var(--ig-station-ready) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-station-ready) var(--ig-tint-border), transparent);
}

/* A caveat or hold-label chip carries no relationship hue: it is a word, not
   an edge, so it keeps the line colour the plain badge has. */
.ig-badge[data-caveat],
.ig-badge[data-hold] {
  color: var(--ig-text-body);
}

.ig-badge[data-caveat='preview-only'] {
  border-color: color-mix(in srgb, var(--ig-state-conflict) var(--ig-tint-border), transparent);
}

.ig-badge[data-not-ready='true'] {
  background: color-mix(in srgb, var(--ig-edge-blocked-by) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-edge-blocked-by) var(--ig-tint-border), transparent);
}

.ig-glyph {
  font-family: var(--ig-font-mono);
}

/* ── the together unit: one rank, two issues ───────────────────────────── */

.ig-unit-mark {
  align-items: center;
  display: flex;
  gap: var(--ig-space-snug);
}

.ig-unit-pill {
  background: var(--ig-accent);
  border-radius: var(--ig-radius-small);
  color: var(--ig-bg);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-pill);
  font-weight: var(--ig-weight-strong);
  letter-spacing: var(--ig-tracking-badge);
  padding: var(--ig-space-micro) var(--ig-space-tight);
  text-transform: uppercase;
}

.ig-unit-note {
  color: var(--ig-text-muted);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-micro);
}

/* THE MEMBERS GET ONE LINE EACH. Joining them with a separator — which is what
   shipped — makes a two-issue unit read as one issue with a long title, and
   the unit is the one place the design draws an enclosure to say the opposite. */
/* THE UNIT'S ENCLOSURE IS THE together-with MARK. It is drawn at the
   connector's hairline width, which is what that token has always meant: finer
   than an ordinary edge, so the enclosure stays the primary read. */
.ig-unit {
  border: var(--ig-stroke-connector) solid color-mix(in srgb, var(--ig-edge-together-with) var(--ig-tint-border), transparent);
  border-radius: var(--ig-radius);
  list-style: none;
  margin: 0;
  overflow: hidden;
  padding: 0;
}

.ig-unit-member {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-micro);
  padding: var(--ig-space-snug) var(--ig-space);
}

.ig-unit-member + .ig-unit-member {
  border-top: var(--ig-stroke) solid var(--ig-line);
}

.ig-unit-member .ig-title {
  font-size: var(--ig-font-size-compact);
}

.ig-unit-member .ig-id {
  font-size: var(--ig-font-size-meta);
}

/* ── the footer group: holds that earn no rank slot ────────────────────── */

.ig-footer {
  background: var(--ig-surface-2);
  padding: var(--ig-space) var(--ig-space-wide);
}

.ig-footer-head {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-micro);
}

.ig-footer-title {
  color: var(--ig-text);
  font-size: var(--ig-font-size-compact);
  margin: 0;
}

.ig-footer-note {
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-meta);
  margin: 0;
}

/* ROWS THAT LOOK LIKE WHAT THEY ARE: THINGS YOU CAN OPEN. Every entry here is
   selectable — it opens in the details panel like any ranked row — and nothing
   said so. They were drawn at 0.72 opacity, which reads as DISABLED, with no
   hover, no pointer and no mark at the end, so the one group whose whole
   purpose is "look at why" gave no sign you could look.

   STILL LIGHTER THAN THE ORDER, BY GROUND AND TYPE RATHER THAN BY FADING. The
   group sits on the second surface in the compact type; that is enough to say
   "not a fact about the work" without also saying "unavailable". */
.ig-footer .ig-list {
  display: flex;
  flex-direction: column;
  margin: var(--ig-space) calc(var(--ig-space-tight) * -1) 0;
}

.ig-footer-row {
  align-items: baseline;
  border-radius: var(--ig-radius);
  column-gap: var(--ig-space-snug);
  cursor: pointer;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: var(--ig-space-tight);
}

/* A DRILL-IN MARK, and hidden from assistive technology with the alternative
   text slot: the row's own accessible name already says what it is, and a
   screen reader announcing "single right-pointing angle quotation mark" after
   every entry is noise, not information. */
.ig-footer-row::after {
  color: var(--ig-text-muted);
  content: '›' / '';
  grid-column: 3;
  grid-row: 1;
}

.ig-footer-row:hover {
  background: color-mix(in srgb, var(--ig-text) var(--ig-tint-unit), transparent);
}

.ig-footer-row:hover::after {
  color: var(--ig-text);
}

/* THE SAME SELECTED MARK THE RANKED ROWS CARRY, so an issue opened from down
   here reads as the current subject the way one opened from the order does. */
.ig-footer-row[aria-current='true'] {
  box-shadow: inset var(--ig-band-rail) 0 0 var(--ig-accent);
}

.ig-footer-row > .ig-badge {
  grid-column: 1;
  grid-row: 1;
}

.ig-footer-body {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-micro);
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
}

.ig-footer-line {
  align-items: baseline;
  display: flex;
  gap: var(--ig-space-snug);
  min-width: 0;
}

.ig-footer-row .ig-title {
  color: var(--ig-text-body);
  font-size: var(--ig-font-size-compact);
}

.ig-footer-row .ig-id {
  font-size: var(--ig-font-size-meta);
}

.ig-footer-why {
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-meta);
  margin: 0;
}

/* ── the graph canvas ──────────────────────────────────────────────────── */

/* The stage carries the LAYOUT's own size, so one SVG unit is one CSS pixel
   and an absolutely-positioned rail row lands on the node it names. A
   percentage-width canvas would rescale under the rail and drift. It scrolls
   rather than shrinking, because shrinking would silently break that. */
.ig-stage {
  block-size: var(--ig-stage-h);
  inline-size: var(--ig-stage-w);
  max-inline-size: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  position: relative;
}

.ig-canvas {
  block-size: var(--ig-stage-h);
  display: block;
  inline-size: var(--ig-stage-w);
}

/* The three column headers, which say what each column is FOR. Without them
   the gutters read as two more piles of issues rather than as the two answers
   the spine deliberately keeps off itself. */
.ig-column-head {
  color: var(--ig-text-muted);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-pill);
  letter-spacing: var(--ig-tracking-group);
  position: absolute;
  text-transform: uppercase;
  inset-block-start: var(--ig-space-snug);
  inset-inline-start: var(--ig-col-x);
}

.ig-column-head[data-column='spine'] {
  color: var(--ig-accent);
}

/* The node cards and the station column, sitting on the coordinates the layout
   computed. */
.ig-rail {
  inset: 0;
  pointer-events: none;
  position: absolute;
}

.ig-rail-row {
  block-size: auto;
  inline-size: var(--ig-row-w);
  inset-block-start: var(--ig-row-y);
  inset-inline-start: var(--ig-row-x);
  min-block-size: var(--ig-row-h);
  pointer-events: auto;
  position: absolute;
}

/* A CARD, NOT A LABELLED RECTANGLE. Drawing the node's text in SVG is what
   forced every title through a width fit and out the other side truncated; an
   HTML card wraps, so the acceptance criterion "nothing truncates" is met by
   construction rather than by choosing a wider box. */
.ig-card {
  background: var(--ig-surface);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius-large);
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
  padding: var(--ig-space) var(--ig-space);
}

.ig-card .ig-title {
  font-size: var(--ig-font-size-compact);
}

.ig-card .ig-id {
  font-size: var(--ig-font-size-meta);
}

.ig-card[data-column='left'] {
  background: var(--ig-surface-2);
  border-color: color-mix(in srgb, var(--ig-edge-blocked-by) var(--ig-tint-border), transparent);
}

/* NEVER WORKED READS AS NEVER DRAWN IN. The right gutter's two node states are
   the design's own: a dashed provenance origin and a dotted duplicate, both on
   no ground at all, so the eye files them as outside the order before reading
   a word. */
.ig-card[data-column='right'] {
  background: transparent;
  border-style: dashed;
  opacity: 0.8;
}

.ig-card[data-exclusion='true'] {
  border-style: dotted;
  border-color: color-mix(in srgb, var(--ig-edge-duplicate-of) var(--ig-tint-border), transparent);
}

.ig-card[data-held='true'] {
  background: transparent;
  border-style: dashed;
  opacity: 0.75;
}

.ig-card[data-now='true'] {
  background: color-mix(in srgb, var(--ig-accent) var(--ig-tint-wash), transparent);
  border-color: color-mix(in srgb, var(--ig-accent) var(--ig-tint-border), transparent);
}

.ig-card[data-unit='true'] {
  background: color-mix(in srgb, var(--ig-accent) var(--ig-tint-unit), transparent);
  border-color: var(--ig-accent);
}

.ig-rail-row[aria-current='true'] .ig-card {
  border-color: var(--ig-accent);
  box-shadow: 0 0 0 var(--ig-band-rail) color-mix(in srgb, var(--ig-accent) var(--ig-tint-border), transparent);
}

/* The station column: a disc on the spine, carrying the rank the row would
   otherwise have to be read for. */
.ig-spine-station {
  align-items: center;
  background: var(--ig-bg);
  block-size: var(--ig-station-box);
  border: calc(var(--ig-stroke) * 2) solid var(--ig-station-ready);
  border-radius: 50%;
  box-shadow: 0 0 0 var(--ig-station-halo) var(--ig-bg);
  color: var(--ig-station-pending);
  display: flex;
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-small);
  font-weight: var(--ig-weight-heavy);
  inline-size: var(--ig-station-box);
  inset-block-start: var(--ig-station-y);
  inset-inline-start: var(--ig-station-x);
  justify-content: center;
  pointer-events: none;
  position: absolute;
}

.ig-spine-station[data-fill='filled'] {
  background: var(--ig-station-ready);
  color: var(--ig-bg);
}

.ig-spine-station[data-fill='hollow'] {
  border-color: var(--ig-station-ready);
  color: var(--ig-station-ready);
}

.ig-spine-station[data-fill='dashed'] {
  border-style: dashed;
  border-width: var(--ig-stroke);
  border-color: var(--ig-station-held);
  color: var(--ig-text-muted);
}

/* The serialize hold is gold in the frame, on the station as well as the arc:
   a station that waits for a PEER is a different fact from one that waits for
   a rank above it. */
/* THE RING TAKES THE HUE, THE DIGIT DOES NOT. §16b draws both in gold, and the
   theme holds every edge hue to the 3:1 NON-TEXT bar — so painting the rank
   figure with it makes a claim the palette does not support, on the one glyph
   in the station a reader has to actually read. The hue keeps the ring, which
   is the channel it was measured for; the number keeps the ink every text
   contrast test already proves. */
.ig-spine-station[data-wait='serialize'] {
  border-color: var(--ig-edge-serialize-with);
  color: var(--ig-text);
}

.ig-spine {
  stroke: var(--ig-line);
  stroke-width: calc(var(--ig-stroke) * 2);
}

.ig-more {
  color: var(--ig-text-muted);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-micro);
  inline-size: var(--ig-row-w);
  inset-block-start: var(--ig-row-y);
  inset-inline-start: var(--ig-row-x);
  position: absolute;
  text-align: center;
}

.ig-node {
  fill: var(--ig-surface);
  stroke: var(--ig-line);
  stroke-width: var(--ig-stroke);
}

.ig-node[data-held='true'] {
  fill: var(--ig-surface-2);
  stroke-dasharray: 4 3;
}

.ig-node-label {
  fill: var(--ig-text);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
}

.ig-edge {
  fill: none;
  stroke-width: var(--ig-stroke);
}

.ig-edge[data-edge='blocked-by'] { stroke: var(--ig-edge-blocked-by); }
.ig-edge[data-edge='serialize-with'] { stroke: var(--ig-edge-serialize-with); }
.ig-edge[data-edge='together-with'] { stroke: var(--ig-edge-together-with); }
.ig-edge[data-edge='duplicate-of'] { stroke: var(--ig-edge-duplicate-of); }
.ig-edge[data-edge='decomposed-from'] { stroke: var(--ig-edge-decomposed-from); }

/* The dash pattern is set per element from the edge vocabulary, never here —
   one source for the channel the colour-blind-safety claim rests on. Drawn only
   in the legend now: a together unit is ONE card with its members listed inside
   it, so the canvas has no pair of boxes to surround. */
.ig-enclosure {
  fill: none;
  stroke: var(--ig-edge-together-with);
  stroke-width: var(--ig-stroke);
}

/* currentColor on the marker resolves to the inherited text colour, not to the
   edge's stroke — so a terminal has to be given the hue explicitly or it renders
   in body text and the fourth channel silently collapses. */
.ig-terminal {
  color: var(--ig-text-body);
  stroke-width: var(--ig-stroke);
}

/* A MARK IS HIT-TESTABLE, AND THAT IS THE OPPOSITE OF WHAT IT FIRST SAID.

   It carried a pointer-events none rule, reasoning from the halo: a decoration
   over a line must not swallow the click aimed at the line. That reasoning does
   not transfer, because a halo IS the line again and a mark is NOT — every one
   of these is deliberately offset AWAY from the path, so a click on it does not
   fall through onto the edge. It falls through onto the canvas, and the viewer's
   walk climbs to the canvas group and reports a click on nothing, clearing the
   very selection the reader was making. A conflict's companion is the clearest
   case: a visibly separate line that could not be pointed at.

   That is a defect this package has already paid for once. The overlay module
   keeps its pointer identity on the dash clone for exactly this reason, and says
   so: dropping the identity makes a clone a dead zone over its own edge. Every
   mark here publishes the same identity, so making it unhittable spent the
   identity it had just been given.

   Colour is set per element, from the token name the caller supplied, for the
   reason the edge hues are set per element: one source for a channel. Nothing
   here paints a state, because nothing here knows what a state is. */
.ig-edge-mark {
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
}

.ig-edge-companion {
  stroke-width: var(--ig-stroke);
}

.ig-terminal[data-edge='blocked-by'] { color: var(--ig-edge-blocked-by); }
.ig-terminal[data-edge='serialize-with'] { color: var(--ig-edge-serialize-with); }
.ig-terminal[data-edge='together-with'] { color: var(--ig-edge-together-with); }
.ig-terminal[data-edge='duplicate-of'] { color: var(--ig-edge-duplicate-of); }
.ig-terminal[data-edge='decomposed-from'] { color: var(--ig-edge-decomposed-from); }

/* ── refusals and empty states ─────────────────────────────────────────── */

.ig-refusal,
.ig-empty {
  background: var(--ig-surface-2);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  color: var(--ig-text-body);
  margin: var(--ig-space-wide);
  padding: var(--ig-space);
}

.ig-refusal-next {
  color: var(--ig-text);
  margin: var(--ig-space-tight) 0 0;
}

/* The capsule is INFORMATIONAL — a plain list item again. It was briefly a
   button, to make the refusal's advertised action keyboard-reachable; the
   action itself has since gone, because this package cannot narrow a document
   and so could never complete it. With the control removed the UA button reset
   goes too: there is no button look left to undo. */
.ig-capsule {
  align-items: baseline;
  background: var(--ig-surface);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  display: flex;
  gap: var(--ig-space);
  margin-top: var(--ig-space-tight);
  padding: var(--ig-space-tight) var(--ig-space);
}

.ig-refusal-omitted {
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-small);
  margin: var(--ig-space-tight) 0 0;
}

/* ── the decomposition tree ────────────────────────────────────────────── */

.ig-tree,
.ig-tree .ig-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.ig-tree {
  padding: var(--ig-space) var(--ig-space-wide);
}

.ig-tree .ig-list {
  border-left: var(--ig-stroke) dashed var(--ig-edge-decomposed-from);
  margin-left: var(--ig-space);
  padding-left: var(--ig-space);
}

.ig-tree-item {
  padding: var(--ig-space-tight) 0;
}

/* ── legend ────────────────────────────────────────────────────────────── */

/* A FOOTER BAR, WHERE §16b PUTS IT, and worded rather than glyph-only. It sits
   under the drawing it explains, carries a drawn sample of each line so the
   dash and terminal channels are legible cold, and ends with the readiness key
   the station fills need. */
.ig-legend {
  align-items: center;
  background: var(--ig-surface-2);
  border: 0;
  border-top: var(--ig-stroke) solid var(--ig-line);
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space-wide);
  margin: 0;
  padding: var(--ig-space) var(--ig-space-wide);
}

/* FLOATED SO THE BROWSER STOPS TREATING IT AS A RENDERED LEGEND, which is the
   only reason this declaration exists. HTML gives the first in-flow legend of a
   fieldset a layout nothing else in CSS has: it is lifted OUT of the fieldset's
   content box, painted across the top border with a notch cut through the rule
   either side of it, and the content box then starts below it. On this bar that
   drew the caption sitting on the rule, a gap of bare ground under the caption
   where the fieldset's own surface should have been, and a top rule broken in
   the middle — all three of which looked like a styling bug and none of which
   any rule here asked for.

   The spec's own escape hatch is the float: a legend whose computed float is
   not none is not the rendered legend, and becomes an ordinary child. This bar
   is a flex container, where float does not apply to an item at all, so the
   caption simply lays out as the first item on the row — which is what the
   flex rule above, its muted uppercase micro type and its centred alignment
   were always written for.

   IT IS LOAD-BEARING AND LOOKS DECORATIVE, which is why it is recorded here at
   this length: delete it and the notch, the gap and the broken rule all come
   back, with nothing else in this file changed. */
.ig-legend-caption {
  color: var(--ig-text-muted);
  float: left;
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-pill);
  letter-spacing: var(--ig-tracking-group);
  padding: 0;
  text-transform: uppercase;
}

.ig-legend-item {
  align-items: center;
  color: var(--ig-text-body);
  display: inline-flex;
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-meta);
  gap: var(--ig-space-tight);
}

.ig-legend-keys {
  display: inline-flex;
  gap: var(--ig-space-loose);
  margin-inline-start: auto;
}
`;
