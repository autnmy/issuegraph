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
  box-shadow: inset var(--ig-stroke) 0 0 0 var(--ig-edge-serialize-with);
}
`;
