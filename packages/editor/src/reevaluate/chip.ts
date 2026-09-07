/**
 * One row's delta chip, in the two places §17c puts it.
 *
 * ## Why this is its own module
 *
 * The chip is drawn twice: as an item in `renderReevaluate`'s standalone list,
 * and ON its row in the mounted workspace. Two spellings of one chip is the
 * drift the package split exists to prevent, so both call this and neither
 * builds spans of its own.
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
import type { PlacedChip } from './view.ts';

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

function countWord(count: number, word: string): readonly ElementSpec[] {
  return [
    element('span', { class: 'ig-change-count' }, [String(count)]),
    element('span', { class: 'ig-change-word' }, [word]),
  ];
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
