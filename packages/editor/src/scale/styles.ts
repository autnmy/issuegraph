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
 * IT ADDS SELECTORS RATHER THAN REDEFINING THEM. The refusal, its capsules and
 * their counts already have a look — this file styles only what layer 2
 * introduces: the ladder container, the routes, the search box, the isolated
 * chip and the list it opens.
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

.ig-isolated-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-isolated-list .ig-id {
  font-family: var(--ig-font-mono);
  color: var(--ig-text-muted);
}
`;
