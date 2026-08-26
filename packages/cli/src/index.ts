/**
 * `@issuegraph/cli` — one command over the Issuegraph packages, and the library
 * it is built from.
 *
 * Install it for the binary:
 *
 * ```sh
 * npm install -g @issuegraph/cli
 * issuegraph parse < issue-body.md
 * ```
 *
 * Import it when you are already in a process and would rather not spawn one.
 * Every verb is a pure function from text to a {@link VerbResult} — the stdout
 * bytes, the stderr lines, and the exit code — so the answer a shell sees and
 * the answer a program sees are produced by the same code.
 *
 * THE BOUNDARY. The outermost input and output is the TICKET BODY. Nothing here
 * reaches the network, holds a credential, or knows what a tracker is. Closure
 * state, labels and assignee counts are INPUTS you supply to `order`, never
 * things this package fetches — which is exactly what lets the binary run inside
 * a workflow holding issue bodies and no token.
 *
 * IT PARSES NOTHING. Reading is `@issuegraph/reader`, ordering is
 * `@issuegraph/derive`, editing is `@issuegraph/writer`, and the vocabulary is
 * `@issuegraph/core`. This package composes them and adds one thing of its own:
 * the four-state answer to "what is this body's declaration", and the exit code
 * that carries it across a process boundary.
 *
 * THE STATE THAT MATTERS. An absent block and a malformed one are different
 * facts, and a tool that returns the same thing for both licenses a false
 * conclusion the caller cannot detect. See {@link classifyDeclaration}.
 *
 * This module is side-effect free and runs no command on import. The binary is a
 * separate entry (`bin`), which is why importing this package can never execute
 * one.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

export { classifyDeclaration, unreadErrorLines } from './declaration.ts';
export type { Declaration, DeclarationState } from './declaration.ts';

export { EXIT, EXIT_MEANING, EXIT_NAMES_BY_CODE } from './exit.ts';
export type { ExitCode, ExitName, VerbResult } from './exit.ts';

export { VERB_NAMES, VERBS, helpText, parseArgv } from './argv.ts';
export type { InputKind, OptionSpec, ParsedArgv, VerbName, VerbSpec } from './argv.ts';

export { dispatch, help } from './run.ts';
export type { ResolvedInputs } from './run.ts';

export { REF_SPELLINGS, resolveRef } from './refs.ts';

export { parseBody } from './verbs/parse.ts';
export { validateBody } from './verbs/validate.ts';
export { asOrderInput, deriveOrder, orderFromJson, InputError } from './verbs/order.ts';
export type { OrderInputDocument, OrderInputIssue, OrderView } from './verbs/order.ts';
export { backfill, setFields, spliceEdges } from './verbs/write.ts';
export type { BackfillOptions } from './verbs/write.ts';
export type { SetFields } from './verbs/write.ts';
