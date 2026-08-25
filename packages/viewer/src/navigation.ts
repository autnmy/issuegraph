/**
 * Keyboard navigation, as a pure reducer.
 *
 * It takes a scene, the current state and a key name, and returns the next
 * state plus the one thing the shell should do. No DOM, no events, no
 * side-effects — which is what lets the whole key map be tested exhaustively on
 * a runtime with no DOM at all, and what leaves `mount.ts` with nothing to get
 * wrong except wiring.
 *
 * THE TRAVERSAL IS THE SCENE'S PUBLISHED ORDER, NEVER THE PICTURE. On the spine
 * that order is rank order, so `Tab` and the vertical keys walk the work order
 * even where the drawing places boxes elsewhere. Recovering an order from
 * coordinates is precisely what the design forbids, so this module cannot see
 * a coordinate.
 */

import { type Scene, resolveFocusKey } from './scene.ts';

export interface NavigationState {
  /** The roving tab stop. `null` before anything has been focused. */
  readonly focused: string | null;
  /** The selected key, which survives a projection change. */
  readonly selected: string | null;
}

/** What the shell should do. `none` means the host keeps its own shortcut. */
export type NavigationCommand =
  | { readonly kind: 'none' }
  | { readonly kind: 'focus'; readonly key: string }
  | { readonly kind: 'select'; readonly key: string };

export interface NavigationResult {
  readonly state: NavigationState;
  readonly command: NavigationCommand;
}

export const initialNavigationState: NavigationState = Object.freeze({
  focused: null,
  selected: null,
});

function indexOfFocus(scene: Scene, state: NavigationState): number {
  if (state.focused === null) return -1;
  return scene.focusOrder.indexOf(state.focused);
}

function stay(state: NavigationState): NavigationResult {
  return { state, command: { kind: 'none' } };
}

function moveTo(state: NavigationState, key: string): NavigationResult {
  return { state: { ...state, focused: key }, command: { kind: 'focus', key } };
}

/**
 * Re-resolve state against a scene.
 *
 * Switching projection changes the REPRESENTATION, never the subject, so a
 * selection carries across. Focus follows it when it can; when the new
 * projection does not draw the focused key at all, focus falls to the first
 * item rather than nowhere.
 */
export function reconcile(scene: Scene, state: NavigationState): NavigationState {
  // Selection is carried WHOLE, even when the new projection does not draw it.
  // It is the subject, and a switch changes representation rather than subject;
  // dropping it here would make the toggle lose the thing the reader is looking
  // at, which is the one property the design fixes about switching.
  //
  // Focus goes through the SHARED rule, so what this reports and what the
  // projection rendered a tab stop on cannot diverge.
  return {
    focused: resolveFocusKey(scene.navigable, state.focused, state.selected),
    selected: state.selected,
  };
}

/**
 * Apply one key.
 *
 * Movement never wraps: the ends of the order are the ends of the work, and a
 * list that silently teleports to the top reads as a jump rather than as a
 * boundary. An unhandled key returns the state untouched and `none`, so a host
 * keeps every shortcut this package does not claim.
 */
export function navigate(scene: Scene, state: NavigationState, key: string): NavigationResult {
  const order = scene.focusOrder;
  if (order.length === 0) return stay(state);

  const current = indexOfFocus(scene, state);
  const first = order[0] as string;
  const last = order[order.length - 1] as string;

  switch (key) {
    case 'ArrowDown': {
      if (current === -1) return moveTo(state, first);
      const next = order[Math.min(current + 1, order.length - 1)] as string;
      return next === state.focused ? stay(state) : moveTo(state, next);
    }
    case 'ArrowUp': {
      if (current === -1) return moveTo(state, first);
      const next = order[Math.max(current - 1, 0)] as string;
      return next === state.focused ? stay(state) : moveTo(state, next);
    }
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (state.focused === null) return moveTo(state, first);
      const neighbours = scene.lateral.get(state.focused);
      const target = key === 'ArrowLeft' ? neighbours?.left : neighbours?.right;
      return target === undefined ? stay(state) : moveTo(state, target);
    }
    case 'Home':
      return state.focused === first ? stay(state) : moveTo(state, first);
    case 'End':
      return state.focused === last ? stay(state) : moveTo(state, last);
    case 'Enter':
    case ' ': {
      const target = state.focused ?? first;
      return {
        state: { focused: target, selected: target },
        command: { kind: 'select', key: target },
      };
    }
    default:
      return stay(state);
  }
}
