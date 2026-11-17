import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StoreSnapshot } from '@issuegraph/store';

import type { AuditToggleOption, WorkspaceProjection } from './mount.ts';
import type { AuditToggleFacts } from './render.ts';
import { SEED, flush, mounted, project, type Mounted } from '../testing/mount.ts';

test('R5 auditToggle onChange hands the host a fresh frozen facts record that writes cannot change', async () => {
  function withCycleAudit(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const told: AuditToggleFacts[] = [];
  const auditToggle: AuditToggleOption = {
    placement: 'host',
    onChange: (facts) => {
      told.push(facts);
    },
    focusToggle: () => undefined,
  };
  const page: Mounted = await mounted(SEED, { project: withCycleAudit, auditToggle });
  try {
    await flush();
    // The issue: "After every draw where a fact changed, the mount calls `onChange` with the facts."
    const first = told[0];
    assert.ok(first !== undefined, 'the mount never told the host the facts');
    // The host's code runs outside the mount. A record it could write to would let
    // it change the facts the mount compares the next draw against.
    assert.ok(Object.isFrozen(first), 'the facts record handed to the host is writable');
    assert.equal(Reflect.set(first, 'count', first.count + 100), false);
    assert.equal(Reflect.set(first, 'open', true), false);

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const last = told[told.length - 1];
    assert.ok(last !== undefined && last !== first, 'opening the panel did not hand the host a new record');
    assert.ok(Object.isFrozen(last), 'the second facts record handed to the host is writable');
    assert.equal(last.open, true);
    assert.equal(last.count, first.count, 'a write the host attempted changed the count the mount reports');
    page.handle.destroy();
  } finally {
    page.dom.window.close();
  }
});

test('R7 auditToggle focusToggle is not called when the host closes the panel while focus is on a rail row', async () => {
  function withCycleAudit(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const told: AuditToggleFacts[] = [];
  let handedFocus = 0;
  const auditToggle: AuditToggleOption = {
    placement: 'host',
    onChange: (facts) => {
      told.push(facts);
    },
    focusToggle: () => {
      handedFocus += 1;
    },
  };
  const page: Mounted = await mounted(SEED, { project: withCycleAudit, auditToggle });
  try {
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.ok(page.element.querySelector('.ig-audit-overlay') !== null, 'the dispatch did not open the panel');

    const row = page.rows()[0];
    assert.ok(row !== undefined, 'no rail row to stand on');
    row.focus();
    assert.equal(page.win.document.activeElement, row, 'the fixture cannot focus a row');
    const key = row.getAttribute('data-ig-key');

    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();
    assert.equal(page.element.querySelector('.ig-audit-overlay'), null, 'audit-close did not close the panel');
    assert.equal(told[told.length - 1]?.open, false, 'the host was not told the panel closed');
    // The issue: "When the panel closes with focus inside it, the mount calls `focusToggle` instead of searching its own surface for a toggle that is no longer there."
    // Focus was on a rail row, outside the panel, so the mount must not hand it to the host.
    assert.equal(handedFocus, 0, 'the mount handed focus to the host although the panel did not hold it');
    assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), key, 'focus left the rail row');
    page.handle.destroy();
  } finally {
    page.dom.window.close();
  }
});

test('R5 auditToggle onChange that reapplies the same option through update gets one call per change and the redraws stop', async () => {
  function withCycleAudit(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const told: AuditToggleFacts[] = [];
  let page: Mounted | undefined;
  const auditToggle: AuditToggleOption = {
    placement: 'host',
    onChange: (facts) => {
      told.push(facts);
      // A host that reapplies its options on every report. If each update drew
      // again and each draw reported again, the page would never stop redrawing.
      page?.handle.update({ auditToggle });
    },
    focusToggle: () => undefined,
  };
  page = await mounted(SEED, { project: withCycleAudit, auditToggle });
  try {
    for (let turn = 0; turn < 3; turn += 1) await flush();
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    for (let turn = 0; turn < 5; turn += 1) await flush();

    const settled = page.element.querySelector('.ig-audit-overlay');
    assert.ok(settled !== null, 'the dispatch did not open the panel');
    await flush();
    assert.equal(
      page.element.querySelector('.ig-audit-overlay'),
      settled,
      'the mount kept redrawing after the facts stopped changing',
    );
    // The issue: "After every draw where a fact changed, the mount calls `onChange` with the facts."
    // The facts changed twice: the first draw, then the panel opening.
    assert.deepEqual(
      told.map((facts) => facts.open),
      [false, true],
    );
    page.handle.destroy();
  } finally {
    page.dom.window.close();
  }
});

import type { AuditInput } from '../audit/findings.ts';
import { auditOverlay } from '../audit/surface.ts';
test('R6: onChange count equals auditOverlay(input).count after an update that changes the input', async () => {
  function cycleAudit(snapshot: StoreSnapshot): AuditInput {
    return {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
    };
  }
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return { ...project(snapshot), audit: cycleAudit(snapshot) };
  }
  const told: AuditToggleFacts[] = [];
  const latest = (): AuditToggleFacts | undefined => told[told.length - 1];
  const page = await mounted(SEED, {
    auditToggle: {
      placement: 'host',
      onChange: (facts: AuditToggleFacts): void => {
        told.push(facts);
      },
      focusToggle: (): void => {},
    },
  });
  try {
    await flush();
    assert.equal(latest()?.count, 0, 'the default projection declares no cycle, so the first report must count 0');

    page.handle.update({ project: withCycle });
    await flush();
    const expected = auditOverlay(cycleAudit(page.store.getSnapshot())).count;
    assert.ok(expected > 0, 'the cycle fixture produced no finding, so this proves nothing');
    // The issue: "`onChange` `count` equals `auditOverlay(input).count` after an update that changes the input."
    assert.equal(latest()?.count, expected);

    const reports = told.length;
    page.handle.update();
    await flush();
    // The issue: "After every draw where a fact changed, the mount calls `onChange` with the facts."
    // This redraw changes no fact, so the host must not be told the same facts twice.
    assert.equal(told.length, reports, 'a redraw with unchanged facts reported them again');
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('R5: repeating audit-close on a shut panel, a plain update and a selection add no onChange call', async () => {
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const told: AuditToggleFacts[] = [];
  const latest = (): AuditToggleFacts | undefined => told[told.length - 1];
  const page = await mounted(SEED, {
    project: withCycle,
    auditToggle: {
      placement: 'host',
      onChange: (facts: AuditToggleFacts): void => {
        told.push(facts);
      },
      focusToggle: (): void => {},
    },
  });
  try {
    // The issue: "The host opens and closes the panel through the existing `audit-panel` control and closes it on Escape through the existing `audit-close` control."
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.equal(latest()?.open, true, 'opening the panel was not reported');
    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();
    assert.equal(latest()?.open, false, 'closing the panel was not reported');

    const reports = told.length;
    // The issue: "After every draw where a fact changed, the mount calls `onChange` with the facts."
    // Each of these draws again with the same facts, so none of them may report.
    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();
    page.handle.update();
    await flush();
    page.handle.dispatch({ kind: 'point', key: '2' });
    await flush();
    assert.equal(told.length, reports, 'a draw that changed no fact told the host again');
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('KTD6: an onChange that reapplies the same option through update gets one call per change and the redraws stop', async () => {
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const told: AuditToggleFacts[] = [];
  let reapply: (() => void) | undefined;
  const toggle = {
    placement: 'host' as const,
    onChange: (facts: AuditToggleFacts): void => {
      told.push(facts);
      // Bounded so a mount that reports on every redraw fails here instead of
      // redrawing until the per-test timeout.
      if (told.length < 20) reapply?.();
    },
    focusToggle: (): void => {},
  };
  const page = await mounted(SEED, { project: withCycle, auditToggle: toggle });
  try {
    reapply = (): void => {
      page.handle.update({ auditToggle: toggle });
    };
    await flush();
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    await flush();
    await flush();
    // Passing the same option again keeps what the host was last told, so the
    // only reports are the first draw and the one real change: the panel opening.
    assert.deepEqual(
      told.map((facts) => facts.open),
      [false, true],
    );

    const overlay = page.element.querySelector('.ig-audit-overlay');
    assert.ok(overlay !== null, 'the panel did not open, so this proves nothing');
    await flush();
    await flush();
    assert.equal(
      page.element.querySelector('.ig-audit-overlay'),
      overlay,
      'the mount kept redrawing after the facts stopped changing',
    );
    assert.equal(told.length, 2);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('KTD6: update with a new onChange tells only the new callback the current facts, once', async () => {
  function cycleAudit(snapshot: StoreSnapshot): AuditInput {
    return {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
    };
  }
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return { ...project(snapshot), audit: cycleAudit(snapshot) };
  }
  const toldFirst: AuditToggleFacts[] = [];
  const toldSecond: AuditToggleFacts[] = [];
  const page = await mounted(SEED, {
    project: withCycle,
    auditToggle: {
      placement: 'host',
      onChange: (facts: AuditToggleFacts): void => {
        toldFirst.push(facts);
      },
      focusToggle: (): void => {},
    },
  });
  try {
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const firstReports = toldFirst.length;
    assert.ok(firstReports > 0, 'the first callback was never told anything');

    page.handle.update({
      auditToggle: {
        placement: 'host',
        onChange: (facts: AuditToggleFacts): void => {
          toldSecond.push(facts);
        },
        focusToggle: (): void => {},
      },
    });
    await flush();
    // The facts did not change, but the new callback has never been told them.
    assert.equal(toldSecond.length, 1, 'the new callback was not told the current facts exactly once');
    assert.equal(toldSecond[0]?.open, true);
    assert.equal(toldSecond[0]?.count, auditOverlay(cycleAudit(page.store.getSnapshot())).count);
    assert.equal(toldFirst.length, firstReports, 'the replaced callback was still called');

    page.handle.update();
    await flush();
    assert.equal(toldSecond.length, 1, 'a redraw with unchanged facts told the new callback again');
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('KTD6: removing auditToggle redraws the in-mount count and adding it back tells the host the current facts again', async () => {
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const told: AuditToggleFacts[] = [];
  const toggle = {
    placement: 'host' as const,
    onChange: (facts: AuditToggleFacts): void => {
      told.push(facts);
    },
    focusToggle: (): void => {},
  };
  const page = await mounted(SEED, { project: withCycle, auditToggle: toggle });
  const inMountCount = (): Element | null => page.element.querySelector('[data-ig-audit-count]');
  try {
    await flush();
    const firstReport = told[told.length - 1];
    assert.ok(firstReport !== undefined, 'the host was never told the facts');
    assert.ok(firstReport.count > 0, 'the cycle fixture produced no finding, so this proves nothing');
    assert.equal(inMountCount(), null, 'the mount drew its own count while the host holds it');

    page.handle.update({ auditToggle: undefined });
    await flush();
    assert.ok(inMountCount() !== null, 'removing the option did not bring the in-mount count back');
    const reports = told.length;

    page.handle.update({ auditToggle: toggle });
    await flush();
    // The facts are the same as before, but the option went from absent to
    // present, so the host is told them once more and only once.
    assert.equal(told.length, reports + 1);
    assert.equal(told[told.length - 1]?.count, firstReport.count);
    assert.equal(inMountCount(), null, 'adding the option back left the in-mount count drawn');
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('KTD4: each onChange call hands a fresh frozen facts object that later draws do not change', async () => {
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const told: AuditToggleFacts[] = [];
  const page = await mounted(SEED, {
    project: withCycle,
    auditToggle: {
      placement: 'host',
      onChange: (facts: AuditToggleFacts): void => {
        told.push(facts);
      },
      focusToggle: (): void => {},
    },
  });
  try {
    await flush();
    const shut = told[0];
    assert.ok(shut !== undefined, 'the host was never told the facts');
    // A host keeps the object it was handed, so the mount must not be able to
    // change it underneath the host, and the host must not be able to change it.
    assert.ok(Object.isFrozen(shut), 'the facts handed to the host can be changed');

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const opened = told[told.length - 1];
    assert.ok(opened !== undefined);
    assert.notEqual(opened, shut, 'the mount reused one facts object for two reports');
    assert.equal(opened.open, true);
    assert.equal(shut.open, false, 'an earlier report changed after the host received it');
    assert.ok(Object.isFrozen(opened));
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('R5: panelId from onChange names the drawn panel and still names it after a close and reopen', async () => {
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const told: AuditToggleFacts[] = [];
  const latest = (): AuditToggleFacts | undefined => told[told.length - 1];
  const drawnPanelId = (): string | undefined =>
    page.element.querySelector<HTMLElement>('div.ig-audit-overlay')?.id;
  const page = await mounted(SEED, {
    project: withCycle,
    auditToggle: {
      placement: 'host',
      onChange: (facts: AuditToggleFacts): void => {
        told.push(facts);
      },
      focusToggle: (): void => {},
    },
  });
  try {
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const panelId = drawnPanelId();
    assert.ok(panelId !== undefined && panelId !== '', 'the open panel carries no id');
    // The issue: "`panelId` in `onChange` equals the rendered panel's id."
    assert.equal(latest()?.panelId, panelId);

    // A host points its button at this id while the panel is shut, so the id it
    // holds must still name the panel the next time the panel is drawn.
    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();
    assert.equal(latest()?.open, false);
    assert.equal(latest()?.panelId, panelId);
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.equal(drawnPanelId(), latest()?.panelId);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('R6: reporting the facts to the host reads the audit input no more often than a mount without auditToggle', async () => {
  // "They come from the same `auditOverlay` evaluation that feeds the panel, never from a second evaluation, so the count a host shows and the panel it opens always agree."
  // Every evaluation of the audit reads the graph's cycles, so a getter that counts
  // those reads shows how many evaluations a mount runs. A mount that told the host
  // its facts from a second evaluation would read them more often than one that does not.
  function countingCycleProjection(): { projection: (snapshot: StoreSnapshot) => WorkspaceProjection; reads: () => number } {
    let reads = 0;
    const projection = (snapshot: StoreSnapshot): WorkspaceProjection => ({
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: {
          get cycles() {
            reads += 1;
            return [['1', '2']];
          },
          duplicateCanonical: () => null,
        },
      },
    });
    return { projection, reads: () => reads };
  }

  async function openAndCloseByDispatch(page: Awaited<ReturnType<typeof mounted>>): Promise<void> {
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
  }

  const plain = countingCycleProjection();
  const plainPage = await mounted(SEED, { project: plain.projection });
  try {
    await openAndCloseByDispatch(plainPage);
  } finally {
    plainPage.handle.destroy();
    plainPage.dom.window.close();
  }

  const told: Array<{ readonly count: number; readonly open: boolean }> = [];
  const hosted = countingCycleProjection();
  const hostedPage = await mounted(SEED, {
    project: hosted.projection,
    auditToggle: {
      placement: 'host',
      onChange: (facts) => {
        told.push(facts);
      },
      focusToggle: () => {},
    },
  });
  try {
    await openAndCloseByDispatch(hostedPage);
  } finally {
    hostedPage.handle.destroy();
    hostedPage.dom.window.close();
  }

  assert.ok(plain.reads() > 0, 'the audit input was never read, so the count proves nothing');
  assert.deepEqual(
    told.map((facts) => facts.open),
    [false, true, false],
    'the host was not told the panel shut, opened and shut again',
  );
  assert.ok(told.every((facts) => facts.count > 0), 'the host was told a count of zero for an audit with a cycle');
  assert.equal(hosted.reads(), plain.reads(), 'the mount evaluated the audit input a second time to tell the host its facts');
});

test('auditToggle: a host button outside the mount opens and closes the panel by dispatch and onChange reports open', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const calls: HostFacts[] = [];
  const auditToggle = {
    placement: 'host' as const,
    onChange: (facts: HostFacts): void => {
      calls.push(facts);
    },
    focusToggle: (): void => {},
  };
  const page = await mounted(SEED, { project: withCycle, auditToggle });
  try {
    const button = page.win.document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => {
      page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    });
    page.win.document.body.append(button);

    // "A button outside the mount opens the panel by dispatch, and `onChange` reports `open` true; after a second dispatch it reports `open` false."
    page.click(button);
    await flush();
    assert.equal(page.element.querySelectorAll('.ig-audit-overlay').length, 1, 'one click did not draw exactly one panel');
    assert.equal(calls[calls.length - 1]?.open, true);

    page.click(button);
    await flush();
    assert.equal(page.element.querySelector('.ig-audit-overlay'), null);
    assert.equal(calls[calls.length - 1]?.open, false);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: Escape on the host button dispatching audit-close closes the panel and onChange reports open false', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const calls: HostFacts[] = [];
  let focusToggleCalls = 0;
  const auditToggle = {
    placement: 'host' as const,
    onChange: (facts: HostFacts): void => {
      calls.push(facts);
    },
    focusToggle: (): void => {
      focusToggleCalls += 1;
    },
  };
  const page = await mounted(SEED, { project: withCycle, auditToggle });
  try {
    const button = page.win.document.createElement('button');
    button.type = 'button';
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    });
    page.win.document.body.append(button);

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.ok(page.element.querySelector('.ig-audit-overlay') !== null, 'the panel did not open, so this proves nothing');
    assert.equal(calls[calls.length - 1]?.open, true);

    button.focus();
    button.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();

    // "Escape on that outside button, dispatching `audit-close`, closes the panel and `onChange` reports `open` false."
    assert.equal(page.element.querySelector('.ig-audit-overlay'), null);
    assert.equal(calls[calls.length - 1]?.open, false);
    // Focus was on the host button, outside the panel, so there is nothing to hand back.
    assert.equal(focusToggleCalls, 0);
    assert.equal(page.win.document.activeElement, button);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: Escape from a rail row inside the mount reports open false and leaves focus on the row without focusToggle', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const calls: HostFacts[] = [];
  let focusToggleCalls = 0;
  const auditToggle = {
    placement: 'host' as const,
    onChange: (facts: HostFacts): void => {
      calls.push(facts);
    },
    focusToggle: (): void => {
      focusToggleCalls += 1;
    },
  };
  const page = await mounted(SEED, { project: withCycle, auditToggle });
  try {
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.ok(page.element.querySelector('.ig-audit-overlay') !== null, 'the panel did not open, so this proves nothing');

    const row = page.rows()[0];
    assert.ok(row !== undefined, 'no rail row to stand on');
    const key = row.getAttribute('data-ig-key');
    row.focus();
    row.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();

    // "Escape inside the mount also reports `open` false."
    assert.equal(page.element.querySelector('.ig-audit-overlay'), null);
    assert.equal(calls[calls.length - 1]?.open, false);
    // "When the panel closes with focus inside it, the mount calls `focusToggle`": focus here was on a row, not inside the panel.
    assert.equal(focusToggleCalls, 0);
    assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), key);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: closing the panel with focus inside it calls focusToggle once, after onChange reports open false', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const events: string[] = [];
  let hostButton: HTMLButtonElement | undefined;
  const auditToggle = {
    placement: 'host' as const,
    onChange: (facts: HostFacts): void => {
      events.push(`onChange open=${String(facts.open)}`);
    },
    focusToggle: (): void => {
      events.push('focusToggle');
      hostButton?.focus();
    },
  };
  const page = await mounted(SEED, { project: withCycle, auditToggle });
  try {
    hostButton = page.win.document.createElement('button');
    hostButton.type = 'button';
    page.win.document.body.append(hostButton);

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const panel = page.element.querySelector<HTMLElement>('.ig-audit-panel');
    assert.ok(panel !== null, 'the panel did not open, so this proves nothing');
    panel.focus();
    assert.equal(page.win.document.activeElement, panel, 'the fixture cannot hold focus in the panel');

    panel.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();

    // "Closing the panel with focus inside it calls `focusToggle`, and focus is not on `document.body`."
    assert.equal(page.element.querySelector('.ig-audit-overlay'), null);
    assert.equal(events.filter((event) => event === 'focusToggle').length, 1);
    assert.deepEqual(events.slice(-2), ['onChange open=false', 'focusToggle']);
    assert.notEqual(page.win.document.activeElement, page.win.document.body);
    assert.equal(page.win.document.activeElement, hostButton);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: an update that clears the findings while focus is in the panel calls focusToggle once', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const calls: HostFacts[] = [];
  let focusToggleCalls = 0;
  let hostButton: HTMLButtonElement | undefined;
  const auditToggle = {
    placement: 'host' as const,
    onChange: (facts: HostFacts): void => {
      calls.push(facts);
    },
    focusToggle: (): void => {
      focusToggleCalls += 1;
      hostButton?.focus();
    },
  };
  const page = await mounted(SEED, { project: withCycle, auditToggle });
  try {
    hostButton = page.win.document.createElement('button');
    hostButton.type = 'button';
    page.win.document.body.append(hostButton);

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const panel = page.element.querySelector<HTMLElement>('.ig-audit-panel');
    assert.ok(panel !== null, 'the panel did not open, so this proves nothing');
    panel.focus();

    // The audit going clean removes the panel without any control being pressed.
    page.handle.update({ project });
    await flush();

    // "When the panel closes with focus inside it, the mount calls `focusToggle` instead of searching its own surface for a toggle that is no longer there."
    assert.equal(page.element.querySelector('.ig-audit-overlay'), null);
    assert.equal(focusToggleCalls, 1);
    assert.equal(page.win.document.activeElement, hostButton);
    assert.deepEqual(
      { count: calls[calls.length - 1]?.count, worst: calls[calls.length - 1]?.worst, open: calls[calls.length - 1]?.open },
      { count: 0, worst: null, open: false },
    );
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: panelId in onChange equals the id of the drawn panel, before and after it opens', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const calls: HostFacts[] = [];
  const auditToggle = {
    placement: 'host' as const,
    onChange: (facts: HostFacts): void => {
      calls.push(facts);
    },
    focusToggle: (): void => {},
  };
  const page = await mounted(SEED, { project: withCycle, auditToggle });
  try {
    // A host sets aria-controls before the panel exists, so the id it is told while shut must name the panel that opens.
    const whileShut = calls[0]?.panelId;

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const overlay = page.element.querySelector('div.ig-audit-overlay');
    assert.ok(overlay !== null, 'the panel did not open, so this proves nothing');

    // "`panelId` in `onChange` equals the rendered panel's id."
    assert.ok(overlay.id !== '', 'the drawn panel carries no id');
    assert.equal(calls[calls.length - 1]?.panelId, overlay.id);
    assert.equal(whileShut, overlay.id);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: onChange count equals auditOverlay(input).count after an update that changes the input', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  let cycleInput: Parameters<typeof auditOverlay>[0] | undefined;
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    const audit: Parameters<typeof auditOverlay>[0] = {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
    };
    cycleInput = audit;
    return { ...project(snapshot), audit };
  }
  const calls: HostFacts[] = [];
  const auditToggle = {
    placement: 'host' as const,
    onChange: (facts: HostFacts): void => {
      calls.push(facts);
    },
    focusToggle: (): void => {},
  };
  const page = await mounted(SEED, { auditToggle });
  try {
    assert.equal(calls[calls.length - 1]?.count, 0);

    page.handle.update({ project: withCycle });
    await flush();

    assert.ok(cycleInput !== undefined, 'the update never drew with the new input');
    const expected = auditOverlay(cycleInput).count;
    assert.ok(expected > 0, 'the fixture has no findings, so a count of zero would pass by accident');
    // "`onChange` `count` equals `auditOverlay(input).count` after an update that changes the input."
    assert.equal(calls[calls.length - 1]?.count, expected);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

import { AUDIT_WORST_ATTRIBUTE } from '../audit/surface.ts';
test('auditToggle: onChange worst equals the worst class a mount without the option draws, and is null at zero', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const reference = await mounted(SEED, { project: withCycle });
  let drawnWorst: string | null | undefined;
  try {
    drawnWorst = reference.element.querySelector(`[${AUDIT_WORST_ATTRIBUTE}]`)?.getAttribute(AUDIT_WORST_ATTRIBUTE);
  } finally {
    reference.handle.destroy();
    reference.dom.window.close();
  }
  assert.ok(typeof drawnWorst === 'string' && drawnWorst !== '', 'the reference mount drew no worst class, so this proves nothing');

  const calls: HostFacts[] = [];
  const auditToggle = {
    placement: 'host' as const,
    onChange: (facts: HostFacts): void => {
      calls.push(facts);
    },
    focusToggle: (): void => {},
  };
  const page = await mounted(SEED, { auditToggle });
  try {
    // At zero findings there is no worst class: null, never an empty string or a default class.
    assert.deepEqual(
      { count: calls[calls.length - 1]?.count, worst: calls[calls.length - 1]?.worst },
      { count: 0, worst: null },
    );

    page.handle.update({ project: withCycle });
    await flush();
    assert.equal(calls[calls.length - 1]?.worst, drawnWorst);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

import { createScriptedSource, createStore } from '@issuegraph/store';
import { JSDOM } from 'jsdom';
import { mountWorkspace } from './mount.ts';
import { WORDS, applyAny, flatDeriver } from '../testing/mount.ts';
test('auditToggle: the first onChange runs inside mountWorkspace, before it returns, with frozen facts', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  try {
    const element = dom.window.document.getElementById('host');
    assert.ok(element !== null);
    const store = createStore({ source: createScriptedSource(SEED, applyAny), derive: flatDeriver });
    await store.hydrate();
    const calls: HostFacts[] = [];
    const auditToggle = {
      placement: 'host' as const,
      onChange: (facts: HostFacts): void => {
        calls.push(facts);
      },
      focusToggle: (): void => {},
    };

    const handle = mountWorkspace(element, { store, project, words: WORDS, auditToggle });
    const callsWhenReturned = calls.length;
    try {
      // A host that renders its button from the handle's return must already hold the facts of the first draw.
      assert.equal(callsWhenReturned, 1);
      const first = calls[0];
      assert.ok(first !== undefined);
      assert.deepEqual({ count: first.count, worst: first.worst, open: first.open }, { count: 0, worst: null, open: false });
      // The host gets its own copy: writing to it must not reach the mount's record of what it last told.
      assert.equal(Object.isFrozen(first), true);
    } finally {
      handle.destroy();
    }
  } finally {
    dom.window.close();
  }
});

import type { DataSource } from '@issuegraph/store';
test('auditToggle: the loading placeholder reports nothing and the first real draw reports once', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  try {
    const element = dom.window.document.getElementById('host');
    assert.ok(element !== null);
    const source = createScriptedSource(SEED, applyAny);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: DataSource = { ...source, hydrate: async () => { await gate; return source.hydrate(); } };
    const store = createStore({ source: slow, derive: flatDeriver });
    const loading = store.hydrate();
    const calls: HostFacts[] = [];
    const auditToggle = {
      placement: 'host' as const,
      onChange: (facts: HostFacts): void => {
        calls.push(facts);
      },
      focusToggle: (): void => {},
    };

    const handle = mountWorkspace(element, { store, project, words: WORDS, auditToggle });
    try {
      await flush();
      assert.equal(element.querySelector('.ig-workspace')?.getAttribute('data-ig-loading'), 'true', 'no placeholder, so this proves nothing');
      // While loading there is no audit to count, so a report would tell the host a count of zero that is not true.
      assert.equal(calls.length, 0);

      release();
      await loading;
      await flush();
      // "After every draw where a fact changed, the mount calls `onChange` with the facts."
      assert.equal(calls.length, 1);
    } finally {
      handle.destroy();
    }
  } finally {
    dom.window.close();
  }
});

test('auditToggle: with no findings, dispatching audit-panel draws no panel and adds no onChange call', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  const calls: HostFacts[] = [];
  const auditToggle = {
    placement: 'host' as const,
    onChange: (facts: HostFacts): void => {
      calls.push(facts);
    },
    focusToggle: (): void => {},
  };
  const page = await mounted(SEED, { auditToggle });
  try {
    assert.equal(calls.length, 1);

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();

    // `open` means drawn: a clean audit draws no panel, so the host must not show its button as expanded.
    assert.equal(page.element.querySelector('.ig-audit-overlay'), null);
    assert.equal(calls.length, 1, 'onChange was called although no fact changed');
    const last = calls[calls.length - 1];
    assert.deepEqual({ count: last?.count, worst: last?.worst, open: last?.open }, { count: 0, worst: null, open: false });
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: a projection with no audit reports count 0, worst null, open false and a panel id', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  // An absent `audit` means the audit was not run; the facts have no value for that, so they read as zero findings.
  function withoutAudit(snapshot: StoreSnapshot): WorkspaceProjection {
    return { viewer: project(snapshot).viewer };
  }
  const calls: HostFacts[] = [];
  const auditToggle = {
    placement: 'host' as const,
    onChange: (facts: HostFacts): void => {
      calls.push(facts);
    },
    focusToggle: (): void => {},
  };
  const page = await mounted(SEED, { project: withoutAudit, auditToggle });
  try {
    assert.equal(calls.length, 1);
    const facts = calls[0];
    assert.ok(facts !== undefined);
    assert.deepEqual({ count: facts.count, worst: facts.worst, open: facts.open }, { count: 0, worst: null, open: false });
    assert.equal(typeof facts.panelId, 'string');
    assert.notEqual(facts.panelId, '');
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: selecting a rail row and a bare update add no onChange call', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const calls: HostFacts[] = [];
  const auditToggle = {
    placement: 'host' as const,
    onChange: (facts: HostFacts): void => {
      calls.push(facts);
    },
    focusToggle: (): void => {},
  };
  const page = await mounted(SEED, { project: withCycle, auditToggle });
  try {
    assert.equal(calls.length, 1);

    const row = page.rows()[1];
    assert.ok(row !== undefined, 'no rail row to select');
    page.click(row);
    await flush();
    page.handle.update();
    await flush();

    // "After every draw where a fact changed, the mount calls `onChange` with the facts." These draws change no fact, so the host is told nothing again.
    assert.equal(calls.length, 1);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: an onChange that reapplies the same option gets one call per change and the redraws stop', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  // Caps the reapplies so a mount that loops on them fails this test instead of hanging the run.
  const reapplyLimit = 50;
  let reapplies = 0;
  let reapply: (() => void) | undefined;
  const calls: HostFacts[] = [];
  const auditToggle = {
    placement: 'host' as const,
    onChange: (facts: HostFacts): void => {
      calls.push(facts);
      if (reapply !== undefined && reapplies < reapplyLimit) {
        reapplies += 1;
        reapply();
      }
    },
    focusToggle: (): void => {},
  };
  const page = await mounted(SEED, { project: withCycle, auditToggle });
  try {
    reapply = () => {
      page.handle.update({ auditToggle });
    };
    assert.equal(calls.length, 1);

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    await flush();
    await flush();

    assert.equal(calls.length, 2, 'the host was told the same facts again');
    assert.equal(calls[1]?.open, true);
    assert.ok(reapplies < reapplyLimit, 'reapplying the option redrew without end');
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: update with a new onChange tells only the new callback the current facts', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const first: HostFacts[] = [];
  const second: HostFacts[] = [];
  const page = await mounted(SEED, {
    project: withCycle,
    auditToggle: { placement: 'host' as const, onChange: (facts: HostFacts): void => { first.push(facts); }, focusToggle: (): void => {} },
  });
  try {
    assert.equal(first.length, 1);

    page.handle.update({
      auditToggle: { placement: 'host' as const, onChange: (facts: HostFacts): void => { second.push(facts); }, focusToggle: (): void => {} },
    });
    await flush();

    assert.equal(second.length, 1, 'the new callback was not told the current facts');
    assert.deepEqual({ ...second[0] }, { ...first[0] });
    assert.equal(first.length, 1, 'the replaced callback was called again');
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: with no findings the mount draws no audit count and no empty header row, and keeps the header zone', async () => {
  const auditToggle = { placement: 'host' as const, onChange: (): void => {}, focusToggle: (): void => {} };
  const page = await mounted(SEED, { auditToggle });
  try {
    // "With `auditToggle` set, no `[data-ig-audit-count]` is in the mount, no `.ig-workspace-header` is drawn when it would be empty, and `li.ig-slot` rows keep `data-ig-audit`."
    // The header zone stays because it also holds the writes log.
    assert.deepEqual(
      {
        count: page.element.querySelectorAll('[data-ig-audit-count]').length,
        toggle: page.element.querySelectorAll('.ig-audit-toggle').length,
        headerRow: page.element.querySelectorAll('.ig-workspace-header').length,
        headerZone: page.zone('header') !== null,
      },
      { count: 0, toggle: 0, headerRow: 0, headerZone: true },
    );
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: a header row holding a host identity is still drawn once, without the audit count', async () => {
  function withIdentity(snapshot: StoreSnapshot): WorkspaceProjection {
    const base = project(snapshot);
    return { ...base, viewer: { ...base.viewer, host: { identity: 'acme/widgets' } } };
  }
  const auditToggle = { placement: 'host' as const, onChange: (): void => {}, focusToggle: (): void => {} };
  const page = await mounted(SEED, { project: withIdentity, auditToggle });
  try {
    const rows = page.element.querySelectorAll('.ig-workspace-header');
    // "draws no `.ig-workspace-header` when nothing else is in it": the identity is something else, so the row stays.
    assert.deepEqual(
      {
        headerRows: rows.length,
        identity: rows[0]?.textContent?.includes('acme/widgets') ?? false,
        count: page.element.querySelectorAll('[data-ig-audit-count]').length,
      },
      { headerRows: 1, identity: true, count: 0 },
    );
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: rail rows keep data-ig-audit and the panel still opens while the mount draws no audit count', async () => {
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const auditToggle = { placement: 'host' as const, onChange: (): void => {}, focusToggle: (): void => {} };
  const page = await mounted(SEED, { project: withCycle, auditToggle });
  try {
    // "The audit panel and the `data-ig-audit` marks on `li.ig-slot` rows still render."
    assert.deepEqual(
      {
        count: page.element.querySelectorAll('[data-ig-audit-count]').length,
        markedRows: page.element.querySelectorAll('[data-zone="rail"] li.ig-slot[data-ig-audit]').length > 0,
      },
      { count: 0, markedRows: true },
    );

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.deepEqual(
      {
        panels: page.element.querySelectorAll('.ig-audit-overlay').length,
        count: page.element.querySelectorAll('[data-ig-audit-count]').length,
        markedRows: page.element.querySelectorAll('[data-zone="rail"] li.ig-slot[data-ig-audit]').length > 0,
      },
      { panels: 1, count: 0, markedRows: true },
    );
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: an update that removes the option draws the in-mount audit count again and stops onChange', async () => {
  type HostFacts = { readonly count: number; readonly worst: string | null; readonly open: boolean; readonly panelId: string };
  function withCycle(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    };
  }
  const calls: HostFacts[] = [];
  const auditToggle = {
    placement: 'host' as const,
    onChange: (facts: HostFacts): void => {
      calls.push(facts);
    },
    focusToggle: (): void => {},
  };
  const page = await mounted(SEED, { project: withCycle, auditToggle });
  try {
    assert.equal(page.element.querySelectorAll('[data-ig-audit-count]').length, 0, 'the option did not take the count out of the mount');
    const callsWithOption = calls.length;

    page.handle.update({ auditToggle: undefined });
    await flush();
    assert.equal(page.element.querySelectorAll('[data-ig-audit-count]').length, 1, 'the in-mount count did not come back');

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.ok(page.element.querySelector('.ig-audit-overlay') !== null);
    assert.equal(calls.length, callsWithOption, 'a removed callback was still told the facts');
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

import { existsSync, readFileSync } from 'node:fs';
test('auditToggle: without the option, a mount with findings and the panel shut matches the 0.49.0 golden', async () => {
  // "Without the option, the mount's output is byte-for-byte what it is today."
  // This guard passes on 0.49.0 by design: its golden is captured from that release before any source edit.
  const withCycle = (snapshot: StoreSnapshot): WorkspaceProjection => ({
    ...project(snapshot),
    audit: {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
    },
  });
  const page = await mounted(SEED, { project: withCycle });
  try {
    await flush();
    assert.ok(page.element.querySelector('[data-ig-audit-count]') !== null, 'the fixture drew no audit count, so this proves nothing');
    const sheet = page.element.querySelector('style');
    assert.ok(sheet !== null, 'the mount installed no stylesheet');
    // The mount numbers its surfaces w1, w2, ... across the process, so the number depends on test order.
    const normalise = (text: string): string => text.replace(/\bw\d+\b/g, 'w#');
    const actual = {
      markup: normalise(page.element.innerHTML.replace(sheet.outerHTML, '')),
      stylesheet: normalise(sheet.textContent ?? ''),
    };
    const golden = new URL('./mount.audit-toggle.golden.json', import.meta.url);
    const paste = `capture it from untouched 0.49.0 and paste this under "findings-shut":\n${JSON.stringify(actual, null, 2)}\n`;
    assert.ok(existsSync(golden), `no golden yet; ${paste}`);
    const committed: Record<string, { markup: string; stylesheet: string }> = JSON.parse(readFileSync(golden, 'utf8'));
    assert.deepEqual(actual, committed['findings-shut'], `the mount without auditToggle no longer draws what 0.49.0 drew; only if the golden is wrong, ${paste}`);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: without the option, the panel opened by audit-panel matches the 0.49.0 golden', async () => {
  // "Without the option, the mount's output is byte-for-byte what it is today."
  // This guard passes on 0.49.0 by design: its golden is captured from that release before any source edit.
  const withCycle = (snapshot: StoreSnapshot): WorkspaceProjection => ({
    ...project(snapshot),
    audit: {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
    },
  });
  const page = await mounted(SEED, { project: withCycle });
  try {
    await flush();
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.ok(page.element.querySelector('.ig-audit-overlay') !== null, 'audit-panel drew no panel, so this proves nothing');
    const sheet = page.element.querySelector('style');
    assert.ok(sheet !== null, 'the mount installed no stylesheet');
    // The mount numbers its surfaces w1, w2, ... across the process, so the number depends on test order.
    const normalise = (text: string): string => text.replace(/\bw\d+\b/g, 'w#');
    const actual = {
      markup: normalise(page.element.innerHTML.replace(sheet.outerHTML, '')),
      stylesheet: normalise(sheet.textContent ?? ''),
    };
    const golden = new URL('./mount.audit-toggle.golden.json', import.meta.url);
    const paste = `capture it from untouched 0.49.0 and paste this under "panel-open":\n${JSON.stringify(actual, null, 2)}\n`;
    assert.ok(existsSync(golden), `no golden yet; ${paste}`);
    const committed: Record<string, { markup: string; stylesheet: string }> = JSON.parse(readFileSync(golden, 'utf8'));
    assert.deepEqual(actual, committed['panel-open'], `the open panel without auditToggle no longer draws what 0.49.0 drew; only if the golden is wrong, ${paste}`);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('auditToggle: without the option, a mount with no findings matches the 0.49.0 golden', async () => {
  // "Without `auditToggle`, the markup matches today's."
  // This guard passes on 0.49.0 by design: its golden is captured from that release before any source edit.
  const page = await mounted(SEED);
  try {
    await flush();
    const sheet = page.element.querySelector('style');
    assert.ok(sheet !== null, 'the mount installed no stylesheet');
    // The mount numbers its surfaces w1, w2, ... across the process, so the number depends on test order.
    const normalise = (text: string): string => text.replace(/\bw\d+\b/g, 'w#');
    const actual = {
      markup: normalise(page.element.innerHTML.replace(sheet.outerHTML, '')),
      stylesheet: normalise(sheet.textContent ?? ''),
    };
    const golden = new URL('./mount.audit-toggle.golden.json', import.meta.url);
    const paste = `capture it from untouched 0.49.0 and paste this under "no-findings":\n${JSON.stringify(actual, null, 2)}\n`;
    assert.ok(existsSync(golden), `no golden yet; ${paste}`);
    const committed: Record<string, { markup: string; stylesheet: string }> = JSON.parse(readFileSync(golden, 'utf8'));
    assert.deepEqual(actual, committed['no-findings'], `the mount without auditToggle no longer draws what 0.49.0 drew; only if the golden is wrong, ${paste}`);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('R5 KTD6: an onChange that reapplies the same auditToggle through update() is told once per change and the redraws stop', async () => {
  interface ToldFacts {
    readonly count: number;
    readonly worst: unknown;
    readonly open: boolean;
    readonly panelId: string;
  }
  // The default projection with a declared cycle, so the audit has findings and can draw a panel.
  const withCycle = (snapshot: StoreSnapshot): WorkspaceProjection => ({
    ...project(snapshot),
    audit: {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
    },
  });
  const settle = async (): Promise<void> => {
    await flush();
    await flush();
    await flush();
  };
  const told: ToldFacts[] = [];
  let reapply: (() => void) | undefined;
  const auditToggle = {
    placement: 'host' as const,
    onChange(facts: ToldFacts): void {
      told.push(facts);
      // A host that reapplies its options from inside the report. If the mount reported again on the redraw that
      // update() causes, the two would call each other without end.
      reapply?.();
    },
    focusToggle(): void {
      // Focus never sits in the panel in this test.
    },
  };
  const page = await mounted(SEED, { project: withCycle, auditToggle });
  reapply = (): void => {
    page.handle.update({ auditToggle });
  };
  try {
    await settle();
    // "After every draw where a fact changed, the mount calls `onChange` with the facts."
    assert.equal(told.length, 1, 'the first draw must be reported once, and the redraws after it changed no fact');
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await settle();
    assert.equal(told.length, 2, 'opening the panel changed one fact, so it must be reported exactly once');
    assert.equal(told[1]?.open, true);
    const settled = page.element.querySelector('.ig-audit-overlay');
    assert.ok(settled !== null, 'the panel did not open');
    await settle();
    assert.equal(
      page.element.querySelector('.ig-audit-overlay'),
      settled,
      'the mount kept redrawing after the facts stopped changing',
    );
    assert.equal(told.length, 2);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('R5 R7: a second audit-close on a shut panel is not reported and does not hand focus to the host again', async () => {
  interface ToldFacts {
    readonly count: number;
    readonly worst: unknown;
    readonly open: boolean;
    readonly panelId: string;
  }
  // The default projection with a declared cycle, so the audit has findings and can draw a panel.
  const withCycle = (snapshot: StoreSnapshot): WorkspaceProjection => ({
    ...project(snapshot),
    audit: {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
    },
  });
  const told: ToldFacts[] = [];
  let focusToggleCalls = 0;
  let hostButton: HTMLElement | undefined;
  const page = await mounted(SEED, {
    project: withCycle,
    auditToggle: {
      placement: 'host',
      onChange: (facts: ToldFacts): void => {
        told.push(facts);
      },
      focusToggle: (): void => {
        focusToggleCalls += 1;
        hostButton?.focus();
      },
    },
  });
  try {
    const button = page.win.document.createElement('button');
    button.textContent = 'problems to fix';
    page.win.document.body.append(button);
    hostButton = button;

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const panel = page.element.querySelector<HTMLElement>('.ig-audit-panel');
    assert.ok(panel !== null, 'the panel did not open, so this proves nothing');
    panel.focus();
    assert.equal(page.win.document.activeElement, panel, 'the fixture cannot hold focus in the panel');
    const toldBeforeClose = told.length;

    // The same close delivered twice: the second one lands on a panel that is already shut.
    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();
    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();

    // "After every draw where a fact changed, the mount calls `onChange` with the facts."
    assert.deepEqual(
      told.slice(toldBeforeClose).map((facts) => facts.open),
      [false],
    );
    // "When the panel closes with focus inside it, the mount calls `focusToggle` instead of searching its own surface for a toggle that is no longer there."
    assert.equal(focusToggleCalls, 1);
    assert.equal(page.win.document.activeElement, button);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('R7 KTD5: the host closing the panel while focus is on a rail row does not call focusToggle and leaves focus on the row', async () => {
  interface ToldFacts {
    readonly count: number;
    readonly worst: unknown;
    readonly open: boolean;
    readonly panelId: string;
  }
  // The default projection with a declared cycle, so the audit has findings and can draw a panel.
  const withCycle = (snapshot: StoreSnapshot): WorkspaceProjection => ({
    ...project(snapshot),
    audit: {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
    },
  });
  const told: ToldFacts[] = [];
  let focusToggleCalls = 0;
  const page = await mounted(SEED, {
    project: withCycle,
    auditToggle: {
      placement: 'host',
      onChange: (facts: ToldFacts): void => {
        told.push(facts);
      },
      focusToggle: (): void => {
        focusToggleCalls += 1;
      },
    },
  });
  try {
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.ok(page.element.querySelector('.ig-audit-overlay') !== null, 'the panel did not open, so this proves nothing');
    const row = page.rows()[0];
    assert.ok(row !== undefined, 'no rail row to stand on');
    const rowKey = row.getAttribute('data-ig-key');
    row.focus();
    assert.equal(page.win.document.activeElement, row, 'the fixture cannot focus a row');

    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();

    assert.equal(page.element.querySelector('.ig-audit-overlay'), null, 'the panel did not close');
    assert.equal(told[told.length - 1]?.open, false, 'the close was not reported');
    // "When the panel closes with focus inside it, the mount calls `focusToggle` instead of searching its own surface for a toggle that is no longer there."
    // Focus was on a row, not inside the panel, so the condition does not hold and the host must not take focus.
    assert.equal(focusToggleCalls, 0);
    assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), rowKey);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('R7 KTD5: Escape inside the panel reports open false before it calls focusToggle', async () => {
  interface ToldFacts {
    readonly count: number;
    readonly worst: unknown;
    readonly open: boolean;
    readonly panelId: string;
  }
  // The default projection with a declared cycle, so the audit has findings and can draw a panel.
  const withCycle = (snapshot: StoreSnapshot): WorkspaceProjection => ({
    ...project(snapshot),
    audit: {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
    },
  });
  const events: string[] = [];
  let hostButton: HTMLElement | undefined;
  const page = await mounted(SEED, {
    project: withCycle,
    auditToggle: {
      placement: 'host',
      onChange: (facts: ToldFacts): void => {
        events.push('onChange open=' + String(facts.open));
      },
      focusToggle: (): void => {
        events.push('focusToggle');
        hostButton?.focus();
      },
    },
  });
  try {
    const button = page.win.document.createElement('button');
    button.textContent = 'problems to fix';
    page.win.document.body.append(button);
    hostButton = button;

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const panel = page.element.querySelector<HTMLElement>('.ig-audit-panel');
    assert.ok(panel !== null, 'the panel did not open, so this proves nothing');
    panel.focus();
    assert.equal(page.win.document.activeElement, panel, 'the fixture cannot hold focus in the panel');
    events.length = 0;

    panel.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();

    assert.equal(page.element.querySelector('.ig-audit-overlay'), null, 'Escape did not close the panel');
    // The host must know the panel is shut before it is asked to take focus, or its button would take focus
    // while still reading as expanded.
    assert.deepEqual(events, ['onChange open=false', 'focusToggle']);
    assert.equal(page.win.document.activeElement, button);
    assert.notEqual(page.win.document.activeElement, page.win.document.body);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('R7 KTD5: an update() that leaves the audit clean while focus is in the panel hands focus to the host', async () => {
  interface ToldFacts {
    readonly count: number;
    readonly worst: unknown;
    readonly open: boolean;
    readonly panelId: string;
  }
  // The default projection with a declared cycle, so the audit has findings and can draw a panel.
  const withCycle = (snapshot: StoreSnapshot): WorkspaceProjection => ({
    ...project(snapshot),
    audit: {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
    },
  });
  const told: ToldFacts[] = [];
  let focusToggleCalls = 0;
  let hostButton: HTMLElement | undefined;
  const page = await mounted(SEED, {
    project: withCycle,
    auditToggle: {
      placement: 'host',
      onChange: (facts: ToldFacts): void => {
        told.push(facts);
      },
      focusToggle: (): void => {
        focusToggleCalls += 1;
        hostButton?.focus();
      },
    },
  });
  try {
    const button = page.win.document.createElement('button');
    button.textContent = 'problems to fix';
    page.win.document.body.append(button);
    hostButton = button;

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const panel = page.element.querySelector<HTMLElement>('.ig-audit-panel');
    assert.ok(panel !== null, 'the panel did not open, so this proves nothing');
    panel.focus();
    assert.equal(page.win.document.activeElement, panel, 'the fixture cannot hold focus in the panel');

    // No control closes the panel here: the audit stops finding problems, so the panel is no longer drawn.
    page.handle.update({ project });
    await flush();

    assert.equal(page.element.querySelector('.ig-audit-overlay'), null, 'a clean audit still drew the panel');
    const last = told[told.length - 1];
    assert.ok(last !== undefined, 'onChange was never called');
    assert.deepEqual({ count: last.count, worst: last.worst, open: last.open }, { count: 0, worst: null, open: false });
    // "When the panel closes with focus inside it, the mount calls `focusToggle` instead of searching its own surface for a toggle that is no longer there."
    assert.equal(focusToggleCalls, 1);
    assert.equal(page.win.document.activeElement, button);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('KTD6: update() with a new onChange tells only the new callback the current facts', async () => {
  interface ToldFacts {
    readonly count: number;
    readonly worst: unknown;
    readonly open: boolean;
    readonly panelId: string;
  }
  // The default projection with a declared cycle, so the audit has findings and can draw a panel.
  const withCycle = (snapshot: StoreSnapshot): WorkspaceProjection => ({
    ...project(snapshot),
    audit: {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
    },
  });
  const firstTold: ToldFacts[] = [];
  const secondTold: ToldFacts[] = [];
  const focusToggle = (): void => {
    // Focus never sits in the panel in this test.
  };
  const page = await mounted(SEED, {
    project: withCycle,
    auditToggle: {
      placement: 'host',
      onChange: (facts: ToldFacts): void => {
        firstTold.push(facts);
      },
      focusToggle,
    },
  });
  try {
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const firstHeard = firstTold.length;
    const lastToFirst = firstTold[firstHeard - 1];
    assert.ok(lastToFirst !== undefined, 'the first onChange was never called');
    assert.equal(lastToFirst.open, true);

    page.handle.update({
      auditToggle: {
        placement: 'host',
        onChange: (facts: ToldFacts): void => {
          secondTold.push(facts);
        },
        focusToggle,
      },
    });
    await flush();

    // The new callback has never heard the facts, so the next draw tells it, even though no fact changed.
    assert.equal(secondTold.length, 1);
    assert.deepEqual({ ...secondTold[0] }, { ...lastToFirst });

    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();

    assert.equal(firstTold.length, firstHeard, 'the replaced onChange was still called');
    assert.equal(secondTold.length, 2);
    assert.equal(secondTold[1]?.open, false);
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('R5 KTD2: an audit-panel request that draws no panel reports open false and nothing new', async () => {
  interface ToldFacts {
    readonly count: number;
    readonly worst: unknown;
    readonly open: boolean;
    readonly panelId: string;
  }
  const told: ToldFacts[] = [];
  // The default projection has a clean audit, so a request to open the panel draws nothing.
  const page = await mounted(SEED, {
    project,
    auditToggle: {
      placement: 'host',
      onChange: (facts: ToldFacts): void => {
        told.push(facts);
      },
      focusToggle: (): void => {
        // Focus never sits in the panel in this test.
      },
    },
  });
  try {
    await flush();
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();

    assert.equal(page.element.querySelector('.ig-audit-overlay'), null, 'a clean audit drew a panel');
    const last = told[told.length - 1];
    assert.ok(last !== undefined, 'onChange was never called');
    // `open` reports the panel as drawn, not as requested: a host that showed it as open here would point at
    // a panel that is not on the page.
    assert.deepEqual({ count: last.count, worst: last.worst, open: last.open }, { count: 0, worst: null, open: false });
    // "After every draw where a fact changed, the mount calls `onChange` with the facts."
    assert.equal(told.length, 1, 'a request that drew no panel changed no fact, so it must not be reported');
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('R5 KTD4: a later draw does not change a facts object the host already holds', async () => {
  interface ToldFacts {
    readonly count: number;
    readonly worst: unknown;
    readonly open: boolean;
    readonly panelId: string;
  }
  // The default projection with a declared cycle, so the audit has findings and can draw a panel.
  const withCycle = (snapshot: StoreSnapshot): WorkspaceProjection => ({
    ...project(snapshot),
    audit: {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
    },
  });
  const told: ToldFacts[] = [];
  const page = await mounted(SEED, {
    project: withCycle,
    auditToggle: {
      placement: 'host',
      onChange: (facts: ToldFacts): void => {
        told.push(facts);
      },
      focusToggle: (): void => {
        // Focus never sits in the panel in this test.
      },
    },
  });
  try {
    const first = told[0];
    assert.ok(first !== undefined, 'the first draw was not reported');

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();

    assert.equal(told.length, 2);
    // A mount that reused one record for every report would rewrite what the host kept from the first report.
    assert.notEqual(told[1], first);
    assert.equal(first.open, false);
    assert.ok(Object.isFrozen(first), 'the host could change the facts it was handed');
    assert.ok(Object.isFrozen(told[1]), 'the host could change the facts it was handed');
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});

test('KTD6: removing auditToggle through update() stops the reports and draws the header count again', async () => {
  interface ToldFacts {
    readonly count: number;
    readonly worst: unknown;
    readonly open: boolean;
    readonly panelId: string;
  }
  // The default projection with a declared cycle, so the audit has findings and can draw a panel.
  const withCycle = (snapshot: StoreSnapshot): WorkspaceProjection => ({
    ...project(snapshot),
    audit: {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
    },
  });
  const told: ToldFacts[] = [];
  const page = await mounted(SEED, {
    project: withCycle,
    auditToggle: {
      placement: 'host',
      onChange: (facts: ToldFacts): void => {
        told.push(facts);
      },
      focusToggle: (): void => {
        // Focus never sits in the panel in this test.
      },
    },
  });
  try {
    assert.equal(page.element.querySelector('[data-ig-audit-count]'), null, 'the mount drew its own count with the option set');
    assert.equal(told.length, 1);

    page.handle.update({ auditToggle: undefined });
    await flush();
    assert.ok(
      page.element.querySelector('[data-ig-audit-count]') !== null,
      'removing the option did not draw the count in the header again',
    );

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.ok(page.element.querySelector('.ig-audit-overlay') !== null, 'the panel did not open');
    assert.equal(told.length, 1, 'onChange was still called after the option was removed');
  } finally {
    page.handle.destroy();
    page.dom.window.close();
  }
});
