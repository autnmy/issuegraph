/**
 * The ladder's view state, and the only transitions that reach it.
 *
 * Focusing a component, searching for one, and opening the isolated list are
 * NOT edits: nothing about the document changes, so none of them is a
 * `Proposal` and none of them goes near the store. They are the reader's
 * position in the ladder, which is why they live in their own tiny reducer
 * rather than being threaded through the render as loose arguments.
 *
 * THE THREE FIELDS ARE ORTHOGONAL, and every transition touches exactly one of
 * them. That is a decision rather than an omission: an earlier sketch had
 * `focus` close the isolated list, which reads as tidy and is really a second
 * rule a reader has to hold — the list is a list of issues that are in no
 * component, so it says nothing about which component is drawn and has no
 * reason to move when that changes.
 */

/** Where the reader is standing in the ladder. */
export interface ScaleState {
  /**
   * A key inside the component the canvas is narrowed to, or `null` for every
   * component at once.
   *
   * ANY MEMBER, NOT THE LEAD. Search-to-focus hands back the issue the reader
   * searched for, and making that the lead's problem would mean the caller
   * resolving a component before it can ask for one.
   */
  readonly focus: string | null;
  /** The search box's contents, verbatim. Empty means the box is untouched. */
  readonly query: string;
  readonly isolatedOpen: boolean;
}

export const INITIAL_SCALE_STATE: ScaleState = Object.freeze({
  focus: null,
  query: '',
  isolatedOpen: false,
});

export type ScaleCommand =
  | { readonly kind: 'focus'; readonly key: string }
  | { readonly kind: 'clear-focus' }
  | { readonly kind: 'search'; readonly query: string }
  | { readonly kind: 'open-isolated' }
  | { readonly kind: 'close-isolated' };

/**
 * Apply one command. Total, pure, and never mutates what it is given.
 *
 * AN EXHAUSTIVE SWITCH OVER A DISCRIMINATED UNION, which is the one branching
 * shape `AGENTS.md`'s boundary rule leaves open and the shape this repository
 * already uses for the same job (`sceneFor`, in the viewer's `render.ts`). The
 * table it would otherwise be — `kind` to handler — cannot be dispatched
 * without a cast: the handlers' parameter types intersect rather than union at
 * the call site, and a cast is exactly what the strict-TypeScript rule forbids.
 * A compile-time-total switch buys the same guarantee honestly: adding a
 * command without a case fails the build here rather than silently returning
 * the state unchanged.
 */
export function scaleReducer(state: ScaleState, command: ScaleCommand): ScaleState {
  switch (command.kind) {
    case 'focus':
      return { ...state, focus: command.key };
    case 'clear-focus':
      return { ...state, focus: null };
    case 'search':
      return { ...state, query: command.query };
    case 'open-isolated':
      return { ...state, isolatedOpen: true };
    case 'close-isolated':
      return { ...state, isolatedOpen: false };
  }
}
