import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diffOrder } from '@issuegraph/store';

import { renderReevaluate } from './render.ts';
import { WORDS, editOf, orderOf, railOf, railRow, ranks, unitRailOf } from '../testing/reevaluate.ts';

describe('unaffected rows are left completely alone', () => {
  it('renders their markup byte-identically across an edit', () => {
    // The rail comes out of `renderViewer` and this package never touches a
    // row, so this is structural rather than asserted — but it is asserted
    // anyway, because that is the property the design actually asks for.
    const before = renderReevaluate(railOf(['a', 'b', 'c', 'd']), { words: WORDS });
    const after = renderReevaluate(railOf(['b', 'a', 'c', 'd']), {
      words: WORDS,
      change: diffOrder(orderOf(['a', 'b', 'c', 'd']), orderOf(['b', 'a', 'c', 'd']), editOf()),
    });

    for (const key of ['c', 'd']) {
      assert.equal(railRow(after.markup, key), railRow(before.markup, key), key);
    }
    // And the rows that DID change are genuinely different, or the assertion
    // above would be passing over a render that never moved anything.
    assert.notEqual(railRow(after.markup, 'a'), railRow(before.markup, 'a'));
  });

  it('draws a chip for changed rows only, keyed to the row', () => {
    const result = renderReevaluate(railOf(['b', 'a', 'c']), {
      words: WORDS,
      change: diffOrder(orderOf(['a', 'b', 'c']), orderOf(['b', 'a', 'c']), editOf()),
    });

    const chipKeys = [...result.markup.matchAll(/<li class="ig-delta-chip" data-ig-key="([^"]+)"/g)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(chipKeys, ['a', 'b']);
    assert.match(result.markup, /data-direction="up"/);
    assert.match(result.markup, /data-direction="down"/);
  });

  it('names the row each chip is about, so the unchipped rows are accounted for', () => {
    // Nothing here positions a chip over its row — `data-ig-key` has no browser
    // behaviour on its own — so a chip that carried its key only as an attribute
    // said nothing visible about WHICH row moved.
    const result = renderReevaluate(railOf(['b', 'a', 'c']), {
      words: WORDS,
      change: diffOrder(orderOf(['a', 'b', 'c']), orderOf(['b', 'a', 'c']), editOf()),
    });
    assert.match(result.markup, /<span class="ig-delta-key">a<\/span>/);
    assert.match(result.markup, /<span class="ig-delta-key">b<\/span>/);
    assert.equal(/<span class="ig-delta-key">c<\/span>/.test(result.markup), false);
  });
});

describe('an edit that changed nothing renders, in the summary\'s own place', () => {
  it('draws the unchanged line rather than an empty summary', () => {
    const same = orderOf(['a', 'b']);
    const result = renderReevaluate(railOf(['a', 'b']), {
      words: WORDS,
      change: diffOrder(same, orderOf(['a', 'b']), editOf()),
    });

    assert.match(result.markup, /data-unchanged="true"/);
    assert.match(result.markup, /<p class="ig-change-unchanged">this edit changed nothing<\/p>/);
    assert.equal(/class="ig-change-parts"/.test(result.markup), false);
    assert.equal(/class="ig-delta-chip"/.test(result.markup), false);
  });

  it('words the summary from the host and writes no sentence of its own', () => {
    const result = renderReevaluate(railOf(['b', 'a', 'c']), {
      words: WORDS,
      change: diffOrder(orderOf(['a', 'b', 'c']), orderOf(['b', 'a', 'c']), editOf()),
    });

    assert.match(
      result.markup,
      /<li class="ig-change-part" data-facet="moved"><span class="ig-change-count">2<\/span><span class="ig-change-word">rows moved<\/span><\/li>/,
    );
    assert.match(result.markup, /data-unchanged="false"/);
  });
});

describe('the computing state shows the previous order, greyed and labelled', () => {
  // The previous order, held still: `a` is first and `c` is last, and the
  // change claims a movement that would put `c` first once it settles.
  const held = renderReevaluate(railOf(['a', 'b', 'c']), {
    words: WORDS,
    status: 'held',
    change: diffOrder(orderOf(['a', 'b', 'c']), orderOf(['c', 'a', 'b']), editOf()),
  });

  it('labels itself and marks the surface held', () => {
    assert.match(held.markup, /<section class="ig-reevaluate" data-order="held">/);
    assert.match(held.markup, /<p class="ig-order-computing">write landed, order computing<\/p>/);
    assert.equal(held.view.held, true);
  });

  it('renders NO rank that came from the change', () => {
    // The rail's ranks are the ones the caller vouched for. A movement's
    // endpoints are 0-based store positions, so printing one beside a 1-based
    // rail would read as an off-by-one — and `c`, which the change moves to
    // position 0, must still render its own rank of 3.
    assert.deepEqual(ranks(held.markup), ['1', '2', '3']);
    assert.equal(/<span class="ig-rank"[^>]*>0<\/span>/.test(held.markup), false);
  });

  it('keeps the chips up while the write is in flight', () => {
    // Chips persist until the next edit or an explicit dismiss. A write going
    // out is neither.
    assert.match(held.markup, /class="ig-delta-chip"/);
  });

  it('is settled by default, so a caller that says nothing claims nothing', () => {
    const result = renderReevaluate(railOf(['a']), { words: WORDS });
    assert.match(result.markup, /data-order="settled"/);
    assert.equal(/class="ig-order-computing"/.test(result.markup), false);
  });
});

describe('a chip attributes each fact to the issue it is about', () => {
  it('names every member when a unit moves, so it does not read as one row twice', () => {
    // Unattributed, a two-member unit each moving down one renders
    // `lead 1 down 1 down` — which says the row moved TWICE.
    const result = renderReevaluate(unitRailOf(), {
      words: WORDS,
      change: diffOrder(
        orderOf(['lead', 'partner', 'other']),
        orderOf(['other', 'lead', 'partner']),
        editOf(),
      ),
    });
    const chip = result.markup.match(/<li class="ig-delta-chip" data-ig-key="lead">.*?<\/li>/)?.[0];
    assert.ok(chip !== undefined, 'no chip for the unit');
    assert.match(chip, /<span class="ig-delta-ref">lead<\/span>/);
    assert.match(chip, /<span class="ig-delta-ref">partner<\/span>/);
  });

  it('names a lone member the row is NOT named after', () => {
    // The row key is the lead; the issue that changed is the partner. Saying
    // only `lead` would attribute the change to an issue that did not change.
    const result = renderReevaluate(unitRailOf(), {
      words: WORDS,
      change: diffOrder(
        orderOf(['other', 'partner'], ['partner']),
        orderOf(['other', 'partner']),
        editOf(),
      ),
    });
    const chip = result.markup.match(/<li class="ig-delta-chip" data-ig-key="lead">.*?<\/li>/)?.[0];
    assert.ok(chip !== undefined, 'no chip for the unit');
    assert.match(chip, /<span class="ig-delta-ref">partner<\/span>/);
  });

  it('does NOT repeat the row key when the only member IS the row', () => {
    // The ordinary case. The key already names it, so a ref span would be the
    // one piece of text on the chip that says nothing.
    const result = renderReevaluate(railOf(['b', 'a']), {
      words: WORDS,
      change: diffOrder(orderOf(['a', 'b']), orderOf(['b', 'a']), editOf()),
    });
    assert.match(result.markup, /class="ig-delta-key">a</);
    assert.equal(/class="ig-delta-ref"/.test(result.markup), false);
  });
});

describe('the status region is mounted before there is anything to say', () => {
  it('renders an EMPTY live region when no edit has landed', () => {
    // A `role="status"` node that is CREATED already carrying its text is not
    // reliably announced — the region has to exist first and then have its
    // contents change. Rendering it only alongside a summary loses the FIRST
    // summary after a load, which is the one a reader is most likely waiting on.
    const result = renderReevaluate(railOf(['a', 'b']), { words: WORDS });
    assert.match(result.markup, /<div class="ig-change-line" role="status"><\/div>/);
    assert.equal(result.view.summary, null);
  });

  it('claims nothing about an edit that has not happened', () => {
    const markup = renderReevaluate(railOf(['a', 'b']), { words: WORDS }).markup;
    // `data-unchanged="false"` would say an edit landed and moved nothing.
    assert.equal(/data-unchanged/.test(markup), false);
    assert.equal(/data-mutation/.test(markup), false);
    // And a control that clears nothing is a control that does nothing.
    assert.equal(/dismiss-change/.test(markup), false);
  });

  it('fills the SAME region once an edit lands', () => {
    const result = renderReevaluate(railOf(['b', 'a']), {
      words: WORDS,
      change: diffOrder(orderOf(['a', 'b']), orderOf(['b', 'a']), editOf()),
    });
    assert.match(result.markup, /<div class="ig-change-line" role="status"><ul class="ig-change-parts"/);
    // Exactly one status region, before and after — not a second one alongside.
    assert.equal(result.markup.match(/role="status"/g)?.length, 1);
  });
});

describe('nothing dismisses itself', () => {
  it('publishes the dismissal as a command for the store to perform', () => {
    const result = renderReevaluate(railOf(['b', 'a']), {
      words: WORDS,
      change: diffOrder(orderOf(['a', 'b']), orderOf(['b', 'a']), editOf()),
    });
    assert.match(
      result.markup,
      /<button type="button" class="ig-change-dismiss" data-ig-command="dismiss-change">dismiss<\/button>/,
    );
  });

  it('schedules no timer while rendering', () => {
    // Not a scan of the source — the purity suite records why a pattern over a
    // grammar with strings in it buys a finding per round. This replaces the
    // scheduling globals with recording stubs, which catches a timer however it
    // is spelled, including one reached through a computed access.
    const timers = ['setTimeout', 'setInterval', 'queueMicrotask', 'requestAnimationFrame'];
    const saved = new Map(
      timers.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const),
    );
    const scheduled: string[] = [];
    for (const name of timers) {
      Object.defineProperty(globalThis, name, {
        value: () => {
          scheduled.push(name);
        },
        configurable: true,
        writable: true,
      });
    }

    try {
      renderReevaluate(railOf(['b', 'a']), {
        words: WORDS,
        status: 'held',
        change: diffOrder(orderOf(['a', 'b']), orderOf(['b', 'a']), editOf()),
      });
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
        else Object.defineProperty(globalThis, name, descriptor);
      }
    }

    assert.deepEqual(scheduled, []);
  });
});

describe('the surface composes the viewer rather than re-rendering it', () => {
  it('nests the rail inside its own root and ships both stylesheets', () => {
    const result = renderReevaluate(railOf(['a', 'b']), { words: WORDS });
    assert.match(result.markup, /^<section class="ig-reevaluate" data-order="settled">/);
    assert.match(result.markup, /<section class="ig-viewer ig-linear" data-projection="linear"/);
    assert.match(result.styles, /\.ig-viewer/);
    assert.match(result.styles, /\.ig-reevaluate/);
    assert.deepEqual([...result.diagnostics], []);
  });

  it('carries the viewer\'s diagnostics out alongside its own', () => {
    // A slot naming an issue the document does not carry is the viewer's to
    // report; this surface must not swallow it on the way past.
    const document = railOf(['a']);
    const result = renderReevaluate(
      {
        ...document,
        order: {
          slots: [
            ...document.order.slots,
            { rank: 2, lead: 'absent', members: ['absent'], ready: true, holds: [] },
          ],
          excluded: [],
        },
        cycles: [],
      },
      { words: WORDS },
    );
    assert.ok(result.diagnostics.length > 0);
  });
});
