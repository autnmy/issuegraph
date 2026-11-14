/**
 * The ladder chrome's structural stylesheet.
 *
 * Same contract as the viewer's, and for the same reason: it carries layout,
 * weight and state, never a value. Every colour, length and font here is a
 * `var(--ig-…)` the host's theme resolves, so a second theme keeps working on
 * the surfaces layer 2 adds rather than only on layer 1's. `styles.test.ts`
 * scans these bytes for a literal colour or a fixed length and for a token the
 * theme does not define, so the rule is enforced rather than remembered.
 *
 * IT ADDS SELECTORS RATHER THAN REDEFINING THEM, with ONE declared exception.
 * The refusal and its counts already have a look, so this file styles what
 * layer 2 introduces: the ladder container, the routes, the search box, the
 * isolated chip, the list it opens, and §17f's capsule card. The exception is
 * `.ig-ladder .ig-refusal .ig-list`, which lays layer 1's list out as a board —
 * declared here because the arrangement is this surface's, and scoped so §16's
 * single-column list and the ladder's own search matches are untouched. The
 * capsule CARD is a new class rather than a redefinition of `.ig-capsule` for
 * the same reason, which is why the list item beside it carries no layer 1
 * class at all.
 *
 * Shipped as a string for the same reason the viewer's is: an entry that
 * imports CSS cannot be loaded by a bare Node runtime, and a string needs no
 * bundler.
 */

export const scaleLadderStylesheet = `
.ig-ladder {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  line-height: var(--ig-line-height);
  color: var(--ig-text-body);
}

.ig-ladder-search {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-ladder-search input {
  background: var(--ig-surface);
  color: var(--ig-text);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: var(--ig-space-tight);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
}

.ig-ladder-search input:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

.ig-ladder-match {
  display: flex;
  gap: var(--ig-space-tight);
  align-items: baseline;
}

.ig-chip {
  align-self: flex-start;
  background: var(--ig-surface-2);
  color: var(--ig-text-body);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: var(--ig-space-tight) var(--ig-space);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  cursor: pointer;
}

.ig-chip:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

.ig-chip[aria-expanded='true'] {
  border-color: var(--ig-accent);
  color: var(--ig-text);
}

/* THE LIST ITEM IS A GRID CELL AND NOTHING ELSE. It deliberately does not
   carry .ig-capsule: that is layer 1's own card, and a card inside a card put
   the stuck tint and the hover on the inner border only. */
.ig-capsule-cell {
  display: flex;
  min-width: 0;
}

/* THE BOARD'S BOX DRAWS NO GROUND AND NO BORDER (issue 296). Layer 1's
   refusal box paints the second fill, which is the group cards' own fill, so
   the cards vanished into it; the export's board sets its cards straight on
   the zone. Scoped to the ladder, so the viewer's own refusal keeps its box. */
.ig-ladder .ig-refusal {
  background: none;
  border: 0;
}

/* FOUR CARDS ACROSS A COLUMN, NOT FOUR ROWS DOWN IT. Frame 17f lays the
   capsules out as a board, which is what makes the counts comparable at a
   glance — the whole reason the count leads. minmax(0, 1fr) rather than a
   width, because this stylesheet declares no fixed length: a title is arbitrary
   and auto would let the longest one set every column. Scoped to the ladder's
   own refusal so §16's single-column list, drawn from the same class in layer
   1, is untouched. */
.ig-ladder .ig-refusal .ig-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--ig-space);
}

/* THE WHOLE CAPSULE IS THE CONTROL, so the button carries the card and the
   list item carries nothing. A button wrapping a card needs its own alignment
   and wrapping reset: a user agent centres and nowraps button content, and both
   are wrong for a four-part card with a title in it. */
.ig-capsule-enter {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: start;
  gap: var(--ig-space-tight) var(--ig-space);
  width: 100%;
  height: 100%;
  text-align: left;
  /* THE EXPORT'S GROUP CARD (issue 296): the second fill at the card corner,
     with no border. */
  background: var(--ig-surface-2);
  color: var(--ig-text-body);
  border: 0;
  border-radius: var(--ig-radius-large);
  padding: var(--ig-space);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  cursor: pointer;
}

.ig-capsule-enter:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

/* With no border to colour, a hovered card takes the stronger fill. */
.ig-capsule-enter:hover {
  background: var(--ig-surface);
}

/* A STUCK CARD SAYS SO ON ITS TAG ALONE (issue 296). It drew blocked-by's hue
   on its border and on its reach line as well, and the export's stuck group is
   the same card as any other with an error Loop tag in it: one state, one mark.
   data-reach stays on the markup for a host that wants to style the stuck card. */

/* THE COUNT LEADS BY ITS PLACE AND ITS INK, NOT ITS FACE. It is a count, and
   every count both packages draw is the body sans at the body size with
   tabular figures (#254), so a column of capsule counts still lines up down the
   board. It was the rank face and size; a rank is a position in the order, which
   a capsule's member count is not. It stays first in the card and at full
   text colour, which is what makes it the part read first. */
.ig-capsule-size {
  grid-column: 1;
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  font-variant-numeric: tabular-nums;
  /* Medium, as the export's group count "38 issues" is (#254 design read). */
  font-weight: var(--ig-weight-medium);
  color: var(--ig-text);
}

/* NO BLOCKED COUNT (issue 296): the export's group card draws none, so the
   chip that held it, and its rule, are gone. */

/* THE CYCLE IS A TAG IN THE ERROR STATE, as the export draws its loop tag: the
   small role in the sans at medium weight, the failed state's colour on the
   failed state's own fill, at the end of the count's row. The theme carries no pill radius, so the corner is the large radius,
   which rounds a tag this tall fully. The fill is the theme's error fill since
   issue 293, so a host maps it to its own; it was the state colour mixed at
   the chip tint, which no host role could name. The tag is the wide space
   step tall, as layer 1's tag is. */
.ig-capsule-loop {
  grid-column: 2;
  justify-self: end;
  align-items: center;
  display: inline-flex;
  background: var(--ig-state-failed-fill);
  block-size: var(--ig-space-wide);
  border-radius: var(--ig-radius-large);
  padding: 0 var(--ig-space-snug);
  color: var(--ig-state-failed);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  font-weight: var(--ig-weight-medium);
  white-space: nowrap;
}

/* THE NAME AND THE REACH SPAN BOTH COLUMNS, and the name is the one part
   allowed to wrap: a title is arbitrary length, and letting it size the grid
   would make every card on the board a different shape. */
/* IN MUTED INK (issue 296), as the export's group card sets its "Around …"
   line: the count above it is the part read first. */
.ig-capsule-name {
  grid-column: 1 / -1;
  color: var(--ig-text-muted);
  min-width: 0;
  overflow-wrap: anywhere;
}

.ig-capsule-reach {
  grid-column: 1 / -1;
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-small);
  font-variant-numeric: tabular-nums;
}

/* A PANEL, NOT A LOOSE COLUMN OF TEXT. With the control moved to the rail
   footer (§17a) this wrapper was left holding an unstyled ol at zero inset:
   it began hard against the zone's own rule, ran on from the graph above it
   with nothing between them, and read as content that had escaped a container
   rather than as the thing the reader had just asked to see.

   THE TOP RULE AND THE PADDING ARE THE CANVAS TOOLBAR'S, because this is the
   same kind of band one row lower — a full-bleed section of the canvas zone,
   not a card floating on it. --ig-bg for the same reason the toolbar takes
   it: the ground this zone already paints, so the two read as one surface. */
.ig-ladder-isolated {
  border-top: var(--ig-stroke) solid var(--ig-line);
  padding: var(--ig-space) var(--ig-space-wide);
}

/* A SECTION HEAD IN THE READ-OUT VOICE the canvas caption and the rail footer
   count already use on this surface — mono, micro, muted, tracked — because it
   carries the same kind of fact and a heavier treatment would make a list of
   issues nobody has to act on the loudest thing in the zone. */
.ig-isolated-caption {
  margin: 0 0 var(--ig-space-tight);
  color: var(--ig-text-muted);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-micro);
  letter-spacing: var(--ig-tracking-group);
  text-transform: uppercase;
}

.ig-isolated-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

/* A ROW PER ENTRY, WITH A GAP THE MARKUP DOES NOT SUPPLY. The element helper
   concatenates its children with no whitespace, so the key and the title
   rendered as one run of text — #492Audit log pagination. Latent until §17a
   moved the CONTROL to the rail footer and made this list the thing a reader is
   sent to, rather than a chip's afterthought. */
/* SEPARATED THE WAY EVERY OTHER LIST OF ISSUES ON THIS SURFACE IS, with a
   hairline between rows rather than a gap between them. A gap left five lines
   of text floating in a column; the rule is what makes them read as rows, and
   it is the treatment the viewer's own order rows already carry. Last row
   included would double the zone's next edge, so it stops one short. */
.ig-isolated-list li {
  display: flex;
  gap: var(--ig-space-tight);
  align-items: baseline;
  min-width: 0;
  padding: var(--ig-space-tight) 0;
}

.ig-isolated-list li + li {
  border-top: var(--ig-stroke) solid var(--ig-line);
}

/* THE KEY IN ITS OWN COLUMN, so five titles start on one edge rather than
   wherever their number happened to end. tabular-nums and a measure in
   characters are what the capsule's own count line already uses for the same
   reason: a ragged left edge on a column of ids reads as a mistake. An issue
   number is read, not copied, so it is the sans layer 1 gives it, not mono;
   the smaller size is this list's own, a column beside the titles. */
.ig-isolated-list .ig-id {
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  font-variant-numeric: tabular-nums;
  color: var(--ig-text-muted);
  flex: none;
  min-inline-size: calc(var(--ig-char-width) * 5);
}

/* The title carries the row, so it takes the body colour and wraps rather than
   setting the row's width — the rule .ig-capsule-name states one file up. */
.ig-isolated-list .ig-title {
  color: var(--ig-text);
  min-width: 0;
  overflow-wrap: anywhere;
}
`;
