/**
 * §17e's multi-select block, as a spec.
 *
 * > **Multi-select · the other bulk path** — For structure the owner already
 * > knows, selecting a set beats answering questions. Symmetric types apply to
 * > a whole selection at once; directed types need one pick.
 * >
 * > `6 issues selected` · `shift-click or ⇧↓`
 * > `⇄ serialize all 6 together` *one group* · `⧉ ship all 6 as one unit`
 * > *one rank* · `⊘ all blocked by…` *pick 1*
 * >
 * > 6 issues = 6 writes. The confirm states the count and the write is
 * > resumable if some fail.
 *
 * ## It draws a PHASE, and there is no branch it can fall out of
 *
 * `workspace/bulk.ts` owns the lifecycle as a discriminated union, so this file
 * is a total function over that union rather than a ladder of conditions about
 * a plan that may or may not be there. Every phase draws something; none of
 * them draws nothing.
 *
 * ## Words in, markup out
 *
 * Every readable byte comes from {@link BulkWords} or from layer 1's
 * `treatmentFor`, and nothing is concatenated: `element` is the markup
 * primitive, reached through the viewer's public surface, which is the rule
 * `audit/surface.ts` states and the reason a second escaper never appears in
 * this package.
 *
 * ## The counts are the plan's, never recounted here
 *
 * `BulkCounts.writes` is `BatchPlan.count`, which `batch.ts` defines as
 * `proposals.length` precisely so "the confirm cannot state a different number
 * from the one it is about to write". This file passes it through and does no
 * arithmetic on it.
 */

import { type ElementSpec, element, glyphAndLabel, treatmentFor } from '@issuegraph/viewer';
import type { EdgeKind } from '@issuegraph/store';

import { type BulkOffer, type BulkPhase, BULK_OFFERS } from '../workspace/bulk.ts';
import type { BulkCounts, BulkWords } from './bulk-words.ts';

/** What the block is drawn from. Everything it needs, and nothing it can derive. */
export interface BulkInput {
  readonly phase: BulkPhase;
  /** The batch's members: canonicalized to slot leads and de-duplicated. */
  readonly members: readonly string[];
  /**
   * Selected issues the canvas could not mark.
   *
   * ABOVE §17f'S DIRECT TIER THE CANVAS DRAWS CAPSULES, NOT NODES, so there is
   * no keyed element to stamp — and §17e's own premise is a 312-issue backlog,
   * which is above it. Rather than let the two zones silently disagree about a
   * set, the block states the number the canvas is not showing. Zero draws
   * nothing.
   */
  readonly notShown: number;
  /**
   * The workspace's own `clearSelection` word.
   *
   * `WorkspaceWords`' RATHER THAN `BulkWords`', because the control it labels
   * is the panel's — same command, same class — and two words for one control
   * is how a surface comes to say two different things about one act.
   */
  readonly clear: string;
  readonly words: BulkWords;
}

/** The block's root class, so a host can find it and the styles can reach it. */
export const BULK_CLASS = 'ig-bulk';

export function bulkSpec(input: BulkInput): ElementSpec {
  const { phase, words } = input;
  return element('section', { class: BULK_CLASS, 'data-phase': phase.kind }, [
    element('header', { class: 'ig-bulk-head' }, [
      element('p', { class: 'ig-bulk-count' }, [words.selected(input.members.length)]),
      // THE GESTURE HINT IS ALSO ON THE SINGLE-SELECTION PANEL, drawn there by
      // `render.ts`. A hint that lives only inside a block which appears at
      // N>1 is a hint that arrives only after the reader has already performed
      // the gesture, which teaches nobody.
      element('p', { class: 'ig-bulk-gesture' }, [words.gesture]),
      input.notShown === 0
        ? null
        : element('p', { class: 'ig-bulk-unshown' }, [words.notShown(input.notShown)]),
      // THE CLEAR CONTROL SURVIVES INTO THE BLOCK. The N=1 panel draws one, and
      // dropping it here would make deselecting six issues a two-step
      // workaround — click a member down to a singleton, click it again —
      // precisely where one action matters most. Same command, same class, so
      // a host styling one styles both.
      element(
        'button',
        { type: 'button', class: 'ig-inspector-clear', 'data-ig-command': 'clear' },
        [input.clear],
      ),
    ]),
    ...bodyOf(input, phase),
  ]);
}

/**
 * The phase's own content, as the children that follow the header.
 *
 * A TABLE OVER THE UNION rather than a switch inside the spec: each arm is one
 * expression, the union's exhaustiveness is what proves every phase draws, and
 * the enclosing `section` is written once.
 */
function bodyOf(input: BulkInput, phase: BulkPhase): readonly (ElementSpec | null)[] {
  const { words } = input;
  switch (phase.kind) {
    case 'idle':
      return [offersSpec(input)];
    case 'offering':
      return [
        offersSpec(input, phase.offer),
        phase.offer.anchorFrom === 'picked' ? targetSpec(phase.target, words) : null,
        confirmSpec(input, phase.offer, phase.target),
      ];
    case 'planned':
      return [
        element('p', { class: 'ig-bulk-plan' }, [
          words.confirm(countsFor(input, phase.offer, phase.plan.anchor, phase.plan.count)),
        ]),
        control('send-batch', 'ig-bulk-send', words.confirm(countsFor(input, phase.offer, phase.plan.anchor, phase.plan.count))),
        control('bulk-dismiss', 'ig-bulk-cancel', words.cancel),
      ];
    case 'refused':
      return [
        // DRAWN, NEVER THROWN. `planBatch` answers a refusal as a value for
        // exactly this reason: these are things a person can do, so they get a
        // surface rather than an exception.
        element('p', { class: 'ig-bulk-refusal', role: 'alert', 'data-reason': phase.refusal.reason }, [
          words.refusals[phase.refusal.reason],
        ]),
        offersSpec(input, phase.offer),
      ];
    case 'writing':
      return [element('p', { class: 'ig-bulk-writing', role: 'status' }, [words.writing(phase.plan.count)])];
    case 'partial':
      return [
        element('p', { class: 'ig-bulk-partial', role: 'status' }, [words.resume(phase.remainder.count)]),
        // THE REMAINDER IS LISTED, because a resume the reader cannot inspect
        // is a resume they will not trust — and `resumeBatch` keeps every
        // proposal it was not TOLD landed, so the list is also how a reader
        // sees a write being re-offered.
        element(
          'ul',
          { class: 'ig-bulk-owed' },
          phase.remainder.proposals.map((proposal) =>
            element('li', { class: 'ig-bulk-owed-row' }, [
              proposal.op === 'create' ? words.owedEdge(proposal.from, proposal.to) : null,
            ]),
          ),
        ),
        control('resume-batch', 'ig-bulk-send', words.resume(phase.remainder.count)),
        // A PERMANENT REFUSAL NEEDS AN EXIT. See `bulk.ts` — an unlandable
        // proposal produces the identical remainder on every retry, so without
        // this the block would offer the same resume for ever.
        control('bulk-dismiss', 'ig-bulk-cancel', words.dismissRemainder),
      ];
    case 'landed':
      return [
        element('p', { class: 'ig-bulk-landed', role: 'status' }, [words.landed(phase.writes)]),
        control('bulk-dismiss', 'ig-bulk-cancel', words.cancel),
      ];
  }
}

/**
 * §17e's three offers.
 *
 * The GLYPH is layer 1's — `treatmentFor(kind).glyph` is the grammar, and the
 * grammar belongs to the viewer — while the SENTENCE and its consequence hint
 * are the host's. `treatmentFor` answers the format's label (`serialized
 * with`), and the frame draws an action with a consequence (`serialize all 6
 * together` / *one group*); those are different registers and the second is not
 * derivable from the first.
 */
function offersSpec(input: BulkInput, chosen?: BulkOffer): ElementSpec {
  const { words, members } = input;
  return element(
    'ul',
    { class: 'ig-bulk-offers' },
    BULK_OFFERS.map((offer) =>
      element('li', { class: 'ig-bulk-offer', 'data-edge': offer.kind }, [
        element(
          'button',
          {
            type: 'button',
            class: 'ig-bulk-offer-control',
            'data-ig-command': 'choose-offer',
            'data-ig-target': offer.kind,
            // WHICH OFFER IS CHOSEN IS STATE, and `aria-pressed` is how a
            // toggle publishes it — the same answer `headerControls` gives for
            // the projection toggle rather than a class only sighted readers
            // can see.
            'aria-pressed': chosen?.kind === offer.kind ? 'true' : 'false',
          },
          [
            ...glyphAndLabel(glyphOf(offer.kind), words.offer[offer.kind](members.length)),
            element('span', { class: 'ig-bulk-consequence' }, [words.consequence[offer.kind]]),
          ],
        ),
      ]),
    ),
  );
}

function glyphOf(kind: EdgeKind): string {
  return treatmentFor(kind).glyph;
}

/** The directed offer's `pick 1`: which issue the whole selection points at. */
function targetSpec(target: string | null, words: BulkWords): ElementSpec {
  // NESTED, SO THERE IS NO `id` TO COLLIDE. A `for`/`id` pair needs a unique
  // token, and a literal one is duplicated the moment a host mounts two of
  // these surfaces on one page — the second label then points at the first
  // surface's input, which is the exact failure `searchSpec` and
  // `isolatedListId` already record this package refusing to build. Wrapping
  // the input in its own label associates them with no id at all.
  return element('div', { class: 'ig-bulk-target' }, [
    element('label', { class: 'ig-bulk-target-label' }, [
      element('span', { class: 'ig-bulk-target-word' }, [words.pickTarget]),
      element('input', {
        class: 'ig-bulk-target-input',
        type: 'text',
        'data-ig-command': 'bulk-target',
        // `value` RATHER THAN A TEXT CHILD: an input's content is its value
        // attribute, and a child here would render inside a void element.
        value: target ?? '',
      }),
    ]),
  ]);
}

/**
 * The confirm, before a plan exists.
 *
 * ABSENT UNTIL THE OFFER CAN BE PLANNED — a directed offer with no target
 * cannot be, and drawing a confirm that would do nothing is a control that
 * cannot complete the action it advertises.
 */
function confirmSpec(input: BulkInput, offer: BulkOffer, target: string | null): ElementSpec | null {
  if (offer.anchorFrom === 'picked' && target === null) return null;
  return control('bulk-confirm', 'ig-bulk-confirm', input.words.review);
}

/** Counts for the confirm: issues, writes, and the anchor a symmetric star leaves out. */
function countsFor(
  input: BulkInput,
  offer: BulkOffer,
  anchor: string,
  writes: number,
): BulkCounts {
  return {
    issues: input.members.length,
    writes,
    anchor: offer.anchorFrom === 'selection-anchor' ? anchor : null,
  };
}

function control(command: string, className: string, label: string): ElementSpec {
  return element('button', { type: 'button', class: className, 'data-ig-command': command }, [label]);
}
