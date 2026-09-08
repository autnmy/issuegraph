/**
 * §17a's rail footer — the isolated route, drawn where the frame puts it.
 *
 * The count and its toggle already existed; what they had was one home, in the
 * canvas ladder's chrome. These pin that the workspace draws them at the foot
 * of the order rail instead, that it draws them EXACTLY once, and that the two
 * halves of that move cannot come apart — no configuration yields two copies of
 * the control, and none yields none.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ViewerDocument } from '@issuegraph/viewer';

import { INITIAL_SCALE_STATE } from '../scale/commands.ts';
import type { RailWords } from './render.ts';
import { renderWorkspace } from './render.ts';
import { WORKSPACE_WORDS, backlogOf } from '../testing/workspace.ts';

/**
 * LOCAL, AND DELIBERATELY NOT ON `WORKSPACE_WORDS`.
 *
 * The shared fixture feeds `testing/a11y.ts`, whose `isolated-shut` and
 * `isolated-open` surfaces are committed in `a11y/baseline.json` and hold the
 * LADDER's control. Putting `rail` on the shared fixture would suppress that
 * control and change both baselines — a hand-regenerated file, by design — as a
 * side effect of a test fixture. The baseline should move when someone decides
 * the shipped surface moves, not because a footer test needed words.
 *
 * The constant's own rules still apply: every entry distinct, none a substring
 * of another, and none the word a renderer would reach for on its own.
 */
const RAIL_WORDS: RailWords = {
  isolated: 'carrying no edges',
  show: 'reveal',
  hide: 'fold away',
};

/**
 * A backlog whose first two issues are joined and whose rest are isolated.
 *
 * `scaleLadder` counts an isolated issue as one in no component, so one edge
 * over four issues leaves two of them isolated — a count that is neither zero
 * nor the whole document, which is what makes the assertions below able to fail.
 */
function withIsolated(total = 4): ViewerDocument {
  return backlogOf(total, { edges: [['blocked-by', 'i0001', 'i0002']] });
}

/** Every issue related, so the isolated set is empty. */
function withoutIsolated(): ViewerDocument {
  return backlogOf(2, { edges: [['blocked-by', 'i0001', 'i0002']] });
}

const WITH_RAIL = { ...WORKSPACE_WORDS, rail: RAIL_WORDS };

/**
 * The rail zone alone. The zones are emitted in a fixed order — header, rail,
 * canvas, inspector — so the slice ends where the canvas begins.
 */
function railZone(markup: string): string {
  const start = markup.indexOf('<section class="ig-zone" data-zone="rail">');
  assert.notEqual(start, -1, 'no rail zone');
  const end = markup.indexOf('<section class="ig-zone" data-zone="canvas">', start);
  assert.notEqual(end, -1, 'no canvas zone after the rail');
  return markup.slice(start, end);
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("§17a's rail footer", () => {
  it('draws the count and the host’s label at the foot of the rail', () => {
    const { markup } = renderWorkspace(withIsolated(), { words: WITH_RAIL });
    const rail = railZone(markup);

    assert.match(rail, /<div class="ig-rail-footer">/);
    assert.match(rail, /<span class="ig-rail-count">2<\/span>/);
    assert.ok(rail.includes(RAIL_WORDS.isolated), 'the host’s label is not drawn');
  });

  it('draws nothing when nothing is isolated', () => {
    const { markup } = renderWorkspace(withoutIsolated(), { words: WITH_RAIL });

    assert.ok(!markup.includes('ig-rail-footer'), 'a footer over an empty set');
    assert.ok(!markup.includes('ig-rail-isolated-list'), 'a list over an empty set');
  });

  /**
   * THE OTHER HALF OF THE MOVE. `renderWorkspace` tells the ladder to drop its
   * chip whenever it is drawing the route itself, so an empty isolated set must
   * leave the ladder alone: the flag fires on the WORDS, and at count zero
   * neither renderer draws anything, which is the equivalence the call site
   * claims. If that ever stopped holding, this is the test that says so.
   */
  it('leaves the ladder’s own chip alone when there is nothing to draw', () => {
    const { markup } = renderWorkspace(withoutIsolated(), { words: WITH_RAIL });

    assert.ok(!markup.includes('ig-ladder-isolated'), 'the ladder drew an empty chip');
  });

  it('draws no footer, and keeps the ladder’s chip, when the host has not worded it', () => {
    const { markup } = renderWorkspace(withIsolated(), { words: WORKSPACE_WORDS });

    assert.ok(!markup.includes('ig-rail-footer'), 'a footer with no words for it');
    assert.match(markup, /ig-ladder-isolated/, 'the route left the surface entirely');
  });

  /**
   * ONE COUNT, ONE ZONE — and the chip being gone is only half of what that
   * means. The second assertion is the one that would catch a footer drawn
   * beside a chip the suppression missed.
   */
  it('states the count once, not twice', () => {
    const { markup } = renderWorkspace(withIsolated(), { words: WITH_RAIL });

    assert.ok(!markup.includes('ig-ladder-isolated'), 'the ladder still drew its chip');
    assert.equal(
      occurrences(markup, RAIL_WORDS.isolated),
      1,
      'the isolated label is drawn more than once',
    );
  });

  it('offers to open the list, and says so to a screen reader', () => {
    const { markup } = renderWorkspace(withIsolated(), { words: WITH_RAIL });
    const rail = railZone(markup);

    assert.match(rail, /data-ig-command="open-isolated"/);
    assert.match(rail, /aria-expanded="false"/);
    assert.ok(rail.includes(RAIL_WORDS.show), 'the closed control is not the host’s word');
    assert.ok(!rail.includes(RAIL_WORDS.hide), 'the closed control offers to hide');
  });

  it('flips the label with the state, and draws the issues', () => {
    const { markup } = renderWorkspace(withIsolated(), {
      words: WITH_RAIL,
      scale: { ...INITIAL_SCALE_STATE, isolatedOpen: true },
    });
    const rail = railZone(markup);

    assert.match(rail, /data-ig-command="close-isolated"/);
    assert.match(rail, /aria-expanded="true"/);
    assert.ok(rail.includes(RAIL_WORDS.hide), 'the open control is not the host’s word');
    assert.match(rail, /<ol class="ig-rail-isolated-list"/);
    // KEY AND TITLE, as the ladder's own list drew them. Dropping the titles
    // would make this a downgrade wearing a move's clothes.
    assert.match(rail, /<span class="ig-id">i0003<\/span>/);
    assert.ok(rail.includes('Issue i0003'), 'the list drew keys without titles');
  });

  /**
   * RULING 2, PINNED. The footer is `position: sticky`, and an element taller
   * than its scrollport cannot stick — so a list inside it would lose the pin
   * exactly as it grew, and would occlude the order rows while it held it. The
   * list is flow content in the rail's scroll track, which this asserts
   * structurally rather than trusting the stylesheet to be read.
   */
  it('keeps the open list out of the pinned footer', () => {
    const { markup } = renderWorkspace(withIsolated(), {
      words: WITH_RAIL,
      scale: { ...INITIAL_SCALE_STATE, isolatedOpen: true },
    });
    const rail = railZone(markup);

    const list = rail.indexOf('<ol class="ig-rail-isolated-list"');
    const footer = rail.indexOf('<div class="ig-rail-footer">');
    assert.notEqual(list, -1, 'no list');
    assert.notEqual(footer, -1, 'no footer');
    assert.ok(list < footer, 'the list is inside or after the footer, not above it');
    assert.ok(
      !rail.slice(footer).includes('ig-rail-isolated-list'),
      'the footer contains the list',
    );
  });

  /**
   * THE POSITIVE CONTROL. Every string in the footer is the host's, so a
   * renderer that fell back to English of its own would pass every assertion
   * above that merely looks for a class.
   */
  it('writes none of its own English', () => {
    const { markup } = renderWorkspace(withIsolated(), { words: WITH_RAIL });
    const rail = railZone(markup);
    // THE TEXT, NOT THE MARKUP. The class names carry "isolated" by design —
    // they are this package's own vocabulary for a host's stylesheet, not prose
    // a reader sees — so the scan has to be over what is actually rendered
    // between the tags. An earlier revision asserted over the raw markup and
    // failed on `ig-rail-isolated`, which is a naming convention rather than a
    // word the surface writes.
    const footer = rail.slice(rail.indexOf('<div class="ig-rail-footer">'));
    const text = footer.replace(/<[^>]*>/g, ' ');

    for (const word of ['isolated', 'relationship', 'show', 'hide']) {
      assert.ok(!text.includes(word), `the footer writes its own "${word}"`);
    }
    // AND THE HOST'S WORDS REALLY ARE IN THAT TEXT, so the scan above cannot
    // pass by finding nothing at all.
    assert.ok(text.includes(RAIL_WORDS.isolated), 'the label is not in the footer’s text');
    assert.ok(text.includes(RAIL_WORDS.show), 'the control is not in the footer’s text');
  });
});
