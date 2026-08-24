/**
 * `order` and `ready` — what is the selection order over a set of issues?
 *
 * ONE DERIVATION, TWO VIEWS. `ready` is a filter over the very slots `order`
 * returns, never a second computation: a second ordering path would be a second
 * ordering engine, which is the thing this package exists not to be. The test
 * compares the two against the same run rather than against a hand-written
 * expectation, so they cannot drift.
 *
 * THE BOUNDARY RULE LIVES HERE, more visibly than anywhere else in the package.
 * Readiness needs closure state, and closure state lives in a tracker — so it
 * arrives as an INPUT on the document, alongside labels and assignee counts.
 * Nothing here fetches, and nothing here holds a credential. That is precisely
 * what lets the binary run inside a workflow that has issue bodies and no token.
 *
 * THE DOCUMENT CARRIES BODIES, NEVER PRE-PARSED DATA. Accepting a caller's own
 * `data` object would let it hand-roll the grammar and feed the result in, which
 * is the defect the package exists to end. Bodies in, reader-parsed, every time.
 */

import { deriveIssueOrder } from '@issuegraph/derive';
import type { IssueOrderBaseRanking } from '@issuegraph/derive';
import { nodeKey, parseFrontmatter } from '@issuegraph/reader';
import type { NodeInput } from '@issuegraph/reader';

import { classifyDeclaration } from '../declaration.ts';
import { EXIT } from '../exit.ts';
import type { VerbResult } from '../exit.ts';
import { toJson } from '../json.ts';

/** One issue as the caller supplies it: its body, plus the tracker facts we do not fetch. */
export interface OrderInputIssue {
  readonly number: number;
  readonly repo?: string | null;
  readonly open: boolean;
  readonly labels: readonly string[];
  readonly assigneeCount: number;
  readonly closedStateReason?: string | null;
  /** The ticket body. The package's outermost input, and the only edge source. */
  readonly body: string;
}

/** The document `order` and `ready` read from stdin or `--input`. */
export interface OrderInputDocument {
  readonly homeRepo?: string;
  readonly baseRanking: IssueOrderBaseRanking;
  readonly issues: readonly OrderInputIssue[];
}

/** A rejected input, named precisely enough to fix without guessing. */
export class InputError extends Error {}

function fail(at: string, wanted: string): never {
  throw new InputError(`${at}: ${wanted}`);
}

/**
 * A type GUARD, not a cast. `unknown` does not narrow to an index signature on
 * its own, and the alternative spelling — `value as Record<string, unknown>` —
 * would assert a shape rather than prove one, which is the same
 * absence-rendered-as-a-value move this package exists to refuse, one layer down.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, at: string): Record<string, unknown> {
  if (!isRecord(value)) fail(at, 'expected an object');
  return value;
}

/**
 * An array whose elements stay `unknown`.
 *
 * `Array.isArray` narrows an `unknown` to `any[]`, so every element read after a
 * bare guard is an implicit `any` that `strict` will not complain about — which
 * is how an unvalidated field reaches the derivation looking checked. Re-binding
 * to `readonly unknown[]` keeps each element unproven until one of the readers
 * above proves it.
 */
function asArray(value: unknown, at: string, wanted = 'expected an array'): readonly unknown[] {
  if (!Array.isArray(value)) fail(at, wanted);
  const items: readonly unknown[] = value;
  return items;
}

function asString(value: unknown, at: string): string {
  if (typeof value !== 'string') fail(at, 'expected a string');
  return value;
}

function asBoolean(value: unknown, at: string): boolean {
  if (typeof value !== 'boolean') fail(at, 'expected true or false');
  return value;
}

function asInteger(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(at, 'expected an integer');
  return value;
}

function asStringArray(value: unknown, at: string): readonly string[] {
  return asArray(value, at, 'expected an array of strings').map((item, index) =>
    asString(item, `${at}[${index}]`),
  );
}

/**
 * The base ranking, validated only as far as its DISCRIMINANT and the shape of
 * the arm it selects.
 *
 * Deliberately not a deep re-validation of `@issuegraph/derive`'s own contract:
 * that package owns those rules, and a second copy here would be one more place
 * for them to disagree. What this checks is what a JSON document can get wrong
 * in a way the derivation would then read as something else entirely.
 */
function asBaseRanking(value: unknown, at: string): IssueOrderBaseRanking {
  const record = asRecord(value, at);
  const source = asString(record['source'], `${at}.source`);
  if (source === 'config') {
    const order = asArray(record['order'], `${at}.order`);
    return {
      source: 'config',
      order: order.map((row, index) => {
        const entry = asRecord(row, `${at}.order[${index}]`);
        return {
          key: asString(entry['key'], `${at}.order[${index}].key`),
          matchedOrderIndex: asInteger(
            entry['matchedOrderIndex'],
            `${at}.order[${index}].matchedOrderIndex`,
          ),
        };
      }),
    };
  }
  if (source === 'fixture-parity') {
    const createdAt = asRecord(record['createdAt'], `${at}.createdAt`);
    return {
      source: 'fixture-parity',
      createdAt: new Map(
        Object.entries(createdAt).map(([key, value]) => [
          key,
          asInteger(value, `${at}.createdAt.${key}`),
        ]),
      ),
    };
  }
  return fail(`${at}.source`, "expected 'config' or 'fixture-parity'");
}

function asIssue(value: unknown, at: string): OrderInputIssue {
  const record = asRecord(value, at);
  const repo = record['repo'];
  const closedStateReason = record['closedStateReason'];
  return {
    number: asInteger(record['number'], `${at}.number`),
    // `exactOptionalPropertyTypes` is on: an absent key and an explicit
    // `undefined` are different types, so the key is only added when supplied.
    ...(repo === undefined ? {} : { repo: repo === null ? null : asString(repo, `${at}.repo`) }),
    open: asBoolean(record['open'], `${at}.open`),
    labels: asStringArray(record['labels'], `${at}.labels`),
    assigneeCount: asInteger(record['assigneeCount'], `${at}.assigneeCount`),
    ...(closedStateReason === undefined
      ? {}
      : {
          closedStateReason:
            closedStateReason === null
              ? null
              : asString(closedStateReason, `${at}.closedStateReason`),
        }),
    body: asString(record['body'], `${at}.body`),
  };
}

/** Validate a parsed JSON value as an input document. Throws {@link InputError}. */
export function asOrderInput(value: unknown): OrderInputDocument {
  const record = asRecord(value, 'input');
  const homeRepo = record['homeRepo'];
  const rawHomeRepo = homeRepo === undefined ? undefined : asString(homeRepo, 'input.homeRepo');
  const issues = asArray(record['issues'], 'input.issues').map((issue, index) =>
    asIssue(issue, `input.issues[${index}]`),
  );

  // TWO ENTRIES FOR ONE ISSUE ARE REFUSED, not silently deduplicated.
  //
  // `buildModel` keeps the FIRST occurrence and ignores the rest, which is a
  // reasonable rule and not this package's to restate — and restating it is
  // exactly what went wrong: the under-read report was built by walking every
  // entry, so a key whose first body read fine and whose second did not was
  // listed as under-read while the derivation had used the readable one. The
  // output then said a ready slot was carried in as under-read.
  //
  // Teaching this loop the same first-occurrence rule would fix that instance
  // and leave a second copy of a rule the derive package owns, free to drift the
  // next time either side changes. A document naming one issue twice is a caller
  // defect with no correct reading, so it is refused and the divergence cannot
  // exist.
  const seen = new Map<string, number>();
  for (const [index, issue] of issues.entries()) {
    const key = nodeKey({ number: issue.number, repo: issue.repo ?? null }, rawHomeRepo);
    const first = seen.get(key);
    if (first !== undefined) {
      fail(
        `input.issues[${index}]`,
        `issue ${key} is already declared at input.issues[${first}]; each issue may appear once`,
      );
    }
    seen.set(key, index);
  }

  return {
    ...(rawHomeRepo === undefined ? {} : { homeRepo: rawHomeRepo }),
    baseRanking: asBaseRanking(record['baseRanking'], 'input.baseRanking'),
    issues,
  };
}

/** Which view of the same derivation to emit. */
export type OrderView = 'order' | 'ready';

/**
 * Derive the order over a validated document.
 *
 * On an under-read body this does NOT refuse, and the asymmetry with `parse` is
 * deliberate rather than an oversight. For a single body, reporting edges would
 * be the lie; for a SET, the fact is not lost — it travels into the derivation
 * as `declarationRead: 'under-read'`, which `NodeInput` makes required for
 * exactly this reason, and the derivation is what decides what an under-read
 * node may do. Refusing the whole set would instead make the command unusable on
 * any real corpus, where under-read bodies are the common case rather than the
 * exception. The keys are reported so a caller can apply its own policy.
 */
export function deriveOrder(document: OrderInputDocument, view: OrderView): VerbResult {
  const underRead: string[] = [];

  const nodes: NodeInput[] = document.issues.map((issue) => {
    const parse = parseFrontmatter(issue.body);
    const decl = classifyDeclaration(parse);
    const repo = issue.repo ?? null;
    if (decl.state === 'unread') {
      underRead.push(nodeKey({ number: issue.number, repo }, document.homeRepo));
    }
    return {
      number: issue.number,
      ...(issue.repo === undefined ? {} : { repo: issue.repo }),
      open: issue.open,
      ...(issue.closedStateReason === undefined
        ? {}
        : { closedStateReason: issue.closedStateReason }),
      labels: issue.labels,
      assigneeCount: issue.assigneeCount,
      // The pair travels together: `data` and the read-completeness answer come
      // from the SAME ParseResult, which is the reader's stated requirement.
      data: parse.data,
      declarationRead: decl.state === 'unread' ? 'under-read' : 'read',
    };
  });

  const derived = deriveIssueOrder({
    issues: nodes,
    config: {
      baseRanking: document.baseRanking,
      ...(document.homeRepo === undefined ? {} : { homeRepo: document.homeRepo }),
    },
  });

  const slots = view === 'ready' ? derived.slots.filter((slot) => slot.ready) : derived.slots;

  return {
    stdout: toJson({
      view,
      slots,
      priority: Object.fromEntries(derived.priority),
      excluded: derived.excluded,
      underRead,
      diagnostics: derived.diagnostics,
    }),
    stderr:
      underRead.length === 0
        ? []
        : [
            `issuegraph: ${underRead.length} of ${document.issues.length} bodies could not be fully read; ` +
              'they are carried into the derivation as under-read, not as edge-free. ' +
              `See "underRead": ${JSON.stringify(underRead)}`,
          ],
    code: EXIT.ok,
  };
}

/** Parse, validate and derive in one step. A bad document is a USAGE error, never `unread`. */
export function orderFromJson(text: string, view: OrderView): VerbResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    // `instanceof`, not a cast: a thrown non-Error is legal JavaScript, and
    // asserting `.message` on one yields `undefined` in the message rather than
    // saying what actually happened.
    const detail = error instanceof Error ? error.message : String(error);
    return {
      stdout: '',
      stderr: [`issuegraph: input is not valid JSON — ${detail}`],
      code: EXIT.usage,
    };
  }
  try {
    return deriveOrder(asOrderInput(value), view);
  } catch (error) {
    if (error instanceof InputError) {
      return { stdout: '', stderr: [`issuegraph: ${error.message}`], code: EXIT.usage };
    }
    throw error;
  }
}
