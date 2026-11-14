/**
 * The mount, driven through a real DOM: the first read, the narrow tabs, the
 * selection set and tree mode.
 *
 * Split from `mount.test.ts`, whose header says why jsdom and why every test
 * goes through the public entry point. The editor suite gives each file 20 s
 * (`--test-timeout=20000` under the glob runner), and one file holding every
 * mount test had grown to that line on node 22 (#297).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GraphDocument, StoreSnapshot, DataSource } from '@issuegraph/store';
import { createScriptedSource, createStore, makeEdge } from '@issuegraph/store';
import { JSDOM } from 'jsdom';

import { RELATE_KEY } from '../create/keys.ts';
import { keysOf, relatedHubEdges } from '../testing/workspace.ts';
import { type CanvasMode, type WorkspaceProjection, mountWorkspace } from './mount.ts';
import { WORDS, SEED, project, flush, applyAny, flatDeriver, mounted, type Mounted } from '../testing/mount.ts';

describe('the first read draws a placeholder, never an empty backlog', () => {
  it('holds the three zones while the store is hydrating, then draws the document', async () => {
    // THE DEFECT: the mount never read the store's hydration status, so a
    // workspace mounted before its data arrived rendered the store's empty
    // document — no rows, "no relationships yet" — about a backlog nobody had
    // read. A host could only avoid that by not mounting, and then drew its own
    // guess at this layout.
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
    const element = dom.window.document.getElementById('host');
    assert.ok(element !== null);
    const source = createScriptedSource(SEED, applyAny);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: DataSource = { ...source, hydrate: async () => { await gate; return source.hydrate(); } };
    const store = createStore({ source: slow, derive: flatDeriver });
    const loading = store.hydrate();
    const handle = mountWorkspace(element, {
      store,
      project,
      words: { ...WORDS, loading: 'Loading your issues' },
    });
    await flush();

    const surface = element.querySelector('.ig-workspace');
    assert.equal(surface?.getAttribute('data-ig-loading'), 'true', 'no placeholder while the read is in flight');
    assert.equal(surface?.getAttribute('aria-busy'), 'true');
    assert.equal(surface?.getAttribute('aria-label'), 'Loading your issues', 'the host word is not the region name');
    assert.deepEqual(
      [...element.querySelectorAll('.ig-zone')].map((zone) => zone.getAttribute('data-zone')),
      ['header', 'rail', 'canvas', 'inspector'],
      'the placeholder does not hold the real zones',
    );
    assert.equal(element.querySelectorAll('[data-ig-key]').length, 0, 'a placeholder drew issue rows');
    assert.ok(element.querySelectorAll('.ig-skeleton-block').length > 0);

    release();
    await loading;
    await flush();
    assert.equal(element.querySelector('[data-ig-loading]'), null, 'the placeholder outlived the read');
    assert.ok(element.querySelectorAll('[data-zone="rail"] [data-ig-key]').length > 0, 'the document never drew');
    handle.destroy();
  });

  it('never shows the placeholder for a store nobody asked to load', async () => {
    // `idle` is not loading. A host that fills its store another way, or a test
    // that never hydrates, must get the surface it has — not a spinner forever.
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
    const element = dom.window.document.getElementById('host');
    assert.ok(element !== null);
    const store = createStore({ source: createScriptedSource(SEED, applyAny), derive: flatDeriver });
    const handle = mountWorkspace(element, { store, project, words: WORDS });
    await flush();
    assert.equal(element.querySelector('[data-ig-loading]'), null);
    handle.destroy();
  });
});

/**
 * The layout under 640's tabs and its Related groups list, mounted.
 *
 * The reducer's half is driven in `host.test.ts`, and the list's rules in
 * `related.test.ts`. What only the shell can get wrong is proven here: that the
 * canvas mode is read from the host state after the mount seeds it, that the
 * rail offset comes back from the scroll handler rather than from a hidden rail,
 * and that a reader can reach a relationship the first draw did not hold.
 */
describe('the narrow tabs and the Related groups list, mounted', () => {
  const narrowTab = (page: Mounted, value: string): HTMLElement =>
    page.element.querySelector<HTMLElement>(`[data-ig-command="narrow-tab"][data-ig-value="${value}"]`) ??
    assert.fail(`no ${value} tab`);
  const treeOf = (page: Mounted): Element | null => page.element.querySelector('[data-zone="canvas"] .ig-tree');
  const dataTabOf = (page: Mounted): string | null =>
    page.element.querySelector('.ig-workspace')?.getAttribute('data-tab') ?? null;

  /** `count` relationships on `i0001`, as a store seed, for the list's limits. */
  function relatedHubSeed(count: number): GraphDocument {
    return {
      issues: keysOf(count + 1).map((ref) => ({ ref, title: `Issue ${ref}`, state: 'open' as const })),
      edges: relatedHubEdges(count).map(([field, from, to]) => makeEdge(field, from, to)),
    };
  }

  it('R1 R2 mountWorkspace: the middle zone switch draws the tree, keeps itself over it, and moves the narrow tab with it', async () => {
    const page = await mounted(SEED, {});
    try {
      const option = (value: string): HTMLElement =>
        page.element.querySelector<HTMLElement>(`[data-zone="canvas"] .ig-canvas-switch [data-ig-value="${value}"]`) ??
        assert.fail(`the middle zone switch has no ${value} option`);
      assert.equal(option('related').getAttribute('aria-pressed'), 'true');

      page.click(option('sub-issues'));
      await flush();
      assert.equal(page.handle.state.canvas, 'tree');
      assert.ok(treeOf(page) !== null, 'the switch did not draw the tree');
      // THE SWITCH SURVIVES THE TREE SWAP, or there would be no way back from it.
      assert.equal(option('sub-issues').getAttribute('aria-pressed'), 'true');
      assert.equal(option('related').getAttribute('aria-pressed'), 'false');
      // ONE STATE, TWO CONTROLS: the narrow tab reads the same canvas mode.
      assert.equal(narrowTab(page, 'sub-issues').getAttribute('aria-selected'), 'true');

      page.click(option('related'));
      await flush();
      assert.equal(page.handle.state.canvas, 'neighbourhood');
      assert.equal(treeOf(page), null, 'the switch did not take the tree back down');

      page.handle.update({ canvas: 'tree' });
      await flush();
      assert.equal(option('sub-issues').getAttribute('aria-pressed'), 'true', "a host's update({ canvas }) did not move the switch");
    } finally {
      page.handle.destroy();
    }
  });

  it('R7 mountWorkspace: a Sub-issues press stays in handle.state.canvas through update() calls that do not name canvas', async () => {
    // "The mount's `canvas` option seeds the field, and an `update()` that names `canvas` sets it."
    // Only an update naming `canvas` may set it. With the mode named in the mount options, an
    // update() that merged options and re-seeded from them would undo the tab press, so both seeds run.
    const seeds: readonly { readonly seed: string; readonly options: { readonly canvas?: CanvasMode } }[] = [
      { seed: 'an omitted seed', options: {} },
      { seed: 'an explicit neighbourhood seed', options: { canvas: 'neighbourhood' } },
    ];
    const updates: readonly { readonly update: string; readonly run: (page: Mounted) => void }[] = [
      { update: 'a bare update()', run: (page) => page.handle.update() },
      { update: 'update({})', run: (page) => page.handle.update({}) },
      { update: 'an update naming only the words', run: (page) => page.handle.update({ words: WORDS }) },
      { update: 'an update naming only firstPass', run: (page) => page.handle.update({ firstPass: undefined }) },
    ];
    for (const { seed, options } of seeds) {
      const page = await mounted(SEED, options);
      try {
        assert.equal(page.handle.state.canvas, 'neighbourhood', seed);
        assert.equal(treeOf(page), null, `${seed} already draws the tree, so this proves nothing`);

        page.click(narrowTab(page, 'sub-issues'));
        await flush();
        assert.equal(page.handle.state.canvas, 'tree', seed);
        assert.equal(page.handle.state.narrowView, 'canvas', seed);
        assert.ok(treeOf(page) !== null, `${seed}: the Sub-issues tab did not draw the tree`);
        assert.equal(dataTabOf(page), 'sub-issues', seed);

        for (const { update, run } of updates) {
          run(page);
          await flush();
          assert.equal(page.handle.state.canvas, 'tree', `${seed}: ${update} re-seeded the mode from the mount options`);
          assert.ok(treeOf(page) !== null, `${seed}: ${update} drew the neighbourhood again`);
          assert.equal(dataTabOf(page), 'sub-issues', `${seed}: ${update} moved the tab`);
        }

        page.handle.update({ canvas: 'neighbourhood' });
        await flush();
        assert.equal(page.handle.state.canvas, 'neighbourhood', `${seed}: an update naming canvas did not set it`);
        assert.equal(treeOf(page), null, `${seed}: update({ canvas }) left the tree drawn`);
        page.handle.destroy();
      } finally {
        page.dom.window.close();
      }
    }
  });

  it('R7 KTD1 mountWorkspace: after the Sub-issues press the keyboard walks the tree scene, onto a node only the tree draws', async () => {
    // The keyboard rebuilds the canvas scene from the mode, so a mode read from the mount
    // options instead of the host state would walk the neighbourhood the reader left.
    const page = await mounted(SEED);
    try {
      const canvasNode = (key: string): HTMLElement | null =>
        page.zone('canvas')?.querySelector<HTMLElement>(`[data-ig-key="${key}"][tabindex]`) ?? null;
      assert.ok(canvasNode('2') !== null, 'the neighbourhood does not draw 2, so there is nothing to compare');
      assert.equal(canvasNode('3'), null, 'the neighbourhood draws 3, so reaching it proves nothing');

      page.click(narrowTab(page, 'sub-issues'));
      await flush();
      assert.ok(treeOf(page) !== null, 'the Sub-issues tab did not draw the tree');
      const from = canvasNode('2') ?? assert.fail('the tree draws no focusable node for 2');
      from.focus();
      from.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      await flush();

      // "after that switch, keyboard navigation walks the tree scene"
      const active = page.win.document.activeElement;
      assert.equal(active?.getAttribute('data-ig-key'), '3', 'ArrowDown did not walk the tree scene');
      assert.ok(active?.closest('.ig-tree') != null, 'focus left the tree');
      page.handle.destroy();
    } finally {
      page.dom.window.close();
    }
  });

  it('R7 the canvas mount option seeds state.canvas and an update naming canvas sets it and moves the tab with it', async () => {
    const page = await mounted(SEED, { canvas: 'tree' });
    try {
      // The issue: "The mount's `canvas` option seeds the field, and an `update()` that names `canvas` sets it."
      assert.equal(page.handle.state.canvas, 'tree');
      assert.ok(treeOf(page) !== null, 'the seeded tree was not drawn');
      assert.equal(dataTabOf(page), 'order');

      page.handle.update();
      await flush();
      assert.equal(page.handle.state.canvas, 'tree', 'a bare update() dropped the seeded mode');

      page.click(narrowTab(page, 'sub-issues'));
      await flush();
      assert.equal(dataTabOf(page), 'sub-issues');

      page.handle.update({ canvas: 'neighbourhood' });
      await flush();
      assert.equal(page.handle.state.canvas, 'neighbourhood');
      assert.equal(treeOf(page), null, 'the update naming the neighbourhood left the tree drawn');
      // The tab is read from the view and the mode, so it cannot keep saying
      // Sub-issues over the neighbourhood.
      assert.equal(dataTabOf(page), 'related');
      page.handle.destroy();
    } finally {
      page.dom.window.close();
    }
  });

  it('R15 R16 KTD9 mountWorkspace: the rail comes back at the offset its scroll handler last saw, not at a hidden rail\'s zero', async () => {
    const page = await mounted(SEED);
    try {
      const rail = (): HTMLElement => page.zone('rail') ?? assert.fail('no rail zone');
      const before = rail();
      const railStart = page.handle.state.railStart;
      before.scrollTop = 120;
      assert.equal(before.scrollTop, 120, 'the fixture cannot hold an offset, so this proves nothing');
      before.dispatchEvent(new page.win.Event('scroll'));
      await flush();
      // A rail the stylesheet hides reports 0 in a browser. jsdom keeps the value, so the test writes the 0 itself, with no scroll event.
      rail().scrollTop = 0;

      // "The mount restores the rail offset its scroll handler last saw, never a hidden zone's."
      page.click(narrowTab(page, 'related'));
      await flush();
      page.click(narrowTab(page, 'order'));
      await flush();
      const switched = rail();
      assert.notEqual(switched, before, 'no redraw happened, so this test would prove nothing');
      assert.equal(switched.scrollTop, 120, 'the tab switch restored the hidden rail\'s offset, not the scroll handler\'s');
      assert.equal(page.handle.state.railStart, railStart, 'a tab press moved the rail window');

      // "The reader's place in the order survives a tab switch and a redraw"
      // The tabs are pressed through the host's `dispatch` from here on, the other route to them.
      page.handle.dispatch({ kind: 'control', name: 'narrow-tab', value: 'related' });
      await flush();
      const hidden = rail();
      hidden.scrollTop = 0;
      page.handle.update();
      await flush();
      const redrawn = rail();
      assert.notEqual(redrawn, hidden, 'no redraw happened, so this test would prove nothing');
      assert.equal(redrawn.scrollTop, 120, 'a redraw while Related groups shows lost the reader\'s place in the order');

      redrawn.scrollTop = 0;
      page.handle.dispatch({ kind: 'control', name: 'narrow-tab', value: 'order' });
      await flush();
      const back = rail();
      assert.notEqual(back, redrawn, 'the tab switch did not rebuild the rail, so this proves nothing');
      assert.equal(back.scrollTop, 120, 'the way back to the order lost the reader\'s place');
      assert.equal(page.handle.state.railStart, railStart, 'the redraw moved the rail window');
      page.handle.destroy();
    } finally {
      page.dom.window.close();
    }
  });

  it('R14 a mounted reader opens a group and selects the 61st relationship, which was not drawn before', async () => {
    const last = makeEdge('blocked-by', 'i0001', 'i0062');
    const hub = await mounted(relatedHubSeed(61));
    try {
      const canvas = (): HTMLElement => hub.zone('canvas') ?? assert.fail('no canvas zone');
      const row = `[data-ig-command="select-edge"][data-ig-target="${last.id}"]`;
      hub.click(hub.rows().find((each) => each.getAttribute('data-ig-key') === 'i0001') ?? assert.fail('no rail row for i0001'));
      await flush();
      hub.click(narrowTab(hub, 'related'));
      await flush();
      // "Test opening a relationship past the first 60, and finding one past 300 by search."
      assert.equal(canvas().querySelector(row), null, 'the 61st relationship was drawn before its group opened');
      hub.click(
        canvas().querySelector('[data-ig-command="related-group"][data-ig-value="blocked-by"]') ??
          assert.fail('no blocked-by group control'),
      );
      await flush();
      hub.click(canvas().querySelector(row) ?? assert.fail('the open group does not draw the 61st relationship'));
      await flush();
      assert.deepEqual(hub.handle.state.selection, { kind: 'edge', edgeId: last.id });
    } finally {
      hub.handle.destroy();
      hub.dom.window.close();
    }
  });

  it('R14 a mounted reader finds the 301st relationship by typing its key into the search and selects it', async () => {
    const last = makeEdge('blocked-by', 'i0001', 'i0302');
    const hub = await mounted(relatedHubSeed(301));
    try {
      const canvas = (): HTMLElement => hub.zone('canvas') ?? assert.fail('no canvas zone');
      const row = `[data-ig-command="select-edge"][data-ig-target="${last.id}"]`;
      hub.click(hub.rows().find((each) => each.getAttribute('data-ig-key') === 'i0001') ?? assert.fail('no rail row for i0001'));
      await flush();
      hub.click(narrowTab(hub, 'related'));
      await flush();
      // "Test opening a relationship past the first 60, and finding one past 300 by search."
      assert.equal(canvas().querySelector(row), null, 'the 301st relationship was drawn before any search');
      const search =
        canvas().querySelector<HTMLInputElement>('input[data-ig-command="related-query"]') ??
        assert.fail('no search over 301 relationships');
      search.value = 'i0302';
      search.dispatchEvent(new hub.win.Event('input', { bubbles: true }));
      await flush();
      hub.click(canvas().querySelector(row) ?? assert.fail('the search does not draw the 301st relationship'));
      await flush();
      assert.deepEqual(hub.handle.state.selection, { kind: 'edge', edgeId: last.id });
    } finally {
      hub.handle.destroy();
      hub.dom.window.close();
    }
  });

  it('keeps the Related search status line across typing, so only its text changes and is announced', async () => {
    const hub = await mounted(relatedHubSeed(301));
    try {
      const canvas = (): HTMLElement => hub.zone('canvas') ?? assert.fail('no canvas zone');
      const status = (): HTMLElement | null => canvas().querySelector<HTMLElement>('.ig-related-status[role="status"]');
      const type = async (value: string): Promise<void> => {
        const field = canvas().querySelector<HTMLInputElement>('input[data-ig-command="related-query"]') ?? assert.fail('no search');
        field.value = value;
        field.dispatchEvent(new hub.win.Event('input', { bubbles: true }));
        await flush();
      };
      hub.click(hub.rows().find((each) => each.getAttribute('data-ig-key') === 'i0001') ?? assert.fail('no rail row for i0001'));
      await flush();
      hub.click(narrowTab(hub, 'related'));
      await flush();
      const region = status() ?? assert.fail('no status line beside the search');
      assert.equal(region.textContent, '', 'the status line said something before any search');
      await type('i0');
      assert.equal(status(), region, 'the redraw replaced the status line instead of changing its text');
      assert.match(region.textContent ?? '', /^\d+ more not shown/);
      await type('no-such-issue');
      assert.equal(status(), region);
      assert.equal(region.textContent, 'no link matches');
    } finally {
      hub.handle.destroy();
      hub.dom.window.close();
    }
  });

  it('R14 mountWorkspace: an edit inside the related query keeps the field focused with its caret, through the input redraw and an unrelated update', async () => {
    // Every keystroke redraws the surface and replaces the field, so a mount that did not carry
    // focus and the caret across would throw the reader out of the search after one key, or send
    // a caret placed mid-query to the end.
    const hub = await mounted(relatedHubSeed(301));
    try {
      const field = (): HTMLInputElement | null =>
        hub.zone('canvas')?.querySelector<HTMLInputElement>('input[data-ig-command="related-query"]') ?? null;
      hub.click(hub.rows().find((each) => each.getAttribute('data-ig-key') === 'i0001') ?? assert.fail('no rail row for i0001'));
      await flush();
      hub.click(narrowTab(hub, 'related'));
      await flush();

      // The reader has typed `i032`, moves the caret back one place and inserts `0`.
      const typed = field() ?? assert.fail('no search over 301 relationships');
      typed.focus();
      typed.value = 'i0302';
      typed.setSelectionRange(4, 4);
      typed.dispatchEvent(new hub.win.Event('input', { bubbles: true }));
      await flush();
      // "typing keeps focus and caret"
      const redrawn = field() ?? assert.fail('the input redraw dropped the search');
      assert.notEqual(redrawn, typed, 'the input did not redraw the field, so this proves nothing');
      assert.equal(hub.handle.state.relatedQuery, 'i0302');
      assert.equal(hub.win.document.activeElement, redrawn, 'the input redraw took focus off the search');
      assert.equal(redrawn.value, 'i0302');
      assert.deepEqual([redrawn.selectionStart, redrawn.selectionEnd], [4, 4], 'the input redraw moved the caret');

      hub.handle.update();
      await flush();
      const updated = field() ?? assert.fail('an unrelated update dropped the search');
      assert.notEqual(updated, redrawn, 'the update did not redraw the field, so this proves nothing');
      assert.equal(hub.win.document.activeElement, updated, 'an unrelated update took focus off the search');
      assert.equal(updated.value, 'i0302');
      assert.deepEqual([updated.selectionStart, updated.selectionEnd], [4, 4], 'an unrelated update moved the caret');
    } finally {
      hub.handle.destroy();
      hub.dom.window.close();
    }
  });

  it('R18 KTD3 mountWorkspace: after the tree swap every aria-controls still names an element inside the workspace, and only Sub-issues is selected', async () => {
    // The tree swap replaces the canvas zone's children, so an id carried by a child, not the zone frame, would vanish here.
    const page = await mounted(SEED);
    try {
      page.click(narrowTab(page, 'sub-issues'));
      await flush();
      assert.ok(page.zone('canvas')?.querySelector('.ig-tree') != null, 'the tree swap did not happen, so this proves nothing');

      // "The a11y baseline covers the tabs with no dangling ARIA reference"
      const tabs = [...page.element.querySelectorAll<HTMLElement>('[role="tab"]')];
      assert.equal(tabs.length, 3);
      for (const node of page.element.querySelectorAll('[aria-controls]')) {
        const tokens = (node.getAttribute('aria-controls') ?? '').split(/\s+/).filter((token) => token !== '');
        for (const token of tokens) {
          const target = page.win.document.getElementById(token);
          assert.ok(target !== null && page.element.contains(target), `aria-controls names ${token}, which is not in the workspace`);
        }
      }
      const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
      assert.deepEqual(selected.map((tab) => tab.getAttribute('data-ig-value')), ['sub-issues']);
      const root = page.element.hasAttribute('data-tab') ? page.element : page.element.querySelector('[data-tab]');
      assert.equal(root?.getAttribute('data-tab'), 'sub-issues');
      page.handle.destroy();
    } finally {
      page.dom.window.close();
    }
  });

  it('KTD3 mountWorkspace: two workspaces on one page share no zone id, so each tab controls a zone in its own workspace', async () => {
    // With a shared id, getElementById answers the first workspace's zone for the second workspace's tab.
    const dom = new JSDOM('<!doctype html><html><body><div id="left"></div><div id="right"></div></body></html>');
    try {
      const roots: HTMLElement[] = [];
      const handles: ReturnType<typeof mountWorkspace>[] = [];
      for (const id of ['left', 'right']) {
        const root = dom.window.document.getElementById(id);
        assert.ok(root !== null);
        const store = createStore({ source: createScriptedSource(SEED, applyAny), derive: flatDeriver });
        await store.hydrate();
        handles.push(mountWorkspace(root, { store, project, words: WORDS }));
        roots.push(root);
      }
      await flush();
      const controlled = roots.map((root) => {
        const tabs = [...root.querySelectorAll('[role="tab"]')];
        assert.equal(tabs.length, 3, `${root.id} drew no tabs`);
        const tokens = tabs.flatMap((tab) => (tab.getAttribute('aria-controls') ?? '').split(/\s+/).filter((token) => token !== ''));
        assert.ok(tokens.length > 0, `${root.id}'s tabs control nothing`);
        for (const token of tokens) {
          const target = dom.window.document.getElementById(token);
          assert.ok(target !== null && root.contains(target), `${root.id}'s tab names ${token}, which is not in ${root.id}`);
        }
        return new Set(tokens);
      });
      const [left, right] = controlled;
      assert.ok(left !== undefined && right !== undefined);
      assert.deepEqual([...left].filter((token) => right.has(token)), [], 'the two workspaces share a zone id');
      for (const handle of handles) handle.destroy();
    } finally {
      dom.window.close();
    }
  });
});

describe('the editor builds and reports a selection set', () => {
  /** A mount recording every `onSelectionChange` call, as JSON in call order. */
  async function recording(seed: GraphDocument = SEED, options: { railCount?: number; wrap?: (source: ReturnType<typeof createScriptedSource>) => DataSource } = {}) {
    const calls: string[] = [];
    const page = await mounted(seed, { ...options, onSelectionChange: (selection) => calls.push(JSON.stringify(selection)) });
    const row = (key: string): HTMLElement => {
      const found = page.rows().find((candidate) => candidate.getAttribute('data-ig-key') === key);
      assert.ok(found !== undefined, `no rail row is drawn for ${key}`);
      return found;
    };
    const press = async (target: Element, key: string, modifiers: { shiftKey?: boolean } = {}): Promise<void> => {
      (target instanceof page.win.HTMLElement ? target : row('1')).focus();
      target.dispatchEvent(new page.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }));
      await flush();
    };
    const click = async (target: Element, modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}): Promise<void> => {
      target.dispatchEvent(new page.win.MouseEvent('click', { bubbles: true, ...modifiers }));
      await flush();
    };
    return { page, calls, row, press, click };
  }
  const issues = (...keys: string[]): string => JSON.stringify({ kind: 'issues', keys });
  const issue = (key: string): string => JSON.stringify({ kind: 'issue', key });
  const many: GraphDocument = {
    issues: Array.from({ length: 60 }, (_, index) => ({ ref: String(index + 1), title: `Issue ${String(index + 1)}`, state: 'open' as const })),
    edges: [],
  };

  it('adds with a Cmd-click and drops with a Ctrl-click, past the chord refusal, one notice each', async () => {
    const { page, calls, row, click } = await recording();
    try {
      await click(row('1'));
      await click(row('3'), { metaKey: true });
      await click(row('1'), { ctrlKey: true });
      assert.deepEqual(calls, [issue('1'), issues('1', '3'), issue('3')]);
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '3' });
    } finally {
      page.handle.destroy();
    }
  });

  it('ranges over the full rank span from an anchor outside the rail window', async () => {
    const { page, calls, row, press, click } = await recording(many, { railCount: 50 });
    try {
      await press(row('1'), 'End');
      await click(row('60'));
      await press(row('60'), 'Home');
      assert.ok(!page.rows().some((candidate) => candidate.getAttribute('data-ig-key') === '60'), 'the anchor is still drawn');
      await click(row('2'), { shiftKey: true });
      const expected = ['60', ...Array.from({ length: 58 }, (_, index) => String(59 - index))];
      assert.deepEqual(calls.at(-1), issues(...expected));
    } finally {
      page.handle.destroy();
    }
  });

  it('extends with Shift and an arrow across the rail window edge, on its last and first drawn rows', async () => {
    const { page, calls, row, press, click } = await recording(many, { railCount: 50 });
    try {
      await click(row('50'));
      const before = calls.length;
      await press(row('50'), 'ArrowDown', { shiftKey: true });
      assert.deepEqual(calls.slice(before), [issues('50', '51')], 'one notice for the press');
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), '51', 'focus did not cross the edge');
      const top = page.rows()[0];
      assert.ok(top !== undefined);
      const first = top.getAttribute('data-ig-key') ?? '';
      await click(top);
      const mark = calls.length;
      // Re-read: the click's redraw replaced the row element.
      await press(row(first), 'ArrowUp', { shiftKey: true });
      const above = String(Number(first) - 1);
      assert.deepEqual(calls.slice(mark), [issues(first, above)]);
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), above);
    } finally {
      page.handle.destroy();
    }
  });

  it('extends with Shift and an arrow inside the window, down and up', async () => {
    const { page, calls, row, press, click } = await recording();
    try {
      await click(row('1'));
      await press(row('1'), 'ArrowDown', { shiftKey: true });
      assert.deepEqual(calls.at(-1), issues('1', '2'));
      await press(row('2'), 'ArrowUp', { shiftKey: true });
      // 1 is already present, so it moves to the end.
      assert.deepEqual(calls.at(-1), issues('2', '1'));
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), '1');
    } finally {
      page.handle.destroy();
    }
  });

  it('clears a set on Escape and announces once', async () => {
    const { page, calls, row, press, click } = await recording();
    try {
      await click(row('1'));
      await click(row('2'), { metaKey: true });
      const before = calls.length;
      // jsdom lays nothing out, so the inspector reads as lifted over the
      // canvas and the first Escape dismisses it, which keeps precedence.
      await press(row('2'), 'Escape');
      assert.equal(page.handle.state.inspectorDismissed, true, 'the first Escape did not dismiss the lifted inspector');
      assert.deepEqual(calls.slice(before), [], 'dismissing the inspector changed the selection');
      await press(row('2'), 'Escape');
      assert.deepEqual(calls.slice(before), [JSON.stringify({ kind: 'none' })]);
      assert.deepEqual(page.handle.state.selection, { kind: 'none' });
    } finally {
      page.handle.destroy();
    }
  });

  it('keeps the set when Escape cancels a live draft', async () => {
    const { page, row, press, click } = await recording();
    try {
      await press(row('1'), RELATE_KEY);
      assert.ok(page.handle.state.draft.source === '1', 'the draft did not begin');
      await click(row('3'), { metaKey: true });
      assert.deepEqual(page.handle.state.selection, { kind: 'issues', keys: ['1', '3'] });
      await press(row('3'), 'Escape');
      assert.equal(page.handle.state.draft.source, null, 'Escape did not cancel the draft');
      assert.deepEqual(page.handle.state.selection, { kind: 'issues', keys: ['1', '3'] });
    } finally {
      page.handle.destroy();
    }
  });

  it('keeps the set when Escape is typed in a text field', async () => {
    const { page, row, press, click } = await recording();
    try {
      await click(row('1'));
      await click(row('2'), { metaKey: true });
      // Dismiss the lifted inspector first (see the Escape test above), so only
      // the field rule decides this press.
      await press(row('2'), 'Escape');
      // A field inside the mount, standing in for any text field a host or a
      // part draws there; the press bubbles to the mount's listener. Appended
      // AFTER the dismissing press, whose redraw would otherwise detach it.
      const field = page.win.document.createElement('input');
      page.zone('rail')?.append(field);
      assert.ok(field.isConnected, 'the field is not in the mount');
      field.focus();
      field.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'issues', keys: ['1', '2'] });
    } finally {
      page.handle.destroy();
    }
  });

  it('reports add, drop, range, clear and a store update that drops a member, and nothing for a no-op', async () => {
    let override: GraphDocument | null = null;
    const { page, calls, row, press, click } = await recording(SEED, {
      wrap: (source) => ({ ...source, hydrate: () => (override === null ? source.hydrate() : Promise.resolve(override)) }),
    });
    try {
      await click(row('1'));
      await click(row('4'), { metaKey: true });
      await click(row('4'), { metaKey: true });
      await click(row('3'), { shiftKey: true });
      await press(row('3'), 'Escape');
      await press(row('3'), 'Escape');
      await click(row('2'));
      await click(row('4'), { metaKey: true });
      // A store notification that changes nothing, and a range onto the anchor, which changes nothing.
      await page.store.rehydrate();
      await flush();
      await click(row('4'), { shiftKey: true });
      assert.deepEqual(calls, [
        issue('1'),
        issues('1', '4'),
        issue('1'),
        issues('1', '2', '3'),
        JSON.stringify({ kind: 'none' }),
        issue('2'),
        issues('2', '4'),
      ]);
      override = { ...SEED, issues: SEED.issues.filter((candidate) => candidate.ref !== '4') };
      await page.store.rehydrate();
      await flush();
      assert.deepEqual(calls.at(-1), issue('2'), 'the reconciliation that dropped 4 was not reported');
      assert.equal(calls.length, 8);
    } finally {
      page.handle.destroy();
    }
  });
});

describe('tree mode keeps the findings panel', () => {
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }

  it('opens the findings panel over the tree from the header count, as it does over the graph', async () => {
    for (const canvas of ['tree', 'neighbourhood'] as const) {
      const page = await mounted(SEED, { project: withCycle, canvas });
      try {
        await page.openAudit();
        const zone = page.zone('canvas');
        assert.ok(zone !== null);
        assert.ok(zone.querySelector('.ig-audit-overlay') !== null, `${canvas}: the header count opened no findings panel`);
        if (canvas === 'tree') {
          assert.ok(zone.querySelector('.ig-tree') !== null, 'the canvas did not draw the tree, so this proves nothing');
        }
      } finally {
        page.handle.destroy();
      }
    }
  });
});

/**
 * The log under the head, mounted: each write that is saving or did not save is
 * listed there whichever issue is selected, and its controls reach the store.
 */
