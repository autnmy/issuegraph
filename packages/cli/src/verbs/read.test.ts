import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EXIT } from '../exit.ts';
import {
  ABSENT_BODY,
  CANONICAL_BODY,
  HAZARD_BODY,
  INERT_BODY,
  QUOTED_BODY,
  UNUSABLE_BODY,
} from '../testing/fixtures.ts';
import { parseBody } from './parse.ts';
import { validateBody } from './validate.ts';

/** Every verb writes JSON to stdout; reading it back is how these tests assert. */
function json(stdout: string): Record<string, unknown> {
  const value: unknown = JSON.parse(stdout);
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

describe('parse', () => {
  test('a read body reports its edges and exits ok', () => {
    const result = parseBody(QUOTED_BODY);
    assert.equal(result.code, EXIT.ok);
    assert.deepEqual(result.stderr, []);
    const out = json(result.stdout);
    assert.equal(out['state'], 'read');
    assert.ok(Object.hasOwn(out, 'data'));
  });

  test('an absent body exits ok and carries NO data key', () => {
    const result = parseBody(ABSENT_BODY);
    assert.equal(result.code, EXIT.ok);
    const out = json(result.stdout);
    assert.equal(out['state'], 'absent');
    assert.equal(Object.hasOwn(out, 'data'), false);
  });

  describe('the hazard', () => {
    const result = parseBody(HAZARD_BODY);

    test('exits unread-declaration, not ok', () => {
      assert.equal(result.code, EXIT.unreadDeclaration);
      assert.notEqual(result.code, EXIT.ok);
    });

    test('names the error on stderr', () => {
      assert.ok(result.stderr[0]?.includes('unread declaration'), result.stderr.join('\n'));
    });

    test('emits no data key on the wire — not null, absent', () => {
      const out = json(result.stdout);
      assert.equal(out['state'], 'unread');
      assert.equal(Object.hasOwn(out, 'data'), false);
    });

    test('the control: the same edges, quoted, are reported and exit ok', () => {
      // Without this the hazard test proves only that the binary can fail.
      const control = parseBody(QUOTED_BODY);
      assert.equal(control.code, EXIT.ok);
      assert.ok(Object.hasOwn(json(control.stdout), 'data'));
    });
  });

  test('an inert body exits ok — refusing it would refuse nearly every hand-authored block', () => {
    const result = parseBody(INERT_BODY);
    assert.equal(result.code, EXIT.ok);
    const out = json(result.stdout);
    assert.equal(out['state'], 'inert');
    assert.equal(out['blockDefect'], 'undelimited');
    assert.ok(result.stderr[0]?.includes('backfill'), 'the warning should name the remedy');
  });

  test('a delimited-but-unusable block is unread too', () => {
    assert.equal(parseBody(UNUSABLE_BODY).code, EXIT.unreadDeclaration);
  });

  test('stdout always parses as JSON, in every state', () => {
    for (const body of [ABSENT_BODY, CANONICAL_BODY, HAZARD_BODY, INERT_BODY, QUOTED_BODY, UNUSABLE_BODY]) {
      assert.doesNotThrow(() => json(parseBody(body).stdout));
    }
  });
});

describe('validate', () => {
  test('agrees with parse on read, absent and unread', () => {
    assert.equal(validateBody(QUOTED_BODY).code, EXIT.ok);
    assert.equal(validateBody(ABSENT_BODY).code, EXIT.ok);
    assert.equal(validateBody(HAZARD_BODY).code, EXIT.unreadDeclaration);
  });

  test('diverges from parse on inert — the one state where the policies differ', () => {
    assert.equal(parseBody(INERT_BODY).code, EXIT.ok);
    assert.equal(validateBody(INERT_BODY).code, EXIT.inertDeclaration);
  });

  test('reports ok as a field, matching the exit code', () => {
    for (const [body, expected] of [
      [QUOTED_BODY, true],
      [ABSENT_BODY, true],
      [INERT_BODY, false],
      [HAZARD_BODY, false],
    ] as const) {
      const result = validateBody(body);
      assert.equal(json(result.stdout)['ok'], expected);
      assert.equal(result.code === EXIT.ok, expected);
    }
  });

  test('never mixes its stderr into stdout', () => {
    for (const body of [INERT_BODY, HAZARD_BODY]) {
      const result = validateBody(body);
      assert.ok(result.stderr.length > 0);
      for (const line of result.stderr) {
        assert.equal(result.stdout.includes(line), false, 'stderr leaked into stdout');
      }
    }
  });
});
