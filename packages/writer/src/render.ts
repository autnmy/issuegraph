/**
 * Rendering the Issuegraph frontmatter block (SPEC §4).
 *
 * The exact inverse of `@issuegraph/reader`'s parser, and every rendering
 * decision below is pinned by a round-trip THROUGH that package rather than
 * through a local restatement of it — which is what stops the two grammars
 * drifting now that they ship separately.
 *
 * THE DEFAULT OUTPUT IS FENCE-WRAPPED. §4.1 permits wrapping the block in a
 * code fence as display armor where the host renders bare frontmatter poorly
 * (a tracker that renders markdown shows a bare `---` block as a broken table),
 * and §4.1 also requires every conforming reader to see through the fence.
 * Bare output is available for hosts that render frontmatter natively.
 *
 * SPELLING CHOICES, each pinned by round-trip:
 *
 *   - Same-repo refs render as BARE INTEGERS. The `#N` spelling needs quoting
 *     inside YAML flow and list contexts — a whitespace-preceded `#` opens a
 *     comment — and quoting is noise the bare form never needs.
 *   - Qualified refs render as unquoted `owner/repo#N`, safe unquoted under the
 *     same rule because no whitespace precedes the `#`.
 *   - Fields render in the SPEC's declaration order, absent fields omitted
 *     entirely; an input with nothing to say renders NO block (`null`), never
 *     an empty `issuegraph:` stub.
 *
 * INPUT IS THE CALLER'S OWN CONTROL-PLANE DATA, not issue text: a writer
 * composes refs from its own records, so a contract violation here is a
 * programmer error and THROWS rather than degrades. A writer that silently
 * dropped an edge would file an issue whose graph lies, which is strictly worse
 * than a loud failure before any write. Reading is the opposite discipline and
 * lives in the other package: `parseFrontmatter` never throws on any input.
 */

import { PRIORITY_MAX, PRIORITY_MIN, isEvidence, isPriority, type Evidence } from '@issuegraph/core';
import type { Frontmatter, IssueRef } from '@issuegraph/reader';

/** The renderable fields — {@link Frontmatter} with every field optional. */
export interface RenderInput {
  readonly blockedBy?: readonly IssueRef[];
  readonly decomposedFrom?: IssueRef | null;
  readonly duplicateOf?: IssueRef | null;
  readonly serializeWith?: IssueRef | null;
  readonly togetherWith?: IssueRef | null;
  readonly priority?: number | null;
  readonly evidence?: Evidence | null;
}

export interface RenderOptions {
  /**
   * Wrap the block in a plain code fence — the §4.1 display armor for hosts
   * that render bare frontmatter poorly. DEFAULT TRUE: the overwhelming
   * majority of callers write issue bodies on such a host.
   */
  readonly fenceWrapped?: boolean;
}

/**
 * The canonical ref spelling — a bare integer same-repo, an unquoted
 * `owner/repo#N` cross-repo — with the render contract's validation throws.
 *
 * Exported because a splice inserts lines into a block this renderer did not
 * write, and those lines must spell refs exactly as it does.
 */
export function renderRef(ref: IssueRef): string {
  if (!Number.isInteger(ref.number) || ref.number < 1) {
    throw new Error(`issuegraph render: ref number must be a positive integer, got ${String(ref.number)}`);
  }
  if (ref.repo === null) return String(ref.number);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(ref.repo)) {
    throw new Error(`issuegraph render: ref repo ${JSON.stringify(ref.repo)} is not owner/repo-shaped`);
  }
  return `${ref.repo}#${String(ref.number)}`;
}

/**
 * Render the issuegraph frontmatter block for one issue body, or `null` when
 * the input carries no fields at all — write nothing rather than an empty stub.
 *
 * The returned string is a complete block, leading `---` through trailing `---`
 * (plus the fence lines in the default wrapped form), ready to prepend to a
 * body with one blank line after it.
 */
export function renderFrontmatter(input: RenderInput, options: RenderOptions = {}): string | null {
  const lines: string[] = [];
  if (input.blockedBy !== undefined && input.blockedBy.length > 0) {
    lines.push('  blocked-by:');
    for (const ref of input.blockedBy) lines.push(`    - ${renderRef(ref)}`);
  }
  if (input.decomposedFrom != null) lines.push(`  decomposed-from: ${renderRef(input.decomposedFrom)}`);
  if (input.duplicateOf != null) lines.push(`  duplicate-of: ${renderRef(input.duplicateOf)}`);
  if (input.serializeWith != null) lines.push(`  serialize-with: ${renderRef(input.serializeWith)}`);
  if (input.togetherWith != null) lines.push(`  together-with: ${renderRef(input.togetherWith)}`);
  if (input.priority != null) {
    if (!isPriority(input.priority)) {
      throw new Error(
        `issuegraph render: priority must be an integer ${String(PRIORITY_MIN)}-${String(PRIORITY_MAX)}, got ${String(input.priority)}`,
      );
    }
    lines.push(`  priority: ${String(input.priority)}`);
  }
  if (input.evidence != null) {
    if (!isEvidence(input.evidence)) {
      throw new Error(`issuegraph render: evidence must be asserted|verified, got ${String(input.evidence)}`);
    }
    lines.push(`  evidence: ${input.evidence}`);
  }
  if (lines.length === 0) return null;
  const block = ['---', 'issuegraph:', ...lines, '---'].join('\n');
  return (options.fenceWrapped ?? true) ? ['```', block, '```'].join('\n') : block;
}

/**
 * The same input as the reader's {@link Frontmatter}, with absent fields
 * normalized to the parser's empty forms — what a round-trip is expected to
 * produce.
 *
 * Exported so the round-trip pin can be asserted BY A CONSUMER, across the
 * package boundary, rather than inside whichever package happens to own both
 * halves. `parseFrontmatter(renderFrontmatter(x))` must equal
 * `expectedParseOfRender(x)`; if the two packages ever disagree about a
 * spelling, that assertion is what goes red.
 */
export function expectedParseOfRender(input: RenderInput): Frontmatter {
  return {
    blockedBy: input.blockedBy ?? [],
    decomposedFrom: input.decomposedFrom ?? null,
    duplicateOf: input.duplicateOf ?? null,
    serializeWith: input.serializeWith ?? null,
    togetherWith: input.togetherWith ?? null,
    priority: input.priority != null && isPriority(input.priority) ? input.priority : null,
    evidence: input.evidence ?? null,
  };
}
