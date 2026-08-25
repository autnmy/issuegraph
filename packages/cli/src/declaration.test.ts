import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseFrontmatter } from '@issuegraph/reader';

import { classifyDeclaration, unreadErrorLines } from './declaration.ts';
import { EXIT, EXIT_MEANING, EXIT_NAMES_BY_CODE } from './exit.ts';
import type { ExitName } from './exit.ts';
import {
  ABSENT_BODY,
  CANONICAL_BODY,
  HAZARD_BODY,
  INERT_BODY,
  QUOTED_BODY,
  UNUSABLE_BODY,
} from './testing/fixtures.ts';

describe('classifyDeclaration', () => {
  test('a delimited block with quoted refs is read, and its edges survive', () => {
    const decl = classifyDeclaration(parseFrontmatter(QUOTED_BODY));
    assert.equal(decl.state, 'read');
    assert.ok(decl.state === 'read');
    assert.deepEqual(
      decl.data.blockedBy.map((ref) => ref.id),
      ['123', '124'],
    );
    assert.deepEqual(decl.diagnostics, []);
  });

  test('the repository’s own fence-wrapped block is read', () => {
    const decl = classifyDeclaration(parseFrontmatter(CANONICAL_BODY));
    assert.equal(decl.state, 'read');
    assert.ok(decl.state === 'read');
    assert.deepEqual(
      decl.data.blockedBy.map((ref) => ref.id),
      ['7'],
    );
    assert.equal(decl.data.evidence, 'verified');
  });

  test('a body with no block is absent, with nothing to report', () => {
    const decl = classifyDeclaration(parseFrontmatter(ABSENT_BODY));
    assert.equal(decl.state, 'absent');
    assert.deepEqual(decl.diagnostics, []);
  });

  test('a key with no --- pair is inert, and reports which defect', () => {
    const decl = classifyDeclaration(parseFrontmatter(INERT_BODY));
    assert.equal(decl.state, 'inert');
    assert.ok(decl.state === 'inert');
    assert.equal(decl.blockDefect, 'undelimited');
    assert.ok(decl.diagnostics.length > 0);
  });

  describe('the hazard: unquoted block-sequence refs', () => {
    test('classifies unread — not read, and not absent', () => {
      const decl = classifyDeclaration(parseFrontmatter(HAZARD_BODY));
      assert.equal(decl.state, 'unread');
      assert.equal(decl.diagnostics.length, 2);
    });

    test('carries NO data property at all, so no caller can reach edges', () => {
      const decl = classifyDeclaration(parseFrontmatter(HAZARD_BODY));
      // `hasOwn`, not `decl.data === undefined`: an accidental `data: undefined`
      // would satisfy the looser test while still letting `decl.data?.blockedBy
      // ?? []` hand back the empty list this whole module refuses to produce.
      assert.equal(Object.hasOwn(decl, 'data'), false);
    });

    test('the reader really does hand back a non-null, empty-looking data here', () => {
      // The premise of the whole module, pinned rather than assumed: if a future
      // reader version stopped producing this shape, the classifier's ordering
      // would no longer be load-bearing and this test says so first.
      const parse = parseFrontmatter(HAZARD_BODY);
      assert.notEqual(parse.data, null);
      assert.deepEqual(parse.data?.blockedBy, []);
      assert.equal(parse.blockDefect, null);
      assert.ok(parse.diagnostics.length > 0);
    });
  });

  test('a delimited but unusable block is unread — the state is not "a field was dropped"', () => {
    const decl = classifyDeclaration(parseFrontmatter(UNUSABLE_BODY));
    assert.equal(decl.state, 'unread');
    assert.equal(Object.hasOwn(decl, 'data'), false);
  });

  test('read is never returned while diagnostics stand and no defect explains them', () => {
    // The recognition-order regression guard. A classifier that asked
    // `data !== null` first would return `read` for the hazard.
    for (const body of [HAZARD_BODY, UNUSABLE_BODY]) {
      const parse = parseFrontmatter(body);
      assert.ok(parse.diagnostics.length > 0 && parse.blockDefect === null);
      assert.notEqual(classifyDeclaration(parse).state, 'read');
    }
  });

  test('every fixture classifies into exactly one of the four states', () => {
    const states = [ABSENT_BODY, CANONICAL_BODY, HAZARD_BODY, INERT_BODY, QUOTED_BODY, UNUSABLE_BODY].map(
      (body) => classifyDeclaration(parseFrontmatter(body)).state,
    );
    for (const state of states) {
      assert.ok(['read', 'absent', 'inert', 'unread'].includes(state), `unexpected state ${state}`);
    }
    // All four are exercised, so no arm is dead.
    assert.deepEqual([...new Set(states)].sort(), ['absent', 'inert', 'read', 'unread']);
  });
});

describe('unreadErrorLines', () => {
  test('leads with the stable name, then the diagnostics', () => {
    const lines = unreadErrorLines(['first thing', 'second thing']);
    assert.ok(lines[0]?.includes('unread declaration'), lines[0]);
    assert.ok(lines[0]?.includes('2 entries'), lines[0]);
    assert.deepEqual(lines.slice(1), ['  first thing', '  second thing']);
  });

  test('singularises one diagnostic', () => {
    assert.ok(unreadErrorLines(['only'])[0]?.includes('1 entry'));
  });
});

describe('the exit-code table', () => {
  test('every code is distinct', () => {
    const codes = Object.values(EXIT);
    assert.equal(new Set(codes).size, codes.length);
  });

  test('every name has a meaning, and every meaning has a name', () => {
    // `EXIT_MEANING` is typed as a total record, so this is a runtime restatement
    // of a compile-time guarantee — kept because the two could drift if the type
    // is ever widened.
    assert.deepEqual(Object.keys(EXIT).sort(), Object.keys(EXIT_MEANING).sort());
  });

  test('the rendering order is by numeric code, and covers every name', () => {
    assert.deepEqual([...EXIT_NAMES_BY_CODE].sort(), (Object.keys(EXIT) as ExitName[]).sort());
    const codes = EXIT_NAMES_BY_CODE.map((name) => EXIT[name]);
    assert.deepEqual(codes, [...codes].sort((a, b) => a - b));
  });

  test('ok is 0 and every other code is non-zero', () => {
    assert.equal(EXIT.ok, 0);
    for (const [name, code] of Object.entries(EXIT)) {
      if (name !== 'ok') assert.notEqual(code, 0, `${name} must be non-zero`);
    }
  });
});
