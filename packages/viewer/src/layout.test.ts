import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type ViewerDocument, normalizeDocument } from './document.ts';
import { edgeGeometry, layoutGraph, measureLabel } from './layout.ts';
import { badgeTexts } from './parts.ts';
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

  it('reserves the room a WRAPPED gutter note needs, not one line per note', () => {
    // A hold reason is an arbitrary host string and `.ig-hold` wraps it inside a
    // fixed-width gutter, so charging one line each under-reserved every note
    // that runs to two or three — and the card beneath was drawn over the
    // overflow while the arcs stayed attached to the box the layout thought it
    // had.
    const long =
      'matches none of the ordered queries the repository configures, so the pick order never reaches it at all and it stays outside the order indefinitely';
    const { document } = normalizeDocument({
      issues: [
        { key: 'a', title: 'Ranked', open: true, priority: 2 },
        { key: 'b', title: 'Blocker with a long reason', open: true, priority: 2 },
      ],
      edges: [{ field: 'blocked-by', from: 'a', to: 'b' }],
      order: {
        slots: [
          { rank: 1, lead: 'a', members: ['a'], ready: true, holds: [] },
          {
            rank: null,
            lead: 'b',
            members: ['b'],
            ready: false,
            holds: [{ family: 'tracker', reason: long, label: 'not eligible' }],
          },
        ],
        excluded: [],
      },
      cycles: [],
    });
    const layout = layoutGraph(document, defaultTheme);
    const box = layout.nodes.get('b');
    assert.ok(box !== undefined, 'the blocker is not in the gutter');

    const line = defaultTheme.metrics['--ig-card-line'];
    const inset = defaultTheme.metrics['--ig-space'];
    const wrapped = Math.ceil(measureLabel(defaultTheme, long) / (box.width - inset * 2));
    assert.ok(wrapped > 1, 'the reason fits on one line, so this proves nothing');
    assert.ok(
      box.height >= inset * 2 + wrapped * line,
      `${String(box.height)}px reserved for a note needing ${String(wrapped)} lines`,
    );
  });

  it('gives a claimed-and-running job ONE box, and it is the NOW station', () => {
    // THE ORDINARY CASE, and it went wrong twice in opposite directions. A job
    // is usually running BECAUSE a runner claimed it, so its slot is
    // tracker-held and off the spine by construction: a spine-only test let it
    // take a NOW card AND keep its footer row — two elements for one key, which
    // is the rule `mount` indexes on — and skipping every job that held a slot
    // then left the one issue the panel exists to say is in flight drawn as a
    // generic footer row with no NOW state at all.
    const { document } = normalizeDocument({
      issues: [{ key: 'a', title: 'Claimed and running', open: true, priority: 2 }],
      edges: [],
      order: {
        slots: [
          {
            rank: null,
            lead: 'a',
            members: ['a'],
            ready: false,
            holds: [{ family: 'tracker', reason: 'claimed by this run', label: 'claimed' }],
          },
        ],
        excluded: [],
      },
      cycles: [],
      host: { running: [{ key: 'a', phase: 'Review', elapsed: '3m' }] },
    });
    const layout = layoutGraph(document, defaultTheme);

    assert.deepEqual([...layout.spineOrder], ['a']);
    assert.equal(layout.nodes.get('a')?.now, true, 'the running job carries no NOW state');
    assert.equal(layout.nodes.get('a')?.column, 'spine');
    assert.deepEqual([...layout.footer], [], 'it kept a footer row as well as its station');
  });

  it('aligns a gutter UNIT through the member that touches the spine', () => {
    // Three passes ask the same question about a unit — does it touch the
    // spine, where does it sit, what is beside it — and this one asked it of
    // the LEAD alone. A tracker-held unit reaches the gutter precisely because
    // a NON-LEAD member blocks a ranked row, so the lookup found nothing,
    // dropped the card at the fallback top row, and drew the long cross-row arc
    // this placement pass exists to prevent.
    const { document } = normalizeDocument({
      issues: [
        { key: 'r1', title: 'First rank', open: true, priority: 2 },
        { key: 'r2', title: 'Second rank, blocked through the partner', open: true, priority: 2 },
        { key: 'u', title: 'Unit lead', open: true, priority: 2 },
        { key: 'p', title: 'Unit partner', open: true, priority: 2 },
      ],
      edges: [
        { field: 'together-with', from: 'u', to: 'p' },
        { field: 'blocked-by', from: 'r2', to: 'p' },
      ],
      order: {
        slots: [
          { rank: 1, lead: 'r1', members: ['r1'], ready: true, holds: [] },
          { rank: 2, lead: 'r2', members: ['r2'], ready: true, holds: [] },
          {
            rank: null,
            lead: 'u',
            members: ['u', 'p'],
            ready: false,
            holds: [{ family: 'tracker', reason: 'claimed by another run', label: 'claimed' }],
          },
        ],
        excluded: [],
      },
      cycles: [],
    });
    const layout = layoutGraph(document, defaultTheme);

    assert.equal(layout.nodes.get('u')?.column, 'left');
    assert.equal(
      layout.nodes.get('u')?.y,
      layout.nodes.get('r2')?.y,
      'the unit lined up with the first rank instead of the one it explains',
    );
  });

  it('measures a chip WITH its glyph and its inner gap', () => {
    // A relationship or status chip is a glyph and a label — two children with
    // a gap between them — and two of them were written out by hand and lost
    // their glyph entirely. Both under-measure, and near a row boundary the
    // browser then wraps a chip the packer kept on the previous row: the height
    // omits that whole row and the cards beneath are drawn over it.
    const { document } = normalizeDocument(fixtureDocument);
    // `101` is held, so it carries the two chips that used to lose their glyph.
    const held = document.order.slots.find((slot) => slot.lead === '101');
    assert.ok(held !== undefined);
    const texts = badgeTexts(document, held, document.byKey.get('101'), ['101']);
    assert.ok(
      texts.some((text) => text.startsWith('⊘')),
      'the not-ready chip is measured without its glyph',
    );
    for (const text of texts) {
      assert.ok(text.length > 0, 'a chip measures as nothing at all');
    }
  });

  it('aligns a gutter card with an unslotted NOW station, not just with a slot', () => {
    // `partnerY` searched `order.slots` alone, and an unslotted running job has
    // a spine box of its own — it IS the NOW station. So a gutter card
    // explaining the SECOND of two running jobs could not resolve it, fell back
    // beside the first row, and drew exactly the cross-row arc this placement
    // pass exists to prevent.
    const { document } = normalizeDocument({
      issues: [
        { key: 'n1', title: 'Running first', open: true, priority: 2 },
        { key: 'n2', title: 'Running second', open: true, priority: 2 },
        { key: 'g', title: 'Explains the second one', open: true, priority: 2 },
      ],
      edges: [{ field: 'blocked-by', from: 'n2', to: 'g' }],
      order: { slots: [], excluded: [] },
      cycles: [],
      host: {
        running: [
          { key: 'n1', phase: 'Plan', elapsed: '1m' },
          { key: 'n2', phase: 'Review', elapsed: '2m' },
        ],
      },
    });
    const layout = layoutGraph(document, defaultTheme);

    assert.deepEqual([...layout.spineOrder], ['n1', 'n2']);
    assert.equal(layout.nodes.get('g')?.column, 'left');
    assert.equal(
      layout.nodes.get('g')?.y,
      layout.nodes.get('n2')?.y,
      'the gutter card lined up with the wrong running job',
    );
  });

  it('keeps an unslotted NOW node off the gutters, however many edges touch it', () => {
    // A running job with no slot is placed as the NOW station and is therefore
    // absent from the slot membership the gutter pass skips — so an edge
    // touching it sent it to a gutter as well. In the expanded graph the gutter
    // box then OVERWROTE the spine one and the NOW marker vanished; in compact
    // mode, where the gutters are not drawn, it appeared as a card AND as a
    // footer row. Both are the same fault: one key, two boxes.
    const running: ViewerDocument = {
      issues: [
        { key: 'n', title: 'Running, in no slot', open: true, priority: 2 },
        { key: 'r', title: 'Ranked', open: true, priority: 2 },
      ],
      edges: [{ field: 'blocked-by', from: 'r', to: 'n' }],
      order: {
        slots: [{ rank: 1, lead: 'r', members: ['r'], ready: true, holds: [] }],
        excluded: [],
      },
      cycles: [],
      host: { running: [{ key: 'n', phase: 'Review', elapsed: '4m' }] },
    };
    const { document } = normalizeDocument(running);

    const wide = layoutGraph(document, defaultTheme);
    assert.equal(wide.nodes.get('n')?.column, 'spine', 'the NOW node was moved into a gutter');
    assert.equal(wide.nodes.get('n')?.now, true, 'the gutter pass overwrote the NOW marker');

    const column = layoutGraph(document, defaultTheme, true);
    assert.equal(column.nodes.get('n')?.now, true);
    assert.equal(column.footer.includes('n'), false, 'the NOW node is a card AND a footer row');
  });

  it('counts a gutter UNIT\u2019s notes as well as its members', () => {
    // The unit branch of the height rule returned before the note lines were
    // added, so a tracker-held unit in the gutter overran its box by exactly its
    // own hold reason while its arcs stayed anchored to the shorter geometry. A
    // height rule with an early return is a height rule with a case it forgets.
    const long =
      'claimed by another run, which is still working the second member of this unit and has not reported back';
    const withNote = (reason: string): ViewerDocument => ({
      issues: [
        { key: 'r', title: 'Ranked', open: true, priority: 2 },
        { key: 'u', title: 'Unit lead', open: true, priority: 2 },
        { key: 'p', title: 'Unit partner', open: true, priority: 2 },
      ],
      edges: [
        { field: 'together-with', from: 'u', to: 'p' },
        { field: 'blocked-by', from: 'r', to: 'p' },
      ],
      order: {
        slots: [
          { rank: 1, lead: 'r', members: ['r'], ready: true, holds: [] },
          {
            rank: null,
            lead: 'u',
            members: ['u', 'p'],
            ready: false,
            holds: [{ family: 'tracker', reason, label: 'claimed' }],
          },
        ],
        excluded: [],
      },
      cycles: [],
    });
    const tall = layoutGraph(normalizeDocument(withNote(long)).document, defaultTheme).nodes.get('u');
    const short = layoutGraph(normalizeDocument(withNote('claimed')).document, defaultTheme).nodes.get('u');

    assert.ok(tall !== undefined && short !== undefined, 'the unit is not in the gutter');
    assert.ok(tall.height > short.height, 'a unit card reserved nothing for its own hold reason');
  });

  it('marks the UNIT when the running job is a partner, and sizes a gutter unit whole', () => {
    // Two rules that both read a slot through its lead alone. A together unit
    // is ONE card, so a running partner marks that card rather than taking a
    // station the projection has no room for; and a tracker-held unit that
    // lands in the gutter is drawn with its pill, its enclosure and every
    // member, so sizing it as a single issue put the next gutter card on top of
    // the difference.
    const held = (members: readonly string[]): ViewerDocument => ({
      issues: [
        { key: 'r', title: 'Ranked', open: true, priority: 2 },
        { key: 'u', title: 'Unit lead', open: true, priority: 2 },
        { key: 'p', title: 'Unit partner, which blocks the ranked row', open: true, priority: 2 },
      ],
      edges: [
        { field: 'together-with', from: 'u', to: 'p' },
        { field: 'blocked-by', from: 'r', to: 'p' },
      ],
      order: {
        slots: [
          { rank: 1, lead: 'r', members: ['r'], ready: true, holds: [] },
          {
            rank: null,
            lead: 'u',
            members,
            ready: false,
            holds: [{ family: 'tracker', reason: 'claimed by another run', label: 'claimed' }],
          },
        ],
        excluded: [],
      },
      cycles: [],
    });
    const unit = layoutGraph(normalizeDocument(held(['u', 'p'])).document, defaultTheme).nodes.get('u');

    // It EXPLAINS the order — through its partner — so it is a gutter card
    // rather than a footer row.
    assert.equal(unit?.column, 'left', 'a unit that blocks through its partner went to the footer');
    // AND IT IS SIZED FOR WHAT `nodeCard` DRAWS THERE: the unit pill, and an
    // enclosure holding a title and an identity for each member. Passing the
    // lead alone reserved a single issue's height for all of that, and the next
    // gutter card was placed on top of the difference. Asserted as the floor the
    // markup needs rather than against a sibling, because the only sibling with
    // the same width would be another unit.
    assert.ok(unit !== undefined);
    const line = defaultTheme.metrics['--ig-card-line'];
    const floor =
      defaultTheme.metrics['--ig-space'] * 2 +
      line +
      defaultTheme.metrics['--ig-space-tight'] +
      2 * (defaultTheme.metrics['--ig-space-snug'] * 2 + 2 * line);
    assert.ok(
      unit.height >= floor,
      `${String(unit.height)}px reserved for a two-member unit needing ${String(floor)}px`,
    );
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
