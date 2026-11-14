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
import { keysOf, relatedHubEdges } from '../testing/workspace.ts';
import { mountStylesheet } from './chrome.ts';
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
    /** Stub the jsdom window or the root element before the workspace mounts on them. */
    beforeMount?: (win: JSDOM['window']) => void;
  } = {},
) {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  const win = dom.window;
  const element = win.document.getElementById('host');
  assert.ok(element !== null);
  const source = createScriptedSource(seed, applyAny);
  const { derive = flatDeriver, project: projection = project, wrap, beforeMount, ...mountOptions } = options;
  const store = createStore({ source: wrap === undefined ? source : wrap(source), derive });
  await store.hydrate();
  beforeMount?.(win);
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
 * THE SCROLLER IS `.ig-audit-overlay`, NOT `.ig-audit-panel`. #177 put the bound
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







/**
 * The first pass, composed.
 *
 * §17e's two rules are the load-bearing tests here, and both are pinned at the
 * MOUNT rather than restated from `firstpass/render.test.ts`: what that file
 * already owns is what the renderer draws from a queue, and what this file owns
 * is everything only the shell can get wrong — whether a drawn candidate
 * reaches the store, and whether anything about the backlog reaches the queue.
 */

/**
 * §17b's recovery cards, driven through the real store.
 *
 * NOT THROUGH A `recoveries` FIXTURE, which is the defect the refusal suite
 * above records paying for: hand the renderer an array and the derivation that
 * BUILDS that array from a snapshot is covered by nothing at all. Every card
 * here comes from a write the scripted source actually refused.
 */

/**
 * The half of §17b that is about the ORDER rather than about a card.
 *
 * `a pending write cannot change a rank` above pins the PENDING state. These
 * are the two settled ones, and they need the same `blockingDeriver`: with the
 * harness's flat deriver every write lands on the same order, so a mount that
 * folded an unsettled edge into the drawn order would pass regardless.
 */

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

/**
 * A projection whose audit flags issues the RAIL does not draw.
 *
 * WHY THIS SHAPE EXISTS. Two tests below need a rail with no rows while the
 * rest of the surface stays usable, and they used to get it by turning the
 * audit filter on with nothing flagged — filtering to zero findings emptied it.
 * `RULINGS.md` §3 moved the filter into the panel, and the panel draws only
 * when there are findings to list, so "the filter is on and nothing is flagged"
 * is no longer a state the interface can reach. That is a consequence worth
 * keeping rather than a defect: a control that narrows to nothing, available
 * only when there is nothing to narrow to, was never a useful pairing.
 *
 * So the rail is emptied the way a reader actually could: a real finding, whose
 * affected rows are simply not in the drawn page. The panel and its filter
 * exist, the filter genuinely narrows, and nothing survives the narrowing.
 */
function withOffPageCycle(snapshot: StoreSnapshot): WorkspaceProjection {
  const offPage = [
    { ref: 'off-page-a', title: 'off page a', state: 'open' as const },
    { ref: 'off-page-b', title: 'off page b', state: 'open' as const },
  ];
  return {
    ...project(snapshot),
    audit: {
      document: {
        issues: offPage,
        edges: [
          { id: 'blocked-by|off-page-a|off-page-b', kind: 'blocked-by' as const, from: 'off-page-a', to: 'off-page-b' },
          { id: 'blocked-by|off-page-b|off-page-a', kind: 'blocked-by' as const, from: 'off-page-b', to: 'off-page-a' },
        ],
      },
      graph: { cycles: [['off-page-a', 'off-page-b']], duplicateCanonical: () => null },
    },
  };
}


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



/**
 * §17k's two narrow layouts, wired end to end.
 *
 * WHAT IS PROVEN HERE IS THE WIRING, not the layout: the stylesheet decides
 * which of the three layouts is drawn, jsdom applies no stylesheet, and the
 * package is forbidden from reading a width. So these read the two attributes
 * the sheet selects on, which is exactly the surface between the two halves.
 * The tracks themselves are pinned in `styles.test.ts` and were measured in a
 * browser at 1440, 1280 and 1000.
 */

/**
 * Two transients now share Escape, and the order between them is a decision.
 *
 * #209 gave §17d's audit panel a dismissal; #210 gave §17k's lifted inspector
 * and collapsed canvas one. They landed within a day of each other and neither
 * knew about the other, so the interaction is settled here rather than left to
 * whichever arm a merge happened to put first.
 *
 * §17d'S PANEL GOES FIRST, and the reason is what each is: the audit overlay is
 * opened by an explicit press on the header count and is drawn at EVERY width,
 * while §17k's inspector is lifted implicitly by a selection and exists only
 * between `1120` and `1359`. Taking the press for §17k's would mean a reader at
 * the wide layout — where nothing of §17k's is drawn at all — pressing Escape
 * over an open audit panel and watching it stay put.
 */


/**
 * The layout under 640's tabs and its Related groups list, mounted.
 *
 * The reducer's half is driven in `host.test.ts`, and the list's rules in
 * `related.test.ts`. What only the shell can get wrong is proven here: that the
 * canvas mode is read from the host state after the mount seeds it, that the
 * rail offset comes back from the scroll handler rather than from a hidden rail,
 * and that a reader can reach a relationship the first draw did not hold.
 */



/**
 * The log under the head, mounted: each write that is saving or did not save is
 * listed there whichever issue is selected, and its controls reach the store.
 */

describe("more tests", function () {
it('a narrow editor root with no ResizeObserver on its window leaves one issue after a Cmd-click, reported once', async () => {
  const box = { width: 500, height: 300 };
  const calls: string[] = [];
  const page = await mounted(SEED, {
    onSelectionChange: (selection) => calls.push(JSON.stringify(selection)),
    beforeMount: (win) => {
      const measure = win.HTMLElement.prototype.getBoundingClientRect;
      win.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
        if (this.id !== 'host') return measure.call(this);
        return { x: 0, y: 0, top: 0, left: 0, right: box.width, bottom: box.height, width: box.width, height: box.height, toJSON: () => ({}) };
      };
    },
  });
  const row = (key: string): HTMLElement => {
    const found = page.rows().find((candidate) => candidate.getAttribute('data-ig-key') === key);
    assert.ok(found !== undefined, `no rail row is drawn for ${key}`);
    return found;
  };
  const issue = (key: string): string => JSON.stringify({ kind: 'issue', key });
  try {
    assert.equal('ResizeObserver' in page.win, false, 'this case needs a window with no ResizeObserver');
    row('1').dispatchEvent(new page.win.MouseEvent('click', { bubbles: true }));
    await flush();
    row('3').dispatchEvent(new page.win.MouseEvent('click', { bubbles: true, metaKey: true }));
    // The issue: "A box that can be measured is reduced on mount even when no resize observer is available"
    // The issue: "A box narrower than 640 reduces a multi-issue selection to its most recently added issue, on mount and on every resize, and an add there leaves one issue."
    assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '3' }, 'the handle held a set before the render');
    await flush();
    assert.deepEqual(calls, [issue('1'), issue('3')]);
  } finally {
    page.handle.destroy();
  }
});
});
