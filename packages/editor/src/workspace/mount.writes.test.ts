/**
 * The mount, driven through a real DOM: failed and conflicted writes, and
 * command controls across their redraws.
 *
 * Split from `mount.test.ts`, whose header says why jsdom and why every test
 * goes through the public entry point. The editor suite gives each file 20 s
 * (`--test-timeout=20000` under the glob runner), and one file holding every
 * mount test had grown to that line on node 22 (#297).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GraphDocument, StoreSnapshot } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';

import { KIND_KEYS } from '../create/keys.ts';
import { WORKSPACE_WORDS } from '../testing/workspace.ts';
import type { WorkspaceProjection } from './mount.ts';
import { SEED, project, flush, blockingDeriver, unitProject, mounted, type Mounted } from '../testing/mount.ts';

/**
 * §17b's recovery cards, driven through the real store.
 *
 * NOT THROUGH A `recoveries` FIXTURE, which is the defect the refusal suite
 * in `mount.test.ts` records paying for: hand the renderer an array and the derivation that
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
      // ONE CARD PER PLACEMENT: the log lists both conflicts and the panel
      // states the one made from `3`, and each says it on the pressed card only.
      const drawnIn = (name: string): Element[] => [
        ...(page.zone(name)?.querySelectorAll('.ig-recovery-refresh-error') ?? []),
      ];
      assert.equal(drawnIn('header').length, 1, 'the read failure was drawn on the wrong number of log cards');
      const drawn = drawnIn('inspector');
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
    // available from focus: with the audit filter on and only OFF-PAGE rows
    // flagged there is no row for the mount to fall back to, while the
    // inspector stays perfectly usable. The selection is made FIRST, while rows
    // still exist, so the inspector keeps a subject and draws `+ add` after the
    // rail empties. See `withOffPageCycle` for why the emptying changed shape.
    const page = await mounted(SEED, { project: withOffPageCycle });
    try {
      const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '1');
      assert.ok(row !== undefined, 'no rail row for 1');
      page.click(row);
      await flush();

      // THE FILTER LIVES IN THE PANEL NOW, so the panel has to be open before
      // there is a control to press. `RULINGS.md` §3 moved it off the header
      // count, which became the panel's anchor instead.
      await page.openAudit();
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
    // always there: with the audit filter on and only OFF-PAGE rows flagged it
    // draws none, while the inspector stays perfectly usable. Pressing a
    // self-removing control there found no row, and focus fell to the body —
    // the original defect, still reachable through the repair for it.
    const page = await mounted(SEED, { project: withOffPageCycle });
    try {
      const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '1');
      assert.ok(row !== undefined, 'no rail row for 1');
      page.click(row);
      await flush();

      // THE FILTER LIVES IN THE PANEL NOW, so the panel has to be open before
      // there is a control to press. `RULINGS.md` §3 moved it off the header
      // count, which became the panel's anchor instead.
      await page.openAudit();
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
