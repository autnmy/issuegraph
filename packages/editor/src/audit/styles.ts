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
import { AUDIT_SEVERITY_ATTRIBUTE, AUDIT_WORST_ATTRIBUTE } from './surface.ts';

export const auditStylesheet = `
.ig-audit {
  align-items: center;
  display: inline-flex;
  font-family: var(--ig-font-ui);
  /* The body size, so the problems word reads at the size of its count: the
     export draws the whole button at one size. */
  font-size: var(--ig-font-size);
  gap: var(--ig-space-tight);
}

/* THE WORDS SIT ON ONE BASELINE (issue 293). An inline-flex box takes its
   baseline from its first item that takes part in baseline alignment, and
   centred items take none, so the empty dot leading the button gave it its
   bottom edge as a baseline and the count rode high beside the header's other
   text. The count and its word align by baseline, which makes the count the
   button's baseline; the dot alone is centred, below. */
.ig-audit-toggle {
  align-items: baseline;
  background: none;
  border: 0;
  color: var(--ig-text);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  gap: var(--ig-space-tight);
  padding: 0;
}

/* THE WORDS ARE IN TEXT INK, as the export's state label is; only the
   neutral state reads muted, and a closed blocker is the neutral one. */
.ig-audit-toggle[${AUDIT_WORST_ATTRIBUTE}='stale-blocker'] {
  color: var(--ig-text-muted);
}

/* A COUNT, SO BODY TEXT: the body sans at the body size, with tabular figures
   to hold its digits still. The mono face is for keys a reader copies, and a
   count is read as a number, not copied. */
.ig-audit-count {
  color: var(--ig-text);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  font-variant-numeric: tabular-nums;
}

/* THE DOT OF THE WORST PROBLEM, before the count, as the export's head draws
   its problems button (issue 293). The export's state dot is eight across; the
   snug step is eight. Its colour is the worst class's state, as the export's
   rules give each one: a loop is the error state, a duplicate of a closed issue
   and relationships that could not be read are the attention state, and a
   closed blocker is the neutral state, drawn as a ring because nothing is
   happening. The dot reads each state's MARK token, not its hue: a host maps
   the hue to the state's text ink, which on a light ground is near black, and
   the mark to the state's own colour. The pending station colour is the
   neutral ring. */
.ig-audit-dot {
  align-self: center;
  block-size: var(--ig-space-snug);
  border-radius: 50%;
  flex: none;
  inline-size: var(--ig-space-snug);
  /* With the toggle's gap, twelve between the dot and its count, as the
     export's state label spaces its dot. */
  margin-inline-end: var(--ig-space-tight);
}

.ig-audit-dot[${AUDIT_WORST_ATTRIBUTE}='cycle'] {
  background: var(--ig-state-failed-mark);
}

.ig-audit-dot[${AUDIT_WORST_ATTRIBUTE}='dead-duplicate-ref'],
.ig-audit-dot[${AUDIT_WORST_ATTRIBUTE}='encoding-refused'] {
  background: var(--ig-state-conflict-mark);
}

.ig-audit-dot[${AUDIT_WORST_ATTRIBUTE}='stale-blocker'] {
  box-shadow: inset 0 0 0 var(--ig-stroke) var(--ig-station-pending);
}

[${AUDIT_SEVERITY_ATTRIBUTE}] {
  box-shadow: inset var(--ig-stroke-audit) 0 0 0 var(--ig-edge-serialize-with);
}

/* §17d'S PANEL. Note what it does NOT select on: ${AUDIT_SEVERITY_ATTRIBUTE},
   whose rule immediately above is deliberately unqualified because it lands on a
   row the VIEWER rendered. A card wearing that attribute would draw the rail's
   gold bar whatever state it was drawn in. Cards carry ${AUDIT_KIND_ATTRIBUTE}. */
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

/* THE PANEL'S TITLE, AS THE EXPORT DRAWS IT: one heading, the count and then
   the host's words, in the sans at medium weight in text colour. It was an
   uppercase mono label in gold with the count beside it; content.md rules out
   that small uppercase label, and the count reads as part of the sentence it
   starts. The export's panel title is a step above the body, and since issue
   293 the theme carries that step and its line, so the title takes both. */
.ig-audit-panel-heading {
  color: var(--ig-text);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-panel-title);
  font-weight: var(--ig-weight-medium);
  line-height: var(--ig-panel-title-line);
  margin: 0;
}

/* The count inside the title is a count, so it keeps the sans and tabular
   figures, in the title's own ink and at the title's own size: the export sets
   the count and the words as one run, and a count a step smaller than the
   words it leads would put two sizes in one heading. */
.ig-audit-panel-count {
  color: inherit;
  font-family: var(--ig-font-ui);
  font-size: inherit;
  font-variant-numeric: tabular-nums;
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

/* EACH FINDING IS THE EXPORT'S NOTE (issue 296): its state's icon beside its
   text, on a fill in its state at the control corner, padded, with no border.
   The neutral state, a closed blocker, sits on the second fill; a loop on the
   error fill and an unreadable relationship or a duplicate of a closed issue on
   the attention fill, each title and icon in its state's hue and the sentence
   under it in text ink. */
.ig-audit-card {
  align-items: flex-start;
  background: var(--ig-surface-2);
  border-radius: var(--ig-radius);
  display: flex;
  gap: var(--ig-space-snug);
  padding: var(--ig-space);
}

.ig-audit-note-text {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-micro);
  min-width: 0;
}

/* THE STATE'S ICON, AS THE EXPORT DRAWS IT: sixteen across, its stroke the
   theme's, in the note's own ink, set a step down so it sits on the title's
   first line. */
.ig-audit-icon {
  block-size: var(--ig-space-loose);
  color: var(--ig-text);
  fill: none;
  flex: none;
  inline-size: var(--ig-space-loose);
  margin-top: var(--ig-space-micro);
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: var(--ig-stroke);
}

.ig-audit-card[data-s='error'] .ig-audit-icon {
  color: var(--ig-state-failed);
}

.ig-audit-card[data-s='attention'] .ig-audit-icon {
  color: var(--ig-state-conflict);
}

.ig-audit-card[data-s='error'] {
  background: var(--ig-state-failed-fill);
}

.ig-audit-card[data-s='error'] .ig-audit-title {
  color: var(--ig-state-failed);
}

.ig-audit-card[data-s='attention'] {
  background: var(--ig-state-conflict-fill);
}

.ig-audit-card[data-s='attention'] .ig-audit-title {
  color: var(--ig-state-conflict);
}

.ig-audit-title {
  color: var(--ig-text);
  font-size: var(--ig-font-size);
  font-weight: var(--ig-weight-medium);
  margin: 0;
}

/* THE NOTE'S SENTENCE IS TEXT INK at the body size, as the export's note body
   is. It took --ig-text-body at a smaller step; muted stays out of it either
   way, because a finding's detail is a sentence. */
.ig-audit-detail {
  color: var(--ig-text);
  font-size: var(--ig-font-size);
  line-height: var(--ig-line-height);
  margin: 0;
}

/* 17d'S REMEDIES. A row of them under the card's sentence.

   THEY ARE QUIET CONTROLS DELIBERATELY. A remedy publishes a selection and
   never writes, so drawing it louder would promise an action it does not
   perform. 3's whole point is that the judgment stays
   with the owner, and a button styled like a commit invites a click that is
   not one.

   WRAPS, because a duplicate's card carries two of them inside a panel of fixed
   width whose cards also indent. A row that cannot wrap pushes its second
   control out of the panel, which is the shape the relationship row one sheet
   over already had to solve. (Worded around two particular verbs on purpose:
   acceptance scans this sheet's PROSE as well as its declarations for the
   vocabulary of a remedy that acts by itself, and it cannot tell a comment
   from a control. Both spellings of that idea are therefore unusable here,
   including in a note explaining why.)

   (The width itself is 3's number and lives in workspace/styles.ts, where the
   overlay is positioned. Naming it here would put a length in a sheet whose
   own guard reads comments as well as declarations - which is how this
   paragraph was first written, and caught.) */
.ig-audit-remedies {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space-tight);
}

.ig-audit-remedy {
  background: none;
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius-small);
  color: var(--ig-text);
  cursor: pointer;
  font: inherit;
  font-size: var(--ig-font-size-meta);
  padding: var(--ig-space-micro) var(--ig-space-tight);
}

.ig-audit-remedy:hover {
  border-color: var(--ig-accent);
}

.ig-audit-remedy:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-micro);
}

/* 17d'S OWN ENTRY POINT - 'filter the rail to these' - in the panel head.

   IT SITS AT THE END OF THE HEAD ROW, after the count and the heading, which is
   where the frame draws it. margin-inline-start: auto rather than a width on
   the heading, so the head stays one flex row whatever the host's word is.

   aria-pressed IS STYLED, NOT JUST PUBLISHED. 2's ruling is that a filter
   which is visibly on, states what it hides and clears in one click is not a
   refusal - so 'visibly on' is a requirement here rather than a nicety. */
.ig-audit-filter {
  background: none;
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius-small);
  color: var(--ig-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--ig-font-size-meta);
  margin-inline-start: auto;
  padding: var(--ig-space-micro) var(--ig-space-tight);
}

.ig-audit-filter[aria-pressed='true'] {
  border-color: var(--ig-accent);
  color: var(--ig-accent);
}

.ig-audit-filter:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-micro);
}

/* ---- §17d's fourth class: an unreadable relationship's note (./refused.ts) ----

   A NOTE IN THE PANEL SINCE ISSUE 296, styled as every note is above, its
   body sentence included; these rules draw only its two controls. */

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
