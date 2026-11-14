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

import { RECEDE_ALPHA } from './recede.ts';

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

   THE CHANNELS THAT MATTER SURVIVE THIS, which is the thing worth checking
   before doing it: dash, terminal and glyph are untouched. Since issue 293 no
   chip carries a relationship hue at any density, so there is none to move.
   '17j' names the hold GLYPH among the five things never dropped, and it is
   still drawn. */
${scope} .ig-slot .ig-row-meta .ig-badge {
  background: none;
  block-size: auto;
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
   the pill's words are already the accessible name's. Like every count this
   package draws it is body sans at the body size with tabular figures; mono
   is kept for keys. */
${scope} .ig-unit-count {
  color: var(--ig-edge-together-with);
  display: inline;
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  font-variant-numeric: tabular-nums;
  margin-right: var(--ig-space-tight);
}

/* THE FOOTER ROW'S TITLE STAYS ON ONE LINE, as a ranked row's does. The row
   is taller than a ranked row now by design — its status and its reason are
   what it exists to show — but a title that wraps still takes the row with it,
   so the name ellipsizes and the reason below it carries the length. */
${scope} .ig-footer-row .ig-title {
  line-height: var(--ig-row-title-line);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The identity never wraps mid-reference. */
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

/* THE QUERY CHIP COMES BACK WHERE ITS LINE GOES (#131). At this density the
   provenance line is hidden, so the chip is the only mark on the row naming
   WHICH ordered query placed it — and step 3 below keeps it for exactly that
   reason. A row the reader opened draws the line again, and the chip leaves
   with it: one fact, said once, at every density. */
${scope} .ig-slot .ig-badge[data-priority='query'] {
  display: inline-flex;
}

${scope} .ig-slot[aria-expanded='true'] .ig-badge[data-priority='query'] {
  display: none;
}
`;
}

/** `RECEDE_ALPHA` as a `color-mix` share, so a receded station's ring and a
 * receded line draw at one strength from one source. */
const RECEDE_PERCENT = `${RECEDE_ALPHA * 100}%`;

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
  background: transparent;
  border: 0;
  border-radius: 0;
}

/* A HOST'S OWN CARD HOLDS IT, SO IT DRAWS NO CARD OF ITS OWN. Declining
   the frame is how a container says it embeds the viewer; with it the root
   paints no ground (above), so the rows sit on the host's surface rather than
   in a second card inside it. The footer group's heading then reads as the
   export's group heading, "Not in the order" in the small role at medium weight
   in muted ink with its count beside it in regular weight, rather than as the
   standalone panel's uppercase kicker and outlined chip. The header, with its
   kicker and its chips, is the chrome a container declines separately. */
.ig-viewer[data-frame='none'] .ig-footer-title {
  color: var(--ig-text-muted);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  font-weight: var(--ig-weight-medium);
  letter-spacing: normal;
  text-transform: none;
}

.ig-viewer[data-frame='none'] .ig-footer-title-row {
  justify-content: space-between;
}

.ig-viewer[data-frame='none'] .ig-count-chip[data-count='footer'] {
  background: none;
  border: 0;
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-small);
  font-weight: var(--ig-weight-regular);
  padding: 0;
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
/* A DOCKED LEGEND TAKES THE ROOT'S OWN GROUND (issue 293). The bar draws no
   ground of its own, as the export draws it, which is right where it sits
   below the drawing; docked, it is sticky over rows that scroll beneath it,
   and with no ground those rows would show through its words. */
.ig-viewer[data-legend='docked'] > .ig-legend {
  background: var(--ig-bg);
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
   line of muted prose.

   A COUNT IS BODY TEXT, NOT A KEY. It is set in the body sans at the body
   size, and tabular figures keep its digits from wandering, which was the one
   thing the small mono gave it. Mono is kept for what a reader copies as typed,
   such as a label:P0 key; an issue number is read, so it is sans too. */
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
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  font-variant-numeric: tabular-nums;
  padding: var(--ig-space-micro) var(--ig-space-snug);
}

.ig-count-chip[data-count='ready'] {
  background: color-mix(in srgb, var(--ig-accent) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-accent) var(--ig-tint-border), transparent);
  color: var(--ig-text);
}

/* The small role in the sans, as the explanation lines are: one face and one
   size on the line, the time inside it included (see .ig-freshness .ig-id). */
.ig-freshness {
  align-items: center;
  color: var(--ig-text-muted);
  display: inline-flex;
  font-family: var(--ig-font-ui);
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

/* A COUNT, SO IT TAKES TABULAR FIGURES. A progress figure is read as a number,
   and proportional digits wander the way a rank column's would. Tabular figures
   in the body sans hold them still; the mono face is for keys, not counts. */
.ig-notice-progress {
  color: var(--ig-text-muted);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
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

/* §16g's FIRST-IMPORT BAR (#129): a track the host's share fills, in the
   importing state's own gold, above the figure it repeats. Rounded at the
   radius the small badge already uses. */
.ig-notice-meter {
  block-size: var(--ig-space-tight);
  display: block;
  inline-size: 100%;
  margin-block-start: var(--ig-space-snug);
}

.ig-notice-meter-track {
  fill: var(--ig-surface);
}

.ig-notice-meter-fill {
  fill: var(--ig-state-conflict);
}

.ig-notice-meter rect {
  rx: calc(var(--ig-space-tight) / 2);
}

.ig-notice[data-ig-condition='importing'] .ig-notice-head {
  color: var(--ig-state-conflict);
}

.ig-notice[data-ig-condition='error'] .ig-notice-head {
  color: var(--ig-state-failed);
}

/* THE EMPTY STATE IS A CENTRED CARD, NOT A BANNER (#132). The shared rule above
   is right for importing and error, whose frames sit left with the control
   pushed aside; §16g's empty frame centres everything, leads with the dashed
   station row, and puts its control beneath the prose. Its frame pads it 30px
   by 20px: the block inset here is 2 x 16px, the nearest the space scale draws. */
.ig-notice[data-ig-condition='empty'] {
  align-items: center;
  flex-direction: column;
  justify-content: flex-start;
  padding: calc(var(--ig-space-loose) * 2) var(--ig-space-wide);
  text-align: center;
}

.ig-notice[data-ig-condition='empty'] .ig-notice-text {
  align-items: center;
}

.ig-notice[data-ig-condition='empty'] .ig-notice-head {
  justify-content: center;
}

.ig-notice-stations {
  display: flex;
  gap: var(--ig-space-tight);
  justify-content: center;
  margin-block-end: var(--ig-space);
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

/* The pulse is the frame's, and it is the one moving thing in the panel. The
   legend's "Being worked" key draws the same dot under a class of its own.
   Both take the progress state (issue 296), not the accent a host maps to the
   same ink as "Ready now". */
.ig-now-pulse,
.ig-legend-working {
  background: var(--ig-state-progress);
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

/* A HELD ROW IS MARKED BY ITS DOT ALONE (issue 296). It keeps its position in
   the sequence, so "why isn't my P1 running" is answerable in place, and the
   export says it is held with the held station and nothing else: no hatched
   ground, no dashed border. The station's held fill is the whole mark. */

/* A SELECTED ROW IS FILLED WITH --ig-surface, the stronger of the two
   surfaces. --ig-surface-2 is what a receded row takes, so a selected row never
   reads as receded. background-color, not the shorthand, so no background-image
   a host gives a row is cleared when it is selected. */
.ig-slot[aria-current='true'] {
  background-color: var(--ig-surface);
  box-shadow: inset var(--ig-band-rail) 0 0 var(--ig-accent);
}

/* A CANVAS-OWNED NODE IS SELECTABLE TOO, and only the rail rows had a selected
   look — so clicking a gutter, excluded or tracker-held node set aria-current on
   the group and changed nothing a reader could see. A pointer does not normally
   raise :focus-visible either, so those selections had no visible state at all
   on the channel most likely to make them. A SELECTED NODE IS INVERTED — the
   text colour fills it and its label takes --ig-bg — the same
   look a selected card takes, so one selection reads the same whichever
   surface drew it. */
.ig-node-group[aria-current='true'] .ig-node {
  fill: var(--ig-text);
  stroke: var(--ig-text);
  stroke-width: calc(var(--ig-stroke) * 2);
}

.ig-node-group[aria-current='true'] .ig-node-label {
  fill: var(--ig-bg);
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
  /* MUTED AND REGULAR AT THE BODY SIZE, as the export draws the rank (issue
     293). It was strong in text colour a step above the body, and the export's
     rules forbid a weight of 600 or more; the row's title is what a reader
     reads first, and the figure beside it only places it. A held row's rank
     reads the same, so it needs no rule of its own: its station says it is
     held.

     A RANK IS A FIGURE A READER READS, NOT A KEY THEY COPY, so it is the sans
     with tabular figures, which keep a column of ranks aligned. */
  color: var(--ig-text-muted);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  font-variant-numeric: tabular-nums;
  font-weight: var(--ig-weight-regular);
  line-height: 1;
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

/* AS THE BOARD DRAWS THEM: ready is a solid dot, ready after its
   blockers a solid ring in the pending colour, and held a solid dot in the held
   colour. Held was a dashed ring, which on a dot this small read as a broken
   outline rather than a state. Each mark is a theme token, so a host maps the
   three to its own state colours. The fill keeps its data-fill name; only the
   drawing changed. */
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
  background: var(--ig-station-held);
  border-color: var(--ig-station-held);
  border-style: solid;
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

.ig-footer .ig-title {
  color: var(--ig-text-body);
}

/* A HELD ROW'S TEXT IS NOT MUTED (issue 296). Its title and body read as any
   row's do, and the held station is the whole of the mark, as the export draws
   a held row with its dot alone. */

/* The isolated-issue tally sits directly on the panel, outside the padded
   groups, so it carries the panel's own inset rather than none. */
.ig-count {
  margin: 0;
  padding: var(--ig-space) var(--ig-space-wide);
}

/* AN ISSUE NUMBER IS READ AS A NUMBER, NOT COPIED AS A KEY. The design draws
   it as its muted .num: the body sans at the body size, with tabular figures so
   a column of numbers lines up. Mono is kept for what a reader copies as typed,
   such as a label:P0 key. The count beside it takes the same type; it keeps a
   rule of its own because the tally's inset above is not the number's. */
.ig-id {
  color: var(--ig-text-muted);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  font-variant-numeric: tabular-nums;
}

.ig-count {
  color: var(--ig-text-muted);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
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
   sentence — which is what shipped — files the explanation under decoration.

   ONE FACE AND ONE SIZE PER LINE. The line is the small role in the sans, with
   tabular figures for the numbers in it; it was small mono, which left a sans
   issue number at the body size sitting inside it. The numbers in it inherit
   its size (below), and the one key a reader copies, .ig-copy-key, is mono at
   that same size. */
.ig-provenance,
.ig-hold,
.ig-caveat {
  align-items: baseline;
  color: var(--ig-text-body);
  display: flex;
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  font-variant-numeric: tabular-nums;
  gap: var(--ig-space-tight);
  margin: 0;
}

.ig-provenance .ig-id,
.ig-hold .ig-id,
.ig-caveat .ig-id {
  color: var(--ig-text);
}

/* A NUMBER IN A SMALL LINE READS SMALL. .ig-id gives an issue number the body
   size on its own; inside an explanation line or the freshness stamp it takes
   the line's size instead, so the line keeps one size. */
.ig-provenance .ig-id,
.ig-hold .ig-id,
.ig-caveat .ig-id,
.ig-freshness .ig-id {
  font-size: inherit;
}

/* A KEY A READER COPIES AS TYPED, such as label:P0, is the one thing set mono.
   It takes no size of its own, so it reads at the size of whatever line it
   sits in; tabular figures because a key can carry digits. */
.ig-copy-key {
  font-family: var(--ig-font-mono);
  font-variant-numeric: tabular-nums;
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

/* ONE TAG PER CELL, AS THE EXPORT DRAWS IT (issue 293): a pill 20 tall, padded 0 8
   on the second fill, with no border. The large radius rounds a tag this tall
   fully; the theme carries no pill radius, and the loop tag on a capsule card
   takes the same corner. The height is the wide space step because the theme
   has no tag height of its own and the export's tag is exactly that tall.

   A TAG, AS THE EXPORT DRAWS ONE: the small role in the sans at medium
   weight. "P3" and a hold label are words a reader reads, not keys they copy,
   so neither is mono. The graph's chip packer measures every chip with
   --ig-label-char-width, the label face's average at this same small size,
   and pads each by this rule's inline padding, so the card it reserves still
   fits the chip. */
.ig-badge {
  align-items: center;
  background: var(--ig-surface-2);
  block-size: var(--ig-space-wide);
  border: 0;
  border-radius: var(--ig-radius-large);
  color: var(--ig-text);
  display: inline-flex;
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  font-weight: var(--ig-weight-medium);
  gap: var(--ig-space-tight);
  padding: 0 var(--ig-space-snug);
}

/* A MATCHED QUERY IS SAID ONCE ON A LIST ROW, BY ITS LINE (#131). The row's
   provenance line already reads "Picked by query 1 · label:P0", so a chip
   carrying "label:P0" above it printed the same label twice on every row a
   query placed — and no §16 frame draws that chip; §16h gives a row "a single
   provenance line". Hidden by CSS rather than dropped from the markup, for the
   reason the dense rail hides the line instead: the markup stays whole, and
   at the dense density, where the LINE is the one hidden, the rail block
   brings the chip back. A graph card is not an .ig-slot and draws no line, so
   its chip is untouched. A declared tier and a promotion keep their chips:
   those are the scanning read §16a draws beside the sentence. */
.ig-slot .ig-badge[data-priority='query'] {
  display: none;
}

/* A SECOND CONDITION IS MUTED TEXT AFTER THE TAG, NOT A SECOND TAG (issue
   293). The export's rules allow one tag per cell, and its board draws a row's
   relationships ("is blocked by …", "blocks …"), a raise ("from …") and its caveats
   ("Priorities disagree", "Estimated") as plain muted words after the one
   priority tag, with the count of what is left as a muted number. So every
   chip that is not the priority tag drops the pill: no fill, no corner, no
   padding, no fixed height, regular weight in muted ink. The glyph stays: with
   the words it is what tells the five relationships apart, and the canvas's
   dash and terminal carry the rest.

   THE HUE THAT USED TO TINT EACH RELATIONSHIP CHIP WENT WITH ITS PILL. The
   export colours no relationship text, and the theme holds the edge hues to
   the 3:1 non-text bar, so the words could never take the hue anyway. */
.ig-badge[data-edge],
.ig-badge[data-raise],
.ig-badge[data-caveat],
.ig-badge[data-evidence],
.ig-badge[data-not-ready],
.ig-badge[data-omitted] {
  background: none;
  block-size: auto;
  border-radius: 0;
  color: var(--ig-text-muted);
  font-weight: var(--ig-weight-regular);
  padding: 0;
}

/* THE OVERFLOW CHIP IS A COUNT, NOT A RELATIONSHIP. '+12 more relationships'
   names no edge, so it takes the body type every count takes rather than the
   chip's micro mono. The graph card's height is reserved before anything is
   drawn, so the layout measures this chip at the body size too (see
   packedRows in layout.ts); a chip this rule enlarged and the layout did not
   would overrun its card and be drawn over by the next. */
.ig-badge[data-omitted] {
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  font-variant-numeric: tabular-nums;
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

/* THE UNIT'S LABEL IS A SENTENCE-CASE LABEL, NOT AN EYEBROW. The export
   draws "One unit · 2 issues" in the small role at medium weight in text
   colour, with no fill and no capitals, and content.md rules out the small
   uppercase mono label. The unit draws no note since issue 293; the note
   class is the NOW banner's, the same size in muted ink. */
.ig-unit-pill {
  color: var(--ig-text);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  font-variant-numeric: tabular-nums;
  font-weight: var(--ig-weight-medium);
}

/* THE COUNT INSIDE THE LABEL IS REGULAR AND MUTED, as the export sets the
   number in "One unit · 2 issues" (issue 293): the words name the unit, and
   the figure is the quieter part of it. */
.ig-unit-num {
  color: var(--ig-text-muted);
  font-weight: var(--ig-weight-regular);
}

.ig-unit-note {
  color: var(--ig-text-muted);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
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

/* NO RULE OF ITS OWN ON TOP. The last ranked row above already draws its
   bottom rule, and a second one here stacked on it as a doubled line. */
/* THE PANEL HEADER'S LAYOUT, ONE LEVEL DOWN: a kicker and a count chip on one
   line, a sentence under them. The kicker and the chip are the header's own
   classes (see footerHead), so this rule only places them. */
.ig-footer-head {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
  padding: var(--ig-row-padding-block-dense) var(--ig-space-wide);
}

.ig-footer-title-row {
  align-items: center;
  display: flex;
  gap: var(--ig-space);
}

.ig-footer-title {
  margin: 0;
}

.ig-footer .ig-list {
  display: flex;
  flex-direction: column;
}

/* A RANKED ROW'S GRID, PADDING AND RULE, so the group is the rest of the same
   list rather than a panel of its own: the rank track holds the held station,
   and it lines up under the stations above because it is the same track.

   ON THE PANEL'S OWN GROUND, NOT A SECOND SURFACE, and at full strength. The
   group used to sit on --ig-surface-2 with every row at 0.72 opacity, which
   read as disabled — on the rows whose whole purpose is "open me to see why". */
.ig-footer-row {
  border-top: var(--ig-stroke) solid var(--ig-line);
  column-gap: var(--ig-space);
  cursor: pointer;
  display: grid;
  grid-template-columns: var(--ig-rank-column) 1fr;
  /* THE DENSE RANKED ROW'S PADDING, at every width: these rows carry three
     lines where a ranked row carries two, and the wider padding on top of that
     made each one twice the height of its neighbours above. */
  padding: var(--ig-row-padding-block-dense) var(--ig-space-wide);
}

.ig-footer-row:hover {
  background: color-mix(in srgb, var(--ig-text) var(--ig-tint-unit), transparent);
}

/* THE RANKED ROW'S SELECTED BAND, and its fill: one selection, one look,
   whichever part of the list it was made in. */
.ig-footer-row[aria-current='true'] {
  background: var(--ig-surface);
  box-shadow: inset var(--ig-band-rail) 0 0 var(--ig-accent);
}

.ig-footer-row .ig-title {
  color: var(--ig-text-body);
}

.ig-footer-row[aria-current='true'] .ig-title {
  color: var(--ig-text);
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
  color: var(--ig-text-muted);
}

.ig-card[data-exclusion='true'] {
  border-style: dotted;
  border-color: color-mix(in srgb, var(--ig-edge-duplicate-of) var(--ig-tint-border), transparent);
}

.ig-card[data-held='true'] {
  background: transparent;
  border-style: dashed;
  color: var(--ig-text-muted);
}

/* The card's own text roles set their colour, so the card's muted colour has
   to be named on them too, or only the unstyled text would dim. */
.ig-card[data-column='right'] .ig-title,
.ig-card[data-held='true'] .ig-title {
  color: var(--ig-text-muted);
}

.ig-card[data-now='true'] {
  background: color-mix(in srgb, var(--ig-accent) var(--ig-tint-wash), transparent);
  border-color: color-mix(in srgb, var(--ig-accent) var(--ig-tint-border), transparent);
}

.ig-card[data-unit='true'] {
  background: color-mix(in srgb, var(--ig-accent) var(--ig-tint-unit), transparent);
  border-color: var(--ig-accent);
}

/* A SELECTED CARD IS INVERTED: filled with --ig-text, every text on it in
   --ig-bg. Every descendant is named, because the card's
   text roles set their own colours and a chip or badge tinted for the light
   ground would vanish on the dark one. Each member of a selected set is drawn
   this way; what is outside the set recedes. */
.ig-rail-row[aria-current='true'] .ig-card {
  background: var(--ig-text);
  border-color: var(--ig-text);
  border-style: solid;
  box-shadow: 0 0 0 var(--ig-band-rail) color-mix(in srgb, var(--ig-accent) var(--ig-tint-border), transparent);
  color: var(--ig-bg);
}

.ig-rail-row[aria-current='true'] .ig-card * {
  background: transparent;
  border-color: var(--ig-bg);
  color: var(--ig-bg);
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

/* ── what recedes around a selection ───────────────────────────────────── */

/* EVERYTHING THAT DOES NOT TOUCH THE SELECTION RECEDES, so its neighbours read
   first. The graph stamps data-recede='true' on each receding card row, spine
   station, footer row, line and terminal, and the list stamps each receding
   order row and footer row; these rules draw the stamp.

   NO RULE HERE USES opacity OR filter. Fading a card by opacity fades its text
   below the contrast the theme's text roles promise, so a card recedes by
   colour instead: the second surface, with muted labels, and a list row
   recedes the same way a card does. A line or terminal
   recedes by stroke-opacity and fill-opacity on the stamped element itself,
   never on a kind's class, so the legend's samples never dim. No rule touches
   a dash, a border style or a stroke width: those carry each kind's line.

   THESE RULES COME LAST AND MATCH OR BEAT EVERY VARIANT'S SPECIFICITY, so a
   held, unit, gutter or now card still recedes the same way. styles.test.ts
   checks that order. */
.ig-canvas path[data-recede='true'],
.ig-canvas circle[data-recede='true'] {
  fill-opacity: ${RECEDE_ALPHA};
  stroke-opacity: ${RECEDE_ALPHA};
}

.ig-rail-row[data-recede='true'] .ig-card {
  background: var(--ig-surface-2);
}

/* A LIST ROW TAKES THE CARD'S GROUND through background-color alone, so any
   background-image on the row survives on the second surface. The
   panel class lifts each rule to the card rule's specificity. The footer rule
   is scoped to the list, whose root and detached footer both carry ig-linear,
   because the graph draws its footer rows without a ground. */
.ig-viewer .ig-slot[data-recede='true'],
.ig-linear .ig-footer-row[data-recede='true'] {
  background-color: var(--ig-surface-2);
}

.ig-rail-row[data-recede='true'] .ig-title,
.ig-rail-row[data-recede='true'] .ig-id,
.ig-rail-row[data-recede='true'] .ig-hold,
.ig-rail-row[data-recede='true'] .ig-unit-note,
.ig-slot[data-recede='true'] .ig-title,
.ig-slot[data-recede='true'] .ig-id,
.ig-slot[data-recede='true'] .ig-hold,
.ig-slot[data-recede='true'] .ig-unit-note,
.ig-footer-row[data-recede='true'] .ig-title,
.ig-linear .ig-footer-row[data-recede='true'] .ig-id {
  color: var(--ig-text-muted);
}

/* The priority tag keeps its words and loses its chip, so a receded card
   carries no filled shape that competes with the kept ones. The tag draws no
   border since issue 293; the border colour stays transparent here so a host
   rule that gives it one cannot bring the chip back. */
.ig-rail-row[data-recede='true'] .ig-badge[data-priority],
.ig-slot[data-recede='true'] .ig-badge[data-priority] {
  background: transparent;
  border-color: transparent;
  color: var(--ig-text);
}

/* A RECEDED STATION MIXES ITS OWN COLOURS WITH THE PAGE GROUND, never with
   transparent and never by opacity: the station has to stay opaque, because
   it sits on the spine line and covers it. Mixing over --ig-bg also makes what
   is drawn equal to what the contrast test composites. Each variant names its
   own hue, in the same order the variants above set it.

   THE RANK NUMERAL IS TEXT AND KEEPS 4.5:1 ON WHAT IT SITS ON. A ring, dashed
   or serialize station is hollow, so its numeral sits on --ig-bg and reads
   --ig-text-muted, like every other receded label. A filled station's numeral
   sits on its mixed fill instead, and --ig-text-muted there falls under 4.5:1
   in both themes, so it reads --ig-text, which clears it. theme.test.ts
   measures both. */
.ig-spine-station[data-recede='true'] {
  border-color: color-mix(in srgb, var(--ig-station-ready) ${RECEDE_PERCENT}, var(--ig-bg));
  color: var(--ig-text-muted);
}

.ig-spine-station[data-fill='filled'][data-recede='true'] {
  background: color-mix(in srgb, var(--ig-station-ready) ${RECEDE_PERCENT}, var(--ig-bg));
  color: var(--ig-text);
}

.ig-spine-station[data-fill='dashed'][data-recede='true'] {
  border-color: color-mix(in srgb, var(--ig-station-held) ${RECEDE_PERCENT}, var(--ig-bg));
}

.ig-spine-station[data-wait='serialize'][data-recede='true'] {
  border-color: color-mix(in srgb, var(--ig-edge-serialize-with) ${RECEDE_PERCENT}, var(--ig-bg));
}

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

/* A CAPSULE'S LOOP IS A TAG IN THE ERROR STATE (issue 293), the same tag the
   editor's capsule board draws: the small role at medium weight in the failed
   hue on the error fill, a pill the wide space step tall, padded 0 8. It sits
   in an HTML list the graph's packer never measures. */
.ig-loop-tag {
  align-items: center;
  align-self: center;
  background: var(--ig-state-failed-fill);
  block-size: var(--ig-space-wide);
  border-radius: var(--ig-radius-large);
  color: var(--ig-state-failed);
  display: inline-flex;
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  font-weight: var(--ig-weight-medium);
  padding: 0 var(--ig-space-snug);
  white-space: nowrap;
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

/* ── loading placeholder ───────────────────────────────────────────────── */

/* THE HOST'S HOOK, AND THE ONLY ONE. Every placeholder shape is one of these,
   on one static fill and holding still, as the skeleton rules have it: the
   fill-strong role, and no pulse. Since issue 293 that is its own token, an
   ink at a low alpha, so this package's own themes draw the skeleton as a
   host's fill-strong does. This package ships no motion, and the fill follows
   the host's theme.

   THE SHAPES FOLLOW THOSE RULES TOO. A line of text, a heading or a figure is
   a pill one snug step tall, set in that line's own height by its margins, so
   nothing moves when the text arrives. A control or an icon is a pill its own
   size. A block is a rectangle with the card's corner. */
.ig-skeleton-block {
  background: var(--ig-fill-strong);
  border-radius: var(--ig-space-snug);
  display: block;
}

.ig-skeleton-block[data-shape='label'] {
  block-size: var(--ig-space-snug);
  inline-size: calc(var(--ig-char-width) * 14);
  margin-block: calc((var(--ig-row-meta-line) - var(--ig-space-snug)) / 2);
}

.ig-skeleton-chips {
  display: flex;
  gap: var(--ig-space-snug);
}

.ig-skeleton-block[data-shape='chip'] {
  block-size: calc(var(--ig-space) * 2);
  border-radius: var(--ig-space);
  inline-size: calc(var(--ig-char-width) * 9);
}

.ig-skeleton-block[data-shape='station'] {
  block-size: var(--ig-space);
  border-radius: 50%;
  inline-size: var(--ig-space);
}

/* THE ROW'S OWN LINE HEIGHTS, so a placeholder row and a real row are the same
   height at every density the container picks: each pill is one snug step
   tall and its margins make up the rest of its line. */
.ig-skeleton-block[data-shape='title'] {
  block-size: var(--ig-space-snug);
  inline-size: 68%;
  margin-block: calc((var(--ig-row-title-line) - var(--ig-space-snug)) / 2);
}

.ig-skeleton-block[data-shape='title'][data-width='1'] {
  inline-size: 54%;
}

.ig-skeleton-block[data-shape='title'][data-width='2'] {
  inline-size: 82%;
}

.ig-skeleton-block[data-shape='meta'] {
  block-size: var(--ig-space-snug);
  inline-size: 36%;
  margin-block: calc((var(--ig-row-meta-line) - var(--ig-space-snug)) / 2);
}

/* THE TWO LINES OF A ROW, stacked with no gap of their own: each block with
   its margins is its line's full height, which already carries the leading a
   real line has. Flex items' margins do not collapse, so the sum holds. */
.ig-skeleton-lines {
  display: flex;
  flex-direction: column;
}

/* A placeholder row points at nothing, so it takes no pointer and no hover. */
.ig-skeleton-row {
  pointer-events: none;
}

.ig-skeleton-stage {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-wide);
  padding: var(--ig-space-wide);
}

/* THE SPINE CARD'S OWN WIDTH, so the graph's placeholder sits where its cards
   will, as one solid block: a block, so the card's corner, the large radius
   the panel's cards use. */
.ig-skeleton-block[data-shape='card'] {
  block-size: calc(var(--ig-station-box) * 4);
  border-radius: var(--ig-radius-large);
  inline-size: min(100%, var(--ig-spine-width));
}

/* ── legend ────────────────────────────────────────────────────────────── */

/* A FOOTER BAR, WHERE §16b PUTS IT, and worded rather than glyph-only. It sits
   under the drawing it explains, carries a drawn sample of each line so the
   dash and terminal channels are legible cold, and ends with the readiness key
   the station fills need. */
/* NO GROUND OF ITS OWN (issue 293): the export's legend sits on the drawing's
   own surface under its hairline, with no band of a second fill. */
.ig-legend {
  align-items: center;
  border: 0;
  border-top: var(--ig-stroke) solid var(--ig-line);
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space-wide);
  margin: 0;
  padding: var(--ig-space) var(--ig-space-wide);
}

/* NO VISIBLE CAPTION. The bar is named by its aria-label, which is what the
   export draws: content.md rules out the small uppercase label above a group,
   and the five drawn samples already say what the bar is. With no legend
   element in the fieldset there is no rendered-legend slot either, so the
   float that used to keep a caption out of it went with the caption. */
/* THE KEYS LINE TAKES THE SMALL ROLE, IN THE SANS. Its words are a legend, not
   keys a reader types, so they are not mono; and a legend explains the drawing
   rather than competing with it, so it sits a step below the body in muted
   ink. Tabular figures as everywhere a figure appears. Each item's glyph keeps
   the mono face .ig-glyph gives it. */
.ig-legend-item {
  align-items: center;
  color: var(--ig-text-muted);
  display: inline-flex;
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  font-variant-numeric: tabular-nums;
  gap: var(--ig-space-tight);
}

.ig-legend-keys {
  display: inline-flex;
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  font-variant-numeric: tabular-nums;
  gap: var(--ig-space-loose);
  margin-inline-start: auto;
}
`;
