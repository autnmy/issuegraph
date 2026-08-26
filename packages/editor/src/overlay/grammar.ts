/**
 * The edge mutation-state grammar, as data.
 *
 * `@issuegraph/store` already ships the state MODEL — `EDGE_STATES`,
 * `edgeStateOf`, `project` and a `ProjectedEdge` that carries a *list* of
 * states. What was missing is the grammar that draws them, and this is it.
 *
 * ## Overlay, not variant — and why that is a property of this table
 *
 * The design's §17b: *"An edge keeps its type identity (dash + terminal + glyph
 * + hue) and gains a state OVERLAY, so a pending `blocked-by` is still
 * recognisably `blocked-by` and combinations need no new symbols."*
 *
 * Five states and five relationships would be twenty-five hand-drawn cases if a
 * state were a variant of an edge. It is not one here: the viewer's
 * `treatmentFor` supplies the kind on four channels, and this table supplies
 * the state on channels of its own, so a `selected` `pending-write`
 * `blocked-by` composes from three independent sources rather than being a
 * twenty-sixth entry somewhere. That is the same construction `vocabulary.ts`
 * uses for `EDGE_TREATMENTS`, and it is what AGENTS.md's branching-boundary
 * rule asks for: the treatments are a table keyed on state, never a switch.
 *
 * It is declared `satisfies Record<EdgeState, OverlayTreatment>` so a sixth
 * state added to the store fails the BUILD here, rather than rendering as an
 * untreated line nobody notices.
 *
 * ## Two channels, and the reason they cannot be one
 *
 * `selected` is *"the only state that is not about a write"*, and it is drawn
 * as a halo — a mark beside the line rather than a change to it. Every other
 * state paints the line itself. Those are different channels, so a selected
 * pending edge shows both and neither has to win.
 *
 * The write states DO compete for the one line, which is why {@link
 * OverlayTreatment.precedence} exists. Two unsettled edits can mark one edge —
 * `project` accumulates a state per record — so "which treatment does the line
 * take" is a real question with a real answer, and the answer is declared as a
 * number in the table instead of being decided by a comparison written out in
 * code. A reader can see the whole ordering at once, and adding a state means
 * choosing its rank rather than finding the branch that ranks things.
 *
 * ## What this module will not do
 *
 * - **It never re-evaluates the order.** `pending-write` is an optimistic
 *   *draw*; the order does not move until the write lands. Nothing here imports
 *   a deriver, and nothing here can.
 * - **It never invents state.** `invalid` carries the store's `InvalidCode` and
 *   nothing else — the sentence beside the ghost is the host's, keyed off the
 *   code, for the same reason `change.ts` ships counts rather than prose.
 * - **It never replaces a terminal.** The four redundant channels have to
 *   survive every overlay, so the mark vocabulary below has no member that
 *   occupies the terminal's place. `failed` ADDS a ✕ beside the type's own
 *   marker rather than standing in for it.
 */

import { EDGE_STATES, type EdgeId, type EdgeState, type ProjectedEdge } from '@issuegraph/store';

/**
 * What a state does to the edge's own stroke.
 *
 * `halo` is the odd one and is deliberately in the same vocabulary: it is a
 * second stroke drawn behind the line, so naming it here keeps "what happens to
 * the line" answerable from one field.
 */
export type OverlayStroke = 'none' | 'halo' | 'ghost' | 'doubled';

/** A dash the overlay lays over the edge, on top of the kind's own pattern. */
export type OverlayDash = 'marching' | 'dotted';

/**
 * A mark the overlay adds. Every one is ADDITIVE — see the module note.
 *
 * `node-chip` sits on both endpoints rather than on the line, which is what
 * §17b specifies: a write is about the pair, and a chip on the line alone is
 * unreadable once the line is short.
 */
export type OverlayMark = 'node-chip' | 'terminal-cross' | 'inline-reason' | 'second-version';

/**
 * What a host may offer for a state.
 *
 * There is deliberately no `merge`. §17b is explicit that a conflict offers
 * view-diff, retry-on-latest and discard-mine and **never** auto-merges, so the
 * absence is encoded in the vocabulary rather than left to a reviewer to
 * notice: a merge affordance cannot be spelled, not merely should not be.
 */
export type OverlayAffordance = 'retry' | 'discard-mine' | 'view-diff';

export interface OverlayTreatment {
  readonly stroke: OverlayStroke;
  /** The dash laid over the kind's own, or `null` when the state adds none. */
  readonly dash: OverlayDash | null;
  /**
   * The opacity the state draws the edge at, or `null` at full strength.
   *
   * A number rather than a token because it is not a colour: opacity is
   * structural, and a host retheming the palette does not re-decide how ghostly
   * a refused edge is.
   */
  readonly opacity: number | null;
  /**
   * The custom property carrying this state's hue, or `null` when it adds none.
   * Never a literal colour, and never an `--ig-edge-*` token: those name what an
   * edge IS, and spending one here would make a host retheming a relationship
   * silently recolour a state.
   */
  readonly hueToken: string | null;
  readonly marks: readonly OverlayMark[];
  readonly affordances: readonly OverlayAffordance[];
  /**
   * Which treatment the LINE takes when several write states mark one edge.
   * Higher wins. `selected` sits on its own channel and is given `0` because it
   * never competes — see the module note.
   */
  readonly precedence: number;
  /** Announced to a screen reader. The one place this package names a state. */
  readonly label: string;
}

/**
 * The five states, drawn.
 *
 * The precedence order reads: a conflict outranks a rejection outranks a
 * refusal outranks an edit still in flight. It is severity order, and it is
 * also *settledness* order — the further a write got from succeeding, the more
 * the line should say so.
 */
export const OVERLAY_TREATMENTS = Object.freeze({
  selected: {
    stroke: 'halo',
    dash: null,
    opacity: null,
    hueToken: '--ig-focus',
    marks: [],
    affordances: [],
    precedence: 0,
    label: 'selected',
  },
  'pending-write': {
    stroke: 'none',
    dash: 'marching',
    // §17b's number. The edge stays legible — this is an optimistic draw of
    // something that is probably about to be true, not a warning.
    opacity: 0.7,
    hueToken: null,
    marks: ['node-chip'],
    affordances: [],
    precedence: 1,
    label: 'writing',
  },
  invalid: {
    stroke: 'ghost',
    dash: 'dotted',
    opacity: 0.5,
    hueToken: '--ig-state-invalid',
    marks: ['inline-reason'],
    // Nothing to retry: the edit was refused before any write was attempted, so
    // the same edit refuses again. The user changes it or discards it.
    affordances: ['discard-mine'],
    precedence: 2,
    label: 'invalid',
  },
  failed: {
    stroke: 'ghost',
    dash: null,
    opacity: 0.5,
    hueToken: '--ig-state-failed',
    marks: ['terminal-cross'],
    affordances: ['retry', 'discard-mine'],
    precedence: 3,
    label: 'failed',
  },
  conflict: {
    stroke: 'doubled',
    dash: null,
    opacity: null,
    hueToken: '--ig-state-conflict',
    // Both versions are held and drawn. The store keeps the upstream document
    // on the record precisely so this can show one beside the other.
    marks: ['second-version'],
    affordances: ['view-diff', 'retry', 'discard-mine'],
    precedence: 4,
    label: 'conflict',
  },
} as const satisfies Record<EdgeState, OverlayTreatment>);

/** The treatment for a state. Total over the store's state set. */
export function treatmentForState(state: EdgeState): OverlayTreatment {
  return OVERLAY_TREATMENTS[state];
}

/** The attribute an overlaid edge announces its states on. */
export const STATE_ATTRIBUTE = 'data-ig-state';

/**
 * One edge's overlay: every state it carries, resolved into what to draw.
 *
 * The states are kept alongside the resolution rather than thrown away, because
 * a host writing an accessible name needs all of them — "selected, writing" —
 * while the line can only be drawn one way.
 */
export interface EdgeOverlay {
  readonly edgeId: EdgeId;
  /** Every state, in `EDGE_STATES` order. Empty for an edge with no overlay. */
  readonly states: readonly EdgeState[];
  /**
   * The treatment the LINE takes — the highest-precedence write state, or
   * `null` when the edge carries none. `selected` is not a candidate here.
   */
  readonly line: OverlayTreatment | null;
  /** Whether the selection halo is drawn. Orthogonal to {@link line}. */
  readonly halo: boolean;
  /** Every mark owed, in state order, de-duplicated. */
  readonly marks: readonly OverlayMark[];
  /** Every affordance offered, in state order, de-duplicated. Never a merge. */
  readonly affordances: readonly OverlayAffordance[];
  /** The value for {@link STATE_ATTRIBUTE}: the states, space separated. */
  readonly attribute: string | null;
}

/**
 * Fold an edge's states into one overlay.
 *
 * `ProjectedEdge.states` already arrives in `EDGE_STATES` order — `project`
 * canonicalises it so two projections of the same state compare equal — and
 * this preserves that order rather than re-sorting, so a host memoising on the
 * attribute string is not defeated by a second ordering rule appearing here.
 */
export function overlayFor(edge: ProjectedEdge): EdgeOverlay {
  const states = EDGE_STATES.filter((state) => edge.states.includes(state));

  let line: OverlayTreatment | null = null;
  const marks: OverlayMark[] = [];
  const affordances: OverlayAffordance[] = [];

  for (const state of states) {
    const treatment = treatmentForState(state);
    // The halo is a channel of its own, so `selected` contributes no line
    // treatment and cannot lose to — or beat — a write state.
    if (state !== 'selected' && (line === null || treatment.precedence > line.precedence)) {
      line = treatment;
    }
    for (const mark of treatment.marks) if (!marks.includes(mark)) marks.push(mark);
    for (const offer of treatment.affordances) {
      if (!affordances.includes(offer)) affordances.push(offer);
    }
  }

  return {
    edgeId: edge.id,
    states,
    line,
    halo: states.includes('selected'),
    marks,
    affordances,
    attribute: states.length === 0 ? null : states.join(' '),
  };
}

/**
 * The accessible name for an overlaid edge, given the viewer's own name for it.
 *
 * The kind's sentence leads and the states follow, because the relationship is
 * what the edge IS and the state is what is happening to it. A reader who stops
 * after the first clause still has the fact.
 *
 * This is the ONLY English this module produces, and it is state names rather
 * than a reason: an `invalid` edge's sentence is the host's, keyed off the
 * store's `InvalidCode`.
 */
export function overlayLabel(base: string, overlay: EdgeOverlay): string {
  if (overlay.states.length === 0) return base;
  return `${base} — ${overlay.states.map((state) => treatmentForState(state).label).join(', ')}`;
}
