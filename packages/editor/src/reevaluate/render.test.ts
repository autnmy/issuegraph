import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diffOrder } from '@issuegraph/store';

import { renderReevaluate } from './render.ts';
import { WORDS, editOf, orderOf, railOf, railRow, ranks } from '../testing/reevaluate.ts';

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
      },
      { words: WORDS },
    );
    assert.ok(result.diagnostics.length > 0);
  });
});
