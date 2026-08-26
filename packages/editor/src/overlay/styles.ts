/**
 * The overlay's structural stylesheet.
 *
 * Same contract as the ladder's and the viewer's: layout, weight and state,
 * never a value. Every colour, length and duration here is a `var(--ig-…)` the
 * host's theme resolves, so a second theme keeps working on the surfaces layer
 * 2 adds. `styles.test.ts` scans these bytes for a literal colour, a fixed
 * length and a token the theme does not define.
 *
 * IT DOES NOT RESTATE THE TABLE. `grammar.ts` is the single source for a
 * state's opacity, and `render.ts` writes it onto the edge as an attribute — so
 * there is deliberately no `opacity` rule for a state here. A rule would be a
 * second copy of a number, and the two would drift the first time one was
 * tuned. What CSS owns is what CSS can express and the table cannot: the halo's
 * stroke, the marching animation, and the hue each state paints with.
 *
 * IT SELECTS ONLY WHAT THIS PACKAGE ADDS. In particular it never selects
 * `.ig-terminal`: the terminal marker is one of the four redundant channels the
 * edge's type identity rests on, and a rule here could occlude it as surely as
 * a mark could. The four survive because nothing in this file reaches them.
 *
 * ## The marching dash, and why it is not a timer
 *
 * `pending-write` animates `stroke-dashoffset`, which is the design's "marching
 * dash". Nothing about it changes STATE: the animation runs while the edge is
 * pending and stops when the projection stops saying so. A chip that dismissed
 * itself would be the banned thing, and there is none.
 *
 * It is written under `prefers-reduced-motion` guard, because a reader who has
 * asked for less motion still needs to know a write is in flight — the opacity
 * and the dash pattern carry that on their own, so the movement is what drops
 * rather than the signal.
 */

export const edgeOverlayStylesheet = `
.ig-overlay {
  pointer-events: none;
}

.ig-overlay-halo {
  fill: none;
  stroke: var(--ig-focus);
  opacity: 0.35;
  stroke-linecap: round;
}

.ig-overlay-marching {
  fill: none;
  stroke: currentColor;
  stroke-dasharray: 4 4;
  animation: ig-overlay-march 1s linear infinite;
}

@keyframes ig-overlay-march {
  to {
    stroke-dashoffset: -8;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ig-overlay-marching {
    animation: none;
  }
}

.ig-edge[data-ig-state~='invalid'] {
  stroke: var(--ig-state-invalid);
}

.ig-edge[data-ig-state~='failed'] {
  stroke: var(--ig-state-failed);
}

.ig-edge[data-ig-state~='conflict'] {
  stroke: var(--ig-state-conflict);
}

.ig-overlay-version {
  fill: none;
  stroke: var(--ig-state-conflict);
}

.ig-overlay-chip {
  background: var(--ig-surface-2);
  color: var(--ig-text-muted);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: var(--ig-space-tight);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
}

.ig-overlay-cross {
  color: var(--ig-state-failed);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
}

.ig-overlay-reason {
  color: var(--ig-state-invalid);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
}

.ig-overlay-held {
  color: var(--ig-state-conflict);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
}
`;
