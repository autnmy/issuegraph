/**
 * The exit-code table.
 *
 * A command's exit code describes THE COMMAND'S OUTCOME, never the declaration's
 * state. The state is always named in the JSON on stdout, which frees the code
 * to carry the decision — and the decision is what a caller in a shell, a
 * workflow, or a GitHub Action can actually branch on without parsing anything.
 *
 * The one code worth understanding before any other is {@link EXIT.unreadDeclaration}.
 * A body whose block was found but could not be fully read is NOT a body with no
 * edges, and a tool that returns `0` for both has told the caller a falsehood it
 * has no way to detect. That code is the process-level half of the distinction;
 * the omitted `data` field is the value-level half. Neither substitutes for the
 * other: a shell reads the code, a program reads the value.
 */

/**
 * Every exit code this package can produce, by name.
 *
 * `1` is deliberately reserved for an unexpected error rather than assigned a
 * meaning. Node exits `1` on an uncaught throw whatever we do, so giving that
 * value a domain meaning would make a crash indistinguishable from a verdict —
 * the same collapse this table exists to prevent one row down.
 */
export const EXIT = Object.freeze({
  ok: 0,
  internal: 1,
  usage: 2,
  unreadDeclaration: 3,
  refusedWrite: 4,
  inertDeclaration: 5,
} as const);

/** A name in {@link EXIT}. */
export type ExitName = keyof typeof EXIT;

/** A numeric exit code this package can produce. */
export type ExitCode = (typeof EXIT)[ExitName];

/**
 * What each code means, for `--help` and the README.
 *
 * Typed as a TOTAL record over {@link ExitName} rather than a list, so adding a
 * code without documenting it is a compile error instead of a gap somebody
 * notices in review. The `--help` test iterates this, so the printed table
 * cannot drift from the codes either.
 */
export const EXIT_MEANING: Readonly<Record<ExitName, string>> = Object.freeze({
  ok: 'the command answered',
  internal: 'an unexpected error escaped; a bug in this package',
  usage: 'unknown verb or option, missing required input, or unreadable input file',
  unreadDeclaration:
    'a delimited block was found and something inside it could not be read; edges were NOT reported',
  refusedWrite: 'the write was declined — there was no block to edit, or the edit was not representable',
  inertDeclaration: 'a block key is present but no `---` pair delimits it, so nothing reads it',
});

/** The codes in numeric order, for rendering. */
export const EXIT_NAMES_BY_CODE: readonly ExitName[] = Object.freeze(
  (Object.keys(EXIT) as ExitName[]).sort((a, b) => EXIT[a] - EXIT[b]),
);

/**
 * What a verb returns: the bytes for each stream and the code, as a VALUE.
 *
 * The verbs perform no I/O at all — the binary writes. That is what makes every
 * verb directly testable without spawning a process, and it is why the same
 * functions are usable from a run that imports this package rather than
 * executing it.
 */
export interface VerbResult {
  /** Written to stdout verbatim. The answer, and nothing else. */
  readonly stdout: string;
  /** Written to stderr, one line each. Diagnostics, warnings, named errors. */
  readonly stderr: readonly string[];
  readonly code: ExitCode;
}
