import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type ElementSpec, type SpecChild } from './element.ts';
import { LAYOUT_PROPERTIES } from './layout.ts';
import { issueNumber } from './parts.ts';
import { renderViewer } from './render.ts';
import { RECEDE_ALPHA } from './recede.ts';
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

/**
 * A selector's specificity, folded to one comparable number.
 *
 * ENOUGH FOR THIS SHEET AND NO MORE: ids, then classes plus attribute
 * selectors, then element names. `:not(…)` takes the specificity of its
 * argument, which is the one subtlety that matters here — the container scope
 * is `:not([data-density])` and would read as zero without it.
 */
function specificity(selector: string): number {
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
}

describe('the structural stylesheet', () => {

  it('gives a selected canvas node a visible state, not just aria-current', () => {
    // Only the rail rows had a selected look, so clicking a gutter, excluded or
    // tracker-held node set `aria-current` on the SVG group and changed nothing
    // a reader could see — and a pointer does not normally raise
    // `:focus-visible`, so the channel most likely to make that selection had no
    // visible state at all.
    //
    // A SELECTED NODE IS INVERTED: filled with the text colour, its label in
    // --ig-bg, and a selected card the same, so a selection reads alike
    // whichever surface drew it.
    const css = withoutComments(viewerStylesheet);
    assert.match(css, /\.ig-node-group\[aria-current='true'\] \.ig-node \{/);
    assert.match(
      css,
      /\.ig-node-group\[aria-current='true'\] \.ig-node \{[^}]*fill: var\(--ig-text\);/,
      'the selected canvas node is not filled with --ig-text',
    );
    assert.match(
      css,
      /\.ig-node-group\[aria-current='true'\] \.ig-node-label \{[^}]*fill: var\(--ig-bg\);/,
      'the selected canvas node does not label in --ig-bg',
    );
    assert.match(
      css,
      /\.ig-rail-row\[aria-current='true'\] \.ig-card \{[^}]*background: var\(--ig-text\);[^}]*color: var\(--ig-bg\);/,
      'the selected card is not inverted',
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

  it('draws the legend with no visible caption, and names it instead (#288)', () => {
    // content.md rules out the small uppercase label above a group, and the
    // export's legend bar carries only an aria-label. So no caption is drawn
    // and no rule styles one, and the bar keeps the name the caption gave it.
    const css = withoutComments(viewerStylesheet);
    assert.equal(/\.ig-legend-caption\b/.test(css), false, 'a rule still styles a legend caption');
    const markup = renderViewer(fixtureDocument, { projection: 'graph' }).markup;
    assert.match(markup, /<fieldset class="ig-legend" aria-label="Relationships">/);
    assert.equal(/<legend\b/.test(markup), false, 'the legend draws a caption');
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

  it('keeps the glyph on every relationship, now that no chip carries its hue (#293)', () => {
    // The export draws a relationship as muted words after the one tag, so the
    // per-kind tint went with the pill. The glyph is what stays beside the
    // words to tell the five apart, so it is the channel asserted here.
    const css = withoutComments(viewerStylesheet);
    assert.equal(/\.ig-badge\[data-edge='[a-z-]+'\]/.test(css), false, 'a relationship chip still takes a per-kind treatment');
    const markup = renderViewer(fixtureDocument, { projection: 'linear' }).markup;
    const chips = [...markup.matchAll(/<span class="ig-badge" data-edge="[^"]*"[^>]*>(.*?)<\/span><\/span>/g)];
    assert.ok(chips.length > 0, 'the fixture draws no relationship, so this proves nothing');
    for (const chip of chips) {
      assert.match(chip[1] ?? '', /^<span class="ig-glyph" aria-hidden="true">/, 'a relationship lost its glyph');
    }
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

  it('says a matched query once on a list row, at every density (#131)', () => {
    // THE CHIP AND THE LINE TRADE PLACES. The line names the query wherever it
    // is drawn, so the chip is hidden there; the dense rail hides the line, so
    // the chip comes back; an opened dense row draws the line again, so the
    // chip leaves. Asserted on both density keys, because a rule written into
    // one emission and not the other is the drift `railDensity` exists to stop.
    const display = (selector: string): string | undefined =>
      rules()
        .filter((rule) => rule.selector === selector)
        .map((rule) => /display:\s*([\w-]+)/.exec(rule.body)?.[1])
        .at(-1);
    const chip = ".ig-badge[data-priority='query']";
    assert.equal(display(`.ig-slot ${chip}`), 'none', 'the wide row prints the query twice');
    for (const scope of [CONTAINER_SCOPE, ATTRIBUTE_SCOPE]) {
      assert.equal(display(`${scope} .ig-slot ${chip}`), 'inline-flex', `${scope}: the dense row names no query`);
      assert.equal(
        display(`${scope} .ig-slot[aria-expanded='true'] ${chip}`),
        'none',
        `${scope}: an opened dense row prints the query twice`,
      );
    }
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

/** The recede stamp in a selector, however its value is quoted. */
const RECEDE_STAMP = /\[data-recede=(['"]?)true\1\]/;

/** The last compound of a selector: the element the rule styles. */
function styledCompound(selector: string): string {
  return selector.split(/[\s>+~]+/).at(-1) ?? '';
}

interface DeclaredRule {
  readonly selector: string;
  readonly declarations: readonly { readonly name: string; readonly value: string }[];
}

/** Every rule of the sheet, one per selector of a selector list, with its declarations. */
function declaredRules(css: string): DeclaredRule[] {
  return [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((match) =>
    (match[1] ?? '').split(',').map((one) => ({
      selector: one.replace(/\s+/g, ' ').trim(),
      declarations: (match[2] ?? '')
        .split(';')
        .filter((line) => line.includes(':'))
        .map((line) => ({ name: line.slice(0, line.indexOf(':')).trim(), value: line.slice(line.indexOf(':') + 1).trim() })),
    })),
  );
}

describe('a receded element draws by colour roles and stroke opacity', () => {
  const sheet = declaredRules(viewerStylesheet);
  const recede = sheet.filter((rule) => RECEDE_STAMP.test(rule.selector));
  /** The values the recede rules styling `target` give to any of `names`. */
  const recededValues = (target: RegExp, ...names: string[]): string[] =>
    recede
      .filter((rule) => target.test(styledCompound(rule.selector)))
      .flatMap((rule) => rule.declarations.filter((one) => names.includes(one.name)).map((one) => one.value));

  it('draws a receded line and its terminal at RECEDE_ALPHA through stroke-opacity and fill-opacity', () => {
    // "With a selection, lines and stations that do not touch it draw at 50%, and with none selected nothing recedes"
    const atAlpha = (value: string): boolean => value === String(RECEDE_ALPHA) || value === `${RECEDE_ALPHA * 100}%`;
    for (const element of ['path', 'circle']) {
      for (const property of ['stroke-opacity', 'fill-opacity']) {
        assert.ok(
          recededValues(new RegExp(`^${element}`), property).some(atAlpha),
          `no rule draws a receded ${element} at RECEDE_ALPHA by ${property}`,
        );
      }
    }
  });

  it('draws a receded card on --ig-surface-2 with --ig-text-muted title and id labels', () => {
    // "Receded nodes draw on `--ig-surface-2` with `--ig-text-muted` labels, with no opacity or filter on them or above them"
    assert.ok(
      recededValues(/^\.ig-card(?![\w-])/, 'background', 'background-color').includes('var(--ig-surface-2)'),
      'no rule draws a receded card on --ig-surface-2',
    );
    assert.ok(
      recededValues(/^\.ig-title(?![\w-])/, 'color').includes('var(--ig-text-muted)'),
      'no rule colours the title of a receded card --ig-text-muted',
    );
    assert.ok(
      recededValues(/^\.ig-id(?![\w-])/, 'color').includes('var(--ig-text-muted)'),
      'no rule colours the id of a receded card --ig-text-muted',
    );
    // The surface role is named by its token here; the host's own role name never enters the sheet.
    assert.equal(viewerStylesheet.includes('fill-secondary'), false);
  });

  it('draws a receded list row and a receded list footer row like a receded card, and leaves the graph footer row without a ground', () => {
    // "List-projection rows are stamped `data-recede="true"` from the same `recedingOf` result and drawn like receded cards
    // (`--ig-surface-2`, `--ig-text-muted` text, no opacity)"
    const slot = /^\.ig-slot\[data-recede=(['"]?)true\1\]$/;
    const listFooterRow = /^\.ig-linear \.ig-footer-row\[data-recede=(['"]?)true\1\]$/;
    const groundOf = (selector: RegExp): string[] =>
      recede
        .filter((rule) => selector.test(rule.selector.replace(/^\.ig-viewer /, '')))
        .flatMap((rule) => rule.declarations.filter((one) => one.name === 'background-color').map((one) => one.value));
    assert.ok(groundOf(slot).includes('var(--ig-surface-2)'), 'no rule draws a receded list row on --ig-surface-2');
    assert.ok(groundOf(listFooterRow).includes('var(--ig-surface-2)'), 'no rule draws a receded list footer row on --ig-surface-2');

    /** Whether a recede rule colours `label` --ig-text-muted inside a stamped row that `row` names. */
    const mutedInside = (row: RegExp, label: string): boolean =>
      recede.some(
        (rule) =>
          styledCompound(rule.selector) === label &&
          row.test(rule.selector.slice(0, rule.selector.lastIndexOf(' ')).replace(/^\.ig-viewer /, '')) &&
          rule.declarations.some((one) => one.name === 'color' && one.value === 'var(--ig-text-muted)'),
      );
    const anyFooterRow = /^(?:\.ig-linear )?\.ig-footer-row\[data-recede=(['"]?)true\1\]$/;
    for (const label of ['.ig-title', '.ig-id']) {
      assert.ok(mutedInside(slot, label), `no rule colours the ${label} of a receded list row --ig-text-muted`);
      assert.ok(mutedInside(anyFooterRow, label), `no rule colours the ${label} of a receded list footer row --ig-text-muted`);
    }

    // The graph draws its footer rows too, and a receded one keeps the panel's ground: only the list's root and its
    // detached footer carry ig-linear, so a ground rule must be scoped there to stay off the graph.
    const groundsAFooterRow = recede.filter(
      (rule) =>
        /^\.ig-footer-row(?![\w-])/.test(styledCompound(rule.selector)) &&
        rule.declarations.some(({ name }) => name === 'background' || name === 'background-color'),
    );
    assert.deepEqual(
      groundsAFooterRow.filter((rule) => !rule.selector.startsWith('.ig-linear ')).map((rule) => rule.selector),
      [],
      'these rules give a receded graph footer row a ground',
    );
  });

  it('sets no opacity and no filter on a receded node or station, or on any element that holds one', () => {
    // "Receded nodes draw on `--ig-surface-2` with `--ig-text-muted` labels, with no opacity or filter on them or above them"
    // and "its rank numeral is `--ig-text-muted` with no opacity on it or above it".
    // The receded card, its labels, the station, the list row, and the rail row, canvas and viewer root that contain them.
    const nodeOrHolder = /^\.ig-(?:viewer|canvas|rail-row|card|title|id|footer-row|spine-station|slot)(?![\w-])/;

    assert.ok(recede.length > 0, 'the stylesheet has no rule for a receded element');
    const offenders = sheet
      .filter((rule) => RECEDE_STAMP.test(rule.selector) || nodeOrHolder.test(styledCompound(rule.selector)))
      .filter((rule) => rule.declarations.some(({ name }) => name === 'opacity' || name === 'filter'))
      .map((rule) => rule.selector);
    assert.deepEqual(offenders, [], 'these rules fade a receded node, or something above it, by opacity or filter');
  });

  it('dims no viewer text by opacity, and colours the held row, the held card and the right-column card with --ig-text-muted instead', () => {
    // "No text in either package is dimmed by opacity"
    // The property name is compared exactly, so stroke-opacity and fill-opacity neither fail this nor hide a bare opacity.
    assert.deepEqual(
      sheet.filter((rule) => rule.declarations.some(({ name }) => name === 'opacity')).map((rule) => rule.selector),
      [],
      'these rules still fade by opacity',
    );
    assert.ok(
      sheet.some((rule) => rule.declarations.some(({ name }) => name === 'stroke-opacity')),
      'the sheet declares no stroke-opacity, so a receded line cannot draw at half strength',
    );

    // "Replace the opacity on text at packages/viewer/src/styles.ts:1030, :1445 and :1456 with `--ig-text-muted` colour, keeping the dashed borders."
    for (const target of [`.ig-slot[data-held='true'] .ig-row-body`, `.ig-card[data-column='right']`, `.ig-card[data-held='true']`]) {
      assert.ok(
        sheet.some(
          (rule) =>
            rule.selector.includes(target) &&
            rule.declarations.some(({ name, value }) => name === 'color' && value === 'var(--ig-text-muted)'),
        ),
        `${target} does not colour its text --ig-text-muted`,
      );
    }
    assert.ok(
      sheet.some(
        (rule) =>
          rule.selector.includes(`.ig-card[data-held='true']`) &&
          rule.declarations.some(({ name, value }) => name.startsWith('border') && value.includes('dashed')),
      ),
      'the held card lost its dashed border',
    );
  });

  it('drops the pill of the priority tag on a receded card, and moves its text from --ig-text-muted to --ig-text', () => {
    // "a receded graph node's tag drops its pill, and where the priority tag's text reads `--ig-text-muted` it moves to `--ig-text`."
    const priorityTag = /^\.ig-badge\[data-priority[^\]]*\]$/;
    const values = (...names: string[]): string[] => recededValues(priorityTag, ...names);

    assert.ok(recede.some((rule) => priorityTag.test(styledCompound(rule.selector))), 'no rule styles the priority tag of a receded card');
    assert.ok(values('background', 'background-color').includes('transparent'), 'the receded priority tag keeps its pill fill');
    assert.ok(values('border-color').includes('transparent'), 'the receded priority tag keeps its pill border');
    assert.deepEqual(
      values('display', 'visibility').filter((value) => value === 'none' || value === 'hidden'),
      [],
      'the receded priority tag lost its text along with its pill',
    );
    assert.equal(values('color').includes('var(--ig-text-muted)'), false, 'the receded priority tag still reads --ig-text-muted');

    const readsMuted = sheet.some(
      (rule) =>
        !RECEDE_STAMP.test(rule.selector) &&
        /^\.ig-badge(?:\[data-priority[^\]]*\])?$/.test(styledCompound(rule.selector)) &&
        rule.declarations.some((one) => one.name === 'color' && one.value === 'var(--ig-text-muted)'),
    );
    if (readsMuted) {
      assert.ok(values('color').includes('var(--ig-text)'), 'the muted priority tag text did not move to --ig-text on a receded card');
    }
  });

  it('draws a receded station ring at RECEDE_ALPHA by mixing its own station colours, with a --ig-text numeral on a filled station and --ig-text-muted on the others', () => {
    // "A receded station's ring draws at 50% through its own colours, and its rank numeral is `--ig-text-muted` with no opacity on it or above it"
    // A filled station's numeral sits on its mixed fill, where --ig-text-muted is under 4.5:1, so it reads --ig-text;
    // theme.test.ts measures both.
    const station = /^\.ig-spine-station(?![\w-])/;
    const values = (...names: string[]): string[] => recededValues(station, ...names);
    const ownColourAtAlpha = (value: string): boolean => {
      const mixed = /color-mix\([^;]*var\(--ig-station-[a-z-]+\)\s+(\d+(?:\.\d+)?)%/.exec(value);
      return mixed !== null && Number(mixed[1]) === RECEDE_ALPHA * 100;
    };

    assert.ok(recede.some((rule) => station.test(styledCompound(rule.selector))), 'no rule styles a receded station');
    assert.ok(values('border-color').some(ownColourAtAlpha), 'the receded ring is not its own station colour mixed at RECEDE_ALPHA');
    assert.ok(values('background', 'background-color').some(ownColourAtAlpha), 'the receded fill is not its own station colour mixed at RECEDE_ALPHA');
    const filled = /\[data-fill=(['"]?)filled\1\]/;
    const colours = (rules: readonly DeclaredRule[]): string[] =>
      rules.flatMap((rule) => rule.declarations.filter((one) => one.name === 'color').map((one) => one.value));
    const stationRules = recede.filter((rule) => station.test(styledCompound(rule.selector)));
    const filledColours = colours(stationRules.filter((rule) => filled.test(rule.selector)));
    const otherColours = colours(stationRules.filter((rule) => !filled.test(rule.selector)));
    assert.deepEqual(filledColours, ['var(--ig-text)'], 'the rank numeral of a receded filled station is not --ig-text');
    assert.deepEqual(otherColours, ['var(--ig-text-muted)'], 'the rank numeral of a receded ring, dashed or serialize station is not --ig-text-muted');
  });

  it('lets no recede rule select a kind or change a dash, a border style or a stroke width, so every kind keeps its dash', () => {
    // "A receded line keeps its kind's dash, for all five kinds"
    // A rule on a kind would also dim the legend sample of that kind, which is never stamped.
    // together-with draws its dash as the border of the unit enclosure inside a card, not as a line,
    // so a recede rule that reset a border would take its dash away.
    const dashChannels = ['stroke-dasharray', 'stroke-dashoffset', 'stroke-width', 'border', 'border-style'];

    assert.ok(recede.length > 0, 'the stylesheet has no rule for a receded element');
    for (const rule of recede) {
      assert.equal(rule.selector.includes('data-edge'), false, `${rule.selector} selects a kind`);
      assert.deepEqual(
        rule.declarations.map(({ name }) => name).filter((name) => dashChannels.includes(name)),
        [],
        `${rule.selector} changes a dash, a border style or a stroke width`,
      );
    }
  });
});

/**
 * The recede rules win by their place in the sheet, not by luck.
 *
 * A receded card or station has to look the same whichever variant it is —
 * held, unit, gutter, now, filled, dashed — so every recede rule must come
 * after, and be at least as specific as, every other rule that sets the same
 * property on the same element. The competitors are found by reading the
 * sheet, so a variant added later is checked without anyone listing it here.
 */
describe('the recede rules win over every card and station variant', () => {
  /** The elements whose recede rules must win: the card, its labels, the footer title, the station and the list rows. */
  const RECEDE_ORDER_TARGETS = ['.ig-card', '.ig-title', '.ig-id', '.ig-hold', '.ig-unit-note', '.ig-spine-station', '.ig-slot', '.ig-footer-row'];

  interface RecedeOrderMember {
    readonly selector: string;
    readonly target: string;
    readonly properties: ReadonlySet<string>;
    readonly at: number;
  }

  /** `background-color` and `background`, or `border` and `border-color`, set one channel. */
  const RECEDE_ORDER_CHANNELS: Readonly<Record<string, string>> = { 'background-color': 'background', border: 'border-color' };
  const recedeOrderChannel = (name: string): string => RECEDE_ORDER_CHANNELS[name] ?? name;

  const recedeOrderMembers = (css: string): RecedeOrderMember[] =>
    [...withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((match) => {
      const head = (match[1] ?? '').trim();
      if (head === '' || head.startsWith('@')) return [];
      const properties = new Set(
        (match[2] ?? '')
          .split(';')
          .filter((line) => line.includes(':'))
          .map((line) => recedeOrderChannel(line.slice(0, line.indexOf(':')).trim())),
      );
      return head.split(',').map((one) => {
        const selector = one.replace(/\s+/g, ' ').trim();
        return { selector, target: /^\.[\w-]+/.exec(styledCompound(selector))?.[0] ?? '', properties, at: match.index };
      });
    });

  /** Every recede rule that loses to a variant, as one line per loss. */
  const recedeOrderLosses = (css: string): string[] => {
    const members = recedeOrderMembers(css);
    const recede = members.filter((one) => RECEDE_STAMP.test(one.selector) && RECEDE_ORDER_TARGETS.includes(one.target));
    return recede.flatMap((rule) =>
      members
        .filter(
          (other) =>
            !RECEDE_STAMP.test(other.selector) &&
            other.target === rule.target &&
            [...other.properties].some((name) => rule.properties.has(name)),
        )
        .filter((other) => other.at > rule.at || specificity(other.selector) > specificity(rule.selector))
        .map((other) => `${rule.selector} loses to ${other.selector}`),
    );
  };

  it('puts every recede rule after, and at least as specific as, every rule it overrides', () => {
    const recede = recedeOrderMembers(viewerStylesheet).filter(
      (one) => RECEDE_STAMP.test(one.selector) && RECEDE_ORDER_TARGETS.includes(one.target),
    );
    assert.deepEqual(
      [...new Set(recede.map((one) => one.target))].sort(),
      [...RECEDE_ORDER_TARGETS].sort(),
      'an element the graph or the list stamps has no recede rule',
    );
    assert.deepEqual(recedeOrderLosses(viewerStylesheet), []);
  });

  it('notices a recede rule moved above a variant it must override', () => {
    const css = withoutComments(viewerStylesheet);
    const moved = /\.ig-spine-station\[data-recede='true'\] \{[^}]*\}\n/.exec(css)?.[0];
    const variant = ".ig-spine-station[data-fill='filled'] {";
    assert.ok(moved !== undefined && css.includes(variant), 'the station rules this test moves are gone');
    const reordered = css.replace(moved, '').replace(variant, `${moved}${variant}`);

    assert.ok(
      recedeOrderLosses(reordered).includes(
        ".ig-spine-station[data-recede='true'] loses to .ig-spine-station[data-fill='filled']",
      ),
      'the order check passed a recede rule written above the variant it overrides',
    );
  });

  it('draws every recede share and opacity at RECEDE_ALPHA', () => {
    const bodies = [...withoutComments(viewerStylesheet).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => RECEDE_STAMP.test(match[1] ?? ''))
      .map((match) => match[2] ?? '');
    const shares = bodies.flatMap((body) =>
      [...body.matchAll(/color-mix\(in srgb, var\(--ig-[a-z-]+\) (\d+(?:\.\d+)?)%/g)].map((match) => Number(match[1]) / 100),
    );
    const opacities = bodies.flatMap((body) =>
      [...body.matchAll(/(?:stroke|fill)-opacity:\s*([^;]+);/g)].map((match) => Number(match[1])),
    );

    assert.ok(shares.length > 0 && opacities.length > 0, 'the recede rules carry no alpha to check');
    assert.deepEqual([...new Set([...shares, ...opacities])], [RECEDE_ALPHA]);
  });
});

/**
 * #254, AS THE REDESIGN LEAD RULED IT: every count this package draws, and
 * every issue number, is the body sans at the body size with tabular figures,
 * not the small mono; the keys line (the legend bar) takes the small role in
 * the same sans. Mono is kept only for keys a reader copies, such as label:P0.
 *
 * jsdom is not a dependency here, so this reads the cascade off the sheet
 * itself, and PESSIMISTICALLY: a rule counts when its last compound can select
 * the element, whatever its ancestors are and whatever state it names, and a
 * container query is taken to hold — a count that reads mono in one context is
 * the defect. A pseudo-element styles another box, so it never counts. The
 * editor's tests carry the same reading in `testing/counts.ts`; a package test
 * reaching into a sibling's source is the seam `check:isolation` keeps.
 */
const COUNT_TYPE: Readonly<Record<string, string>> = Object.freeze({
  'font-family': 'var(--ig-font-ui)',
  'font-size': 'var(--ig-font-size)',
  'font-variant-numeric': 'tabular-nums',
});

/** The small role the legend bar takes: the same sans, a step below the body. */
const SMALL_TYPE: Readonly<Record<string, string>> = Object.freeze({
  'font-family': 'var(--ig-font-ui)',
  'font-size': 'var(--ig-font-size-small)',
  'font-variant-numeric': 'tabular-nums',
});

/** A tag, as the export draws one (#288): the small role in the sans at medium weight. */
const TAG_TYPE: Readonly<Record<string, string>> = Object.freeze({
  'font-family': 'var(--ig-font-ui)',
  'font-size': 'var(--ig-font-size-small)',
  'font-weight': 'var(--ig-weight-medium)',
});

/**
 * What an issue number keeps in EVERY context: the sans and tabular figures.
 * A context may size or colour it — a card's identity line is smaller — so only
 * these two are read pessimistically; the base rule is read on its own below.
 */
const ISSUE_NUMBER_TYPE: Readonly<Record<string, string>> = Object.freeze({
  'font-family': 'var(--ig-font-ui)',
  'font-variant-numeric': 'tabular-nums',
});

/** One attribute selector, or one attribute an element carries. */
interface CountAttribute {
  readonly name: string;
  readonly operator: string | null;
  readonly value: string | null;
}

/** One compound selector: what an element must be to match it. `tag: null` matches any tag. */
interface CountCompound {
  readonly tag: string | null;
  readonly classes: readonly string[];
  readonly attributes: readonly CountAttribute[];
}

/** How an attribute selector's operator compares the value it names with the one the element holds. */
const ATTRIBUTE_OPERATORS: Readonly<Record<string, (wanted: string, held: string) => boolean>> = {
  '=': (wanted, held) => held === wanted,
  '~=': (wanted, held) => held.split(/\s+/).includes(wanted),
};

/** A compound's parts with every pseudo-class removed, or null when it is not a plain compound. */
function countCompoundOf(text: string): CountCompound | null {
  const bare = text.replace(/:[\w-]+(?:\([^()]*\))?/g, '');
  const tag = /^(?:\*|[a-z][\w-]*)/i.exec(bare)?.[0] ?? null;
  const rest = bare.slice(tag?.length ?? 0);
  const parts = rest.match(/\.[\w-]+|\[[^\]]*\]/g) ?? [];
  if (parts.join('') !== rest || (tag === null && parts.length === 0)) return null;
  const attributes = parts
    .filter((part) => part.startsWith('['))
    .map((part) => /^\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:'([^']*)'|"([^"]*)"|([^\s\]]+)))?\s*\]$/.exec(part));
  if (attributes.some((match) => match === null)) return null;
  return {
    tag: tag === '*' ? null : tag,
    classes: parts.filter((part) => part.startsWith('.')).map((part) => part.slice(1)),
    attributes: attributes
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ name: match[1] ?? '', operator: match[2] ?? null, value: match[3] ?? match[4] ?? match[5] ?? null })),
  };
}

/** Whether a rule's compound can select an element that is exactly `element`. */
function canStyleCount(rule: CountCompound, element: CountCompound): boolean {
  if (rule.tag !== null && rule.tag !== element.tag) return false;
  return (
    rule.classes.every((name) => element.classes.includes(name)) &&
    rule.attributes.every((wanted) =>
      element.attributes.some((held) => {
        if (held.name !== wanted.name) return false;
        const compare = wanted.operator === null ? undefined : ATTRIBUTE_OPERATORS[wanted.operator];
        // An operator this reading does not model matches on presence, so it
        // over-counts a rule rather than missing one.
        return compare === undefined || compare(wanted.value ?? '', held.value ?? '');
      }),
    )
  );
}

/**
 * Whether a selector's ancestor compounds can all be found, in order, among
 * `ancestors` (outermost first). Every combinator is read as a descendant one,
 * which only ever lets a rule match more.
 */
function withinAncestors(selector: string, ancestors: readonly CountCompound[]): boolean {
  const wanted = selector.split(/[\s>+~]+/).filter((part) => part !== '').slice(0, -1);
  let at = ancestors.length - 1;
  for (let index = wanted.length - 1; index >= 0; index -= 1) {
    const compound = countCompoundOf(wanted[index] ?? '');
    if (compound === null) return false;
    while (at >= 0) {
      const held = ancestors[at];
      if (held !== undefined && canStyleCount(compound, held)) break;
      at -= 1;
    }
    if (at < 0) return false;
    at -= 1;
  }
  return true;
}

/**
 * What the cascade gives `property` on an element that is exactly `target`:
 * the most specific rule that can style it, and of those the last. The `font`
 * shorthand resets all three properties, so it is read as setting each.
 *
 * WITH `ancestors` (outermost first) the element sits inside exactly those, and
 * a rule whose ancestor compounds they cannot supply does not apply — so a
 * number inside a provenance line is read as that line's number. Without them,
 * any ancestor is taken as present.
 */
function declaredOn(
  css: string,
  target: string,
  property: string,
  ancestors?: readonly string[],
): { value: string; selector: string } | undefined {
  const element = countCompoundOf(target);
  assert.ok(element !== null, `${target} is not a compound selector`);
  const context = ancestors?.map((one) => {
    const compound = countCompoundOf(one);
    assert.ok(compound !== null, `${one} is not a compound selector`);
    return compound;
  });
  let winner: { rank: number; value: string; selector: string } | undefined;
  for (const rule of declaredRules(css)) {
    if (rule.selector.includes('::')) continue;
    const styled = countCompoundOf(styledCompound(rule.selector));
    if (styled === null || !canStyleCount(styled, element)) continue;
    if (context !== undefined && !withinAncestors(rule.selector, context)) continue;
    for (const { name, value } of rule.declarations) {
      if (name !== property && name !== 'font') continue;
      const rank = specificity(rule.selector) + (value.includes('!important') ? 1_000_000 : 0);
      if (winner === undefined || rank >= winner.rank) {
        winner = { rank, value: name === 'font' ? `font: ${value}` : value, selector: rule.selector };
      }
    }
  }
  return winner === undefined ? undefined : { value: winner.value, selector: winner.selector };
}

/** Every one of `targets` the cascade does not give `type`, one line per property. */
function typeMisses(css: string, targets: readonly string[], type: Readonly<Record<string, string>>): string[] {
  return targets.flatMap((target) =>
    Object.entries(type).flatMap(([property, expected]) => {
      const declared = declaredOn(css, target, property);
      return declared?.value === expected
        ? []
        : [`${target} reads ${property}: ${declared?.value ?? 'nothing'} (from ${declared?.selector ?? 'no rule'})`];
    }),
  );
}

/**
 * `css` with a later rule on the selector that gives `target` its `property`
 * today, setting `value` — so it ties that rule on specificity and wins on
 * order, the shape a careless later edit takes.
 */
function withLaterRule(css: string, target: string, property: string, value: string): string {
  const winner = declaredOn(css, target, property);
  assert.ok(winner !== undefined, `no rule sets ${property} on ${target}`);
  return `${css}\n${winner.selector} {\n  ${property}: ${value};\n}\n`;
}

describe('every count and every issue number is body text, and the keys line is the small role (#254)', () => {
  // Every count the viewer draws, the overflow chip among them — it is a
  // count, not an edge.
  const COUNTS = ['.ig-count-chip', '.ig-count', '.ig-notice-progress', '.ig-unit-count', '.ig-badge[data-omitted]'];
  // "The keys line" names no class; in this package it is the legend bar's
  // items and its readiness keys.
  const SMALL = ['.ig-legend-item', '.ig-legend-keys'];

  it('sets the body sans, the body size and tabular figures on each count, as the last rule that can style it', () => {
    assert.deepEqual(typeMisses(viewerStylesheet, COUNTS, COUNT_TYPE), []);
  });

  it('fails a later rule that puts the mono face or a smaller size back on a count', () => {
    const wrong: readonly (readonly [string, string])[] = [
      ['font-family', 'var(--ig-font-mono)'],
      ['font-size', 'var(--ig-font-size-small)'],
    ];
    for (const target of COUNTS) {
      for (const [property, value] of wrong) {
        const later = withLaterRule(viewerStylesheet, target, property, value);
        assert.notDeepEqual(typeMisses(later, [target], COUNT_TYPE), [], `${target} passed with ${property}: ${value} put back`);
      }
    }
  });

  it('sets the legend bar at the small role, in the sans with tabular figures, its items muted', () => {
    assert.deepEqual(typeMisses(viewerStylesheet, SMALL, SMALL_TYPE), []);
    // Read in the legend's own context: the reader otherwise assumes any ancestor, and the
    // current rail card's `.ig-card *` colour rule would stand in for a legend item it never holds.
    assert.equal(declaredOn(viewerStylesheet, '.ig-legend-item', 'color', ['.ig-viewer', '.ig-legend'])?.value, 'var(--ig-text-muted)');
  });

  it('fails a later rule that puts the mono face or a smaller size on the legend bar', () => {
    const wrong: readonly (readonly [string, string])[] = [
      ['font-family', 'var(--ig-font-mono)'],
      ['font-size', 'var(--ig-font-size-micro)'],
    ];
    for (const target of SMALL) {
      for (const [property, value] of wrong) {
        const later = withLaterRule(viewerStylesheet, target, property, value);
        assert.notDeepEqual(typeMisses(later, [target], SMALL_TYPE), [], `${target} passed with ${property}: ${value} put back`);
      }
    }
  });

  it('draws an issue number as the design’s muted number: the sans at the body size, tabular figures', () => {
    // AN ISSUE NUMBER IS READ, NOT COPIED, so it is not mono. The base rule
    // carries the whole treatment; a context may resize or recolour it (a
    // card's identity line is smaller), but no context may put the mono face
    // back or drop the tabular figures.
    assert.deepEqual(typeMisses(viewerStylesheet, ['.ig-id'], ISSUE_NUMBER_TYPE), []);
    const base = declaredRules(viewerStylesheet).filter((rule) => rule.selector === '.ig-id');
    assert.deepEqual(
      Object.fromEntries(base.flatMap((rule) => rule.declarations.map(({ name, value }) => [name, value]))),
      {
        color: 'var(--ig-text-muted)',
        'font-family': 'var(--ig-font-ui)',
        'font-size': 'var(--ig-font-size)',
        'font-variant-numeric': 'tabular-nums',
      },
    );
    const later = withLaterRule(viewerStylesheet, '.ig-id', 'font-family', 'var(--ig-font-mono)');
    assert.notDeepEqual(typeMisses(later, ['.ig-id'], ISSUE_NUMBER_TYPE), [], 'an issue number passed in the mono face');
  });
});

describe('one face and one size per explanation line, and a copied key is mono at it (#254)', () => {
  // The provenance, hold and caveat lines and the freshness stamp: the small
  // role in the sans. A number in one inherits the line's size; the one key a
  // reader copies (label:P0) is `.ig-copy-key`, mono at the line's size.
  const LINES = ['.ig-provenance', '.ig-hold', '.ig-caveat', '.ig-freshness'];

  it('sets each line in the sans at the small size with tabular figures, as the last rule that can style it', () => {
    assert.deepEqual(typeMisses(viewerStylesheet, LINES, SMALL_TYPE), []);
  });

  it('fails a later rule that puts the mono face or a smaller size on a line', () => {
    const wrong: readonly (readonly [string, string])[] = [
      ['font-family', 'var(--ig-font-mono)'],
      ['font-size', 'var(--ig-font-size-micro)'],
    ];
    for (const target of LINES) {
      for (const [property, value] of wrong) {
        const later = withLaterRule(viewerStylesheet, target, property, value);
        assert.notDeepEqual(typeMisses(later, [target], SMALL_TYPE), [], `${target} passed with ${property}: ${value} put back`);
      }
    }
  });

  it('draws an issue number inside a line at the line’s size, not the body size', () => {
    // READ IN CONTEXT: the number sits inside the viewer and the line, and in
    // nothing else, so a rule for a number on a card does not stand in for it.
    for (const line of LINES) {
      const inside = ['.ig-viewer', line];
      assert.equal(declaredOn(viewerStylesheet, '.ig-id', 'font-size', inside)?.value, 'inherit', `a number in ${line} has a size of its own`);
      assert.equal(declaredOn(viewerStylesheet, '.ig-id', 'font-family', inside)?.value, 'var(--ig-font-ui)', `a number in ${line} is not sans`);
    }
    // And the body size is what it would get without the line rule.
    const without = viewerStylesheet.replace(/\.ig-freshness \.ig-id \{\n {2}font-size: inherit;\n\}/, '.ig-freshness .ig-id {\n}');
    assert.notEqual(without, viewerStylesheet, 'the line rule this test removes is gone');
    assert.notEqual(declaredOn(without, '.ig-id', 'font-size', ['.ig-viewer', '.ig-freshness'])?.value, 'inherit');
  });

  it('sets a copied key mono with tabular figures, and gives it no size of its own anywhere', () => {
    // NO SIZE IS THE POINT: read pessimistically, in any context, no rule sizes
    // it, so it takes the size of the line it sits in.
    assert.equal(declaredOn(viewerStylesheet, '.ig-copy-key', 'font-family')?.value, 'var(--ig-font-mono)');
    assert.equal(declaredOn(viewerStylesheet, '.ig-copy-key', 'font-variant-numeric')?.value, 'tabular-nums');
    assert.equal(declaredOn(viewerStylesheet, '.ig-copy-key', 'font-size'), undefined);
    for (const line of LINES) {
      const inside = ['.ig-viewer', line];
      assert.equal(declaredOn(viewerStylesheet, '.ig-copy-key', 'font-family', inside)?.value, 'var(--ig-font-mono)', line);
    }
  });
});

describe('the chrome the export draws differently, drawn as the export draws it (#288)', () => {
  /** Every later rule in `wrong` that the reading must catch, as one line per pass it let through. */
  const blindTo = (target: string, type: Readonly<Record<string, string>>, wrong: readonly (readonly [string, string])[]): string[] =>
    wrong.flatMap(([property, value]) =>
      typeMisses(withLaterRule(viewerStylesheet, target, property, value), [target], type).length > 0
        ? []
        : [`${target} passed with ${property}: ${value}`],
    );
  const MONO_OR_MICRO: readonly (readonly [string, string])[] = [
    ['font-family', 'var(--ig-font-mono)'],
    ['font-size', 'var(--ig-font-size-micro)'],
  ];

  it('sets every row tag as a tag: the small role in the sans at medium weight', () => {
    // "P3" and a hold label are words a reader reads, not keys they copy, so
    // neither is mono. The relationships and caveats beside them were tags
    // here too until #293 made them muted text; that block pins them below.
    const BADGES = [
      '.ig-badge',
      ".ig-badge[data-priority='tier']",
      ".ig-badge[data-priority='promoted']",
      ".ig-badge[data-hold='claimed']",
    ];
    assert.deepEqual(typeMisses(viewerStylesheet, BADGES, TAG_TYPE), []);
    assert.deepEqual(blindTo('.ig-badge', TAG_TYPE, MONO_OR_MICRO), []);
  });

  it('draws the unit label and its note in sentence case in the sans, with no fill and no tracking', () => {
    const LABEL = { 'font-family': 'var(--ig-font-ui)', 'font-size': 'var(--ig-font-size-small)', 'font-weight': 'var(--ig-weight-medium)' };
    const NOTE = { 'font-family': 'var(--ig-font-ui)', 'font-size': 'var(--ig-font-size-small)' };
    assert.deepEqual(typeMisses(viewerStylesheet, ['.ig-unit-pill'], LABEL), []);
    assert.deepEqual(typeMisses(viewerStylesheet, ['.ig-unit-note'], NOTE), []);
    // READ WHERE THE LABEL SITS, inside a row's unit mark, so the rule that
    // clears a selected graph card's children does not stand in for it.
    const inside = ['.ig-viewer', '.ig-slot', '.ig-unit-mark'];
    for (const target of ['.ig-unit-pill', '.ig-unit-note']) {
      for (const property of ['text-transform', 'letter-spacing', 'background']) {
        assert.equal(declaredOn(viewerStylesheet, target, property, inside), undefined, `${target} still sets ${property}`);
      }
    }
    assert.deepEqual(blindTo('.ig-unit-pill', LABEL, MONO_OR_MICRO), []);
  });

  it('sets the rank figure in the sans with tabular figures', () => {
    const RANK = { 'font-family': 'var(--ig-font-ui)', 'font-variant-numeric': 'tabular-nums' };
    assert.deepEqual(typeMisses(viewerStylesheet, ['.ig-rank', ".ig-rank[data-held='true']"], RANK), []);
    assert.deepEqual(blindTo('.ig-rank', RANK, [['font-family', 'var(--ig-font-mono)']]), []);
  });

  it('draws held as a solid dot in the held colour and ready-after as a solid ring, as the board does', () => {
    const held = ".ig-station[data-fill='dashed']";
    const after = ".ig-station[data-fill='hollow']";
    // READ IN A ROW'S RANK TRACK, where the station is drawn.
    const inside = ['.ig-viewer', '.ig-slot', '.ig-rank-cell'];
    assert.equal(declaredOn(viewerStylesheet, held, 'background', inside)?.value, 'var(--ig-station-held)');
    assert.equal(declaredOn(viewerStylesheet, held, 'border-style', inside)?.value, 'solid');
    assert.equal(declaredOn(viewerStylesheet, after, 'background', inside)?.value, 'transparent');
    assert.equal(declaredOn(viewerStylesheet, after, 'border-color', inside)?.value, 'var(--ig-station-pending)');
    assert.equal(declaredOn(viewerStylesheet, after, 'border-style', inside), undefined, 'the ring takes a style of its own');
    // NO ROW STATION IS DASHED ANY MORE. The graph's spine station keeps its
    // dashed held ring, which is what the board draws on the spine.
    assert.equal(/\.ig-station\b[^{]*\{[^}]*dashed/.test(withoutComments(viewerStylesheet)), false, 'a row station is still dashed');
  });

  it('draws no card of its own inside a host that declines the frame, and a sentence-case group heading', () => {
    const embedded = [".ig-viewer[data-frame='none']"];
    // NO GROUND, so the rows sit on the host's card rather than in a second one.
    assert.equal(declaredOn(viewerStylesheet, ".ig-viewer[data-frame='none']", 'background')?.value, 'transparent');
    // THE GROUP HEADING is the export's: small, medium, muted, sentence case.
    const heading = '.ig-header-label.ig-footer-title';
    const HEADING = {
      color: 'var(--ig-text-muted)',
      'font-family': 'var(--ig-font-ui)',
      'font-size': 'var(--ig-font-size-small)',
      'font-weight': 'var(--ig-weight-medium)',
      'text-transform': 'none',
    };
    for (const [property, expected] of Object.entries(HEADING)) {
      assert.equal(declaredOn(viewerStylesheet, heading, property, embedded)?.value, expected, `the embedded heading's ${property}`);
    }
    // ITS COUNT SITS AT THE ROW'S END, as the export's group row sets it.
    assert.equal(declaredOn(viewerStylesheet, '.ig-footer-title-row', 'justify-content', embedded)?.value, 'space-between');
    // AND ITS COUNT IS A NUMBER, NOT AN OUTLINED CHIP.
    const count = ".ig-count-chip[data-count='footer']";
    assert.equal(declaredOn(viewerStylesheet, count, 'border', embedded)?.value, '0');
    assert.equal(declaredOn(viewerStylesheet, count, 'background', embedded)?.value, 'none');
    assert.equal(declaredOn(viewerStylesheet, count, 'font-size', embedded)?.value, 'var(--ig-font-size-small)');
    // STANDING ALONE IT IS STILL THE PANEL'S OWN KICKER, unchanged.
    assert.equal(declaredOn(viewerStylesheet, heading, 'text-transform', ['.ig-viewer'])?.value, 'uppercase');
    // The flag reaches the markup the rules key off.
    assert.match(renderViewer(hostedFixtureDocument, { frame: false, chrome: false }).markup, /<section class="ig-viewer ig-linear"[^>]*data-frame="none"/);
  });

  it('draws the loading placeholder on one static fill, lines as short pills in their line height, blocks with the card corner', () => {
    const css = viewerStylesheet;
    // ONE FILL, the fill-strong role (its own token since #293), everywhere — no
    // ground-specific override. Read in a row and on the header's own ground,
    // where an override used to be.
    assert.equal(declaredOn(css, '.ig-skeleton-block', 'background', ['.ig-viewer', '.ig-list', '.ig-slot'])?.value, 'var(--ig-fill-strong)');
    assert.equal(declaredOn(css, '.ig-skeleton-block', 'background', ['.ig-viewer', '.ig-header', '.ig-header-top'])?.value, 'var(--ig-fill-strong)');
    // A LINE IS A PILL ONE SNUG STEP TALL, whose margins make up its line.
    const lines: readonly (readonly [string, string])[] = [
      ['title', '--ig-row-title-line'],
      ['meta', '--ig-row-meta-line'],
    ];
    for (const [shape, line] of lines) {
      const target = `.ig-skeleton-block[data-shape='${shape}']`;
      assert.equal(declaredOn(css, target, 'block-size')?.value, 'var(--ig-space-snug)', `${shape} is not a short pill`);
      assert.equal(declaredOn(css, target, 'border-radius')?.value, 'var(--ig-space-snug)', `${shape} is not rounded to a pill`);
      assert.equal(
        declaredOn(css, target, 'margin-block')?.value,
        `calc((var(${line}) - var(--ig-space-snug)) / 2)`,
        `${shape} does not sit in its line's height`,
      );
    }
    // A CONTROL IS A PILL ITS OWN SIZE: the chip's corner is half its height.
    const chip = ".ig-skeleton-block[data-shape='chip']";
    assert.equal(declaredOn(css, chip, 'block-size')?.value, 'calc(var(--ig-space) * 2)');
    assert.equal(declaredOn(css, chip, 'border-radius')?.value, 'var(--ig-space)');
    // A BLOCK TAKES THE CARD'S CORNER.
    assert.equal(declaredOn(css, ".ig-skeleton-block[data-shape='card']", 'border-radius')?.value, 'var(--ig-radius-large)');
  });
});

describe('the tag, the rank, the unit count and the legend, as the export draws them (#293)', () => {
  /** Every later rule in `wrong`, set on `selector`, that the reading under `inside` does not see. */
  const missedBy = (
    target: string,
    selector: string,
    inside: readonly string[],
    wrong: readonly (readonly [string, string])[],
  ): string[] =>
    wrong.flatMap(([property, value]) => {
      const later = `${viewerStylesheet}\n${selector} {\n  ${property}: ${value};\n}\n`;
      return declaredOn(later, target, property, inside)?.value === value ? [] : [`${target} hid a later ${property}: ${value}`];
    });
  // READ ON A GRAPH CARD'S BADGE ROW, where no rail-density rule reaches: the
  // dense rail strips every chip to text on purpose, and that rule would
  // otherwise stand in for the wide one.
  const CARD = ['.ig-viewer', '.ig-card', '.ig-badges'];

  it('draws the one tag as a pill 20 tall, padded 0 8, on the second fill with no border', () => {
    const PILL: Readonly<Record<string, string>> = {
      background: 'var(--ig-surface-2)',
      'block-size': 'var(--ig-space-wide)',
      border: '0',
      'border-radius': 'var(--ig-radius-large)',
      padding: '0 var(--ig-space-snug)',
      color: 'var(--ig-text)',
    };
    const tags: readonly (readonly [string, readonly string[]])[] = [
      ['.ig-badge', CARD],
      [".ig-badge[data-priority='tier']", CARD],
      [".ig-badge[data-priority='promoted']", CARD],
      // A hold label is the one tag its explanation line holds.
      [".ig-badge[data-hold='claimed']", ['.ig-viewer', '.ig-slot', '.ig-hold']],
    ];
    for (const [target, inside] of tags) {
      for (const [property, expected] of Object.entries(PILL)) {
        assert.equal(declaredOn(viewerStylesheet, target, property, inside)?.value, expected, `${target} reads ${property}`);
      }
    }
    // NO BORDER ON ANY TAG, the promoted one included: the accent tint it wore
    // was a second treatment the export does not draw.
    assert.equal(/\.ig-badge\[data-priority='promoted'\]\s*\{/.test(withoutComments(viewerStylesheet)), false, 'the promoted tag keeps a treatment of its own');
    assert.deepEqual(missedBy('.ig-badge', '.ig-badge', CARD, [['border', 'var(--ig-stroke) solid var(--ig-line)'], ['border-radius', 'var(--ig-radius-small)']]), []);
  });

  it('draws every chip after the tag as muted words: no fill, no corner, no padding, regular weight', () => {
    // ONE TAG PER CELL, A SECOND CONDITION IS MUTED TEXT AFTER IT. The board
    // draws a row's relationships and its caveats as plain muted words after
    // the priority tag, and the count of the rest as a muted number.
    const SECOND = [
      ".ig-badge[data-edge='blocked-by']",
      ".ig-badge[data-edge='decomposed-from']",
      // A raise, "from P3", after the raised priority's tag.
      ".ig-badge[data-raise='3']",
      ".ig-badge[data-caveat='disagree']",
      ".ig-badge[data-caveat='preview-only']",
      ".ig-badge[data-evidence='verified']",
      ".ig-badge[data-not-ready='true']",
      '.ig-badge[data-omitted]',
    ];
    const TEXT: Readonly<Record<string, string>> = {
      background: 'none',
      'block-size': 'auto',
      'border-radius': '0',
      color: 'var(--ig-text-muted)',
      'font-weight': 'var(--ig-weight-regular)',
      padding: '0',
    };
    for (const target of SECOND) {
      for (const [property, expected] of Object.entries(TEXT)) {
        assert.equal(declaredOn(viewerStylesheet, target, property, CARD)?.value, expected, `${target} reads ${property}`);
      }
    }
    // THE WORDS STAY AT THE SMALL ROLE IN THE SANS, which is the size the
    // graph's packer measures them at; the overflow count keeps the body size
    // every count takes, pinned with the counts above.
    for (const target of SECOND.filter((one) => one !== '.ig-badge[data-omitted]')) {
      assert.equal(declaredOn(viewerStylesheet, target, 'font-size', CARD)?.value, 'var(--ig-font-size-small)', `${target} left the small role`);
    }
    assert.deepEqual(
      missedBy(".ig-badge[data-edge='blocked-by']", '.ig-badge[data-edge]', CARD, [
        ['background', 'var(--ig-surface-2)'],
        ['font-weight', 'var(--ig-weight-medium)'],
      ]),
      [],
    );
  });

  it('sets the rank muted and regular at the body size, held or not', () => {
    // The export draws the rank as body text in muted ink; it was strong in
    // text colour at 14, and the export's rules forbid a weight of 600.
    const inside = ['.ig-viewer', '.ig-slot', '.ig-rank-cell'];
    const RANK: Readonly<Record<string, string>> = {
      color: 'var(--ig-text-muted)',
      'font-size': 'var(--ig-font-size)',
      'font-weight': 'var(--ig-weight-regular)',
    };
    for (const target of ['.ig-rank', ".ig-rank[data-held='true']"]) {
      for (const [property, expected] of Object.entries(RANK)) {
        assert.equal(declaredOn(viewerStylesheet, target, property, inside)?.value, expected, `${target} reads ${property}`);
      }
    }
    assert.deepEqual(
      missedBy('.ig-rank', '.ig-rank', inside, [
        ['font-weight', 'var(--ig-weight-strong)'],
        ['font-size', 'var(--ig-font-size-rank)'],
      ]),
      [],
    );
  });

  it('sets the count inside the unit label regular and muted, and draws no glyph and no note', () => {
    const inside = ['.ig-viewer', '.ig-slot', '.ig-unit-mark', '.ig-unit-pill'];
    assert.equal(declaredOn(viewerStylesheet, '.ig-unit-num', 'color', inside)?.value, 'var(--ig-text-muted)');
    assert.equal(declaredOn(viewerStylesheet, '.ig-unit-num', 'font-weight', inside)?.value, 'var(--ig-weight-regular)');
    // The label around it keeps the medium weight, so the two read apart.
    assert.equal(declaredOn(viewerStylesheet, '.ig-unit-pill', 'font-weight', ['.ig-viewer', '.ig-slot', '.ig-unit-mark'])?.value, 'var(--ig-weight-medium)');
    const markup = renderViewer(fixtureDocument, { projection: 'linear' }).markup;
    assert.match(markup, /<span class="ig-unit-pill">One unit · <span class="ig-unit-num">\d+<\/span> issues<\/span>/);
    assert.equal(/⧉ One unit|Worked together/.test(markup), false, 'the unit label still draws its glyph or its note');
  });

  it('draws a refusal capsule\u2019s loop as a tag in the error state, as the editor\u2019s capsule draws it', () => {
    const inside = ['.ig-viewer', '.ig-refusal', '.ig-capsule'];
    const LOOP: Readonly<Record<string, string>> = {
      background: 'var(--ig-state-failed-fill)',
      'block-size': 'var(--ig-space-wide)',
      'border-radius': 'var(--ig-radius-large)',
      color: 'var(--ig-state-failed)',
      'font-family': 'var(--ig-font-ui)',
      'font-size': 'var(--ig-font-size-small)',
      'font-weight': 'var(--ig-weight-medium)',
      padding: '0 var(--ig-space-snug)',
    };
    for (const [property, expected] of Object.entries(LOOP)) {
      assert.equal(declaredOn(viewerStylesheet, '.ig-loop-tag', property, inside)?.value, expected, `the loop tag reads ${property}`);
    }
    assert.deepEqual(
      missedBy('.ig-loop-tag', '.ig-loop-tag', inside, [
        ['background', 'color-mix(in srgb, var(--ig-state-failed) var(--ig-tint-fill), transparent)'],
        ['font-size', 'var(--ig-font-size-micro)'],
      ]),
      [],
    );
  });

  it('draws the legend bar on no ground of its own, and a docked one on the root ground', () => {
    assert.equal(declaredOn(viewerStylesheet, '.ig-legend', 'background', ['.ig-viewer']), undefined, 'the legend bar still paints a ground');
    // DOCKED, IT IS STICKY OVER ROWS THAT SCROLL BENEATH IT, so it takes the
    // root's ground rather than letting them show through.
    assert.equal(declaredOn(viewerStylesheet, '.ig-legend', 'background', [".ig-viewer[data-legend='docked']"])?.value, 'var(--ig-bg)');
  });
});

describe('the legend, the held row, the footer group and issue numbers, as the export draws them (#296)', () => {
  it('prints the legend in the export’s words and order, with the four readiness keys', () => {
    const markup = renderViewer(fixtureDocument, { projection: 'graph' }).markup;
    const legend = /<fieldset class="ig-legend"[^>]*>([\s\S]*?)<\/fieldset>/.exec(markup)?.[1] ?? '';
    const words = [...legend.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);
    assert.deepEqual(words, [
      'is blocked by',
      'serializes with',
      'goes together with',
      'is a duplicate of',
      'was decomposed from',
      'Ready now',
      'Ready after its blockers',
      'Held',
      'Being worked',
    ]);
  });

  it('marks a held row with its dot alone: no hatched ground', () => {
    const inside = ['.ig-viewer', '.ig-list'];
    assert.equal(declaredOn(viewerStylesheet, ".ig-slot[data-held='true']", 'background-image', inside), undefined, 'a held row is still hatched');
    assert.equal(/repeating-linear-gradient/.test(withoutComments(viewerStylesheet)), false);
  });

  it('heads the group "Not in the order" with a bare count, draws no lede, and no second line of reasons', () => {
    const css = withoutComments(viewerStylesheet);
    assert.equal(/\.ig-footer-(note|why)\b/.test(css), false, 'a rule still styles the lede or the reasons line');
    const markup = renderViewer(fixtureDocument).markup;
    assert.match(markup, /<p class="ig-header-label ig-footer-title">Not in the order<\/p><span class="ig-count-chip" data-count="footer">\d+<\/span>/);
    assert.equal(/ig-footer-(note|why)/.test(markup), false);
    assert.match(markup, /<span class="ig-badge" data-hold="duplicate">Duplicate<\/span>/);
  });

  it('draws a bare issue number with its "#", and a host’s other spelling as written', () => {
    const markup = renderViewer(fixtureDocument).markup;
    assert.match(markup, /<span class="ig-id">#\d+<\/span>/);
    assert.equal(/<span class="ig-id">\d+<\/span>/.test(markup), false, 'an issue number lost its "#"');
    assert.equal(issueNumber('101'), '#101');
    assert.equal(issueNumber('acme/app#7'), 'acme/app#7');
    assert.equal(issueNumber('c0-1'), 'c0-1');
  });
});
