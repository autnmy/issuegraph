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

import { edgeIdentity } from '@issuegraph/core';

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
import { type Theme, resolveTheme } from './theme.ts';

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
  // EVERY IDENTITY THE LAST DRAW PUT UNDER THE POINTER — issues AND decoration.
  // Rebuilt by each `draw()` from the scene it just materialized, and read by
  // BOTH the hover reconciliation and `emitSelect`, because "what the pointer
  // can name" is one question. A click and a hover resolve their target through
  // the same `keyAt` walk, so answering them from two different sets is how a
  // mark becomes hoverable but unselectable.
  let pointable = new Set<string>();
  /**
   * Whether this document carries the edge a key names.
   *
   * THE EDGE COUNTERPART OF `byKey`, and that symmetry is the whole point. An
   * edge identity is in no document MAP, so before this the only evidence an
   * edge existed was that some projection had drawn a mark for it — which made
   * a selection's survival a property of the CURRENT REPRESENTATION rather than
   * of the subject. An ISSUE has never been held to that standard: `byKey`
   * answers for one whether or not the active projection draws its row, which
   * is why an issue selection already survives into a projection that renders
   * nothing for it.
   *
   * DERIVED FROM `normalized` ON EVERY CALL rather than cached beside it. There
   * are two assignment sites (mount and `update`), and a cache would have to be
   * rebuilt at both — the shape this file has been bitten by repeatedly, where
   * one site is updated and the other silently answers from a stale copy.
   * Reading the live value has no second site to forget.
   */
  const isDocumentEdge = (key: string): boolean =>
    normalized.edges.some((edge) => edgeIdentity(edge.field, edge.from, edge.to) === key);
  /**
   * Whether a key still names something the reader can be looking at.
   *
   * ASKED TWICE PER DRAW, from either side of the rebuild of `pointable`, and
   * that is exactly why it is a function rather than a copied condition: before
   * the rebuild it means "the last scene drew this", after it means "this one
   * does", and both are the question that site needs. Two hand-written copies
   * of it would answer differently the first time either was touched — the
   * failure this file has already recorded twice, once for focus keys and once
   * for the hover.
   *
   * THE DOCUMENT ANSWERS FIRST, FOR ISSUES AND FOR EDGES ALIKE; `pointable` is
   * what admits a mark the document cannot speak for. Resting an edge on
   * `pointable` alone made its survival depend on every projection publishing
   * an identity, and a projection that renders no mark for an edge therefore
   * DROPPED THE SUBJECT — the refused graph being the case with no arc and no
   * badge to fall back on, and an edge between two gutter nodes the case no
   * amount of rail-row badging can reach, since neither endpoint has a row.
   * Chasing that per representation is unbounded; asking the document is not.
   *
   * IT STILL CLEARS AN EDGE THE DOCUMENT DOES NOT CARRY. This widens the
   * evidence, not the acceptance: an identity naming an edge no longer in the
   * document fails every leg, so a host restoring a stale selection is refused
   * and an `update` that removes an edge still drops it.
   */
  const stillDrawn = (key: string): boolean =>
    normalized.byKey.has(key) || isDocumentEdge(key) || pointable.has(key);
  let hovered: string | null = null;
  let destroyed = false;
  // Set by the first `draw()` below, which runs before any listener can fire.
  let currentScene: Scene | null = null;

  const theme: Theme = resolveTheme(options.theme);

  // ONE PLACE THAT CLEARS A HOVER, because forgetting a site is exactly how this
  // kept going wrong: `pointerleave` had it, then a redraw needed it, and now
  // teardown does too. Three call sites open-coding two lines is a fourth site
  // waiting to omit them, so the rule lives here and the sites ask for it.
  const clearHover = (): void => {
    if (hovered === null) return;
    hovered = null;
    currentOptions.onHover?.(null);
  };

  // `announceSelection` is false ONLY for the redraw `emitSelect` runs, which
  // reports the settled selection itself — see there. Every other caller wants
  // the notice, because a reconciliation that moves the selection has moved it
  // out from under whoever set it.
  const draw = (announceSelection = true): void => {
    // A DOCUMENT UPDATE CAN REMOVE THE SELECTED ISSUE, and `reconcile` carries
    // the selection through whole — deliberately, because a PROJECTION switch
    // changes representation rather than subject and dropping it there would
    // lose the thing the reader is looking at. A document REPLACEMENT is the
    // other case: the subject can genuinely be gone, and the handle went on
    // reporting a key this document does not carry, against `update`'s own
    // documented promise that a still-present selection survives.
    // THE TEST IS DOCUMENT MEMBERSHIP, WHICH IS WHY IT COSTS THE PROJECTION
    // SWITCH NOTHING. `setProjection` redraws against the SAME `normalized`, so
    // `byKey` is unchanged and a still-present selection passes untouched —
    // preserved across a projection-only change and reconciled on replacement,
    // from one rule rather than from two entry points that can disagree.
    // THE SAME SHAPE AND THE SAME TEST AS THE HOVER RECONCILIATION at the foot
    // of this function, sitting apart from it only because the selection has to
    // be settled BEFORE the scene is built: `sceneFor` is handed
    // `state.selected`, so clearing afterwards would draw one frame marking a
    // selection that no longer exists.
    // WHAT THE SELECTION WAS BEFORE THIS DRAW TOUCHED IT. Two things can move
    // it — the document-membership drop just below, and `reconcile`'s
    // canonicalization to the station this projection draws it under — and the
    // host has to hear about BOTH. Keying the notice on a single `dropped` flag
    // covered only the first, so `setProjection` renamed the selection and told
    // nobody: the handle read the station while the host still held the member.
    const selectedBefore = state.selected;
    // A DECORATION SELECTION IS NOT AN ISSUE AND MUST SURVIVE THIS TEST. The
    // subject can be a `together-with` connector, whose identity is an edge and
    // is therefore absent from `byKey` by construction — dropping on document
    // membership alone deselected it on the very next redraw. Whether the NEW
    // scene still draws it is a different question, and it is answered below,
    // after materialize, exactly where the hover clear answers it.
    //
    // AND NOT AT ALL BEFORE THE FIRST DRAW, which is what `currentScene` tests.
    // `pointable` is empty until a scene has been materialized, so on mount
    // this check has NO evidence about decoration — it would clear a connector
    // identity a host passed as `selected`, making a selection impossible to
    // restore across a remount even though every later redraw preserves it.
    // The post-materialize check settles it a few lines down, against a scene
    // that exists; deferring costs one frame in which nothing renders an edge
    // selection anyway.
    if (currentScene !== null && state.selected !== null && !stillDrawn(state.selected)) {
      state = { ...state, selected: null };
    }
    if (root !== null) container.removeChild(root);
    const scene = sceneFor(normalized, projection, {
      ...currentOptions,
      theme: currentOptions.theme ?? theme,
      selected: state.selected,
      focused: state.focused,
    });
    state = reconcile(scene, state);
    keyed = new Map<string, SpecElement>();
    // EVERY POINTER IDENTITY THIS SCENE ACTUALLY DREW, which is a WIDER set than
    // `keyed` and a NARROWER one than the document. `keyed` holds focus
    // identities only; decoration announces itself through `GROUP_ATTRIBUTE` and
    // deliberately never enters the focus index, so an enclosure or a connector
    // is absent from `keyed` on every redraw. The hover reconciliation and the
    // selection both need both, and need them from the SCENE rather than from
    // `byKey` — a decoration identity is in no document.
    pointable = new Set<string>();
    // WHICH KEYS ARE INDEXED BY SOMETHING THAT CAN ACTUALLY TAKE FOCUS. `keyed`
    // is a FOCUS index — its only readers call `focus()` on what it holds — so
    // holding an element a browser ignores makes it silently useless.
    // FIRST-WINS WAS THE DEFECT, and the shape is specific: a RAILED lead is
    // emitted twice with `data-ig-key` — the canvas `<g>`, which carries no
    // `tabindex` because the rail row owns the tab stop, and then the row. The
    // canvas comes first, so every ranked row's `focus()` landed on the group:
    // arrow navigation moved nothing, and focus dropped out of the viewer after
    // a selection redraw. It passed 258 tests because the test double counted
    // every `focus()` call regardless of whether the element could take one.
    // A LATER FOCUSABLE ELEMENT REPLACES A STORED UNFOCUSABLE ONE, rather than
    // indexing only focusable elements: a key whose every element is unfocusable
    // still belongs in the map, so `focus?.()` on it is a no-op rather than a
    // lookup miss, and the pointer identity keeps working exactly as before.
    // TABINDEX **OR** A NATURALLY FOCUSABLE TAG, the same pair the test double
    // now applies — two notions of focusable that can disagree is how this class
    // hides, and it just did.
    const focusableKeys = new Set<string>();
    root = materialize(doc, scene.root, {
      onElement: (spec, node) => {
        const key = spec.attrs?.[KEY_ATTRIBUTE];
        if (typeof key === 'string' && key !== '') {
          const tabindex = spec.attrs?.tabindex;
          const canFocus =
            (tabindex !== undefined && tabindex !== null) || spec.tag === 'a' || spec.tag === 'button';
          if (!keyed.has(key) || (canFocus && !focusableKeys.has(key))) {
            keyed.set(key, node);
            if (canFocus) focusableKeys.add(key);
          }
          pointable.add(key);
        }
        const group = spec.attrs?.[GROUP_ATTRIBUTE];
        if (typeof group === 'string' && group !== '') pointable.add(group);
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
    // ASK WHAT THIS SCENE DREW, NOT WHAT THE DOCUMENT CARRIES. Both tests reject
    // `keyed` alone, and for the reason that still stands: decoration announces
    // itself through `GROUP_ATTRIBUTE` and never enters the focus index, so
    // clearing on `keyed` would fire constantly on a hover that is perfectly
    // live. The earlier answer — document membership — was the wrong correction,
    // because the document is not what the pointer is over.
    // A PROJECTION SWITCH IS WHERE THE TWO COME APART. An off-order edge endpoint
    // is drawn on the graph canvas and has no row in the linear projection, so
    // switching destroys the element while its issue stays in `byKey` — the
    // document test then preserves a hover on something that is no longer on
    // screen, and the host never receives the documented `onHover(null)` until
    // the pointer leaves the whole viewer. `pointable` carries both
    // attributes from the scene just materialized, so it answers for decoration
    // and for issues, on every redraw, from the thing the pointer can touch.
    if (hovered !== null && !pointable.has(hovered)) clearHover();
    // THE SAME QUESTION FOR THE SELECTION, and it has to be asked here rather
    // than above: only a materialized scene knows whether this draw still drew
    // the connector the reader selected. An issue selection is already settled
    // by `byKey` and by `reconcile`; this covers the decoration case those two
    // cannot see. It runs BEFORE the notice below, so a subject that went away
    // is reported exactly once, through the same channel as every other change.
    if (state.selected !== null && !stillDrawn(state.selected)) {
      state = { ...state, selected: null };
    }
    // TOLD, NOT JUST DROPPED. The host was told a selection began, so leaving it
    // to infer the ending from a document it happens to have replaced is the
    // same divergence `clearHover` exists to prevent one line up. Fired AFTER
    // the DOM is in place, exactly as the hover clear is, so a host that redraws
    // from this callback finds the viewer already consistent.
    if (announceSelection && state.selected !== selectedBefore) {
      currentOptions.onSelect?.(state.selected);
    }
  };

  const emitSelect = (key: string | null): void => {
    // A KEY THIS DOCUMENT DOES NOT CARRY IS A SELECTION OF NOTHING, and it has
    // to be resolved HERE, before the state is written. `select()` is documented
    // to fire `onSelect` exactly as a click does — and a click can only ever
    // land on a key the canvas drew, so an unknown key has no click to be
    // equivalent to. A host holding a stale key from its own list is the
    // ordinary way one arrives.
    // WITHOUT THIS, THE TWO NOTIFICATIONS CONTRADICTED EACH OTHER. The state
    // took the unknown key, `draw()` reconciled it away against `byKey` and
    // reported `onSelect(null)`, and then this function reported `onSelect(key)`
    // — so the host was told twice, ending on the key that does not exist,
    // while the handle read `selected: null`. Resolving first means the state
    // and the one notification agree, and the reconciliation in `draw()` finds
    // nothing left to undo.
    // DECORATION IS A SUBJECT TOO. The document answers for issues; `pointable`
    // answers for the marks this scene drew that are not issues — today the
    // `together-with` connector, whose identity is an edge. Without the second
    // arm a connector click resolved to `null`, so the host was told a
    // selection ENDED by the one gesture that was starting one.
    const resolved = key !== null && stillDrawn(key) ? key : null;
    // FOCUS FOLLOWS AN ISSUE, NEVER A DECORATION IDENTITY. `navigable` lists
    // issues, and `navigate` resolves a key it cannot find to -1 and throws the
    // reader back to the top of the order — which is why `onKeyDown` already
    // narrows its own adoption to `KEY_ATTRIBUTE`. Selecting a connector must
    // leave the tab stop where the reader left it, so the focus arm asks the
    // document rather than reusing `resolved`.
    const focusable = resolved !== null && normalized.byKey.has(resolved) ? resolved : null;
    state = { ...state, selected: resolved, focused: focusable ?? state.focused };
    // SILENCED, because this function reports the result itself once the draw
    // has settled it. Letting the draw announce too would fire `onSelect` twice
    // for one selection whenever reconciliation renamed it — and a caller
    // cannot tell a doubled notice from a second selection.
    draw(false);
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
    // WHAT THE STATE ACTUALLY HOLDS, not what was asked for. `draw()` reconciles
    // the selection against the scene, which canonicalizes a together unit's
    // partner to the station that represents it — so reporting `resolved` here
    // would tell the host a key the handle does not hold, which is the very
    // disagreement between the two notifications this function was written to
    // end. `select()` stays equivalent to the click it documents itself as.
    currentOptions.onSelect?.(state.selected);
  };

  const onClick = (event: MountEvent): void => {
    // AN ACTIVATION ON A CONTROL THAT ACTIVATES ITSELF IS THAT CONTROL'S — the
    // same invariant `onKeyDown` already applies, and the click path needs its
    // own copy because returning from the keydown handler does NOT suppress the
    // click the browser synthesizes afterwards. Following a row's deep link was
    // therefore also selecting the row and firing `onSelect` at the host, for an
    // activation the anchor owned.
    // UNCONDITIONAL HERE, CONDITIONAL THERE, and the asymmetry is the point: a
    // click IS an activation, whereas a keydown may be a MOVEMENT key, which
    // stays the viewer's even while focus rests on a link.
    if (ownsItsOwnActivation(event.target, container)) return;
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
    clearHover();
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
      // BEFORE THE LISTENERS COME OFF, because after that no `pointerleave` can
      // fire and the host is left holding a key for an element about to be
      // removed — a tooltip pinned to nothing. Destruction bypasses `draw()`
      // entirely, so the redraw reconciliation above never sees this path.
      clearHover();
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
