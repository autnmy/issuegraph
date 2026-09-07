import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { edgeIdentity } from '@issuegraph/core';
import { EDGE_STATES, type EdgeState, type ProjectedEdge } from '@issuegraph/store';

import { OVERLAY_TREATMENTS, overlayFor } from './grammar.ts';
import { edgeMarkRequests, marksFor } from './request.ts';

const ID = edgeIdentity('blocked-by', '1', '2');

function projected(...states: readonly EdgeState[]): ProjectedEdge {
  return { id: ID, kind: 'blocked-by', from: '1', to: '2', states, writes: [] };
}

describe('a write state becomes a position, and nothing else crosses', () => {
  it('asks for a placement for every mark the grammar declares', () => {
    // The failure this whole area has had twice is a channel declared in a table
    // and rendered by nothing. So the check is over the TABLE rather than over a
    // list written here: a sixth state, or a fifth mark, fails this rather than
    // silently stopping being drawn.
    for (const state of EDGE_STATES) {
      const declared = OVERLAY_TREATMENTS[state].marks;
      const asked = marksFor(overlayFor(projected(state)));
      assert.equal(
        asked.length,
        declared.length,
        `${state} declares ${String(declared.length)} marks and asks for ${String(asked.length)}`,
      );
    }
  });

  it('names a POSITION and never a state', () => {
    // THE SEAM, checked rather than asserted. Layer 1 receives `companion` and
    // must never receive `conflict`: the moment a state name appears in this
    // request the viewer has learned that one of its consumers is an editor.
    const placements = new Set<string>();
    for (const state of EDGE_STATES) {
      for (const mark of marksFor(overlayFor(projected(state)))) placements.add(mark.placement);
    }
    for (const placement of placements) {
      assert.equal(
        EDGE_STATES.includes(placement as EdgeState),
        false,
        `${placement} is a state name, not a position`,
      );
    }
    assert.deepEqual([...placements].sort(), ['beside', 'both-ends', 'companion', 'terminal']);
  });

  it('takes the hue of the state that DECLARED the mark, not the overlay’s', () => {
    // An edge can be selected and conflicted at once, and the overlay's own
    // `line` carries whichever won on precedence — so reading the tone from
    // there would paint a conflict's companion in the focus colour the moment a
    // reader clicked it.
    const alone = marksFor(overlayFor(projected('conflict')));
    const clicked = marksFor(overlayFor(projected('selected', 'conflict')));
    assert.deepEqual(clicked, alone);
    assert.equal(alone[0]?.tone, OVERLAY_TREATMENTS.conflict.hueToken);
  });

  it('gives a state with no hue of its own no tone to impose', () => {
    // `pending-write` declares no hue: a write in flight on a `blocked-by` is
    // still a `blocked-by`, so the mark inherits the relationship's colour the
    // same way the dashed clone does.
    const marks = marksFor(overlayFor(projected('pending-write')));
    assert.ok(marks.length > 0);
    for (const mark of marks) assert.equal(mark.tone, null);
  });

  it('keys the request the way layer 1 keys its edges', () => {
    // `ProjectedEdge.id` IS `edgeIdentity(field, from, to)` — the same string the
    // viewer publishes on `data-ig-group` — so the two sides agree with no
    // reconstruction and nothing to keep in step.
    const requests = edgeMarkRequests([projected('failed')]);
    assert.deepEqual([...requests.keys()], [ID]);
  });

  it('leaves an edge with no marks OUT rather than mapping it to nothing', () => {
    // `selected` declares no marks — its halo is drawn from the path's own
    // position — so it contributes no key. An absent key and a key with an empty
    // list should not be two ways of saying one thing.
    assert.equal(edgeMarkRequests([projected('selected')]).size, 0);
    assert.equal(edgeMarkRequests([]).size, 0);
  });

  it('asks for a companion exactly when the edge is conflicted', () => {
    // The one state whose entire drawn form beyond its hue is the mark: a
    // conflict is two versions, and one line cannot be two.
    for (const state of EDGE_STATES) {
      const wants = marksFor(overlayFor(projected(state))).some(
        (mark) => mark.placement === 'companion',
      );
      assert.equal(wants, state === 'conflict', `${state} and companion disagree`);
    }
  });

  it('carries the word for a chip and no word for a line', () => {
    // A companion is not a symbol, it is the relationship drawn a second time.
    const chip = marksFor(overlayFor(projected('pending-write')))[0];
    const companion = marksFor(overlayFor(projected('conflict')))[0];
    assert.ok(typeof chip?.glyph === 'string' && chip.glyph.length > 0);
    assert.equal(companion?.glyph, null);
  });
});
