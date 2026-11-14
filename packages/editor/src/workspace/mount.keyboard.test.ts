/**
 * The mount, driven through a real DOM: keyboard activation, the isolated list,
 * the outward link and the narrow layouts.
 *
 * Split from `mount.test.ts`, whose header says why jsdom and why every test
 * goes through the public entry point. The editor suite gives each file 20 s
 * (`--test-timeout=20000` under the glob runner), and one file holding every
 * mount test had grown to that line on node 22 (#297).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { StoreSnapshot } from '@issuegraph/store';

import { KIND_KEYS } from '../create/keys.ts';
import type { WorkspaceProjection } from './mount.ts';
import { WORDS, SEED, project, flush, mounted, type Mounted } from '../testing/mount.ts';

/**
 * `#158` — activating a control with the keyboard, and the loop that proves it.
 *
 * ## Why this needed its own coverage at all
 *
 * §17b fixes the create loop as `R → 1–5 → search → ⏎` and says what it is for
 * in four words: "full loop, no pointer". Every one of those key steps was
 * already implemented and already tested. What was not implemented was the step
 * BETWEEN them — pressing a control. It worked anyway, because a browser
 * activates a focused `<button>` natively and `onClick` sees the click, so the
 * package advertised a keyboard loop while implementing none of its activation
 * and leaving the guarantee to whatever elements a host chose to render.
 *
 * That gap was invisible from both sides. jsdom synthesizes no native
 * activation, so nothing here could drive the step; and the harness `click`
 * helper CONSTRUCTS a `MouseEvent`, so "no pointer event was used" asserted over
 * it would have passed while proving nothing.
 *
 * ## So the last test removes the ability rather than asserting about it
 *
 * `win.MouseEvent`, `win.PointerEvent` and `HTMLElement.prototype.click` are all
 * replaced with stand-ins that throw, and the assertion is that the scenario
 * FINISHES. A count of pointer events is a number someone has to remember to
 * update; a constructor that throws needs no maintenance and cannot be passed by
 * a test that quietly stops exercising the path.
 *
 * Be exact about the bound, as the command-control suite in
 * `mount.writes.test.ts` is: poisoning those
 * three closes every activation route this suite can take — the harness helper,
 * a hand-rolled `new win.MouseEvent`, and `node.click()`. It does not reach
 * events jsdom builds internally by other routes, and it is not a proof that no
 * `MouseEvent` exists anywhere in the process. The claim is "no pointer
 * activation route this suite can take", which is the claim that was wanted.
 */
describe('a control activates from the keyboard', () => {
  /**
   * One press at the focused element.
   *
   * `cancelable: true` IS LOAD-BEARING and is why this helper exists rather than
   * copying the nearest neighbour: `defaultPrevented` is unconditionally `false`
   * on a non-cancelable event, and several dispatches elsewhere in this file
   * omit the flag — so a test copied from one of those would assert `false`
   * whatever the mount did.
   *
   * `.focus()` FIRST, for the same class of reason. The arm reads
   * `document.activeElement`, as `interaction()` and `navigateFocus` already do,
   * so a press dispatched at an unfocused node exercises a different ordering
   * than the one the design reasons about.
   */
  const press = (
    page: Mounted,
    node: HTMLElement,
    key: string,
    press_: {
      readonly ctrlKey?: boolean;
      readonly metaKey?: boolean;
      readonly altKey?: boolean;
      readonly isComposing?: boolean;
      readonly repeat?: boolean;
    } = {},
  ): KeyboardEvent => {
    node.focus();
    const event = new page.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...press_ });
    node.dispatchEvent(event);
    return event;
  };

  /**
   * Whatever holds focus, narrowed without a cast.
   *
   * `instanceof` against THIS page's own `HTMLElement`, which is safe here for
   * the reason `mount.ts` avoids it in the product: a test has exactly one
   * window and knows which, while the mount may be handed a node from another.
   */
  const focused = (page: Mounted): HTMLElement => {
    const active = page.win.document.activeElement;
    if (!(active instanceof page.win.HTMLElement)) throw new Error('nothing focusable holds focus');
    return active;
  };

  /** Select an issue with the keyboard alone — the rail's roving tab stop, then `⏎`. */
  const selectFirstIssue = async (page: Mounted): Promise<void> => {
    const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '1');
    assert.ok(row !== undefined, 'no rail row for 1');
    press(page, row, 'Enter');
    await flush();
  };

  /** The host facts that draw §17a's `First pass →`, with no bundle to run it. */
  const withEntry = (snapshot: StoreSnapshot): WorkspaceProjection => {
    const base = project(snapshot);
    return { ...base, viewer: { ...base.viewer, host: { identity: 'acme/widgets', firstPass: 'First pass' } } };
  };

  it('opens the kind chooser on Enter, and cancels the press', async () => {
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control to activate');

      const event = press(page, add, 'Enter');
      await flush();

      assert.ok(
        page.element.querySelector('[data-ig-command="kind"]') !== null,
        'Enter on the add control opened no kind chooser',
      );
      // CANCELLING IS THE HALF THAT MAKES THIS SAFE IN A BROWSER, not a detail.
      // A `<button>`'s activation behaviour is this keydown's default action, so
      // an arm that dispatched without cancelling would fire once here and once
      // more from the native click the browser then synthesizes.
      assert.equal(event.defaultPrevented, true, 'the activation left the native click to fire as well');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('opens the kind chooser on Space, and cancels the press', async () => {
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control to activate');

      const event = press(page, add, ' ');
      await flush();

      assert.ok(
        page.element.querySelector('[data-ig-command="kind"]') !== null,
        'Space on the add control opened no kind chooser',
      );
      // AND THE PAGE DOES NOT ALSO SCROLL. Space's other default action.
      assert.equal(event.defaultPrevented, true, 'Space activated the control and scrolled the page too');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('hands a press inside a command-bearing input straight back', async () => {
    // THE REGRESSION THIS ARM WOULD OTHERWISE SHIP. Both search boxes are
    // `<input>` elements carrying `data-ig-command`, and `onClick` declines them
    // because the `input` listener owns them. Treat that refusal as "the package
    // answered" and the arm cancels the press — so a space typed into the target
    // query never reaches the box, and step three of `R → digit → search → ⏎`
    // cannot be typed. The refusal has to travel with its REASON for the arm to
    // tell this case from the inert one below.
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      press(page, add, 'Enter');
      await flush();

      const chosen = KIND_KEYS[0];
      assert.ok(chosen !== undefined, 'the vocabulary has no first kind');
      const landed = page.win.document.activeElement;
      assert.ok(landed !== null);
      landed.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: chosen.key, bubbles: true }));
      await flush();

      const search = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(search !== null, 'the draft never reached its target step');

      const space = press(page, search, ' ');
      assert.equal(space.defaultPrevented, false, 'the arm swallowed a space typed into the target query');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('holds the press on a control that refuses because it is inert', async () => {
    // THE OTHER REFUSAL, AND THE OPPOSITE ANSWER. `First pass →` is drawn whether
    // or not a host supplied the bundle it needs, and the mount withholds it
    // rather than moving the reducer to a state with no way back. That press is
    // kept — `Space` would otherwise scroll the page under a reader who has just
    // pressed something, and this package has answered — which is why one
    // boolean cannot serve both refusals.
    const page = await mounted(SEED, { project: withEntry });
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null, 'no first-pass entry drawn');

      const event = press(page, entry, 'Enter');
      await flush();

      assert.equal(event.defaultPrevented, true, 'the inert entry handed its press to the platform');
      assert.equal(
        page.element.querySelector('.ig-firstpass-overlay'),
        null,
        'the inert entry opened the queue anyway',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('leaves a rail row to the viewer’s own navigation', async () => {
    // WHAT THIS PINS, said exactly: a rail row is NOT a control, so the arm
    // answers `null` for it and the viewer's own `Enter` still selects. It is
    // NOT an ordering test — moving the arm earlier would pass this too, because
    // the arm has nothing to say about a keyed row either way. The ordering is
    // load-bearing only if a control is ever drawn INSIDE a keyed element, which
    // nothing does today and nothing here can pin.
    const page = await mounted();
    try {
      const row = page.rows().find((each) => each.getAttribute('data-ig-key') === '2');
      assert.ok(row !== undefined, 'no rail row for 2');

      press(page, row, 'Enter');
      await flush();

      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      assert.ok(inspector.textContent?.includes('Write the release notes') === true, 'Enter selected no issue');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  // EACH MODIFIER ITS OWN ROW. One `ctrlKey` case leaves `metaKey ||` and
  // `altKey ||` free to be dropped with nothing failing, and on macOS those are
  // the realistic chords — `⌘Enter` and `⌥Space` — so the untested two are the
  // ones a reader would actually press.
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
    it(`leaves a ${modifier} press to the platform`, async () => {
      const page = await mounted();
      try {
        await selectFirstIssue(page);
        const add = page.control('add');
        assert.ok(add !== null, 'no add control');

        const event = press(page, add, 'Enter', { [modifier]: true });
        await flush();

        assert.equal(
          page.element.querySelector('[data-ig-command="kind"]'),
          null,
          `${modifier}+Enter began a draft — the platform’s chord was claimed`,
        );
        assert.equal(event.defaultPrevented, false, `${modifier}+Enter was cancelled`);
      } finally {
        page.handle.destroy();
        page.dom.window.close();
      }
    });
  }

  it('leaves an input method its own Enter', async () => {
    // `Enter` MID-COMPOSITION CONFIRMS A CANDIDATE, and belongs to the input
    // method. Anyone entering CJK text hits this on the ordinary path, which is
    // why `create/keys.ts` refuses it for its own bindings and why the arm does
    // too — untested, it was a line anyone could delete as redundant.
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');

      const event = press(page, add, 'Enter', { isComposing: true });
      await flush();

      assert.equal(page.element.querySelector('[data-ig-command="kind"]'), null, 'a composing Enter was claimed');
      assert.equal(event.defaultPrevented, false, 'a composing Enter was cancelled');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('makes a held key one act, and cancels the repeat rather than handing it back', async () => {
    // THE TOGGLE IS THE FIXTURE, because it is the one control that survives its
    // own activation as the SAME element with the other command — so a repeat
    // can be aimed at it, and a second dispatch is VISIBLE as the chip closing
    // again. An earlier draft of this test aimed the repeat at "whatever holds
    // focus after pressing add", which turned out to be a rail row; the press
    // was then `navigateFocus`'s and the test passed with the repeat rule
    // inverted. A document with no edges, because the chip is drawn only when
    // something is isolated.
    const page = await mounted({ issues: SEED.issues, edges: [] });
    try {
      const chip = page.control('open-isolated');
      assert.ok(chip !== null, 'no isolated chip was drawn — the test would prove nothing');

      press(page, chip, ' ');
      await flush();
      const opened = page.control('close-isolated');
      assert.ok(opened !== null, 'the first press did not open the isolated list');

      const held = press(page, opened, ' ', { repeat: true });
      await flush();

      // ONE ACT. A repeat that dispatched would flip the toggle straight back,
      // so the reader holding the key would watch the list they just opened
      // close under them.
      assert.ok(page.control('close-isolated') !== null, 'the repeat dispatched a second act and closed the list');
      // AND CANCELLED, which is the half jsdom cannot show the consequence of.
      // `Space` activates a `<button>` on KEYUP, so a repeat handed back lets the
      // platform mark the button active and the keyup then synthesizes a click —
      // performing the act a second time through `onClick` instead. There is no
      // native activation here to observe, so `defaultPrevented` stands in for
      // it, which is why it is asserted rather than assumed.
      assert.equal(held.defaultPrevented, true, 'the repeat was handed back — a native keyup would act again');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('keeps a held key with the control it activated, even after focus moves', async () => {
    // REVIEW FINDING ON THIS CHANGE, and the half the in-arm repeat guard cannot
    // reach. ACTIVATING A CONTROL OFTEN MOVES FOCUS — pressing a kind option
    // redraws and focuses `target-query` — so the repeats of that same held
    // press arrive at the INPUT. There the arm asks "is what holds focus a
    // control?", answers "an input, hand it back", and the platform types a
    // space into a query the reader never started. Held long enough, the target
    // search fills with spaces from a press that was aimed at a button.
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      press(page, add, 'Enter');
      await flush();

      const chosen = KIND_KEYS[0];
      assert.ok(chosen !== undefined, 'the vocabulary has no first kind');
      const option = page.element.querySelector<HTMLElement>(`[data-ig-command="kind"][data-ig-value="${chosen.edgeKind}"]`);
      assert.ok(option !== null, 'the chooser drew no option to press');

      press(page, option, ' ');
      await flush();

      // FOCUS HAS MOVED, and the test says so rather than assuming it — the
      // whole finding rests on this step happening.
      const now = focused(page);
      assert.equal(now.getAttribute('data-ig-command'), 'target-query', 'activating the kind did not move focus');

      const held = new page.win.KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true, cancelable: true });
      now.dispatchEvent(held);
      await flush();

      assert.equal(held.defaultPrevented, true, 'a repeat of the held key typed a space into the target query');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('keeps the held key across an unrelated press, like Shift', async () => {
    // REVIEW FINDING ON THIS CHANGE. The record was cleared by ANY fresh
    // non-repeat press, so a reader holding `Space` on a control and touching
    // `Shift` — or anything else — dropped it, and the next `Space` repeat
    // landed wherever the activation had since sent focus. That is the inserted
    // spaces the record exists to prevent, one keystroke away from every use.
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      press(page, add, 'Enter');
      await flush();

      const chosen = KIND_KEYS[0];
      assert.ok(chosen !== undefined, 'the vocabulary has no first kind');
      const option = page.element.querySelector<HTMLElement>(
        `[data-ig-command="kind"][data-ig-value="${chosen.edgeKind}"]`,
      );
      assert.ok(option !== null, 'the chooser drew no option to press');
      press(page, option, ' ');
      await flush();

      const search = focused(page);
      assert.equal(search.getAttribute('data-ig-command'), 'target-query', 'activating the kind did not move focus');

      // STILL HOLDING SPACE, and now something else is pressed.
      search.dispatchEvent(new page.win.KeyboardEvent('keydown', { key: 'Shift', bubbles: true, cancelable: true }));

      const held = new page.win.KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true, cancelable: true });
      search.dispatchEvent(held);
      await flush();

      assert.equal(held.defaultPrevented, true, 'an unrelated press forgot the still-held activation');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('keeps every held key’s record, not just the latest one', async () => {
    // REVIEW FINDING ON THIS CHANGE. Two keys can be down at once — hold `Space`
    // on one control and press `Enter` on another — and a scalar record answered
    // that by forgetting the first, so the `Space` repeats stopped being
    // recognised as its own and went wherever focus had since moved. The set is
    // what stops the case existing rather than guarding against it.
    // THE REPEAT HAS TO LAND SOMEWHERE THE TWO ANSWERS DIFFER, which is why this
    // drives the loop to the target input rather than pressing two chrome
    // buttons: on a control, a lost record is invisible — the repeat simply
    // reaches the arm and is cancelled again for its own reasons. On the INPUT
    // the arm hands the press back, so a forgotten record shows up as the
    // reader's search box taking a character from a key they are holding on a
    // button. An earlier draft of this test pressed two chrome buttons and
    // passed with the set replaced by a scalar.
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');

      // ENTER GOES DOWN FIRST, and stays down for the rest of the test.
      press(page, add, 'Enter');
      await flush();

      // SPACE ACTIVATES A SECOND CONTROL while Enter is still held, and this one
      // moves focus into the target search.
      const chosen = KIND_KEYS[0];
      assert.ok(chosen !== undefined, 'the vocabulary has no first kind');
      const option = page.element.querySelector<HTMLElement>(
        `[data-ig-command="kind"][data-ig-value="${chosen.edgeKind}"]`,
      );
      assert.ok(option !== null, 'the chooser drew no option to press');
      press(page, option, ' ');
      await flush();

      const search = focused(page);
      assert.equal(search.getAttribute('data-ig-command'), 'target-query', 'activating the kind did not move focus');

      // NOW ENTER REPEATS, at the input. It is still this package's press.
      const held = new page.win.KeyboardEvent('keydown', {
        key: 'Enter',
        repeat: true,
        bubbles: true,
        cancelable: true,
      });
      search.dispatchEvent(held);
      await flush();

      assert.equal(held.defaultPrevented, true, 'a second activation overwrote the first still-held key’s record');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('releases the held key on keyup, so a later repeat is the reader’s own', async () => {
    // THE OTHER SIDE OF THE SAME FLAG, isolated to `keyup` alone. Remembering
    // the press must not outlive it, or the reader who let go and then held
    // `Space` inside the search box they were sent to would find it swallowed by
    // a press that ended.
    //
    // A REPEAT is what discriminates: `onKeydown` clears the flag on any fresh
    // NON-repeat press, so a test driving one of those would pass with the
    // `keyup` listener deleted.
    const page = await mounted();
    try {
      await selectFirstIssue(page);
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      press(page, add, 'Enter');
      await flush();

      const chosen = KIND_KEYS[0];
      assert.ok(chosen !== undefined, 'the vocabulary has no first kind');
      const option = page.element.querySelector<HTMLElement>(`[data-ig-command="kind"][data-ig-value="${chosen.edgeKind}"]`);
      assert.ok(option !== null, 'the chooser drew no option to press');
      press(page, option, ' ');
      await flush();

      const search = focused(page);
      assert.equal(search.getAttribute('data-ig-command'), 'target-query', 'activating the kind did not move focus');

      // LET GO.
      search.dispatchEvent(new page.win.KeyboardEvent('keyup', { key: ' ', bubbles: true }));

      const held = new page.win.KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true, cancelable: true });
      search.dispatchEvent(held);
      await flush();

      // NOW IT IS THE READER TYPING, and the input owns it again.
      assert.equal(held.defaultPrevented, false, 'a repeat after keyup was still held by the finished press');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('leaves a host’s own command its native activation', async () => {
    // REVIEW FINDING ON THIS CHANGE, and the one that made the arm a regression
    // rather than only an addition. `data-ig-command` is a SHARED NAMESPACE:
    // `reduceHost`'s default arm says a host's chrome publishes on it too, and
    // layer 1 already does — `refresh`, `retry:index`, `review-pick-order`,
    // `dismiss:adoption` are drawn inside this surface and answered by the
    // host's own `click` listener. Cancelling their keydown suppresses the
    // native click that listener waits for, so every one of them would stop
    // answering the keyboard while looking untouched from in here.
    //
    // A COMMAND NO ARM KNOWS is the general case, driven directly rather than
    // through one of those four: what the arm must key on is the REDUCER's
    // answer, not a list of names it would have to keep in step with layer 1.
    const page = await mounted();
    try {
      const host = page.win.document.createElement('button');
      host.setAttribute('data-ig-command', 'a-command-this-reducer-has-no-arm-for');
      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      inspector.append(host);

      const event = press(page, host, 'Enter');
      await flush();

      // NOT CANCELLED, so the browser still activates the button and the host's
      // click listener still hears it. This is the whole assertion: everything
      // else about that control is the host's business, not this package's.
      assert.equal(
        event.defaultPrevented,
        false,
        'the arm cancelled a host-owned command and took its control off the keyboard',
      );
      // AND NOT REDRAWN, which is the same defect by a different route and was
      // the second finding on it. A redraw replaces `surface.innerHTML`, and
      // `Space` activates a `<button>` on KEYUP — so destroying the held button
      // before then loses the activation exactly as cancelling would. The node
      // still being in the document is what says no redraw ran.
      assert.ok(host.isConnected, 'a redraw replaced the host’s button before its activation could land');
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('stops a refused press before the identity branches, on the click path too', async () => {
    // THE EXTRACTION'S CENTRAL CLAIM, pinned. `controlAnswer` answers `refused`
    // rather than `null` so that `onClick` STOPS — fall through and a press on a
    // control the mount declined reaches the `data-ig-group` / `data-ig-key`
    // branch and selects whatever sits under it, an act the reader never asked
    // for.
    //
    // NO CONTROL IS DRAWN INSIDE A KEYED ELEMENT TODAY, which is why this
    // configuration is BUILT here rather than found. That is the point: the
    // guard exists against a future renderer nesting one, and a test that waited
    // for that renderer would arrive after the regression it was meant to catch.
    const page = await mounted(SEED, { project: withEntry });
    try {
      const entry = page.control('first-pass');
      assert.ok(entry !== null, 'no first-pass entry drawn');
      const parent = entry.parentElement;
      assert.ok(parent !== null, 'the entry has no parent to key');
      parent.setAttribute('data-ig-key', '4');

      page.click(entry);
      await flush();

      const inspector = page.zone('inspector');
      assert.ok(inspector !== null);
      assert.equal(
        inspector.textContent?.includes('Rename the config flag') ?? false,
        false,
        'a refused press fell through and selected the element underneath it',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  it('runs the whole create loop with no pointer activation route available', async () => {
    const page = await mounted();
    const { win } = page;
    const realMouse = win.MouseEvent;
    const realPointer = win.PointerEvent;
    const realClick = win.HTMLElement.prototype.click;
    const poisoned = (what: string) =>
      function (this: unknown): never {
        throw new Error(`${what} was used — this scenario is meant to be pointer-free`);
      };
    const put = (host: object, name: string, value: unknown): void => {
      Object.defineProperty(host, name, { value, configurable: true, writable: true });
    };
    try {
      // POISONED AFTER THE MOUNT, so the mount's own setup is unaffected and only
      // the scenario is bound by it.
      //
      // `defineProperty` RATHER THAN AN ASSIGNMENT, and then CHECKED. A plain set
      // answers `false` on a property that is not writable instead of throwing,
      // so a jsdom that ever made these non-configurable would leave the scenario
      // running against the real constructors while every assertion still passed
      // — the same silently-stops-proving-anything failure this test replaces.
      put(win, 'MouseEvent', poisoned('MouseEvent'));
      put(win, 'PointerEvent', poisoned('PointerEvent'));
      put(win.HTMLElement.prototype, 'click', poisoned('HTMLElement.click()'));
      assert.throws(() => new win.MouseEvent('click'), /pointer-free/, 'MouseEvent was not poisoned');
      assert.throws(() => new win.PointerEvent('pointerdown'), /pointer-free/, 'PointerEvent was not poisoned');
      assert.throws(() => win.document.body.click(), /pointer-free/, 'HTMLElement.click was not poisoned');

      // 1. THE SUBJECT, chosen with the rail's roving tab stop and `⏎`.
      await selectFirstIssue(page);

      // 2. `add`, THE STEP THIS ISSUE ADDED. Deliberately not `r` on the rail
      //    row: `r` resolves through `keyIntent`'s own `relate` binding, so that
      //    variant would stay green with the keydown arm deleted — the same
      //    vacuity this test exists to retire, wearing a different shape.
      const add = page.control('add');
      assert.ok(add !== null, 'no add control');
      press(page, add, 'Enter');
      await flush();

      // 3. THE KIND, by its digit — read from `KIND_KEYS` so a sixth edge field
      //    cannot silently falsify the pairing.
      const chosen = KIND_KEYS[0];
      assert.ok(chosen !== undefined, 'the vocabulary has no first kind');
      const landed = page.win.document.activeElement;
      assert.ok(landed !== null, 'the chooser left nothing focused');
      landed.dispatchEvent(new win.KeyboardEvent('keydown', { key: chosen.key, bubbles: true, cancelable: true }));
      await flush();

      // 4. THE TARGET, typed and committed.
      const search = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(search !== null, 'the draft never reached its target step');
      search.focus();
      search.value = '3';
      search.dispatchEvent(new win.Event('input', { bubbles: true }));
      await flush();
      // RE-QUERIED, because the redraw the query causes replaces the box. The
      // stale node is detached, so a press dispatched at it bubbles to nothing
      // and the commit silently never happens.
      const typed = page.element.querySelector<HTMLInputElement>('input[data-ig-command="target-query"]');
      assert.ok(typed !== null, 'the target search went away as the query landed');
      typed.focus();
      typed.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await flush();

      const proposed = page.store.getSnapshot().writes.map((write) => write.mutation);
      assert.equal(proposed.length, 1, `the loop proposed ${String(proposed.length)} edits, not one`);
      assert.equal(proposed[0]?.op, 'create');
    } finally {
      put(win, 'MouseEvent', realMouse);
      put(win, 'PointerEvent', realPointer);
      put(win.HTMLElement.prototype, 'click', realClick);
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});

describe('opening the isolated list reveals it', () => {
  /**
   * §17a PUTS THE CONTROL AND THE LIST IN DIFFERENT ZONES, which is the whole
   * reason this behaviour exists. The count and its toggle are at the foot of
   * the ORDER RAIL; the list the ladder draws is in the CANVAS, because the
   * rail is virtualized on a fixed row pitch and an arbitrary-height list in
   * that scroll track makes every offset beneath it name the wrong row.
   *
   * So the press flips a control in one zone and grows a list in another, below
   * whatever that zone was already scrolled to. Without the reveal the reader
   * is told the list is open and sees nothing move.
   */
  const RAIL_WORDS = { isolated: 'carrying no edges', show: 'reveal', hide: 'fold away' };

  it('scrolls the opened list into view, and only on the press that opens it', async () => {
    const page = await mounted(SEED, { words: { ...WORDS, rail: RAIL_WORDS } });
    try {
      const revealed: string[] = [];
      // jsdom implements no scrolling at all, so `scrollIntoView` is absent —
      // which is also the case the mount guards for. Installing it here is what
      // makes the call observable rather than a no-op.
      page.win.Element.prototype.scrollIntoView = function scrollIntoView(this: Element): void {
        revealed.push(this.className);
      };

      const toggle = page.element.querySelector<HTMLElement>('[data-ig-command="open-isolated"]');
      assert.ok(toggle !== null, 'no isolated toggle in the rail footer');
      toggle.click();
      await flush();

      assert.ok(
        revealed.some((name) => name.includes('ig-isolated-list')),
        `the opened list was never revealed — scrolled: ${JSON.stringify(revealed)}`,
      );
      assert.ok(
        page.element.querySelector('.ig-isolated-list') !== null,
        'the list did not open at all',
      );

      // AND NOT AGAIN ON AN UNRELATED REDRAW. The flag is set by the command,
      // not read off `scale.isolatedOpen` — which stays true — so a later
      // render must not yank the canvas back under a reader who scrolled away.
      revealed.length = 0;
      const row = page.rows()[0];
      assert.ok(row !== undefined, 'no rail row to select');
      page.click(row);
      await flush();

      assert.deepEqual(
        revealed.filter((name) => name.includes('ig-isolated-list')),
        [],
        'an unrelated redraw revealed the list again',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });

  /**
   * THE ID IS PER MOUNT, WHICH IS THE POINT OF MINTING IT HERE. `renderWorkspace`
   * is pure and cannot know what else is on the host's page; `mountWorkspace`
   * can, because it is the thing being called twice. Two mounted workspaces must
   * not name one element — `scale/render.ts`'s `searchSpec` records what a
   * duplicated id costs, and an earlier revision of this work shipped one.
   */
  it('gives two mounted workspaces different ids for their lists', async () => {
    const first = await mounted(SEED, { words: { ...WORDS, rail: RAIL_WORDS } });
    const second = await mounted(SEED, { words: { ...WORDS, rail: RAIL_WORDS } });
    try {
      const openIn = async (page: Awaited<ReturnType<typeof mounted>>): Promise<string> => {
        const toggle = page.element.querySelector<HTMLElement>('[data-ig-command="open-isolated"]');
        assert.ok(toggle !== null, 'no isolated toggle');
        toggle.click();
        await flush();
        const list = page.element.querySelector('.ig-isolated-list');
        assert.ok(list !== null, 'no list after opening');
        const id = list.getAttribute('id');
        assert.ok(id !== null && id !== '', 'the list carries no id');
        const control = page.element.querySelector('[data-ig-command="close-isolated"]');
        assert.equal(control?.getAttribute('aria-controls'), id, 'the toggle names another element');
        return id;
      };

      assert.notEqual(await openIn(first), await openIn(second), 'both mounts named one element');
    } finally {
      first.handle.destroy();
      first.dom.window.close();
      second.handle.destroy();
      second.dom.window.close();
    }
  });

  /**
   * THE TREE REPLACES THE CANVAS ZONE'S `innerHTML`, and the list is drawn in
   * that zone. The control is not — §17a puts it at the foot of the rail — so
   * without preserving the block the reader gets a toggle that flips to "hide"
   * and `aria-expanded="true"` over nothing at all.
   *
   * That is worse than what it replaced: before the control moved, the chip sat
   * in this zone beside its list and the tree deleted both, so the affordance
   * was absent rather than lying.
   */
  it('keeps the list in tree mode, where the canvas markup is replaced', async () => {
    const page = await mounted(SEED, { words: { ...WORDS, rail: RAIL_WORDS }, canvas: 'tree' });
    try {
      const toggle = page.element.querySelector<HTMLElement>('[data-ig-command="open-isolated"]');
      assert.ok(toggle !== null, 'no isolated toggle in the rail footer');
      toggle.click();
      await flush();

      const opened = page.element.querySelector<HTMLElement>('[data-ig-command="close-isolated"]');
      assert.ok(opened !== null, 'the control did not flip to its open state');
      assert.equal(opened.getAttribute('aria-expanded'), 'true');
      // THE ASSERTION THIS TEST EXISTS FOR: the control says open, so something
      // has to be open.
      assert.ok(
        page.element.querySelector('.ig-isolated-list') !== null,
        'the control reports an open list the tree canvas deleted',
      );
      assert.ok(
        page.zone('canvas')?.querySelector('.ig-isolated-list') != null,
        'the list survived but not in the canvas zone',
      );
    } finally {
      page.handle.destroy();
      page.dom.window.close();
    }
  });
});

describe('§17d’s outward link is the browser’s to follow, not the mount’s', () => {
  /**
   * A projection reporting one encoding refusal on a seed issue.
   *
   * A REFUSAL IS THE ONLY WAY TO DRAW THE BLOCK. It is a fact about a raw body
   * the package never sees, so no document shape produces one — the host states
   * it, and this is that host.
   */
  function withRefusal(snapshot: StoreSnapshot): WorkspaceProjection {
    return {
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [], duplicateCanonical: () => null },
        encodingRefused: [
          { ref: '1', diagnostic: 'unparseable YAML at line 3', sourceLine: 'blocked-by: [231, 234' },
        ],
      },
    };
  }

  it('does not redraw the surface under the reader’s own click', async () => {
    // THE ANCHOR CARRIES A `data-ig-command` ONLY SO `a11y/baseline.ts` CAN SEE
    // IT — that artifact records a control through the attribute channels it
    // knows, and an anchor bearing nothing but `href` is invisible to it. But
    // the command channel is also how a press becomes a dispatch, and nothing
    // reduces this name: the command would come back unclaimed while the mount
    // scheduled a redraw anyway, replacing the surface's markup and detaching
    // the anchor mid-activation. An `<a>` is exempt from the "cannot navigate"
    // connectedness check, so the navigation would still happen and the cost
    // would have been invisible — a full re-render per click, for nothing.
    const page = await mounted(SEED, {
      project: withRefusal,
      issueUrl: (ref) => `https://example.invalid/${ref}`,
    });
    try {
      await page.openAudit();
      const link = page.element.querySelector<HTMLElement>('.ig-audit-refused-open');
      assert.ok(link !== null, 'the fixture drew no outward link, so this proves nothing');
      assert.equal(link.getAttribute('data-ig-command'), 'open-issue-url');

      // IDENTITY, NOT MARKUP. A redraw replaces the surface's nodes, so the
      // question "did the mount redraw" is exactly "is this the same node".
      const before = page.element.querySelector('.ig-audit-refused-open');
      page.click(link);
      await flush();
      assert.equal(
        page.element.querySelector('.ig-audit-refused-open'),
        before,
        'clicking the link redrew the surface, detaching the anchor mid-activation',
      );

      // AND THE FIXTURE CAN ACTUALLY OBSERVE A REDRAW, or the assertion above
      // passes for a mount that never redraws at all.
      page.handle.update();
      await flush();
      assert.notEqual(
        page.element.querySelector('.ig-audit-refused-open'),
        before,
        'the fixture cannot see a redraw, so the assertion above proves nothing',
      );
    } finally {
      page.handle.destroy();
    }
  });

  it('leaves Enter to the browser, so the link is not pointer-only', async () => {
    // AN ANCHOR'S `Enter` ACTIVATION IS A DEFAULT ACTION. The click path refuses
    // to DISPATCH this control — nothing reduces the name, and a redraw would
    // detach the anchor mid-activation — but the keydown path must not answer
    // the same way: cancelling the press means no click is ever synthesized and
    // the link works for a pointer and not for a keyboard.
    //
    // `input` AND `inert` REFUSALS STILL KEEP THE PRESS, and the difference is
    // the point: those say "this press does nothing and nothing else wants it",
    // while `navigation` says something else is waiting for exactly this key.
    const page = await mounted(SEED, {
      project: withRefusal,
      issueUrl: (ref) => `https://example.invalid/${ref}`,
    });
    try {
      await page.openAudit();
      const link = page.element.querySelector<HTMLElement>('.ig-audit-refused-open');
      assert.ok(link !== null, 'the fixture drew no outward link, so this proves nothing');
      link.focus();
      const press = new page.win.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(press);
      await flush();
      assert.equal(
        press.defaultPrevented,
        false,
        'the mount cancelled Enter on the link, so its navigation never happens',
      );
    } finally {
      page.handle.destroy();
    }
  });

  it('still dispatches the rewrite control beside it', async () => {
    // THE REFUSAL IS SCOPED TO A LINK, not to the block. `Rewrite from editor`
    // is an ordinary button on the command channel and must still reach the
    // reducer, or the guard above has taken the surface's other control with it.
    const page = await mounted(SEED, { project: withRefusal });
    try {
      await page.openAudit();
      const rewrite = page.element.querySelector<HTMLElement>('.ig-audit-refused-rewrite');
      assert.ok(rewrite !== null, 'the fixture drew no rewrite control, so this proves nothing');
      page.click(rewrite);
      await flush();
      // `reveal-issue` MOVES THE SELECTION, which is the whole of what it does.
      const selected = page.element.querySelector('[data-ig-key="1"][data-ig-selected="true"]');
      assert.ok(
        selected !== null || page.element.querySelector('.ig-inspector') !== null,
        'the rewrite control reached nothing',
      );
    } finally {
      page.handle.destroy();
    }
  });
});

/**
 * §17k's two narrow layouts, wired end to end.
 *
 * WHAT IS PROVEN HERE IS THE WIRING, not the layout: the stylesheet decides
 * which of the three layouts is drawn, jsdom applies no stylesheet, and the
 * package is forbidden from reading a width. So these read the two attributes
 * the sheet selects on, which is exactly the surface between the two halves.
 * The tracks themselves are pinned in `styles.test.ts` and were measured in a
 * browser at 1440, 1280 and 1000.
 */
describe("§17k's narrow layouts open and dismiss", () => {
  const root = (page: Mounted): HTMLElement => {
    const found = page.element.querySelector<HTMLElement>('.ig-workspace');
    assert.ok(found !== null, 'no workspace root');
    return found;
  };

  const press = (page: Mounted, key: string): void => {
    // DISPATCHED FROM THE FOCUSED ELEMENT, which is where a reader's press comes
    // from — the mount's listener is on its own element, as every other key here
    // is. A scripted `.click()` leaves focus on `body`, so a press dispatched
    // from there reaches nothing and the feature reads as broken. That mistake
    // cost a round in a browser before it was recognised.
    const active = page.win.document.activeElement;
    assert.ok(active !== null);
    active.dispatchEvent(new page.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };

  it('lifts the inspector on a selection and dismisses it on Escape', async () => {
    const page = await mounted();
    try {
      assert.equal(root(page).dataset['inspector'], 'dismissed', 'lifted with nothing selected');

      const row = page.rows()[0];
      assert.ok(row !== undefined);
      page.click(row);
      await flush();
      assert.equal(root(page).dataset['inspector'], 'lifted', 'a selection did not lift the panel');

      // FOCUS ON THE RAIL ROW, AND THAT IS THE WHOLE POINT OF THIS TEST.
      // `interaction()` answers `canvas` for any focused `[data-ig-key]`, and
      // `create/keys.ts` binds Escape to `cancel` as "ALWAYS AVAILABLE" — so an
      // Escape arm placed after `keyIntent` is claimed by a draft that does not
      // exist and never runs. Measured in a browser first: the panel stayed
      // open and the attribute stayed `lifted`. Driving this from a focused
      // BUTTON would pass either way, because `interaction()` answers
      // `elsewhere` there and Escape does not reach the create map at all.
      page.rows()[0]?.focus();
      assert.ok(page.win.document.activeElement?.closest('[data-ig-key]') !== null);
      press(page, 'Escape');
      await flush();
      assert.equal(root(page).dataset['inspector'], 'dismissed', 'Escape did not dismiss the panel');

      // AND THE SELECTION SURVIVED IT. Escape closes the panel; the rail's
      // current row and the canvas halo are not the panel.
      assert.equal(
        page.element.querySelector('[data-zone="rail"] [aria-current="true"]') !== null,
        true,
        'the dismissal cleared the selection as well',
      );

      // THE NEXT SELECTION RE-OPENS IT — §17k's "opened by selection", which is
      // a rule about every selection rather than about the first one.
      const next = page.rows()[1];
      assert.ok(next !== undefined);
      page.click(next);
      await flush();
      assert.equal(root(page).dataset['inspector'], 'lifted', 'the panel stayed shut after a new selection');
    } finally {
      page.handle.destroy();
    }
  });

  it('opens the collapsed canvas from its strip, and shuts it on Escape', async () => {
    const page = await mounted();
    try {
      assert.equal(root(page).dataset['canvas'], 'strip');
      const strip = page.control('canvas-strip');
      assert.ok(strip !== null, 'no control opens §17k’s collapsed canvas');
      assert.equal(strip.getAttribute('aria-expanded'), 'false');
      // IT IS IN THE CANVAS ZONE, which is what keeps it off the rail without
      // an offset: the zones are grid areas, so a control in one cannot be
      // drawn in another however the tracks resize.
      assert.equal(strip.closest('.ig-zone')?.getAttribute('data-zone'), 'canvas');

      strip.focus();
      page.click(strip);
      await flush();
      assert.equal(root(page).dataset['canvas'], 'open', 'the strip did not open the canvas');
      const opened = page.control('canvas-strip');
      assert.equal(opened?.getAttribute('aria-expanded'), 'true');
      // THE LABEL FLIPS WITH THE STATE. A control carrying `aria-expanded`
      // whose word did not flip would tell a screen-reader user the canvas is
      // open and offer to open it in one breath.
      assert.equal(opened?.textContent, WORDS.hideCanvas);
      assert.notEqual(WORDS.hideCanvas, WORDS.showCanvas);

      opened?.focus();
      press(page, 'Escape');
      await flush();
      assert.equal(root(page).dataset['canvas'], 'strip', 'Escape did not shut the canvas');
      assert.equal(page.control('canvas-strip')?.textContent, WORDS.showCanvas);
    } finally {
      page.handle.destroy();
    }
  });

  it('gives Escape back to the create draft, which is the more local thing', async () => {
    // A READER MID-RELATIONSHIP PRESSING ESCAPE MEANS "NOT THIS EDGE", not
    // "close the panel behind it". The §17k arm runs BEFORE `keyIntent` — it
    // has to, see the first test — so the draft is protected by a guard on the
    // draft rather than by the order of the two arms.
    const page = await mounted();
    try {
      const row = page.rows()[0];
      assert.ok(row !== undefined);
      page.click(row);
      await flush();
      const add = page.control('add');
      assert.ok(add !== null);
      page.click(add);
      await flush();
      assert.equal(page.control('cancel') !== null, true, 'no draft is open, so this proves nothing');
      assert.equal(root(page).dataset['inspector'], 'lifted');

      page.rows()[0]?.focus();
      press(page, 'Escape');
      await flush();
      assert.equal(page.control('cancel'), null, 'Escape did not abandon the draft');
      assert.equal(
        root(page).dataset['inspector'],
        'lifted',
        'the draft’s Escape also dismissed the panel, so one press did two things',
      );
    } finally {
      page.handle.destroy();
    }
  });
});

/**
 * Two transients now share Escape, and the order between them is a decision.
 *
 * #209 gave §17d's audit panel a dismissal; #210 gave §17k's lifted inspector
 * and collapsed canvas one. They landed within a day of each other and neither
 * knew about the other, so the interaction is settled here rather than left to
 * whichever arm a merge happened to put first.
 *
 * §17d'S PANEL GOES FIRST, and the reason is what each is: the audit overlay is
 * opened by an explicit press on the header count and is drawn at EVERY width,
 * while §17k's inspector is lifted implicitly by a selection and exists only
 * between `1120` and `1359`. Taking the press for §17k's would mean a reader at
 * the wide layout — where nothing of §17k's is drawn at all — pressing Escape
 * over an open audit panel and watching it stay put.
 */
describe('§17d and §17k share Escape, audit first', () => {
  it('closes the audit overlay, then the lifted inspector, then hands the key back', async () => {
    // A LOCAL PROJECTION WITH A FINDING IN IT. `withCycle` is scoped to the
    // audit scroll-offset suite in `mount.test.ts`; this suite needs the same
    // thing and copying the four lines is cheaper than sharing a helper
    // across two files.
    const cycling = (snapshot: StoreSnapshot): WorkspaceProjection => ({
      ...project(snapshot),
      audit: {
        document: { issues: snapshot.issues, edges: snapshot.landed },
        graph: { cycles: [['1', '2']], duplicateCanonical: () => null },
      },
    });
    const page = await mounted(SEED, { project: cycling });
    try {
      const root = (): HTMLElement => {
        const found = page.element.querySelector<HTMLElement>('.ig-workspace');
        assert.ok(found !== null);
        return found;
      };
      const overlay = (): Element | null => page.element.querySelector('.ig-audit-overlay');
      const press = (): void => {
        // FROM A FOCUSED RAIL ROW, which is the case both features get wrong if
        // the arm sits after `keyIntent`: `interaction()` answers `canvas` for
        // any focused `[data-ig-key]`, and `create/keys.ts` binds Escape to a
        // cancel that is "ALWAYS AVAILABLE".
        page.rows()[1]?.focus();
        const active = page.win.document.activeElement;
        assert.ok(active !== null);
        active.dispatchEvent(
          new page.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
      };

      const row = page.rows()[1];
      assert.ok(row !== undefined);
      page.click(row);
      await flush();
      const toggle = page.element.querySelector<HTMLElement>('[data-ig-audit-panel]');
      assert.ok(toggle !== null);
      toggle.focus();
      page.click(toggle);
      await flush();

      assert.ok(overlay() !== null, 'the audit panel did not open');
      assert.equal(root().dataset['inspector'], 'lifted', 'the selection did not lift the panel');

      press();
      await flush();
      assert.equal(overlay(), null, 'the first press did not close the audit overlay');
      assert.equal(
        root().dataset['inspector'],
        'lifted',
        'the first press closed both, so one key did two things',
      );

      press();
      await flush();
      assert.equal(root().dataset['inspector'], 'dismissed', 'the second press did not dismiss the panel');

      // AND THE THIRD CHANGES NOTHING, which is all this asserts. Both reducers
      // answer `unclaimed` with nothing open — but the press does NOT reach the
      // host: it falls to `keyIntent`, which binds Escape to a cancel that is
      // "ALWAYS AVAILABLE" and cancels it there. That predates this branch and
      // is stated so the assertion below is not read as more than it is.
      press();
      await flush();
      assert.equal(overlay(), null);
      assert.equal(root().dataset['inspector'], 'dismissed');
    } finally {
      page.handle.destroy();
    }
  });
});
