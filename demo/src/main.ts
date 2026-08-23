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

import { type ExplainedRow, createDeriver, explainOrder, wouldCloseCycle } from './order.ts';
import { render } from './render.ts';
import { seedDocument, seedHolds } from './seed.ts';
import { type DemoSource, type NextOutcome, createDemoSource } from './source.ts';

/**
 * The host's cycle guard, delegating to the order module's own question.
 *
 * It used to walk the raw edges here, which is how it came to disagree with the
 * index it guards: a cycle that exists only AFTER duplicate resolution was
 * accepted, because raw endpoints have no path between them. `wouldCloseCycle`
 * builds the same canonical, boundary-crossing graph readiness uses, so the two
 * cannot drift apart again.
 *
 * Deliberately NOT a refusal of a cycle that already exists — §6.6 is explicit
 * that a cycle is detected on read and surfaced for grooming, because
 * write-time rejection pushes writers into describing the dependency in prose.
 * This refuses only the edit that would create one.
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
    // The armed outcome fires once and disarms itself, so the control follows
    // the source rather than keeping a claim the source has already dropped.
    outcome.value = source.armed();
  };

  const boot = (): void => {
    unsubscribe();
    issuesFilled = false;
    source = createDemoSource(seedDocument());
    store = createStore({
      source,
      derive: createDeriver(seedHolds()),
      guard: ({ mutation, current }) => {
        if (mutation.op !== 'create' || mutation.kind !== 'blocked-by') return undefined;
        if (!wouldCloseCycle(current, mutation.from, mutation.to)) return undefined;
        return {
          code: 'would-cycle',
          message: 'that blocked-by would close a cycle, so nothing was written',
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
