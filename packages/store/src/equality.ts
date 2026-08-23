/**
 * One structural comparison, used by every slice the store reuses.
 *
 * It exists because the alternative failed twice in one review. Each reused
 * slice used to have its own comparator listing the fields it cared about —
 * and a field left off a list is invisible: the slice compares equal, the old
 * one is republished, and a host renders state the store has already replaced.
 * Two of those shipped (a projection whose edge carriers had reversed, a
 * refusal whose reason had changed), and a third was one field away.
 *
 * A list of fields to compare is the defect, not any particular list. Nothing
 * here enumerates anything, so a field added tomorrow is compared tomorrow.
 *
 * The one comparator that stays bespoke is `sameEdgeSet`, and for a reason
 * this cannot express: it is deliberately order-INSENSITIVE, because an adapter
 * may return its edges in whatever order its storage yields and a reordering is
 * not a change.
 */

/**
 * How deep a comparison will go before giving up and reporting "different".
 *
 * A bound rather than cycle tracking, because the failure it guards is a host
 * value the store did not build — a row from an injected deriver — and the
 * safe direction is obvious: over-reporting a change costs one redundant
 * publish, while looping costs the process. Nothing the store itself builds is
 * more than a handful of levels deep.
 */
const MAX_DEPTH = 100;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Whether two values say the same thing, all the way down.
 *
 * `Object.is` at the top, so a reference match short-circuits and `NaN`
 * compares equal to itself — which matters because a rank is a number and a
 * deriver that produces `NaN` should not make every snapshot look different
 * from the last one for ever.
 */
export function sameValue(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (depth >= MAX_DEPTH) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index], depth + 1));
  }

  if (!isPlainObject(a) || !isPlainObject(b)) return false;

  const keys = Object.keys(a);
  // Counted both ways, so a key present on one side and absent on the other is
  // a difference even when every shared key matches.
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key], depth + 1));
}

/** Whether two lists say the same thing, element for element and in order. */
export function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  return sameValue(a, b);
}
