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

.ig-ladder-routes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-small);
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
  background: var(--ig-surface-2);
  color: var(--ig-text-body);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: var(--ig-space);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  cursor: pointer;
}

.ig-capsule-enter:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

.ig-capsule-enter:hover {
  border-color: var(--ig-accent);
}

/* THE WHOLE STUCK CARD IS TINTED, as frame 17f draws it — the badge alone puts
   the one finding that stops work outright at the size of every other chip on
   the board. Same hue as the badge inside it, which is blocked-by's, because
   that is the edge the cycle is made of. */
.ig-capsule-enter[data-reach='cyclic'] {
  border-color: var(--ig-edge-blocked-by);
}

.ig-capsule-enter[data-reach='cyclic'] .ig-capsule-reach {
  color: var(--ig-edge-blocked-by);
}

/* THE COUNT LEADS, so it is the one part sized to be read down the board rather
   than within a card. The --ig-font-size-rank token is the one the theme defines
   for exactly this — "the rank number itself" — so a capsule's count and a rail
   rank are one size by declaration rather than by coincidence. */
.ig-capsule-size {
  grid-column: 1;
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-rank);
  font-variant-numeric: tabular-nums;
  color: var(--ig-text);
}

/* END-ALIGNED AND CONTENT-WIDTH. A grid item stretches by default, which drew
   the cycle badge as a full-width bar across the top of the card. The pill is
   the frame's: the blocked count and the cycle sit in one slot, so they read as
   one kind of thing rather than as a bordered badge beside bare text. */
.ig-capsule-load {
  grid-column: 2;
  justify-self: end;
  background: var(--ig-bg);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: var(--ig-space-micro) var(--ig-space-snug);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-small);
  font-variant-numeric: tabular-nums;
  color: var(--ig-text-muted);
}

/* THE NAME AND THE REACH SPAN BOTH COLUMNS, and the name is the one part
   allowed to wrap: a title is arbitrary length, and letting it size the grid
   would make every card on the board a different shape. */
.ig-capsule-name {
  grid-column: 1 / -1;
  color: var(--ig-text);
  min-width: 0;
  overflow-wrap: anywhere;
}

.ig-capsule-reach {
  grid-column: 1 / -1;
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-small);
  font-variant-numeric: tabular-nums;
}

.ig-isolated-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

/* A ROW PER ENTRY, WITH A GAP THE MARKUP DOES NOT SUPPLY. The element helper
   concatenates its children with no whitespace, so the key and the title
   rendered as one run of text — #492Audit log pagination. Latent until §17a
   moved the CONTROL to the rail footer and made this list the thing a reader is
   sent to, rather than a chip's afterthought. */
.ig-isolated-list li {
  display: flex;
  gap: var(--ig-space-tight);
  align-items: baseline;
  min-width: 0;
}

.ig-isolated-list .ig-id {
  font-family: var(--ig-font-mono);
  color: var(--ig-text-muted);
  flex: none;
}
`;
