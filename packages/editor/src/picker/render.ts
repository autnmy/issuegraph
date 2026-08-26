/**
 * The type picker, the direction statement and the flip control, as markup.
 *
 * ## Every readable byte comes from the host or from the document
 *
 * This surface renders no word of its own — not in a text node, and not in an
 * `aria-label`. That is stricter than the rest of this package (the scale
 * ladder writes its own chip labels), and it is stricter deliberately: what is
 * being worded here is a RELATIONSHIP, so a phrase written in would be an
 * English clause in the one place the design says a reader most often gets the
 * encoding wrong. `render.test.ts` enforces it by asserting that every text node
 * is either a {@link ./words.ts PickerWords} entry or an issue reference — a
 * total claim rather than a spot check, so a word added later fails rather than
 * slipping in.
 *
 * ## The default word order is a DEFAULT
 *
 * The statement is drawn subject · phrase · object, which is a word order and
 * therefore a presentation choice this layer is not entitled to impose. It is
 * offered as the ordinary case and bypassed the same way the re-evaluate
 * summary's is: {@link ./view.ts PickerView} carries the ordered pair and the
 * kind and no order beyond that, so a host that needs another arrangement
 * renders the view model. Nothing here is load-bearing for it.
 *
 * ## It publishes commands and wires nothing
 *
 * `data-ig-command="retype"` with a `data-ig-kind`, and
 * `data-ig-command="flip"`. Listener wiring, focus and dispatch belong to the
 * mount, exactly as the scale ladder and the re-evaluate surface already defer
 * them — and the proposal each command stands for is on the view model, so a
 * mount reads it rather than reconstructing it from attributes.
 *
 * ## It names itself without claiming a heading level
 *
 * The label is a paragraph, and the list carries the same words as its
 * `aria-label`. A heading would be a claim about the HOST's document outline —
 * whether this picker is a section of something, and at what depth — which a
 * package rendered into an unknown page cannot make. A host that wants it in
 * the outline wraps it in a heading of its own choosing.
 */

import {
  type ElementSpec,
  type Theme,
  element,
  renderMarkup,
  resolveTheme,
  themeCss,
} from '@issuegraph/viewer';
import type { EdgeId, GraphDocument } from '@issuegraph/store';

import { type DirectionStatement, type KindOption, type PickerView, pickerView } from './view.ts';
import { pickerStylesheet } from './styles.ts';
import type { PickerWords } from './words.ts';

export interface PickerOptions {
  /**
   * The words. Required — see {@link PickerWords} for why this package will not
   * invent them.
   */
  readonly words: PickerWords;
  readonly theme?: Theme | undefined;
  /** The selector the theme's custom properties are written onto. */
  readonly themeSelector?: string | undefined;
}

export interface PickerResult {
  readonly view: PickerView;
  /** The picker, the statement and the flip control, under one root. */
  readonly markup: string;
  /**
   * The theme and this surface's own stylesheet. Install both.
   *
   * The VIEWER's stylesheet is deliberately not among them, which is where the
   * scale ladder and the re-evaluate surface differ — both draw viewer elements
   * and so must ship the rules for them. This surface draws none, so including
   * them would ship a sheet whose every selector matches nothing here, and a
   * host that installs the picker alone would take the whole canvas stylesheet
   * with it. A host drawing a viewer installs the viewer's own.
   */
  readonly styles: string;
  readonly diagnostics: readonly string[];
}

/** One row of the picker. The phrase is the host's; everything else is data. */
function optionSpec(option: KindOption, words: PickerWords): ElementSpec {
  return element(
    'li',
    {
      class: 'ig-picker-kind',
      'data-ig-kind': option.kind,
      'data-directed': option.directed ? 'true' : 'false',
      'data-current': option.current ? 'true' : 'false',
    },
    [
      element(
        'button',
        {
          type: 'button',
          class: 'ig-picker-choice',
          'data-ig-command': 'retype',
          'data-ig-kind': option.kind,
          // A radio group's checked member, spelled for assistive technology.
          // The current kind is still OFFERED — hiding it would be a second
          // validity rule out here, and the store already refuses the edit.
          'aria-pressed': option.current ? 'true' : 'false',
        },
        [
          element('span', { class: 'ig-picker-phrase' }, [words.kinds[option.kind]]),
          option.current ? element('span', { class: 'ig-picker-current' }, [words.current]) : null,
        ],
      ),
    ],
  );
}

/**
 * The direction statement.
 *
 * The two references are the DOCUMENT's, not this package's words, and each
 * carries the role it plays so a host can restyle or reorder them without
 * parsing the sentence back apart.
 */
function directionSpec(direction: DirectionStatement, words: PickerWords): ElementSpec {
  return element('p', { class: 'ig-picker-direction', 'data-ig-kind': direction.kind }, [
    element('span', { class: 'ig-picker-ref', 'data-ig-role': 'from' }, [direction.from]),
    element('span', { class: 'ig-picker-phrase' }, [words.kinds[direction.kind]]),
    element('span', { class: 'ig-picker-ref', 'data-ig-role': 'to' }, [direction.to]),
  ]);
}

/**
 * The picker for one existing edge.
 *
 * Takes a DOCUMENT and an edge id — never a store and never a source. A host
 * hands the proposals on {@link PickerResult.view} to `Store.propose`, which is
 * the only thing in the family that dispatches.
 */
export function renderPicker(
  document: GraphDocument,
  edgeId: EdgeId,
  options: PickerOptions,
): PickerResult {
  const view = pickerView(document, edgeId);
  const theme = resolveTheme(options.theme);
  const { words } = options;

  const root = element('section', { class: 'ig-picker', 'data-ig-edge': view.edgeId }, [
    element('p', { class: 'ig-picker-heading' }, [words.heading]),
    view.options.length === 0
      ? null
      : element(
          'ul',
          { class: 'ig-picker-kinds', 'aria-label': words.heading },
          view.options.map((option) => optionSpec(option, words)),
        ),
    // Symmetric kinds render NEITHER of the next two. The absence is the
    // finding: a control to reverse a relationship that carries no direction
    // would claim the format says something it does not.
    view.direction === null ? null : directionSpec(view.direction, words),
    view.flip === null
      ? null
      : element(
          'button',
          { type: 'button', class: 'ig-picker-flip', 'data-ig-command': 'flip' },
          [words.flip],
        ),
  ]);

  return {
    view,
    markup: renderMarkup(root),
    styles: `${themeCss(theme, options.themeSelector ?? ':root')}\n${pickerStylesheet}`,
    diagnostics: [...view.diagnostics],
  };
}
