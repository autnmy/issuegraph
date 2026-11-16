/**
 * The batch Inspector, mounted over a real store (#249): a selected set is
 * changed in one confirmed step, every write goes through the store, and a
 * batch that half-fails says what saved and finishes or drops the rest.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WORKSPACE_WORDS } from '../testing/workspace.ts';
import { flush, mounted, type Mounted } from '../testing/mount.ts';

const words = WORKSPACE_WORDS.batch ?? assert.fail('the test vocabulary has no batch words');

/** Select 2, 3 and 4: a click, then Cmd-clicks. */
async function selectSet(page: Mounted): Promise<void> {
  for (const [index, key] of ['2', '3', '4'].entries()) {
    const row = page.rows().find((each) => each.getAttribute('data-ig-key') === key) ?? assert.fail(`no rail row for ${key}`);
    row.dispatchEvent(new page.win.MouseEvent('click', { bubbles: true, metaKey: index > 0 }));
    await flush();
  }
  assert.deepEqual(page.handle.state.selection, { kind: 'issues', keys: ['2', '3', '4'] });
}

async function press(page: Mounted, selector: string): Promise<void> {
  const control = page.element.querySelector<HTMLElement>(selector) ?? assert.fail(`nothing matches ${selector}`);
  control.dispatchEvent(new page.win.MouseEvent('click', { bubbles: true }));
  await flush();
}

const noteText = (page: Mounted): string | null => page.element.querySelector('.ig-batch-note-title')?.textContent ?? null;

describe('the batch Inspector, mounted (#249)', () => {
  it('serializes a set of 3 in one confirmed step: the confirm counts 2 writes and both reach the store', async () => {
    const page = await mounted();
    try {
      await selectSet(page);
      await press(page, '[data-ig-command="batch-offer"][data-ig-value="serialize"]');
      assert.equal(page.element.querySelector('.ig-batch-card-title')?.textContent, words.confirmTitle(2));
      assert.equal(page.element.querySelector('.ig-batch-card')?.getAttribute('aria-modal'), 'true');
      // The confirm's first draw takes the focus onto Cancel, never onto the write.
      assert.equal(page.win.document.activeElement?.getAttribute('data-ig-command'), 'batch-cancel');
      await press(page, '[data-ig-command="batch-confirm"]');
      assert.equal(page.element.querySelector('.ig-batch-card'), null, 'the confirm stayed open');
      for (let landed = 0; landed < 2; landed += 1) {
        await page.source.whenPending();
        page.source.settleNext('applied');
        await flush();
      }
      const serialized = page.source
        .current()
        .edges.filter((edge) => edge.kind === 'serialize-with')
        .map((edge) => [edge.from, edge.to]);
      assert.deepEqual(serialized, [
        ['3', '2'],
        ['4', '2'],
      ]);
      assert.equal(noteText(page), null, 'a batch that all saved left a note');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('says "1 of 2 saved" when one write fails, and Retry sends only the one owed', async () => {
    const page = await mounted();
    try {
      await selectSet(page);
      await press(page, '[data-ig-command="batch-offer"][data-ig-value="unit"]');
      await press(page, '[data-ig-command="batch-confirm"]');
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      await page.source.whenPending();
      page.source.settleNext({ outcome: 'rejected', reason: 'the issue body is locked' });
      await flush();
      assert.equal(noteText(page), words.saved(1, 2, 1));

      await press(page, '[data-ig-command="batch-retry"]');
      const resent = await page.source.whenPending();
      assert.equal(page.source.pending().length, 1, 'Retry sent more than the one owed');
      const mutation = resent.mutation;
      assert.deepEqual(mutation.op === 'create' ? [mutation.kind, mutation.from, mutation.to] : [], ['together-with', '4', '2']);
      page.source.settleNext('applied');
      await flush();
      assert.equal(noteText(page), null, 'the note outlived the batch it was about');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('Discard drops what is owed and the note with it', async () => {
    const page = await mounted();
    try {
      await selectSet(page);
      await press(page, '[data-ig-command="batch-offer"][data-ig-value="unit"]');
      await press(page, '[data-ig-command="batch-confirm"]');
      for (const outcome of ['applied', { outcome: 'rejected', reason: 'the issue body is locked' }] as const) {
        await page.source.whenPending();
        page.source.settleNext(outcome);
        await flush();
      }
      assert.ok(page.store.getSnapshot().writes.length > 0, 'the failed write left no record to discard');
      await press(page, '[data-ig-command="batch-discard"]');
      assert.equal(noteText(page), null);
      assert.deepEqual(page.store.getSnapshot().writes, []);
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('"All 3 are blocked by…" picks the one issue from a search, and Escape closes the ask before the selection', async () => {
    const page = await mounted();
    try {
      await selectSet(page);
      await press(page, '[data-ig-command="batch-offer"][data-ig-value="blocked-by"]');
      const query = page.element.querySelector<HTMLInputElement>('input[data-ig-command="batch-query"]') ?? assert.fail('no search');
      assert.equal(page.win.document.activeElement, query, 'the search did not take the focus');
      query.value = 'first';
      query.dispatchEvent(new page.win.Event('input', { bubbles: true }));
      await flush();
      assert.deepEqual(
        [...page.element.querySelectorAll('[data-ig-command="batch-target"]')].map((pick) => pick.getAttribute('data-ig-target')),
        ['1'],
      );
      // The redraw that drew the matches replaced the box; the focus moved to the new one.
      const typed = page.element.querySelector<HTMLInputElement>('input[data-ig-command="batch-query"]') ?? assert.fail('no search');
      assert.equal(page.win.document.activeElement, typed, 'typing moved the focus out of the search');
      typed.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await flush();
      assert.equal(page.handle.state.batch.step, 'idle', 'Escape did not close the ask');
      assert.deepEqual(page.handle.state.selection, { kind: 'issues', keys: ['2', '3', '4'] }, 'Escape cleared the set');

      // Enter in the search picks the highlighted match.
      await press(page, '[data-ig-command="batch-offer"][data-ig-value="blocked-by"]');
      const again = page.element.querySelector<HTMLInputElement>('input[data-ig-command="batch-query"]') ?? assert.fail('no search');
      again.value = 'release';
      again.dispatchEvent(new page.win.Event('input', { bubbles: true }));
      await flush();
      const box = page.element.querySelector<HTMLInputElement>('input[data-ig-command="batch-query"]') ?? assert.fail('no search');
      box.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await flush();
      assert.equal(page.element.querySelector('.ig-batch-card-title')?.textContent, words.confirmTitle(3));
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});
