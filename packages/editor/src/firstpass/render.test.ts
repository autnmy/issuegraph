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
    for (const answer of ['apply', 'reject', 'skip', 'undo']) {
      assert.match(markup, new RegExp(`data-ig-answer="${answer}"`), answer);
    }
    assert.equal(/\bon[a-z]+=/.test(markup), false, 'an inline handler');
  });
});

describe('every readable byte comes from the host or from the document', () => {
  it('writes no word of its own', () => {
    // A total claim rather than a spot check: every text node must be a
    // FirstPassWords entry, an issue reference, or the document's own kind
    // spelling. A word added later fails rather than slipping in.
    const { markup } = renderFirstPass(openQueue(candidates(2)), OPTIONS);
    const texts = [...markup.matchAll(/>([^<>]+)</g)]
      .map((match) => (match[1] ?? '').trim())
      .filter((text) => text !== '');
    const allowed = new Set<string>([
      ...Object.values(FIRST_PASS_WORDS.answers),
      FIRST_PASS_WORDS.undo,
      FIRST_PASS_WORDS.evidence,
      FIRST_PASS_WORDS.answersLabel,
      FIRST_PASS_WORDS.progress(0, 2),
      'both bodies reference file 0',
      '100',
      '101',
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

describe('it claims no heading level', () => {
  it('names itself without one', () => {
    // A heading would be a claim about the HOST's document outline, which a
    // package rendered into an unknown page cannot make.
    const { markup } = renderFirstPass(openQueue(candidates(1)), OPTIONS);
    assert.equal(/<h[1-6]\b/.test(markup), false);
  });
});
