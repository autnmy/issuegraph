/**
 * The workspace's structural stylesheet: three fixed zones, and nothing else.
 *
 * Same contract as the viewer's, the ladder's and the re-evaluate surface's —
 * layout, weight and state, never a value. Every colour, length and font is a
 * `var(--ig-…)` the host's theme resolves, and `styles.test.ts` scans these
 * bytes for a literal or an unresolvable token.
 *
 * ## Fixed, and that is the requirement
 *
 * §17f gives the rail and the canvas opposite obligations — the rail is
 * complete at any backlog size, the canvas refuses above its budget — and
 * assembling them must not average the two. Positions are therefore FIXED
 * rather than negotiated: `grid-template-columns` gives the rail and the
 * inspector their own tracks and the canvas the remaining `1fr`, so a large
 * document grows the canvas's refusal rather than squeezing the rail out of
 * the layout.
 *
 * The rail scrolls in its own track. That is what makes windowing a rendering
 * decision rather than a visible one: the reader scrolls a complete order, and
 * which slice is currently drawn is the host's business.
 *
 * ## Dark only, with no forked token set
 *
 * Light was cut after pass 1, so there is no second palette here and no
 * `prefers-color-scheme` block. The single palette is the viewer's, reached
 * through its custom properties — a forked set would be exactly the drifting
 * second implementation the package split exists to remove.
 *
 * ## No animation, anywhere
 *
 * §17a: the audit is ambient, and a count that animates is a count demanding
 * attention it has not earned. The re-evaluate surface already rejected the
 * animated re-sort for a stronger reason — rows moving under the cursor mean
 * the next edit targets the wrong thing — and this is the file where both
 * could creep back in without touching a line of TypeScript.
 */

export const workspaceStylesheet = `
.ig-workspace {
  display: grid;
  /* HEADER SPANS, THE THREE ZONES SIT UNDER IT. The audit count is ambient: it
     belongs to the whole workspace rather than to one zone, and putting it in a
     zone's own track would make it move when that zone resized. */
  grid-template-areas:
    'header header header'
    'rail canvas inspector';
  /* The rail and the inspector are sized in TYPE, not in pixels: a host that
     scales the type scales the zones with it, which a fixed track would not.

     A LENGTH TIMES A UNITLESS COUNT, which is the viewer's own idiom
     (styles.ts writes min-width: calc(var(--ig-char-width) * 4)). An earlier
     version multiplied --ig-char-width by --ig-label-char-width, having read
     the second as "how many characters wide a label is". It is not: it is the
     average width OF one character, and themeCss renders every metric with px
     — so the expression was calc(7.8px * 6px), which is not a length. CSS
     discards a declaration it cannot parse, so the whole template went with it
     and all three zones fell back to auto columns: long content could then
     squeeze the canvas, which is the one thing fixed positions exist to stop.
     Nothing failed loudly, because an invalid declaration is simply absent.

     40 is a reading measure for a title plus its id, in characters. */
  grid-template-columns:
    calc(var(--ig-char-width) * 40)
    1fr
    calc(var(--ig-char-width) * 40);
  grid-template-rows: auto 1fr;
  gap: var(--ig-space);
  background: var(--ig-bg);
  color: var(--ig-text-body);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  line-height: var(--ig-line-height);
}

.ig-zone {
  min-width: 0;
  /* Without this a long title in any zone sets that track's minimum width and
     the grid stops honouring its own template. */
  min-height: 0;
}

.ig-zone[data-zone='header'] {
  grid-area: header;
}

.ig-zone[data-zone='rail'] {
  grid-area: rail;
  /* The rail scrolls; the window slides underneath. */
  overflow-y: auto;
  border-right: var(--ig-stroke) solid var(--ig-line);
}

.ig-zone[data-zone='canvas'] {
  grid-area: canvas;
  overflow: auto;
}

.ig-zone[data-zone='inspector'] {
  grid-area: inspector;
  overflow-y: auto;
  border-left: var(--ig-stroke) solid var(--ig-line);
}

/* THE AMBIENT LEFT-BAR. A 2px gold rule on the affected row and nothing else —
   no fill, no icon, no badge. §17a's whole ask is that encoding errors stay
   visible while you work rather than pulling you out of it.

   An inset box-shadow rather than a border: a border changes the row's box and
   would shift every marked row against its neighbours, which is a layout jump
   the eye reads as movement. The width is the theme's spine, so the bar scales
   with the rest of the rail. */
.ig-zone[data-zone='rail'] [data-ig-audit] {
  box-shadow: inset var(--ig-spine-width) 0 0 0 var(--ig-accent);
}

.ig-zone[data-zone='rail'] [data-ig-audit='misleading'] {
  box-shadow: inset var(--ig-spine-width) 0 0 0 var(--ig-state-invalid);
}

/* THE ROWS OUTSIDE THE WINDOW, AS HEIGHT. The rail scrolls, so without a spacer
   at each end the container is exactly as tall as the drawn rows and native
   scrolling stops at the end of the first window — leaving a host no offset to
   turn into the next start, and a reader no way to reach rank 287 of 312.

   NO BACKTICKS ANYWHERE IN THIS FILE'S COMMENTS. The stylesheet is a template
   literal, so a backtick closes it — and the failure is a parse error pages
   away from the character that caused it.

   THE PITCH IS THE OUTER BOX, NOT THE ROW HEIGHT. A .ig-slot is
   min-height: --ig-row-height PLUS margin-bottom: --ig-space-tight, so
   row-to-row is the sum of the two. Sized on --ig-row-height alone, this
   undercounted EVERY omitted row by the gap — 44 of a 50px pitch on the default
   theme, so 300 omitted rows left the scroll extent 1,800px short and a host
   dividing its scroll position by the measured pitch could reach about offset
   264 of 300. The tail of the order became unreachable by the very mechanism
   added to make it reachable.

   That is a SYSTEMATIC undercount, not the approximation below, which is why it
   is corrected exactly rather than tolerated: the gap is constant per row and
   both terms are theme metrics.

   --ig-rail-rows is the count, set inline by the renderer. What remains
   approximate is only VARIABLE row height — a row carrying holds is taller than
   a bare one — so the scrollbar stays proportional rather than exact. Measuring
   that needs a mount, which this package does not have. */
.ig-rail-spacer {
  height: calc((var(--ig-row-height) + var(--ig-space-tight)) * var(--ig-rail-rows, 0));
}

.ig-inspector {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space);
  padding: var(--ig-space);
}

.ig-inspector-empty {
  margin: 0;
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-small);
}

.ig-inspector-issue {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-inspector-title {
  margin: 0;
  font-size: var(--ig-font-size);
  color: var(--ig-text);
}

.ig-inspector-key {
  font-family: var(--ig-font-mono);
  color: var(--ig-text-muted);
}

.ig-inspector-position {
  margin: 0;
  font-family: var(--ig-font-mono);
  color: var(--ig-text-muted);
}

.ig-inspector-position[data-ready='true'] {
  color: var(--ig-station-ready);
}

.ig-inspector-holds {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

/* The two hold families never share a treatment — layer 1's rule, carried
   across so the inspector cannot contradict the rail it sits beside. */
.ig-inspector-hold[data-family='graph'] {
  color: var(--ig-station-held);
}

.ig-inspector-hold[data-family='tracker'] {
  color: var(--ig-text-muted);
}

.ig-inspector-relationships {
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-inspector-heading {
  margin: 0;
  font-size: var(--ig-font-size-small);
  color: var(--ig-text-muted);
}

.ig-inspector-clear {
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

.ig-inspector-clear:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

.ig-relationship-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ig-space-tight);
}

.ig-relationship {
  display: flex;
  gap: var(--ig-space-tight);
  align-items: baseline;
  padding: var(--ig-space-tight);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  background: var(--ig-surface);
}

/* Hue by field, from the theme's own edge tokens — the same channel layer 1
   uses, so a relationship reads the same colour in the list as on the canvas. */
.ig-relationship[data-edge='blocked-by'] {
  border-left-color: var(--ig-edge-blocked-by);
}

.ig-relationship[data-edge='duplicate-of'] {
  border-left-color: var(--ig-edge-duplicate-of);
}

.ig-relationship[data-edge='serialize-with'] {
  border-left-color: var(--ig-edge-serialize-with);
}

.ig-relationship[data-edge='together-with'] {
  border-left-color: var(--ig-edge-together-with);
}

.ig-relationship[data-edge='decomposed-from'] {
  border-left-color: var(--ig-edge-decomposed-from);
}

/* The button fills its row, so the whole relationship is the hit target rather
   than the words inside it. Transparent and borderless: the li already carries
   the border and the hue, and a second box around it would read as two
   controls. */
.ig-relationship-select {
  flex: 1;
  display: flex;
  gap: var(--ig-space-tight);
  align-items: baseline;
  background: none;
  border: none;
  padding: 0;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.ig-relationship-select:focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

.ig-relationship-kind {
  font-family: var(--ig-font-mono);
  color: var(--ig-text-body);
}

.ig-relationship-ref {
  font-family: var(--ig-font-mono);
  color: var(--ig-text-muted);
}
`;
