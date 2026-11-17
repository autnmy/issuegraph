import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { DataSource, StoreSnapshot } from '@issuegraph/store';
import { createScriptedSource, createStore } from '@issuegraph/store';
import { JSDOM } from 'jsdom';

import { type AuditToggleOption, type WorkspaceProjection, mountWorkspace } from './mount.ts';
import type { AuditToggleFacts } from './render.ts';
import type { AuditInput } from '../audit/findings.ts';
import { AUDIT_WORST_ATTRIBUTE, auditOverlay } from '../audit/surface.ts';
import { SEED, WORDS, applyAny, flatDeriver, flush, mounted, project, type Mounted } from '../testing/mount.ts';

/** An audit input with one declared cycle, so the audit has findings and can draw a panel. */
function cycleAuditInput(snapshot: StoreSnapshot): AuditInput {
  return {
    document: { issues: snapshot.issues, edges: snapshot.landed },
    graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
  };
}

function withCycleAudit(snapshot: StoreSnapshot): WorkspaceProjection {
  return { ...project(snapshot), audit: cycleAuditInput(snapshot) };
}

/**
 * A host's audit toggle that records every report and every focus hand-off,
 * in the order they happen. `takeFocus` is what the host does when asked to
 * take focus back.
 */
function recordingAuditToggle(takeFocus: () => void = () => {}) {
  const told: AuditToggleFacts[] = [];
  const order: string[] = [];
  let focusToggleCalls = 0;
  const option: AuditToggleOption = {
    placement: 'host',
    onChange: (facts) => {
      told.push(facts);
      order.push(`onChange open=${String(facts.open)}`);
    },
    focusToggle: () => {
      focusToggleCalls += 1;
      order.push('focusToggle');
      takeFocus();
    },
  };
  return {
    option,
    told,
    order,
    latest: (): AuditToggleFacts | undefined => told[told.length - 1],
    focusToggleCalls: (): number => focusToggleCalls,
  };
}

/** The host's own button, drawn outside the mounted element. */
function appendHostButton(page: Mounted): HTMLButtonElement {
  const button = page.win.document.createElement('button');
  button.type = 'button';
  button.textContent = 'problems to fix';
  page.win.document.body.append(button);
  return button;
}

function pressEscape(page: Mounted, target: Element): void {
  target.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

function closePage(page: Mounted): void {
  page.handle.destroy();
  page.dom.window.close();
}

test('auditToggle: the first onChange runs inside mountWorkspace, before it returns, with frozen facts', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>');
  try {
    const element = dom.window.document.getElementById('host');
    assert.ok(element !== null);
    const store = createStore({ source: createScriptedSource(SEED, applyAny), derive: flatDeriver });
    await store.hydrate();
    const host = recordingAuditToggle();

    const handle = mountWorkspace(element, { store, project, words: WORDS, auditToggle: host.option });
    const callsWhenReturned = host.told.length;
    try {
      // A host that renders its button from the handle's return must already hold the facts of the first draw.
      assert.equal(callsWhenReturned, 1);
      const first = host.told[0];
      assert.ok(first !== undefined);
      assert.deepEqual({ count: first.count, worst: first.worst, open: first.open }, { count: 0, worst: null, open: false });
      assert.equal(Object.isFrozen(first), true);
    } finally {
      handle.destroy();
    }
  } finally {
    dom.window.close();
  }
});

test('auditToggle: the loading placeholder reports nothing and the first real draw reports once', async () => {
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
    const host = recordingAuditToggle();

    const handle = mountWorkspace(element, { store, project, words: WORDS, auditToggle: host.option });
    try {
      await flush();
      assert.equal(element.querySelector('.ig-workspace')?.getAttribute('data-ig-loading'), 'true', 'no placeholder, so this proves nothing');
      // While loading there is no audit to count, so a report would tell the host a count of zero that is not true.
      assert.equal(host.told.length, 0);

      release();
      await loading;
      await flush();
      // "After every draw where a fact changed, the mount calls `onChange` with the facts."
      assert.equal(host.told.length, 1);
    } finally {
      handle.destroy();
    }
  } finally {
    dom.window.close();
  }
});

test('auditToggle: each report is a fresh frozen record that neither the host nor a later draw can change', async () => {
  const host = recordingAuditToggle();
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: host.option });
  try {
    await flush();
    const first = host.told[0];
    assert.ok(first !== undefined, 'the mount never told the host the facts');
    // The host's code runs outside the mount. A record it could write to would let
    // it change the facts the mount compares the next draw against.
    assert.ok(Object.isFrozen(first), 'the facts record handed to the host is writable');
    assert.equal(Reflect.set(first, 'count', first.count + 100), false);
    assert.equal(Reflect.set(first, 'open', true), false);

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.equal(host.told.length, 2);
    const opened = host.told[1];
    assert.ok(opened !== undefined);
    // A mount that reused one record for every report would rewrite what the host kept from the first report.
    assert.notEqual(opened, first, 'the mount reused one facts object for two reports');
    assert.ok(Object.isFrozen(opened), 'the second facts record handed to the host is writable');
    assert.equal(opened.open, true);
    assert.equal(opened.count, first.count, 'a write the host attempted changed the count the mount reports');
    assert.equal(first.open, false, 'an earlier report changed after the host received it');
  } finally {
    closePage(page);
  }
});

test('auditToggle: a draw that changes no fact adds no onChange call', async () => {
  const host = recordingAuditToggle();
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: host.option });
  try {
    assert.equal(host.told.length, 1);
    const row = page.rows()[1];
    assert.ok(row !== undefined, 'no rail row to select');
    page.click(row);
    await flush();
    page.handle.update();
    await flush();
    // "After every draw where a fact changed, the mount calls `onChange` with the facts." These draws change no fact.
    assert.equal(host.told.length, 1, 'selecting a row or a bare update told the host again');

    // The issue: "The host opens and closes the panel through the existing `audit-panel` control and closes it on Escape through the existing `audit-close` control."
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.equal(host.latest()?.open, true, 'opening the panel was not reported');
    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();
    assert.equal(host.latest()?.open, false, 'closing the panel was not reported');

    const reports = host.told.length;
    // Each of these draws again with the same facts, so none of them may report.
    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();
    page.handle.update();
    await flush();
    page.handle.dispatch({ kind: 'point', key: '2' });
    await flush();
    assert.equal(host.told.length, reports, 'a draw that changed no fact told the host again');
  } finally {
    closePage(page);
  }
});

test('auditToggle: an onChange that reapplies the same option gets one call per change and the redraws stop', async () => {
  const settle = async (): Promise<void> => {
    await flush();
    await flush();
    await flush();
  };
  // Caps the reapplies so a mount that loops on them fails this test instead of hanging the run.
  const reapplyLimit = 20;
  let reapplies = 0;
  let reapply: (() => void) | undefined;
  const told: AuditToggleFacts[] = [];
  const auditToggle: AuditToggleOption = {
    placement: 'host',
    onChange: (facts) => {
      told.push(facts);
      // A host that reapplies its options on every report. If each update drew
      // again and each draw reported again, the page would never stop redrawing.
      if (reapply !== undefined && reapplies < reapplyLimit) {
        reapplies += 1;
        reapply();
      }
    },
    focusToggle: () => {},
  };
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle });
  reapply = (): void => {
    page.handle.update({ auditToggle });
  };
  try {
    await settle();
    assert.equal(told.length, 1, 'the first draw must be reported once, and the redraws after it changed no fact');
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await settle();
    // Passing the same option again keeps what the host was last told, so the
    // only reports are the first draw and the one real change: the panel opening.
    assert.deepEqual(
      told.map((facts) => facts.open),
      [false, true],
    );

    const settled = page.element.querySelector('.ig-audit-overlay');
    assert.ok(settled !== null, 'the dispatch did not open the panel');
    await settle();
    assert.equal(
      page.element.querySelector('.ig-audit-overlay'),
      settled,
      'the mount kept redrawing after the facts stopped changing',
    );
    assert.equal(told.length, 2);
    assert.ok(reapplies < reapplyLimit, 'reapplying the option redrew without end');
  } finally {
    closePage(page);
  }
});

test('auditToggle: update with a new onChange tells it nothing until a fact changes, and the old one nothing more', async () => {
  const first = recordingAuditToggle();
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: first.option });
  try {
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const firstHeard = first.told.length;
    assert.equal(first.latest()?.open, true, 'the first onChange was never told the panel opened');

    const second = recordingAuditToggle();
    page.handle.update({ auditToggle: second.option });
    await flush();
    // A new function is not a new fact, so it is not told the unchanged facts.
    assert.equal(second.told.length, 0, 'swapping onChange re-sent facts that had not changed');

    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();
    assert.equal(first.told.length, firstHeard, 'the replaced onChange was still called');
    assert.equal(second.told.length, 1, 'the new onChange was not told the change');
    assert.equal(second.told[0]?.open, false);
    assert.equal(second.told[0]?.count, auditOverlay(cycleAuditInput(page.store.getSnapshot())).count);
  } finally {
    closePage(page);
  }
});

test('auditToggle: a host that passes a fresh onChange closure on every update is not called in a loop', async () => {
  const told: AuditToggleFacts[] = [];
  const updateLimit = 50;
  let updates = 0;
  let page: Mounted | undefined;
  // Each report builds a new closure and hands it back through update(), as a
  // host that recreates its callbacks on every render does.
  const freshOption = (): AuditToggleOption => ({
    placement: 'host',
    onChange: (facts) => {
      told.push(facts);
      if (page !== undefined && updates < updateLimit) {
        updates += 1;
        page.handle.update({ auditToggle: freshOption() });
      }
    },
    focusToggle: () => {},
  });
  page = await mounted(SEED, { project: withCycleAudit, auditToggle: freshOption() });
  try {
    await flush();
    await flush();
    assert.equal(told.length, 1, 'the first draw must be reported once');
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    await flush();
    assert.deepEqual(
      told.map((facts) => facts.open),
      [false, true],
      'a fresh closure on each update re-sent unchanged facts',
    );
    assert.ok(updates < updateLimit, 'passing a fresh onChange on every update redrew without end');
  } finally {
    closePage(page);
  }
});

test('auditToggle: removing the option draws the in-mount count and stops onChange, and adding it back reports the current facts', async () => {
  const host = recordingAuditToggle();
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: host.option });
  const inMountCounts = (): number => page.element.querySelectorAll('[data-ig-audit-count]').length;
  try {
    await flush();
    assert.equal(inMountCounts(), 0, 'the mount drew its own count while the host holds it');
    assert.equal(host.told.length, 1);
    const firstReport = host.told[0];
    assert.ok(firstReport !== undefined, 'the host was never told the facts');
    assert.ok(firstReport.count > 0, 'the cycle fixture produced no finding, so this proves nothing');

    page.handle.update({ auditToggle: undefined });
    await flush();
    assert.equal(inMountCounts(), 1, 'removing the option did not bring the in-mount count back');

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.ok(page.element.querySelector('.ig-audit-overlay') !== null, 'the panel did not open');
    assert.equal(host.told.length, 1, 'onChange was still called after the option was removed');
    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();

    page.handle.update({ auditToggle: host.option });
    await flush();
    // The facts are the same as before, but the option went from absent to
    // present, so the host is told them once more and only once.
    assert.equal(host.told.length, 2);
    assert.deepEqual({ ...host.told[1] }, { ...firstReport });
    assert.equal(inMountCounts(), 0, 'adding the option back left the in-mount count drawn');
  } finally {
    closePage(page);
  }
});

test('auditToggle: onChange count equals auditOverlay(input).count after an update that changes the input', async () => {
  let drawnInput: AuditInput | undefined;
  function capturingCycleAudit(snapshot: StoreSnapshot): WorkspaceProjection {
    const audit = cycleAuditInput(snapshot);
    drawnInput = audit;
    return { ...project(snapshot), audit };
  }
  const host = recordingAuditToggle();
  const page = await mounted(SEED, { auditToggle: host.option });
  try {
    assert.equal(host.latest()?.count, 0, 'the default projection declares no cycle, so the first report must count 0');

    page.handle.update({ project: capturingCycleAudit });
    await flush();

    assert.ok(drawnInput !== undefined, 'the update never drew with the new input');
    const expected = auditOverlay(drawnInput).count;
    assert.ok(expected > 0, 'the fixture has no findings, so a count of zero would pass by accident');
    // "`onChange` `count` equals `auditOverlay(input).count` after an update that changes the input."
    assert.equal(host.latest()?.count, expected);
  } finally {
    closePage(page);
  }
});

test('auditToggle: onChange worst equals the worst class a mount without the option draws, and is null at zero', async () => {
  const reference = await mounted(SEED, { project: withCycleAudit });
  let drawnWorst: string | null | undefined;
  try {
    drawnWorst = reference.element.querySelector(`[${AUDIT_WORST_ATTRIBUTE}]`)?.getAttribute(AUDIT_WORST_ATTRIBUTE);
  } finally {
    closePage(reference);
  }
  assert.ok(typeof drawnWorst === 'string' && drawnWorst !== '', 'the reference mount drew no worst class, so this proves nothing');

  const host = recordingAuditToggle();
  const page = await mounted(SEED, { auditToggle: host.option });
  try {
    // At zero findings there is no worst class: null, never an empty string or a default class.
    assert.deepEqual({ count: host.latest()?.count, worst: host.latest()?.worst }, { count: 0, worst: null });

    page.handle.update({ project: withCycleAudit });
    await flush();
    assert.equal(host.latest()?.worst, drawnWorst);
  } finally {
    closePage(page);
  }
});

test('auditToggle: a change of worst class alone, with the count unchanged, is reported once', async () => {
  // One refused declaration and no cycle: the same count as the cycle fixture, a lighter class.
  const refusedOnly = (snapshot: StoreSnapshot): WorkspaceProjection => ({
    ...project(snapshot),
    audit: {
      document: { issues: snapshot.issues, edges: snapshot.landed },
      graph: { cycles: [], duplicateCanonical: () => null },
      encodingRefused: [{ ref: '1' }],
    },
  });
  const host = recordingAuditToggle();
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: host.option });
  try {
    await flush();
    const before = host.latest();
    assert.ok(before !== undefined && before.count > 0, 'the cycle fixture produced no finding, so this proves nothing');
    const heard = host.told.length;

    page.handle.update({ project: refusedOnly });
    await flush();
    const after = host.latest();
    assert.ok(after !== undefined);
    // Only the worst class moved, so a comparison that skipped it would report nothing here.
    assert.deepEqual(
      { reports: host.told.length - heard, count: after.count, open: after.open, panelId: after.panelId },
      { reports: 1, count: before.count, open: before.open, panelId: before.panelId },
    );
    assert.notEqual(after.worst, before.worst);
  } finally {
    closePage(page);
  }
});

test('auditToggle: panelId in onChange names the drawn panel, while shut, open and after a reopen', async () => {
  const host = recordingAuditToggle();
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: host.option });
  const drawnPanelId = (): string | undefined => page.element.querySelector<HTMLElement>('div.ig-audit-overlay')?.id;
  try {
    // A host sets aria-controls before the panel exists, so the id it is told while shut must name the panel that opens.
    const whileShut = host.told[0]?.panelId;

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const panelId = drawnPanelId();
    assert.ok(panelId !== undefined && panelId !== '', 'the open panel carries no id');
    // The issue: "`panelId` in `onChange` equals the rendered panel's id."
    assert.equal(host.latest()?.panelId, panelId);
    assert.equal(whileShut, panelId);

    // The id the host holds while the panel is shut must still name the panel the next time it is drawn.
    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();
    assert.equal(host.latest()?.open, false);
    assert.equal(host.latest()?.panelId, panelId);
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.equal(drawnPanelId(), host.latest()?.panelId);
  } finally {
    closePage(page);
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

  async function openAndCloseByDispatch(page: Mounted): Promise<void> {
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
    closePage(plainPage);
  }

  const host = recordingAuditToggle();
  const hosted = countingCycleProjection();
  const hostedPage = await mounted(SEED, { project: hosted.projection, auditToggle: host.option });
  try {
    await openAndCloseByDispatch(hostedPage);
  } finally {
    closePage(hostedPage);
  }

  assert.ok(plain.reads() > 0, 'the audit input was never read, so the count proves nothing');
  assert.deepEqual(
    host.told.map((facts) => facts.open),
    [false, true, false],
    'the host was not told the panel shut, opened and shut again',
  );
  assert.ok(host.told.every((facts) => facts.count > 0), 'the host was told a count of zero for an audit with a cycle');
  assert.equal(hosted.reads(), plain.reads(), 'the mount evaluated the audit input a second time to tell the host its facts');
});

test('auditToggle: with no findings, dispatching audit-panel draws no panel and adds no onChange call', async () => {
  const host = recordingAuditToggle();
  const page = await mounted(SEED, { auditToggle: host.option });
  try {
    assert.equal(host.told.length, 1);

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();

    // `open` means drawn: a clean audit draws no panel, so the host must not show its button as expanded.
    assert.equal(page.element.querySelector('.ig-audit-overlay'), null, 'a clean audit drew a panel');
    assert.equal(host.told.length, 1, 'a request that drew no panel changed no fact, so it must not be reported');
    const last = host.latest();
    assert.deepEqual({ count: last?.count, worst: last?.worst, open: last?.open }, { count: 0, worst: null, open: false });
  } finally {
    closePage(page);
  }
});

test('auditToggle: a projection with no audit reports count 0, worst null, open false and a panel id', async () => {
  // An absent `audit` means the audit was not run; the facts have no value for that, so they read as zero findings.
  function withoutAudit(snapshot: StoreSnapshot): WorkspaceProjection {
    return { viewer: project(snapshot).viewer };
  }
  const host = recordingAuditToggle();
  const page = await mounted(SEED, { project: withoutAudit, auditToggle: host.option });
  try {
    assert.equal(host.told.length, 1);
    const facts = host.told[0];
    assert.ok(facts !== undefined);
    assert.deepEqual({ count: facts.count, worst: facts.worst, open: facts.open }, { count: 0, worst: null, open: false });
    assert.equal(typeof facts.panelId, 'string');
    assert.notEqual(facts.panelId, '');
  } finally {
    closePage(page);
  }
});

test('auditToggle: a host button outside the mount opens and closes the panel by dispatch and onChange reports open', async () => {
  const host = recordingAuditToggle();
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: host.option });
  try {
    const button = appendHostButton(page);
    button.addEventListener('click', () => {
      page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    });

    // "A button outside the mount opens the panel by dispatch, and `onChange` reports `open` true; after a second dispatch it reports `open` false."
    page.click(button);
    await flush();
    assert.equal(page.element.querySelectorAll('.ig-audit-overlay').length, 1, 'one click did not draw exactly one panel');
    assert.equal(host.latest()?.open, true);

    page.click(button);
    await flush();
    assert.equal(page.element.querySelector('.ig-audit-overlay'), null);
    assert.equal(host.latest()?.open, false);
  } finally {
    closePage(page);
  }
});

test('auditToggle: Escape on the host button dispatching audit-close closes the panel and onChange reports open false', async () => {
  const host = recordingAuditToggle();
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: host.option });
  try {
    const button = appendHostButton(page);
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    });

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.ok(page.element.querySelector('.ig-audit-overlay') !== null, 'the panel did not open, so this proves nothing');
    assert.equal(host.latest()?.open, true);

    button.focus();
    pressEscape(page, button);
    await flush();

    // "Escape on that outside button, dispatching `audit-close`, closes the panel and `onChange` reports `open` false."
    assert.equal(page.element.querySelector('.ig-audit-overlay'), null);
    assert.equal(host.latest()?.open, false);
    // Focus was on the host button, outside the panel, so there is nothing to hand back.
    assert.equal(host.focusToggleCalls(), 0);
    assert.equal(page.win.document.activeElement, button);
  } finally {
    closePage(page);
  }
});

test('auditToggle: Escape from a rail row inside the mount reports open false and leaves focus on the row without focusToggle', async () => {
  const host = recordingAuditToggle();
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: host.option });
  try {
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.ok(page.element.querySelector('.ig-audit-overlay') !== null, 'the panel did not open, so this proves nothing');

    const row = page.rows()[0];
    assert.ok(row !== undefined, 'no rail row to stand on');
    const key = row.getAttribute('data-ig-key');
    row.focus();
    pressEscape(page, row);
    await flush();

    // "Escape inside the mount also reports `open` false."
    assert.equal(page.element.querySelector('.ig-audit-overlay'), null);
    assert.equal(host.latest()?.open, false);
    // Focus was on a row, not inside the panel, so the mount must not hand it to the host.
    assert.equal(host.focusToggleCalls(), 0);
    assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), key);
  } finally {
    closePage(page);
  }
});

test('auditToggle: the host closing the panel while focus is on a rail row does not call focusToggle and leaves focus on the row', async () => {
  const host = recordingAuditToggle();
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: host.option });
  try {
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.ok(page.element.querySelector('.ig-audit-overlay') !== null, 'the panel did not open, so this proves nothing');
    const row = page.rows()[0];
    assert.ok(row !== undefined, 'no rail row to stand on');
    const key = row.getAttribute('data-ig-key');
    row.focus();
    assert.equal(page.win.document.activeElement, row, 'the fixture cannot focus a row');

    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();

    assert.equal(page.element.querySelector('.ig-audit-overlay'), null, 'audit-close did not close the panel');
    assert.equal(host.latest()?.open, false, 'the host was not told the panel closed');
    // "When the panel closes with focus inside it, the mount calls `focusToggle` instead of searching its own surface for a toggle that is no longer there."
    // Focus was on a rail row, outside the panel, so the mount must not hand it to the host.
    assert.equal(host.focusToggleCalls(), 0, 'the mount handed focus to the host although the panel did not hold it');
    assert.equal(page.win.document.activeElement?.getAttribute('data-ig-key'), key, 'focus left the rail row');
  } finally {
    closePage(page);
  }
});

test('auditToggle: Escape inside the panel reports open false, then calls focusToggle once, and focus lands on the host button', async () => {
  let hostButton: HTMLButtonElement | undefined;
  const host = recordingAuditToggle(() => hostButton?.focus());
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: host.option });
  try {
    hostButton = appendHostButton(page);

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const panel = page.element.querySelector<HTMLElement>('.ig-audit-panel');
    assert.ok(panel !== null, 'the panel did not open, so this proves nothing');
    panel.focus();
    assert.equal(page.win.document.activeElement, panel, 'the fixture cannot hold focus in the panel');
    const before = host.order.length;

    pressEscape(page, panel);
    await flush();

    // "Closing the panel with focus inside it calls `focusToggle`, and focus is not on `document.body`."
    assert.equal(page.element.querySelector('.ig-audit-overlay'), null, 'Escape did not close the panel');
    // The host must know the panel is shut before it is asked to take focus, or its button would take focus
    // while still reading as expanded.
    assert.deepEqual(host.order.slice(before), ['onChange open=false', 'focusToggle']);
    assert.equal(page.win.document.activeElement, hostButton);
    assert.notEqual(page.win.document.activeElement, page.win.document.body);
  } finally {
    closePage(page);
  }
});

test('auditToggle: a second audit-close on a shut panel is not reported and does not hand focus to the host again', async () => {
  let hostButton: HTMLButtonElement | undefined;
  const host = recordingAuditToggle(() => hostButton?.focus());
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: host.option });
  try {
    hostButton = appendHostButton(page);

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    const panel = page.element.querySelector<HTMLElement>('.ig-audit-panel');
    assert.ok(panel !== null, 'the panel did not open, so this proves nothing');
    panel.focus();
    assert.equal(page.win.document.activeElement, panel, 'the fixture cannot hold focus in the panel');
    const toldBeforeClose = host.told.length;

    // The same close delivered twice: the second one lands on a panel that is already shut.
    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();
    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();

    // "After every draw where a fact changed, the mount calls `onChange` with the facts."
    assert.deepEqual(
      host.told.slice(toldBeforeClose).map((facts) => facts.open),
      [false],
    );
    // "When the panel closes with focus inside it, the mount calls `focusToggle` instead of searching its own surface for a toggle that is no longer there."
    assert.equal(host.focusToggleCalls(), 1);
    assert.equal(page.win.document.activeElement, hostButton);
  } finally {
    closePage(page);
  }
});

test('auditToggle: the host closing the panel while focus is on a control in it hands focus to the host once', async () => {
  let hostButton: HTMLButtonElement | undefined;
  const host = recordingAuditToggle(() => hostButton?.focus());
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: host.option });
  try {
    hostButton = appendHostButton(page);

    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    // A remedy names an issue, so without the hand-off the mount's own restore would look for that issue's control.
    const remedy = page.element.querySelector<HTMLElement>('.ig-audit-panel [data-ig-remedy]');
    assert.ok(remedy !== null, 'the panel drew no remedy control, so this proves nothing');
    remedy.focus();
    assert.equal(page.win.document.activeElement, remedy, 'the fixture cannot focus the remedy');

    page.handle.dispatch({ kind: 'control', name: 'audit-close' });
    await flush();

    assert.equal(page.element.querySelector('.ig-audit-overlay'), null, 'the panel did not close');
    // "When the panel closes with focus inside it, the mount calls `focusToggle` instead of searching its own surface for a toggle that is no longer there."
    assert.equal(host.focusToggleCalls(), 1);
    assert.equal(page.win.document.activeElement, hostButton);
    assert.notEqual(page.win.document.activeElement, page.win.document.body);
  } finally {
    closePage(page);
  }
});

test('auditToggle: an update that clears the findings while focus is in the panel calls focusToggle once', async () => {
  let hostButton: HTMLButtonElement | undefined;
  const host = recordingAuditToggle(() => hostButton?.focus());
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: host.option });
  try {
    hostButton = appendHostButton(page);

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
    const last = host.latest();
    assert.ok(last !== undefined, 'onChange was never called');
    assert.deepEqual({ count: last.count, worst: last.worst, open: last.open }, { count: 0, worst: null, open: false });
    // "When the panel closes with focus inside it, the mount calls `focusToggle` instead of searching its own surface for a toggle that is no longer there."
    assert.equal(host.focusToggleCalls(), 1);
    assert.equal(page.win.document.activeElement, hostButton);
  } finally {
    closePage(page);
  }
});

test('auditToggle: with no findings the mount draws no audit count and no empty header row, and keeps the header zone', async () => {
  const page = await mounted(SEED, { auditToggle: recordingAuditToggle().option });
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
    closePage(page);
  }
});

test('auditToggle: a header row holding a host identity is still drawn once, without the audit count', async () => {
  function withIdentity(snapshot: StoreSnapshot): WorkspaceProjection {
    const base = project(snapshot);
    return { ...base, viewer: { ...base.viewer, host: { identity: 'acme/widgets' } } };
  }
  const page = await mounted(SEED, { project: withIdentity, auditToggle: recordingAuditToggle().option });
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
    closePage(page);
  }
});

test('auditToggle: rail rows keep data-ig-audit and the panel still opens while the mount draws no audit count', async () => {
  const page = await mounted(SEED, { project: withCycleAudit, auditToggle: recordingAuditToggle().option });
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
    closePage(page);
  }
});

// "Without the option, the mount's output is byte-for-byte what it is today."
// The markup in the golden is what 0.49.0 drew. The stylesheet digest is this release's sheet, because the
// mount installs the first-pass sheet into every mount and that sheet gained the title row and key label rules.
type AuditToggleGoldenKey = 'findings-shut' | 'panel-open' | 'no-findings';

function assertMatchesAuditToggleGolden(page: Mounted, key: AuditToggleGoldenKey): void {
  const sheet = page.element.querySelector('style');
  assert.ok(sheet !== null, 'the mount installed no stylesheet');
  // The mount numbers its surfaces w1, w2, ... across the process, so the number depends on test order.
  const normalise = (text: string): string => text.replace(/\bw\d+\b/g, 'w#');
  const actual = {
    markup: normalise(page.element.innerHTML.replace(sheet.outerHTML, '')),
    // A digest, not the text: the stylesheet is about 246 KB, and three copies of it made the golden too large to read in review.
    stylesheetSha256: createHash('sha256').update(normalise(sheet.textContent ?? '')).digest('hex'),
  };
  const golden = new URL('./mount.audit-toggle.golden.json', import.meta.url);
  const paste = `keep the markup 0.49.0 drew, take the digest of this release's sheet, and paste this under "${key}":\n${JSON.stringify(actual, null, 2)}\n`;
  const committed: Record<string, { markup: string; stylesheetSha256: string }> = JSON.parse(readFileSync(golden, 'utf8'));
  assert.deepEqual(actual, committed[key], `the mount without auditToggle no longer draws 0.49.0's markup with this release's sheet; only if the golden is wrong, ${paste}`);
}

test('auditToggle: without the option, a mount with findings and the panel shut matches the 0.49.0 golden', async () => {
  const page = await mounted(SEED, { project: withCycleAudit });
  try {
    await flush();
    assert.ok(page.element.querySelector('[data-ig-audit-count]') !== null, 'the fixture drew no audit count, so this proves nothing');
    assertMatchesAuditToggleGolden(page, 'findings-shut');
  } finally {
    closePage(page);
  }
});

test('auditToggle: without the option, the panel opened by audit-panel matches the 0.49.0 golden', async () => {
  const page = await mounted(SEED, { project: withCycleAudit });
  try {
    await flush();
    page.handle.dispatch({ kind: 'control', name: 'audit-panel' });
    await flush();
    assert.ok(page.element.querySelector('.ig-audit-overlay') !== null, 'audit-panel drew no panel, so this proves nothing');
    assertMatchesAuditToggleGolden(page, 'panel-open');
  } finally {
    closePage(page);
  }
});

test('auditToggle: without the option, a mount with no findings matches the 0.49.0 golden', async () => {
  const page = await mounted(SEED);
  try {
    await flush();
    assertMatchesAuditToggleGolden(page, 'no-findings');
  } finally {
    closePage(page);
  }
});
