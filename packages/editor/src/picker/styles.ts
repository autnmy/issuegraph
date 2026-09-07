/**
 * The picker's structural stylesheet.
 *
 * Same contract as the ladder's and the overlay's: layout, weight and state,
 * never a value. Every colour, length and font is a var(--ig-...) the host's
 * theme resolves, and styles.test.ts scans these bytes for a literal colour, a
 * fixed length, and a token the theme does not define — so the rule is enforced
 * rather than remembered.
 *
 * IT ADDS SELECTORS RATHER THAN REDEFINING THEM. Nothing here reaches into the
 * viewer's own classes; this file styles only what the picker introduces.
 *
 * ## §17b's direction statement is no longer styled here
 *
 * This sheet once laid the statement out as a flex row so a host could reorder
 * it with the CSS order property. The statement is `renderWorkspace`'s
 * relationship row now — see `picker/render.ts`'s header for why — and its
 * layout went with it, to `workspace/styles.ts`. Nothing here draws a
 * relationship any more; this sheet styles the kind list and nothing else.
 *
 * Shipped as a string for the same reason the viewer's is: an entry that
 * imports CSS cannot be loaded by a bare Node runtime, and a string needs no
 * bundler.
 */

export const pickerStylesheet = `
.ig-picker {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  line-height: var(--ig-line-height);
  color: var(--ig-text-body);
}

.ig-picker-heading {
  margin: 0;
  font-weight: normal;
  font-size: var(--ig-font-size-small);
  color: var(--ig-text-muted);
}

.ig-picker-kinds {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-picker-choice {
  display: flex;
  align-items: baseline;
  gap: var(--ig-space-tight);
  width: 100%;
  text-align: left;
  background: var(--ig-surface);
  color: var(--ig-text-body);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: var(--ig-space-tight);
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

.ig-picker-choice:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-stroke);
}

/* The kind the edge already carries. Marked on the ROW rather than on the
   button, so a host restyling the control keeps the distinction. */
.ig-picker-kind[data-current='true'] .ig-picker-choice {
  background: var(--ig-surface-2);
  border-color: var(--ig-accent);
  color: var(--ig-text);
}

.ig-picker-current {
  margin-left: auto;
  font-size: var(--ig-font-size-small);
  color: var(--ig-text-muted);
}
`;
