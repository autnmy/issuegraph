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
      // The key labels are the key table's letters, not words of this surface.
      answerKey('apply'),
      answerKey('reject'),
      answerKey('skip'),
      FIRST_PASS_WORDS.undo,
      FIRST_PASS_WORDS.evidence,
      FIRST_PASS_WORDS.answersLabel,
      FIRST_PASS_WORDS.progress(1, 2),
      'both bodies reference file 1',
      '200',
      '201',
      // The viewer's vocabulary label for the kind — the same words every badge
      // and legend on the surface use, so it is not a word of this surface's own.
      'is blocked by',
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

import { JSDOM } from 'jsdom';
import { answerKey } from './keys.ts';
import type { Answer } from './queue.ts';
import { firstPassIntent } from './keys.ts';

describe("more tests", function () {
it('a heading level outside 2 to 6 never becomes a tag name, and draws the no-option markup', () => {
  const state = openQueue(candidates(1));

  // A valid level must draw its heading, or a renderer that ignored `heading`
  // altogether would pass every comparison below.
  const named = new JSDOM(
    renderFirstPass(state, { words: FIRST_PASS_WORDS, heading: { level: 2 } }).markup,
  );
  try {
    assert.equal(named.window.document.querySelectorAll('section.ig-firstpass h2').length, 1);
  } finally {
    named.window.close();
  }

  // "Map the level to a fixed `h2` to `h6` tag literal, so no caller text ever becomes a tag name."
  // A host is typed but not trusted at runtime: a JavaScript caller or a value
  // read from configuration can hand over anything, and the result must be the
  // band with no heading rather than a tag built from that value.
  const plain = renderFirstPass(state, { words: FIRST_PASS_WORDS }).markup;
  const malformed = [
    7,
    1,
    0,
    '2',
    'h2',
    'script',
    '__proto__',
    'constructor',
    '2><script>alert(1)</script><h2',
    undefined,
  ];
  for (const level of malformed) {
    const options = { words: FIRST_PASS_WORDS };
    Reflect.set(options, 'heading', { level });
    const { markup } = renderFirstPass(state, options);
    assert.equal(markup, plain, String(level));
    assert.equal(markup.includes('<script'), false, String(level));
    assert.equal(/<h[1-6]\b/.test(markup), false, String(level));
  }

  const unset = { words: FIRST_PASS_WORDS, heading: undefined };
  assert.equal(renderFirstPass(state, unset).markup, plain);
});

it('a heading label holding markup is drawn as text in every state, never as elements', () => {
  // "Build every new text as a text child of `element()`, so it is escaped."
  // "A `words.label` holding markup renders as escaped text."
  // Checked in all three states, because the title row is drawn in each of them
  // and an unescaped label in any one lets host text inject elements.
  const finished = queueReducer(openQueue(candidates(1)), { kind: 'answer', answer: 'apply' }).state;
  const states = [
    ['asking', openQueue(candidates(2))],
    ['finished', finished],
    ['empty', openQueue([])],
  ] as const;
  for (const label of ['<img src=x>', '</h2><script>alert(1)</script>']) {
    for (const [name, state] of states) {
      const { markup } = renderFirstPass(state, {
        words: { ...FIRST_PASS_WORDS, label },
        heading: { level: 2 },
      });
      const dom = new JSDOM(markup);
      try {
        const { document } = dom.window;
        const heading = document.querySelector('section.ig-firstpass > .ig-firstpass-title > h2');
        assert.ok(heading !== null, `${name}: no heading in the title row`);
        assert.equal(heading.textContent, label, name);
        assert.equal(heading.childElementCount, 0, `${name}: the label became an element`);
        assert.equal(document.querySelectorAll('img, script').length, 0, `${name}: the label injected an element`);
        assert.equal(
          document.querySelector('section.ig-firstpass')?.getAttribute('aria-label'),
          label,
          `${name}: the region name was altered`,
        );
      } finally {
        dom.window.close();
      }
    }
  }
});

it('host answer words holding markup cannot add or replace a key label', () => {
  // "Each of the three answer buttons holds its words, then a `kbd` with that letter."
  // The letter tells the reader which key records a consent, so host text that
  // could forge a second `kbd`, or close the button and draw its own, would show
  // a key that answers something else. The letters are written here as literals
  // so the expectation does not come from the code under test.
  const answers = {
    apply: '<kbd>N</kbd>',
    reject: '<b>No</b>',
    skip: '</button><kbd>Q</kbd>',
  };
  const letters = { apply: 'Y', reject: 'N', skip: 'S' } as const;
  const { markup } = renderFirstPass(openQueue(candidates(1)), {
    words: { ...FIRST_PASS_WORDS, answers },
  });
  const dom = new JSDOM(markup);
  try {
    const { document } = dom.window;
    assert.equal(document.querySelectorAll('kbd').length, 3, 'host words added a key label');
    assert.equal(document.querySelectorAll('b').length, 0, 'host words became an element');
    for (const answer of ['apply', 'reject', 'skip'] as const) {
      const button = document.querySelector(`[data-ig-answer="${answer}"]`);
      assert.ok(button !== null, answer);
      const keys = button.querySelectorAll('kbd');
      assert.equal(keys.length, 1, answer);
      assert.equal(keys[0]?.textContent, letters[answer], answer);
      assert.equal(button.textContent?.trim(), `${answers[answer]} ${letters[answer]}`, answer);
    }
  } finally {
    dom.window.close();
  }
});
});

describe("more tests 2", function () {
it('first-pass heading: a queue answered to its end still draws the title row with the read-back count, and keeps undo', () => {
  // "With the option, the finished state and the no-candidates state also draw the title row."
  // "With the option, the existing finished-state undo control (`undoSpec`) is still drawn."
  let state = openQueue(candidates(2));
  state = queueReducer(state, { kind: 'answer', answer: 'apply' }).state;
  state = queueReducer(state, { kind: 'answer', answer: 'skip' }).state;
  const { markup } = renderFirstPass(state, { words: FIRST_PASS_WORDS, heading: { level: 2 } });
  const document = new JSDOM(markup).window.document;
  const section = document.querySelector('section.ig-firstpass');
  assert.ok(section !== null, 'no first-pass section was drawn');
  assert.equal(section.getAttribute('data-ig-state'), 'finished');

  const row = Array.from(section.children).find((child) => child.matches('div.ig-firstpass-title'));
  assert.ok(row !== undefined, 'the finished state drew no title row');
  assert.equal(section.firstElementChild, row, 'the title row is not drawn first');
  assert.equal(row.querySelector('h2')?.textContent, FIRST_PASS_WORDS.label);
  // The count is the answered state read back after both answers, not the opening one.
  assert.equal(row.querySelector('p.ig-firstpass-progress')?.textContent?.trim(), FIRST_PASS_WORDS.progress(2, 2));
  assert.equal(section.querySelectorAll('p.ig-firstpass-progress').length, 1, 'the count is drawn twice');
  assert.ok(section.querySelector('[data-ig-command="undo"]') !== null, 'the heading dropped the finished-state undo');
});

it('first-pass heading: drawing with a heading twice leaves the queue untouched and draws the same markup', () => {
  // The heading is presentation only: drawing it must not change the queue a
  // later answer reads, must not change the host's options, and must open no
  // channel for a proposal.
  const queue = queueReducer(openQueue(candidates(3)), { kind: 'answer', answer: 'skip' }).state;
  const before = structuredClone(queue);
  const options = { words: FIRST_PASS_WORDS, heading: { level: 3 as const } };
  const first = renderFirstPass(queue, options);
  const second = renderFirstPass(queue, options);
  assert.deepEqual(queue, before, 'drawing the heading changed the queue');
  assert.equal(options.heading.level, 3);
  assert.deepEqual(Object.keys(first).sort(), ['markup', 'styles', 'view']);
  assert.match(first.markup, /<h3\b/, 'level 3 drew no h3');
  assert.equal(second.markup, first.markup, 'a second draw of the same queue differed');
});
});

describe("more tests 3", function () {
it('heading level 2 draws the label as an h2 beside the progress, in one title row before the question', () => {
  const { markup } = renderFirstPass(openQueue(candidates(3)), {
    words: FIRST_PASS_WORDS,
    heading: { level: 2 },
  });
  const doc = new JSDOM(markup).window.document;
  const section = doc.querySelector('section.ig-firstpass');
  assert.ok(section !== null, 'no first-pass section was drawn');
  // Every element under the section, in document order.
  const order = [...section.querySelectorAll('*')];

  // "With heading level 2, `section.ig-firstpass` holds an `h2` with the `words.label` text and the progress `p` in one row element that comes before the question."
  const rows = [...section.children].filter((child) => child.classList.contains('ig-firstpass-title'));
  assert.equal(rows.length, 1, 'the section holds no single title row');
  const row = rows[0];
  assert.ok(row !== undefined && row.tagName === 'DIV', 'the title row is not a div');
  assert.equal(doc.querySelectorAll('h1, h2, h3, h4, h5, h6').length, 1, 'more than one heading was drawn');
  const heading = row.querySelector('h2');
  assert.ok(heading !== null, 'the title row holds no h2');
  assert.equal(heading.textContent, FIRST_PASS_WORDS.label);

  assert.equal(doc.querySelectorAll('p.ig-firstpass-progress').length, 1, 'the progress is not drawn exactly once');
  const progress = doc.querySelector('p.ig-firstpass-progress');
  assert.ok(progress !== null);
  assert.equal(progress.parentElement, row, 'the progress is not in the title row');
  assert.equal(progress.textContent, FIRST_PASS_WORDS.progress(0, 3));
  assert.ok(order.indexOf(heading) < order.indexOf(progress), 'the progress comes before the heading');

  const question = section.querySelector('.ig-firstpass-question');
  assert.ok(question !== null, 'no question was drawn');
  assert.ok(order.indexOf(row) < order.indexOf(question), 'the title row does not come before the question');
});

it('heading levels 2 to 6 each draw their own heading tag and no other', () => {
  // "With level 4, the heading is `h4`."
  for (const level of [2, 3, 4, 5, 6] as const) {
    const { markup } = renderFirstPass(openQueue(candidates(1)), { words: FIRST_PASS_WORDS, heading: { level } });
    const doc = new JSDOM(markup).window.document;
    const headings = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((element) => element.tagName);
    assert.deepEqual(headings, [`H${String(level)}`], `level ${String(level)}`);
  }
});

it('a heading level outside 2 to 6 draws exactly the markup of no heading option', () => {
  // "Map the level to a fixed `h2` to `h6` tag literal, so no caller text ever becomes a tag name."
  // A plain JavaScript host can pass any value, so a level that is not one of
  // the five falls back to the band with no heading instead of throwing or
  // building a tag from it.
  const state = openQueue(candidates(2));
  const plain = renderFirstPass(state, { words: FIRST_PASS_WORDS }).markup;
  assert.match(renderFirstPass(state, { words: FIRST_PASS_WORDS, heading: { level: 2 } }).markup, /<h2\b/);
  assert.equal(renderFirstPass(state, { words: FIRST_PASS_WORDS, heading: undefined }).markup, plain);
  // @ts-expect-error level 1 is not one of the five levels the option accepts
  assert.equal(renderFirstPass(state, { words: FIRST_PASS_WORDS, heading: { level: 1 } }).markup, plain);
  // @ts-expect-error level 7 is not one of the five levels the option accepts
  assert.equal(renderFirstPass(state, { words: FIRST_PASS_WORDS, heading: { level: 7 } }).markup, plain);
  // @ts-expect-error the level is a number, never text
  assert.equal(renderFirstPass(state, { words: FIRST_PASS_WORDS, heading: { level: '2' } }).markup, plain);

  for (const level of [0, 1, 7, 2.5, Number.NaN, '2', 'h2', 'script', '__proto__', 'constructor', 'toString', null, undefined]) {
    const heading = {};
    Reflect.set(heading, 'level', level);
    const options = { words: FIRST_PASS_WORDS };
    Reflect.set(options, 'heading', heading);
    assert.equal(renderFirstPass(state, options).markup, plain, `level ${String(level)}`);
  }
  for (const heading of [null, 2, 'h2', {}]) {
    const options = { words: FIRST_PASS_WORDS };
    Reflect.set(options, 'heading', heading);
    assert.equal(renderFirstPass(state, options).markup, plain, `heading ${JSON.stringify(heading)}`);
  }
});

it('the title row leads the band in every state with a heading, and without one the progress stays the last child', () => {
  const finished = queueReducer(openQueue(candidates(1)), { kind: 'answer', answer: 'apply' }).state;
  for (const [name, state] of [
    ['asking', openQueue(candidates(2))],
    ['finished', finished],
    ['empty', openQueue([])],
  ] as const) {
    // "With the option, the finished state and the no-candidates state also draw the title row."
    const titled = new JSDOM(renderFirstPass(state, { words: FIRST_PASS_WORDS, heading: { level: 3 } }).markup).window.document;
    const first = titled.querySelector('section.ig-firstpass')?.firstElementChild ?? null;
    assert.ok(first !== null && first.classList.contains('ig-firstpass-title'), `${name}: the title row is not the first child`);
    assert.equal(titled.querySelectorAll('.ig-firstpass-title').length, 1, `${name}: not exactly one title row`);
    assert.equal(first.querySelector('h3')?.textContent, FIRST_PASS_WORDS.label, `${name}: the title row holds no h3 with the label`);

    // "Without the option, today's output stays: no heading, and the progress is the last child."
    const plain = new JSDOM(renderFirstPass(state, { words: FIRST_PASS_WORDS }).markup).window.document;
    assert.equal(plain.querySelector('h1, h2, h3, h4, h5, h6'), null, `${name}: a heading with no option`);
    assert.equal(plain.querySelector('.ig-firstpass-title'), null, `${name}: a title row with no option`);
    const last = plain.querySelector('section.ig-firstpass')?.lastElementChild ?? null;
    assert.ok(last !== null && last.matches('p.ig-firstpass-progress'), `${name}: the progress is not the last child`);
  }
});

it('with a heading, the finished state keeps its undo and a found total of 0 keeps the title but hides the count', () => {
  const finished = queueReducer(openQueue(candidates(1)), { kind: 'answer', answer: 'apply' }).state;
  const done = new JSDOM(renderFirstPass(finished, { words: FIRST_PASS_WORDS, heading: { level: 2 } }).markup).window.document;
  // "With the option, the existing finished-state undo control (`undoSpec`) is still drawn."
  assert.equal(done.querySelectorAll('[data-ig-command="undo"]').length, 1, 'the finished state lost its undo');
  const doneRow = done.querySelector('.ig-firstpass-title');
  assert.ok(doneRow !== null, 'the finished state drew no title row');
  assert.equal(doneRow.querySelector('h2')?.textContent, FIRST_PASS_WORDS.label);
  assert.equal(done.querySelectorAll('p.ig-firstpass-progress').length, 1, 'the count is not drawn exactly once');
  assert.equal(doneRow.querySelector('p.ig-firstpass-progress')?.textContent, FIRST_PASS_WORDS.progress(1, 1));
  assert.ok((done.body.textContent ?? '').includes(FIRST_PASS_WORDS.finished));

  const empty = new JSDOM(renderFirstPass(openQueue([]), { words: FIRST_PASS_WORDS, heading: { level: 2 } }).markup).window.document;
  // "So with the option and a found total of 0, the title row holds the heading and no progress element."
  const emptyRow = empty.querySelector('.ig-firstpass-title');
  assert.ok(emptyRow !== null, 'the no-candidates state drew no title row');
  assert.equal(emptyRow.querySelector('h2')?.textContent, FIRST_PASS_WORDS.label);
  assert.equal(empty.querySelector('.ig-firstpass-progress'), null, 'the count is drawn when nothing was found');
  assert.equal((empty.body.textContent ?? '').includes(FIRST_PASS_WORDS.progress(0, 0)), false);
  assert.ok((empty.body.textContent ?? '').includes(FIRST_PASS_WORDS.noCandidates));
});

it('a label holding markup is drawn in the heading as escaped text', () => {
  const label = '<img src=x>';
  const { markup } = renderFirstPass(openQueue(candidates(1)), {
    words: { ...FIRST_PASS_WORDS, label },
    heading: { level: 2 },
  });
  const doc = new JSDOM(markup).window.document;
  // "A `words.label` holding markup renders as escaped text."
  const heading = doc.querySelector('h2');
  assert.ok(heading !== null, 'no heading was drawn');
  assert.equal(heading.textContent, label);
  assert.equal(heading.children.length, 0, 'the label became markup inside the heading');
  assert.equal(doc.querySelector('img'), null, 'the label became an element');
});

it('rendering with a frozen heading option leaves the queue and the option as they were', () => {
  const state = openQueue(candidates(2));
  const before = structuredClone(state);
  // Frozen at both depths, so a renderer that writes to the option throws in
  // this strict-mode module instead of passing quietly.
  const options = Object.freeze({ words: FIRST_PASS_WORDS, heading: Object.freeze({ level: 2 as const }) });
  const first = renderFirstPass(state, options).markup;
  const second = renderFirstPass(state, options).markup;
  assert.match(first, /<h2\b/);
  assert.equal(second, first, 'a second render of the same input drew different markup');
  assert.deepEqual(state, before);
  assert.deepEqual(options.heading, { level: 2 });
});

it('each answer button is its words, a space, then one kbd holding answerKey of its answer, with or without a heading', () => {
  // A record keyed by every answer, so a fourth answer is a compile error here.
  const answers: Record<Answer, Answer> = { apply: 'apply', reject: 'reject', skip: 'skip' };
  // "The key labels are not behind an option."
  for (const options of [{ words: FIRST_PASS_WORDS }, { words: FIRST_PASS_WORDS, heading: { level: 2 } }] as const) {
    const doc = new JSDOM(renderFirstPass(openQueue(candidates(2)), options).markup).window.document;
    assert.equal(doc.querySelectorAll('[data-ig-answer]').length, 3);
    for (const answer of Object.values(answers)) {
      const buttons = doc.querySelectorAll(`[data-ig-answer="${answer}"]`);
      assert.equal(buttons.length, 1, answer);
      const button = buttons[0];
      assert.ok(button !== undefined);
      // "Each of the three answer buttons holds exactly one `kbd` whose text equals `answerKey` of that button's `data-ig-answer`."
      const keys = button.querySelectorAll('kbd');
      assert.equal(keys.length, 1, `${answer}: not exactly one key label`);
      assert.equal(keys[0]?.textContent, answerKey(answer));
      // "Each of the three answer buttons holds its words, then a `kbd` with that letter."
      assert.equal(button.lastChild, keys[0], `${answer}: the key label does not come after the words`);
      // The space keeps the words and the letter apart in the button's name, so "YesY" fails.
      assert.equal((button.textContent ?? '').trim(), `${FIRST_PASS_WORDS.answers[answer]} ${answerKey(answer)}`);
    }
  }
});

it('the undo control holds no key label, one answer in and when finished', () => {
  const oneIn = queueReducer(openQueue(candidates(2)), { kind: 'answer', answer: 'skip' }).state;
  const finished = queueReducer(openQueue(candidates(1)), { kind: 'answer', answer: 'apply' }).state;
  for (const [name, state] of [
    ['one answered', oneIn],
    ['finished', finished],
  ] as const) {
    const doc = new JSDOM(renderFirstPass(state, { words: FIRST_PASS_WORDS }).markup).window.document;
    const undo = doc.querySelector('[data-ig-command="undo"]');
    assert.ok(undo !== null, `${name}: no undo control`);
    // "The undo button gets no `kbd`."
    assert.equal(undo.querySelector('kbd'), null, `${name}: the undo control holds a key label`);
    assert.equal((undo.textContent ?? '').trim(), FIRST_PASS_WORDS.undo, name);
  }
  // The three answer buttons beside that undo do carry their labels.
  const beside = new JSDOM(renderFirstPass(oneIn, { words: FIRST_PASS_WORDS }).markup).window.document;
  assert.equal(beside.querySelectorAll('kbd').length, 3);
});

it('writes no word of its own with a heading and key labels drawn', () => {
  // "Words come only from the export, `content.md`, `voice.md` and `messaging.md`."
  // One answer in, so the undo control is drawn and its word is under test too.
  const state = queueReducer(openQueue(candidates(2)), { kind: 'answer', answer: 'skip' }).state;
  const { markup } = renderFirstPass(state, { words: FIRST_PASS_WORDS, heading: { level: 2 } });
  const texts = [...markup.matchAll(/>([^<>]+)</g)]
    .map((match) => (match[1] ?? '').trim())
    .filter((text) => text !== '');
  const keys = [answerKey('apply'), answerKey('reject'), answerKey('skip')];
  const allowed = new Set<string>([
    ...Object.values(FIRST_PASS_WORDS.answers),
    ...keys,
    FIRST_PASS_WORDS.label,
    FIRST_PASS_WORDS.undo,
    FIRST_PASS_WORDS.evidence,
    FIRST_PASS_WORDS.answersLabel,
    FIRST_PASS_WORDS.progress(1, 2),
    'both bodies reference file 1',
    '200',
    '201',
    // The viewer's own label for the relationship kind.
    'is blocked by',
  ]);
  assert.deepEqual(
    texts.filter((text) => !allowed.has(text)),
    [],
  );
  for (const expected of [FIRST_PASS_WORDS.label, ...keys]) {
    assert.ok(texts.includes(expected), `${expected} was not drawn`);
  }
});

it('the evidence list is drawn after the title row and keeps its token-drawn left rule, with or without a heading', () => {
  // "The evidence list keeps its left rule."
  const state = openQueue(candidates(1));
  const plain = renderFirstPass(state, { words: FIRST_PASS_WORDS });
  const titled = renderFirstPass(state, { words: FIRST_PASS_WORDS, heading: { level: 2 } });
  const evidenceClass = /class="[^"]*\big-firstpass-evidence\b/;
  const titleClass = /class="[^"]*\big-firstpass-title\b/;

  assert.match(plain.markup, evidenceClass, 'no evidence list without a heading');
  const titleAt = titled.markup.search(titleClass);
  const evidenceAt = titled.markup.search(evidenceClass);
  assert.ok(titleAt >= 0, 'no title row with a heading');
  assert.ok(evidenceAt > titleAt, 'the evidence list is missing or drawn before the title row');

  for (const { styles } of [plain, titled]) {
    const css = styles.replace(/\/\*[\s\S]*?\*\//g, '');
    const evidenceRules = [...css.matchAll(/\.ig-firstpass-evidence[^{]*\{([^}]*)\}/g)]
      .map((match) => match[1] ?? '')
      .join('\n');
    const leftRules = [
      ...evidenceRules.matchAll(/border-(?:left|inline-start)(?:-[a-z]+)?\s*:\s*([^;]+)/g),
    ].map((match) => match[1] ?? '');
    assert.ok(leftRules.length > 0, 'the evidence list has no left rule');
    assert.ok(
      leftRules.some((value) => value.includes('var(--ig-')),
      'the left rule is not drawn from an --ig-* token',
    );
  }
});
});

describe("more tests 4", function () {
it('draws exactly the no-heading band when a host passes a heading level outside 2 to 6', () => {
  // "Map the level to a fixed `h2` to `h6` tag literal, so no caller text ever becomes a tag name."
  // A JavaScript host is not held to the type, so each level below can arrive at run time.
  const state = openQueue(candidates(2));
  const bare = renderFirstPass(state, { words: FIRST_PASS_WORDS }).markup;
  const titled = renderFirstPass(state, { words: FIRST_PASS_WORDS, heading: { level: 2 } }).markup;
  assert.match(titled, /<h2\b/, 'level 2 drew no heading, so the comparisons below would prove nothing');
  for (const level of [1, 7, 0, 2.5, '2', 'h2', 'script', '__proto__', 'constructor', 'toString', null, undefined]) {
    const heading = { level: 2 as const };
    Reflect.set(heading, 'level', level);
    const { markup } = renderFirstPass(state, { words: FIRST_PASS_WORDS, heading });
    assert.equal(markup, bare, `level ${String(level)} changed the band`);
  }
});

it('draws the count once, inside the title row, and keeps undo after the last answer', () => {
  const answeredOnce = queueReducer(openQueue(candidates(2)), { kind: 'answer', answer: 'skip' }).state;
  const finished = queueReducer(openQueue(candidates(1)), { kind: 'answer', answer: 'apply' }).state;
  for (const [name, state] of [
    ['asking', answeredOnce],
    ['finished', finished],
  ] as const) {
    const { markup } = renderFirstPass(state, { words: FIRST_PASS_WORDS, heading: { level: 2 } });
    const section = new JSDOM(markup).window.document.querySelector('section.ig-firstpass');
    assert.ok(section !== null, name);
    // "With the option, draw `words.label` as the heading text, with `p.ig-firstpass-progress` beside it in one row, before the question."
    // A title row added while the old trailing count is still appended draws the count twice.
    const counts = section.querySelectorAll('p.ig-firstpass-progress');
    assert.equal(counts.length, 1, `${name}: the count is drawn ${String(counts.length)} times`);
    const row = section.firstElementChild;
    assert.ok(row !== null && row.matches('div.ig-firstpass-title'), `${name}: the title row is not the first child`);
    assert.equal(counts[0]?.parentElement, row, `${name}: the count sits outside the title row`);
    assert.equal(row.querySelector('h2')?.textContent, FIRST_PASS_WORDS.label, name);
    // "With the option, the existing finished-state undo control (`undoSpec`) is still drawn."
    assert.ok(section.querySelector('[data-ig-command="undo"]') !== null, `${name}: undo was dropped`);
  }
});

it('hides the count and keeps the title when nothing was found', () => {
  const { markup } = renderFirstPass(openQueue([]), { words: FIRST_PASS_WORDS, heading: { level: 3 } });
  const parsed = new JSDOM(markup).window.document;
  // "So with the option and a found total of 0, the title row holds the heading and no progress element."
  const row = parsed.querySelector('section.ig-firstpass > div.ig-firstpass-title');
  assert.ok(row !== null, 'the empty state drew no title row');
  assert.equal(row.querySelector('h3')?.textContent, FIRST_PASS_WORDS.label);
  assert.equal(parsed.querySelectorAll('.ig-firstpass-progress').length, 0, 'a count was drawn when nothing was found');
  assert.equal(markup.includes(FIRST_PASS_WORDS.progress(0, 0)), false, 'the 0 of 0 sentence was drawn');
  assert.ok(markup.includes(FIRST_PASS_WORDS.noCandidates), 'the empty state lost its own sentence');
});

it('draws a label holding markup as text, in the heading and in the region name', () => {
  // "Build every new text as a text child of `element()`, so it is escaped."
  const label = '</h2><img src=x onerror="alert(1)"><h1>';
  const { markup } = renderFirstPass(openQueue(candidates(1)), {
    words: { ...FIRST_PASS_WORDS, label },
    heading: { level: 2 },
  });
  const parsed = new JSDOM(markup).window.document;
  const heading = parsed.querySelector('.ig-firstpass-title h2');
  assert.equal(heading?.textContent, label, 'the heading does not read as the label');
  assert.equal(heading?.childElementCount, 0, 'the label became elements inside the heading');
  assert.equal(parsed.querySelector('img'), null, 'the label drew an image');
  assert.equal(parsed.querySelector('h1'), null, 'the label drew a heading of its own');
  assert.equal(parsed.querySelector('section.ig-firstpass')?.getAttribute('aria-label'), label);
});

it('puts on each answer button the letter that answers that button, and none on undo', () => {
  // One answer in, so the undo control is drawn beside the three answers.
  const answeredOnce = queueReducer(openQueue(candidates(2)), { kind: 'answer', answer: 'skip' }).state;
  const parsed = new JSDOM(renderFirstPass(answeredOnce, { words: FIRST_PASS_WORDS }).markup).window.document;
  const words = new Map<string, string>(Object.entries(FIRST_PASS_WORDS.answers));
  const buttons = [...parsed.querySelectorAll('[data-ig-answer]')];
  assert.equal(buttons.length, 3);
  for (const button of buttons) {
    const answer = button.getAttribute('data-ig-answer') ?? '';
    // "Each of the three answer buttons holds its words, then a `kbd` with that letter. The undo button gets no `kbd`."
    const labels = button.querySelectorAll('kbd');
    assert.equal(labels.length, 1, `${answer}: ${String(labels.length)} key labels`);
    const letter = labels[0]?.textContent ?? '';
    assert.match(letter, /^\S$/u, `${answer}: the key label ${JSON.stringify(letter)} is not one visible character`);
    assert.equal(letter, letter.toUpperCase(), `${answer}: the key label is not a capital`);
    assert.deepEqual(
      firstPassIntent({ key: letter }, { interaction: 'queue', hasCandidate: true, canUndo: false }),
      { kind: 'queue', command: { kind: 'answer', answer } },
      `${answer}: its key label answers a different button`,
    );
    // "The `kbd` stays in each button's accessible name: "Yes, add it Y", "No N", "Skip for now S"."
    assert.equal(
      button.textContent?.trim(),
      `${words.get(answer) ?? ''} ${letter}`,
      `${answer}: the name runs the words into the letter`,
    );
  }
  const undo = parsed.querySelector('[data-ig-command="undo"]');
  assert.ok(undo !== null, 'no undo control after one answer');
  assert.equal(undo.querySelector('kbd'), null, 'the undo button carries a key label');
});
});
