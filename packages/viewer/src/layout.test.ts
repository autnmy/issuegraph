import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeDocument } from './document.ts';
import { edgeGeometry, layoutGraph } from './layout.ts';
import { fixtureDocument } from './testing/fixtures.ts';
import { defaultTheme, extendTheme } from './theme.ts';

const laidOut = (): ReturnType<typeof layoutGraph> =>
  layoutGraph(normalizeDocument(fixtureDocument).document, defaultTheme);

/** The key whose card stands for this one — its own, or its unit's lead. */
function stationOf(
  document: ReturnType<typeof normalizeDocument>['document'],
  key: string,
): string {
  return document.order.slots.find((slot) => slot.members.includes(key))?.lead ?? key;
}

/** Whether both ends of an edge are drawn on ONE card, so it needs no arc. */
function sameStation(
  document: ReturnType<typeof normalizeDocument>['document'],
  edge: { readonly from: string; readonly to: string },
): boolean {
  return stationOf(document, edge.from) === stationOf(document, edge.to);
}

/** Whether a point lies on one of a box's vertical bounds. */
function onVerticalBound(box: { x: number; width: number }, x: number): boolean {
  return Math.abs(x - box.x) < 0.001 || Math.abs(x - (box.x + box.width)) < 0.001;
}

describe('layoutGraph', () => {
  it('is deterministic — two runs produce identical coordinates', () => {
    const first = laidOut();
    const second = laidOut();

    assert.deepEqual([...first.nodes.entries()], [...second.nodes.entries()]);
    assert.equal(first.width, second.width);
    assert.equal(first.height, second.height);
  });

  it('puts one station on the spine per SLOT, in rank order, never one per member', () => {
    // §16b draws a together unit as ONE card with its members listed inside it.
    // A box per member gave the unit two rows of a column whose vertical
    // position IS the rank, so two boxes claimed two ranks for one — and `104`,
    // the fixture's partner, is exactly that case.
    const layout = laidOut();
    // `105` is tracker-held in the fixture, so it earns no rank and is not on
    // the spine at all — see the gutter rule below.
    assert.deepEqual([...layout.spineOrder], ['102', '101', '103']);
    for (const key of layout.spineOrder) {
      assert.equal(layout.nodes.get(key)?.column, 'spine');
    }
    assert.equal(layout.nodes.has('104'), false, 'the unit partner took a box of its own');
    assert.deepEqual([...(layout.slotMembers.get('103') ?? [])], ['103', '104']);
  });

  it('gives every key touched by a kept edge a box, or the station that stands for it', () => {
    // Totality, restated for one-box-per-slot: an endpoint with no bounds has
    // undefined geometry, and an edge whose ends are BOTH inside one unit is
    // drawn on the card rather than as an arc, so it needs none.
    const { document } = normalizeDocument(fixtureDocument);
    const layout = layoutGraph(document, defaultTheme);
    const stationOf = (key: string): string =>
      document.order.slots.find((slot) => slot.members.includes(key))?.lead ?? key;

    for (const edge of document.edges) {
      assert.ok(layout.nodes.has(stationOf(edge.from)), `${edge.from} has no box`);
      assert.ok(layout.nodes.has(stationOf(edge.to)), `${edge.to} has no box`);
    }
  });

  it('sets the spine line where the stations are centred, spanning them and no further', () => {
    // §16c's whole argument turns on sequence having a channel of its own — one
    // vertical line to read down. A line running the full height of the canvas
    // would imply order where the gutters sit; one absent entirely leaves the
    // picture a column of rectangles, which is what the alternatives were
    // rejected for.
    const layout = laidOut();
    const first = layout.nodes.get(layout.spineOrder[0] as string);
    const last = layout.nodes.get(layout.spineOrder[layout.spineOrder.length - 1] as string);
    assert.ok(first !== undefined && last !== undefined);

    assert.ok(layout.spineLineX < first.x, 'the spine runs through the cards, not beside them');
    assert.ok(
      layout.spineLineX > first.x - defaultTheme.metrics['--ig-station-box'] - defaultTheme.metrics['--ig-space'],
      'the spine is further from the cards than a station is wide',
    );
    assert.equal(layout.spineTop, first.y);
    assert.equal(layout.spineBottom, last.y + last.height);
  });

  it('gives a card the height its own contents need, never a fixed row height', () => {
    // The truncation this pass exists to remove came from the other choice: a
    // fixed-height box, a title fitted to it, and an ellipsis. A unit card lists
    // two issues and cannot be the height of a card that lists one.
    const layout = laidOut();
    const unit = layout.nodes.get('103');
    const plain = layout.nodes.get('101');
    assert.ok(unit !== undefined && plain !== undefined);
    assert.ok(unit.height > plain.height, 'a two-member unit is no taller than a single row');
  });

  it('aligns a gutter card with the spine row it explains', () => {
    // Stacking the gutters from the top independently drew a blocker beside an
    // unrelated rank and its arc across every card in between — and the arcs
    // then crossed the spine, which is the one thing this layout exists to
    // prevent.
    const layout = laidOut();
    // `105` is serialize-with `103`, and `103` is the fixture's rank 2.
    assert.equal(layout.nodes.get('105')?.column, 'left');
    assert.equal(layout.nodes.get('105')?.y, layout.nodes.get('103')?.y);
    // `107` is the closed origin `103` was split from, so it sits beside it.
    assert.equal(layout.nodes.get('107')?.column, 'right');
    assert.equal(layout.nodes.get('107')?.y, layout.nodes.get('103')?.y);
  });

  it('sends a runner-held slot to the gutter when it explains a rank, and to the footer otherwise', () => {
    // §16b's left column heading is the test: "Explains the order". A parked
    // issue that blocks a ranked one answers "why isn't my P1 running", so it is
    // drawn beside the spine; one that blocks nothing on the spine explains
    // nothing about it and belongs in the footer group with the duplicates.
    // Drawing either ON the spine gave it a position in a sequence it is not
    // part of, with a dash where its number should be.
    const layout = laidOut();
    assert.equal(layout.spineOrder.includes('105'), false);
    assert.equal(layout.nodes.get('105')?.column, 'left');
    assert.deepEqual([...layout.footer], []);
  });

  it('drops the gutters and the arcs in the column, keeping the spine identical', () => {
    // §16b: at a settings column's width the arcs and both gutters cannot be
    // drawn legibly, so in-column is a spine-only preview with an expand
    // affordance — NOT the same picture squeezed.
    const { document } = normalizeDocument(fixtureDocument);
    const wide = layoutGraph(document, defaultTheme);
    const column = layoutGraph(document, defaultTheme, true);

    assert.equal(column.compact, true);
    assert.ok(column.width < wide.width);
    for (const box of column.nodes.values()) assert.equal(box.column, 'spine');
    assert.deepEqual([...column.spineOrder], [...wide.spineOrder]);
    // Nothing is hidden: what the gutters would have held joins the footer
    // group, which the projection renders beneath the stage.
    for (const key of ['105', 'other/repo#7', '106', '107']) {
      assert.ok(column.footer.includes(key), `${key} vanished in the column`);
    }
  });

  it('puts an open blocker outside the order in the left gutter', () => {
    assert.equal(laidOut().nodes.get('other/repo#7')?.column, 'left');
  });

  it('puts a duplicate and a closed split origin in the right gutter', () => {
    const layout = laidOut();
    assert.equal(layout.nodes.get('106')?.column, 'right');
    assert.equal(layout.nodes.get('107')?.column, 'right');
  });

  it('leaves free channels between the columns', () => {
    const layout = laidOut();
    const columns = [...layout.nodes.values()];
    const occupies = (x: number): boolean =>
      columns.some((box) => x > box.x && x < box.x + box.width);

    assert.equal(occupies(layout.leftChannel), false, 'the left channel is occupied');
    assert.equal(occupies(layout.rightChannel), false, 'the right channel is occupied');
  });

  it('reserves the room the focus ring reaches, not just the enclosure', () => {
    // `:focus-visible` sits `--ig-space-tight` clear of the element and is
    // `--ig-focus-ring` thick, so it extends their SUM outward. The stage hides
    // its vertical overflow, so a margin of `--ig-space-tight` alone clipped the
    // first row's top ring segment — and on a one-row graph the bottom one too.
    // Read from the theme rather than written as 8, so a retheme that moves
    // either token moves this assertion with the layout it is checking.
    const reach =
      defaultTheme.metrics['--ig-space-tight'] + defaultTheme.metrics['--ig-focus-ring'];
    const { document } = normalizeDocument({
      issues: [{ key: 'a', title: 'Only row', open: true, priority: 2 }],
      edges: [],
      order: {
        slots: [{ rank: 1, lead: 'a', members: ['a'], ready: true, holds: [] }],
        excluded: [],
      },
      cycles: [],
    });
    const layout = layoutGraph(document, defaultTheme);
    const box = layout.nodes.get('a');

    assert.ok(box !== undefined);
    assert.ok(box.y >= reach, `row starts at y=${String(box.y)}, inside the ring's ${String(reach)}px reach`);
    assert.ok(
      box.y + box.height + reach <= layout.height,
      'the ring below the last row falls outside the canvas',
    );
  });

  it('moves every coordinate when the theme changes its geometry', () => {
    // The single-sourcing claim: geometry is theme data, so retheming moves the
    // drawing and the stylesheet together rather than only one of them.
    const taller = extendTheme(defaultTheme, { metrics: { '--ig-card-line': 36 } });
    const base = laidOut();
    const other = layoutGraph(normalizeDocument(fixtureDocument).document, taller);

    assert.notEqual(base.height, other.height);
    assert.notEqual(base.nodes.get('101')?.y, other.nodes.get('101')?.y);
  });
});

describe('edgeGeometry', () => {
  it('terminates on a node bound at both ends, never inside a box', () => {
    const { document } = normalizeDocument(fixtureDocument);
    const layout = layoutGraph(document, defaultTheme);

    for (const edge of document.edges) {
      // AN EDGE INSIDE ONE UNIT HAS NO ARC. Both ends are on the same card, so
      // the card lists them and the badge row names the relationship — the same
      // treatment the list projection gives it.
      if (sameStation(document, edge)) continue;
      const geometry = edgeGeometry(layout, edge);
      assert.ok(geometry !== null, `${edge.from} -> ${edge.to} has no geometry`);
      const from = layout.nodes.get(stationOf(document, edge.from));
      const to = layout.nodes.get(stationOf(document, edge.to));
      assert.ok(from !== undefined && to !== undefined);
      assert.ok(onVerticalBound(from, geometry.start.x), `${edge.from} start is not on a bound`);
      assert.ok(onVerticalBound(to, geometry.end.x), `${edge.to} end is not on a bound`);
    }
  });

  it('leaves and enters clear of the station band on the centre line', () => {
    const { document } = normalizeDocument(fixtureDocument);
    const layout = layoutGraph(document, defaultTheme);

    for (const edge of document.edges) {
      if (sameStation(document, edge)) continue;
      const geometry = edgeGeometry(layout, edge);
      assert.ok(geometry !== null);
      const from = layout.nodes.get(stationOf(document, edge.from));
      const to = layout.nodes.get(stationOf(document, edge.to));
      assert.ok(from !== undefined && to !== undefined);
      assert.notEqual(geometry.start.y, from.y + from.height / 2);
      assert.notEqual(geometry.end.y, to.y + to.height / 2);
    }
  });

  it('leaves and enters on the bound FACING the other node', () => {
    // Deciding the side from a box's own column alone put every spine endpoint
    // on the LEFT bound — so an arc to the right gutter left the spine on its
    // far side and had to cross the node to reach its own terminal, occluding
    // exactly the marker the colour-blind-safety claim depends on.
    const { document } = normalizeDocument(fixtureDocument);
    const layout = layoutGraph(document, defaultTheme);

    for (const edge of document.edges) {
      if (sameStation(document, edge)) continue;
      const geometry = edgeGeometry(layout, edge);
      const from = layout.nodes.get(stationOf(document, edge.from));
      const to = layout.nodes.get(stationOf(document, edge.to));
      assert.ok(geometry !== null && from !== undefined && to !== undefined);
      if (from.x === to.x) continue; // same column: the design bows left, tested below

      const fromFacesRight = to.x > from.x;
      assert.equal(
        Math.abs(geometry.start.x - (fromFacesRight ? from.x + from.width : from.x)) < 0.001,
        true,
        `${edge.from} -> ${edge.to} left from the wrong side`,
      );
      assert.equal(
        Math.abs(geometry.end.x - (fromFacesRight ? to.x : to.x + to.width)) < 0.001,
        true,
        `${edge.from} -> ${edge.to} entered from the wrong side`,
      );
    }
  });

  it('bows two spine nodes to the LEFT, which is the design rule for a tie', () => {
    const layout = laidOut();
    const geometry = edgeGeometry(layout, { field: 'blocked-by', from: '101', to: '102' });
    const from = layout.nodes.get('101');

    assert.ok(geometry !== null && from !== undefined);
    assert.equal(geometry.start.x, from.x);
  });

  it('routes a spine-to-spine arc through the left channel', () => {
    const layout = laidOut();
    const geometry = edgeGeometry(layout, { field: 'blocked-by', from: '101', to: '102' });

    assert.ok(geometry !== null);
    assert.match(geometry.d, new RegExp(`Q ${layout.leftChannel.toFixed(2)} `));
  });

  it('routes an arc touching the right gutter through the right channel', () => {
    const layout = laidOut();
    const geometry = edgeGeometry(layout, { field: 'duplicate-of', from: '106', to: '105' });

    assert.ok(geometry !== null);
    assert.match(geometry.d, new RegExp(`Q ${layout.rightChannel.toFixed(2)} `));
  });

  it('orients the terminal along the path tangent rather than a fixed angle', () => {
    const layout = laidOut();
    const up = edgeGeometry(layout, { field: 'blocked-by', from: '105', to: '102' });
    const down = edgeGeometry(layout, { field: 'blocked-by', from: '102', to: '105' });

    assert.ok(up !== null && down !== null);
    assert.notEqual(up.endAngle, down.endAngle);
  });

  it('faces the channel when two nodes share a column', () => {
    // "Face the other node" says nothing about a tie, and defaulting LEFT was
    // right for the spine only by coincidence — the left channel happens to sit
    // left of it. For two LEFT-GUTTER nodes the same channel is on their right,
    // so the default sent both endpoints out of the canvas and dragged the path
    // back across the boxes.
    const { document } = normalizeDocument({
      issues: [
        { key: 'p', title: 'Outside one', open: true, priority: 2 },
        { key: 'q', title: 'Outside two', open: true, priority: 2 },
      ],
      edges: [{ field: 'blocked-by', from: 'p', to: 'q' }],
      order: { slots: [], excluded: [] },
      cycles: [],
    });
    const layout = layoutGraph(document, defaultTheme);
    const geometry = edgeGeometry(layout, { field: 'blocked-by', from: 'p', to: 'q' });
    const from = layout.nodes.get('p');
    const to = layout.nodes.get('q');

    assert.ok(geometry !== null && from !== undefined && to !== undefined);
    assert.equal(from.column, 'left');
    assert.equal(to.column, 'left');
    assert.equal(geometry.start.x, from.x + from.width, 'left it on the far side from the channel');
    assert.equal(geometry.end.x, to.x + to.width, 'entered it on the far side from the channel');
  });

  it('still bows two spine nodes to the left, which is that rule as an instance', () => {
    const layout = laidOut();
    const geometry = edgeGeometry(layout, { field: 'blocked-by', from: '101', to: '102' });
    const from = layout.nodes.get('101');

    assert.ok(geometry !== null && from !== undefined);
    assert.equal(geometry.start.x, from.x);
  });

  it('refuses rather than guesses when a node has no box', () => {
    const layout = laidOut();
    assert.equal(edgeGeometry(layout, { field: 'blocked-by', from: '101', to: 'nope' }), null);
  });
});
