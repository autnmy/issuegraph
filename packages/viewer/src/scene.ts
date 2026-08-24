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
   * Every focusable key, in the order `Tab` and the vertical keys walk them.
   * For the spine that is RANK ORDER — never the order boxes happen to sit in.
   */
  readonly focusOrder: readonly string[];
  /** Key -> its lateral neighbours. Absent for keys with none. */
  readonly lateral: ReadonlyMap<string, LateralNeighbours>;
  /** Anything the projection had to drop or refuse, for the host to surface. */
  readonly diagnostics: readonly string[];
}

/** The attribute every focusable element carries, and the key it announces. */
export const KEY_ATTRIBUTE = 'data-ig-key';
