import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RAIL_WINDOW, railWindow } from './rail.ts';
import { backlogOf, keysOf } from '../testing/workspace.ts';

describe('the rail model is complete however small the window is', () => {
  const document = backlogOf(312);

  it('addresses every rank, including ranks it never draws', () => {
    const rail = railWindow(document, { start: 0, count: 10 });
    assert.equal(rail.total, 312);
    assert.equal(rail.rows.length, 10);

    // THE COMPLETENESS CLAIM, driven over every rank rather than sampled: a
    // window of 10 still answers for 312. This is the assertion the leaf's
    // "done when" names, and it is the one that fails the moment an index is
    // built over the window instead of the order.
    for (let rank = 1; rank <= 312; rank += 1) {
      const slot = rail.addressOf(rank);
      assert.ok(slot !== undefined, `rank ${String(rank)} is unaddressable`);
      assert.equal(slot.rank, rank);
    }
  });

  it('answers the offset of every key, drawn or not', () => {
    const rail = railWindow(document, { start: 300, count: 5 });
    for (const [index, key] of keysOf(312).entries()) {
      assert.equal(rail.offsetOf(key), index, key);
    }
  });

  it('refuses nothing: there is no size at which it stops answering', () => {
    for (const total of [0, 1, 312, 5000]) {
      const rail = railWindow(backlogOf(total));
      assert.equal(rail.total, total);
      assert.equal(rail.count, Math.min(total, RAIL_WINDOW));
      assert.equal(rail.before + rail.count + rail.after, total);
    }
  });
});

describe('the window is bounded, and clamped rather than refused', () => {
  const document = backlogOf(312);

  it('slices where it was asked to', () => {
    const rail = railWindow(document, { start: 100, count: 20 });
    assert.equal(rail.start, 100);
    assert.equal(rail.before, 100);
    assert.equal(rail.after, 192);
    assert.deepEqual(
      rail.rows.map((slot) => slot.lead),
      keysOf(312).slice(100, 120),
    );
  });

  it('clamps a start past the end back onto the last full window', () => {
    // A scroll container hands over whatever position it is at. Refusing here
    // would take the rail down over a rounding error, which is the one thing it
    // may never do.
    const rail = railWindow(document, { start: 9_000, count: 20 });
    assert.equal(rail.start, 292);
    assert.equal(rail.count, 20);
    assert.equal(rail.after, 0);
  });

  it('clamps a negative start, a fractional one, and an over-long count', () => {
    assert.equal(railWindow(document, { start: -40 }).start, 0);
    assert.equal(railWindow(document, { start: 10.7, count: 5.9 }).start, 10);
    assert.equal(railWindow(document, { start: 10.7, count: 5.9 }).count, 5);
    assert.equal(railWindow(document, { count: 9_000 }).count, 312);
    assert.equal(railWindow(document, { count: -3 }).count, 0);
    assert.equal(railWindow(document, { count: Number.POSITIVE_INFINITY }).count, 312);
  });

  it('falls back on NaN rather than reporting an order it cannot account for', () => {
    // NaN is the one input a clamp does not catch: `Math.max(0, Math.min(NaN,
    // n))` is NaN, which slices to an empty window and leaves `before + count +
    // after` NOT equal to `total` — the rail silently failing to account for the
    // order it exists to account for.
    for (const options of [{ count: Number.NaN }, { start: Number.NaN }]) {
      const rail = railWindow(document, options);
      assert.equal(rail.before + rail.count + rail.after, 312, JSON.stringify(options));
      assert.ok(Number.isInteger(rail.start));
      assert.ok(Number.isInteger(rail.count));
    }
    assert.equal(railWindow(document, { count: Number.NaN }).count, RAIL_WINDOW);
    assert.equal(railWindow(document, { start: Number.NaN }).start, 0);
  });
});

describe('exclusions are carried whole, and that bound is stated', () => {
  // An excluded issue holds no rank, so it is not part of the SEQUENCE the
  // window slices. Windowing it would need a second window with its own
  // coordinate. Pinned so the bound stays a decision rather than becoming a
  // surprise.
  const document = {
    ...backlogOf(20),
    order: {
      ...backlogOf(20).order,
      excluded: [{ key: 'i0020', canonical: 'i0001', reason: 'duplicate-of' as const }],
    },
  };

  it('keeps every exclusion however narrow the window is', () => {
    const rail = railWindow(document, { start: 0, count: 2 });
    assert.equal(rail.document.order.excluded.length, 1);
    assert.equal(rail.rows.length, 2);
  });

  it('keeps the edges a visible excluded row owes a badge for', () => {
    // Layer 1 draws each exclusion as a footer row that calls `edgeBadges` for
    // its own key, so an excluded row owes badges exactly like a slot does.
    // Selecting edges from the SLOT members alone dropped them: the row stayed
    // on screen and silently lost its relationship as the reader scrolled past
    // the slot at the other end.
    const related = {
      ...backlogOf(20),
      edges: [{ field: 'blocked-by' as const, from: 'i0020', to: 'i0002' }],
      order: {
        slots: backlogOf(20).order.slots.filter((slot) => slot.lead !== 'i0020'),
        excluded: [{ key: 'i0020', canonical: 'i0001', reason: 'duplicate-of' as const }],
      },
    };
    // A window nowhere near `i0002`, the slot at the other end of that edge.
    const rail = railWindow(related, { start: 10, count: 3 });
    assert.equal(rail.document.order.excluded.length, 1, 'the exclusion stopped rendering');
    assert.ok(
      rail.document.edges.some((edge) => edge.from === 'i0020' && edge.to === 'i0002'),
      'the visible excluded row lost its badge',
    );
    assert.ok(rail.document.issues.some((issue) => issue.key === 'i0002'));
  });
});

describe('a held slot has no rank, and the window does not pretend otherwise', () => {
  // Held slots keep their POSITION and lose their RANK, so ranks are not a
  // coordinate a window can slice on — which is why the window is an offset.
  const document = backlogOf(10, { held: ['i0003', 'i0007'] });

  it('slices on offsets, so a held slot is still drawn in its place', () => {
    const rail = railWindow(document, { start: 2, count: 3 });
    assert.deepEqual(
      rail.rows.map((slot) => slot.lead),
      ['i0003', 'i0004', 'i0005'],
    );
    assert.equal(rail.rows[0]?.rank, null);
  });

  it('addresses the ranks that exist and invents none for the ones that do not', () => {
    const rail = railWindow(document);
    // Eight ranked slots among ten rows, and the ranks run 1..8 with no gap:
    // a held slot consumes a position, not a number.
    assert.equal(rail.total, 10);
    for (let rank = 1; rank <= 8; rank += 1) assert.ok(rail.addressOf(rank) !== undefined);
    assert.equal(rail.addressOf(9), undefined);
    assert.equal(rail.addressOf(0), undefined);
  });
});

describe('windowing keeps every issue and drops only what layer 1 could not draw', () => {
  const document = backlogOf(20, {
    unitOf: { i0004: 'i0003' },
    edges: [
      ['blocked-by', 'i0001', 'i0015'],
      ['together-with', 'i0003', 'i0004'],
    ],
  });

  it('keeps an edge onto an undrawn row, and the issue it points at', () => {
    const rail = railWindow(document, { start: 0, count: 2 });
    // `i0001` is drawn and owes a badge, so the edge survives — and `i0015`
    // survives with it, or the viewer would drop the edge with a diagnostic.
    assert.ok(
      rail.document.edges.some((edge) => edge.field === 'blocked-by' && edge.to === 'i0015'),
    );
    assert.ok(rail.document.issues.some((issue) => issue.key === 'i0015'));
  });

  it('leaves no issue both unplaced and edgeless, at any window', () => {
    // The rule the whole-issue-list version broke: the linear projection counts
    // the keys that appear in no slot and on no edge and prints that count to
    // the reader, so an edgeless issue outside the window read as ISOLATED.
    // Every surviving issue must be placed, excluded, or on an edge.
    for (const options of [{ count: 1 }, { start: 5, count: 3 }, { start: 18, count: 2 }, {}]) {
      const rail = railWindow(document, options);
      const placed = new Set(rail.rows.flatMap((slot) => slot.members));
      const excluded = new Set(rail.document.order.excluded.map((one) => one.key));
      const onAnEdge = new Set(rail.document.edges.flatMap((edge) => [edge.from, edge.to]));
      assert.deepEqual(
        rail.document.issues
          .map((issue) => issue.key)
          .filter((key) => !placed.has(key) && !excluded.has(key) && !onAnEdge.has(key)),
        [],
        JSON.stringify(options),
      );
    }
  });

  it('drops an edge no drawn row owes a badge for', () => {
    const rail = railWindow(document, { start: 10, count: 2 });
    assert.deepEqual(
      rail.document.edges.filter((edge) => edge.to === 'i0015' && edge.from === 'i0001'),
      [],
    );
  });

  it('drops a together-with whose unit fell outside the window, and counts it', () => {
    // Layer 1 draws that edge as an ENCLOSURE around one slot's members, so a
    // unit outside the window has nothing to draw it and the viewer would
    // report a diagnostic about a row nobody asked to see. Reported as a
    // property of the window instead.
    const rail = railWindow(document, { start: 10, count: 4 });
    assert.equal(rail.undrawn, 1);
    assert.deepEqual(
      rail.document.edges.filter((edge) => edge.field === 'together-with'),
      [],
    );
  });

  it('keeps it when the unit IS drawn', () => {
    const rail = railWindow(document, { start: 0, count: 5 });
    assert.equal(rail.undrawn, 0);
    assert.equal(
      rail.document.edges.filter((edge) => edge.field === 'together-with').length,
      1,
    );
  });
});

describe('the lookups cannot be reached and mutated', () => {
  it('answers through a closure rather than handing out its index', () => {
    // The same shape as `AuditOverlay.rowFor`, and for the same reason: a live
    // index handed out can be cleared, after which the lookups and `total`
    // disagree about what the order contains.
    const rail = railWindow(backlogOf(5));
    assert.equal(typeof rail.addressOf, 'function');
    assert.equal(typeof rail.offsetOf, 'function');
    assert.equal(
      Object.values(rail).some((value) => value instanceof Map || value instanceof Set),
      false,
    );
  });

  it('is pure: the same document and window twice give the same rows', () => {
    const once = railWindow(backlogOf(40), { start: 5, count: 7 });
    const twice = railWindow(backlogOf(40), { start: 5, count: 7 });
    assert.deepEqual(once.rows, twice.rows);
    assert.deepEqual(once.document, twice.document);
  });
});
