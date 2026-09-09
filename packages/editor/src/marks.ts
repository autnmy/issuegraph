/**
 * One keyed walk over a rendered spec tree, used by every zone that decorates
 * layer 1's rows and nodes.
 *
 * ## Why it is one function and not one per decoration
 *
 * `render.ts` grew this walk for `data-ig-audit`, then composed §17c's delta
 * chip onto the same pass rather than adding a second — and the reason it gave
 * holds for the third decoration too: the row is a SPEC, keyed and reachable,
 * so a decoration is composed onto it rather than positioned over it, and no
 * geometry is consulted at all.
 *
 * §17e adds the third. A multi-selection marks every member, and it marks them
 * in the RAIL and on the CANVAS — two roots, drawn by two different renderers.
 * A walk written twice is two spellings of one traversal, and the failure it
 * produces is the one the whole workspace is built to prevent: two zones
 * disagreeing about what is selected. So the traversal moves here, both zones
 * call it, and neither owns a copy.
 *
 * ## It rebuilds; it never mutates
 *
 * `ElementSpec` is `readonly` throughout, and a mutating walk would also be
 * visible through the caller's own reference to `scene.root`.
 *
 * ## An unmarked element is returned UNTOUCHED, identically
 *
 * Not "equivalently" — the same `attrs` and the same `children` array it came
 * in with. §17c's rule is that unaffected rows are *left completely alone*, and
 * a rebuilt array carrying an appended `null` is a change even when it renders
 * the same bytes. The test that pins it compares markup, so the structural
 * guarantee is what makes that test meaningful rather than incidental.
 */

import { type AttrValue, type ElementSpec, type SpecChild, KEY_ATTRIBUTE } from '@issuegraph/viewer';

/**
 * What one keyed element gains.
 *
 * Every field optional, and a lookup answering `undefined` leaves the element
 * alone entirely — which is what lets three unrelated decorations share one
 * pass without any of them having to know the others exist.
 */
export interface KeyedMark {
  /** Merged over the element's own attributes. */
  readonly attrs?: Readonly<Record<string, AttrValue>> | undefined;
  /** Appended as the element's last child. */
  readonly append?: ElementSpec | undefined;
  /**
   * Appended to the element's `aria-label`, em-dash separated.
   *
   * SEEN AND NOT HEARD IS THE FAILURE THIS FIELD EXISTS FOR. An accessible name
   * computed from `aria-label` WINS over descendant text, so anything appended
   * as a child is invisible to a screen reader unless the name is extended too.
   * The rail is the surface a reader arrows through, and "is this row in my
   * selection" is exactly the kind of fact that has to arrive with the row.
   *
   * The separator is layer 1's own: `slotLabel` joins its parts with the same
   * em dash, so a clause here reads as one more part rather than a second
   * sentence in a different hand.
   *
   * IGNORED WHEN THE ELEMENT HAS NO `aria-label`, rather than minting one. An
   * element layer 1 chose not to name is not one this layer names on its behalf.
   */
  readonly nameClause?: string | undefined;
}

/** Answers what one key's element gains, or `undefined` to leave it alone. */
export type MarkLookup = (key: string) => KeyedMark | undefined;

/**
 * Every keyed element in `root`, decorated by `lookup`.
 *
 * TYPED AS `ElementSpec -> ElementSpec` AT THE BOUNDARY, with the child walk
 * kept inside. A single function over `SpecChild` would hand `renderMarkup` a
 * union it does not take, and the obvious repair — asserting the result back —
 * is the one this repository bans outright. The narrowing belongs where the
 * string case actually lives.
 */
export function markKeyed(root: ElementSpec, lookup: MarkLookup): ElementSpec {
  const markChild = (child: SpecChild): SpecChild =>
    typeof child === 'string' ? child : markSpec(child);

  function markSpec(spec: ElementSpec): ElementSpec {
    const key = spec.attrs?.[KEY_ATTRIBUTE];
    // A KEY IS A STRING OR IT IS NOT A KEY. `AttrValue` admits numbers and
    // booleans, and `String(true)` would look up a row named "true" — which
    // resolves to nothing today and to something the day a host names an issue
    // that. Narrowed rather than coerced.
    const mark = typeof key === 'string' ? lookup(key) : undefined;
    const walked = spec.children?.map(markChild);
    if (mark === undefined) {
      return { ...spec, ...(walked === undefined ? {} : { children: walked }) };
    }

    const children = mark.append === undefined ? walked : [...(walked ?? []), mark.append];
    const label = spec.attrs?.['aria-label'];
    // COMPOSED IN ONE OBJECT rather than assigned conditionally into a mutable
    // record: the name clause depends on the incoming label, so building the
    // whole set at once keeps the "only when layer 1 named it" rule in the
    // expression that reads the label rather than in a later `if`.
    const named =
      mark.nameClause === undefined || typeof label !== 'string'
        ? {}
        : { 'aria-label': `${label} — ${mark.nameClause}` };
    const attrs: Readonly<Record<string, AttrValue>> = { ...spec.attrs, ...mark.attrs, ...named };

    return {
      ...spec,
      attrs,
      ...(children === undefined ? {} : { children }),
    };
  }

  return markSpec(root);
}

/**
 * The lookups of several decorations, as one.
 *
 * MERGED RATHER THAN CHAINED, so each decoration stays a function of a key
 * alone and none of them can see — or accidentally depend on — what another
 * one did. Later lookups win on a colliding attribute, and name clauses
 * ACCUMULATE in order, because two facts about one row are two things a reader
 * needs to hear rather than one overwriting the other.
 *
 * Answers `undefined` when every lookup did, which is what preserves
 * {@link markKeyed}'s untouched-element guarantee through composition.
 */
export function marksOf(...lookups: readonly MarkLookup[]): MarkLookup {
  return (key) => {
    const found = lookups.map((lookup) => lookup(key)).filter((mark) => mark !== undefined);
    if (found.length === 0) return undefined;
    const clauses = found.flatMap((mark) => (mark.nameClause === undefined ? [] : [mark.nameClause]));
    const appended = found.flatMap((mark) => (mark.append === undefined ? [] : [mark.append]));
    return {
      attrs: Object.assign({}, ...found.map((mark) => mark.attrs ?? {})),
      // ONE APPEND, AND THE LAST ONE WINS RATHER THAN BOTH BEING DRAWN. Two
      // decorations appending to one row would stack two elements the row's
      // grid has no cell for; today exactly one decoration appends, and this
      // states the rule rather than leaving the second one to be discovered by
      // a layout that quietly breaks.
      ...(appended.length === 0 ? {} : { append: appended[appended.length - 1] }),
      ...(clauses.length === 0 ? {} : { nameClause: clauses.join(' — ') }),
    };
  };
}
