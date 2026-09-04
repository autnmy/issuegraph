/**
 * The mount's chrome stylesheet: the controls the mount draws beside the
 * package's own panels, and nothing the panels already style.
 *
 * Same contract as the workspace's, the picker's and the ladder's — layout,
 * weight and state, never a value. Every colour, length and font is a
 * `var(--ig-…)` the host's theme resolves, and `mount.test.ts` scans these
 * bytes for a literal or an unresolvable token, so the rule is enforced rather
 * than remembered.
 *
 * What is styled here is exactly what `mount.ts` builds with `createElement`:
 * the add button, the kind chooser, the target search and its matches, the
 * delete button, the key hints, and the floating chooser a canvas drop places.
 * The picker inside the inspector ships its own sheet, installed alongside.
 *
 * Shipped as a string for the same reason every sibling sheet is: an entry
 * that imports CSS cannot be loaded by a bare Node runtime, and a string needs
 * no bundler.
 */

export const mountStylesheet = `
.ig-mount {
  position: relative;
  height: 100%;
  min-height: 0;
}

.ig-mount > .ig-workspace {
  /* THE FLOATING CHOOSER'S BOX. A canvas drop places the kind chooser inside
     the workspace root, so a host that scopes its theme to that root still
     resolves the chooser's tokens; the root is the positioning box for it. */
  position: relative;
  height: 100%;
  box-sizing: border-box;
}

.ig-mount[data-dragging='true'] {
  cursor: grabbing;
  user-select: none;
}

.ig-chrome {
  padding: var(--ig-space-tight) var(--ig-space);
  border-top: var(--ig-stroke) solid var(--ig-line);
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  line-height: var(--ig-line-height);
  color: var(--ig-text-body);
}

.ig-chrome-sentence {
  margin: 0;
  font-family: var(--ig-font-mono);
  color: var(--ig-text);
}

.ig-chrome-button {
  font: inherit;
  font-size: var(--ig-font-size-small);
  color: var(--ig-text);
  background: var(--ig-surface-2);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: var(--ig-space-tight) var(--ig-space);
  cursor: pointer;
  text-align: left;
}

.ig-chrome-button:hover {
  border-color: var(--ig-accent);
}

.ig-chrome-button:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

.ig-chrome-quiet {
  background: none;
  color: var(--ig-text-muted);
}

.ig-chrome-danger {
  color: var(--ig-state-failed);
  border-color: var(--ig-state-failed);
}

.ig-chrome-input {
  font: inherit;
  font-size: var(--ig-font-size-small);
  color: var(--ig-text);
  background: var(--ig-surface-2);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: var(--ig-space-tight) var(--ig-space);
  width: 100%;
  box-sizing: border-box;
}

.ig-chrome-input:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

.ig-chrome-kinds {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

/* EACH KIND CARRIES ITS HUE ON THE LEFT, the same hue the viewer draws the
   edge in, so the chooser and the canvas name a relationship the same way. */
.ig-chrome-kinds .ig-chrome-button {
  border-left: var(--ig-terminal-width) solid var(--ig-line);
}

.ig-chrome-kinds [data-edge='blocked-by'] {
  border-left-color: var(--ig-edge-blocked-by);
}

.ig-chrome-kinds [data-edge='serialize-with'] {
  border-left-color: var(--ig-edge-serialize-with);
}

.ig-chrome-kinds [data-edge='together-with'] {
  border-left-color: var(--ig-edge-together-with);
}

.ig-chrome-kinds [data-edge='duplicate-of'] {
  border-left-color: var(--ig-edge-duplicate-of);
}

.ig-chrome-kinds [data-edge='decomposed-from'] {
  border-left-color: var(--ig-edge-decomposed-from);
}

.ig-chrome-matches {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-chrome-match {
  width: 100%;
}

.ig-chrome-search,
.ig-chrome-chooser {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

/* PLACED BY THE MOUNT, at the drop point \`pickerPlacement\` chose: \`left\` and
   \`top\` are written inline on the element, so this rule carries the box and
   nothing about where it sits. */
.ig-chrome-floating {
  position: absolute;
  width: calc(var(--ig-char-width) * 40);
  padding: var(--ig-space-tight) var(--ig-space);
  background: var(--ig-surface-2);
  border: var(--ig-stroke) solid var(--ig-accent);
  border-radius: var(--ig-radius);
  z-index: 2;
}

.ig-chrome-keys {
  margin: 0;
  font-size: var(--ig-font-size-small);
  color: var(--ig-text-muted);
}
`;
