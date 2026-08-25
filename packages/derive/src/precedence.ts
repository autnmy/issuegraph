/**
 * Priority-carrier precedence.
 *
 * SPEC §4.3.5 gives an issue two priority carriers: the tracker's mapped P0-P3
 * label and the frontmatter `priority` field. `buildModel` resolves them
 * label-first and propagates effective priority from that resolved value.
 *
 * WHICH CARRIER WINS WHEN THEY DISAGREE IS A HOST DECISION, so this module
 * makes it a parameter — without re-resolving priority downstream. The naive
 * shape (re-resolve in the consumer) would force a SECOND effective-priority
 * propagation beside the model's, which is exactly the mirror-whose-input-
 * space-drifts anti-pattern the reference packages exist to avoid.
 *
 * Instead precedence is applied as an INPUT NORMALIZATION, before the model is
 * built:
 *   - `label` (the default) is the IDENTITY. The same array comes back by
 *     reference and the model behaves exactly as it does everywhere else.
 *   - `frontmatter` REMOVES the P0-P3 labels from any node whose frontmatter
 *     `priority` speaks, so the model's own label-first rule lands on the
 *     frontmatter value and its propagation runs unmodified.
 *
 * A removal, never a synthesis: nothing fabricated enters the model. The raw
 * carriers are read separately, from the UNTOUCHED input, so whichever signal
 * lost is still recoverable for a "signals disagree" surface.
 */

import type { NodeInput } from '@issuegraph/reader';
import { priorityLabelValue } from '@issuegraph/reader';

/** Which carrier wins when a mapped label and frontmatter `priority` disagree. */
export type DeclaredPriorityPrecedence = 'label' | 'frontmatter';

/**
 * The mapped label wins by default — SPEC §4.3.5's own ordering, and the rule
 * `buildModel` already implements.
 */
export const DEFAULT_PRIORITY_PRECEDENCE: DeclaredPriorityPrecedence = 'label';

// The model's OWN rule, imported rather than restated: this module decides
// which labels to REMOVE, so a looser or tighter pattern here would leave a
// label the model still reads (or strip one it never would).
const isPriorityLabel = (label: string): boolean => priorityLabelValue([label]) !== null;

/** SPEC §4.3.5: absent means 2 — for the frontmatter FIELD only. */
const DEFAULT_PRIORITY = 2;

/** What each carrier said, which one won, and what the loser asserted. */
export interface PrioritySignals {
  /** The declared priority under the active precedence. */
  readonly resolved: number;
  readonly winner: DeclaredPriorityPrecedence | 'default';
  /** The mapped-label value (lowest when several priority labels are set). */
  readonly labelValue: number | null;
  readonly frontmatterValue: number | null;
  /** Both carriers spoke and said different things. */
  readonly disagreement: boolean;
  /** The carrier that lost a disagreement; null when there was none. */
  readonly losingCarrier: DeclaredPriorityPrecedence | null;
  /** What the losing carrier asserted — a surface renders it beside the winner. */
  readonly losingValue: number | null;
}

/**
 * Read both raw carriers off an UNNORMALIZED node and resolve them under
 * `precedence`, keeping the losing signal recoverable.
 *
 * An ABSENT frontmatter priority never overrides a mapped label under either
 * precedence — the §4.3.5 default of 2 applies to the frontmatter field, not
 * to the issue.
 */
export function resolvePrioritySignals(
  node: NodeInput,
  precedence: DeclaredPriorityPrecedence = DEFAULT_PRIORITY_PRECEDENCE,
): PrioritySignals {
  const labelValue = priorityLabelValue(node.labels);
  const frontmatterValue = node.data?.priority ?? null;
  const other: DeclaredPriorityPrecedence = precedence === 'label' ? 'frontmatter' : 'label';
  const preferred = precedence === 'label' ? labelValue : frontmatterValue;
  const fallback = precedence === 'label' ? frontmatterValue : labelValue;

  const winner: DeclaredPriorityPrecedence | 'default' =
    preferred !== null ? precedence : fallback !== null ? other : 'default';
  const resolved = preferred ?? fallback ?? DEFAULT_PRIORITY;
  const disagreement =
    labelValue !== null && frontmatterValue !== null && labelValue !== frontmatterValue;
  const losingCarrier = disagreement ? other : null;
  const losingValue = losingCarrier === null ? null : (fallback ?? null);

  return {
    resolved,
    winner,
    labelValue,
    frontmatterValue,
    disagreement,
    losingCarrier,
    losingValue,
  };
}

/**
 * Normalize a node set so the model's own label-first resolution lands on the
 * carrier `precedence` selects.
 *
 * `label` returns the input BY REFERENCE — the default path costs nothing and
 * changes no node. `frontmatter` returns a new array in which any node whose
 * frontmatter priority speaks has had its P0-P3 labels removed; every other
 * node is passed through by reference.
 */
export function applyPriorityPrecedence(
  issues: readonly NodeInput[],
  precedence: DeclaredPriorityPrecedence = DEFAULT_PRIORITY_PRECEDENCE,
): readonly NodeInput[] {
  if (precedence === 'label') return issues;
  return issues.map((node) => {
    if (node.data?.priority == null) return node;
    const labels = node.labels.filter((label) => !isPriorityLabel(label));
    if (labels.length === node.labels.length) return node;
    return { ...node, labels };
  });
}
