/**
 * The audit's structural stylesheet.
 *
 * Same contract as the viewer's and the ladder's, and for the same reason: it
 * carries layout, weight and state, never a value. Every colour and length is a
 * `var(--ig-…)` the host's theme already resolves, so a second theme keeps
 * working here. `styles.test.ts` scans these bytes for a literal and for a
 * token the theme does not define.
 *
 * NO TOKENS OF ITS OWN, WHICH IS A REVERSAL WORTH RECORDING. An earlier draft
 * declared `--ig-audit-bar` and shipped an `auditThemeCss()` to default it. The
 * failure mode that killed it is the one this package's other stylesheet test
 * exists to catch: a host that installs the viewer's theme and forgets a second
 * one gets a `var()` resolving to nothing, and the bar silently does not draw —
 * "the failure that looks like a styling bug for weeks". Reading the palette's
 * own gold has no such state, and a host who wants a different attention colour
 * still has one: target the attribute in their own CSS, which needs no API from
 * us. Fewer exports is also the safer direction for a package that can add one
 * later and never take one back.
 *
 * THE BAR IS AN INSET BOX SHADOW rather than a border, because a border changes
 * a row's box and every affected row would shift by its width the moment a
 * finding appeared. §17d asks for a count that never moves; a rail that jumps
 * would be the same broken promise one element over.
 *
 * SCOPING, THE ONE PLACE THIS DEPARTS FROM ITS SIBLINGS. They scope every
 * selector under an `.ig-` class because they own the elements they draw. The
 * bar does not: it lands on a row the VIEWER rendered, and adding a class there
 * means rewriting a `class` attribute this layer has no business touching. So
 * it is scoped by {@link AUDIT_SEVERITY_ATTRIBUTE} instead — this package's own
 * namespaced name, which bounds it to elements a host stamped on purpose.
 *
 * There is no transition, no animation and no `@keyframes` here, and there is a
 * test that says so.
 */

import { AUDIT_KIND_ATTRIBUTE } from './panel.ts';
import { AUDIT_SEVERITY_ATTRIBUTE } from './surface.ts';

export const auditStylesheet = `
.ig-audit {
  align-items: center;
  display: inline-flex;
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
  gap: var(--ig-space-tight);
}

.ig-audit-toggle {
  align-items: center;
  background: none;
  border: 0;
  color: var(--ig-text-muted);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  gap: var(--ig-space-tight);
  padding: 0;
}

.ig-audit-toggle[aria-pressed='true'] {
  color: var(--ig-text);
}

.ig-audit-count {
  color: var(--ig-text);
  font-family: var(--ig-font-mono);
  font-variant-numeric: tabular-nums;
}

[${AUDIT_SEVERITY_ATTRIBUTE}] {
  box-shadow: inset var(--ig-stroke-audit) 0 0 0 var(--ig-edge-serialize-with);
}

/* §17d'S PANEL. Note what it does NOT select on: ${AUDIT_SEVERITY_ATTRIBUTE},
   whose rule immediately above is deliberately unqualified because it lands on a
   row the VIEWER rendered. A chip wearing that attribute would draw the rail's
   gold bar whatever hue the class table gave it, which is the four-hue mapping
   below defeated by one attribute. Chips carry ${AUDIT_KIND_ATTRIBUTE}. */
/* IT IS THE SELECTION'S PEER, NOT ITS HEADING, so it carries its own padding:
   it is a sibling of .ig-inspector inside the zone rather than a child, and
   that column's padding does not reach it.

   IT DECLARES NO SIZE OF ITS OWN, AND THAT IS THE LAYERING. Issue 177 gave the
   audit half the inspector column, scrolling itself past that — and since the
   fourth class moved to ./refused.ts the half belongs to the REGION holding both
   surfaces rather than to this panel. Either way it is a fact about SHARING A
   COLUMN, not a fact about the panel, so it is declared by the composition that
   owns the zone. See workspace/styles.ts.

   The difference is reachable rather than theoretical: renderAuditPanel and
   this stylesheet are both public exports, so a consumer can draw the panel
   outside renderWorkspace. Capping it there would hide findings behind an inner
   scrollbar with half the container left empty and no selection detail to
   reserve the space for. A leaf that sized itself would be wrong in every
   composition but one. */
.ig-audit-panel {
  border-bottom: var(--ig-stroke) solid var(--ig-line);
  display: flex;
  flex-direction: column;
  font-family: var(--ig-font-ui);
  gap: var(--ig-space-snug);
  min-height: 0;
  padding: var(--ig-space);
}

/* THE RING FOR THE PANEL'S OWN TAB STOP. Unscoped, unlike the sizing above,
   because the tabindex is in this leaf's MARKUP and is therefore carried into
   every composition: a focusable element that shows nothing on focus is a stop
   a keyboard reader lands on blind, wherever it is drawn.

   INSET, WHICH IS THE VIEWER'S OWN IDIOM for exactly this shape — its sheet
   draws every focus ring at a negative offset. Drawn outward it would sit on
   the panel's border box against the zone's edge and the column's own scroll,
   where the top and bottom of the ring are the first thing clipped. */
.ig-audit-panel:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: calc(var(--ig-focus-ring) * -1);
}

.ig-audit-panel-head {
  align-items: center;
  display: flex;
  gap: var(--ig-space-tight);
}

/* THE GOLD IS THE AMBIENT MARK'S, not a fifth hue. §17d names one attention
   colour and the rail bar already spends it; the panel head answering in the
   same gold is what makes the count and the list read as one thing. */
.ig-audit-mark {
  color: var(--ig-edge-serialize-with);
  font-size: var(--ig-font-size-small);
}

.ig-audit-panel-count {
  color: var(--ig-edge-serialize-with);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-small);
  font-variant-numeric: tabular-nums;
}

.ig-audit-panel-heading {
  color: var(--ig-edge-serialize-with);
  font-weight: inherit;
  margin: 0;
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-small);
  letter-spacing: var(--ig-tracking-group);
  text-transform: uppercase;
}

/* NO CAP ON THE LIST, AND THAT IS STILL RIGHT — the bound belongs to the PANEL
   above, not here. Three caps were tried on this element (a fixed length, a
   share of a flex column, that share measured on the right box) and each was
   correct about the previous one's defect while the column stayed the thing
   that could not be bounded from in here. It still cannot: the list has no
   padding, so a scroll container here computes overflow-x to auto and clips the
   focus ring on every card control. The panel carries the share and the
   scrolling; see the rule above. */
.ig-audit-list {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-snug);
  list-style: none;
  margin: 0;
  padding: 0;
}

.ig-audit-card {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-micro);
}

.ig-audit-chip {
  align-self: flex-start;
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius-small);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-pill);
  padding: 0 var(--ig-space-tight);
}

.ig-audit-title {
  color: var(--ig-text);
  font-size: var(--ig-font-size);
  margin: 0;
}

/* SENTENCE-LENGTH COPY TAKES --ig-text-body, NEVER --ig-text-muted. SPEC's
   closing note measures muted at 4.65:1 on a plain surface and about 0.4 less
   inside a tint, which drops it under AA — so muted is reserved there for short
   mono labels, and a finding's detail is a sentence. */
.ig-audit-detail {
  color: var(--ig-text-body);
  font-size: var(--ig-font-size-compact);
  line-height: var(--ig-line-height);
  margin: 0;
}

/* MUTED IS CORRECT HERE, ON THE SAME RULE .ig-audit-refused-source ends this
   file with: the note above reserves muted for SHORT MONO LABELS, and a cycle's
   walk is one — refs and separators, no prose. Length is not the test and could
   not be: a large ring draws a long line, which is what the wrap below is for.
   What muted is reserved AGAINST is sentence-length COPY. The detail rule one block up takes --ig-text-body because it IS a
   sentence, so it is the wrong neighbour to copy.

   break-word, NOT anywhere. A ref is a token worth keeping whole; the refused
   block accepts mid-token breaks because it quotes arbitrary body text, and a
   walk is a list of identifiers a reader has to be able to match against the
   rail. */
.ig-audit-walk {
  color: var(--ig-text-muted);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-compact);
  line-height: var(--ig-line-height);
  margin: 0;
  overflow-wrap: break-word;
}

.ig-audit-show {
  align-self: flex-start;
  background: none;
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius-small);
  color: var(--ig-text);
  cursor: pointer;
  font: inherit;
  font-size: var(--ig-font-size-meta);
  padding: var(--ig-space-micro) var(--ig-space-tight);
}

.ig-audit-show:hover {
  border-color: var(--ig-accent);
}

.ig-audit-show:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-micro);
}

/* ONE RULE PER CLASS, WRITTEN OUT, never through an intermediate property: the
   viewer's own badge sheet records why — a \--ig-audit-hue\ set here and read
   here names something no theme and no layout declares, and the token scan
   exists to refuse exactly that.

   THE TINTS ARE THE VIEWER'S RECIPE, not new numbers. \--ig-tint-fill\ and
   \--ig-tint-border\ are what \.ig-badge[data-edge]\ already mixes an edge hue
   with, and they are the frame's own chip wash to within a point.

   THE TEXT IS THE BASE HUE. The frame lightens each chip's label a step off the
   hue it tints with; those derivatives have no token, and a literal here is
   refused by the scan two files over, so the label takes the hue itself. */
.ig-audit-chip[${AUDIT_KIND_ATTRIBUTE}='cycle'] {
  background: color-mix(in srgb, var(--ig-edge-blocked-by) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-edge-blocked-by) var(--ig-tint-border), transparent);
  color: var(--ig-edge-blocked-by);
}

.ig-audit-chip[${AUDIT_KIND_ATTRIBUTE}='stale-blocker'] {
  background: color-mix(in srgb, var(--ig-edge-serialize-with) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-edge-serialize-with) var(--ig-tint-border), transparent);
  color: var(--ig-edge-serialize-with);
}

.ig-audit-chip[${AUDIT_KIND_ATTRIBUTE}='dead-duplicate-ref'] {
  background: color-mix(in srgb, var(--ig-edge-duplicate-of) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-edge-duplicate-of) var(--ig-tint-border), transparent);
  color: var(--ig-edge-duplicate-of);
}

.ig-audit-chip[${AUDIT_KIND_ATTRIBUTE}='encoding-refused'] {
  background: color-mix(in srgb, var(--ig-edge-blocked-by) var(--ig-tint-fill), transparent);
  border-color: color-mix(in srgb, var(--ig-edge-blocked-by) var(--ig-tint-border), transparent);
  color: var(--ig-edge-blocked-by);
}

/* ---- §17d's fourth class, drawn outside the panel (./refused.ts) ---- */

/* NO SIZE OF ITS OWN, THE SAME ANSWER .ig-audit-panel GIVES ABOVE. This block
   and that panel are the two members of .ig-audit-region, which is what the
   inspector zone actually holds, and how much of the zone's single track that
   region may take is a fact about SHARING A COLUMN rather than a fact about
   either leaf. So the share is declared once by the composition that owns the
   zone — see workspace/styles.ts, which bounds the region alone. */
.ig-audit-refused {
  display: flex;
  flex-direction: column;
  font-family: var(--ig-font-ui);
  gap: var(--ig-space-snug);
  min-height: 0;
  padding: var(--ig-space);
}

/* THE RING FOR THIS BLOCK'S TAB STOP, unscoped for the reason the panel's is:
   the tabindex is in this leaf's MARKUP, so it is carried into every
   composition, and a focusable element that shows nothing on focus is a stop a
   keyboard reader lands on blind. Inset, the viewer's idiom, so a ring at the
   zone's edge is not the first thing the column's scroll clips. */
.ig-audit-refused:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: calc(var(--ig-focus-ring) * -1);
}

/* THE SAME HEADING TREATMENT AS THE PANEL'S, because they are peers in one
   column and §17d draws them as one section. A second treatment would say they
   were two unrelated things. */
.ig-audit-refused-heading {
  color: var(--ig-edge-blocked-by);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-small);
  font-weight: inherit;
  letter-spacing: var(--ig-tracking-group);
  margin: 0;
  text-transform: uppercase;
}

.ig-audit-refused-list {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-snug);
  list-style: none;
  margin: 0;
  padding: 0;
}

/* THE CARD IS DRAWN, UNLIKE THE PANEL'S. The frame gives this one a surface and
   a border because it sits alone rather than in a list of like items — it is
   the one finding that is about an ISSUE rather than a relationship, and the
   box is what says so. */
.ig-audit-refused-card {
  background: var(--ig-surface-2);
  border: var(--ig-stroke) solid var(--ig-card-line);
  border-radius: var(--ig-radius);
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
  padding: var(--ig-space-tight);
}

.ig-audit-refused-head {
  align-items: center;
  display: flex;
  gap: var(--ig-space-tight);
}

.ig-audit-refused-ref {
  color: var(--ig-text);
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-meta);
}

/* ONE BLOCK, TWO LINES — the diagnostic and, under it, the line the reader
   stopped on. pre-wrap because the source line is RAW BODY TEXT: it carries
   its own leading space and its own length, and collapsing either would show a
   reader something other than what is in their issue. overflow-wrap keeps a
   long unbroken line inside the column instead of widening the track. */
.ig-audit-refused-reason {
  display: flex;
  flex-direction: column;
  font-family: var(--ig-font-mono);
  font-size: var(--ig-font-size-meta);
  gap: var(--ig-space-micro);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.ig-audit-refused-diagnostic {
  color: var(--ig-text-body);
}

/* MUTED IS CORRECT HERE AND NOWHERE NEAR A SENTENCE. SPEC's closing note puts
   muted under AA for sentence-length copy, which is why .ig-audit-detail
   takes --ig-text-body — but this is a short mono quotation of the reader's own
   input, the exact shape muted is reserved for, and the frame draws it a step
   back from the diagnostic it belongs to. */
.ig-audit-refused-source {
  color: var(--ig-text-muted);
}

.ig-audit-refused-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space-tight);
}

/* ONE TREATMENT FOR BOTH CONTROLS, THOUGH ONE IS AN ANCHOR AND ONE A BUTTON.
   The element differs because what they DO differs — the link leaves the
   document and must say so to assistive technology — but they sit side by side
   in the frame as one pair of moves, and drawing them differently would imply a
   difference in weight that §17d does not make. */
.ig-audit-refused-open,
.ig-audit-refused-rewrite {
  align-items: center;
  background: none;
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius-small);
  color: var(--ig-text);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: var(--ig-font-size-meta);
  gap: var(--ig-space-micro);
  padding: var(--ig-space-micro) var(--ig-space-tight);
  text-decoration: none;
}

.ig-audit-refused-open:hover,
.ig-audit-refused-rewrite:hover {
  border-color: var(--ig-accent);
}

.ig-audit-refused-open:focus-visible,
.ig-audit-refused-rewrite:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-micro);
}

.ig-audit-refused-away {
  color: var(--ig-text-muted);
}
`;
