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

import { isRepoQualifier } from '@issuegraph/core';
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
  /**
   * The tracker's own identifier, as SPEC §4.2 defines one — an OPAQUE
   * tracker-scoped token. `ABC-123` and `ENG-456` are identifiers exactly as
   * `231` is, so a Jira or Linear corpus is addressable here.
   *
   * OPTIONAL ONLY BECAUSE `number` PREDATES IT. Supply one or the other; both
   * is fine when they agree, and refused when they do not, because a caller
   * naming one issue two ways has no correct reading. Neither is refused too:
   * an issue with no identifier cannot be referenced by any body in the corpus.
   */
  readonly id?: string;
  /**
   * The numeric identifier — this verb's original contract, kept because every
   * existing caller supplies it. Equivalent to `id: String(number)`.
   */
  readonly number?: number;
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
 * The bound is not restated here — it is asked. `resolveRef` calls the reader's
 * own `parseRef`, so a node number is accepted exactly when a `blocked-by`
 * naming it would parse, by construction rather than by two bounds being kept in
 * step.
 *
 * That distinction is why this exists rather than a second `isSafeInteger` test.
 * Review found this validator accepting `9007199254740992` while the reader and
 * writer both refuse a ref at that value — a node that could be ranked and never
 * addressed. Every previous version of that mistake in this package was the same
 * shape: a rule owned elsewhere, restated here, and drifting. The ref grammar is
 * already asked rather than reimplemented; the number bound now is too.
 */
function isReferenceableId(value: string): boolean {
  const ref = resolveRef(value);
  // COMPARED AS THE READER STORES IT. An identifier is an opaque string
  // (SPEC §4.2), so the round-trip through `resolveRef` comes back as text.
  // TAKES THE STRING, NOT THE NUMBER, since §4.2 widened: the numeric spelling
  // is now one CASE of the opaque one rather than the domain itself, so asking
  // about a number and asking about an id is the same question and this answers
  // both. A second numeric predicate would be exactly the drifting restatement
  // this function's own history is a warning about.
  return ref !== null && ref.id === value;
}

/**
 * The identifier this issue is keyed by — `id` when supplied, else `number`.
 *
 * TOTAL ONLY BEHIND VALIDATION, deliberately rather than defensively: both
 * entry points ({@link asIssue} for JSON, {@link inputDomainRefusal} for a
 * typed document) refuse an issue carrying neither, and `runOrder` calls the
 * latter before anything else. A sentinel here instead would push a null check
 * into every call site to describe a state the boundary has already excluded.
 */
function issueId(issue: OrderInputIssue): string {
  return issue.id ?? String(issue.number);
}

/**
 * No tracker resolves a negative claim count, and the derivation reads
 * `assigneeCount > 0` as "this serialize component is actively claimed" — so a
 * negative one read as UNCLAIMED and admitted a second worker to a group whose
 * whole purpose is to exclude one. The safe-integer half is the same bound every
 * numeric field carries: past 2^53 a JSON number lost precision before this code
 * saw it.
 */
function isAssigneeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function asIssueNumber(value: unknown, at: string): number {
  const parsed = asInteger(value, at);
  if (!isReferenceableId(String(parsed))) {
    fail(at, `expected an issue number the reader can reference, got ${parsed}`);
  }
  return parsed;
}

/** An opaque identifier the READER would also accept as a reference (§4.2). */
function asOpaqueId(value: unknown, at: string): string {
  const parsed = asString(value, at);
  if (!isReferenceableId(parsed)) {
    fail(at, `expected an identifier the reader can reference, got ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

/**
 * A repository qualifier the LIBRARIES would also accept.
 *
 * The bound is not restated here — it is asked, exactly as {@link asIssueNumber}
 * asks for the number half. `isRepoQualifier` is the predicate
 * `@issuegraph/reader`'s own ref parser calls before it will build a qualified
 * reference, so what this admits is what the reader admits, by construction.
 *
 * Review found this field accepting any non-null string. `nodeKey` then built a
 * key such as `project#7`, and no issue body can reference that: a dependent
 * declaring `blocked-by: project#7` came back HELD, reported as `own issuegraph
 * declaration was not fully read (fail-safe: refusing the node)`. The miss failed
 * SAFE — it refused work rather than releasing blocked work — but the reason it
 * gave named the wrong thing, so the caller could not see that its own input was
 * the defect. Refusing the input names it at the boundary that owns it.
 *
 * `homeRepo` is validated through here too. It is not a reference, so nothing it
 * accepts can be mis-resolved — but it is compared against every node's repo
 * after both are lowercased, so an unusable value silently matches nothing and
 * leaves qualified keys where the caller expected bare ones. Same predicate,
 * same authority, one helper.
 */
function asRepoQualifier(value: unknown, at: string): string {
  const repo = asString(value, at);
  if (!isRepoQualifier(repo)) {
    fail(at, `expected an owner/repo qualifier the reader can reference, got ${JSON.stringify(repo)}`);
  }
  return repo;
}

/** The parse-time reader for `assigneeCount`; the domain itself is {@link isAssigneeCount}'s. */
function asAssigneeCount(value: unknown, at: string): number {
  const parsed = asInteger(value, at);
  if (!isAssigneeCount(parsed)) fail(at, `expected an integer >= 0, got ${parsed}`);
  return parsed;
}

function asIssue(value: unknown, at: string): OrderInputIssue {
  const record = asRecord(value, at);
  const repo = record['repo'];
  const closedStateReason = record['closedStateReason'];
  const rawId = record['id'];
  const rawNumber = record['number'];
  if (rawId === undefined && rawNumber === undefined) {
    fail(`${at}.id`, 'expected an identifier: supply `id` (any tracker id) or `number`');
  }
  const id = rawId === undefined ? undefined : asOpaqueId(rawId, `${at}.id`);
  const number = rawNumber === undefined ? undefined : asIssueNumber(rawNumber, `${at}.number`);
  // BOTH IS FINE WHEN THEY AGREE. A caller migrating from `number` to `id` will
  // send both for a while, and refusing that would make the migration a flag
  // day. Disagreement is the case with no correct reading — the same doctrine
  // `duplicateKeyRefusal` applies to one issue named twice.
  if (id !== undefined && number !== undefined && id !== String(number)) {
    fail(`${at}.id`, `names ${JSON.stringify(id)} while ${at}.number names ${number}`);
  }
  return {
    ...(id === undefined ? {} : { id }),
    ...(number === undefined ? {} : { number }),
    // `exactOptionalPropertyTypes` is on: an absent key and an explicit
    // `undefined` are different types, so the key is only added when supplied.
    ...(repo === undefined ? {} : { repo: repo === null ? null : asRepoQualifier(repo, `${at}.repo`) }),
    open: asBoolean(record['open'], `${at}.open`),
    labels: asStringArray(record['labels'], `${at}.labels`),
    assigneeCount: asAssigneeCount(record['assigneeCount'], `${at}.assigneeCount`),
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
  const rawHomeRepo = homeRepo === undefined ? undefined : asRepoQualifier(homeRepo, 'input.homeRepo');
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
    const key = nodeKey({ id: issueId(issue), repo: issue.repo ?? null }, document.homeRepo);
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
 * The input domains the DERIVATION depends on, checked at the boundary both
 * entry points share.
 *
 * IT LIVES HERE FOR THE REASON {@link duplicateKeyRefusal} ALREADY GIVES, and
 * this is the second instance of that one class rather than a new rule. These
 * bounds were enforced in `asOrderInput`, so `orderFromJson` had them and the
 * exported `deriveOrder` — the same operation, reached directly — did not. A
 * typed caller can hold an `OrderInputDocument` legitimately: `repo` is a
 * `string`, `number` is a `number`, so `repo: "project"` and `number: 0`
 * both compile, reach `nodeKey`, and rebuild the unreferenceable `project#7`
 * key this package refuses everywhere else. Type-checking the FIELD is not
 * checking its DOMAIN.
 *
 * THE PARSE-TIME READERS STAY, and are not a second copy of these rules. They
 * narrow `unknown` and name the offending path for a JSON caller; the domain
 * itself is owned by the three predicates both sides call, so there is one
 * statement of each rule and two callers of it. On the JSON path `asOrderInput`
 * simply refuses first, which is why that path's messages are unchanged.
 *
 * THE ORDER OF THE FIELDS IS THE ORDER `asIssue` READS THEM, so a document with
 * two faults is reported the same way whichever entry point it arrives through.
 */
/**
 * A rejected value, named in a refusal, without the naming becoming the failure.
 *
 * `JSON.stringify` THROWS on a bigint and on a cyclic structure, and it runs on
 * an object supplied by a DIRECT caller here — so the guards below entered their
 * rejection branch correctly and then escaped with a `TypeError` while building
 * the message. Measured: `{ id: 1n }` and a self-referential object both left
 * `deriveOrder` throwing instead of returning the usage result it promises,
 * which is the very defect those guards were added for, arriving one line later.
 *
 * A `toJSON` that throws reaches this too, and so does a getter — which is why
 * the fallback names the KIND rather than trying harder to serialize.
 */
function describeValue(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json.length <= 80 ? json : `${json.slice(0, 77)}...`;
  } catch {
    // Fall through: the caller gets a kind rather than a crash.
  }
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function inputDomainRefusal(document: OrderInputDocument): VerbResult | null {
  // Phrased exactly as the parse-time failures are, and rendered exactly as
  // `orderFromJson` renders an `InputError`, so one document cannot produce two
  // differently-shaped reports depending on how it was supplied.
  const refuse = (at: string, wanted: string): VerbResult => ({
    stdout: '',
    stderr: [`issuegraph: ${at}: ${wanted}`],
    code: EXIT.usage,
  });

  if (document.homeRepo !== undefined && !isRepoQualifier(document.homeRepo)) {
    return refuse(
      'input.homeRepo',
      `expected an owner/repo qualifier the reader can reference, got ${describeValue(document.homeRepo)}`,
    );
  }

  for (const [index, issue] of document.issues.entries()) {
    const at = `input.issues[${index}]`;
    // THE TYPE IS PART OF THE DOMAIN AT THIS BOUNDARY. `deriveOrder` is exported
    // and a JavaScript caller reaches it with no compiler in the way, so the
    // annotations promise nothing here — the same reasoning `parseRef` records
    // for taking `unknown`. Without this, `id: 123` reached `resolveRef` and
    // threw a `TypeError` rather than returning the usage result this function
    // promises, and `id: null` with no `number` fell through `issueId` to the
    // valid-looking key `"undefined"` and was SILENTLY ACCEPTED — the worse of
    // the two, because nothing refuses and the order is keyed by a lie.
    // NULL IS NOT ABSENT HERE. `id?: string` does not admit it, and reading it
    // as "unset" would re-open exactly the fall-through above.
    if (issue.id !== undefined && typeof issue.id !== 'string') {
      return refuse(`${at}.id`, `expected a string identifier, got ${describeValue(issue.id)}`);
    }
    if (issue.number !== undefined && typeof issue.number !== 'number') {
      return refuse(`${at}.number`, `expected a number, got ${describeValue(issue.number)}`);
    }
    if (issue.id === undefined && issue.number === undefined) {
      return refuse(`${at}.id`, 'expected an identifier: supply `id` (any tracker id) or `number`');
    }
    if (
      issue.id !== undefined &&
      issue.number !== undefined &&
      issue.id !== String(issue.number)
    ) {
      return refuse(
        `${at}.id`,
        `names ${describeValue(issue.id)} while ${at}.number names ${describeValue(issue.number)}`,
      );
    }
    if (!isReferenceableId(issueId(issue))) {
      return refuse(
        issue.id === undefined ? `${at}.number` : `${at}.id`,
        `expected an identifier the reader can reference, got ${describeValue(issueId(issue))}`,
      );
    }
    // `!= null` covers both spellings: an absent key and an explicit `null` are
    // the SAME fact here — the issue is home-repo data — and neither is a repo
    // to qualify. Only a supplied string is in this predicate's domain.
    if (issue.repo != null && !isRepoQualifier(issue.repo)) {
      return refuse(
        `${at}.repo`,
        `expected an owner/repo qualifier the reader can reference, got ${describeValue(issue.repo)}`,
      );
    }
    if (!isAssigneeCount(issue.assigneeCount)) {
      return refuse(`${at}.assigneeCount`, `expected an integer >= 0, got ${issue.assigneeCount}`);
    }
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
  // DOMAIN BEFORE IDENTITY. `duplicateKeyRefusal` builds a `nodeKey` from the
  // very fields checked here, so running it first would key a document this one
  // is about to refuse — and report an unreferenceable key back to the caller as
  // though it were a real one.
  const domain = inputDomainRefusal(document);
  if (domain !== null) return domain;

  const refusal = duplicateKeyRefusal(document);
  if (refusal !== null) return refusal;

  const underRead: string[] = [];

  const nodes: NodeInput[] = document.issues.map((issue) => {
    const parse = parseFrontmatter(issue.body);
    const decl = classifyDeclaration(parse);
    const repo = issue.repo ?? null;
    if (decl.state === 'unread') {
      underRead.push(nodeKey({ id: issueId(issue), repo }, document.homeRepo));
    }
    return {
      id: issueId(issue),
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
