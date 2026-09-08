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
/* IT IS ITS OWN PANE. The panel is a sibling of the inspector inside the zone
   rather than a child of it, so it carries its own padding — that column's no
   longer reaches it — and it takes its own share of the zone's height:
   flex: 0 1 auto against a sibling that claims the rest, so a long audit and a
   long selection cannot push each other off screen. workspace/styles.ts makes
   the zone the flex column this sits in; the share is declared here because
   this sheet owns this class. */
.ig-audit-panel {
  flex: 0 1 auto;
  border-bottom: var(--ig-stroke) solid var(--ig-line);
  display: flex;
  flex-direction: column;
  font-family: var(--ig-font-ui);
  gap: var(--ig-space-snug);
  min-height: 0;
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

/* THE LIST SCROLLS INSIDE THE PANEL, and the pane above it is what makes that
   a guarantee rather than a hope. A FIXED cap could not be one: a calc of 24
   times the wide space step is, under the default theme, most of a short
   workspace's whole column — the list obeyed its budget and the selection
   detail went below the fold anyway. The bound that matters is the share of the
   ZONE this pane may take, and flex: 0 1 auto against a sibling that claims
   the rest is what states it; the list then simply fills its pane.

   min-height: 0 again, for the reason the zone's children carry it: without
   it this scroll container refuses to shrink below its content. */
.ig-audit-list {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-snug);
  list-style: none;
  margin: 0;
  min-height: 0;
  overflow-y: auto;
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
