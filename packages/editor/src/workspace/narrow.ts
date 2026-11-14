/**
 * The narrow layout's vocabulary: what the canvas zone draws, and the three
 * tabs that pick one view at a time under `640`.
 *
 * ITS OWN FILE BECAUSE TWO LAYERS NEED IT. `host.ts` holds the canvas mode in
 * its state, and `mount.ts` imports `host.ts` and re-exports these names for
 * the package's own index, so neither of them can be the one that defines it.
 *
 * THE TAB IS DERIVED, NEVER STORED. A press sets two facts the host already
 * needs — which zone the narrow layout shows, and which mode the canvas zone
 * draws — and {@link narrowTabOf} reads the tab back from them. A stored tab
 * could disagree with the mode after a host's `update({ canvas })`; a derived
 * one cannot.
 */

/** What the canvas zone draws: the editor's scale ladder, or the viewer's tree projection. */
export const CANVAS_MODES = Object.freeze(['neighbourhood', 'tree'] as const);
export type CanvasMode = (typeof CANVAS_MODES)[number];

/** Which zone the narrow layout shows: the rail's order, or the canvas zone. */
export type NarrowView = 'order' | 'canvas';

/** The tabs drawn under `640`, in the order they are drawn. Each is a `narrow-tab` value. */
export const NARROW_TABS = Object.freeze(['order', 'related', 'sub-issues'] as const);
export type NarrowTab = (typeof NARROW_TABS)[number];

/**
 * What one tab press sets. `canvas: null` keeps the mode the reader had.
 *
 * Order keeps it so the wider layouts still draw the mode the reader last
 * picked. Related groups is drawn over the neighbourhood and Sub-issues is the
 * tree, so those two tabs set the mode as well as the view.
 */
interface NarrowTabPress {
  readonly narrowView: NarrowView;
  readonly canvas: CanvasMode | null;
}

const NARROW_TAB_PRESSES: Readonly<Record<NarrowTab, NarrowTabPress>> = Object.freeze({
  order: { narrowView: 'order', canvas: null },
  related: { narrowView: 'canvas', canvas: 'neighbourhood' },
  'sub-issues': { narrowView: 'canvas', canvas: 'tree' },
});

/** The tab that shows each canvas mode in the canvas zone. */
const CANVAS_TABS: Readonly<Record<CanvasMode, NarrowTab>> = Object.freeze({
  neighbourhood: 'related',
  tree: 'sub-issues',
});

/**
 * Whether a string names a tab.
 *
 * A guard over the tuple rather than a lookup in the table: the value comes off
 * a `data-ig-value` attribute, and a property lookup would find `constructor`
 * or `toString` on the table's prototype.
 */
export function isNarrowTab(value: string): value is NarrowTab {
  return NARROW_TABS.some((tab): boolean => tab === value);
}

/** The view and mode a tab press leaves, starting from the mode the reader had. */
export function pressNarrowTab(
  tab: NarrowTab,
  canvas: CanvasMode,
): { readonly narrowView: NarrowView; readonly canvas: CanvasMode } {
  const press = NARROW_TAB_PRESSES[tab];
  return { narrowView: press.narrowView, canvas: press.canvas ?? canvas };
}

/** The tab that shows a canvas mode: what the middle zone's switch marks selected. */
export function canvasTabOf(canvas: CanvasMode): NarrowTab {
  return CANVAS_TABS[canvas];
}

/** The tab a view and a mode stand for: what `data-tab` and `aria-selected` say. */
export function narrowTabOf(narrowView: NarrowView, canvas: CanvasMode): NarrowTab {
  return narrowView === 'order' ? 'order' : canvasTabOf(canvas);
}
