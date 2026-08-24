/**
 * What a projection returns.
 *
 * A scene is the drawn tree PLUS the traversal it implies. Keeping the two
 * together is what lets keyboard navigation walk the order rather than the
 * picture: the graph projection places stations by geometry but publishes its
 * `focusOrder` in rank order, and `navigate` reads only the published order. A
 * projection that returned markup alone would leave every consumer to recover
 * an order from coordinates, which is exactly the rule the design forbids.
 */

import type { ElementSpec } from './element.ts';

/** Which projection produced a scene. */
export type Projection = 'linear' | 'graph' | 'tree';

/** The neighbours a lateral key press moves to, when there are any. */
export interface LateralNeighbours {
  readonly left?: string | undefined;
  readonly right?: string | undefined;
}

export interface Scene {
  readonly projection: Projection;
  readonly root: ElementSpec;
  /**
   * Every key the vertical keys walk, in the order they walk them. For the
   * spine that is RANK ORDER — never the order boxes happen to sit in.
   */
  readonly focusOrder: readonly string[];
  /**
   * Every key that can hold focus at all — `focusOrder` FIRST, then any key
   * reachable only sideways.
   *
   * The two differ because a lateral move is not a position in the order: a
   * gutter node is somewhere focus can GO without being somewhere `ArrowDown`
   * ever stops. Resolving focus against `focusOrder` alone bounced focus off
   * every such node on the next redraw, and rendered no tab stop for it — so
   * membership questions ask this, and `focusOrder` answers ordering questions.
   * `focusOrder` leads, so the first entry is the same under either.
   */
  readonly navigable: readonly string[];
  /** Key -> its lateral neighbours. Absent for keys with none. */
  readonly lateral: ReadonlyMap<string, LateralNeighbours>;
  /** Anything the projection had to drop or refuse, for the host to surface. */
  readonly diagnostics: readonly string[];
}

/** The attribute every focusable element carries, and the key it announces. */
export const KEY_ATTRIBUTE = 'data-ig-key';

/**
 * Which key holds the roving tab stop.
 *
 * ONE RULE, USED BY THE PROJECTIONS AND BY `reconcile`. They have to agree: the
 * projections decide which element renders `tabindex="0"`, `reconcile` decides
 * what `handle.state.focused` reports, and a viewer whose markup and whose
 * reported state disagree is one a keyboard cannot enter. Two spellings of
 * "which key is focused" is exactly how they came to disagree — a requested key
 * the projection no longer draws rendered NO tab stop at all.
 *
 * Selection is the fallback before the first item because a switch changes
 * representation, never subject: landing focus on what the reader was looking
 * at beats landing it at the top.
 */
export function resolveFocusKey(
  navigable: readonly string[],
  focused: string | null | undefined,
  selected: string | null | undefined,
): string | null {
  if (focused !== null && focused !== undefined && navigable.includes(focused)) return focused;
  if (selected !== null && selected !== undefined && navigable.includes(selected)) return selected;
  return navigable[0] ?? null;
}
