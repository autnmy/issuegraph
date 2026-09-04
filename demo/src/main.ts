/**
 * The demo, wired.
 *
 * Everything here is HOST work — the shell, the adapter, and the two ports
 * filled in below. The packages beneath are published and unmodified:
 * `@issuegraph/store` holds the document and runs the write loop, its
 * `OrderDeriver` and `EdgeGuard` are filled with `@issuegraph/derive` rather
 * than with a second reading of the ordering rules (see `order.ts`), and
 * `@issuegraph/viewer` and `@issuegraph/editor` draw the result through
 * `workspace.ts`. That is the claim this page exists to make good: if the demo
 * needs an app installation, an auth flow or a backend, the port is not a port.
 *
 * No credentials of any kind are read, and nothing is persisted. Reloading the
 * page restores the seed, which is the honest behaviour for a demo whose whole
 * subject is a tracker that is not there.
 */

import type { Store } from '@issuegraph/store';
import { createStore } from '@issuegraph/store';

import { createDeriver, introducesCycle } from './order.ts';
import { seedDocument, seedHolds } from './seed.ts';
import { type DemoSource, createDemoSource } from './source.ts';
import { type Live, mountSandbox } from './workspace.ts';

/**
 * The host's graph guard, asked of the two DOCUMENTS rather than of the edit.
 *
 * It used to key on the mutation — "is this a `blocked-by` create that would
 * close a cycle?" — and that shape cannot work, because a cycle needs no new
 * dependency to appear: `duplicate-of` and `together-with` COLLAPSE vertices.
 * `#4 blocked-by #2`, `#2 blocked-by #3`, `#3 duplicate-of #4` closes
 * `#4 → #2 → #4` with the last edit adding no dependency at all. Extending the
 * guard kind by kind is a list that is always one entry short; comparing the
 * resulting graphs has no list.
 *
 * The store hands a guard both documents precisely so it can ask this. The WALK
 * is still the package's — `introducesCycle` asks `@issuegraph/derive`'s own
 * pre-write probe about each document's edges — so what a write is refused for
 * agrees with the package's refusal rather than with a second opinion.
 *
 * Deliberately NOT a refusal of a cycle that already exists — §6.6 is explicit
 * that a cycle is detected on read and surfaced for grooming, because
 * write-time rejection pushes writers into describing the dependency in prose.
 * `introducesCycle` compares which EDGES lie on one, so only what this edit adds
 * is refused, and the seed can ship a cycle to be looked at.
 */
function boot(onChange: () => void): Live {
  const source: DemoSource = createDemoSource(seedDocument(), {
    // The adapter disarms itself inside `dispatch`, which happens AFTER the
    // store has already notified the page about the pending write — so the
    // control cannot be kept honest by redrawing, only by being told.
    onArmedChange: onChange,
  });
  const store: Store = createStore({
    source,
    derive: createDeriver(seedHolds()),
    guard: ({ current, next }) => {
      if (!introducesCycle(current, next)) return undefined;
      return {
        code: 'would-cycle',
        message: 'that edit would close a dependency cycle, so nothing was written',
      };
    },
  });
  return { store, source };
}

function requireElement<T extends HTMLElement>(id: string, kind: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof kind)) throw new Error(`the page is missing #${id}`);
  return found;
}

function start(): void {
  const root = requireElement('sandbox', HTMLElement);
  const styles = requireElement('ig-styles', HTMLStyleElement);
  mountSandbox(
    {
      root,
      workspace: requireElement('workspace', HTMLElement),
      styles,
      writes: requireElement('writes', HTMLElement),
      versions: requireElement('versions', HTMLElement),
      outcome: requireElement('next-outcome', HTMLSelectElement),
    },
    boot,
  );
  const asOf = document.getElementById('as-of');
  if (asOf !== null) asOf.textContent = `as of ${new Date().toLocaleTimeString()}`;
}

start();
