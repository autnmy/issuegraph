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

/** Resolve one ref-valued option, or say which flag was wrong. */
function refOption(options: Options, name: string): IssueRef | 'absent' | { readonly bad: string } {
  const values = options.get(name);
  if (values === undefined) return 'absent';
  const token = values[0];
  if (token === undefined) return { bad: name };
  const ref = resolveRef(token);
  return ref === null ? { bad: name } : ref;
}

/**
 * Build the `set` fields from the options, or a usage error.
 *
 * A `--x` and `--no-x` pair given together is refused rather than resolved by
 * precedence: either answer would be a guess about which the caller meant, and a
 * guess that writes to an issue body is the expensive kind.
 */
function collectSetFields(options: Options): Collected<SetFields> {
  const pairs: readonly (readonly [set: string, clear: string])[] = [
    ['--blocked-by', '--no-blocked-by'],
    ['--serialize-with', '--no-serialize-with'],
    ['--decomposed-from', '--no-decomposed-from'],
    ['--duplicate-of', '--no-duplicate-of'],
    ['--together-with', '--no-together-with'],
    ['--priority', '--no-priority'],
    ['--evidence', '--no-evidence'],
  ];
  for (const [setName, clearName] of pairs) {
    if (options.has(setName) && options.has(clearName)) {
      return refused(usageResult(`set: ${setName} and ${clearName} were both given; they contradict each other`));
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

  const singles: readonly (readonly [
    option: string,
    clear: string,
    assign: (ref: IssueRef | null) => void,
  ])[] = [
    ['--serialize-with', '--no-serialize-with', (ref) => (fields.serializeWith = ref)],
    ['--decomposed-from', '--no-decomposed-from', (ref) => (fields.decomposedFrom = ref)],
    ['--duplicate-of', '--no-duplicate-of', (ref) => (fields.duplicateOf = ref)],
    ['--together-with', '--no-together-with', (ref) => (fields.togetherWith = ref)],
  ];
  for (const [option, clear, assign] of singles) {
    if (options.has(clear)) {
      assign(null);
      continue;
    }
    const resolved = refOption(options, option);
    if (resolved === 'absent') continue;
    if ('bad' in resolved) {
      const given = options.get(option)?.[0] ?? '';
      return refused(usageResult(`set: ${option} ${JSON.stringify(given)} is not ${REF_SPELLINGS}`));
    }
    assign(resolved);
  }

  if (options.has('--no-priority')) fields.priority = null;
  const priority = options.get('--priority')?.[0];
  if (priority !== undefined) {
    const value = Number(priority);
    if (!isPriority(value)) return refused(usageResult(`set: --priority ${JSON.stringify(priority)} is not an integer 0-3`));
    fields.priority = value;
  }

  if (options.has('--no-evidence')) fields.evidence = null;
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
 * Absent leaves a field untouched; `null` clears it; a value sets it.
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
      edges[key] = null;
      continue;
    }
    const ref = typeof item === 'string' ? resolveRef(item) : null;
    if (ref === null) return refused(usageResult(`splice: --edges.${key} is not ${REF_SPELLINGS} or null`));
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
      return backfill(input);
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
