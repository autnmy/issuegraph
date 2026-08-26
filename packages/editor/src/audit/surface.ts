/**
 * The ambient half of the audit: attention without nagging.
 *
 * §17d fixes both what this is and what it may never be. It is a **persistent
 * header count** that never moves and never animates, a **left-bar** on the
 * rail rows a finding touches, and an audit **filter**. It is explicitly not a
 * modal, a toast, a red banner, an animated badge, anything that blocks the
 * edit loop, or an auto-fix — every finding is a judgment call, so the surface
 * offers navigation and never a remedy.
 *
 * §17a settles the last of those: audit is *"a filter, not a mode — a mode you
 * must enter is a mode you forget, and encoding errors need to be visible while
 * you work."* So the count is always drawn, including at zero, and the toggle
 * narrows what is listed rather than switching the workspace into something
 * else.
 *
 * ## Why the bar is CSS on an attribute rather than a drawn element
 *
 * The rows belong to `@issuegraph/viewer`, which stamps `KEY_ATTRIBUTE` on
 * them. Layer 2 composes layer 1 through its public surface, and the viewer's
 * markup primitive is deliberately not on it — so an overlay drawn from out
 * here would have to re-implement HTML escaping, which is duplication with an
 * injection shape rather than a mirror that merely drifts.
 *
 * An attribute plus a stylesheet needs neither. {@link auditRowAttributes}
 * answers what an affected row carries, `./styles.ts` draws the bar from it,
 * and the whole exchange is data. It also settles nothing about HOW
 * overlays attach, which is a separate decision with its own change.
 *
 * ## Nothing here renders host text
 *
 * The only value that reaches the markup is a COUNT, and a count is a number.
 * That is a deliberate boundary rather than a happy accident: a finding's
 * `detail` is prose about issues a host supplied, so drawing it here would put
 * an escaper in a package whose seam says it may not have one. Findings travel
 * as data; whatever lists them owns their escaping.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

import type { IssueRef } from '@issuegraph/store';

import { AUDIT_CLASSES, AUDIT_CLASS_SPECS, auditDocument } from './findings.ts';
import type { AuditClass, AuditFinding, AuditInput, AuditSeverity } from './findings.ts';

/**
 * The attribute an affected rail row carries. Its value is the severity that
 * won the row, so a host can style the four differently without this package
 * deciding that they should be.
 */
export const AUDIT_SEVERITY_ATTRIBUTE = 'data-ig-audit';

/** The attribute carrying the persistent count, for a host that reads it back. */
export const AUDIT_COUNT_ATTRIBUTE = 'data-ig-audit-count';

/**
 * The attribute marking the filter toggle, so a host can bind to it without
 * matching on a class name that is a styling hook rather than a contract.
 */
export const AUDIT_FILTER_ATTRIBUTE = 'data-ig-audit-filter';

/** What one affected row is told about itself. */
export interface AuditRow {
  readonly ref: IssueRef;
  /**
   * The severity of the heaviest finding on this row — `weight` in
   * {@link AUDIT_CLASS_SPECS}, which exists for exactly this.
   */
  readonly severity: AuditSeverity;
  /** Every class present on the row, in {@link AUDIT_CLASSES} order. */
  readonly kinds: readonly AuditClass[];
  /** How many findings name this row. */
  readonly count: number;
}

/**
 * The two things the ambient surface draws, plus the index they are looked up
 * through.
 *
 * AN IN-PROCESS VALUE, NOT A PAYLOAD — the same distinction
 * `@issuegraph/viewer` draws between its normalized document and the plain
 * shape a host sends over a wire. {@link AuditOverlay.rowFor} is a closure, so
 * this does not serialize; what crosses a boundary is the DOCUMENT, and a
 * receiver builds its own overlay from it.
 */
export interface AuditOverlay {
  /**
   * The header count: findings, not affected rows.
   *
   * FINDINGS, BECAUSE THAT IS WHAT THE OWNER WORKS THROUGH. One cycle across
   * six issues is one judgment call, not six, and counting rows would report it
   * as six pieces of work while the list has one entry.
   */
  readonly count: number;
  /** One entry per affected ref, sorted, so two renders agree. */
  readonly rows: readonly AuditRow[];
  /**
   * The row for a ref, or `undefined` when it is clean.
   *
   * A FUNCTION RATHER THAN THE INDEX ITSELF, and the difference is not
   * cosmetic: `ReadonlyMap` is a TypeScript restriction and nothing more, so
   * handing out the live `Map` let a JavaScript consumer call `.clear()` on it
   * — after which the lookups disagreed with `rows`, `findings` and `count`,
   * which is the inconsistency this whole value exists to prevent. A closure
   * over a private index cannot be reached at all, and still answers in
   * constant time, which a scan per row would not.
   */
  readonly rowFor: (ref: IssueRef) => AuditRow | undefined;
  /** The findings themselves, carried through unchanged. */
  readonly findings: readonly AuditFinding[];
}

const CLASS_ORDER: ReadonlyMap<AuditClass, number> = new Map(
  AUDIT_CLASSES.map((kind, index) => [kind, index]),
);

/**
 * Project findings onto the two things the ambient surface draws.
 *
 * Pure, and a function of the findings alone: it neither re-detects anything
 * nor reads the document, so the count on screen and the list behind it can
 * never disagree about what was found.
 */
export function auditOverlay(input: AuditInput): AuditOverlay {
  // IT RUNS THE AUDIT RATHER THAN ACCEPTING ONE. Taking a finding list made
  // this a public boundary for values TypeScript never checked, and six review
  // rounds each found a different way for one to be wrong — a mutable array, a
  // mutable `members`, a `severity` disagreeing with its `kind`, a prototype
  // key, a ref named twice, a finding naming nobody. That surface is not
  // enumerable, so it is gone instead of defended: every finding here was built
  // by the detector, with its invariants established rather than checked.
  //
  // The cost is a host that persisted findings must re-audit to draw them. That
  // is the right way round anyway — the audit is pure and cheap, and a
  // persisted finding may not describe the document being drawn.
  const findings = auditDocument(input);
  // ROWS ARE RAIL ROWS, so only a ref the document carries can have one. A
  // refusal may name an issue outside a paged document — the detector supports
  // that on purpose, because filtering findings to the loaded set would drop
  // them on exactly the issues paging has not reached — but a ROW for such a
  // ref advertises a rail entry that does not exist, and a consumer iterating
  // `rows` to filter or navigate would offer an unreachable issue. The finding
  // and the header count keep it; the row index does not.
  const carried = new Set(input.document.issues.map((issue) => issue.ref));
  const byRef = new Map<IssueRef, { kinds: Set<AuditClass>; count: number }>();
  for (const found of findings) {
    for (const ref of found.members) {
      if (!carried.has(ref)) continue;
      const existing = byRef.get(ref);
      if (existing === undefined) {
        byRef.set(ref, { kinds: new Set([found.kind]), count: 1 });
        continue;
      }
      existing.kinds.add(found.kind);
      existing.count += 1;
    }
  }
  const rows: AuditRow[] = [];
  for (const [ref, { kinds, count }] of byRef) {
    const ordered = [...kinds].sort(
      (a, b) => (CLASS_ORDER.get(a) ?? 0) - (CLASS_ORDER.get(b) ?? 0),
    );
    // The heaviest class speaks for the row. Written as a loop rather than a
    // seedless `reduce`, which throws on an empty list: a ref only enters the
    // map by carrying a finding, so the list cannot be empty today — and an
    // expression whose totality rests on an invariant stated three lines away
    // is one refactor from a TypeError.
    let heaviest: AuditClass | undefined;
    for (const kind of ordered) {
      if (heaviest === undefined || AUDIT_CLASS_SPECS[kind].weight > AUDIT_CLASS_SPECS[heaviest].weight) {
        heaviest = kind;
      }
    }
    if (heaviest === undefined) continue;
    rows.push({
      ref,
      severity: AUDIT_CLASS_SPECS[heaviest].severity,
      kinds: Object.freeze(ordered),
      count,
    });
  }
  rows.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  const index = new Map(rows.map((row) => [row.ref, row]));
  return Object.freeze({
    count: findings.length,
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
    // The index is captured, never exposed — see `rowFor`.
    rowFor: (ref: IssueRef) => index.get(ref),
    findings,
  });
}

/**
 * What an affected row carries, or an empty record when the row is clean.
 *
 * An EMPTY RECORD rather than `undefined`, so a caller spreads the answer
 * unconditionally and a clean row simply contributes nothing. A caller that
 * branched would be one `if` away from stamping `undefined` into an attribute,
 * which reads in the DOM as the string.
 */
export function auditRowAttributes(
  overlay: AuditOverlay,
  ref: IssueRef,
): Readonly<Record<string, string>> {
  const row = overlay.rowFor(ref);
  if (row === undefined) return Object.freeze({});
  return Object.freeze({ [AUDIT_SEVERITY_ATTRIBUTE]: row.severity });
}

/** Whether the audit filter would keep this row. Clean rows are hidden by it. */
export function auditFilterKeeps(overlay: AuditOverlay, ref: IssueRef): boolean {
  return overlay.rowFor(ref) !== undefined;
}

export interface AuditHeaderOptions {
  /** Whether the filter is currently narrowing the rail. Defaults to `false`. */
  readonly filtered?: boolean | undefined;
}

/**
 * The persistent header count, as markup.
 *
 * ONE CONTROL, ALWAYS PRESENT, ALWAYS THE SAME CLICK — including at zero, which
 * is why it is neither hidden nor disabled when nothing is found. A control
 * that appears when there is bad news is a control the eye has to re-find, and
 * §17d's whole ask is that the audit never demands attention it has not earned.
 *
 * A `button` with `aria-pressed`, because a filter toggle is a toggle: it has
 * two states and a screen reader has to be able to say which one is on.
 */
export function renderAuditHeader(overlay: AuditOverlay, options: AuditHeaderOptions = {}): string {
  const count = String(overlay.count);
  const pressed = options.filtered === true;
  return [
    `<div class="ig-audit" ${AUDIT_COUNT_ATTRIBUTE}="${count}">`,
    `<button type="button" class="ig-audit-toggle" aria-pressed="${String(pressed)}"`,
    ` ${AUDIT_FILTER_ATTRIBUTE}>`,
    `<span class="ig-audit-count">${count}</span>`,
    `<span class="ig-audit-label">audit</span>`,
    `</button>`,
    `</div>`,
  ].join('');
}
