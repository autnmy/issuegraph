/**
 * §17d's fourth class, drawn on its own rather than in the findings list.
 *
 * `./panel.ts` lists the three RELATIONSHIP findings — a cycle, a stale
 * blocker, a dead duplicate ref. This module draws the fourth, and the
 * separation is SPEC's rather than a layout preference: an encoding refusal is
 * *"surfaced on the issue itself, because until it parses the issue has no
 * edges at all and would otherwise look simply unencoded"*. The other three say
 * something about a relationship that exists; this one says the relationships
 * cannot be read, which is a statement about an ISSUE.
 *
 * ## It reads the host's refusals, not the audit's findings
 *
 * The two are the same set — `auditDocument` turns every refusal into a finding
 * — but only the refusal carries `diagnostic` and `sourceLine`, and only the
 * refusal is meant to. `AuditFinding` is one shape over four classes, so
 * declaring two fields three of them can never hold would render an absence as
 * a value in the module whose fourth class exists to refuse that; and
 * `AuditFinding.detail` is "one sentence, never parsed, never a code", so
 * recovering a source line out of it would make a sentence a wire format. See
 * {@link EncodingRefusal}.
 *
 * THE COST IS ONE DUPLICATED RULE AND IT IS STATED RATHER THAN HIDDEN.
 * `encodingRefusedFindings` deduplicates refusals by ref, first occurrence
 * winning, and {@link refusalsToDraw} applies the same rule here — so a host
 * that reports one issue twice gets one finding and one card rather than one
 * and two. `findings.ts` warns against exactly this shape ("a renderer doing it
 * would leave the HEADER COUNT wrong"), and the warning is answered rather than
 * ignored: the count is not computed here, the rule is one line rather than a
 * detector, and `./panel.test.ts` pins the arithmetic across both surfaces.
 *
 * The alternative was to drive this off `overlay.findings` filtered to the
 * class, using the refusals only as a `ref -> fields` map. That makes the two
 * surfaces a partition of one list and cannot drift by construction — a real
 * advantage — but it makes the block read a finding whose only role at that
 * point is to be a key, in order to learn a ref it was already handed.
 *
 * ## Nothing here decides that a refusal is worth drawing
 *
 * A refusal naming an issue the drawn page does not carry STILL DRAWS ITS CARD.
 * `findings.ts` keeps such a refusal on purpose — filtering to the loaded set
 * would drop findings on exactly the issues a paging boundary has not reached —
 * and `./surface.ts` deliberately gives it no rail row. What it loses is the
 * move that needs a row: see {@link revealControl}. It keeps the outward link,
 * because leaving the application does not need a local row, and it keeps its
 * prose, because the finding is true.
 *
 * ## The block is a tab stop for the same reason the panel is
 *
 * Every control here is conditional, so a block whose refusals all name
 * unloaded issues, with no URL resolver supplied, has NO focusable descendant —
 * and browsers disagree about putting a generic container in the tab order.
 * `./panel.ts` met this and settled it; this is the same answer one leaf over.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

import type { IssueRef } from '@issuegraph/store';
import { type ElementSpec, element, isLinkable } from '@issuegraph/viewer';

import type { EncodingRefusal } from './findings.ts';
import { AUDIT_KIND_ATTRIBUTE, type AuditWords } from './panel.ts';

/**
 * The class every card here carries, as a value rather than a literal at four
 * call sites.
 *
 * IT IS THE `AuditClass` MEMBER, NOT A SECOND NAME FOR IT. The chip's hue comes
 * from `./styles.ts`'s `[data-ig-audit-kind='encoding-refused']` rule, which
 * `./panel.ts` was drawing until this module took the class — so spelling it
 * differently here would leave that rule dead and the chip unstyled.
 */
const REFUSED_KIND = 'encoding-refused';

export interface EncodingRefusedBlockOptions {
  readonly words: AuditWords;
  /**
   * The keys the DRAWN surface carries.
   *
   * THE SAME SET AND THE SAME RULE `./panel.ts` AND `holdRow` USE, and it is
   * the caller's answer rather than one derived here: a host audits the whole
   * repository it holds and renders a page of it, so a ref can be audited and
   * still have no row to arrive at. Neither this module nor the overlay can see
   * that difference.
   */
  readonly known: ReadonlySet<string>;
  /**
   * Where this issue lives, in the host's own world.
   *
   * THE HOST'S ANSWER BECAUSE IT IS THE ONLY PARTY THAT HAS ONE. An
   * {@link IssueRef} is opaque here and this package holds no repository
   * identity — `check:isolation` is what keeps it that way — so a URL is not
   * derivable, only supplied.
   *
   * ABSENT, `null`, OR NOT LINKABLE ALL MEAN THE SAME THING: no link is drawn.
   * The last of those is not tidiness. An `href` runs in the host's origin, so
   * `javascript:` and `data:` are script-execution sinks that escaping does not
   * close — `renderMarkup` escapes attribute TEXT and has no opinion about
   * schemes. `@issuegraph/viewer` already owns that allowlist and canonicalizes
   * the way a URL parser does, which is what a naive scan gets wrong; a second
   * copy out here would be the mirror whose input space drifts.
   */
  readonly issueUrl?: ((ref: IssueRef) => string | null) | undefined;
}

/**
 * The refusals this block draws: deduplicated by ref, first occurrence winning.
 *
 * THE RULE IS `encodingRefusedFindings`', repeated here on purpose and stated
 * in the header. A host that reports one issue twice has one refusal, so it has
 * one finding and must have one card — an arithmetic the count depends on.
 */
function refusalsToDraw(refusals: readonly EncodingRefusal[]): readonly EncodingRefusal[] {
  const seen = new Set<IssueRef>();
  const drawn: EncodingRefusal[] = [];
  for (const refusal of refusals) {
    if (seen.has(refusal.ref)) continue;
    seen.add(refusal.ref);
    drawn.push(refusal);
  }
  return drawn;
}

/**
 * An accessible name that cannot collide, built the way this package builds
 * every other one.
 *
 * THE REF IS APPENDED, NEVER INTERPOLATED — the `WorkspaceWords.whyRank` idiom,
 * and the reason `./panel.ts` records is the one that binds here too: in a
 * screen reader's BUTTON LIST the surrounding card is gone and the name is all
 * a reader has, so two cards drawing one host word yield two controls a reader
 * cannot tell apart. The ref is unique per card by {@link refusalsToDraw}, so
 * this cannot collide by construction rather than by inspection.
 *
 * It adds no English: the ref is already the card's visible heading line.
 */
function controlName(word: string, ref: IssueRef): string {
  return `${word} ${ref}`;
}

/**
 * The outward link, or `null` when there is nowhere safe to send the reader.
 *
 * AN ANCHOR RATHER THAN A BUTTON, because it leaves the document — a control
 * that navigates away and announces itself as a button tells a reader the wrong
 * thing about what pressing it does. `rel` carries both `noreferrer` and
 * `noopener`: the new context must not be handed a reference back to this one.
 *
 * IT CARRIES A `data-ig-command` PURELY SO THE BASELINE CAN SEE IT.
 * `a11y/baseline.ts` records a control through the attribute channels it knows,
 * and an anchor bearing nothing but `href` is invisible to it — a control this
 * package ships and its own accessibility artifact cannot see is exactly what
 * that artifact exists to make impossible.
 *
 * THE MOUNT REFUSES TO DISPATCH IT, and that refusal is the other half of this
 * decision rather than an unrelated guard. Nothing handles the name, so the
 * command would come back unclaimed — but the mount schedules a redraw anyway,
 * which replaces the surface's markup and detaches this anchor mid-activation.
 * An `<a>` is exempt from the "cannot navigate" connectedness check, so the
 * navigation would still happen and the cost would have been invisible: a full
 * re-render under the reader's own click, for a command nothing acts on. See
 * `workspace/mount.ts`'s `isNavigating`, which reads this the way it already
 * reads an `input` — a control whose activation the browser owns.
 */
function openControl(
  refusal: EncodingRefusal,
  words: AuditWords,
  issueUrl: EncodingRefusedBlockOptions['issueUrl'],
): ElementSpec | null {
  if (issueUrl === undefined) return null;
  const href = issueUrl(refusal.ref);
  // TRIMMED BEFORE THE ALLOWLIST, WHICH WOULD OTHERWISE PASS IT. `isLinkable`
  // canonicalizes the way a URL parser does — it strips tabs, newlines and
  // leading controls — so a resolver answering whitespace leaves it with an
  // empty string, no scheme to object to, and a `true`. The result resolves to
  // the current document, so the control would open a second copy of the
  // workspace: not unsafe, but a move that goes nowhere, which is the rule the
  // reveal control beside it is built on.
  if (href === null || href.trim() === '') return null;
  if (!isLinkable(href)) return null;
  return element(
    'a',
    {
      class: 'ig-audit-refused-open',
      href,
      target: '_blank',
      rel: 'noreferrer noopener',
      'data-ig-command': 'open-issue-url',
      'data-ig-target': refusal.ref,
      'aria-label': controlName(words.refusedOpen, refusal.ref),
    },
    [
      words.refusedOpen,
      // THE GLYPH IS THE FRAME'S AND IT IS NOT A WORD. `aria-hidden` for the
      // reason `./panel.ts`'s `◆` is: the anchor already announces that it
      // opens elsewhere, so the arrow would be said twice.
      element('span', { class: 'ig-audit-refused-away', 'aria-hidden': 'true' }, ['↗']),
    ],
  );
}

/**
 * The control that puts the reader on the issue, or `null` when it could not
 * move them.
 *
 * IT PUBLISHES `reveal-issue`, NEVER `select-issue`, and the distinction is the
 * whole of this control's safety — the same one `./panel.ts` records.
 * `select-issue` is a POINTER: with a relationship draft awaiting its target,
 * `workspace/host.ts` reads a pointer as CHOOSING that target and emits the
 * create proposal. So a control labelled "go and rewrite this" would have
 * declared a relationship, from the surface whose stated rule is that it never
 * offers a remedy. `reveal-issue` moves the selection, abandons the draft, and
 * can produce no edit at all.
 *
 * WITHHELD FOR A REF THE DRAWN DOCUMENT DOES NOT CARRY, on `navigableMember`'s
 * rule: a control naming a row that is not there advertises a move it cannot
 * make, and the mount reconciles the unknown selection straight back away.
 */
function revealControl(
  refusal: EncodingRefusal,
  words: AuditWords,
  known: ReadonlySet<string>,
): ElementSpec | null {
  if (!known.has(refusal.ref)) return null;
  return element(
    'button',
    {
      type: 'button',
      class: 'ig-audit-refused-rewrite',
      'data-ig-command': 'reveal-issue',
      'data-ig-target': refusal.ref,
      'aria-label': controlName(words.refusedRewrite, refusal.ref),
    },
    [words.refusedRewrite],
  );
}

/**
 * The reader's own words about this refusal, and the line it stopped on.
 *
 * ONE ELEMENT HOLDING BOTH, which is what the frame draws — the diagnostic,
 * then the offending source line under it in a muted tone. Two sibling blocks
 * would read as two facts; they are one fact and its evidence.
 *
 * `null` WHEN THE HOST SUPPLIED NEITHER. A refusal is still a refusal without
 * them — `EncodingRefusal` makes both optional because "this package never
 * produces one, because it never sees a body" — and an empty mono box under the
 * ref would say a reader is missing something rather than that nobody recorded
 * it.
 */
function reasonSpec(refusal: EncodingRefusal): ElementSpec | null {
  const lines: ElementSpec[] = [];
  if (refusal.diagnostic !== undefined && refusal.diagnostic !== '') {
    lines.push(element('span', { class: 'ig-audit-refused-diagnostic' }, [refusal.diagnostic]));
  }
  if (refusal.sourceLine !== undefined && refusal.sourceLine !== '') {
    // RAW BODY TEXT REACHES `element`, NEVER A TAG THIS MODULE WROTE. It can
    // carry markup — a body is a body — and the escaping is `renderMarkup`'s,
    // which is the rule every leaf in this package renders under.
    lines.push(element('span', { class: 'ig-audit-refused-source' }, [refusal.sourceLine]));
  }
  if (lines.length === 0) return null;
  return element('div', { class: 'ig-audit-refused-reason' }, lines);
}

/** One refusal's card: the chip and ref, the reason, and what can be done. */
function refusalSpec(
  refusal: EncodingRefusal,
  options: EncodingRefusedBlockOptions,
): ElementSpec {
  const { words, known, issueUrl } = options;
  const controls = [
    openControl(refusal, words, issueUrl),
    revealControl(refusal, words, known),
  ].filter((control): control is ElementSpec => control !== null);
  return element(
    'li',
    {
      class: 'ig-audit-refused-card',
      // `data-ig-audit-kind`, NEVER `data-ig-audit`. `./styles.ts` ends with an
      // UNQUALIFIED `[data-ig-audit]` rule, deliberately, because it lands on a
      // row the viewer rendered and this layer may not rewrite that row's
      // `class` — so an element out here carrying it picks up the rail's gold
      // left-bar whatever hue it was given. `./panel.ts` records the same trap.
      [AUDIT_KIND_ATTRIBUTE]: REFUSED_KIND,
    },
    [
      element('div', { class: 'ig-audit-refused-head' }, [
        element('span', { class: 'ig-audit-chip', [AUDIT_KIND_ATTRIBUTE]: REFUSED_KIND }, [
          words.classes[REFUSED_KIND],
        ]),
        element('span', { class: 'ig-audit-refused-ref' }, [refusal.ref]),
      ]),
      reasonSpec(refusal),
      // NO EMPTY CONTROL ROW. Both controls are conditional, and a card that
      // can offer neither is inert rather than broken — see the header.
      controls.length === 0
        ? null
        : element('div', { class: 'ig-audit-refused-controls' }, controls),
    ],
  );
}

/**
 * The refused block, or `null` when the host reported no refusals.
 *
 * `null` RATHER THAN AN EMPTY BLOCK, the same call `renderAuditPanel` makes: a
 * heading over an empty region is not a control, and this zone's space belongs
 * to the selection.
 */
export function renderEncodingRefusedBlock(
  encodingRefused: readonly EncodingRefusal[],
  options: EncodingRefusedBlockOptions,
): ElementSpec | null {
  const drawn = refusalsToDraw(encodingRefused);
  if (drawn.length === 0) return null;
  const { words } = options;
  return element(
    'section',
    {
      class: 'ig-audit-refused',
      // A `section` WITH NO NAME IS NOT A LANDMARK — the implicit `region` role
      // is conditional on an accessible name, so an unnamed one is exposed as
      // nothing. `./panel.ts` states the same rule.
      'aria-label': words.refusedHeading,
      // A TAB STOP. Every control below is conditional, so this block can have
      // no focusable descendant at all — see the header.
      tabindex: '0',
    },
    [
      // A REAL HEADING, AT THE PANEL'S LEVEL. `./panel.ts` records what a `span`
      // cost it: the section went invisible to heading navigation and left a
      // gap in the column's outline. This block is drawn ABOVE that `h2` as its
      // sibling, so anything shallower here would reopen the gap the panel
      // closed — and anything deeper would claim a nesting the markup does not
      // have. Two peers, two `h2`s.
      element('h2', { class: 'ig-audit-refused-heading' }, [words.refusedHeading]),
      element(
        'ul',
        { class: 'ig-audit-refused-list' },
        drawn.map((refusal) => refusalSpec(refusal, options)),
      ),
    ],
  );
}
