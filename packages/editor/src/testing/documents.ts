/**
 * Documents built to a shape, for the tests that ask about scale.
 *
 * The ladder's whole subject is how many nodes there are, so its tests need
 * documents at 60, 61, 300 and 301 nodes — sizes nobody hand-writes. A builder
 * also keeps the arithmetic in one place: a fixture whose component sizes do
 * not sum to the count under test proves nothing, and that is invisible when
 * the numbers are scattered through the assertions.
 */

import type { ViewerDocument, ViewerEdge, ViewerIssue, ViewerSlot } from '@issuegraph/viewer';

export interface DocumentShape {
  /** One entry per connected component, giving its member count. */
  readonly components: readonly number[];
  /** Issues carrying no relationship at all. */
  readonly isolated?: number;
  /** Close a `blocked-by` cycle in the component at this index. */
  readonly cycleIn?: number;
  /** Titles for the first members, so a search has something to match. */
  readonly titles?: Readonly<Record<string, string>>;
}

export function componentKey(component: number, member: number): string {
  return `c${String(component)}-${String(member)}`;
}

export function isolatedKey(index: number): string {
  return `iso-${String(index)}`;
}

/**
 * A document of the requested shape.
 *
 * Each component is a `blocked-by` CHAIN, so its chain depth is one less than
 * its size and a reader can check a depth assertion by counting. Every issue
 * holds an order position, which is the ordinary grooming case and the one that
 * makes the viewer's own `isolated` field empty — see `IsolatedChip`.
 */
export function documentOf(shape: DocumentShape): ViewerDocument {
  const issues: ViewerIssue[] = [];
  const edges: ViewerEdge[] = [];
  const titles = shape.titles ?? {};

  const add = (key: string): void => {
    issues.push({
      key,
      title: titles[key] ?? `Issue ${key}`,
      open: true,
      priority: 2,
    });
  };

  shape.components.forEach((size, component) => {
    // A component of one has no edge, so it would not be a component at all —
    // the builder refuses to pretend otherwise rather than emitting a self-edge,
    // which would make a node-count assertion silently wrong.
    if (size < 2) {
      throw new Error('a component of one carries no relationship; use `isolated` instead');
    }
    for (let member = 1; member <= size; member += 1) add(componentKey(component, member));
    for (let member = 1; member < size; member += 1) {
      edges.push({
        field: 'blocked-by',
        from: componentKey(component, member),
        to: componentKey(component, member + 1),
      });
    }
    if (shape.cycleIn === component) {
      edges.push({
        field: 'blocked-by',
        from: componentKey(component, size),
        to: componentKey(component, 1),
      });
    }
  });

  for (let index = 1; index <= (shape.isolated ?? 0); index += 1) add(isolatedKey(index));

  const slots: ViewerSlot[] = issues.map((issue, index) => ({
    rank: index + 1,
    lead: issue.key,
    members: [issue.key],
    ready: true,
    holds: [],
  }));

  return { issues, edges, order: { slots, excluded: [] } };
}

/** Component sizes summing to `total`, each no larger than `cap`. */
export function componentsSumming(total: number, cap: number): number[] {
  if (total < 2 || cap < 2) {
    throw new Error('a document of related issues needs at least one component of two');
  }
  const sizes: number[] = [];
  let left = total;
  while (left > 0) {
    // Never leaves a remainder of one: a component of one is not a component.
    const size = left <= cap ? left : left - cap < 2 ? cap - 1 : cap;
    sizes.push(size);
    left -= size;
  }
  return sizes;
}
