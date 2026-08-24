import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { NodeInput } from '@issuegraph/reader';

import { wouldCycleOnBlockedBy } from './cycle.ts';
import { deriveIssueOrder } from './order.ts';
import {
  frontmatter,
  issuegraphOrderSeed,
  issuegraphOrderSeedCreatedAt,
  ref,
} from './testing/fixtures.ts';

// `wouldCycle` is the validation that runs BEFORE a write: a `blocked-by` edge
// that closes a cycle produces a component no member of which can ever be
// ready, and refusing it must cost zero round-trips.

function issue(number: number, blockedBy: readonly number[] = []): NodeInput {
  return {
    number,
    open: true,
    labels: [],
    assigneeCount: 0,
    data: frontmatter({ blockedBy: blockedBy.map(ref) }),
  };
}

describe('wouldCycleOnBlockedBy', () => {
  test('refuses an issue blocking itself', () => {
    assert.equal(wouldCycleOnBlockedBy(issuegraphOrderSeed(), '512', '512'), true);
  });

  test('allows an edge between two issues with no existing dependency', () => {
    // The seed carries no blocked-by relationship between #512 and #488.
    assert.equal(wouldCycleOnBlockedBy(issuegraphOrderSeed(), '512', '488'), false);
  });

  test('refuses the reverse of an existing edge', () => {
    const issues = [issue(488), issue(512, [488])];
    // #512 is already blocked by #488, so #488 blocked-by #512 closes the loop.
    assert.equal(wouldCycleOnBlockedBy(issues, '488', '512'), true);
  });

  test('refuses an edge that closes a TRANSITIVE chain', () => {
    // 10 <- 20 <- 30 (30 depends on 20 depends on 10).
    const issues = [issue(10), issue(20, [10]), issue(30, [20])];
    assert.equal(wouldCycleOnBlockedBy(issues, '10', '30'), true);
    // The same edge in the other direction merely deepens the chain.
    assert.equal(wouldCycleOnBlockedBy(issues, '30', '10'), false);
  });

  test('terminates on an input that already contains a cycle', () => {
    // The walk would revisit 10 -> 20 -> 10 forever without the seen-set; this
    // test completing at all is the termination proof.
    const issues = [issue(10, [20]), issue(20, [10])];
    // Both members already depend on each other, so either direction refuses.
    assert.equal(wouldCycleOnBlockedBy(issues, '10', '20'), true);
    assert.equal(wouldCycleOnBlockedBy(issues, '20', '10'), true);
    // A fresh issue depending on a stuck component adds no NEW cycle through
    // itself — nothing in the component depends on #30.
    assert.equal(wouldCycleOnBlockedBy(issues, '30', '10'), false);
  });

  test('returns false for an unknown target rather than throwing', () => {
    // DOCUMENTED PRECONDITION, not an oversight: both endpoints must be in the
    // supplied node set for the answer to mean anything. Failing closed here
    // would make a paged editing surface refuse every edge to an issue it has
    // not loaded yet.
    assert.equal(wouldCycleOnBlockedBy(issuegraphOrderSeed(), '512', '999999'), false);
  });

  test("refuses across a CLOSED intermediate, diverging from the model's cycle set", () => {
    // The model's §6.6 cycle detector walks open nodes only, because a closed
    // blocker does not block today. This guard is asked about the future: the
    // edge outlives the current states, and a reopened #20 would make the
    // cycle real and unbreakable. Refusing is the recoverable direction.
    const issues = [issue(10, [20]), { ...issue(20, [30]), open: false }, issue(30)];
    assert.equal(wouldCycleOnBlockedBy(issues, '30', '10'), true);
  });

  describe('home-repo-qualified endpoints fold to the bare key', () => {
    // SPEC §4.2 lets a surface spell a home-repo issue either way, and the
    // adjacency stores it bare. An endpoint arriving qualified must fold the
    // same way or the walk starts at a key that is not there and the guard
    // FAILS OPEN — accepting an edge that closes a cycle.
    const homeRepo = 'acme/widgets';
    const cyclic = (): NodeInput[] => [issue(488), issue(512, [488])];

    test('refuses with both endpoints bare (the control)', () => {
      assert.equal(wouldCycleOnBlockedBy(cyclic(), '488', '512', { homeRepo }), true);
    });

    test('refuses with a qualified `from`', () => {
      assert.equal(
        wouldCycleOnBlockedBy(cyclic(), 'acme/widgets#488', '512', { homeRepo }),
        true,
      );
    });

    test('refuses with a qualified `to`', () => {
      assert.equal(
        wouldCycleOnBlockedBy(cyclic(), '488', 'acme/widgets#512', { homeRepo }),
        true,
      );
    });

    test('refuses with both endpoints qualified', () => {
      assert.equal(
        wouldCycleOnBlockedBy(cyclic(), 'acme/widgets#488', 'acme/widgets#512', { homeRepo }),
        true,
      );
    });

    test("refuses with a qualified endpoint in the host's own casing", () => {
      assert.equal(
        wouldCycleOnBlockedBy(cyclic(), 'Acme/Widgets#488', 'acme/widgets#512', { homeRepo }),
        true,
      );
    });

    test("still refuses through the derived model's bound probe", () => {
      const derived = deriveIssueOrder({
        issues: cyclic(),
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
      assert.equal(derived.wouldCycle('acme/widgets#488', 'acme/widgets#512'), true);
      assert.equal(derived.wouldCycle('acme/widgets#512', 'acme/widgets#488'), false);
    });
  });

  test("normalizes caller-supplied keys to the adjacency's own spelling", () => {
    const issues = [issue(488), issue(512, [488])];
    // A surface holding the host's casing must get the same verdict as one
    // holding the model's — otherwise the walk silently misses and the
    // cycle-creating edge is written.
    assert.equal(
      wouldCycleOnBlockedBy(issues, 'Acme/Widgets#488', 'acme/widgets#512', {
        homeRepo: 'other/repo',
      }),
      false,
    );
    const qualified: NodeInput = {
      number: 512,
      repo: 'Acme/Widgets',
      open: true,
      labels: [],
      assigneeCount: 0,
      data: frontmatter({ blockedBy: [{ repo: 'Acme/Widgets', number: 488 }] }),
    };
    const cross = [{ ...issue(488), repo: 'Acme/Widgets' }, qualified];
    assert.equal(wouldCycleOnBlockedBy(cross, 'Acme/Widgets#488', 'ACME/widgets#512'), true);
  });

  test("normalizes a cross-repo ref onto the home repo's bare key", () => {
    const qualified: NodeInput = {
      number: 512,
      open: true,
      labels: [],
      assigneeCount: 0,
      data: frontmatter({ blockedBy: [{ repo: 'acme/widgets', number: 488 }] }),
    };
    const issues = [issue(488), qualified];
    // Spelled `acme/widgets#488` but the home repo IS acme/widgets, so it is
    // the same node as the bare `488` — and the reverse edge still cycles.
    assert.equal(wouldCycleOnBlockedBy(issues, '488', '512', { homeRepo: 'acme/widgets' }), true);
    // Without the home repo it is a different node, so nothing closes.
    assert.equal(wouldCycleOnBlockedBy(issues, '488', '512'), false);
  });

  test('is exposed on the derived model bound to the same node set', () => {
    const derived = deriveIssueOrder({
      issues: [issue(488), issue(512, [488])],
      config: {
        baseRanking: { source: 'fixture-parity', createdAt: issuegraphOrderSeedCreatedAt() },
      },
    });
    // Synchronous: the refusal is decided from data already in hand, so it
    // costs no round-trip. A promise here would be a contract violation.
    //
    // Asserted on the TYPE OF THE VALUE rather than with `instanceof Promise`.
    // The signature already returns `boolean`, so an `instanceof` check no
    // longer typechecks — and had it been widened to compile, it would have
    // been a test that can never fail, which is worse than none.
    const verdict = derived.wouldCycle('488', '512');
    assert.equal(typeof verdict, 'boolean');
    assert.equal(verdict, true);
    assert.equal(derived.wouldCycle('512', '488'), false);
  });
});

describe('duplicate targets, which the model resolves and a raw walk does not', () => {
  // `buildModel` reads an edge naming a duplicate as naming its CANONICAL
  // (`packages/reader/src/model.ts:477`). A walk over raw targets therefore
  // misses a path the model can see, and misses it in the fail-OPEN direction.

  test('resolves a blocked-by target through a duplicate before walking', () => {
    // #30 duplicates #10, so the model reads "#20 blocked-by #30" as
    // "#20 blocked-by #10". Adding "#10 blocked-by #20" closes 10 -> 20 -> 10.
    // A raw walk follows #20 -> #30, never reaches #10, and admits the edge.
    const issues = [
      issue(10),
      issue(20, [30]),
      { ...issue(30), data: frontmatter({ duplicateOf: ref(10) }) },
    ];
    assert.equal(wouldCycleOnBlockedBy(issues, '10', '20'), true);
  });

  test('CONTROL: the same shape with no duplicate edge admits the write', () => {
    // Identical but for the `duplicate-of`. Without this the test above would
    // pass for a guard that simply refuses more, rather than one that resolves.
    const issues = [issue(10), issue(20, [30]), issue(30)];
    assert.equal(wouldCycleOnBlockedBy(issues, '10', '20'), false);
  });

  test('resolves through a CHAIN of duplicates, as the model does', () => {
    // #30 -> #25 -> #10. The canonical is transitive, so the walk must follow
    // it the whole way rather than one hop.
    const issues = [
      issue(10),
      issue(20, [30]),
      { ...issue(25), data: frontmatter({ duplicateOf: ref(10) }) },
      { ...issue(30), data: frontmatter({ duplicateOf: ref(25) }) },
    ];
    assert.equal(wouldCycleOnBlockedBy(issues, '10', '20'), true);
  });

  test('KEEPS an edge declared BY a duplicate — a third deliberate divergence', () => {
    // The model drops a duplicate's own edges entirely (`model.ts:443`). This
    // guard does not, for the reason the other two divergences give: dropping
    // them REMOVES reachability, which is the fail-open direction, and a
    // groomer clearing the `duplicate-of` makes the edge live again with the
    // cycle already written. Refusing is the recoverable direction.
    const issues = [
      issue(10),
      {
        ...issue(20),
        data: frontmatter({ blockedBy: [ref(10)], duplicateOf: ref(40) }),
      },
      issue(40),
    ];
    assert.equal(wouldCycleOnBlockedBy(issues, '10', '20'), true);
  });
});
