/**
 * Bodies whose classification is the point, shared by every test that needs one.
 *
 * They are kept here rather than inlined per test because the SAME bodies have
 * to travel to the process-level tests, which spawn the built binary and cannot
 * import a test file. A drifted copy of {@link HAZARD_BODY} would leave the unit
 * tests and the process tests proving things about two different inputs, and the
 * process test is the one that discharges the requirement.
 */

/**
 * THE HAZARD. Two hard blockers, declared inside a proper `---` pair, in the
 * unquoted block-sequence form.
 *
 * A plain YAML load reads `#` as opening a comment, so it produces `[None, None]`
 * — successfully, silently, and empty. An issue with two blockers reads as an
 * issue with none, and blocked work is handed to whoever asked.
 *
 * Measured against `@issuegraph/reader`: `data` comes back NON-NULL with an empty
 * `blockedBy`, two diagnostics, `blockDefect: null`, and `isUnreadDeclaration`
 * true. Only the last of those tells the truth, which is why nothing here reads
 * `data` to decide.
 */
export const HAZARD_BODY = ['---', 'issuegraph:', '  blocked-by:', '    - #123', '    - #124', '---', '', 'The body.'].join('\n');

/** The control for the hazard: the same two edges, quoted, and therefore readable. */
export const QUOTED_BODY = ['---', 'issuegraph:', '  blocked-by:', '    - "#123"', '    - "#124"', '---', '', 'The body.'].join('\n');

/** A valid issue that declares no edges. Not an error, and not the hazard. */
export const ABSENT_BODY = 'An issue body with no block in it at all.';

/**
 * A key inside a code fence with no `---` pair — the shape hand-authored blocks
 * overwhelmingly take when their author forgets the delimiters. The reader calls
 * it `undelimited` and treats that arm as its loosest rule on purpose, so
 * nothing here may refuse it the way it refuses the hazard.
 */
export const INERT_BODY = ['```', 'issuegraph:', '  blocked-by:', '    - "#1"', '```', '', 'The body.'].join('\n');

/**
 * A DELIMITED block the reader cannot use at all — inline mapping form. It
 * returns `data: null` with a diagnostic, which is `unread` for the same reason
 * the hazard is: the block was there and could not be read. It exists as a
 * fixture to prove the state is not "a field was dropped".
 */
export const UNUSABLE_BODY = ['---', 'issuegraph: hello', '---', '', 'The body.'].join('\n');
// An inline flow mapping (`issuegraph: { together-with: 71 }`) filled this role
// until SPEC 4.2's parser change: it is ordinary YAML and now READS, which is
// the point of that change rather than a regression. A SCALAR under the key is
// still genuinely unusable — it is not the mapping of fields §4.3 describes, so
// reading edges out of it would mean inventing them.

/** The canonical fence-wrapped block this repository's own issues use. */
export const CANONICAL_BODY = [
  '```',
  '---',
  'issuegraph:',
  '  blocked-by:',
  '    - "#7"',
  '  evidence: verified',
  '---',
  '```',
  '',
  'The body.',
].join('\n');
