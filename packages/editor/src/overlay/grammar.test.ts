import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_STATES, type EdgeState, type ProjectedEdge } from '@issuegraph/store';
import { THEME_TOKENS } from '@issuegraph/viewer';

import {
  OVERLAY_TREATMENTS,
  type OverlayAffordance,
  overlayFor,
  overlayLabel,
  treatmentForState,
} from './grammar.ts';

/**
 * A projected edge carrying exactly the states named.
 *
 * Built here rather than by driving a store, because the grammar's input is a
 * `ProjectedEdge` and nothing else — feeding it through a store would test the
 * store's projection a second time and make a grammar failure look like a
 * write-ledger failure.
 */
function edgeWith(...states: readonly EdgeState[]): ProjectedEdge {
  return {
    id: 'blocked-by|%23512|%23488',
    kind: 'blocked-by',
    from: '#512',
    to: '#488',
    // Canonical order, which is what `project` guarantees its callers.
    states: EDGE_STATES.filter((state) => states.includes(state)),
    writes: [],
  };
}

describe('the treatment table', () => {
  it('treats every state the store declares', () => {
    // The `satisfies` clause proves this at build time. Asserting it again at
    // run time is what catches a table that type-checks because a state was
    // spelled into it twice, or an entry reached through a widened key.
    assert.deepEqual(Object.keys(OVERLAY_TREATMENTS).sort(), [...EDGE_STATES].sort());
  });

  it('names a hue token the theme actually defines, never a literal colour', () => {
    for (const state of EDGE_STATES) {
      const { hueToken } = treatmentForState(state);
      if (hueToken === null) continue;
      assert.ok(
        THEME_TOKENS.includes(hueToken),
        `${state} paints with ${hueToken}, which the theme does not define`,
      );
    }
  });

  it('never spends an edge-kind hue on a state', () => {
    // The failure this rules out is silent: a host retheming `blocked-by` would
    // recolour "invalid", and an invalid `duplicate-of` would read as a
    // `blocked-by`. That collapses the hue channel the colour-blind-safety
    // claim rests on.
    for (const state of EDGE_STATES) {
      const { hueToken } = treatmentForState(state);
      assert.equal(
        hueToken !== null && hueToken.startsWith('--ig-edge-'),
        false,
        `${state} paints with the relationship token ${String(hueToken)}`,
      );
    }
  });

  it('gives every write state its own place in the line ordering', () => {
    // Two unsettled edits can mark one edge, so "which treatment does the line
    // take" must have ONE answer. Equal precedences would make it depend on
    // iteration order, which is the bug this ordering exists to prevent.
    const write = EDGE_STATES.filter((state) => state !== 'selected');
    const ranks = write.map((state) => treatmentForState(state).precedence);
    assert.equal(new Set(ranks).size, ranks.length, 'two write states share a precedence');
    assert.deepEqual([...ranks].sort((a, b) => a - b), ranks, 'the table is not in severity order');
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(OVERLAY_TREATMENTS));
  });
});

describe('every state, drawn', () => {
  it('draws selection as a halo and never as a line treatment', () => {
    const overlay = overlayFor(edgeWith('selected'));
    assert.equal(overlay.halo, true);
    // The halo is a second stroke beside the line, so an edge that is ONLY
    // selected still shows its own kind at full strength.
    assert.equal(overlay.line, null);
    assert.deepEqual(overlay.marks, []);
  });

  it('draws a pending write at reduced opacity with a marching dash and chips', () => {
    const overlay = overlayFor(edgeWith('pending-write'));
    assert.equal(overlay.line?.opacity, 0.7);
    assert.equal(overlay.line?.dash, 'marching');
    assert.deepEqual(overlay.marks, ['node-chip']);
    // An optimistic draw offers nothing to act on: the write has not settled,
    // so there is nothing yet to retry or discard.
    assert.deepEqual(overlay.affordances, []);
  });

  it('draws a refusal as a dotted ghost carrying its reason', () => {
    const overlay = overlayFor(edgeWith('invalid'));
    assert.equal(overlay.line?.stroke, 'ghost');
    assert.equal(overlay.line?.dash, 'dotted');
    assert.deepEqual(overlay.marks, ['inline-reason']);
    // Nothing to retry — the same edit is refused again.
    assert.equal(overlay.affordances.includes('retry'), false);
  });

  it('draws a rejection as a ghost with a cross, and offers a retry', () => {
    const overlay = overlayFor(edgeWith('failed'));
    assert.equal(overlay.line?.stroke, 'ghost');
    assert.deepEqual(overlay.marks, ['terminal-cross']);
    assert.equal(overlay.affordances.includes('retry'), true);
  });

  it('draws a conflict as a doubled line holding both versions', () => {
    const overlay = overlayFor(edgeWith('conflict'));
    assert.equal(overlay.line?.stroke, 'doubled');
    assert.equal(overlay.marks.includes('second-version'), true);
    assert.equal(overlay.affordances.includes('view-diff'), true);
  });

  it('offers no auto-merge for a conflict, in any spelling', () => {
    // §17b: a conflict offers view-diff, retry-on-latest and discard-mine and
    // NEVER auto-merges. The vocabulary has no `merge` member, so this asserts
    // the property rather than one spelling of it — a merge affordance cannot
    // be stated, not merely is not stated here.
    const offered: readonly OverlayAffordance[] = overlayFor(edgeWith('conflict')).affordances;
    for (const offer of offered) {
      assert.equal(/merge/i.test(offer), false, `${offer} reads as a merge`);
    }
  });

  it('gives an edge with no state no overlay at all', () => {
    const overlay = overlayFor(edgeWith());
    assert.deepEqual(overlay.states, []);
    assert.equal(overlay.line, null);
    assert.equal(overlay.halo, false);
    // `null` rather than an empty string: an empty attribute would still be
    // rendered, and an edge with nothing happening to it should carry no state
    // attribute for a stylesheet to match on.
    assert.equal(overlay.attribute, null);
  });
});

describe('states compose rather than replacing one another', () => {
  it('draws selected and pending-write on their own channels at once', () => {
    // The composition the design names: three independent channels — the
    // viewer's kind treatment, the halo, and the line treatment — and no
    // fifteenth hand-drawn case.
    const overlay = overlayFor(edgeWith('selected', 'pending-write'));
    assert.deepEqual(overlay.states, ['selected', 'pending-write']);
    assert.equal(overlay.halo, true);
    assert.equal(overlay.line, treatmentForState('pending-write'));
    assert.equal(overlay.attribute, 'selected pending-write');
  });

  it('lets the most-settled write state take the line', () => {
    // An edge marked by two unsettled edits: the failure is the thing to say,
    // and the pending edit's marching dash must not paint over it.
    const overlay = overlayFor(edgeWith('pending-write', 'failed'));
    assert.equal(overlay.line, treatmentForState('failed'));
    // The pending state has not been discarded — it is still announced, and its
    // chip is still owed. Only the LINE is exclusive.
    assert.equal(overlay.states.includes('pending-write'), true);
    assert.equal(overlay.marks.includes('node-chip'), true);
  });

  it('resolves the line the same way whichever order the states arrive in', () => {
    const forwards = overlayFor(edgeWith('pending-write', 'conflict'));
    const backwards = overlayFor({
      ...edgeWith('pending-write', 'conflict'),
      states: ['conflict', 'pending-write'],
    });
    assert.equal(forwards.line, backwards.line);
    assert.deepEqual(forwards.states, backwards.states);
  });

  it('de-duplicates affordances two states both offer', () => {
    const overlay = overlayFor(edgeWith('failed', 'conflict'));
    assert.equal(new Set(overlay.affordances).size, overlay.affordances.length);
  });

  it('keeps the canonical state order whatever the projection hands it', () => {
    const overlay = overlayFor({
      ...edgeWith(),
      states: ['conflict', 'selected', 'invalid'],
    });
    assert.deepEqual(overlay.states, ['selected', 'invalid', 'conflict']);
  });
});

describe('the accessible name', () => {
  it('leads with the relationship and follows with the states', () => {
    const overlay = overlayFor(edgeWith('selected', 'pending-write'));
    assert.equal(
      overlayLabel('#512 blocked by #488', overlay),
      '#512 blocked by #488 — selected, writing',
    );
  });

  it('leaves the name of an un-overlaid edge exactly as the viewer wrote it', () => {
    assert.equal(overlayLabel('#512 blocked by #488', overlayFor(edgeWith())), '#512 blocked by #488');
  });
});
