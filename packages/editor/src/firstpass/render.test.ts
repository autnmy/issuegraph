import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FIRST_PASS_WORDS, candidates } from '../testing/firstpass.ts';
import { openQueue, queueReducer } from './queue.ts';
import { renderFirstPass } from './render.ts';

const OPTIONS = { words: FIRST_PASS_WORDS };

describe('rendering a candidate answers nothing', () => {
  it('returns no proposal, because there is no channel for one', () => {
    // The property §17e turns on: "it always costs one keystroke of consent."
    // Drawing the question is not answering it, and the result type is what
    // makes that structural rather than promised.
    const result = renderFirstPass(openQueue(candidates(3)), OPTIONS);
    assert.equal('proposal' in result, false);
    assert.deepEqual(Object.keys(result).sort(), ['markup', 'styles', 'view']);
  });

  it('leaves the queue exactly as it found it', () => {
    const queue = openQueue(candidates(3));
    const before = structuredClone(queue);
    renderFirstPass(queue, OPTIONS);
    renderFirstPass(queue, OPTIONS);
    assert.deepEqual(queue, before);
  });

  it('publishes the answers as commands and wires nothing', () => {
    // Listener wiring and dispatch belong to the mount, exactly as the picker
    // and the ladder defer them.
    const { markup } = renderFirstPass(openQueue(candidates(1)), OPTIONS);
    for (const answer of ['apply', 'reject', 'skip']) {
      assert.match(markup, new RegExp(`data-ig-answer="${answer}"`), answer);
    }
    assert.equal(/\bon[a-z]+=/.test(markup), false, 'an inline handler');
  });

  it('publishes undo as a COMMAND, never as a fourth answer', () => {
    // `Answer` is a closed union of three. A shell reading `data-ig-answer` and
    // switching over it must never be handed a value outside that type.
    const answered = queueReducer(openQueue(candidates(2)), {
      kind: 'answer',
      answer: 'skip',
    }).state;
    const { markup } = renderFirstPass(answered, OPTIONS);
    assert.match(markup, /data-ig-command="undo"/);
    assert.equal(markup.includes('data-ig-answer="undo"'), false);
  });
});

describe('every readable byte comes from the host or from the document', () => {
  it('writes no word of its own', () => {
    // A total claim rather than a spot check: every text node must be a
    // FirstPassWords entry, an issue reference, or the document's own kind
    // spelling. A word added later fails rather than slipping in.
    // Driven one answer in, so the undo control is present and its word is
    // genuinely under test rather than absent and trivially allowed.
    const state = queueReducer(openQueue(candidates(2)), {
      kind: 'answer',
      answer: 'skip',
    }).state;
    const { markup } = renderFirstPass(state, OPTIONS);
    const texts = [...markup.matchAll(/>([^<>]+)</g)]
      .map((match) => (match[1] ?? '').trim())
      .filter((text) => text !== '');
    const allowed = new Set<string>([
      ...Object.values(FIRST_PASS_WORDS.answers),
      FIRST_PASS_WORDS.undo,
      FIRST_PASS_WORDS.evidence,
      FIRST_PASS_WORDS.answersLabel,
      FIRST_PASS_WORDS.progress(1, 2),
      'both bodies reference file 1',
      '200',
      '201',
      'blocked-by',
    ]);
    assert.deepEqual(
      texts.filter((text) => !allowed.has(text)),
      [],
    );
  });

  it("places the host's evidence sentence verbatim", () => {
    const { markup } = renderFirstPass(openQueue(candidates(1)), OPTIONS);
    assert.match(markup, /both bodies reference file 0/);
    assert.match(markup, /data-ig-evidence="shared-path"/);
  });

  it('draws no evidence block when the host offered none', () => {
    // A labelled empty container would turn "my detector cannot explain itself"
    // into a rendering fault the owner has to interpret.
    const bare = candidates(1).map((candidate) => ({ ...candidate, evidence: [] }));
    const { markup } = renderFirstPass(openQueue(bare), OPTIONS);
    assert.equal(markup.includes('ig-firstpass-evidence'), false);
    // The evidence WORD goes with the block, so its absence is the whole point;
    // the answer group keeps its own label, which is why they are separate words.
    assert.equal(markup.includes(FIRST_PASS_WORDS.evidence), false);
    assert.equal(markup.includes(FIRST_PASS_WORDS.answersLabel), true);
  });
});

describe('progress is published as counts, never as a bar', () => {
  it('carries both numbers as attributes on the root', () => {
    const answered = queueReducer(openQueue(candidates(5)), {
      kind: 'answer',
      answer: 'apply',
    }).state;
    const { markup } = renderFirstPass(answered, OPTIONS);
    assert.match(markup, /data-ig-answered="1"/);
    assert.match(markup, /data-ig-found="5"/);
  });

  it('renders no <progress> element and no fill', () => {
    // §17e: "100% encoded is never the goal and the workspace never implies it
    // is." A bar implies a target by its geometry whatever the words say.
    const { markup } = renderFirstPass(openQueue(candidates(5)), OPTIONS);
    assert.equal(/<progress/.test(markup), false);
    assert.equal(/role="progressbar"/.test(markup), false);
  });

  it("words the count with the host's own sentence", () => {
    const { markup } = renderFirstPass(openQueue(candidates(64)), OPTIONS);
    assert.match(markup, /0 of 64/);
  });
});

describe('the three states read differently', () => {
  it('says the queue is complete when it is', () => {
    let state = openQueue(candidates(1));
    state = queueReducer(state, { kind: 'answer', answer: 'apply' }).state;
    const { markup } = renderFirstPass(state, OPTIONS);
    assert.match(markup, /data-ig-state="finished"/);
    assert.match(markup, new RegExp(FIRST_PASS_WORDS.finished));
    assert.equal(markup.includes('data-ig-answer='), false, 'nothing left to answer');
  });

  it('KEEPS UNDO after the last answer, which is the one most worth taking back', () => {
    // An accidental `Y` on the final candidate creates the duplicate-of §17e
    // says silently removes real work from the order — and the queue then has
    // no candidate left to show. Dropping the control at that exact moment left
    // a reader without a keyboard no way back from the answer that matters most.
    let state = openQueue(candidates(1));
    state = queueReducer(state, { kind: 'answer', answer: 'apply' }).state;
    const { markup } = renderFirstPass(state, OPTIONS);
    assert.match(markup, /data-ig-command="undo"/);
  });

  it('draws no undo before anything has been answered', () => {
    // The other edge of the same rule. `keys.ts` returns `none` for undo with an
    // empty history, so a control drawn here would be inert — and an affordance
    // that is sometimes inert teaches a reader answering at speed to distrust it.
    const { markup } = renderFirstPass(openQueue(candidates(3)), OPTIONS);
    assert.equal(markup.includes('data-ig-command="undo"'), false);
    assert.equal(markup.includes(FIRST_PASS_WORDS.undo), false);
  });

  it('draws no undo on an empty queue, because nothing can have been answered', () => {
    const { markup } = renderFirstPass(openQueue([]), OPTIONS);
    assert.equal(markup.includes('data-ig-command="undo"'), false);
  });

  it('says nothing was found when nothing was', () => {
    const { markup } = renderFirstPass(openQueue([]), OPTIONS);
    assert.match(markup, /data-ig-state="empty"/);
    assert.match(markup, new RegExp(FIRST_PASS_WORDS.noCandidates));
    assert.equal(markup.includes(FIRST_PASS_WORDS.finished), false, 'a different finding');
  });
});

describe('it ships the theme and its own sheet', () => {
  it('carries both, and not the viewer canvas sheet', () => {
    // This surface draws no viewer elements, so shipping the canvas stylesheet
    // would give a host that installs the queue alone a sheet whose every
    // selector matches nothing.
    const { styles } = renderFirstPass(openQueue(candidates(1)), OPTIONS);
    assert.match(styles, /--ig-space/);
    assert.match(styles, /\.ig-firstpass\b/);
    assert.equal(styles.includes('.ig-station'), false);
  });
});

describe('it claims no heading level, and is still findable', () => {
  it('draws no heading', () => {
    // A heading would be a claim about the HOST's document outline, which a
    // package rendered into an unknown page cannot make.
    const { markup } = renderFirstPass(openQueue(candidates(1)), OPTIONS);
    assert.equal(/<h[1-6]\b/.test(markup), false);
  });

  it('names the region anyway, in EVERY state', () => {
    // Refusing the heading without supplying a name left the root section
    // exposed to a landmark reader as an unnamed generic region. Asserted over
    // all three states, because the root is drawn by one code path and a future
    // per-state root would have to break this to exist.
    let answered = openQueue(candidates(1));
    answered = queueReducer(answered, { kind: 'answer', answer: 'skip' }).state;
    for (const [name, state] of [
      ['asking', openQueue(candidates(2))],
      ['finished', answered],
      ['empty', openQueue([])],
    ] as const) {
      const { markup } = renderFirstPass(state, OPTIONS);
      assert.match(markup, new RegExp(`<section[^>]*aria-label="${FIRST_PASS_WORDS.label}"`), name);
    }
  });

  it('takes the name from the host rather than writing one', () => {
    const { markup } = renderFirstPass(openQueue(candidates(1)), {
      words: { ...FIRST_PASS_WORDS, label: 'Erstdurchgang' },
    });
    assert.match(markup, /aria-label="Erstdurchgang"/);
    assert.equal(markup.includes(FIRST_PASS_WORDS.label), false);
  });
});
