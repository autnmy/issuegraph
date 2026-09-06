/**
 * The host facts — the proof that the port is real.
 *
 * `hostFacts` is a pure function of an explained order, a running job and a
 * clock, so every number and every stamp here is asserted exactly against a
 * fixed clock. The mounted half (the refresh control reaching this host) runs
 * on jsdom, because the claim it makes — that a control the viewer publishes
 * and does not wire is heard by the host — is a claim about a click.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

import { normalizeDocument, renderViewer } from '@issuegraph/viewer';
import { type Store, createStore } from '@issuegraph/store';

import { projectDocument } from './document.ts';
import {
  STALE_AFTER_MS,
  ageBetween,
  elapsedBetween,
  hostFacts,
  orderCounts,
  runningJobs,
  runningSince,
  stampOf,
} from './host.ts';
import { createDeriver, explainDocument, slotCount } from './order.ts';
import { SCENARIOS, type Scenario, compSeed } from './seed.ts';
import { createDemoSource } from './source.ts';
import { HOST_COMMANDS_FROM_WORKSPACE, type Live, mountSandbox } from './workspace.ts';

const OBSERVED = new Date(Date.UTC(2026, 8, 6, 14, 32, 0));
const NOW = new Date(OBSERVED.getTime() + 2 * 60_000);
const comp: Scenario = SCENARIOS.comp;

function facts(document = compSeed(), now = NOW) {
  const explained = explainDocument(document, comp.holds, comp.ranking);
  const running = comp.running === undefined ? undefined : runningSince(comp.running, OBSERVED);
  return { explained, host: hostFacts({ rows: explained.rows, observedAt: OBSERVED, now, running }) };
}

describe('the demo supplies every host fact the port carries', () => {
  it('stamps the mirror read in UTC and ages it against the clock', () => {
    assert.equal(stampOf(OBSERVED), '14:32');
    assert.equal(ageBetween(OBSERVED, OBSERVED), 'just now');
    assert.equal(ageBetween(OBSERVED, NOW), '2m ago');
    assert.equal(elapsedBetween(OBSERVED, new Date(OBSERVED.getTime() + 42_000)), '42s');
    assert.equal(elapsedBetween(OBSERVED, new Date(OBSERVED.getTime() + 90 * 60_000)), '1h 30m');
    assert.equal(elapsedBetween(OBSERVED, new Date(OBSERVED.getTime() + 120 * 60_000)), '2h');
  });

  it('is a pure function of its inputs: the same clock, the same facts', () => {
    assert.deepEqual(facts().host, facts().host);
    const { host } = facts();
    assert.deepEqual(host.freshness, { asOf: '14:32', age: '2m ago', stale: false, refresh: 'refresh' });
    assert.equal(host.concurrencyCap, 2);
  });

  it("draws the scenario's running job as the NOW row, with the runner's elapsed time", () => {
    // #499 is the frame's `now` row; #533 is ALSO an active claim, and is not
    // running. The job is named by the scenario, never read off the holds.
    const { host } = facts();
    assert.deepEqual(host.running, [{ key: '499', phase: 'Review', elapsed: '14m' }]);
    assert.deepEqual(runningJobs(undefined, NOW), []);
  });

  it('goes stale past the demo threshold, and only then', () => {
    const fresh = facts(compSeed(), new Date(OBSERVED.getTime() + STALE_AFTER_MS)).host;
    const stale = facts(compSeed(), new Date(OBSERVED.getTime() + STALE_AFTER_MS + 1)).host;
    assert.equal(fresh.freshness?.stale, false);
    assert.equal(stale.freshness?.stale, true);
  });

  it('tallies the whole order in slots, and agrees with an independent count over the same rows', () => {
    const { explained, host } = facts();
    const rows = explained.rows;
    const spine = rows.filter((row) => row.placement === 'spine');
    const expected = {
      ranked: slotCount(spine),
      readyNow: slotCount(spine.filter((row) => row.ready)),
      held:
        slotCount(spine.filter((row) => !row.ready)) +
        slotCount(
          rows.filter(
            (row) => row.placement === 'footer' && row.issue.ref !== '499' && row.holds.some((hold) => hold.family === 'executor'),
          ),
        ),
    };
    assert.deepEqual(host.counts, expected);
    assert.deepEqual(orderCounts(rows, new Set(['499'])), expected);
    // A graph-held row keeps its rank, so ranked exceeds ready — the shape the
    // frame's header has (`6 ranked · 4 ready now`), and one a tautology could
    // never produce. The comp carries two more spine rows than the frame draws
    // (§16b: "19 more ranked · scroll"), so the numbers are the comp's own.
    assert.ok((host.counts?.ranked ?? 0) > (host.counts?.readyNow ?? 0), 'held spine rows were not counted as ranked');
    assert.ok((host.counts?.held ?? 0) > 0);
    // A together unit is one rank, so members never inflate the tally.
    assert.ok(spine.length > (host.counts?.ranked ?? 0), 'the comp has no together unit on the spine to prove the rule against');
    // The running issue is drawn in the NOW row, not counted as held.
    assert.equal(orderCounts(rows).held, expected.held + 1);
  });

  it('projects the full set onto the viewer document, and the viewer draws every one', () => {
    const document = compSeed();
    const { explained, host } = facts(document);
    const { viewer } = projectDocument(explained, document, host, comp.caveats);
    assert.deepEqual(viewer.host, host);

    const { document: drawn, diagnostics } = normalizeDocument(viewer);
    assert.deepEqual(diagnostics, [], diagnostics.join('\n'));
    assert.deepEqual(drawn.host.running.map((job) => job.key), ['499']);

    // The running issue holds no slot: the NOW row is where it is drawn.
    assert.equal(viewer.order.slots.some((slot) => slot.members.includes('499')), false);
    assert.ok(viewer.issues.some((issue) => issue.key === '499'));
    assert.equal(drawn.isolated.includes('499'), false);

    // The runner's words ride the tracker arm — one label per executor hold.
    const footer = viewer.order.slots.filter((slot) => slot.holds.some((hold) => hold.family === 'tracker'));
    const labels = footer.flatMap((slot) => slot.holds.flatMap((hold) => (hold.family === 'tracker' ? [hold.label] : [])));
    assert.deepEqual([...new Set(labels)].sort(), ['claimed', 'not eligible', 'parked']);

    // The engine's caveats, from the scenario's table.
    const preview = viewer.issues.find((issue) => issue.key === '487');
    const disagreeing = viewer.issues.find((issue) => issue.key === '501');
    assert.deepEqual(preview?.previewOnly, comp.caveats.get('487')?.previewOnly);
    assert.deepEqual(disagreeing?.disagreement, comp.caveats.get('501')?.disagreement);

    const markup = renderViewer(viewer).markup;
    // THREE CHIPS, which is how §16a draws the tally: each figure outlined on
    // its own and only the one an operator acts on — how many could run now,
    // against the cap — carrying the accent.
    assert.match(
      markup,
      new RegExp(`<span class="ig-count-chip" data-count="ranked">${String(host.counts?.ranked)} ranked</span>`),
    );
    assert.match(
      markup,
      new RegExp(`<span class="ig-count-chip" data-count="ready">${String(host.counts?.readyNow)} ready now · cap 2</span>`),
    );
    assert.match(
      markup,
      new RegExp(`<span class="ig-count-chip" data-count="held">${String(host.counts?.held)} held</span>`),
    );
    assert.match(markup, /<p class="ig-freshness" data-stale="false"><span>as of <span class="ig-id">14:32<\/span> · 2m ago<\/span><button class="ig-refresh" type="button" data-ig-command="refresh">refresh<\/button><\/p>/);
    assert.match(markup, /<li class="ig-now-row" data-ig-group="499" aria-label="Fix flaky auth integration test — Review · 14m">/);
    assert.equal((markup.match(/data-ig-key="499"/g) ?? []).length, 0, 'the running issue also holds a slot');
    assert.match(markup, /<span class="ig-badge" data-hold="claimed">claimed<\/span>/);
    assert.match(markup, /<span class="ig-badge" data-hold="parked">parked<\/span>/);
    assert.match(markup, /data-ig-key="487"[^]*?data-caveat="preview-only"/);
    assert.match(markup, /data-ig-key="501"[^]*?data-caveat="disagree"[^]*?ranked by label:P1 \(your mapping\) · frontmatter declares <s class="ig-strike">priority: 3<\/s>/);
    // In footer order — the first-stated word first — which is how the rows
    // beneath read. §16a puts them beside the count rather than inside the
    // heading, so the heading says what the group IS and the words say why.
    assert.match(markup, /<span class="ig-footer-labels">not eligible · claimed · parked<\/span>/);
  });

  it('draws the pure-graph view when no host is handed across', () => {
    const document = compSeed();
    const { explained } = facts(document);
    const { viewer } = projectDocument(explained, document);
    assert.equal(viewer.host, undefined);
    const markup = renderViewer(viewer).markup;
    // THE HOST'S FACTS, NOT THE PANEL'S CHROME. The header bar carries the
    // panel's own name and its projection toggle — neither is a fact a host
    // states — so what the pure-graph promise is about is the counts, the
    // stamp, the NOW row and the caveats.
    for (const cls of ['ig-counts', 'ig-now', 'ig-freshness', 'ig-caveat']) {
      assert.equal(markup.includes(cls), false, cls);
    }
    // Without a running job the runner's claim on #499 is a footer row again.
    assert.ok(viewer.order.slots.some((slot) => slot.members.includes('499')));
  });
});

describe('the refresh control reaches the host', () => {
  it('re-reads the mirror on a click inside the mounted workspace', async () => {
    assert.ok(HOST_COMMANDS_FROM_WORKSPACE.has('refresh'));
    const dom = new JSDOM(
      '<!doctype html><html><body><main id="sandbox"><section id="workspace"></section><div id="writes"></div><p id="versions"></p><select id="outcome"><option value="apply">apply</option><option value="reject">reject</option><option value="conflict">conflict</option></select><button type="button" data-ig-command="reset">reset</button></main></body></html>',
    );
    const win = dom.window;
    // The sandbox reads the page globals a browser has — `document` for its
    // own chrome, `Element` for the click target test — so the double supplies them.
    const previous = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element };
    Object.assign(globalThis, { document: win.document, window: win, Element: win.Element });
    try {
      const byId = <T extends HTMLElement>(id: string, kind: new () => T): T => {
        const found = win.document.getElementById(id);
        if (!(found instanceof kind)) throw new Error(`missing #${id}`);
        return found;
      };
      let hydrations = 0;
      // The source can be told to REFUSE the next read, and to HOLD a read until
      // the test releases it — the two shapes a stamp must not be fooled by.
      let refuse = false;
      const held: Array<() => void> = [];
      let hold = false;
      const boot = (scenario: Scenario, onChange: () => void): Live => {
        const source = createDemoSource(scenario.document(), { onArmedChange: onChange });
        const counted = {
          ...source,
          hydrate: async () => {
            hydrations += 1;
            if (hold) await new Promise<void>((resolve) => held.push(resolve));
            if (refuse) throw new Error('the tracker is unreachable');
            return source.hydrate();
          },
        };
        const store: Store = createStore({ source: counted, derive: createDeriver(scenario.holds, scenario.ranking) });
        return { store, source: counted };
      };
      // A clock in PHASES rather than ticks, so the stamp the workspace draws
      // can be asserted exactly: every read before the refresh is `OBSERVED`,
      // every read after it is ten minutes later.
      let current = OBSERVED;
      const handle = mountSandbox(
        {
          root: byId('sandbox', win.HTMLElement),
          workspace: byId('workspace', win.HTMLElement),
          writes: byId('writes', win.HTMLElement),
          versions: byId('versions', win.HTMLElement),
          outcome: byId('outcome', win.HTMLSelectElement),
        },
        boot,
        // A fast tick, so the clock-only redraw is observable within the test.
        { clock: () => current, tickMs: 5 },
      );
      const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
      await settle();
      await settle();
      assert.equal(hydrations, 1, 'the sandbox did not hydrate once on start');
      const stamp = (): string | null | undefined =>
        win.document.querySelector('#workspace .ig-freshness .ig-id')?.textContent;
      // THE ELAPSED TIME MOVED WITH §16a's BAND. It used to sit at the far end
      // of the NOW row, where the frame puts a "working" indicator; it is now on
      // the row's own metadata line, beside the identity, which is where §16a
      // draws it.
      const elapsed = (): string | null | undefined =>
        win.document.querySelector('#workspace .ig-now-row .ig-row-head .ig-id')?.textContent;
      // THE STAMP THE WORKSPACE DRAWS IS THE READ'S, not the mount's: the store
      // notifies its subscribers before `hydrate()` resolves, so without the
      // mount's own redraw the drawn stamp was one read behind.
      assert.equal(stamp(), stampOf(OBSERVED));
      assert.equal(elapsed(), '499 · Review · 12m');

      // RE-QUERIED PER CLICK: every redraw rebuilds the control, so a reference
      // taken once would dispatch into a detached node after the first read.
      const clickRefresh = (): void => {
        const refresh = win.document.querySelector<HTMLButtonElement>('#workspace button[data-ig-command="refresh"]');
        assert.ok(refresh !== null, 'the workspace drew no refresh control');
        refresh.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      };
      current = new Date(OBSERVED.getTime() + 10 * 60_000);
      clickRefresh();
      await settle();
      await settle();
      assert.equal(hydrations, 2, 'the click did not re-read the mirror');
      assert.equal(stamp(), stampOf(current), 'the drawn stamp is not the newest read');
      // The job started once, at mount; a refresh does not wind it back.
      assert.equal(elapsed(), '499 · Review · 22m');
      const landed = current;

      // A READ THAT FAILED IS NOT A READ. The store keeps the last good document
      // and stays ready (`rehydrate`, not a second `hydrate`), and the stamp
      // stays at the read that landed rather than claiming "just now".
      refuse = true;
      current = new Date(OBSERVED.getTime() + 20 * 60_000);
      clickRefresh();
      await settle();
      await settle();
      assert.equal(hydrations, 3);
      assert.equal(stamp(), stampOf(landed), 'a failed read moved the stamp');
      refuse = false;

      // A COMPLETION FROM A SUPERSEDED STORE STAMPS NOTHING. Hold the next
      // read, reset the sandbox underneath it (a fresh store, read at once),
      // then release the held read with the clock moved on: the stamp is the
      // replacement's, not the stale completion's.
      hold = true;
      clickRefresh();
      await settle();
      assert.equal(held.length, 1, 'the read was not held');
      hold = false;
      current = new Date(OBSERVED.getTime() + 30 * 60_000);
      const reset = win.document.querySelector<HTMLButtonElement>('#sandbox button[data-ig-command="reset"]');
      assert.ok(reset !== null, 'no reset control');
      reset.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await settle();
      await settle();
      const fresh = stamp();
      assert.equal(fresh, stampOf(current), 'the reset did not stamp its own read');
      current = new Date(OBSERVED.getTime() + 40 * 60_000);
      for (const release of held.splice(0)) release();
      await settle();
      await settle();
      assert.equal(stamp(), fresh, 'a completion from the replaced store re-stamped the page');

      // THE CLOCK ALONE REDRAWS. Nothing happens to the store; the tick reads
      // `now` again, and the age and the elapsed time move — and past the
      // threshold the stamp goes stale without anyone touching the page.
      current = new Date(current.getTime() + STALE_AFTER_MS + 60_000);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await settle();
      assert.equal(win.document.querySelector('#workspace .ig-freshness')?.getAttribute('data-stale'), 'true', 'the stamp never went stale on its own');
      assert.equal(stamp(), fresh, 'a clock tick re-stamped the read');
      handle.destroy();
      // TORN DOWN, NO TIMER: a later tick draws nothing.
      const after = win.document.querySelector('#workspace .ig-freshness')?.textContent;
      current = new Date(current.getTime() + 60_000);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(win.document.querySelector('#workspace .ig-freshness')?.textContent, after);
    } finally {
      Object.assign(globalThis, previous);
      win.close();
    }
  });
});

describe('the §16g states are reachable from the sandbox, with their affordances', () => {
  it('switches state, performs Retry, and dismisses the adoption line — all on a click', async () => {
    // R10's ACTUAL CLAIM: reachable without editing a file. A package test can
    // only prove the viewer draws a control for a host that named one; that the
    // control is drawn HERE, and that a click on it reaches this host through
    // the mount's own listener, is a claim about a click.
    for (const name of ['retry:index', 'review-pick-order', 'dismiss:adoption']) {
      assert.ok(HOST_COMMANDS_FROM_WORKSPACE.has(name), `${name} would be dropped before the switch`);
    }
    const dom = new JSDOM(
      '<!doctype html><html><body><main id="sandbox"><div class="control-row" data-chrome="state"></div><div class="control-row" data-chrome="scenario"></div><section id="workspace"></section><div id="writes"></div><p id="versions"></p><select id="outcome"><option value="apply">apply</option></select></main></body></html>',
    );
    const win = dom.window;
    const previous = { document: globalThis.document, window: globalThis.window, Element: globalThis.Element };
    Object.assign(globalThis, { document: win.document, window: win, Element: win.Element });
    let handle: ReturnType<typeof mountSandbox> | null = null;
    try {
      const byId = <T extends HTMLElement>(id: string, kind: new () => T): T => {
        const found = win.document.getElementById(id);
        if (!(found instanceof kind)) throw new Error(`missing #${id}`);
        return found;
      };
      // A SOURCE THAT CAN REFUSE THE NEXT READ, so the failed-refresh path is
      // exercised rather than reasoned about.
      let refuse = false;
      const boot = (scenario: Scenario, onChange: () => void): Live => {
        const source = createDemoSource(scenario.document(), { onArmedChange: onChange });
        const counted = {
          ...source,
          hydrate: async () => {
            if (refuse) throw new Error('the tracker is unreachable');
            return source.hydrate();
          },
        };
        const store: Store = createStore({ source: counted, derive: createDeriver(scenario.holds, scenario.ranking) });
        return { store, source: counted };
      };
      handle = mountSandbox(
        {
          root: byId('sandbox', win.HTMLElement),
          workspace: byId('workspace', win.HTMLElement),
          writes: byId('writes', win.HTMLElement),
          versions: byId('versions', win.HTMLElement),
          outcome: byId('outcome', win.HTMLSelectElement),
        },
        boot,
        { clock: () => new Date('2026-09-06T14:32:00Z'), tickMs: 10_000 },
      );
      const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
      await settle();
      await settle();

      // QUERIED, NEVER SUBSTRING-MATCHED. The mount installs the viewer's own
      // stylesheet inside this element, and that stylesheet names every
      // attribute the panel can carry — so `innerHTML.includes(...)` reads the
      // CSS as markup and answers yes to every question asked of it.
      const conditionNow = (): string | null =>
        win.document.querySelector('#workspace .ig-viewer')?.getAttribute('data-ig-condition') ?? null;
      const noticeText = (): string => win.document.querySelector('#workspace .ig-notice')?.textContent ?? '';
      const has = (selector: string): boolean => win.document.querySelector(`#workspace ${selector}`) !== null;
      const click = (selector: string, why: string): void => {
        const control = win.document.querySelector<HTMLElement>(selector);
        assert.ok(control !== null, why);
        control.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      };
      const chooseState = async (name: string): Promise<void> => {
        click(`[data-chrome="state"] [data-ig-value="${name}"]`, `no control for the ${name} state`);
        await settle();
        await settle();
      };

      // EVERY STATE IS ONE CLICK AWAY, over whatever document is loaded.
      assert.equal(conditionNow(), null, 'the sandbox did not land on the live state');
      await chooseState('importing');
      assert.equal(conditionNow(), 'importing', 'the importing state is unreachable');
      assert.ok(noticeText().includes('Building the local index'), 'the importing notice lost its headline');
      await chooseState('empty');
      assert.equal(conditionNow(), 'empty', 'the empty state is unreachable');
      assert.ok(noticeText().includes('Nothing is eligible right now'), 'the empty notice lost its headline');
      assert.ok(has('[data-ig-command="review-pick-order"]'), 'the empty state drew no action');
      await chooseState('stale');
      assert.equal(
        win.document.querySelector('#workspace .ig-freshness')?.getAttribute('data-stale'),
        'true',
        'the stale state is unreachable',
      );
      await chooseState('error');
      assert.equal(conditionNow(), 'error', 'the error state is unreachable');
      assert.ok(noticeText().includes('The index could not be read'), 'the error notice lost its headline');

      // AND THE AFFORDANCE PERFORMS. A Retry the host never hears is the "control
      // nobody wired" failure wearing a different coat, and it would pass every
      // package assertion — the viewer's half is drawing it, and it does.
      click('#workspace [data-ig-command="retry:index"]', 'the error state drew no Retry');
      await settle();
      await settle();
      assert.equal(conditionNow(), null, 'Retry reached nobody');

      // A REFRESH THAT CANNOT MAKE THE STAMP FRESH IS A CONTROL THAT LIES. The
      // stale state is drawn by dating the read further back on every render,
      // so without clearing the state a landed re-read left the panel saying
      // "stale" forever — the one affordance §16g gives that state, doing
      // nothing a reader could see.
      await chooseState('stale');
      assert.equal(
        win.document.querySelector('#workspace .ig-freshness')?.getAttribute('data-stale'),
        'true',
      );
      click('#workspace [data-ig-command="refresh"]', 'the stale state drew no refresh');
      await settle();
      await settle();
      assert.equal(
        win.document.querySelector('#workspace .ig-freshness')?.getAttribute('data-stale'),
        'false',
        'a landed refresh left the panel stale',
      );

      // AND A REFRESH THAT FAILS LEAVES IT STALE. The state lifts with the
      // stamp, in the one place that knows a read landed — lifting it at the
      // click moved it before the evidence, so a failed re-read left the stamp
      // untouched (correctly) while the panel re-rendered live, which is a
      // failure wearing the look of a success.
      await chooseState('stale');
      refuse = true;
      click('#workspace [data-ig-command="refresh"]', 'the stale state drew no refresh');
      await settle();
      await settle();
      assert.equal(
        win.document.querySelector('#workspace .ig-freshness')?.getAttribute('data-stale'),
        'true',
        'a refresh that failed still read as fresh',
      );
      refuse = false;

      // EVERY STATE A READ REFUTES, not whichever one was last reported. The
      // lift used to be spelled per state, so `stale` was fixed and `error` was
      // still holding a five-hour-old stamp over a read that had just landed.
      for (const backdated of ['importing', 'error', 'stale'] as const) {
        await chooseState(backdated);
        click('#workspace [data-ig-command="refresh"]', `the ${backdated} state drew no refresh`);
        await settle();
        await settle();
        assert.equal(conditionNow(), null, `a landed read left the ${backdated} state standing`);
        assert.equal(
          win.document.querySelector('#workspace .ig-freshness')?.getAttribute('data-stale'),
          'false',
          `a landed read left the ${backdated} stamp backdated`,
        );
      }

      // AND A RETRY IS A READ. It used to clear the state at the click, which is
      // the same optimism that made a failed refresh look successful.
      await chooseState('error');
      refuse = true;
      click('#workspace [data-ig-command="retry:index"]', 'the error state drew no Retry');
      await settle();
      await settle();
      assert.equal(conditionNow(), 'error', 'a retry that could not read still cleared the error');
      refuse = false;
      click('#workspace [data-ig-command="retry:index"]', 'the error state drew no Retry');
      await settle();
      await settle();
      assert.equal(conditionNow(), null, 'a retry that landed left the error standing');

      // §16h's line is dismissible, which is the design's own word for it.
      click('[data-chrome="scenario"] [data-ig-value="adoption"]', 'no control for the day-one document');
      await settle();
      await settle();
      assert.ok(has('.ig-adoption'), 'the day-one document drew no adoption line');
      click('#workspace [data-ig-command="dismiss:adoption"]', 'the adoption line drew no dismiss');
      await settle();
      await settle();
      assert.ok(!has('.ig-adoption'), 'dismiss reached nobody');

      // ADOPTION IS A REPOSITORY FACT, so blanking the ORDER must not blank it.
      // The empty state deliberately shows no rows; the backlog it is drawn
      // over still declares whatever it declares.
      click('[data-chrome="scenario"] [data-ig-value="backlog"]', 'no control for the big backlog');
      await settle();
      await settle();
      const chip = (): string =>
        win.document.querySelector('#workspace [data-count="adoption"]')?.textContent ?? '';
      const populated = chip();
      assert.ok(/^\d+ of \d+ declare relationships$/.test(populated), `no adoption chip: ${populated}`);
      assert.ok(!populated.startsWith('0 of 0'), 'the backlog counted nothing');
      await chooseState('empty');
      assert.equal(chip(), populated, 'the empty state emptied the repository as well as the order');
    } finally {
      // TORN DOWN EVEN ON A FAILED ASSERTION. The sandbox holds a clock
      // interval, so a throw before this left the timer alive and the whole
      // test run hung instead of reporting the failure.
      handle?.destroy();
      Object.assign(globalThis, previous);
      win.close();
    }
  });
});
