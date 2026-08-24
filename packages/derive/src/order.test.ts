import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { NodeInput } from '@issuegraph/reader';

import {
  type ConfigRankedIssue,
  type DeriveIssueOrderInput,
  type DerivedIssueOrder,
  type IssueOrderSlot,
  deriveIssueOrder,
} from './order.ts';
// Not on the barrel: the per-issue signals reach consumers through the derived
// model's priority view, so the resolver itself stays package-internal.
import { resolvePrioritySignals } from './precedence.ts';
import {
  PROMOTED_GOLDEN_RANKS,
  SEED_GOLDEN_RANKS,
  frontmatter,
  issuegraphOrderSeed,
  issuegraphOrderSeedCreatedAt,
  ref,
  withBlockedByEdge,
} from './testing/fixtures.ts';

// The derivation is pinned against the reference prototype's own seed: every
// relationship the specification defines appears in it, and the two golden rank
// vectors are the reference's exact outcomes before and after its demonstration
// edit.

function deriveSeed(
  issues: readonly NodeInput[] = issuegraphOrderSeed(),
  overrides: Partial<DeriveIssueOrderInput['config']> = {},
): DerivedIssueOrder {
  return deriveIssueOrder({
    issues,
    config: {
      baseRanking: { source: 'fixture-parity', createdAt: issuegraphOrderSeedCreatedAt() },
      ...overrides,
    },
  });
}

/** The ranks as a plain map, for whole-vector comparison against a golden. */
function rankVector(derived: DerivedIssueOrder): Map<string, number | null> {
  return new Map(derived.rankOf);
}

/**
 * The slot a predicate names, asserted PRESENT rather than optional-chained.
 * `find(...)?.rank` reads as a passing assertion when the slot is missing
 * entirely, which is the one failure a rank test most needs to catch.
 */
function slotWhere(
  derived: DerivedIssueOrder,
  predicate: (slot: IssueOrderSlot) => boolean,
  what: string,
): IssueOrderSlot {
  const slot = derived.slots.find(predicate);
  assert.ok(slot !== undefined, `expected a slot ${what}`);
  return slot;
}

const slotLed = (derived: DerivedIssueOrder, lead: string): IssueOrderSlot =>
  slotWhere(derived, (slot) => slot.lead === lead, `led by ${lead}`);

const slotWith = (derived: DerivedIssueOrder, member: string): IssueOrderSlot =>
  slotWhere(derived, (slot) => slot.members.includes(member), `containing ${member}`);

/** Same reason as the reader's own helper: survives `noUncheckedIndexedAccess`. */
function assertIncludes(haystack: string | undefined, needle: string): void {
  assert.ok(
    haystack !== undefined && haystack.includes(needle),
    `expected ${JSON.stringify(haystack)} to contain ${JSON.stringify(needle)}`,
  );
}

function priorityView(derived: DerivedIssueOrder, key: string) {
  const view = derived.priority.get(key);
  assert.ok(view !== undefined, `expected a priority view for ${key}`);
  return view;
}

describe("deriveIssueOrder — the seed's baseline order", () => {
  test("reproduces the reference implementation's exact rank vector", () => {
    assert.deepStrictEqual(rankVector(deriveSeed()), new Map(SEED_GOLDEN_RANKS));
  });

  test('collapses the together unit {512, 514} into ONE rank slot', () => {
    const derived = deriveSeed();
    const unit = slotWith(derived, '512');
    assert.deepStrictEqual(unit.members, ['512', '514']);
    assert.equal(unit.rank, 1);
    assert.equal(unit.togetherGroupSize, 2);
    // One slot, not two adjacent ones that merely look related.
    assert.equal(derived.slots.filter((slot) => slot.members.includes('514')).length, 1);
  });

  test('holds #530 behind open #602 with rank null and a reason naming the blocker', () => {
    const derived = deriveSeed();
    const held = slotLed(derived, '530');
    assert.equal(held.rank, null);
    assert.equal(held.ready, false);
    assertIncludes(held.holdReasons.join(' '), '602');
    // A held slot carries `null`, never a number — not 0, not a string.
    assert.equal(derived.rankOf.get('530'), null);
  });

  test('excludes #455 as a duplicate and keeps #512 canonical', () => {
    const derived = deriveSeed();
    assert.deepStrictEqual(derived.excluded, [
      { key: '455', canonical: '512', reason: 'duplicate-of' },
    ]);
    assert.equal(derived.rankOf.has('455'), false);
    assert.equal(
      derived.slots.some((slot) => slot.members.includes('455')),
      false,
    );
    // The canonical is still ranked.
    assert.equal(derived.rankOf.get('512'), 1);
  });

  test('treats closed #470 as provenance only — never an ordering edge', () => {
    const derived = deriveSeed();
    assert.deepStrictEqual(derived.provenance, [{ key: '488', origin: '470', originOpen: false }]);
    assert.equal(derived.rankOf.has('470'), false);
    assert.equal(
      derived.slots.some((slot) => slot.members.includes('470')),
      false,
    );
    // #488's position is set by its own priority, not by its split origin:
    // last in the baseline, exactly where a P3 with no dependents belongs.
    assert.equal(derived.rankOf.get('488'), 7);
  });

  test("promotes the open blocker #602 to its dependent's priority", () => {
    const view = priorityView(deriveSeed(), '602');
    // No label and no frontmatter priority: the spec default of 2, lifted to 1
    // by the P1 issue it blocks.
    assert.equal(view.declared, 2);
    assert.equal(view.effective, 1);
    assert.equal(view.promoted, true);
    assert.deepStrictEqual(view.promotedBy, ['530']);
    assert.equal(view.notation, 'P2 -> 1');
  });

  test('exposes the COMPUTED serialize group size while ranking members separately', () => {
    const derived = deriveSeed();
    const first = slotLed(derived, '501');
    const second = slotLed(derived, '503');
    // Nobody writes the group down — the size is derived by following links.
    assert.equal(first.serializeGroupSize, 2);
    assert.equal(second.serializeGroupSize, 2);
    // Serialize forbids concurrency, not ordering: both members are ranked.
    assert.equal(first.rank, 2);
    assert.equal(second.rank, 3);
    assert.equal(first.togetherGroupSize, 1);
  });

  test('reports an unpromoted issue in plain notation with no promoter', () => {
    const view = priorityView(deriveSeed(), '520');
    assert.equal(view.declared, 2);
    assert.equal(view.effective, 2);
    assert.equal(view.promoted, false);
    assert.equal(view.notation, 'P2');
    assert.deepStrictEqual(view.promotedBy, []);
  });
});

describe('deriveIssueOrder — adding #512 blocked-by #488', () => {
  const promoted = (): DerivedIssueOrder =>
    deriveSeed(withBlockedByEdge(issuegraphOrderSeed(), 512, 488));

  test("reproduces the reference implementation's promoted rank vector", () => {
    assert.deepStrictEqual(rankVector(promoted()), new Map(PROMOTED_GOLDEN_RANKS));
  });

  test('promotes #488 from declared P3 to effective 0 and to rank 1', () => {
    const derived = promoted();
    const view = priorityView(derived, '488');
    assert.equal(view.declared, 3);
    assert.equal(view.effective, 0);
    assert.equal(view.notation, 'P3 -> 0');
    assert.deepStrictEqual(view.promotedBy, ['512']);
    assert.equal(derived.rankOf.get('488'), 1);
  });

  test('moves the whole {512, 514} unit to held even though #514 alone is ready', () => {
    const derived = promoted();
    const unit = slotWith(derived, '512');
    assert.deepStrictEqual(unit.members, ['512', '514']);
    assert.equal(unit.rank, null);
    assert.equal(derived.rankOf.get('514'), null);
    assertIncludes(unit.holdReasons.join(' '), '488');
  });

  test('promotes transitively — a blocker of the blocker inherits the same urgency', () => {
    const chained = withBlockedByEdge(withBlockedByEdge(issuegraphOrderSeed(), 512, 488), 488, 487);
    const derived = deriveSeed(chained);
    // #487 is two hops from the P0: 487 <- 488 <- 512.
    const view = priorityView(derived, '487');
    assert.equal(view.declared, 2);
    assert.equal(view.effective, 0);
    assert.equal(view.notation, 'P2 -> 0');
    // The promoter named is the adjacent dependent, not the distant origin.
    assert.deepStrictEqual(view.promotedBy, ['488']);
    assert.equal(derived.rankOf.get('487'), 1);
  });
});

describe('deriveIssueOrder — the base ranking is an input', () => {
  /** The seed's keys in creation order, as a host-supplied base ranking. */
  function configOrder(keys: readonly string[]): ConfigRankedIssue[] {
    return keys.map((key, index) => ({ key, matchedOrderIndex: index }));
  }

  const seedOrder = ['488', '512', '514', '501', '503', '530', '602', '520', '487'];

  test('agrees with fixture-parity when the base ranking carries the same order', () => {
    const derived = deriveIssueOrder({
      issues: issuegraphOrderSeed(),
      config: { baseRanking: { source: 'config', order: configOrder(seedOrder) } },
    });
    assert.deepStrictEqual(rankVector(derived), new Map(SEED_GOLDEN_RANKS));
  });

  test('actually consumes the base ranking — reordering a band reorders the result', () => {
    // #501 and #503 are both P1 with no relationships between them, so only
    // the base ranking separates them. Swapping them must swap their ranks.
    const swapped = ['488', '512', '514', '503', '501', '530', '602', '520', '487'];
    const derived = deriveIssueOrder({
      issues: issuegraphOrderSeed(),
      config: { baseRanking: { source: 'config', order: configOrder(swapped) } },
    });
    assert.equal(derived.rankOf.get('503'), 2);
    assert.equal(derived.rankOf.get('501'), 3);
  });

  test("lets the relationship layer OVERRIDE the base ranking's position", () => {
    // The base ranking puts #488 last; the blocking edge must still lift it to
    // rank 1. Frontmatter modifies the base order, it does not defer.
    const lastPlace = [...seedOrder.filter((key) => key !== '488'), '488'];
    const derived = deriveIssueOrder({
      issues: withBlockedByEdge(issuegraphOrderSeed(), 512, 488),
      config: { baseRanking: { source: 'config', order: configOrder(lastPlace) } },
    });
    assert.equal(derived.rankOf.get('488'), 1);
  });

  test('sorts an issue the base ranking omits last within its band, with a diagnostic', () => {
    const without487 = seedOrder.filter((key) => key !== '487');
    const derived = deriveIssueOrder({
      issues: issuegraphOrderSeed(),
      config: { baseRanking: { source: 'config', order: configOrder(without487) } },
    });
    // #520 and #487 are both effective 2; #487 is unranked by the base ranking
    // so it sorts behind #520 rather than by its issue number.
    assert.equal(derived.rankOf.get('520'), 5);
    assert.equal(derived.rankOf.get('487'), 6);
    assertIncludes(derived.diagnostics.join(' '), '487');
  });

  test('takes rank from ARRAY ORDER, not from matchedOrderIndex', () => {
    // `matchedOrderIndex` is the query BAND a row matched — many rows share
    // one — so it is provenance, not a position. Here the two deliberately
    // disagree: the array says #503 first, the field says #501 first.
    const derived = deriveIssueOrder({
      issues: issuegraphOrderSeed(),
      config: {
        baseRanking: {
          source: 'config',
          order: [
            { key: '512', matchedOrderIndex: 0 },
            { key: '514', matchedOrderIndex: 0 },
            { key: '503', matchedOrderIndex: 9 },
            { key: '501', matchedOrderIndex: 1 },
            { key: '530', matchedOrderIndex: 1 },
            { key: '602', matchedOrderIndex: 1 },
            { key: '520', matchedOrderIndex: 2 },
            { key: '487', matchedOrderIndex: 2 },
            { key: '488', matchedOrderIndex: 3 },
          ],
        },
      },
    });
    assert.equal(derived.rankOf.get('503'), 2);
    assert.equal(derived.rankOf.get('501'), 3);
  });

  test('degrades a non-finite ordinal to the unranked path instead of a NaN comparator', () => {
    // `Date.parse` of a missing timestamp is the obvious way to get a NaN in
    // here. One NaN would make the comparator intransitive and the resulting
    // order implementation-defined, so it must be rejected at the boundary.
    const createdAt = new Map(issuegraphOrderSeedCreatedAt());
    createdAt.set('520', Number.NaN);
    createdAt.set('487', Number.NEGATIVE_INFINITY);
    const derived = deriveSeed(issuegraphOrderSeed(), {
      baseRanking: { source: 'fixture-parity', createdAt },
    });
    // Both fall to the back of their shared band, then order by issue number.
    assert.equal(derived.rankOf.get('487'), 5);
    assert.equal(derived.rankOf.get('520'), 6);
    assertIncludes(derived.diagnostics.join(' '), '520: no usable position');
  });

  test('orders two issues the base ranking omits by number, not arbitrarily', () => {
    // Both #520 and #487 are effective 2 and both unranked, so the
    // comparator's base-position term is equal on either side. It must fall
    // through to the issue-number tie-break rather than subtracting two equal
    // sentinels — the ordering has to be total, and a NaN comparator result
    // would leave it unspecified.
    const withoutBoth = ['488', '512', '514', '501', '503', '530', '602'];
    const derived = deriveIssueOrder({
      issues: issuegraphOrderSeed(),
      config: { baseRanking: { source: 'config', order: configOrder(withoutBoth) } },
    });
    assert.equal(derived.rankOf.get('487'), 5);
    assert.equal(derived.rankOf.get('520'), 6);
  });
});

describe('deriveIssueOrder — priority carrier precedence', () => {
  /** #520 with a frontmatter priority that contradicts its P2 label. */
  function disagreeingSeed(): NodeInput[] {
    return issuegraphOrderSeed().map((issue) =>
      issue.number === 520 ? { ...issue, data: frontmatter({ priority: 0 }) } : issue,
    );
  }

  test('defaults to the mapped label winning, keeping the frontmatter value readable', () => {
    const derived = deriveSeed(disagreeingSeed());
    const signals = priorityView(derived, '520').signals;
    assert.equal(signals.resolved, 2);
    assert.equal(signals.winner, 'label');
    assert.equal(signals.disagreement, true);
    assert.equal(signals.losingCarrier, 'frontmatter');
    assert.equal(signals.losingValue, 0);
    assert.equal(derived.rankOf.get('520'), 5);
  });

  test('lets the frontmatter win under the parameter, keeping the label readable', () => {
    const derived = deriveSeed(disagreeingSeed(), { priorityPrecedence: 'frontmatter' });
    const view = priorityView(derived, '520');
    assert.equal(view.signals.resolved, 0);
    assert.equal(view.signals.winner, 'frontmatter');
    assert.equal(view.signals.losingCarrier, 'label');
    assert.equal(view.signals.losingValue, 2);
    // The precedence flip really moves it: effective 0 lifts #520 from rank 5
    // to rank 2, directly behind the P0 unit it now shares a band with.
    assert.equal(view.effective, 0);
    assert.equal(derived.rankOf.get('520'), 2);
  });

  test('never lets an ABSENT frontmatter priority override a mapped label', () => {
    for (const precedence of ['label', 'frontmatter'] as const) {
      const derived = deriveSeed(issuegraphOrderSeed(), { priorityPrecedence: precedence });
      // #530 carries a P1 label and frontmatter that says nothing about
      // priority. The §4.3.5 default of 2 applies to the FIELD, not the issue.
      const view = priorityView(derived, '530');
      assert.equal(view.declared, 1);
      assert.equal(view.signals.winner, 'label');
    }
  });

  test('reports the carrier disagreement identically under both precedences', () => {
    // The anomaly must not depend on which carrier we let win. Under
    // `frontmatter` the normalization removes the labels the model would
    // compare, so the model's own diagnostic cannot fire — the derivation has
    // to emit it from the raw carriers instead.
    const underLabel = deriveSeed(disagreeingSeed()).diagnostics;
    const underFrontmatter = deriveSeed(disagreeingSeed(), {
      priorityPrecedence: 'frontmatter',
    }).diagnostics;
    assert.ok(underLabel.includes('520: priority label p2 disagrees with frontmatter 0'));
    assert.deepStrictEqual([...underFrontmatter].sort(), [...underLabel].sort());
  });

  test('reports a disagreement on an issue that never reaches the order', () => {
    // #455 is excluded as a duplicate and #470 is closed, so neither gets a
    // priority view — the diagnostic is the only place their disagreement can
    // surface.
    const excluded = issuegraphOrderSeed().map((issue) =>
      issue.number === 455
        ? { ...issue, labels: ['P1'], data: frontmatter({ duplicateOf: ref(512), priority: 3 }) }
        : issue,
    );
    const derived = deriveSeed(excluded);
    assert.equal(derived.priority.has('455'), false);
    assert.ok(derived.diagnostics.includes('455: priority label p1 disagrees with frontmatter 3'));
  });

  test('falls back to the spec default when neither carrier speaks', () => {
    const signals = priorityView(deriveSeed(), '487').signals;
    assert.equal(signals.resolved, 2);
    assert.equal(signals.winner, 'default');
    assert.equal(signals.disagreement, false);
    assert.equal(signals.losingValue, null);
  });

  test('takes the lowest value when several priority labels are set', () => {
    const signals = resolvePrioritySignals({
      number: 1,
      open: true,
      labels: ['P3', 'P0'],
      assigneeCount: 0,
      data: null,
    });
    assert.equal(signals.labelValue, 0);
    assert.equal(signals.resolved, 0);
  });
});

describe('deriveIssueOrder — readiness', () => {
  test('refuses a candidate whose serialize partner is actively being worked', () => {
    const claimed = issuegraphOrderSeed().map((issue) =>
      issue.number === 503 ? { ...issue, assigneeCount: 1 } : issue,
    );
    const slot = slotLed(deriveSeed(claimed), '501');
    assert.equal(slot.rank, null);
    assertIncludes(slot.holdReasons.join(' '), '503');
  });

  test('readies a slot once its blocker closes', () => {
    const unblocked = issuegraphOrderSeed().map((issue) =>
      issue.number === 602 ? { ...issue, open: false } : issue,
    );
    const derived = deriveSeed(unblocked);
    // The exact rank, not merely "not held": with #602 gone from the order the
    // P1 band is #501, #503, #530, so the freed slot lands at 4.
    assert.equal(derived.rankOf.get('530'), 4);
    assert.equal(slotLed(derived, '530').ready, true);
  });

  test('counts serialize group size over live members only, like together', () => {
    const shipped = issuegraphOrderSeed().map((issue) =>
      issue.number === 503 ? { ...issue, open: false } : issue,
    );
    // #503 has shipped, so it is no longer part of the live serialize group —
    // the same denominator `togetherGroupSize` uses.
    assert.equal(slotLed(deriveSeed(shipped), '501').serializeGroupSize, 1);
  });
});

describe('deriveIssueOrder — structural invariants', () => {
  test('keeps held slots in place rather than moving them to the end', () => {
    // The whole point of a held slot is that it answers "why isn't my P1
    // running" AT the rank the work would have taken. This pins the array
    // order itself, which no assertion reading `rankOf` can.
    const derived = deriveSeed();
    assert.deepStrictEqual(
      derived.slots.map((slot) => slot.lead),
      ['512', '501', '503', '530', '602', '520', '487', '488'],
    );
    assert.deepStrictEqual(
      derived.slots.map((slot) => slot.rank),
      [1, 2, 3, null, 4, 5, 6, 7],
    );
  });

  test('derives the same order however the input is enumerated', () => {
    // The contract stated as a PROPERTY, not an example: two clients reading
    // the same graph agree without coordinating. Issue number is not unique
    // across repos, so a tie there used to fall through to the stable sort,
    // which preserves fetch order — and the two clients disagreed.
    const collide = (repo: string | null, number: number): NodeInput => ({
      number,
      ...(repo === null ? {} : { repo }),
      open: true,
      labels: ['P2'],
      assigneeCount: 0,
      data: null,
    });
    // Three issues sharing one number across three repos, all effective 2, none
    // in the base ranking: every earlier comparison ties.
    const issues = [collide(null, 42), collide('acme/one', 42), collide('acme/two', 42)];
    const config = { baseRanking: { source: 'config', order: [] } } as const;

    const forward = deriveIssueOrder({ issues, config });
    const reversed = deriveIssueOrder({ issues: [...issues].reverse(), config });
    const rotated = deriveIssueOrder({ issues: [...issues].slice(2).concat(issues.slice(0, 2)), config });

    const order = (derived: DerivedIssueOrder): string[] => derived.slots.map((slot) => slot.lead);
    assert.deepStrictEqual(order(reversed), order(forward));
    assert.deepStrictEqual(order(rotated), order(forward));
    // And it is the canonical key order, not an accident of the first input.
    assert.deepStrictEqual(order(forward), ['42', 'acme/one#42', 'acme/two#42']);
  });

  test('assigns every candidate to exactly one slot', () => {
    const derived = deriveSeed();
    const assigned = derived.slots.flatMap((slot) => slot.members);
    assert.equal(new Set(assigned).size, assigned.length);
    assert.deepStrictEqual([...assigned].sort(), [...derived.rankOf.keys()].sort());
  });

  test('resolves a duplicate together member through to its canonical', () => {
    // A groomer marks a together partner as a duplicate but has not closed it
    // yet. §4.3.3 says a duplicate is ignored in favour of its canonical, so
    // #514 contributes no edges of its own and #512's `together-with: 514`
    // RESOLVES THROUGH to #514's canonical — #520. The unit is therefore
    // #512 + #520, and it is not held by #514 at all.
    //
    // Resolved rather than dropped, deliberately: dropping is unsafe in the one
    // direction that matters (a `blocked-by` naming a duplicate would stop
    // blocking while the work is still open under another number), so the model
    // resolves every such edge and over-serializes at worst.
    const withDuplicateMember = issuegraphOrderSeed().map((issue) =>
      issue.number === 514
        ? { ...issue, data: frontmatter({ togetherWith: ref(512), duplicateOf: ref(520) }) }
        : issue,
    );
    const derived = deriveSeed(withDuplicateMember);
    const unit = slotWith(derived, '512');
    assert.deepStrictEqual(unit.members, ['512', '520']);
    assert.equal(unit.togetherGroupSize, 2);
    assert.ok(
      derived.excluded.some(
        (entry) =>
          entry.key === '514' && entry.canonical === '520' && entry.reason === 'duplicate-of',
      ),
    );
    // The duplicate holds nothing any more — no hold names #514.
    assert.ok(!unit.holdReasons.join(' ').includes('514'));
  });

  test('keeps the first occurrence when the input repeats an issue', () => {
    const seed = issuegraphOrderSeed();
    const original = seed.find((issue) => issue.number === 488);
    assert.ok(original !== undefined, 'expected #488 in the seed');
    const stale: NodeInput = {
      ...original,
      labels: ['P0'],
      data: frontmatter({ decomposedFrom: ref(520) }),
    };
    const derived = deriveSeed([...seed, stale]);
    // The seed's own #488 governs: still P3, still last, still split from #470.
    assert.equal(priorityView(derived, '488').declared, 3);
    assert.equal(derived.rankOf.get('488'), 7);
    assert.deepStrictEqual(
      derived.provenance.filter((entry) => entry.key === '488'),
      [{ key: '488', origin: '470', originOpen: false }],
    );
  });
});

describe('deriveIssueOrder — decomposed-from orders nothing', () => {
  test('neither holds nor promotes across an OPEN split origin', () => {
    // The seed's own origin is closed, and a closed node neither blocks nor
    // propagates urgency — so that case cannot tell a provenance edge from an
    // ordering one. An OPEN origin can: if `decomposed-from` were ever folded
    // into the blocked-by graph, #488 would go held and #520 would inherit.
    const openOrigin = issuegraphOrderSeed().map((issue) =>
      issue.number === 488
        ? { ...issue, data: frontmatter({ decomposedFrom: ref(520), evidence: 'verified' }) }
        : issue,
    );
    const derived = deriveSeed(openOrigin);
    assert.equal(slotLed(derived, '488').ready, true);
    assert.equal(priorityView(derived, '488').effective, 3);
    assert.equal(priorityView(derived, '520').effective, 2);
    assert.ok(
      derived.provenance.some(
        (entry) => entry.key === '488' && entry.origin === '520' && entry.originOpen === true,
      ),
    );
  });
});

describe('deriveIssueOrder — cross-repo keys', () => {
  test('keys a home-repo-qualified node the same as a bare one, end to end', () => {
    const homeRepo = 'acme/widgets';
    const issues: NodeInput[] = [
      {
        number: 488,
        repo: homeRepo,
        open: true,
        labels: ['P3'],
        assigneeCount: 0,
        data: frontmatter({ decomposedFrom: { repo: 'acme/widgets', number: 470 } }),
      },
      {
        number: 512,
        open: true,
        labels: ['P0'],
        assigneeCount: 0,
        data: frontmatter({ blockedBy: [{ repo: 'acme/widgets', number: 488 }] }),
      },
    ];
    const derived = deriveIssueOrder({
      issues,
      config: {
        baseRanking: {
          source: 'fixture-parity',
          createdAt: new Map([
            ['488', 1],
            ['512', 2],
          ]),
        },
        homeRepo,
      },
    });
    // The qualified node keys bare, the qualified blocked-by ref resolves onto
    // it, and the promotion travels across the two spellings.
    assert.equal(derived.rankOf.get('488'), 1);
    assert.equal(priorityView(derived, '488').effective, 0);
    assert.deepStrictEqual(priorityView(derived, '488').promotedBy, ['512']);
    assert.equal(derived.rankOf.get('512'), null);
    // Provenance resolves through the same normalization.
    assert.deepStrictEqual(derived.provenance, [
      { key: '488', origin: '470', originOpen: null },
    ]);
  });
});

describe('deriveIssueOrder — promotion provenance matches the edges the model used', () => {
  // `promotedBy` EXPLAINS a promotion the model computed, so it has to read the
  // same edges the model read: an edge naming a duplicate is attributed to its
  // canonical (`packages/reader/src/model.ts:477`), and a duplicate's own edges
  // are ignored entirely (`:443`). This is the one place the derivation must
  // MATCH the model rather than over-refuse — a reason that did not cause a
  // promotion cannot be the reason given for it.

  const plain = (number: number, labels: readonly string[] = []): NodeInput => ({
    number,
    open: true,
    labels,
    assigneeCount: 0,
    data: null,
  });
  const derive = (issues: readonly NodeInput[]): DerivedIssueOrder =>
    deriveIssueOrder({ issues, config: { baseRanking: { source: 'config', order: [] } } });

  test('attributes a promotion to the canonical, not the duplicate that named it', () => {
    // #20 is blocked-by #30, and #30 duplicates #10 — so the model promotes
    // #10. Reading the RAW target files the dependent under #30, and #10 comes
    // back promoted with nothing to show for it.
    const derived = derive([
      plain(10),
      { ...plain(20, ['P0']), data: frontmatter({ blockedBy: [ref(30)] }) },
      { ...plain(30), data: frontmatter({ duplicateOf: ref(10) }) },
    ]);
    const view = priorityView(derived, '10');
    assert.equal(view.promoted, true);
    assert.equal(view.effective, 0);
    assert.deepStrictEqual(view.promotedBy, ['20']);
  });

  test('never names a duplicate as the promoter — the model ignored its edge', () => {
    // #30 is a duplicate, so its `blocked-by` did NOT promote #10. Its own P0
    // label makes its effective priority equal the promotion, which is exactly
    // what let a raw reverse index list it beside the genuine promoter.
    const derived = derive([
      plain(10),
      { ...plain(20, ['P0']), data: frontmatter({ blockedBy: [ref(10)] }) },
      {
        ...plain(30, ['P0']),
        data: frontmatter({ blockedBy: [ref(10)], duplicateOf: ref(40) }),
      },
      plain(40),
    ]);
    assert.deepStrictEqual(priorityView(derived, '10').promotedBy, ['20']);
  });
});

describe('deriveIssueOrder — urgency also arrives through a together peer', () => {
  // SPEC §6.3 relaxes effective priority along blocked-by AND together edges —
  // "a together group's effective priority is the highest over its members"
  // (`packages/reader/src/model.ts:546-552`). A provenance index built from
  // reverse blocked-by edges alone therefore reports a real promotion with
  // nothing to show for it.

  test('names the together peer the urgency arrived through', () => {
    const issues: NodeInput[] = [
      {
        number: 10,
        open: true,
        labels: ['P3'],
        assigneeCount: 0,
        data: frontmatter({ togetherWith: ref(20) }),
      },
      {
        number: 20,
        open: true,
        labels: ['P0'],
        assigneeCount: 0,
        data: frontmatter({ togetherWith: ref(10) }),
      },
    ];
    const derived = deriveIssueOrder({
      issues,
      config: { baseRanking: { source: 'config', order: [] } },
    });
    const view = priorityView(derived, '10');
    assert.equal(view.declared, 3);
    assert.equal(view.effective, 0);
    assert.equal(view.promoted, true);
    assert.equal(view.notation, 'P3 -> 0');
    assert.deepStrictEqual(view.promotedBy, ['20']);
  });

  test('CONTROL: the P0 peer is not itself promoted, so it names nobody', () => {
    // Without this the test above would pass for an index that simply lists
    // every together member regardless of where the urgency came from.
    const issues: NodeInput[] = [
      {
        number: 10,
        open: true,
        labels: ['P3'],
        assigneeCount: 0,
        data: frontmatter({ togetherWith: ref(20) }),
      },
      {
        number: 20,
        open: true,
        labels: ['P0'],
        assigneeCount: 0,
        data: frontmatter({ togetherWith: ref(10) }),
      },
    ];
    const derived = deriveIssueOrder({
      issues,
      config: { baseRanking: { source: 'config', order: [] } },
    });
    const peer = priorityView(derived, '20');
    assert.equal(peer.promoted, false);
    assert.deepStrictEqual(peer.promotedBy, []);
  });
});

describe('deriveIssueOrder — a together component is not a neighbourhood', () => {
  // `togetherComponent` is the transitive component, and relaxation gives every
  // member the SAME effective priority — so the effective-priority filter
  // cannot tell a direct peer from a distant one, and every member reads as a
  // cause. `promotedBy` promises the neighbour urgency arrived THROUGH, which
  // the blocked-by arm has always answered with the adjacent issue even when
  // the cause is several hops away.

  const chain = (): NodeInput[] => [
    // #10 -- #20 -- #30, and only #30 carries the urgency.
    {
      number: 10,
      open: true,
      labels: [],
      assigneeCount: 0,
      data: frontmatter({ togetherWith: ref(20) }),
    },
    {
      number: 20,
      open: true,
      labels: [],
      assigneeCount: 0,
      data: frontmatter({ togetherWith: ref(30) }),
    },
    { number: 30, open: true, labels: ['P0'], assigneeCount: 0, data: null },
  ];

  const derived = (): DerivedIssueOrder =>
    deriveIssueOrder({
      issues: chain(),
      config: { baseRanking: { source: 'config', order: [] } },
    });

  test('names only the DIRECT together peer, not the whole component', () => {
    const view = priorityView(derived(), '10');
    assert.equal(view.effective, 0);
    assert.equal(view.promoted, true);
    // #30 is two hops away and shares no edge with #10.
    assert.deepStrictEqual(view.promotedBy, ['20']);
  });

  test('names BOTH peers for the member that genuinely has two', () => {
    // The control that stops the test above passing for a rule that simply
    // returns one peer, or the lowest-numbered one.
    assert.deepStrictEqual(priorityView(derived(), '20').promotedBy, ['10', '30']);
  });

  test('CONTROL: the whole chain really is one component at one priority', () => {
    // Without this the assertions above could pass because the component never
    // formed — in which case they would be measuring nothing.
    const d = derived();
    const unit = slotWith(d, '10');
    assert.deepStrictEqual(unit.members, ['10', '20', '30']);
    assert.equal(unit.togetherGroupSize, 3);
    for (const key of ['10', '20', '30']) {
      assert.equal(priorityView(d, key).effective, 0);
    }
  });
});
