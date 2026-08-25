/**
 * Rendering the Issuegraph frontmatter block (SPEC §4).
 *
 * The exact inverse of `@issuegraph/reader`'s parser, and every rendering
 * decision below is pinned by a round-trip THROUGH that package rather than
 * through a local restatement of it — which is what stops the two grammars
 * drifting now that they ship separately.
 *
 * THE DEFAULT OUTPUT IS BARE, WITH A BLANK LINE BEFORE THE CLOSING DELIMITER.
 * §4.1 has always said writers SHOULD write the block bare and permitted a code
 * fence only as an exception, where the tracker's rendering mangles it. This
 * writer used to take that exception by default, and the reason was real: on
 * GFM a closing `---` makes the line above it a setext HEADING, so a bare block
 * rendered as a rule followed by a giant `<h2>` of YAML.
 *
 * A blank line before the closing delimiter removes the mangling — measured
 * against GitHub's renderer, the block then renders as rule / paragraph / rule
 * — so the exception is no longer needed, and taking it costs something real.
 *
 * WHAT THE FENCE COSTS IS THE REVERSE EDGE. A `#`-sigil reference in a bare
 * block is auto-linked by the tracker, which stamps a CROSS-REFERENCE on the
 * target issue. That cross-reference is the only surface anywhere showing what
 * an issue is BLOCKING: §4.3.1 deliberately has no `blocks` field, so a reverse
 * index is otherwise reconstructed by hand. Fenced, bare-integer output renders
 * none of it.
 *
 * SPELLING CHOICES, each pinned by round-trip:
 *
 *   - Refs render with a `#` SIGIL and are ALWAYS QUOTED. The quoting is not
 *     style — it is mandatory, and the reason is the same YAML rule that used
 *     to argue for bare integers: a whitespace-preceded `#` opens a comment.
 *     Measured: `blocked-by: [#9094]` is a PARSE ERROR, and the block-sequence
 *     spelling is worse — `- #9094` parses SUCCESSFULLY to `[null]`, with no
 *     error and no warning, so an unquoted sigil would silently emit a block
 *     declaring no edges. Quoted, both forms parse to the reference.
 *   - Qualified refs render as `"owner/repo#123"`, quoted for consistency with
 *     the same-repo form rather than because they need it.
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

import {
  PRIORITY_MAX,
  PRIORITY_MIN,
  isEvidence,
  isPriority,
  isRefId,
  isRepoQualifier,
  type Evidence,
} from '@issuegraph/core';
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
   * that render bare frontmatter poorly.
   *
   * DEFAULT FALSE, which is a change: it used to default true. The blank line
   * before the closing delimiter is what made bare output render correctly on
   * the host that motivated the fence, and bare output is what auto-links the
   * references. The option stays because §4.1's exception stays: a host whose
   * renderer still mangles the bare form needs it.
   */
  readonly fenceWrapped?: boolean;
}

/**
 * The canonical ref spelling — a quoted `"#123"` same-repo, a quoted
 * `"owner/repo#123"` cross-repo — with the render contract's validation throws.
 *
 * Exported because a splice inserts lines into a block this renderer did not
 * write, and those lines must spell refs exactly as it does.
 *
 * THE ID IS VALIDATED THROUGH `@issuegraph/core`, the same predicate the reader
 * parses with. Spelling the rule here as well would be a second grammar, which
 * is exactly what this specification's own reference implementation must not
 * model — and the bound it carries is the READER'S: an id the reader would
 * refuse must never be rendered, or the edge silently does not exist.
 */
export function renderRef(ref: IssueRef): string {
  if (!isRefId(ref.id)) {
    throw new Error(
      `issuegraph render: ref id ${JSON.stringify(ref.id)} is not a valid tracker identifier`,
    );
  }
  if (ref.repo === null) return `"#${ref.id}"`;
  if (!isRepoQualifier(ref.repo)) {
    throw new Error(`issuegraph render: ref repo ${JSON.stringify(ref.repo)} is not owner/repo-shaped`);
  }
  return `"${ref.repo}#${ref.id}"`;
}

/**
 * Render the issuegraph frontmatter block for one issue body, or `null` when
 * the input carries no fields at all — write nothing rather than an empty stub.
 *
 * The returned string is a complete block, leading `---` through trailing `---`
 * (plus the fence lines when wrapped), ready to prepend to a body with one
 * blank line after it.
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
  // THE BLANK LINE IS STRUCTURAL, not spacing. Without it a markdown renderer
  // reads the closing `---` as a setext heading underline for the line above,
  // turning the last field into an `<h2>`. A trailing blank line inside a
  // frontmatter block is valid YAML, so it costs the parse nothing.
  const block = ['---', 'issuegraph:', ...lines, '', '---'].join('\n');
  return (options.fenceWrapped ?? false) ? ['```', block, '```'].join('\n') : block;
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
