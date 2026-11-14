/**
 * The selection set: what the reader has selected, and how a gesture changes it.
 *
 * It owns the set and nothing else, as `recede.ts` owns receding. Every later
 * step that builds a set — the mount's pointer and key input, an editor's —
 * reads its gesture rules here, so no shell writes a rule of its own.
 *
 * A SELECTION IS TAGGED, NEVER A BARE STRING. `nextSelection` takes and returns
 * a `ViewerSelection`, so it always knows an issue from a relationship and never
 * guesses from the shape of a string. The tag is decided once, at the edge, by
 * `viewerSelectionOf`, against the document.
 *
 * THE STORED FORM is `string | readonly string[] | null` — the shape
 * `RecedeSelection.key` already takes. One issue or one relationship is a
 * string; two or more issues are a frozen array in addition order. An empty or
 * one-key array is never stored, so a single selection has exactly one
 * spelling and every single-key caller keeps working unchanged.
 */

import { edgeIdentity } from '@issuegraph/core';

import type { NormalizedDocument } from './document.ts';

export type ViewerSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'edge'; readonly edgeId: string }
  | { readonly kind: 'issues'; readonly keys: readonly string[] };

/** What the reader did, as the set rules read it. */
export type SelectionGesture =
  | { readonly kind: 'replace' | 'toggle' | 'range'; readonly key: string }
  | { readonly kind: 'edge'; readonly edgeId: string }
  | { readonly kind: 'clear' }
  | { readonly kind: 'limit-to-one' };

/** A selection as hosts store it and the projections draw it. */
export type StoredSelection = string | readonly string[] | null;

/** Below this width a box is narrow, and a set narrows to one issue. */
export const NARROW_WIDTH = 640;

const NONE: ViewerSelection = Object.freeze({ kind: 'none' });

function issues(keys: readonly string[]): ViewerSelection {
  return keys.length === 0 ? NONE : { kind: 'issues', keys: Object.freeze([...keys]) };
}

/** The issue keys of a selection, in addition order; none for a relationship. */
function issueKeys(selection: ViewerSelection): readonly string[] {
  return selection.kind === 'issues' ? selection.keys : [];
}

function toggled(current: ViewerSelection, key: string): ViewerSelection {
  const keys = issueKeys(current);
  return keys.includes(key) ? issues(keys.filter((member) => member !== key)) : issues([...keys, key]);
}

/** `keys`, with `key` moved to the end — added last, wherever it was. */
function addedLast(keys: readonly string[], key: string): readonly string[] {
  return [...keys.filter((member) => member !== key), key];
}

/**
 * A Shift range: from the most recently added key to `key`, in rank order.
 *
 * The keys between are appended walking from the anchor, so a range upward
 * adds the nearer keys first; keys already present stay where they are; the
 * clicked key ends the set. With no issue to extend from it is a replace, and
 * when either end has no rank the clicked key is added alone.
 */
function ranged(current: ViewerSelection, key: string, rankOrder: readonly string[]): ViewerSelection {
  const keys = issueKeys(current);
  const anchor = keys.at(-1);
  if (anchor === undefined) return issues([key]);
  const from = rankOrder.indexOf(anchor);
  const to = rankOrder.indexOf(key);
  if (from === -1 || to === -1) return issues(addedLast(keys, key));
  const step = to > from ? 1 : -1;
  const between = Array.from({ length: Math.abs(to - from) }, (_, index) => rankOrder[from + step * (index + 1)])
    .filter((member): member is string => member !== undefined && !keys.includes(member));
  return issues(addedLast([...keys, ...between], key));
}

function limitedToOne(current: ViewerSelection): ViewerSelection {
  const last = issueKeys(current).at(-1);
  return current.kind === 'issues' && last !== undefined ? issues([last]) : current;
}

/** The selection after `gesture`, over the issues in `rankOrder`. */
export function nextSelection(
  current: ViewerSelection,
  gesture: SelectionGesture,
  rankOrder: readonly string[],
): ViewerSelection {
  switch (gesture.kind) {
    case 'replace': return issues([gesture.key]);
    case 'toggle': return toggled(current, gesture.key);
    case 'range': return ranged(current, gesture.key, rankOrder);
    case 'edge': return { kind: 'edge', edgeId: gesture.edgeId };
    case 'clear': return NONE;
    case 'limit-to-one': return limitedToOne(current);
  }
}

/**
 * A stored selection, tagged by the document: a string one of its edges'
 * identities matches is a relationship, and any other string is an issue.
 */
export function viewerSelectionOf(document: NormalizedDocument, selected: StoredSelection): ViewerSelection {
  if (selected === null) return NONE;
  if (typeof selected === 'string') {
    const isEdge = document.edges.some((edge) => edgeIdentity(edge.field, edge.from, edge.to) === selected);
    return isEdge ? { kind: 'edge', edgeId: selected } : issues([selected]);
  }
  return issues([...new Set(selected)]);
}

/** The stored form: never an empty or a one-key array. */
export function storedSelectionOf(selection: ViewerSelection): StoredSelection {
  switch (selection.kind) {
    case 'none': return null;
    case 'edge': return selection.edgeId;
    case 'issues': return storedKeys(selection.keys);
  }
}

function storedKeys(keys: readonly string[]): StoredSelection {
  if (keys.length === 0) return null;
  if (keys.length === 1) return keys[0] ?? null;
  return Object.freeze([...keys]);
}

/** Whether two selections are the same, by value and in addition order. */
export function sameSelection(a: ViewerSelection, b: ViewerSelection): boolean {
  if (a.kind === 'edge' && b.kind === 'edge') return a.edgeId === b.edgeId;
  if (a.kind === 'issues' && b.kind === 'issues') {
    return a.keys.length === b.keys.length && a.keys.every((key, index) => b.keys[index] === key);
  }
  return a.kind === b.kind;
}

/** Whether a box is narrow: under 640 wide, and not the all-zero box of an unlaid-out element. */
export function isNarrowBox(box: { readonly width: number; readonly height: number }): boolean {
  const unmeasured = box.width === 0 && box.height === 0;
  return box.width < NARROW_WIDTH && !unmeasured;
}

/** Every key a stored selection names, in addition order. */
export function selectedKeysOf(selected: StoredSelection | undefined): readonly string[] {
  if (selected === null || selected === undefined) return [];
  return typeof selected === 'string' ? [selected] : selected;
}

/** Whether a stored selection names `key`. */
export function isSelectedKey(selected: StoredSelection | undefined, key: string): boolean {
  return selectedKeysOf(selected).includes(key);
}
