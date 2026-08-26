/**
 * Creating an edge, as the one thing all three paths do.
 *
 * §17b asks for three **equivalent** create paths — canvas, inspector and
 * keyboard — and is explicit that they are equivalent rather than a primary
 * path with two shortcuts. The inspector is "the only path when the target
 * isn't on canvas", and at any real size most targets are off canvas (§17f:
 * the canvas is a *local* instrument), so a design where drag is the real path
 * and the other two are conveniences is a design that stops working at the
 * size it was built for.
 *
 * ## Equivalence is a property of the SHAPE, not a promise a test keeps
 *
 * The three paths gather the same three facts in different orders:
 *
 *     canvas      source → target → kind      (drag, then the picker at the drop)
 *     inspector   source → kind   → target    ("+ add" → type → issue search)
 *     keyboard    source → kind   → target    (`R` → `1`–`5` → search → `⏎`)
 *
 * So a draft modelled as a SEQUENCE would need three sequences, and "equivalent"
 * would mean three implementations that agree today. This models it as a SET of
 * gathered facts instead: three slots, each filled by its own command, in any
 * order, and the proposal is emitted on whichever transition completes the set.
 * Order-independence stops being a thing to verify and becomes a thing that
 * cannot be otherwise — there is one emitter, and none of the three paths is
 * spelled out here at all.
 *
 * That is also why the draft carries no path identity. A `source` filled by a
 * drag and one filled by `R` are the same fact, and a field recording which
 * arrived would be the difference between the paths growing back — every reader
 * of it a place where one path could start behaving unlike the others. What
 * genuinely differs between them is where the picker is DRAWN, which is
 * geometry and lives in {@link ./placement.ts}, not state.
 *
 * ## One user act, one `Proposal`
 *
 * The same rule `picker/view.ts` keeps for retype and flip. `@issuegraph/store`
 * closed the operation set at four so that one act is one round trip and one
 * undo entry, and a create that emitted twice — or that emitted a delete plus a
 * create — would undo the property the store went out of its way to model.
 *
 * ## Validity is the store's, and stays there
 *
 * A self-edge, a duplicate edge, an unknown issue: `structuralRefusal` owns all
 * of them and answers with an `InvalidCode`. This module proposes; it does not
 * adjudicate. `picker/view.ts` made the same call for `unchanged-kind` and
 * recorded why — a second validity rule out here is a second place for the
 * answer to drift, and the surface a refusal is drawn on already exists.
 */

import type { EdgeKind, IssueRef, Proposal } from '@issuegraph/store';

/**
 * The facts gathered so far. Three slots, filled in any order.
 *
 * `null` means "not yet gathered", which is distinct from any legal value of
 * either field — an issue reference is a non-empty string and a kind is one of
 * five — so no sentinel collides with real data.
 */
export interface CreateDraft {
  /** The issue the relationship is being created FROM. */
  readonly source: IssueRef | null;
  /** The issue it is being created TO. */
  readonly target: IssueRef | null;
  /** Which relationship. `null` until the type picker has answered. */
  readonly kind: EdgeKind | null;
}

/** Nothing gathered. The state before a create starts and after one emits. */
export const IDLE_CREATE_DRAFT: CreateDraft = Object.freeze({
  source: null,
  target: null,
  kind: null,
});

/**
 * One fact arriving, from whichever path gathered it.
 *
 * `begin` is deliberately not "set source": it starts a NEW relationship, so it
 * clears whatever a previous, abandoned draft had gathered. Restarting from a
 * different issue while a half-built draft is open is ordinary — the reader
 * changes their mind about the subject — and carrying the old target into it
 * would create an edge nobody asked for out of two halves of two intentions.
 */
export type CreateCommand =
  | { readonly kind: 'begin'; readonly source: IssueRef }
  | { readonly kind: 'target'; readonly ref: IssueRef }
  | { readonly kind: 'type'; readonly edgeKind: EdgeKind }
  | { readonly kind: 'cancel' };

/**
 * The next draft, and the proposal this transition emitted.
 *
 * `proposal` is `null` on every transition but the completing one. Same shape
 * as the viewer's `NavigationResult` — next state plus the one thing the shell
 * should do — because it is the same job, and a host already reducing one can
 * reduce the other without learning a second protocol.
 */
export interface CreateResult {
  readonly draft: CreateDraft;
  readonly proposal: Proposal | null;
}

/**
 * A completed draft, or `null`.
 *
 * Narrowed through a type guard rather than three `!== null` tests at the call
 * site, so the emission below reads its three fields without a cast — which the
 * strict-TypeScript rule forbids — and the completeness rule lives in one place.
 */
interface CompleteDraft {
  readonly source: IssueRef;
  readonly target: IssueRef;
  readonly kind: EdgeKind;
}

function complete(draft: CreateDraft): CompleteDraft | null {
  const { source, target, kind } = draft;
  if (source === null || target === null || kind === null) return null;
  return { source, target, kind };
}

/**
 * Apply one command. Total, pure, and never mutates what it is given.
 *
 * AN EXHAUSTIVE SWITCH OVER A DISCRIMINATED UNION — the shape `scaleReducer`
 * already uses here and the one branching form `AGENTS.md`'s boundary rule
 * leaves open. Adding a command without a case fails the build rather than
 * silently returning the draft unchanged.
 *
 * The direction a create lands with is the gather order: `from` is the source,
 * `to` is the target. Nothing here infers it. §17b's rule is that direction is
 * STATED rather than guessed, and it is — by the picker, after the edit lands,
 * with a flip beside it, which is one act from correct. That is the same
 * reasoning `picker/view.ts` records for retyping across the directed/symmetric
 * split, and it is why this module does not ask about directedness at all: a
 * symmetric kind keeps the pair too, precisely so an editor knows which issue
 * carries the field.
 */
export function createReducer(draft: CreateDraft, command: CreateCommand): CreateResult {
  const next = ((): CreateDraft => {
    switch (command.kind) {
      case 'begin':
        return { source: command.source, target: null, kind: null };
      case 'target':
        return { ...draft, target: command.ref };
      case 'type':
        return { ...draft, kind: command.edgeKind };
      case 'cancel':
        return IDLE_CREATE_DRAFT;
    }
  })();

  // `cancel` CANNOT emit, and it needs no guard here to be sure of it: it
  // empties the draft, so the completeness test below has nothing to find. An
  // earlier revision carried an explicit early return for it and claimed to be
  // tested — a mutation control disproved that in the only way it can be
  // disproved, by deleting the line and watching every test still pass. It was
  // dead code asserting its own necessity, which is worse than no comment.
  //
  // A withdrawal that fired the edit it withdrew would be the worst possible
  // reading of the key, so the property is still pinned by tests; what changed
  // is that they now pin a structural guarantee rather than a branch.
  const ready = complete(next);
  if (ready === null) return { draft: next, proposal: null };

  // THE DRAFT RESETS ON EMISSION. Left full, the next command to arrive would
  // complete it again and emit a second proposal for one user act — the "two
  // dispatches, two order re-evaluations" the closed operation set exists to
  // prevent. Emission is the end of the draft, not a state it stays in.
  return {
    draft: IDLE_CREATE_DRAFT,
    proposal: { op: 'create', kind: ready.kind, from: ready.source, to: ready.target },
  };
}
