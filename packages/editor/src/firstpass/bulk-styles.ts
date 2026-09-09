/**
 * The §17e bulk block's rules.
 *
 * Custom properties only — the theme is layer 1's and this sheet writes
 * structure against it, which is the rule the whole package holds and the
 * reason there is no second palette here. Dark is the default theme rather than
 * the only possible one; nothing below names a literal colour.
 *
 * Its own sheet rather than lines in `workspace/styles.ts`, for the reason
 * `reevaluate/styles.ts` gives about itself: the block is drawn by
 * `firstpass/bulk.ts` and a host that installs that surface without the whole
 * workspace would otherwise get unstyled markup.
 */

export const bulkStylesheet = `
.ig-bulk {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--ig-border);
  border-radius: var(--ig-radius, 4px);
  background: var(--ig-surface);
  color: var(--ig-fg);
}

.ig-bulk-head {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.ig-bulk-count {
  margin: 0;
  font-weight: 600;
}

/* THE HINT IS QUIET, NOT HIDDEN. It is the only place the gesture is named, so
   it reads as secondary rather than being dropped to a size a reader skips. */
.ig-bulk-gesture,
.ig-bulk-unshown {
  margin: 0;
  color: var(--ig-fg-muted);
  font-size: 0.875em;
}

.ig-bulk-offers {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* EACH OFFER ON ITS OWN ROW, full width. §17a's inspector is a narrow column,
   and three actions laid side by side there truncate to the point where the
   consequence hint — the half that says what the action DOES — is the part that
   goes. Same reasoning PR #170 recorded for the chips one zone over. */
.ig-bulk-offer-control {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  width: 100%;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--ig-border);
  border-radius: var(--ig-radius, 4px);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

/* THE EDGE'S OWN HUE, read from the treatment's token so the offer is
   recognisably the same relationship the canvas draws. Four redundant channels
   is layer 1's claim and this borrows one of them; it does not replace it. */
.ig-bulk-offer[data-edge='blocked-by'] .ig-bulk-offer-control {
  border-inline-start: 2px solid var(--ig-edge-blocked-by);
}
.ig-bulk-offer[data-edge='serialize-with'] .ig-bulk-offer-control {
  border-inline-start: 2px solid var(--ig-edge-serialize-with);
}
.ig-bulk-offer[data-edge='together-with'] .ig-bulk-offer-control {
  border-inline-start: 2px solid var(--ig-edge-together-with);
}

.ig-bulk-offer-control[aria-pressed='true'] {
  border-color: var(--ig-accent);
}

.ig-bulk-consequence {
  margin-inline-start: auto;
  color: var(--ig-fg-muted);
  font-size: 0.875em;
}

.ig-bulk-target {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.ig-bulk-target-input {
  padding: 0.25rem 0.375rem;
  border: 1px solid var(--ig-border);
  border-radius: var(--ig-radius, 4px);
  background: var(--ig-bg);
  color: inherit;
  font: inherit;
}

.ig-bulk-plan,
.ig-bulk-writing,
.ig-bulk-partial,
.ig-bulk-landed,
.ig-bulk-refusal {
  margin: 0;
}

/* A REFUSAL IS THE INVALID STATE'S HUE, which §17b already owns. Reusing it
   means a reader who has learned what red means on an edge does not have to
   learn a second vocabulary for a refused batch. */
.ig-bulk-refusal {
  color: var(--ig-state-invalid);
}

.ig-bulk-landed {
  color: var(--ig-station-ready, var(--ig-fg));
}

.ig-bulk-owed {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--ig-fg-muted);
  font-size: 0.875em;
}

.ig-bulk-send,
.ig-bulk-confirm,
.ig-bulk-cancel {
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--ig-border);
  border-radius: var(--ig-radius, 4px);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.ig-bulk-send,
.ig-bulk-confirm {
  border-color: var(--ig-accent);
}

/* §17e'S SET, MARKED IN PLACE. The anchor keeps layer 1's aria-current; this is
   the visual half for every member, including the anchor, so a reader sees one
   set rather than one current row and five unmarked ones. Absent on every row
   when the selection is not a set — an attribute stamped everywhere with one
   value meaning "nothing" is marking the row, not leaving it alone. */
.ig-viewer [data-ig-selected='true'] {
  box-shadow: inset 2px 0 0 0 var(--ig-accent);
}
`;
