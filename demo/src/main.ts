/**
 * The demo, wired.
 *
 * Everything here is HOST work — the shell, the controls, the adapter, and the
 * two ports filled in below. The packages beneath are published and unmodified:
 * `@issuegraph/store` holds the document and runs the write loop, and the
 * `OrderDeriver` and `EdgeGuard` it declares are filled with
 * `@issuegraph/derive` rather than with a second reading of the ordering rules
 * (see `order.ts`). That is the claim this page exists to make good: if the demo
 * needs an app installation, an auth flow or a backend, the port is not a port.
 *
 * No credentials of any kind are read, and nothing is persisted. Reloading the
 * page restores the seed, which is the honest behaviour for a demo whose whole
 * subject is a tracker that is not there.
 */

import { EDGE_FIELDS } from '@issuegraph/core';
import type { EdgeKind, Store, StoreSnapshot } from '@issuegraph/store';
import { createStore } from '@issuegraph/store';

import {
  type ExplainedRow,
  createDeriver,
  explainOrder,
  introducesCycle,
} from './order.ts';
import { render } from './render.ts';
import { seedDocument, seedHolds } from './seed.ts';
import { type DemoSource, type NextOutcome, createDemoSource } from './source.ts';

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

function requireElement<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`the page is missing #${id}`);
  return found as T;
}

function option(value: string, label: string): HTMLOptionElement {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function fillIssueOptions(select: HTMLSelectElement, snapshot: StoreSnapshot): void {
  const chosen = select.value;
  select.replaceChildren();
  for (const issue of snapshot.issues) {
    select.append(option(issue.ref, `#${issue.ref} ${issue.title}`));
  }
  if (snapshot.issues.some((issue) => issue.ref === chosen)) select.value = chosen;
}

function start(): void {
  const root = requireElement('board');
  const from = requireElement<HTMLSelectElement>('edit-from');
  const to = requireElement<HTMLSelectElement>('edit-to');
  const kind = requireElement<HTMLSelectElement>('edit-kind');
  const create = requireElement<HTMLButtonElement>('edit-create');
  const outcome = requireElement<HTMLSelectElement>('next-outcome');
  const reset = requireElement<HTMLButtonElement>('reset');
  const asOf = requireElement('as-of');

  for (const field of EDGE_FIELDS) kind.append(option(field, field));

  let source: DemoSource;
  let store: Store;
  let unsubscribe = (): void => {};
  let issuesFilled = false;

  const draw = (): void => {
    const snapshot = store.getSnapshot();
    if (!issuesFilled && snapshot.issues.length > 0) {
      fillIssueOptions(from, snapshot);
      fillIssueOptions(to, snapshot);
      // Two different issues by default, so the first click is not a self-edge.
      const second = snapshot.issues[1];
      if (second !== undefined) to.value = second.ref;
      issuesFilled = true;
    }
    const rows: readonly ExplainedRow[] = explainOrder(
      { issues: snapshot.issues, edges: snapshot.landed },
      seedHolds(),
    );
    render(root, store, rows, snapshot);
    // The source ANNOUNCES a disarm (see `onArmedChange`), so this is only the
    // initial sync and the reset path — a redraw can no longer be relied on to
    // catch it, because the redraw happens first.
    outcome.value = source.armed();
  };

  const boot = (): void => {
    unsubscribe();
    issuesFilled = false;
    source = createDemoSource(seedDocument(), {
      // The adapter disarms itself inside `dispatch`, which happens AFTER the
      // store has already notified the page about the pending write — so the
      // control cannot be kept honest by redrawing, only by being told.
      onArmedChange: (armed) => {
        outcome.value = armed;
      },
    });
    store = createStore({
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
    unsubscribe = store.subscribe(draw);
    outcome.value = 'apply';
    asOf.textContent = `as of ${new Date().toLocaleTimeString()}`;
    void store.hydrate().then(draw);
    draw();
  };

  create.addEventListener('click', () => {
    // No writer rules here: the adapter enforces them for EVERY write path,
    // which is the only way a rule reaches `retry` as well as this button.
    void store.propose({
      op: 'create',
      kind: kind.value as EdgeKind,
      from: from.value,
      to: to.value,
    });
  });

  outcome.addEventListener('change', () => {
    source.arm(outcome.value as NextOutcome);
  });

  reset.addEventListener('click', boot);

  boot();
}

start();
