import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type ElementSpec, type SpecChild } from './element.ts';
import { LAYOUT_PROPERTIES } from './layout.ts';
import { renderViewer } from './render.ts';
import { fixtureDocument, hostedFixtureDocument } from './testing/fixtures.ts';
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
    // BOTH FIXTURES, because the host facts add row children — a caveat line,
    // a labelled hold — that the bare fixture never renders, and the rule has
    // to see every child a row can have.
    walk(renderViewer(fixtureDocument, {}).scene.root);
    walk(renderViewer(hostedFixtureDocument, {}).scene.root);
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

  it('keeps the legend caption out of the rendered-legend slot', () => {
    // A LOAD-BEARING DECLARATION THAT READS AS DECORATION. HTML lifts the first
    // in-flow `legend` of a `fieldset` out of the content box, paints it across
    // the top border with the rule notched either side, and starts the content
    // below it. That drew the caption on the rule, a band of bare ground under
    // it, and a broken top rule. `float` is the spec's own opt-out: a legend
    // whose computed float is not `none` is an ordinary child, and in this flex
    // bar the float itself is then ignored, so it lays out as the first item.
    //
    // ASSERTED HERE BECAUSE NOTHING ELSE WOULD FAIL. Removing the line changes
    // no markup, no token and no other rule — the defect returns silently, and
    // the next reader tidying an "unused float" has no signal at all.
    const css = withoutComments(viewerStylesheet);
    const block = /\.ig-legend-caption \{([^}]*)\}/.exec(css);
    assert.ok(block, 'the legend caption no longer has a rule of its own');
    assert.match(
      block[1] as string,
      /float:\s*left/,
      'the caption is back in the rendered-legend slot, so the top rule is notched again',
    );
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
    //
    // ONE EXEMPTION, AND IT IS THE NARROWEST ONE CSS LEAVES AVAILABLE: the
    // CONDITION of an `@container` query. This rule's intent is that every
    // VALUE is the theme's, so a host can retheme without forking — and a
    // query threshold is not a value a theme sets. It is the width at which a
    // different set of themed values starts applying.
    //
    // It is exempted because CSS gives no alternative. `@container (max-width:
    // var(--x))` is not valid: a container condition cannot read a custom
    // property, so the threshold has to be a literal or the query cannot exist.
    // The three ways out were measured against §17j's ruling before this was
    // widened:
    //   - a host-set density prop — forbidden in as many words, *"not a prop
    //     the host sets"*;
    //   - a viewport media query — forbidden in the same sentence, and wrong,
    //     because the row's question is about its COLUMN and not the window;
    //   - `cqw` sizing with no breakpoint — cannot express "stop drawing this
    //     below a width", which is the whole of the drop order.
    //
    // So the exemption is scoped to the parenthesised condition ONLY. A px in
    // any DECLARATION still fails, which is the half of the rule that protects
    // the theme contract.
    const css = withoutComments(viewerStylesheet).replaceAll(
      /@container[^{]*\{/g,
      '@container {',
    );
    assert.equal(/\d+(?:\.\d+)?px/.exec(css), null, 'a px length');
  });

  it('puts a px length only in a container condition, never in a declaration', () => {
    // THE OTHER HALF OF THE EXEMPTION ABOVE, asserted rather than trusted.
    // Stripping the conditions makes the first test blind to what is inside
    // them, so this one looks at exactly that text and holds it to the shape
    // the exemption was granted for: a container query, on an inline size.
    const css = withoutComments(viewerStylesheet);
    for (const match of css.matchAll(/@container([^{]*)\{/g)) {
      const condition = (match[1] ?? '').trim();
      assert.match(
        condition,
        /^[a-z-]*\s*\((?:max|min)-width:\s*\d+(?:\.\d+)?px\)$/,
        `"${condition}" is not a plain inline-size container condition`,
      );
    }
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
      // AN AT-RULE IS NOT A SELECTOR, and this split cannot tell them apart on
      // its own: `@container ig-rail (max-width: 430px) {` arrives here as if
      // it were one, and it carries no class because it selects nothing. The
      // rules INSIDE it are still checked — they are their own entries in this
      // same list — so the scoping guarantee is unchanged. What is skipped is
      // the wrapper, which cannot leak to a host page because it matches no
      // element.
      if (selector.startsWith('@')) continue;
      assert.match(
        selector,
        /(^|[\s,])\.ig-/,
        `"${selector}" is not scoped to a viewer class`,
      );
    }
  });

  it('draws the together mark at the contrast-checked hue and the hairline width', () => {
    // WHAT MAKES THE CONTRAST CLAIM ABOUT THE DRAWN CONNECTOR. `theme.test.ts`
    // already holds `--ig-edge-together-with` to the 3:1 non-text bar on all
    // three plain surfaces — but a token nothing uses proves nothing about a
    // line on screen. This is the link between the two: the connector is
    // painted with THAT token, so the measurement there is a measurement of
    // this. A literal hex here would pass the theme test and still ship an
    // unmeasured colour.
    const css = withoutComments(viewerStylesheet);
    // THE MARK MOVED, THE LINK DID NOT. A together unit is now ONE card with an
    // inner enclosure round its members, rather than two boxes joined by a
    // connector across the canvas — so the element carrying the hue is
    // `.ig-unit`. It is still drawn at `--ig-stroke-connector`, which is what
    // that token has always meant: the hairline the together mark takes, finer
    // than an ordinary edge.
    // ANCHORED TO THE DEFINING RULE, NOT TO ANY SELECTOR THAT ENDS IN IT.
    // `\.ig-unit\s*\{` matched the FIRST rule whose selector happens to end
    // `.ig-unit` — and once a density rule existed that hides the enclosure in
    // a narrow rail, that was `… [data-unit='true'] .ig-unit { display: none }`
    // and this test read `display: none` as the together mark's definition.
    //
    // It is the substring-for-exact defect one more time: the string that means
    // "the together mark" is contained in the string that means "hide the
    // together mark". Anchoring to a selector that BEGINS a line and is exactly
    // `.ig-unit` is the whole fix, and it makes this test stricter rather than
    // more permissive — a rule that stops defining the border still fails.
    const rule = /(?:^|\n)\.ig-unit\s*\{([^}]*)\}/.exec(css);
    assert.ok(rule !== null, 'the stylesheet draws no together mark');

    const body = rule[1] ?? '';
    assert.match(body, /border:[^;]*var\(--ig-stroke-connector\)[^;]*var\(--ig-edge-together-with\)/);
    assert.ok(
      !/#[0-9a-fA-F]{3,8}|\brgba?\(/.test(body),
      'the together mark names a literal colour, which no contrast test measures',
    );
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
        !/\.ig-edge|\.ig-enclosure/.test(selector),
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

  it('still carries the hue on the badge border and its fill, so no channel was lost', () => {
    // The fix moves the hue rather than dropping it. Losing it here would be a
    // quieter regression than the one it repairs.
    // THE HUE IS NOW MIXED RATHER THAN SET FLAT, because §16a's chip is a tinted
    // fill inside a heavier border of the same hue and a bare outline carries a
    // third of the weight the design gives it. What the rule holds is unchanged
    // — the badge names the relationship's own hue — so the assertion names the
    // token and not the exact function it is spent through.
    const css = withoutComments(viewerStylesheet);
    const rule = /\.ig-badge\[data-edge='duplicate-of'\]\s*\{([^}]*)\}/.exec(css);
    assert.ok(rule !== null, 'the stylesheet gives duplicate-of no badge treatment');
    const body = rule[1] ?? '';
    assert.match(body, /border-color:[^;]*var\(--ig-edge-duplicate-of\)/);
    assert.match(body, /background:[^;]*var\(--ig-edge-duplicate-of\)/);
  });
});

/**
 * §17j's density crossover is a DEFAULT, and the escape hatch has to beat it.
 *
 * `430px` is this package's own number — §17j gives two anchors and no
 * crossover — so a consumer must be able to disagree without patching the
 * sheet. `data-density` on the viewer root is that hatch, and these are the two
 * properties it rests on: the declarations exist exactly once in the source,
 * and the attribute's copy WINS over the base density it overrides.
 *
 * THE SECOND ONE IS NOT THEORETICAL HERE. One rule in this block already had to
 * be hand-scoped with `.ig-viewer` after a container query, which adds no
 * specificity, tied with the base rule it was overriding at an even `0,3,0` and
 * lost on file order — the together-unit row drew as an empty em dash, and it
 * was found by measuring rather than by reading. So this asserts the win rather
 * than trusting the arithmetic.
 */
describe('the density escape hatch overrides the crossover it is an escape from', () => {
  const css = withoutComments(viewerStylesheet);
  const CONTAINER_SCOPE = '.ig-viewer:not([data-density])';
  const ATTRIBUTE_SCOPE = ".ig-viewer[data-density='dense']";

  /**
   * Every rule in the sheet, in source order, as `{ selector, body, at }`.
   *
   * A HAND-ROLLED SPLIT RATHER THAN ONE REGEX OVER THE WHOLE FILE, because the
   * sheet nests rules inside `@container` blocks: this pairs each innermost
   * brace group with the text before it and drops the `@` headers, which is all
   * this sheet's one level of nesting needs.
   */
  const rules = (): { selector: string; body: string; at: number }[] => {
    const found: { selector: string; body: string; at: number }[] = [];
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (match[1] ?? '').trim();
      if (selector === '' || selector.startsWith('@')) continue;
      found.push({ selector, body: (match[2] ?? '').trim(), at: match.index });
    }
    return found;
  };

  /**
   * A selector's specificity, folded to one comparable number.
   *
   * ENOUGH FOR THIS SHEET AND NO MORE: ids, then classes plus attribute
   * selectors, then element names. `:not(…)` takes the specificity of its
   * argument, which is the one subtlety that matters here — the container scope
   * is `:not([data-density])` and would read as zero without it.
   */
  const specificity = (selector: string): number => {
    const inner = [...selector.matchAll(/:not\(([^)]*)\)/g)].map((match) => match[1] ?? '').join(' ');
    const bare = selector.replace(/:not\([^)]*\)/g, ' ');
    const count = (text: string): [number, number, number] => [
      (text.match(/#[\w-]+/g) ?? []).length,
      (text.match(/\.[\w-]+/g) ?? []).length + (text.match(/\[[^\]]*\]/g) ?? []).length,
      (text.match(/(?:^|[\s>+~])([a-z][\w-]*)/g) ?? []).length,
    ];
    const [a1, b1, c1] = count(bare);
    const [a2, b2, c2] = count(inner);
    return (a1 + a2) * 10000 + (b1 + b2) * 100 + (c1 + c2);
  };

  it('writes the density block once, and emits it under both keys', () => {
    // ONE SOURCE, TWO KEYS. CSS cannot say "this container condition OR that
    // selector", so the declarations would otherwise be written twice — and two
    // copies of three hundred lines are two copies that drift. `railDensity`
    // interpolates one block under two scopes, and this is what says so from
    // the outside, by matching the bodies rather than by trusting the function.
    // EVERY OCCURRENCE OF THE SCOPE COMES OUT, not just the leading one. Two
    // rules here carry a selector LIST, and the interpolation puts the scope in
    // front of each member — so slicing only the prefix left the second member
    // still wearing it and reported two identical blocks as drifted.
    const bodies = (scope: string): string[] =>
      rules()
        .filter((rule) => rule.selector.includes(scope))
        .map((rule) => `${rule.selector.split(scope).join('').replace(/\s+/g, ' ').trim()} { ${rule.body} }`);

    const container = bodies(CONTAINER_SCOPE);
    const attribute = bodies(ATTRIBUTE_SCOPE);
    assert.ok(container.length > 10, 'the container-scoped density block vanished');
    assert.deepEqual(attribute, container, 'the two emissions have drifted apart');
  });

  it('wins on specificity, not on where anyone put the rule', () => {
    // THE PROPERTY, ASSERTED AGAINST EVERY RULE THE HATCH OVERRIDES. For each
    // density rule the base rule it answers is the one whose selector is that
    // rule's own tail — `.ig-slot`, `.ig-footer-row .ig-title`, and so on. The
    // hatch has to beat it on specificity, so a rule added further down the
    // file later cannot take the density back by position.
    const all = rules();
    const dense = all.filter((rule) => rule.selector.startsWith(ATTRIBUTE_SCOPE));
    assert.ok(dense.length > 10, 'the attribute-scoped density block vanished');

    // ONE SELECTOR AT A TIME, because two of these rules carry a selector LIST
    // and a base rule may spell the same target on its own.
    const members = (selector: string): string[] =>
      selector.split(',').map((one) => one.replace(/\s+/g, ' ').trim());

    let compared = 0;
    for (const rule of dense) {
      for (const member of members(rule.selector)) {
        const tail = member.slice(ATTRIBUTE_SCOPE.length).trim();
        const base = all.find(
          (other) => other !== rule && members(other.selector).includes(tail),
        );
        if (base === undefined) continue;
        compared += 1;
        assert.ok(
          specificity(member) > specificity(tail),
          `${member} does not outrank ${tail} on specificity`,
        );
      }
    }
    assert.ok(compared > 0, 'no density rule shares a tail with a base rule, so this proved nothing');

    // AND POSITION IS DELIBERATELY NOT ASSERTED. At least one base rule — the
    // together-unit row — is written BELOW this block, which is exactly the
    // arrangement that broke once: at equal specificity the later rule won and
    // the unit row drew empty. The fix then was to raise specificity, and the
    // fix now is the same one applied to the whole block, so a test demanding
    // source order would be pinning the thing that did not work.
    const unitBase = all.find(
      (rule) => rule.selector === ".ig-slot[data-unit='true'] > .ig-row-body > .ig-row-head",
    );
    const unitDense = dense.find((rule) => rule.selector.includes("[data-unit='true'] >"));
    assert.ok(unitBase !== undefined && unitDense !== undefined, 'the unit row rules moved');
    assert.ok(unitBase.at > unitDense.at, 'the arrangement this note is about no longer exists');
  });

  it('leaves the crossover deciding only while the host has not', () => {
    // THE DEFAULT SURVIVES THE HATCH, which is the half that keeps this a
    // drop-in: a consumer who passes nothing still gets a density chosen from
    // the box it was given, per §17j. The container block is scoped to the
    // attribute being ABSENT, so any value takes the decision away from the
    // width — and `wide` needs no rules of its own, because it matches neither
    // scope and falls through to the base density.
    assert.match(css, /@container ig-rail \(max-width: \d+px\)/);
    for (const rule of rules().filter((one) => one.selector.startsWith('.ig-viewer:not('))) {
      assert.ok(
        rule.selector.startsWith(CONTAINER_SCOPE),
        `${rule.selector} is scoped to some other absence`,
      );
    }
    assert.equal(
      css.includes("[data-density='wide']"),
      false,
      'the wide direction grew rules of its own, so it can now disagree with the base density',
    );
  });
});

describe('the density escape hatch reaches the markup the sheet keys off', () => {
  it('stamps the host’s decision on the viewer root, and nothing when absent', () => {
    // THE SHEET KEYS OFF THE ATTRIBUTE'S PRESENCE, so "absent" has to mean the
    // attribute is not written at all rather than written empty — an empty one
    // would take the decision away from the container and give it to nobody.
    const plain = renderViewer(fixtureDocument, {}).markup;
    assert.equal(/data-density/.test(plain), false, 'an unasked-for density reached the markup');

    for (const density of ['dense', 'wide'] as const) {
      const markup = renderViewer(fixtureDocument, { density }).markup;
      assert.match(markup, new RegExp(`<section class="ig-viewer[^"]*"[^>]*data-density="${density}"`));
    }
  });

  it('stamps it on every projection, so a toggle cannot drop it', () => {
    for (const projection of ['linear', 'graph', 'tree'] as const) {
      const markup = renderViewer(fixtureDocument, { projection, density: 'dense' }).markup;
      assert.match(markup, /data-density="dense"/, projection);
    }
  });
});
