/**
 * The structural stylesheet.
 *
 * It carries layout, weight and state — never a value. Every colour, size and
 * spacing here is a `var(--ig-…)` reference resolved by whatever theme the host
 * installs, which is what makes "supply a second theme through custom
 * properties" a real capability rather than a claim. `styles.test.ts` scans
 * this string for a literal colour or a fixed pixel length and fails on either,
 * so the rule is enforced against the bytes rather than remembered.
 *
 * Shipped as a string, not a `.css` file: an entry that imports CSS cannot be
 * loaded by a bare Node runtime (`ERR_UNKNOWN_FILE_EXTENSION`), and this
 * package's floor is checked by a smoke test that imports the built entry. A
 * string also means no consumer needs a bundler to use it.
 */

export const viewerStylesheet = `
.ig-viewer {
  background: var(--ig-bg);
  color: var(--ig-text-body);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size);
  line-height: var(--ig-line-height);
  position: relative;
}

.ig-viewer *,
.ig-viewer *::before,
.ig-viewer *::after {
  box-sizing: border-box;
}

.ig-viewer :focus-visible {
  outline: var(--ig-focus-ring) solid var(--ig-focus);
  outline-offset: var(--ig-space-tight);
}

.ig-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* ── the spine ─────────────────────────────────────────────────────────── */

.ig-slot {
  align-items: center;
  background: var(--ig-surface);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  column-gap: var(--ig-space);
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  margin-bottom: var(--ig-space-tight);
  min-height: var(--ig-row-height);
  padding: var(--ig-space-tight) var(--ig-space);
}

.ig-slot[data-held='true'] {
  background: var(--ig-surface-2);
  border-style: dashed;
}

.ig-slot[aria-current='true'] {
  border-color: var(--ig-accent);
}

.ig-rank {
  color: var(--ig-text);
  font-family: var(--ig-font-mono);
  font-variant-numeric: tabular-nums;
  min-width: calc(var(--ig-char-width) * 4);
  text-align: right;
}

.ig-rank[data-held='true'] {
  color: var(--ig-text-muted);
}

/* ── readiness stations ────────────────────────────────────────────────── */

.ig-station {
  block-size: var(--ig-station-size);
  border: var(--ig-stroke) solid var(--ig-station-held);
  border-radius: 50%;
  box-shadow: 0 0 0 var(--ig-station-halo) var(--ig-bg);
  display: inline-block;
  inline-size: var(--ig-station-size);
}

.ig-station[data-fill='filled'] {
  background: var(--ig-station-ready);
  border-color: var(--ig-station-ready);
}

.ig-station[data-fill='hollow'] {
  background: transparent;
  border-color: var(--ig-station-pending);
}

.ig-station[data-fill='dashed'] {
  background: transparent;
  border-style: dashed;
  border-color: var(--ig-station-held);
}

/* ── titles, identity, provenance ──────────────────────────────────────── */

.ig-title {
  color: var(--ig-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ig-id,
.ig-count {
  color: var(--ig-text-muted);
  font-family: var(--ig-font-mono);
  font-variant-numeric: tabular-nums;
}

.ig-link {
  color: var(--ig-accent);
  text-decoration: none;
}

.ig-link:hover {
  text-decoration: underline;
}

.ig-provenance,
.ig-hold {
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-small);
  grid-column: 3 / -1;
}

.ig-strike {
  text-decoration: line-through;
}

/* ── edge badges ───────────────────────────────────────────────────────── */

.ig-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space-tight);
}

.ig-badge {
  align-items: center;
  border: var(--ig-stroke) solid currentColor;
  border-radius: var(--ig-radius);
  display: inline-flex;
  font-size: var(--ig-font-size-small);
  gap: var(--ig-space-tight);
  padding: 0 var(--ig-space-tight);
}

.ig-badge[data-edge='blocked-by'] { color: var(--ig-edge-blocked-by); border-style: solid; }
.ig-badge[data-edge='serialize-with'] { color: var(--ig-edge-serialize-with); border-style: double; }
.ig-badge[data-edge='together-with'] { color: var(--ig-edge-together-with); border-style: solid; }
.ig-badge[data-edge='duplicate-of'] { color: var(--ig-edge-duplicate-of); border-style: dotted; }
.ig-badge[data-edge='decomposed-from'] { color: var(--ig-edge-decomposed-from); border-style: dashed; }

.ig-glyph {
  font-family: var(--ig-font-mono);
}

/* ── the footer group: holds that earn no rank slot ────────────────────── */

.ig-footer {
  border-top: var(--ig-stroke) solid var(--ig-line);
  margin-top: var(--ig-space);
  padding-top: var(--ig-space);
}

.ig-footer-title {
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-small);
  margin: 0 0 var(--ig-space-tight);
}

/* ── the graph canvas ──────────────────────────────────────────────────── */

.ig-canvas {
  display: block;
  inline-size: 100%;
}

.ig-node {
  fill: var(--ig-surface);
  stroke: var(--ig-line);
  stroke-width: var(--ig-stroke);
}

.ig-node[data-held='true'] {
  fill: var(--ig-surface-2);
  stroke-dasharray: 4 3;
}

.ig-node-label {
  fill: var(--ig-text);
  font-family: var(--ig-font-ui);
  font-size: var(--ig-font-size-small);
}

.ig-edge {
  fill: none;
  stroke-width: var(--ig-stroke);
}

.ig-edge[data-edge='blocked-by'] { stroke: var(--ig-edge-blocked-by); }
.ig-edge[data-edge='serialize-with'] { stroke: var(--ig-edge-serialize-with); }
.ig-edge[data-edge='together-with'] { stroke: var(--ig-edge-together-with); }
.ig-edge[data-edge='duplicate-of'] { stroke: var(--ig-edge-duplicate-of); }
.ig-edge[data-edge='decomposed-from'] { stroke: var(--ig-edge-decomposed-from); }

/* The dash pattern is set per element from the edge vocabulary, never here —
   one source for the channel the colour-blind-safety claim rests on. */
.ig-enclosure {
  fill: none;
  stroke: var(--ig-edge-together-with);
  stroke-width: var(--ig-stroke);
}

.ig-connector {
  stroke: var(--ig-edge-together-with);
  stroke-width: var(--ig-stroke-connector);
}

/* currentColor on the marker resolves to the inherited text colour, not to the
   edge's stroke — so a terminal has to be given the hue explicitly or it renders
   in body text and the fourth channel silently collapses. */
.ig-terminal {
  color: var(--ig-text-body);
  stroke-width: var(--ig-stroke);
}

.ig-terminal[data-edge='blocked-by'] { color: var(--ig-edge-blocked-by); }
.ig-terminal[data-edge='serialize-with'] { color: var(--ig-edge-serialize-with); }
.ig-terminal[data-edge='together-with'] { color: var(--ig-edge-together-with); }
.ig-terminal[data-edge='duplicate-of'] { color: var(--ig-edge-duplicate-of); }
.ig-terminal[data-edge='decomposed-from'] { color: var(--ig-edge-decomposed-from); }

/* ── refusals and empty states ─────────────────────────────────────────── */

.ig-refusal,
.ig-empty {
  background: var(--ig-surface-2);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  color: var(--ig-text-body);
  padding: var(--ig-space);
}

.ig-refusal-next {
  color: var(--ig-text);
  margin: var(--ig-space-tight) 0 0;
}

.ig-capsule {
  align-items: baseline;
  background: var(--ig-surface);
  border: var(--ig-stroke) solid var(--ig-line);
  border-radius: var(--ig-radius);
  display: flex;
  gap: var(--ig-space);
  margin-top: var(--ig-space-tight);
  padding: var(--ig-space-tight) var(--ig-space);
}

/* ── the decomposition tree ────────────────────────────────────────────── */

.ig-tree,
.ig-tree .ig-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.ig-tree .ig-list {
  border-left: var(--ig-stroke) dashed var(--ig-edge-decomposed-from);
  margin-left: var(--ig-space);
  padding-left: var(--ig-space);
}

.ig-tree-item {
  padding: var(--ig-space-tight) 0;
}

/* ── legend ────────────────────────────────────────────────────────────── */

.ig-legend {
  border: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--ig-space);
  margin: 0 0 var(--ig-space);
  padding: 0;
}

.ig-legend-caption {
  color: var(--ig-text-muted);
  font-size: var(--ig-font-size-small);
  padding: 0;
}
`;
