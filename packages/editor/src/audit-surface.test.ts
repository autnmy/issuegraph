import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { THEME_TOKENS } from '@issuegraph/viewer';

import { AUDIT_CLASS_SPECS } from './audit.ts';
import type { AuditClass, AuditFinding } from './audit.ts';
import {
  AUDIT_COUNT_ATTRIBUTE,
  AUDIT_FILTER_ATTRIBUTE,
  AUDIT_SEVERITY_ATTRIBUTE,
  AUDIT_TOKENS,
  auditFilterKeeps,
  auditOverlay,
  auditRowAttributes,
  auditStylesheet,
  auditThemeCss,
  renderAuditHeader,
} from './audit-surface.ts';

function finding(kind: AuditClass, members: readonly string[]): AuditFinding {
  const spec = AUDIT_CLASS_SPECS[kind];
  return {
    kind,
    severity: spec.severity,
    keepAsHistory: spec.keepAsHistory,
    members,
    detail: `${kind} on ${members.join(', ')}`,
  };
}

describe('the overlay', () => {
  it('counts findings, not affected rows', () => {
    // One cycle across four issues is ONE judgment call. Counting rows would
    // report it as four pieces of work while the list behind the count has one.
    const overlay = auditOverlay([finding('cycle', ['a', 'b', 'c', 'd'])]);
    assert.equal(overlay.count, 1);
    assert.equal(overlay.rows.length, 4);
  });

  it('lets the heaviest finding speak for a row carrying several', () => {
    const overlay = auditOverlay([
      finding('stale-blocker', ['a', 'closed']),
      finding('cycle', ['a', 'b']),
    ]);
    const row = overlay.rows.find((candidate) => candidate.ref === 'a');
    assert.equal(row?.severity, 'blocks-work');
    assert.deepEqual(row?.kinds, ['cycle', 'stale-blocker']);
    assert.equal(row?.count, 2);
  });

  it('orders rows and their classes deterministically', () => {
    const overlay = auditOverlay([
      finding('stale-blocker', ['c', 'a']),
      finding('encoding-refused', ['b']),
    ]);
    assert.deepEqual(
      overlay.rows.map((row) => row.ref),
      ['a', 'b', 'c'],
    );
  });

  it('has a count and no rows when nothing was found', () => {
    const overlay = auditOverlay([]);
    assert.equal(overlay.count, 0);
    assert.deepEqual(overlay.rows, []);
    assert.equal(overlay.byRef.size, 0);
  });

  it('snapshots the findings, so the count cannot drift from the list', () => {
    // `readonly AuditFinding[]` accepts a MUTABLE array, so a caller that
    // assembles findings from several sources and later pushes one would leave
    // `findings` growing while `count` and `rows` kept their snapshot — the
    // header count disagreeing with the list behind it, which is the one thing
    // this function promises cannot happen.
    const live: AuditFinding[] = [finding('cycle', ['a', 'b'])];
    const overlay = auditOverlay(live);
    live.push(finding('encoding-refused', ['z']));
    assert.equal(overlay.findings.length, 1);
    assert.equal(overlay.count, overlay.findings.length);
    assert.equal(Object.isFrozen(overlay.findings), true);
  });

  it('indexes exactly the rows it lists', () => {
    // The index and the list are two views of one answer, so a lookup that
    // disagreed with the rail would draw a bar on a row the list calls clean.
    const overlay = auditOverlay([
      finding('cycle', ['a', 'b']),
      finding('stale-blocker', ['c', 'closed']),
    ]);
    assert.deepEqual([...overlay.byRef.keys()].sort(), overlay.rows.map((row) => row.ref));
    for (const row of overlay.rows) assert.equal(overlay.byRef.get(row.ref), row);
  });
});

describe('the row left-bar', () => {
  it('gives an affected row the severity attribute the stylesheet draws from', () => {
    const overlay = auditOverlay([finding('dead-duplicate-ref', ['a', 'closed'])]);
    assert.deepEqual(auditRowAttributes(overlay, 'a'), {
      [AUDIT_SEVERITY_ATTRIBUTE]: 'dangerous',
    });
  });

  it('gives a clean row an empty record, never an undefined value', () => {
    // A caller spreads this unconditionally. Returning `undefined` for a clean
    // row is one `if` away from stamping the STRING "undefined" into the DOM.
    const overlay = auditOverlay([finding('cycle', ['a', 'b'])]);
    assert.deepEqual(auditRowAttributes(overlay, 'untouched'), {});
  });

  it('is drawn by the stylesheet from that attribute', () => {
    assert.match(auditStylesheet, new RegExp(`\\[${AUDIT_SEVERITY_ATTRIBUTE}\\]`));
    assert.match(auditStylesheet, /box-shadow:\s*inset var\(--ig-audit-bar-width\)/);
    assert.match(auditStylesheet, /var\(--ig-audit-bar\)/);
  });

  it('draws the bar with a shadow, not a border, so no row moves when one appears', () => {
    // §17d asks for a count that never moves. A border changes the row's box,
    // so every affected row would shift by the bar's width the moment a finding
    // arrived — the same broken promise one element over.
    const rule = /\[data-ig-audit\]\s*\{([^}]*)\}/.exec(auditStylesheet);
    assert.ok(rule !== null, 'the stylesheet draws no bar');
    assert.equal(/border/.test(rule[1] ?? ''), false);
  });

  it('keeps the audit filter to the rows a finding names', () => {
    const overlay = auditOverlay([finding('cycle', ['a', 'b'])]);
    assert.equal(auditFilterKeeps(overlay, 'a'), true);
    assert.equal(auditFilterKeeps(overlay, 'untouched'), false);
  });
});

describe('the header count', () => {
  it('renders the count', () => {
    const markup = renderAuditHeader(auditOverlay([finding('cycle', ['a', 'b'])]));
    assert.match(markup, new RegExp(`${AUDIT_COUNT_ATTRIBUTE}="1"`));
    assert.match(markup, /<span class="ig-audit-count">1<\/span>/);
  });

  it('is still drawn, and still clickable, at zero', () => {
    // "Always the same click" (§17d). A control that appears only when there is
    // bad news is a control the eye has to re-find, and audit is a FILTER, not
    // a mode you enter (§17a).
    const markup = renderAuditHeader(auditOverlay([]));
    assert.match(markup, new RegExp(`${AUDIT_COUNT_ATTRIBUTE}="0"`));
    assert.match(markup, /<button type="button"/);
    assert.match(markup, new RegExp(AUDIT_FILTER_ATTRIBUTE));
    assert.equal(/disabled/.test(markup), false);
    assert.equal(/hidden/.test(markup), false);
  });

  it('freezes what it hands out, so a render site cannot edit a finding', () => {
    const overlay = auditOverlay([finding('cycle', ['a', 'b'])]);
    assert.equal(Object.isFrozen(overlay), true);
    assert.equal(Object.isFrozen(overlay.rows), true);
    assert.equal(Object.isFrozen(overlay.rows[0]?.kinds), true);
  });

  it('says whether the filter is on, so a screen reader can too', () => {
    const overlay = auditOverlay([finding('cycle', ['a', 'b'])]);
    assert.match(renderAuditHeader(overlay), /aria-pressed="false"/);
    assert.match(renderAuditHeader(overlay, { filtered: true }), /aria-pressed="true"/);
  });

  it('renders no host-supplied text at all', () => {
    // The boundary that means this module needs no escaper: the only value that
    // reaches the markup is a number. A finding's `detail` is prose about
    // issues a host supplied, and whatever lists it owns its escaping.
    const markup = renderAuditHeader(
      auditOverlay([finding('cycle', ['<script>alert(1)</script>', 'b'])]),
    );
    assert.equal(markup.includes('<script>'), false);
    assert.equal(markup.includes('alert'), false);
  });
});

describe('what the ambient surface may never be', () => {
  // §17d, as an assertion over the bytes rather than a sentence in a doc
  // comment: no modals, toasts, red banners, badge animation, blocking the edit
  // loop, or auto-fix.
  const surfaces: readonly (readonly [string, string])[] = [
    ['the header markup', renderAuditHeader(auditOverlay([finding('cycle', ['a', 'b'])]))],
    ['the stylesheet', auditStylesheet],
  ];

  for (const [name, text] of surfaces) {
    it(`${name} carries no modal`, () => {
      assert.equal(/dialog|aria-modal|\bmodal\b|showModal/i.test(text), false);
    });

    it(`${name} carries no auto-fix affordance`, () => {
      // Every finding is a judgment call, so the surface offers navigation and
      // never a remedy.
      assert.equal(/auto-?fix|\bfix\b|\brepair\b|\bresolve\b/i.test(text), false);
    });

    it(`${name} carries no animation hook`, () => {
      assert.equal(/@keyframes|animation|animate|transition/i.test(text), false);
    });

    it(`${name} carries no toast or banner`, () => {
      assert.equal(/\btoast\b|\bbanner\b|\balert\b/i.test(text), false);
    });
  }
});

describe('the structural stylesheet', () => {
  /** Every `var(--…)` name the stylesheet references. */
  function referencedTokens(css: string): string[] {
    return [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] as string);
  }

  it('contains no literal colour', () => {
    assert.equal(/#[0-9A-Fa-f]{3,8}\b/.exec(auditStylesheet), null, 'a hex colour');
    assert.equal(/\brgba?\(/.exec(auditStylesheet), null, 'an rgb() colour');
    assert.equal(/\bhsla?\(/.exec(auditStylesheet), null, 'an hsl() colour');
    assert.equal(
      /:\s*(?:red|blue|green|black|white|grey|gray)\b/.exec(auditStylesheet),
      null,
      'a named colour',
    );
  });

  it('contains no fixed pixel length', () => {
    // `0` is unitless and carries no scale, which is why it is the one length
    // allowed to appear literally.
    assert.equal(/\d+(?:\.\d+)?px/.exec(auditStylesheet), null, 'a px length');
  });

  it('references only properties something actually sets', () => {
    // A `var()` naming a property no theme sets resolves to nothing and the
    // rule silently does not apply — the failure that reads as a styling bug
    // for weeks. Two sources, and only two: the viewer's theme, which a host
    // installing the viewer already has, and this surface's own tokens.
    const known = [...THEME_TOKENS, ...AUDIT_TOKENS];
    assert.deepEqual(
      referencedTokens(auditStylesheet).filter((token) => !known.includes(token)),
      [],
    );
  });

  it('scopes every rule to this package, so a host page is untouched', () => {
    // The viewer scopes on an `.ig-` class because it owns what it draws. The
    // bar lands on a row the VIEWER rendered, so it is scoped by this package's
    // own namespaced attribute instead — which bounds it to elements a host
    // stamped on purpose. Both are accepted; nothing else is.
    const selectors = auditStylesheet
      .split('}')
      .map((block) => block.split('{')[0]?.trim() ?? '')
      .filter((selector) => selector !== '');
    assert.ok(selectors.length > 0, 'no rules were scanned, so this proves nothing');
    for (const selector of selectors) {
      assert.match(
        selector,
        new RegExp(`(^|[\\s,])\\.ig-|\\[${AUDIT_SEVERITY_ATTRIBUTE}`),
        `"${selector}" is scoped to neither an ig- class nor the audit attribute`,
      );
    }
  });

  it('names no font family outside the type tokens', () => {
    for (const match of auditStylesheet.matchAll(/font-family:\s*([^;]+);/g)) {
      assert.match(match[1] as string, /^var\(--ig-font-(ui|mono)\)$/);
    }
  });
});

describe('the default values', () => {
  it('sets every token the stylesheet may read', () => {
    const css = auditThemeCss();
    for (const token of AUDIT_TOKENS) {
      assert.match(css, new RegExp(`${token}:`), `${token} has no default`);
    }
  });

  it('is a rule on a caller-chosen selector', () => {
    assert.match(auditThemeCss(), /^:root \{/);
    assert.match(auditThemeCss('.ig-workspace'), /^\.ig-workspace \{/);
  });

  it('keeps the values out of the stylesheet and in here', () => {
    // The split `packages/viewer/src/styles.ts` makes: structure carries no
    // value, so a host replaces one by declaring the property later and needs
    // no API to do it.
    assert.match(auditThemeCss(), /#[0-9A-Fa-f]{6}/);
    assert.match(auditThemeCss(), /\dpx/);
  });
});
