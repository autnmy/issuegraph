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
  /** Announced to a screen reader, and used as the badge's accessible name. */
  readonly label: string;
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
    label: 'blocked by',
    ordering: 'strict-directed',
    symmetric: false,
  },
  'serialize-with': {
    dash: 'double',
    terminal: 'none',
    glyph: '⇄',
    hueToken: '--ig-edge-serialize-with',
    label: 'serialized with',
    ordering: 'exclusive-unordered',
    symmetric: true,
  },
  'together-with': {
    dash: 'enclosure',
    terminal: 'enclosure',
    glyph: '⧉',
    hueToken: '--ig-edge-together-with',
    label: 'together with',
    ordering: 'shares-rank',
    symmetric: true,
  },
  'duplicate-of': {
    dash: 'dotted',
    terminal: 'hollow-circle',
    glyph: '≡',
    hueToken: '--ig-edge-duplicate-of',
    label: 'duplicate of',
    ordering: 'never-worked',
    symmetric: false,
  },
  'decomposed-from': {
    dash: 'dashed',
    terminal: 'tee',
    glyph: '⑃',
    hueToken: '--ig-edge-decomposed-from',
    label: 'decomposed from',
    ordering: 'provenance-only',
    symmetric: false,
  },
} as const satisfies Record<EdgeField, EdgeTreatment>);

/** The treatment for a relationship. Total over the format's fields. */
export function treatmentFor(field: EdgeField): EdgeTreatment {
  return EDGE_TREATMENTS[field];
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
