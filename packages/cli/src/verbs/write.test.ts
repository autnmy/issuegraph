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
function edgesOf(body: string): readonly number[] {
  const decl = classifyDeclaration(parseFrontmatter(body));
  assert.equal(decl.state, 'read', `expected a readable block, got ${decl.state}`);
  assert.ok(decl.state === 'read');
  return decl.data.blockedBy.map((ref) => ref.number);
}

const REF_1 = { repo: null, number: 1 } as const;
const REF_7 = { repo: null, number: 7 } as const;
const REF_8 = { repo: null, number: 8 } as const;

describe('set', () => {
  test('on a body with no block, renders one whose re-parse carries the edges', () => {
    const result = setFields(ABSENT_BODY, { blockedBy: [REF_7, REF_8] });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(edgesOf(result.stdout), [7, 8]);
  });

  test('the rendered block keeps the original prose', () => {
    const result = setFields(ABSENT_BODY, { blockedBy: [REF_7] });
    assert.ok(result.stdout.includes(ABSENT_BODY), 'the body was not preserved');
  });

  test('on a body with a block, splices in place and leaves surrounding prose alone', () => {
    const result = setFields(QUOTED_BODY, { blockedBy: [REF_7] });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(edgesOf(result.stdout), [7]);
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
    assert.deepEqual(edgesOf(result.stdout), [8]);
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
    const result = spliceEdges(WITH_PROVENANCE, { duplicateOf: { repo: null, number: 99 } });
    assert.equal(result.code, EXIT.ok);
    assert.ok(result.stdout.includes('duplicate-of: 99'), result.stdout);
  });
});

describe('splice', () => {
  test('an owned field present replaces its entries', () => {
    const result = spliceEdges(QUOTED_BODY, { blockedBy: [REF_1] });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(edgesOf(result.stdout), [1]);
  });

  test('an owned field ABSENT leaves its entries untouched', () => {
    const result = spliceEdges(QUOTED_BODY, { serializeWith: REF_7 });
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(edgesOf(result.stdout), [123, 124]);
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
    assert.deepEqual(edgesOf(result.stdout), [1]);
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
