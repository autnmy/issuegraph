/**
 * The DOM shell — the only module in this package that touches nodes.
 *
 * It is deliberately thin. Everything that could be wrong about WHAT is drawn
 * lives in the projections, everything that could be wrong about WHERE
 * navigation goes lives in `navigate`, and what is left here is three
 * listeners, an index from key to element, and a teardown. A shell that grew
 * decisions would be a second implementation of the parts above it, testable
 * only through a DOM.
 *
 * IT REACHES NO GLOBAL. The document comes from the container the caller
 * passed, which is what keeps this module importable on a runtime that has no
 * DOM — the property the workspace smoke test measures against the published
 * entry.
 */

import { type NormalizedDocument, type ViewerDocument, normalizeDocument } from './document.ts';
import { type SpecDocument, type SpecElement, materialize } from './element.ts';
import {
  type NavigationState,
  initialNavigationState,
  navigate,
  reconcile,
} from './navigation.ts';
import { type RenderOptions, sceneFor } from './render.ts';
import { GROUP_ATTRIBUTE, KEY_ATTRIBUTE, type Projection, type Scene } from './scene.ts';
import { type Theme, defaultTheme } from './theme.ts';

/** The slice of an element `mount` needs beyond building. */
export interface MountElement extends SpecElement {
  readonly ownerDocument: SpecDocument;
  /** Upper-case, as the DOM reports it. Absent on an implementation that has none. */
  readonly tagName?: string;
  addEventListener(type: string, handler: (event: MountEvent) => void): void;
  removeEventListener(type: string, handler: (event: MountEvent) => void): void;
  removeChild(child: SpecElement): void;
  getAttribute(name: string): string | null;
  readonly parentElement: MountElement | null;
  focus?(): void;
}

/** The slice of an event `mount` reads. */
export interface MountEvent {
  readonly target?: MountElement | null;
  /** Present on a keyboard event. */
  readonly key?: string;
  preventDefault?(): void;
}

export interface MountOptions extends RenderOptions {
  /** Called when a key is selected — by click, `Enter`, or `select()`. */
  readonly onSelect?: ((key: string | null) => void) | undefined;
  /** Called with the hovered key, and with `null` when nothing is hovered. */
  readonly onHover?: ((key: string | null) => void) | undefined;
}

export interface ViewerHandle {
  /** Redraw. A still-present selection survives; focus follows it. */
  update(input: ViewerDocument, options?: MountOptions): void;
  /** Switch projection. The subject is kept; only the representation changes. */
  setProjection(projection: Projection): void;
  /** Select a key programmatically. Fires `onSelect` exactly as a click does. */
  select(key: string | null): void;
  readonly state: NavigationState;
  /** Remove every listener this handle added and empty the container. */
  destroy(): void;
}

/**
 * Elements that own their own keyboard activation.
 *
 * Every row deliberately carries a deep-link chip, and `keydown` BUBBLES — so
 * the viewer's own Enter/Space handling ran while focus was on the anchor,
 * called `preventDefault()`, and suppressed the link. A projection that exposes
 * a link a keyboard cannot follow has not exposed it.
 */
const SELF_ACTIVATING_TAGS: ReadonlySet<string> = new Set([
  'A',
  'BUTTON',
  'INPUT',
  'SELECT',
  'TEXTAREA',
]);

function ownsItsOwnActivation(
  target: MountElement | null | undefined,
  container: MountElement,
): boolean {
  let cursor: MountElement | null = target ?? null;
  while (cursor !== null && cursor !== container) {
    const tag = cursor.tagName;
    if (tag !== undefined && SELF_ACTIVATING_TAGS.has(tag.toUpperCase())) return true;
    cursor = cursor.parentElement;
  }
  return false;
}

/**
 * Walk up from an event target to the nearest element carrying a key.
 *
 * BOUNDED AT THE CONTAINER. An unbounded walk keeps climbing into the host's
 * own page, so an ancestor that happens to carry `data-ig-key` — a host
 * rendering two viewers, or reusing the attribute — would answer for a click
 * that landed on nothing of ours. Stopping at the mount point makes the answer
 * a fact about this viewer.
 *
 * DECORATION ANSWERS TOO, through {@link GROUP_ATTRIBUTE}. The enclosure and
 * its connector are deliberately outside the focus index — one element per key
 * or `focus()` lands on the wrong one — but they are still visible marks a
 * reader can click, and the design states the connector IS a click target.
 * Reading both attributes here separates "what may take focus" from "what may
 * be pointed at" rather than making one attribute answer both.
 */
function keyAt(
  target: MountElement | null | undefined,
  container: MountElement,
  // WHICH IDENTITY IS BEING ASKED FOR. Pointing and focusing are different
  // questions — see the note above — so the caller names the attributes rather
  // than a second near-identical walk being written for the narrower one, which
  // is how two walkers drift apart.
  attributes: readonly string[] = [KEY_ATTRIBUTE, GROUP_ATTRIBUTE],
): string | null {
  let cursor: MountElement | null = target ?? null;
  while (cursor !== null) {
    for (const attribute of attributes) {
      const key = cursor.getAttribute(attribute);
      if (key !== null && key !== '') return key;
    }
    if (cursor === container) return null;
    cursor = cursor.parentElement;
  }
  return null;
}

/**
 * Mount a viewer into a container.
 *
 * Returns a handle rather than nothing, because a host that cannot tear this
 * down leaks a listener on every re-render — the shell's one genuine hazard.
 */
export function mountViewer(
  container: MountElement,
  input: ViewerDocument,
  options: MountOptions = {},
): ViewerHandle {
  const doc = container.ownerDocument;
  let currentOptions: MountOptions = options;
  let projection: Projection = options.projection ?? 'linear';
  let normalized: NormalizedDocument = normalizeDocument(input).document;
  // SEEDED FROM THE OPTIONS, not from nothing. `MountOptions` carries
  // `selected` and `focused` because it extends the render options, so a caller
  // restoring a view — after a projection toggle, a route change, a reload —
  // passes them here. Starting empty silently discarded them and dropped the
  // caller straight back to the top of the order.
  let state: NavigationState = {
    focused: options.focused ?? initialNavigationState.focused,
    selected: options.selected ?? initialNavigationState.selected,
  };
  let root: SpecElement | null = null;
  let keyed = new Map<string, SpecElement>();
  let hovered: string | null = null;
  let destroyed = false;
  // Set by the first `draw()` below, which runs before any listener can fire.
  let currentScene: Scene | null = null;

  const theme: Theme = options.theme ?? defaultTheme;

  const draw = (): void => {
    if (root !== null) container.removeChild(root);
    const scene = sceneFor(normalized, projection, {
      ...currentOptions,
      theme: currentOptions.theme ?? theme,
      selected: state.selected,
      focused: state.focused,
    });
    state = reconcile(scene, state);
    keyed = new Map<string, SpecElement>();
    root = materialize(doc, scene.root, {
      onElement: (spec, node) => {
        const key = spec.attrs?.[KEY_ATTRIBUTE];
        if (typeof key === 'string' && key !== '' && !keyed.has(key)) keyed.set(key, node);
      },
    });
    container.appendChild(root);
    currentScene = scene;
    // A REDRAW CAN REMOVE THE HOVERED ISSUE, and `pointerleave` does not fire
    // when it does: the element under the pointer is destroyed while the
    // pointer stays inside the container, so the handler that clears `hovered`
    // never runs. The host was then left holding a key for an issue this
    // document no longer carries, and never received the documented
    // `onHover(null)` until the pointer left the whole viewer.
    // IN `draw()` RATHER THAN IN `update()`, because the removal is a property
    // of REDRAWING, not of one entry point — `setProjection` and a selection
    // redraw can drop the key just as `update` can.
    // ASK THE DOCUMENT, NOT `keyed`. Decoration announces itself through
    // GROUP_ATTRIBUTE and deliberately never enters the focus index, so a
    // hover on an enclosure or a connector is absent from `keyed` on every
    // redraw — clearing on that test would fire constantly on a hover that is
    // perfectly live. Both attributes carry an ISSUE key, so membership in the
    // normalized document is the test that answers for both.
    if (hovered !== null && !normalized.byKey.has(hovered)) {
      hovered = null;
      currentOptions.onHover?.(null);
    }
  };

  const emitSelect = (key: string | null): void => {
    state = { ...state, selected: key, focused: key ?? state.focused };
    draw();
    // FOCUS FOLLOWS THE SUBJECT — the movement branch of `onKeyDown` already
    // does this, and selection needs it for the same reason: `draw()` destroys
    // the subtree holding focus and mounts a replacement. Without it a reader
    // who pressed Enter dropped focus out of the viewer entirely, so no later
    // arrow key reached the container and keyboard navigation was over.
    // HERE AND NOT IN `draw()`, which is the tempting generalization and the
    // wrong one: `update()` redraws too, and a host that refreshes the document
    // while the reader is somewhere else on the page would have focus YANKED
    // into the viewer. Restoring only where the viewer itself moved the subject
    // keeps that impossible. Narrowing `draw()` correctly instead would need to
    // know whether focus was already inside — an `activeElement` this module
    // deliberately does not ask its host for.
    // IT COVERS THE CLICK AND `select()` PATHS TOO, which is what the handle
    // documents: selection "fires onSelect exactly as a click does", and a
    // click moves focus. `:focus-visible` is what keeps the ring off a pointer
    // user, so this costs a mouse reader nothing.
    if (state.focused !== null) keyed.get(state.focused)?.focus?.();
    currentOptions.onSelect?.(key);
  };

  const onClick = (event: MountEvent): void => {
    const key = keyAt(event.target, container);
    if (key === null) return;
    emitSelect(key);
  };

  const onPointerOver = (event: MountEvent): void => {
    const key = keyAt(event.target, container);
    if (key === hovered) return;
    hovered = key;
    currentOptions.onHover?.(key);
  };

  const onPointerLeave = (): void => {
    if (hovered === null) return;
    hovered = null;
    currentOptions.onHover?.(null);
  };

  const onKeyDown = (event: MountEvent): void => {
    if (event.key === undefined || currentScene === null) return;
    // An activation key on a control that activates itself is that control's.
    // Movement keys are still the viewer's — a reader on a link must be able to
    // arrow away from it.
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      ownsItsOwnActivation(event.target, container)
    ) {
      return;
    }
    // SYNC FOCUS FROM THE DOM BEFORE MOVING. `state.focused` tracks the viewer's
    // OWN moves — its arrow keys and its clicks — and native Tab is neither. A
    // reader who tabs into the deep link inside the third row leaves `focused`
    // pointing wherever it was, so ArrowDown moved relative to the OLD row and
    // sent focus BACKWARDS past the row they were standing in.
    // FOCUS IDENTITY ONLY, hence the explicit attribute list: `GROUP_ATTRIBUTE`
    // marks decoration that is deliberately outside the focus index, so adopting
    // one would set `focused` to a key `navigate` cannot find — which resolves
    // to -1 and throws the reader back to the top of the order. That is the same
    // bug this fixes, arriving through the fix.
    // `navigable`, NOT `focusOrder`: a gutter node reachable only sideways is a
    // legitimate place to be standing, and `focusOrder` does not contain it.
    const standingOn = keyAt(event.target, container, [KEY_ATTRIBUTE]);
    if (standingOn !== null && standingOn !== state.focused && currentScene.navigable.includes(standingOn)) {
      state = { ...state, focused: standingOn };
    }
    const result = navigate(currentScene, state, event.key);
    if (result.command.kind === 'none') return;
    event.preventDefault?.();
    if (result.command.kind === 'select') {
      emitSelect(result.command.key);
      return;
    }
    state = result.state;
    draw();
    keyed.get(result.command.key)?.focus?.();
  };

  container.addEventListener('click', onClick);
  container.addEventListener('pointerover', onPointerOver);
  container.addEventListener('pointerleave', onPointerLeave);
  container.addEventListener('keydown', onKeyDown);

  draw();

  return {
    update(next: ViewerDocument, nextOptions?: MountOptions): void {
      if (destroyed) return;
      if (nextOptions !== undefined) currentOptions = nextOptions;
      if (nextOptions?.projection !== undefined) projection = nextOptions.projection;
      normalized = normalizeDocument(next).document;
      draw();
    },
    setProjection(next: Projection): void {
      if (destroyed) return;
      projection = next;
      draw();
    },
    select(key: string | null): void {
      if (destroyed) return;
      emitSelect(key);
    },
    get state(): NavigationState {
      return state;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      container.removeEventListener('click', onClick);
      container.removeEventListener('pointerover', onPointerOver);
      container.removeEventListener('pointerleave', onPointerLeave);
      container.removeEventListener('keydown', onKeyDown);
      if (root !== null) container.removeChild(root);
      root = null;
      keyed = new Map<string, SpecElement>();
    },
  };
}
