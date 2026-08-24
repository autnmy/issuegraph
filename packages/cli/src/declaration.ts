/**
 * Four named states for one issue body, and the classifier that tells them apart.
 *
 * The reader distinguishes more outcomes than `data !== null` can carry, and the
 * gap between them is the defect this whole package exists to close: a block that
 * was found but not fully read comes back with `data` NON-NULL and a field
 * silently rejected. `blocked-by:` with unquoted `- #123` items is the canonical
 * example — a plain YAML load reads `#` as a comment, so an issue with two hard
 * blockers presents as an issue with none.
 *
 * So the states are named, all four, and the name always travels with the answer:
 *
 * | state    | what it means                                              |
 * |----------|------------------------------------------------------------|
 * | `read`   | a delimited block, fully read                               |
 * | `absent` | no block at all — a valid issue that declares no edges      |
 * | `inert`  | a key is present but no `---` pair delimits it              |
 * | `unread` | a DELIMITED block, and something inside it could not be read|
 *
 * THE `unread` ARM CARRIES NO `data` FIELD, and that is a mechanism rather than
 * tidiness: a caller holding an unread result cannot reach edges by any
 * type-safe path, so the type system enforces at compile time what the exit code
 * enforces at the process boundary. An optional-but-undefined `data` would let a
 * caller write `decl.data?.blockedBy ?? []` and land back on the empty list this
 * module exists to refuse.
 *
 * RECOGNITION IS DELEGATED, NEVER RE-DERIVED. `isUnreadDeclaration` and
 * `blockDefect` are the reader's own answers; matching diagnostic PROSE would
 * fail open the moment a message is reworded, which the reader's documentation
 * warns about explicitly.
 */

import { isUnreadDeclaration } from '@issuegraph/reader';
import type { BlockDefect, Frontmatter, ParseResult } from '@issuegraph/reader';

/** The name of a declaration state. */
export type DeclarationState = 'read' | 'absent' | 'inert' | 'unread';

/**
 * One body's declaration, classified.
 *
 * A discriminated union rather than a record with optional fields, so that
 * "which states carry data" is a property of the type rather than a convention.
 */
export type Declaration =
  | {
      readonly state: 'read';
      /** Present ONLY on this arm. */
      readonly data: Frontmatter;
      readonly diagnostics: readonly string[];
    }
  | {
      readonly state: 'absent';
      readonly diagnostics: readonly string[];
    }
  | {
      readonly state: 'inert';
      /** Which block-level defect left it undelimited. */
      readonly blockDefect: BlockDefect;
      readonly diagnostics: readonly string[];
    }
  | {
      readonly state: 'unread';
      readonly diagnostics: readonly string[];
    };

/**
 * Classify one {@link ParseResult}.
 *
 * THE ORDER OF THESE TESTS IS THE WHOLE CORRECTNESS ARGUMENT. `unread` is asked
 * FIRST, because the hazard row is non-null `data` WITH diagnostics: any
 * classifier that reaches for `data !== null` before asking the unread question
 * reports the hazard as `read` and hands back the empty edge list. The tests pin
 * this ordering directly rather than only its consequences.
 *
 * The four arms are exhaustive over the reader's documented rows:
 * `isUnreadDeclaration` is `diagnostics.length > 0 && blockDefect === null`, so
 * anything left carrying diagnostics necessarily has a defect and is `inert`;
 * anything left is a clean parse, which is `read` or `absent` by whether the
 * block existed.
 */
export function classifyDeclaration(parse: ParseResult): Declaration {
  if (isUnreadDeclaration(parse)) {
    return { state: 'unread', diagnostics: parse.diagnostics };
  }
  if (parse.blockDefect !== null) {
    return { state: 'inert', blockDefect: parse.blockDefect, diagnostics: parse.diagnostics };
  }
  if (parse.data !== null) {
    return { state: 'read', data: parse.data, diagnostics: parse.diagnostics };
  }
  return { state: 'absent', diagnostics: parse.diagnostics };
}

/**
 * The named error a caller sees on stderr when a declaration could not be read.
 *
 * `unread declaration` is the NAME — stable, greppable, and the thing a caller
 * keys on. Everything after it is detail that may be reworded, which is why the
 * name comes first and the count and diagnostics follow.
 */
export function unreadErrorLines(diagnostics: readonly string[]): readonly string[] {
  const count = diagnostics.length;
  return [
    `issuegraph: unread declaration — a delimited block was found and ${count} ` +
      `${count === 1 ? 'entry' : 'entries'} could not be read; refusing to report edges`,
    ...diagnostics.map((d) => `  ${d}`),
  ];
}
