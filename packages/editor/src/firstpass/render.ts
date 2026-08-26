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
 * HOST's document outline — whether this surface is a section of something, and
 * at what depth — which a package rendered into an unknown page cannot make.
 *
 * That refusal used to be the whole of it, and it left the root `<section>`
 * with no accessible name at all: a screen-reader user navigating by landmarks
 * met an unnamed generic region and could not tell it from any other. The
 * refusal was right and the silence that followed it was not, so the region now
 * carries an `aria-label` from {@link ./words.ts FirstPassWords} — which names
 * the surface without asserting anything about where it sits in an outline. A
 * host that wants it in the outline still wraps it in a heading of its own
 * choosing.
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
/**
 * The attribute on the undo control.
 *
 * ITS OWN ATTRIBUTE, not `data-ig-answer="undo"`. {@link ./queue.ts Answer} is
 * a closed union of three, and undo is not one of them — so a shell reading
 * `data-ig-answer` and switching over `Answer` would be handed a value outside
 * the type it was told to expect. `data-ig-command` is the spelling
 * `picker/render.ts` already uses for a control that is not a choice.
 */
export const COMMAND_ATTRIBUTE = 'data-ig-command';
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

/**
 * The undo control, drawn whenever there is an answer to withdraw.
 *
 * ## It survives the finished state, and that is the point of the rule
 *
 * The last answer is the one most in need of taking back — an accidental `Y` on
 * the final candidate creates the `duplicate-of` §17e says "silently removes
 * real work from the order", and the queue then has no candidate left to show.
 * An earlier revision replaced every control with the finished message at that
 * exact moment, so a reader without a keyboard had no way back from the one
 * answer that matters most.
 *
 * ## One rule, so the pointer and the keyboard cannot disagree
 *
 * `keys.ts` gates undo on `canUndo` — anything answered — and deliberately
 * keeps it live once `hasCandidate` is false. Drawing the control on the same
 * condition is what makes the two paths the same path. The previous version
 * disagreed at BOTH edges, in opposite directions: it drew a dead control
 * before anything was answered, and dropped a live one after the last answer.
 *
 * A control that does nothing is worse than no control, which is why this
 * returns `null` rather than a disabled button: the queue is answered at speed,
 * and an affordance that is sometimes inert teaches the reader to distrust it.
 */
function undoSpec(progress: QueueProgress, words: FirstPassWords): ElementSpec | null {
  if (progress.answered === 0) return null;
  return element(
    'button',
    { type: 'button', class: 'ig-firstpass-undo', [COMMAND_ATTRIBUTE]: 'undo' },
    [words.undo],
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
        return [questionSpec(view.question, words), answersSpec(words), undoSpec(view.progress, words)];
      case 'finished':
        // UNDO OUTLIVES THE QUESTIONS. `finished` always carries at least one
        // answer — a queue that found nothing is `empty` instead — so the
        // control is always drawn here, which is exactly the case that needs it.
        return [
          element('p', { class: 'ig-firstpass-finished' }, [words.finished]),
          undoSpec(view.progress, words),
        ];
      case 'empty':
        // A DIFFERENT SENTENCE FROM `finished`, which is the whole reason the
        // view model separates them. See `view.ts`.
        //
        // NO UNDO, and it needs no test to be sure of it: `empty` means the host
        // found nothing, and nothing found is nothing that can have been
        // answered — so `undoSpec` would return `null` here anyway.
        return [element('p', { class: 'ig-firstpass-empty' }, [words.noCandidates])];
    }
  })();

  const root = element(
    'section',
    {
      class: 'ig-firstpass',
      // NAMED WITHOUT CLAIMING AN OUTLINE POSITION. The heading refusal above
      // is unchanged — a heading LEVEL is a claim about the host's document
      // structure — but an unnamed `<section>` is a landmark a screen-reader
      // user cannot identify, so the region carries the host's own name here.
      'aria-label': words.label,
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
