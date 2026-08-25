/**
 * The theming promise, enforced instead of restated.
 *
 * The README, the page footer and `styles.css` itself all say a host can
 * retheme this demo by redeclaring one block of custom properties. That was
 * once an overclaim: the token block existed, and the rules underneath it went
 * on hard-coding font sizes, paddings, borders, radii and grid tracks — so a
 * host following the instructions could change the colours and nothing else.
 *
 * A promise a reader has to verify by hand is a promise that drifts, and the
 * drift is invisible: nothing fails, the page still renders, and the sentence
 * goes on being printed. So the rule is a test. It reads the stylesheet, splits
 * off the blocks that DEFINE custom properties, and asserts that no rule
 * outside them carries a length literal.
 *
 * It deliberately does not try to parse CSS. Everything it needs is decidable
 * on a line: a declaration either sets a custom property or it does not, and a
 * value either contains a dimension or it does not.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const stylesheet = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');

/** A number followed by a CSS length or angle unit — the thing a theme owns. */
const DIMENSION = /(^|[\s(,:/])-?\d*\.?\d+(px|rem|em|ch|ex|vh|vw|vmin|vmax|pt|pc|cm|mm|in|deg)\b/;

/**
 * Values a rule may carry literally, because they are STRUCTURE rather than
 * theme: a host retheming the page does not redefine what "fill the row" means.
 * Unitless numbers (`0`, `1fr`, `100%`, `999`) are not dimensions and never
 * reach the test above.
 */
const STRUCTURAL = /^(0|auto|none|inherit|initial|unset)$/;

interface Declaration {
  readonly line: number;
  readonly text: string;
}

/**
 * Every declaration that is NOT inside a custom-property definition block.
 *
 * The token blocks are exactly the `:root` selectors, which is where this file
 * declares its theme; anything else is a rule a host should not have to edit.
 */
function rulesOutsideTheTokenBlocks(): Declaration[] {
  const found: Declaration[] = [];
  let inTokens = false;
  let depth = 0;
  stylesheet.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\/\*.*?\*\//g, '').trim();
    if (line === '') return;
    if (line.endsWith('{')) {
      depth += 1;
      // A `:root` selector at any nesting — including inside the media query —
      // opens a token block.
      if (line.includes(':root')) inTokens = true;
      return;
    }
    if (line.startsWith('}')) {
      depth -= 1;
      if (depth <= 0) {
        inTokens = false;
        depth = Math.max(depth, 0);
      }
      return;
    }
    if (inTokens) return;
    found.push({ line: index + 1, text: line });
  });
  return found;
}

test('no rule outside the token blocks carries a length literal', () => {
  const offenders = rulesOutsideTheTokenBlocks().filter((declaration) => {
    const [, ...rest] = declaration.text.split(':');
    const value = rest.join(':').replace(/;$/, '').trim();
    if (value === '' || STRUCTURAL.test(value)) return false;
    return DIMENSION.test(value);
  });

  assert.deepEqual(
    offenders.map((each) => `styles.css:${each.line}  ${each.text}`),
    [],
    'these rules hard-code a dimension, so a host cannot retheme by redeclaring the token block alone',
  );
});

test('CONTROL: the guard actually reads the stylesheet and can fail', () => {
  // A test that scans nothing passes just as loudly as one that scans
  // everything, so prove both halves: there ARE rules outside the token
  // blocks, and the pattern DOES match a dimension when one is present.
  const rules = rulesOutsideTheTokenBlocks();
  assert.ok(rules.length > 20, `only ${rules.length} rules were scanned; the split is wrong`);
  assert.ok(DIMENSION.test('padding: 9px var(--gap)'), 'the pattern misses a plain px value');
  assert.ok(DIMENSION.test('font-size: 1.2rem'), 'the pattern misses a fractional value');
  assert.ok(!DIMENSION.test('var(--pad-row-y) var(--gap)'), 'the pattern flags a tokenised value');
  assert.ok(!DIMENSION.test('1 / -1'), 'the pattern flags a unitless grid line');
});

test('the token blocks actually define the dimensions the rules use', () => {
  // The other half of the promise: every custom property a rule references has
  // to be declared, or "redeclare the block" reaches nothing.
  const declared = new Set([...stylesheet.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
  const used = new Set([...stylesheet.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], 'these properties are used but never declared');
});
