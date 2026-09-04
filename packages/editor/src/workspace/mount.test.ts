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
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { GraphDocument, Mutation, StoreSnapshot } from '@issuegraph/store';
import { createScriptedSource, createStore, makeEdge } from '@issuegraph/store';
import { THEME_TOKENS } from '@issuegraph/viewer';
import { JSDOM } from 'jsdom';

import { PICKER_WORDS } from '../testing/picker.ts';
import { WORKSPACE_WORDS } from '../testing/workspace.ts';
import { mountStylesheet } from './chrome.ts';
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

/** One page, one store, one mount — rebuilt per test so nothing leaks between them. */
async function mounted(seed: GraphDocument = SEED, options: { railCount?: number } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  const win = dom.window;
  const element = win.document.getElementById('host');
  assert.ok(element !== null);
  const source = createScriptedSource(seed, applyAny);
  const store = createStore({
    source,
    derive: (document) =>
      document.issues.map((issue, rank) => ({ ref: issue.ref, rank, ready: true, holdReasons: [] })),
  });
  await store.hydrate();
  const handle = mountWorkspace(element, { store, project, words: WORDS, ...options });
  const click = (node: Element): void => {
    node.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  };
  const zone = (name: string): HTMLElement | null =>
    element.querySelector<HTMLElement>(`.ig-zone[data-zone="${name}"]`);
  const rows = (): HTMLElement[] => [...element.querySelectorAll<HTMLElement>('[data-zone="rail"] [data-ig-key][tabindex]')];
  const control = (command: string): HTMLElement | null =>
    element.querySelector<HTMLElement>(`[data-ig-command="${command}"]`);
  return { dom, win, element, source, store, handle, click, zone, rows, control };
}

type Mounted = Awaited<ReturnType<typeof mounted>>;

describe('mountWorkspace', () => {
  let page: Mounted;

  beforeEach(async () => {
    page = await mounted();
  });

  afterEach(() => {
    page.handle.destroy();
    page.dom.window.close();
  });

  describe('done when: it draws the workspace from the store’s snapshot', () => {
    it('draws the rail, the canvas, the inspector and the audit header', () => {
      for (const name of ['rail', 'canvas', 'inspector', 'header']) {
        assert.ok(page.zone(name) !== null, `no ${name} zone`);
      }
      assert.ok(page.element.querySelector('.ig-audit') !== null, 'no audit header');
      assert.deepEqual(
        page.rows().map((row) => row.getAttribute('data-ig-key')),
        ['1', '2', '3', '4'],
      );
    });

    it('installs every stylesheet the surface needs into the element, once', () => {
      const sheets = page.element.querySelectorAll('style');
      assert.equal(sheets.length, 1);
      const css = sheets[0]?.textContent ?? '';
      for (const marker of ['.ig-workspace {', '.ig-picker {', '.ig-chrome {', ':root {']) {
        assert.ok(css.includes(marker), `the sheet lacks ${marker}`);
      }
    });

    it('draws nothing selected, and says so in the host’s words', () => {
      assert.ok(page.zone('inspector')?.textContent?.includes(WORDS.nothingSelected));
      assert.equal(page.control('add'), null, 'no add control before a selection');
    });
  });

  describe('done when: a proposal through the store redraws with the edge pending and the order held', () => {
    it('marks the new edge pending-write on the canvas while the source has not answered', async () => {
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending();
      await flush();

      const pending = page.element.querySelector('[data-zone="canvas"] [data-ig-state="pending-write"]');
      assert.ok(pending !== null, 'the pending edge is not overlaid on the canvas');
      assert.equal(pending.getAttribute('data-ig-group'), makeEdge('blocked-by', '2', '3').id);
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-order'), 'held');

      page.source.settleNext('applied');
      await flush();
      assert.equal(page.element.querySelector('[data-ig-state="pending-write"]'), null, 'the dash outlives the write');
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-order'), 'settled');
    });

    it('draws one line per pair during a pending retype: the new identity dashed, the hidden old one gone', async () => {
      const old = makeEdge('blocked-by', '1', '2');
      const next = makeEdge('duplicate-of', '1', '2');
      void page.store.propose({ op: 'retype', edgeId: old.id, nextKind: 'duplicate-of' });
      await page.source.whenPending();
      await flush();

      const marks = [...page.element.querySelectorAll<HTMLElement>('[data-zone="canvas"] path.ig-edge')].map((path) => [
        path.getAttribute('data-ig-group'),
        path.getAttribute('data-ig-state'),
      ]);
      assert.deepEqual(marks, [[next.id, 'pending-write']]);
      assert.equal(page.element.querySelector(`[data-ig-group="${old.id}"]`), null, 'the store hid the old edge; the canvas must too');

      page.source.settleNext('applied');
      await flush();
      const settled = [...page.element.querySelectorAll<HTMLElement>('[data-zone="canvas"] path.ig-edge')].map((path) =>
        path.getAttribute('data-ig-group'),
      );
      assert.deepEqual(settled, [next.id]);
    });
  });

  describe('done when: destroy unsubscribes and empties the element', () => {
    it('removes what it built and stops redrawing on store changes', async () => {
      page.handle.destroy();
      assert.equal(page.element.childNodes.length, 0);

      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      assert.equal(page.element.childNodes.length, 0, 'a destroyed mount drew again');
      assert.deepEqual(page.handle.state.selection, { kind: 'none' });
    });

    it('is idempotent', () => {
      page.handle.destroy();
      page.handle.destroy();
      assert.equal(page.element.childNodes.length, 0);
    });
  });

  describe('the inspector path: select → add → kind → search → target, through the published controls', () => {
    it('reaches one proposal, which the store hands to the source', async () => {
      const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '2');
      assert.ok(row !== undefined);
      page.click(row);
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '2' });

      const add = page.control('add');
      assert.ok(add !== null, 'the add control is not drawn for a selected issue');
      assert.equal(add.textContent, WORDS.addRelationship);
      page.click(add);
      await flush();

      const kind = page.element.querySelector<HTMLElement>('[data-ig-command="kind"][data-ig-value="blocked-by"]');
      assert.ok(kind !== null, 'the kind chooser is not drawn');
      assert.equal(kind.textContent, `1 ${PICKER_WORDS.kinds['blocked-by']}`);
      page.click(kind);
      await flush();

      const search = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(search !== null, 'the target search is not drawn');
      assert.equal(search.getAttribute('aria-label'), WORDS.targetLabel);
      assert.equal(page.win.document.activeElement, search, 'focus did not move to the search');
      search.value = 'changelog';
      search.dispatchEvent(new page.win.Event('input', { bubbles: true }));
      await flush();

      const match = page.element.querySelector<HTMLElement>('[data-ig-command="target"][data-ig-target="3"]');
      assert.ok(match !== null, 'the search offers no match');
      page.click(match);

      const handed = await page.source.whenPending();
      // The store stamps its own id on what it hands over; the edit is the rest.
      const { mutationId, ...edit } = handed.mutation;
      assert.ok(mutationId !== '');
      assert.deepEqual(edit, { op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await flush();
      assert.equal(page.handle.state.draft.source, null, 'the draft is idle again');
    });

    it('cancel returns the draft to idle without proposing', async () => {
      const row = page.rows()[1];
      assert.ok(row !== undefined);
      page.click(row);
      await flush();
      page.click(page.control('add') ?? assert.fail('no add'));
      await flush();
      page.click(page.control('cancel') ?? assert.fail('no cancel'));
      await flush();
      assert.equal(page.handle.state.draft.source, null);
      assert.equal(page.source.pending().length, 0);
    });
  });

  describe('the keyboard path, through the package’s own key map', () => {
    it('R on a focused row begins a draft from that row and 1 types it', async () => {
      const row = page.rows()[2];
      assert.ok(row !== undefined);
      row.focus();
      assert.equal(page.win.document.activeElement, row);
      row.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      await flush();
      assert.equal(page.handle.state.draft.source, '3');

      const again = page.rows().find((each) => each.getAttribute('data-ig-key') === '3');
      assert.ok(again !== undefined);
      assert.equal(page.win.document.activeElement, again, 'focus did not survive the redraw');
      again.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: '1', bubbles: true }));
      await flush();
      assert.equal(page.handle.state.draft.kind, 'blocked-by');
      const search = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(search !== null);
      assert.equal(page.win.document.activeElement, search);
    });

    it('ArrowDown moves focus along the rail, through the viewer’s navigation', async () => {
      const first = page.rows()[0];
      assert.ok(first !== undefined);
      first.focus();
      first.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await flush();
      const active = page.win.document.activeElement;
      assert.equal(active?.getAttribute('data-ig-key'), '2');
      assert.equal(active?.getAttribute('tabindex'), '0', 'the roving tab stop did not move');
    });
  });

  describe('the rail window, re-cut from the keyboard at its edges', () => {
    const many: GraphDocument = {
      issues: Array.from({ length: 60 }, (_, index) => ({ ref: String(index + 1), title: `Issue ${String(index + 1)}`, state: 'open' as const })),
      edges: [],
    };

    it('ArrowDown on the last drawn row re-cuts the window and focuses the next row', async () => {
      page.handle.destroy();
      page = await mounted(many, { railCount: 50 });
      const rows = page.rows();
      assert.equal(rows.length, 50, 'the window is the railCount');
      const last = rows[rows.length - 1];
      assert.ok(last !== undefined);
      last.focus();
      last.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await flush();
      assert.equal(page.handle.state.railStart, 10, 'the window moved to its last start');
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), '51', 'focus followed onto the next row');
      assert.equal(page.rows()[0]?.getAttribute('data-ig-key'), '11');
    });

    it('End and Home jump the window to its ends, and ArrowUp on the first drawn row re-cuts upward', async () => {
      page.handle.destroy();
      page = await mounted(many, { railCount: 50 });
      const first = page.rows()[0];
      assert.ok(first !== undefined);
      first.focus();
      first.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      await flush();
      assert.equal(page.handle.state.railStart, 10);
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), '60');

      const top = page.rows()[0];
      assert.ok(top !== undefined && top.getAttribute('data-ig-key') === '11');
      top.focus();
      top.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await flush();
      assert.equal(page.handle.state.railStart, 0, 'ArrowUp at the first drawn row re-cut the window upward');
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), '10');

      const active = page.win.document.activeElement;
      assert.ok(active !== null);
      active.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      await flush();
      assert.equal(page.handle.state.railStart, 10);
      page.win.document.activeElement?.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      await flush();
      assert.equal(page.handle.state.railStart, 0);
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), '1');
    });
  });

  describe('a small rail window still advances from the keyboard', () => {
    it('ArrowDown on the last row of a 21-row window reaches the next row', async () => {
      const many: GraphDocument = {
        issues: Array.from({ length: 60 }, (_, index) => ({ ref: String(index + 1), title: `Issue ${String(index + 1)}`, state: 'open' as const })),
        edges: [],
      };
      page.handle.destroy();
      page = await mounted(many, { railCount: 21 });
      const last = page.rows()[page.rows().length - 1];
      assert.ok(last !== undefined && last.getAttribute('data-ig-key') === '21');
      last.focus();
      last.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await flush();
      assert.ok(page.handle.state.railStart > 0, 'the window did not move');
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), '22');
    });
  });

  describe('the tree canvas carries the same overlays as the ladder', () => {
    it('marks a pending edge and the selected edge on their badges', async () => {
      page.handle.update({ canvas: 'tree' });
      await flush();
      const edge = makeEdge('blocked-by', '1', '2');
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending();
      await flush();
      const pending = page.element.querySelector(`[data-zone="canvas"] .ig-tree [data-ig-group="${makeEdge('blocked-by', '2', '3').id}"]`);
      assert.ok(pending !== null, 'the tree draws no badge for the pending edge');
      assert.equal(pending.getAttribute('data-ig-state'), 'pending-write');

      page.handle.dispatch({ kind: 'group', id: edge.id });
      await flush();
      const selected = page.element.querySelector(`[data-zone="canvas"] .ig-tree [data-ig-group="${edge.id}"]`);
      assert.ok(selected !== null);
      assert.equal(selected.getAttribute('data-ig-state'), 'selected');
    });
  });

  describe('the canvas path: drag a node onto another, then choose the kind at the drop point', () => {
    it('reaches the same proposal as the inspector path', async () => {
      // RE-QUERIED ON EVERY STEP: the drag-start dispatch redraws the canvas, so
      // a node held from before it is detached and an event on it reaches nothing.
      const nodeOf = (key: string): Element => {
        const canvas = page.zone('canvas');
        assert.ok(canvas !== null);
        const found = [...canvas.querySelectorAll('[data-ig-key]')].find((node) => node.getAttribute('data-ig-key') === key);
        assert.ok(found !== undefined, `no canvas node for ${key}`);
        return found;
      };
      // jsdom has no hit testing, so the drop resolves through a stubbed `elementFromPoint`.
      // ONLY CONNECTED ISSUES ARE ON THE GRAPH CANVAS — the seed's #1 and #2.
      Object.defineProperty(page.win.document, 'elementFromPoint', { value: () => nodeOf('1'), configurable: true });
      const pointer = (type: string, node: Element, x: number, y: number): void => {
        node.dispatchEvent(new page.win.PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y }));
      };
      pointer('pointerdown', nodeOf('2'), 10, 10);
      pointer('pointermove', nodeOf('2'), 12, 12);
      await flush();
      assert.equal(page.handle.state.drag, null, 'a move under the threshold is not a drag');
      pointer('pointermove', nodeOf('2'), 40, 40);
      await flush();
      assert.equal(page.handle.state.drag, '2');
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-dragging'), 'true');
      pointer('pointerup', nodeOf('1'), 40, 40);
      await flush();
      assert.equal(page.handle.state.drag, null);
      assert.equal(page.handle.state.draft.source, '2');
      assert.equal(page.handle.state.draft.target, '1');
      assert.deepEqual(page.handle.state.drop, { x: 40, y: 40 });
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-dragging'), null);

      const floating = page.element.querySelector<HTMLElement>('.ig-workspace > .ig-chrome-floating');
      assert.ok(floating !== null, 'the kind chooser was not placed inside the workspace root');
      const kind = floating.querySelector<HTMLElement>('[data-ig-command="kind"][data-ig-value="blocked-by"]');
      assert.ok(kind !== null);
      page.click(kind);
      const handed = await page.source.whenPending();
      const { mutationId, ...edit } = handed.mutation;
      assert.ok(mutationId !== '');
      assert.deepEqual(edit, { op: 'create', kind: 'blocked-by', from: '2', to: '1' });
    });

    it('ignores a second pointer while one is pressed, and a non-primary press', async () => {
      const canvas = page.zone('canvas');
      assert.ok(canvas !== null);
      const node = [...canvas.querySelectorAll('[data-ig-key]')].find((each) => each.getAttribute('data-ig-key') === '2');
      assert.ok(node !== undefined);
      node.dispatchEvent(new page.win.PointerEvent('pointerdown', { bubbles: true, pointerId: 7, isPrimary: false, button: 0, clientX: 0, clientY: 0 }));
      node.dispatchEvent(new page.win.PointerEvent('pointermove', { bubbles: true, pointerId: 7, isPrimary: false, button: 0, clientX: 50, clientY: 50 }));
      await flush();
      assert.equal(page.handle.state.drag, null, 'a non-primary pointer never starts a drag');
      node.dispatchEvent(new page.win.PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true, button: 2, clientX: 0, clientY: 0 }));
      node.dispatchEvent(new page.win.PointerEvent('pointermove', { bubbles: true, pointerId: 1, isPrimary: true, button: 2, clientX: 50, clientY: 50 }));
      await flush();
      assert.equal(page.handle.state.drag, null, 'a secondary button never starts a drag');
    });
  });

  describe('a selected edge', () => {
    it('draws the picker and the delete control, and delete proposes', async () => {
      const edge = makeEdge('blocked-by', '1', '2');
      const mark = page.element.querySelector<HTMLElement>(`[data-ig-group="${edge.id}"]`);
      assert.ok(mark !== null, 'the canvas draws no mark for the seeded edge');
      page.click(mark);
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'edge', edgeId: edge.id });
      assert.ok(page.element.querySelector('.ig-chrome-picker .ig-picker') !== null, 'no picker');

      page.click(page.control('delete') ?? assert.fail('no delete control'));
      const handed = await page.source.whenPending();
      const { mutationId, ...edit } = handed.mutation;
      assert.ok(mutationId !== '');
      assert.deepEqual(edit, { op: 'delete', edgeId: edge.id });
    });
  });

  describe('the one selection is the workspace’s, not the store’s', () => {
    it('draws no halo for an edge the host selected on the store, and one halo for the workspace’s own', async () => {
      const edge = makeEdge('blocked-by', '1', '2');
      page.store.select([edge.id]);
      await flush();
      assert.equal(page.element.querySelector('[data-zone="canvas"] [data-ig-state]'), null, 'a store selection drew a halo');
      assert.deepEqual(page.handle.state.selection, { kind: 'none' });

      const mark = page.element.querySelector<HTMLElement>(`[data-ig-group="${edge.id}"]`);
      assert.ok(mark !== null);
      page.click(mark);
      await flush();
      const halos = [...page.element.querySelectorAll('[data-zone="canvas"] path.ig-edge[data-ig-state]')].map((path) =>
        path.getAttribute('data-ig-state'),
      );
      assert.deepEqual(halos, ['selected']);
    });
  });

  describe('the handle', () => {
    it('dispatch hands the reducer a command from the host’s own chrome', async () => {
      page.handle.dispatch({ kind: 'point', key: '4' });
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '4' });
      assert.ok(page.control('add') !== null);
    });

    it('update redraws in place with new options and keeps the selection', async () => {
      page.handle.dispatch({ kind: 'point', key: '2' });
      await flush();
      page.handle.update({ canvas: 'tree' });
      await flush();
      assert.ok(page.element.querySelector('[data-zone="canvas"] .ig-tree') !== null, 'the tree was not drawn');
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '2' });
      assert.ok(page.control('add') !== null);
    });

    it('update with no argument is a plain redraw', async () => {
      page.handle.update();
      await flush();
      assert.equal(page.rows().length, 4);
    });

    it('keeps the caret where the reader left it across an unrelated redraw', async () => {
      page.handle.dispatch({ kind: 'point', key: '2' });
      await flush();
      page.click(page.control('add') ?? assert.fail('no add'));
      await flush();
      page.click(page.element.querySelector('[data-ig-command="kind"][data-ig-value="blocked-by"]') ?? assert.fail('no kind'));
      await flush();
      const search = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(search !== null);
      search.value = 'change';
      search.dispatchEvent(new page.win.Event('input', { bubbles: true }));
      await flush();
      const typed = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(typed !== null);
      typed.setSelectionRange(1, 3);
      page.handle.update();
      await flush();
      const again = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(again !== null);
      assert.equal(page.win.document.activeElement, again);
      assert.equal(again.selectionStart, 1);
      assert.equal(again.selectionEnd, 3);
    });

    it('does not steal focus back into an open search when the reader is elsewhere', async () => {
      page.handle.dispatch({ kind: 'point', key: '2' });
      await flush();
      page.click(page.control('add') ?? assert.fail('no add'));
      await flush();
      page.click(page.element.querySelector('[data-ig-command="kind"][data-ig-value="blocked-by"]') ?? assert.fail('no kind'));
      await flush();
      assert.ok(page.element.querySelector('input[data-ig-command="target-query"]') !== null);
      const outside = page.win.document.createElement('button');
      page.win.document.body.append(outside);
      outside.focus();
      assert.equal(page.win.document.activeElement, outside);
      page.handle.update();
      await flush();
      assert.equal(page.win.document.activeElement, outside, 'a redraw while the search stands open yanked focus');
    });
  });

  describe('a first render that throws', () => {
    it('leaves the element empty and the store unsubscribed', async () => {
      page.handle.destroy();
      const element = page.win.document.createElement('div');
      page.win.document.body.append(element);
      let calls = 0;
      assert.throws(
        () =>
          mountWorkspace(element, {
            store: page.store,
            words: WORDS,
            project: () => {
              calls += 1;
              throw new Error('a host projection that cannot run');
            },
          }),
        /cannot run/,
      );
      assert.equal(element.childNodes.length, 0);
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      assert.equal(calls, 1, 'a failed mount kept its store subscription');
      assert.equal(element.childNodes.length, 0);
    });
  });
});

describe('the mount stylesheet carries structure, never a value', () => {
  const css = mountStylesheet.replace(/\/\*[\s\S]*?\*\//g, '');

  it('references only theme tokens', () => {
    const referenced = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] ?? '');
    assert.ok(referenced.length > 0);
    assert.deepEqual(referenced.filter((token) => !THEME_TOKENS.includes(token)), []);
  });

  it('writes no literal colour and no fixed length', () => {
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'a literal colour');
    assert.equal(/\brgba?\(/.test(css), false, 'a literal colour function');
    assert.equal(/\b\d+(\.\d+)?(px|rem|em|pt)\b/.test(css), false, 'a fixed length');
  });

  it('declares no animation and no transition', () => {
    assert.equal(/\banimation\b|\btransition\b|@keyframes/.test(css), false);
  });
});
