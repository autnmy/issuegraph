import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { EdgeState, ProjectedEdge } from '@issuegraph/store';
import {
  type ElementSpec,
  type SpecChild,
  type ViewerDocument,
  renderMarkup,
  renderViewer,
} from '@issuegraph/viewer';

import { STATE_ATTRIBUTE, overlayFor } from './grammar.ts';
import { OVERLAY_CLASS, attachEdgeOverlays, renderOverlayMark } from './render.ts';

/**
 * Two issues and one `blocked-by` between them, with an order.
 *
 * Small on purpose: the subject is one edge's overlay, and a fixture with
 * thirty edges makes a failing assertion a search rather than a read.
 */
const DOCUMENT: ViewerDocument = {
  issues: [
    { key: '#488', title: 'The blocker', open: true, priority: 1 },
    { key: '#512', title: 'The blocked', open: true, priority: 2 },
  ],
  edges: [{ field: 'blocked-by', from: '#512', to: '#488' }],
  order: {
    slots: [
      { rank: 1, lead: '#488', members: ['#488'], ready: true, holds: [] },
      {
        // Held by the edge, at the rank it would have taken — the ordinary
        // shape, so the scene under test is one the viewer really draws.
        rank: null,
        lead: '#512',
        members: ['#512'],
        ready: false,
        holds: [{ family: 'graph', reason: 'blocked by #488' }],
      },
    ],
    excluded: [],
  },
};

function projected(...states: readonly EdgeState[]): ProjectedEdge {
  return {
    id: 'blocked-by|%23512|%23488',
    kind: 'blocked-by',
    from: '#512',
    to: '#488',
    states,
    writes: [],
  };
}

/** Every element in a spec tree, root first. */
function walk(spec: ElementSpec): ElementSpec[] {
  const found: ElementSpec[] = [spec];
  for (const child of spec.children ?? ([] as readonly SpecChild[])) {
    if (typeof child !== 'string') found.push(...walk(child));
  }
  return found;
}

function sceneOf(): ReturnType<typeof renderViewer>['scene'] {
  return renderViewer(DOCUMENT, { projection: 'graph' }).scene;
}

function classesOf(spec: ElementSpec): readonly string[] {
  const value = spec.attrs?.['class'];
  return typeof value === 'string' ? value.split(' ') : [];
}

describe('an overlay attaches to the edge the viewer actually drew', () => {
  it('finds it — the positive control for the whole matching scheme', () => {
    // THIS TEST IS THE POINT OF THE FILE. Edge paths publish no identity, so an
    // edge is matched by the accessible name the viewer gives it. The LABEL
    // comes from the viewer's own `treatmentFor`, but the SHAPE of the sentence
    // cannot be imported — so it is pinned here, against a real rendered scene.
    //
    // Without this control a viewer that restyles its edge label would leave
    // the overlays silently ceasing to attach, with every unit test above still
    // green because they never render a viewer at all.
    const { unattached } = attachEdgeOverlays(sceneOf(), [projected('selected')]);
    assert.deepEqual(unattached, [], 'the overlay matched no edge in a scene that draws one');
  });

  it('writes the states onto the edge it matched', () => {
    const { scene } = attachEdgeOverlays(sceneOf(), [projected('selected', 'pending-write')]);
    const overlaid = walk(scene.root).filter(
      (spec) => spec.attrs?.[STATE_ATTRIBUTE] !== undefined && spec.attrs[STATE_ATTRIBUTE] !== null,
    );
    assert.equal(overlaid.length, 1);
    assert.equal(overlaid[0]?.attrs?.[STATE_ATTRIBUTE], 'selected pending-write');
  });

  it('reports an overlay whose edge the scene does not draw, rather than dropping it', () => {
    // An unattached overlay is ordinary — the graph projection has a node
    // budget and falls back to clusters — but it is also what a broken match
    // looks like. The two must not be indistinguishable.
    const absent: ProjectedEdge = { ...projected('failed'), from: '#999', to: '#998' };
    const { unattached } = attachEdgeOverlays(sceneOf(), [absent]);
    assert.equal(unattached.length, 1);
  });

  it('gives the same answer every time, so a re-render is stable', () => {
    // The property a host actually depends on: it renders a FRESH scene on
    // every state change and attaches to that, so two passes over equal input
    // must produce equal output. Determinism, not idempotence — see the note
    // below about what happens if a scene is attached to twice.
    const edges = [projected('selected', 'pending-write')];
    assert.equal(
      renderMarkup(attachEdgeOverlays(sceneOf(), edges).scene.root),
      renderMarkup(attachEdgeOverlays(sceneOf(), edges).scene.root),
    );
  });

  it('reports an already-overlaid scene rather than doubling its labels', () => {
    // ATTACHING TO ITS OWN OUTPUT IS OUT OF CONTRACT, and this pins what
    // happens anyway, because the failure worth ruling out is silent
    // corruption. The overlay rewrites `aria-label` — which is the very key the
    // match reads — so a second pass matches nothing: the scene keeps the
    // overlays it already had, and the edge is reported `unattached` rather
    // than being announced `… — writing — writing`.
    //
    // Recorded as a test rather than left as a comment so the workspace leaf
    // that assembles this finds the boundary already drawn: re-render, then
    // attach. Do not attach twice.
    const edges = [projected('selected', 'pending-write')];
    const once = attachEdgeOverlays(sceneOf(), edges);
    const twice = attachEdgeOverlays(once.scene, edges);

    assert.deepEqual(once.unattached, []);
    assert.equal(twice.unattached.length, 1, 'a second pass silently matched again');
    assert.equal(
      renderMarkup(twice.scene.root),
      renderMarkup(once.scene.root),
      'a second pass changed the scene',
    );
  });

  it('leaves a scene with no overlaid edges byte-identical', () => {
    const before = renderMarkup(sceneOf().root);
    const { scene } = attachEdgeOverlays(sceneOf(), [projected()]);
    assert.equal(renderMarkup(scene.root), before);
  });

  it('leaves every other element of the scene alone', () => {
    const before = walk(sceneOf().root).length;
    const { scene } = attachEdgeOverlays(sceneOf(), [projected('selected')]);
    const after = walk(scene.root);
    // One halo added, and nothing removed.
    assert.equal(after.length, before + 1);
  });
});

describe('the four redundant channels survive every overlay', () => {
  it('never rewrites a terminal marker', () => {
    // The claim the colour-blind-safety argument rests on: an edge keeps its
    // dash, terminal, glyph and hue, and a state is added BESIDE them. Driven
    // over every state rather than a sample, because one state reaching the
    // terminal would be enough to break it.
    //
    // WEAK ON ITS OWN, AND SAID SO RATHER THAN LEFT TO BE DISCOVERED. A
    // mutation that let the walk treat terminals as edges left this green: the
    // viewer gives a terminal no `aria-label`, so the match skips it whatever
    // the guard does. The two tests below are the ones that bite — this one
    // pins the property, they pin the mechanisms.
    const states: readonly EdgeState[] = ['selected', 'pending-write', 'invalid', 'failed', 'conflict'];
    const terminalsBefore = walk(sceneOf().root).filter((spec) =>
      classesOf(spec).includes('ig-terminal'),
    );
    assert.ok(terminalsBefore.length > 0, 'the fixture draws no terminal to protect');

    for (const state of states) {
      const { scene } = attachEdgeOverlays(sceneOf(), [projected(state)]);
      const terminals = walk(scene.root).filter((spec) => classesOf(spec).includes('ig-terminal'));
      assert.deepEqual(
        terminals,
        terminalsBefore,
        `the ${state} overlay changed a terminal marker`,
      );
    }
  });

  it('leaves every terminal painted ON TOP of every mark it adds', () => {
    // THIS is what actually stops an overlay occluding a terminal, and it is a
    // fact about ORDER rather than about attributes: SVG paints in document
    // order, the viewer emits an edge's terminal directly after its paths, and
    // this module inserts its marks at the EDGE's position. So the terminal
    // still paints last and nothing can cover it.
    //
    // A mark appended after the terminal would draw over the arrowhead — the
    // one channel a reader with no colour vision leans on hardest — while
    // every attribute assertion above stayed green.
    for (const state of ['selected', 'pending-write', 'conflict'] as const) {
      const { scene } = attachEdgeOverlays(sceneOf(), [projected(state)]);
      const order = walk(scene.root);
      const lastMark = order.findLastIndex((spec) => classesOf(spec).includes(OVERLAY_CLASS));
      const firstTerminal = order.findIndex((spec) => classesOf(spec).includes('ig-terminal'));
      assert.ok(lastMark >= 0, `${state} added no mark to order`);
      assert.ok(firstTerminal >= 0, 'the fixture draws no terminal');
      assert.ok(
        lastMark < firstTerminal,
        `a ${state} mark is painted after the terminal and can occlude it`,
      );
    }
  });

  it('refuses a terminal even when one is handed to it wearing an edge label', () => {
    // The guard the mutation above could not reach, reached deliberately. The
    // viewer gives terminals no accessible name today, so the guard is defence
    // in depth — but "today" is the whole reason to pin it: a viewer that
    // starts labelling its markers would otherwise silently begin overlaying
    // them, and nothing else in this file would notice.
    const hostile = {
      ...sceneOf(),
      root: {
        tag: 'g',
        children: [
          {
            tag: 'path',
            attrs: { class: 'ig-terminal', 'data-edge': 'blocked-by', 'aria-label': '#512 blocked by #488' },
          },
        ],
      },
    };
    const { scene } = attachEdgeOverlays(hostile, [projected('conflict')]);
    const terminals = walk(scene.root).filter((spec) => classesOf(spec).includes('ig-terminal'));
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0]?.attrs?.[STATE_ATTRIBUTE], undefined, 'the terminal was overlaid');
    assert.equal(
      walk(scene.root).some((spec) => classesOf(spec).includes(OVERLAY_CLASS)),
      false,
      'a mark was drawn against a terminal',
    );
  });

  it('adds the failed cross as its own mark, carrying no relationship identity', () => {
    // `failed`'s ✕ is ADDITIVE. If it carried `data-edge` or the terminal's
    // class it would be competing with the type's marker rather than sitting
    // beside it.
    const cross = renderOverlayMark(overlayFor(projected('failed')), 'terminal-cross');
    assert.equal(classesOf(cross).includes('ig-terminal'), false);
    assert.equal(cross.attrs?.['data-edge'], undefined);
    assert.equal(classesOf(cross).includes(OVERLAY_CLASS), true);
  });

  it('leaves the edge its own dash pattern', () => {
    // The kind's dash is one of the four channels. An overlay that rewrote
    // `stroke-dasharray` on the edge itself would erase it; the marching dash
    // is drawn on a CLONE for exactly that reason.
    const edgeDashBefore = walk(sceneOf().root)
      .filter((spec) => classesOf(spec).includes('ig-edge'))
      .map((spec) => spec.attrs?.['stroke-dasharray']);
    const { scene } = attachEdgeOverlays(sceneOf(), [projected('pending-write')]);
    const edgeDashAfter = walk(scene.root)
      .filter((spec) => classesOf(spec).includes('ig-edge'))
      .map((spec) => spec.attrs?.['stroke-dasharray']);
    assert.deepEqual(edgeDashAfter, edgeDashBefore);
  });

  it('hides every added mark from a screen reader, so nothing is read twice', () => {
    const { scene } = attachEdgeOverlays(sceneOf(), [projected('selected', 'conflict')]);
    const added = walk(scene.root).filter((spec) => classesOf(spec).includes(OVERLAY_CLASS));
    assert.ok(added.length > 0);
    for (const mark of added) {
      assert.equal(mark.attrs?.['aria-hidden'], 'true');
      assert.equal(mark.attrs?.['aria-label'], undefined);
    }
  });

  it('re-announces the states on the edge itself instead', () => {
    const { scene } = attachEdgeOverlays(sceneOf(), [projected('pending-write')]);
    const edge = walk(scene.root).find((spec) => spec.attrs?.[STATE_ATTRIBUTE] === 'pending-write');
    assert.match(String(edge?.attrs?.['aria-label']), /blocked by .* — writing$/);
  });
});

describe('a conflict holds both versions and merges neither', () => {
  it('draws the second version', () => {
    const { scene } = attachEdgeOverlays(sceneOf(), [projected('conflict')]);
    const versions = walk(scene.root).filter((spec) =>
      classesOf(spec).includes('ig-overlay-version'),
    );
    // Two strokes, offset either side — the pair reads as two lines at any
    // scale, which is how the viewer draws `serialize-with`'s double.
    assert.equal(versions.length, 2);
    assert.notEqual(versions[0]?.attrs?.['transform'], versions[1]?.attrs?.['transform']);
  });

  it('offers no affordance that reads as a merge', () => {
    const marks = overlayFor(projected('conflict')).marks.map((mark) =>
      renderMarkup(renderOverlayMark(overlayFor(projected('conflict')), mark)),
    );
    for (const markup of marks) assert.equal(/merge/i.test(markup), false);
  });
});

describe('the inline reason carries a code and never a sentence', () => {
  it('publishes the store code and no English', () => {
    const mark = renderOverlayMark(overlayFor(projected('invalid')), 'inline-reason', 'would-cycle');
    assert.equal(mark.attrs?.['data-ig-code'], 'would-cycle');
    // No text node at all: the host writes the sentence, keyed off the code.
    assert.deepEqual(mark.children ?? [], []);
  });
});

describe('nothing in the module changes state on its own', () => {
  it('starts no timer, driven over every state', () => {
    // The marching dash is a CSS animation, which is what the design asks for.
    // What is banned is a module that advances or dismisses something ITSELF —
    // a chip persists until the write settles, and a settled failure persists
    // until the user acts on it.
    //
    // ASSERTED BY REMOVING THE TIMERS, NOT BY SCANNING FOR THEM. A regex over
    // the source is the instrument `purity.test.ts` records tearing out after
    // it drew four findings across two rounds: a grammar with comments and
    // strings in it cannot be read by a pattern. It fails here in the most
    // embarrassing direction available — the first draft of this test matched
    // the sentence in `render.ts` that PROMISES there is no timer.
    //
    // Removing them instead asks the real question, and it asks it of running
    // code: a call that reached for one gets a TypeError rather than a pattern
    // that has to be kept honest.
    const removed = ['setTimeout', 'setInterval', 'setImmediate', 'requestAnimationFrame'];
    const saved = new Map(
      removed.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const),
    );
    for (const name of removed) {
      Object.defineProperty(globalThis, name, {
        value: undefined,
        configurable: true,
        writable: true,
      });
    }

    try {
      for (const state of ['selected', 'pending-write', 'invalid', 'failed', 'conflict'] as const) {
        const edge = projected(state);
        const overlay = overlayFor(edge);
        attachEdgeOverlays(sceneOf(), [edge]);
        for (const mark of overlay.marks) renderOverlayMark(overlay, mark, 'would-cycle');
      }
      // The composition case too — it is the path that takes both channels.
      attachEdgeOverlays(sceneOf(), [projected('selected', 'pending-write')]);
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor === undefined) {
          Reflect.deleteProperty(globalThis, name);
        } else {
          Object.defineProperty(globalThis, name, descriptor);
        }
      }
    }
  });
});
