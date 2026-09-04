/**
 * The DOM shell — the only module in the demo that touches nodes.
 *
 * `@issuegraph/editor` renders the three-zone workspace as markup and publishes
 * every control as `data-ig-command`; `@issuegraph/viewer` publishes its two
 * identities, `data-ig-key` and `data-ig-group`. A host reads those, reduces,
 * and renders again — and that loop is this file. What it DECIDES lives in
 * `host.ts`, as a reducer with no DOM, so this file is left with listeners,
 * an `innerHTML` assignment, and the chrome the packages leave to a host.
 *
 * ## `innerHTML`, and why it is not the thing `render.ts` refused
 *
 * The demo's old list wrote every string with `textContent`, because an issue
 * title is data an adapter supplied. That rule stands: nothing in this file
 * interpolates host text into markup. What IS assigned as markup is the
 * packages' own rendered output, which `renderMarkup` escaped — the exact
 * bytes a server-rendered host would send. The host's chrome beside it is
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
 */

import {
  type CreateInteraction,
  type KeyboardContext,
  type PickerWords,
  type WorkspaceWords,
  keyIntent,
  pickerPlacement,
  pickerStylesheet,
  renderPicker,
  renderWorkspace,
  selectedEdgeId,
  selectedKey,
  summaryOf,
} from '@issuegraph/editor';
import type { EdgeKind, GraphDocument, Store, StoreSnapshot, WriteRecord } from '@issuegraph/store';
import { type Theme, defaultTheme, extendTheme, renderViewer } from '@issuegraph/viewer';

import { projectDocument } from './document.ts';
import {
  CANVAS_MODES,
  type HostCommand,
  type HostEffect,
  type HostState,
  INITIAL_HOST_STATE,
  KINDS,
  THEMES,
  type ThemeName,
  reconcileHost,
  reduceHost,
  targetMatches,
} from './host.ts';
import { explainDocument } from './order.ts';
import { seedHolds } from './seed.ts';
import type { DemoSource } from './source.ts';
import { STAMPED_PACKAGES, VERSIONS } from './versions.ts';

/** The words the packages refuse to invent. */
export const WORKSPACE_WORDS: WorkspaceWords = {
  nothingSelected: 'Pick a row, a node or an edge to inspect it.',
  clearSelection: 'clear the selection',
  relationships: 'Relationships',
};

/** Each relationship as a phrase, so a picker reads as a sentence. */
export const KIND_PHRASE: Readonly<Record<EdgeKind, string>> = {
  'blocked-by': 'is blocked by',
  'serialize-with': 'serializes with',
  'together-with': 'goes together with',
  'duplicate-of': 'is a duplicate of',
  'decomposed-from': 'was decomposed from',
};

export const PICKER_WORDS: PickerWords = {
  kinds: KIND_PHRASE,
  heading: 'Relationship kind',
  flip: 'flip the direction',
  current: 'current',
};

/**
 * The second theme: the paper palette the viewer's README documents, so the
 * switcher proves the contract the Descant embed relies on — redeclare the
 * tokens, touch nothing else. The exact values are the README's, which the
 * viewer's acceptance test also renders, so this cannot drift from what is
 * tested.
 */
export const PAPER_THEME: Theme = extendTheme(defaultTheme, {
  colors: {
    '--ig-bg': '#FBFAF7',
    '--ig-surface': '#FFFFFF',
    '--ig-surface-2': '#F2F0EA',
    '--ig-line': '#D9D4C7',
    '--ig-text': '#1B1A17',
    '--ig-text-body': '#3B3A35',
    '--ig-text-muted': '#5E5B52',
    '--ig-accent': '#0A5B8A',
    '--ig-focus': '#0A5B8A',
    '--ig-station-ready': '#0A5B8A',
    '--ig-station-pending': '#5E5B52',
    '--ig-station-held': '#8A857A',
    '--ig-edge-blocked-by': '#A32020',
    '--ig-edge-serialize-with': '#7A5A00',
    '--ig-edge-together-with': '#0A5B8A',
    '--ig-edge-duplicate-of': '#6B2E9E',
    '--ig-edge-decomposed-from': '#A31257',
  },
});

export function themeFor(name: ThemeName): Theme {
  return name === 'paper' ? PAPER_THEME : defaultTheme;
}

/** How many rail rows are drawn per window. Wider than the package default so a scroll rarely lands past the drawn rows. */
export const RAIL_COUNT = 80;

/** How far the reader may scroll into the window before it is re-cut around them. */
const RAIL_SLACK = 20;

/** The kind chooser's size for placement — the CSS decides the real one; this only picks a corner. */
const CHOOSER_SIZE = { width: 280, height: 220 };

const UNSETTLED: ReadonlySet<WriteRecord['state']> = new Set(['pending', 'invalid', 'failed', 'conflict']);

const STATE_LABEL: Readonly<Record<WriteRecord['state'], string>> = {
  pending: 'writing',
  invalid: 'refused before dispatch',
  failed: 'the tracker refused it',
  conflict: 'the document moved upstream',
};

export interface Live {
  readonly store: Store;
  readonly source: DemoSource;
}

export interface SandboxElements {
  /** The container every listener is attached to; holds all of the below. */
  readonly root: HTMLElement;
  readonly workspace: HTMLElement;
  /** The `<style>` the workspace's stylesheet is installed into. */
  readonly styles: HTMLStyleElement;
  readonly writes: HTMLElement;
  readonly versions: HTMLElement;
  readonly outcome: HTMLSelectElement;
}

export interface SandboxHandle {
  readonly state: () => HostState;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string>> = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

function button(label: string, command: string, attributes: Readonly<Record<string, string>> = {}): HTMLButtonElement {
  return el('button', { type: 'button', class: 'chrome-button', 'data-ig-command': command, ...attributes }, [label]);
}

/** One write, as a sentence. Exhaustive over `Proposal['op']`, so a sixth op fails here. */
function describe(record: WriteRecord): string {
  const mutation = record.mutation;
  switch (mutation.op) {
    case 'create':
      return `create: #${mutation.from} ${KIND_PHRASE[mutation.kind]} #${mutation.to}`;
    case 'delete':
      return `delete: ${mutation.edgeId}`;
    case 'retype':
      return `retype: ${mutation.edgeId} → ${mutation.nextKind}`;
    case 'flip':
      return `flip: ${mutation.edgeId}`;
  }
}

/** Mount the sandbox. `boot` builds a fresh store and source, and is called again on reset. */
export function mountSandbox(elements: SandboxElements, boot: (onChange: () => void) => Live): SandboxHandle {
  const { root, workspace, styles, writes, versions, outcome } = elements;
  const chromeStyles = el('style');
  chromeStyles.textContent = pickerStylesheet;
  styles.after(chromeStyles);

  let state: HostState = INITIAL_HOST_STATE;
  let live: Live;
  let unsubscribe = (): void => {};
  let pending = false;
  let destroyed = false;
  let pressed: { readonly key: string; readonly x: number; readonly y: number; dragging: boolean } | null = null;

  const landed = (): GraphDocument => {
    const snapshot = live.store.getSnapshot();
    return { issues: snapshot.issues, edges: snapshot.landed };
  };

  // COALESCED ON A MICROTASK, NOT A FRAME. The store notifies once per state
  // change and a hydrate or a settling write can produce several in one task;
  // one render per task is what a reader sees anyway. A frame would coalesce
  // the same way but never fires while the tab is hidden, which stalls every
  // store notification until the reader returns — and makes the page
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
        void live.store.propose(effect.proposal);
        return;
      case 'retry': {
        // A conflict retries against the LATEST document: the store offers no
        // retry-on-latest of its own, so the host composes it from the two
        // single steps, exactly as the store's README prescribes.
        const record = live.store.getSnapshot().writes.find((each) => each.mutationId === effect.mutationId);
        if (record?.state === 'conflict') {
          void live.store.rehydrate().then(() => live.store.retry(effect.mutationId));
        } else {
          void live.store.retry(effect.mutationId);
        }
        return;
      }
      case 'discard':
        live.store.discardMine(effect.mutationId);
        return;
      case 'dismiss-change':
        live.store.dismissChange();
        return;
      case 'arm':
        live.source.arm(effect.outcome);
        return;
      case 'reset':
        start();
        return;
    }
  };

  const dispatch = (command: HostCommand): void => {
    const result = reduceHost(state, command, landed());
    state = result.state;
    for (const effect of result.effects) perform(effect);
    schedule();
  };

  const start = (): void => {
    unsubscribe();
    live = boot(schedule);
    unsubscribe = live.store.subscribe(schedule);
    void live.store.hydrate().then(schedule);
    schedule();
  };

  const zone = (name: string): HTMLElement | null => workspace.querySelector(`.ig-zone[data-zone="${name}"]`);

  const pitch = (theme: Theme): number =>
    theme.metrics['--ig-row-height'] + theme.metrics['--ig-space-tight'];

  /** The chrome the inspector zone gets beside the package's own panel. */
  const inspectorChrome = (document: GraphDocument, theme: Theme): HTMLElement => {
    const panel = el('div', { class: 'chrome', 'data-chrome': 'inspector' });
    const edgeId = selectedEdgeId(state.selection);
    const issue = selectedKey(state.selection);
    const { draft } = state;

    if (edgeId !== null) {
      const picker = el('div', { class: 'chrome-picker' });
      // Package-rendered markup, escaped by the package.
      picker.innerHTML = renderPicker(document, edgeId, { words: PICKER_WORDS, theme }).markup;
      panel.append(picker, button('delete this relationship', 'delete', { class: 'chrome-button chrome-danger' }));
    } else if (draft.source === null) {
      if (issue !== null) panel.append(button('+ add a relationship', 'add'));
    } else if (draft.kind === null) {
      // Placed at the drop point when a canvas drag got here; inline otherwise.
      if (state.drop === null) panel.append(kindChooser(draft.source, draft.target));
    } else if (draft.target === null) {
      panel.append(targetSearch(document, draft.source, draft.kind));
    }

    panel.append(
      el('p', { class: 'chrome-keys' }, [
        'R relate · 1–5 kind · type to search · ⏎ commit · ⌫ delete · T retype · Esc cancel',
      ]),
    );
    return panel;
  };

  const kindChooser = (source: string, target: string | null): HTMLElement => {
    const chooser = el('div', { class: 'chrome-chooser', role: 'group', 'aria-label': 'Relationship kind' });
    chooser.append(
      el('p', { class: 'chrome-sentence' }, [
        `#${source} … ${target === null ? 'choose the kind' : `#${target}`}`,
      ]),
    );
    const list = el('div', { class: 'chrome-kinds' });
    KINDS.forEach((kind, index) => {
      list.append(
        button(`${String(index + 1)} ${KIND_PHRASE[kind]}`, 'kind', {
          'data-ig-value': kind,
          'data-edge': kind,
        }),
      );
    });
    chooser.append(list, button('cancel', 'cancel', { class: 'chrome-button chrome-quiet' }));
    return chooser;
  };

  const targetSearch = (document: GraphDocument, source: string, kind: EdgeKind): HTMLElement => {
    const search = el('div', { class: 'chrome-search' });
    search.append(el('p', { class: 'chrome-sentence' }, [`#${source} ${KIND_PHRASE[kind]} …`]));
    const input = el('input', {
      type: 'search',
      class: 'chrome-input',
      placeholder: 'find the other issue by number or title',
      'aria-label': 'Target issue',
      'data-ig-command': 'target-query',
    });
    input.value = state.targetQuery;
    search.append(input);
    const matches = targetMatches(document.issues, state.targetQuery, source);
    if (matches.length > 0) {
      const list = el('ul', { class: 'chrome-matches' });
      for (const match of matches) {
        list.append(
          el('li', {}, [
            button(`#${match.ref} ${match.title}`, 'target', {
              'data-ig-target': match.ref,
              class: 'chrome-button chrome-match',
            }),
          ]),
        );
      }
      search.append(list);
    }
    search.append(button('cancel', 'cancel', { class: 'chrome-button chrome-quiet' }));
    return search;
  };

  const floatingChooser = (): HTMLElement | null => {
    const { draft, drop } = state;
    if (drop === null || draft.source === null || draft.kind !== null) return null;
    const bounds = workspace.getBoundingClientRect();
    const placed = pickerPlacement(drop, CHOOSER_SIZE, {
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
    });
    const chooser = kindChooser(draft.source, draft.target);
    chooser.classList.add('chrome-floating');
    chooser.style.setProperty('--chooser-x', `${String(placed.x)}px`);
    chooser.style.setProperty('--chooser-y', `${String(placed.y)}px`);
    return chooser;
  };

  const renderWrites = (snapshot: StoreSnapshot): void => {
    writes.replaceChildren();
    const unsettled = snapshot.writes.filter((record) => UNSETTLED.has(record.state));
    if (snapshot.order.status === 'held') {
      writes.append(el('p', { class: 'order-status order-status-held' }, ['order held — a write is in flight, and the order does not move until it lands']));
    }
    const change = snapshot.lastChange;
    if (change !== undefined) {
      const summary = summaryOf(change);
      const text = summary.unchanged
        ? 'the last write landed and the order did not change'
        : `the last write landed: ${summary.parts.map((part) => `${String(part.count)} ${part.facet}`).join(', ')}`;
      writes.append(el('p', { class: 'change' }, [text, ' ', button('dismiss', 'dismiss-change', { class: 'chrome-button chrome-quiet chrome-inline' })]));
    }
    if (unsettled.length === 0) return;
    const list = el('ul', { class: 'writes-list' });
    for (const record of unsettled) {
      const row = el('li', { class: 'write', 'data-state': record.state });
      row.append(
        el('span', { class: 'write-op' }, [describe(record)]),
        el('span', { class: 'write-state' }, [STATE_LABEL[record.state]]),
      );
      if (record.state === 'invalid') row.append(el('span', { class: 'write-reason' }, [record.reason.message]));
      if (record.state === 'failed') row.append(el('span', { class: 'write-reason' }, [record.reason]));
      if (record.state === 'failed' || record.state === 'conflict') {
        row.append(button(record.state === 'conflict' ? 'retry on latest' : 'retry', 'retry', { 'data-ig-target': record.mutationId, class: 'chrome-button chrome-inline' }));
      }
      if (record.state !== 'pending') {
        row.append(button('discard mine', 'discard', { 'data-ig-target': record.mutationId, class: 'chrome-button chrome-quiet chrome-inline' }));
      }
      list.append(row);
    }
    writes.append(list);
  };

  const render = (): void => {
    if (destroyed) return;
    const snapshot = live.store.getSnapshot();
    const document_ = landed();
    // A landed write can retire what the state names; agree with the document first.
    state = reconcileHost(state, document_);
    const explained = explainDocument(document_, seedHolds());
    const { viewer, audit } = projectDocument(explained, document_);
    const theme = themeFor(state.theme);

    const result = renderWorkspace(viewer, {
      words: WORKSPACE_WORDS,
      selection: state.selection,
      scale: state.scale,
      rail: { start: state.railStart, count: RAIL_COUNT },
      audit,
      auditFiltered: state.auditFiltered,
      theme,
    });
    if (styles.textContent !== result.styles) styles.textContent = result.styles;

    // What the reader was doing survives the redraw: the rail's scroll offset,
    // and the caret in whichever search box they were typing into.
    const railBefore = zone('rail');
    const scrollTop = railBefore?.scrollTop ?? 0;
    const active = document.activeElement;
    const activeCommand = active instanceof HTMLInputElement ? active.getAttribute('data-ig-command') : null;

    workspace.innerHTML = result.markup;
    document.documentElement.setAttribute('data-theme', state.theme);

    if (state.canvas === 'tree') {
      const canvas = zone('canvas');
      if (canvas !== null) {
        canvas.innerHTML = renderViewer(viewer, {
          projection: 'tree',
          theme,
          selected: selectedKey(state.selection),
        }).markup;
      }
    }
    zone('inspector')?.append(inspectorChrome(document_, theme));
    const floating = floatingChooser();
    if (floating !== null) workspace.append(floating);

    const rail = zone('rail');
    if (rail !== null) rail.scrollTop = scrollTop;
    if (activeCommand !== null) {
      const again = root.querySelector<HTMLInputElement>(`input[data-ig-command="${activeCommand}"]`);
      if (again !== null) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    }

    renderWrites(snapshot);
    outcome.value = live.source.armed();
    // The masthead toggles read as pressed for the value in force.
    for (const toggle of root.querySelectorAll<HTMLElement>('[data-chrome="theme"] [data-ig-value]')) {
      toggle.setAttribute('aria-pressed', String(toggle.getAttribute('data-ig-value') === state.theme));
    }
    for (const toggle of root.querySelectorAll<HTMLElement>('[data-chrome="canvas"] [data-ig-value]')) {
      toggle.setAttribute('aria-pressed', String(toggle.getAttribute('data-ig-value') === state.canvas));
    }
  };

  // --- listeners ---

  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) return;
    const control = target.closest<HTMLElement>('[data-ig-command]');
    if (control !== null && root.contains(control)) {
      const name = control.getAttribute('data-ig-command') ?? '';
      if (control instanceof HTMLInputElement) return; // the `input` listener owns these
      dispatch({
        kind: 'control',
        name,
        target: control.getAttribute('data-ig-target') ?? undefined,
        // The editor's picker publishes its kind as `data-ig-kind`; the host's
        // chrome publishes `data-ig-value`. One command channel, two spellings.
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
    const named = target.closest<HTMLElement>('[data-ig-group],[data-ig-key]');
    if (named === null || !workspace.contains(named)) return;
    const id = named.getAttribute('data-ig-group');
    if (id !== null) {
      dispatch({ kind: 'group', id });
      return;
    }
    const key = named.getAttribute('data-ig-key');
    if (key !== null) dispatch({ kind: 'point', key });
  };

  const onInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const name = target.getAttribute('data-ig-command');
    if (name === 'search' || name === 'target-query') dispatch({ kind: 'control', name, value: target.value });
  };

  const onChange = (event: Event): void => {
    if (event.target === outcome) dispatch({ kind: 'control', name: 'arm', value: outcome.value });
  };

  const onScroll = (event: Event): void => {
    const rail = zone('rail');
    if (rail === null || event.target !== rail) return;
    const row = Math.floor(rail.scrollTop / pitch(themeFor(state.theme)));
    const offset = row - state.railStart;
    if (offset >= 0 && offset <= RAIL_COUNT - RAIL_SLACK * 2) return;
    dispatch({ kind: 'scroll', start: Math.max(0, row - RAIL_SLACK) });
  };

  /** The row or node that owns keyboard focus, if focus is on one at all. */
  const focusedKey = (): string | null => {
    const active = document.activeElement;
    const keyed = active instanceof Element ? active.closest<HTMLElement>('[data-ig-key]') : null;
    return keyed !== null && workspace.contains(keyed) ? keyed.getAttribute('data-ig-key') : null;
  };

  /**
   * Which of the create flow's interactions the keyboard is in.
   *
   * `canvas` ONLY on the navigation surface — a focused row or node — because
   * that is the one place every binding belongs. A theme toggle, the audit
   * filter, a picker choice or the delete button is a control with its own
   * Enter and Space, and a Backspace there must not delete the selected edge;
   * the editor's own README names `elsewhere` as "everything that is not our
   * own search box", and a host's buttons are that. The target search keeps
   * its two bindings, and everything else is someone else's key.
   */
  const interaction = (): CreateInteraction => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.getAttribute('data-ig-command') === 'target-query') {
      return 'target-search';
    }
    return focusedKey() !== null ? 'canvas' : 'elsewhere';
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
    if (intent.kind === 'none') return;
    event.preventDefault();
    dispatch({ kind: 'intent', intent });
  };

  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const canvas = zone('canvas');
    const keyed = target?.closest<HTMLElement>('[data-ig-key]') ?? null;
    if (canvas === null || keyed === null || !canvas.contains(keyed)) return;
    const key = keyed.getAttribute('data-ig-key');
    if (key === null) return;
    pressed = { key, x: event.clientX, y: event.clientY, dragging: false };
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pressed === null || pressed.dragging) return;
    if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 6) return;
    pressed.dragging = true;
    workspace.setAttribute('data-dragging', 'true');
    dispatch({ kind: 'drag-start', key: pressed.key });
  };

  const onPointerUp = (event: PointerEvent): void => {
    const was = pressed;
    pressed = null;
    workspace.removeAttribute('data-dragging');
    if (was === null || !was.dragging) return;
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const canvas = zone('canvas');
    const keyed = under?.closest<HTMLElement>('[data-ig-key]') ?? null;
    const key = keyed !== null && canvas?.contains(keyed) === true ? keyed.getAttribute('data-ig-key') : null;
    const bounds = workspace.getBoundingClientRect();
    dispatch({ kind: 'drop', key, at: { x: event.clientX - bounds.left, y: event.clientY - bounds.top } });
  };

  const onPointerCancel = (): void => {
    pressed = null;
    workspace.removeAttribute('data-dragging');
    if (state.drag !== null) dispatch({ kind: 'drop', key: null, at: { x: 0, y: 0 } });
  };

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('scroll', onScroll, true);
  root.addEventListener('keydown', onKeydown);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);

  versions.replaceChildren(
    ...STAMPED_PACKAGES.map((name) =>
      el('span', { class: 'version' }, [`@issuegraph/${name} `, el('strong', {}, [VERSIONS[name]])]),
    ),
  );

  // The masthead's own controls publish commands too, so one listener covers them.
  for (const control of root.querySelectorAll<HTMLElement>('[data-chrome="theme"]')) {
    control.replaceChildren(
      ...THEMES.map((name) => button(name, 'theme', { 'data-ig-value': name, class: 'chrome-button chrome-toggle' })),
    );
  }
  for (const control of root.querySelectorAll<HTMLElement>('[data-chrome="canvas"]')) {
    control.replaceChildren(
      ...CANVAS_MODES.map((name) => button(name, 'canvas', { 'data-ig-value': name, class: 'chrome-button chrome-toggle' })),
    );
  }

  start();

  return {
    state: () => state,
    destroy: () => {
      destroyed = true;
      unsubscribe();
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      root.removeEventListener('scroll', onScroll, true);
      root.removeEventListener('keydown', onKeydown);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', onPointerUp);
      root.removeEventListener('pointercancel', onPointerCancel);
      chromeStyles.remove();
    },
  };
}
