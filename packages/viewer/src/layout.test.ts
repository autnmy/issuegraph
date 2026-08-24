import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeDocument } from './document.ts';
import { edgeGeometry, enclosureBounds, layoutGraph } from './layout.ts';
import { fixtureDocument } from './testing/fixtures.ts';
import { defaultTheme, extendTheme } from './theme.ts';

const laidOut = (): ReturnType<typeof layoutGraph> =>
  layoutGraph(normalizeDocument(fixtureDocument).document, defaultTheme);

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

  it('puts every slot member on the spine, in rank order', () => {
    const layout = laidOut();
    assert.deepEqual([...layout.spineOrder], ['102', '101', '103', '104', '105']);
    for (const key of layout.spineOrder) {
      assert.equal(layout.nodes.get(key)?.column, 'spine');
    }
  });

  it('gives every key touched by a kept edge a box', () => {
    // Totality: an endpoint with no bounds has undefined geometry, and this is
    // the invariant that makes `edgeGeometry` unable to return null in practice.
    const { document } = normalizeDocument(fixtureDocument);
    const layout = layoutGraph(document, defaultTheme);

    for (const edge of document.edges) {
      assert.ok(layout.nodes.has(edge.from), `${edge.from} has no box`);
      assert.ok(layout.nodes.has(edge.to), `${edge.to} has no box`);
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

  it('moves every coordinate when the theme changes its geometry', () => {
    // The single-sourcing claim: geometry is theme data, so retheming moves the
    // drawing and the stylesheet together rather than only one of them.
    const taller = extendTheme(defaultTheme, { metrics: { '--ig-row-height': 88 } });
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
      const geometry = edgeGeometry(layout, edge);
      assert.ok(geometry !== null, `${edge.from} -> ${edge.to} has no geometry`);
      const from = layout.nodes.get(edge.from);
      const to = layout.nodes.get(edge.to);
      assert.ok(from !== undefined && to !== undefined);
      assert.ok(onVerticalBound(from, geometry.start.x), `${edge.from} start is not on a bound`);
      assert.ok(onVerticalBound(to, geometry.end.x), `${edge.to} end is not on a bound`);
    }
  });

  it('leaves and enters clear of the station band on the centre line', () => {
    const { document } = normalizeDocument(fixtureDocument);
    const layout = layoutGraph(document, defaultTheme);

    for (const edge of document.edges) {
      const geometry = edgeGeometry(layout, edge);
      assert.ok(geometry !== null);
      const from = layout.nodes.get(edge.from);
      const to = layout.nodes.get(edge.to);
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
      const geometry = edgeGeometry(layout, edge);
      const from = layout.nodes.get(edge.from);
      const to = layout.nodes.get(edge.to);
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

  it('refuses rather than guesses when a node has no box', () => {
    const layout = laidOut();
    assert.equal(edgeGeometry(layout, { field: 'blocked-by', from: '101', to: 'nope' }), null);
  });
});

describe('enclosureBounds', () => {
  it('surrounds every member, padded clear of their bounds', () => {
    const layout = laidOut();
    const bounds = enclosureBounds(layout, ['103', '104'], defaultTheme);

    assert.ok(bounds !== null);
    for (const key of ['103', '104']) {
      const box = layout.nodes.get(key);
      assert.ok(box !== undefined);
      assert.ok(bounds.x < box.x);
      assert.ok(bounds.y < box.y);
      assert.ok(bounds.x + bounds.width > box.x + box.width);
      assert.ok(bounds.y + bounds.height > box.y + box.height);
    }
  });

  it('draws nothing around a slot of one — there is no unit to enclose', () => {
    assert.equal(enclosureBounds(laidOut(), ['101'], defaultTheme), null);
  });
});
