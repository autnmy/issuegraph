/**
 * The mount, driven through a real DOM.
 *
 * jsdom rather than the viewer's element double, because this shell reads what
 * a double would have to re-implement — `innerHTML`, `closest`, `querySelector`,
 * `activeElement`, `focus` — and a second DOM written for the test is a second
 * place the shell can be wrong about the first. The reducer beneath is driven
 * with no DOM at all in `host.test.ts`; what is proven here is the wiring.
 *
 * Every test goes through the PUBLIC entry point with a real store, so the
 * criterion — a typed host mounts the workspace and edits through it — is what
 * a consumer gets rather than what an internal happens to do.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GraphDocument, Mutation, StoreSnapshot } from '@issuegraph/store';
import type { DataSource } from '@issuegraph/store';
import { type OrderDeriver, createScriptedSource, createStore, makeEdge } from '@issuegraph/store';
import { JSDOM } from 'jsdom';

import { PICKER_WORDS } from '../testing/picker.ts';
import { WORKSPACE_WORDS } from '../testing/workspace.ts';
import type { WorkspaceSelection } from './selection.ts';
import {
  type CanvasMode,
  type FirstPassOption,
  type MountWords,
  type WorkspaceProjection,
  mountWorkspace,
} from './mount.ts';

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

/** The happy-path edit semantics, for the scripted source to apply on `applied`. */
function apply(document: GraphDocument, mutation: Mutation): GraphDocument {
  if (mutation.op !== 'create') return document;
  return { ...document, edges: [...document.edges, makeEdge(mutation.kind, mutation.from, mutation.to)] };
}

/** A host's projection: the order as the deriver ranked it, and an audit over the landed document. */
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
    },
    audit: { document: landed, graph: { cycles: [], duplicateCanonical: () => null } },
  };
}

/** Let every queued microtask — the coalesced render among them — run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The happy-path semantics for every op, so a retype can be driven end to end. */
function applyAny(document: GraphDocument, mutation: Mutation): GraphDocument {
  switch (mutation.op) {
    case 'create':
      return apply(document, mutation);
    case 'delete':
      return { ...document, edges: document.edges.filter((edge) => edge.id !== mutation.edgeId) };
    case 'retype': {
      const old = document.edges.find((edge) => edge.id === mutation.edgeId);
      if (old === undefined) return document;
      return { ...document, edges: [...document.edges.filter((edge) => edge.id !== old.id), makeEdge(mutation.nextKind, old.from, old.to)] };
    }
    case 'flip': {
      const old = document.edges.find((edge) => edge.id === mutation.edgeId);
      if (old === undefined) return document;
      return { ...document, edges: [...document.edges.filter((edge) => edge.id !== old.id), makeEdge(old.kind, old.to, old.from)] };
    }
  }
}

/** The harness deriver: document order, everything ready. */
const flatDeriver: OrderDeriver = (document) =>
  document.issues.map((issue, rank) => ({ ref: issue.ref, rank, ready: true, holdReasons: [] }));

/**
 * A deriver whose order MOVES with the edges: an issue with an open blocker
 * sorts after every unblocked one and is held. The rank pin needs an order a
 * landed edge changes, or it could not tell a pending edge apart from one that
 * landed.
 */
const blockingDeriver: OrderDeriver = (document) => {
  const blocked = new Set(document.edges.filter((edge) => edge.kind === 'blocked-by').map((edge) => edge.from));
  const byRef = (a: { ref: string }, b: { ref: string }): number => a.ref.localeCompare(b.ref);
  const free = document.issues.filter((issue) => !blocked.has(issue.ref)).sort(byRef);
  const held = document.issues.filter((issue) => blocked.has(issue.ref)).sort(byRef);
  return [...free, ...held].map((issue, rank) => ({
    ref: issue.ref,
    rank,
    ready: !blocked.has(issue.ref),
    holdReasons: blocked.has(issue.ref) ? ['blocked'] : [],
  }));
};

/** One page, one store, one mount — rebuilt per test so nothing leaks between them. */
async function mounted(
  seed: GraphDocument = SEED,
  options: {
    railCount?: number;
    derive?: OrderDeriver;
    /** Override the vocabulary. */
    words?: MountWords;
    project?: (snapshot: StoreSnapshot) => WorkspaceProjection;
    firstPass?: FirstPassOption;
    canvas?: CanvasMode;
    /**
     * Wrap the scripted source before the store sees it.
     *
     * The scripted adapter's `hydrate` always resolves, and a READ that fails
     * is a state the store models deliberately — so the only way to reach it is
     * to decorate the adapter. Injected here rather than grown onto
     * `createScriptedSource`, which is a published testing surface and should
     * not sprout a knob for one consumer's suite.
     */
    wrap?: (source: ReturnType<typeof createScriptedSource>) => DataSource;
    /** §17d's outward link is drawn only for a URL the host can name. */
    issueUrl?: (ref: string) => string | null;
    onSelectionChange?: (selection: WorkspaceSelection) => void;
  } = {},
) {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  const win = dom.window;
  const element = win.document.getElementById('host');
  assert.ok(element !== null);
  const source = createScriptedSource(seed, applyAny);
  const { derive = flatDeriver, project: projection = project, wrap, ...mountOptions } = options;
  const store = createStore({ source: wrap === undefined ? source : wrap(source), derive });
  await store.hydrate();
  const handle = mountWorkspace(element, { store, project: projection, words: WORDS, ...mountOptions });
  const click = (node: Element): void => {
    node.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  };
  const zone = (name: string): HTMLElement | null =>
    element.querySelector<HTMLElement>(`.ig-zone[data-zone="${name}"]`);
  const rows = (): HTMLElement[] => [...element.querySelectorAll<HTMLElement>('[data-zone="rail"] [data-ig-key][tabindex]')];
  const control = (command: string): HTMLElement | null =>
    element.querySelector<HTMLElement>(`[data-ig-command="${command}"]`);
  // §17d'S PANEL IS TRANSIENT NOW, so a test that wants to look at it has to
  // OPEN it first — which is the real path a reader takes, and a better fixture
  // than an option would have been. `RULINGS.md` §3 anchors it to the header
  // count, so this is that click.
  const openAudit = async (): Promise<void> => {
    const toggle = element.querySelector<HTMLElement>('.ig-audit-toggle');
    assert.ok(toggle !== null, 'no audit header to open the panel from');
    click(toggle);
    await flush();
  };
  return { dom, win, element, source, store, handle, click, zone, rows, control, openAudit };
}

describe("more tests", function () {
it('R7 R6 mountWorkspace: three writes are each listed while saving, the ranks hold until the last settles, and the saved line counts the earlier moves beside the failed last write', async () => {
  const page = await mounted(SEED, { derive: blockingDeriver });
  try {
    const drawn = (): (string | null)[][] =>
      page.rows().map((row) => [row.getAttribute('data-ig-key'), row.querySelector('.ig-rank')?.textContent ?? null]);
    const header = (): HTMLElement | null => page.zone('header');
    const listedCreates = (): number =>
      (header()?.textContent ?? '').split(WORKSPACE_WORDS.log.ops.create).length - 1;
    const before = drawn();
    assert.deepEqual(before, [['2', '1'], ['3', '2'], ['4', '3'], ['1', '4']]);

    // Three writes on three issues. The first two each hold another issue,
    // so each moves the order; the third is refused by the tracker.
    const first = page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
    const second = page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
    const third = page.store.propose({ op: 'create', kind: 'duplicate-of', from: '4', to: '1' });
    await page.source.whenPending(first.mutationId);
    await flush();

    // The issue: "A change to several issues (#249) lists each write in the log, and the order holds until all of them settle."
    assert.equal(listedCreates(), 3, 'the log does not list each saving write once');

    page.source.settleNext('applied');
    await first.settled;
    await page.source.whenPending(second.mutationId);
    await flush();
    assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-order'), 'held');
    assert.deepEqual(drawn(), before, 'a rank moved before every write settled');
    assert.equal(listedCreates(), 2, 'the saved write is still listed as saving');

    page.source.settleNext('applied');
    await second.settled;
    await page.source.whenPending(third.mutationId);
    page.source.settleNext({ outcome: 'rejected', reason: 'the tracker said no' });
    await third.settled;
    await flush();

    assert.deepEqual(drawn(), [['4', '1'], ['1', '2'], ['2', '3'], ['3', '4']]);
    assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-order'), 'settled');

    // The issue: "A saved change says what it did to the order, in `text-muted`, until it is dismissed: "Saved: 2 moved · 1 newly held", or "Saved. The order did not change." Never on a timer."
    // Issues 2 and 3 became held across the period, though the closing write failed.
    const line = header()?.querySelector('.ig-change-line[role="status"]') ?? null;
    assert.ok(line !== null, 'no change line under the head');
    assert.ok(line.textContent?.includes(WORKSPACE_WORDS.change.saved), 'the saved line is missing');
    assert.equal(
      line.querySelector('.ig-change-part[data-facet="newly-held"] .ig-change-count')?.textContent,
      '2',
      'the saved line does not count both saved writes',
    );
    const failed = [...(header()?.querySelectorAll<HTMLElement>('.ig-recovery') ?? [])];
    assert.equal(failed.length, 1, 'the failed last write is not in the log beside the saved line');
    assert.equal(failed[0]?.getAttribute('data-ig-state'), 'failed');
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});
});
