/**
 * The Inspector is a sheet from the bottom under 640 (#245).
 *
 * Under 640 there is no column for the Inspector, so a selection lifts it over
 * the tab the reader is on, and Escape or its close control puts it away. The
 * test window lays nothing out, so every box would be empty and the shell
 * would read the sheet as on screen whatever its rule says. Each test stubs
 * NON-ZERO boxes instead: the rail and the sheet share the view, and the
 * canvas zone draws nothing, as on the Order tab. Before #245 the shell asked
 * only the canvas, so the same boxes read as no sheet at all.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { flush, mounted, type Mounted } from '../testing/mount.ts';

/** The phone layout's boxes: [left, top, right, bottom] per zone; any other element is an empty box. */
const PHONE: Readonly<Record<string, readonly [number, number, number, number]>> = {
  rail: [0, 120, 360, 720],
  canvas: [0, 0, 0, 0],
  inspector: [0, 420, 360, 720],
};

/** Stub every element's box from {@link PHONE}, and return the undo. */
function phoneBoxes(page: Mounted): () => void {
  const proto = page.win.Element.prototype;
  const measure = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect');
  Object.defineProperty(proto, 'getBoundingClientRect', {
    configurable: true,
    value(this: Element) {
      const [left, top, right, bottom] = PHONE[this.getAttribute('data-zone') ?? ''] ?? [0, 0, 0, 0];
      return new page.win.DOMRect(left, top, right - left, bottom - top);
    },
  });
  return () => {
    if (measure !== undefined) Object.defineProperty(proto, 'getBoundingClientRect', measure);
  };
}

async function selectRow(page: Mounted, key: string): Promise<HTMLElement> {
  const row = page.rows().find((each) => each.getAttribute('data-ig-key') === key) ?? assert.fail(`no rail row for ${key}`);
  row.dispatchEvent(new page.win.MouseEvent('click', { bubbles: true }));
  await flush();
  assert.equal(page.element.querySelector('.ig-workspace')?.getAttribute('data-inspector'), 'lifted', 'the selection did not lift the Inspector');
  return row;
}

const activeKey = (page: Mounted): string | null => page.win.document.activeElement?.getAttribute('data-ig-key') ?? null;

describe('the Inspector is a sheet from the bottom under 640 (#245)', () => {
  it('draws a named close control in the Inspector zone that sends narrow-dismiss, and names the zone', async () => {
    const page = await mounted();
    try {
      const inspector = page.zone('inspector') ?? assert.fail('no inspector zone');
      assert.ok((inspector.getAttribute('aria-label') ?? '') !== '', 'the sheet has no accessible name');
      const close = inspector.querySelector('[data-ig-command="narrow-dismiss"]') ?? assert.fail('no close control in the sheet');
      assert.equal(close.tagName, 'BUTTON');
      assert.ok((close.getAttribute('aria-label') ?? '') !== '', 'the close control has no accessible name');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('Escape from inside the sheet over the Order tab closes it, keeps the selection, and focuses the selected row', async () => {
    const page = await mounted();
    const undo = phoneBoxes(page);
    try {
      await selectRow(page, '2');
      const inspector = page.zone('inspector') ?? assert.fail('no inspector zone');
      inspector.focus();
      inspector.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await flush();
      assert.equal(page.handle.state.inspectorDismissed, true, 'Escape did not close the sheet over the rail');
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '2' }, 'Escape cleared the selection instead');
      assert.equal(activeKey(page), '2', 'the focus did not land on the selected row');
      assert.ok(page.zone('rail')?.contains(page.win.document.activeElement) === true, 'the focus is not in the order');
    } finally {
      undo();
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('the close control closes the sheet and focuses the selected row', async () => {
    const page = await mounted();
    const undo = phoneBoxes(page);
    try {
      await selectRow(page, '2');
      const close = page.element.querySelector<HTMLElement>('.ig-sheet-close') ?? assert.fail('no close control');
      close.focus();
      close.dispatchEvent(new page.win.MouseEvent('click', { bubbles: true }));
      await flush();
      assert.equal(page.handle.state.inspectorDismissed, true, 'the close control did not close the sheet');
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '2' });
      assert.equal(activeKey(page), '2', 'the focus went down with the sheet');
    } finally {
      undo();
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('focuses the active tab when the selected row is not drawn', async () => {
    const page = await mounted();
    const undo = phoneBoxes(page);
    try {
      await selectRow(page, '2');
      // The rail not drawn, as on the Related groups and Sub-issues tabs, and
      // the tabs drawn: a stylesheet stands in for the under-640 container
      // query the test window does not evaluate. `.ig-mount` outranks the
      // mount's own sheet, which comes later in the document.
      const phone = page.win.document.createElement('style');
      phone.textContent =
        ".ig-mount .ig-workspace .ig-zone[data-zone='rail'] { display: none; } .ig-mount .ig-workspace .ig-narrow-tabs { display: flex; }";
      page.win.document.head.append(phone);
      const close = page.element.querySelector<HTMLElement>('.ig-sheet-close') ?? assert.fail('no close control');
      close.focus();
      close.dispatchEvent(new page.win.MouseEvent('click', { bubbles: true }));
      await flush();
      const active = page.win.document.activeElement;
      assert.equal(active?.getAttribute('data-ig-command'), 'narrow-tab', 'the focus did not land on a tab');
      assert.equal(active?.getAttribute('aria-selected'), 'true', 'the focus landed on a tab that is not the active one');
    } finally {
      undo();
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('falls back to the restore it had before when neither the row nor a tab is drawn (the lifted Inspector at 1120-1359)', async () => {
    const page = await mounted();
    const undo = phoneBoxes(page);
    try {
      await selectRow(page, '2');
      // The rail folded and the tabs not drawn, as in §17k's band; the
      // mount's own sheet already hides the tabs outside the 640 query.
      const band = page.win.document.createElement('style');
      band.textContent = ".ig-mount .ig-workspace .ig-zone[data-zone='rail'] { display: none; }";
      page.win.document.head.append(band);
      const inspector = page.zone('inspector') ?? assert.fail('no inspector zone');
      inspector.focus();
      inspector.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await flush();
      assert.equal(page.handle.state.inspectorDismissed, true, 'Escape did not close the lifted Inspector');
      const active = page.win.document.activeElement;
      assert.ok(active !== null && page.element.contains(active), 'the focus dropped out of the workspace');
      // The test window would let a hidden tab take the focus; a browser would not, and the focus would fall to the page.
      assert.notEqual(active.getAttribute('data-ig-command'), 'narrow-tab', 'the focus went to a tab that is not drawn');
    } finally {
      undo();
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('leaves a focus outside the sheet where it is when Escape closes it', async () => {
    const page = await mounted();
    const undo = phoneBoxes(page);
    try {
      const row = await selectRow(page, '2');
      const other = page.rows().find((each) => each.getAttribute('data-ig-key') === '3') ?? row;
      other.focus();
      other.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await flush();
      assert.equal(page.handle.state.inspectorDismissed, true, 'Escape did not close the sheet');
      assert.equal(activeKey(page), other.getAttribute('data-ig-key'), 'the focus moved off the row the reader was on');
    } finally {
      undo();
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});
