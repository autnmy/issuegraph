import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Frontmatter, NodeInput } from '@issuegraph/reader';
import { evaluateReadiness, resolveSerializeGroup, resolveTogetherUnit } from '@issuegraph/reader';

import { deriveIssueOrder } from './order.ts';
import { issuegraphOrderSeed, issuegraphOrderSeedCreatedAt } from './testing/fixtures.ts';

const EMPTY_DATA: Frontmatter = {
  blockedBy: [],
  decomposedFrom: null,
  duplicateOf: null,
  serializeWith: null,
  togetherWith: null,
  priority: null,
  evidence: null,
};

const seedNode = (id: string, data: Partial<Frontmatter> = {}): NodeInput => ({
  id,
  open: true,
  labels: [],
  assigneeCount: 0,
  declarationRead: 'read',
  data: { ...EMPTY_DATA, ...data },
});

/**
 * DW3 OF autnmy/issuegraph#83, as a check rather than a claim: `deriveIssueOrder`
 * must COMPOSE the three relation answers, not re-implement them.
 *
 * It reaches them through `buildModel`, which reaches them through the same
 * functions these assertions call — so today this holds by construction. That is
 * exactly why it is worth pinning: the failure this guards against is a future
 * change that "optimises" one of these three answers inside the derivation and
 * leaves the standalone entry points saying something else. Nothing else in the
 * suite would notice, because both paths have their own passing tests.
 *
 * The seed is the reference prototype's own, so every relationship the
 * specification defines is exercised rather than a hand-picked few.
 */
describe('deriveIssueOrder composes the relation layer (#83 DW3)', () => {
  const issues = issuegraphOrderSeed();
  const derived = deriveIssueOrder({
    issues,
    config: {
      baseRanking: { source: 'fixture-parity', createdAt: issuegraphOrderSeedCreatedAt() },
    },
  });

  test('the seed exercises more than one slot, so the sweep below is not vacuous', () => {
    assert.ok(derived.slots.length > 1, `expected several slots, saw ${derived.slots.length}`);
  });

  /**
   * A HELD UNIT, built here because the seed has none — without it the sweep
   * below never sees a slot whose `ready` is false, and a whole half of the
   * composition goes unchecked.
   *
   * IT ALSO RECORDS SOMETHING THE DERIVATION'S OWN CODE DOES NOT SAY. Mutating
   * `members.every((m) => model.readiness(m).ready)` to `members.some(...)`
   * leaves this suite — and this fixture — green, and that is CORRECT rather
   * than a gap: `readiness` is already unit-aware (it appends a `together
   * member ... is not ready` reason to every member), so all members of a unit
   * share one readiness and the two quantifiers cannot differ. The `every` is
   * therefore a restatement of a guarantee the relation layer already gives.
   * Left as-is — it is the honest spelling of the intent — but nobody should
   * expect a test to distinguish it.
   */
  test('a unit with a blocked member is held, and every member says so', () => {
    const mixed: NodeInput[] = [
      // BOTH members carry the SAME blocker, so their reasons OVERLAP — which is
      // what makes the deduplication below an assertion rather than a no-op.
      seedNode('900', {
        togetherWith: { repo: null, id: '901' },
        blockedBy: [{ repo: null, id: '902' }],
      }),
      seedNode('901', { blockedBy: [{ repo: null, id: '902' }] }),
      seedNode('902'),
    ];
    const order = deriveIssueOrder({
      issues: mixed,
      config: { baseRanking: { source: 'config', order: [] } },
    });

    // Unit-aware readiness: the partner's blocker holds the DECLARER too.
    assert.equal(evaluateReadiness(mixed, '900').ready, false);
    assert.equal(evaluateReadiness(mixed, '901').ready, false);
    assert.equal(evaluateReadiness(mixed, '902').ready, true);

    const unit = order.slots.find((slot) => slot.members.includes('900'));
    assert.ok(unit !== undefined, 'expected a slot carrying 900');
    assert.deepEqual(unit.members, ['900', '901']);
    assert.equal(unit.ready, false, 'a unit with a held member is held');
    assert.equal(unit.rank, null, 'a held slot carries no rank');
    // The reasons are the relation layer's, deduplicated — not the derivation's
    // own sentences. This is the assertion the sweep below generalises.
    assert.deepEqual(
      unit.holdReasons,
      [...new Set(['900', '901'].flatMap((m) => evaluateReadiness(mixed, m).reasons))],
    );
    assert.ok(unit.holdReasons.length > 0, 'a held slot names why');
  });

  for (const slot of derived.slots) {
    test(`slot ${slot.lead}: readiness and both group answers are the relation layer's`, () => {
      // A unit advances only when every member can — recomputed here from the
      // STANDALONE readiness rather than read off the slot.
      const ready = slot.members.every((member) => evaluateReadiness(issues, member).ready);
      assert.equal(slot.ready, ready);

      const holdReasons = [
        ...new Set(slot.members.flatMap((member) => evaluateReadiness(issues, member).reasons)),
      ];
      assert.deepEqual(slot.holdReasons, holdReasons);

      // The unit is the together component narrowed to the slot's own members,
      // so every member must agree the others are in its unit.
      for (const member of slot.members) {
        const unit = resolveTogetherUnit(issues, member);
        for (const peer of slot.members) assert.ok(unit.includes(peer));
      }

      // Every member's serialize component is a superset of what the slot
      // counted, and the count never exceeds the union of those components.
      const union = new Set(
        slot.members.flatMap((member) => [...resolveSerializeGroup(issues, member)]),
      );
      assert.ok(
        slot.serializeGroupSize <= union.size,
        `slot counted ${slot.serializeGroupSize} serialize peers, the relation layer knows ${union.size}`,
      );
    });
  }
});
