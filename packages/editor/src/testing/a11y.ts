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

function projectWith(held: boolean) {
  return (snapshot: StoreSnapshot): WorkspaceProjection => project(snapshot, held);
}

function project(snapshot: StoreSnapshot, held = false): WorkspaceProjection {
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
          ready: held && row.ref === '3' ? false : row.ready,
          // A HOLD WITH A SUBJECT THE DOCUMENT CARRIES, which is the only
          // shape that draws one: `holdRow` publishes `select-issue` on the
          // holder, and withholds the control for a subject the inspector
          // could not resolve or one already in the inspected slot.
          holds:
            held && row.ref === '3'
              ? [{ family: 'graph' as const, reason: 'held until #2 closes', code: 'blocked-by', subject: '2' }]
              : [],
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
    /**
     * Use a backlog big enough to leave the ladder's direct tier, and drive its
     * canvas search — which is the only way `search`, `focus` and `clear-focus`
     * are drawn at all.
     */
    readonly refusalTier?: boolean;
    /** Select an edge, which is the only thing that renders the retype picker. */
    readonly selectEdge?: boolean;
    /** A backlog with nothing related, which is what draws the isolated chip. */
    readonly isolated?: boolean;
    /** Open that chip, so its other command is recorded too. */
    readonly openIsolated?: boolean;
    /** Put a hold on the inspected slot, which is what draws its subject control. */
    readonly held?: boolean;
  } = {},
): Promise<{ root: Element; close: () => void }> {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  const host = dom.window.document.getElementById('host');
  assert.ok(host !== null);
  // A CHAINED BACKLOG FOR THE REFUSAL TIER. The ladder draws capsules, search
  // results and a focused state only above its node budget; below it there is
  // nothing to refuse and none of those controls exist. The four-issue seed
  // every other surface uses keeps it in the direct tier, so the baseline had
  // no `search`, `focus` or `clear-focus` in any state while the rules claimed
  // to cover what this package renders.
  const dense = 90;
  const seed: GraphDocument =
    options.isolated === true
      ? // NOTHING RELATED TO ANYTHING, which is what leaves issues isolated:
        // the chip is drawn only for a non-empty isolated set, and every other
        // fixture here connects its issues.
        { issues: SEED.issues, edges: [] }
      : options.refusalTier === true
      ? {
          issues: Array.from({ length: dense }, (_unused, index) => ({
            ref: String(index + 1),
            title: `Release task ${index + 1}`,
            state: 'open' as const,
            priority: 2,
          })),
          edges: Array.from({ length: dense - 1 }, (_unused, index) =>
            makeEdge('blocked-by', String(index + 1), String(index + 2)),
          ),
        }
      : SEED;
  const source = createScriptedSource(seed, apply);
  const store = createStore({ source, derive: flatDeriver });
  await store.hydrate();
  const handle = mountWorkspace(host, {
    store,
    project: projectWith(options.held === true),
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

  // AN EDGE THE SEED DOES NOT ALREADY CARRY. The dense backlog is a CHAIN, so
  // `3 -> 4` is already in it and the store refuses a duplicate before any
  // dispatch — `whenPending` then never settles and the fixture hangs rather
  // than failing. A non-adjacent pair is new, and it closes no cycle because 3
  // already reaches 7 through the chain.
  const to = options.refusalTier === true ? '7' : '4';
  void store.propose({ op: 'create', kind: 'blocked-by', from: '3', to });
  await source.whenPending();
  source.settleNext({
    outcome: 'conflict',
    upstream: { issues: seed.issues, edges: [...seed.edges, makeEdge('blocked-by', '2', '3')] },
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

  // THE ISOLATED CHIP'S OTHER STATE, when asked for. One button, two commands
  // — the same toggle the focus token had to learn to follow — so recording it
  // shut and open is what puts both names in the artifact.
  if (options.openIsolated === true) {
    const chip = host.querySelector<HTMLElement>('[data-ig-command="open-isolated"]');
    assert.ok(chip !== null, 'no isolated chip to open');
    chip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await flush();
  }

  // AN EDGE SELECTION, when asked for. `inspectorChrome` renders the mounted
  // retype picker only while an edge is selected, so `retype` and `flip` — two
  // controls this package draws — were in no recorded state at all.
  if (options.selectEdge === true) {
    // A LANDED EDGE, and the distinction cost a round to find. The conflicted
    // write this fixture stages is NOT in the landed document, so selecting it
    // resolves to nothing and `inspectorView` correctly answers `none` — the
    // panel empties and the picker has no subject. The seed's own `1 -> 2` is
    // landed, so the carrier is switched first.
    const carrier = [...host.querySelectorAll<HTMLElement>('[data-zone="rail"] [data-ig-key][tabindex]')].find(
      (each) => each.getAttribute('data-ig-key') === '1',
    );
    assert.ok(carrier !== undefined, 'no rail row for 1');
    carrier.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await flush();
    const edge = host.querySelector<HTMLElement>('[data-ig-command="select-edge"]');
    assert.ok(edge !== null, 'no relationship row to select an edge from');
    edge.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await flush();
  }

  // THE CANVAS SEARCH, which is what turns the refusal tier into a state with
  // results and a focused component in it rather than a bare refusal.
  if (options.refusalTier === true) {
    const canvasSearch = host.querySelector<HTMLInputElement>('input[data-ig-command="search"]');
    assert.ok(canvasSearch !== null, 'no canvas search — the ladder is not in a refusal tier');
    canvasSearch.value = 'Release task 3';
    canvasSearch.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await flush();
    const match = host.querySelector<HTMLElement>('[data-ig-command="focus"]');
    assert.ok(match !== null, 'no focus control among the search results');
    match.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await flush();
  }

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

    // AND ONE ANSWER, because `undo` is rendered only once something can be
    // undone. A freshly opened queue has no such control, so the recovery the
    // whole surface leans on was in no recorded state.
    const answer = host.querySelector<HTMLElement>('[data-ig-answer]');
    assert.ok(answer !== null, 'no answer control in the opened queue');
    answer.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
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

