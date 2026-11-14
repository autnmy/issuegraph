/**
 * A REAL DOM ELEMENT IS A `MountElement`, checked by the compiler (#112).
 *
 * `MountElement` is the slice of an element `mount` reads, kept free of the DOM
 * so the test harness can stand in for one. Nothing in this package passed a
 * DOM element to `mountViewer` under strict TypeScript, so for several releases
 * a typed host could not either — `removeChild` was declared against
 * `SpecElement` in a form the DOM's generic `removeChild<T extends Node>` does
 * not satisfy — and every typed consumer had to cast or narrow at runtime.
 *
 * The assertion is the ASSIGNMENT: this file is in `tsconfig.test.json`'s
 * program with the DOM library, so `pnpm run typecheck` fails the moment an
 * `HTMLElement` stops satisfying the slice. The first test only proves the
 * file was loaded; there is no global `document` under `node --test` to call
 * it with.
 *
 * FOCUS IS THE ONE THING THE ELEMENT DOUBLE CANNOT ANSWER, so the resize case
 * below mounts into a jsdom element instead. The double counts `focus()` calls
 * and dispatches no focus events, so it cannot show that a resize redraw,
 * which destroys the row holding focus, leaves `activeElement` inside the
 * viewer through a real `focusin` and a real removal.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { JSDOM } from 'jsdom';

import { type MountElement, mountViewer } from './mount.ts';
import { twoUnitDocument } from './testing/fixtures.ts';

/** Never called at runtime: compiled, so a DOM element must satisfy the slice. */
function mountsIntoARealElement(): void {
  const container: MountElement = document.createElement('div');
  mountViewer(document.createElement('section'), {
    issues: [],
    edges: [],
    order: { slots: [], excluded: [] },
    cycles: [],
  });
  assert.ok(container);
}

test('a DOM element type-checks as mountViewer’s container (compile-time, #112)', () => {
  assert.equal(typeof mountsIntoARealElement, 'function');
});

test('a real document keeps focus inside the viewer when a resize under 640 reduces the set', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  const win = dom.window;
  const container = win.document.getElementById('host');
  assert.ok(container !== null);
  let width = 800;
  // jsdom lays nothing out, so the container's own measure is the width the test sets.
  Object.defineProperty(container, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: 300, width, height: 300, toJSON: () => ({}) }),
  });
  const callbacks: (() => void)[] = [];
  class FakeResizeObserver {
    constructor(callback: () => void) {
      callbacks.push(callback);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(win, 'ResizeObserver', { value: FakeResizeObserver, configurable: true });
  const handle = mountViewer(container, twoUnitDocument, { selected: ['31', '33'] });
  try {
    const row = container.querySelector<HTMLElement>('[data-ig-key="31"][tabindex]');
    assert.ok(row !== null, 'no row was drawn for 31');
    row.focus();
    assert.equal(container.ownerDocument.activeElement, row, 'the row did not take focus');
    width = 500;
    assert.equal(callbacks.length, 1, 'the mount took no observer from its document');
    callbacks[0]?.();
    assert.equal(handle.state.selected, '33');
    assert.equal(row.isConnected, false, 'the resize did not redraw the focused row');
    const active = container.ownerDocument.activeElement;
    assert.ok(active !== null && container.contains(active), 'focus left the viewer on a resize reduction');
    assert.equal(active.getAttribute('data-ig-key'), '31', 'focus did not go back to the row the reader stood on');
  } finally {
    handle.destroy();
    win.close();
  }
});
