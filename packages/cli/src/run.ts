/**
 * Dispatch: a parsed command line plus its input text, in; a {@link VerbResult}, out.
 *
 * No I/O. The binary reads stdin and files and writes streams; everything that
 * decides an exit code lives here, where a test can call it directly. That split
 * is also what makes the package importable: a run that wants the same answers
 * without spawning a process calls these functions.
 */

import { isEvidence, isPriority } from '@issuegraph/core';
import type { Evidence } from '@issuegraph/core';
import type { GeneratedEdges, IssueRef } from '@issuegraph/writer';

import { EXIT, EXIT_MEANING, EXIT_NAMES_BY_CODE } from './exit.ts';
import type { VerbResult } from './exit.ts';
import { helpText } from './argv.ts';
import type { ParsedArgv } from './argv.ts';
import { REF_SPELLINGS, resolveRef } from './refs.ts';
import { CLEARABLE_JSON_KEYS, EDGE_JSON_KEYS, SPLICE_CLEARABLE, clearRefusalReason } from './fields.ts';
import { parseBody } from './verbs/parse.ts';
import { validateBody } from './verbs/validate.ts';
import { orderFromJson } from './verbs/order.ts';
import { backfill, setFields, spliceEdges } from './verbs/write.ts';
import type { SetFields } from './verbs/write.ts';

function usageResult(message: string): VerbResult {
  return { stdout: '', stderr: [`issuegraph: ${message}`], code: EXIT.usage };
}

/**
 * A collector either produced its value or produced the refusal to return.
 *
 * A DISCRIMINATED UNION, not a structural sniff. The shape this replaces asked
 * whether the returned object happened to carry `code` and `stdout`, which is
 * only correct for as long as no payload type ever grows a field by those names
 * — and the day one does, a caller's fields would be silently routed as a
 * refusal, or a refusal spliced into an issue body. A tag cannot drift that way.
 */
type Collected<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly result: VerbResult };

function collected<T>(value: T): Collected<T> {
  return { ok: true, value };
}

function refused<T>(result: VerbResult): Collected<T> {
  return { ok: false, result };
}

/** The `--help` body, with the exit table rendered from its single source. */
export function help(): string {
  return helpText(EXIT_NAMES_BY_CODE.map((name) => [name, EXIT[name], EXIT_MEANING[name]] as const));
}

type Options = ReadonlyMap<string, readonly string[]>;

/**
 * A priority, as a caller may spell it on the command line: exactly one digit
 * 0-3. Deliberately narrower than "something `Number()` can read" — see the use
 * site for what that admitted.
 */
const PRIORITY_SPELLING = /^[0-3]$/;

/**
 * Build the `set` fields from the options, or the refusal to return.
 *
 * A `--x` and `--no-x` pair given together is refused rather than resolved by
 * precedence: either answer would be a guess about which the caller meant, and a
 * guess that writes to an issue body is the expensive kind.
 *
 * Only the fields `fields.ts` lists as clearable have a `--no-` form at all, so
 * there is no arm here that accepts a clear the writer cannot perform.
 */
function collectSetFields(options: Options): Collected<SetFields> {
  for (const field of SPLICE_CLEARABLE) {
    if (options.has(`--${field}`) && options.has(`--no-${field}`)) {
      return refused(
        usageResult(`set: --${field} and --no-${field} were both given; they contradict each other`),
      );
    }
  }

  const fields: {
    blockedBy?: readonly IssueRef[];
    serializeWith?: IssueRef | null;
    decomposedFrom?: IssueRef | null;
    duplicateOf?: IssueRef | null;
    togetherWith?: IssueRef | null;
    priority?: number | null;
    evidence?: Evidence | null;
  } = {};

  const blockedBy = options.get('--blocked-by');
  if (blockedBy !== undefined) {
    const refs: IssueRef[] = [];
    for (const token of blockedBy) {
      const ref = resolveRef(token);
      if (ref === null) {
        return refused(usageResult(`set: --blocked-by ${JSON.stringify(token)} is not ${REF_SPELLINGS}`));
      }
      refs.push(ref);
    }
    fields.blockedBy = refs;
  }
  if (options.has('--no-blocked-by')) fields.blockedBy = [];

  /**
   * The single-ref fields. `clearable` is read from the taxonomy rather than
   * hard-coded, so a field that gains or loses a `--no-` form does so in one
   * place and this loop follows.
   */
  const singles: readonly (readonly [
    field: string,
    assign: (ref: IssueRef | null) => void,
  ])[] = [
    ['serialize-with', (ref) => (fields.serializeWith = ref)],
    ['decomposed-from', (ref) => (fields.decomposedFrom = ref)],
    ['duplicate-of', (ref) => (fields.duplicateOf = ref)],
    ['together-with', (ref) => (fields.togetherWith = ref)],
  ];
  for (const [field, assign] of singles) {
    const option = `--${field}`;
    if (options.has(`--no-${field}`)) {
      assign(null);
      continue;
    }
    const values = options.get(option);
    if (values === undefined) continue;
    const token = values[0] ?? '';
    const ref = resolveRef(token);
    if (ref === null) {
      return refused(usageResult(`set: ${option} ${JSON.stringify(token)} is not ${REF_SPELLINGS}`));
    }
    assign(ref);
  }

  const priority = options.get('--priority')?.[0];
  if (priority !== undefined) {
    // VALIDATE THE SPELLING, THEN CONVERT — never convert and then validate.
    // `Number()` is a coercion, not an integer parser: it reads `""` and a
    // whitespace-only value as 0, which `isPriority` accepts, so `--priority=`
    // silently wrote the HIGHEST urgency. It also accepts `0x2`, `1e0`, `2.0`
    // and `+1`, each of which is a caller typing something they did not mean.
    // A priority is one character from 0 to 3; anything else is a usage error.
    if (!PRIORITY_SPELLING.test(priority)) {
      return refused(usageResult(`set: --priority ${JSON.stringify(priority)} is not an integer 0-3`));
    }
    const value = Number(priority);
    // The vocabulary's own answer, kept as the second half of the pair: the
    // spelling test bounds the input, `isPriority` bounds the RANGE, and the two
    // stay in step because `@issuegraph/core` owns what a priority is.
    if (!isPriority(value)) {
      return refused(usageResult(`set: --priority ${JSON.stringify(priority)} is not an integer 0-3`));
    }
    fields.priority = value;
  }

  const evidence = options.get('--evidence')?.[0];
  if (evidence !== undefined) {
    if (!isEvidence(evidence)) {
      return refused(usageResult(`set: --evidence ${JSON.stringify(evidence)} is not one of asserted, verified`));
    }
    fields.evidence = evidence;
  }

  return collected(fields);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the `--edges` payload.
 *
 * Refs are given as STRINGS in the same three spellings the flags accept, so the
 * CLI has one ref grammar rather than two — and that one is the reader's.
 * Absent leaves a field untouched; a value sets it; `null` clears it, but only
 * for the keys the writer can actually clear.
 *
 * EVERY KEY IS CHECKED AGAINST THE ALLOWLIST, and an unrecognised one is a usage
 * error rather than a shrug. `splice` is a WRITE command, so ignoring a key it
 * did not recognise means exiting 0 with the body unchanged while the caller
 * believes an edge landed — a misspelling (`serialiseWith`) or the block's own
 * spelling (`duplicate-of`) is enough to trigger it, and automation has no way
 * to tell that success from a real one.
 */
function collectEdges(text: string): Collected<GeneratedEdges> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refused(usageResult(`splice: --edges is not valid JSON — ${detail}`));
  }
  if (!isRecord(value)) return refused(usageResult('splice: --edges must be a JSON object'));

  const allowed: readonly string[] = EDGE_JSON_KEYS;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return refused(
        usageResult(
          `splice: --edges has an unrecognised key ${JSON.stringify(key)}. Allowed: ${allowed.join(', ')}`,
        ),
      );
    }
  }

  const edges: {
    blockedBy?: readonly IssueRef[];
    serializeWith?: IssueRef | null;
    decomposedFrom?: IssueRef | null;
    duplicateOf?: IssueRef | null;
  } = {};

  if (Object.hasOwn(value, 'blockedBy')) {
    const raw = value['blockedBy'];
    if (!Array.isArray(raw)) return refused(usageResult('splice: --edges.blockedBy must be an array of refs'));
    // Re-bound so each element stays `unknown`: `Array.isArray` narrows to
    // `any[]`, and an `any` element would make the `typeof item === 'string'`
    // test below look like validation while proving nothing.
    const list: readonly unknown[] = raw;
    const refs: IssueRef[] = [];
    for (const [index, item] of list.entries()) {
      const ref = typeof item === 'string' ? resolveRef(item) : null;
      if (ref === null) {
        return refused(usageResult(`splice: --edges.blockedBy[${index}] is not ${REF_SPELLINGS}`));
      }
      refs.push(ref);
    }
    edges.blockedBy = refs;
  }

  const singles = ['serializeWith', 'decomposedFrom', 'duplicateOf'] as const;
  for (const key of singles) {
    if (!Object.hasOwn(value, key)) continue;
    const item = value[key];
    if (item === null) {
      // The writer reads `null` as "leave untouched" for the provenance pair, so
      // accepting one here would report a clear it never performed.
      if (!CLEARABLE_JSON_KEYS.includes(key)) {
        return refused(usageResult(`splice: ${clearRefusalReason(`--edges.${key}`)}`));
      }
      edges[key] = null;
      continue;
    }
    const ref = typeof item === 'string' ? resolveRef(item) : null;
    if (ref === null) return refused(usageResult(`splice: --edges.${key} is not ${REF_SPELLINGS}`));
    edges[key] = ref;
  }

  return collected(edges);
}

/**
 * Every file option, already read into text by the binary.
 *
 * The binary resolves paths; this layer never touches the filesystem. Keeping
 * the resolution on the I/O side is what stops `--edges-file`'s PATH from being
 * mistaken for its CONTENT — a substitution that would silently splice the
 * characters of a filename into an issue body.
 */
export interface ResolvedInputs {
  /** The verb's primary input: an issue body, or an order document. */
  readonly primary: string;
  /** The contents of `--edges-file`, when that option was given. */
  readonly edgesFile?: string;
}

/** Run one parsed command against its already-read input. */
export function dispatch(parsed: ParsedArgv, inputs: ResolvedInputs, version: string): VerbResult {
  if (parsed.kind === 'help') return { stdout: `${help()}\n`, stderr: [], code: EXIT.ok };
  if (parsed.kind === 'version') return { stdout: `${version}\n`, stderr: [], code: EXIT.ok };
  if (parsed.kind === 'usage-error') return usageResult(parsed.message);

  const input = inputs.primary;

  switch (parsed.verb) {
    case 'parse':
      return parseBody(input);
    case 'validate':
      return validateBody(input);
    case 'order':
      return orderFromJson(input, 'order');
    case 'ready':
      return orderFromJson(input, 'ready');
    case 'backfill':
      return backfill(input, { json: parsed.options.has('--json') });
    case 'set': {
      const fields = collectSetFields(parsed.options);
      return fields.ok ? setFields(input, fields.value) : fields.result;
    }
    case 'splice': {
      const inline = parsed.options.get('--edges')?.[0];
      const hasFile = parsed.options.has('--edges-file');
      if (inline !== undefined && hasFile) {
        return usageResult('splice: give --edges or --edges-file, not both');
      }
      const text = inline ?? inputs.edgesFile;
      if (text === undefined) return usageResult('splice: --edges or --edges-file is required');
      const edges = collectEdges(text);
      return edges.ok ? spliceEdges(input, edges.value) : edges.result;
    }
  }
}
