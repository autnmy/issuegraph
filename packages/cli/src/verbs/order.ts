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
import { resolveRef } from '../refs.ts';
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

/**
 * An integer JSON has not already rounded.
 *
 * `Number.isSafeInteger`, not `Number.isInteger`: past 2^53 a JSON number has
 * lost precision before this code ever sees it, so `9007199254740993` arrives as
 * `9007199254740992`. Accepting one means accepting a value that is not what the
 * document said, which no amount of downstream care recovers.
 */
function asInteger(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail(at, 'expected an integer within the safe range');
  }
  return value;
}

/**
 * An integer that is also IN ITS DOMAIN.
 *
 * Checking the type and stopping there is how a malformed tracker fact reaches
 * the derivation looking validated. A negative `assigneeCount` is the case
 * review found: the derivation tests `assigneeCount > 0` to decide a serialize
 * component is actively claimed, so `-1` read as UNCLAIMED and a peer that was
 * being worked appeared free — admitting a second worker to a group whose whole
 * purpose is to exclude one.
 *
 * None of these fields has a meaningful negative value, so the bound is part of
 * what the field IS rather than an extra rule.
 */
function asIntegerAtLeast(value: unknown, at: string, min: number): number {
  const parsed = asInteger(value, at);
  if (parsed < min) fail(at, `expected an integer >= ${min}, got ${parsed}`);
  return parsed;
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
          matchedOrderIndex: asIntegerAtLeast(
            entry['matchedOrderIndex'],
            `${at}.order[${index}].matchedOrderIndex`,
            0,
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

/**
 * An issue number the READER would also accept as a reference.
 *
 * The bound is not restated here — it is asked. `resolveRef` puts the token
 * through `parseFrontmatter`, so a node number is accepted exactly when a
 * `blocked-by` naming it would parse, by construction rather than by two bounds
 * being kept in step.
 *
 * That distinction is why this exists rather than a second `isSafeInteger` test.
 * Review found this validator accepting `9007199254740992` while the reader and
 * writer both refuse a ref at that value — a node that could be ranked and never
 * addressed. Every previous version of that mistake in this package was the same
 * shape: a rule owned elsewhere, restated here, and drifting. The ref grammar is
 * already asked rather than reimplemented; the number bound now is too.
 */
function asIssueNumber(value: unknown, at: string): number {
  const parsed = asInteger(value, at);
  const ref = resolveRef(String(parsed));
  // COMPARED AS THE READER STORES IT. An identifier is an opaque string
  // (SPEC 4.2), so the round-trip through `resolveRef` comes back as text; the
  // CLI's own input schema keeps `number`, and this is the boundary.
  if (ref === null || ref.id !== String(parsed)) {
    fail(at, `expected an issue number the reader can reference, got ${parsed}`);
  }
  return parsed;
}

function asIssue(value: unknown, at: string): OrderInputIssue {
  const record = asRecord(value, at);
  const repo = record['repo'];
  const closedStateReason = record['closedStateReason'];
  return {
    number: asIssueNumber(record['number'], `${at}.number`),
    // `exactOptionalPropertyTypes` is on: an absent key and an explicit
    // `undefined` are different types, so the key is only added when supplied.
    ...(repo === undefined ? {} : { repo: repo === null ? null : asString(repo, `${at}.repo`) }),
    open: asBoolean(record['open'], `${at}.open`),
    labels: asStringArray(record['labels'], `${at}.labels`),
    assigneeCount: asIntegerAtLeast(record['assigneeCount'], `${at}.assigneeCount`, 0),
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

  return {
    ...(rawHomeRepo === undefined ? {} : { homeRepo: rawHomeRepo }),
    baseRanking: asBaseRanking(record['baseRanking'], 'input.baseRanking'),
    issues,
  };
}

/** Which view of the same derivation to emit. */
export type OrderView = 'order' | 'ready';

/**
 * The precondition every derivation shares, checked at the boundary they share.
 *
 * TWO ENTRIES FOR ONE ISSUE ARE REFUSED, not silently deduplicated. `buildModel`
 * keeps the FIRST occurrence and ignores the rest — a reasonable rule, and not
 * this package's to restate. Walking every entry to build `underRead` while the
 * derivation used only the first is what made the output report a READY issue as
 * under-read. Measured: readable body first, unreadable second, and the result
 * carried `underRead: ["1"]` beside a slot for `1` with `ready: true`.
 *
 * IT LIVES HERE RATHER THAN IN `asOrderInput`, and that placement is the whole
 * correction. It was in the JSON validator, so `orderFromJson` enforced it and
 * the exported `deriveOrder` — the same operation, reached directly — did not.
 * That is the same shape as the write paths before `performWrite`: a precondition
 * at one entry point while a second entry point reaches the operation without it.
 * The write half was made structural first and the derive half was left per-site,
 * which is exactly where the next round landed.
 *
 * A document naming one issue twice is a caller defect with no correct reading,
 * so it is refused and the divergence cannot exist.
 */
function duplicateKeyRefusal(document: OrderInputDocument): VerbResult | null {
  const seen = new Map<string, number>();
  for (const [index, issue] of document.issues.entries()) {
    const key = nodeKey({ id: String(issue.number), repo: issue.repo ?? null }, document.homeRepo);
    const first = seen.get(key);
    if (first !== undefined) {
      return {
        stdout: '',
        stderr: [
          `issuegraph: input.issues[${index}]: issue ${key} is already declared at ` +
            `input.issues[${first}]; each issue may appear once`,
        ],
        code: EXIT.usage,
      };
    }
    seen.set(key, index);
  }
  return null;
}

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
  const refusal = duplicateKeyRefusal(document);
  if (refusal !== null) return refusal;

  const underRead: string[] = [];

  const nodes: NodeInput[] = document.issues.map((issue) => {
    const parse = parseFrontmatter(issue.body);
    const decl = classifyDeclaration(parse);
    const repo = issue.repo ?? null;
    if (decl.state === 'unread') {
      underRead.push(nodeKey({ id: String(issue.number), repo }, document.homeRepo));
    }
    return {
      id: String(issue.number),
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
