/**
 * Turn a command-line ref token into an {@link IssueRef} — WITHOUT owning the
 * grammar.
 *
 * `@issuegraph/reader` accepts three spellings for a reference (`123`, `#123`,
 * `owner/repo#123`) and does not export the function that reads them, so a CLI
 * that wanted `--blocked-by 123` had two options: re-implement the rule, or ask
 * the reader. Re-implementing it is precisely what this package exists not to
 * do, and the failure mode is not hypothetical — two spellings of the same rule
 * drift, and the drift shows up as an edge that renders but does not parse.
 *
 * So the reader is asked. The token is placed into a minimal block and handed to
 * `parseFrontmatter`; whatever comes back IS the answer. The accepted grammar is
 * therefore identical to the reader's by construction rather than by
 * maintenance, and it stays identical when the reader's grammar changes.
 *
 * THE CHARACTER GATE IS NOT THE GRAMMAR. It is an injection guard: the token is
 * interpolated into a quoted YAML scalar, so a value carrying a quote or a
 * newline could close the scalar and write lines of its own. The gate is an
 * allowlist of the characters the three legal spellings use, applied BEFORE the
 * probe; everything it admits is still adjudicated by the reader, which is what
 * keeps it from becoming a second grammar.
 */

import { parseFrontmatter } from '@issuegraph/reader';
import type { IssueRef } from '@issuegraph/reader';

/** Characters the three legal ref spellings are built from. Nothing else reaches the probe. */
const REF_CHARSET = /^[A-Za-z0-9._/#-]+$/;

/** The spellings, quoted in error messages so a caller sees what to type. */
export const REF_SPELLINGS = '123, #123, or owner/repo#123';

/**
 * Resolve one token, or `null` when the reader does not accept it.
 *
 * `null` rather than a throw: every caller here turns it into a usage error with
 * its own field name attached, and an exception would lose which flag was wrong.
 */
export function resolveRef(token: string): IssueRef | null {
  const trimmed = token.trim();
  if (trimmed === '' || !REF_CHARSET.test(trimmed)) return null;

  // A block carrying exactly one entry. `blocked-by` is used because it is the
  // only list field, so a single item comes back as a single-element array and
  // "the reader read it" and "the reader read exactly one" are the same check.
  const probe = ['---', 'issuegraph:', '  blocked-by:', `    - "${trimmed}"`, '---', ''].join('\n');
  const parse = parseFrontmatter(probe);

  // Any diagnostic at all means the reader rejected something. Testing for a
  // diagnostic rather than for an empty list is the same fail-closed rule the
  // rest of this package follows: a dropped item leaves a list that looks like a
  // deliberate absence.
  if (parse.diagnostics.length > 0 || parse.data === null) return null;
  const refs = parse.data.blockedBy;
  return refs.length === 1 ? (refs[0] ?? null) : null;
}
