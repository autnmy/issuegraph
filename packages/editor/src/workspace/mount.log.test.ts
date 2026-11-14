/**
 * The log under the workspace head, mounted.
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
 *
 * ITS OWN FILE, beside `mount.test.ts`, so neither file runs into the per-test
 * timeout that also bounds a whole file.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GraphDocument } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';

import { WORKSPACE_WORDS } from '../testing/workspace.ts';
import { SEED, flush, blockingDeriver, hostedProject, mounted } from '../testing/mount.ts';

describe('the log under the head, mounted', () => {
  it('R3 mountWorkspace: a write that failed with nothing selected stays in the log under the head, with Retry and Discard that reach the store', async () => {
    const page = await mounted();
    try {
      const write = page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending(write.mutationId);
      page.source.settleNext({ outcome: 'rejected', reason: 'the tracker said no' });
      await write.settled;
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'none' });

      // The issue: "A write that was not saved stays in the log, whether or not its issue is selected, with Retry and "Discard my edit"."
      const logCards = (): HTMLElement[] => [
        ...(page.zone('header')?.querySelectorAll<HTMLElement>('.ig-recovery') ?? []),
      ];
      assert.equal(logCards().length, 1, 'the failed write is not in the log exactly once');
      const card = logCards()[0];
      assert.ok(card !== undefined);
      assert.equal(card.getAttribute('data-ig-state'), 'failed');
      assert.equal(card.querySelector('.ig-recovery-reason')?.textContent, 'the tracker said no');
      assert.deepEqual(
        [...card.querySelectorAll('.ig-recovery-action')].map((node) => [
          node.getAttribute('data-ig-command'),
          node.getAttribute('data-ig-target'),
        ]),
        [
          ['retry', write.mutationId],
          ['discard', write.mutationId],
        ],
      );
      const retry = card.querySelector<HTMLElement>('[data-ig-command="retry"]');
      assert.ok(retry !== null);
      assert.equal(retry.textContent, WORKSPACE_WORDS.recovery.retry);
      assert.ok(
        card.querySelector('[data-ig-command="discard"]')?.textContent?.includes(WORKSPACE_WORDS.recovery.discardMine),
        'Discard is not in the host word',
      );

      page.click(retry);
      await page.source.whenPending();
      assert.equal(page.store.getSnapshot().writes[0]?.state, 'pending', 'Retry in the log did not reach the store');
      page.source.settleNext({ outcome: 'rejected', reason: 'the tracker said no again' });
      await flush();
      await flush();

      const discard = logCards()[0]?.querySelector<HTMLElement>('[data-ig-command="discard"]') ?? null;
      assert.ok(discard !== null, 'the write failed again and is not in the log');
      page.click(discard);
      await flush();
      assert.deepEqual(page.store.getSnapshot().writes, [], 'Discard in the log did not reach the store');
      assert.equal(logCards().length, 0, 'the discarded write is still in the log');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('R3 R4 mountWorkspace: a failed write is drawn once, in the log, with another issue selected, and its log card matches the Inspector card when its own issue is selected', async () => {
    const page = await mounted();
    try {
      const write = page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending(write.mutationId);
      page.source.settleNext({ outcome: 'rejected', reason: 'the tracker said no' });
      await write.settled;
      await flush();

      const selectRow = async (key: string): Promise<void> => {
        const row = page.rows().find((each) => each.getAttribute('data-ig-key') === key);
        assert.ok(row !== undefined, `no rail row for ${key}`);
        page.click(row);
        await flush();
      };
      const cardsIn = (zone: string): HTMLElement[] => [
        ...(page.zone(zone)?.querySelectorAll<HTMLElement>('.ig-recovery') ?? []),
      ];
      const everyCard = (): HTMLElement[] => [...page.element.querySelectorAll<HTMLElement>('.ig-recovery')];

      // The issue: "A write that was not saved stays in the log, whether or not its issue is selected, with Retry and "Discard my edit"."
      await selectRow('1');
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '1' });
      assert.equal(cardsIn('header').length, 1, 'the log dropped the write while another issue is selected');
      assert.equal(everyCard().length, 1, 'the write is drawn more than once');

      // The issue: "It is the same note and actions the Inspector shows for the selected issue."
      await selectRow('3');
      const logged = cardsIn('header')[0];
      const inspected = cardsIn('inspector')[0];
      assert.ok(logged !== undefined, 'the log dropped the write while its own issue is selected');
      assert.ok(inspected !== undefined, 'the Inspector stopped drawing the selected issue card');
      assert.equal(everyCard().length, 2, 'expected one card in the log and one in the Inspector');
      const face = (card: HTMLElement): unknown => ({
        state: card.getAttribute('data-ig-state'),
        text: card.textContent,
        actions: [...card.querySelectorAll('.ig-recovery-action')].map((node) => [
          node.getAttribute('data-ig-command'),
          node.getAttribute('data-ig-target'),
          node.textContent,
        ]),
      });
      assert.deepEqual(face(logged), face(inspected));
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('two failed writes on unselected issues each keep their own Retry and Discard in the log', async () => {
    const page = await mounted();
    try {
      const onThree = page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending(onThree.mutationId);
      page.source.settleNext({ outcome: 'rejected', reason: 'the tracker said no' });
      await onThree.settled;
      const onFour = page.store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '2' });
      await page.source.whenPending(onFour.mutationId);
      page.source.settleNext({ outcome: 'rejected', reason: 'the tracker said no again' });
      await onFour.settled;
      await flush();

      // The header is redrawn on every store update, so it is queried afresh each time.
      const logCards = (): HTMLElement[] => [
        ...(page.zone('header')?.querySelectorAll<HTMLElement>('.ig-recovery') ?? []),
      ];
      const actionsOf = (card: HTMLElement): (string | null)[][] =>
        [...card.querySelectorAll('.ig-recovery-action')].map((action) => [
          action.getAttribute('data-ig-command'),
          action.getAttribute('data-ig-target'),
        ]);

      // The issue: "A write that was not saved stays in the log, whether or not its issue is selected, with Retry and "Discard my edit"."
      assert.deepEqual(
        logCards().map(actionsOf),
        [
          [['retry', onThree.mutationId], ['discard', onThree.mutationId]],
          [['retry', onFour.mutationId], ['discard', onFour.mutationId]],
        ],
        'each not-saved write needs its own card whose controls name that write',
      );

      const fourCard = logCards()[1];
      assert.ok(fourCard !== undefined);
      const discardFour = fourCard.querySelector<HTMLElement>('[data-ig-command="discard"]');
      assert.ok(discardFour !== null);
      page.click(discardFour);
      await flush();

      assert.deepEqual(
        page.store.getSnapshot().writes.map((record) => record.mutationId),
        [onThree.mutationId],
        'discarding one card removed a different write',
      );
      assert.deepEqual(logCards().map(actionsOf), [[['retry', onThree.mutationId], ['discard', onThree.mutationId]]]);
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('a failed write on an unselected issue stays in the log across redraws and is re-sent once by its Retry', async () => {
    const dispatched: string[] = [];
    const page = await mounted(SEED, {
      wrap: (source) => ({
        ...source,
        dispatch: (mutation) => {
          dispatched.push(mutation.mutationId);
          return source.dispatch(mutation);
        },
      }),
    });
    try {
      const failed = page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending(failed.mutationId);
      page.source.settleNext({ outcome: 'rejected', reason: 'the tracker said no' });
      await flush();

      // The issue: "A write that was not saved stays in the log, whether or not its issue is selected, with Retry and "Discard my edit"."
      const stillListed = (when: string): HTMLElement => {
        const cards = [
          ...(page.zone('header')?.querySelectorAll<HTMLElement>('.ig-recovery[data-ig-state="failed"]') ?? []),
        ];
        assert.equal(cards.length, 1, `the log does not list the failed write ${when}`);
        const card = cards[0];
        assert.ok(card !== undefined);
        assert.deepEqual(
          [...card.querySelectorAll('.ig-recovery-action')].map((node) => [
            node.getAttribute('data-ig-command'),
            node.getAttribute('data-ig-target'),
          ]),
          [
            ['retry', failed.mutationId],
            ['discard', failed.mutationId],
          ],
          `the log entry does not carry Retry and Discard for its write ${when}`,
        );
        return card;
      };

      stillListed('with nothing selected');
      page.handle.update();
      await flush();
      stillListed('after a redraw');
      const other = page.rows().find((row) => row.getAttribute('data-ig-key') === '2');
      assert.ok(other !== undefined, 'no rail row for 2');
      page.click(other);
      await flush();
      const card = stillListed('with another issue selected');

      const retry = card.querySelector('[data-ig-command="retry"]');
      assert.ok(retry !== null);
      page.click(retry);
      await page.source.whenPending(failed.mutationId);
      // A second press while the retry is in flight must not send the write again.
      page.handle.dispatch({ kind: 'control', name: 'retry', target: failed.mutationId });
      await flush();
      assert.deepEqual(dispatched, [failed.mutationId, failed.mutationId], 'the retry was not sent exactly once');

      page.source.settleNext('applied');
      await flush();
      assert.deepEqual(page.store.getSnapshot().writes, []);
      assert.equal(
        page.zone('header')?.querySelector('.ig-recovery') ?? null,
        null,
        'a write that saved stayed in the log as not saved',
      );
      assert.deepEqual(dispatched, [failed.mutationId, failed.mutationId], 'the landing sent the write again');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('two presses of a log card Retry send the failed write only once', async () => {
    let dispatches = 0;
    const page = await mounted(SEED, {
      wrap: (source) => ({
        ...source,
        dispatch: (mutation) => {
          dispatches += 1;
          return source.dispatch(mutation);
        },
      }),
    });
    try {
      const write = page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending(write.mutationId);
      page.source.settleNext({ outcome: 'rejected', reason: 'the tracker said no' });
      await write.settled;
      await flush();
      assert.equal(dispatches, 1);

      // The issue: "A write that was not saved stays in the log, whether or not its issue is selected, with Retry and "Discard my edit"."
      const retry =
        page.zone('header')?.querySelector<HTMLElement>(
          `.ig-recovery [data-ig-command="retry"][data-ig-target="${write.mutationId}"]`,
        ) ?? null;
      assert.ok(retry !== null, 'the log has no Retry for the failed write');
      // Both presses land before the coalesced redraw replaces the button.
      page.click(retry);
      page.click(retry);

      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      await flush();

      assert.equal(dispatches, 2, 'the second press sent the same write again');
      assert.deepEqual(page.store.getSnapshot().writes, []);
      assert.equal(
        page.zone('header')?.querySelector('.ig-recovery') ?? null,
        null,
        'the log kept a not-saved card for a write that saved',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('R5 R10 mountWorkspace: a write someone else got to first stays in the log with Compare, redo on the latest version and Discard, and its redo reads the latest version before it resends', async () => {
    let reads = 0;
    const page = await mounted(SEED, {
      wrap: (source) => ({
        ...source,
        hydrate: () => {
          reads += 1;
          return source.hydrate();
        },
      }),
    });
    try {
      const write = page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending(write.mutationId);
      const upstream: GraphDocument = { issues: SEED.issues, edges: [...SEED.edges, makeEdge('blocked-by', '2', '3')] };
      page.source.settleNext({ outcome: 'conflict', upstream });
      await write.settled;
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'none' });

      // The issue: "A write someone else got to first stays in the log with the attention note and its actions (Compare, "Redo on the latest version", "Discard my edit")."
      const cards = [...(page.zone('header')?.querySelectorAll<HTMLElement>('.ig-recovery') ?? [])];
      assert.equal(cards.length, 1, 'the conflicted write is not in the log exactly once');
      const card = cards[0];
      assert.ok(card !== undefined);
      assert.equal(card.getAttribute('data-ig-state'), 'conflict');
      assert.ok(card.textContent?.includes(WORKSPACE_WORDS.recovery.conflict), 'the attention note is missing');
      assert.deepEqual(
        [...card.querySelectorAll('.ig-recovery-action')].map((node) => [
          node.getAttribute('data-ig-command'),
          node.getAttribute('data-ig-target'),
        ]),
        [
          ['view-diff', write.mutationId],
          ['retry', write.mutationId],
          ['discard', write.mutationId],
        ],
      );
      assert.ok(card.querySelector('[data-ig-command="view-diff"]')?.textContent?.includes(WORKSPACE_WORDS.recovery.viewDiff));
      const redo = card.querySelector<HTMLElement>('[data-ig-command="retry"]');
      assert.ok(redo !== null);
      assert.equal(redo.textContent, WORKSPACE_WORDS.recovery.retryOnLatest);

      // The redo is the store's retry-on-latest, which reads the tracker again
      // before it resends; a plain retry would resend without that read.
      const readsBefore = reads;
      page.click(redo);
      await page.source.whenPending();
      assert.equal(reads, readsBefore + 1, 'the redo resent without reading the latest version first');
      page.source.settleNext('applied');
      await flush();
      await flush();
      assert.equal(page.zone('header')?.querySelector('.ig-recovery') ?? null, null, 'the redone write is still in the log after it was saved');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('with a conflict Compare open on the selected issue no two elements share an id', async () => {
    // The selected issue's conflict is drawn twice, in the log and in the
    // Inspector, so an id derived from the write alone would be minted twice.
    const page = await mounted();
    try {
      const write = page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending(write.mutationId);
      page.source.settleNext({
        outcome: 'conflict',
        upstream: { issues: SEED.issues, edges: [...SEED.edges, makeEdge('blocked-by', '2', '3')] },
      });
      await write.settled;
      await flush();
      const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '3');
      assert.ok(row !== undefined, 'no rail row for 3');
      page.click(row);
      await flush();

      // The issue: "A write someone else got to first stays in the log with the attention note and its actions (Compare, "Redo on the latest version", "Discard my edit")."
      assert.ok(
        page.zone('header')?.querySelector('.ig-recovery[data-ig-state="conflict"]'),
        'the log does not list the conflict, so this test would prove nothing',
      );
      const compare =
        page.zone('inspector')?.querySelector<HTMLElement>('.ig-recovery [data-ig-command="view-diff"]') ?? null;
      assert.ok(compare !== null, 'the Inspector card has no Compare');
      page.click(compare);
      await flush();

      const ids = [...page.element.querySelectorAll('[id]')].map((node) => node.id);
      assert.deepEqual(
        ids.filter((id, index) => ids.indexOf(id) !== index),
        [],
        'two elements share an id',
      );
      const controls = [...page.element.querySelectorAll('[data-ig-command="view-diff"][aria-controls]')];
      assert.ok(controls.length > 0, 'no Compare names the region it opens');
      for (const control of controls) {
        const id = control.getAttribute('aria-controls') ?? '';
        assert.equal(
          page.element.querySelectorAll(`[id="${id}"]`).length,
          1,
          `aria-controls ${id} does not name exactly one element`,
        );
      }
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('a failed read on one conflict redo is drawn on that write log card only', async () => {
    let readFails = false;
    const page = await mounted(SEED, {
      wrap: (source) => ({
        ...source,
        hydrate: () =>
          readFails ? Promise.reject(new Error('the tracker did not answer')) : source.hydrate(),
      }),
    });
    try {
      const upstream = { issues: SEED.issues, edges: [...SEED.edges, makeEdge('blocked-by', '2', '3')] };
      const first = page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending(first.mutationId);
      page.source.settleNext({ outcome: 'conflict', upstream });
      await first.settled;
      const second = page.store.propose({ op: 'create', kind: 'blocked-by', from: '4', to: '2' });
      await page.source.whenPending(second.mutationId);
      page.source.settleNext({ outcome: 'conflict', upstream });
      await second.settled;
      await flush();

      readFails = true;
      page.handle.dispatch({ kind: 'control', name: 'retry', target: first.mutationId });
      await flush();
      await flush();
      assert.equal(
        page.store.getSnapshot().writes.filter((record) => record.state === 'conflict').length,
        2,
        'two standing conflicts are needed for "only that card" to mean anything',
      );

      const header = page.zone('header');
      assert.ok(header !== null, 'no header zone');
      // The issue: "A write someone else got to first stays in the log with the attention note and its actions (Compare, "Redo on the latest version", "Discard my edit")."
      const errors = [...header.querySelectorAll('.ig-recovery-refresh-error')];
      assert.equal(errors.length, 1, 'the read failure was drawn on the wrong number of log cards');
      assert.match(errors[0]?.textContent ?? '', /the tracker did not answer/);
      assert.equal(
        errors[0]?.closest('.ig-recovery')?.querySelector('[data-ig-command="retry"]')?.getAttribute('data-ig-target'),
        first.mutationId,
        'the read failure was blamed on a write whose redo nobody pressed',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('R2 mountWorkspace: a saving write says so in the log beside the held sentence, names its kind in the host word, and leaves the log when it is saved', async () => {
    const page = await mounted();
    try {
      const headerText = (): string => page.zone('header')?.textContent ?? '';
      assert.equal(headerText().includes(WORKSPACE_WORDS.log.saving), false, 'the log says a write is saving before any is');

      const write = page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending(write.mutationId);
      await flush();

      // The issue: "While a write is saving it says so, and the order holds: "Saving. The order updates when the save is done.""
      assert.ok(headerText().includes(WORKSPACE_WORDS.log.saving), 'the log does not say the write is saving');
      assert.ok(headerText().includes(WORKSPACE_WORDS.change.computing), 'the held sentence is missing');
      assert.ok(headerText().includes(WORKSPACE_WORDS.log.ops.create), 'the entry does not name the write');
      assert.ok(headerText().includes(WORKSPACE_WORDS.log.kinds['blocked-by']), 'the entry does not name the kind in the host word');
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-order'), 'held');

      page.source.settleNext('applied');
      await write.settled;
      await flush();
      assert.equal(headerText().includes(WORKSPACE_WORDS.log.saving), false, 'the saved write still says it is saving');
      assert.equal(headerText().includes(WORKSPACE_WORDS.change.computing), false, 'the held sentence outlived the save');
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-order'), 'settled');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

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
      assert.ok(
        line.textContent?.includes(WORKSPACE_WORDS.change.facets['newly-held']),
        'the saved line does not name the newly held count in the host word',
      );
      assert.equal(
        line.querySelector('.ig-change-part[data-facet="newly-held"] .ig-change-count')?.textContent,
        '2',
        'the saved line does not count both saved writes',
      );
      const failed = [...(header()?.querySelectorAll<HTMLElement>('.ig-recovery') ?? [])];
      assert.equal(failed.length, 1, 'the failed last write is not in the log beside the saved line');
      assert.equal(failed[0]?.getAttribute('data-ig-state'), 'failed');
      assert.deepEqual(
        [...(failed[0]?.querySelectorAll('.ig-recovery-action') ?? [])].map((action) => action.getAttribute('data-ig-target')),
        [third.mutationId, third.mutationId],
        'the failed entry does not act on the write that failed',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('R6 mountWorkspace: the saved line stays through a redraw, a new edit and a write that failed, and only the dismiss control removes it', async () => {
    const page = await mounted(SEED, { derive: blockingDeriver });
    try {
      const lineText = (): string =>
        page.zone('header')?.querySelector('.ig-change-line[role="status"]')?.textContent ?? '';
      const showsSaved = (when: string): void => {
        assert.ok(lineText().includes(WORKSPACE_WORDS.change.saved), `the saved lead is missing ${when}`);
        assert.ok(lineText().includes(WORKSPACE_WORDS.change.facets['newly-held']), `the saved counts are missing ${when}`);
      };

      const first = page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending(first.mutationId);
      page.source.settleNext('applied');
      await first.settled;
      await flush();

      // The issue: "A saved change says what it did to the order, in `text-muted`, until it is dismissed: "Saved: 2 moved · 1 newly held", or "Saved. The order did not change." Never on a timer."
      showsSaved('after the landing');

      page.handle.update();
      await flush();
      showsSaved('after a redraw');

      const second = page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending(second.mutationId);
      await flush();
      showsSaved('while the next edit is saving');

      page.source.settleNext({ outcome: 'rejected', reason: 'the tracker said no' });
      await second.settled;
      await flush();
      showsSaved('after the next edit was not saved');
      assert.equal(page.zone('header')?.querySelectorAll('.ig-recovery').length, 1, 'the failed write is not in the log');

      const dismiss = page.zone('header')?.querySelector<HTMLElement>('[data-ig-command="dismiss-change"]') ?? null;
      assert.ok(dismiss !== null, 'the saved line has no dismiss control');
      page.click(dismiss);
      await flush();
      assert.equal(page.store.getSnapshot().lastChange, undefined, 'dismiss-change did not reach the store');
      assert.equal(lineText().includes(WORKSPACE_WORDS.change.saved), false, 'dismissing left the saved line');
      assert.equal(
        lineText().includes(WORKSPACE_WORDS.change.facets['newly-held']),
        false,
        'the saved counts outlived their dismissal',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it("the log draws a refused write's reason as text, and the reason forges no control", async () => {
    // THE REASON IS THE ADAPTER'S, relayed from the tracker, so the package does
    // not control a word of it. The log is a second place it is drawn, now on an
    // issue nobody selected. Decoded as markup, this reason would open an element
    // with a script handler, and add a button the click handler would read as a
    // real discard of a write named "forged".
    const forged = '<img src=x onerror=alert(1)><button data-ig-command="discard" data-ig-target="forged">';
    const page = await mounted(SEED, { project: hostedProject });
    try {
      const write = page.store.propose({ op: 'create', kind: 'blocked-by', from: '3', to: '4' });
      await page.source.whenPending();
      page.source.settleNext({ outcome: 'rejected', reason: forged });
      await flush();
      assert.deepEqual(page.handle.state.selection, { kind: 'none' }, 'something is selected, so this is not the unselected case');

      const header = page.zone('header');
      assert.ok(header !== null, 'no header zone');
      // "A write that was not saved stays in the log, whether or not its issue is selected, with Retry and "Discard my edit"."
      const card = header.querySelector<HTMLElement>('.ig-recovery');
      assert.ok(card !== null, 'the log drew no card for the failed write, so this proves nothing');
      assert.equal(card.querySelector('.ig-recovery-reason')?.textContent, forged, 'the reason was not drawn as its own text');
      assert.equal(header.querySelector('img'), null, 'the reason opened an element in the log');

      const targets = [...header.querySelectorAll('[data-ig-target]')].map((node) => node.getAttribute('data-ig-target'));
      assert.ok(targets.length > 0, 'the log card names no write on its controls');
      assert.deepEqual(new Set(targets), new Set([write.mutationId]), 'a control in the log names a write the store never made');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it("the log names a saving write's issue refs as text, never as markup", async () => {
    // AN ISSUE REF IS TRACKER DATA, and the log is the first part of the header
    // that prints the refs at a write's two ends. Decoded as markup, this ref
    // would open an element with a script handler in the header, which is drawn
    // at every width.
    const hostile = '<img src=x onerror=alert(1)>';
    const seed: GraphDocument = {
      issues: [...SEED.issues, { ref: hostile, title: 'An issue with a hostile ref', state: 'open' }],
      edges: SEED.edges,
    };
    const page = await mounted(seed, { project: hostedProject });
    try {
      void page.store.propose({ op: 'create', kind: 'blocked-by', from: hostile, to: '3' });
      await page.source.whenPending();
      await flush();

      const header = page.zone('header');
      assert.ok(header !== null, 'no header zone');
      // "While a write is saving it says so, and the order holds: "Saving. The order updates when the save is done.""
      assert.ok(
        [...header.querySelectorAll('.ig-id')].some((node) => (node.textContent ?? '').includes(hostile)),
        'the saving write does not name its issue in the log, so this proves nothing',
      );
      assert.equal(header.querySelector('img'), null, 'an issue ref opened an element in the log');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});
