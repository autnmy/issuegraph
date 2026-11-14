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
it('reads no window size while the editor narrows a live set on resize', async () => {
  // The issue: "The editor mount measures its own root box, as `inspectorIsLifted` in packages/editor/src/workspace/mount.ts measures its zones, and watches resizes with a `ResizeObserver`, as `railResize` there does."
  // The issue: "Neither reads the window."
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  const win = dom.window;
  const element = win.document.getElementById('host');
  assert.ok(element !== null);
  let box = { width: 800, height: 300 };
  const original = win.HTMLElement.prototype.getBoundingClientRect;
  win.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    if (this.id !== 'host') return original.call(this);
    const { width, height } = box;
    return { x: 0, y: 0, top: 0, left: 0, width, height, right: width, bottom: height, toJSON: () => ({ width, height }) };
  };
  const resizeCallbacks: (() => void)[] = [];
  class FakeObserver {
    constructor(callback: () => void) {
      resizeCallbacks.push(callback);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(win, 'ResizeObserver', { value: FakeObserver, configurable: true });
  // Every window member a width check could reach records its read, so a mount that sized itself from the page instead of its root element is caught.
  const reads: string[] = [];
  for (const name of ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'matchMedia', 'visualViewport', 'screen', 'devicePixelRatio']) {
    Object.defineProperty(win, name, {
      configurable: true,
      get: () => {
        reads.push(name);
        return undefined;
      },
    });
  }
  const store = createStore({ source: createScriptedSource(SEED, applyAny), derive: flatDeriver });
  await store.hydrate();
  const calls: string[] = [];
  const handle = mountWorkspace(element, { store, project, words: WORDS, onSelectionChange: (selection) => calls.push(JSON.stringify(selection)) });
  try {
    await flush();
    const row = (key: string): HTMLElement => {
      const found = element.querySelector<HTMLElement>(`[data-zone="rail"] [data-ig-key="${key}"][tabindex]`);
      assert.ok(found !== null, `no rail row is drawn for ${key}`);
      return found;
    };
    row('1').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await flush();
    row('3').dispatchEvent(new win.MouseEvent('click', { bubbles: true, metaKey: true }));
    await flush();
    assert.deepEqual(handle.state.selection, { kind: 'issues', keys: ['1', '3'] }, 'a wide box kept the set');
    box = { width: 500, height: 300 };
    for (const callback of resizeCallbacks) callback();
    await flush();
    assert.deepEqual(handle.state.selection, { kind: 'issue', key: '3' }, 'the shrink did not reduce the set to its last-added issue');
    assert.equal(calls.at(-1), JSON.stringify({ kind: 'issue', key: '3' }));
    assert.deepEqual(reads, [], 'the editor read the window size');
  } finally {
    handle.destroy();
    dom.window.close();
  }
});
});
