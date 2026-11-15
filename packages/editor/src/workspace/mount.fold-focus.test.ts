/**
 * The focus follows the fold (#346).
 *
 * Under the fold a selection lifts the Inspector and hides the rail, so a rail
 * row that held the focus would drop it to the page, where no key reaches the
 * workspace and the keyboard loop stops. The design lead's call: the selected
 * issue's node in the graph takes the focus. A stylesheet stands in for the
 * container query the test window does not evaluate.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { flush, mounted } from '../testing/mount.ts';

describe('the focus follows the fold (#346)', () => {
  it('moves a rail row’s focus to the selected issue in the graph when the selection hides the rail', async () => {
    const page = await mounted();
    try {
      const fold = page.win.document.createElement('style');
      fold.textContent = ".ig-workspace[data-inspector='lifted'] .ig-zone[data-zone='rail'] { display: none; }";
      page.win.document.head.append(fold);
      const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '2');
      assert.ok(row !== undefined, 'no rail row for 2');

      row.focus();
      row.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await flush();

      const rail = page.zone('rail');
      assert.ok(rail !== null && page.win.getComputedStyle(rail).display === 'none', 'the selection did not fold the rail');
      const active = page.win.document.activeElement;
      assert.ok(active instanceof page.win.Element, 'nothing holds the focus');
      assert.equal(active.getAttribute('data-ig-key'), '2', 'the focus left the selected issue');
      assert.ok(page.zone('canvas')?.contains(active) === true, 'the focus did not move to the graph');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('leaves the focus on the rail row when nothing folds', async () => {
    const page = await mounted();
    try {
      const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '2');
      assert.ok(row !== undefined, 'no rail row for 2');

      row.focus();
      row.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await flush();

      const active = page.win.document.activeElement;
      assert.ok(active instanceof page.win.Element, 'nothing holds the focus');
      assert.equal(active.getAttribute('data-ig-key'), '2');
      assert.ok(page.zone('rail')?.contains(active) === true, 'the focus left the rail with nothing folded');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});
