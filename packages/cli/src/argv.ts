/**
 * The command line, as a CLOSED grammar.
 *
 * Every verb, every option and every arity is declared in {@link VERBS}, and
 * anything not in that table is a usage error naming what was rejected. It is an
 * allowlist, which is the shape that converges: a denylist of bad inputs grows a
 * new entry every time somebody types something nobody anticipated.
 *
 * WHY NOT `node:util`'s `parseArgs`. The published floor is Node 18 — forced,
 * not chosen: `scripts/smoke-consumer.mjs` asserts every package's
 * `engines.node` floor EQUALS the Node the smoke job runs on. `parseArgs` is
 * still experimental there and prints an `ExperimentalWarning` to stderr, and
 * this binary's stderr is a machine-read surface for a workflow. Forty lines of
 * closed-grammar reading costs less than a warning nobody can suppress.
 *
 * This is not the hand-rolled grammar the package exists to avoid. That rule is
 * about ISSUEGRAPH grammar — an open format owned elsewhere — and there is none
 * of it here or anywhere else in this package.
 */

import { RENDER_ONLY, SPLICE_CLEARABLE, SPLICE_WRITABLE } from './fields.ts';

/** How many values an option takes, and whether it may repeat. */
export interface OptionSpec {
  readonly arity: 0 | 1;
  readonly repeatable: boolean;
  readonly summary: string;
}

/** Where a verb's primary input comes from when no file option is given. */
export type InputKind = 'body' | 'document';

export interface VerbSpec {
  readonly summary: string;
  readonly input: InputKind;
  readonly options: Readonly<Record<string, OptionSpec>>;
}

function opt(arity: 0 | 1, summary: string, repeatable = false): OptionSpec {
  return { arity, repeatable, summary };
}

/** The option every body verb carries, so the spelling is declared once. */
const BODY_FILE = { '--body-file': opt(1, 'read the issue body from a file instead of stdin') };
/** The option every document verb carries. */
const INPUT_FILE = { '--input': opt(1, 'read the input document from a file instead of stdin') };

const REF = 'a reference: 123, #123, or owner/repo#123';

/** The value each writable field takes, for its `--<field>` option's summary. */
const FIELD_VALUE: Readonly<Record<string, string>> = Object.freeze({
  'blocked-by': `${REF}; repeat to give the whole list`,
  'serialize-with': REF,
  'decomposed-from': REF,
  'duplicate-of': REF,
  'together-with': REF,
  priority: 'an integer 0-3',
  evidence: 'asserted or verified',
});

/**
 * `set`'s field options, GENERATED from the capability tables rather than
 * listed.
 *
 * A `--no-<field>` flag appears for exactly the fields the writer can remove
 * from an existing block. Listing them by hand is what produced five flags that
 * accepted a clear nothing could perform and exited 0 having changed nothing —
 * see `fields.ts` for why the capabilities differ per field.
 */
const SET_FIELD_OPTIONS: Readonly<Record<string, OptionSpec>> = Object.freeze(
  Object.fromEntries([
    ...[...SPLICE_WRITABLE, ...RENDER_ONLY].map((field) => [
      `--${field}`,
      opt(
        1,
        `${FIELD_VALUE[field] ?? REF}${RENDER_ONLY.includes(field) ? ' (only when the body has no block yet)' : ''}`,
        field === 'blocked-by',
      ),
    ]),
    ...SPLICE_CLEARABLE.map((field) => [
      `--no-${field}`,
      opt(0, `remove the ${field} entry from the block`),
    ]),
  ]),
);

/**
 * Every verb this binary answers to.
 *
 * Declared as data because three things read it: the parser, `--help`, and the
 * test that asserts `--help` documents every verb. A table one of them disagreed
 * with is a table that lies to a user.
 */
export const VERBS = Object.freeze({
  parse: {
    summary: 'read one issue body and report what it declares',
    input: 'body',
    options: Object.freeze({ ...BODY_FILE }),
  },
  validate: {
    summary: 'check one issue body’s block and report what is wrong with it',
    input: 'body',
    options: Object.freeze({ ...BODY_FILE }),
  },
  order: {
    summary: 'derive the selection order over a set of issues you supply',
    input: 'document',
    options: Object.freeze({ ...INPUT_FILE }),
  },
  ready: {
    summary: 'the same derivation as `order`, filtered to the slots that are ready',
    input: 'document',
    options: Object.freeze({ ...INPUT_FILE }),
  },
  set: {
    summary: 'write fields into one issue body, rendering a block if it has none',
    input: 'body',
    options: Object.freeze({
      ...BODY_FILE,
      ...SET_FIELD_OPTIONS,
    }),
  },
  splice: {
    summary: 'refresh the owned generated edges inside an existing block',
    input: 'body',
    options: Object.freeze({
      ...BODY_FILE,
      '--edges': opt(1, 'a JSON object of the owned edges to write'),
      '--edges-file': opt(1, 'read that JSON object from a file'),
    }),
  },
  backfill: {
    summary: 'repair a block a code fence left undelimited',
    input: 'body',
    options: Object.freeze({ ...BODY_FILE }),
  },
} as const satisfies Readonly<Record<string, VerbSpec>>);

/** A verb name. */
export type VerbName = keyof typeof VERBS;

/** The verbs in declaration order, for `--help`. */
export const VERB_NAMES: readonly VerbName[] = Object.freeze(Object.keys(VERBS) as VerbName[]);

function isVerbName(value: string): value is VerbName {
  return Object.hasOwn(VERBS, value);
}

/** What the command line asked for. */
export type ParsedArgv =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | {
      readonly kind: 'verb';
      readonly verb: VerbName;
      /** Option name to its values. A zero-arity option maps to an empty array. */
      readonly options: ReadonlyMap<string, readonly string[]>;
    }
  | { readonly kind: 'usage-error'; readonly message: string };

function usage(message: string): ParsedArgv {
  return { kind: 'usage-error', message };
}

/**
 * Read the arguments after the node binary and the script path.
 *
 * `--name value` and `--name=value` are both accepted; the second form is what
 * makes a value beginning with `-` expressible at all, which matters for a file
 * path more than for a ref.
 */
export function parseArgv(argv: readonly string[]): ParsedArgv {
  const first = argv[0];
  if (first === undefined || first === '--help' || first === '-h') return { kind: 'help' };
  if (first === '--version' || first === '-V') return { kind: 'version' };

  if (!isVerbName(first)) {
    return usage(`unknown verb ${JSON.stringify(first)}. Known verbs: ${VERB_NAMES.join(', ')}`);
  }
  // Widened to a string index, NOT cast. `as const satisfies` gives each verb's
  // option map literal keys, which is what makes `--help` and the tests total —
  // but a lookup by a token read from argv is a string. A widening ASSIGNMENT
  // keeps the value type (`OptionSpec`) honest and lets
  // `noUncheckedIndexedAccess` hand back `| undefined` for an unknown key, which
  // is the answer this parser wants; a cast would assert the key exists.
  const allowedOptions: Readonly<Record<string, OptionSpec>> = VERBS[first].options;
  const options = new Map<string, string[]>();

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (token === '--help' || token === '-h') return { kind: 'help' };
    if (!token.startsWith('--')) {
      return usage(
        `${first}: unexpected argument ${JSON.stringify(token)}. This verb takes options only; its input arrives on stdin or through a file option.`,
      );
    }

    const equals = token.indexOf('=');
    const name = equals === -1 ? token : token.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : token.slice(equals + 1);

    if (!Object.hasOwn(allowedOptions, name)) {
      const allowed = Object.keys(allowedOptions);
      return usage(
        `${first}: unknown option ${JSON.stringify(name)}. ${
          allowed.length === 0 ? 'This verb takes no options.' : `Allowed: ${allowed.join(', ')}`
        }`,
      );
    }
    const optionSpec = allowedOptions[name];
    if (optionSpec === undefined) continue;

    const existing = options.get(name);
    if (existing !== undefined && !optionSpec.repeatable) {
      return usage(`${first}: ${name} was given more than once, and it is not repeatable`);
    }

    if (optionSpec.arity === 0) {
      if (inlineValue !== undefined) return usage(`${first}: ${name} takes no value`);
      options.set(name, []);
      continue;
    }

    let value = inlineValue;
    if (value === undefined) {
      index += 1;
      value = argv[index];
      // A SPACE-SEPARATED VALUE MAY NOT LOOK LIKE A FLAG. `--blocked-by
      // --evidence verified` would otherwise swallow `--evidence` as the ref and
      // then fail on `verified` as a stray positional — a cascade whose message
      // names neither the flag the user forgot to fill nor the one it ate. No
      // legal value here begins with `--`, and `--name=value` expresses one that
      // does, so refusing is total rather than a heuristic.
      if (value !== undefined && value.startsWith('--')) {
        return usage(
          `${first}: ${name} needs a value, but the next argument is ${JSON.stringify(value)}, which looks like an option. Write ${name}=<value> if the value really begins with --.`,
        );
      }
    }
    if (value === undefined) return usage(`${first}: ${name} needs a value`);
    options.set(name, [...(existing ?? []), value]);
  }

  return { kind: 'verb', verb: first, options };
}

/** The `--help` text, rendered from the tables so it cannot drift from them. */
export function helpText(exitRows: readonly (readonly [name: string, code: number, meaning: string])[]): string {
  const lines: string[] = [
    'issuegraph — read, order and edit the Issuegraph block in an issue body.',
    '',
    'The outermost input and output is the ticket body. Nothing here reaches the',
    'network, and nothing here takes a credential — closure state and labels are',
    'inputs you supply, which is what lets this run in a workflow with no token.',
    '',
    'USAGE',
    '  issuegraph <verb> [options]        # input on stdin unless a file option is given',
    '',
    'VERBS',
  ];
  for (const name of VERB_NAMES) {
    const spec: VerbSpec = VERBS[name];
    lines.push(`  ${name.padEnd(10)} ${spec.summary}`);
    for (const [option, optionSpec] of Object.entries(spec.options)) {
      lines.push(`      ${option.padEnd(20)} ${optionSpec.summary}`);
    }
  }
  lines.push('', 'EXIT CODES');
  for (const [name, code, meaning] of exitRows) {
    lines.push(`  ${String(code).padEnd(3)} ${name.padEnd(20)} ${meaning}`);
  }
  lines.push('');
  return lines.join('\n');
}
