/**
 * The workspace mount's rule under 640px, driven through a real DOM: while the
 * root element the host passed measures narrower than 640, the selection is
 * one issue.
 *
 * jsdom lays nothing out, so each test gives the root element its own box and,
 * where it needs one, puts a fake `ResizeObserver` on the jsdom window, which
 * is the root element's own `defaultView`. These tests sit apart from
 * `mount.test.ts` so that file stays inside the test runner's per-file time
 * limit.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createScriptedSource, createStore } from '@issuegraph/store';
import { JSDOM } from 'jsdom';

import { SEED, WORDS, flatDeriver, flush, project } from '../testing/mount.ts';
import { mountWorkspace } from './mount.ts';

/** The root element's box, read at every measure, so a test changes it between resize callbacks. */
interface NarrowRuleBox {
  width: number;
  height: number;
}

/** One observer the mount built from the jsdom window: its callback, what it watches, and its disconnects. */
interface NarrowRuleWatch {
  readonly callback: () => void;
  readonly observed: Element[];
  readonly disconnects: number;
}

/**
 * The workspace mounted on a root element that measures `box`, or has no
 * `getBoundingClientRect` at all when `box` is `null`. The jsdom window gets
 * a fake `ResizeObserver` unless `observer` is `false`, and `onWindow` stubs
 * the window before the mount. Every `onSelectionChange` is recorded as JSON.
 */
async function mountNarrowRule(options: {
  box: NarrowRuleBox | null;
  observer?: boolean;
  onWindow?: (win: JSDOM['window']) => void;
}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  const win = dom.window;
  const element = win.document.getElementById('host');
  assert.ok(element !== null);
  const { box } = options;
  // An own property hides the prototype's measure on the root alone, so the
  // zones the workspace measures for its layout keep jsdom's.
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value:
      box === null
        ? undefined
        : () => ({ x: 0, y: 0, top: 0, left: 0, right: box.width, bottom: box.height, width: box.width, height: box.height, toJSON: () => ({}) }),
  });
  const watches: NarrowRuleWatch[] = [];
  if (options.observer !== false) {
    class NarrowRuleResizeObserver implements NarrowRuleWatch {
      readonly callback: () => void;
      readonly observed: Element[] = [];
      disconnects = 0;
      constructor(callback: () => void) {
        this.callback = callback;
        watches.push(this);
      }
      observe(target: Element): void {
        this.observed.push(target);
      }
      unobserve(): void {}
      disconnect(): void {
        this.disconnects += 1;
      }
    }
    Object.defineProperty(win, 'ResizeObserver', { value: NarrowRuleResizeObserver, configurable: true });
  }
  // These tests never write, so the source applies nothing.
  const store = createStore({ source: createScriptedSource(SEED, (document) => document), derive: flatDeriver });
  await store.hydrate();
  options.onWindow?.(win);
  const notices: string[] = [];
  const handle = mountWorkspace(element, {
    store,
    project,
    words: WORDS,
    onSelectionChange: (selection) => notices.push(JSON.stringify(selection)),
  });
  /** Click the rail row for `key`, as a Cmd-click when `metaKey`. The render it schedules has not run on return. */
  const click = (key: string, metaKey = false): void => {
    const row = element.querySelector(`[data-zone="rail"] [data-ig-key="${key}"][tabindex]`);
    assert.ok(row !== null, `no rail row is drawn for ${key}`);
    row.dispatchEvent(new win.MouseEvent('click', { bubbles: true, metaKey }));
  };
  /** Click issue 1, then Cmd-click issue 3, letting each render run. */
  const selectOneAndThree = async (): Promise<void> => {
    click('1');
    await flush();
    click('3', true);
    await flush();
  };
  /** The observers from the root element's own window that watch the root element. */
  const rootWatches = (): NarrowRuleWatch[] => watches.filter((watch) => watch.observed.includes(element));
  return { win, element, handle, notices, click, selectOneAndThree, rootWatches };
}

const issue = (key: string): string => JSON.stringify({ kind: 'issue', key });
const issues = (...keys: string[]): string => JSON.stringify({ kind: 'issues', keys });

/** The one observer watching the root element, asserted to be exactly one. */
function soleRootWatch(watches: readonly NarrowRuleWatch[]): NarrowRuleWatch {
  assert.equal(watches.length, 1, 'not exactly one observer from the root element document watches the root element');
  const [watch] = watches;
  assert.ok(watch !== undefined);
  return watch;
}

describe('under 640 the workspace selection is one issue', () => {
  it('under 640 the editor stores one issue when its root box shrinks under a live set, reports it once, and widening restores nothing', async () => {
    const box = { width: 800, height: 300 };
    const page = await mountNarrowRule({ box });
    try {
      await page.selectOneAndThree();
      assert.deepEqual(page.notices, [issue('1'), issues('1', '3')]);
      const watch = soleRootWatch(page.rootWatches());
      box.width = 639;
      // Two callbacks before the coalesced render runs: the first writes one
      // issue at once, and the second finds nothing left to change.
      watch.callback();
      watch.callback();
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '3' }, 'the handle still held the set after the resize callback');
      await flush();
      assert.deepEqual(page.notices.slice(2), [issue('3')], 'the resize reduction was not reported exactly once');
      watch.callback();
      await flush();
      assert.equal(page.notices.length, 3, 'a second callback at the same narrow box reported again');
      box.width = 800;
      watch.callback();
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '3' }, 'growing back restored the set');
      assert.equal(page.notices.length, 3, 'growing back reported a change');
    } finally {
      page.handle.destroy();
    }
  });

  it('a narrow editor root with no ResizeObserver on its wide window leaves one issue after a Cmd-click, before its render runs, reported once', async () => {
    const page = await mountNarrowRule({
      box: { width: 500, height: 300 },
      observer: false,
      // The window and the root box disagree, so only a mount that reads the window would get this wrong.
      onWindow: (win) => {
        for (const name of ['innerWidth', 'outerWidth']) Object.defineProperty(win, name, { value: 1024, configurable: true });
      },
    });
    try {
      assert.equal('ResizeObserver' in page.win, false, 'this case needs a window with no ResizeObserver');
      page.click('1');
      await flush();
      page.click('3', true);
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '3' }, 'the handle held a set before the render');
      await flush();
      assert.deepEqual(page.notices, [issue('1'), issue('3')]);
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '3' });
    } finally {
      page.handle.destroy();
    }
  });

  it('an all-zero or 640-wide editor root keeps a set, and a resize to 500 reduces it', async () => {
    const box = { width: 0, height: 0 };
    const page = await mountNarrowRule({ box });
    try {
      await page.selectOneAndThree();
      assert.deepEqual(page.notices.at(-1), issues('1', '3'), 'an all-zero root reduced an add');
      const watch = soleRootWatch(page.rootWatches());
      watch.callback();
      await flush();
      assert.equal(page.notices.length, 2, 'a resize callback at an all-zero root reported a change');
      box.width = 640;
      box.height = 300;
      watch.callback();
      await flush();
      assert.equal(page.notices.length, 2, 'a resize callback at 640 reported a change');
      assert.deepEqual(page.handle.state.selection, { kind: 'issues', keys: ['1', '3'] });
      box.width = 500;
      watch.callback();
      await flush();
      assert.deepEqual(page.notices.slice(2), [issue('3')]);
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '3' });
    } finally {
      page.handle.destroy();
    }
  });

  it('an editor root with no getBoundingClientRect keeps a two-issue set after a Cmd-click and a resize callback, and throws nothing', async () => {
    const page = await mountNarrowRule({ box: null });
    try {
      assert.equal(typeof page.element.getBoundingClientRect, 'undefined', 'the root kept its measure, so this test proves nothing');
      await page.selectOneAndThree();
      assert.deepEqual(page.handle.state.selection, { kind: 'issues', keys: ['1', '3'] });
      const watch = soleRootWatch(page.rootWatches());
      assert.doesNotThrow(() => watch.callback());
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'issues', keys: ['1', '3'] });
      assert.deepEqual(page.notices, [issue('1'), issues('1', '3')]);
    } finally {
      page.handle.destroy();
    }
  });

  it('reads no window size while the editor narrows a live set on resize', async () => {
    const box = { width: 800, height: 300 };
    // Every window member a width check could reach records its read, so a
    // mount that sized itself from the page instead of its root element is caught.
    const reads: string[] = [];
    const page = await mountNarrowRule({
      box,
      onWindow: (win) => {
        for (const name of ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'matchMedia', 'visualViewport', 'screen', 'devicePixelRatio']) {
          Object.defineProperty(win, name, {
            configurable: true,
            get: () => {
              reads.push(name);
              return undefined;
            },
          });
        }
      },
    });
    try {
      await page.selectOneAndThree();
      assert.deepEqual(page.handle.state.selection, { kind: 'issues', keys: ['1', '3'] }, 'a wide box kept the set');
      box.width = 500;
      soleRootWatch(page.rootWatches()).callback();
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '3' }, 'the shrink did not reduce the set to its last-added issue');
      assert.equal(page.notices.at(-1), issue('3'));
      assert.deepEqual(reads, [], 'the editor read the window size');
    } finally {
      page.handle.destroy();
    }
  });

  it('a narrow window around a wide editor root keeps the set through a resize callback', async () => {
    const page = await mountNarrowRule({
      box: { width: 800, height: 300 },
      // The window reads narrow; only the root element box may decide the rule.
      onWindow: (win) => {
        for (const name of ['innerWidth', 'outerWidth']) Object.defineProperty(win, name, { value: 400, configurable: true });
      },
    });
    try {
      await page.selectOneAndThree();
      soleRootWatch(page.rootWatches()).callback();
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'issues', keys: ['1', '3'] }, 'the window width, not the root box, decided narrowness');
      assert.deepEqual(page.notices, [issue('1'), issues('1', '3')]);
    } finally {
      page.handle.destroy();
    }
  });

  it('a resize callback after destroy reports nothing and throws nothing, and the root observer is disconnected once despite redraws', async () => {
    const box = { width: 800, height: 300 };
    const page = await mountNarrowRule({ box });
    // Each click redraws, so an observer disconnected and re-observed per render would count more than one disconnect.
    await page.selectOneAndThree();
    const watch = soleRootWatch(page.rootWatches());
    const before = page.notices.length;
    page.handle.destroy();
    assert.equal(watch.disconnects, 1, 'destroy did not disconnect the root-box observer exactly once');
    // A queued callback can still arrive after disconnect(), at a box that would reduce the set.
    box.width = 500;
    assert.doesNotThrow(() => watch.callback());
    await flush();
    assert.deepEqual(page.notices.slice(before), [], 'a callback after destroy reached the host');
    assert.equal(watch.disconnects, 1);
  });
});
