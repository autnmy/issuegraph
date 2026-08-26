import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AUDIT_CLASS_SPECS } from './findings.ts';
import type { AuditClass, AuditFinding } from './findings.ts';
import {
  AUDIT_COUNT_ATTRIBUTE,
  AUDIT_FILTER_ATTRIBUTE,
  AUDIT_SEVERITY_ATTRIBUTE,
  auditFilterKeeps,
  auditOverlay,
  auditRowAttributes,
  renderAuditHeader,
} from './surface.ts';
import { auditStylesheet } from './styles.ts';

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

  it('snapshots each finding\'s members too, not only the array holding them', () => {
    // The array copy alone moves the aliasing down one level rather than
    // removing it: a mutable `members` is assignable to the readonly field, so
    // pushing a ref after construction changes what a consumer already
    // rendered while `rows` and `byRef` keep the old snapshot. `members` is the
    // last level — every other field is a primitive — so this is the whole of
    // it rather than the next instalment.
    const members: string[] = ['a', 'b'];
    const live: AuditFinding[] = [{ ...finding('cycle', ['a', 'b']), members }];
    const overlay = auditOverlay(live);
    members.push('sneaked-in');
    assert.deepEqual(overlay.findings[0]?.members, ['a', 'b']);
    assert.equal(Object.isFrozen(overlay.findings[0]), true);
    assert.equal(Object.isFrozen(overlay.findings[0]?.members), true);
    assert.deepEqual(
      overlay.rows.map((row) => row.ref),
      [...(overlay.findings[0]?.members ?? [])],
    );
  });

  it('derives the class-owned fields, so two render sites cannot disagree', () => {
    // `severity` and `keepAsHistory` belong to the CLASS, not to the finding —
    // and the row grammar already reads them off the table. A stored severity
    // that disagreed was therefore a second, editable copy of a fact the table
    // states, and it showed up as one render site calling a cycle
    // `blocks-work` while another called it `misleading`.
    const lying: AuditFinding = {
      kind: 'cycle',
      severity: 'misleading',
      keepAsHistory: true,
      members: ['a', 'b'],
      detail: 'hand-built',
    };
    const overlay = auditOverlay([lying]);
    assert.equal(overlay.findings[0]?.severity, 'blocks-work');
    assert.equal(overlay.findings[0]?.keepAsHistory, false);
    assert.equal(overlay.rows[0]?.severity, overlay.findings[0]?.severity);
    // What genuinely belongs to the finding is kept.
    assert.equal(overlay.findings[0]?.detail, 'hand-built');
  });

  it('drops a finding whose class nothing knows, rather than drawing it', () => {
    // Unreachable from TypeScript — `AuditClass` is closed — so this is the
    // JavaScript and deserialized case. Drawing it would put a row on the rail
    // whose severity nothing can resolve: an absence rendered as a value, in
    // the surface that exists to report absences.
    // DESERIALIZED RATHER THAN CAST. `JSON.parse` is the route a value like
    // this actually arrives by, and it needs no cast — which matters, because
    // this repository forbids them, and a test that had to escape the type
    // system to reach a guard would be evidence the guard was unreachable
    // rather than evidence it works.
    const fromWire: AuditFinding = JSON.parse(
      '{"kind":"invented","severity":"blocks-work","keepAsHistory":false,"members":["a"],"detail":"from a wire"}',
    );
    const overlay = auditOverlay([fromWire, finding('cycle', ['x', 'y'])]);
    assert.equal(overlay.count, 1);
    assert.deepEqual(overlay.rows.map((row) => row.ref), ['x', 'y']);
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
    // The attribute is the only handle between the two, so this is what makes
    // `auditRowAttributes` and the stylesheet one mechanism rather than two
    // that happen to agree today.
    assert.match(auditStylesheet, new RegExp(`\\[${AUDIT_SEVERITY_ATTRIBUTE}\\]`));
    assert.match(auditStylesheet, /box-shadow:\s*inset var\(--ig-stroke\)/);
    assert.match(auditStylesheet, /var\(--ig-edge-serialize-with\)/);
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
