/**
 * The Issuegraph writer: put the frontmatter block into an issue body.
 *
 * Three write modes, and the split is the point.
 * {@link renderFrontmatter} emits a fresh block for a body that has none.
 * {@link spliceGeneratedEdges} refreshes the edges ONE writer owns inside a
 * block other people also write to, leaving every other byte alone.
 * {@link backfillFrontmatter} repairs a block a code fence left inert, by
 * adding the `---` pair its author omitted and changing nothing else.
 *
 * None of them fetches anything, authenticates anything or talks to a tracker:
 * a body goes in and a body comes out. Reading is `@issuegraph/reader`, whose
 * line grammar this package edits through so a writer and a parser cannot
 * disagree about which bytes are a block; the vocabulary both share is
 * `@issuegraph/core`.
 *
 * READING AND WRITING HAVE OPPOSITE ERROR DISCIPLINES, deliberately. A parser
 * takes untrusted issue text and must never throw — every anomaly becomes a
 * diagnostic. A writer takes its caller's own control-plane data, so a contract
 * violation is a programmer error and throws before anything is written: an
 * issue filed with a graph that lies is worse than a loud failure.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

/**
 * The ref shape every write mode takes, re-exported from the reader rather than
 * restated. A second declaration of the same record is a second thing to keep
 * in step, and a consumer should not need two imports to describe one edge.
 */
export type { IssueRef } from '@issuegraph/reader';

export { expectedParseOfRender, renderFrontmatter, renderRef } from './render.ts';
export type { RenderInput, RenderOptions } from './render.ts';

/**
 * The splice's OWNERSHIP DOMAIN is exported alongside the call it governs: which
 * fields {@link spliceGeneratedEdges} can own, and which of those an explicit
 * empty value clears. A consumer that validates a write request before making
 * one needs both answers, and reading them out of a doc comment is how four
 * separate restatements of this rule came to exist. {@link owns} inside the
 * package derives from the same table, so asking it and behaving are the same
 * thing rather than two things that agree today.
 */
export {
  isSpliceOwnedField,
  SPLICE_FIELD_OWNERSHIP,
  SPLICE_OWNED_FIELDS,
  spliceGeneratedEdges,
} from './splice.ts';
export type {
  GeneratedEdges,
  SpliceFieldOwnership,
  SpliceOwnedField,
  SpliceResult,
} from './splice.ts';

export { backfillFrontmatter } from './backfill.ts';
export type { BackfillOutcome, BackfillResult } from './backfill.ts';
