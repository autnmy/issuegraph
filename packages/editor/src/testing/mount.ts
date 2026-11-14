/**
 * The mount's test harness: a real store behind a scripted source, mounted into
 * jsdom through the public entry point, and the projections the mount suites
 * draw with.
 *
 * ITS OWN MODULE SO THE MOUNT SUITES CAN SPLIT ACROSS FILES. Each test file runs
 * in its own process under the per-test timeout, which also bounds the file, so
 * one file holding every mounted suite runs up against it.
 */

import assert from 'node:assert/strict';

import type { GraphDocument, Mutation, StoreSnapshot, DataSource } from '@issuegraph/store';
import { type OrderDeriver, createScriptedSource, createStore, makeEdge } from '@issuegraph/store';
import { JSDOM } from 'jsdom';

import { PICKER_WORDS } from './picker.ts';
import { WORKSPACE_WORDS } from './workspace.ts';
import type { WorkspaceSelection } from '../workspace/selection.ts';
import { type CanvasMode, type FirstPassOption, type MountWords, type WorkspaceProjection, mountWorkspace } from '../workspace/mount.ts';

export const WORDS: MountWords = {
  ...WORKSPACE_WORDS,
  picker: PICKER_WORDS,
  addRelationship: 'add a relationship',
  deleteRelationship: 'delete this relationship',
  cancel: 'cancel',
  chooseKind: 'choose the kind',
  targetLabel: 'target issue',
  targetPlaceholder: 'find the other issue',
  keys: 'R relate · Esc cancel',
};

export const SEED: GraphDocument = {
  issues: [
    { ref: '1', title: 'Publish the first release', state: 'open', priority: 0 },
    { ref: '2', title: 'Write the release notes', state: 'open', priority: 3 },
    { ref: '3', title: 'Cut the changelog', state: 'open', priority: 3 },
    { ref: '4', title: 'Rename the config flag', state: 'open' },
  ],
  edges: [makeEdge('blocked-by', '1', '2')],
};

/** The happy-path edit semantics, for the scripted source to apply on `applied`. */
export function apply(document: GraphDocument, mutation: Mutation): GraphDocument {
  if (mutation.op !== 'create') return document;
  return { ...document, edges: [...document.edges, makeEdge(mutation.kind, mutation.from, mutation.to)] };
}

/** A host's projection: the order as the deriver ranked it, and an audit over the landed document. */
export function project(snapshot: StoreSnapshot): WorkspaceProjection {
  const landed = { issues: snapshot.issues, edges: snapshot.landed };
  return {
    viewer: {
      issues: snapshot.issues.map((issue) => ({
        key: issue.ref,
        title: issue.title,
        open: issue.state === 'open',
        priority: issue.priority ?? 2,
      })),
      edges: snapshot.landed.map((edge) => ({ field: edge.kind, from: edge.from, to: edge.to })),
      order: {
        slots: snapshot.order.rows.map((row) => ({
          rank: row.rank + 1,
          lead: row.ref,
          members: [row.ref],
          ready: row.ready,
          holds: [],
        })),
        excluded: [],
      },
      cycles: [],
    },
    audit: { document: landed, graph: { cycles: [], duplicateCanonical: () => null } },
  };
}

/** Let every queued microtask — the coalesced render among them — run. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The happy-path semantics for every op, so a retype can be driven end to end. */
export function applyAny(document: GraphDocument, mutation: Mutation): GraphDocument {
  switch (mutation.op) {
    case 'create':
      return apply(document, mutation);
    case 'delete':
      return { ...document, edges: document.edges.filter((edge) => edge.id !== mutation.edgeId) };
    case 'retype': {
      const old = document.edges.find((edge) => edge.id === mutation.edgeId);
      if (old === undefined) return document;
      return { ...document, edges: [...document.edges.filter((edge) => edge.id !== old.id), makeEdge(mutation.nextKind, old.from, old.to)] };
    }
    case 'flip': {
      const old = document.edges.find((edge) => edge.id === mutation.edgeId);
      if (old === undefined) return document;
      return { ...document, edges: [...document.edges.filter((edge) => edge.id !== old.id), makeEdge(old.kind, old.to, old.from)] };
    }
  }
}

/** One page, one store, one mount — rebuilt per test so nothing leaks between them. */
/** The harness deriver: document order, everything ready. */
export const flatDeriver: OrderDeriver = (document) =>
  document.issues.map((issue, rank) => ({ ref: issue.ref, rank, ready: true, holdReasons: [] }));

/**
 * A deriver whose order MOVES with the edges: an issue with an open blocker
 * sorts after every unblocked one and is held. The rank pin needs an order a
 * landed edge changes, or it could not tell a pending edge apart from one that
 * landed.
 */
export const blockingDeriver: OrderDeriver = (document) => {
  const blocked = new Set(document.edges.filter((edge) => edge.kind === 'blocked-by').map((edge) => edge.from));
  const byRef = (a: { ref: string }, b: { ref: string }): number => a.ref.localeCompare(b.ref);
  const free = document.issues.filter((issue) => !blocked.has(issue.ref)).sort(byRef);
  const held = document.issues.filter((issue) => blocked.has(issue.ref)).sort(byRef);
  return [...free, ...held].map((issue, rank) => ({
    ref: issue.ref,
    rank,
    ready: !blocked.has(issue.ref),
    holdReasons: blocked.has(issue.ref) ? ['blocked'] : [],
  }));
};

/** The harness projection plus every host fact, so the workspace has a header to draw once. */
export function hostedProject(snapshot: StoreSnapshot): WorkspaceProjection {
  const base = project(snapshot);
  return {
    ...base,
    viewer: {
      ...base.viewer,
      host: {
        concurrencyCap: 2,
        counts: { ranked: 4, readyNow: 4, held: 0 },
        running: [{ key: '2', phase: 'Review', elapsed: '12m' }],
        freshness: { asOf: '14:32', age: '2m ago', refresh: 'refresh' },
      },
    },
  };
}

/**
 * The harness projection with `2` folded into `1`'s slot — one together unit
 * with a non-lead member.
 *
 * A UNIT IS THE ONE SHAPE WHERE THE PANEL'S SUBJECT AND A KEY THE READER CAN
 * STAND ON DIVERGE WITHOUT A CLICK: `inspectorView` canonicalizes a selection
 * naming a member onto the slot's lead, so `R` on the member begins a draft
 * from a source the panel is not about.
 */
export function unitProject(snapshot: StoreSnapshot): WorkspaceProjection {
  const base = project(snapshot);
  const slots = base.viewer.order.slots
    .filter((slot) => slot.lead !== '2')
    .map((slot, index) => ({
      ...slot,
      rank: index + 1,
      members: slot.lead === '1' ? ['1', '2'] : slot.members,
    }));
  return { ...base, viewer: { ...base.viewer, order: { ...base.viewer.order, slots } } };
}

export async function mounted(
  seed: GraphDocument = SEED,
  options: {
    railCount?: number;
    derive?: OrderDeriver;
    /** Override the vocabulary. */
    words?: MountWords;
    project?: (snapshot: StoreSnapshot) => WorkspaceProjection;
    firstPass?: FirstPassOption;
    canvas?: CanvasMode;
    /**
     * Wrap the scripted source before the store sees it.
     *
     * The scripted adapter's `hydrate` always resolves, and a READ that fails
     * is a state the store models deliberately — so the only way to reach it is
     * to decorate the adapter. Injected here rather than grown onto
     * `createScriptedSource`, which is a published testing surface and should
     * not sprout a knob for one consumer's suite.
     */
    wrap?: (source: ReturnType<typeof createScriptedSource>) => DataSource;
    /** §17d's outward link is drawn only for a URL the host can name. */
    issueUrl?: (ref: string) => string | null;
    onSelectionChange?: (selection: WorkspaceSelection) => void;
  } = {},
) {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  const win = dom.window;
  const element = win.document.getElementById('host');
  assert.ok(element !== null);
  const source = createScriptedSource(seed, applyAny);
  const { derive = flatDeriver, project: projection = project, wrap, ...mountOptions } = options;
  const store = createStore({ source: wrap === undefined ? source : wrap(source), derive });
  await store.hydrate();
  const handle = mountWorkspace(element, { store, project: projection, words: WORDS, ...mountOptions });
  const click = (node: Element): void => {
    node.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  };
  const zone = (name: string): HTMLElement | null =>
    element.querySelector<HTMLElement>(`.ig-zone[data-zone="${name}"]`);
  const rows = (): HTMLElement[] => [...element.querySelectorAll<HTMLElement>('[data-zone="rail"] [data-ig-key][tabindex]')];
  const control = (command: string): HTMLElement | null =>
    element.querySelector<HTMLElement>(`[data-ig-command="${command}"]`);
  // §17d'S PANEL IS TRANSIENT NOW, so a test that wants to look at it has to
  // OPEN it first — which is the real path a reader takes, and a better fixture
  // than an option would have been. `RULINGS.md` §3 anchors it to the header
  // count, so this is that click.
  const openAudit = async (): Promise<void> => {
    const toggle = element.querySelector<HTMLElement>('.ig-audit-toggle');
    assert.ok(toggle !== null, 'no audit header to open the panel from');
    click(toggle);
    await flush();
  };
  return { dom, win, element, source, store, handle, click, zone, rows, control, openAudit };
}

export type Mounted = Awaited<ReturnType<typeof mounted>>;
