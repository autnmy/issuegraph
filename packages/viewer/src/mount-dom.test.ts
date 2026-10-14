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
 * `HTMLElement` stops satisfying the slice. The runtime test only proves the
 * file was loaded; there is no `document` under `node --test` to call it with.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type MountElement, mountViewer } from './mount.ts';

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
