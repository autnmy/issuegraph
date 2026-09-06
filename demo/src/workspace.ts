/**
 * The sandbox — what is left of the host once the mount is the package's.
 *
 * `@issuegraph/editor` ships `mountWorkspace`: the listener wiring, the focus
 * source and restore, the keyboard routing, the canvas drag and the store
 * subscription all live there now, in the viewer's `mountViewer` shape. This
 * file used to be that shell, written once for this page; what remains is the
 * chrome that is genuinely the sandbox's — the writes log, the versions line,
 * the theme and canvas toggles, the armed dispatch outcome and the reset — and
 * the two ports the mount takes from a host: the store, and the projection of
 * a snapshot onto the viewer's document and the audit's input.
 *
 * ## One listener, for the sandbox's own controls
 *
 * The mount reads every `data-ig-command` inside the element it was given and
 * nothing outside it. The controls above and beside the workspace publish the
 * same attribute, so one delegated `click` on the sandbox root reads them:
 * the commands the mount's reducer knows (`retry`, `discard`, `dismiss-change`
 * — the writes log's) are handed to it through `handle.dispatch`, and the ones
 * it does not (`theme`, `canvas`, `reset`) are the sandbox's own.
 *
 * ## `textContent`, everywhere
 *
 * Every string written here is host chrome built with `createElement` and
 * `textContent`; the package's markup is the mount's to assign. Nothing in
 * this file touches `innerHTML`.
 */

import {
  CANVAS_MODES,
  type CanvasMode,
  type MountWords,
  type PickerWords,
  type WorkspaceHandle,
  type WorkspaceProjection,
  mountWorkspace,
  summaryOf,
} from '@issuegraph/editor';
import type { EdgeKind, Store, StoreSnapshot, WriteRecord } from '@issuegraph/store';
import { type Theme, defaultTheme, extendTheme } from '@issuegraph/viewer';

import { projectDocument } from './document.ts';
import { type RunningWork, hostFacts } from './host.ts';
import { explainDocument } from './order.ts';
import { seedHolds } from './seed.ts';
import type { DemoSource, NextOutcome } from './source.ts';
import { STAMPED_PACKAGES, VERSIONS } from './versions.ts';

/** The two themes the page offers: the package default, and the README's paper theme. */
export const THEMES = Object.freeze(['default', 'paper'] as const);
export type ThemeName = (typeof THEMES)[number];

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

/** The words the packages refuse to invent. */
export const WORKSPACE_WORDS: MountWords = {
  nothingSelected: 'Pick a row, a node or an edge to inspect it.',
  clearSelection: 'clear the selection',
  relationships: 'Relationships',
  picker: PICKER_WORDS,
  addRelationship: '+ add a relationship',
  deleteRelationship: 'delete this relationship',
  cancel: 'cancel',
  chooseKind: 'choose the kind',
  targetLabel: 'Target issue',
  targetPlaceholder: 'find the other issue by number or title',
  keys: 'R relate · 1–5 kind · type to search · ⏎ commit · ⌫ delete · T retype · Esc cancel',
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

const UNSETTLED: ReadonlySet<WriteRecord['state']> = new Set(['pending', 'invalid', 'failed', 'conflict']);

const STATE_LABEL: Readonly<Record<WriteRecord['state'], string>> = {
  pending: 'writing',
  invalid: 'refused before dispatch',
  failed: 'the tracker refused it',
  conflict: 'the document moved upstream',
};

/** The commands the mount's reducer owns that the writes log publishes outside the mount. */
const FORWARDED: ReadonlySet<string> = new Set(['retry', 'discard', 'dismiss-change']);

/**
 * Commands published INSIDE the mounted workspace that are the host's to act
 * on. The viewer draws the freshness stamp's refresh control and wires nothing
 * to it — refreshing a mirror is fetching, which the packages never do — and
 * the mount's reducer answers a command it does not know by changing nothing.
 * So the click reaches this listener, and this set is what admits it past the
 * "inside the mount, the mount owns it" rule below.
 */
export const HOST_COMMANDS_FROM_WORKSPACE: ReadonlySet<string> = new Set(['refresh']);

/** How long the demo's runner has been on its job when the page loads. A fixture, like the seed. */
const RUNNING_FOR_MS = 12 * 60_000;

/**
 * The demo runner's job. Its start is fixed relative to the moment the page
 * mounts, so the row reads `12m` on load and counts up from there — captured
 * ONCE, not per mirror read, or a refresh would wind the elapsed time back.
 */
export function runningWork(mountedAt: Date): RunningWork {
  return { phase: 'Review', startedAt: new Date(mountedAt.getTime() - RUNNING_FOR_MS) };
}

const OUTCOMES: ReadonlySet<string> = new Set(['apply', 'reject', 'conflict']);

function isOutcome(value: string): value is NextOutcome {
  return OUTCOMES.has(value);
}

function isTheme(value: string | null): value is ThemeName {
  return value === 'default' || value === 'paper';
}

function isCanvasMode(value: string | null): value is CanvasMode {
  return value === 'neighbourhood' || value === 'tree';
}

export interface Live {
  readonly store: Store;
  readonly source: DemoSource;
}

export interface SandboxOptions {
  /** The clock the host facts read. The page passes the real one; a test passes a fixed one. */
  readonly clock?: () => Date;
}

export interface SandboxElements {
  /** The container every sandbox listener is attached to; holds all of the below. */
  readonly root: HTMLElement;
  /** The element the workspace is mounted into. The mount installs its own stylesheet there. */
  readonly workspace: HTMLElement;
  readonly writes: HTMLElement;
  readonly versions: HTMLElement;
  readonly outcome: HTMLSelectElement;
}

export interface SandboxState {
  readonly theme: ThemeName;
  readonly canvas: CanvasMode;
  /** The mount's own state — the selection, the draft, the scale, the rail window. */
  readonly workspace: WorkspaceHandle['state'];
}

export interface SandboxHandle {
  readonly state: () => SandboxState;
  destroy(): void;
}

/**
 * The host's projection, from ONE derivation.
 *
 * `explainDocument` is the same `@issuegraph/derive` call the store's deriver
 * runs, so the viewer's rows, the audit's cycles and the store's order cannot
 * disagree. The landed document is `{ issues, edges: landed }` — never the
 * projection with its unsettled edits, because the order must not move for an
 * edit that did not land. The mount adds the unsettled edges to the canvas
 * itself, from the store's own projection.
 */
function project(snapshot: StoreSnapshot, observedAt: Date, now: Date, job: RunningWork): WorkspaceProjection {
  const landed = { issues: snapshot.issues, edges: snapshot.landed };
  const holds = seedHolds();
  const explained = explainDocument(landed, holds);
  // THE HOST FACTS, from the same explained order the slots come from, so the
  // header's tally and the rows beneath it are one derivation.
  const host = hostFacts({ rows: explained.rows, holds, observedAt, now, job });
  return projectDocument(explained, landed, host);
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
export function mountSandbox(
  elements: SandboxElements,
  boot: (onChange: () => void) => Live,
  options: SandboxOptions = {},
): SandboxHandle {
  const { root, workspace, writes, versions, outcome } = elements;
  const clock = options.clock ?? ((): Date => new Date());

  let theme: ThemeName = 'default';
  // WHEN THE MIRROR WAS LAST READ — the `as of` stamp. Set when the store
  // hydrates and again on every refresh, which is the only two times this
  // trackerless demo has anything that reads as a mirror read.
  let observedAt: Date = clock();
  const job: RunningWork = runningWork(observedAt);
  let canvas: CanvasMode = 'neighbourhood';
  let live: Live;
  let handle: WorkspaceHandle | null = null;
  let unsubscribe = (): void => {};
  let pending = false;
  let destroyed = false;

  // COALESCED ON A MICROTASK, for the mount's reason: one redraw per task, and
  // never a frame, which stalls while the tab is hidden.
  const schedule = (): void => {
    if (pending || destroyed) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      renderChrome();
    });
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

  const renderChrome = (): void => {
    if (destroyed) return;
    renderWrites(live.store.getSnapshot());
    outcome.value = live.source.armed();
    document.documentElement.setAttribute('data-theme', theme);
    // The masthead toggles read as pressed for the value in force.
    for (const toggle of root.querySelectorAll<HTMLElement>('[data-chrome="theme"] [data-ig-value]')) {
      toggle.setAttribute('aria-pressed', String(toggle.getAttribute('data-ig-value') === theme));
    }
    for (const toggle of root.querySelectorAll<HTMLElement>('[data-chrome="canvas"] [data-ig-value]')) {
      toggle.setAttribute('aria-pressed', String(toggle.getAttribute('data-ig-value') === canvas));
    }
  };

  /** Build a fresh store and mount the workspace over it. Called at start and on reset. */
  const start = (): void => {
    unsubscribe();
    handle?.destroy();
    live = boot(schedule);
    unsubscribe = live.store.subscribe(schedule);
    handle = mountWorkspace(workspace, {
      store: live.store,
      project: (snapshot) => project(snapshot, observedAt, clock(), job),
      words: WORKSPACE_WORDS,
      theme: themeFor(theme),
      canvas,
    });
    // ONE RENDER, once the store has answered: `hydrate` schedules it. A second
    // `schedule()` here painted the chrome against pre-hydrate state and threw
    // the frame away a microtask later.
    void hydrate();
  };

  /**
   * Read the mirror: hydrate the store and stamp the read.
   *
   * THE STAMP HAS TO REACH THE WORKSPACE, and the store's own notification
   * does not carry it: the store publishes to its subscribers synchronously,
   * INSIDE `hydrate()`, so the mount has already projected — with the OLD
   * `observedAt` — by the time the await returns. Re-stamping and redrawing
   * only the chrome left the drawn `as of` one read behind, every time. The
   * mount's `update()` re-runs the projection with the new stamp.
   */
  const hydrate = async (): Promise<void> => {
    await live.store.hydrate();
    observedAt = clock();
    handle?.update();
    schedule();
  };

  // --- the sandbox's own controls ---

  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest<HTMLElement>('[data-ig-command]') ?? null;
    if (control === null || !root.contains(control)) return;
    const name = control.getAttribute('data-ig-command') ?? '';
    // Inside the mounted element the mount owns every command; this listener
    // reads only the chrome around it — and the few commands the packages
    // publish for the HOST to act on (`HOST_COMMANDS_FROM_WORKSPACE`).
    if (workspace.contains(control) && !HOST_COMMANDS_FROM_WORKSPACE.has(name)) return;
    const value = control.getAttribute('data-ig-value');
    if (handle === null) return;
    if (FORWARDED.has(name)) {
      handle.dispatch({ kind: 'control', name, target: control.getAttribute('data-ig-target') ?? undefined });
      return;
    }
    switch (name) {
      case 'theme':
        if (!isTheme(value)) return;
        theme = value;
        handle.update({ theme: themeFor(theme) });
        schedule();
        return;
      case 'canvas':
        if (!isCanvasMode(value)) return;
        canvas = value;
        handle.update({ canvas });
        schedule();
        return;
      case 'reset':
        start();
        return;
      case 'refresh':
        void hydrate();
        return;
      default:
        return;
    }
  };

  const onChange = (event: Event): void => {
    if (event.target !== outcome || !isOutcome(outcome.value)) return;
    live.source.arm(outcome.value);
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);

  versions.replaceChildren(
    ...STAMPED_PACKAGES.map((name) =>
      el('span', { class: 'version' }, [`@issuegraph/${name} `, el('strong', {}, [VERSIONS[name]])]),
    ),
  );

  // The masthead's own controls publish commands too, so the one listener covers them.
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
    state: () => {
      if (handle === null) throw new Error('the sandbox is not mounted');
      return { theme, canvas, workspace: handle.state };
    },
    destroy: () => {
      destroyed = true;
      unsubscribe();
      handle?.destroy();
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
    },
  };
}
