/**
 * The DOM shell — the only module in this package that touches nodes.
 *
 * It is deliberately thin. Everything that could be wrong about WHAT is drawn
 * lives in the projections, everything that could be wrong about WHERE
 * navigation goes lives in `navigate`, and what is left here is a few
 * listeners, a resize watch, an index from key to element, and a teardown. A
 * shell that grew decisions would be a second implementation of the parts above
 * it, testable only through a DOM.
 *
 * IT REACHES NO GLOBAL. The document comes from the container the caller
 * passed, which is what keeps this module importable on a runtime that has no
 * DOM — the property the workspace smoke test measures against the published
 * entry. The resize observer comes from that document's own view, for the same
 * reason.
 */

import { edgeIdentity } from '@issuegraph/core';

import { type NormalizedDocument, type ViewerDocument, normalizeDocument } from './document.ts';
import { type SpecDocument, type SpecElement, type SpecNode, materialize } from './element.ts';
import {
  type NavigationState,
  initialNavigationState,
  navigate,
  reconcile,
} from './navigation.ts';
import { COMMAND_ATTRIBUTE, stationsOf } from './parts.ts';
import { type RenderOptions, sceneFor } from './render.ts';
import { GROUP_ATTRIBUTE, KEY_ATTRIBUTE, type Projection, type Scene } from './scene.ts';
import {
  type SelectionGesture,
  type StoredSelection,
  type ViewerSelection,
  isNarrowBox,
  nextSelection,
  sameSelection,
  selectedKeysOf,
  storedSelectionOf,
  viewerSelectionOf,
} from './selection.ts';
import { type Theme, resolveTheme } from './theme.ts';

/** The slice of an element `mount` needs beyond building. */
export interface MountElement extends SpecElement {
  readonly ownerDocument: SpecDocument;
  /** Upper-case, as the DOM reports it. Absent on an implementation that has none. */
  readonly tagName?: string;
  addEventListener(type: string, handler: (event: MountEvent) => void): void;
  removeEventListener(type: string, handler: (event: MountEvent) => void): void;
  removeChild(child: SpecNode): void;
  getAttribute(name: string): string | null;
  readonly parentElement: MountElement | null;
  focus?(): void;
  /**
   * The container's laid-out box. Optional because a container that cannot be
   * measured — a server render, a test double — simply never counts as narrow.
   */
  getBoundingClientRect?(): { width: number; height: number };
  /**
   * Whether `other` is this element or inside it. Optional: without it every
   * `focusout` counts as focus leaving the viewer, which can only skip putting
   * focus back after a resize, never pull it in from the host's page.
   */
  contains?(other: SpecNode | null): boolean;
}

/** The slice of an event `mount` reads. */
export interface MountEvent {
  readonly target?: MountElement | null;
  /** Present on a `focusout`: where focus went, or `null` when it left the page. */
  readonly relatedTarget?: MountElement | null;
  /** Present on a keyboard event. */
  readonly key?: string;
  /** Shift-click ranges; Shift with an arrow extends. */
  readonly shiftKey?: boolean;
  /** Cmd-click adds or drops one issue. */
  readonly metaKey?: boolean;
  /** Ctrl-click adds or drops one issue, as Cmd-click does. */
  readonly ctrlKey?: boolean;
  preventDefault?(): void;
}

export interface MountOptions extends RenderOptions {
  /**
   * Called when a key is selected — by click, `Enter`, or `select()` — and when
   * a narrow container reduces a set to one issue. Reports `null` for none, the
   * identity for a relationship, a single issue as the station it is drawn on,
   * and for a set of two or more issues the most recently added key exactly as
   * given.
   */
  readonly onSelect?: ((key: string | null) => void) | undefined;
  /**
   * Called once per change of the selection, with the whole selection as the
   * reader made it: never for a redraw, a projection switch, or a repeated
   * selection of what is already selected. Fires before `onSelect`. The keys
   * are a fresh frozen array each time.
   *
   * A container that measures under 640 wide holds one issue, so a set there
   * is reduced to its most recently added issue, and that reduction is a
   * change. A container already narrow at mount reports it during
   * `mountViewer`, before the handle is returned; one that narrows later
   * reports it from the resize that narrowed it.
   */
  readonly onSelectionChange?: ((selection: ViewerSelection) => void) | undefined;
  /** Called with the hovered key, and with `null` when nothing is hovered. */
  readonly onHover?: ((key: string | null) => void) | undefined;
  /**
   * Called with a command the viewer PUBLISHES and cannot complete: `refresh`,
   * `projection:linear`, `projection:graph`, `expand`, `collapse`.
   *
   * THE VIEWER IS A PURE RENDERER, so none of these is its to perform — it
   * cannot fetch a mirror, switch its own projection or widen its own column.
   * They already travel on `data-ig-command` for a host that listens to the
   * DOM; this is the same set on the callback channel, because §16e puts one of
   * them on a KEY (`g` toggles the view) and a key press has no element for a
   * host to have been listening to. One name set, two channels, so a host
   * cannot wire the button and silently lose the shortcut.
   */
  readonly onCommand?: ((command: string) => void) | undefined;
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
/**
 * The published command an activation landed on, walking target-upward.
 *
 * THE SAME WALK `keyAt` MAKES, on a different attribute, and it is a separate
 * function rather than a third attribute in that one because the two answer
 * different questions: `keyAt` asks which SUBJECT was pointed at, and a command
 * control has no subject. Folding them together would let a click on the
 * refresh button select whatever row happened to contain it.
 */
function commandAt(
  target: MountElement | null | undefined,
  container: MountElement,
): string | null {
  return keyAt(target, container, [COMMAND_ATTRIBUTE]);
}

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
  /**
   * The selection exactly as the reader or host made it, which the graph and
   * the list recede by.
   *
   * `state.selected` cannot serve, because each draw moves a selected unit
   * member to its unit's lead, and a member keeps only its own neighbours and
   * lines, not its partners'. Every other reader — the tree, the handle and
   * `onSelect` — still sees `state.selected`. Written wherever
   * `state.selected` is chosen or dropped, and re-checked on every draw by
   * `asGivenSelection`.
   */
  let selectedAsGiven: StoredSelection = state.selected;
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
   * The first ELEMENT drawn for a pointer identity — a `data-ig-key` or a
   * `data-ig-group`.
   *
   * SEPARATE FROM `keyed`, WHICH IS A FOCUS INDEX. `keyed` holds only
   * `data-ig-key` and prefers whichever element can take focus, because its
   * readers call `focus()`. §16f's promise is different and does not need
   * focus: a projection switch brings the surviving SELECTION into view, and a
   * selection may be an edge or a NOW row, neither of which carries a focus
   * key. Looking those up in `keyed` always missed, so the scroll the switch
   * advertises simply never happened for exactly the subjects that need it
   * most — the ones the two views place furthest apart.
   */
  let drawn = new Map<string, SpecElement>();
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
  /**
   * A selection with every member that no longer names something dropped.
   * A single key is kept or dropped whole, as before; a set loses only the
   * members that went, and collapses to one key or none as they go.
   */
  const keepDrawn = (selected: StoredSelection): StoredSelection =>
    typeof selected === 'string' || selected === null
      ? selected !== null && stillDrawn(selected) ? selected : null
      : storedSelectionOf({ kind: 'issues', keys: selected.filter((key) => stillDrawn(key) && !isDocumentEdge(key)) });
  /**
   * The remembered selection, while it still names what `state.selected`
   * names; otherwise `state.selected` itself.
   *
   * It must name something this document carries and stand on the same
   * station as `state.selected`. An update that removes a selected member, or
   * a later selection of another subject, therefore falls back to the issue
   * the graph and the list mark and the handle reports, so they never disagree.
   */
  const asGivenSelection = (): StoredSelection => {
    const selected = state.selected;
    const given = selectedAsGiven;
    if (selected === null || given === null) return selected;
    const stations = stationsOf(normalized);
    // Each station once, where its member was last added: the order `reconcile`
    // names a set's stations in, so a set and its stations compare by value.
    const stationsIn = (keys: readonly string[]): string => {
      const named = keys.map((key) => stations.get(key) ?? key);
      return JSON.stringify(named.filter((key, index) => named.lastIndexOf(key) === index));
    };
    const stillNamed = selectedKeysOf(given).filter((key) => normalized.byKey.has(key) || isDocumentEdge(key));
    return stillNamed.length > 0 && stationsIn(stillNamed) === stationsIn(selectedKeysOf(selected))
      ? storedSelectionOf(viewerSelectionOf(normalized, stillNamed.length === 1 ? (stillNamed[0] ?? null) : stillNamed))
      : selected;
  };
  /**
   * A SET IS ITS MEMBERS AS GIVEN, ON EVERY DRAW. The members this document
   * still carries are the selection, and their stations are derived from them
   * afresh; nothing else is. Falling back to the stations the handle held
   * selected a removed member's lead, an issue the reader never picked, and
   * keeping old stations after an update moved a lead silently dropped a
   * member that was still there. An edge identity is never a member. A single
   * selection keeps today's rule — a removed member falls back to its lead —
   * which `asGivenSelection` applies. `undefined` when the selection is not a
   * set.
   */
  const survivingSet = (): StoredSelection | undefined => {
    const given = selectedAsGiven;
    if (given === null || typeof given === 'string') return undefined;
    return storedSelectionOf({ kind: 'issues', keys: given.filter((key) => normalized.byKey.has(key)) });
  };
  /** The selection as the reader made it, which `onSelectionChange` reports. */
  const selectionAsGiven = (): ViewerSelection => viewerSelectionOf(normalized, selectedAsGiven);
  /**
   * What `onSelect` reports: for a set of two or more issues, the most recently
   * added key exactly as given; otherwise the one key the handle holds, a unit
   * member as its lead.
   */
  const reportedKey = (): string | null => {
    const given = selectionAsGiven();
    if (given.kind === 'issues' && given.keys.length > 1) return given.keys.at(-1) ?? null;
    return selectedKeysOf(state.selected).at(-1) ?? null;
  };
  // WHAT THE HOST WAS LAST TOLD, compared by value, never by array identity.
  // Seeded from the options, so mounting a selection is not a change.
  let announced: ViewerSelection = selectionAsGiven();
  let lastReported: string | null = reportedKey();
  /**
   * Whether the container measured narrow at its last measure: once before
   * the first draw, then on every resize. Measured AFTER `announced` is seeded,
   * so a set the first draw reduces is reported as a change, once, before
   * `mountViewer` returns. A container that cannot be measured is never narrow.
   */
  const measuresNarrow = (): boolean => {
    const box = container.getBoundingClientRect?.();
    return box !== undefined && isNarrowBox(box);
  };
  let narrow = measuresNarrow();
  /** A set as one issue, its most recently added; anything else unchanged. */
  const limitedToOne = (selected: StoredSelection): StoredSelection =>
    storedSelectionOf(nextSelection(viewerSelectionOf(normalized, selected), { kind: 'limit-to-one' }, []));
  // ONE QUEUE FOR EVERY NOTICE, so a host that changes the selection from
  // inside a callback is told about it after the notices already due, in
  // order, and none is skipped or reported out of turn.
  const notices: (() => void)[] = [];
  let draining = false;
  const deliver = (notice: () => void): void => {
    notices.push(notice);
    if (draining) return;
    draining = true;
    try {
      for (let next = notices.shift(); next !== undefined; next = notices.shift()) next();
    } finally {
      draining = false;
    }
  };
  /**
   * Tell the host about the selection, from ONE place. `onSelectionChange`
   * fires when the selection as given changed by value; `onSelect` fires with
   * it, and also when the key it reports changed (a projection switch that
   * renames a unit member to its lead), and — `force` — on every click,
   * `Enter` or `select()`, even of what is already selected, as it always has.
   */
  const announce = (force: boolean): void => {
    const selection = selectionAsGiven();
    const key = reportedKey();
    const changed = !sameSelection(announced, selection);
    const reported = changed || force || key !== lastReported;
    announced = selection;
    lastReported = key;
    // A FRESH FROZEN COPY per notice, so a host that mutates what it was
    // handed changes nothing here.
    const handed: ViewerSelection =
      selection.kind === 'issues'
        ? Object.freeze({ kind: 'issues', keys: Object.freeze([...selection.keys]) })
        : Object.freeze({ ...selection });
    deliver(() => {
      if (changed) currentOptions.onSelectionChange?.(handed);
      if (reported) currentOptions.onSelect?.(key);
    });
  };
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
    //
    // A NARROW CONTAINER HOLDS ONE ISSUE, so a set is reduced here, where every
    // writer — the mount seed, a gesture, `update` and a resize — draws next.
    // Neither the handle nor a notice ever sees a set while narrow, and the
    // stored value itself changes, so growing back restores nothing. It reduces
    // the set `survivingSet` already pruned, so the issue kept is the last one
    // this document carries.
    const surviving = survivingSet();
    if (surviving !== undefined) {
      const kept = narrow ? limitedToOne(surviving) : surviving;
      selectedAsGiven = kept;
      state = { ...state, selected: kept };
    } else if (currentScene !== null) {
      state = { ...state, selected: keepDrawn(state.selected) };
    }
    selectedAsGiven = asGivenSelection();
    if (root !== null) container.removeChild(root);
    const scene = sceneFor(normalized, projection, {
      ...currentOptions,
      // THE GRAPH AND THE LIST ARE HANDED THE SELECTION AS GIVEN, because they
      // are the projections that recede. Each still marks the unit's lead,
      // since it moves a member to its lead before it marks anything. The tree
      // does not recede and keeps the lead the handle reports.
      selected: projection === 'tree' ? state.selected : selectedAsGiven,
      // DERIVED FROM THE SELECTION, never taken from the host's options, so a
      // relationship recedes only while it is the selection and a clear
      // always restores everything.
      selectedEdge:
        typeof state.selected === 'string' && isDocumentEdge(state.selected) ? state.selected : null,
      // NEVER TAKEN FROM THE HOST'S OPTIONS either, for the same reason: the
      // mount draws its whole document, so the list works out what recedes
      // from the live selection above.
      receding: undefined,
      // NEVER DETACHED HERE. The mount draws every row it is handed, so it is
      // its own extent and the inline footer is already after the last of
      // them. It also materializes `scene.root` and nothing else — a detached
      // group would be in `focusOrder` and on no element, which is a keyboard
      // walking into keys the page does not have. See `SceneOptions.detachFooter`.
      detachFooter: false,
      theme: currentOptions.theme ?? theme,
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
    drawn = new Map<string, SpecElement>();
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
          if (!drawn.has(key)) drawn.set(key, node);
        }
        const group = spec.attrs?.[GROUP_ATTRIBUTE];
        if (typeof group === 'string' && group !== '') {
          pointable.add(group);
          if (!drawn.has(group)) drawn.set(group, node);
        }
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
    state = { ...state, selected: keepDrawn(state.selected) };
    selectedAsGiven = state.selected === null ? null : asGivenSelection();
    // TOLD, NOT JUST DROPPED. The host was told a selection began, so leaving it
    // to infer the ending from a document it happens to have replaced is the
    // same divergence `clearHover` exists to prevent one line up. Fired AFTER
    // the DOM is in place, exactly as the hover clear is, so a host that redraws
    // from this callback finds the viewer already consistent.
    if (announceSelection) announce(false);
  };

  /**
   * The rank order a Shift range walks: every member of every ranked slot, in
   * the order the document ranks them, so a range across a unit adds each of
   * its members as given.
   */
  const rankOrder = (): readonly string[] =>
    normalized.order.slots.filter((slot) => slot.rank !== null).flatMap((slot) => slot.members);
  /**
   * The selection after `gesture`, with everything this document cannot name
   * dropped BEFORE it is written, so no notice ever names it: an issue key the
   * scene cannot point at, or an edge identity inside a set of issues.
   */
  const selectionAfter = (gesture: SelectionGesture): StoredSelection => {
    const next = nextSelection(selectionAsGiven(), gesture, rankOrder());
    if (next.kind === 'edge') return stillDrawn(next.edgeId) ? next.edgeId : null;
    if (next.kind === 'none') return null;
    return storedSelectionOf({
      kind: 'issues',
      keys: next.keys.filter((key) => stillDrawn(key) && !isDocumentEdge(key)),
    });
  };
  /** What a pointer or key press on `key` asks for, given the modifiers held. */
  const gestureFor = (key: string, event: MountEvent): SelectionGesture => {
    // A RELATIONSHIP UNDER ANY MODIFIER IS A PLAIN RELATIONSHIP CLICK: a set
    // holds issues only, so it replaces any set.
    if (isDocumentEdge(key)) return { kind: 'edge', edgeId: key };
    if (event.metaKey === true || event.ctrlKey === true) return { kind: 'toggle', key };
    if (event.shiftKey === true) return { kind: 'range', key };
    return { kind: 'replace', key };
  };
  const emitSelect = (key: string | null): void => {
    applyGesture(
      key === null ? { kind: 'clear' } : isDocumentEdge(key) ? { kind: 'edge', edgeId: key } : { kind: 'replace', key },
      key,
    );
  };

  const applyGesture = (gesture: SelectionGesture, key: string | null): void => {
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
    const selected = selectionAfter(gesture);
    // FOCUS FOLLOWS AN ISSUE, NEVER A DECORATION IDENTITY. `navigable` lists
    // issues, and `navigate` resolves a key it cannot find to -1 and throws the
    // reader back to the top of the order — which is why `onKeyDown` already
    // narrows its own adoption to `KEY_ATTRIBUTE`. Selecting a connector must
    // leave the tab stop where the reader left it, so the focus arm asks the
    // document rather than reusing `resolved`.
    // AND A NAVIGABLE ONE. A NOW row names an issue the document carries, so
    // `byKey` admits it — but a running issue that holds no slot has no row in
    // `navigable`, and adopting it as the tab stop sent `reconcile` to the
    // FIRST navigable key: a click on the NOW row selected the running issue
    // and moved keyboard focus to an unrelated row at the top of the order.
    // The tab stop stays where the reader left it, as it does for a connector.
    // ASKED OF THE STATION THAT REPRESENTS THE KEY, because a together partner
    // is a legitimate subject the projection draws under its lead's row: the
    // partner is in no order, the lead is, and `reconcile` will canonicalize
    // the focus to the lead — so it is the lead's membership that decides.
    const station = resolved === null ? null : (currentScene?.stationOf.get(resolved) ?? resolved);
    const focusable =
      resolved !== null &&
      station !== null &&
      normalized.byKey.has(resolved) &&
      (currentScene?.navigable.includes(station) ?? false)
        ? resolved
        : null;
    state = { ...state, selected, focused: focusable ?? state.focused };
    selectedAsGiven = selected;
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
    // ONLY WHEN THE SELECTION NAMED A FOCUSABLE SUBJECT. `state.focused` is a
    // logical tab stop and is never null after the first draw — `reconcile`
    // seeds it with the first navigable row before anything has DOM focus. So
    // moving DOM focus to it on a decoration or NOW-row click, where the
    // selection itself could take no focus, sent focus to an unrelated first
    // row on the reader's very first click. A pointer on a mark that cannot
    // take focus moves the selection and nothing else.
    if (focusable !== null && state.focused !== null) keyed.get(state.focused)?.focus?.();
    // WHAT THE STATE ACTUALLY HOLDS, not what was asked for. `draw()` reconciles
    // the selection against the scene, which canonicalizes a together unit's
    // partner to the station that represents it — so reporting `resolved` here
    // would tell the host a key the handle does not hold, which is the very
    // disagreement between the two notifications this function was written to
    // end. `select()` stays equivalent to the click it documents itself as.
    // FORCED, because `onSelect` has always reported every click, `Enter` and
    // `select()`, even of what is already selected; `onSelectionChange` still
    // fires only on a change.
    announce(true);
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
    // A PUBLISHED COMMAND IS REPORTED BEFORE THE ACTIVATION RULE DROPS IT. A
    // command control is a real button, so it owns its own activation and the
    // rule below correctly leaves it alone — which also meant a host using the
    // callback channel never heard the click at all, while a host reading the
    // DOM did. The two channels carry the same set or neither is trustworthy.
    const command = commandAt(event.target, container);
    if (command !== null) {
      currentOptions.onCommand?.(command);
      return;
    }
    if (ownsItsOwnActivation(event.target, container)) return;
    // A CLICK ON NOTHING KEYED CLEARS A SELECTION ON THE GRAPH ONLY, exactly as
    // `select(null)` does, so a reader can restore a receded graph by clicking
    // blank space. The list and the tree ignore such a click as they always
    // did. With nothing selected there is nothing to clear, so it neither
    // redraws nor tells the host.
    // A MODIFIER CLICK ON BLANK SPACE KEEPS THE SET: the reader was building
    // one and missed, which is not a request to throw it away.
    const key = keyAt(event.target, container);
    const modified = event.shiftKey === true || event.metaKey === true || event.ctrlKey === true;
    const clearsSelection = projection === 'graph' && state.selected !== null && !modified;
    if (key === null) {
      if (clearsSelection) emitSelect(null);
      return;
    }
    applyGesture(gestureFor(key, event), key);
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
    const result = navigate(currentScene, state, event.key, { shift: event.shiftKey === true });
    if (result.command.kind === 'none') return;
    event.preventDefault?.();
    if (result.command.kind === 'select') {
      emitSelect(result.command.key);
      return;
    }
    // SHIFT WITH AN ARROW IS A SHIFT-CLICK ON THE NEWLY FOCUSED ISSUE.
    if (result.command.kind === 'extend') {
      state = result.state;
      applyGesture({ kind: 'range', key: result.command.key }, result.command.key);
      return;
    }
    if (result.command.kind === 'clear') {
      applyGesture({ kind: 'clear' }, null);
      // THE REDRAW DESTROYED THE ROW HOLDING FOCUS, and a clear names no subject
      // for `applyGesture` to refocus, so the tab stop the reader kept is
      // focused again — this is the viewer's own key press, not a host update.
      if (state.focused !== null) keyed.get(state.focused)?.focus?.();
      return;
    }
    // A COMMAND IS THE HOST'S TO COMPLETE, exactly like the header's own
    // buttons: this package cannot switch its own projection or resize its own
    // column. It travels on the same channel a click on those buttons does, so
    // a host wires one listener and gets both.
    if (result.command.kind === 'command') {
      currentOptions.onCommand?.(result.command.command);
      return;
    }
    state = result.state;
    draw();
    keyed.get(result.command.key)?.focus?.();
  };

  // WHETHER FOCUS IS INSIDE THE VIEWER, kept from the container's own focus
  // events so the module never asks its host for `activeElement`. A resize
  // redraw reads it to put focus back on the row it destroyed, and only then,
  // so a resize while the reader is elsewhere on the page moves nothing.
  let focusInside = false;
  const onFocusIn = (): void => {
    focusInside = true;
  };
  const onFocusOut = (event: MountEvent): void => {
    const to = event.relatedTarget ?? null;
    focusInside = to !== null && container.contains?.(to) === true;
  };

  /**
   * Re-measure, and reduce a set the container is now too narrow for.
   *
   * It redraws only when that reduction is due, so a resize that changes
   * nothing tells the host nothing, and the redraw's own notice reports the
   * reduction once. `onSelect` is not forced, as a click forces it, because a
   * resize is not a selection. Guarded by `destroyed`, because a browser can
   * deliver a callback it queued before `disconnect()`.
   */
  const onResize = (): void => {
    if (destroyed) return;
    narrow = measuresNarrow();
    if (!narrow || selectedKeysOf(selectedAsGiven).length < 2) return;
    const refocus = focusInside;
    draw();
    if (refocus && state.focused !== null) keyed.get(state.focused)?.focus?.();
  };

  container.addEventListener('click', onClick);
  container.addEventListener('pointerover', onPointerOver);
  container.addEventListener('pointerleave', onPointerLeave);
  container.addEventListener('keydown', onKeyDown);
  container.addEventListener('focusin', onFocusIn);
  container.addEventListener('focusout', onFocusOut);

  draw();

  // ATTACHED ONLY WHEN THE DOCUMENT OFFERS ONE, and separate from measuring: a
  // container without an observer was still measured and reduced above, and
  // loses only the watch on later resizes.
  const ResizeWatch = doc.defaultView?.ResizeObserver;
  const resizeWatch = ResizeWatch === undefined ? null : new ResizeWatch(onResize);
  resizeWatch?.observe(container);

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
      if (next === projection) return;
      projection = next;
      draw();
      // §16f: A SWITCH CHANGES REPRESENTATION, NEVER SUBJECT. The selection
      // already survives — `reconcile` carries it whole — but surviving off
      // screen is indistinguishable from being lost, and the two views place
      // the same subject at completely different coordinates. So the other view
      // brings it into view. Focus is NOT moved: a switch is not an act of
      // navigation, and stealing focus from wherever the reader put it would
      // make the toggle a worse citizen than the click that made the selection.
      // FROM THE POINTER INDEX, not the focus one. A selection can be an edge
      // or a NOW row, and neither carries a focus key — so `keyed` missed them
      // and the scroll this promises never happened for the subjects the two
      // views place furthest apart.
      const subject = selectedKeysOf(state.selected).at(-1);
      if (subject !== undefined) {
        drawn.get(subject)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
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
      container.removeEventListener('focusin', onFocusIn);
      container.removeEventListener('focusout', onFocusOut);
      resizeWatch?.disconnect();
      if (root !== null) container.removeChild(root);
      root = null;
      keyed = new Map<string, SpecElement>();
      drawn = new Map<string, SpecElement>();
    },
  };
}
