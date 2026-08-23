/**
 * The demo, wired.
 *
 * Everything here is HOST work — the shell, the controls, the deriver, the
 * adapter. The store below is the published package, unmodified and
 * unconfigured beyond the two ports it declares. That is the claim this page
 * exists to make good: if the demo needs an app installation, an auth flow or a
 * backend, the port is not a port.
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
  cardinalityConflict,
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
 * The store hands a guard both documents precisely so it can ask this.
 *
 * Deliberately NOT a refusal of a cycle that already exists — §6.6 is explicit
 * that a cycle is detected on read and surfaced for grooming, because
 * write-time rejection pushes writers into describing the dependency in prose.
 * `introducesCycle` compares sets, so only what this edit adds is refused.
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
  const note = requireElement('edit-note');
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
    note.textContent = '';
    asOf.textContent = `as of ${new Date().toLocaleTimeString()}`;
    void store.hydrate().then(draw);
    draw();
  };

  create.addEventListener('click', () => {
    const chosen = kind.value as EdgeKind;
    // CARDINALITY IS THE WRITER'S RULE, so the host checks it before writing.
    // Every field except `blocked-by` holds ONE reference (§4.3), and a second
    // one does not enrich the document — it makes the reader pick whichever it
    // saw last. It is refused here rather than in the guard because the
    // package's refusal codes are a closed set describing the STORE's own
    // structural refusals, and inventing a meaning for one of them to carry a
    // format rule would misreport what happened.
    const existing = cardinalityConflict(
      { issues: store.getSnapshot().issues, edges: store.getSnapshot().landed },
      chosen,
      from.value,
    );
    if (existing !== undefined) {
      note.textContent = `#${from.value} already has ${chosen} → #${existing.to}, and ${chosen} holds one reference. Delete that edge first.`;
      return;
    }
    note.textContent = '';
    void store.propose({
      op: 'create',
      kind: chosen,
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
