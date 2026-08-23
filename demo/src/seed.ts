/**
 * The seeded backlog.
 *
 * Its job is coverage, not realism: every edge type, both hold families, all
 * three readiness stations and all three rank-provenance forms have to be
 * reachable without the visitor editing anything first. A demo whose interesting
 * states are three clicks away is a demo whose interesting states nobody sees.
 *
 * TWO OF THE FIVE EDGE TYPES HAVE NEVER BEEN USED IN ANGER. Across the backlog
 * this specification was written against there are zero `together-with` and zero
 * `duplicate-of` declarations, so this seed is the first place either is
 * exercised at all — treat what it renders as a real test of them rather than as
 * decoration.
 *
 * References are numbered the way a tracker numbers them, which is what lets the
 * order's tiebreak read as §6.4's "newest first" (see `order.ts`).
 */

import type { GraphDocument, StoredEdge, StoredIssue } from '@issuegraph/store';
import { makeEdge } from '@issuegraph/store';
import type { ExecutorHold } from './order.ts';

const issues: readonly StoredIssue[] = [
  { ref: '1', title: 'Publish the first release', state: 'open', priority: 0 },
  { ref: '2', title: 'Write the release notes', state: 'open', priority: 3 },
  { ref: '3', title: 'Cut the changelog', state: 'open', priority: 3 },
  // No declared priority: the spec's default tier applies (§4.3.5).
  { ref: '4', title: 'Rename the config flag', state: 'open' },
  { ref: '5', title: 'Migrate the store schema', state: 'open', priority: 1 },
  { ref: '6', title: 'Backfill the store schema', state: 'open', priority: 1 },
  { ref: '7', title: 'Split: the reading half', state: 'open', priority: 2 },
  { ref: '8', title: 'Support two halves of one format', state: 'closed', priority: 2 },
  { ref: '9', title: 'Split: the writing half', state: 'open', priority: 2 },
  { ref: '10', title: 'Rename the flag in the config file', state: 'open', priority: 2 },
  { ref: '11', title: 'Choose a name for the public package', state: 'open', priority: 1 },
  { ref: '12', title: 'Load the manifest before the plugins', state: 'open', priority: 2 },
  { ref: '13', title: 'Load the plugins before the manifest', state: 'open', priority: 2 },
  { ref: '14', title: 'Adopt the shared linter preset', state: 'open', priority: 2 },
];

const edges: readonly StoredEdge[] = [
  // blocked-by ⊘ — strict and directed. #1 waits on two open issues that both
  // hold ranks, which is what a HOLLOW station means: ready after a named rank.
  makeEdge('blocked-by', '1', '2'),
  makeEdge('blocked-by', '1', '3'),

  // serialize-with ⇄ — symmetric, no order, exclusive. #6 is claimed, so #5 is
  // held by the GRAPH while #6 is held by the EXECUTOR: one relationship, two
  // hold families, two treatments.
  makeEdge('serialize-with', '5', '6'),

  // together-with ⧉ — the group shares ONE rank and is ready as a unit or not
  // at all (§4.3.7).
  makeEdge('together-with', '7', '9'),

  // decomposed-from ⑃ — provenance, with no ordering effect whatsoever. The
  // parent is closed and never worked again.
  makeEdge('decomposed-from', '7', '8'),
  makeEdge('decomposed-from', '9', '8'),

  // duplicate-of ≡ — never worked, and the closure is transitive (§6.1).
  makeEdge('duplicate-of', '10', '4'),

  // A blocked-by CYCLE. Detected on read and surfaced as stuck (§6.6) rather
  // than refused at write time, because a cycle a groomer can see beats a
  // dependency described in prose.
  makeEdge('blocked-by', '12', '13'),
  makeEdge('blocked-by', '13', '12'),

  // An UNRESOLVABLE reference. Treated as blocking (§6.7): unknown state is not
  // "closed", and reading it as closed would start work whose dependency
  // nobody can see.
  makeEdge('blocked-by', '14', '404'),
];

/** The seeded document, fresh each call so the reset button gets a clean one. */
export function seedDocument(): GraphDocument {
  return { issues: [...issues], edges: [...edges] };
}

/**
 * The executor's own holds (§6.8) — the second hold family.
 *
 * They live here rather than on the issues because the format never learns why
 * an executor declines ready work: hold semantics MUST NOT be encoded as format
 * fields. A host knows its own holds, and this table is the host's.
 */
export function seedHolds(): readonly ExecutorHold[] {
  return [
    // ACTIVE: a worker is running this right now, so its serialize group is
    // excluded (§6.2 rule 4).
    { ref: '6', label: 'claimed', detail: 'another worker holds this issue', active: true },
    // NOT active: parked work is not running, so it excludes nobody. Reading
    // every hold as a claim is what held a serialize group over an issue that
    // nothing was working.
    { ref: '11', label: 'parked', detail: 'parked for a decision a person has to make' },
  ];
}
