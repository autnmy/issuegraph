/**
 * The mounted surface the a11y baseline is taken over.
 *
 * IN `testing/` SO THE TEST AND THE GENERATOR SHARE ONE FIXTURE. A baseline
 * regenerated from a second, hand-copied fixture would drift from the one the
 * test compares against, and the artifact would then be evidence about a
 * surface nothing checks. `purity.test.ts` skips this directory and the package
 * does not ship it.
 */

import assert from 'node:assert/strict';

import type { GraphDocument, Mutation, OrderDeriver, StoreSnapshot } from '@issuegraph/store';
import { createScriptedSource, createStore, makeEdge } from '@issuegraph/store';
import { JSDOM } from 'jsdom';

import { type MountWords, type WorkspaceProjection, mountWorkspace } from '../workspace/mount.ts';
import { FIRST_PASS_WORDS, candidates } from './firstpass.ts';
import { PICKER_WORDS } from './picker.ts';
import { WORKSPACE_WORDS } from './workspace.ts';

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

const flatDeriver: OrderDeriver = (document) =>
  document.issues.map((issue, rank) => ({ ref: issue.ref, rank, ready: true, holdReasons: [] }));

function apply(document: GraphDocument, mutation: Mutation): GraphDocument {
  if (mutation.op !== 'create') return document;
  return { ...document, edges: [...document.edges, makeEdge(mutation.kind, mutation.from, mutation.to)] };
}

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
      // THE PANEL HEADER'S OWN CONTROLS, and they are gated HERE rather than on
      // the mount's `firstPass` option — `render.ts` draws the entry only when
      // `host.firstPass` is a non-empty string. An earlier revision supplied
      // the mount option alone and claimed the entry was therefore drawn; it
      // was not, and the baseline recorded only the inspector.
      host: { firstPass: 'find relationships', identity: 'demo/backlog' },
    },
    audit: { document: landed, graph: { cycles: [], duplicateCanonical: () => null } },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The surface the baseline is taken over.
 *
 * A CONFLICT IS PART OF THE FIXTURE, not an extra case: the disclosure is the
 * only control in the package carrying `aria-expanded` and `aria-controls`, and
 * covering them is what #149 asks the baseline for. A fixture without one would
 * record a surface where the interesting attributes do not appear at all.
 */
export async function a11ySurface(
  options: {
    readonly openDiff?: boolean;
    readonly openDraft?: boolean;
    /** Choose a kind too, which advances the draft to the target search. */
    readonly openSearch?: boolean;
    /** Open the first-pass queue, so its `data-ig-answer` controls are recorded. */
    readonly openFirstPass?: boolean;
  } = {},
): Promise<{ root: Element; close: () => void }> {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  const host = dom.window.document.getElementById('host');
  assert.ok(host !== null);
  const source = createScriptedSource(SEED, apply);
  const store = createStore({ source, derive: flatDeriver });
  await store.hydrate();
  const handle = mountWorkspace(host, {
    store,
    project,
    words: WORDS,
    // SUPPLIED SO §17a's ENTRY IS DRAWN, and so the QUEUE can be opened. The
    // entry is a command control in the rail's panel header, and the queue
    // behind it is the only surface publishing `data-ig-answer` — which
    // `CONTROL_ATTRIBUTES` names and the rules claim to cover, so a fixture
    // that never opened it left that whole channel unrecorded while the
    // baseline read as if it covered three.
    firstPass: {
      source: { findCandidates: () => Promise.resolve(candidates(3)) },
      words: FIRST_PASS_WORDS,
      exit: 'leave the first pass',
      scanning: 'looking for candidates',
      scanFailed: 'the scan could not run',
    },
  });

  void store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
  await source.whenPending();
  source.settleNext({
    outcome: 'conflict',
    upstream: { issues: SEED.issues, edges: [...SEED.edges, makeEdge('blocked-by', '2', '3')] },
  });
  await flush();

  // SELECT THE CARRIER, so the recovery card is drawn: the panel states a
  // write on the issue it was made from, and nothing is selected on mount.
  const row = [...host.querySelectorAll<HTMLElement>('[data-zone="rail"] [data-ig-key][tabindex]')].find(
    (each) => each.getAttribute('data-ig-key') === '3',
  );
  assert.ok(row !== undefined, 'no rail row for 3');
  row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flush();

  // THE DISCLOSURE'S OTHER STATE, when asked for. `aria-controls` is rendered
  // only while the region exists, so a baseline taken with the difference shut
  // records `aria-expanded` and nothing else — and #149 asks for both
  // attributes. The two states are recorded as two surfaces rather than one,
  // because "the same control, in its other state" is exactly what a reader
  // needs to see side by side.
  if (options.openDiff === true) {
    const disclosure = host.querySelector<HTMLElement>('[data-ig-command="view-diff"]');
    assert.ok(disclosure !== null, 'no disclosure to open');
    disclosure.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await flush();
  }

  // THE DRAFT FLOW, when asked for. The kind chooser and the target search are
  // built by the mount with `createElement` and never pass a renderer, and they
  // are the controls whose keyboard behaviour matters most — so a baseline that
  // never opened the draft would omit exactly what mounting was chosen for. It
  // is also the only state that exercises a `tabindex` other than none.
  if (options.openDraft === true || options.openSearch === true) {
    const add = host.querySelector<HTMLElement>('[data-ig-command="add"]');
    assert.ok(add !== null, 'no add control to open the draft');
    add.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await flush();
  }

  // THE SECOND STEP, and it needs its own state. Opening the draft renders the
  // KIND CHOOSER; the target search only appears once a kind is chosen, so a
  // baseline that stopped at `add` recorded the chooser and left `target-query`,
  // the match buttons and their cancel out of every surface — while this
  // module's own header justified mounting by that search. Regressions in its
  // accessible name, tab stop or ARIA state would have moved neither the
  // artifact nor a rule.
  if (options.openSearch === true) {
    const kind = host.querySelector<HTMLElement>('[data-ig-command="kind"]');
    assert.ok(kind !== null, 'no kind option to choose');
    kind.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await flush();

    // AND A QUERY, because the MATCH LIST is a third thing again: the search
    // renders its input with no matches until one is typed, and the match
    // buttons are the controls a reader actually operates to finish the edit.
    const input = host.querySelector<HTMLInputElement>('[data-ig-command="target-query"]');
    assert.ok(input !== null, 'no target search to type into');
    input.value = 'release';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await flush();
  }

  // THE FIRST-PASS QUEUE, when asked for. Its y/n/s answers are the package's
  // only `data-ig-answer` controls, and they are keyboard-first by design —
  // §17e advertises a pointer-free loop — so they are exactly the controls a
  // keyboard record should not be missing.
  if (options.openFirstPass === true) {
    const entry = host.querySelector<HTMLElement>('[data-ig-command="first-pass"]');
    assert.ok(entry !== null, 'no first-pass entry to open');
    entry.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await flush();
    // THE SCAN IS A PROMISE, so the queue is drawn on the render after it
    // settles rather than on the one that asked for it.
    await flush();
  }

  return {
    root: host,
    close: () => {
      handle.destroy();
      dom.window.close();
    },
  };
}

