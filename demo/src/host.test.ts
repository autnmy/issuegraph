/**
 * The host facts — the proof that the port is real.
 *
 * `hostFacts` is a pure function of an explained order and a clock, so every
 * number and every stamp here is asserted exactly against a fixed clock. The
 * mounted half (the refresh control reaching this host) runs on jsdom, because
 * the claim it makes — that a control the viewer publishes and does not wire
 * is heard by the host — is a claim about a click.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

import { normalizeDocument, renderViewer } from '@issuegraph/viewer';
import { type Store, createStore } from '@issuegraph/store';

import { projectDocument } from './document.ts';
import {
  CAVEATS,
  STALE_AFTER_MS,
  ageBetween,
  elapsedBetween,
  hostFacts,
  orderCounts,
  runningJobs,
  stampOf,
} from './host.ts';
import { createDeriver, explainDocument, slotCount } from './order.ts';
import { coverageSeed, seedDocument, seedHolds } from './seed.ts';
import { createDemoSource } from './source.ts';
import { HOST_COMMANDS_FROM_WORKSPACE, type Live, mountSandbox, runningWork } from './workspace.ts';

const OBSERVED = new Date(Date.UTC(2026, 8, 6, 14, 32, 0));
const NOW = new Date(OBSERVED.getTime() + 2 * 60_000);

function facts(document = coverageSeed(), now = NOW) {
  const holds = seedHolds();
  const explained = explainDocument(document, holds);
  return {
    explained,
    host: hostFacts({ rows: explained.rows, holds, observedAt: OBSERVED, now, job: runningWork(OBSERVED) }),
  };
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

  it('reads the running job off the active executor hold, with the runner elapsed', () => {
    // #6 is the seed's one ACTIVE hold; #11 is parked, and parked is not running.
    const { host } = facts();
    assert.deepEqual(host.running, [{ key: '6', phase: 'Review', elapsed: '14m' }]);
    assert.deepEqual(runningJobs([], runningWork(OBSERVED), NOW), []);
  });

  it('goes stale past the demo threshold, and only then', () => {
    const fresh = facts(coverageSeed(), new Date(OBSERVED.getTime() + STALE_AFTER_MS)).host;
    const stale = facts(coverageSeed(), new Date(OBSERVED.getTime() + STALE_AFTER_MS + 1)).host;
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
        slotCount(rows.filter((row) => row.placement === 'footer' && row.holds.some((hold) => hold.family === 'executor'))),
    };
    assert.deepEqual(host.counts, expected);
    assert.deepEqual(orderCounts(rows), expected);
    // The seed reaches every bucket: something ranked, something ready, something held.
    assert.ok((host.counts?.ranked ?? 0) > 0 && (host.counts?.readyNow ?? 0) > 0 && (host.counts?.held ?? 0) > 0);
    // A graph-held row keeps its rank, so ranked exceeds ready — the shape the
    // design's header has, and one a tautology could never produce.
    assert.ok((host.counts?.ranked ?? 0) > (host.counts?.readyNow ?? 0), 'held spine rows were not counted as ranked');
    // A together unit is one rank, so members never inflate the tally.
    assert.ok(spine.length > (host.counts?.ranked ?? 0), 'the seed has no together unit on the spine to prove the rule against');
  });

  it('projects the full set onto the viewer document, and the viewer draws every one', () => {
    const document = coverageSeed();
    const { explained, host } = facts(document);
    const { viewer } = projectDocument(explained, document, host);
    assert.deepEqual(viewer.host, host);

    const { document: drawn, diagnostics } = normalizeDocument(viewer);
    assert.deepEqual(diagnostics.filter((line) => !line.includes('404')), []);
    assert.deepEqual(drawn.host.running.map((job) => job.key), ['6']);

    // The runner's words ride the tracker arm — one label per executor hold.
    const footer = viewer.order.slots.filter((slot) => slot.holds.some((hold) => hold.family === 'tracker'));
    const labels = footer.flatMap((slot) => slot.holds.flatMap((hold) => (hold.family === 'tracker' ? [hold.label] : [])));
    assert.deepEqual([...new Set(labels)].sort(), ['claimed', 'parked']);

    // The engine's caveats, from the host's table.
    const four = viewer.issues.find((issue) => issue.key === '4');
    const fourteen = viewer.issues.find((issue) => issue.key === '14');
    assert.deepEqual(four?.previewOnly, CAVEATS.get('4')?.previewOnly);
    assert.deepEqual(fourteen?.disagreement, CAVEATS.get('14')?.disagreement);

    const markup = renderViewer(viewer).markup;
    assert.match(markup, /<p class="ig-summary">\d+ ranked · \d+ ready now · cap 2 · \d+ held<\/p>/);
    assert.match(markup, /<p class="ig-freshness" data-stale="false">as of <span class="ig-id">14:32<\/span> · 2m ago<button class="ig-refresh" type="button" data-ig-command="refresh">refresh<\/button><\/p>/);
    assert.match(markup, /<li class="ig-now-row" data-ig-group="6"/);
    assert.match(markup, /<span class="ig-badge" data-hold="claimed">claimed<\/span>/);
    assert.match(markup, /<span class="ig-badge" data-hold="parked">parked<\/span>/);
    assert.match(markup, /data-caveat="preview-only"/);
    assert.match(markup, /data-caveat="disagree"/);
    // In footer order — the first-stated word first — which is how the rows beneath read.
    assert.match(markup, /never worked · parked · claimed</);
  });

  it('draws the pure-graph view when no host is handed across', () => {
    const document = coverageSeed();
    const { explained } = facts(document);
    const { viewer } = projectDocument(explained, document);
    assert.equal(viewer.host, undefined);
    const markup = renderViewer({ ...viewer, issues: viewer.issues.map(({ previewOnly: _p, disagreement: _d, ...rest }) => rest) }).markup;
    for (const cls of ['ig-header', 'ig-now', 'ig-freshness']) assert.equal(markup.includes(cls), false, cls);
  });
});

describe('the refresh control reaches the host', () => {
  it('re-reads the mirror on a click inside the mounted workspace', async () => {
    assert.ok(HOST_COMMANDS_FROM_WORKSPACE.has('refresh'));
    const dom = new JSDOM(
      '<!doctype html><html><body><main id="sandbox"><section id="workspace"></section><div id="writes"></div><p id="versions"></p><select id="outcome"><option value="apply">apply</option><option value="reject">reject</option><option value="conflict">conflict</option></select></main></body></html>',
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
      const boot = (onChange: () => void): Live => {
        const source = createDemoSource(seedDocument(), { onArmedChange: onChange });
        const counted = {
          ...source,
          hydrate: async () => {
            hydrations += 1;
            return source.hydrate();
          },
        };
        const store: Store = createStore({ source: counted, derive: createDeriver(seedHolds()) });
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
        { clock: () => current },
      );
      const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
      await settle();
      await settle();
      assert.equal(hydrations, 1, 'the sandbox did not hydrate once on start');
      const stamp = (): string | null | undefined =>
        win.document.querySelector('#workspace .ig-freshness .ig-id')?.textContent;
      const elapsed = (): string | null | undefined =>
        win.document.querySelector('#workspace .ig-now-phase')?.textContent;
      // THE STAMP THE WORKSPACE DRAWS IS THE READ'S, not the mount's: the store
      // notifies its subscribers before `hydrate()` resolves, so without the
      // mount's own redraw the drawn stamp was one read behind.
      assert.equal(stamp(), stampOf(OBSERVED));
      assert.equal(elapsed(), '· Review · 12m');

      const refresh = win.document.querySelector<HTMLButtonElement>('#workspace button[data-ig-command="refresh"]');
      assert.ok(refresh !== null, 'the workspace drew no refresh control');
      current = new Date(OBSERVED.getTime() + 10 * 60_000);
      refresh.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      await settle();
      await settle();
      assert.equal(hydrations, 2, 'the click did not re-read the mirror');
      assert.equal(stamp(), stampOf(current), 'the drawn stamp is not the newest read');
      // The job started once, at mount; a refresh does not wind it back.
      assert.equal(elapsed(), '· Review · 22m');
      handle.destroy();
    } finally {
      Object.assign(globalThis, previous);
      win.close();
    }
  });
});
