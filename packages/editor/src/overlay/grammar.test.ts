import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_STATES, type EdgeState, type ProjectedEdge } from '@issuegraph/store';
import { THEME_TOKENS, defaultTheme } from '@issuegraph/viewer';

import {
  HALO_OPACITY,
  OVERLAY_TREATMENTS,
  compositedHues,
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

  it('carries a mark for any treatment the composer has to draw', () => {
    // `doubled` is not rendered by `attachEdgeOverlays` — a second version sits
    // BESIDE the line, and that needs the path's perpendicular, which layer 2
    // does not have. It is therefore a claim about what the COMPOSER draws, and
    // it is only honest while something carries it there.
    //
    // Without this, `stroke: 'doubled'` is exactly the defect an earlier round
    // found in `dash: 'dotted'`: a field declaring a treatment that nothing
    // anywhere renders.
    for (const state of EDGE_STATES) {
      const treatment = treatmentForState(state);
      if (treatment.stroke !== 'doubled') continue;
      assert.ok(
        treatment.marks.includes('second-version'),
        `${state} declares a doubled stroke and carries no mark to draw it`,
      );
    }
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(OVERLAY_TREATMENTS));
  });
});

/**
 * WCAG relative luminance, over a colour composited onto a surface.
 *
 * A SECOND COPY OF THIS MATH, DELIBERATELY. The viewer keeps its own beside its
 * fixtures and says why it is not shipped: "the viewer RENDERS, it does not
 * audit. Shipping a contrast function would invite a host to gate on it." That
 * reasoning applies here too, so this package audits its own claim with its own
 * test-only copy rather than the viewer widening its surface for a consumer.
 *
 * It is `over()` that makes this test say something the viewer's cannot: the
 * viewer measures a token, and a token is not what lands on the screen when the
 * state that uses it draws at half opacity.
 */
function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** `fg` drawn at `alpha` over `bg` — what the compositor actually produces. */
function over(fg: string, bg: string, alpha: number): string {
  const f = Number.parseInt(fg.slice(1), 16);
  const b = Number.parseInt(bg.slice(1), 16);
  const mix = (shift: number): number =>
    Math.round(alpha * ((f >> shift) & 255) + (1 - alpha) * ((b >> shift) & 255));
  return `#${[mix(16), mix(8), mix(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const SURFACES = ['--ig-bg', '--ig-surface', '--ig-surface-2'] as const;

describe('a state hue clears the contrast bar AS RENDERED, not as written', () => {
  it('measures every state hue composited at the opacity its treatment draws with', () => {
    // THE BUG THIS EXISTS FOR: the viewer's theme test measures the token
    // uncomposited, where `#F2555A` reads a comfortable 5.31:1. `invalid` draws
    // at 0.5 opacity, and the composite over the shipped surfaces is 2.18:1 —
    // under the 3:1 non-text bar. The suite asserted an accessibility guarantee
    // the code did not provide.
    //
    // It lives HERE rather than in the viewer because the opacity is declared
    // here. Measuring it there would mean a second copy of a number that this
    // table owns, and the two would drift the first time one was tuned.
    // RANGES OVER EVERY ALPHA THE PACKAGE APPLIES, from `compositedHues()`.
    // An earlier revision walked the treatment table's `opacity` field alone,
    // so the SELECTION HALO — drawn as its own element at its own alpha, in the
    // stylesheet — was the one thing this check could not see, and it was the
    // one measuring 2.0:1.
    for (const { token, alpha } of compositedHues()) {
      const hue = defaultTheme.colors[token as keyof typeof defaultTheme.colors];
      for (const surface of SURFACES) {
        const bg = defaultTheme.colors[surface];
        const ratio = contrastRatio(over(hue, bg, alpha), bg);
        assert.ok(
          ratio >= 3,
          `${token} drawn at ${String(alpha)} opacity on ${surface}: ` +
            `${ratio.toFixed(2)}:1, below the 3:1 non-text minimum`,
        );
      }
    }
  });

  it('covers the halo, which is the alpha that escaped the last version', () => {
    // A positive control on the LIST rather than on the maths. If
    // `compositedHues()` stopped reporting the halo, the assertion above would
    // quietly narrow back to the states and pass on a halo nobody measured.
    const halo = compositedHues().find(({ token }) => token === '--ig-focus');
    assert.ok(halo !== undefined, 'the halo is not in the composited set');
    assert.equal(halo.alpha, HALO_OPACITY);
    assert.ok(HALO_OPACITY < 1, 'a halo at full opacity would need no composite check');
  });

  it('is measuring a real composite, not passing because alpha is always 1', () => {
    // The positive control for the instrument itself. If `over()` were a no-op
    // — or if no state carried an opacity — the assertion above would silently
    // become the viewer's test again, which is the test that already passed
    // while the rendering was non-compliant.
    const ghosted = EDGE_STATES.filter((state) => {
      const { hueToken, opacity } = treatmentForState(state);
      return hueToken !== null && opacity !== null && opacity < 1;
    });
    assert.ok(ghosted.length > 0, 'no state both paints a hue and reduces opacity');
    assert.notEqual(over('#FFFFFF', '#000000', 0.5), '#ffffff', 'over() is not compositing');
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
