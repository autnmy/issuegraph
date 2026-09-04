import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EXIT } from '../exit.ts';
import { HAZARD_BODY } from '../testing/fixtures.ts';
import { resolveRef } from '../refs.ts';
import { asOrderInput, deriveOrder, orderFromJson, InputError } from './order.ts';
import type { OrderInputDocument } from './order.ts';

interface Slot {
  readonly rank: number | null;
  readonly lead: string;
  readonly members: readonly string[];
  readonly ready: boolean;
  readonly holdReasons: readonly string[];
  readonly holds: readonly { readonly code: string; readonly subject?: string; readonly text: string }[];
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
      order: issues.map((i) => ({
        key: String(i['id'] ?? i['number']),
        matchedOrderIndex: 0,
      })),
    },
    issues,
  });
}

/** The same issue keyed by an OPAQUE tracker id rather than a number (SPEC §4.2). */
function opaque(
  id: string,
  body: string,
  overrides: { open?: boolean; labels?: readonly string[] } = {},
): Record<string, unknown> {
  return {
    id,
    open: overrides.open ?? true,
    labels: overrides.labels ?? ['P2'],
    assigneeCount: 0,
    body,
  };
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

  /**
   * THE SECOND INSTANCE OF THE CLASS THE BLOCK ABOVE NAMES, so it is a row here
   * rather than a test of its own. Each of these bounds lived only in
   * `asOrderInput`, so a caller holding an `OrderInputDocument` — which every
   * one of these values type-checks against — reached the derivation without it.
   * `repo: "project"` is the measured case: `nodeKey` builds `project#7`, which
   * no issue body can reference.
   */
  const OUT_OF_DOMAIN: readonly (readonly [field: string, value: unknown])[] = [
    ['repo', 'project'],
    ['repo', 'owner/'],
    ['number', 0],
    ['number', -3],
    ['number', 9007199254740992],
    ['assigneeCount', -1],
  ];

  test('every entry point refuses a field outside its domain, not just the JSON one', () => {
    for (const [field, value] of OUT_OF_DOMAIN) {
      const bad = doc([{ ...issue(1, READABLE), [field]: value }]);
      for (const [name, run] of ENTRY_POINTS) {
        const result = run(bad);
        assert.equal(result.code, EXIT.usage, `${name} accepted ${field}=${JSON.stringify(value)}`);
        assert.equal(result.stdout, '', `${name} produced output for ${field}=${JSON.stringify(value)}`);
      }
    }
  });

  test('homeRepo is held to its domain at every entry point too', () => {
    const parsed: unknown = JSON.parse(
      JSON.stringify({ homeRepo: 'project', baseRanking: { source: 'config', order: [] }, issues: [issue(1, READABLE)] }),
    );
    const bad = parsed as OrderInputDocument;
    for (const [name, run] of ENTRY_POINTS) {
      assert.equal(run(bad).code, EXIT.usage, `${name} accepted homeRepo="project"`);
    }
  });

  test('CONTROL: in-domain values still derive at every entry point', () => {
    // Without this the two tests above pass for a package that refuses
    // everything — and the qualified `repo` is the one that must NOT be caught.
    for (const [field, value] of [['repo', 'owner/repo'], ['repo', null], ['number', 1], ['assigneeCount', 0]] as const) {
      const ok = doc([{ ...issue(1, READABLE), [field]: value }, CLOSED_FIVE as unknown as Record<string, unknown>]);
      for (const [name, run] of ENTRY_POINTS) {
        assert.equal(run(ok).code, EXIT.ok, `${name} refused ${field}=${JSON.stringify(value)}`);
      }
    }
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

  test('a repository the reader cannot reference is refused', () => {
    // MEASURED CONSEQUENCE, not a tidiness rule. `repo` used to accept any
    // string, `nodeKey` then built `project#7`, and no issue body can reference
    // that: a dependent declaring `blocked-by: project#7` came back HELD with
    // `own issuegraph declaration was not fully read`. Fail-safe, and the reason
    // named the wrong thing — so the caller could not see its own input was at
    // fault. Refused at the boundary that owns it instead.
    for (const value of ['project', 'owner/', '/repo', 'owner repo', 'owner/repo#7', '']) {
      const message = refusal('repo', value);
      assert.ok(message.includes('repo'), `${JSON.stringify(value)}: ${message}`);
      assert.ok(message.includes('owner/repo'), `${JSON.stringify(value)}: ${message}`);
    }
  });

  test('CONTROL: a qualified repo, an explicit null, and an absent key all still pass', () => {
    // The refusal has to be the unusable value and nothing else. `null` and an
    // absent key both mean "home repo" and are the common case, so a rule that
    // caught either would break every ordinary document.
    for (const value of ['owner/repo', 'autnmy/issuegraph', 'a/b', 'Owner/Repo.js', null]) {
      const issues = [{ ...issue(1, 'no block'), repo: value }];
      const result = orderFromJson(document(issues), 'order');
      assert.equal(result.code, EXIT.ok, `${JSON.stringify(value)}: ${result.stderr.join('\n')}`);
    }
    assert.equal(orderFromJson(document([issue(1, 'no block')]), 'order').code, EXIT.ok);
  });

  test('the accepted repositories are exactly the ones the reader can reference', () => {
    // Asked, not restated — the same claim the issue-number test above makes,
    // over the other half of a qualified reference. `resolveRef` is the reader's
    // whole-token answer, so agreeing with it is agreeing with the grammar that
    // decides whether the key this input produces can ever be addressed.
    for (const value of ['owner/repo', 'a/b']) {
      assert.notEqual(resolveRef(`${value}#1`), null, `reader refuses ${value}`);
      assert.equal(orderFromJson(document([{ ...issue(1, 'no block'), repo: value }]), 'order').code, EXIT.ok);
    }
    for (const value of ['project', 'owner/', '/repo']) {
      assert.equal(resolveRef(`${value}#1`), null, `reader accepts ${value}`);
      assert.equal(orderFromJson(document([{ ...issue(1, 'no block'), repo: value }]), 'order').code, EXIT.usage);
    }
  });

  test('homeRepo is held to the same domain as an issue repo', () => {
    // It is not a reference, so nothing it accepts can be MIS-resolved — but it
    // is compared against every node's repo after both are lowercased, so an
    // unusable value silently matches nothing and leaves qualified keys where
    // the caller expected bare ones. Same predicate, same authority.
    const withHome = (homeRepo: unknown): string =>
      JSON.stringify({
        homeRepo,
        baseRanking: { source: 'config', order: [{ key: '1', matchedOrderIndex: 0 }] },
        issues: [issue(1, 'no block')],
      });
    assert.equal(orderFromJson(withHome('project'), 'order').code, EXIT.usage);
    assert.ok(orderFromJson(withHome('project'), 'order').stderr.join('\n').includes('homeRepo'));
    assert.equal(orderFromJson(withHome('owner/repo'), 'order').code, EXIT.ok);
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

describe('opaque identifiers (SPEC §4.2)', () => {
  test('orders a corpus whose ids are not numbers, resolving refs between them', () => {
    // The gap #33 named: §4.2 defines a reference as an OPAQUE tracker-scoped
    // token, and this verb refused anything but an integer at the boundary — so
    // a Jira or Linear corpus could not be ordered at all, even though the
    // reader resolves `blocked-by: ABC-124` perfectly well.
    const { out } = run(
      document([opaque('ABC-123', blockedBy('ABC-124'), { labels: ['P1'] }), opaque('ABC-124', 'Prose.')]),
    );

    const held = out.slots.find((slot) => slot.lead === 'ABC-123');
    const ready = out.slots.find((slot) => slot.lead === 'ABC-124');
    assert.ok(held !== undefined && ready !== undefined, 'an opaque-id slot is missing');
    // THE REFERENCE RESOLVED, which is the half a looser id check would miss:
    // accepting the id but failing to key nodes by it would leave this hold
    // reported as an unresolvable ref instead.
    assert.deepEqual(held.holdReasons, ['blocked-by ABC-124 is open']);
    // AND THE CAUSE AS DATA, beside the sentence: a consumer of this JSON groups
    // on `code` and links `subject` without matching the prose above.
    assert.deepEqual(held.holds, [
      { code: 'blocked-by-open', subject: 'ABC-124', text: 'blocked-by ABC-124 is open' },
    ]);
    assert.equal(ready.ready, true);
  });

  test('still accepts the numeric spelling it has always accepted', () => {
    // `number` is the published contract and every existing caller sends it.
    const { out } = run(document([issue(1, blockedBy('2')), issue(2, 'Prose.')]));
    assert.ok(out.slots.some((slot) => slot.lead === '1'));
    assert.ok(out.slots.some((slot) => slot.lead === '2'));
  });

  test('accepts both spellings when they agree', () => {
    // A caller migrating from `number` to `id` sends both for a while; refusing
    // that would make the migration a flag day.
    const both = { ...issue(7, 'Prose.'), id: '7' };
    const { out } = run(document([both]));
    assert.ok(out.slots.some((slot) => slot.lead === '7'));
  });

  /**
   * BOTH BOUNDARIES, SEPARATELY. `asOrderInput` is the JSON schema boundary and
   * `deriveOrder` is the domain one, and they are deliberately redundant — the
   * package already asserts that over duplicate keys. Testing only through
   * `orderFromJson` cannot tell them apart, because it runs the schema check and
   * then hands the result straight to the domain check: deleting either guard
   * still refuses, so a test that goes through the front door alone passes with
   * one of them gone. Verified by removing each and watching this file stay
   * green before it was written this way.
   */
  function refusals(issues: readonly Record<string, unknown>[]): { schema: string; domain: string } {
    const json = document(issues);
    let schema = '';
    try {
      asOrderInput(JSON.parse(json));
    } catch (error) {
      schema = error instanceof InputError ? error.message : `threw ${String(error)}`;
    }
    const typed = deriveOrder(JSON.parse(json) as OrderInputDocument, 'order');
    assert.equal(typed.code, EXIT.usage, 'the domain boundary accepted it');
    return { schema, domain: typed.stderr.join('\n') };
  }

  test('refuses an issue carrying NEITHER spelling, at both boundaries', () => {
    const { number: _dropped, ...idless } = issue(1, 'Prose.');
    const { schema, domain } = refusals([idless]);
    assert.ok(schema.includes('supply `id`'), `schema boundary: ${JSON.stringify(schema)}`);
    assert.ok(domain.includes('supply `id`'), `domain boundary: ${domain}`);
  });

  test('refuses the two spellings when they DISAGREE, at both boundaries', () => {
    // One issue named two ways has no correct reading — the same doctrine
    // `duplicateKeyRefusal` applies to one issue declared twice.
    const { schema, domain } = refusals([{ ...issue(7, 'Prose.'), id: 'ABC-9' }]);
    assert.ok(schema.includes('while'), `schema boundary: ${JSON.stringify(schema)}`);
    assert.ok(domain.includes('while'), `domain boundary: ${domain}`);
  });

  test('refuses a non-STRING id at the direct derivation boundary', () => {
    // `deriveOrder` is exported and a JavaScript caller reaches it with no
    // compiler in the way, so the annotations promise nothing here. Measured
    // before the fix: `id: 123` reached `resolveRef` and threw a `TypeError`
    // instead of the usage result this function promises, and `id: null` with
    // no `number` fell through to the key `"undefined"` and was SILENTLY
    // ACCEPTED — an order keyed by a lie, which is the worse of the two.
    //
    // THE JSON PATH ALREADY TYPED IT through `asOpaqueId`; this is the other,
    // deliberately separate boundary, and it is only reachable from here.
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    // BIGINT AND A CYCLIC OBJECT ARE IN THIS LIST DELIBERATELY. The guard
    // entered its rejection branch for both and then escaped with a `TypeError`
    // while `JSON.stringify` built the message — the very defect the guard was
    // added for, arriving one line later. Naming a rejected value must not
    // become the failure it is reporting.
    for (const bad of [123, null, {}, [], 1n, cyclic] as const) {
      const doc = {
        baseRanking: { source: 'config', order: [] },
        issues: [{ id: bad, open: true, labels: [], assigneeCount: 0, body: 'Prose.' }],
      } as unknown as OrderInputDocument;

      // `String`, not `JSON.stringify` — this list contains a bigint and a
      // cyclic object precisely because stringifying them throws, and a test
      // message that falls into the trap it is testing reports the wrong thing.
      const result = deriveOrder(doc, 'order');
      assert.equal(result.code, EXIT.usage, `${String(bad)} was not refused`);
      assert.equal(result.stdout, '', `${String(bad)} produced output`);
    }
  });

  test('refuses a non-NUMBER number at the same boundary', () => {
    for (const bad of ['7', 1n, {}] as const) {
      const doc = {
        baseRanking: { source: 'config', order: [] },
        issues: [{ number: bad, open: true, labels: [], assigneeCount: 0, body: 'Prose.' }],
      } as unknown as OrderInputDocument;

      assert.equal(deriveOrder(doc, 'order').code, EXIT.usage, `${String(bad)} was not refused`);
    }
  });

  test('refuses an id the READER could not reference', () => {
    // The bound is the reader's, asked rather than restated — so an id no
    // `blocked-by` could name is refused here rather than ranked and then
    // unaddressable.
    const bad = orderFromJson(document([opaque('has space', 'Prose.')]), 'order');
    assert.equal(bad.code, EXIT.usage);
    assert.ok(bad.stderr.join('\n').includes('reference'), bad.stderr.join('\n'));
  });
});
