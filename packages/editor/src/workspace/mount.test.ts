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

import type { GraphDocument, StoreSnapshot } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';
import { treatmentFor } from '@issuegraph/viewer';

import { KIND_KEYS, RELATE_KEY } from '../create/keys.ts';
import { PICKER_WORDS } from '../testing/picker.ts';
import { WORDS as CHANGE_WORDS } from '../testing/reevaluate.ts';
import { WORKSPACE_WORDS } from '../testing/workspace.ts';
import { type WorkspaceProjection, mountWorkspace } from './mount.ts';
import { WORDS, SEED, project, flush, unitProject, mounted, type Mounted } from '../testing/mount.ts';

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
      await page.openAudit();
      const region = (): HTMLElement | null =>
        page.element.querySelector<HTMLElement>('.ig-audit-overlay');
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

  it('§17d: the header count opens the overlay and Escape dismisses it', async () => {
    // `RULINGS.md` §3, in its own words: *"a transient overlay anchored to the
    // header count ... dismissed on Escape."* Three facts, and the middle one
    // is the reason this is a MOUNT test rather than a reducer test: the panel
    // is not rendered at all while shut, so "dismissed" has to be observed as
    // the element going away, not as a flag changing.
    //
    // THE ESCAPE IS DISPATCHED FROM THE FOCUSED CONTROL, which is where a
    // reader's press comes from. Driving this in a browser first, a scripted
    // `.click()` left focus on `body` and the press reached nothing — the
    // mount's listener is on its own element, as every other key here is. That
    // was the fixture being wrong rather than the wiring, and it is worth the
    // sentence because the same mistake would read as a broken feature.
    const page = await mounted(SEED, { project: withCycle });
    try {
      const overlay = (): Element | null => page.element.querySelector('.ig-audit-overlay');
      assert.equal(overlay(), null, 'the panel is drawn before anything opened it');

      const toggle = page.element.querySelector<HTMLElement>('[data-ig-audit-panel]');
      assert.ok(toggle !== null, 'no header count to open the panel from');
      assert.equal(toggle.getAttribute('aria-expanded'), 'false');

      toggle.focus();
      page.click(toggle);
      await flush();
      assert.ok(overlay() !== null, 'the header count did not open the panel');
      assert.equal(
        page.element.querySelector('[data-ig-audit-panel]')?.getAttribute('aria-expanded'),
        'true',
      );

      const active = page.win.document.activeElement;
      assert.ok(active !== null);
      active.dispatchEvent(
        new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      await flush();
      assert.equal(overlay(), null, 'Escape did not dismiss the overlay');
      assert.equal(
        page.element.querySelector('[data-ig-audit-panel]')?.getAttribute('aria-expanded'),
        'false',
      );
      page.handle.destroy();
    } finally {
      page.dom.window.close();
    }
  });

  it('§17d: Escape dismisses the overlay from a RAIL ROW, not just from the count', async () => {
    // THE CASE MY OWN BROWSER CHECK MISSED. I drove the dismissal with focus on
    // the header count, which is where a click leaves it — and it worked. A
    // reader who opens the panel, looks back at the order to judge a finding
    // and then presses Escape has focus on a ROW, and there the press was
    // swallowed: `create/keys.ts` binds `escape` to `cancel`, and `cancel`
    // settled unconditionally, claiming the press to reset an already-idle
    // draft to idle. The audit arm below it never ran.
    //
    // §3 says "dismissed on Escape" without qualifying where focus is, and
    // the row is the likeliest place for it to be.
    const page = await mounted(SEED, { project: withCycle });
    try {
      const toggle = page.element.querySelector<HTMLElement>('[data-ig-audit-panel]');
      assert.ok(toggle !== null);
      toggle.focus();
      page.click(toggle);
      await flush();
      assert.ok(page.element.querySelector('.ig-audit-overlay') !== null, 'the panel did not open');

      const row = page.rows()[0];
      assert.ok(row !== undefined, 'no rail row to stand on');
      row.focus();
      assert.equal(page.win.document.activeElement, row, 'the fixture cannot focus a row');

      row.dispatchEvent(
        new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      await flush();
      assert.equal(
        page.element.querySelector('.ig-audit-overlay'),
        null,
        'Escape from a rail row did not dismiss the overlay',
      );
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
      await page.openAudit();
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
      await page.openAudit();
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
      assert.equal(page.element.querySelector('.ig-audit-overlay'), null);
      page.handle.update();
      await flush();
      assert.equal(page.element.querySelector('.ig-audit-overlay'), null);
      page.handle.destroy();
    } finally {
      page.dom.window.close();
    }
  });
});

describe("the log's scroll offset survives a redraw", () => {
  // The log under the head is bounded and scrolls itself, so a reader working
  // down a long list of failed writes must not be sent back to its top by a
  // write settling elsewhere. jsdom holds `scrollTop` on any element, so this
  // checks the mount's carry, and the stylesheet test checks the bound.
  it('restores the offset onto the log the redraw built', async () => {
    const page = await mounted(SEED);
    try {
      const log = (): HTMLElement | null => page.element.querySelector<HTMLElement>('.ig-workspace-log');
      const before = log();
      assert.ok(before !== null, 'the mount drew no log, so this proves nothing');
      before.scrollTop = 48;
      assert.equal(before.scrollTop, 48, 'the fixture cannot hold an offset, so this proves nothing');

      page.handle.update();
      await flush();

      const after = log();
      assert.ok(after !== null, 'the redraw dropped the log');
      assert.notEqual(after, before, 'no redraw happened, so this test would prove nothing');
      assert.equal(after.scrollTop, 48);
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

    it('§16f: ArrowRight opens the focused row, ArrowLeft closes it', async () => {
      // THE SEAM THIS EXISTS FOR. The viewer publishes `expand:<key>` because
      // it cannot expand anything itself, and the reducer holds the set — both
      // are driven elsewhere with no DOM. What is only true HERE is that the
      // shell carries one to the other: before this, `navigateFocus` returned
      // false for a published command and the key reached nothing at all.
      //
      // FOCUS MUST NOT MOVE. A row that opens under a reader who then finds
      // themselves on a different row is worse than a row that does not open.
      const first = page.rows()[0];
      assert.ok(first !== undefined);
      first.focus();
      const key = first.getAttribute('data-ig-key');

      first.dispatchEvent(
        new page.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      await flush();
      assert.deepEqual(page.handle.state.expanded, [key]);
      assert.equal(
        page.win.document.activeElement?.getAttribute('data-ig-key'),
        key,
        'expanding is not a move',
      );

      page.win.document.activeElement?.dispatchEvent(
        new page.win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
      await flush();
      assert.deepEqual(page.handle.state.expanded, []);
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
     * THE PATH THAT USED TO EMPTY THE ROW. The tree branch removes the caption
     * after the fact, so a host that worded the caption and not the pill once had
     * its row emptied and re-inserted as a bordered band with nothing inside. The
     * middle zone's switch now leads every row, so the row the tree keeps still
     * holds it, and the caption stays gone.
     */
    it('keeps the row for the switch alone when the caption was its other content', async () => {
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
      // The middle zone's switch keeps the row from ever being an empty band over the tree.
      assert.ok(row()?.querySelector('.ig-canvas-switch') !== null, 'the tree lost the middle zone switch');
      assert.equal(row()?.querySelector('.ig-canvas-caption') ?? null, null, 'the caption came back over the tree');
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
