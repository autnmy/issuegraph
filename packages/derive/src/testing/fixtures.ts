/**
 * The Issuegraph ordering seed and its golden outcomes.
 *
 * This is the reference prototype's own seed, transcribed as graph data. It is
 * the fixture the derivation is pinned against, so the two cannot drift: every
 * relationship the specification defines appears at least once, and each one is
 * load-bearing for at least one assertion.
 *
 * Issue titles are deliberately absent — `NodeInput` carries none, and the
 * derivation consumes none. What each issue means STRUCTURALLY is in the
 * comment beside it, which is the only thing a reader of this file needs.
 *
 * The `createdAt` ordinals are the seed's own insertion order. They exist for
 * the fixture-parity tie-break; only their relative order is meaningful.
 *
 * TEST-ONLY. Excluded from the build, so nothing here is published.
 */

import type { Frontmatter, IssueRef, NodeInput } from '@issuegraph/reader';

/** A same-repo ref, as the frontmatter parser produces it. */
export function ref(number: number): IssueRef {
  return { repo: null, number };
}

/**
 * Frontmatter as the PARSER yields it — every field present, absent ones at
 * their empty forms.
 *
 * Spelled out here rather than imported: the normalizer that states this once
 * for real belongs to the writer, which is a separate extraction, and a
 * fixture may not wait on it. `Frontmatter` is a closed interface under
 * `exactOptionalPropertyTypes`, so a field added to it fails this function to
 * compile rather than silently defaulting — which is the property that keeps a
 * hand-written normalizer honest.
 */
export function frontmatter(overrides: Partial<Frontmatter> = {}): Frontmatter {
  return {
    blockedBy: [],
    decomposedFrom: null,
    duplicateOf: null,
    serializeWith: null,
    togetherWith: null,
    priority: null,
    evidence: null,
    ...overrides,
  };
}

interface SeedNode {
  readonly number: number;
  readonly open: boolean;
  readonly labels?: readonly string[];
  /** `null` mirrors an issue whose body carries no issuegraph block at all. */
  readonly data?: Frontmatter | null;
}

function node(seed: SeedNode): NodeInput {
  return {
    number: seed.number,
    open: seed.open,
    labels: seed.labels ?? [],
    // No issue in the seed is claimed; serialize admission is exercised by its
    // own test rather than baked into the shared seed.
    assigneeCount: 0,
    data: seed.data ?? null,
  };
}

/**
 * The seed. Eleven issues covering every Issuegraph relationship:
 *
 *   470  closed  — the split ORIGIN; contributes provenance only
 *   488  P3      — the split LEAF (`decomposed-from: 470`), evidence verified
 *   512  P0      — half of the together UNIT, and the duplicate CANONICAL
 *   514  P0      — the other half of the together unit
 *   501  P1      — half of a serialize GROUP
 *   503  P1      — the other half of the serialize group
 *   530  P1      — HELD: blocked by an open issue
 *   602  no label— the open BLOCKER (inherits urgency from 530)
 *   520  P2      — an ordinary ranked issue
 *   455  no label— EXCLUDED: `duplicate-of: 512`
 *   487  no label— an ordinary ranked issue at the spec default
 */
export function issuegraphOrderSeed(): NodeInput[] {
  return [
    node({ number: 470, open: false }),
    node({
      number: 488,
      open: true,
      labels: ['P3'],
      data: frontmatter({ decomposedFrom: ref(470), evidence: 'verified' }),
    }),
    node({ number: 512, open: true, labels: ['P0'], data: frontmatter({ togetherWith: ref(514) }) }),
    node({ number: 514, open: true, labels: ['P0'], data: frontmatter({ togetherWith: ref(512) }) }),
    node({
      number: 501,
      open: true,
      labels: ['P1'],
      data: frontmatter({ serializeWith: ref(503) }),
    }),
    node({
      number: 503,
      open: true,
      labels: ['P1'],
      data: frontmatter({ serializeWith: ref(501) }),
    }),
    node({
      number: 530,
      open: true,
      labels: ['P1'],
      data: frontmatter({ blockedBy: [ref(602)] }),
    }),
    node({ number: 602, open: true }),
    node({ number: 520, open: true, labels: ['P2'] }),
    node({ number: 455, open: true, data: frontmatter({ duplicateOf: ref(512) }) }),
    node({ number: 487, open: true }),
  ];
}

/** The seed's own insertion order, as the fixture-parity tie-break reads it. */
export function issuegraphOrderSeedCreatedAt(): Map<string, number> {
  return new Map([
    ['470', 1],
    ['488', 2],
    ['512', 3],
    ['514', 4],
    ['501', 5],
    ['503', 6],
    ['530', 7],
    ['602', 8],
    ['520', 9],
    ['455', 10],
    ['487', 11],
  ]);
}

/**
 * The seed with one `blocked-by` edge added — the reference prototype's own
 * demonstration edit. This is what promotes #488 and holds the unit; the seed
 * ALONE carries no blocking relationship between them.
 */
export function withBlockedByEdge(
  issues: readonly NodeInput[],
  from: number,
  to: number,
): NodeInput[] {
  return issues.map((issue) => {
    if (issue.number !== from) return issue;
    const data = issue.data ?? frontmatter({});
    return { ...issue, data: { ...data, blockedBy: [...data.blockedBy, ref(to)] } };
  });
}

/**
 * The golden ranks for the seed. `null` is a HELD slot; a key absent from the
 * map is not in the order at all (excluded, or closed).
 *
 * #530 is held behind open #602, so it takes no number and the ranks below it
 * close up — a held slot does not reserve a position.
 */
export const SEED_GOLDEN_RANKS: ReadonlyMap<string, number | null> = new Map([
  ['512', 1],
  ['514', 1],
  ['501', 2],
  ['503', 3],
  ['530', null],
  ['602', 4],
  ['520', 5],
  ['487', 6],
  ['488', 7],
]);

/**
 * The golden ranks after adding `#512 blocked-by #488`.
 *
 * #488 inherits effective priority 0 from the P0 issue it now blocks, which
 * lifts it from last to first; the `{512, 514}` unit goes held because one of
 * its two members is blocked, and a unit advances only as a whole.
 */
export const PROMOTED_GOLDEN_RANKS: ReadonlyMap<string, number | null> = new Map([
  ['488', 1],
  ['512', null],
  ['514', null],
  ['501', 2],
  ['503', 3],
  ['530', null],
  ['602', 4],
  ['520', 5],
  ['487', 6],
]);
