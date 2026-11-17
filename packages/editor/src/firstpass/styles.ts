/**
 * The first pass's structural stylesheet.
 *
 * Same contract as the picker's, the ladder's and the overlay's: layout, weight
 * and state, never a value. Every colour, length and font is a `var(--ig-…)`
 * the host's theme resolves, and `styles.test.ts` scans these bytes for a
 * literal colour, a fixed length and a token the theme does not define — so the
 * rule is enforced rather than remembered.
 *
 * IT ADDS SELECTORS RATHER THAN REDEFINING THEM. Nothing here reaches into the
 * viewer's own classes; this file styles only what the first pass introduces.
 *
 * ## The statement is a FLEX ROW, and that is load-bearing
 *
 * `render.ts` draws the proposed relationship subject · kind · object and calls
 * that word order a default a host may bypass. The CSS `order` property
 * reorders flex children and does nothing to inline text, so laying it out any
 * other way would make that claim true only in principle — the same reasoning
 * the picker's stylesheet records, and enforced by the same kind of test.
 *
 * ## There is no progress BAR, and its absence is the design
 *
 * §17e: "100% encoded is never the goal and the workspace never implies it is."
 * A bar implies a target by its geometry — an unfilled tail reads as work
 * outstanding whatever the words beside it say. The progress line is therefore
 * typographic, and this sheet gives it no track, no fill and no width driven by
 * the counts. A host that wants a bar draws one knowing what it is claiming.
 *
 * ## Every control gets a focus ring
 *
 * The queue is keyboard-first, so a control with no `:focus-visible` rule is
 * unreachable for the reader this surface is built for on any host that resets
 * the UA outline. Enforced in `styles.test.ts`.
 */

export const firstPassStylesheet = `
.ig-firstpass {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  line-height: var(--ig-line-height);
  color: var(--ig-text-body);
  background: var(--ig-surface);
  border-radius: var(--ig-radius);
  padding: var(--ig-space);
}

.ig-firstpass-question {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-firstpass-statement {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--ig-space-tight);
  margin: 0;
  color: var(--ig-text);
}

.ig-firstpass-ref {
  font-family: var(--ig-font-mono);
}

.ig-firstpass-kind {
  font-family: var(--ig-font-mono);
  color: var(--ig-text-muted);
}

.ig-firstpass-evidence {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
  border-left: var(--ig-stroke) solid var(--ig-line);
  padding-left: var(--ig-space);
}

.ig-firstpass-evidence-label {
  margin: 0;
  font-size: var(--ig-font-size-small);
  color: var(--ig-text-muted);
}

.ig-firstpass-evidence-list {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ig-firstpass-evidence-item {
  font-size: var(--ig-font-size-small);
  color: var(--ig-text-body);
}

.ig-firstpass-answers {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space-tight);
}

.ig-firstpass-answer,
.ig-firstpass-undo {
  font: inherit;
  color: var(--ig-text);
  background: var(--ig-surface-2);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: var(--ig-space-tight) var(--ig-space);
  cursor: pointer;
}

/* An answer lays its words and its key side by side, as the export's buttons
   do, so the gap and not the space in the markup sets the distance between
   them. */
.ig-firstpass-answer {
  display: inline-flex;
  align-items: center;
  gap: var(--ig-space-snug);
}

/* THE KEY THAT GIVES THE ANSWER, as the export's keyboard hint: muted ink on
   the panel ground inside a hairline, at a small radius. The export sets it in
   an 11px caption on a 16px line in a 20px box; no theme token holds those, so
   it takes the small size and the body line. */
.ig-firstpass-key {
  display: inline-flex;
  align-items: center;
  margin-left: var(--ig-space-tight);
  padding: 0 var(--ig-space-tight);
  border-radius: var(--ig-radius-small);
  background: var(--ig-bg);
  box-shadow: inset 0 0 0 var(--ig-hairline-width) var(--ig-hairline);
  color: var(--ig-text-muted);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  line-height: var(--ig-line-height);
}

/* The one answer that writes. Weighted so the irreversible option is the one
   the eye lands on — §17e's consent rule is about knowing what you agreed to,
   and that starts before the keystroke. */
.ig-firstpass-answer[data-ig-answer='apply'] {
  border-color: var(--ig-accent);
}

.ig-firstpass-undo {
  align-self: flex-start;
  color: var(--ig-text-muted);
}

.ig-firstpass-answer:focus-visible,
.ig-firstpass-undo:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-stroke);
}

/* THE TITLE ROW, drawn only when the host asks for a heading: the heading at
   the start and the count at the end of one line, centred on each other, as
   the export draws its "Suggested relationships" row. */
.ig-firstpass-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ig-space);
}

/* The export's panel title: one step above the body, at medium weight, in
   text ink — the treatment the audit panel's heading already takes. */
.ig-firstpass-heading {
  margin: 0;
  color: var(--ig-text);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-panel-title);
  font-weight: var(--ig-weight-medium);
  line-height: var(--ig-panel-title-line);
}

.ig-firstpass-progress {
  margin: 0;
  font-size: var(--ig-font-size-small);
  color: var(--ig-text-muted);
}

/* In the title row the count is the export's: the body size with tabular
   figures, so its digits hold still as the answers climb. */
.ig-firstpass-title .ig-firstpass-progress {
  font-size: var(--ig-font-size);
  font-variant-numeric: tabular-nums;
}

.ig-firstpass-finished,
.ig-firstpass-empty {
  margin: 0;
  color: var(--ig-text);
}
`;
