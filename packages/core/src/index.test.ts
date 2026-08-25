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
  SYMMETRIC_EDGE_FIELDS,
  isEdgeField,
  isEvidence,
  isField,
  isPriority,
  isScalarField,
  isRefId,
  isRepoQualifier,
  isSymmetricEdgeField,
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
  for (const value of [
    EDGE_FIELDS,
    SCALAR_FIELDS,
    FIELDS,
    EVIDENCE_VALUES,
    EDGE_CARDINALITY,
    SYMMETRIC_EDGE_FIELDS,
  ]) {
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

test('the symmetric edge fields are a subset of the edge fields, and the split is total', () => {
  // Pinned against the spec by reading, not by parsing: §4.3.4 states the serialize
  // group is "treated as undirected" and §4.3.7 says together-with's encoding
  // "mirrors serialize-with: symmetric". Neither sentence lives in a table, and a
  // matcher over prose is a parser for an open grammar — it would find a new edge
  // case every time someone reworded a paragraph. So the constant is pinned here
  // and the spec sections are cited in its doc comment.
  for (const field of SYMMETRIC_EDGE_FIELDS) {
    assert.ok(isEdgeField(field), `${field} should be an edge field`);
    assert.ok(isSymmetricEdgeField(field));
  }
  assert.deepEqual([...SYMMETRIC_EDGE_FIELDS], ['serialize-with', 'together-with']);

  const directed = EDGE_FIELDS.filter((field) => !isSymmetricEdgeField(field));
  assert.deepEqual([...directed], ['blocked-by', 'decomposed-from', 'duplicate-of']);
  assert.equal(directed.length + SYMMETRIC_EDGE_FIELDS.length, EDGE_FIELDS.length);
});

test('the reference predicates test the TYPE before the pattern', () => {
  // `RegExp.test` COERCES, and the coercion is not a curiosity: the opaque-id
  // pattern tested against `undefined` tests the string "undefined", which is a
  // perfectly good identifier. Typed `string`, these returned TRUE for every
  // non-string primitive — and a type annotation is a promise to TypeScript
  // callers and nothing at all to the JavaScript ones a published package has.
  //
  // Measured consequence before the guard: `renderRef({ repo: null, id:
  // undefined })` emitted `"#undefined"`, which parses back as a valid
  // reference with zero diagnostics. An unresolvable blocker still blocks, so
  // the issue is permanently unready and nothing says why.
  for (const value of [undefined, null, true, false, 123, 0, {}, [], () => 1]) {
    assert.equal(isRefId(value), false, `isRefId(${String(value)})`);
    assert.equal(isRepoQualifier(value), false, `isRepoQualifier(${String(value)})`);
  }

  // CONTROL: the guard must not have swallowed the valid cases with them.
  for (const id of ['1', '231', 'ABC-123', 'ENG-456', String(Number.MAX_SAFE_INTEGER)]) {
    assert.equal(isRefId(id), true, id);
  }
  assert.equal(isRepoQualifier('acme/widgets'), true);

  // And the numeric bound still applies to the strings that carry one.
  for (const id of ['0', '007', '99999999999999999999999']) {
    assert.equal(isRefId(id), false, id);
  }
});

test('the Set-backed predicates never had the coercion problem', () => {
  // The negative half of the sweep, so the class is bounded by evidence rather
  // than by having stopped looking: `Set.has` does not coerce, so every other
  // predicate in this module already refused a non-string. That is what made
  // the two regex ones the whole class, and the inconsistency an internal one.
  for (const value of [undefined, null, true, 123]) {
    assert.equal(isEvidence(value as unknown as string), false, `isEvidence(${String(value)})`);
    assert.equal(isField(value as unknown as string), false, `isField(${String(value)})`);
    assert.equal(isPriority(value), false, `isPriority(${String(value)})`);
  }
});

/**
 * Read §4.2's identifier conformance table out of SPEC.md.
 *
 * The same reason the §4.3 reader above exists: the grammar is stated in two
 * places, and a copy nothing compares against drifts. This one earned its keep
 * immediately — §4.2 said an identifier was "whatever string the host tracker
 * uses to name an issue" while `isRefId` admitted a bounded class, and nothing
 * in the suite could see the contradiction.
 *
 * A BEHAVIOURAL pin rather than a comparison of pattern SOURCES. The spec states
 * the class in prose for a human; matching that text against a regex literal
 * would compare two spellings and prove nothing about how either is read. The
 * table states cases, and the cases are what both sides must agree on.
 */
function identifierCasesDeclaredBySpec(): { id: string; accepted: boolean }[] {
  const start = spec.indexOf('### 4.2 Issue references');
  assert.notEqual(start, -1, 'SPEC.md no longer contains a "### 4.2 Issue references" heading');
  const section = spec.slice(start, spec.indexOf('### 4.3 Fields'));
  const marker = '| identifier | accepted | why |';
  const tableAt = section.indexOf(marker);
  assert.notEqual(tableAt, -1, 'SPEC.md §4.2 no longer carries the identifier conformance table');
  // CONTIGUOUS rows only, stopping at the first line that is not a table row.
  // §4.2 carries a SECOND table (the sigil-quoting one), and filtering every
  // `|`-prefixed line in the section jumps the blank line between them and
  // parses both as one — which is how this test first failed, on a header cell
  // from the wrong table.
  const rows: string[] = [];
  for (const line of section.slice(tableAt + marker.length).split('\n').slice(1)) {
    if (!line.startsWith('|')) break;
    rows.push(line);
  }
  assert.ok(rows.length > 1, 'SPEC.md §4.2 identifier table has no rows under its separator');
  const cases: { id: string; accepted: boolean }[] = [];
  for (const row of rows.slice(1)) { // drop the |---|---|---| separator
    const cells = row.split('|').map((cell) => cell.trim());
    const id = cells[1];
    const verdict = cells[2];
    if (id === undefined || verdict === undefined || id === '') break;
    assert.match(id, /^`.*`$/, `§4.2 identifier cell is not backticked: ${row}`);
    assert.ok(verdict === 'yes' || verdict === 'no', `§4.2 verdict must be yes|no, got "${verdict}"`);
    cases.push({ id: id.slice(1, -1), accepted: verdict === 'yes' });
  }
  return cases;
}

test('isRefId agrees with SPEC.md §4.2 on every case the spec states', () => {
  const cases = identifierCasesDeclaredBySpec();
  // The table must actually have been read. An empty parse would make every
  // assertion below vacuous, which is the failure mode a doc-derived test has.
  assert.ok(cases.length >= 8, `expected the §4.2 table to yield cases, got ${cases.length}`);
  assert.ok(
    cases.some((entry) => entry.accepted) && cases.some((entry) => !entry.accepted),
    'the table must state both accepted and rejected identifiers, or it pins only one direction',
  );
  for (const { id, accepted } of cases) {
    assert.equal(isRefId(id), accepted, `§4.2 says ${JSON.stringify(id)} is ${accepted ? 'accepted' : 'rejected'}`);
  }
});
