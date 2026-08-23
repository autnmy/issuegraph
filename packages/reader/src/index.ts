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

export { buildModel, declarerOnlyNode, nodeKey, nodeSourceRepo, priorityLabelValue, refKey } from './model.ts';
export type {
  DeclaredPriority,
  DeclarerOnlyNode,
  Model,
  ModelNode,
  ModelOptions,
  NodeInput,
  ReadinessResult,
} from './model.ts';
