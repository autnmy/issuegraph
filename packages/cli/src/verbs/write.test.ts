import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseFrontmatter } from '@issuegraph/reader';

import { classifyDeclaration } from '../declaration.ts';
import { EXIT } from '../exit.ts';
import { ABSENT_BODY, CANONICAL_BODY, HAZARD_BODY, INERT_BODY, QUOTED_BODY } from '../testing/fixtures.ts';
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

describe('a clear the writer cannot perform is refused on EVERY path', () => {
  // The class, swept. `setFields` was fixed first and review found `spliceEdges`
  // still open, so both now go through one shared test rather than two inline
  // copies — a second copy is how a third path gets missed.
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

  test('setFields refuses it', () => {
    for (const fields of [{ decomposedFrom: null }, { duplicateOf: null }] as const) {
      const result = setFields(WITH_PROVENANCE, fields);
      assert.equal(result.code, EXIT.refusedWrite);
      assert.equal(result.stdout, '');
    }
  });

  test('spliceEdges refuses it too — the exported path a library caller reaches', () => {
    for (const edges of [{ decomposedFrom: null }, { duplicateOf: null }] as const) {
      const result = spliceEdges(WITH_PROVENANCE, edges);
      assert.equal(result.code, EXIT.refusedWrite);
      assert.equal(result.stdout, '', 'a refusal writes no body');
    }
  });

  test('both paths give the SAME code and the same reason', () => {
    const a = setFields(WITH_PROVENANCE, { duplicateOf: null });
    const b = spliceEdges(WITH_PROVENANCE, { duplicateOf: null });
    assert.equal(a.code, b.code);
    assert.deepEqual(a.stderr, b.stderr);
  });

  test('CONTROL: omitting the key leaves the entry alone at exit 0', () => {
    // The intent `null` might have expressed is already expressible by omission,
    // which is why refusing it breaks nothing.
    const result = spliceEdges(WITH_PROVENANCE, { blockedBy: [REF_1] });
    assert.equal(result.code, EXIT.ok);
    // BARE, not `"#42"`. These entries are UNOWNED by this call, so the splice
    // preserves them byte-for-byte — the author's spelling survives. Only
    // entries the writer RENDERS take the canonical quoted form.
    assert.ok(result.stdout.includes('duplicate-of: 42'), result.stdout);
    assert.ok(result.stdout.includes('decomposed-from: 7'), result.stdout);
  });

  test('CONTROL: the clear the writer CAN perform still works on both paths', () => {
    for (const result of [
      setFields(WITH_PROVENANCE, { serializeWith: null }),
      spliceEdges(WITH_PROVENANCE, { serializeWith: null }),
    ]) {
      assert.equal(result.code, EXIT.ok);
      assert.ok(!result.stdout.includes('serialize-with'), result.stdout);
    }
  });

  test('CONTROL: an ordinary write to those same fields still lands', () => {
    const result = spliceEdges(WITH_PROVENANCE, { duplicateOf: { repo: null, id: '99' } });
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
  const WRITE_OPERATIONS: readonly (readonly [name: string, run: (body: string, request: never) => ReturnType<typeof setFields>])[] = [
    ['setFields', (body, request) => setFields(body, request)],
    ['spliceEdges', (body, request) => spliceEdges(body, request)],
  ];

  const WITH_BLOCK = ['---', 'issuegraph:', '  blocked-by:', '    - 1', '  duplicate-of: 42', '---', '', 'Prose.'].join('\n');

  test('every write operation refuses a request that asks for nothing', () => {
    for (const [name, run] of WRITE_OPERATIONS) {
      const result = run(WITH_BLOCK, {} as never);
      assert.equal(result.code, EXIT.usage, `${name} accepted an empty request`);
      assert.equal(result.stdout, '', `${name} wrote a body for an empty request`);
    }
  });

  test('every write operation refuses a clear the writer cannot perform', () => {
    for (const [name, run] of WRITE_OPERATIONS) {
      const result = run(WITH_BLOCK, { duplicateOf: null } as never);
      assert.equal(result.code, EXIT.refusedWrite, `${name} accepted an unperformable clear`);
      assert.equal(result.stdout, '', `${name} wrote a body for a refused clear`);
    }
  });

  test('every write operation refuses an unread block', () => {
    for (const [name, run] of WRITE_OPERATIONS) {
      const result = run(HAZARD_BODY, { blockedBy: [REF_7] } as never);
      assert.equal(result.code, EXIT.unreadDeclaration, `${name} wrote into an unread block`);
      assert.equal(result.stdout, '');
    }
  });

  test('CONTROL: every write operation still performs an ordinary write', () => {
    // Without this the three tests above would pass for a package that had
    // simply stopped writing anything at all.
    for (const [name, run] of WRITE_OPERATIONS) {
      const result = run(WITH_BLOCK, { blockedBy: [REF_7] } as never);
      assert.equal(result.code, EXIT.ok, `${name} refused a valid write`);
      assert.deepEqual(edgesOf(result.stdout), ['7'], name);
    }
  });

  test('the refusals are identical across paths, so they cannot drift apart', () => {
    for (const request of [{}, { duplicateOf: null }]) {
      const [a, b] = WRITE_OPERATIONS.map(([, run]) => run(WITH_BLOCK, request as never));
      assert.ok(a !== undefined && b !== undefined);
      assert.equal(a.code, b.code);
      assert.deepEqual(a.stderr, b.stderr);
    }
  });
});

describe('splice', () => {
  test('an owned field present replaces its entries', () => {
    const result = spliceEdges(QUOTED_BODY, { blockedBy: [REF_1] });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(edgesOf(result.stdout), ['1']);
  });

  test('an owned field ABSENT leaves its entries untouched', () => {
    const result = spliceEdges(QUOTED_BODY, { serializeWith: REF_7 });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(edgesOf(result.stdout), ['123', '124']);
  });

  test('an explicit empty list removes entries without inserting', () => {
    const result = spliceEdges(CANONICAL_BODY, { blockedBy: [] });
    assert.equal(result.code, EXIT.ok);
    const decl = classifyDeclaration(parseFrontmatter(result.stdout));
    assert.ok(decl.state === 'read');
    assert.deepEqual(decl.data.blockedBy, []);
    assert.equal(decl.data.evidence, 'verified', 'an unowned field must survive');
  });

  test('refuses a body with no block — unlike set, it never prepends', () => {
    const result = spliceEdges(ABSENT_BODY, { blockedBy: [REF_1] });
    assert.equal(result.code, EXIT.refusedWrite);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.join('\n').includes('set'), 'the refusal should point at the verb that does prepend');
  });

  test('refuses the hazard', () => {
    const result = spliceEdges(HAZARD_BODY, { blockedBy: [REF_1] });
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
    assert.equal(spliceEdges(CANONICAL_BODY, { blockedBy: [REF_7] }).code, EXIT.ok);
    assert.equal(spliceEdges(CANONICAL_BODY, { serializeWith: null }).code, EXIT.ok);
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

  test('an unsupported key is reported ahead of a clear the writer cannot perform', () => {
    // Both are wrong with the request; the misspelling is the one the caller can
    // act on, and reporting the other would describe a request they did not make.
    const message = setFromJs({ serialiseWith: REF_7, decomposedFrom: null }).stderr.join('\n');
    assert.ok(message.includes('serialiseWith'), message);
  });
});
