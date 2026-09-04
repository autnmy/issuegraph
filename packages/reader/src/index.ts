/**
 * The Issuegraph reader: turn issue bodies into a graph you can schedule from.
 *
 * Two halves, and the split is the point. {@link parseFrontmatter} reads ONE
 * body and answers what that issue declared — including, through
 * {@link isUnreadDeclaration}, whether anything in the block could not be read,
 * and through {@link isUnreadDeclarationFor}, whether anything the CALLER'S OWN
 * fields depend on could not be read. Ask the narrow one when you gate on one
 * field: the broad predicate makes every gate as strict as the most damaged
 * field anywhere in the block.
 * {@link buildModel} takes a SET of parsed issues and derives what the
 * specification says follows from them: the ready set, effective priority,
 * serialize and together components, duplicate resolution and cycles.
 *
 * {@link parseRef} sits underneath both: it answers whether one TOKEN is a
 * legal reference, which is the question a consumer has to settle about its own
 * input before it calls in at all. It is exported so that question has an
 * answer to ask for — re-deriving §4.2's grammar, or round-tripping a token
 * through {@link parseFrontmatter} to see what comes back, are the two things
 * consumers did while it was private.
 *
 * Neither half fetches anything, authenticates anything or writes anything. A
 * host supplies bodies and labels from whatever tracker it has; writing edges
 * back is `@issuegraph/writer`'s job, and the vocabulary both packages share is
 * `@issuegraph/core`.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

export {
  FRONTMATTER_KEY_PATTERN,
  isUnreadDeclaration,
  isUnreadDeclarationFor,
  parseFrontmatter,
  parseRef,
} from './frontmatter.ts';
export type { BlockDefect, Finding, Frontmatter, IssueRef, ParseResult } from './frontmatter.ts';

/**
 * THE BLOCK'S STRUCTURE, shared with `@issuegraph/writer`.
 *
 * A writer edits the block this reader would read — in place, byte-for-byte
 * outside the entries it owns — so it has to locate the same block and the same
 * entries. Spelling those rules twice is how an editor hands back a body its own
 * parser cannot read, so they are stated once, here, and both packages read them
 * from this surface.
 *
 * {@link locateSection} computes its answer from the same `yaml` document the
 * parse uses. It replaces a hand-written line grammar this module used to
 * export (`readMappingEntry`, `topLevelKeyScalar`, `stripComment`), which was a
 * SECOND opinion about what an entry is — and every one of its three questions
 * produced a real defect when answered twice.
 *
 * It is a LOWER-LEVEL surface than {@link parseFrontmatter} and consumers who
 * only want the data should not reach for it.
 */
export { FENCE_CLOSE, FENCE_OPEN, isSectionHeader, locateBlock, locateSection } from './frontmatter.ts';
export type { BlockLocation, SectionField, SectionLocation } from './frontmatter.ts';

export { buildModel, declarerOnlyNode, nodeKey, nodeSourceRepo, priorityLabelValue, refKey } from './model.ts';

/**
 * THE THREE PER-CANDIDATE QUESTIONS, callable one at a time.
 *
 * {@link buildModel} answers these too, and answers them as part of building
 * everything else — declared and effective priority, the promotion worklist,
 * §6.6 cycle detection, and a readiness evaluation of EVERY node in the set. A
 * scheduler asking one of them per candidate therefore paid for the whole
 * corpus once per candidate. These take the layers that answer does not consult
 * out of the price.
 *
 * THEY ARE THE MODEL'S OWN CODE PATH, not a faster approximation of it:
 * `Model.readiness` and {@link evaluateReadiness} are the same function reached
 * two ways, so the two cannot drift. Reach for `buildModel` when you want the
 * whole picture — priority, ordering, cycles, diagnostics — and for these when
 * you have one issue and one question.
 *
 * Closure and claim state are INPUTS on each node (`open`, `assigneeCount`),
 * per the package boundary: nothing here consults a tracker.
 */
export { evaluateReadiness, resolveSerializeGroup, resolveTogetherUnit } from './model.ts';
export type {
  DeclarationRead,
  DeclaredPriority,
  DeclarerOnlyNode,
  Model,
  ModelNode,
  ModelOptions,
  NodeInput,
  ReadinessHold,
  ReadinessHoldCode,
  ReadinessResult,
} from './model.ts';
/**
 * The closed vocabulary `ReadinessHold.code` draws from, as a frozen tuple —
 * exported so a consumer building a filter facet or a legend enumerates the
 * reader's own list rather than restating it.
 */
export { READINESS_HOLD_CODES } from './relations.ts';
