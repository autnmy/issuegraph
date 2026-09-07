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

.ig-viewer *,
.ig-viewer *::before,
.ig-viewer *::after {
  box-sizing: border-box;
}

.ig-viewer :focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: calc(var(--ig-focus-ring) * -1);
}

.ig-list {
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
  align-items: center;
  display: flex;
  gap: var(--ig-space);
  justify-content: space-between;
}

.ig-footer-title {
  color: var(--ig-text-body);
  font-size: var(--ig-font-size-compact);
  margin: 0;
}

.ig-footer-labels {
  color: var(--ig-text-muted);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-meta);
}

/* ONE LINE EACH, and the frame is explicit about why: these are not facts
   about the work, so they earn no rank slot and no explanation block. A full
   row here — station, badges, provenance — was claiming the opposite. */
.ig-footer .ig-list {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-snug);
  margin-top: var(--ig-space);
}

.ig-footer-row {
  align-items: center;
  display: flex;
  gap: var(--ig-space-snug);
  opacity: 0.72;
}

.ig-footer-row .ig-title {
  font-size: var(--ig-font-size-compact);
}

.ig-footer-row .ig-id {
  font-size: var(--ig-font-size-meta);
}

.ig-footer-row[aria-current='true'] {
  opacity: 1;
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

.ig-legend-caption {
  color: var(--ig-text-muted);
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
