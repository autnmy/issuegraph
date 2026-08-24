/**
 * The Issuegraph reader: turn issue bodies into a graph you can schedule from.
 *
 * Two halves, and the split is the point. {@link parseFrontmatter} reads ONE
 * body and answers what that issue declared — including, through
 * {@link isUnreadDeclaration}, whether anything in the block could not be read.
 * {@link buildModel} takes a SET of parsed issues and derives what the
 * specification says follows from them: the ready set, effective priority,
 * serialize and together components, duplicate resolution and cycles.
 *
 * Neither half fetches anything, authenticates anything or writes anything. A
 * host supplies bodies and labels from whatever tracker it has; writing edges
 * back is `@issuegraph/writer`'s job, and the vocabulary both packages share is
 * `@issuegraph/core`.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

export { FRONTMATTER_KEY_PATTERN, isUnreadDeclaration, parseFrontmatter } from './frontmatter.ts';
export type { BlockDefect, Frontmatter, IssueRef, ParseResult } from './frontmatter.ts';

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
export type {
  DeclarationRead,
  DeclaredPriority,
  DeclarerOnlyNode,
  Model,
  ModelNode,
  ModelOptions,
  NodeInput,
  ReadinessResult,
} from './model.ts';
