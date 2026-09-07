/**
 * The type picker — the five kinds an edge can be retyped to — as markup.
 *
 * ## The direction statement and the flip are NOT here, and once were
 *
 * §17b's direction card belongs to the panel that has an edge selected, and
 * `renderWorkspace` draws it: the relationship row already states the pair and
 * the kind, and the flip sits at the end of that row where frame 17b draws it.
 * They lived here because this surface landed first, and a picker composed into
 * that panel then drew a second statement and a second flip one element from
 * the first — which is the encoding ambiguity §17b exists to remove, produced by
 * the surface meant to remove it.
 *
 * {@link ./view.ts PickerView} still carries `direction` and `flip`: they are
 * the MODEL, `reduceHost` builds its proposal from them, and a host that wants
 * another arrangement renders them itself — `PickerView` carries the ordered
 * pair and the kind and no word order beyond that, which is what makes such a
 * host cheap. What moved is the drawing, not the answer.
 *
 * ## Every readable byte comes from the host or from the document
 *
 * This surface renders no word of its own — not in a text node, and not in an
 * `aria-label`. That is stricter than the rest of this package (the scale
 * ladder writes its own chip labels), and it is stricter deliberately: what is
 * being worded here is a RELATIONSHIP, so a phrase written in would be an
 * English clause in the one place the design says a reader most often gets the
 * encoding wrong. `render.test.ts` enforces it by asserting that every text node
 * is a {@link ./words.ts PickerWords} entry — a total claim rather than a spot
 * check, so a word added later fails rather than slipping in.
 *
 * IT NO LONGER ADMITS AN ISSUE REFERENCE EITHER, and the tightening is the
 * statement leaving rather than a decision: the two references this surface
 * used to draw were the statement's. A list of KINDS naming an ISSUE would now
 * itself be the finding.
 *
 * ## It publishes commands and wires nothing
 *
 * `data-ig-command="retype"` with a `data-ig-kind`. Listener wiring, focus and
 * dispatch belong to the mount, exactly as the scale ladder and the re-evaluate surface already defer
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

import { type KindOption, type PickerView, pickerView } from './view.ts';
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
  /** The kind list, under one root. */
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
  ]);

  return {
    view,
    markup: renderMarkup(root),
    styles: `${themeCss(theme, options.themeSelector ?? ':root')}\n${pickerStylesheet}`,
    diagnostics: [...view.diagnostics],
  };
}
