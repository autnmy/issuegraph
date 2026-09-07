import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diffOrder } from '@issuegraph/store';
import type { ViewerDocument } from '@issuegraph/viewer';

import { renderWorkspace } from './render.ts';
import type { WorkspaceWords } from './render.ts';
import { WORDS as CHANGE_WORDS, editOf, orderOf, railOf } from '../testing/reevaluate.ts';
import { WORKSPACE_WORDS } from '../testing/workspace.ts';

/**
 * §17c in the mounted workspace: cause in the header, effect on the row.
 *
 * The rails here come from `testing/reevaluate.ts` rather than
 * `testing/workspace.ts`, for the reason that file states: these tests ask
 * WHERE A CHIP LANDS, so they need arbitrary keys that line up with an order's
 * refs, which the workspace builder's generated keys cannot give them.
 */

const WORDS: WorkspaceWords = { ...WORKSPACE_WORDS, change: CHANGE_WORDS };

/** `a` and `b` swap; `c` and `d` do not move. */
const SWAPPED = diffOrder(
  orderOf(['a', 'b', 'c', 'd']),
  orderOf(['b', 'a', 'c', 'd']),
  editOf(),
);

function railZone(markup: string): string {
  const zone = /<section class="ig-zone" data-zone="rail">([\s\S]*?)<section class="ig-zone" data-zone="canvas">/.exec(
    markup,
  );
  assert.ok(zone !== null, 'no rail zone');
  return zone[1] ?? '';
}

function headerZone(markup: string): string {
  const zone = /<section class="ig-zone" data-zone="header">([\s\S]*?)<section class="ig-zone" data-zone="rail">/.exec(
    markup,
  );
  assert.ok(zone !== null, 'no header zone');
  return zone[1] ?? '';
}

/**
 * One rail row's markup, verbatim — INCLUDING any chip placed on it.
 *
 * A row's own children are spans and divs, and the placed chip is a `span`
 * appended among them, so the first `</li>` after the opening tag still closes
 * the row and now correctly encloses the chip. That is the whole point of the
 * change: the chip is part of the row, so a reader of one reads the other.
 */
function row(markup: string, key: string): string {
  const found = new RegExp(`<li class="ig-slot" data-ig-key="${key}"[\\s\\S]*?</li>`).exec(markup);
  assert.ok(found !== null, `no row for ${key}`);
  return found[0];
}

describe('§17c draws the effect on the row, not beside it', () => {
  it('puts a placed chip inside the rows that moved, and nowhere else', () => {
    const result = renderWorkspace(railOf(['b', 'a', 'c', 'd']), {
      words: WORDS,
      change: SWAPPED,
    });
    const rail = railZone(result.markup);

    for (const key of ['a', 'b']) {
      assert.match(row(rail, key), /<span class="ig-delta-chip" data-placed="true">/, key);
    }
    for (const key of ['c', 'd']) {
      assert.equal(/ig-delta-chip/.test(row(rail, key)), false, key);
    }
  });

  it('drops the key span on a placed chip, because the row already names it', () => {
    // `reevaluate/render.ts` names its row in text precisely BECAUSE it is
    // unpositioned. On the row that reasoning inverts: the key would be the one
    // span on the chip saying nothing the reader cannot already see.
    const rail = railZone(
      renderWorkspace(railOf(['b', 'a', 'c']), { words: WORDS, change: SWAPPED }).markup,
    );
    assert.equal(/ig-delta-key/.test(rail), false);
    // The words are still there, so the assertion above is not passing over a
    // chip that rendered nothing at all.
    assert.match(rail, /<span class="ig-change-word">up<\/span>/);
    assert.match(rail, /<span class="ig-change-word">down<\/span>/);
  });

  it('tints a moved row by KIND, and leaves an unmoved row with no attribute', () => {
    const rail = railZone(
      renderWorkspace(railOf(['b', 'a', 'c', 'd']), { words: WORDS, change: SWAPPED }).markup,
    );
    assert.match(row(rail, 'a'), /data-ig-delta="down"/);
    assert.match(row(rail, 'b'), /data-ig-delta="up"/);
    for (const key of ['c', 'd']) {
      assert.equal(/data-ig-delta/.test(row(rail, key)), false, key);
    }
  });

  it('leaves an unaffected row byte-identical across the edit', () => {
    // The design's rule — "unaffected rows are left completely alone" — asserted
    // over the WORKSPACE now that the workspace is what appends to a row.
    const before = renderWorkspace(railOf(['a', 'b', 'c', 'd']), { words: WORDS });
    const after = renderWorkspace(railOf(['b', 'a', 'c', 'd']), {
      words: WORDS,
      change: SWAPPED,
    });
    for (const key of ['c', 'd']) {
      assert.equal(row(railZone(after.markup), key), row(railZone(before.markup), key), key);
    }
    assert.notEqual(row(railZone(after.markup), 'a'), row(railZone(before.markup), 'a'));
  });
});

describe('§17c puts the cause in the header, where it cannot scroll away', () => {
  it('draws the summary and its dismiss control in the header zone', () => {
    const result = renderWorkspace(railOf(['b', 'a', 'c']), { words: WORDS, change: SWAPPED });
    const header = headerZone(result.markup);
    assert.match(header, /class="ig-change-summary"/);
    assert.match(header, /data-ig-command="dismiss-change"/);
    // The rail zone is the scroller. A summary in there is one that survives a
    // dismiss but not a scroll, which is not what "persists" means.
    assert.equal(/ig-change-summary/.test(railZone(result.markup)), false);
  });

  it('draws the unchanged finding in the summary\'s own place', () => {
    const same = orderOf(['a', 'b']);
    const result = renderWorkspace(railOf(['a', 'b']), {
      words: WORDS,
      change: diffOrder(same, same, editOf()),
    });
    assert.match(headerZone(result.markup), /this edit changed nothing/);
  });
});

describe('the package invents no English, so no words means no loop', () => {
  it('draws neither summary nor chip when the host supplied no change words', () => {
    // `ChangeWords` refuses a default vocabulary because the store ships counts
    // so a host writes the sentence itself. A default here would take that
    // choice back one layer down, so absence draws nothing at all.
    const result = renderWorkspace(railOf(['b', 'a', 'c']), {
      words: WORKSPACE_WORDS,
      change: SWAPPED,
    });
    assert.equal(/ig-change-summary/.test(result.markup), false);
    assert.equal(/ig-delta-chip/.test(result.markup), false);
    assert.equal(/data-ig-delta/.test(result.markup), false);
  });

  it('renders identically to a workspace given no change at all', () => {
    const wordless = renderWorkspace(railOf(['b', 'a', 'c']), {
      words: WORKSPACE_WORDS,
      change: SWAPPED,
    });
    const changeless = renderWorkspace(railOf(['b', 'a', 'c']), { words: WORKSPACE_WORDS });
    assert.equal(wordless.markup, changeless.markup);
  });
});

describe('a write in flight labels the order and never re-ranks it', () => {
  it('publishes the held status on the root, for the stylesheet to grey', () => {
    const result = renderWorkspace(railOf(['a', 'b', 'c']), {
      words: WORDS,
      orderStatus: 'held',
    });
    assert.match(result.markup, /^<div class="ig-workspace" data-order="held">/);
  });

  it('draws the SAME ranks held as settled — optimistic rendering, never optimistic re-ordering', () => {
    // §122's non-negotiable. A pending write may show as pending; it may not
    // move a rank. Asserted by the ranks being byte-identical across the two
    // statuses over one document, while the status itself demonstrably differs.
    const document: ViewerDocument = railOf(['a', 'b', 'c']);
    const settled = renderWorkspace(document, { words: WORDS, orderStatus: 'settled' });
    const held = renderWorkspace(document, { words: WORDS, orderStatus: 'held' });

    const ranksOf = (markup: string): string[] =>
      [...markup.matchAll(/data-ig-key="([^"]+)"/g)].map((match) => match[1] ?? '');
    assert.deepEqual(ranksOf(railZone(held.markup)), ranksOf(railZone(settled.markup)));
    assert.notEqual(held.markup, settled.markup);
  });
});

describe('a placed chip is decoration, so it changes no tab order', () => {
  it('takes no tab stop and leaves the rail\'s stops exactly as they were', () => {
    // #155 is open on the control surface not seeing a tab-order change, so
    // this is asserted here rather than left to the baseline: an element
    // appended INTO a row is precisely the shape of change that bug hides.
    const before = renderWorkspace(railOf(['a', 'b', 'c', 'd']), { words: WORDS });
    const after = renderWorkspace(railOf(['b', 'a', 'c', 'd']), {
      words: WORDS,
      change: SWAPPED,
    });

    const stops = (markup: string): string[] =>
      [...markup.matchAll(/tabindex="(-?\d+)"/g)].map((match) => match[1] ?? '');
    assert.deepEqual(stops(railZone(after.markup)), stops(railZone(before.markup)));

    // And the chip itself carries neither a stop nor an interactive role.
    const chip = /<span class="ig-delta-chip" data-placed="true">/.exec(railZone(after.markup));
    assert.ok(chip !== null, 'no placed chip to check');
    const opening = chip[0];
    assert.equal(/tabindex/.test(opening), false);
    assert.equal(/role=/.test(opening), false);
  });
});

describe('nothing about the loop expires on its own', () => {
  it('schedules nothing and offers no clear but the command', () => {
    // The store's `dismissChange()` and the next edit are the only clears, and
    // this render holds no "has this been dismissed" of its own — so there is
    // nothing here for a timer to expire.
    const source = renderWorkspace(railOf(['b', 'a']), { words: WORDS, change: SWAPPED }).markup;
    for (const timer of ['setTimeout', 'setInterval', 'requestAnimationFrame']) {
      assert.equal(source.includes(timer), false, timer);
    }
  });
});
