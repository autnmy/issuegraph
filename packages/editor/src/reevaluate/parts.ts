/**
 * The pieces every §17c rendering draws the same way.
 *
 * ## Why this is its own module
 *
 * The loop is drawn twice: by `renderReevaluate`, standalone, with its chips in
 * a list beside the rail; and by the workspace, with the summary in the header
 * and each chip ON its row. Two spellings of one summary or one chip is the
 * drift the package split exists to prevent, so both call these and neither
 * builds spans of its own. Same reasoning as `@issuegraph/viewer`'s own
 * `parts.ts`, one layer up.
 *
 * ## PLACED IS NOT A STYLING FLAG — it removes a fact the row already states
 *
 * `renderReevaluate`'s header records why the unpositioned chip names its row
 * in text: *"a chip that carried its key only as an attribute said nothing a
 * reader could see about WHICH row moved."* That reasoning is conditional on
 * being unpositioned, and it inverts once the chip sits on the row: the row
 * names the issue immediately to its left, so a `.ig-delta-key` there is the
 * one span on the chip that says nothing new.
 *
 * So `placed: true` drops the key span, and it drops nothing else. The
 * per-member `data-ref` stays in both, because a `together-with` unit is one
 * row speaking for several issues and the row names only its lead.
 *
 * ## It builds a SPEC, so it is composed and never concatenated
 *
 * The words come from the host through {@link ChangeWords}, and host prose may
 * not be joined into markup out here — `audit/surface.ts` states the rule and
 * the reason: layer 1 owns the markup primitive, and a second escaper in this
 * package is duplication with an injection shape. `element` is that primitive,
 * reached through the viewer's public surface, so this is the one renderer used
 * from a second call site rather than a second renderer.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

import { type ElementSpec, KEY_ATTRIBUTE, element } from '@issuegraph/viewer';
import type { RankDelta } from '@issuegraph/store';

import type { ChangeWords } from './words.ts';
import type { ChangeSummary, PlacedChip } from './view.ts';

/**
 * The attribute a rail row carries while the last edit moved it.
 *
 * ITS VALUE IS THE ROW'S OWN DELTA KIND, not a severity: §17c tints a promoted
 * row and a newly-held row differently, and a single boolean "changed" would
 * make the reader read the chip to learn which. It is the same shape
 * `AUDIT_SEVERITY_ATTRIBUTE` takes and for the same reason — the styling
 * decision stays the host's, and this package only says which kind it is.
 *
 * ABSENT ON AN UNAFFECTED ROW, never `""` or `"none"`. §17c's rule is that
 * unaffected rows are *left completely alone*, and an attribute stamped on
 * every row with one value meaning "nothing" is not leaving it alone — it is
 * marking it, and a host stylesheet would then have to know which value means
 * absent.
 */
export const DELTA_ATTRIBUTE = 'data-ig-delta';

/**
 * Which of a chip's facts decides the row's tint.
 *
 * ONE ROW, ONE TINT, and a `together-with` unit can carry several members whose
 * deltas disagree — so this picks rather than concatenates. Readiness outranks
 * movement because §17c's own summary orders it that way ("1 newly promoted · 1
 * newly held · 1 pushed down"): becoming held is a change to whether the work
 * can start, and moving five ranks is a change to when. A reader scanning for
 * what broke is scanning for the first.
 *
 * `undefined` when no member carries either, which is the only way a chip with
 * no drawable delta reaches a row. It leaves the row unmarked rather than
 * inventing a kind for it.
 */
export function deltaKind(chip: PlacedChip): string | undefined {
  const readiness = chip.deltas.find((delta) => delta.readiness !== undefined)?.readiness;
  if (readiness !== undefined) return readiness;
  const movement = chip.deltas.find((delta) => delta.movement !== undefined)?.movement;
  if (movement !== undefined) return movement.direction;
  return chip.deltas.find((delta) => delta.presence !== undefined)?.presence;
}

export function countWord(count: number, word: string): readonly ElementSpec[] {
  return [
    element('span', { class: 'ig-change-count' }, [String(count)]),
    element('span', { class: 'ig-change-word' }, [word]),
  ];
}

export function summarySpec(summary: ChangeSummary | null, words: ChangeWords): ElementSpec {
  return element(
    'div',
    {
      class: 'ig-change-summary',
      // Omitted rather than falsified while there is nothing to report: an
      // element() attribute whose value is `undefined` is not written at all,
      // and `data-unchanged="false"` would claim an edit landed and moved
      // nothing when no edit has landed.
      'data-unchanged': summary === null ? undefined : summary.unchanged ? 'true' : 'false',
      'data-op': summary?.op,
      'data-mutation': summary?.mutationId,
    },
    [
      // THE LIVE REGION IS ALWAYS MOUNTED, AND EMPTY UNTIL THERE IS SOMETHING
      // TO SAY. A `role="status"` node that is CREATED already carrying its
      // text is not reliably announced — the region has to exist first and
      // then have its contents change — so rendering it only alongside a
      // summary would silently lose the FIRST summary after a load, which is
      // the one a reader is most likely to be waiting for.
      //
      // It is also why the region is this wrapper rather than the content
      // inside it: an edit that moved something renders a list and one that
      // moved nothing renders a paragraph, so a role on either would come and
      // go with the shape. And the dismiss button stays OUTSIDE, or its label
      // would be re-announced with every summary.
      //
      // It is a role, not a timer. Nothing about it expires and the region
      // stays put until the next edit or an explicit dismissal.
      element(
        'div',
        { class: 'ig-change-line', role: 'status' },
        summary === null
          ? []
          : [
              // THE ZERO CASE RENDERS, in the summary's own place. An edit that
              // landed and moved nothing is the finding an owner auditing an
              // encoding most needs, and drawing nothing for it is the defect
              // this branch prevents.
              summary.unchanged
                ? element('p', { class: 'ig-change-unchanged' }, [words.unchanged])
                : element(
                    'ul',
                    { class: 'ig-change-parts' },
                    summary.parts.map((part) =>
                      element('li', { class: 'ig-change-part', 'data-facet': part.facet }, [
                        ...countWord(part.count, words.facets[part.facet]),
                      ]),
                    ),
                  ),
            ],
      ),
      // ITS OWN CLASS, not the ladder's `.ig-chip`. That class is defined only
      // in `scale/styles.ts`, so borrowing it would leave this control unstyled
      // for a host that installs this surface and not that one. Folding the two
      // chip looks into one rule is the assembling change's call, not this
      // leaf's — it is the change that first has both on screen at once.
      //
      // Absent with no summary: a control that clears nothing is a control that
      // does nothing, and the region above is what has to persist, not this.
      summary === null
        ? null
        : element(
            'button',
            { type: 'button', class: 'ig-change-dismiss', 'data-ig-command': 'dismiss-change' },
            [words.dismiss],
          ),
    ],
  );
}

/**
 * What one issue's delta says, as spans.
 *
 * IT NAMES A DIRECTION AND A DISTANCE, NEVER A RANK. `RankMovement.from` and
 * `.to` are the deriver's 0-BASED positions, while the rail beside them renders
 * the viewer's 1-BASED ranks — so printing either as a number would put two
 * different bases side by side and read as an off-by-one. `by` is a distance,
 * which is basis-independent and safe to print. A host that knows the basis and
 * wants the endpoints reads them off `view.chips[].deltas`, which carries every
 * `RankDelta` untouched.
 */
function memberSpec(delta: RankDelta, words: ChangeWords, named: boolean): ElementSpec {
  return element('span', { class: 'ig-delta-member', 'data-ref': delta.ref }, [
    // NAMED ONLY WHEN THE NAME ADDS SOMETHING. On a chip whose single member IS
    // the row, the row key above has already said it and repeating it is noise.
    // Everywhere else the ref is load-bearing: two members reading
    // `lead 1 down 1 down` says the row moved twice rather than that a unit of
    // two each moved down one, and a lone member that is NOT the lead is a
    // change to an issue the row key does not name at all.
    named ? element('span', { class: 'ig-delta-ref' }, [delta.ref]) : null,
    delta.movement === undefined
      ? null
      : element(
          'span',
          {
            class: 'ig-delta-move',
            'data-direction': delta.movement.direction,
            'data-by': delta.movement.by,
          },
          [...countWord(delta.movement.by, words.direction[delta.movement.direction])],
        ),
    delta.readiness === undefined
      ? null
      : element('span', { class: 'ig-delta-readiness', 'data-readiness': delta.readiness }, [
          words.facets[delta.readiness],
        ]),
    delta.presence === undefined
      ? null
      : element('span', { class: 'ig-delta-presence', 'data-presence': delta.presence }, [
          words.facets[delta.presence],
        ]),
  ]);
}

/**
 * One ROW's chip — which can speak for more than one issue.
 *
 * A `together-with` unit is one row and several refs, so its members are nested
 * inside a single chip rather than given one each. Each keeps its own
 * `data-ref`, so a host can still tell which member moved.
 *
 * THE TAG FOLLOWS THE PLACE. Unplaced it is an `li`, because the standalone
 * surface draws a list of them and a list item outside a list is markup a
 * reader's assistive technology reports wrongly. Placed it is a `span`, because
 * the row it joins is not a list and an `li` there would be the same defect
 * mirrored.
 */
export function chipSpec(
  chip: PlacedChip,
  words: ChangeWords,
  options: { readonly placed: boolean } = { placed: false },
): ElementSpec {
  // One member whose ref IS the row: the key names it, so naming it again would
  // be the only text on the chip that says nothing. Any other shape — several
  // members, or a lone member the row is not named after — needs each fact
  // attributed, or the chip reads as one row's facts repeated.
  const named = chip.deltas.length > 1 || chip.deltas[0]?.ref !== chip.key;
  const members = chip.deltas.map((delta) => memberSpec(delta, words, named));
  return options.placed
    ? element('span', { class: 'ig-delta-chip', 'data-placed': 'true' }, members)
    : element('li', { class: 'ig-delta-chip', [KEY_ATTRIBUTE]: chip.key }, [
        element('span', { class: 'ig-delta-key' }, [chip.key]),
        ...members,
      ]);
}
