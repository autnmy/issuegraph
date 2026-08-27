import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseFrontmatter } from '@issuegraph/reader';

import { classifyDeclaration } from '../declaration.ts';
import { EXIT } from '../exit.ts';
import {
  ABSENT_BODY,
  CANONICAL_BODY,
  HAZARD_BODY,
  INERT_BODY,
  QUOTED_BODY,
  UNREPAIRABLE_BODY,
} from '../testing/fixtures.ts';
import { backfill, setFields, spliceEdges } from './write.ts';

/**
 * Every write assertion goes through the READER, never through string
 * comparison against the writer's byte layout. A test that pins bytes pins the
 * writer's formatting choices, which are its to change; what has to hold is that
 * the result parses back to what was asked for.
 */
function edgesOf(body: string): readonly string[] {
  const decl = classifyDeclaration(parseFrontmatter(body));
  assert.equal(decl.state, 'read', `expected a readable block, got ${decl.state}`);
  assert.ok(decl.state === 'read');
  return decl.data.blockedBy.map((ref) => ref.id);
}

const REF_1 = { repo: null, id: '1' } as const;
const REF_7 = { repo: null, id: '7' } as const;
const REF_8 = { repo: null, id: '8' } as const;

describe('set', () => {
  test('on a body with no block, renders one whose re-parse carries the edges', () => {
    const result = setFields(ABSENT_BODY, { blockedBy: [REF_7, REF_8] });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(edgesOf(result.stdout), ['7', '8']);
  });

  test('the rendered block keeps the original prose', () => {
    const result = setFields(ABSENT_BODY, { blockedBy: [REF_7] });
    assert.ok(result.stdout.includes(ABSENT_BODY), 'the body was not preserved');
  });

  test('on a body with a block, splices in place and leaves surrounding prose alone', () => {
    const result = setFields(QUOTED_BODY, { blockedBy: [REF_7] });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(edgesOf(result.stdout), ['7']);
    assert.ok(result.stdout.includes('The body.'), 'the prose was disturbed');
  });

  test('an empty blocked-by clears the edges rather than leaving them', () => {
    const result = setFields(QUOTED_BODY, { blockedBy: [] });
    assert.equal(result.code, EXIT.ok);
    const decl = classifyDeclaration(parseFrontmatter(result.stdout));
    // The writer removes the whole block when the edit leaves nothing behind.
    assert.ok(decl.state === 'absent' || (decl.state === 'read' && decl.data.blockedBy.length === 0));
  });

  test('render-only fields work on an absent body', () => {
    const result = setFields(ABSENT_BODY, { evidence: 'verified', priority: 1 });
    assert.equal(result.code, EXIT.ok);
    const decl = classifyDeclaration(parseFrontmatter(result.stdout));
    assert.ok(decl.state === 'read');
    assert.equal(decl.data.evidence, 'verified');
    assert.equal(decl.data.priority, 1);
  });

  test('render-only fields are REFUSED on a body that already has a block, with the reason', () => {
    // The writer's splice surface owns generated edges only. Refusing is the
    // honest answer; silently dropping the field is the one that costs money.
    for (const fields of [{ evidence: 'verified' } as const, { priority: 1 }, { togetherWith: REF_7 }]) {
      const result = setFields(QUOTED_BODY, fields);
      assert.equal(result.code, EXIT.refusedWrite);
      assert.equal(result.stdout, '', 'a refusal must write nothing to stdout');
      assert.ok(result.stderr.join('\n').includes('generated edges'), result.stderr.join('\n'));
    }
  });

  test('refuses the hazard and writes nothing', () => {
    const result = setFields(HAZARD_BODY, { blockedBy: [REF_7] });
    assert.equal(result.code, EXIT.unreadDeclaration);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.join('\n').includes('unread declaration'));
  });

  test('refuses an inert body and names backfill as the remedy', () => {
    const result = setFields(INERT_BODY, { blockedBy: [REF_7] });
    assert.equal(result.code, EXIT.refusedWrite);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.join('\n').includes('backfill'), result.stderr.join('\n'));
  });

  test('no fields at all is a usage error, not a silent no-op', () => {
    assert.equal(setFields(ABSENT_BODY, {}).code, EXIT.usage);
  });

  test('round-trip: parse, set, parse preserves the rest of the body byte for byte', () => {
    const result = setFields(CANONICAL_BODY, { blockedBy: [REF_8] });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(edgesOf(result.stdout), ['8']);
    assert.ok(result.stdout.includes('The body.'));
    // `evidence` was in the original block and is not an owned edge, so the
    // splice must have left it exactly where it was.
    const decl = classifyDeclaration(parseFrontmatter(result.stdout));
    assert.ok(decl.state === 'read');
    assert.equal(decl.data.evidence, 'verified');
  });
});

describe('every clear is PERFORMED on every path, since #18', () => {
  // WHAT THIS BLOCK REPLACED. It used to assert that clearing `decomposed-from`
  // or `duplicate-of` was REFUSED on both paths — correctly, because the writer
  // read an empty value there as "leave untouched" and a command that accepted
  // the request and exited 0 would report work it never did. #18 gave removal
  // its own spelling in the writer, so the request is performable and the
  // refusal has nothing left to refuse.
  //
  // The sweep it existed for is kept: `setFields` and `spliceEdges` are still
  // exercised through one shared body, because `setFields` was fixed first and
  // review found `spliceEdges` still open. A second copy is how a third path
  // gets missed.
  const WITH_PROVENANCE = [
    '---',
    'issuegraph:',
    '  decomposed-from: 7',
    '  duplicate-of: 42',
    '  serialize-with: 9',
    '---',
    '',
    'Prose.',
  ].join('\n');

  test('setFields performs it — a flat null is a clear at this boundary', () => {
    for (const [fields, gone] of [
      [{ decomposedFrom: null }, 'decomposed-from'],
      [{ duplicateOf: null }, 'duplicate-of'],
    ] as const) {
      const result = setFields(WITH_PROVENANCE, fields);
      assert.equal(result.code, EXIT.ok, gone);
      assert.ok(!result.stdout.includes(gone), result.stdout);
      // Surgical: the OTHER provenance entry and the scheduling edge stay.
      assert.ok(result.stdout.includes('serialize-with: 9'), result.stdout);
    }
  });

  test('spliceEdges performs it too — the exported path a library caller reaches', () => {
    for (const [edges, gone] of [
      [{ decomposedFrom: { clear: true } }, 'decomposed-from'],
      [{ duplicateOf: { clear: true } }, 'duplicate-of'],
    ] as const) {
      const result = spliceEdges(WITH_PROVENANCE, edges);
      assert.equal(result.code, EXIT.ok, gone);
      assert.ok(!result.stdout.includes(gone), result.stdout);
      assert.ok(result.stdout.includes('serialize-with: 9'), result.stdout);
    }
  });

  test('both paths produce the SAME body from the same request', () => {
    // The flat spelling and the wrapped one are one translation apart, so a
    // difference between them would be a bug in that translation rather than a
    // difference a caller should have to learn.
    const a = setFields(WITH_PROVENANCE, { duplicateOf: null });
    const b = spliceEdges(WITH_PROVENANCE, { duplicateOf: { clear: true } });
    assert.equal(a.code, b.code);
    assert.equal(a.stdout, b.stdout);
  });

  test('CONTROL: omitting the key still leaves the entry alone at exit 0', () => {
    // The distinction #18 turns on: absence is the ONLY way to say "not mine",
    // and it has to keep meaning that now that a present value can remove.
    const result = spliceEdges(WITH_PROVENANCE, { blockedBy: { set: [REF_1] } });
    assert.equal(result.code, EXIT.ok);
    // BARE, not `"#42"`. These entries are UNOWNED by this call, so the splice
    // preserves them byte-for-byte — the author's spelling survives. Only
    // entries the writer RENDERS take the canonical quoted form.
    assert.ok(result.stdout.includes('duplicate-of: 42'), result.stdout);
    assert.ok(result.stdout.includes('decomposed-from: 7'), result.stdout);
  });

  test('CONTROL: the clear that always worked still works on both paths', () => {
    for (const result of [
      setFields(WITH_PROVENANCE, { serializeWith: null }),
      spliceEdges(WITH_PROVENANCE, { serializeWith: { clear: true } }),
    ]) {
      assert.equal(result.code, EXIT.ok);
      assert.ok(!result.stdout.includes('serialize-with'), result.stdout);
    }
  });

  test('CONTROL: an ordinary write to those same fields still lands', () => {
    const result = spliceEdges(WITH_PROVENANCE, { duplicateOf: { set: { repo: null, id: '99' } } });
    assert.equal(result.code, EXIT.ok);
    assert.ok(result.stdout.includes('duplicate-of: "#99"'), result.stdout);
  });
});

describe('the write funnel — one gate, every path', () => {
  /**
   * ENUMERATED AS DATA so a new write operation is one row, and every
   * precondition below is asserted over ALL of them rather than once per
   * operation. Three review rounds each found the next write path missing the
   * check the previous round added; this is that pattern's stop-condition.
   */
  /**
   * EACH ROW CARRIES ITS OWN SPELLING OF THE SAME INTENT since #18. The two
   * surfaces are one translation apart — `setFields` is flat, `spliceEdges`
   * takes the writer's wrapped `EdgeWrite` — so a single shared request literal
   * would have to be one of the two, and the funnel would then be testing one
   * path with a request the other cannot express. The INTENTS are what the
   * table shares; only their spelling differs.
   */
  const WRITE_OPERATIONS = [
    {
      name: 'setFields',
      run: (body: string, request: never) => setFields(body, request),
      nothing: {},
      clearDuplicate: { duplicateOf: null },
      setBlockedBy: { blockedBy: [REF_7] },
    },
    {
      name: 'spliceEdges',
      run: (body: string, request: never) => spliceEdges(body, request),
      nothing: {},
      clearDuplicate: { duplicateOf: { clear: true } },
      setBlockedBy: { blockedBy: { set: [REF_7] } },
    },
  ] as const;

  const WITH_BLOCK = ['---', 'issuegraph:', '  blocked-by:', '    - 1', '  duplicate-of: 42', '---', '', 'Prose.'].join('\n');

  test('every write operation refuses a request that asks for nothing', () => {
    for (const { name, run, nothing } of WRITE_OPERATIONS) {
      const result = run(WITH_BLOCK, nothing as never);
      assert.equal(result.code, EXIT.usage, `${name} accepted an empty request`);
      assert.equal(result.stdout, '', `${name} wrote a body for an empty request`);
    }
  });

  test('every write operation PERFORMS a clear — the row that used to refuse one', () => {
    // It asserted `refusedWrite` until #18, for the two fields the writer could
    // set but not remove. Every owned field is clearable now, so the row stays
    // in the funnel with its expectation inverted rather than being deleted:
    // "does every path treat this request the same way" is the question the
    // table exists for, and the answer moving from refuse to perform does not
    // retire it.
    for (const { name, run, clearDuplicate } of WRITE_OPERATIONS) {
      const result = run(WITH_BLOCK, clearDuplicate as never);
      assert.equal(result.code, EXIT.ok, `${name} refused a clear it can perform`);
      assert.ok(!result.stdout.includes('duplicate-of'), `${name}: ${result.stdout}`);
      assert.deepEqual(edgesOf(result.stdout), ['1'], `${name}: an unowned edge must survive`);
    }
  });

  test('every write operation refuses an unread block', () => {
    for (const { name, run, setBlockedBy } of WRITE_OPERATIONS) {
      const result = run(HAZARD_BODY, setBlockedBy as never);
      assert.equal(result.code, EXIT.unreadDeclaration, `${name} wrote into an unread block`);
      assert.equal(result.stdout, '');
    }
  });

  test('CONTROL: every write operation still performs an ordinary write', () => {
    // Without this the tests above would pass for a package that had simply
    // stopped writing anything at all.
    for (const { name, run, setBlockedBy } of WRITE_OPERATIONS) {
      const result = run(WITH_BLOCK, setBlockedBy as never);
      assert.equal(result.code, EXIT.ok, `${name} refused a valid write`);
      assert.deepEqual(edgesOf(result.stdout), ['7'], name);
    }
  });

  test('the paths answer identically, so they cannot drift apart', () => {
    // Refusals AND successes. A shared refusal was the original point; since
    // #18 the clear succeeds on both paths, and two paths that agree on how to
    // say no while disagreeing on what they write would be worse than either.
    for (const intent of ['nothing', 'clearDuplicate', 'setBlockedBy'] as const) {
      const [a, b] = WRITE_OPERATIONS.map((op) => op.run(WITH_BLOCK, op[intent] as never));
      assert.ok(a !== undefined && b !== undefined);
      assert.equal(a.code, b.code, intent);
      assert.deepEqual(a.stderr, b.stderr, intent);
      assert.equal(a.stdout, b.stdout, intent);
    }
  });
});

describe('splice', () => {
  test('an owned field present replaces its entries', () => {
    const result = spliceEdges(QUOTED_BODY, { blockedBy: { set: [REF_1] } });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(edgesOf(result.stdout), ['1']);
  });

  test('an owned field ABSENT leaves its entries untouched', () => {
    const result = spliceEdges(QUOTED_BODY, { serializeWith: { set: REF_7 } });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(edgesOf(result.stdout), ['123', '124']);
  });

  test('an explicit empty list removes entries without inserting', () => {
    const result = spliceEdges(CANONICAL_BODY, { blockedBy: { set: [] } });
    assert.equal(result.code, EXIT.ok);
    const decl = classifyDeclaration(parseFrontmatter(result.stdout));
    assert.ok(decl.state === 'read');
    assert.deepEqual(decl.data.blockedBy, []);
    assert.equal(decl.data.evidence, 'verified', 'an unowned field must survive');
  });

  test('refuses a body with no block — unlike set, it never prepends', () => {
    const result = spliceEdges(ABSENT_BODY, { blockedBy: { set: [REF_1] } });
    assert.equal(result.code, EXIT.refusedWrite);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.join('\n').includes('set'), 'the refusal should point at the verb that does prepend');
  });

  test('refuses the hazard', () => {
    const result = spliceEdges(HAZARD_BODY, { blockedBy: { set: [REF_1] } });
    assert.equal(result.code, EXIT.unreadDeclaration);
    assert.equal(result.stdout, '');
  });
});

describe('backfill', () => {
  test('repairs an inert body into one that reads', () => {
    const result = backfill(INERT_BODY);
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(edgesOf(result.stdout), ['1']);
    // The loop closes: what `validate` flagged, `backfill` fixes.
    assert.equal(classifyDeclaration(parseFrontmatter(INERT_BODY)).state, 'inert');
  });

  test('leaves an already-canonical body byte for byte identical', () => {
    const result = backfill(CANONICAL_BODY);
    assert.equal(result.code, EXIT.ok);
    assert.equal(result.stdout, CANONICAL_BODY);
    assert.ok(result.stderr.join('\n').includes('unchanged'));
  });

  test('leaves a body with no block alone, and says so', () => {
    const result = backfill(ABSENT_BODY);
    assert.equal(result.code, EXIT.ok);
    assert.equal(result.stdout, ABSENT_BODY);
    assert.ok(result.stderr.join('\n').includes('no block'));
  });
});

/**
 * A request key the writer cannot act on.
 *
 * EVERY CASE HERE IS UNREACHABLE FROM TYPESCRIPT, and that is the finding rather
 * than a gap in it: `{ serialiseWith: ref }` draws TS2561 as a literal and TS2559
 * as a variable, so the reachable population is plain-JavaScript callers of an
 * exported function. A published package's type annotation is a promise to
 * TypeScript callers and nothing at all to the others — the same reasoning
 * `@issuegraph/core`'s own predicates were corrected on — so the tests reach the
 * functions the way that population does, through `as unknown as`, exactly as
 * this repository's other untyped-caller tests do.
 */
describe('a write request naming a field the writer cannot act on', () => {
  function setFromJs(fields: Record<string, unknown>) {
    return setFields(CANONICAL_BODY, fields as unknown as Parameters<typeof setFields>[1]);
  }
  function spliceFromJs(edges: Record<string, unknown>) {
    return spliceEdges(CANONICAL_BODY, edges as unknown as Parameters<typeof spliceEdges>[1]);
  }

  test('a misspelled key is refused, not ignored — this is the whole defect', () => {
    // It used to pass `writeRequestRefusal` (the request was non-empty), the
    // writer ignored the property it does not know, and the wrapper returned the
    // UNCHANGED body at exit 0 — a command telling its caller an edit happened
    // when none did, which is the one outcome this package exists to refuse.
    const result = setFromJs({ serialiseWith: REF_7 });
    assert.equal(result.code, EXIT.usage);
    assert.equal(result.stdout, '', 'a refused write must emit no body');
    assert.ok(result.stderr.join('\n').includes('serialiseWith'), result.stderr.join('\n'));
  });

  test('the refusal lists what IS allowed, so the caller can fix it without guessing', () => {
    const message = setFromJs({ serialiseWith: REF_7 }).stderr.join('\n');
    for (const key of ['blockedBy', 'serializeWith', 'priority', 'evidence']) {
      assert.ok(message.includes(key), `${key} missing from: ${message}`);
    }
  });

  test('the allowlist is PER PATH: a set-only field is refused by splice', () => {
    // The case a single shared allowlist would wave through. `togetherWith` is a
    // real `SetFields` key, so a union allowlist would accept it here — and
    // `spliceGeneratedEdges` does not own it, so the request would be ignored and
    // the body returned unchanged at exit 0. Same defect, one field further along.
    const result = spliceFromJs({ togetherWith: REF_7 });
    assert.equal(result.code, EXIT.usage);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.join('\n').includes('togetherWith'), result.stderr.join('\n'));
  });

  test('CONTROL: that same field is accepted by set, on a body with no block', () => {
    // Proves the refusal above is about the SURFACE REACHED and not about the
    // field being unknown to the package — otherwise the test above would pass
    // for the wrong reason.
    const result = setFields(ABSENT_BODY, { togetherWith: REF_7 });
    assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
  });

  test('CONTROL: every allowed key still reaches the writer', () => {
    // The refusal must not have narrowed the surface. A stale allowlist would
    // refuse a write the writer can perform — the mirror image of the defect.
    assert.equal(setFields(CANONICAL_BODY, { blockedBy: [REF_7] }).code, EXIT.ok);
    assert.equal(setFields(CANONICAL_BODY, { serializeWith: REF_7 }).code, EXIT.ok);
    assert.equal(setFields(CANONICAL_BODY, { decomposedFrom: REF_7 }).code, EXIT.ok);
    assert.equal(setFields(CANONICAL_BODY, { duplicateOf: REF_7 }).code, EXIT.ok);
    assert.equal(spliceEdges(CANONICAL_BODY, { blockedBy: { set: [REF_7] } }).code, EXIT.ok);
    assert.equal(spliceEdges(CANONICAL_BODY, { serializeWith: { clear: true } }).code, EXIT.ok);
  });

  test('an explicitly-undefined value asks for nothing, exactly as an absent key does', () => {
    // Counting KEYS let this one shape of "nothing requested" through to a
    // body-unchanged exit 0. Absent and explicitly-undefined mean the same thing
    // to every reader downstream, so they get the same answer here.
    for (const request of [{ blockedBy: undefined }, { serializeWith: undefined }]) {
      const result = setFromJs(request);
      assert.equal(result.code, EXIT.usage, JSON.stringify(request));
      assert.equal(result.stdout, '');
      assert.ok(result.stderr.join('\n').includes('nothing to write'), result.stderr.join('\n'));
    }
  });

  test('CONTROL: a clear request is a request — [] and null are not "nothing"', () => {
    // The undefined rule must not swallow the two values that MEAN remove.
    assert.equal(setFields(CANONICAL_BODY, { blockedBy: [] }).code, EXIT.ok);
    assert.equal(setFields(CANONICAL_BODY, { serializeWith: null }).code, EXIT.ok);
  });

  test('an unsupported key is reported ahead of the OTHER refusal in the same request', () => {
    // Both are wrong with the request; the misspelling is the one the caller can
    // act on, and reporting the other would describe a request they did not make.
    //
    // THE SECOND DEFECT USED TO BE `decomposedFrom: null`, an unperformable
    // clear. #18 made that a real clear, so the pairing stopped being a pairing
    // and this test quietly became a single-defect test that could no longer
    // fail for the ordering it names. `priority` restores it: a render-only
    // field is still refused in a body that already has a block, so there are
    // genuinely two defects and the unsupported key must still win. Raised in
    // review.
    const result = setFromJs({ serialiseWith: REF_7, priority: 2 });
    const message = result.stderr.join('\n');
    assert.ok(message.includes('serialiseWith'), message);
    // ASSERTED ON THE EXIT CODE, not on the absence of the word "priority" —
    // the unsupported-key message lists every ALLOWED field, and `priority` is
    // one of them, so a substring test reads as a failure when the ordering is
    // in fact correct. `usage` is the unsupported-key code; `refusedWrite` is
    // the render-only one. Which code comes back IS the ordering.
    assert.equal(result.code, EXIT.usage, `the unsupported key must win: ${message}`);
    assert.ok(!message.includes('owns generated edges only'), `the render-only refusal must not fire: ${message}`);
  });
});

/**
 * `backfill --json` — the OUTCOME as data.
 *
 * Every assertion here is about a caller that cannot read prose. The verb's
 * stderr is unchanged and is not what these test.
 */
describe('backfill --json', () => {
  /** The parsed payload, with the shape assertions a reader needs done once. */
  function payload(body: string): Record<string, unknown> {
    const result = backfill(body, { json: true });
    const parsed: unknown = JSON.parse(result.stdout);
    assert.ok(typeof parsed === 'object' && parsed !== null, 'the payload must be an object');
    return parsed as Record<string, unknown>;
  }

  test('THE DISCRIMINATOR: two bodies `validate` cannot tell apart get different outcomes', () => {
    // THE PRECONDITION IS THE TEST. Without it this reads as two unrelated
    // assertions about two fixtures; with it, it is the claim that this flag
    // carries information available NOWHERE else in the binary.
    //
    // Asserted through `validate`'s own classifier rather than a remembered
    // string, so a future change that made `validate` discriminating would
    // redden this precondition and retire the test honestly, instead of leaving
    // it passing for a reason that had stopped being true.
    const inert = classifyDeclaration(parseFrontmatter(INERT_BODY));
    const unrepairable = classifyDeclaration(parseFrontmatter(UNREPAIRABLE_BODY));
    assert.equal(inert.state, 'inert');
    assert.equal(unrepairable.state, 'inert');
    assert.equal(
      inert.state === 'inert' ? inert.blockDefect : null,
      unrepairable.state === 'inert' ? unrepairable.blockDefect : null,
      'precondition: the two bodies must be indistinguishable to the classifier `validate` uses',
    );

    assert.equal(payload(INERT_BODY).outcome, 'delimited');
    assert.equal(payload(UNREPAIRABLE_BODY).outcome, 'unrecoverable');
  });

  test('a repaired body is reported AND is the body that reads', () => {
    const parsed = payload(INERT_BODY);
    assert.equal(parsed.outcome, 'delimited');
    assert.equal(typeof parsed.body, 'string');
    // Through the reader, never a byte comparison — the writer owns its layout.
    assert.deepEqual(edgesOf(String(parsed.body)), ['1']);
  });

  test('a refusal carries NO `body` key at all, at the wire level', () => {
    const result = backfill(UNREPAIRABLE_BODY, { json: true });
    assert.equal(result.code, EXIT.refusedWrite);

    const parsed = payload(UNREPAIRABLE_BODY);
    assert.equal(parsed.outcome, 'unrecoverable');
    // `Object.hasOwn`, not `=== undefined`: the claim is that the key is ABSENT
    // from the JSON, not merely that it reads as undefined. A `"body": null`
    // would satisfy the weaker test and is exactly the value a caller could
    // write back believing the input had been repaired.
    assert.equal(Object.hasOwn(parsed, 'body'), false, result.stdout);
    assert.ok(Array.isArray(parsed.diagnostics) && parsed.diagnostics.length > 0);
  });

  test('the two unchanged-body outcomes still carry the body they did not change', () => {
    for (const [body, outcome] of [
      [CANONICAL_BODY, 'already-canonical'],
      [ABSENT_BODY, 'no-block'],
    ] as const) {
      const parsed = payload(body);
      assert.equal(parsed.outcome, outcome);
      assert.equal(parsed.body, body, `${outcome} must round-trip its input byte for byte`);
    }
  });

  test('the flag changes the PAYLOAD and never the exit code', () => {
    // `exit.ts`: the code carries the command's decision, the payload carries
    // the declaration's state. A flag that softened `unrecoverable` to `ok`
    // would make a shell reading and a program reading disagree about one run.
    for (const body of [INERT_BODY, CANONICAL_BODY, ABSENT_BODY, UNREPAIRABLE_BODY, HAZARD_BODY, QUOTED_BODY]) {
      assert.equal(
        backfill(body, { json: true }).code,
        backfill(body).code,
        'the exit code must not depend on --json',
      );
      assert.deepEqual(
        backfill(body, { json: true }).stderr,
        backfill(body).stderr,
        'the stderr must not depend on --json',
      );
    }
  });

  test('default is body mode, so a bare call is unchanged', () => {
    // The regression guard for `issuegraph backfill < body > new-body`.
    assert.equal(backfill(INERT_BODY).stdout, backfill(INERT_BODY, { json: false }).stdout);
    assert.deepEqual(edgesOf(backfill(INERT_BODY).stdout), ['1']);
  });

  test('body mode emits NOTHING on a refusal', () => {
    // Pre-existing behaviour, pinned here because the refusal arm was rewritten:
    // a caller redirecting stdout to a file must not be handed the unrepaired
    // input to write back.
    const result = backfill(UNREPAIRABLE_BODY);
    assert.equal(result.code, EXIT.refusedWrite);
    assert.equal(result.stdout, '');
  });

  test('every outcome says something on stderr', () => {
    // The note table is total over the writer's outcome union, so a fifth
    // outcome is a compile error rather than a silent empty line. This is the
    // runtime half: each of the four reachable outcomes actually prints.
    for (const body of [INERT_BODY, CANONICAL_BODY, ABSENT_BODY, UNREPAIRABLE_BODY]) {
      const [first] = backfill(body, { json: true }).stderr;
      assert.ok(
        typeof first === 'string' && first.startsWith('issuegraph: '),
        `no note for ${JSON.stringify(body.slice(0, 20))}`,
      );
    }
  });
});
