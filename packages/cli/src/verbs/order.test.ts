import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EXIT } from '../exit.ts';
import { HAZARD_BODY } from '../testing/fixtures.ts';
import { resolveRef } from '../refs.ts';
import { deriveOrder, orderFromJson } from './order.ts';
import type { OrderInputDocument } from './order.ts';

interface Slot {
  readonly rank: number | null;
  readonly lead: string;
  readonly members: readonly string[];
  readonly ready: boolean;
  readonly holdReasons: readonly string[];
}

interface OrderOutput {
  readonly view: string;
  readonly slots: readonly Slot[];
  readonly excluded: readonly { readonly key: string; readonly canonical: string }[];
  readonly underRead: readonly string[];
  readonly diagnostics: readonly string[];
}

/** A body declaring exactly the given `blocked-by` refs, in the readable spelling. */
function blockedBy(...refs: readonly string[]): string {
  return ['---', 'issuegraph:', '  blocked-by:', ...refs.map((r) => `    - "${r}"`), '---', '', 'Prose.'].join('\n');
}

function issue(
  number: number,
  body: string,
  overrides: { open?: boolean; labels?: readonly string[]; assigneeCount?: number } = {},
): Record<string, unknown> {
  return {
    number,
    open: overrides.open ?? true,
    labels: overrides.labels ?? ['P2'],
    assigneeCount: overrides.assigneeCount ?? 0,
    body,
  };
}

function document(issues: readonly Record<string, unknown>[]): string {
  return JSON.stringify({
    baseRanking: {
      source: 'config',
      order: issues.map((i) => ({ key: String(i['number']), matchedOrderIndex: 0 })),
    },
    issues,
  });
}

function run(input: string, view: 'order' | 'ready' = 'order'): { result: ReturnType<typeof orderFromJson>; out: OrderOutput } {
  const result = orderFromJson(input, view);
  assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
  const parsed: unknown = JSON.parse(result.stdout);
  return { result, out: parsed as OrderOutput };
}

describe('order', () => {
  test('an open blocker holds its dependent; the blocker itself is ready', () => {
    const { out } = run(document([issue(1, blockedBy('#2')), issue(2, 'no block')]));
    const one = out.slots.find((s) => s.lead === '1');
    const two = out.slots.find((s) => s.lead === '2');
    assert.equal(one?.ready, false);
    assert.ok(one?.holdReasons.some((r) => r.includes('2')), JSON.stringify(one?.holdReasons));
    assert.equal(two?.ready, true);
  });

  test('closing that blocker — an INPUT, never a fetch — makes the dependent ready', () => {
    // The boundary rule, as an executable claim: the only thing that changed
    // between these two runs is a field on the document.
    const { out } = run(document([issue(1, blockedBy('#2')), issue(2, 'no block', { open: false })]));
    assert.equal(out.slots.find((s) => s.lead === '1')?.ready, true);
  });

  test('a chain ranks in dependency order', () => {
    const { out } = run(
      document([issue(1, blockedBy('#2')), issue(2, blockedBy('#3')), issue(3, 'no block')]),
    );
    assert.equal(out.slots.find((s) => s.lead === '3')?.ready, true);
    assert.equal(out.slots.find((s) => s.lead === '2')?.ready, false);
    assert.equal(out.slots.find((s) => s.lead === '1')?.ready, false);
  });

  test('a duplicate is excluded and takes no slot', () => {
    const dup = ['---', 'issuegraph:', '  duplicate-of: "#1"', '---', '', 'Prose.'].join('\n');
    const { out } = run(document([issue(1, 'no block'), issue(2, dup)]));
    assert.deepEqual(
      out.excluded.map((e) => [e.key, e.canonical]),
      [['2', '1']],
    );
    assert.equal(
      out.slots.some((s) => s.members.includes('2')),
      false,
    );
  });

  test('a together pair occupies ONE slot with two members', () => {
    const together = ['---', 'issuegraph:', '  together-with: "#2"', '---', '', 'Prose.'].join('\n');
    const { out } = run(document([issue(1, together), issue(2, 'no block')]));
    const unit = out.slots.find((s) => s.members.length === 2);
    assert.ok(unit, `expected one slot with two members, got ${JSON.stringify(out.slots)}`);
    assert.deepEqual([...unit.members].sort(), ['1', '2']);
    assert.equal(out.slots.length, 1);
  });

  describe('an under-read body', () => {
    const { result, out } = run(document([issue(1, 'no block'), issue(2, HAZARD_BODY)]));

    test('is reported in underRead', () => {
      assert.deepEqual(out.underRead, ['2']);
    });

    test('is NOT reported ready — its silence about an edge is not evidence', () => {
      // The plan's one open risk, answered by executing it rather than by
      // reading the library's documentation. An under-read node reported ready
      // would launder the exact defect this package exists to surface.
      const held = out.slots.find((s) => s.lead === '2');
      assert.equal(held?.ready, false);
      assert.ok(held !== undefined && held.holdReasons.length > 0);
    });

    test('does not fail the whole set — the fact travels, it does not stop the run', () => {
      assert.equal(result.code, EXIT.ok);
      assert.ok(result.stderr[0]?.includes('under-read'), result.stderr.join('\n'));
    });

    test('the readable sibling is still ready', () => {
      assert.equal(out.slots.find((s) => s.lead === '1')?.ready, true);
    });
  });
});

describe('ready', () => {
  test('is exactly the subset of order’s slots that are ready — compared against the same run', () => {
    const input = document([issue(1, blockedBy('#2')), issue(2, 'no block'), issue(3, 'no block')]);
    const all = run(input, 'order').out;
    const only = run(input, 'ready').out;
    assert.deepEqual(only.slots, all.slots.filter((s) => s.ready));
    assert.ok(only.slots.length > 0 && only.slots.length < all.slots.length);
  });

  test('names its view, so a caller can tell the two apart', () => {
    assert.equal(run(document([issue(1, 'no block')]), 'ready').out.view, 'ready');
    assert.equal(run(document([issue(1, 'no block')]), 'order').out.view, 'order');
  });
});

describe('every entry point to the derivation enforces the same preconditions', () => {
  /**
   * ENUMERATED AS DATA, the same shape the write funnel's test uses.
   *
   * The uniqueness check first lived in `asOrderInput`, so `orderFromJson`
   * enforced it and the exported `deriveOrder` — the same operation, reached
   * directly — did not. That is the identical shape the write paths had before
   * `performWrite`, and it is why this is asserted over the entry points rather
   * than once per entry point: a new one is a row here, and a new one that skips
   * the boundary fails an assertion that already exists.
   */
  const ENTRY_POINTS: readonly (readonly [name: string, run: (doc: OrderInputDocument) => { code: number; stdout: string }])[] = [
    ['deriveOrder', (doc) => deriveOrder(doc, 'order')],
    ['orderFromJson', (doc) => orderFromJson(JSON.stringify(doc), 'order')],
  ];

  const READABLE = blockedBy('#5');
  const CLOSED_FIVE = { number: 5, open: false, labels: ['P2'], assigneeCount: 0, body: 'no block' };

  function doc(issues: readonly Record<string, unknown>[]): OrderInputDocument {
    const parsed: unknown = JSON.parse(JSON.stringify({ baseRanking: { source: 'config', order: [] }, issues }));
    return parsed as OrderInputDocument;
  }

  test('every entry point refuses an issue declared twice', () => {
    const duplicated = doc([
      issue(1, READABLE),
      issue(1, HAZARD_BODY),
      CLOSED_FIVE as unknown as Record<string, unknown>,
    ]);
    for (const [name, run] of ENTRY_POINTS) {
      const result = run(duplicated);
      assert.equal(result.code, EXIT.usage, `${name} accepted a duplicate key`);
      assert.equal(result.stdout, '', `${name} produced output for a refused document`);
    }
  });

  test('CONTROL: every entry point still derives a unique-key document identically', () => {
    // Without this the test above would pass for a package that had stopped
    // deriving anything, and it also pins that the two paths agree.
    const clean = doc([issue(1, READABLE), CLOSED_FIVE as unknown as Record<string, unknown>]);
    const outputs = ENTRY_POINTS.map(([, run]) => run(clean));
    for (const [index, result] of outputs.entries()) {
      assert.equal(result.code, EXIT.ok, `${ENTRY_POINTS[index]?.[0]} refused a valid document`);
    }
    const [first, second] = outputs;
    assert.ok(first !== undefined && second !== undefined);
    assert.equal(first.stdout, second.stdout, 'the two entry points disagreed about the same document');
  });

  test('the reported divergence is gone: no key is reported under-read AND ready', () => {
    // The exact shape review measured — readable body first, unreadable second.
    const clean = doc([issue(1, READABLE), CLOSED_FIVE as unknown as Record<string, unknown>]);
    for (const [name, run] of ENTRY_POINTS) {
      const parsed: unknown = JSON.parse(run(clean).stdout);
      const out = parsed as OrderOutput;
      for (const slot of out.slots) {
        if (!slot.ready) continue;
        for (const member of slot.members) {
          assert.equal(out.underRead.includes(member), false, `${name}: ${member} is both ready and under-read`);
        }
      }
    }
  });
});

describe('input fields are bounded by their domain, not just their type', () => {
  function refusal(field: string, value: unknown): string {
    const issues = [{ ...issue(1, 'no block'), [field]: value }];
    const result = orderFromJson(document(issues), 'order');
    assert.equal(result.code, EXIT.usage, `${field}=${JSON.stringify(value)} was accepted`);
    return result.stderr.join('\n');
  }

  test('a negative assigneeCount is refused — it would read as UNCLAIMED', () => {
    // The derivation tests `assigneeCount > 0` to decide a serialize component is
    // actively claimed, so a negative count made a peer being worked look free.
    const message = refusal('assigneeCount', -1);
    assert.ok(message.includes('assigneeCount'), message);
    assert.ok(message.includes('>= 0'), message);
  });

  test('a non-positive issue number is refused', () => {
    // The bound is the READER's now, not a hand-written `>= 1` here, so the
    // message names referenceability rather than a number this package chose.
    for (const value of [0, -3]) assert.ok(refusal('number', value).includes('reference'));
  });

  test('an issue number outside the safe range is refused — JSON already rounded it', () => {
    // 2^53 and above lose precision before this code sees them, and the reader
    // and writer both refuse a ref there, so a node accepted at that value could
    // be ranked and never addressed.
    for (const value of [9007199254740992, 9007199254740993]) {
      assert.ok(refusal('number', value).includes('safe range'), String(value));
    }
  });

  test('an unsafe integer is refused in EVERY numeric field, not just the number', () => {
    assert.ok(refusal('assigneeCount', 9007199254740992).includes('safe range'));
  });

  test('the accepted issue numbers are exactly the ones the reader can reference', () => {
    // Asked, not restated: the bound cannot drift from the reader's because it
    // IS the reader's answer.
    for (const value of [1, 42, 9007199254740991]) {
      const ref = resolveRef(String(value));
      assert.notEqual(ref, null, `reader refuses ${value}`);
      assert.equal(orderFromJson(document([{ ...issue(1, 'no block'), number: value }]), 'order').code, EXIT.ok);
    }
    for (const value of [0, -3, 9007199254740992]) {
      assert.equal(resolveRef(String(value)), null, `reader accepts ${value}`);
      assert.equal(orderFromJson(document([{ ...issue(1, 'no block'), number: value }]), 'order').code, EXIT.usage);
    }
  });

  test('a negative matchedOrderIndex is refused', () => {
    const input = JSON.stringify({
      baseRanking: { source: 'config', order: [{ key: '1', matchedOrderIndex: -1 }] },
      issues: [],
    });
    assert.equal(orderFromJson(input, 'order').code, EXIT.usage);
  });

  test('CONTROL: the boundary values on each side are accepted', () => {
    for (const [field, value] of [
      ['assigneeCount', 0],
      ['assigneeCount', 5],
      ['number', 1],
    ] as const) {
      const issues = [{ ...issue(1, 'no block'), [field]: value }];
      assert.equal(orderFromJson(document(issues), 'order').code, EXIT.ok, `${field}=${value} was refused`);
    }
  });
});

describe('input validation — a bad document is a USAGE error, never unread', () => {
  function usage(input: string): string {
    const result = orderFromJson(input, 'order');
    assert.equal(result.code, EXIT.usage, `expected usage, got ${result.code}: ${result.stdout}`);
    assert.equal(result.stdout, '');
    return result.stderr.join('\n');
  }

  test('malformed JSON names the input as the problem', () => {
    assert.ok(usage('{ not json').includes('not valid JSON'));
  });

  test('a missing required field names the field and the issue', () => {
    for (const field of ['open', 'labels', 'assigneeCount', 'body', 'number']) {
      const issues = [issue(1, 'no block')];
      const first = issues[0];
      assert.ok(first !== undefined);
      delete first[field];
      const message = usage(document(issues));
      assert.ok(message.includes(field), `${field}: ${message}`);
      assert.ok(message.includes('issues[0]'), message);
    }
  });

  test('a wrongly-typed field is refused rather than coerced', () => {
    assert.ok(usage(JSON.stringify({ baseRanking: { source: 'config', order: [] }, issues: [{ ...issue(1, 'x'), open: 'yes' }] })).includes('open'));
    assert.ok(usage(JSON.stringify({ baseRanking: { source: 'config', order: [] }, issues: [{ ...issue(1, 'x'), labels: 'P1' }] })).includes('labels'));
  });

  test('an unknown baseRanking source is refused', () => {
    assert.ok(usage(JSON.stringify({ baseRanking: { source: 'vibes' }, issues: [] })).includes('source'));
  });

  test('an issue declared twice is refused, naming both positions', () => {
    // Not silently deduplicated: `buildModel` keeps the first occurrence, and
    // this package walking every entry to build `underRead` reported a key as
    // under-read whose readable body the derivation had actually used. Refusing
    // removes the divergence instead of restating a rule derive owns.
    const readable = blockedBy('#5');
    const message = usage(document([issue(1, readable), issue(1, HAZARD_BODY)]));
    assert.ok(message.includes('issues[1]'), message);
    assert.ok(message.includes('issues[0]'), message);
    assert.ok(message.includes('once'), message);
  });

  test('the same number in a DIFFERENT repo is not a duplicate', () => {
    // The key, not the number, is what must be unique — otherwise a cross-repo
    // set would be refused for no reason.
    const doc = JSON.parse(document([issue(1, 'no block'), issue(1, 'no block')])) as {
      issues: Record<string, unknown>[];
    };
    const second = doc.issues[1];
    assert.ok(second !== undefined);
    second['repo'] = 'other/repo';
    const result = orderFromJson(JSON.stringify(doc), 'order');
    assert.equal(result.code, EXIT.ok, result.stderr.join('\n'));
  });

  test('CONTROL: unique keys still derive, and report no spurious under-read', () => {
    const { out } = run(document([issue(1, blockedBy('#5')), issue(5, 'no block', { open: false })]));
    assert.deepEqual(out.underRead, []);
    assert.equal(out.slots.find((s) => s.lead === '1')?.ready, true);
  });

  test('a top-level non-object is refused', () => {
    assert.ok(usage('[]').includes('input'));
  });

  test('a caller-supplied `data` object cannot bypass the reader', () => {
    // The document carries bodies. Handing in pre-parsed data is exactly the
    // hand-rolled-grammar path this package exists to close, so an extra key is
    // simply not read — the body is still the only edge source.
    const issues = [{ ...issue(1, 'no block'), data: { blockedBy: [{ repo: null, id: '999' }] } }];
    const { out } = run(document(issues));
    assert.equal(out.slots.find((s) => s.lead === '1')?.ready, true, 'a fabricated blocker must not gate anything');
  });
});
