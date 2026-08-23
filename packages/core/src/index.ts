/**
 * The Issuegraph specification's vocabulary, as data.
 *
 * This package holds what the spec fixes and nothing it derives: the field
 * names, their cardinality, the value sets, and the documented defaults. It
 * parses nothing, reads nothing and builds no graph — those are the reader's
 * and writer's jobs, and keeping them apart is what lets a consumer depend on
 * the vocabulary without taking on either.
 *
 * Every export is frozen. A shared vocabulary that a consumer can mutate is a
 * vocabulary that disagrees with itself in the next process.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

/** The specification revision this vocabulary tracks (SPEC.md's version header). */
export const SPEC_VERSION = '0.2.0';

/** The top-level frontmatter key that namespaces this specification's data (§4.1). */
export const FRONTMATTER_KEY = 'issuegraph';

/**
 * The relationship fields (§4.3). They carry issue references between issues,
 * and for them the frontmatter is canonical over any native tracker mirror.
 */
export const EDGE_FIELDS = Object.freeze([
  'blocked-by',
  'decomposed-from',
  'duplicate-of',
  'serialize-with',
  'together-with',
] as const);

/**
 * The scalar fields (§4.3.5, §4.3.6). They annotate one issue with a value a
 * human might flip, and they run the *other* way from the relationship fields:
 * where the tracker has an established convention, that convention is canonical
 * and the frontmatter field is an optional mirror.
 */
export const SCALAR_FIELDS = Object.freeze(['priority', 'evidence'] as const);

/** Every field the specification recognises. Anything else is inert (§4.1). */
export const FIELDS = Object.freeze([...EDGE_FIELDS, ...SCALAR_FIELDS] as const);

/**
 * How many references each relationship field carries. `blocked-by` is the only
 * list; the group fields are single because a writer joins a group by pointing
 * at any one existing member (§4.3.4, §4.3.7).
 */
export const EDGE_CARDINALITY = Object.freeze({
  'blocked-by': 'list',
  'decomposed-from': 'single',
  'duplicate-of': 'single',
  'serialize-with': 'single',
  'together-with': 'single',
} as const);

/**
 * The relationship fields whose edges carry no direction (§4.3.4, §4.3.7). Both
 * describe a connected component "treated as undirected", so `A serialize-with
 * B` and `B serialize-with A` state the same fact and a reader must not present
 * them as two.
 *
 * Directed and symmetric are the only two readings, so the complement is every
 * other member of `EDGE_FIELDS` rather than a second table to keep in step.
 */
export const SYMMETRIC_EDGE_FIELDS = Object.freeze(['serialize-with', 'together-with'] as const);

/** The two values `evidence` accepts (§4.3.6). */
export const EVIDENCE_VALUES = Object.freeze(['asserted', 'verified'] as const);

/** Declared priority is an integer 0–3, 0 most urgent (§4.3.5). */
export const PRIORITY_MIN = 0;
export const PRIORITY_MAX = 3;

/** Absent `priority` means 2 (§4.3.5). */
export const DEFAULT_PRIORITY = 2;

/** Absent `evidence` means `asserted` for machine-written issues (§4.3.6). */
export const DEFAULT_EVIDENCE = 'asserted';

/** A relationship field name. */
export type EdgeField = (typeof EDGE_FIELDS)[number];

/** A scalar field name. */
export type ScalarField = (typeof SCALAR_FIELDS)[number];

/** Any recognised field name. */
export type Field = (typeof FIELDS)[number];

/** A value `evidence` may take. */
export type Evidence = (typeof EVIDENCE_VALUES)[number];

/** A declared priority. */
export type Priority = 0 | 1 | 2 | 3;

/** How many references a relationship field carries. */
export type EdgeCardinality = (typeof EDGE_CARDINALITY)[EdgeField];

/** A relationship field whose edges carry no direction. */
export type SymmetricEdgeField = (typeof SYMMETRIC_EDGE_FIELDS)[number];

const EDGE_FIELD_SET: ReadonlySet<string> = new Set<string>(EDGE_FIELDS);
const SCALAR_FIELD_SET: ReadonlySet<string> = new Set<string>(SCALAR_FIELDS);
const FIELD_SET: ReadonlySet<string> = new Set<string>(FIELDS);
const EVIDENCE_SET: ReadonlySet<string> = new Set<string>(EVIDENCE_VALUES);
const SYMMETRIC_EDGE_FIELD_SET: ReadonlySet<string> = new Set<string>(SYMMETRIC_EDGE_FIELDS);

/** Narrow an arbitrary string to a relationship field name. */
export function isEdgeField(value: string): value is EdgeField {
  return EDGE_FIELD_SET.has(value);
}

/**
 * Whether a relationship field's edges carry no direction (§4.3.4, §4.3.7).
 *
 * Takes an `EdgeField` rather than a bare string: "is this direction-free?" is
 * only a question about a field the format recognises, and accepting anything
 * would answer `false` for a typo as readily as for `blocked-by`.
 */
export function isSymmetricEdgeField(field: EdgeField): field is SymmetricEdgeField {
  return SYMMETRIC_EDGE_FIELD_SET.has(field);
}

/** Narrow an arbitrary string to a scalar field name. */
export function isScalarField(value: string): value is ScalarField {
  return SCALAR_FIELD_SET.has(value);
}

/** Narrow an arbitrary string to any recognised field name. */
export function isField(value: string): value is Field {
  return FIELD_SET.has(value);
}

/** Narrow an arbitrary string to an `evidence` value. */
export function isEvidence(value: string): value is Evidence {
  return EVIDENCE_SET.has(value);
}

/**
 * Narrow an arbitrary value to a declared priority. Deliberately strict about
 * the number's shape as well as its range: YAML will hand a reader `2.0`, `"2"`
 * and `NaN` as readily as `2`, and only one of those is a priority.
 */
export function isPriority(value: unknown): value is Priority {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= PRIORITY_MIN &&
    value <= PRIORITY_MAX
  );
}
