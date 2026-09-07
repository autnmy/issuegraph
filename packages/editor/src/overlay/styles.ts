/**
 * The overlay's structural stylesheet.
 *
 * Same contract as the ladder's and the viewer's: layout, weight and state,
 * never a value. Every colour, length and duration here is a `var(--ig-…)` the
 * host's theme resolves, so a second theme keeps working on the surfaces layer
 * 2 adds. `styles.test.ts` scans these bytes for a literal colour, a fixed
 * length and a token the theme does not define.
 *
 * IT DECLARES NO OPACITY AT ALL. `grammar.ts` is the single source for every
 * alpha this package applies, and `render.ts` writes each onto its element —
 * so there is deliberately no `opacity` rule here, for a state OR for a mark.
 *
 * That rule was written for the state opacities and then broken by the halo,
 * which was styled here at 0.35 because it is not a state. The composited
 * contrast check reads the grammar, so the one alpha it could not see was the
 * one that failed the 3:1 bar. `styles.test.ts` now enforces the rule instead
 * of stating it. A rule would be a
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
  stroke-linecap: round;
}

/* The stroke is set per element from the treatment table — a state's own hue
   where it has one, the relationship's where it does not — for the same reason
   the viewer sets its dash per element: one source for a channel. */
.ig-overlay-dash {
  fill: none;
}

.ig-overlay-marching {
  stroke-dasharray: 4 4;
  animation: ig-overlay-march 1s linear infinite;
}

.ig-overlay-dotted {
  stroke-dasharray: 1 3;
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

/* QUALIFIED, AND THE QUALIFICATION IS THE WHOLE RULE — it is what makes these
   three declarations apply at all.

   They used to be bare, and the comment here explained why: a together-with was
   drawn as a CONNECTOR rather than an edge path, so an edge-anchored rule left
   one of the five relationships unstyled. Both halves of that have since stopped
   being true, and nothing noticed either.

   The connector is gone — layer 1's section-16 pass draws a together unit as ONE
   card with its members listed inside, so the relationship's whole drawn form is
   its badge, and the badge rules below are what reach it.

   And the bare selector never painted an edge. A drawn path carries BOTH the edge
   class with its kind attribute, which the viewer hues at specificity (0,2,0), and
   the state attribute, which at (0,1,0) loses to it — and specificity beats source
   order, so concatenating this sheet last changed nothing. Measured in a browser:
   a conflicted blocked-by edge computed the relationship's own red, never the
   state's gold.

   So the bare rules matched exactly two kinds of element and were dead on both.
   On a path they lost the cascade; on a badge they set a stroke, which a span has
   no use for.

   invalid was the only state that looked right, and by accident: it is the one
   settled state carrying a dash, so render.ts builds a CLONE for it, and a clone
   drops its class — which is precisely why that file sets the stroke inline on
   one. The states that build no clone had nothing to fall back on, which is why
   failed rendered identically to invalid, and conflict identically to a settled
   edge.

   The kind attribute is carried by every drawn path and by nothing else, so adding
   it reaches (0,3,0) and wins OUTRIGHT rather than by tying and being placed later.
   A tie would work today and would break the first time a host reordered the
   sheets — and this rule has already failed silently once.

   (No backticks in here: this is inside a template literal, and one ends it.) */
.ig-edge[data-edge][data-ig-state~='invalid'] {
  stroke: var(--ig-state-invalid);
}

.ig-edge[data-edge][data-ig-state~='failed'] {
  stroke: var(--ig-state-failed);
}

.ig-edge[data-edge][data-ig-state~='conflict'] {
  stroke: var(--ig-state-conflict);
}

/* A BADGE IS NOT A STROKE, AND SOME RELATIONSHIPS ARE ONLY A BADGE.
   together-with is drawn as no line at all — it shares a rank rather than
   ordering anything, and layer 1 draws the unit as one card with its members
   listed inside — so the chip that names it is its entire representation. The
   marks this module clones from a stroke cannot be cloned from a span, and the
   stroke rules above paint a property a span does not have: an in-flight or
   refused together-edge therefore read exactly like a settled one, with the
   state visible only to a screen reader.

   So a chip states the state with what a chip HAS: its border and its ink.
   Every state the drawn edge distinguishes, distinguished here too — including
   the two that have no hue of their own, where a stroke uses a ghost or a halo
   and a chip uses a dash and the focus ring. */
.ig-badge[data-ig-state~='invalid'] {
  border-color: var(--ig-state-invalid);
  color: var(--ig-state-invalid);
}

.ig-badge[data-ig-state~='failed'] {
  border-color: var(--ig-state-failed);
  color: var(--ig-state-failed);
}

.ig-badge[data-ig-state~='conflict'] {
  border-color: var(--ig-state-conflict);
  color: var(--ig-state-conflict);
}

/* Pending is the state with no hue: the drawn edge says it with a dashed ghost,
   and a chip says it with a dashed border of its own. */
.ig-badge[data-ig-state~='pending-write'] {
  border-style: dashed;
}

/* Selected is the focus ring's meaning, and the theme says so where it declares
   the token — selected is deliberately not an edit-state hue. */
.ig-badge[data-ig-state~='selected'] {
  box-shadow: 0 0 0 var(--ig-stroke) var(--ig-focus);
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
