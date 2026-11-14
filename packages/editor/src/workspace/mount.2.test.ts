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
import { type OrderDeriver, createScriptedSource, createStore, makeEdge } from '@issuegraph/store';
import { JSDOM } from 'jsdom';

import { PICKER_WORDS } from '../testing/picker.ts';
import { WORKSPACE_WORDS } from '../testing/workspace.ts';
import { type MountWords, type WorkspaceProjection, mountWorkspace } from './mount.ts';

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

describe("more tests", function () {
it('decides the editor narrow rule from its root element box and never from the window width', async () => {
  const mountMeasured = async (rootWidth: number, windowWidth: number) => {
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
    const win = dom.window;
    // The window and the root box disagree, so only a mount that reads the window would get this wrong.
    for (const name of ['innerWidth', 'outerWidth']) Object.defineProperty(win, name, { value: windowWidth, configurable: true });
    const element = win.document.getElementById('host');
    assert.ok(element !== null);
    Object.defineProperty(element, 'getBoundingClientRect', {
      value: () => ({ x: 0, y: 0, top: 0, left: 0, right: rootWidth, bottom: 600, width: rootWidth, height: 600, toJSON: () => ({}) }),
      configurable: true,
    });
    const store = createStore({ source: createScriptedSource(SEED, applyAny), derive: flatDeriver });
    await store.hydrate();
    const calls: string[] = [];
    const handle = mountWorkspace(element, {
      store,
      project,
      words: WORDS,
      onSelectionChange: (selection) => calls.push(JSON.stringify(selection)),
    });
    await flush();
    const click = async (key: string, modifiers: { metaKey?: boolean } = {}): Promise<void> => {
      const target = [...element.querySelectorAll<HTMLElement>('[data-zone="rail"] [data-ig-key][tabindex]')].find(
        (row) => row.getAttribute('data-ig-key') === key,
      );
      assert.ok(target !== undefined, `no rail row is drawn for ${key}`);
      target.dispatchEvent(new win.MouseEvent('click', { bubbles: true, ...modifiers }));
      await flush();
    };
    return { handle, calls, click };
  };
  const issue = (key: string): string => JSON.stringify({ kind: 'issue', key });

  const wideRoot = await mountMeasured(800, 320);
  try {
    await wideRoot.click('1');
    await wideRoot.click('3', { metaKey: true });
    // The issue: "Neither reads the window."
    assert.deepEqual(
      wideRoot.handle.state.selection,
      { kind: 'issues', keys: ['1', '3'] },
      'a window 320 wide reduced a set in a root box 800 wide',
    );
  } finally {
    wideRoot.handle.destroy();
  }

  const narrowRoot = await mountMeasured(500, 1024);
  try {
    await narrowRoot.click('1');
    await narrowRoot.click('3', { metaKey: true });
    // The issue: "A box narrower than 640 reduces a multi-issue selection to its most recently added issue, on mount and on every resize, and an add there leaves one issue."
    assert.deepEqual(narrowRoot.handle.state.selection, { kind: 'issue', key: '3' }, 'a window 1024 wide kept a set in a root box 500 wide');
    assert.deepEqual(narrowRoot.calls, [issue('1'), issue('3')]);
  } finally {
    narrowRoot.handle.destroy();
  }
});
});
