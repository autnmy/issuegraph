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
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { GraphDocument, Mutation, StoreSnapshot } from '@issuegraph/store';
import type { DataSource } from '@issuegraph/store';
import { type OrderDeriver, createScriptedSource, createStore, makeEdge } from '@issuegraph/store';
import { THEME_TOKENS, treatmentFor } from '@issuegraph/viewer';
import { JSDOM } from 'jsdom';

import { KIND_KEYS, RELATE_KEY } from '../create/keys.ts';
import type { Candidate } from '../firstpass/candidates.ts';
import { FIRST_PASS_WORDS } from '../testing/firstpass.ts';
import { PICKER_WORDS } from '../testing/picker.ts';
import { WORDS as CHANGE_WORDS } from '../testing/reevaluate.ts';
import { WORKSPACE_WORDS } from '../testing/workspace.ts';
import { mountStylesheet } from './chrome.ts';
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

/** One page, one store, one mount — rebuilt per test so nothing leaks between them. */
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

/** The harness projection plus every host fact, so the workspace has a header to draw once. */
function hostedProject(snapshot: StoreSnapshot): WorkspaceProjection {
  const base = project(snapshot);
  return {
    ...base,
    viewer: {
      ...base.viewer,
      host: {
        concurrencyCap: 2,
        counts: { ranked: 4, readyNow: 4, held: 0 },
        running: [{ key: '2', phase: 'Review', elapsed: '12m' }],
        freshness: { asOf: '14:32', age: '2m ago', refresh: 'refresh' },
      },
    },
  };
}

/**
 * The harness projection with `2` folded into `1`'s slot — one together unit
 * with a non-lead member.
 *
 * A UNIT IS THE ONE SHAPE WHERE THE PANEL'S SUBJECT AND A KEY THE READER CAN
 * STAND ON DIVERGE WITHOUT A CLICK: `inspectorView` canonicalizes a selection
 * naming a member onto the slot's lead, so `R` on the member begins a draft
 * from a source the panel is not about.
 */
function unitProject(snapshot: StoreSnapshot): WorkspaceProjection {
  const base = project(snapshot);
  const slots = base.viewer.order.slots
    .filter((slot) => slot.lead !== '2')
    .map((slot, index) => ({
      ...slot,
      rank: index + 1,
      members: slot.lead === '1' ? ['1', '2'] : slot.members,
    }));
  return { ...base, viewer: { ...base.viewer, order: { ...base.viewer.order, slots } } };
}

async function mounted(
  seed: GraphDocument = SEED,
  options: {
    railCount?: number;
    derive?: OrderDeriver;
    /**
     * Override the vocabulary.
     *
     * The default deliberately carries no `change`, so §17c draws nothing for
     * the suite's other tests — the package refuses to invent those words, and
     * a fixture that supplied them everywhere would put the loop on surfaces
     * whose tests are not about it. A test that IS about it passes its own.
     */
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
  return { dom, win, element, source, store, handle, click, zone, rows, control };
}

type Mounted = Awaited<ReturnType<typeof mounted>>;

/**
 * The audit panel's scroll offset survives a redraw, as the rail's already does.
 *
 * #177 gave the audit a share of the inspector column, which made it an
 * INDEPENDENT scroll container. Before that it grew to its content and only the
 * zone scrolled, so there was one offset to keep and `redraw` kept it. Now there
 * are two, and a store update runs the same redraw — so without this a reader
 * deep in a long audit is returned to the first finding by something happening
 * elsewhere on the surface.
 *
 * THE SCROLLER IS `.ig-audit-region`, NOT `.ig-audit-panel`. #177 put the bound
 * on the panel; §17d's second surface moved it up to the region holding both, so
 * the panel's own offset is now always zero. THIS TEST DID NOT NOTICE — jsdom
 * lets `scrollTop` be set on any element whatever its overflow, so it was
 * measuring the mount's bookkeeping rather than anything that scrolls, and it
 * went on passing against an element that had stopped being the scroll
 * container. It asks about the region now, which is what a browser scrolls.
 *
 * `surface.innerHTML` replaces the subtree, so the element the offset was read
 * from is gone by the time it is written back: the restore has to RE-QUERY.
 * That is the part this test holds, and the identity assertion below is what
 * proves the subtree really was rebuilt rather than left alone.
 */
describe("the audit region's scroll offset survives a redraw", () => {
  /** The default projection, with a cycle declared so the audit has findings. */
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    // THE DOCUMENT IS REBUILT RATHER THAN READ OFF `base.audit`, which is
    // optional on the projection — an absent `audit` means "not run" — so
    // reaching through it would need a cast this repository does not allow.
    // `project` composes it from exactly these two fields.
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }

  it('restores the offset onto the region the redraw built', async () => {
    const page = await mounted(SEED, { project: withCycle });
    try {
      const region = (): HTMLElement | null =>
        page.element.querySelector<HTMLElement>('.ig-audit-region');
      const before = region();
      assert.ok(before !== null, 'the fixture drew no audit region, so this proves nothing');

      before.scrollTop = 120;
      assert.equal(before.scrollTop, 120, 'the fixture cannot hold an offset, so this proves nothing');

      // The plain redraw, which is the one every other redraw reduces to.
      page.handle.update();
      await flush();

      const after = region();
      assert.ok(after !== null, 'the redraw dropped the region');
      // THE REDRAW MUST ACTUALLY HAVE REPLACED IT, or the assertion below is
      // vacuous: an offset on a node nothing touched survives by itself.
      assert.notEqual(after, before, 'no redraw happened, so this test would prove nothing');
      assert.equal(after.scrollTop, 120);
      page.handle.destroy();
    } finally {
      page.dom.window.close();
    }
  });

  it('keeps focus on the panel rather than dropping it into the rail', async () => {
    // THE OFFSET AND THE FOCUS ARE TWO FACTS, and keeping one without the other
    // still moves the reader out of the zone.
    //
    // THE STOPS ARE THE PANEL AND THE BLOCK; THE SCROLLER IS THE REGION AROUND
    // THEM. They came apart when §17d gained its second surface: the tab stops
    // are in the leaves' own markup and travel with them, while the bound moved
    // up to the region. So this asks about the panel and the offset test above
    // asks about the region, and neither answers for the other.
    //
    // Neither stop can be named by a token — no keyed ancestor, no command
    // attribute — so `focusedKey()` and `commandFocusToken()` answer nothing for
    // them, and the last-resort arm, which fires on "nothing inside the surface
    // holds focus", would send a reader reading a long audit to the first rail
    // row in another zone.
    const page = await mounted(SEED, { project: withCycle });
    try {
      const before = page.element.querySelector<HTMLElement>('.ig-audit-panel');
      assert.ok(before !== null, 'the fixture drew no findings panel');
      before.focus();
      assert.equal(page.dom.window.document.activeElement, before, 'the fixture cannot hold focus');

      page.handle.update();
      await flush();

      const after = page.element.querySelector<HTMLElement>('.ig-audit-panel');
      assert.ok(after !== null, 'the redraw dropped the panel');
      assert.notEqual(after, before, 'no redraw happened, so this test would prove nothing');
      assert.equal(
        page.dom.window.document.activeElement,
        after,
        'focus left the panel — the rail fallback claimed it',
      );
      page.handle.destroy();
    } finally {
      page.dom.window.close();
    }
  });

  it('keeps focus on the refused block, which is the stop that needs it most', async () => {
    // THE SECOND STOP, AND THE ONE WITH THE STRONGEST CLAIM. Both of the refused
    // block's controls are conditional, so a block whose refusals all name
    // issues outside the drawn page — the case `findings.ts` keeps on purpose —
    // has NO focusable descendant at all, and the section itself is the only
    // thing a keyboard reader can hold. Losing it to the rail on an unrelated
    // redraw is losing the surface.
    //
    // AND IT MUST COME BACK TO THE SAME SURFACE. Restoring "whichever audit stop
    // the redraw drew first" would move a reader from the block to the panel,
    // which is why the stop is captured by name.
    function withRefusalOnly(snapshot: StoreSnapshot): WorkspaceProjection {
      return {
        ...project(snapshot),
        audit: {
          document: { issues: snapshot.issues, edges: snapshot.landed },
          graph: { cycles: [], duplicateCanonical: () => null },
          encodingRefused: [{ ref: 'nowhere-near-this-page', diagnostic: 'unparseable YAML' }],
        },
      };
    }
    const page = await mounted(SEED, { project: withRefusalOnly });
    try {
      const before = page.element.querySelector<HTMLElement>('.ig-audit-refused');
      assert.ok(before !== null, 'the fixture drew no refused block');
      // THE INERT CASE ITSELF: the ref names nothing the page carries, so the
      // block draws its card and neither control.
      assert.equal(before.querySelector('button'), null, 'the fixture drew a control, so this is not the inert case');
      assert.equal(page.element.querySelector('.ig-audit-panel'), null, 'the fixture drew a panel too');

      before.focus();
      assert.equal(page.dom.window.document.activeElement, before, 'the fixture cannot hold focus');

      page.handle.update();
      await flush();

      const after = page.element.querySelector<HTMLElement>('.ig-audit-refused');
      assert.ok(after !== null, 'the redraw dropped the block');
      assert.notEqual(after, before, 'no redraw happened, so this test would prove nothing');
      assert.equal(
        page.dom.window.document.activeElement,
        after,
        'focus left the refused block — the rail fallback claimed it',
      );
      page.handle.destroy();
    } finally {
      page.dom.window.close();
    }
  });

  it('restores nothing when the redraw draws no panel', async () => {
    // A CLEAN AUDIT HAS NO PANEL — `renderAuditPanel` returns null on no
    // findings — and the restore must be absent rather than zeroing whatever
    // else the selector might have found.
    const page = await mounted(SEED);
    try {
      assert.equal(page.element.querySelector('.ig-audit-region'), null);
      page.handle.update();
      await flush();
      assert.equal(page.element.querySelector('.ig-audit-region'), null);
      page.handle.destroy();
    } finally {
      page.dom.window.close();
    }
  });
});

describe('§17c\u2019s live region survives the redraw that would destroy it', () => {
  /**
   * The region is the ONE node this shell carries across a redraw.
   *
   * `summarySpec` mounts it always and leaves it empty until there is
   * something to say, because a status node created already carrying its text
   * is not reliably announced. This shell replaces its whole subtree on every
   * redraw, so without the carry the region is destroyed and re-created
   * populated each time — present, correct in the markup, and inert.
   */
  it('keeps the very same element across a redraw, rather than an equal one', async () => {
    const page = await mounted(SEED, { words: { ...WORDS, change: CHANGE_WORDS } });
    try {
      const region = (): Element | null =>
        page.element.querySelector('.ig-change-line[role="status"]');
      const before = region();
      assert.ok(before !== null, 'no live region was mounted');

      const inspectorBefore = page.zone('inspector');
      // The plain redraw, which is the one every other redraw reduces to.
      page.handle.update();
      await flush();

      // THE REDRAW MUST ACTUALLY HAVE HAPPENED, or the identity assertion
      // below is vacuous — it would be comparing a node nothing replaced. A
      // sibling inside the replaced subtree is the witness.
      assert.notEqual(
        page.zone('inspector'),
        inspectorBefore,
        'no redraw happened, so this test would prove nothing',
      );

      const after = region();
      assert.ok(after !== null, 'the live region did not survive the redraw');
      // IDENTITY, not equality. An equal node in the same place is exactly the
      // defect: assistive technology announces a mutation to a region it
      // already knows, and never an insertion of a populated one.
      assert.equal(after, before, 'the live region was replaced rather than carried');
      page.handle.destroy();
    } finally {
      page.dom.window.close();
    }
  });
});

describe('mountWorkspace', () => {
  let page: Mounted;

  beforeEach(async () => {
    page = await mounted();
  });

  afterEach(() => {
    page.handle.destroy();
    page.dom.window.close();
  });

  describe('done when: §17b\u2019s flip is offered once, and reaches the store', () => {
    /**
     * Select the seed’s one landed edge, the way a reader does.
     *
     * THE ISSUE FIRST. Nothing is selected on mount, so the inspector lists no
     * relationships and there is no edge row to click — the carrier has to be
     * selected before the edge it declares exists as a control.
     */
    const selectTheEdge = async (on: Mounted = page): Promise<void> => {
      const carrier = on.rows().find((row) => row.getAttribute('data-ig-key') === '1');
      assert.ok(carrier !== undefined, 'no rail row for 1');
      on.click(carrier);
      await flush();
      const row = on.element.querySelector('[data-ig-command="select-edge"]');
      assert.ok(row !== null, 'no relationship row to select an edge from');
      on.click(row);
      await flush();
    };

    it('draws exactly one flip and one statement for the selected edge', async () => {
      await selectTheEdge();
      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      // ONE CONTROL. The workspace draws it and the composed picker no longer
      // does; two would be the double-draw this work exists to remove, and it
      // is the assertion that fails if the picker ever grows one back.
      assert.equal(inspector.querySelectorAll('[data-ig-command="flip"]').length, 1);
      // ONE STATEMENT, for the same reason from the other side.
      assert.equal(inspector.querySelectorAll('.ig-relationship-kind').length, 1);
      // AND THE PICKER IS STILL THERE, so this is not passing by the chrome
      // having gone missing.
      assert.ok(inspector.querySelector('.ig-picker') !== null, 'the retype picker is gone');
    });

    it('emits one flip proposal, and no other, when it is pressed', async () => {
      await selectTheEdge();
      const flip = page.control('flip');
      assert.ok(flip !== null, 'the workspace published no flip control');
      const landed = page.store.getSnapshot().landed[0];
      assert.ok(landed !== undefined);

      page.click(flip);
      await flush();

      // ONE WRITE, AND IT IS THE FLIP. The store stamps its own `mutationId`, so
      // the assertion reads the two fields the control is responsible for
      // rather than the record's whole shape.
      const mutations = page.store.getSnapshot().writes.map((write) => write.mutation);
      assert.deepEqual(
        mutations.map(({ op, ...rest }) => ({ op, edgeId: 'edgeId' in rest ? rest.edgeId : null })),
        [{ op: 'flip', edgeId: landed.id }],
      );
    });

    it('offers no flip on a symmetric edge, and still states it', async () => {
      // THE ABSENCE IS OF THE ACT, NEVER OF THE FACT. `serialize-with` reads
      // the same both ways, so there is nothing to reverse — and the store
      // would refuse the edit as `symmetric-edge` anyway.
      const symmetric = await mounted({
        ...SEED,
        edges: [makeEdge('serialize-with', '1', '2')],
      });
      try {
        await selectTheEdge(symmetric);
        const inspector = symmetric.zone('inspector');
        assert.ok(inspector !== null);
        assert.equal(inspector.querySelectorAll('[data-ig-command="flip"]').length, 0);
        assert.equal(inspector.querySelectorAll('.ig-relationship-kind').length, 1);
      } finally {
        symmetric.handle.destroy();
        symmetric.dom.window.close();
      }
    });
  });

  describe('done when: it draws the workspace from the store’s snapshot', () => {
    it('draws the rail, the canvas, the inspector and the audit header', () => {
      for (const name of ['rail', 'canvas', 'inspector', 'header']) {
        assert.ok(page.zone(name) !== null, `no ${name} zone`);
      }
      assert.ok(page.element.querySelector('.ig-audit') !== null, 'no audit header');
      assert.deepEqual(
        page.rows().map((row) => row.getAttribute('data-ig-key')),
        ['1', '2', '3', '4'],
      );
    });

    it('installs every stylesheet the surface needs into the element, once', () => {
      const sheets = page.element.querySelectorAll('style');
      assert.equal(sheets.length, 1);
      const css = sheets[0]?.textContent ?? '';
      for (const marker of ['.ig-workspace {', '.ig-picker {', '.ig-chrome {', ':root {']) {
        assert.ok(css.includes(marker), `the sheet lacks ${marker}`);
      }
    });

    it('draws nothing selected, and says so in the host’s words', () => {
      assert.ok(page.zone('inspector')?.textContent?.includes(WORDS.nothingSelected));
      assert.equal(page.control('add'), null, 'no add control before a selection');
    });
  });

  describe('done when: a proposal through the store redraws with the edge pending and the order held', () => {
    it('marks the new edge pending-write on the canvas while the source has not answered', async () => {
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending();
      await flush();

      const pending = page.element.querySelector('[data-zone="canvas"] [data-ig-state="pending-write"]');
      assert.ok(pending !== null, 'the pending edge is not overlaid on the canvas');
      assert.equal(pending.getAttribute('data-ig-group'), makeEdge('blocked-by', '2', '3').id);
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-order'), 'held');

      page.source.settleNext('applied');
      await flush();
      assert.equal(page.element.querySelector('[data-ig-state="pending-write"]'), null, 'the dash outlives the write');
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-order'), 'settled');
    });

    it('draws one line per pair during a pending retype: the new identity dashed, the hidden old one gone', async () => {
      const old = makeEdge('blocked-by', '1', '2');
      const next = makeEdge('duplicate-of', '1', '2');
      void page.store.propose({ op: 'retype', edgeId: old.id, nextKind: 'duplicate-of' });
      await page.source.whenPending();
      await flush();

      const marks = [...page.element.querySelectorAll<HTMLElement>('[data-zone="canvas"] path.ig-edge')].map((path) => [
        path.getAttribute('data-ig-group'),
        path.getAttribute('data-ig-state'),
      ]);
      assert.deepEqual(marks, [[next.id, 'pending-write']]);
      assert.equal(page.element.querySelector(`[data-ig-group="${old.id}"]`), null, 'the store hid the old edge; the canvas must too');

      page.source.settleNext('applied');
      await flush();
      const settled = [...page.element.querySelectorAll<HTMLElement>('[data-zone="canvas"] path.ig-edge')].map((path) =>
        path.getAttribute('data-ig-group'),
      );
      assert.deepEqual(settled, [next.id]);
    });
  });

  describe('done when: destroy unsubscribes and empties the element', () => {
    it('removes what it built and stops redrawing on store changes', async () => {
      page.handle.destroy();
      assert.equal(page.element.childNodes.length, 0);

      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      assert.equal(page.element.childNodes.length, 0, 'a destroyed mount drew again');
      assert.deepEqual(page.handle.state.selection, { kind: 'none' });
    });

    it('is idempotent', () => {
      page.handle.destroy();
      page.handle.destroy();
      assert.equal(page.element.childNodes.length, 0);
    });
  });

  describe('the inspector path: select → add → kind → search → target, through the published controls', () => {
    it('reaches one proposal, which the store hands to the source', async () => {
      const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '2');
      assert.ok(row !== undefined);
      page.click(row);
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '2' });

      const add = page.control('add');
      assert.ok(add !== null, 'the add control is not drawn for a selected issue');
      // THE NAME A READER HEARS, NOT THE TEXT THE ELEMENT HOLDS. §17a draws the
      // `R` key inside this control, so `textContent` is now the label plus the
      // hint and is no longer the accessible name. The hint is `aria-hidden`
      // precisely so the name stays the host's word — an exposed one would
      // announce "begin a relationship r", a shortcut read as part of the act.
      // Both halves are asserted, because either alone passes while the other
      // is broken.
      // ASKED OF THE NODES, NOT OF A SUBTRACTED STRING. Stripping the hint with
      // `replace` takes the FIRST match anywhere, and this key is `r` — so it
      // ate the `r` in "relationship" and compared two equally wrong strings.
      const hint = add.querySelector('[aria-hidden="true"]');
      assert.ok(hint !== null, 'the key hint is exposed to assistive technology');
      assert.equal(hint.textContent, RELATE_KEY);
      assert.equal(add.firstChild?.textContent, WORDS.addRelationship);
      page.click(add);
      await flush();

      // SCOPED TO THE PANEL, because the query is no longer unambiguous. The
      // kind step is drawn in two places now — the package's panel entry here,
      // and the mount's floating chooser after a canvas drop — and an unscoped
      // `querySelector` silently retargeted from the second to the first when
      // the step moved into the package. The message said "the kind chooser is
      // not drawn" while asserting about the panel, and the floating chooser's
      // own digits stopped being pinned by anything at all.
      const panel = page.zone('inspector');
      assert.ok(panel !== null);
      const kind = panel.querySelector<HTMLElement>('.ig-kind-option[data-ig-value="blocked-by"]');
      assert.ok(kind !== null, 'the panel draws no numbered kind list');
      // THE DIGIT AND THE WORD, ASSERTED SEPARATELY, because they now come from
      // two different places on purpose. The digit is `create/keys.ts`'s own —
      // the entry is drawn from `KIND_KEYS` rather than numbered here — and the
      // word is the EDGE VOCABULARY's, the same string §16's badge draws one
      // zone away, rather than the picker's clause-register wording. The old
      // assertion pinned `1 ${PICKER_WORDS.kinds['blocked-by']}` as one string
      // and would have gone on passing if either half had been re-derived
      // locally, which is the failure this whole change is about.
      assert.equal(kind.querySelector('.ig-kind-digit')?.textContent, '1');
      // THE PAIR, COMPARED AS STRINGS. `new RegExp(label)` is the shape this
      // change removed twice elsewhere in the suite: a word carrying a regex
      // metacharacter stops being the assertion it reads as. And the pairing is
      // what matters, not the word alone — the glyph is `aria-hidden` and the
      // word beside it is the accessible name, so a copy that drops either half
      // is the failure `glyphAndLabel` exists to prevent.
      const glyph = kind.querySelector('.ig-glyph');
      assert.equal(glyph?.textContent, treatmentFor('blocked-by').glyph);
      assert.equal(glyph?.getAttribute('aria-hidden'), 'true');
      assert.equal(glyph?.nextElementSibling?.textContent, treatmentFor('blocked-by').label);
      page.click(kind);
      await flush();

      const search = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(search !== null, 'the target search is not drawn');
      assert.equal(search.getAttribute('aria-label'), WORDS.targetLabel);
      assert.equal(page.win.document.activeElement, search, 'focus did not move to the search');
      search.value = 'changelog';
      search.dispatchEvent(new page.win.Event('input', { bubbles: true }));
      await flush();

      const match = page.element.querySelector<HTMLElement>('[data-ig-command="target"][data-ig-target="3"]');
      assert.ok(match !== null, 'the search offers no match');
      page.click(match);

      const handed = await page.source.whenPending();
      // The store stamps its own id on what it hands over; the edit is the rest.
      const { mutationId, ...edit } = handed.mutation;
      assert.ok(mutationId !== '');
      assert.deepEqual(edit, { op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await flush();
      assert.equal(page.handle.state.draft.source, null, 'the draft is idle again');
    });

    it('cancel returns the draft to idle without proposing', async () => {
      const row = page.rows()[1];
      assert.ok(row !== undefined);
      page.click(row);
      await flush();
      page.click(page.control('add') ?? assert.fail('no add'));
      await flush();
      page.click(page.control('cancel') ?? assert.fail('no cancel'));
      await flush();
      assert.equal(page.handle.state.draft.source, null);
      assert.equal(page.source.pending().length, 0);
    });
  });

  describe('the keyboard path, through the package’s own key map', () => {
    it('R on a focused row begins a draft from that row and 1 types it', async () => {
      const row = page.rows()[2];
      assert.ok(row !== undefined);
      row.focus();
      assert.equal(page.win.document.activeElement, row);
      row.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: RELATE_KEY, bubbles: true }));
      await flush();
      assert.equal(page.handle.state.draft.source, '3');

      const again = page.rows().find((each) => each.getAttribute('data-ig-key') === '3');
      assert.ok(again !== undefined);
      assert.equal(page.win.document.activeElement, again, 'focus did not survive the redraw');
      again.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: '1', bubbles: true }));
      await flush();
      assert.equal(page.handle.state.draft.kind, 'blocked-by');
      const search = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(search !== null);
      assert.equal(page.win.document.activeElement, search);
    });

    it('R on the focused + add control begins from the subject that control publishes', async () => {
      // THE MOUNT-LEVEL PIN FOR `#173`, and it has to be mount-level: the
      // render-layer pin resolves `keyIntent` with `interaction: 'canvas'`, a
      // context this shell never produces while a button holds focus. What was
      // wrong is only visible where the shell answers the predicate itself.
      const row = page.rows()[1];
      assert.ok(row !== undefined);
      page.click(row);
      await flush();
      const add = page.control('add') ?? assert.fail('no add');
      add.focus();
      assert.equal(page.win.document.activeElement, add, 'the control did not take focus');
      // THE SUBJECT COMES OFF THE CONTROL, so the assertion below is about that
      // attribute rather than about whatever the selection happens to be.
      const subject = add.getAttribute('data-ig-target');
      assert.equal(subject, '2');
      add.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: RELATE_KEY, bubbles: true }));
      await flush();
      assert.equal(page.handle.state.draft.source, subject);
    });

    it('leaves every other key on the + add control to the control itself', async () => {
      // THE OTHER HALF OF THE SAME CHANGE. `add-control` admits `RELATE_KEY`
      // alone, so a digit must not fill a kind slot on a draft that has not
      // begun and `⌫` must not delete an edge the reader is not looking at.
      // Asserted through the shell rather than through the table because what
      // could regress here is the shell reporting a wider state, which the
      // table cannot see.
      const row = page.rows()[1];
      assert.ok(row !== undefined);
      page.click(row);
      await flush();
      const add = page.control('add') ?? assert.fail('no add');
      add.focus();
      for (const key of [KIND_KEYS[0]?.key ?? '1', 'Backspace', 't']) {
        add.dispatchEvent(new page.win.KeyboardEvent('keydown', { key, bubbles: true }));
        await flush();
        assert.equal(page.handle.state.draft.kind, null, `${key} reached the draft`);
        assert.equal(page.handle.state.draft.source, null, `${key} began a draft`);
      }
      // AND THE NAVIGATION ARM STAYS SHUT. It is guarded on `KeyboardContext`'s
      // `focused`, which this change widened — so an arrow here is the press
      // that would show a leak, by stepping the rail from a focused button.
      for (const key of ['ArrowDown', 'ArrowUp']) {
        add.dispatchEvent(new page.win.KeyboardEvent('keydown', { key, bubbles: true }));
        await flush();
        assert.equal(page.win.document.activeElement, add, `${key} moved focus off the control`);
      }
    });

    it('R on a together unit’s non-lead member leaves the draft visible and cancellable', async () => {
      // THE PANEL AND THE DRAFT DIVERGE WITH NO CLICK AT ALL. `R` begins from
      // the FOCUSED key, and the tree canvas draws every issue — including a
      // unit's non-lead members, which the rail folds into one row — so the
      // draft starts at `2` while `inspectorView` canonicalizes the panel onto
      // the slot's lead, `1`. The panel used to withhold the numbered list
      // whenever the two disagreed, and the cancel control sits WITH that list:
      // the reader was left holding a live draft with no pointer route to the
      // choices and none to abandoning it either. The shell draws nothing here
      // to fall back on — its floating chooser needs a canvas drop and its
      // target search needs a kind already chosen.
      page.handle.destroy();
      page = await mounted(SEED, { project: unitProject, canvas: 'tree' });
      const member = page.element.querySelector<HTMLElement>(
        '[data-zone="canvas"] [data-ig-key="2"]',
      );
      assert.ok(member !== null, 'the tree canvas draws no node for the unit’s partner');
      member.focus();
      member.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: RELATE_KEY, bubbles: true }));
      await flush();
      assert.equal(page.handle.state.draft.source, '2');

      const panel = page.zone('inspector');
      assert.ok(panel !== null);
      // The panel really is about the LEAD, so this is the diverged case rather
      // than an ordinary draft that happens to pass.
      assert.equal(panel.querySelector('.ig-inspector-title')?.textContent, 'Publish the first release');
      assert.ok(panel.querySelector('.ig-kind-list') !== null, 'the reader cannot see the choices');
      const cancel = panel.querySelector<HTMLElement>('[data-ig-command="cancel"]');
      assert.ok(cancel !== null, 'the reader cannot abandon the draft with a pointer');
      // AND THE STEP SAYS WHOSE DRAFT IT IS, because the heading above it names
      // a different issue.
      assert.equal(
        panel.querySelector('.ig-inspector-source')?.textContent,
        `${WORDS.relatingFrom} 2`,
      );

      // The cancel it drew actually cancels — a control pinned only by its
      // presence is a control that can be drawn inert.
      page.click(cancel);
      await flush();
      assert.equal(page.handle.state.draft.source, null);
      assert.equal(page.source.pending().length, 0);
    });

    it('ArrowDown moves focus along the rail, through the viewer’s navigation', async () => {
      const first = page.rows()[0];
      assert.ok(first !== undefined);
      first.focus();
      first.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await flush();
      const active = page.win.document.activeElement;
      assert.equal(active?.getAttribute('data-ig-key'), '2');
      assert.equal(active?.getAttribute('tabindex'), '0', 'the roving tab stop did not move');
    });
  });

  describe('the rail window, re-cut from the keyboard at its edges', () => {
    const many: GraphDocument = {
      issues: Array.from({ length: 60 }, (_, index) => ({ ref: String(index + 1), title: `Issue ${String(index + 1)}`, state: 'open' as const })),
      edges: [],
    };

    it('ArrowDown on the last drawn row re-cuts the window and focuses the next row', async () => {
      page.handle.destroy();
      page = await mounted(many, { railCount: 50 });
      const rows = page.rows();
      assert.equal(rows.length, 50, 'the window is the railCount');
      const last = rows[rows.length - 1];
      assert.ok(last !== undefined);
      last.focus();
      last.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await flush();
      assert.equal(page.handle.state.railStart, 10, 'the window moved to its last start');
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), '51', 'focus followed onto the next row');
      assert.equal(page.rows()[0]?.getAttribute('data-ig-key'), '11');
    });

    it('End and Home jump the window to its ends, and ArrowUp on the first drawn row re-cuts upward', async () => {
      page.handle.destroy();
      page = await mounted(many, { railCount: 50 });
      const first = page.rows()[0];
      assert.ok(first !== undefined);
      first.focus();
      first.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      await flush();
      assert.equal(page.handle.state.railStart, 10);
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), '60');

      const top = page.rows()[0];
      assert.ok(top !== undefined && top.getAttribute('data-ig-key') === '11');
      top.focus();
      top.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await flush();
      assert.equal(page.handle.state.railStart, 0, 'ArrowUp at the first drawn row re-cut the window upward');
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), '10');

      const active = page.win.document.activeElement;
      assert.ok(active !== null);
      active.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      await flush();
      assert.equal(page.handle.state.railStart, 10);
      page.win.document.activeElement?.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      await flush();
      assert.equal(page.handle.state.railStart, 0);
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), '1');
    });
  });

  describe('a small rail window still advances from the keyboard', () => {
    it('ArrowDown on the last row of a 21-row window reaches the next row', async () => {
      const many: GraphDocument = {
        issues: Array.from({ length: 60 }, (_, index) => ({ ref: String(index + 1), title: `Issue ${String(index + 1)}`, state: 'open' as const })),
        edges: [],
      };
      page.handle.destroy();
      page = await mounted(many, { railCount: 21 });
      const last = page.rows()[page.rows().length - 1];
      assert.ok(last !== undefined && last.getAttribute('data-ig-key') === '21');
      last.focus();
      last.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await flush();
      assert.ok(page.handle.state.railStart > 0, 'the window did not move');
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), '22');
    });
  });

  describe('the tree canvas carries the same overlays as the ladder', () => {
    /**
     * THE TREE BRANCH ASSIGNS `innerHTML` OVER THE WHOLE ZONE, and §17f's row is
     * that zone's first child — so it was deleted, pill included, the moment a
     * reader switched canvas. The pill is a property of the SURFACE and a
     * mounted surface is the one place a host is told to supply it, so this is
     * the state it must survive.
     *
     * THE CAPTION IS DROPPED ON PURPOSE, and that asymmetry is the point of
     * asserting both halves here. The caption states what the LADDER's canvas
     * draws; this branch draws the whole document as a tree, so its ratio would
     * be false — the same rule that keeps the caption off the refusing tiers.
     */
    it('keeps §17f’s pill across the canvas switch, and drops its caption', async () => {
      const row = () => page.element.querySelector('[data-zone="canvas"] .ig-canvas-toolbar');
      assert.ok(row() !== null, 'the neighbourhood canvas drew no toolbar to begin with');
      assert.ok(row()?.querySelector('.ig-canvas-caption') !== null, 'no caption to lose');

      page.handle.update({ canvas: 'tree' });
      await flush();
      assert.ok(row() !== null, 'the tree canvas deleted the whole toolbar');
      assert.ok(row()?.querySelector('.ig-edit-mode') !== null, 'the tree canvas deleted the pill');
      assert.equal(
        row()?.querySelector('.ig-canvas-caption') ?? null,
        null,
        'the caption states a ratio the tree canvas does not honour',
      );

      page.handle.update({ canvas: 'neighbourhood' });
      await flush();
      assert.ok(row()?.querySelector('.ig-canvas-caption') !== null, 'the caption did not come back');
    });

    /**
     * THE ROW'S OWN RULE, ON THE PATH THAT CAN BREAK IT. `canvasToolbar` refuses
     * to draw a row with neither half in it; the tree branch removes the caption
     * after the fact, so a host that worded the caption and not the pill had its
     * row emptied and then re-inserted — a sticky padded band with a border and
     * nothing inside. The rule lives in one place and this is the other path to
     * it.
     */
    it('drops the row entirely when the caption was its only content', async () => {
      const { editMode: _editMode, ...captionOnly } = WORKSPACE_WORDS.canvas ?? {
        focus: '',
        of: '',
        shown: '',
      };
      page.handle.destroy();
      page = await mounted(SEED, { words: { ...WORDS, canvas: captionOnly } });
      const row = () => page.element.querySelector('[data-zone="canvas"] .ig-canvas-toolbar');
      assert.ok(row() !== null, 'the caption-only row was never drawn');
      assert.equal(row()?.querySelector('.ig-edit-mode') ?? null, null, 'the fixture worded a pill');

      page.handle.update({ canvas: 'tree' });
      await flush();
      assert.equal(row(), null, 'an empty bordered band was left over the tree');
    });

    it('marks a pending edge and the selected edge on their badges', async () => {
      page.handle.update({ canvas: 'tree' });
      await flush();
      const edge = makeEdge('blocked-by', '1', '2');
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending();
      await flush();
      const pending = page.element.querySelector(`[data-zone="canvas"] .ig-tree [data-ig-group="${makeEdge('blocked-by', '2', '3').id}"]`);
      assert.ok(pending !== null, 'the tree draws no badge for the pending edge');
      assert.equal(pending.getAttribute('data-ig-state'), 'pending-write');

      page.handle.dispatch({ kind: 'group', id: edge.id });
      await flush();
      const selected = page.element.querySelector(`[data-zone="canvas"] .ig-tree [data-ig-group="${edge.id}"]`);
      assert.ok(selected !== null);
      assert.equal(selected.getAttribute('data-ig-state'), 'selected');
    });
  });

  describe('the canvas path: drag a node onto another, then choose the kind at the drop point', () => {
    it('reaches the same proposal as the inspector path', async () => {
      // RE-QUERIED ON EVERY STEP: the drag-start dispatch redraws the canvas, so
      // a node held from before it is detached and an event on it reaches nothing.
      const nodeOf = (key: string): Element => {
        const canvas = page.zone('canvas');
        assert.ok(canvas !== null);
        const found = [...canvas.querySelectorAll('[data-ig-key]')].find((node) => node.getAttribute('data-ig-key') === key);
        assert.ok(found !== undefined, `no canvas node for ${key}`);
        return found;
      };
      // jsdom has no hit testing, so the drop resolves through a stubbed `elementFromPoint`.
      // ONLY CONNECTED ISSUES ARE ON THE GRAPH CANVAS — the seed's #1 and #2.
      Object.defineProperty(page.win.document, 'elementFromPoint', { value: () => nodeOf('1'), configurable: true });
      const pointer = (type: string, node: Element, x: number, y: number): void => {
        node.dispatchEvent(new page.win.PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y }));
      };
      pointer('pointerdown', nodeOf('2'), 10, 10);
      pointer('pointermove', nodeOf('2'), 12, 12);
      await flush();
      assert.equal(page.handle.state.drag, null, 'a move under the threshold is not a drag');
      pointer('pointermove', nodeOf('2'), 40, 40);
      await flush();
      assert.equal(page.handle.state.drag, '2');
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-dragging'), 'true');
      pointer('pointerup', nodeOf('1'), 40, 40);
      await flush();
      assert.equal(page.handle.state.drag, null);
      assert.equal(page.handle.state.draft.source, '2');
      assert.equal(page.handle.state.draft.target, '1');
      assert.deepEqual(page.handle.state.drop, { x: 40, y: 40 });
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-dragging'), null);

      const floating = page.element.querySelector<HTMLElement>('.ig-workspace > .ig-chrome-floating');
      assert.ok(floating !== null, 'the kind chooser was not placed inside the workspace root');
      const kind = floating.querySelector<HTMLElement>('[data-ig-command="kind"][data-ig-value="blocked-by"]');
      assert.ok(kind !== null);
      // THE FLOATING CHOOSER'S OWN DIGIT AND WORD, which nothing pinned once
      // the panel's list took the unscoped query above. Its digit comes from
      // `KIND_KEYS` — the same table the keyboard reads, so a chooser cannot
      // tell the reader to press a key that resolves to another kind — and its
      // word is the PICKER's clause register rather than the vocabulary's,
      // because the sentence above it reads "#2 … <kind>". Compared as a
      // string, not as a pattern: a word with a regex metacharacter in it
      // stops being an assertion.
      assert.equal(kind.textContent, `1 ${PICKER_WORDS.kinds['blocked-by']}`);
      page.click(kind);
      const handed = await page.source.whenPending();
      const { mutationId, ...edit } = handed.mutation;
      assert.ok(mutationId !== '');
      assert.deepEqual(edit, { op: 'create', kind: 'blocked-by', from: '2', to: '1' });
    });

    it('ignores a second pointer while one is pressed, and a non-primary press', async () => {
      const canvas = page.zone('canvas');
      assert.ok(canvas !== null);
      const node = [...canvas.querySelectorAll('[data-ig-key]')].find((each) => each.getAttribute('data-ig-key') === '2');
      assert.ok(node !== undefined);
      node.dispatchEvent(new page.win.PointerEvent('pointerdown', { bubbles: true, pointerId: 7, isPrimary: false, button: 0, clientX: 0, clientY: 0 }));
      node.dispatchEvent(new page.win.PointerEvent('pointermove', { bubbles: true, pointerId: 7, isPrimary: false, button: 0, clientX: 50, clientY: 50 }));
      await flush();
      assert.equal(page.handle.state.drag, null, 'a non-primary pointer never starts a drag');
      node.dispatchEvent(new page.win.PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true, button: 2, clientX: 0, clientY: 0 }));
      node.dispatchEvent(new page.win.PointerEvent('pointermove', { bubbles: true, pointerId: 1, isPrimary: true, button: 2, clientX: 50, clientY: 50 }));
      await flush();
      assert.equal(page.handle.state.drag, null, 'a secondary button never starts a drag');
    });
  });

  describe('a selected edge', () => {
    it('draws the picker and the delete control, and delete proposes', async () => {
      const edge = makeEdge('blocked-by', '1', '2');
      const mark = page.element.querySelector<HTMLElement>(`[data-ig-group="${edge.id}"]`);
      assert.ok(mark !== null, 'the canvas draws no mark for the seeded edge');
      page.click(mark);
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'edge', edgeId: edge.id });
      assert.ok(page.element.querySelector('.ig-chrome-picker .ig-picker') !== null, 'no picker');

      page.click(page.control('delete') ?? assert.fail('no delete control'));
      const handed = await page.source.whenPending();
      const { mutationId, ...edit } = handed.mutation;
      assert.ok(mutationId !== '');
      assert.deepEqual(edit, { op: 'delete', edgeId: edge.id });
    });
  });

  describe('a refusal reaches the panel through the store, not through a fixture', () => {
    /**
     * THE JOIN NOTHING TESTED. `renderWorkspace`'s refusal capsule had a suite
     * of its own, driven by handing the renderer a `refusals` array — so the
     * derivation that BUILDS that array from a snapshot was covered by nothing
     * at all. Measured: replacing `refusals` with `[]` at the call site left
     * every one of the package's tests green, which is the whole join deletable
     * in silence.
     *
     * Driven through the real store: the refusals here are the ones
     * `store/validity.ts` actually produces, not codes chosen by hand.
     */
    const select = async (key: string): Promise<HTMLElement> => {
      const row = page.rows().find((each) => each.getAttribute('data-ig-key') === key);
      assert.ok(row !== undefined, `no rail row for ${key}`);
      page.click(row);
      await flush();
      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      return inspector;
    };

    it('states a refusal about a LANDED edge on that relationship’s own row', async () => {
      // A create of a relationship the document already carries. `project`
      // folds the refused phantom onto the landed edge, so the code marks an
      // edge that is really there — and the row has to survive, remove control
      // and all, or the reader is told about a relationship and left with
      // nothing that can undo it.
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
      const inspector = await select('1');

      const row = inspector.querySelector<HTMLElement>('.ig-relationship[data-edge="blocked-by"]');
      assert.ok(row !== null, 'the relationship row is gone');
      assert.equal(row.getAttribute('data-ig-code'), 'duplicate-edge');
      assert.equal(
        row.querySelector('.ig-relationship-reason')?.textContent,
        WORDS.refusals['duplicate-edge'],
      );
      assert.ok(row.querySelector('.ig-relationship-remove') !== null, 'the remove control went with it');
      assert.equal(inspector.querySelector('.ig-relationship-refused'), null);
    });

    it('draws a capsule for a refusal about an edge the document never got', async () => {
      // `unknown-issue`: the create names an issue the backlog does not hold,
      // so the store's phantom edge is dropped by layer 1's normalization and
      // the panel has a code with no row to attach it to. §17b's rule is that
      // such a refusal is never silently dropped.
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: 'nope' });
      const inspector = await select('1');

      const capsule = inspector.querySelector<HTMLElement>('.ig-relationship-refused');
      assert.ok(capsule !== null, 'the refusal was dropped');
      assert.equal(capsule.getAttribute('data-ig-code'), 'unknown-issue');
      assert.equal(
        capsule.querySelector('.ig-relationship-reason')?.textContent,
        WORDS.refusals['unknown-issue'],
      );
      // AND NOT ON THE PANEL OF AN ISSUE IT SAYS NOTHING ABOUT. One list serves
      // the whole surface, so this is the same render asked a second question.
      const elsewhere = await select('3');
      assert.equal(elsewhere.querySelector('.ig-relationship-refused'), null);
    });

    it('states the refusal the reader most recently caused, of two on one edge', async () => {
      // TWO REFUSALS ON ONE EDGE ARE REACHABLE, and a note here once said they
      // were not — "an edge is at most one unsettled write" is not a rule the
      // store has. `ProjectedEdge.writes` is a list because two edits touching
      // one edge compose in the order the reader made them, and one row states
      // one reason. A retype to the kind it already is, then a create of the
      // relationship that already exists: two codes, one edge, in that order.
      //
      // THE LAST WINS. The first is one the reader has read and moved past.
      // `findLast` here and `Map`'s repeated-key rule in `renderWorkspace` are
      // the same decision at the two ends of one list, and this is what holds
      // them to it.
      const edge = makeEdge('blocked-by', '1', '2');
      void page.store.propose({ op: 'retype', edgeId: edge.id, nextKind: 'blocked-by' });
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '1', to: '2' });
      const inspector = await select('1');

      const row = inspector.querySelector<HTMLElement>('.ig-relationship[data-edge="blocked-by"]');
      assert.ok(row !== null);
      assert.equal(row.getAttribute('data-ig-code'), 'duplicate-edge');
      assert.equal(
        row.querySelector('.ig-relationship-reason')?.textContent,
        WORDS.refusals['duplicate-edge'],
      );
    });

    it('draws a refusal the store’s projection has no edge for at all', async () => {
      // `unknown-edge` is the class the projection cannot carry: a delete of an
      // edge nobody has produces `{ hidden: [], drawn: [], marked: [] }`, so a
      // walk over `snapshot.projected` sees nothing and the reader's refused
      // act vanished — on exactly the refusal whose message is that the thing
      // they acted on is gone. The mutation names its own edge, and that is
      // what the capsule is keyed on.
      void page.store.propose({ op: 'delete', edgeId: makeEdge('blocked-by', '1', '3').id });
      const inspector = await select('1');

      const capsule = inspector.querySelector<HTMLElement>('.ig-relationship-refused');
      assert.ok(capsule !== null, 'a refusal with no projected edge was dropped');
      assert.equal(capsule.getAttribute('data-ig-code'), 'unknown-edge');
      // The subject's real relationship is untouched beside it.
      assert.ok(inspector.querySelector('.ig-relationship[data-edge="blocked-by"]') !== null);
    });

    it('states a gone DIRECTED edge\u2019s refusal on its SOURCE, not the end listed first', async () => {
      // A HOST PROPOSING ON THE SHARED STORE — the one route with no emit-time
      // carrier to record, because `reduceHost` never saw this edit. The panel
      // is worked out from the identity the first time the ledger is rendered,
      // and `blocked-by` is DIRECTED: `edgeIdentity` sorts the symmetric fields
      // only, so `blocked-by|3|1` still records that `3` declared the
      // relationship (§4.3). `3` is also the only panel that could have made
      // this delete — the row on `1` is inbound and inbound rows carry no
      // remove control.
      //
      // AND `1` IS THE WRONG ANSWER THIS PINS OUT. `document.issues` is ordered
      // `1,2,3,4`, so an arm that reads an identity as naming NEITHER end takes
      // the first end the document lists and states the refusal under the
      // target, for every directed pair listed in this order.
      void page.store.propose({ op: 'delete', edgeId: makeEdge('blocked-by', '3', '1').id });
      const source = await select('3');

      const capsule = source.querySelector<HTMLElement>('.ig-relationship-refused');
      assert.ok(capsule !== null, 'the refusal is stated nowhere on the declaring panel');
      assert.equal(capsule.getAttribute('data-ig-code'), 'unknown-edge');
      // AND NOT ON THE TARGET'S PANEL — the same render asked a second
      // question, which is where the unordered answer put it.
      const target = await select('1');
      assert.equal(target.querySelector('[data-ig-code]'), null, 'the refusal was stated on the target');
    });

    it('states a symmetric refusal on the end that DECLARED it, not the end its identity leads with', async () => {
      // MECHANISM A, END TO END, AND IT IS ABOUT TIME RATHER THAN PLACE.
      // `edgeIdentity` SORTS a symmetric pair, so this relationship — declared
      // from `3` — carries the identity `serialize-with|1|3`. While the document
      // holds the edge, `edge.from` answers `3`. Once a sibling write has
      // removed it, the identity is the only record left and it records the SORT
      // ORDER, not the declaring end; a revision read that first segment as the
      // carrier and stated this refusal under `1`.
      //
      // `1` IS NOT MERELY THE WRONG PANEL, IT IS THE ONE THAT COULD NOT HAVE
      // CAUSED IT. The row on `1` is inbound and inbound rows carry no remove
      // control, so `3`'s panel is the only place this delete can be made from
      // and the only place the reader can be standing when it is refused.
      page.handle.destroy();
      const symmetric = makeEdge('serialize-with', '3', '1');
      assert.equal(symmetric.from, '3');
      assert.ok(symmetric.id.startsWith('serialize-with|1|'), symmetric.id);
      page = await mounted({ issues: SEED.issues, edges: [symmetric, makeEdge('blocked-by', '1', '2')] });
      const inspector = await select('3');
      const remove = inspector.querySelector<HTMLElement>(
        `.ig-relationship-remove[data-ig-target="${symmetric.id}"]`,
      );
      assert.ok(remove !== null, 'the declaring panel offers no remove control for its own row');

      // THE SIBLING GOES FIRST AND THE READER'S SECOND, both before either
      // lands — which is the whole scenario. The store re-checks a queued edit
      // against the document as it stands when its turn comes, so the reader's
      // delete is refused `unknown-edge` on a relationship that was still there
      // when they clicked.
      void page.store.propose({ op: 'delete', edgeId: symmetric.id });
      page.click(remove);
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();

      const records = page.store.getSnapshot().writes;
      assert.equal(records.length, 1, 'the sibling did not land, or the reader’s edit did not queue');
      const refused = records[0];
      assert.ok(refused !== undefined && refused.state === 'invalid');
      assert.equal(refused.reason.code, 'unknown-edge');

      // NOTHING IS CLICKED BETWEEN THERE AND HERE.
      const after = page.zone('inspector');
      assert.ok(after !== null);
      assert.equal(
        after.querySelector('.ig-inspector-title')?.textContent,
        'Cut the changelog',
        'the panel is not the one the reader made the edit from',
      );
      const capsule = after.querySelector<HTMLElement>('.ig-relationship-refused');
      assert.ok(capsule !== null, 'the refusal is stated nowhere on the panel the reader is on');
      assert.equal(capsule.getAttribute('data-ig-code'), 'unknown-edge');
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '3' });

      // AND NOT ON THE END THE IDENTITY LEADS WITH — the same render asked a
      // second question, which is where the reconstructed answer put it.
      const far = await select('1');
      assert.equal(far.querySelector('[data-ig-code]'), null, 'the refusal was stated on the far end');
    });

    it('states a refusal ONCE when the refused edit named one edge and produced another', async () => {
      // THE DOUBLE DRAW. A retype is refused as `duplicate-edge` exactly when
      // the kind it asks for already exists between the pair — and
      // `edgeChangeFor` hides the original and marks the PRODUCED identity, so
      // the projection records the write under one id while
      // `record.mutation.edgeId` still names the other. Asked "is this record
      // already projected" by comparing edge ids, the answer was no, and the
      // panel drew the reason twice: on the produced edge's row, and again as an
      // orphan capsule for the id the reader's edit named — an edge the canvas
      // is no longer even drawing.
      page.handle.destroy();
      page = await mounted({
        issues: SEED.issues,
        edges: [makeEdge('blocked-by', '1', '2'), makeEdge('serialize-with', '1', '2')],
      });
      const original = makeEdge('blocked-by', '1', '2');
      void page.store.propose({ op: 'retype', edgeId: original.id, nextKind: 'serialize-with' });
      const inspector = await select('1');

      // ONE STATEMENT, COUNTED — the count is the assertion, because both
      // halves rendered correctly on their own and only their number was wrong.
      assert.equal(inspector.querySelectorAll('.ig-relationship-reason').length, 1);
      assert.equal(
        inspector.querySelector('.ig-relationship-refused'),
        null,
        'an orphan capsule for the id the mutation named',
      );
      // AND IT IS ON THE EDGE THE STORE MARKED, which is the produced one.
      const row = inspector.querySelector<HTMLElement>('.ig-relationship[data-ig-code]');
      assert.ok(row !== null, 'the refusal is stated nowhere at all');
      assert.equal(row.getAttribute('data-edge'), 'serialize-with');
      assert.equal(row.getAttribute('data-ig-code'), 'duplicate-edge');
    });

    it('states the refusal at the moment the reader is refused, with no second click', async () => {
      // THE MOMENT THAT ACTUALLY HAPPENS. Every test above reaches the panel by
      // selecting an issue AFTER the refused edit, and that is the one path the
      // reader does not take: they had the EDGE selected — that is what the
      // picker is drawn for — and the refusal has to be readable where they
      // already are.
      //
      // It was not. `edgeChangeFor` hides the retyped edge the instant the edit
      // is proposed, so the workspace stops drawing it, while `reconcileHost`
      // asked the LANDED document — where an edit that landed nothing has
      // changed nothing — and kept the selection on it. `inspectorView`
      // resolved that selection against the document actually being drawn,
      // found no such edge, and answered `none`; a refusal is drawn only for
      // the subject it names, and `none` names nothing. So the picker closed
      // and the panel said "nothing is selected", with the reason nowhere.
      page.handle.destroy();
      page = await mounted({
        issues: SEED.issues,
        edges: [makeEdge('blocked-by', '1', '2'), makeEdge('serialize-with', '1', '2')],
      });
      const original = makeEdge('blocked-by', '1', '2');
      const mark = page.element.querySelector<HTMLElement>(`[data-ig-group="${original.id}"]`);
      assert.ok(mark !== null, 'the canvas draws no mark for the seeded edge');
      page.click(mark);
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'edge', edgeId: original.id });

      // THE READER'S OWN ACT, through the picker the selection drew — not a
      // proposal handed to the store behind the panel's back.
      const choice = page.element.querySelector<HTMLElement>(
        '[data-ig-command="retype"][data-ig-kind="serialize-with"]',
      );
      assert.ok(choice !== null, 'the picker offers no serialize-with to retype into');
      page.click(choice);
      await flush();

      // NOTHING ELSE IS CLICKED BETWEEN THERE AND HERE.
      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      const row = inspector.querySelector<HTMLElement>('.ig-relationship[data-ig-code]');
      assert.ok(row !== null, 'the refusal is stated nowhere at the moment it happened');
      assert.equal(row.getAttribute('data-ig-code'), 'duplicate-edge');
      assert.equal(
        row.querySelector('.ig-relationship-reason')?.textContent,
        WORDS.refusals['duplicate-edge'],
      );
      // ONCE, still. The panel it returned to is the carrier's, which is the
      // same panel the deliberate selection above reaches.
      assert.equal(inspector.querySelectorAll('.ig-relationship-reason').length, 1);
      // AND THE PANEL IS THE CARRIER'S, which is what makes the row reachable:
      // the edge the reader was inspecting is not drawn any more, so a panel
      // still filtered to it can state nothing.
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '1' });
      // THE WHOLE PANEL AGREES, chrome included. The empty sentence used to be
      // drawn with the vanished edge's picker still open beneath it — one zone
      // saying nothing is selected and the next offering to retype something.
      assert.equal(inspector.querySelector('.ig-inspector-empty'), null);
      assert.equal(inspector.querySelector('.ig-picker'), null);
    });

    it('states a refusal for a create the reader began on a DIFFERENT panel', async () => {
      // THE DRAFT'S SOURCE AND THE PANEL COME APART WITHOUT ANY OF IT BEING A
      // MISTAKE. `pointed` only diverts a click to the draft once a KIND has
      // been chosen, so a click at the kind step moves the selection and leaves
      // the draft where it was — which is the behaviour the panel's own
      // "the draft starts at #n" line exists to state. The write then goes out
      // from `1` while the panel is headed by `3`, and the refused edge names
      // neither end of `3`: the reason was stated on no panel at all, and the
      // target picker vanished with the draft, so nothing on the surface said
      // the edit had happened.
      await select('1');
      page.click(page.control('add') ?? assert.fail('no add control'));
      await flush();
      const elsewhere = await select('3');
      assert.equal(
        elsewhere.querySelector('.ig-inspector-source')?.textContent,
        `${WORDS.relatingFrom} 1`,
        'the panel is not the diverged one this test needs',
      );
      const kind = elsewhere.querySelector<HTMLElement>(
        '[data-ig-command="kind"][data-ig-value="blocked-by"]',
      );
      assert.ok(kind !== null, 'the panel offers no blocked-by to choose');
      page.click(kind);
      await flush();
      // THE TARGET IS THE LAST CLICK. The create it completes — `1 blocked-by 2`
      // — is the relationship the seed already carries, so the store refuses it.
      const target = page.rows().find((row) => row.getAttribute('data-ig-key') === '2');
      assert.ok(target !== undefined);
      page.click(target);
      await flush();

      // NOTHING ELSE IS CLICKED BETWEEN THERE AND HERE.
      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      const row = inspector.querySelector<HTMLElement>('.ig-relationship[data-ig-code]');
      assert.ok(row !== null, 'the refusal is stated nowhere at the moment it happened');
      assert.equal(row.getAttribute('data-ig-code'), 'duplicate-edge');
      assert.equal(
        row.querySelector('.ig-relationship-reason')?.textContent,
        WORDS.refusals['duplicate-edge'],
      );
      // AND THE PANEL IS THE CREATE'S OWN SOURCE, which is what makes it
      // readable: the reader is returned to the issue they were relating FROM.
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '1' });
    });

    it('states a refusal a together unit\u2019s PARTNER caused, on the unit\u2019s panel', async () => {
      // THE DIVERGENCE THAT NEEDS NO CLICK AT ALL. `R` begins a draft from the
      // FOCUSED key, and the tree canvas draws a unit's non-lead members, which
      // the rail folds into one row — so the draft starts at `2` while
      // `inspectorView` canonicalizes the panel onto the slot's lead, `1`. The
      // refused edge names `2` and `3` and the panel is headed by `1`, so
      // nothing about the edge could place it.
      //
      // THE SELECTION CANNOT BE MOVED TO CLOSE THIS ONE. Selecting `2` IS
      // selecting the unit, and the panel canonicalizes it back to `1` — which
      // is why the panel has to speak for every member of its slot rather than
      // for the one key it prints.
      page.handle.destroy();
      page = await mounted(
        { issues: SEED.issues, edges: [makeEdge('blocked-by', '1', '2'), makeEdge('blocked-by', '2', '3')] },
        { project: unitProject, canvas: 'tree' },
      );
      const member = page.element.querySelector<HTMLElement>('[data-zone="canvas"] [data-ig-key="2"]');
      assert.ok(member !== null, 'the tree canvas draws no node for the unit\u2019s partner');
      member.focus();
      member.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: RELATE_KEY, bubbles: true }));
      await flush();
      assert.equal(page.handle.state.draft.source, '2');

      const kind = page.element.querySelector<HTMLElement>(
        '[data-ig-command="kind"][data-ig-value="blocked-by"]',
      );
      assert.ok(kind !== null, 'the panel offers no blocked-by to choose');
      page.click(kind);
      await flush();
      const target = page.rows().find((row) => row.getAttribute('data-ig-key') === '3');
      assert.ok(target !== undefined);
      page.click(target);
      await flush();

      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      // The panel really is the LEAD's, so this is the diverged case rather
      // than one that happens to pass because the two agree.
      assert.equal(
        inspector.querySelector('.ig-inspector-title')?.textContent,
        'Publish the first release',
      );
      const stated = inspector.querySelector<HTMLElement>('[data-ig-code]');
      assert.ok(stated !== null, 'the partner\u2019s refusal is stated nowhere');
      assert.equal(stated.getAttribute('data-ig-code'), 'duplicate-edge');
      assert.equal(
        stated.querySelector('.ig-relationship-reason')?.textContent,
        WORDS.refusals['duplicate-edge'],
      );
    });

    it('reports the refusal the reader most recently caused, not an older one on the same edge', async () => {
      // THE JOIN, NOT EITHER HALF. Two refusals can name one edge from two
      // different places in the store: a retype of an edge the document does
      // not carry marks NOTHING, so its record reaches the panel only through
      // the ledger, while a later refused create DRAWS that same edge and
      // reaches it through the projection. Assembled as "every projected
      // refusal, then every stranded one", the older record was appended last —
      // and the panel collapses repeated edges last-wins, so it reported
      // `unknown-edge` about an edit the reader had already moved past instead
      // of the `cardinality` they had just been refused.
      page.handle.destroy();
      page = await mounted({
        issues: SEED.issues,
        edges: [makeEdge('blocked-by', '1', '2'), makeEdge('duplicate-of', '1', '4')],
      });
      const absent = makeEdge('duplicate-of', '1', '3').id;
      // OLDER: a retype of an edge nobody has. `edgeChangeFor` marks nothing.
      void page.store.propose({ op: 'retype', edgeId: absent, nextKind: 'blocked-by' });
      // LATER: a create that PRODUCES that same edge, refused because `1`
      // already carries a `duplicate-of` and the field holds one reference.
      void page.store.propose({ op: 'create', kind: 'duplicate-of', from: '1', to: '3' });
      const inspector = await select('1');

      const stated = inspector.querySelector<HTMLElement>('[data-ig-code]');
      assert.ok(stated !== null, 'neither refusal was stated');
      assert.equal(stated.getAttribute('data-ig-code'), 'cardinality');
      assert.equal(
        /that relationship is already gone/.test(inspector.innerHTML),
        false,
        'the older refusal outranked the one the reader just caused',
      );
      // ONE STATEMENT, still: the two records name one edge and one edge states
      // one reason.
      assert.equal(inspector.querySelectorAll('.ig-relationship-reason').length, 1);
    });

    it('states a refusal whose produced edge never landed, at that same moment', async () => {
      // THE ROUTE THAT RULES OUT FOLLOWING THE REPLACEMENT. `cardinality`
      // refuses a retype into an occupied single-valued field, and the edge it
      // produces exists in no document — a phantom. Reconciling the selection
      // onto that produced identity, the other candidate, would name an edge
      // the landed document does not carry, which this same function drops on
      // the next render; the carrier issue is a subject that exists either way.
      page.handle.destroy();
      page = await mounted({
        issues: SEED.issues,
        edges: [makeEdge('blocked-by', '1', '2'), makeEdge('duplicate-of', '1', '3')],
      });
      const original = makeEdge('blocked-by', '1', '2');
      const mark = page.element.querySelector<HTMLElement>(`[data-ig-group="${original.id}"]`);
      assert.ok(mark !== null, 'the canvas draws no mark for the seeded edge');
      page.click(mark);
      await flush();

      const choice = page.element.querySelector<HTMLElement>(
        '[data-ig-command="retype"][data-ig-kind="duplicate-of"]',
      );
      assert.ok(choice !== null, 'the picker offers no duplicate-of to retype into');
      page.click(choice);
      await flush();

      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      const capsule = inspector.querySelector<HTMLElement>('.ig-relationship-refused');
      assert.ok(capsule !== null, 'the refusal is stated nowhere at the moment it happened');
      assert.equal(capsule.getAttribute('data-ig-code'), 'cardinality');
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '1' });
      // AND THE PICKER WENT WITH THE EDGE. The chrome is drawn from the same
      // one selection, so an edge the workspace has stopped drawing leaves no
      // picker behind offering to retype it again.
      assert.equal(inspector.querySelector('.ig-picker'), null);
    });
  });

  describe('the one selection is the workspace’s, not the store’s', () => {
    it('draws no halo for an edge the host selected on the store, and one halo for the workspace’s own', async () => {
      const edge = makeEdge('blocked-by', '1', '2');
      page.store.select([edge.id]);
      await flush();
      assert.equal(page.element.querySelector('[data-zone="canvas"] [data-ig-state]'), null, 'a store selection drew a halo');
      assert.deepEqual(page.handle.state.selection, { kind: 'none' });

      const mark = page.element.querySelector<HTMLElement>(`[data-ig-group="${edge.id}"]`);
      assert.ok(mark !== null);
      page.click(mark);
      await flush();
      const halos = [...page.element.querySelectorAll('[data-zone="canvas"] path.ig-edge[data-ig-state]')].map((path) =>
        path.getAttribute('data-ig-state'),
      );
      assert.deepEqual(halos, ['selected']);
    });
  });

  describe('the handle', () => {
    it('dispatch hands the reducer a command from the host’s own chrome', async () => {
      page.handle.dispatch({ kind: 'point', key: '4' });
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '4' });
      assert.ok(page.control('add') !== null);
    });

    it('update redraws in place with new options and keeps the selection', async () => {
      page.handle.dispatch({ kind: 'point', key: '2' });
      await flush();
      page.handle.update({ canvas: 'tree' });
      await flush();
      assert.ok(page.element.querySelector('[data-zone="canvas"] .ig-tree') !== null, 'the tree was not drawn');
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '2' });
      assert.ok(page.control('add') !== null);
    });

    it('update with no argument is a plain redraw', async () => {
      page.handle.update();
      await flush();
      assert.equal(page.rows().length, 4);
    });

    it('keeps the caret where the reader left it across an unrelated redraw', async () => {
      page.handle.dispatch({ kind: 'point', key: '2' });
      await flush();
      page.click(page.control('add') ?? assert.fail('no add'));
      await flush();
      page.click(page.element.querySelector('[data-ig-command="kind"][data-ig-value="blocked-by"]') ?? assert.fail('no kind'));
      await flush();
      const search = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(search !== null);
      search.value = 'change';
      search.dispatchEvent(new page.win.Event('input', { bubbles: true }));
      await flush();
      const typed = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(typed !== null);
      typed.setSelectionRange(1, 3);
      page.handle.update();
      await flush();
      const again = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(again !== null);
      assert.equal(page.win.document.activeElement, again);
      assert.equal(again.selectionStart, 1);
      assert.equal(again.selectionEnd, 3);
    });

    it('does not steal focus back into an open search when the reader is elsewhere', async () => {
      page.handle.dispatch({ kind: 'point', key: '2' });
      await flush();
      page.click(page.control('add') ?? assert.fail('no add'));
      await flush();
      page.click(page.element.querySelector('[data-ig-command="kind"][data-ig-value="blocked-by"]') ?? assert.fail('no kind'));
      await flush();
      assert.ok(page.element.querySelector('input[data-ig-command="target-query"]') !== null);
      const outside = page.win.document.createElement('button');
      page.win.document.body.append(outside);
      outside.focus();
      assert.equal(page.win.document.activeElement, outside);
      page.handle.update();
      await flush();
      assert.equal(page.win.document.activeElement, outside, 'a redraw while the search stands open yanked focus');
    });
  });

  describe('a first render that throws', () => {
    it('leaves the element empty and the store unsubscribed', async () => {
      page.handle.destroy();
      const element = page.win.document.createElement('div');
      page.win.document.body.append(element);
      let calls = 0;
      assert.throws(
        () =>
          mountWorkspace(element, {
            store: page.store,
            words: WORDS,
            project: () => {
              calls += 1;
              throw new Error('a host projection that cannot run');
            },
          }),
        /cannot run/,
      );
      assert.equal(element.childNodes.length, 0);
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      assert.equal(calls, 1, 'a failed mount kept its store subscription');
      assert.equal(element.childNodes.length, 0);
    });
  });
});

describe('the mount stylesheet carries structure, never a value', () => {
  const css = mountStylesheet.replace(/\/\*[\s\S]*?\*\//g, '');

  it('references only theme tokens', () => {
    const referenced = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] ?? '');
    assert.ok(referenced.length > 0);
    assert.deepEqual(referenced.filter((token) => !THEME_TOKENS.includes(token)), []);
  });

  it('writes no literal colour and no fixed length', () => {
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'a literal colour');
    assert.equal(/\brgba?\(/.test(css), false, 'a literal colour function');
    assert.equal(/\b\d+(\.\d+)?(px|rem|em|pt)\b/.test(css), false, 'a fixed length');
  });

  it('lets the first-pass takeover scroll rather than centring content out of reach', () => {
    // Evidence is host prose of no fixed length. Centring overflow in a
    // fixed-height absolute box puts the question above the container's own
    // origin, where no scroll can reach it.
    const overlay = css.slice(css.indexOf('.ig-firstpass-overlay'));
    const block = overlay.slice(0, overlay.indexOf('}'));
    assert.match(block, /overflow:\s*auto/);
    assert.equal(/justify-content:\s*center/.test(block), false, 'the takeover centres its overflow');
  });

  it('declares no animation and no transition', () => {
    assert.equal(/\banimation\b|\btransition\b|@keyframes/.test(css), false);
  });
});

describe('a pending write cannot change a rank', () => {
  it('draws the same ranks before, during and after a write the source has not answered', async () => {
    // OPTIMISTIC RENDERING, NEVER OPTIMISTIC RE-ORDERING. The store already
    // pins that `order.status` is `held` while an edit is in flight
    // (`packages/store/src/acceptance.test.ts`); this pins the half a reader
    // sees — the rail's rank column — because the mount adds an unsettled edge
    // to the drawn document's EDGES and never to its ORDER, and a fact about
    // the drawn document is proven on the drawn document.
    // A DERIVER THE EDGE MOVES, or the pin could not fail: with the harness's
    // flat deriver every write lands on the same order, and a mount that folded
    // pending edges into the drawn order would have passed.
    const page = await mounted(SEED, { derive: blockingDeriver });
    try {
      const drawn = (): (string | null)[][] =>
        page.rows().map((row) => [row.getAttribute('data-ig-key'), row.querySelector('.ig-rank')?.textContent ?? null]);
      // #1 is blocked by #2 in the seed, so it sorts last and is held.
      const before = drawn();
      assert.deepEqual(before, [['2', '1'], ['3', '2'], ['4', '3'], ['1', '4']]);

      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending();
      await flush();
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-order'), 'held');
      assert.deepEqual(drawn(), before, 'a pending write moved a rank');

      page.source.settleNext('applied');
      await flush();
      // LANDED, THE ORDER MOVES — #2 is now blocked too and sorts after #3 and
      // #4. The move happens here and only here: when the store re-derived,
      // not when the edge was drawn.
      assert.deepEqual(drawn(), [['3', '1'], ['4', '2'], ['1', '3'], ['2', '4']]);
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-order'), 'settled');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});

describe('the host facts are drawn once per workspace', () => {
  it('draws each host fact in exactly one zone, in both canvas modes', async () => {
    // Every host fact is whole-order, and the property this pins is that each
    // is stated ONCE. The graph canvas already drops `host` through the
    // ladder's focus; the tree canvas rendered the whole hosted document and
    // drew a second header and a second refresh control beside the rail's.
    //
    // RE-AIMED BY #135, NOT WEAKENED. The counts and the NOW row still belong
    // to the rail; the freshness stamp and its refresh control now belong to
    // §17a's workspace header, so "in the rail only" became the wrong shape of
    // the same claim. The counts below are unchanged — what moved is which
    // zone each answer is asserted in, which is the whole of the ruling.
    const page = await mounted(SEED, { project: hostedProject });
    try {
      const count = (selector: string): number => page.element.querySelectorAll(selector).length;
      assert.equal(count('.ig-header'), 1);
      assert.equal(count('[data-ig-command="refresh"]'), 1);
      assert.equal(count('.ig-now'), 1);
      assert.ok(page.zone('rail')?.querySelector('.ig-header') !== null, 'the header is not in the rail');
      // THE MOVE ITSELF, ASSERTED IN BOTH DIRECTIONS. One of these alone would
      // pass while the control was drawn twice.
      assert.ok(
        page.zone('header')?.querySelector('[data-ig-command="refresh"]') !== null,
        'the refresh control did not reach §17a\'s header',
      );
      assert.equal(
        page.zone('rail')?.querySelector('[data-ig-command="refresh"]'),
        null,
        'layer 1 still draws the refresh control the header now owns',
      );
      assert.ok(page.zone('rail')?.querySelector('.ig-now') !== null, 'the NOW row left the rail');

      page.handle.update({ canvas: 'tree' });
      await flush();
      assert.equal(count('.ig-header'), 1, 'the tree canvas drew a second header');
      assert.equal(count('[data-ig-command="refresh"]'), 1, 'the tree canvas drew a second refresh control');
      assert.equal(count('.ig-now'), 1);
      assert.equal(page.zone('canvas')?.querySelector('.ig-header'), null);
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});

/**
 * The first pass, composed.
 *
 * §17e's two rules are the load-bearing tests here, and both are pinned at the
 * MOUNT rather than restated from `firstpass/render.test.ts`: what that file
 * already owns is what the renderer draws from a queue, and what this file owns
 * is everything only the shell can get wrong — whether a drawn candidate
 * reaches the store, and whether anything about the backlog reaches the queue.
 */
describe('the first pass, composed behind §17a’s entry', () => {
  const FIRST_PASS_OPTION = {
    words: FIRST_PASS_WORDS,
    exit: 'leave the first pass',
    scanning: 'looking for candidates',
    scanFailed: 'the scan did not answer',
  };

  /**
   * `count` candidates over the harness backlog's own issues.
   *
   * NOT `testing/firstpass.ts`'s fixture, whose references are `100`/`101` and
   * so on: that file exists to make a POSITION error visible in the reducer
   * tests, and it does that well — but an edge naming an issue the document does
   * not carry is refused by the store as structurally invalid, so a write here
   * would never be dispatched and every settlement assertion would be about a
   * record that never left. Two fresh issues per candidate, so a wrong candidate
   * is still a wrong pair.
   */
  function pairsOver(count: number): readonly Candidate[] {
    return Array.from({ length: count }, (_unused, index) => ({
      id: `c${String(index)}`,
      kind: 'blocked-by' as const,
      from: String(index * 2 + 1),
      to: String(index * 2 + 2),
      evidence: [{ token: 'shared-path', text: `both bodies reference file ${String(index)}` }],
    }));
  }

  /** A backlog of `count` issues, with §17a's first-pass entry published. */
  function backlog(count: number): GraphDocument {
    return {
      issues: Array.from({ length: count }, (_unused, index) => ({
        ref: String(index + 1),
        title: `Issue number ${String(index + 1)}`,
        state: 'open' as const,
        priority: 2,
      })),
      edges: [],
    };
  }

  function entryProject(snapshot: StoreSnapshot): WorkspaceProjection {
    const base = project(snapshot);
    return {
      ...base,
      viewer: { ...base.viewer, host: { identity: 'acme/widgets', firstPass: 'First pass' } },
    };
  }

  /** A source whose answer is held until the test releases it. */
  function heldSource(found: readonly Candidate[]) {
    let release: (() => void) | null = null;
    let refuse: (() => void) | null = null;
    const source = {
      findCandidates: (): Promise<readonly Candidate[]> =>
        new Promise((resolve, reject) => {
          release = (): void => {
            resolve(found);
          };
          refuse = (): void => {
            reject(new Error('the tracker said no'));
          };
        }),
    };
    return {
      // NAMED `scanner`, not `source`: the page harness already carries the
      // store's `ScriptedSource` under that name, and one shadowing the other
      // would silently give a test the wrong one.
      scanner: source,
      answer: async (): Promise<void> => {
        release?.();
        await flush();
        await flush();
      },
      fail: async (): Promise<void> => {
        refuse?.();
        await flush();
        await flush();
      },
    };
  }

  async function firstPassPage(
    found: readonly Candidate[] = pairsOver(3),
    issues = 8,
    options: { derive?: OrderDeriver } = {},
  ) {
    const held = heldSource(found);
    const page = await mounted(backlog(issues), {
      project: entryProject,
      ...options,
      firstPass: { source: held.scanner, ...FIRST_PASS_OPTION },
    });
    return { ...page, ...held };
  }

  const overlayOf = (page: Mounted): HTMLElement | null =>
    page.element.querySelector<HTMLElement>('.ig-firstpass-overlay');

  /** Open the surface and let the scan answer. */
  async function open(page: Awaited<ReturnType<typeof firstPassPage>>): Promise<void> {
    const entry = page.control('first-pass');
    assert.ok(entry !== null, 'no first-pass entry was drawn');
    page.click(entry);
    await flush();
    await page.answer();
  }

  const press = (page: Mounted, key: string): void => {
    page.element.dispatchEvent(
      new page.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  };

  it('draws the entry inert when the host supplies no source', async () => {
    // The button is drawn INSIDE the surface this mount owns, so a host cannot
    // intercept it — the command is withheld here instead.
    const page = await mounted(backlog(4), { project: entryProject });
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null, 'the header entry is the host facts’ to draw');
      page.click(entry);
      await flush();
      assert.equal(overlayOf(page), null, 'a mount with no source opened a surface');
      assert.equal(page.handle.state.firstPass.phase.kind, 'closed');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('draws the scan, then the queue, and leaves on the exit control', async () => {
    const page = await firstPassPage();
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null);
      page.click(entry);
      await flush();
      assert.equal(overlayOf(page)?.getAttribute('data-ig-firstpass'), 'scanning');
      assert.ok(overlayOf(page)?.textContent?.includes(FIRST_PASS_OPTION.scanning));

      await page.answer();
      assert.equal(overlayOf(page)?.getAttribute('data-ig-firstpass'), 'open');
      assert.ok(page.element.querySelector('.ig-firstpass') !== null, 'no queue was drawn');

      const exit = page.control('first-pass-close');
      assert.ok(exit !== null);
      page.click(exit);
      await flush();
      assert.equal(overlayOf(page), null, 'the exit control left the surface up');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('says a failed scan failed, rather than saying the backlog is empty', async () => {
    const page = await firstPassPage();
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null);
      page.click(entry);
      await flush();
      await page.fail();
      assert.equal(overlayOf(page)?.getAttribute('data-ig-firstpass'), 'failed');
      assert.ok(overlayOf(page)?.textContent?.includes(FIRST_PASS_OPTION.scanFailed));
      // "the host found nothing to encode" is a different claim, and a scan that
      // never answered does not license it.
      assert.ok(!(overlayOf(page)?.textContent ?? '').includes(FIRST_PASS_WORDS.noCandidates));
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  describe('§17e: candidates are never auto-applied', () => {
    it('writes nothing for a queue that is only drawn, or only refused', async () => {
      const page = await firstPassPage();
      try {
        await open(page);
        assert.deepEqual(page.store.getSnapshot().writes, [], 'drawing a candidate wrote something');

        // The whole queue, answered without a single consent.
        for (const key of ['n', 's', 'n']) {
          press(page, key);
          await flush();
        }
        assert.deepEqual(page.store.getSnapshot().writes, [], 'refusing wrote something');
        assert.equal(
          page.element.querySelector('.ig-firstpass')?.getAttribute('data-ig-state'),
          'finished',
        );
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });

    it('writes exactly one edge for one consent, and it is the candidate on screen', async () => {
      const page = await firstPassPage();
      try {
        await open(page);
        press(page, 'y');
        await flush();
        const { writes } = page.store.getSnapshot();
        assert.equal(writes.length, 1, 'one keystroke was not one write');
        // The fixture keys each candidate's pair on its index, so answering the
        // wrong one is a visible digit rather than a plausible one.
        assert.deepEqual(writes[0]?.mutation, {
          op: 'create',
          kind: 'blocked-by',
          from: '1',
          to: '2',
          mutationId: writes[0]?.mutationId,
        });
        assert.notEqual(writes[0]?.state, 'invalid', 'the write never left the store');
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });
  });

  describe('§17e: 100% encoded is never the goal', () => {
    it('shows the reader the candidate count, and never the backlog’s', async () => {
      // What only the MOUNT can break: it holds the whole backlog and hands the
      // renderer a QueueState. `firstpass/render.test.ts` owns what the renderer
      // then does with it.
      // Twelve issues, three candidates over the first six of them — so the
      // backlog's size appears nowhere the surface could have drawn it from.
      const page = await firstPassPage(pairsOver(3), 12);
      try {
        await open(page);
        const queue = page.element.querySelector('.ig-firstpass');
        assert.equal(queue?.getAttribute('data-ig-found'), '3');
        const shown = overlayOf(page)?.textContent ?? '';
        assert.ok(!shown.includes('12'), `the backlog size reached the surface: ${shown}`);
        assert.ok(!shown.includes('%'), 'the surface drew a percentage');
        // And the chrome the mount adds around it states no quantity of its own.
        for (const node of overlayOf(page)?.querySelectorAll('[style]') ?? []) {
          assert.fail(`the mount styled ${node.className} inline`);
        }
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });
  });

  describe('the keyboard loop survives its own redraws', () => {
    it('answers more than once — every answer redraws the surface it is on', async () => {
      const page = await firstPassPage();
      try {
        await open(page);
        press(page, 'y');
        await flush();
        press(page, 'n');
        await flush();
        const queue = page.element.querySelector('.ig-firstpass');
        assert.equal(queue?.getAttribute('data-ig-answered'), '2', 'the loop stopped after one key');
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });

    it('undoes on either spelling of the delete key', async () => {
      for (const key of ['Backspace', 'Delete']) {
        const page = await firstPassPage();
        try {
          await open(page);
          press(page, 'n');
          await flush();
          press(page, key);
          await flush();
          assert.equal(
            page.element.querySelector('.ig-firstpass')?.getAttribute('data-ig-answered'),
            '0',
            `${key} did not undo`,
          );
        } finally {
          page.handle.destroy();
          page.dom.window.close();
        }
      }
    });

    it('leaves on Escape, which §17e’s "exit anytime" has no other key for', async () => {
      const page = await firstPassPage();
      try {
        await open(page);
        press(page, 'Escape');
        await flush();
        assert.equal(overlayOf(page), null, 'Escape did not leave the queue');
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });

    it('owns the keyboard while it is up, and gives it back on close', async () => {
      const page = await firstPassPage();
      try {
        // FOCUSED FOR REAL, not merely selected: a synthetic click moves no
        // focus in jsdom, and what the queue has to give back is focus.
        page.rows()[0]?.focus();
        await open(page);
        press(page, 'r');
        await flush();
        assert.equal(page.handle.state.draft.source, null, 'a create draft began under the queue');

        press(page, 'Escape');
        await flush();
        // Focus is back on a real row, so the create map reaches it again.
        assert.ok(
          [...page.element.querySelectorAll('.ig-zone')].some((zone_) =>
            zone_.contains(page.win.document.activeElement),
          ),
          'focus was left outside the workspace',
        );
        press(page, 'r');
        await flush();
        assert.equal(page.handle.state.draft.source, '1', 'the keyboard was not given back');
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });
  });

  describe('an undo takes back only what the store can take back', () => {
    it('leaves an in-flight create alone — the store declines a pending discard', async () => {
      const page = await firstPassPage();
      try {
        await open(page);
        press(page, 'y');
        await flush();
        await page.source.whenPending();
        await flush();
        assert.equal(page.store.getSnapshot().writes.length, 1);

        press(page, 'Backspace');
        await flush();
        assert.equal(
          page.store.getSnapshot().writes.length,
          1,
          'a pending write was reported as discarded',
        );
        assert.equal(
          page.element.querySelector('.ig-firstpass')?.getAttribute('data-ig-answered'),
          '0',
          'the queue did not step back',
        );
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });

    it('leaves a landed create standing — the store has no undo for one', async () => {
      // The decision this pins, and the one §17e does not make: once the write
      // has landed there is no record to discard, and proposing a compensating
      // `delete` would be this package inventing a retraction the store does not
      // have. `⌫` is the queue's position, and says so by leaving the edge.
      const page = await firstPassPage();
      try {
        await open(page);
        press(page, 'y');
        await flush();
        await page.source.whenPending();
        page.source.settleNext('applied');
        await flush();
        const landed = page.store.getSnapshot().landed.length;
        assert.equal(landed, 1, 'the create did not land');
        assert.deepEqual(page.store.getSnapshot().writes, []);

        press(page, 'Backspace');
        await flush();
        assert.equal(page.store.getSnapshot().landed.length, landed, 'the landed edge was retracted');
        assert.deepEqual(page.store.getSnapshot().writes, [], 'the undo proposed a second write');
        assert.equal(
          page.element.querySelector('.ig-firstpass')?.getAttribute('data-ig-answered'),
          '0',
          'the queue did not step back',
        );
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });

    it('discards a create the source refused', async () => {
      const page = await firstPassPage();
      try {
        await open(page);
        press(page, 'y');
        await flush();
        await page.source.whenPending();
        page.source.settleNext({ outcome: 'rejected', reason: 'the issue body is locked' });
        await flush();
        assert.equal(page.store.getSnapshot().writes[0]?.state, 'failed');

        press(page, 'Backspace');
        await flush();
        assert.deepEqual(page.store.getSnapshot().writes, [], 'the failed record survived the undo');
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });
  });

  it('states a refused answer’s reason on a panel, with nothing ever selected', async () => {
    // MECHANISM B, END TO END. The apply route built its own `first-pass-apply`
    // effect and never went through the reducer's emit funnel, so the one thing
    // that funnel does — leave the panel on the issue the write is about —
    // never happened on this route. The queue is entered from the HOST HEADER,
    // so the ordinary reader opens it with nothing selected: a refused `Y` then
    // closed the overlay back onto "nothing is selected", which states no
    // refusal at all, and §17b's rule that a refusal is never silently dropped
    // failed on the one route where the reader was never looking at the
    // relationship in the first place.
    const seeded: GraphDocument = { ...backlog(6), edges: [makeEdge('duplicate-of', '1', '2')] };
    const candidate: Candidate = {
      id: 'dup',
      kind: 'duplicate-of',
      from: '1',
      to: '3',
      evidence: [{ token: 'shared-path', text: 'both bodies reference the same file' }],
    };
    const held = heldSource([candidate]);
    const page = await mounted(seeded, {
      project: entryProject,
      firstPass: { source: held.scanner, ...FIRST_PASS_OPTION },
    });
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null, 'no first-pass entry was drawn');
      page.click(entry);
      await flush();
      await held.answer();
      assert.deepEqual(page.handle.state.selection, { kind: 'none' }, 'the queue opened with a selection');

      press(page, 'y');
      await flush();
      // REFUSED BEFORE ANY WRITE, and by a rule of the FORMAT rather than of
      // the adapter: `duplicate-of` holds one reference (§4.3) and `1` already
      // declares one, so the source is never called and the reader has only the
      // panel to learn it from.
      const records = page.store.getSnapshot().writes;
      const refused = records[0];
      assert.ok(refused !== undefined && refused.state === 'invalid', 'the answer was not refused');
      assert.equal(refused.reason.code, 'cardinality');

      const exit = page.control('first-pass-close');
      assert.ok(exit !== null, 'no exit control');
      page.click(exit);
      await flush();
      assert.equal(overlayOf(page), null, 'the overlay is still up');

      // NOTHING WAS EVER SELECTED: the only two clicks were the header's entry
      // and the overlay's exit, and the answer was a keypress.
      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      assert.equal(inspector.querySelector('.ig-inspector-empty'), null, 'the panel still says nothing is selected');
      const stated = inspector.querySelector<HTMLElement>('[data-ig-code]');
      assert.ok(stated !== null, 'the refused answer is stated nowhere');
      assert.equal(stated.getAttribute('data-ig-code'), 'cardinality');
      assert.equal(
        stated.querySelector('.ig-relationship-reason')?.textContent,
        WORDS.refusals.cardinality,
      );
      // AND THE PANEL IS THE CREATE'S OWN CARRIER — the issue whose block would
      // have declared the relationship the reader consented to.
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '1' });
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('hands focus back to the control the reader came in through', async () => {
    // §17a's entry carries no `data-ig-key`, so a keyboard user who tabbed to it
    // left `focusedKey()` null — and the queue then had nothing to hand focus
    // back to. Focus on the body reaches no listener, because the keydown
    // listener is on the mount's element, so the surface would take no key at
    // all until the reader clicked it.
    const page = await firstPassPage();
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null);
      entry.focus();
      assert.equal(page.win.document.activeElement, entry);
      page.click(entry);
      await flush();
      await page.answer();

      press(page, 'Escape');
      await flush();
      const active = page.win.document.activeElement;
      assert.notEqual(active, page.win.document.body, 'focus was left on the body');
      assert.ok(page.element.contains(active), 'focus was left outside the mount');
      assert.equal(
        active?.getAttribute('data-ig-command'),
        'first-pass',
        'focus did not return to the entry',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('closes itself when the host takes the option away mid-queue', async () => {
    // `update()` may remove the bundle while a queue is up. The overlay stops
    // being drawn either way; what must not survive is the PHASE, which is what
    // hands every key to a queue that is no longer on screen — with no control
    // left to close it.
    const page = await firstPassPage();
    try {
      await open(page);
      assert.equal(page.handle.state.firstPass.phase.kind, 'open');
      page.handle.update({ firstPass: undefined });
      await flush();
      await flush();
      assert.equal(overlayOf(page), null);
      assert.equal(page.handle.state.firstPass.phase.kind, 'closed', 'the phase stayed open');
      // And the workspace takes keys again.
      page.rows()[0]?.focus();
      press(page, 'r');
      await flush();
      assert.equal(page.handle.state.draft.source, '1', 'the workspace stayed keyboard-dead');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('withdraws the write this answer made, not another with the same pair', async () => {
    // Two detectors proposing the same pair is explicitly supported, so the
    // create's own fields do not identify a write. Here an older FAILED record
    // carries the same triple as the live one.
    const twins: readonly Candidate[] = [
      { id: 'left', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
      { id: 'right', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
    ];
    const page = await firstPassPage(twins);
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      page.source.settleNext({ outcome: 'rejected', reason: 'the issue body is locked' });
      await flush();
      const older = page.store.getSnapshot().writes[0]?.mutationId;
      assert.ok(older !== undefined, 'the first answer left no record');

      press(page, 'y');
      await flush();
      await page.source.whenPending();
      await flush();
      assert.equal(page.store.getSnapshot().writes.length, 2);

      // Undo the SECOND answer. The first record must survive it.
      press(page, 'Backspace');
      await flush();
      const left = page.store.getSnapshot().writes.map((write) => write.mutationId);
      assert.ok(left.includes(older), 'the undo discarded the older record instead');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('does not propose the same create twice when a pending undo is re-answered', async () => {
    // `discardMine` declines a pending record, so `⌫` steps the queue back and
    // leaves the write standing. Answering `Y` again must not send it a second
    // time — when the first lands, the second turns `invalid` and shows the
    // reader an error about a relationship that now exists.
    const page = await firstPassPage();
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      await flush();
      assert.equal(page.store.getSnapshot().writes.length, 1);

      press(page, 'Backspace');
      await flush();
      assert.equal(page.store.getSnapshot().writes.length, 1, 'the pending write went away');

      press(page, 'y');
      await flush();
      assert.equal(page.store.getSnapshot().writes.length, 1, 'the create was proposed twice');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('proposes nothing for a relationship the document already carries', async () => {
    // Two findings with different ids may propose the same pair — `candidates.ts`
    // keeps them apart on purpose — and a close-and-reopen starts a fresh queue
    // over a document the earlier answer has since written to. Either way the
    // store would refuse the second create, correctly, and leave the reader an
    // `invalid` record about a relationship that exists.
    const twins: readonly Candidate[] = [
      { id: 'left', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
      { id: 'right', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
    ];
    const page = await firstPassPage(twins);
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      assert.equal(page.store.getSnapshot().landed.length, 1);

      // The second finding proposes the same pair. It must not be sent.
      press(page, 'y');
      await flush();
      assert.deepEqual(
        page.store.getSnapshot().writes,
        [],
        'a duplicate create was proposed for a landed relationship',
      );
      // The queue still advanced: the reader answered, and the answer stands.
      assert.equal(
        page.element.querySelector('.ig-firstpass')?.getAttribute('data-ig-answered'),
        '2',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('lands focus in the order when the entry itself has gone', async () => {
    // Whether a backlog has a first pass to run is the host's answer and the
    // host may change it — the sandbox draws the entry only while its detector
    // finds candidates, so a completed queue whose writes land removes the very
    // control the close would return to. Focus on the body reaches no listener.
    let entryDrawn = true;
    const withEntry = (snapshot: StoreSnapshot): WorkspaceProjection => {
      const base = project(snapshot);
      return {
        ...base,
        viewer: {
          ...base.viewer,
          host: entryDrawn ? { identity: 'acme/widgets', firstPass: 'First pass' } : { identity: 'acme/widgets' },
        },
      };
    };
    const held = heldSource(pairsOver(2));
    const page = await mounted(backlog(8), {
      project: withEntry,
      firstPass: { source: held.scanner, ...FIRST_PASS_OPTION },
    });
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null);
      entry.focus();
      page.click(entry);
      await flush();
      await held.answer();
      assert.ok(page.element.querySelector('.ig-firstpass-overlay') !== null);

      // The host stops offering a first pass while the queue is up.
      entryDrawn = false;
      page.element.dispatchEvent(
        new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      await flush();
      assert.equal(page.control('first-pass'), null, 'the entry survived');
      const active = page.win.document.activeElement;
      assert.notEqual(active, page.win.document.body, 'focus was left on the body');
      assert.ok(page.element.contains(active), 'focus was left outside the mount');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('ends the lifecycle when the host swaps the scanner under it', async () => {
    // The old scan's promise still resolves under the current generation, so
    // without this the queue is drawn in the NEW bundle's words and populated by
    // the superseded scanner — and a `Y` there writes a relationship the
    // configured source never proposed.
    const page = await firstPassPage();
    try {
      await open(page);
      assert.equal(page.handle.state.firstPass.phase.kind, 'open');
      const replacement = heldSource(pairsOver(1));
      page.handle.update({ firstPass: { source: replacement.scanner, ...FIRST_PASS_OPTION } });
      await flush();
      await flush();
      assert.equal(page.handle.state.firstPass.phase.kind, 'closed', 'the old queue survived');
      assert.equal(overlayOf(page), null);
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('cancels a live draft when the queue really opens, by either route', async () => {
    for (const openIt of [
      (page: Awaited<ReturnType<typeof firstPassPage>>): void => {
        const entry = page.control('first-pass');
        assert.ok(entry !== null);
        page.click(entry);
      },
      (page: Awaited<ReturnType<typeof firstPassPage>>): void => {
        page.handle.dispatch({ kind: 'first-pass', command: { kind: 'open' } });
      },
    ]) {
      const page = await firstPassPage();
      try {
        page.click(page.rows()[0] ?? page.element);
        await flush();
        page.handle.dispatch({ kind: 'control', name: 'add' });
        page.handle.dispatch({ kind: 'control', name: 'kind', value: 'blocked-by' });
        page.handle.dispatch({ kind: 'control', name: 'target-query', value: 'issue' });
        await flush();
        assert.equal(page.handle.state.draft.source, '1');

        openIt(page);
        await flush();
        await page.answer();
        // The queue covers the target search and the chooser; a draft left
        // standing is re-entered on close with the reader's context gone.
        assert.equal(page.handle.state.draft.source, null, 'the draft survived the open');
        assert.equal(page.handle.state.targetQuery, '');
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    }
  });

  it('keeps the draft when the open is refused for want of a scanner', async () => {
    // No queue ever appears, so nothing covered the draft and nothing should
    // have taken it — the reader's source, kind, query and drop point are work.
    const page = await mounted(backlog(8), { project: entryProject });
    try {
      page.handle.dispatch({ kind: 'point', key: '1' });
      page.handle.dispatch({ kind: 'control', name: 'add' });
      page.handle.dispatch({ kind: 'control', name: 'kind', value: 'blocked-by' });
      page.handle.dispatch({ kind: 'control', name: 'target-query', value: 'issue' });
      await flush();
      assert.equal(page.handle.state.draft.source, '1');

      page.handle.dispatch({ kind: 'first-pass', command: { kind: 'open' } });
      await flush();
      await flush();
      assert.equal(page.handle.state.firstPass.phase.kind, 'closed');
      assert.equal(page.handle.state.draft.source, '1', 'a refused open took the draft');
      assert.equal(page.handle.state.targetQuery, 'issue');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('refuses a dispatched open when the host supplied no scanner', async () => {
    // `handle.dispatch` is public and reaches the reducer directly, so the DOM
    // guard does not cover it. What must not happen is a non-closed phase with
    // no overlay: invisible, and it blocks the workspace's keyboard with no
    // control to close it.
    const page = await mounted(backlog(8), { project: entryProject });
    try {
      page.handle.dispatch({ kind: 'first-pass', command: { kind: 'open' } });
      await flush();
      await flush();
      assert.equal(page.element.querySelector('.ig-firstpass-overlay'), null);
      assert.equal(page.handle.state.firstPass.phase.kind, 'closed', 'an invisible phase was left up');
      // And the workspace still takes keys.
      page.rows()[0]?.focus();
      page.element.dispatchEvent(
        new page.win.KeyboardEvent('keydown', { key: RELATE_KEY, bubbles: true, cancelable: true }),
      );
      await flush();
      assert.equal(page.handle.state.draft.source, '1', 'the workspace was left keyboard-dead');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('forgets one scanner’s decisions when the host swaps in another', async () => {
    // Two independently written detectors may reuse a CandidateId for entirely
    // different findings, and a question nobody was asked is indistinguishable
    // from one already answered.
    const page = await firstPassPage();
    try {
      await open(page);
      press(page, 'n');
      await flush();
      assert.deepEqual([...page.handle.state.firstPass.decided], ['c0']);

      const replacement = heldSource(pairsOver(1));
      page.handle.update({ firstPass: { source: replacement.scanner, ...FIRST_PASS_OPTION } });
      await flush();
      await flush();
      assert.deepEqual(
        [...page.handle.state.firstPass.decided],
        [],
        'the old scanner’s decisions would filter the new one’s questions',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('sees a landed relationship that also carries a settled write overlay', async () => {
    // A landed edge is not "an edge with no unsettled write": a failed DELETE
    // leaves the relationship there AND leaves a record on it. Inferring one
    // from the other proposed a create for a relationship that still existed.
    const twins: readonly Candidate[] = [
      { id: 'left', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
      { id: 'right', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
    ];
    const page = await firstPassPage(twins);
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      const landed = page.store.getSnapshot().landed[0];
      assert.ok(landed !== undefined, 'the create did not land');

      // A delete of that edge, refused — the edge stays, and now carries a record.
      void page.store.propose({ op: 'delete', edgeId: landed.id });
      await page.source.whenPending();
      page.source.settleNext({ outcome: 'rejected', reason: 'the issue body is locked' });
      await flush();
      assert.equal(page.store.getSnapshot().landed.length, 1, 'the edge went away');
      assert.equal(page.store.getSnapshot().writes.length, 1, 'no overlay was left on it');

      press(page, 'y');
      await flush();
      assert.equal(
        page.store.getSnapshot().writes.length,
        1,
        'a create was proposed for a relationship that is still there',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('opens for a host that updates the source and dispatches in one task', async () => {
    // Renders are coalesced on a microtask. Deciding the swap in the render that
    // OBSERVES it meant a host calling `update()` and then dispatching an open
    // in the same task had its brand-new lifecycle reset by a render still
    // holding the previous scanner — and the new scan's answer then arrived on a
    // closed phase and was dropped, so the queue never opened at all.
    const page = await firstPassPage();
    try {
      const replacement = heldSource(pairsOver(2));
      page.handle.update({ firstPass: { source: replacement.scanner, ...FIRST_PASS_OPTION } });
      page.handle.dispatch({ kind: 'first-pass', command: { kind: 'open' } });
      await flush();
      await replacement.answer();

      assert.equal(page.handle.state.firstPass.phase.kind, 'open', 'the open was reset by a stale render');
      assert.ok(page.element.querySelector('.ig-firstpass') !== null, 'no queue was drawn');
      assert.equal(
        page.element.querySelector('.ig-firstpass')?.getAttribute('data-ig-found'),
        '2',
        'the queue was not the new scanner’s',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('lets a second consent through after the first attempt failed', async () => {
    // apply → undo while pending → that request fails → apply again. Reading
    // "a record exists" as "a write is on its way" suppressed the second
    // proposal, and the queue still marked the candidate decided — so a
    // relationship the reader believed they recorded was silently absent and
    // never asked about again.
    const page = await firstPassPage();
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      await flush();

      press(page, 'Backspace');
      await flush();
      assert.equal(page.store.getSnapshot().writes.length, 1, 'the pending write went away');

      page.source.settleNext({ outcome: 'rejected', reason: 'the issue body is locked' });
      await flush();
      assert.equal(page.store.getSnapshot().writes[0]?.state, 'failed');

      press(page, 'y');
      await flush();
      const pending = page.store
        .getSnapshot()
        .writes.filter((write) => write.state === 'pending');
      assert.equal(pending.length, 1, 'the second consent proposed nothing');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('does not treat a relationship on its way out as one already there', async () => {
    // A pending DELETE leaves its edge in `landed` and marks it `pending-write`.
    // Read as "already there, or a create on its way", that suppressed the
    // reader's consent — and if the delete then landed, their answer had
    // written nothing, shown nothing, and was already decided.
    const twins: readonly Candidate[] = [
      { id: 'left', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
      { id: 'right', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
    ];
    const page = await firstPassPage(twins);
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      const landed = page.store.getSnapshot().landed[0];
      assert.ok(landed !== undefined);

      // A delete of it, left in flight.
      void page.store.propose({ op: 'delete', edgeId: landed.id });
      await page.source.whenPending();
      await flush();
      assert.equal(page.store.getSnapshot().writes.filter((w) => w.state === 'pending').length, 1);

      press(page, 'y');
      await flush();
      const creates = page.store
        .getSnapshot()
        .writes.filter((write) => write.mutation.op === 'create');
      assert.equal(creates.length, 1, 'the consent was suppressed while the edge was being removed');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('sees a pending retype as removing the relationship it replaces', async () => {
    // A retype (and a flip) removes the edge the reader is being asked about
    // just as surely as a delete does — it is simply not a delete. Enumerating
    // the operations here got this wrong; the store's own `nextDocument` does
    // not, and covers whatever operation it grows next.
    const twins: readonly Candidate[] = [
      { id: 'left', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
      { id: 'right', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
    ];
    const page = await firstPassPage(twins);
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      const landed = page.store.getSnapshot().landed[0];
      assert.ok(landed !== undefined);

      // Retyped to a different kind, left in flight: the blocked-by is going.
      void page.store.propose({ op: 'retype', edgeId: landed.id, nextKind: 'serialize-with' });
      await page.source.whenPending();
      await flush();

      press(page, 'y');
      await flush();
      const creates = page.store
        .getSnapshot()
        .writes.filter((write) => write.mutation.op === 'create');
      assert.equal(creates.length, 1, 'the consent was suppressed by an edge being retyped away');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('keeps Tab inside the takeover, at both ends', async () => {
    // `inert` covers the workspace's own zones and nothing else, so a mount
    // beside other page chrome let Tab walk out of a dialog asserting
    // `aria-modal` — and the keydown listener is on the mount's element, so
    // outside it every key stops working while the overlay is still up.
    const page = await firstPassPage();
    try {
      await open(page);
      const overlay = overlayOf(page);
      assert.ok(overlay !== null);
      const stops = [...overlay.querySelectorAll<HTMLElement>('button')];
      assert.ok(stops.length >= 4, 'the overlay drew too few controls to trap');

      // From the wrapper, Tab lands on the first control.
      press(page, 'Tab');
      assert.equal(page.win.document.activeElement, stops[0]);

      // From the last control, Tab wraps to the first rather than leaving.
      stops[stops.length - 1]?.focus();
      press(page, 'Tab');
      assert.equal(page.win.document.activeElement, stops[0], 'Tab left the dialog');

      // And Shift-Tab from the first wraps to the last.
      stops[0]?.focus();
      page.element.dispatchEvent(
        new page.win.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
      );
      assert.equal(
        page.win.document.activeElement,
        stops[stops.length - 1],
        'Shift-Tab left the dialog',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('treats a scanner that throws before it returns as a failed scan', async () => {
    // A host reading its own state or building a request can throw
    // SYNCHRONOUSLY; called directly that escapes the `.catch` and unwinds
    // through the click handler, leaving the phase `scanning` for good.
    const page = await mounted(backlog(8), {
      project: entryProject,
      firstPass: {
        source: {
          findCandidates: (): Promise<readonly Candidate[]> => {
            throw new Error('the host blew up before it returned');
          },
        },
        ...FIRST_PASS_OPTION,
      },
    });
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null);
      page.click(entry);
      await flush();
      await flush();
      const overlay = page.element.querySelector('.ig-firstpass-overlay');
      assert.equal(overlay?.getAttribute('data-ig-firstpass'), 'failed', 'the scan stuck');
      assert.ok(overlay?.textContent?.includes(FIRST_PASS_OPTION.scanFailed));
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('is a modal over the workspace, and says so', async () => {
    const page = await firstPassPage();
    try {
      await open(page);
      const overlay = overlayOf(page);
      assert.equal(overlay?.getAttribute('role'), 'dialog');
      assert.equal(overlay?.getAttribute('aria-modal'), 'true');
      // NAMED ON THE DIALOG ITSELF. The label the package puts on its own
      // `<section>` names that landmark and says nothing about its ancestor, so
      // without this assistive technology meets an unnamed modal.
      assert.equal(overlay?.getAttribute('aria-label'), FIRST_PASS_WORDS.label);
      // Focus does not move onto a control, so the swapped question needs a live
      // region or a screen reader hears nothing after the first answer.
      assert.equal(overlay?.getAttribute('aria-live'), 'polite');
      const zones = [...page.element.querySelectorAll('.ig-zone')];
      assert.ok(zones.length > 0);
      assert.ok(
        zones.every((covered) => covered.hasAttribute('inert')),
        'a zone stayed reachable under the overlay',
      );

      press(page, 'Escape');
      await flush();
      assert.ok(
        [...page.element.querySelectorAll('.ig-zone')].every((covered) => !covered.hasAttribute('inert')),
        'a zone stayed inert after the overlay came down',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});

/**
 * §17b's recovery cards, driven through the real store.
 *
 * NOT THROUGH A `recoveries` FIXTURE, which is the defect the refusal suite
 * above records paying for: hand the renderer an array and the derivation that
 * BUILDS that array from a snapshot is covered by nothing at all. Every card
 * here comes from a write the scripted source actually refused.
 */
describe('a failed or conflicted write reaches the panel it was made from', () => {
  const upstreamWith = (extra: readonly ReturnType<typeof makeEdge>[]): GraphDocument => ({
    issues: SEED.issues,
    edges: [...SEED.edges, ...extra],
  });

  const select = async (page: Mounted, key: string): Promise<HTMLElement> => {
    const row = page.rows().find((each) => each.getAttribute('data-ig-key') === key);
    assert.ok(row !== undefined, `no rail row for ${key}`);
    page.click(row);
    await flush();
    const inspector = page.zone('inspector');
    assert.ok(inspector !== null);
    return inspector;
  };

  const cards = (inspector: HTMLElement): HTMLElement[] => [
    ...inspector.querySelectorAll<HTMLElement>('.ig-recovery'),
  ];

  /**
   * The one element matching `selector`, narrowed by an assertion.
   *
   * NOT A CAST. This file had none before these suites and the repository bans
   * them outright; `assert.ok(x !== null)` is both the rule and this file's own
   * idiom, and it also turns "the control is missing" into a named failure
   * rather than a null dereference three lines later.
   */
  const one = (root: HTMLElement, selector: string): HTMLElement => {
    const node = root.querySelector<HTMLElement>(selector);
    assert.ok(node !== null, `no ${selector}`);
    return node;
  };

  const inspectorOf = (page: Mounted): HTMLElement => {
    const zone = page.zone('inspector');
    assert.ok(zone !== null, 'no inspector zone');
    return zone;
  };

  it('draws a failed write with retry and discard, and no view-diff', async () => {
    const page = await mounted();
    try {
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending();
      page.source.settleNext({ outcome: 'rejected', reason: 'the tracker said no' });
      await flush();

      const inspector = await select(page, '3');
      const card = cards(inspector)[0];
      assert.ok(card !== undefined, 'no recovery card for a failed write');
      assert.equal(card.getAttribute('data-ig-state'), 'failed');
      assert.equal(card.querySelector('.ig-recovery-reason')?.textContent, 'the tracker said no');

      // THE GRAMMAR TABLE'S OWN ANSWER, not a list written in the test either:
      // if `OVERLAY_TREATMENTS.failed` ever offered a third thing, this moves
      // with it rather than going red for the wrong reason.
      assert.deepEqual(
        [...card.querySelectorAll('.ig-recovery-action')].map((node) =>
          node.getAttribute('data-ig-command'),
        ),
        ['retry', 'discard'],
      );
      // §17b gives a failed write no second version to look at, and the word
      // for a plain retry rather than the one that re-reads first.
      assert.equal(card.querySelector('[data-ig-command="view-diff"]'), null);
      assert.equal(
        card.querySelector('[data-ig-command="retry"]')?.textContent,
        WORKSPACE_WORDS.recovery.retry,
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('draws a conflict with all three resolutions, and names the one that re-reads', async () => {
    const page = await mounted();
    try {
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending();
      page.source.settleNext({
        outcome: 'conflict',
        upstream: upstreamWith([makeEdge('blocked-by', '2', '3')]),
      });
      await flush();

      const inspector = await select(page, '3');
      const card = cards(inspector)[0];
      assert.ok(card !== undefined, 'no recovery card for a conflict');
      assert.equal(card.getAttribute('data-ig-state'), 'conflict');
      assert.deepEqual(
        [...card.querySelectorAll('.ig-recovery-action')].map((node) =>
          node.getAttribute('data-ig-command'),
        ),
        ['view-diff', 'retry', 'discard'],
      );
      // TWO DIFFERENT CALLS, TWO DIFFERENT WORDS. `retryOnLatest` re-reads and
      // adopts the newest document before re-dispatching, and a card labelled
      // with the plain `retry` word would be telling the reader it does less
      // than it does.
      assert.equal(
        card.querySelector('[data-ig-command="retry"]')?.textContent,
        WORKSPACE_WORDS.recovery.retryOnLatest,
      );

      // EVERY BUTTON NAMES ITS WRITE. Without `data-ig-target` the reducer's
      // retry and discard arms return no effect at all — the controls render,
      // read correctly, and do nothing, while every assertion above still
      // passes.
      for (const action of card.querySelectorAll('.ig-recovery-action')) {
        assert.ok(
          (action.getAttribute('data-ig-target') ?? '').length > 0,
          `${String(action.getAttribute('data-ig-command'))} names no write`,
        );
      }
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('offers nothing that merges the two versions, in markup or in command', async () => {
    const page = await mounted();
    try {
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending();
      page.source.settleNext({
        outcome: 'conflict',
        upstream: upstreamWith([makeEdge('blocked-by', '2', '3')]),
      });
      await flush();
      const inspector = await select(page, '3');
      const card = cards(inspector)[0];
      assert.ok(card !== undefined);
      page.click(one(card, '[data-ig-command=\"view-diff\"]'));
      await flush();

      // OVER THE RENDERED MARKUP AND THE COMMANDS, which is the idiom
      // `overlay/render.test.ts` already uses for this property — NOT over
      // source text, where `merge` legitimately appears in the comments that
      // state this very rule.
      const opened = cards(inspectorOf(page))[0];
      assert.ok(opened !== undefined);
      assert.equal(/merge|combine|accept-both/i.test(opened.innerHTML), false);
      for (const action of opened.querySelectorAll('[data-ig-command]')) {
        assert.equal(
          /merge|combine|accept-both/i.test(action.getAttribute('data-ig-command') ?? ''),
          false,
        );
      }
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('shows both sides when the difference is opened, and combines neither', async () => {
    const page = await mounted();
    try {
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending();
      page.source.settleNext({
        outcome: 'conflict',
        upstream: upstreamWith([makeEdge('blocked-by', '3', '2')]),
      });
      await flush();
      let inspector = await select(page, '3');
      assert.equal(inspector.querySelector('.ig-recovery-diff'), null, 'the diff opened itself');

      page.click(one(inspector, '[data-ig-command=\"view-diff\"]'));
      await flush();
      inspector = inspectorOf(page);

      const diff = inspector.querySelector('.ig-recovery-diff');
      assert.ok(diff !== null, 'view-diff drew nothing');
      const sides = [...diff.querySelectorAll('.ig-recovery-side-name')].map(
        (node) => node.textContent,
      );
      // THE READER'S EDIT AND UPSTREAM'S, UNDER SEPARATE HEADINGS. `landed`
      // cannot hold the reader's edge at all — `conflictDiff` rebuilds it from
      // the mutation — so its presence here is the whole join working.
      assert.ok(sides.includes(WORKSPACE_WORDS.recovery.mineOnly), 'the reader’s own edit is missing');
      assert.ok(sides.includes(WORKSPACE_WORDS.recovery.upstreamOnly), 'the upstream edge is missing');

      // A SECOND PRESS CLOSES IT. The control says `aria-pressed`, so it has to
      // be a toggle rather than a one-way door.
      page.click(one(inspector, '[data-ig-command=\"view-diff\"]'));
      await flush();
      assert.equal(inspectorOf(page).querySelector('.ig-recovery-diff'), null);
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('closes an open difference when the record stops being a conflict', async () => {
    // ITS LIFETIME IS THE CONFLICT'S, NOT THE LEDGER'S. `discardMine` drops the
    // record; a `retry on latest` would reserve it as `pending` and a refused
    // resolve would leave it `invalid` — in both of those the record is STILL
    // in the ledger with its held document gone, which is why the shell's rule
    // is "still a conflict" rather than "still there".
    const page = await mounted();
    try {
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending();
      page.source.settleNext({
        outcome: 'conflict',
        upstream: upstreamWith([makeEdge('blocked-by', '2', '3')]),
      });
      await flush();
      const inspector = await select(page, '3');
      page.click(one(inspector, '[data-ig-command=\"view-diff\"]'));
      await flush();
      assert.ok(inspectorOf(page).querySelector('.ig-recovery-diff') !== null);

      page.click(one(inspectorOf(page), '[data-ig-command="discard"]'));
      await flush();
      const after = inspectorOf(page);
      assert.equal(after.querySelector('.ig-recovery'), null, 'the card outlived the record');
      assert.equal(after.querySelector('.ig-recovery-diff'), null, 'the diff outlived the record');
      assert.equal(page.handle.state.diffOpen, null);
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('closes an open difference when the record is RESERVED, not only when it leaves', async () => {
    // THE MUTATION THE `discardMine` TEST CANNOT KILL. Discarding removes the
    // record from the ledger, so "still in the ledger" and "still a conflict"
    // agree there and a prune written either way passes. `retryOnLatest`
    // separates them: the store reserves the record as `pending` SYNCHRONOUSLY,
    // so it is still in the ledger with its held document gone — and a region
    // left open over it is a difference the store can no longer answer for.
    const page = await mounted();
    try {
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending();
      page.source.settleNext({
        outcome: 'conflict',
        upstream: upstreamWith([makeEdge('blocked-by', '2', '3')]),
      });
      await flush();
      const inspector = await select(page, '3');
      page.click(one(inspector, '[data-ig-command="view-diff"]'));
      await flush();
      assert.ok(inspectorOf(page).querySelector('.ig-recovery-diff') !== null, 'the diff never opened');

      page.click(one(inspectorOf(page), '[data-ig-command="retry"]'));
      await flush();

      // STILL THERE, AND NO LONGER A CONFLICT — which is exactly the state the
      // weaker rule would have kept the region open through.
      const record = page.store.getSnapshot().writes[0];
      assert.equal(record?.mutationId !== undefined, true, 'the record left the ledger');
      assert.notEqual(record?.state, 'conflict');
      assert.equal(page.handle.state.diffOpen, null, 'the difference outlived its conflict');
      assert.equal(inspectorOf(page).querySelector('.ig-recovery-diff'), null);
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('says why a retry on latest could not even read, and only on that card', async () => {
    // MEASURED: `refreshError: null` passed every test. The field also used to
    // read `snapshot.hydrationError` unconditionally — which the store sets from
    // ANY failed read and attributes to no mutation, so it painted "could not
    // read the newest version" on cards whose button nobody pressed.
    let readFails = false;
    const page = await mounted(SEED, {
      wrap: (source) => ({
        ...source,
        hydrate: () =>
          readFails ? Promise.reject(new Error('the tracker did not answer')) : source.hydrate(),
      }),
    });
    try {
      // TWO CONFLICTS, so "only on that card" is a claim the fixture can test.
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending();
      page.source.settleNext({ outcome: 'conflict', upstream: upstreamWith([makeEdge('blocked-by', '2', '3')]) });
      await flush();
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '2' });
      await page.source.whenPending();
      page.source.settleNext({ outcome: 'conflict', upstream: upstreamWith([makeEdge('blocked-by', '2', '3')]) });
      await flush();

      // BOTH CARDS ON ONE PANEL, or "only that card" is answered by the panel
      // filter rather than by the attribution under test. `3` carries the first
      // conflict; the second is a create FROM `4` TO `2`, so selecting `4`
      // would split them. Instead both are stated on `3` only if `3` carries
      // both — it does not — so the honest fixture selects the carrier of the
      // one under test and asserts the OTHER card is absent from it.
      const first = page.store.getSnapshot().writes[0];
      assert.ok(first !== undefined);
      await select(page, '3');
      readFails = true;
      page.handle.dispatch({ kind: 'control', name: 'retry', target: first.mutationId });
      await flush();
      await flush();

      const snapshot = page.store.getSnapshot();
      assert.equal(snapshot.hydrationError !== undefined, true, 'the read did not fail');
      assert.equal(
        snapshot.writes.filter((record) => record.state === 'conflict').length,
        2,
        'the fixture needs two standing conflicts for "only that card" to mean anything',
      );
      const drawn = [...page.element.querySelectorAll('.ig-recovery-refresh-error')];
      assert.equal(drawn.length, 1, 'the read failure was drawn on the wrong number of cards');
      assert.match(drawn[0]?.textContent ?? '', /the tracker did not answer/);
      assert.match(drawn[0]?.textContent ?? '', new RegExp(WORKSPACE_WORDS.recovery.retryFailed));

      // AND NOT ON THE OTHER CONFLICT, which is standing with the same
      // snapshot-level hydration error behind it and no press of its own.
      const other = page.store.getSnapshot().writes.find((record) => record.mutationId !== first.mutationId);
      assert.ok(other !== undefined);
      const otherPanel = await select(page, '4');
      assert.ok(otherPanel.querySelector('.ig-recovery') !== null, 'the other conflict has no card');
      assert.equal(
        otherPanel.querySelector('.ig-recovery-refresh-error'),
        null,
        'a read nobody asked for was blamed on this card',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('states a partner’s write on the together unit’s lead panel, diff and all', async () => {
    // THE CASE A SINGLE-KEY SCOPE WOULD LOSE. `inspectorView` folds `2` onto
    // `1`'s slot, so an edit made from `2` is stated on `1`'s panel — and the
    // difference drawn there has to be narrowed by the SAME key set that
    // entitled it, or the card lands on the right panel showing nothing.
    const page = await mounted(SEED, { project: unitProject });
    try {
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '4' });
      await page.source.whenPending();
      // THE UPSTREAM EDGE TOUCHES THE LEAD AND NOT THE CARRIER, which is what
      // makes this pin discriminate. The edit went out from `2`, so a diff
      // narrowed by the carrier ALONE keeps only edges touching `2` and drops
      // this one — on the very panel entitled to state it. Narrowed by the
      // panel's key set it survives. Measured: with an upstream edge touching
      // `2`, both rules pass and the test proves nothing.
      page.source.settleNext({
        outcome: 'conflict',
        upstream: upstreamWith([makeEdge('blocked-by', '1', '3')]),
      });
      await flush();

      const inspector = await select(page, '1');
      const card = cards(inspector)[0];
      assert.ok(card !== undefined, 'the partner’s conflict was stated nowhere');

      page.click(one(card, '[data-ig-command=\"view-diff\"]'));
      await flush();
      const diff = inspectorOf(page).querySelector('.ig-recovery-diff');
      assert.ok(diff !== null, 'the diff drew nothing on the lead’s panel');
      assert.ok(
        [...diff.querySelectorAll('.ig-recovery-side-name')]
          .map((node) => node.textContent)
          .includes(WORKSPACE_WORDS.recovery.upstreamOnly),
        'the partner’s upstream edge was narrowed away on the panel entitled to it',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});

/**
 * The half of §17b that is about the ORDER rather than about a card.
 *
 * `a pending write cannot change a rank` above pins the PENDING state. These
 * are the two settled ones, and they need the same `blockingDeriver`: with the
 * harness's flat deriver every write lands on the same order, so a mount that
 * folded an unsettled edge into the drawn order would pass regardless.
 */
describe('a failed or conflicted write cannot change a rank either', () => {
  const drawnRanks = (page: Mounted): (string | null)[][] =>
    page.rows().map((row) => [row.getAttribute('data-ig-key'), row.querySelector('.ig-rank')?.textContent ?? null]);

  it('draws the same ranks after a write the tracker refused', async () => {
    const page = await mounted(SEED, { derive: blockingDeriver });
    try {
      const before = drawnRanks(page);
      assert.deepEqual(before, [['2', '1'], ['3', '2'], ['4', '3'], ['1', '4']]);

      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending();
      page.source.settleNext({ outcome: 'rejected', reason: 'refused upstream' });
      await flush();

      // THE PRECONDITION, NOT A CAST WRAPPED IN AN ASSERTION. The earlier form
      // read `(page.zone(...) as HTMLElement) !== null`, which the cast makes
      // statically true — so only the ledger half was ever asserted.
      assert.equal(
        page.store.getSnapshot().writes.length,
        1,
        'the failed record is not in the ledger, so this pin proves nothing',
      );
      assert.deepEqual(drawnRanks(page), before, 'a failed write moved a rank');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('draws the same ranks while a conflict is unresolved', async () => {
    const page = await mounted(SEED, { derive: blockingDeriver });
    try {
      const before = drawnRanks(page);
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending();
      // AN UPSTREAM THAT WOULD MOVE THE ORDER IF IT WERE ADOPTED — `4` blocked
      // by `1` sorts `4` last under this deriver. It is held, never adopted, so
      // the rail must not move: adopting a held document is the auto-merge §17b
      // forbids, and it would be visible right here.
      page.source.settleNext({
        outcome: 'conflict',
        upstream: { issues: SEED.issues, edges: [...SEED.edges, makeEdge('blocked-by', '4', '1')] },
      });
      await flush();

      assert.equal(page.store.getSnapshot().writes[0]?.state, 'conflict');
      assert.deepEqual(drawnRanks(page), before, 'a conflict moved a rank');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});

/**
 * #149: focus survives the redraw for a command control, so the keyboard loop
 * lives through an edit.
 *
 * ## Why the disclosure is the case that proves it
 *
 * `view-diff` is the first control in the package whose design needs a SECOND
 * press — everything else acts once, so losing focus afterwards was survivable
 * and invisible. Open a conflict's difference with the keyboard and, before the
 * fix, the control that would close it no longer had focus and no key reached
 * the mount to get back to it.
 *
 * ## `.click()` rather than a constructed event, and why that is the keyboard path
 *
 * `onKeydown` DOES bind Enter and Space now (`#158`), and this paragraph used to
 * say the opposite — that binding them would fire twice in a real browser, once
 * from the mount's handler and once from the button's own NATIVE activation.
 * That objection was right about the mechanism and wrong about the conclusion:
 * a `<button>`'s activation behaviour is the keydown's DEFAULT ACTION, so the
 * arm's `preventDefault()` cancels it and only one dispatch survives. Kept as
 * history rather than deleted, because the double fire is exactly what returns
 * if a future arm ever resolves a control without reaching that call.
 *
 * This suite still activates with `.click()`, and that is still right HERE:
 * these tests are about focus surviving a redraw, so they want the shortest
 * route to an activation rather than a second copy of `#158`'s own keyboard
 * coverage — which lives further down and drives the loop with keys alone.
 *
 * `HTMLElement.click()` is the activation behaviour Enter reaches, so the
 * INTERACTION under test constructs no event of its own and no pointer gesture
 * is simulated — focus is established, activated and asserted at every step.
 *
 * Be exact about the bound: reaching the state under test needs a rail row
 * selected, and `conflicted()` does that with `page.click(row)`, which IS a
 * `MouseEvent`. That is fixture setup, not the behaviour being asserted, and
 * pretending otherwise would be the kind of claim this suite exists to replace.
 * What the assertions cover is everything after the disclosure has focus.
 */
describe('a command control keeps focus across the redraw it causes', () => {
  const conflicted = async (page: Mounted): Promise<HTMLElement> => {
    void page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
    await page.source.whenPending();
    page.source.settleNext({
      outcome: 'conflict',
      upstream: { issues: SEED.issues, edges: [...SEED.edges, makeEdge('blocked-by', '2', '3')] },
    });
    await flush();
    const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '3');
    assert.ok(row !== undefined, 'no rail row for 3');
    page.click(row);
    await flush();
    const inspector = page.zone('inspector');
    assert.ok(inspector !== null, 'no inspector zone');
    return inspector;
  };

  const viewDiff = (page: Mounted): HTMLElement => {
    const zone = page.zone('inspector');
    assert.ok(zone !== null, 'no inspector zone');
    const node = zone.querySelector<HTMLElement>('[data-ig-command="view-diff"]');
    assert.ok(node !== null, 'no view-diff control');
    return node;
  };

  it('opens the difference, keeps focus, and can be closed by pressing it again', async () => {
    const page = await mounted();
    try {
      await conflicted(page);

      const open = viewDiff(page);
      assert.equal(open.getAttribute('aria-expanded'), 'false');
      open.focus();
      assert.equal(page.win.document.activeElement, open, 'the control never took focus');

      open.click();
      await flush();

      // THE ASSERTION THIS ISSUE EXISTS FOR. Before the fix `activeElement` was
      // `BODY` here: the node was destroyed by `surface.innerHTML` and no
      // restore arm covered a command control outside the first-pass overlay.
      const opened = viewDiff(page);
      assert.equal(opened.getAttribute('aria-expanded'), 'true', 'the difference did not open');
      assert.equal(
        page.win.document.activeElement,
        opened,
        `focus was lost across the redraw — activeElement is ${page.win.document.activeElement?.nodeName ?? 'null'}`,
      );

      // THE SECOND PRESS, which is the one that was unreachable.
      opened.click();
      await flush();
      const closed = viewDiff(page);
      assert.equal(closed.getAttribute('aria-expanded'), 'false', 'the difference did not close');
      assert.equal(page.win.document.activeElement, closed, 'focus was lost closing it');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('restores the SAME option when one command is published by several', async () => {
    // MEASURED REGRESSION. A token of zone + command + target alone matched the
    // first `kind` button in document order, because the five options carry one
    // command and no target and differ only by `data-ig-value`. Focus the
    // `together-with` option, let an unrelated redraw land, and focus came back
    // on `blocked-by` — worse than the body it replaced, because the reader's
    // next Enter then encodes a DIFFERENT relationship rather than nothing.
    const page = await mounted();
    try {
      const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '1');
      assert.ok(row !== undefined, 'no rail row for 1');
      page.click(row);
      await flush();
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      page.click(add);
      await flush();

      const options = [...page.element.querySelectorAll<HTMLElement>('[data-ig-command="kind"]')];
      const wanted = options.find((node) => node.getAttribute('data-ig-value') === 'together-with');
      assert.ok(wanted !== undefined, 'no together-with option');
      assert.ok(options.length > 1, 'only one option — the namesake case is not exercised');
      wanted.focus();

      // AN UNRELATED REDRAW: a write settling elsewhere, which is the ordinary
      // way a render lands while the reader is mid-draft.
      page.handle.update();
      await flush();

      const now = page.win.document.activeElement;
      assert.ok(now !== null);
      assert.equal(
        now.getAttribute('data-ig-value'),
        'together-with',
        `focus moved to a different option (${now.getAttribute('data-ig-value') ?? 'none'})`,
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('keeps a press reaching the mount even when the control resolves itself', async () => {
    // THE OTHER HALF, and it needs its own case: `refocusCommand` correctly
    // answers "gone" for a control that removes itself — `discard` takes its
    // whole card away — and without a last resort focus then falls to the body
    // exactly as before. Every one-shot control has this shape, so fixing only
    // the disclosure would have left the class alive.
    const page = await mounted();
    try {
      await conflicted(page);
      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      const discard = inspector.querySelector<HTMLElement>('[data-ig-command="discard"]');
      assert.ok(discard !== null, 'no discard control');
      discard.focus();
      discard.click();
      await flush();

      const now = page.win.document.activeElement;
      assert.ok(now !== null && page.element.contains(now), 'focus left the workspace entirely');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('restores the right one of two controls that publish the same identity', async () => {
    // THE THIRD SHAPE OF THIS BUG, and the reason the token carries an ordinal
    // rather than a fourth attribute. The scale ladder draws a capsule button
    // and a search-result button with the SAME command and the same lead in one
    // zone, so no attribute separates them at all — order is what is left.
    //
    // A CHAINED BACKLOG, because the collision only exists above the direct
    // tier: below it the ladder draws no capsules and there is nothing to
    // collide with. An earlier revision of this test used the ordinary fixture,
    // where two `target` matches differ by `data-ig-target` — so the filter
    // already narrowed to one, the ordinal never did any work, and the test
    // passed with the fix reverted. That is the fifth guard on this branch that
    // could not fail, so this one is pinned against its own falsification below.
    const size = 90;
    const page = await mounted({
      issues: Array.from({ length: size }, (_unused, index) => ({
        ref: String(index + 1),
        title: `Release task ${index + 1}`,
        state: 'open' as const,
        priority: 2,
      })),
      edges: Array.from({ length: size - 1 }, (_unused, index) =>
        makeEdge('blocked-by', String(index + 1), String(index + 2)),
      ),
    });
    try {
      const search = page.element.querySelector<HTMLInputElement>(
        'input[data-ig-command="search"]',
      );
      assert.ok(search !== null, 'no canvas search');
      search.value = 'Release task 3';
      search.dispatchEvent(new page.win.Event('input', { bubbles: true }));
      await flush();

      const duplicates = [
        ...page.element.querySelectorAll<HTMLElement>('[data-ig-command="focus"]'),
      ].filter((node) => node.getAttribute('data-ig-target') === '1');
      assert.ok(
        duplicates.length > 1,
        `only ${String(duplicates.length)} controls share this identity — no ambiguity to test`,
      );

      const second = duplicates[1];
      assert.ok(second !== undefined);
      second.focus();
      page.handle.update();
      await flush();

      const again = [
        ...page.element.querySelectorAll<HTMLElement>('[data-ig-command="focus"]'),
      ].filter((node) => node.getAttribute('data-ig-target') === '1');
      const active = page.win.document.activeElement;
      assert.ok(active !== null, 'nothing holds focus');
      assert.equal(
        again.findIndex((node) => node === active),
        1,
        'focus moved to a different control publishing the same identity',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('keeps focus on a toggle that redraws itself with the other command', async () => {
    // THIS PULL REQUEST'S OWN DEFECT, wearing a different attribute value. The
    // isolated-issues chip is one button whose command flips between
    // `open-isolated` and `close-isolated`, so an exact command match rejected
    // the replacement and dropped the reader onto the rail — on a control that,
    // like the disclosure, exists to be pressed a second time.
    // A DOCUMENT WITH NO EDGES, because the chip is drawn only when something is
    // isolated. An earlier revision of this test used the shared fixture and
    // returned early when the chip was absent — it always was, so the test
    // asserted nothing while reading as coverage. That is the same "a rule that
    // cannot fail" this pull request had to fix three times already, so it is
    // spelled out rather than quietly corrected.
    const page = await mounted({ issues: SEED.issues, edges: [] });
    try {
      const chip = page.control('open-isolated');
      assert.ok(chip !== null, 'no isolated chip was drawn — the test would prove nothing');
      chip.focus();
      chip.click();
      await flush();

      const now = page.win.document.activeElement;
      assert.ok(now !== null);
      assert.equal(
        now.getAttribute('data-ig-command'),
        'close-isolated',
        'focus left the toggle when it redrew with the other command',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('answers the kind chooser from the keyboard with no rail row to stand on', async () => {
    // `#152`. The advertised loop is `R → 1–5 → search → ⏎`, "full loop, no
    // pointer" — and its second step was dead wherever focus was not on a rail
    // row. `interaction()` read focus alone and `focusedKey()` answers only for
    // a keyed row, so the chooser classified `elsewhere` and `keyIntent`
    // returned `none` for the chooser's OWN digits.
    //
    // THE RAIL IS EMPTIED DELIBERATELY, because that is the case with no repair
    // available from focus: with the audit filter on and nothing flagged there
    // is no row for the mount to fall back to, while the inspector stays
    // perfectly usable. The selection is made FIRST, while rows still exist, so
    // the inspector keeps a subject and draws `+ add` after the rail empties.
    const page = await mounted();
    try {
      const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '1');
      assert.ok(row !== undefined, 'no rail row for 1');
      page.click(row);
      await flush();

      const filter = page.element.querySelector<HTMLElement>('[data-ig-audit-filter]');
      assert.ok(filter !== null, 'no audit filter control');
      page.click(filter);
      await flush();
      assert.equal(page.rows().length, 0, 'the rail still has rows — the case is not reproduced');

      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      add.focus();
      page.click(add);
      await flush();

      // WHERE FOCUS ACTUALLY IS, asserted rather than assumed — and it is NOT
      // inside the chooser. The last-resort restore takes the zone's FIRST
      // command control and the inspector draws `clear` above the kind list, so
      // a predicate conjoining the draft with `closest(<the chooser>)` would be
      // false here and the digits would still be dead. Pinning the landing spot
      // is what stops that predicate being reintroduced as an "improvement".
      const landed = page.win.document.activeElement;
      assert.equal(
        landed?.getAttribute('data-ig-command') ?? null,
        'clear',
        `focus did not land on the inspector's clear control (${landed?.nodeName ?? 'null'})`,
      );

      // THE DIGIT AND ITS KIND BOTH COME FROM `KIND_KEYS`, never written out.
      // The table is built from `EDGE_FIELDS`, so a literal `'2'` paired with a
      // remembered kind is a pin that a sixth field silently falsifies — the
      // exact drift `create/keys.ts` rejects in its own header.
      const chosen = KIND_KEYS[1];
      assert.ok(chosen !== undefined, 'the vocabulary has no second kind');
      landed?.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: chosen.key, bubbles: true }));
      await flush();

      const picked = page.element.querySelector<HTMLElement>('[data-ig-command="target-query"]');
      assert.ok(
        picked !== null,
        `pressing ${chosen.key} chose no kind — the draft never reached its target step`,
      );

      // AND `ESCAPE` WITHDRAWS, the other half of the create context. A draft a
      // reader cannot abandon from the keyboard is worse than one they cannot
      // start, and it died in exactly the same place for exactly the same
      // reason.
      page.win.document.activeElement?.dispatchEvent(
        new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await flush();
      assert.equal(
        page.element.querySelector('[data-ig-command="target-query"]'),
        null,
        'Escape did not withdraw the draft',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('leaves the canvas search its own digits while a kind-step draft is open', async () => {
    // REVIEW FINDING ON THIS CHANGE, pinned so it cannot come back. Classifying
    // the kind step from the draft alone said `kind-chooser` for EVERY
    // non-keyed focus except the target search — including the ladder's
    // search-to-focus input, which stays usable while a draft is open. A reader
    // who clicked it and typed `1` had the digit taken from their query,
    // `preventDefault()`ed, and spent on a relationship kind.
    //
    // That is precisely the failure `create/keys.ts` withholds the digits from
    // `target-search` to avoid — "most issue references carry a digit, so a map
    // that claimed 1–5 here would eat nearly every query" — reintroduced one
    // control over.
    const size = 80;
    const page = await mounted({
      issues: Array.from({ length: size }, (_unused, index) => ({
        ref: String(index + 1),
        title: `Release task ${index + 1}`,
        state: 'open' as const,
        priority: 2,
      })),
      edges: Array.from({ length: size - 1 }, (_unused, index) =>
        makeEdge('blocked-by', String(index + 1), String(index + 2)),
      ),
    });
    try {
      const row = page.rows()[0];
      assert.ok(row !== undefined, 'no rail row to begin a draft from');
      page.click(row);
      await flush();

      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      page.click(add);
      await flush();

      const search = page.element.querySelector<HTMLInputElement>('input[data-ig-command="search"]');
      assert.ok(search !== null, 'no canvas search — the case is not reproduced');
      search.focus();

      const chosen = KIND_KEYS[0];
      assert.ok(chosen !== undefined, 'the vocabulary has no first kind');
      const press = new page.win.KeyboardEvent('keydown', { key: chosen.key, bubbles: true, cancelable: true });
      search.dispatchEvent(press);
      await flush();

      // THE PRESS IS HANDED BACK, which is the assertion that discriminates: a
      // digit the map declines is one the platform types into the box.
      assert.equal(press.defaultPrevented, false, 'the create map claimed a digit typed into the search');
      assert.equal(
        page.element.querySelector('[data-ig-command="target-query"]'),
        null,
        'typing into the canvas search chose a relationship kind',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('keeps a press reaching the mount even when the rail has no rows to fall back to', async () => {
    // A FALLBACK WITH A PRECONDITION IS NOT A LAST RESORT. The rail is not
    // always there: with the audit filter on and nothing flagged it draws no
    // rows, while the inspector stays perfectly usable. Pressing a
    // self-removing control there found no row, and focus fell to the body —
    // the original defect, still reachable through the repair for it.
    const page = await mounted();
    try {
      const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '1');
      assert.ok(row !== undefined, 'no rail row for 1');
      page.click(row);
      await flush();

      const filter = page.element.querySelector<HTMLElement>('[data-ig-audit-filter]');
      assert.ok(filter !== null, 'no audit filter control');
      page.click(filter);
      await flush();
      assert.equal(page.rows().length, 0, 'the rail still has rows — the case is not reproduced');

      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      add.focus();
      page.click(add);
      await flush();

      const now = page.win.document.activeElement;
      assert.ok(
        now !== null && page.element.contains(now),
        `focus left the workspace — activeElement is ${now?.nodeName ?? 'null'}`,
      );
      // AND SOMEWHERE THE READER CAN ACT FROM, which is a stronger claim than
      // "inside the surface" and the one this issue actually makes. `add` opens
      // the kind chooser, so the chooser is what focus should land on — on the
      // bare surface the press reaches the listener and every create binding
      // still answers `none`.
      assert.notEqual(
        now?.getAttribute('data-ig-command') ?? null,
        null,
        `focus landed on the bare surface rather than a control (${now?.className ?? 'none'})`,
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('leaves the keyboard loop alive — a later press still reaches the mount', async () => {
    const page = await mounted();
    try {
      await conflicted(page);
      const open = viewDiff(page);
      open.focus();
      open.click();
      await flush();

      // THE WHOLE-LOOP HALF OF THE DEFECT, and it is not the same assertion as
      // the one above. The keydown listener is on the mount's element, so a
      // press only reaches the workspace if it starts inside it and bubbles.
      // Counted on the mount element rather than asserted through one key's
      // effect, because what is being proved is that ANY press arrives — the
      // meaning of a particular key is `keyIntent`'s to decide and is pinned
      // where that lives.
      let reached = 0;
      page.element.addEventListener('keydown', () => {
        reached += 1;
      });
      const active = page.win.document.activeElement;
      assert.ok(active !== null, 'nothing holds focus');
      active.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(reached, 1, 'the press did not reach the mount — the keyboard loop is dead');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});

/**
 * `#158` — activating a control with the keyboard, and the loop that proves it.
 *
 * ## Why this needed its own coverage at all
 *
 * §17b fixes the create loop as `R → 1–5 → search → ⏎` and says what it is for
 * in four words: "full loop, no pointer". Every one of those key steps was
 * already implemented and already tested. What was not implemented was the step
 * BETWEEN them — pressing a control. It worked anyway, because a browser
 * activates a focused `<button>` natively and `onClick` sees the click, so the
 * package advertised a keyboard loop while implementing none of its activation
 * and leaving the guarantee to whatever elements a host chose to render.
 *
 * That gap was invisible from both sides. jsdom synthesizes no native
 * activation, so nothing here could drive the step; and the harness `click`
 * helper CONSTRUCTS a `MouseEvent`, so "no pointer event was used" asserted over
 * it would have passed while proving nothing.
 *
 * ## So the last test removes the ability rather than asserting about it
 *
 * `win.MouseEvent`, `win.PointerEvent` and `HTMLElement.prototype.click` are all
 * replaced with stand-ins that throw, and the assertion is that the scenario
 * FINISHES. A count of pointer events is a number someone has to remember to
 * update; a constructor that throws needs no maintenance and cannot be passed by
 * a test that quietly stops exercising the path.
 *
 * Be exact about the bound, as the block above this one is: poisoning those
 * three closes every activation route this suite can take — the harness helper,
 * a hand-rolled `new win.MouseEvent`, and `node.click()`. It does not reach
 * events jsdom builds internally by other routes, and it is not a proof that no
 * `MouseEvent` exists anywhere in the process. The claim is "no pointer
 * activation route this suite can take", which is the claim that was wanted.
 */
describe('a control activates from the keyboard', () => {
  /**
   * One press at the focused element.
   *
   * `cancelable: true` IS LOAD-BEARING and is why this helper exists rather than
   * copying the nearest neighbour: `defaultPrevented` is unconditionally `false`
   * on a non-cancelable event, and several dispatches elsewhere in this file
   * omit the flag — so a test copied from one of those would assert `false`
   * whatever the mount did.
   *
   * `.focus()` FIRST, for the same class of reason. The arm reads
   * `document.activeElement`, as `interaction()` and `navigateFocus` already do,
   * so a press dispatched at an unfocused node exercises a different ordering
   * than the one the design reasons about.
   */
  const press = (
    page: Mounted,
    node: HTMLElement,
    key: string,
    press_: {
      readonly ctrlKey?: boolean;
      readonly metaKey?: boolean;
      readonly altKey?: boolean;
      readonly isComposing?: boolean;
      readonly repeat?: boolean;
    } = {},
  ): KeyboardEvent => {
    node.focus();
    const event = new page.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...press_ });
    node.dispatchEvent(event);
    return event;
  };

  /**
   * Whatever holds focus, narrowed without a cast.
   *
   * `instanceof` against THIS page's own `HTMLElement`, which is safe here for
   * the reason `mount.ts` avoids it in the product: a test has exactly one
   * window and knows which, while the mount may be handed a node from another.
   */
  const focused = (page: Mounted): HTMLElement => {
    const active = page.win.document.activeElement;
    if (!(active instanceof page.win.HTMLElement)) throw new Error('nothing focusable holds focus');
    return active;
  };

  /** Select an issue with the keyboard alone — the rail's roving tab stop, then `⏎`. */
  const selectFirstIssue = async (page: Mounted): Promise<void> => {
    const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '1');
    assert.ok(row !== undefined, 'no rail row for 1');
    press(page, row, 'Enter');
    await flush();
  };

  /** The host facts that draw §17a's `First pass →`, with no bundle to run it. */
  const withEntry = (snapshot: StoreSnapshot): WorkspaceProjection => {
    const base = project(snapshot);
    return { ...base, viewer: { ...base.viewer, host: { identity: 'acme/widgets', firstPass: 'First pass' } } };
  };

  it('opens the kind chooser on Enter, and cancels the press', async () => {
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control to activate');

      const event = press(page, add, 'Enter');
      await flush();

      assert.ok(
        page.element.querySelector('[data-ig-command="kind"]') !== null,
        'Enter on the add control opened no kind chooser',
      );
      // CANCELLING IS THE HALF THAT MAKES THIS SAFE IN A BROWSER, not a detail.
      // A `<button>`'s activation behaviour is this keydown's default action, so
      // an arm that dispatched without cancelling would fire once here and once
      // more from the native click the browser then synthesizes.
      assert.equal(event.defaultPrevented, true, 'the activation left the native click to fire as well');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('opens the kind chooser on Space, and cancels the press', async () => {
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control to activate');

      const event = press(page, add, ' ');
      await flush();

      assert.ok(
        page.element.querySelector('[data-ig-command="kind"]') !== null,
        'Space on the add control opened no kind chooser',
      );
      // AND THE PAGE DOES NOT ALSO SCROLL. Space's other default action.
      assert.equal(event.defaultPrevented, true, 'Space activated the control and scrolled the page too');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('hands a press inside a command-bearing input straight back', async () => {
    // THE REGRESSION THIS ARM WOULD OTHERWISE SHIP. Both search boxes are
    // `<input>` elements carrying `data-ig-command`, and `onClick` declines them
    // because the `input` listener owns them. Treat that refusal as "the package
    // answered" and the arm cancels the press — so a space typed into the target
    // query never reaches the box, and step three of `R → digit → search → ⏎`
    // cannot be typed. The refusal has to travel with its REASON for the arm to
    // tell this case from the inert one below.
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      press(page, add, 'Enter');
      await flush();

      const chosen = KIND_KEYS[0];
      assert.ok(chosen !== undefined, 'the vocabulary has no first kind');
      const landed = page.win.document.activeElement;
      assert.ok(landed !== null);
      landed.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: chosen.key, bubbles: true }));
      await flush();

      const search = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(search !== null, 'the draft never reached its target step');

      const space = press(page, search, ' ');
      assert.equal(space.defaultPrevented, false, 'the arm swallowed a space typed into the target query');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('holds the press on a control that refuses because it is inert', async () => {
    // THE OTHER REFUSAL, AND THE OPPOSITE ANSWER. `First pass →` is drawn whether
    // or not a host supplied the bundle it needs, and the mount withholds it
    // rather than moving the reducer to a state with no way back. That press is
    // kept — `Space` would otherwise scroll the page under a reader who has just
    // pressed something, and this package has answered — which is why one
    // boolean cannot serve both refusals.
    const page = await mounted(SEED, { project: withEntry });
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null, 'no first-pass entry drawn');

      const event = press(page, entry, 'Enter');
      await flush();

      assert.equal(event.defaultPrevented, true, 'the inert entry handed its press to the platform');
      assert.equal(
        page.element.querySelector('.ig-firstpass-overlay'),
        null,
        'the inert entry opened the queue anyway',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('leaves a rail row to the viewer’s own navigation', async () => {
    // WHAT THIS PINS, said exactly: a rail row is NOT a control, so the arm
    // answers `null` for it and the viewer's own `Enter` still selects. It is
    // NOT an ordering test — moving the arm earlier would pass this too, because
    // the arm has nothing to say about a keyed row either way. The ordering is
    // load-bearing only if a control is ever drawn INSIDE a keyed element, which
    // nothing does today and nothing here can pin.
    const page = await mounted();
    try {
      const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '2');
      assert.ok(row !== undefined, 'no rail row for 2');

      press(page, row, 'Enter');
      await flush();

      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      assert.ok(inspector.textContent?.includes('Write the release notes') === true, 'Enter selected no issue');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  // EACH MODIFIER ITS OWN ROW. One `ctrlKey` case leaves `metaKey ||` and
  // `altKey ||` free to be dropped with nothing failing, and on macOS those are
  // the realistic chords — `⌘Enter` and `⌥Space` — so the untested two are the
  // ones a reader would actually press.
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
    it(`leaves a ${modifier} press to the platform`, async () => {
      const page = await mounted();
      try {
        await selectFirstIssue(page);
        const add = page.control('add');
        assert.ok(add !== null, 'no add control');

        const event = press(page, add, 'Enter', { [modifier]: true });
        await flush();

        assert.equal(
          page.element.querySelector('[data-ig-command="kind"]'),
          null,
          `${modifier}+Enter began a draft — the platform’s chord was claimed`,
        );
        assert.equal(event.defaultPrevented, false, `${modifier}+Enter was cancelled`);
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });
  }

  it('leaves an input method its own Enter', async () => {
    // `Enter` MID-COMPOSITION CONFIRMS A CANDIDATE, and belongs to the input
    // method. Anyone entering CJK text hits this on the ordinary path, which is
    // why `create/keys.ts` refuses it for its own bindings and why the arm does
    // too — untested, it was a line anyone could delete as redundant.
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');

      const event = press(page, add, 'Enter', { isComposing: true });
      await flush();

      assert.equal(page.element.querySelector('[data-ig-command="kind"]'), null, 'a composing Enter was claimed');
      assert.equal(event.defaultPrevented, false, 'a composing Enter was cancelled');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('makes a held key one act, and cancels the repeat rather than handing it back', async () => {
    // THE TOGGLE IS THE FIXTURE, because it is the one control that survives its
    // own activation as the SAME element with the other command — so a repeat
    // can be aimed at it, and a second dispatch is VISIBLE as the chip closing
    // again. An earlier draft of this test aimed the repeat at "whatever holds
    // focus after pressing add", which turned out to be a rail row; the press
    // was then `navigateFocus`'s and the test passed with the repeat rule
    // inverted. A document with no edges, because the chip is drawn only when
    // something is isolated.
    const page = await mounted({ issues: SEED.issues, edges: [] });
    try {
      const chip = page.control('open-isolated');
      assert.ok(chip !== null, 'no isolated chip was drawn — the test would prove nothing');

      press(page, chip, ' ');
      await flush();
      const opened = page.control('close-isolated');
      assert.ok(opened !== null, 'the first press did not open the isolated list');

      const held = press(page, opened, ' ', { repeat: true });
      await flush();

      // ONE ACT. A repeat that dispatched would flip the toggle straight back,
      // so the reader holding the key would watch the list they just opened
      // close under them.
      assert.ok(page.control('close-isolated') !== null, 'the repeat dispatched a second act and closed the list');
      // AND CANCELLED, which is the half jsdom cannot show the consequence of.
      // `Space` activates a `<button>` on KEYUP, so a repeat handed back lets the
      // platform mark the button active and the keyup then synthesizes a click —
      // performing the act a second time through `onClick` instead. There is no
      // native activation here to observe, so `defaultPrevented` stands in for
      // it, which is why it is asserted rather than assumed.
      assert.equal(held.defaultPrevented, true, 'the repeat was handed back — a native keyup would act again');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('keeps a held key with the control it activated, even after focus moves', async () => {
    // REVIEW FINDING ON THIS CHANGE, and the half the in-arm repeat guard cannot
    // reach. ACTIVATING A CONTROL OFTEN MOVES FOCUS — pressing a kind option
    // redraws and focuses `target-query` — so the repeats of that same held
    // press arrive at the INPUT. There the arm asks "is what holds focus a
    // control?", answers "an input, hand it back", and the platform types a
    // space into a query the reader never started. Held long enough, the target
    // search fills with spaces from a press that was aimed at a button.
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      press(page, add, 'Enter');
      await flush();

      const chosen = KIND_KEYS[0];
      assert.ok(chosen !== undefined, 'the vocabulary has no first kind');
      const option = page.element.querySelector<HTMLElement>(`[data-ig-command="kind"][data-ig-value="${chosen.edgeKind}"]`);
      assert.ok(option !== null, 'the chooser drew no option to press');

      press(page, option, ' ');
      await flush();

      // FOCUS HAS MOVED, and the test says so rather than assuming it — the
      // whole finding rests on this step happening.
      const now = focused(page);
      assert.equal(now.getAttribute('data-ig-command'), 'target-query', 'activating the kind did not move focus');

      const held = new page.win.KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true, cancelable: true });
      now.dispatchEvent(held);
      await flush();

      assert.equal(held.defaultPrevented, true, 'a repeat of the held key typed a space into the target query');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('keeps the held key across an unrelated press, like Shift', async () => {
    // REVIEW FINDING ON THIS CHANGE. The record was cleared by ANY fresh
    // non-repeat press, so a reader holding `Space` on a control and touching
    // `Shift` — or anything else — dropped it, and the next `Space` repeat
    // landed wherever the activation had since sent focus. That is the inserted
    // spaces the record exists to prevent, one keystroke away from every use.
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      press(page, add, 'Enter');
      await flush();

      const chosen = KIND_KEYS[0];
      assert.ok(chosen !== undefined, 'the vocabulary has no first kind');
      const option = page.element.querySelector<HTMLElement>(
        `[data-ig-command="kind"][data-ig-value="${chosen.edgeKind}"]`,
      );
      assert.ok(option !== null, 'the chooser drew no option to press');
      press(page, option, ' ');
      await flush();

      const search = focused(page);
      assert.equal(search.getAttribute('data-ig-command'), 'target-query', 'activating the kind did not move focus');

      // STILL HOLDING SPACE, and now something else is pressed.
      search.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Shift', bubbles: true, cancelable: true }));

      const held = new page.win.KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true, cancelable: true });
      search.dispatchEvent(held);
      await flush();

      assert.equal(held.defaultPrevented, true, 'an unrelated press forgot the still-held activation');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('keeps every held key’s record, not just the latest one', async () => {
    // REVIEW FINDING ON THIS CHANGE. Two keys can be down at once — hold `Space`
    // on one control and press `Enter` on another — and a scalar record answered
    // that by forgetting the first, so the `Space` repeats stopped being
    // recognised as its own and went wherever focus had since moved. The set is
    // what stops the case existing rather than guarding against it.
    // THE REPEAT HAS TO LAND SOMEWHERE THE TWO ANSWERS DIFFER, which is why this
    // drives the loop to the target input rather than pressing two chrome
    // buttons: on a control, a lost record is invisible — the repeat simply
    // reaches the arm and is cancelled again for its own reasons. On the INPUT
    // the arm hands the press back, so a forgotten record shows up as the
    // reader's search box taking a character from a key they are holding on a
    // button. An earlier draft of this test pressed two chrome buttons and
    // passed with the set replaced by a scalar.
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');

      // ENTER GOES DOWN FIRST, and stays down for the rest of the test.
      press(page, add, 'Enter');
      await flush();

      // SPACE ACTIVATES A SECOND CONTROL while Enter is still held, and this one
      // moves focus into the target search.
      const chosen = KIND_KEYS[0];
      assert.ok(chosen !== undefined, 'the vocabulary has no first kind');
      const option = page.element.querySelector<HTMLElement>(
        `[data-ig-command="kind"][data-ig-value="${chosen.edgeKind}"]`,
      );
      assert.ok(option !== null, 'the chooser drew no option to press');
      press(page, option, ' ');
      await flush();

      const search = focused(page);
      assert.equal(search.getAttribute('data-ig-command'), 'target-query', 'activating the kind did not move focus');

      // NOW ENTER REPEATS, at the input. It is still this package's press.
      const held = new page.win.KeyboardEvent('keydown', {
        key: 'Enter',
        repeat: true,
        bubbles: true,
        cancelable: true,
      });
      search.dispatchEvent(held);
      await flush();

      assert.equal(held.defaultPrevented, true, 'a second activation overwrote the first still-held key’s record');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('releases the held key on keyup, so a later repeat is the reader’s own', async () => {
    // THE OTHER SIDE OF THE SAME FLAG, isolated to `keyup` alone. Remembering
    // the press must not outlive it, or the reader who let go and then held
    // `Space` inside the search box they were sent to would find it swallowed by
    // a press that ended.
    //
    // A REPEAT is what discriminates: `onKeydown` clears the flag on any fresh
    // NON-repeat press, so a test driving one of those would pass with the
    // `keyup` listener deleted.
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      press(page, add, 'Enter');
      await flush();

      const chosen = KIND_KEYS[0];
      assert.ok(chosen !== undefined, 'the vocabulary has no first kind');
      const option = page.element.querySelector<HTMLElement>(`[data-ig-command="kind"][data-ig-value="${chosen.edgeKind}"]`);
      assert.ok(option !== null, 'the chooser drew no option to press');
      press(page, option, ' ');
      await flush();

      const search = focused(page);
      assert.equal(search.getAttribute('data-ig-command'), 'target-query', 'activating the kind did not move focus');

      // LET GO.
      search.dispatchEvent(new page.win.KeyboardEvent('keyup', { key: ' ', bubbles: true }));

      const held = new page.win.KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true, cancelable: true });
      search.dispatchEvent(held);
      await flush();

      // NOW IT IS THE READER TYPING, and the input owns it again.
      assert.equal(held.defaultPrevented, false, 'a repeat after keyup was still held by the finished press');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('leaves a host’s own command its native activation', async () => {
    // REVIEW FINDING ON THIS CHANGE, and the one that made the arm a regression
    // rather than only an addition. `data-ig-command` is a SHARED NAMESPACE:
    // `reduceHost`'s default arm says a host's chrome publishes on it too, and
    // layer 1 already does — `refresh`, `retry:index`, `review-pick-order`,
    // `dismiss:adoption` are drawn inside this surface and answered by the
    // host's own `click` listener. Cancelling their keydown suppresses the
    // native click that listener waits for, so every one of them would stop
    // answering the keyboard while looking untouched from in here.
    //
    // A COMMAND NO ARM KNOWS is the general case, driven directly rather than
    // through one of those four: what the arm must key on is the REDUCER's
    // answer, not a list of names it would have to keep in step with layer 1.
    const page = await mounted();
    try {
      const host = page.win.document.createElement('button');
      host.setAttribute('data-ig-command', 'a-command-this-reducer-has-no-arm-for');
      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      inspector.append(host);

      const event = press(page, host, 'Enter');
      await flush();

      // NOT CANCELLED, so the browser still activates the button and the host's
      // click listener still hears it. This is the whole assertion: everything
      // else about that control is the host's business, not this package's.
      assert.equal(
        event.defaultPrevented,
        false,
        'the arm cancelled a host-owned command and took its control off the keyboard',
      );
      // AND NOT REDRAWN, which is the same defect by a different route and was
      // the second finding on it. A redraw replaces `surface.innerHTML`, and
      // `Space` activates a `<button>` on KEYUP — so destroying the held button
      // before then loses the activation exactly as cancelling would. The node
      // still being in the document is what says no redraw ran.
      assert.ok(host.isConnected, 'a redraw replaced the host’s button before its activation could land');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('stops a refused press before the identity branches, on the click path too', async () => {
    // THE EXTRACTION'S CENTRAL CLAIM, pinned. `controlAnswer` answers `refused`
    // rather than `null` so that `onClick` STOPS — fall through and a press on a
    // control the mount declined reaches the `data-ig-group` / `data-ig-key`
    // branch and selects whatever sits under it, an act the reader never asked
    // for.
    //
    // NO CONTROL IS DRAWN INSIDE A KEYED ELEMENT TODAY, which is why this
    // configuration is BUILT here rather than found. That is the point: the
    // guard exists against a future renderer nesting one, and a test that waited
    // for that renderer would arrive after the regression it was meant to catch.
    const page = await mounted(SEED, { project: withEntry });
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null, 'no first-pass entry drawn');
      const parent = entry.parentElement;
      assert.ok(parent !== null, 'the entry has no parent to key');
      parent.setAttribute('data-ig-key', '4');

      page.click(entry);
      await flush();

      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      assert.equal(
        inspector.textContent?.includes('Rename the config flag') ?? false,
        false,
        'a refused press fell through and selected the element underneath it',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('runs the whole create loop with no pointer activation route available', async () => {
    const page = await mounted();
    const { win } = page;
    const realMouse = win.MouseEvent;
    const realPointer = win.PointerEvent;
    const realClick = win.HTMLElement.prototype.click;
    const poisoned = (what: string) =>
      function (this: unknown): never {
        throw new Error(`${what} was used — this scenario is meant to be pointer-free`);
      };
    const put = (host: object, name: string, value: unknown): void => {
      Object.defineProperty(host, name, { value, configurable: true, writable: true });
    };
    try {
      // POISONED AFTER THE MOUNT, so the mount's own setup is unaffected and only
      // the scenario is bound by it.
      //
      // `defineProperty` RATHER THAN AN ASSIGNMENT, and then CHECKED. A plain set
      // answers `false` on a property that is not writable instead of throwing,
      // so a jsdom that ever made these non-configurable would leave the scenario
      // running against the real constructors while every assertion still passed
      // — the same silently-stops-proving-anything failure this test replaces.
      put(win, 'MouseEvent', poisoned('MouseEvent'));
      put(win, 'PointerEvent', poisoned('PointerEvent'));
      put(win.HTMLElement.prototype, 'click', poisoned('HTMLElement.click()'));
      assert.throws(() => new win.MouseEvent('click'), /pointer-free/, 'MouseEvent was not poisoned');
      assert.throws(() => new win.PointerEvent('pointerdown'), /pointer-free/, 'PointerEvent was not poisoned');
      assert.throws(() => win.document.body.click(), /pointer-free/, 'HTMLElement.click was not poisoned');

      // 1. THE SUBJECT, chosen with the rail's roving tab stop and `⏎`.
      await selectFirstIssue(page);

      // 2. `add`, THE STEP THIS ISSUE ADDED. Deliberately not `r` on the rail
      //    row: `r` resolves through `keyIntent`'s own `relate` binding, so that
      //    variant would stay green with the keydown arm deleted — the same
      //    vacuity this test exists to retire, wearing a different shape.
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      press(page, add, 'Enter');
      await flush();

      // 3. THE KIND, by its digit — read from `KIND_KEYS` so a sixth edge field
      //    cannot silently falsify the pairing.
      const chosen = KIND_KEYS[0];
      assert.ok(chosen !== undefined, 'the vocabulary has no first kind');
      const landed = page.win.document.activeElement;
      assert.ok(landed !== null, 'the chooser left nothing focused');
      landed.dispatchEvent(new win.KeyboardEvent('keydown', { key: chosen.key, bubbles: true, cancelable: true }));
      await flush();

      // 4. THE TARGET, typed and committed.
      const search = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(search !== null, 'the draft never reached its target step');
      search.focus();
      search.value = '3';
      search.dispatchEvent(new win.Event('input', { bubbles: true }));
      await flush();
      // RE-QUERIED, because the redraw the query causes replaces the box. The
      // stale node is detached, so a press dispatched at it bubbles to nothing
      // and the commit silently never happens.
      const typed = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(typed !== null, 'the target search went away as the query landed');
      typed.focus();
      typed.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await flush();

      const proposed = page.store.getSnapshot().writes.map((write) => write.mutation);
      assert.equal(proposed.length, 1, `the loop proposed ${String(proposed.length)} edits, not one`);
      assert.equal(proposed[0]?.op, 'create');
    } finally {
      put(win, 'MouseEvent', realMouse);
      put(win, 'PointerEvent', realPointer);
      put(win.HTMLElement.prototype, 'click', realClick);
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});

describe('opening the isolated list reveals it', () => {
  /**
   * §17a PUTS THE CONTROL AND THE LIST IN DIFFERENT ZONES, which is the whole
   * reason this behaviour exists. The count and its toggle are at the foot of
   * the ORDER RAIL; the list the ladder draws is in the CANVAS, because the
   * rail is virtualized on a fixed row pitch and an arbitrary-height list in
   * that scroll track makes every offset beneath it name the wrong row.
   *
   * So the press flips a control in one zone and grows a list in another, below
   * whatever that zone was already scrolled to. Without the reveal the reader
   * is told the list is open and sees nothing move.
   */
  const RAIL_WORDS = { isolated: 'carrying no edges', show: 'reveal', hide: 'fold away' };

  it('scrolls the opened list into view, and only on the press that opens it', async () => {
    const page = await mounted(SEED, { words: { ...WORDS, rail: RAIL_WORDS } });
    try {
      const revealed: string[] = [];
      // jsdom implements no scrolling at all, so `scrollIntoView` is absent —
      // which is also the case the mount guards for. Installing it here is what
      // makes the call observable rather than a no-op.
      page.win.Element.prototype.scrollIntoView = function scrollIntoView(this: Element): void {
        revealed.push(this.className);
      };

      const toggle = page.element.querySelector<HTMLElement>('[data-ig-command="open-isolated"]');
      assert.ok(toggle !== null, 'no isolated toggle in the rail footer');
      toggle.click();
      await flush();

      assert.ok(
        revealed.some((name) => name.includes('ig-isolated-list')),
        `the opened list was never revealed — scrolled: ${JSON.stringify(revealed)}`,
      );
      assert.ok(
        page.element.querySelector('.ig-isolated-list') !== null,
        'the list did not open at all',
      );

      // AND NOT AGAIN ON AN UNRELATED REDRAW. The flag is set by the command,
      // not read off `scale.isolatedOpen` — which stays true — so a later
      // render must not yank the canvas back under a reader who scrolled away.
      revealed.length = 0;
      const row = page.rows()[0];
      assert.ok(row !== undefined, 'no rail row to select');
      page.click(row);
      await flush();

      assert.deepEqual(
        revealed.filter((name) => name.includes('ig-isolated-list')),
        [],
        'an unrelated redraw revealed the list again',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  /**
   * THE ID IS PER MOUNT, WHICH IS THE POINT OF MINTING IT HERE. `renderWorkspace`
   * is pure and cannot know what else is on the host's page; `mountWorkspace`
   * can, because it is the thing being called twice. Two mounted workspaces must
   * not name one element — `scale/render.ts`'s `searchSpec` records what a
   * duplicated id costs, and an earlier revision of this work shipped one.
   */
  it('gives two mounted workspaces different ids for their lists', async () => {
    const first = await mounted(SEED, { words: { ...WORDS, rail: RAIL_WORDS } });
    const second = await mounted(SEED, { words: { ...WORDS, rail: RAIL_WORDS } });
    try {
      const openIn = async (page: Awaited<ReturnType<typeof mounted>>): Promise<string> => {
        const toggle = page.element.querySelector<HTMLElement>('[data-ig-command="open-isolated"]');
        assert.ok(toggle !== null, 'no isolated toggle');
        toggle.click();
        await flush();
        const list = page.element.querySelector('.ig-isolated-list');
        assert.ok(list !== null, 'no list after opening');
        const id = list.getAttribute('id');
        assert.ok(id !== null && id !== '', 'the list carries no id');
        const control = page.element.querySelector('[data-ig-command="close-isolated"]');
        assert.equal(control?.getAttribute('aria-controls'), id, 'the toggle names another element');
        return id;
      };

      assert.notEqual(await openIn(first), await openIn(second), 'both mounts named one element');
    } finally {
      first.handle.destroy();
      first.dom.window.close();
      second.handle.destroy();
      second.dom.window.close();
    }
  });

  /**
   * THE TREE REPLACES THE CANVAS ZONE'S `innerHTML`, and the list is drawn in
   * that zone. The control is not — §17a puts it at the foot of the rail — so
   * without preserving the block the reader gets a toggle that flips to "hide"
   * and `aria-expanded="true"` over nothing at all.
   *
   * That is worse than what it replaced: before the control moved, the chip sat
   * in this zone beside its list and the tree deleted both, so the affordance
   * was absent rather than lying.
   */
  it('keeps the list in tree mode, where the canvas markup is replaced', async () => {
    const page = await mounted(SEED, { words: { ...WORDS, rail: RAIL_WORDS }, canvas: 'tree' });
    try {
      const toggle = page.element.querySelector<HTMLElement>('[data-ig-command="open-isolated"]');
      assert.ok(toggle !== null, 'no isolated toggle in the rail footer');
      toggle.click();
      await flush();

      const opened = page.element.querySelector<HTMLElement>('[data-ig-command="close-isolated"]');
      assert.ok(opened !== null, 'the control did not flip to its open state');
      assert.equal(opened.getAttribute('aria-expanded'), 'true');
      // THE ASSERTION THIS TEST EXISTS FOR: the control says open, so something
      // has to be open.
      assert.ok(
        page.element.querySelector('.ig-isolated-list') !== null,
        'the control reports an open list the tree canvas deleted',
      );
      assert.ok(
        page.zone('canvas')?.querySelector('.ig-isolated-list') != null,
        'the list survived but not in the canvas zone',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});

describe('§17d’s outward link is the browser’s to follow, not the mount’s', () => {
  /**
   * A projection reporting one encoding refusal on a seed issue.
   *
   * A REFUSAL IS THE ONLY WAY TO DRAW THE BLOCK. It is a fact about a raw body
   * the package never sees, so no document shape produces one — the host states
   * it, and this is that host.
   */
  function withRefusal(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [], duplicateCanonical: () => null },
        encodingRefused: [
          { ref: '1', diagnostic: 'unparseable YAML at line 3', sourceLine: 'blocked-by: [231, 234' },
        ],
      },
    };
  }

  it('does not redraw the surface under the reader’s own click', async () => {
    // THE ANCHOR CARRIES A `data-ig-command` ONLY SO `a11y/baseline.ts` CAN SEE
    // IT — that artifact records a control through the attribute channels it
    // knows, and an anchor bearing nothing but `href` is invisible to it. But
    // the command channel is also how a press becomes a dispatch, and nothing
    // reduces this name: the command would come back unclaimed while the mount
    // scheduled a redraw anyway, replacing the surface's markup and detaching
    // the anchor mid-activation. An `<a>` is exempt from the "cannot navigate"
    // connectedness check, so the navigation would still happen and the cost
    // would have been invisible — a full re-render per click, for nothing.
    const page = await mounted(SEED, {
      project: withRefusal,
      issueUrl: (ref) => `https://example.invalid/${ref}`,
    });
    try {
      const link = page.element.querySelector<HTMLElement>('.ig-audit-refused-open');
      assert.ok(link !== null, 'the fixture drew no outward link, so this proves nothing');
      assert.equal(link.getAttribute('data-ig-command'), 'open-issue-url');

      // IDENTITY, NOT MARKUP. A redraw replaces the surface's nodes, so the
      // question "did the mount redraw" is exactly "is this the same node".
      const before = page.element.querySelector('.ig-audit-refused-open');
      page.click(link);
      await flush();
      assert.equal(
        page.element.querySelector('.ig-audit-refused-open'),
        before,
        'clicking the link redrew the surface, detaching the anchor mid-activation',
      );

      // AND THE FIXTURE CAN ACTUALLY OBSERVE A REDRAW, or the assertion above
      // passes for a mount that never redraws at all.
      page.handle.update();
      await flush();
      assert.notEqual(
        page.element.querySelector('.ig-audit-refused-open'),
        before,
        'the fixture cannot see a redraw, so the assertion above proves nothing',
      );
    } finally {
      page.handle.destroy();
    }
  });

  it('leaves Enter to the browser, so the link is not pointer-only', async () => {
    // AN ANCHOR'S `Enter` ACTIVATION IS A DEFAULT ACTION. The click path refuses
    // to DISPATCH this control — nothing reduces the name, and a redraw would
    // detach the anchor mid-activation — but the keydown path must not answer
    // the same way: cancelling the press means no click is ever synthesized and
    // the link works for a pointer and not for a keyboard.
    //
    // `input` AND `inert` REFUSALS STILL KEEP THE PRESS, and the difference is
    // the point: those say "this press does nothing and nothing else wants it",
    // while `navigation` says something else is waiting for exactly this key.
    const page = await mounted(SEED, {
      project: withRefusal,
      issueUrl: (ref) => `https://example.invalid/${ref}`,
    });
    try {
      const link = page.element.querySelector<HTMLElement>('.ig-audit-refused-open');
      assert.ok(link !== null, 'the fixture drew no outward link, so this proves nothing');
      link.focus();
      const press = new page.win.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(press);
      await flush();
      assert.equal(
        press.defaultPrevented,
        false,
        'the mount cancelled Enter on the link, so its navigation never happens',
      );
    } finally {
      page.handle.destroy();
    }
  });

  it('still dispatches the rewrite control beside it', async () => {
    // THE REFUSAL IS SCOPED TO A LINK, not to the block. `Rewrite from editor`
    // is an ordinary button on the command channel and must still reach the
    // reducer, or the guard above has taken the surface's other control with it.
    const page = await mounted(SEED, { project: withRefusal });
    try {
      const rewrite = page.element.querySelector<HTMLElement>('.ig-audit-refused-rewrite');
      assert.ok(rewrite !== null, 'the fixture drew no rewrite control, so this proves nothing');
      page.click(rewrite);
      await flush();
      // `reveal-issue` MOVES THE SELECTION, which is the whole of what it does.
      const selected = page.element.querySelector('[data-ig-key="1"][data-ig-selected="true"]');
      assert.ok(
        selected !== null || page.element.querySelector('.ig-inspector') !== null,
        'the rewrite control reached nothing',
      );
    } finally {
      page.handle.destroy();
    }
  });
});
