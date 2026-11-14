/**
 * The mount, driven through a real DOM: the stylesheet, the host facts and the
 * first pass.
 *
 * Split from `mount.test.ts`, whose header says why jsdom and why every test
 * goes through the public entry point. The editor suite gives each file 20 s
 * (`--test-timeout=20000` under the glob runner), and one file holding every
 * mount test had grown to that line on node 22 (#297).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GraphDocument, StoreSnapshot } from '@issuegraph/store';
import { type OrderDeriver, makeEdge } from '@issuegraph/store';
import { THEME_TOKENS } from '@issuegraph/viewer';

import { RELATE_KEY } from '../create/keys.ts';
import type { Candidate } from '../firstpass/candidates.ts';
import { FIRST_PASS_WORDS } from '../testing/firstpass.ts';
import { mountStylesheet } from './chrome.ts';
import type { WorkspaceProjection } from './mount.ts';
import { WORDS, SEED, project, flush, blockingDeriver, hostedProject, mounted, type Mounted } from '../testing/mount.ts';

describe('the mount stylesheet carries structure, never a value', () => {
  const css = mountStylesheet.replace(/\/\*[\s\S]*?\*\//g, '');

  it('references only theme tokens', () => {
    const referenced = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] ?? '');
    assert.ok(referenced.length > 0);
    assert.deepEqual(referenced.filter((token) => !THEME_TOKENS.includes(token)), []);
  });

  it('writes no literal colour and no fixed length', () => {
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'a literal colour');
    assert.equal(/\brgba?\(/.test(css), false, 'a literal colour function');
    assert.equal(/\b\d+(\.\d+)?(px|rem|em|pt)\b/.test(css), false, 'a fixed length');
  });

  it('lets the first-pass takeover scroll rather than centring content out of reach', () => {
    // Evidence is host prose of no fixed length. Centring overflow in a
    // fixed-height absolute box puts the question above the container's own
    // origin, where no scroll can reach it.
    const overlay = css.slice(css.indexOf('.ig-firstpass-overlay'));
    const block = overlay.slice(0, overlay.indexOf('}'));
    assert.match(block, /overflow:\s*auto/);
    assert.equal(/justify-content:\s*center/.test(block), false, 'the takeover centres its overflow');
  });

  it('declares no animation and no transition', () => {
    assert.equal(/\banimation\b|\btransition\b|@keyframes/.test(css), false);
  });

});

describe('a pending write cannot change a rank', () => {
  it('draws the same ranks before, during and after a write the source has not answered', async () => {
    // OPTIMISTIC RENDERING, NEVER OPTIMISTIC RE-ORDERING. The store already
    // pins that `order.status` is `held` while an edit is in flight
    // (`packages/store/src/acceptance.test.ts`); this pins the half a reader
    // sees — the rail's rank column — because the mount adds an unsettled edge
    // to the drawn document's EDGES and never to its ORDER, and a fact about
    // the drawn document is proven on the drawn document.
    // A DERIVER THE EDGE MOVES, or the pin could not fail: with the harness's
    // flat deriver every write lands on the same order, and a mount that folded
    // pending edges into the drawn order would have passed.
    const page = await mounted(SEED, { derive: blockingDeriver });
    try {
      const drawn = (): (string | null)[][] =>
        page.rows().map((row) => [row.getAttribute('data-ig-key'), row.querySelector('.ig-rank')?.textContent ?? null]);
      // #1 is blocked by #2 in the seed, so it sorts last and is held.
      const before = drawn();
      assert.deepEqual(before, [['2', '1'], ['3', '2'], ['4', '3'], ['1', '4']]);

      void page.store.propose({ op: 'create', kind: 'blocked-by', from: '2', to: '3' });
      await page.source.whenPending();
      await flush();
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-order'), 'held');
      assert.deepEqual(drawn(), before, 'a pending write moved a rank');

      page.source.settleNext('applied');
      await flush();
      // LANDED, THE ORDER MOVES — #2 is now blocked too and sorts after #3 and
      // #4. The move happens here and only here: when the store re-derived,
      // not when the edge was drawn.
      assert.deepEqual(drawn(), [['3', '1'], ['4', '2'], ['1', '3'], ['2', '4']]);
      assert.equal(page.element.querySelector('.ig-mount')?.getAttribute('data-order'), 'settled');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});

describe('the host facts are drawn once per workspace', () => {
  it('draws each host fact in exactly one zone, in both canvas modes', async () => {
    // Every host fact is whole-order, and the property this pins is that each
    // is stated ONCE. The graph canvas already drops `host` through the
    // ladder's focus; the tree canvas rendered the whole hosted document and
    // drew a second header and a second refresh control beside the rail's.
    //
    // RE-AIMED BY #135, NOT WEAKENED. The counts and the NOW row still belong
    // to the rail; the freshness stamp and its refresh control now belong to
    // §17a's workspace header, so "in the rail only" became the wrong shape of
    // the same claim. The counts below are unchanged — what moved is which
    // zone each answer is asserted in, which is the whole of the ruling.
    const page = await mounted(SEED, { project: hostedProject });
    try {
      const count = (selector: string): number => page.element.querySelectorAll(selector).length;
      assert.equal(count('.ig-header'), 1);
      assert.equal(count('[data-ig-command="refresh"]'), 1);
      assert.equal(count('.ig-now'), 1);
      assert.ok(page.zone('rail')?.querySelector('.ig-header') !== null, 'the header is not in the rail');
      // THE MOVE ITSELF, ASSERTED IN BOTH DIRECTIONS. One of these alone would
      // pass while the control was drawn twice.
      assert.ok(
        page.zone('header')?.querySelector('[data-ig-command="refresh"]') !== null,
        'the refresh control did not reach §17a\'s header',
      );
      assert.equal(
        page.zone('rail')?.querySelector('[data-ig-command="refresh"]'),
        null,
        'layer 1 still draws the refresh control the header now owns',
      );
      assert.ok(page.zone('rail')?.querySelector('.ig-now') !== null, 'the NOW row left the rail');

      page.handle.update({ canvas: 'tree' });
      await flush();
      assert.equal(count('.ig-header'), 1, 'the tree canvas drew a second header');
      assert.equal(count('[data-ig-command="refresh"]'), 1, 'the tree canvas drew a second refresh control');
      assert.equal(count('.ig-now'), 1);
      assert.equal(page.zone('canvas')?.querySelector('.ig-header'), null);
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});

/**
 * The first pass, composed.
 *
 * §17e's two rules are the load-bearing tests here, and both are pinned at the
 * MOUNT rather than restated from `firstpass/render.test.ts`: what that file
 * already owns is what the renderer draws from a queue, and what this file owns
 * is everything only the shell can get wrong — whether a drawn candidate
 * reaches the store, and whether anything about the backlog reaches the queue.
 */
describe('the first pass, composed behind §17a’s entry', () => {
  const FIRST_PASS_OPTION = {
    words: FIRST_PASS_WORDS,
    exit: 'leave the first pass',
    scanning: 'looking for candidates',
    scanFailed: 'the scan did not answer',
  };

  /**
   * `count` candidates over the harness backlog's own issues.
   *
   * NOT `testing/firstpass.ts`'s fixture, whose references are `100`/`101` and
   * so on: that file exists to make a POSITION error visible in the reducer
   * tests, and it does that well — but an edge naming an issue the document does
   * not carry is refused by the store as structurally invalid, so a write here
   * would never be dispatched and every settlement assertion would be about a
   * record that never left. Two fresh issues per candidate, so a wrong candidate
   * is still a wrong pair.
   */
  function pairsOver(count: number): readonly Candidate[] {
    return Array.from({ length: count }, (_unused, index) => ({
      id: `c${String(index)}`,
      kind: 'blocked-by' as const,
      from: String(index * 2 + 1),
      to: String(index * 2 + 2),
      evidence: [{ token: 'shared-path', text: `both bodies reference file ${String(index)}` }],
    }));
  }

  /** A backlog of `count` issues, with §17a's first-pass entry published. */
  function backlog(count: number): GraphDocument {
    return {
      issues: Array.from({ length: count }, (_unused, index) => ({
        ref: String(index + 1),
        title: `Issue number ${String(index + 1)}`,
        state: 'open' as const,
        priority: 2,
      })),
      edges: [],
    };
  }

  function entryProject(snapshot: StoreSnapshot): WorkspaceProjection {
    const base = project(snapshot);
    return {
      ...base,
      viewer: { ...base.viewer, host: { identity: 'acme/widgets', firstPass: 'First pass' } },
    };
  }

  /** A source whose answer is held until the test releases it. */
  function heldSource(found: readonly Candidate[]) {
    let release: (() => void) | null = null;
    let refuse: (() => void) | null = null;
    const source = {
      findCandidates: (): Promise<readonly Candidate[]> =>
        new Promise((resolve, reject) => {
          release = (): void => {
            resolve(found);
          };
          refuse = (): void => {
            reject(new Error('the tracker said no'));
          };
        }),
    };
    return {
      // NAMED `scanner`, not `source`: the page harness already carries the
      // store's `ScriptedSource` under that name, and one shadowing the other
      // would silently give a test the wrong one.
      scanner: source,
      answer: async (): Promise<void> => {
        release?.();
        await flush();
        await flush();
      },
      fail: async (): Promise<void> => {
        refuse?.();
        await flush();
        await flush();
      },
    };
  }

  async function firstPassPage(
    found: readonly Candidate[] = pairsOver(3),
    issues = 8,
    options: { derive?: OrderDeriver } = {},
  ) {
    const held = heldSource(found);
    const page = await mounted(backlog(issues), {
      project: entryProject,
      ...options,
      firstPass: { source: held.scanner, ...FIRST_PASS_OPTION },
    });
    return { ...page, ...held };
  }

  const overlayOf = (page: Mounted): HTMLElement | null =>
    page.element.querySelector<HTMLElement>('.ig-firstpass-overlay');

  /** Open the surface and let the scan answer. */
  async function open(page: Awaited<ReturnType<typeof firstPassPage>>): Promise<void> {
    const entry = page.control('first-pass');
    assert.ok(entry !== null, 'no first-pass entry was drawn');
    page.click(entry);
    await flush();
    await page.answer();
  }

  const press = (page: Mounted, key: string): void => {
    page.element.dispatchEvent(
      new page.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  };

  it('draws the entry inert when the host supplies no source', async () => {
    // The button is drawn INSIDE the surface this mount owns, so a host cannot
    // intercept it — the command is withheld here instead.
    const page = await mounted(backlog(4), { project: entryProject });
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null, 'the header entry is the host facts’ to draw');
      page.click(entry);
      await flush();
      assert.equal(overlayOf(page), null, 'a mount with no source opened a surface');
      assert.equal(page.handle.state.firstPass.phase.kind, 'closed');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('draws the scan, then the queue, and leaves on the exit control', async () => {
    const page = await firstPassPage();
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null);
      page.click(entry);
      await flush();
      assert.equal(overlayOf(page)?.getAttribute('data-ig-firstpass'), 'scanning');
      assert.ok(overlayOf(page)?.textContent?.includes(FIRST_PASS_OPTION.scanning));

      await page.answer();
      assert.equal(overlayOf(page)?.getAttribute('data-ig-firstpass'), 'open');
      assert.ok(page.element.querySelector('.ig-firstpass') !== null, 'no queue was drawn');

      const exit = page.control('first-pass-close');
      assert.ok(exit !== null);
      page.click(exit);
      await flush();
      assert.equal(overlayOf(page), null, 'the exit control left the surface up');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('says a failed scan failed, rather than saying the backlog is empty', async () => {
    const page = await firstPassPage();
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null);
      page.click(entry);
      await flush();
      await page.fail();
      assert.equal(overlayOf(page)?.getAttribute('data-ig-firstpass'), 'failed');
      assert.ok(overlayOf(page)?.textContent?.includes(FIRST_PASS_OPTION.scanFailed));
      // "the host found nothing to encode" is a different claim, and a scan that
      // never answered does not license it.
      assert.ok(!(overlayOf(page)?.textContent ?? '').includes(FIRST_PASS_WORDS.noCandidates));
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  describe('§17e: candidates are never auto-applied', () => {
    it('writes nothing for a queue that is only drawn, or only refused', async () => {
      const page = await firstPassPage();
      try {
        await open(page);
        assert.deepEqual(page.store.getSnapshot().writes, [], 'drawing a candidate wrote something');

        // The whole queue, answered without a single consent.
        for (const key of ['n', 's', 'n']) {
          press(page, key);
          await flush();
        }
        assert.deepEqual(page.store.getSnapshot().writes, [], 'refusing wrote something');
        assert.equal(
          page.element.querySelector('.ig-firstpass')?.getAttribute('data-ig-state'),
          'finished',
        );
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });

    it('writes exactly one edge for one consent, and it is the candidate on screen', async () => {
      const page = await firstPassPage();
      try {
        await open(page);
        press(page, 'y');
        await flush();
        const { writes } = page.store.getSnapshot();
        assert.equal(writes.length, 1, 'one keystroke was not one write');
        // The fixture keys each candidate's pair on its index, so answering the
        // wrong one is a visible digit rather than a plausible one.
        assert.deepEqual(writes[0]?.mutation, {
          op: 'create',
          kind: 'blocked-by',
          from: '1',
          to: '2',
          mutationId: writes[0]?.mutationId,
        });
        assert.notEqual(writes[0]?.state, 'invalid', 'the write never left the store');
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });
  });

  describe('§17e: 100% encoded is never the goal', () => {
    it('shows the reader the candidate count, and never the backlog’s', async () => {
      // What only the MOUNT can break: it holds the whole backlog and hands the
      // renderer a QueueState. `firstpass/render.test.ts` owns what the renderer
      // then does with it.
      // Twelve issues, three candidates over the first six of them — so the
      // backlog's size appears nowhere the surface could have drawn it from.
      const page = await firstPassPage(pairsOver(3), 12);
      try {
        await open(page);
        const queue = page.element.querySelector('.ig-firstpass');
        assert.equal(queue?.getAttribute('data-ig-found'), '3');
        const shown = overlayOf(page)?.textContent ?? '';
        assert.ok(!shown.includes('12'), `the backlog size reached the surface: ${shown}`);
        assert.ok(!shown.includes('%'), 'the surface drew a percentage');
        // And the chrome the mount adds around it states no quantity of its own.
        for (const node of overlayOf(page)?.querySelectorAll('[style]') ?? []) {
          assert.fail(`the mount styled ${node.className} inline`);
        }
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });
  });

  describe('the keyboard loop survives its own redraws', () => {
    it('answers more than once — every answer redraws the surface it is on', async () => {
      const page = await firstPassPage();
      try {
        await open(page);
        press(page, 'y');
        await flush();
        press(page, 'n');
        await flush();
        const queue = page.element.querySelector('.ig-firstpass');
        assert.equal(queue?.getAttribute('data-ig-answered'), '2', 'the loop stopped after one key');
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });

    it('undoes on either spelling of the delete key', async () => {
      for (const key of ['Backspace', 'Delete']) {
        const page = await firstPassPage();
        try {
          await open(page);
          press(page, 'n');
          await flush();
          press(page, key);
          await flush();
          assert.equal(
            page.element.querySelector('.ig-firstpass')?.getAttribute('data-ig-answered'),
            '0',
            `${key} did not undo`,
          );
        } finally {
          page.handle.destroy();
          page.dom.window.close();
        }
      }
    });

    it('leaves on Escape, which §17e’s "exit anytime" has no other key for', async () => {
      const page = await firstPassPage();
      try {
        await open(page);
        press(page, 'Escape');
        await flush();
        assert.equal(overlayOf(page), null, 'Escape did not leave the queue');
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });

    it('owns the keyboard while it is up, and gives it back on close', async () => {
      const page = await firstPassPage();
      try {
        // FOCUSED FOR REAL, not merely selected: a synthetic click moves no
        // focus in jsdom, and what the queue has to give back is focus.
        page.rows()[0]?.focus();
        await open(page);
        press(page, 'r');
        await flush();
        assert.equal(page.handle.state.draft.source, null, 'a create draft began under the queue');

        press(page, 'Escape');
        await flush();
        // Focus is back on a real row, so the create map reaches it again.
        assert.ok(
          [...page.element.querySelectorAll('.ig-zone')].some((zone_) =>
            zone_.contains(page.win.document.activeElement),
          ),
          'focus was left outside the workspace',
        );
        press(page, 'r');
        await flush();
        assert.equal(page.handle.state.draft.source, '1', 'the keyboard was not given back');
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });
  });

  describe('an undo takes back only what the store can take back', () => {
    it('leaves an in-flight create alone — the store declines a pending discard', async () => {
      const page = await firstPassPage();
      try {
        await open(page);
        press(page, 'y');
        await flush();
        await page.source.whenPending();
        await flush();
        assert.equal(page.store.getSnapshot().writes.length, 1);

        press(page, 'Backspace');
        await flush();
        assert.equal(
          page.store.getSnapshot().writes.length,
          1,
          'a pending write was reported as discarded',
        );
        assert.equal(
          page.element.querySelector('.ig-firstpass')?.getAttribute('data-ig-answered'),
          '0',
          'the queue did not step back',
        );
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });

    it('leaves a landed create standing — the store has no undo for one', async () => {
      // The decision this pins, and the one §17e does not make: once the write
      // has landed there is no record to discard, and proposing a compensating
      // `delete` would be this package inventing a retraction the store does not
      // have. `⌫` is the queue's position, and says so by leaving the edge.
      const page = await firstPassPage();
      try {
        await open(page);
        press(page, 'y');
        await flush();
        await page.source.whenPending();
        page.source.settleNext('applied');
        await flush();
        const landed = page.store.getSnapshot().landed.length;
        assert.equal(landed, 1, 'the create did not land');
        assert.deepEqual(page.store.getSnapshot().writes, []);

        press(page, 'Backspace');
        await flush();
        assert.equal(page.store.getSnapshot().landed.length, landed, 'the landed edge was retracted');
        assert.deepEqual(page.store.getSnapshot().writes, [], 'the undo proposed a second write');
        assert.equal(
          page.element.querySelector('.ig-firstpass')?.getAttribute('data-ig-answered'),
          '0',
          'the queue did not step back',
        );
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });

    it('discards a create the source refused', async () => {
      const page = await firstPassPage();
      try {
        await open(page);
        press(page, 'y');
        await flush();
        await page.source.whenPending();
        page.source.settleNext({ outcome: 'rejected', reason: 'the issue body is locked' });
        await flush();
        assert.equal(page.store.getSnapshot().writes[0]?.state, 'failed');

        press(page, 'Backspace');
        await flush();
        assert.deepEqual(page.store.getSnapshot().writes, [], 'the failed record survived the undo');
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });
  });

  it('states a refused answer’s reason on a panel, with nothing ever selected', async () => {
    // MECHANISM B, END TO END. The apply route built its own `first-pass-apply`
    // effect and never went through the reducer's emit funnel, so the one thing
    // that funnel does — leave the panel on the issue the write is about —
    // never happened on this route. The queue is entered from the HOST HEADER,
    // so the ordinary reader opens it with nothing selected: a refused `Y` then
    // closed the overlay back onto "nothing is selected", which states no
    // refusal at all, and §17b's rule that a refusal is never silently dropped
    // failed on the one route where the reader was never looking at the
    // relationship in the first place.
    const seeded: GraphDocument = { ...backlog(6), edges: [makeEdge('duplicate-of', '1', '2')] };
    const candidate: Candidate = {
      id: 'dup',
      kind: 'duplicate-of',
      from: '1',
      to: '3',
      evidence: [{ token: 'shared-path', text: 'both bodies reference the same file' }],
    };
    const held = heldSource([candidate]);
    const page = await mounted(seeded, {
      project: entryProject,
      firstPass: { source: held.scanner, ...FIRST_PASS_OPTION },
    });
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null, 'no first-pass entry was drawn');
      page.click(entry);
      await flush();
      await held.answer();
      assert.deepEqual(page.handle.state.selection, { kind: 'none' }, 'the queue opened with a selection');

      press(page, 'y');
      await flush();
      // REFUSED BEFORE ANY WRITE, and by a rule of the FORMAT rather than of
      // the adapter: `duplicate-of` holds one reference (§4.3) and `1` already
      // declares one, so the source is never called and the reader has only the
      // panel to learn it from.
      const records = page.store.getSnapshot().writes;
      const refused = records[0];
      assert.ok(refused !== undefined && refused.state === 'invalid', 'the answer was not refused');
      assert.equal(refused.reason.code, 'cardinality');

      const exit = page.control('first-pass-close');
      assert.ok(exit !== null, 'no exit control');
      page.click(exit);
      await flush();
      assert.equal(overlayOf(page), null, 'the overlay is still up');

      // NOTHING WAS EVER SELECTED: the only two clicks were the header's entry
      // and the overlay's exit, and the answer was a keypress.
      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      assert.equal(inspector.querySelector('.ig-inspector-empty'), null, 'the panel still says nothing is selected');
      const stated = inspector.querySelector<HTMLElement>('[data-ig-code]');
      assert.ok(stated !== null, 'the refused answer is stated nowhere');
      assert.equal(stated.getAttribute('data-ig-code'), 'cardinality');
      assert.equal(
        stated.querySelector('.ig-relationship-reason')?.textContent,
        WORDS.refusals.cardinality,
      );
      // AND THE PANEL IS THE CREATE'S OWN CARRIER — the issue whose block would
      // have declared the relationship the reader consented to.
      assert.deepEqual(page.handle.state.selection, { kind: 'issue', key: '1' });
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('hands focus back to the control the reader came in through', async () => {
    // §17a's entry carries no `data-ig-key`, so a keyboard user who tabbed to it
    // left `focusedKey()` null — and the queue then had nothing to hand focus
    // back to. Focus on the body reaches no listener, because the keydown
    // listener is on the mount's element, so the surface would take no key at
    // all until the reader clicked it.
    const page = await firstPassPage();
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null);
      entry.focus();
      assert.equal(page.win.document.activeElement, entry);
      page.click(entry);
      await flush();
      await page.answer();

      press(page, 'Escape');
      await flush();
      const active = page.win.document.activeElement;
      assert.notEqual(active, page.win.document.body, 'focus was left on the body');
      assert.ok(page.element.contains(active), 'focus was left outside the mount');
      assert.equal(
        active?.getAttribute('data-ig-command'),
        'first-pass',
        'focus did not return to the entry',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('closes itself when the host takes the option away mid-queue', async () => {
    // `update()` may remove the bundle while a queue is up. The overlay stops
    // being drawn either way; what must not survive is the PHASE, which is what
    // hands every key to a queue that is no longer on screen — with no control
    // left to close it.
    const page = await firstPassPage();
    try {
      await open(page);
      assert.equal(page.handle.state.firstPass.phase.kind, 'open');
      page.handle.update({ firstPass: undefined });
      await flush();
      await flush();
      assert.equal(overlayOf(page), null);
      assert.equal(page.handle.state.firstPass.phase.kind, 'closed', 'the phase stayed open');
      // And the workspace takes keys again.
      page.rows()[0]?.focus();
      press(page, 'r');
      await flush();
      assert.equal(page.handle.state.draft.source, '1', 'the workspace stayed keyboard-dead');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('withdraws the write this answer made, not another with the same pair', async () => {
    // Two detectors proposing the same pair is explicitly supported, so the
    // create's own fields do not identify a write. Here an older FAILED record
    // carries the same triple as the live one.
    const twins: readonly Candidate[] = [
      { id: 'left', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
      { id: 'right', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
    ];
    const page = await firstPassPage(twins);
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      page.source.settleNext({ outcome: 'rejected', reason: 'the issue body is locked' });
      await flush();
      const older = page.store.getSnapshot().writes[0]?.mutationId;
      assert.ok(older !== undefined, 'the first answer left no record');

      press(page, 'y');
      await flush();
      await page.source.whenPending();
      await flush();
      assert.equal(page.store.getSnapshot().writes.length, 2);

      // Undo the SECOND answer. The first record must survive it.
      press(page, 'Backspace');
      await flush();
      const left = page.store.getSnapshot().writes.map((write) => write.mutationId);
      assert.ok(left.includes(older), 'the undo discarded the older record instead');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('does not propose the same create twice when a pending undo is re-answered', async () => {
    // `discardMine` declines a pending record, so `⌫` steps the queue back and
    // leaves the write standing. Answering `Y` again must not send it a second
    // time — when the first lands, the second turns `invalid` and shows the
    // reader an error about a relationship that now exists.
    const page = await firstPassPage();
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      await flush();
      assert.equal(page.store.getSnapshot().writes.length, 1);

      press(page, 'Backspace');
      await flush();
      assert.equal(page.store.getSnapshot().writes.length, 1, 'the pending write went away');

      press(page, 'y');
      await flush();
      assert.equal(page.store.getSnapshot().writes.length, 1, 'the create was proposed twice');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('proposes nothing for a relationship the document already carries', async () => {
    // Two findings with different ids may propose the same pair — `candidates.ts`
    // keeps them apart on purpose — and a close-and-reopen starts a fresh queue
    // over a document the earlier answer has since written to. Either way the
    // store would refuse the second create, correctly, and leave the reader an
    // `invalid` record about a relationship that exists.
    const twins: readonly Candidate[] = [
      { id: 'left', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
      { id: 'right', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
    ];
    const page = await firstPassPage(twins);
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      assert.equal(page.store.getSnapshot().landed.length, 1);

      // The second finding proposes the same pair. It must not be sent.
      press(page, 'y');
      await flush();
      assert.deepEqual(
        page.store.getSnapshot().writes,
        [],
        'a duplicate create was proposed for a landed relationship',
      );
      // The queue still advanced: the reader answered, and the answer stands.
      assert.equal(
        page.element.querySelector('.ig-firstpass')?.getAttribute('data-ig-answered'),
        '2',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('lands focus in the order when the entry itself has gone', async () => {
    // Whether a backlog has a first pass to run is the host's answer and the
    // host may change it — the sandbox draws the entry only while its detector
    // finds candidates, so a completed queue whose writes land removes the very
    // control the close would return to. Focus on the body reaches no listener.
    let entryDrawn = true;
    const withEntry = (snapshot: StoreSnapshot): WorkspaceProjection => {
      const base = project(snapshot);
      return {
        ...base,
        viewer: {
          ...base.viewer,
          host: entryDrawn ? { identity: 'acme/widgets', firstPass: 'First pass' } : { identity: 'acme/widgets' },
        },
      };
    };
    const held = heldSource(pairsOver(2));
    const page = await mounted(backlog(8), {
      project: withEntry,
      firstPass: { source: held.scanner, ...FIRST_PASS_OPTION },
    });
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null);
      entry.focus();
      page.click(entry);
      await flush();
      await held.answer();
      assert.ok(page.element.querySelector('.ig-firstpass-overlay') !== null);

      // The host stops offering a first pass while the queue is up.
      entryDrawn = false;
      page.element.dispatchEvent(
        new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      await flush();
      assert.equal(page.control('first-pass'), null, 'the entry survived');
      const active = page.win.document.activeElement;
      assert.notEqual(active, page.win.document.body, 'focus was left on the body');
      assert.ok(page.element.contains(active), 'focus was left outside the mount');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('ends the lifecycle when the host swaps the scanner under it', async () => {
    // The old scan's promise still resolves under the current generation, so
    // without this the queue is drawn in the NEW bundle's words and populated by
    // the superseded scanner — and a `Y` there writes a relationship the
    // configured source never proposed.
    const page = await firstPassPage();
    try {
      await open(page);
      assert.equal(page.handle.state.firstPass.phase.kind, 'open');
      const replacement = heldSource(pairsOver(1));
      page.handle.update({ firstPass: { source: replacement.scanner, ...FIRST_PASS_OPTION } });
      await flush();
      await flush();
      assert.equal(page.handle.state.firstPass.phase.kind, 'closed', 'the old queue survived');
      assert.equal(overlayOf(page), null);
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('cancels a live draft when the queue really opens, by either route', async () => {
    for (const openIt of [
      (page: Awaited<ReturnType<typeof firstPassPage>>): void => {
        const entry = page.control('first-pass');
        assert.ok(entry !== null);
        page.click(entry);
      },
      (page: Awaited<ReturnType<typeof firstPassPage>>): void => {
        page.handle.dispatch({ kind: 'first-pass', command: { kind: 'open' } });
      },
    ]) {
      const page = await firstPassPage();
      try {
        page.click(page.rows()[0] ?? page.element);
        await flush();
        page.handle.dispatch({ kind: 'control', name: 'add' });
        page.handle.dispatch({ kind: 'control', name: 'kind', value: 'blocked-by' });
        page.handle.dispatch({ kind: 'control', name: 'target-query', value: 'issue' });
        await flush();
        assert.equal(page.handle.state.draft.source, '1');

        openIt(page);
        await flush();
        await page.answer();
        // The queue covers the target search and the chooser; a draft left
        // standing is re-entered on close with the reader's context gone.
        assert.equal(page.handle.state.draft.source, null, 'the draft survived the open');
        assert.equal(page.handle.state.targetQuery, '');
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    }
  });

  it('keeps the draft when the open is refused for want of a scanner', async () => {
    // No queue ever appears, so nothing covered the draft and nothing should
    // have taken it — the reader's source, kind, query and drop point are work.
    const page = await mounted(backlog(8), { project: entryProject });
    try {
      page.handle.dispatch({ kind: 'point', key: '1' });
      page.handle.dispatch({ kind: 'control', name: 'add' });
      page.handle.dispatch({ kind: 'control', name: 'kind', value: 'blocked-by' });
      page.handle.dispatch({ kind: 'control', name: 'target-query', value: 'issue' });
      await flush();
      assert.equal(page.handle.state.draft.source, '1');

      page.handle.dispatch({ kind: 'first-pass', command: { kind: 'open' } });
      await flush();
      await flush();
      assert.equal(page.handle.state.firstPass.phase.kind, 'closed');
      assert.equal(page.handle.state.draft.source, '1', 'a refused open took the draft');
      assert.equal(page.handle.state.targetQuery, 'issue');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('refuses a dispatched open when the host supplied no scanner', async () => {
    // `handle.dispatch` is public and reaches the reducer directly, so the DOM
    // guard does not cover it. What must not happen is a non-closed phase with
    // no overlay: invisible, and it blocks the workspace's keyboard with no
    // control to close it.
    const page = await mounted(backlog(8), { project: entryProject });
    try {
      page.handle.dispatch({ kind: 'first-pass', command: { kind: 'open' } });
      await flush();
      await flush();
      assert.equal(page.element.querySelector('.ig-firstpass-overlay'), null);
      assert.equal(page.handle.state.firstPass.phase.kind, 'closed', 'an invisible phase was left up');
      // And the workspace still takes keys.
      page.rows()[0]?.focus();
      page.element.dispatchEvent(
        new page.win.KeyboardEvent('keydown', { key: RELATE_KEY, bubbles: true, cancelable: true }),
      );
      await flush();
      assert.equal(page.handle.state.draft.source, '1', 'the workspace was left keyboard-dead');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('forgets one scanner’s decisions when the host swaps in another', async () => {
    // Two independently written detectors may reuse a CandidateId for entirely
    // different findings, and a question nobody was asked is indistinguishable
    // from one already answered.
    const page = await firstPassPage();
    try {
      await open(page);
      press(page, 'n');
      await flush();
      assert.deepEqual([...page.handle.state.firstPass.decided], ['c0']);

      const replacement = heldSource(pairsOver(1));
      page.handle.update({ firstPass: { source: replacement.scanner, ...FIRST_PASS_OPTION } });
      await flush();
      await flush();
      assert.deepEqual(
        [...page.handle.state.firstPass.decided],
        [],
        'the old scanner’s decisions would filter the new one’s questions',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('sees a landed relationship that also carries a settled write overlay', async () => {
    // A landed edge is not "an edge with no unsettled write": a failed DELETE
    // leaves the relationship there AND leaves a record on it. Inferring one
    // from the other proposed a create for a relationship that still existed.
    const twins: readonly Candidate[] = [
      { id: 'left', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
      { id: 'right', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
    ];
    const page = await firstPassPage(twins);
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      const landed = page.store.getSnapshot().landed[0];
      assert.ok(landed !== undefined, 'the create did not land');

      // A delete of that edge, refused — the edge stays, and now carries a record.
      void page.store.propose({ op: 'delete', edgeId: landed.id });
      await page.source.whenPending();
      page.source.settleNext({ outcome: 'rejected', reason: 'the issue body is locked' });
      await flush();
      assert.equal(page.store.getSnapshot().landed.length, 1, 'the edge went away');
      assert.equal(page.store.getSnapshot().writes.length, 1, 'no overlay was left on it');

      press(page, 'y');
      await flush();
      assert.equal(
        page.store.getSnapshot().writes.length,
        1,
        'a create was proposed for a relationship that is still there',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('opens for a host that updates the source and dispatches in one task', async () => {
    // Renders are coalesced on a microtask. Deciding the swap in the render that
    // OBSERVES it meant a host calling `update()` and then dispatching an open
    // in the same task had its brand-new lifecycle reset by a render still
    // holding the previous scanner — and the new scan's answer then arrived on a
    // closed phase and was dropped, so the queue never opened at all.
    const page = await firstPassPage();
    try {
      const replacement = heldSource(pairsOver(2));
      page.handle.update({ firstPass: { source: replacement.scanner, ...FIRST_PASS_OPTION } });
      page.handle.dispatch({ kind: 'first-pass', command: { kind: 'open' } });
      await flush();
      await replacement.answer();

      assert.equal(page.handle.state.firstPass.phase.kind, 'open', 'the open was reset by a stale render');
      assert.ok(page.element.querySelector('.ig-firstpass') !== null, 'no queue was drawn');
      assert.equal(
        page.element.querySelector('.ig-firstpass')?.getAttribute('data-ig-found'),
        '2',
        'the queue was not the new scanner’s',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('lets a second consent through after the first attempt failed', async () => {
    // apply → undo while pending → that request fails → apply again. Reading
    // "a record exists" as "a write is on its way" suppressed the second
    // proposal, and the queue still marked the candidate decided — so a
    // relationship the reader believed they recorded was silently absent and
    // never asked about again.
    const page = await firstPassPage();
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      await flush();

      press(page, 'Backspace');
      await flush();
      assert.equal(page.store.getSnapshot().writes.length, 1, 'the pending write went away');

      page.source.settleNext({ outcome: 'rejected', reason: 'the issue body is locked' });
      await flush();
      assert.equal(page.store.getSnapshot().writes[0]?.state, 'failed');

      press(page, 'y');
      await flush();
      const pending = page.store
        .getSnapshot()
        .writes.filter((write) => write.state === 'pending');
      assert.equal(pending.length, 1, 'the second consent proposed nothing');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('does not treat a relationship on its way out as one already there', async () => {
    // A pending DELETE leaves its edge in `landed` and marks it `pending-write`.
    // Read as "already there, or a create on its way", that suppressed the
    // reader's consent — and if the delete then landed, their answer had
    // written nothing, shown nothing, and was already decided.
    const twins: readonly Candidate[] = [
      { id: 'left', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
      { id: 'right', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
    ];
    const page = await firstPassPage(twins);
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      const landed = page.store.getSnapshot().landed[0];
      assert.ok(landed !== undefined);

      // A delete of it, left in flight.
      void page.store.propose({ op: 'delete', edgeId: landed.id });
      await page.source.whenPending();
      await flush();
      assert.equal(page.store.getSnapshot().writes.filter((w) => w.state === 'pending').length, 1);

      press(page, 'y');
      await flush();
      const creates = page.store
        .getSnapshot()
        .writes.filter((write) => write.mutation.op === 'create');
      assert.equal(creates.length, 1, 'the consent was suppressed while the edge was being removed');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('sees a pending retype as removing the relationship it replaces', async () => {
    // A retype (and a flip) removes the edge the reader is being asked about
    // just as surely as a delete does — it is simply not a delete. Enumerating
    // the operations here got this wrong; the store's own `nextDocument` does
    // not, and covers whatever operation it grows next.
    const twins: readonly Candidate[] = [
      { id: 'left', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
      { id: 'right', kind: 'blocked-by', from: '1', to: '2', evidence: [] },
    ];
    const page = await firstPassPage(twins);
    try {
      await open(page);
      press(page, 'y');
      await flush();
      await page.source.whenPending();
      page.source.settleNext('applied');
      await flush();
      const landed = page.store.getSnapshot().landed[0];
      assert.ok(landed !== undefined);

      // Retyped to a different kind, left in flight: the blocked-by is going.
      void page.store.propose({ op: 'retype', edgeId: landed.id, nextKind: 'serialize-with' });
      await page.source.whenPending();
      await flush();

      press(page, 'y');
      await flush();
      const creates = page.store
        .getSnapshot()
        .writes.filter((write) => write.mutation.op === 'create');
      assert.equal(creates.length, 1, 'the consent was suppressed by an edge being retyped away');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('keeps Tab inside the takeover, at both ends', async () => {
    // `inert` covers the workspace's own zones and nothing else, so a mount
    // beside other page chrome let Tab walk out of a dialog asserting
    // `aria-modal` — and the keydown listener is on the mount's element, so
    // outside it every key stops working while the overlay is still up.
    const page = await firstPassPage();
    try {
      await open(page);
      const overlay = overlayOf(page);
      assert.ok(overlay !== null);
      const stops = [...overlay.querySelectorAll<HTMLElement>('button')];
      assert.ok(stops.length >= 4, 'the overlay drew too few controls to trap');

      // From the wrapper, Tab lands on the first control.
      press(page, 'Tab');
      assert.equal(page.win.document.activeElement, stops[0]);

      // From the last control, Tab wraps to the first rather than leaving.
      stops[stops.length - 1]?.focus();
      press(page, 'Tab');
      assert.equal(page.win.document.activeElement, stops[0], 'Tab left the dialog');

      // And Shift-Tab from the first wraps to the last.
      stops[0]?.focus();
      page.element.dispatchEvent(
        new page.win.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
      );
      assert.equal(
        page.win.document.activeElement,
        stops[stops.length - 1],
        'Shift-Tab left the dialog',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('treats a scanner that throws before it returns as a failed scan', async () => {
    // A host reading its own state or building a request can throw
    // SYNCHRONOUSLY; called directly that escapes the `.catch` and unwinds
    // through the click handler, leaving the phase `scanning` for good.
    const page = await mounted(backlog(8), {
      project: entryProject,
      firstPass: {
        source: {
          findCandidates: (): Promise<readonly Candidate[]> => {
            throw new Error('the host blew up before it returned');
          },
        },
        ...FIRST_PASS_OPTION,
      },
    });
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null);
      page.click(entry);
      await flush();
      await flush();
      const overlay = page.element.querySelector('.ig-firstpass-overlay');
      assert.equal(overlay?.getAttribute('data-ig-firstpass'), 'failed', 'the scan stuck');
      assert.ok(overlay?.textContent?.includes(FIRST_PASS_OPTION.scanFailed));
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('is a modal over the workspace, and says so', async () => {
    const page = await firstPassPage();
    try {
      await open(page);
      const overlay = overlayOf(page);
      assert.equal(overlay?.getAttribute('role'), 'dialog');
      assert.equal(overlay?.getAttribute('aria-modal'), 'true');
      // NAMED ON THE DIALOG ITSELF. The label the package puts on its own
      // `<section>` names that landmark and says nothing about its ancestor, so
      // without this assistive technology meets an unnamed modal.
      assert.equal(overlay?.getAttribute('aria-label'), FIRST_PASS_WORDS.label);
      // Focus does not move onto a control, so the swapped question needs a live
      // region or a screen reader hears nothing after the first answer.
      assert.equal(overlay?.getAttribute('aria-live'), 'polite');
      const zones = [...page.element.querySelectorAll('.ig-zone')];
      assert.ok(zones.length > 0);
      assert.ok(
        zones.every((covered) => covered.hasAttribute('inert')),
        'a zone stayed reachable under the overlay',
      );

      press(page, 'Escape');
      await flush();
      assert.ok(
        [...page.element.querySelectorAll('.ig-zone')].every((covered) => !covered.hasAttribute('inert')),
        'a zone stayed inert after the overlay came down',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});
