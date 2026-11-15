/**
 * The edge grammar, as data.
 *
 * Each relationship is separable on FOUR redundant channels — dash pattern,
 * terminal marker, glyph and hue — and the colour-blind-safety claim is that
 * removing hue entirely still leaves all five distinguishable. That is a
 * property of this table, so it is asserted against this table rather than
 * asserted about the rendering.
 *
 * It is declared as a total mapping over `EDGE_FIELDS` rather than a list of
 * cases, so a sixth relationship added to the format fails the BUILD here
 * instead of rendering as an untreated line nobody notices.
 */

import { EDGE_FIELDS, type EdgeField } from '@issuegraph/core';

/** How the line is stroked. `enclosure` draws a surrounding shape, not a line. */
export type EdgeDash = 'solid' | 'double' | 'dotted' | 'dashed' | 'enclosure';

/** What sits at the pointed end. `none` is symmetric; `enclosure` has no end. */
export type EdgeTerminal = 'arrow' | 'none' | 'enclosure' | 'hollow-circle' | 'tee';

/** What the relationship does to the order. */
export type OrderingEffect =
  | 'strict-directed'
  | 'exclusive-unordered'
  | 'shares-rank'
  | 'never-worked'
  | 'provenance-only';

export interface EdgeTreatment {
  readonly dash: EdgeDash;
  readonly terminal: EdgeTerminal;
  /** The single character that names the relationship without colour. */
  readonly glyph: string;
  /** The custom property carrying this edge's hue. Never a literal colour. */
  readonly hueToken: string;
  /**
   * The relationship's phrase, as RULES words it everywhere a kind is named:
   * a row, the Inspector, the legend and an accessible name ("is blocked by",
   * "serializes with", "goes together with", "is a duplicate of", "was
   * decomposed from"). One set of words (#308): the row vocabulary that read
   * "blocked by" beside a legend reading "is blocked by" is gone.
   */
  readonly label: string;
  /**
   * The same relationship read from the OTHER end: #488 is what #512 is
   * blocked by, and #512 is what #488 BLOCKS, so the vocabulary carries the
   * plain reading rather than asking a reader to invert a sentence.
   *
   * A symmetric edge reads the same both ways and carries none. So does
   * `decomposed-from`: read from the parent its other end is a sub-issue,
   * listed in the Sub-issues tree and never as a relationship (build-136's
   * #308 ruling, RULES "Relationships"), so it has no reverse phrase at all.
   */
  readonly reverseLabel?: string;
  /**
   * Whether the reverse phrase names the other issue FIRST: "#2250 is a
   * duplicate of this" (build-136's #308 ruling, matching Design 5b5f1cc),
   * where every other phrase is followed by the number.
   */
  readonly reverseOtherFirst?: true;
  readonly ordering: OrderingEffect;
  /**
   * Whether the edge reads the same both ways. A symmetric edge is drawn once
   * and never as two arrows, because `A serialize-with B` and its reverse state
   * one fact.
   */
  readonly symmetric: boolean;
}

/**
 * `satisfies` rather than an annotation, so the object literal keeps its narrow
 * types AND the compiler proves every `EdgeField` has an entry. Adding a field
 * to `@issuegraph/core` without adding it here is TS2739 at build time.
 */
export const EDGE_TREATMENTS = Object.freeze({
  'blocked-by': {
    dash: 'solid',
    terminal: 'arrow',
    glyph: '⊘',
    hueToken: '--ig-edge-blocked-by',
    label: 'is blocked by',
    reverseLabel: 'blocks',
    ordering: 'strict-directed',
    symmetric: false,
  },
  'serialize-with': {
    dash: 'double',
    terminal: 'none',
    glyph: '⇄',
    hueToken: '--ig-edge-serialize-with',
    label: 'serializes with',
    ordering: 'exclusive-unordered',
    symmetric: true,
  },
  'together-with': {
    dash: 'enclosure',
    terminal: 'enclosure',
    glyph: '⧉',
    hueToken: '--ig-edge-together-with',
    label: 'goes together with',
    ordering: 'shares-rank',
    symmetric: true,
  },
  'duplicate-of': {
    dash: 'dotted',
    terminal: 'hollow-circle',
    glyph: '≡',
    hueToken: '--ig-edge-duplicate-of',
    label: 'is a duplicate of',
    reverseLabel: 'is a duplicate of this',
    reverseOtherFirst: true,
    ordering: 'never-worked',
    symmetric: false,
  },
  'decomposed-from': {
    dash: 'dashed',
    terminal: 'tee',
    glyph: '⑃',
    hueToken: '--ig-edge-decomposed-from',
    label: 'was decomposed from',
    ordering: 'provenance-only',
    symmetric: false,
  },
} as const satisfies Record<EdgeField, EdgeTreatment>);

/** The treatment for a relationship. Total over the format's fields. */
export function treatmentFor(field: EdgeField): EdgeTreatment {
  return EDGE_TREATMENTS[field];
}

/**
 * A relationship's phrase, read from the end the reader is standing at: "is
 * blocked by" or "blocks". `null` where that end reads no relationship: a
 * `decomposed-from` read from the parent, whose sub-issues are the Sub-issues
 * tree's (#308).
 *
 * IT IS A FUNCTION HERE RATHER THAN A TEST AT EACH CALL SITE, and that is the
 * whole reason it exists: the order row, the Inspector row and the Inspector's
 * group heads draw the SAME edge on one screen, and two copies of this
 * expression would be free to disagree the moment either was edited.
 *
 * A symmetric kind takes {@link EdgeTreatment.label} at either end, because
 * `serialize-with` and `together-with` state one fact whichever way round.
 */
export function labelFrom(treatment: EdgeTreatment, outgoing: boolean): string | null {
  if (outgoing || treatment.symmetric) return treatment.label;
  return treatment.reverseLabel ?? null;
}

/**
 * A relationship's phrase about one other issue, read from the reader's end:
 * "is blocked by #2240", or, for the one phrase that names the other issue
 * first, "#2250 is a duplicate of this". `null` where {@link labelFrom} is.
 */
export function phraseFrom(treatment: EdgeTreatment, outgoing: boolean, other: string): string | null {
  const label = labelFrom(treatment, outgoing);
  if (label === null) return null;
  return otherFirst(treatment, outgoing) ? `${other} ${label}` : `${label} ${other}`;
}

/** Whether the phrase read from this end names the other issue before its words. */
export function otherFirst(treatment: EdgeTreatment, outgoing: boolean): boolean {
  return !outgoing && !treatment.symmetric && treatment.reverseOtherFirst === true;
}

/**
 * The dash patterns, as SVG `stroke-dasharray` values keyed by dash name.
 *
 * `solid` and `double` carry none: a solid line has no pattern, and a double
 * line is two solid strokes side by side rather than one stroked differently.
 * Returning `null` for them says that out loud; returning `'none'` would read
 * as "solid" and quietly collapse two of the four channels into one.
 *
 * This is the single source for the pattern channel — the stylesheet sets no
 * `stroke-dasharray` for an edge, so a pattern cannot be changed in one place
 * and left stale in the other.
 */
export function dashArrayFor(dash: EdgeDash): string | null {
  switch (dash) {
    case 'solid':
    case 'double':
      return null;
    case 'dotted':
      return '1 3';
    case 'dashed':
      return '6 4';
    case 'enclosure':
      return '3 3';
  }
}

/** Every relationship the format declares, in the order `@issuegraph/core` lists them. */
export const EDGE_ORDER: readonly EdgeField[] = EDGE_FIELDS;
