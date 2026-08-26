/**
 * The type picker, as a view model: which kinds an edge can be retyped to,
 * which way round it currently reads, and the single proposal each act emits.
 *
 * ## One user act, one `Proposal`
 *
 * `@issuegraph/store` closed the operation set at four — `create`, `delete`,
 * `retype`, `flip` — and `mutation.ts` says why in as many words: `retype` and
 * `flip` "are their own operations rather than a delete followed by a create,
 * because the design requires a retype to be one operation, one round trip and
 * one undo entry". This module is the surface that emits them, so its whole job
 * is to hand out ONE proposal per affordance. Composing two here would undo the
 * property the store went out of its way to model.
 *
 * ## Directedness is READ, never listed
 *
 * §17b: a directed type renders as a sentence with an explicit flip control,
 * "because 'which way round' is the most common encoding mistake"; a symmetric
 * type shows no flip. Which kinds are which is a fact about the FORMAT, and
 * `@issuegraph/core` already owns it — `isSymmetricEdgeField` over
 * `EDGE_FIELDS`. So this module imports it rather than restating the split.
 *
 * That is why `@issuegraph/core` is a dependency of this package and not only
 * of its two siblings. Core is the layer both the viewer and the store already
 * sit on, and the seam rule in `eslint.config.mjs` refuses a sibling's SUBPATH,
 * never its bare specifier — reaching for the shared foundation is not reaching
 * past a surface. The rejected alternative was a local
 * `const DIRECTED = ['blocked-by', …]`, which is the drifting second
 * implementation the package family removes everywhere else it appears: a sixth
 * field added to the format would leave it silently wrong, and nothing would
 * fail.
 *
 * ## It offers the kind the edge already has, on purpose
 *
 * A picker that hid the current kind would be a SECOND validity rule living out
 * here, and the store already refuses that edit — `structuralRefusal` answers
 * `unchanged-kind` and the record never reaches a `DataSource`. So the option
 * is offered and marked {@link KindOption.current}, which is what a radio group
 * needs anyway: the current value is the checked one. Validity stays in one
 * place, and this module stays presentation.
 *
 * ## Retyping ACROSS the split keeps the pair, and that is a decision
 *
 * A `serialize-with` edge retyped to `blocked-by` becomes directed, and the
 * direction it lands with is the carrier pair the format already recorded —
 * `StoredEdge` keeps that pair even for a symmetric kind, precisely so an
 * editor knows which issue carries the field. Nothing here infers a direction;
 * it carries the one that was already written down.
 *
 * The rejected shape was a per-option PREVIEW: every option carrying the
 * statement it would produce, so the direction is chosen at the same moment as
 * the kind. It was rejected because it doubles what the picker says in order to
 * pre-empt a case the surface already answers — the retype lands, the picker
 * re-derives from the new document, and the direction is then STATED with a
 * flip beside it, one act from correct. §17b's rule is that direction is stated
 * rather than inferred, and it is stated. Revisit this if the flip turns out to
 * be reached often enough to be the real cost.
 *
 * ## It writes no words and holds no state
 *
 * {@link DirectionStatement} is the ordered pair and the kind. The sentence is
 * the host's, for the same reason `change.ts` ships counts rather than prose and
 * `overlay/grammar.ts` ships an `InvalidCode` rather than a message: a default
 * sentence here would be a language choice a consumer could not theme away.
 */

import { EDGE_FIELDS, isSymmetricEdgeField } from '@issuegraph/core';
import {
  type EdgeId,
  type EdgeKind,
  type GraphDocument,
  type IssueRef,
  type Proposal,
  findEdge,
} from '@issuegraph/store';

/**
 * Which way round a relationship reads, as data.
 *
 * `from` and `to` are the edge's own pair, which for a directed kind IS the
 * reading order — `StoredEdge` keeps "A blocked-by B" as `from: A`, `to: B`.
 * The kind travels with them because a pair alone cannot be worded.
 *
 * There is deliberately no `text`. A host renders "#530 is blocked by #602" in
 * its own language and its own word order; see {@link ./words.ts PickerWords}.
 */
export interface DirectionStatement {
  readonly kind: EdgeKind;
  readonly from: IssueRef;
  readonly to: IssueRef;
}

/** One entry in the type picker. */
export interface KindOption {
  readonly kind: EdgeKind;
  /**
   * Whether this kind carries a direction, read from the format rather than
   * decided here. A host uses it to word the option; the picker uses the
   * TARGET's directedness to decide whether a flip control exists at all.
   */
  readonly directed: boolean;
  /**
   * The kind the edge already carries. Presentation only — the store owns
   * whether choosing it is a valid edit, and it refuses it as `unchanged-kind`.
   */
  readonly current: boolean;
  /** The one proposal choosing this option emits. Never two. */
  readonly proposal: Proposal;
}

/**
 * The control that reverses a directed relationship.
 *
 * `null` on a symmetric kind — not "present but disabled". A symmetric edge has
 * no direction to reverse, so a control for it is a claim the format does not
 * make, and the store would refuse the edit as `symmetric-edge` anyway.
 */
export interface FlipControl {
  /** What the relationship would read as afterwards. The reverse pair. */
  readonly reversed: DirectionStatement;
  /** Exactly one proposal. `flip` is an operation, not a delete plus a create. */
  readonly proposal: Proposal;
}

export interface PickerView {
  /** The edge this picker was opened on, whether or not it was found. */
  readonly edgeId: EdgeId;
  /** Every kind in the format's order. Empty only when the edge is gone. */
  readonly options: readonly KindOption[];
  /** `null` for a symmetric kind: there is no direction to state. */
  readonly direction: DirectionStatement | null;
  /** `null` exactly when {@link direction} is. The two travel together. */
  readonly flip: FlipControl | null;
  readonly diagnostics: readonly string[];
}

/** An empty picker, for a target that is not in the document. */
function nothingToPick(edgeId: EdgeId): PickerView {
  return {
    edgeId,
    options: [],
    direction: null,
    flip: null,
    // REPORTED RATHER THAN DRAWN AS AN EMPTY PICKER. A picker with no options
    // and no reason looks like a kind vocabulary that came back empty, and the
    // false conclusion is "this edge can be nothing" rather than "this edge is
    // no longer here". The state is reachable in ordinary use: a sibling write
    // can land a delete of the edge while its picker is open.
    diagnostics: [`${edgeId} is no longer an edge in this document; there is nothing to retype`],
  };
}

/**
 * The picker for one existing edge.
 *
 * Pure and synchronous, and it takes a document rather than a store — which is
 * what makes "emits proposals, never touches a `DataSource`" structural. There
 * is no port in scope here to touch. A host hands the proposals it gets back to
 * `Store.propose`, which is the only thing that dispatches.
 *
 * The create path is not here. It lands with the change that assembles the
 * workspace, alongside the other affordances `index.ts` defers.
 */
export function pickerView(document: GraphDocument, edgeId: EdgeId): PickerView {
  const edge = findEdge(document, edgeId);
  if (edge === undefined) return nothingToPick(edgeId);

  const options = EDGE_FIELDS.map((kind): KindOption => {
    const proposal: Proposal = { op: 'retype', edgeId: edge.id, nextKind: kind };
    return { kind, directed: !isSymmetricEdgeField(kind), current: kind === edge.kind, proposal };
  });

  if (isSymmetricEdgeField(edge.kind)) {
    return { edgeId, options, direction: null, flip: null, diagnostics: [] };
  }

  const proposal: Proposal = { op: 'flip', edgeId: edge.id };
  return {
    edgeId,
    options,
    direction: { kind: edge.kind, from: edge.from, to: edge.to },
    flip: {
      reversed: { kind: edge.kind, from: edge.to, to: edge.from },
      proposal,
    },
    diagnostics: [],
  };
}
