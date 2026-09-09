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

   HALF THE COLUMN, AND PAST THAT IT SCROLLS ITSELF. This is the audit's share
   of the inspector zone, and it is the whole of issue 177's answer. The panel is a
   GLOBAL list sitting above a SELECTION-SCOPED one, and it is drawn first, so
   unbounded it pushed the detail a reader had just clicked below the fold --
   at section 17f's own scale case, a 312-issue backlog, that is the ordinary
   size rather than a corner.

   A PERCENTAGE, NEVER A LENGTH. A fixed cap was tried first and resolved to
   most of a short workspace's column under the default theme: a length cannot
   know how tall the column it is dividing happens to be. The share resolves
   against the zone, which is a grid item on the workspace's 1fr row inside a
   mount that is height: 100% — so mounted, the track is definite and it applies.

   AND IT GOES INERT EXACTLY WHERE THE DEFECT DOES. Rendered with no
   height-bounded ancestor the percentage is indefinite, CSS reads the
   max-height as none, and the panel is unbounded as before. That is right
   rather than a gap: an auto-height zone grows to its content, so nothing is
   below any fold and there is nothing to bound.

   BORDER-BOX, AND IT IS LOAD-BEARING. This repository declares box-sizing per
   element — there is no global reset — so without it the half is measured on
   the CONTENT box and the panel's own padding and border push the drawn box
   past the share it was given. Nothing would look broken; it would just be
   wrong by a padding and a stroke.

   THE PANEL SCROLLS, NOT THE LIST INSIDE IT. Scrolling the list instead would
   pin this head, which is tempting and is the wrong trade twice over. The
   ambient count section 17d fixes is the WORKSPACE HEADER's, drawn in the
   header grid area by headerMarkup and outside this zone entirely — it already
   never moves, so a second pinned count buys nothing. And the list has zero
   horizontal padding, so making it the scroll container computes its overflow-x
   to auto and CLIPS the focus ring on every card's control: an outline is ink
   overflow, so it is cut rather than scrolled to. The panel's own padding gives
   those rings room on all four sides.

   THE ZONE IS STILL ONE TRACK, which is the other half of the answer and the
   reason the mount's chrome is safe. A two-pane version was built and reverted:
   making the zone a flex column with overflow: hidden gave the audit and the
   selection independent scrolling and CLIPPED .ig-chrome, a third sibling
   mountWorkspace appends to this zone. Bounding one sibling inside the single
   track needs none of that — .ig-inspector and .ig-chrome keep the zone's own
   scrolling, so there is no layout in which the chrome can be cut. */
.ig-audit-panel {
  border-bottom: var(--ig-stroke) solid var(--ig-line);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  font-family: var(--ig-font-ui);
  gap: var(--ig-space-snug);
  max-height: 50%;
  min-height: 0;
  overflow-y: auto;
  padding: var(--ig-space);
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
`;
