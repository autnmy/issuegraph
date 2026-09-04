/**
 * The workspace's DOM shell — the only module in this package that touches
 * nodes.
 *
 * `renderWorkspace` renders the three-zone workspace as markup and publishes
 * every control as `data-ig-command`; `@issuegraph/viewer` publishes its two
 * identities, `data-ig-key` and `data-ig-group`. A mount reads those, reduces,
 * and renders again — and that loop is this file. What it DECIDES lives in
 * `host.ts`, as a reducer with no DOM, so this file is left with listeners, an
 * `innerHTML` assignment, and the chrome the panels leave to a mount: the add
 * button, the kind chooser, the target search, the delete button.
 *
 * ## Lifted from the demo, in the viewer's shape
 *
 * This was the demo's `workspace.ts`, written once for that page. The viewer
 * made the opposite call for the same problem — it exports `mountViewer` with
 * `update` and `destroy` — and that is the entry point a typed host actually
 * consumes. It took nine review rounds to get this shell right, and every
 * finding was in the shell, none in the reducer; a second host would have
 * re-run them. So the shell ships, in the viewer's shape: one function, one
 * handle, and a container it touches and nothing else.
 *
 * ## `innerHTML`, and why it is not the thing `render.ts` refused
 *
 * Nothing in this file interpolates host text into markup. What IS assigned as
 * markup is the package's own rendered output, which `renderMarkup` escaped —
 * the exact bytes a server-rendered host would send. The chrome beside it is
 * built with `createElement` and `textContent`, so the two disciplines meet at
 * the seam rather than mixing.
 *
 * ## One listener per event, at the root
 *
 * The workspace is re-rendered on every change, so a listener attached to a
 * rendered node dies with it. Delegation at the root is what makes the loop
 * cheap to reason about: one `click`, one `input`, one `keydown`, one scroll
 * (captured, because scroll does not bubble), and the three pointer events the
 * canvas drag needs.
 *
 * ## It reaches no global
 *
 * The document comes from the element the caller passed, which is what keeps
 * this module importable on a runtime that has no DOM — the property
 * `purity.test.ts` measures. An element is recognised by what it can do rather
 * than by `instanceof` against a constructor this module would have to reach
 * for, and a pointer release outside the element is heard on the element's own
 * document rather than on a window.
 */

import { edgeIdentity } from '@issuegraph/core';
import type { EdgeKind, GraphDocument, Store, StoreSnapshot } from '@issuegraph/store';
import {
  type Scene,
  type Theme,
  type ViewerDocument,
  navigate,
  renderViewer,
  resolveTheme,
} from '@issuegraph/viewer';

import type { AuditInput } from '../audit/findings.ts';
import { type CreateInteraction, type KeyboardContext, keyIntent } from '../create/keys.ts';
import { pickerPlacement } from '../create/placement.ts';
import { renderPicker } from '../picker/render.ts';
import { pickerStylesheet } from '../picker/styles.ts';
import type { PickerWords } from '../picker/words.ts';
import { scaleLadder } from '../scale/ladder.ts';
import { mountStylesheet } from './chrome.ts';
import {
  type HostCommand,
  type HostEffect,
  type HostState,
  INITIAL_HOST_STATE,
  KINDS,
  RAIL_SLACK,
  railWindowTarget,
  reconcileHost,
  reduceHost,
  targetMatches,
} from './host.ts';
import type { RailWindow } from './rail.ts';
import { type WorkspaceWords, renderWorkspace } from './render.ts';
import { selectedEdgeId, selectedKey } from './selection.ts';

/** What the canvas zone draws: the editor's scale ladder, or the viewer's tree projection. */
export const CANVAS_MODES = Object.freeze(['neighbourhood', 'tree'] as const);
export type CanvasMode = (typeof CANVAS_MODES)[number];

/**
 * The words the mount's chrome needs on top of the workspace's own.
 *
 * Required, for the reason `WorkspaceWords` gives: this package does not
 * invent an English sentence, and a default would be one. `picker` is the
 * picker's vocabulary, which the mount draws for a selected edge; `keys` is
 * the one optional entry, because a host may prefer to document the keyboard
 * elsewhere.
 */
export interface MountWords extends WorkspaceWords {
  readonly picker: PickerWords;
  /** The control that begins a relationship from the selected issue. */
  readonly addRelationship: string;
  /** The control that proposes deleting the selected edge. */
  readonly deleteRelationship: string;
  /** The control that returns a draft to idle. */
  readonly cancel: string;
  /** The chooser's sentence tail while no target is known yet. */
  readonly chooseKind: string;
  /** The target search's accessible name. */
  readonly targetLabel: string;
  /** The target search's placeholder. */
  readonly targetPlaceholder: string;
  /** A one-line key legend under the inspector, when the host wants one drawn. */
  readonly keys?: string | undefined;
}

/**
 * What the host projects a store snapshot onto.
 *
 * The viewer derives nothing — the order, the holds and the provenance are all
 * inputs — and the audit reads a graph the host built, so both come from the
 * host's projection rather than from anything this mount could compute. An
 * absent `audit` means "not run", which the workspace renders as no header.
 */
export interface WorkspaceProjection {
  readonly viewer: ViewerDocument;
  readonly audit?: AuditInput | undefined;
}

export interface MountWorkspaceOptions {
  /**
   * The store the host built, with its own `DataSource` and `OrderDeriver`.
   * Fixed for the life of the mount; a host that swaps stores destroys and
   * mounts again. Hydration is the host's: the mount subscribes and redraws on
   * every notification, so a `hydrate()` before or after mounting both land.
   */
  readonly store: Store;
  /** The host's projection of a snapshot — the landed document is `{ issues, edges: landed }`. */
  readonly project: (snapshot: StoreSnapshot) => WorkspaceProjection;
  readonly words: MountWords;
  readonly theme?: Theme | undefined;
  /** The selector the theme's custom properties are written onto. */
  readonly themeSelector?: string | undefined;
  readonly canvas?: CanvasMode | undefined;
  /** How many rail rows are drawn per window. Wider than the package default so a scroll rarely lands past the drawn rows. */
  readonly railCount?: number | undefined;
}

/** What `update` may change. The store is not among them — see {@link MountWorkspaceOptions.store}. */
export type WorkspaceUpdate = Partial<Omit<MountWorkspaceOptions, 'store'>>;

export interface WorkspaceHandle {
  /** Take new options, redraw in place, keep the selection and the focus. */
  update(options?: WorkspaceUpdate): void;
  /**
   * Hand the mount a command from the host's own chrome.
   *
   * A host draws controls the mount does not — the demo's writes log, with its
   * retry and discard buttons — outside the mounted element, and this is how
   * those reach the one reducer rather than a second copy of it.
   */
  dispatch(command: HostCommand): void;
  readonly state: HostState;
  /** Remove every listener this handle added and the nodes it built. */
  destroy(): void;
}

/** The package default: wide enough that a scroll rarely lands past the drawn rows. */
export const MOUNT_RAIL_COUNT = 80;

/** The kind chooser's size for placement — the stylesheet decides the real one; this only picks a corner. */
const CHOOSER_SIZE = { width: 280, height: 220 };

/** The drag threshold, in CSS pixels: a press that moves less is a click. */
const DRAG_THRESHOLD = 6;

const KEY_ATTRIBUTE = 'data-ig-key';
const GROUP_ATTRIBUTE = 'data-ig-group';
const COMMAND_ATTRIBUTE = 'data-ig-command';

/**
 * An element, recognised by what it can do.
 *
 * Not `instanceof Element`: that reaches for a constructor this module has no
 * global for, and on a runtime with two documents — a test's jsdom beside
 * Node's own globals — it answers wrong even where one exists.
 */
function isElement(target: EventTarget | null | undefined): target is Element {
  return target !== null && target !== undefined && 'closest' in target && 'getAttribute' in target;
}

function isFocusable(node: Element | null | undefined): node is HTMLElement {
  return node !== null && node !== undefined && 'focus' in node;
}

function isInput(node: Element | null | undefined): node is HTMLInputElement {
  return node !== null && node !== undefined && node.tagName === 'INPUT';
}

function isComposing(event: Event): boolean {
  return 'isComposing' in event && event.isComposing === true;
}

/** Every element under `scope` carrying exactly this key, in document order. */
function withKey(scope: Element, key: string): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(`[${KEY_ATTRIBUTE}]`)].filter(
    (node) => node.getAttribute(KEY_ATTRIBUTE) === key,
  );
}

/**
 * Mount the workspace into an element.
 *
 * Returns a handle rather than nothing, for the viewer's reason: a host that
 * cannot tear this down leaks a listener on every re-render.
 */
export function mountWorkspace(element: HTMLElement, options: MountWorkspaceOptions): WorkspaceHandle {
  const doc = element.ownerDocument;
  const { store } = options;
  let current: MountWorkspaceOptions = options;

  const styles = doc.createElement('style');
  const surface = doc.createElement('div');
  surface.className = 'ig-mount';
  element.append(styles, surface);

  let state: HostState = INITIAL_HOST_STATE;
  let pending = false;
  let destroyed = false;
  // What the last redraw drew, kept so a key press can ask the viewer's own
  // navigation reducer about the scene the reader is looking at.
  let drawn: { readonly viewer: ViewerDocument; readonly rail: RailWindow } | null = null;
  // A rail row to focus once the window has been re-cut around it.
  let pendingFocus: { readonly kind: 'after' | 'before' | 'first' | 'last'; readonly key: string | null } | null = null;
  let pressed:
    | { readonly pointerId: number; readonly key: string; readonly x: number; readonly y: number; dragging: boolean }
    | null = null;
  // Whether the last render drew the target search, so focus moves into it on
  // the render that OPENS it and not on every render while it stays open.
  let searchWasOpen = false;

  const railCount = (): number => current.railCount ?? MOUNT_RAIL_COUNT;
  const theme = (): Theme => resolveTheme(current.theme);

  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attributes: Readonly<Record<string, string>> = {},
    children: readonly (Node | string)[] = [],
  ): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  };

  const button = (label: string, command: string, attributes: Readonly<Record<string, string>> = {}): HTMLButtonElement =>
    el('button', { type: 'button', class: 'ig-chrome-button', [COMMAND_ATTRIBUTE]: command, ...attributes }, [label]);

  const landed = (): GraphDocument => {
    const snapshot = store.getSnapshot();
    return { issues: snapshot.issues, edges: snapshot.landed };
  };

  // COALESCED ON A MICROTASK, NOT A FRAME. The store notifies once per state
  // change and a hydrate or a settling write can produce several in one task;
  // one render per task is what a reader sees anyway. A frame would coalesce
  // the same way but never fires while the tab is hidden, which stalls every
  // store notification until the reader returns — and makes the surface
  // impossible to drive headlessly, which is how it is verified.
  const schedule = (): void => {
    if (pending || destroyed) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      render();
    });
  };

  const perform = (effect: HostEffect): void => {
    switch (effect.kind) {
      case 'propose':
        void store.propose(effect.proposal);
        return;
      case 'retry': {
        // A conflict retries against the LATEST document. The store owns that
        // resolution: it reserves the edit, re-reads, then re-dispatches as one
        // operation, so there is nothing for the mount to sequence.
        const record = store.getSnapshot().writes.find((each) => each.mutationId === effect.mutationId);
        if (record?.state === 'conflict') {
          void store.retryOnLatest(effect.mutationId);
        } else {
          void store.retry(effect.mutationId);
        }
        return;
      }
      case 'discard':
        store.discardMine(effect.mutationId);
        return;
      case 'dismiss-change':
        store.dismissChange();
        return;
    }
  };

  const dispatch = (command: HostCommand): void => {
    if (destroyed) return;
    const result = reduceHost(state, command, landed());
    state = result.state;
    for (const effect of result.effects) perform(effect);
    schedule();
  };

  const zone = (name: string): HTMLElement | null => surface.querySelector<HTMLElement>(`.ig-zone[data-zone="${name}"]`);

  const pitch = (): number => theme().metrics['--ig-row-height'] + theme().metrics['--ig-space-tight'];

  const kindChooser = (source: string, target: string | null): HTMLElement => {
    const { words } = current;
    const chooser = el('div', { class: 'ig-chrome-chooser', role: 'group', 'aria-label': words.picker.heading });
    chooser.append(
      el('p', { class: 'ig-chrome-sentence' }, [`#${source} … ${target === null ? words.chooseKind : `#${target}`}`]),
    );
    const list = el('div', { class: 'ig-chrome-kinds' });
    KINDS.forEach((kind, index) => {
      list.append(
        button(`${String(index + 1)} ${words.picker.kinds[kind]}`, 'kind', {
          'data-ig-value': kind,
          'data-edge': kind,
        }),
      );
    });
    chooser.append(list, button(words.cancel, 'cancel', { class: 'ig-chrome-button ig-chrome-quiet' }));
    return chooser;
  };

  const targetSearch = (document: GraphDocument, source: string, kind: EdgeKind): HTMLElement => {
    const { words } = current;
    const search = el('div', { class: 'ig-chrome-search' });
    search.append(el('p', { class: 'ig-chrome-sentence' }, [`#${source} ${words.picker.kinds[kind]} …`]));
    const input = el('input', {
      type: 'search',
      class: 'ig-chrome-input',
      placeholder: words.targetPlaceholder,
      'aria-label': words.targetLabel,
      [COMMAND_ATTRIBUTE]: 'target-query',
    });
    input.value = state.targetQuery;
    search.append(input);
    const matches = targetMatches(document.issues, state.targetQuery, source);
    if (matches.length > 0) {
      const list = el('ul', { class: 'ig-chrome-matches' });
      for (const match of matches) {
        list.append(
          el('li', {}, [
            button(`#${match.ref} ${match.title}`, 'target', {
              'data-ig-target': match.ref,
              class: 'ig-chrome-button ig-chrome-match',
            }),
          ]),
        );
      }
      search.append(list);
    }
    search.append(button(words.cancel, 'cancel', { class: 'ig-chrome-button ig-chrome-quiet' }));
    return search;
  };

  /** The chrome the inspector zone gets beside the package's own panel. */
  const inspectorChrome = (document: GraphDocument): HTMLElement => {
    const { words } = current;
    const panel = el('div', { class: 'ig-chrome', 'data-chrome': 'inspector' });
    const edgeId = selectedEdgeId(state.selection);
    const issue = selectedKey(state.selection);
    const { draft } = state;

    if (edgeId !== null) {
      const picker = el('div', { class: 'ig-chrome-picker' });
      // Package-rendered markup, escaped by the package.
      picker.innerHTML = renderPicker(document, edgeId, { words: words.picker, theme: theme() }).markup;
      panel.append(picker, button(words.deleteRelationship, 'delete', { class: 'ig-chrome-button ig-chrome-danger' }));
    } else if (draft.source === null) {
      if (issue !== null) panel.append(button(words.addRelationship, 'add'));
    } else if (draft.kind === null) {
      // Placed at the drop point when a canvas drag got here; inline otherwise.
      if (state.drop === null) panel.append(kindChooser(draft.source, draft.target));
    } else if (draft.target === null) {
      panel.append(targetSearch(document, draft.source, draft.kind));
    }

    if (words.keys !== undefined) panel.append(el('p', { class: 'ig-chrome-keys' }, [words.keys]));
    return panel;
  };

  const floatingChooser = (): HTMLElement | null => {
    const { draft, drop } = state;
    if (drop === null || draft.source === null || draft.kind !== null) return null;
    const bounds = surface.getBoundingClientRect();
    const placed = pickerPlacement(drop, CHOOSER_SIZE, {
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
    });
    const chooser = kindChooser(draft.source, draft.target);
    chooser.classList.add('ig-chrome-floating');
    chooser.style.left = `${String(placed.x)}px`;
    chooser.style.top = `${String(placed.y)}px`;
    return chooser;
  };

  /** Focus the element carrying `key`, inside one zone when named, without scrolling the page. */
  const focusIn = (zoneName: string | null, key: string): void => {
    const scope = zoneName === null ? surface : (zone(zoneName) ?? surface);
    const candidates = withKey(scope, key);
    // THE FOCUSABLE ONE. The graph draws an issue twice — its SVG node and the
    // rail row positioned over it — and only the element carrying `tabindex`
    // takes focus; the first match by document order is the node, on which
    // `focus()` is a no-op and the reader's focus falls off the page.
    const target = candidates.find((node) => node.hasAttribute('tabindex')) ?? candidates[0];
    if (target === undefined) return;
    // THE ROVING TAB STOP MOVES WITH FOCUS, as the viewer's own mount moves it.
    // The zone renders one element at tabindex 0 and the rest at -1; moving
    // focus without moving the stop leaves Tab returning to the old row when
    // the reader leaves the zone and comes back.
    if (target.hasAttribute('tabindex')) {
      const owner = target.closest<HTMLElement>('.ig-zone') ?? scope;
      for (const stop of owner.querySelectorAll<HTMLElement>(`[${KEY_ATTRIBUTE}][tabindex="0"]`)) {
        if (stop !== target) stop.setAttribute('tabindex', '-1');
      }
      target.setAttribute('tabindex', '0');
    }
    target.focus({ preventScroll: true });
  };

  /**
   * The scene a zone is showing, for the viewer's navigation reducer.
   *
   * `renderWorkspace` composes its scenes and publishes none of them, so the
   * scene is rendered again here from the SAME documents the workspace drew —
   * the rail's window and the ladder's canvas — through the same pure
   * `renderViewer`. That is a second render, not a second implementation: the
   * traversal order, the lateral neighbours and the Enter semantics are the
   * viewer's own, read off its scene rather than guessed from the markup.
   */
  const sceneFor = (zoneName: string): Scene | null => {
    if (drawn === null) return null;
    if (zoneName === 'rail') return renderViewer(drawn.rail.document, { projection: 'linear', theme: theme() }).scene;
    if (zoneName !== 'canvas') return null;
    if (current.canvas === 'tree') return renderViewer(drawn.viewer, { projection: 'tree', theme: theme() }).scene;
    const ladder = scaleLadder(drawn.viewer, state.scale);
    return ladder.tier === 'direct' ? renderViewer(ladder.canvas, { projection: 'graph', theme: theme() }).scene : null;
  };

  /** The row or node that owns keyboard focus, if focus is on one at all. */
  const focusedKey = (): string | null => {
    const active = doc.activeElement;
    const keyed = isElement(active) ? active.closest<HTMLElement>(`[${KEY_ATTRIBUTE}]`) : null;
    return keyed !== null && surface.contains(keyed) ? keyed.getAttribute(KEY_ATTRIBUTE) : null;
  };

  const render = (): void => {
    if (destroyed) return;
    const snapshot = store.getSnapshot();
    const document_ = landed();
    // A landed write can retire what the state names; agree with the document first.
    state = reconcileHost(state, document_);
    const projected = current.project(snapshot);
    // WHAT TO DRAW IS THE STORE'S PROJECTION, by the store's own contract:
    // `projected` is "landed plus every unsettled edit, each carrying its
    // states". A host projects the ORDER from the landed document — the order
    // must not move for an edit that did not land — so its viewer document
    // carries landed edges, and an edit in flight would be invisible on the
    // very surface that just proposed it. The unsettled edges are added here,
    // and only those: an edge the host's projection deliberately left out stays
    // out, because a landed edge carries no state and is never added.
    // AND A LANDED EDGE THE STORE HIDES IS DROPPED, for the same reason. A
    // pending retype or flip gives the edge a new identity and the store's
    // projection hides the old one until the write settles; the host's
    // document still carries it, so without this the old line and the new
    // dashed one were drawn together for the life of the write.
    const shown = new Set(snapshot.projected.map((edge) => edge.id));
    const hidden = new Set(snapshot.landed.map((edge) => edge.id).filter((id) => !shown.has(id)));
    const kept = projected.viewer.edges.filter((edge) => !hidden.has(edgeIdentity(edge.field, edge.from, edge.to)));
    const drawn_ = new Set(kept.map((edge) => edgeIdentity(edge.field, edge.from, edge.to)));
    const unsettled = snapshot.projected
      .filter((edge) => edge.states.length > 0 && !drawn_.has(edge.id))
      .map((edge) => ({ field: edge.kind, from: edge.from, to: edge.to }));
    const viewer: ViewerDocument =
      unsettled.length === 0 && kept.length === projected.viewer.edges.length
        ? projected.viewer
        : { ...projected.viewer, edges: [...kept, ...unsettled] };
    const { audit } = projected;
    const resolved = theme();

    const result = renderWorkspace(viewer, {
      words: current.words,
      selection: state.selection,
      scale: state.scale,
      rail: { start: state.railStart, count: railCount() },
      audit,
      auditFiltered: state.auditFiltered,
      theme: resolved,
      themeSelector: current.themeSelector,
      // THE WRITE STATES ONLY. The workspace holds the one selection, and the
      // ladder draws its halo from that; a `selected` the host put on the store
      // through `store.select()` would draw a second halo the inspector does
      // not reflect, so it is stripped before the projection reaches the canvas.
      projected: snapshot.projected.map((edge) =>
        edge.states.includes('selected') ? { ...edge, states: edge.states.filter((state) => state !== 'selected') } : edge,
      ),
    });
    const sheet = [result.styles, pickerStylesheet, mountStylesheet].join('\n');
    if (styles.textContent !== sheet) styles.textContent = sheet;

    // What the reader was doing survives the redraw: the rail's scroll offset,
    // and the caret in whichever search box they were typing into.
    const railBefore = zone('rail');
    const scrollTop = railBefore?.scrollTop ?? 0;
    const active = doc.activeElement;
    const activeInput = isElement(active) && isInput(active) && surface.contains(active) ? active : null;
    const activeCommand = activeInput?.getAttribute(COMMAND_ATTRIBUTE) ?? null;
    // THE CARET AS IT WAS, not the end of the value: a reader editing in the
    // middle of a query keeps typing there, and every keystroke redraws.
    const caret =
      activeInput !== null
        ? { start: activeInput.selectionStart, end: activeInput.selectionEnd, direction: activeInput.selectionDirection }
        : null;
    const focused = focusedKey();
    // The ZONE too: an issue is commonly drawn in the rail and on the canvas,
    // and restoring "the first element with this key" would move focus from
    // a canvas node into the rail on every redraw.
    const focusedZone = isElement(active) ? (active.closest('.ig-zone')?.getAttribute('data-zone') ?? null) : null;
    drawn = { viewer, rail: result.view.rail };

    // Package-rendered markup, escaped by the package.
    surface.innerHTML = result.markup;
    // THE ORDER'S STATUS, PUBLISHED AS DATA. A write in flight holds the order
    // — it does not move until the edit lands — and a host that wants to say
    // so has nowhere to read it once the snapshot is consumed here. The
    // attribute is the store's own vocabulary, verbatim, so a host styles or
    // reads it without this package inventing a sentence.
    surface.setAttribute('data-order', snapshot.order.status);

    if (current.canvas === 'tree') {
      const canvas = zone('canvas');
      if (canvas !== null) {
        canvas.innerHTML = renderViewer(viewer, {
          projection: 'tree',
          theme: resolved,
          selected: selectedKey(state.selection),
        }).markup;
      }
    }
    zone('inspector')?.append(inspectorChrome(document_));
    // INSIDE THE WORKSPACE ROOT, not beside it: that root is the box the
    // chrome sheet positions the chooser against, and a host that scopes its
    // theme to the root still resolves the chooser's tokens there.
    const floating = floatingChooser();
    if (floating !== null) (surface.firstElementChild ?? surface).append(floating);

    const rail = zone('rail');
    if (rail !== null) rail.scrollTop = scrollTop;
    // FOCUS SURVIVES THE REDRAW, and it moves to the target search when that
    // step opens. The keyboard path is R -> kind -> search -> Enter, and every
    // step redraws: without this, R destroyed the focused row, the next press
    // landed outside the workspace and read as 'elsewhere', and the advertised
    // pointer-free loop could not get past its first key.
    const search = surface.querySelector<HTMLInputElement>(`input[${COMMAND_ATTRIBUTE}="target-query"]`);
    const focusRow = (key: string | null, within: string | null = focusedZone): void => {
      if (key === null) return;
      focusIn(within, key);
    };
    if (activeCommand !== null) {
      const again = surface.querySelector<HTMLInputElement>(`input[${COMMAND_ATTRIBUTE}="${activeCommand}"]`);
      if (again !== null) {
        again.focus();
        const end = again.value.length;
        again.setSelectionRange(
          Math.min(caret?.start ?? end, end),
          Math.min(caret?.end ?? end, end),
          caret?.direction ?? 'none',
        );
      } else {
        // The search closed under the caret — the target was committed or the
        // draft cancelled — so focus returns to the row the flow started on.
        focusRow(selectedKey(state.selection));
      }
    } else if (search !== null && !searchWasOpen) {
      // ON THE RENDER THAT OPENS IT ONLY. A store notification while the search
      // stands open and focus rests on the host's own chrome must not yank
      // focus back into the search; the caret arm above already keeps it when
      // the reader is typing there.
      search.focus();
    } else if (pendingFocus !== null) {
      const rows = result.view.rail.rows;
      const wanted = pendingFocus.key;
      const at = rows.findIndex((slot) => wanted !== null && slot.members.includes(wanted));
      // THE ENDS ARE THE VIEWER'S ENDS. The linear projection appends the
      // excluded rows after the slots, so the last focusable row of the last
      // window is an exclusion when the document has any; read the ends off
      // what the rail actually drew rather than off the slots alone.
      const drawnKeys = [...(rail?.querySelectorAll<HTMLElement>(`[${KEY_ATTRIBUTE}][tabindex]`) ?? [])].map((row) =>
        row.getAttribute(KEY_ATTRIBUTE),
      );
      const target =
        pendingFocus.kind === 'first' ? (drawnKeys[0] ?? rows[0]?.lead)
        : pendingFocus.kind === 'last' ? (drawnKeys[drawnKeys.length - 1] ?? rows[rows.length - 1]?.lead)
        : pendingFocus.kind === 'after' ? rows[at + 1]?.lead
        : at > 0 ? rows[at - 1]?.lead : undefined;
      const jump = pendingFocus.kind;
      pendingFocus = null;
      focusRow(target ?? focused, 'rail');
      // THE VIEWPORT FOLLOWS THE JUMP. The window was re-cut around the target
      // but the scroll offset restored above is the one from before the key
      // press, so without this the focused row sits below (or above) the
      // visible rows and the reader sees nothing move.
      if (rail !== null) {
        if (jump === 'last') rail.scrollTop = rail.scrollHeight;
        else if (jump === 'first') rail.scrollTop = 0;
        else {
          const now = doc.activeElement;
          if (isFocusable(now) && typeof now.scrollIntoView === 'function') now.scrollIntoView({ block: 'nearest' });
        }
      }
    } else {
      focusRow(focused);
    }
    searchWasOpen = search !== null;
  };

  // --- listeners ---

  const onClick = (event: MouseEvent): void => {
    const target = isElement(event.target) ? event.target : null;
    if (target === null) return;
    const control = target.closest<HTMLElement>(`[${COMMAND_ATTRIBUTE}]`);
    if (control !== null && surface.contains(control)) {
      const name = control.getAttribute(COMMAND_ATTRIBUTE) ?? '';
      if (isInput(control)) return; // the `input` listener owns these
      dispatch({
        kind: 'control',
        name,
        target: control.getAttribute('data-ig-target') ?? undefined,
        // The picker publishes its kind as `data-ig-kind`; the mount's chrome
        // publishes `data-ig-value`. One command channel, two spellings.
        value: control.getAttribute('data-ig-value') ?? control.getAttribute('data-ig-kind') ?? undefined,
      });
      return;
    }
    if (target.closest('[data-ig-audit-filter]') !== null) {
      dispatch({ kind: 'control', name: 'audit-filter' });
      return;
    }
    // THE NEARER IDENTITY WINS. A relationship badge inside a row carries
    // `data-ig-group` and sits under the row's `data-ig-key`, so resolving the
    // key first would answer every badge click with the row and no edge could
    // ever be selected from a row. One `closest` over both attributes answers
    // with whichever the pointer actually landed on.
    const named = target.closest<HTMLElement>(`[${GROUP_ATTRIBUTE}],[${KEY_ATTRIBUTE}]`);
    if (named === null || !surface.contains(named)) return;
    const id = named.getAttribute(GROUP_ATTRIBUTE);
    if (id !== null) {
      dispatch({ kind: 'group', id });
      return;
    }
    const key = named.getAttribute(KEY_ATTRIBUTE);
    if (key !== null) dispatch({ kind: 'point', key });
  };

  const readInput = (event: Event): void => {
    const target = isElement(event.target) && isInput(event.target) ? event.target : null;
    if (target === null || !surface.contains(target)) return;
    const name = target.getAttribute(COMMAND_ATTRIBUTE);
    if (name === 'search' || name === 'target-query') dispatch({ kind: 'control', name, value: target.value });
  };

  // NOT WHILE AN INPUT METHOD IS COMPOSING. Every keystroke of a composition
  // fires `input`, and a redraw replaces the element that owns the
  // composition, which truncates or cancels the text before `compositionend`.
  // The value is read once the composition settles, from the same listener.
  const onInput = (event: Event): void => {
    if (isComposing(event)) return;
    readInput(event);
  };

  const onCompositionEnd = (event: Event): void => {
    readInput(event);
  };

  const onScroll = (event: Event): void => {
    const rail = zone('rail');
    if (rail === null || event.target !== rail) return;
    if (drawn === null) return;
    // THE DECISION IS THE REDUCER'S, and `null` is load-bearing: a scroll that
    // clamps back to the current start must not dispatch, because every
    // dispatch redraws and every redraw restores the scroll offset — which
    // fires this listener again. See `railWindowTarget`.
    const row = Math.floor(rail.scrollTop / pitch());
    const start = railWindowTarget(row, state.railStart, railCount(), drawn.rail.total);
    if (start !== null) dispatch({ kind: 'scroll', start });
  };

  /**
   * Which of the create flow's interactions the keyboard is in.
   *
   * `canvas` ONLY on the navigation surface — a focused row or node — because
   * that is the one place every binding belongs. A picker choice, the audit
   * filter or the delete button is a control with its own Enter and Space, and
   * a Backspace there must not delete the selected edge; the key map names
   * `elsewhere` as "everything that is not our own search box", and a button is
   * that. The target search keeps its two bindings, and everything else is
   * someone else's key.
   */
  const interaction = (): CreateInteraction => {
    const active = doc.activeElement;
    if (isElement(active) && isInput(active) && active.getAttribute(COMMAND_ATTRIBUTE) === 'target-query') {
      return 'target-search';
    }
    return focusedKey() !== null ? 'canvas' : 'elsewhere';
  };

  /**
   * The rail's window edge, decided BEFORE the viewer is asked.
   *
   * The viewer draws the excluded rows after every window, so its scene's
   * focus order runs from the last drawn slot into the exclusions rather than
   * ending there — from the viewer's side the window is the whole document.
   * The window is the mount's, so the mount decides first: on the last drawn
   * slot, ArrowDown and End re-cut the window rather than stepping into the
   * exclusions; on the first, ArrowUp and Home re-cut it upward. Anything
   * inside the window, and every other key, is the viewer's to answer.
   */
  const advanceRail = (rail: RailWindow, key: string, pressedKey: string): boolean => {
    const first = rail.rows[0];
    const last = rail.rows[rail.rows.length - 1];
    const onFirst = first !== undefined && first.members.includes(key);
    const onLast = last !== undefined && last.members.includes(key);
    const offset = rail.offsetOf(key);
    const count = railCount();
    const lastStart = Math.max(0, rail.total - count);
    switch (pressedKey) {
      case 'ArrowDown':
        if (!onLast || rail.after === 0 || offset === undefined) return false;
        pendingFocus = { kind: 'after', key };
        dispatch({ kind: 'scroll', start: Math.min(lastStart, Math.max(0, offset - RAIL_SLACK)) });
        return true;
      case 'ArrowUp':
        if (!onFirst || rail.before === 0 || offset === undefined) return false;
        pendingFocus = { kind: 'before', key };
        dispatch({ kind: 'scroll', start: Math.max(0, offset - (count - RAIL_SLACK)) });
        return true;
      case 'End':
        if (rail.after === 0) return false;
        pendingFocus = { kind: 'last', key: null };
        dispatch({ kind: 'scroll', start: lastStart });
        return true;
      case 'Home':
        if (rail.before === 0) return false;
        pendingFocus = { kind: 'first', key: null };
        dispatch({ kind: 'scroll', start: 0 });
        return true;
      default:
        return false;
    }
  };

  /**
   * The viewer's movement keys, through the viewer's own reducer.
   *
   * `mountViewer` wires these itself; the workspace composes the viewer's
   * scenes rather than its mount, so this asks `navigate` about the zone's
   * scene (see `sceneFor`) and moves focus to the key it answers with.
   * Movement never wraps and never crosses zones — the ends of the order are
   * the ends of the work — and Enter or Space selects, exactly as the viewer's
   * own shell does.
   *
   * THE RAIL WINDOW IS THE ONE THING THE VIEWER CANNOT SEE. Its scene is the
   * drawn window, so at the window's edge `navigate` correctly stays put while
   * the order goes on behind the spacer. That edge is the mount's, because the
   * window is: the window is re-cut around the row and the neighbour is
   * focused once the redraw has drawn it (`pendingFocus`).
   */
  const navigateFocus = (event: KeyboardEvent): boolean => {
    if (event.isComposing) return false;
    const active = doc.activeElement;
    if (!isElement(active)) return false;
    const owner = active.closest<HTMLElement>('.ig-zone');
    const zoneName = owner?.getAttribute('data-zone') ?? null;
    const key = active.closest<HTMLElement>(`[${KEY_ATTRIBUTE}]`)?.getAttribute(KEY_ATTRIBUTE) ?? null;
    if (owner === null || zoneName === null || key === null || !surface.contains(owner)) return false;
    if (zoneName === 'rail' && drawn !== null && advanceRail(drawn.rail, key, event.key)) return true;
    const scene = sceneFor(zoneName);
    if (scene === null) return false;
    const result = navigate(scene, { focused: key, selected: selectedKey(state.selection) }, event.key);
    if (result.command.kind === 'select') {
      dispatch({ kind: 'point', key: result.command.key });
      return true;
    }
    if (result.command.kind === 'focus') {
      focusIn(zoneName, result.command.key);
      return true;
    }
    return false;
  };

  const onKeydown = (event: KeyboardEvent): void => {
    const document_ = landed();
    const match = targetMatches(document_.issues, state.targetQuery, state.draft.source)[0]?.ref ?? null;
    const context: KeyboardContext = {
      // The FOCUSED row, not the selection: on a fresh page a row can own
      // focus while nothing is selected, and after focus moves on, a stale
      // selection must not become the source of a keyboard-started draft.
      focused: focusedKey(),
      match,
      selectedEdge: selectedEdgeId(state.selection),
      interaction: interaction(),
    };
    const intent = keyIntent(event, context);
    if (intent.kind !== 'none') {
      event.preventDefault();
      dispatch({ kind: 'intent', intent });
      return;
    }
    if (context.focused !== null && navigateFocus(event)) event.preventDefault();
  };

  const onPointerDown = (event: PointerEvent): void => {
    // ONE PRIMARY MAIN-BUTTON PRESS AT A TIME. A second pointer during a drag
    // would replace the press and strand the first drag's release; a
    // right-button press would start a drag under the context menu.
    if (pressed !== null || !event.isPrimary || event.button !== 0) return;
    const target = isElement(event.target) ? event.target : null;
    const canvas = zone('canvas');
    const keyed = target?.closest<HTMLElement>(`[${KEY_ATTRIBUTE}]`) ?? null;
    if (canvas === null || keyed === null || !canvas.contains(keyed)) return;
    const key = keyed.getAttribute(KEY_ATTRIBUTE);
    if (key === null) return;
    pressed = { pointerId: event.pointerId, key, x: event.clientX, y: event.clientY, dragging: false };
  };

  // A PRESS RELEASED OUTSIDE THE ELEMENT BEFORE THE DRAG THRESHOLD. Nothing is
  // captured yet at that point, so the release never reaches the delegated
  // listeners and the press would stay recorded — and a later move inside the
  // element, even from another press, could exceed the distance from those
  // stale coordinates and start a phantom drag for the old node. The document
  // sees every release inside the page, so the pre-drag press is cleared
  // there; a drag underway holds capture and is delivered to the element.
  const onDocumentPointerUp = (event: PointerEvent): void => {
    if (pressed !== null && !pressed.dragging && pressed.pointerId === event.pointerId) pressed = null;
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pressed === null || pressed.dragging || pressed.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < DRAG_THRESHOLD) return;
    pressed.dragging = true;
    surface.setAttribute('data-dragging', 'true');
    // CAPTURED ON THE ELEMENT, ONLY ONCE A DRAG IS UNDERWAY. Without capture a
    // pointer released outside the element never reports back, and the drag
    // state stays set until some later interaction happens to clear it. Not
    // captured on the press itself, because capture also redirects the click
    // and a plain click on a node must keep reaching the node.
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic or already-released pointer cannot be captured; the
      // release then reaches the element only if it lands inside it.
    }
    dispatch({ kind: 'drag-start', key: pressed.key });
  };

  const releasePointer = (event: PointerEvent): void => {
    try {
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    } catch {
      // Nothing was captured.
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    // THE PRESS IS CONSUMED BEFORE THE CAPTURE IS RELEASED. Releasing fires
    // `lostpointercapture` synchronously, which is wired to the cancel path;
    // with `pressed` already null that path stands down instead of cancelling
    // the drop this very handler is about to deliver.
    const was = pressed;
    pressed = null;
    releasePointer(event);
    surface.removeAttribute('data-dragging');
    if (was === null || !was.dragging) return;
    // WHAT IS UNDER THE POINTER, from the document, because a drag captured on
    // the element reports every event with the element as its target.
    const under = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(event.clientX, event.clientY) : null;
    const canvas = zone('canvas');
    const keyed = under?.closest<HTMLElement>(`[${KEY_ATTRIBUTE}]`) ?? null;
    const key = keyed !== null && canvas?.contains(keyed) === true ? keyed.getAttribute(KEY_ATTRIBUTE) : null;
    const bounds = surface.getBoundingClientRect();
    dispatch({ kind: 'drop', key, at: { x: event.clientX - bounds.left, y: event.clientY - bounds.top } });
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (pressed === null) return;
    pressed = null;
    releasePointer(event);
    surface.removeAttribute('data-dragging');
    if (state.drag !== null) dispatch({ kind: 'drop', key: null, at: { x: 0, y: 0 } });
  };

  element.addEventListener('click', onClick);
  element.addEventListener('input', onInput);
  element.addEventListener('compositionend', onCompositionEnd);
  element.addEventListener('scroll', onScroll, true);
  element.addEventListener('keydown', onKeydown);
  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('lostpointercapture', onPointerCancel);
  doc.addEventListener('pointerup', onDocumentPointerUp);
  doc.addEventListener('pointercancel', onDocumentPointerUp);

  const unsubscribe = store.subscribe(schedule);

  /** Every listener off and every node this mount built removed. Shared by `destroy` and a failed first render. */
  const teardown = (): void => {
    unsubscribe();
    element.removeEventListener('click', onClick);
    element.removeEventListener('input', onInput);
    element.removeEventListener('compositionend', onCompositionEnd);
    element.removeEventListener('scroll', onScroll, true);
    element.removeEventListener('keydown', onKeydown);
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('lostpointercapture', onPointerCancel);
    doc.removeEventListener('pointerup', onDocumentPointerUp);
    doc.removeEventListener('pointercancel', onDocumentPointerUp);
    // A DRAG STILL HELD IS LET GO. The element keeps a pointer capture across
    // a destroy otherwise, and the demo's reset mounts again over this very
    // element while the reader may still be dragging.
    if (pressed !== null) {
      try {
        if (element.hasPointerCapture(pressed.pointerId)) element.releasePointerCapture(pressed.pointerId);
      } catch {
        // Nothing was captured.
      }
      pressed = null;
    }
    surface.removeAttribute('data-dragging');
    styles.remove();
    surface.remove();
    drawn = null;
  };

  // THE FIRST RENDER CAN THROW — a host's `project` is host code — and by then
  // the listeners and the subscription are live with no handle to remove
  // them. Tear down before rethrowing, so a mount that failed leaves nothing.
  try {
    render();
  } catch (error) {
    destroyed = true;
    teardown();
    throw error;
  }

  return {
    update(next?: WorkspaceUpdate): void {
      if (destroyed) return;
      if (next !== undefined) current = { ...current, ...next, store };
      schedule();
    },
    dispatch,
    get state(): HostState {
      return state;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      teardown();
    },
  };
}
