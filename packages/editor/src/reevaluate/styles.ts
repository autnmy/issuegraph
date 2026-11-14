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

import { COLOR_TOKENS, type ColorToken } from '@issuegraph/viewer';

/**
 * The colour tokens that carry no hue: the background, the surfaces, the
 * hairline and the text roles. Every other entry of `COLOR_TOKENS` is a hue.
 */
const NEUTRAL_TOKENS: ReadonlySet<ColorToken> = new Set<ColorToken>([
  '--ig-bg',
  '--ig-surface',
  '--ig-surface-2',
  // A ground for a placeholder, an ink with no hue of its own (#293).
  '--ig-fill-strong',
  '--ig-line',
  '--ig-text',
  '--ig-text-body',
  '--ig-text-muted',
]);

/**
 * The declarations that grey a held rail: every hue token redefined to
 * `--ig-text-muted`. Taken from the viewer's own token list, so a hue added
 * there is greyed here too. The workspace's held rule uses the same block.
 */
export const heldRailDeclarations = COLOR_TOKENS.filter((token) => !NEUTRAL_TOKENS.has(token))
  .map((token) => `  ${token}: var(--ig-text-muted);`)
  .join('\n');

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
   the most useful thing on the screen.

   THE HUE TOKENS, NOT color, and that is the whole point of this rule. color
   on the rail greys almost nothing: the viewer's own stylesheet sets color
   directly on .ig-title, .ig-id and .ig-hold, and carries the stations
   and badges in background and border-color, none of which inherit at all.
   A specified value beats an inherited one, so the stale order would have kept
   its normal palette while this rule looked like it was doing something.

   Listing the descendants to override would go stale the first time layer 1
   colours something new. Custom properties DO inherit, so redefining the hue
   tokens here greys every descendant that reads one, a descendant added later
   included. It greys by colour, never by filter or opacity, so the rail's
   text keeps the contrast its theme pairs promise. styles.test.ts pins both
   halves: that layer 1 really does colour its own descendants, and that this
   rule redefines every hue and sets no bare color. */
.ig-reevaluate[data-order='held'] .ig-viewer {
${heldRailDeclarations}
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

/* THE SAVED LINE IS QUIET TEXT, counts included. It reports an edit the
   reader already made and stays until they dismiss it, so it must not compete
   with the order beside it. The count and its word carry their own colours
   because a rail chip draws them too, so inside the line both are named. */
.ig-change-line,
.ig-change-line .ig-change-count,
.ig-change-line .ig-change-word {
  color: var(--ig-text-muted);
}

/* The host's lead before the counts — the "Saved:" of "Saved: 2 moved". The
   line itself has no gap, so the space after the lead is this margin. */
.ig-change-saved {
  margin-inline-end: var(--ig-space);
}

.ig-change-parts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  /* The blast radius reads as ONE line: "2 moved · 1 newly held". */
  gap: var(--ig-space-tight);
}

.ig-change-part {
  display: flex;
  gap: var(--ig-space-tight);
  align-items: baseline;
}

/* THE SEPARATOR IS GENERATED HERE, NOT WRITTEN INTO THE MARKUP, so the
   markup carries only the host's words. The empty alternative text after the
   slash keeps a screen reader from reading the dot aloud between facets. */
.ig-change-part + .ig-change-part::before {
  content: '·' / '';
}

/* A COUNT IS BODY TEXT: the body sans at the body size, with tabular figures
   so "2 moved" and "12 moved" keep their digits in one column. Mono is the
   face of a key a reader copies, and a count is read rather than copied. */
.ig-change-count {
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  font-variant-numeric: tabular-nums;
  color: var(--ig-text);
}

.ig-change-word {
  color: var(--ig-text-body);
}

.ig-change-unchanged {
  margin: 0;
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

.ig-delta-list {
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

.ig-delta-key,
.ig-delta-ref {
  font-family: var(--ig-font-mono);
  color: var(--ig-text-muted);
}

/* The count and its word are adjacent spans with no text between them, so
   without this they render as 2up. Same reason .ig-change-part has one. */
.ig-delta-move {
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

/* THE PLACED CHIP IS NOT A LIST ITEM and does not lay out like one: it sits at
   the end of its row, after whatever the row already drew, and it never grows
   the row's height on its own.

   WHAT PUTS IT AT THE TRAILING EDGE IS NOT HERE, and this comment claimed it
   was. It named margin-inline-start: auto, which an earlier revision of this
   rule did set and this one does not — the ranked row reaches the edge by
   being given a third grid column in workspace/styles.ts instead, and the
   footer row, which is a flex box rather than that grid, is pushed there by a
   rule of its own beside it. Both live with the row shapes they are about;
   what is left here is only what a placed chip looks like whatever it sits in.
   The claim survived the change that falsified it, which is this codebase's
   named failure mode and not a new one. */
.ig-delta-chip[data-placed] {
  display: inline-flex;
  gap: var(--ig-space-tight);
  align-items: baseline;
  align-self: center;
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  padding: 0 var(--ig-space-tight);
  background: var(--ig-surface-2);
  font-size: var(--ig-font-size-small);
}

`;
