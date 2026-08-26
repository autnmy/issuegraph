/**
 * The re-evaluate surface's structural stylesheet.
 *
 * Same contract as the viewer's and the ladder's: layout, weight and state,
 * never a value. Every colour, length and font is a `var(--ig-…)` the host's
 * theme resolves, so a second theme keeps working here too, and
 * `styles.test.ts` scans these bytes for a literal or an unresolvable token.
 *
 * IT ADDS SELECTORS RATHER THAN REDEFINING THEM, with one deliberate exception
 * that is worth naming: the greyed rail. `.ig-reevaluate[data-order='held']
 * .ig-viewer` reaches a layer-1 class — but only from INSIDE this surface's own
 * root, and only for a state layer 1 does not model. The viewer draws the order
 * it is handed; whether that order is the current one is a fact only the store
 * knows, so the label and the greying belong to whoever knows it. Nothing here
 * changes how the rail looks outside this surface.
 *
 * There is no transition and no animation, anywhere in this file. The design
 * rejected the animated re-sort because rows moving under the cursor mean the
 * next edit targets the wrong thing, and it rejected the toast because the only
 * evidence the edit worked disappears before it is read. A stylesheet is a
 * place both could creep back in.
 */

export const reevaluateStylesheet = `
.ig-reevaluate {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  line-height: var(--ig-line-height);
  color: var(--ig-text-body);
}

/* Greyed one step, and never hidden: a stale order that is labelled is still
   the most useful thing on the screen. */
.ig-reevaluate[data-order='held'] .ig-viewer {
  color: var(--ig-text-muted);
}

.ig-order-computing {
  margin: 0;
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-small);
}

.ig-change-summary {
  display: flex;
  gap: var(--ig-space);
  align-items: baseline;
  flex-wrap: wrap;
}

.ig-change-line {
  display: flex;
  align-items: baseline;
}

.ig-change-parts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  /* The blast radius reads as ONE line. The gap is the separator, so no
     punctuation glyph is baked into the markup — that would be a second
     language choice on top of the words themselves. */
  gap: var(--ig-space);
}

.ig-change-part {
  display: flex;
  gap: var(--ig-space-tight);
  align-items: baseline;
}

.ig-change-count {
  font-family: var(--ig-font-mono);
  color: var(--ig-text);
}

.ig-change-word {
  color: var(--ig-text-body);
}

.ig-change-unchanged {
  margin: 0;
  color: var(--ig-text-body);
}

.ig-change-dismiss {
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

.ig-change-dismiss:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

.ig-delta-overlay {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-delta-chip {
  display: flex;
  gap: var(--ig-space-tight);
  align-items: baseline;
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: var(--ig-space-tight);
  background: var(--ig-surface-2);
}

.ig-delta-member {
  display: flex;
  gap: var(--ig-space-tight);
  align-items: baseline;
}

.ig-delta-move[data-direction='up'] .ig-change-count {
  color: var(--ig-station-ready);
}

.ig-delta-move[data-direction='down'] .ig-change-count {
  color: var(--ig-text-muted);
}

.ig-delta-readiness[data-readiness='promoted'] {
  color: var(--ig-station-ready);
}

.ig-delta-readiness[data-readiness='newly-held'] {
  color: var(--ig-station-held);
}

.ig-delta-presence {
  color: var(--ig-text-muted);
}
`;
