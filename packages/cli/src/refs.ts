/**
 * Turn a command-line ref token into an {@link IssueRef} — by ASKING the reader,
 * which now exports the function that reads them.
 *
 * `@issuegraph/reader` accepts three spellings for a reference (`123`, `#123`,
 * `owner/repo#123`). This file used to have two bad options for reaching that
 * rule — re-implement it, or feed a synthetic frontmatter block to
 * `parseFrontmatter` and read the answer back out — and it took the second.
 * That probe worked, but it was a parser invocation standing in for a function
 * call, and it dragged a character allowlist along with it: the token was
 * interpolated into a quoted YAML scalar, so a value carrying a quote or a
 * newline could close the scalar and write lines of its own.
 *
 * `parseRef` removes both. There is no interpolation left, so there is nothing
 * for an allowlist to guard, and the accepted grammar is the reader's by
 * construction rather than by maintenance — it stays identical when the reader's
 * grammar changes, which is the property the probe was bought for in the first
 * place.
 */

import { parseRef } from '@issuegraph/reader';
import type { IssueRef } from '@issuegraph/reader';

/** The spellings, quoted in error messages so a caller sees what to type. */
export const REF_SPELLINGS = '123, #123, or owner/repo#123';

/**
 * Resolve one token, or `null` when the reader does not accept it.
 *
 * `null` rather than a throw: every caller here turns it into a usage error with
 * its own field name attached, and an exception would lose which flag was wrong.
 *
 * THE TRIM IS THIS PACKAGE'S, AND IT IS DELIBERATELY NOT THE READER'S. A shell
 * argument carries whitespace the user never typed — a stray space inside quotes,
 * a line continuation — so trimming a CLI token is reading the caller's intent.
 * `parseRef` refuses to trim for the opposite and equally correct reason: a token
 * inside a QUOTED YAML scalar is bytes the author explicitly asked for, and
 * trimming there would silently rewrite what they wrote. Same rule, different
 * input, and the difference belongs on this side of the boundary.
 */
export function resolveRef(token: string): IssueRef | null {
  return parseRef(token.trim());
}
