/**
 * The first-pass queue, as markup.
 *
 * ## Drawing a candidate answers nothing
 *
 * The property §17e turns on, and the one this file most has to be trusted
 * with: rendering emits no proposal, wires no listener and dispatches nothing.
 * It publishes `data-ig-answer` on three buttons and stops. The consent
 * §17e requires — "it always costs one keystroke" — survives because the
 * only thing in this package that builds a `Proposal` from a candidate is
 * `queue.ts`'s `apply` arm, and nothing here calls it.
 *
 * `render.test.ts` asserts it from the outside: a rendered candidate produces
 * no proposal, because there is no return channel on which it could.
 *
 * ## Every readable byte comes from the host or from the document
 *
 * The same total claim `picker/render.ts` makes, and it is stricter here than
 * it looks, because the evidence text is host prose flowing through a package
 * surface. This module never reads it, never truncates it and never summarises
 * it — it places it, with the evidence `token` beside it as a data attribute so
 * a host can style a class of reason and a test can assert one without matching
 * on words.
 *
 * ## Progress is drawn as a number the host worded, not a bar
 *
 * §17e: "100% encoded is never the goal and the workspace never implies it is."
 * A progress BAR implies a target by its geometry — an empty tail is a thing
 * left undone — and no wording can undo that. So the surface publishes the two
 * counts as attributes and renders the host's sentence, and a host that wants a
 * bar draws one knowing what it is claiming. `<progress>` is deliberately not
 * used for the same reason.
 *
 * ## It names itself without claiming a heading level
 *
 * Same call `picker/render.ts` records: a heading would be a claim about the
 * HOST's document outline, which a package rendered into an unknown page cannot
 * make.
 */

import {
  type ElementSpec,
  type Theme,
  element,
  renderMarkup,
  resolveTheme,
  themeCss,
} from '@issuegraph/viewer';

import { type FirstPassQuestion, type FirstPassView, firstPassView } from './view.ts';
import type { QueueProgress, QueueState } from './queue.ts';
import { firstPassStylesheet } from './styles.ts';
import type { FirstPassWords } from './words.ts';

/** The attribute a shell reads to know which answer a control stands for. */
export const ANSWER_ATTRIBUTE = 'data-ig-answer';
/** The attribute carrying an evidence item's machine-readable token. */
export const EVIDENCE_TOKEN_ATTRIBUTE = 'data-ig-evidence';
/** Answers given, on the root. */
export const ANSWERED_ATTRIBUTE = 'data-ig-answered';
/** Candidates found — the denominator, on the root. */
export const FOUND_ATTRIBUTE = 'data-ig-found';

export interface FirstPassOptions {
  /** The words. Required — see {@link ./words.ts FirstPassWords} for why. */
  readonly words: FirstPassWords;
  readonly theme?: Theme | undefined;
  /** The selector the theme's custom properties are written onto. */
  readonly themeSelector?: string | undefined;
}

export interface FirstPassResult {
  readonly view: FirstPassView;
  /** The question, its evidence, the answers and the progress, under one root. */
  readonly markup: string;
  /**
   * The theme and this surface's own stylesheet. Install both.
   *
   * The VIEWER's stylesheet is deliberately not among them, on the same
   * reasoning `picker/render.ts` records: this surface draws no viewer
   * elements, so shipping the canvas sheet with it would give a host that
   * installs the queue alone a stylesheet whose every selector matches nothing.
   */
  readonly styles: string;
}

/** The three answer controls, in §17e's order. */
const ANSWER_ORDER = Object.freeze(['apply', 'reject', 'skip'] as const);

/**
 * One evidence item.
 *
 * The text is the host's sentence, placed verbatim. The token rides beside it
 * as an attribute rather than in the text, which is what keeps the rendered
 * prose entirely the host's while leaving the item addressable.
 */
function evidenceSpec(item: { readonly token: string; readonly text: string }): ElementSpec {
  return element('li', { class: 'ig-firstpass-evidence-item', [EVIDENCE_TOKEN_ATTRIBUTE]: item.token }, [
    item.text,
  ]);
}

/**
 * The proposed relationship, drawn subject · kind · object.
 *
 * A DEFAULT WORD ORDER, bypassable exactly as the picker's statement is: the
 * view model carries the ordered pair and the kind and no order beyond that, so
 * a host whose language arranges it differently renders the model. The
 * stylesheet lays it out as a flex row, which is what makes that bypass a
 * restyle rather than a re-implementation.
 *
 * The kind is drawn as its FORMAT SPELLING (`blocked-by`), not as a phrase.
 * `PickerWords` words the kinds for the picker, and asking a host to word them
 * a second time here would be two vocabularies free to disagree about one
 * relationship — while reusing `PickerWords` would couple this surface to a
 * flow it is not part of. The spelling is the document's own token, so it is
 * the document's word rather than ours, and it is what the owner will see in
 * the issue body afterwards.
 */
function questionSpec(question: FirstPassQuestion, words: FirstPassWords): ElementSpec {
  return element('div', { class: 'ig-firstpass-question' }, [
    element('p', { class: 'ig-firstpass-statement', 'data-ig-kind': question.kind }, [
      element('span', { class: 'ig-firstpass-ref', 'data-ig-role': 'from' }, [question.subject]),
      element('span', { class: 'ig-firstpass-kind' }, [question.kind]),
      element('span', { class: 'ig-firstpass-ref', 'data-ig-role': 'to' }, [question.object]),
    ]),
    // NO EVIDENCE IS NO BLOCK, rather than an empty list with a heading. A host
    // whose detector cannot explain itself says so by sending none
    // (`candidates.ts`), and drawing a labelled empty container would turn that
    // into a rendering fault the owner has to interpret.
    question.evidence.length === 0
      ? null
      : element('div', { class: 'ig-firstpass-evidence' }, [
          element('p', { class: 'ig-firstpass-evidence-label' }, [words.evidence]),
          element(
            'ul',
            { class: 'ig-firstpass-evidence-list', 'aria-label': words.evidence },
            question.evidence.map(evidenceSpec),
          ),
        ]),
  ]);
}

/**
 * The answer controls.
 *
 * BUTTONS, and a keyboard-first surface still needs them: §17e's claim is that
 * the loop is reachable with no pointer, not that a pointer is refused. A
 * surface with keys and no controls would also be a surface with no discoverable
 * vocabulary and nothing for assistive technology to name.
 */
function answersSpec(words: FirstPassWords): ElementSpec {
  return element(
    'div',
    { class: 'ig-firstpass-answers', role: 'group', 'aria-label': words.answersLabel },
    ANSWER_ORDER.map((answer) =>
      element(
        'button',
        { type: 'button', class: 'ig-firstpass-answer', [ANSWER_ATTRIBUTE]: answer },
        [words.answers[answer]],
      ),
    ),
  );
}

/** The progress line. The host's sentence over this package's two numbers. */
function progressSpec(progress: QueueProgress, words: FirstPassWords): ElementSpec {
  return element('p', { class: 'ig-firstpass-progress' }, [
    words.progress(progress.answered, progress.found),
  ]);
}

/**
 * Draw the queue.
 *
 * Takes a {@link QueueState} — never a store and never a source. A host hands
 * the proposal a reduction produced to `Store.propose`, which is the only thing
 * in the family that dispatches.
 */
export function renderFirstPass(state: QueueState, options: FirstPassOptions): FirstPassResult {
  const view = firstPassView(state);
  const theme = resolveTheme(options.theme);
  const { words } = options;

  const body = ((): readonly (ElementSpec | null)[] => {
    switch (view.state) {
      case 'asking':
        return [
          questionSpec(view.question, words),
          answersSpec(words),
          element(
            'button',
            { type: 'button', class: 'ig-firstpass-undo', [ANSWER_ATTRIBUTE]: 'undo' },
            [words.undo],
          ),
        ];
      case 'finished':
        return [element('p', { class: 'ig-firstpass-finished' }, [words.finished])];
      case 'empty':
        // A DIFFERENT SENTENCE FROM `finished`, which is the whole reason the
        // view model separates them. See `view.ts`.
        return [element('p', { class: 'ig-firstpass-empty' }, [words.noCandidates])];
    }
  })();

  const root = element(
    'section',
    {
      class: 'ig-firstpass',
      'data-ig-state': view.state,
      [ANSWERED_ATTRIBUTE]: String(view.progress.answered),
      [FOUND_ATTRIBUTE]: String(view.progress.found),
    },
    [...body, progressSpec(view.progress, words)],
  );

  return {
    view,
    markup: renderMarkup(root),
    styles: `${themeCss(theme, options.themeSelector ?? ':root')}\n${firstPassStylesheet}`,
  };
}
