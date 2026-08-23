import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_EVIDENCE,
  DEFAULT_PRIORITY,
  EDGE_CARDINALITY,
  EDGE_FIELDS,
  EVIDENCE_VALUES,
  FIELDS,
  FRONTMATTER_KEY,
  PRIORITY_MAX,
  PRIORITY_MIN,
  SCALAR_FIELDS,
  SPEC_VERSION,
  isEdgeField,
  isEvidence,
  isField,
  isPriority,
  isScalarField,
} from './index.ts';

const specPath = fileURLToPath(new URL('../../../SPEC.md', import.meta.url));
const spec = readFileSync(specPath, 'utf8');

/**
 * Read the field names out of SPEC.md's own §4.3 table.
 *
 * This is the point of the whole test file: the vocabulary is a copy of
 * something, and a copy that nothing compares against drifts. Adding a field to
 * the spec without adding it here must fail, and it does — the sets are
 * compared both ways.
 */
function fieldNamesDeclaredBySpec(): string[] {
  const start = spec.indexOf('### 4.3 Fields');
  assert.notEqual(start, -1, 'SPEC.md no longer contains a "### 4.3 Fields" heading');
  const rest = spec.slice(start + '### 4.3 Fields'.length);
  const end = rest.indexOf('####');
  assert.notEqual(end, -1, 'SPEC.md §4.3 is no longer followed by a #### subsection');
  const table = rest.slice(0, end);

  const names: string[] = [];
  for (const line of table.split('\n')) {
    const row = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (row?.[1] !== undefined) names.push(row[1]);
  }
  return names;
}

test('the field vocabulary matches SPEC.md §4.3, in both directions', () => {
  const declared = fieldNamesDeclaredBySpec();
  assert.ok(declared.length > 0, 'parsed no field rows out of SPEC.md §4.3');
  assert.deepEqual([...declared].sort(), [...FIELDS].sort());
});

test("SPEC_VERSION matches SPEC.md's version header", () => {
  const header = /^\*\*Version:\*\*\s*(\d+\.\d+\.\d+)/m.exec(spec)?.[1];
  assert.ok(header !== undefined, 'SPEC.md no longer carries a **Version:** header');
  assert.equal(SPEC_VERSION, header);
});

test('SPEC.md §8 restates the version its header declares', () => {
  // §8 narrates the version the header fixes, so the two can drift — and had, at
  // 0.1.0 against a 0.2.0 header, until this pin was written. Cheap to keep true.
  const header = /^\*\*Version:\*\*\s*(\d+\.\d+\.\d+)/m.exec(spec)?.[1];
  const narrated = /This is \*\*v(\d+\.\d+\.\d+)/.exec(spec)?.[1];
  assert.ok(narrated !== undefined, 'SPEC.md §8 no longer states a version in the expected form');
  assert.equal(narrated, header);
});

test('FIELDS is exactly the edge fields plus the scalar fields, with no overlap', () => {
  assert.deepEqual([...FIELDS], [...EDGE_FIELDS, ...SCALAR_FIELDS]);
  const overlap = EDGE_FIELDS.filter((field) => (SCALAR_FIELDS as readonly string[]).includes(field));
  assert.deepEqual(overlap, []);
  assert.equal(new Set(FIELDS).size, FIELDS.length);
});

test('every edge field declares a cardinality, and only blocked-by is a list', () => {
  assert.deepEqual(Object.keys(EDGE_CARDINALITY).sort(), [...EDGE_FIELDS].sort());
  const lists = Object.entries(EDGE_CARDINALITY)
    .filter(([, cardinality]) => cardinality === 'list')
    .map(([field]) => field);
  assert.deepEqual(lists, ['blocked-by']);
});

test('the exported vocabulary is frozen', () => {
  for (const value of [EDGE_FIELDS, SCALAR_FIELDS, FIELDS, EVIDENCE_VALUES, EDGE_CARDINALITY]) {
    assert.ok(Object.isFrozen(value));
  }
});

test('the documented defaults are the documented defaults', () => {
  assert.equal(DEFAULT_PRIORITY, 2);
  assert.equal(DEFAULT_EVIDENCE, 'asserted');
  assert.ok(isEvidence(DEFAULT_EVIDENCE));
  assert.ok(isPriority(DEFAULT_PRIORITY));
  assert.equal(FRONTMATTER_KEY, 'issuegraph');
  assert.deepEqual([...EVIDENCE_VALUES], ['asserted', 'verified']);
});

test('the field guards accept every field and reject a plausible near-miss', () => {
  for (const field of EDGE_FIELDS) {
    assert.ok(isEdgeField(field));
    assert.ok(isField(field));
    assert.ok(!isScalarField(field));
  }
  for (const field of SCALAR_FIELDS) {
    assert.ok(isScalarField(field));
    assert.ok(isField(field));
    assert.ok(!isEdgeField(field));
  }
  for (const nearMiss of ['blocks', 'blocked_by', 'blockedBy', 'Blocked-By', 'duplicate', '']) {
    assert.ok(!isField(nearMiss), `${nearMiss} should not be a field`);
  }
  assert.ok(!isEvidence('asserted '));
  assert.ok(!isEvidence('VERIFIED'));
});

test('isPriority accepts 0-3 and rejects the shapes YAML actually produces', () => {
  for (const priority of [PRIORITY_MIN, 1, 2, PRIORITY_MAX]) assert.ok(isPriority(priority));
  for (const notPriority of [-1, 4, 1.5, NaN, Infinity, '2', null, undefined, [2], { priority: 2 }]) {
    assert.ok(!isPriority(notPriority), `${String(notPriority)} should not be a priority`);
  }
});

test('the guards read a prototype key as absent, not as a field', () => {
  for (const inherited of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.ok(!isField(inherited));
    assert.ok(!isEdgeField(inherited));
    assert.ok(!isEvidence(inherited));
  }
});
