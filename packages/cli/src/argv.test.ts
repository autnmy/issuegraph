import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { VERBS, VERB_NAMES, helpText, parseArgv } from './argv.ts';
import { RENDER_ONLY, SPLICE_CLEARABLE, SPLICE_WRITABLE } from './fields.ts';

describe('parseArgv', () => {
  test('no arguments asks for help rather than guessing a verb', () => {
    assert.equal(parseArgv([]).kind, 'help');
  });

  test('--help and -h ask for help, before and after a verb', () => {
    for (const argv of [['--help'], ['-h'], ['parse', '--help'], ['set', '-h']]) {
      assert.equal(parseArgv(argv).kind, 'help', argv.join(' '));
    }
  });

  test('--version and -V ask for the version', () => {
    assert.equal(parseArgv(['--version']).kind, 'version');
    assert.equal(parseArgv(['-V']).kind, 'version');
  });

  test('an unknown verb is a usage error naming every known verb', () => {
    const parsed = parseArgv(['nope']);
    assert.equal(parsed.kind, 'usage-error');
    assert.ok(parsed.kind === 'usage-error');
    for (const name of VERB_NAMES) assert.ok(parsed.message.includes(name), `missing ${name}`);
  });

  test('a known option on the wrong verb is a usage error', () => {
    // `--edges` belongs to splice; parse must not silently accept it.
    const parsed = parseArgv(['parse', '--edges', '{}']);
    assert.equal(parsed.kind, 'usage-error');
    assert.ok(parsed.kind === 'usage-error');
    assert.ok(parsed.message.includes('--edges'), parsed.message);
  });

  test('a document option on a body verb is a usage error, and the reverse', () => {
    assert.equal(parseArgv(['parse', '--input', 'f']).kind, 'usage-error');
    assert.equal(parseArgv(['order', '--body-file', 'f']).kind, 'usage-error');
  });

  test('an unknown option is a usage error listing what the verb allows', () => {
    const parsed = parseArgv(['parse', '--nope']);
    assert.ok(parsed.kind === 'usage-error');
    assert.ok(parsed.message.includes('--body-file'), parsed.message);
  });

  test('a positional argument is refused — input arrives on stdin or a file option', () => {
    const parsed = parseArgv(['parse', 'body.md']);
    assert.ok(parsed.kind === 'usage-error');
    assert.ok(parsed.message.includes('body.md'), parsed.message);
  });

  test('--name value and --name=value are the same thing', () => {
    for (const argv of [
      ['parse', '--body-file', 'x.md'],
      ['parse', '--body-file=x.md'],
    ]) {
      const parsed = parseArgv(argv);
      assert.ok(parsed.kind === 'verb');
      assert.deepEqual(parsed.options.get('--body-file'), ['x.md']);
    }
  });

  test('--name=value is what makes a value beginning with - expressible', () => {
    const parsed = parseArgv(['parse', '--body-file=-weird.md']);
    assert.ok(parsed.kind === 'verb');
    assert.deepEqual(parsed.options.get('--body-file'), ['-weird.md']);
  });

  test('a value-taking option with no value is a usage error', () => {
    const parsed = parseArgv(['parse', '--body-file']);
    assert.ok(parsed.kind === 'usage-error');
    assert.ok(parsed.message.includes('needs a value'), parsed.message);
  });

  test('a space-separated value that looks like an option is refused, not swallowed', () => {
    // Without this, `--blocked-by` eats `--evidence` and the error names neither.
    const parsed = parseArgv(['set', '--blocked-by', '--evidence', 'verified']);
    assert.ok(parsed.kind === 'usage-error');
    assert.ok(parsed.message.includes('--blocked-by'), parsed.message);
    assert.ok(parsed.message.includes('--evidence'), parsed.message);
    assert.ok(parsed.message.includes('=<value>'), parsed.message);
  });

  test('the = form still expresses a value that legitimately begins with --', () => {
    const parsed = parseArgv(['parse', '--body-file=--odd-name.md']);
    assert.ok(parsed.kind === 'verb');
    assert.deepEqual(parsed.options.get('--body-file'), ['--odd-name.md']);
  });

  test('a zero-arity option given a value is a usage error', () => {
    const parsed = parseArgv(['set', '--no-blocked-by=yes']);
    assert.ok(parsed.kind === 'usage-error');
    assert.ok(parsed.message.includes('takes no value'), parsed.message);
  });

  test('a repeatable option accumulates; a non-repeatable one is refused twice', () => {
    const repeated = parseArgv(['set', '--blocked-by', '1', '--blocked-by', '2']);
    assert.ok(repeated.kind === 'verb');
    assert.deepEqual(repeated.options.get('--blocked-by'), ['1', '2']);

    const twice = parseArgv(['parse', '--body-file', 'a', '--body-file', 'b']);
    assert.ok(twice.kind === 'usage-error');
    assert.ok(twice.message.includes('more than once'), twice.message);
  });

  test('a zero-arity option is present with an empty value list', () => {
    const parsed = parseArgv(['set', '--no-blocked-by']);
    assert.ok(parsed.kind === 'verb');
    assert.deepEqual(parsed.options.get('--no-blocked-by'), []);
  });
});

describe('the verb table', () => {
  test('every verb declares a summary, an input kind, and a file option matching it', () => {
    for (const name of VERB_NAMES) {
      const spec = VERBS[name];
      assert.ok(spec.summary.length > 0, `${name} has no summary`);
      const expected = spec.input === 'body' ? '--body-file' : '--input';
      assert.ok(Object.hasOwn(spec.options, expected), `${name} lacks ${expected}`);
    }
  });

  test('set offers a --<field> for every writable field, and a --no-<field> for exactly the clearable ones', () => {
    // The invariant is NOT "every flag has a partner" — that was the shape that
    // produced five `--no-` flags accepting a clear the writer cannot perform.
    // It is: a clear is offered exactly where one can be performed.
    const setOptions = Object.keys(VERBS.set.options);
    for (const field of [...SPLICE_WRITABLE, ...RENDER_ONLY]) {
      assert.ok(setOptions.includes(`--${field}`), `set lacks --${field}`);
    }
    for (const option of setOptions) {
      if (!option.startsWith('--no-')) continue;
      const field = option.slice('--no-'.length);
      assert.ok(
        SPLICE_CLEARABLE.some((clearable) => clearable === field),
        `${option} offers a clear the writer cannot perform`,
      );
    }
    for (const field of SPLICE_CLEARABLE) {
      assert.ok(setOptions.includes(`--no-${field}`), `set lacks --no-${field}`);
    }
  });
});

describe('helpText', () => {
  const rendered = helpText([
    ['ok', 0, 'the command answered'],
    ['usage', 2, 'bad arguments'],
  ]);

  test('documents every verb', () => {
    for (const name of VERB_NAMES) assert.ok(rendered.includes(name), `help omits ${name}`);
  });

  test('documents every option of every verb', () => {
    for (const name of VERB_NAMES) {
      for (const option of Object.keys(VERBS[name].options)) {
        assert.ok(rendered.includes(option), `help omits ${name} ${option}`);
      }
    }
  });

  test('renders the exit rows it is given', () => {
    assert.ok(rendered.includes('the command answered'));
    assert.ok(rendered.includes('bad arguments'));
  });

  test('states the boundary rule, which is the thing a reader most needs to know', () => {
    assert.ok(rendered.includes('ticket body'));
    assert.ok(rendered.includes('credential'));
  });
});
