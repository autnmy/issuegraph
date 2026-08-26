import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { THEME_TOKENS, renderViewer } from '@issuegraph/viewer';

import { AUDIT_SEVERITY_ATTRIBUTE } from '../audit/surface.ts';
import { ZONES, renderWorkspace } from './render.ts';
import { workspaceStylesheet } from './styles.ts';
import { WORKSPACE_WORDS, backlogOf } from '../testing/workspace.ts';

/** The stylesheet with its comments removed — a comment is not a declaration. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function classesIn(markup: string): string[] {
  return [...markup.matchAll(/class="([^"]+)"/g)].flatMap((match) => (match[1] ?? '').split(' '));
}

/**
 * Every state this surface renders, in one place.
 *
 * The states exclude each other — nothing is selected, or an issue is, or an
 * edge is; a slot is held or it is ready — so one render would leave most of
 * the stylesheet looking orphaned. Both sets below are derived from this SAME
 * list, which is what stops the two directions being wrong at once.
 */
const DOCUMENT = backlogOf(6, {
  held: ['i0005'],
  edges: [
    ['blocked-by', 'i0001', 'i0002'],
    ['duplicate-of', 'i0003', 'i0006'],
    ['serialize-with', 'i0001', 'i0003'],
    ['together-with', 'i0002', 'i0004'],
    ['decomposed-from', 'i0004', 'i0006'],
  ],
});

const RENDERS = [
  renderWorkspace(DOCUMENT, { words: WORKSPACE_WORDS }),
  renderWorkspace(DOCUMENT, { words: WORKSPACE_WORDS, selection: { kind: 'issue', key: 'i0005' } }),
  renderWorkspace(DOCUMENT, { words: WORKSPACE_WORDS, selection: { kind: 'issue', key: 'i0001' } }),
  renderWorkspace(DOCUMENT, {
    words: WORKSPACE_WORDS,
    selection: { kind: 'edge', edgeId: 'blocked-by|i0001|i0002' },
  }),
  // A WINDOW WITH ROWS ON BOTH SIDES OF IT. The spacers only render when the
  // window is narrower than the order, so without this render their rule looks
  // orphaned and the "no unstyled class" direction never sees them at all.
  renderWorkspace(DOCUMENT, { words: WORKSPACE_WORDS, rail: { start: 2, count: 2 } }),
];

/** Every class THIS package's workspace emits, across those states. */
const EMITTED: ReadonlySet<string> = new Set(RENDERS.flatMap((result) => classesIn(result.markup)));

/** The classes the COMPOSED leaves emit over the same document, from those leaves. */
const COMPOSED: ReadonlySet<string> = new Set([
  ...classesIn(renderViewer(DOCUMENT, { projection: 'linear' }).markup),
  ...classesIn(renderViewer(DOCUMENT, { projection: 'graph' }).markup),
  // The ladder's chrome and the audit header ship their own stylesheets, which
  // `renderWorkspace` installs alongside this one.
  'ig-ladder',
  'ig-ladder-isolated',
  'ig-chip',
  'ig-audit',
  'ig-audit-toggle',
  'ig-audit-count',
  'ig-audit-label',
]);

describe('the workspace stylesheet carries structure, never a value', () => {
  const css = withoutComments(workspaceStylesheet);

  it('references only properties something actually resolves', () => {
    // A `var(--ig-…)` nothing resolves is a silent nothing: the declaration is
    // dropped, so the surface loses its look on exactly the host that installed
    // a second theme correctly.
    //
    // TWO RESOLVERS, NOT ONE. Most come from the theme. The rest are LOCAL —
    // set inline by this package's own renderer on the element that needs them,
    // the same way layer 1 carries `--ig-stage-w` and `--ig-row-x`. Those are
    // derived from the rendered markup rather than allowed by a hand-written
    // exemption, so a `var()` for a property nothing sets is still caught.
    const setInline = new Set(
      RENDERS.flatMap((result) => [...result.markup.matchAll(/(--[a-z0-9-]+)\s*:/g)]).map(
        (match) => match[1] ?? '',
      ),
    );
    assert.ok(setInline.size > 0, 'the renderer sets no local properties at all');

    const referenced = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]);
    assert.ok(referenced.length > 0, 'the stylesheet references no tokens at all');
    assert.deepEqual(
      referenced.filter(
        (token) => token === undefined || !(THEME_TOKENS.includes(token) || setInline.has(token)),
      ),
      [],
    );
  });

  it('writes no literal colour and no fixed length', () => {
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'a literal colour');
    assert.equal(/\brgba?\(/.test(css), false, 'a literal colour function');
    assert.equal(/\b\d+(\.\d+)?(px|rem|em|pt)\b/.test(css), false, 'a fixed length');
  });

  it('declares no animation and no transition', () => {
    // §17a: the audit is ambient, and a count that animates is a count demanding
    // attention it has not earned. This is where it could creep back in without
    // touching a line of TypeScript.
    assert.equal(/\banimation\b/.test(css), false, 'an animation');
    assert.equal(/\btransition\b/.test(css), false, 'a transition');
    assert.equal(/@keyframes/.test(css), false, 'a keyframes block');
  });

  it('is dark only: one palette, and no second one behind a media query', () => {
    // Light was cut after pass 1. A forked token set is the drifting second
    // implementation the package split exists to remove, and a
    // `prefers-color-scheme` block is how one arrives without anyone deciding to
    // add it.
    assert.equal(/prefers-color-scheme/.test(css), false, 'a second palette');
    assert.equal(/color-scheme\s*:/.test(css), false, 'a scheme declaration');
  });

  it('gives each zone a fixed area rather than letting content negotiate it', () => {
    // §17f: the rail is complete at any backlog size and the canvas refuses
    // above its budget, and assembling them must not average the two. A large
    // document has to grow the canvas's refusal, never squeeze the rail out.
    assert.match(css, /grid-template-areas:/);
    for (const zone of ZONES) {
      assert.match(css, new RegExp(`\\[data-zone='${zone}'\\]`), zone);
    }
  });

  it('draws the audit bar from the mark, and only inside the rail', () => {
    const bar = css.match(
      new RegExp(`\\[data-zone='rail'\\] \\[${AUDIT_SEVERITY_ATTRIBUTE}\\]\\s*\\{([^}]*)\\}`),
    )?.[1];
    assert.ok(bar !== undefined, 'nothing draws the ambient left-bar');
    // An inset shadow, not a border: a border changes the row's box, so every
    // marked row would shift against its neighbours — a layout jump the eye
    // reads as movement, on the surface that may least afford one.
    assert.match(bar, /box-shadow:\s*inset/);
    assert.equal(/(^|;)\s*border(-\w+)?:/.test(bar), false, 'a border that would shift the row');
  });
});

describe('the stylesheet and the markup account for each other', () => {
  const css = withoutComments(workspaceStylesheet);
  const styled = new Set([...css.matchAll(/\.(ig-[a-z0-9-]+)/g)].map((match) => match[1] ?? ''));

  it('styles the selectors this package actually renders, and no others', () => {
    // Derived from the rendered markup rather than from a list kept by hand, so
    // a rule for a class nothing emits cannot survive here.
    assert.ok(styled.size > 0, 'the stylesheet declares no rules at all');
    assert.deepEqual([...styled].filter((name) => !EMITTED.has(name)), []);
  });

  it('leaves nothing this surface adds unstyled', () => {
    // The other direction: a class emitted with no rule of its own is unstyled
    // on a host that installs this stylesheet. The composed leaves' own classes
    // are excluded — they are those leaves' to style, and their sheets ship
    // alongside this one.
    assert.ok(COMPOSED.size > 0, 'the composed leaves emitted no classes at all');
    assert.deepEqual(
      [...EMITTED].filter(
        (name) => name.startsWith('ig-') && !COMPOSED.has(name) && !styled.has(name),
      ),
      [],
    );
  });
});
