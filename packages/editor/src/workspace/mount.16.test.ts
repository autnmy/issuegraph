/**
 * The mount, driven through a real DOM.
 *
 * jsdom rather than the viewer's element double, because this shell reads what
 * a double would have to re-implement — `innerHTML`, `closest`, `querySelector`,
 * `activeElement`, `focus` — and a second DOM written for the test is a second
 * place the shell can be wrong about the first. The reducer beneath is driven
 * with no DOM at all in `host.test.ts`; what is proven here is the wiring.
 *
 * Every test goes through the PUBLIC entry point with a real store, so the
 * criterion — a typed host mounts the workspace and edits through it — is what
 * a consumer gets rather than what an internal happens to do.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GraphDocument, Mutation, StoreSnapshot } from '@issuegraph/store';
import type { DataSource } from '@issuegraph/store';
import { type OrderDeriver, createScriptedSource, createStore, makeEdge } from '@issuegraph/store';
import { JSDOM } from 'jsdom';

import { PICKER_WORDS } from '../testing/picker.ts';
import { WORKSPACE_WORDS } from '../testing/workspace.ts';
import type { WorkspaceSelection } from './selection.ts';
import {
  type CanvasMode,
  type FirstPassOption,
  type MountWords,
  type WorkspaceProjection,
  mountWorkspace,
} from './mount.ts';

const WORDS: MountWords = {
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

const SEED: GraphDocument = {
  issues: [
    { ref: '1', title: 'Publish the first release', state: 'open', priority: 0 },
    { ref: '2', title: 'Write the release notes', state: 'open', priority: 3 },
    { ref: '3', title: 'Cut the changelog', state: 'open', priority: 3 },
    { ref: '4', title: 'Rename the config flag', state: 'open' },
  ],
  edges: [makeEdge('blocked-by', '1', '2')],
};

/** The happy-path edit semantics, for the scripted source to apply on `applied`. */
function apply(document: GraphDocument, mutation: Mutation): GraphDocument {
  if (mutation.op !== 'create') return document;
  return { ...document, edges: [...document.edges, makeEdge(mutation.kind, mutation.from, mutation.to)] };
}

/** A host's projection: the order as the deriver ranked it, and an audit over the landed document. */
function project(snapshot: StoreSnapshot): WorkspaceProjection {
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
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The happy-path semantics for every op, so a retype can be driven end to end. */
function applyAny(document: GraphDocument, mutation: Mutation): GraphDocument {
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

/** The harness deriver: document order, everything ready. */
const flatDeriver: OrderDeriver = (document) =>
  document.issues.map((issue, rank) => ({ ref: issue.ref, rank, ready: true, holdReasons: [] }));

/** One page, one store, one mount — rebuilt per test so nothing leaks between them. */
async function mounted(
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

describe("more tests", function () {
it('a failed read on one conflict redo is drawn on that write log card only', async () => {
  let readFails = false;
  const page = await mounted(SEED, {
    wrap: (source) => ({
      ...source,
      hydrate: () =>
        readFails ? Promise.reject(new Error('the tracker did not answer')) : source.hydrate(),
    }),
  });
  try {
    const upstream = { issues: SEED.issues, edges: [...SEED.edges, makeEdge('blocked-by', '2', '3')] };
    const first = page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
    await page.source.whenPending(first.mutationId);
    page.source.settleNext({ outcome: 'conflict', upstream });
    await first.settled;
    const second = page.store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '2' });
    await page.source.whenPending(second.mutationId);
    page.source.settleNext({ outcome: 'conflict', upstream });
    await second.settled;
    await flush();

    readFails = true;
    page.handle.dispatch({ kind: 'control', name: 'retry', target: first.mutationId });
    await flush();
    await flush();
    assert.equal(
      page.store.getSnapshot().writes.filter((record) => record.state === 'conflict').length,
      2,
      'two standing conflicts are needed for "only that card" to mean anything',
    );

    const header = page.zone('header');
    assert.ok(header !== null, 'no header zone');
    // The issue: "A write someone else got to first stays in the log with the attention note and its actions (Compare, "Redo on the latest version", "Discard my edit")."
    const errors = [...header.querySelectorAll('.ig-recovery-refresh-error')];
    assert.equal(errors.length, 1, 'the read failure was drawn on the wrong number of log cards');
    assert.match(errors[0]?.textContent ?? '', /the tracker did not answer/);
    assert.equal(
      errors[0]?.closest('.ig-recovery')?.querySelector('[data-ig-command="retry"]')?.getAttribute('data-ig-target'),
      first.mutationId,
      'the read failure was blamed on a write whose redo nobody pressed',
    );
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});
});
