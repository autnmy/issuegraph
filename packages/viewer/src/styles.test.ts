import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type ElementSpec, type SpecChild } from './element.ts';
import { LAYOUT_PROPERTIES } from './layout.ts';
import { renderViewer } from './render.ts';
import { fixtureDocument } from './testing/fixtures.ts';
import { viewerStylesheet } from './styles.ts';
import { THEME_TOKENS } from './theme.ts';

/** Every `var(--…)` name the stylesheet references. */
function referencedTokens(css: string): string[] {
  return [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] as string);
}

/** The stylesheet with its comments removed — a comment is not a declaration. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('the structural stylesheet', () => {

  it('gives a selected canvas node a visible state, not just aria-current', () => {
    // Only the rail rows had a selected look, so clicking a gutter, excluded or
    // tracker-held node set `aria-current` on the SVG group and changed nothing
    // a reader could see — and a pointer does not normally raise
    // `:focus-visible`, so the channel most likely to make that selection had no
    // visible state at all.
    const css = withoutComments(viewerStylesheet);
    assert.match(css, /\.ig-node-group\[aria-current='true'\] \.ig-node \{/);
    assert.match(
      css,
      /\.ig-node-group\[aria-current='true'\] \.ig-node \{[^}]*--ig-accent/,
      'the selected canvas node does not use the accent the rail selection uses',
    );
  });
  it('places every row child the four grid columns cannot hold', () => {
    // `.ig-slot` declares FOUR columns and a row has more children than that.
    // A child left unplaced auto-places into column ONE of a second row — the
    // rank track, an auto-sized column that takes the width of its widest item
    // — so one relationship badge set the rank column's width for the whole
    // row, pushing the station and title across and squeezing the title.
    //
    // ASSERTED AS THE RULE, NOT AS ONE CLASS. Naming `.ig-badges` would pass
    // the moment a sixth child is added and land in the rank exactly as this
    // one did; deriving the children from the rendered row makes the next
    // addition fail here instead of on someone's screen.
    const css = withoutComments(viewerStylesheet);
    const columns = (css.match(/\.ig-slot \{[^}]*grid-template-columns:([^;]*);/) ?? [])[1];
    assert.ok(columns, 'the slot row no longer declares its columns');
    const budget = columns.trim().split(/\s+/).length;

    const rows: ElementSpec[] = [];
    const walk = (node: SpecChild): void => {
      if (typeof node === 'string') return;
      if (node.tag === 'li' && node.attrs?.['class'] === 'ig-slot') rows.push(node);
      for (const child of node.children ?? []) walk(child);
    };
    walk(renderViewer(fixtureDocument, {}).scene.root);
    assert.ok(rows.length > 0, 'no slot rows rendered, so this proves nothing');

    for (const row of rows) {
      const classes = (row.children ?? [])
        .filter((child): child is ElementSpec => typeof child !== 'string')
        .map((child) => String(child.attrs?.['class'] ?? ''));
      for (const cls of classes.slice(budget)) {
        assert.match(
          css,
          new RegExp(`\\.${cls}[^{]*\\{[^}]*grid-column`),
          `.${cls} sits past the ${budget} declared columns and names no grid-column, so it auto-places into the rank track`,
        );
      }
    }
  });

  it('references only properties something actually sets', () => {
    // The other direction of the theme contract: a `var()` naming a property no
    // theme and no layout sets resolves to nothing, and the affected rule
    // silently does not apply — the failure mode that looks like a styling bug
    // for weeks.
    //
    // TWO KINDS, declared separately rather than merged. A theme token is a
    // value a HOST chooses; a layout property is one the LAYOUT computes and
    // writes onto an element. Accepting any `--ig-` name would have made this
    // guard vacuous the moment the first computed property appeared.
    const known = [...THEME_TOKENS, ...LAYOUT_PROPERTIES];
    const unknown = referencedTokens(viewerStylesheet).filter(
      (token) => !known.includes(token),
    );
    assert.deepEqual(unknown, []);
  });

  it('keeps the two kinds of property disjoint', () => {
    for (const property of LAYOUT_PROPERTIES) {
      assert.equal(
        THEME_TOKENS.includes(property),
        false,
        `${property} is both a theme token and layout output`,
      );
      assert.match(property, /^--ig-[a-z0-9-]+$/);
    }
  });

  it('sets every layout property on the elements that use it', () => {
    // A declared-but-never-written property is the same silent nothing as an
    // undeclared one, so the list is checked against the markup rather than
    // taken on trust.
    const written = renderViewer(fixtureDocument, { projection: 'graph' }).markup;
    for (const property of LAYOUT_PROPERTIES) {
      assert.ok(written.includes(`${property}:`), `${property} is declared but never written`);
    }
  });

  it('contains no literal colour', () => {
    // R5 asserted against the bytes: every colour is the theme's to decide, so
    // finding one here means a value escaped the custom properties.
    const css = withoutComments(viewerStylesheet);
    assert.equal(/#[0-9A-Fa-f]{3,8}\b/.exec(css), null, 'a hex colour');
    assert.equal(/\brgba?\(/.exec(css), null, 'an rgb() colour');
    assert.equal(/\bhsla?\(/.exec(css), null, 'an hsl() colour');
    assert.equal(/:\s*(?:red|blue|green|black|white|grey|gray)\b/.exec(css), null, 'a named colour');
  });

  it('contains no fixed pixel length', () => {
    // Spacing is the theme's too. `0` is unitless and carries no scale, which
    // is why it is the one length allowed to appear literally.
    const css = withoutComments(viewerStylesheet);
    assert.equal(/\d+(?:\.\d+)?px/.exec(css), null, 'a px length');
  });

  it('names no font family outside the type tokens', () => {
    const css = withoutComments(viewerStylesheet);
    for (const match of css.matchAll(/font-family:\s*([^;]+);/g)) {
      assert.match(match[1] as string, /^var\(--ig-font-(ui|mono)\)$/);
    }
  });

  it('scopes every rule under the viewer, so a host page is untouched', () => {
    const selectors = withoutComments(viewerStylesheet)
      .split('}')
      .map((block) => block.split('{')[0]?.trim() ?? '')
      .filter((selector) => selector !== '');

    for (const selector of selectors) {
      assert.match(
        selector,
        /(^|[\s,])\.ig-/,
        `"${selector}" is not scoped to a viewer class`,
      );
    }
  });

  it('sets no stroke-dasharray for an edge — the vocabulary owns that channel', () => {
    // One source for the pattern channel. A dash set here and a dash set in
    // `vocabulary.ts` is two, and the colour-blind-safety claim rests on it.
    const css = withoutComments(viewerStylesheet);
    for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = (match[1] ?? '').trim();
      const body = match[2] ?? '';
      if (!/stroke-dasharray/.test(body)) continue;
      assert.ok(
        !/\.ig-edge|\.ig-enclosure|\.ig-connector/.test(selector),
        `${selector} sets stroke-dasharray, which the edge vocabulary owns`,
      );
    }
  });
});

describe('the stylesheet keeps text on text-grade colours', () => {
  it('never paints a text colour with an edge hue', () => {
    // The theme holds the edge hues to the 3:1 NON-TEXT bar and says so where it
    // defines them — so any rule setting `color` to one is a claim the palette
    // does not support. It was not theoretical: the badge label took the hue,
    // and duplicate-of measured 3.98:1 on --ig-surface at 11px.
    // Written as a STRUCTURAL rule rather than a per-token contrast check,
    // because that is the invariant: `color` may not name an edge hue at all.
    // A contrast assertion would pass again the moment somebody darkened one
    // hue by a point, which is not the property worth holding.
    // COMMENTS STRIPPED FIRST — this very rule's own comment names the tokens,
    // and the prose around the badge rules discusses them at length, so a raw
    // scan would report the explanation as the offence.
    const css = withoutComments(viewerStylesheet);
    const offenders = [];
    for (const rule of css.split('}')) {
      for (const line of rule.split(';')) {
        const declaration = line.trim();
        if (!/^color\s*:/.test(declaration)) continue;
        if (/--ig-edge-/.test(declaration)) offenders.push(declaration);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `these rules paint TEXT with a non-text-grade edge hue: ${offenders.join(' | ')}`,
    );
  });

  it('still carries the hue on the badge border, so no channel was lost', () => {
    // The fix moves the hue rather than dropping it. Losing it here would be a
    // quieter regression than the one it repairs.
    const css = withoutComments(viewerStylesheet);
    assert.match(css, /border-color: var\(--ig-edge-duplicate-of\)/);
  });
});
