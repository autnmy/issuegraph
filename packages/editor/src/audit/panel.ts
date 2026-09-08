/**
 * §17d's findings panel: the list the ambient count is a count OF.
 *
 * `./surface.ts` draws the ambient half — the persistent header count and the
 * left-bar on an affected rail row. Neither says what was found. This module
 * draws the list, so a reader who sees `3` has somewhere to read the three.
 *
 * ## It is the module `./surface.ts` predicted
 *
 * That file's rule is *"findings travel as data; whatever lists them owns their
 * escaping"*, and it is still true of it: `renderAuditHeader` concatenates by
 * hand and is safe because the only value reaching it is a COUNT. A `detail` is
 * not a number — it is prose about issues a host supplied — so this module is
 * the lister that owns the escaping, and it owns it the way every other leaf in
 * this package does: it builds an {@link ElementSpec} tree and the caller renders
 * it through the viewer's `renderMarkup`. Nothing here writes a tag.
 *
 * ## The card is THREE lines, not the frame's four
 *
 * The frame draws a chip, a title, a mono line of the refs, and a prose
 * paragraph. `AuditFinding.detail` ALREADY OPENS WITH THE MEMBERS — `${members
 * .join(' · ')} form a blocked-by cycle; …` — so drawing a members line beside
 * it prints every reference twice. The refs are in the prose, and the card is
 * chip + title + prose.
 *
 * THE TITLE IS PER CLASS, AND THE FRAME'S ARE PER FINDING. `AuditFinding` has no
 * title field, and this package appends numbers rather than interpolating them
 * (`WorkspaceWords.whyRank` records why), so a per-finding title would need a
 * template language this package has twice refused to ship. Four fixed titles
 * keep the frame's type hierarchy at no cost to the data model; the difference
 * is a stated deviation rather than a silent one.
 *
 * ## The chip carries `data-ig-audit-kind`, NEVER `data-ig-audit`
 *
 * `./styles.ts` ends with an UNQUALIFIED `[data-ig-audit]` rule — deliberately,
 * because it lands on a row the viewer rendered and this layer may not rewrite
 * that row's `class`. So an element out here carrying the same attribute picks
 * up the rail's 2px gold left-bar whatever hue it was given, and the four-hue
 * chip mapping would draw one gold bar on all four. The severity attribute stays
 * reserved for the rail rows it was scoped for.
 *
 * ## There is no filter control here, and that is SPEC's call rather than a cut
 *
 * The frame's panel header carries `filter the rail to these`. SPEC §17a gives
 * the workspace *"an audit **filter** … for focus; an audit **mode** does not"*,
 * and §17d gives the header count one job — *"always the same click"*. That is
 * one control, which `./surface.ts` already draws and which is on screen beside
 * this panel. A second element on `data-ig-audit-filter` would be a second
 * TOGGLE for one boolean (`workspace/host.ts` flips rather than sets), one
 * announcing `aria-pressed` and one not.
 *
 * The frame needs its own because it draws the panel STANDALONE, with no
 * workspace header in the artboard. Composed, it has one.
 *
 * ## `Show the loop` is in, because §17d's rule is navigation
 *
 * `./surface.ts` states the section's own doctrine: *"every finding is a
 * judgment call, so the surface offers navigation and never a remedy."* The
 * frame's other three buttons are remedies and are deferred. This one mutates
 * nothing — it selects the finding's first member on the `select-issue` channel
 * the inspector's hold rows already publish — and without it the panel is a
 * paragraph you cannot act on or navigate from, sitting at the top of a column
 * whose whole job is the selection.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

import { type ElementSpec, element } from '@issuegraph/viewer';

import type { AuditClass, AuditFinding } from './findings.ts';
import type { AuditOverlay } from './surface.ts';

/**
 * The attribute a severity chip carries.
 *
 * ITS OWN NAME RATHER THAN `AUDIT_SEVERITY_ATTRIBUTE`, for the reason in this
 * module's header: that one is matched by an unqualified rule meant for rail
 * rows, and a chip wearing it would draw the ambient bar.
 */
export const AUDIT_KIND_ATTRIBUTE = 'data-ig-audit-kind';

/**
 * The words this package will not invent.
 *
 * TOTAL RECORDS OVER {@link AuditClass}, the shape `AUDIT_CLASS_SPECS` already
 * uses, so adding a fifth class is a type error here rather than a chip that
 * silently draws its own key.
 */
export interface AuditWords {
  /** Reads the panel's header after the count — the frame's `encoding problems`. */
  readonly heading: string;
  /** The chip on each card. The frame's `cycle`, `stale`, `dead ref`, `refused`. */
  readonly classes: Readonly<Record<AuditClass, string>>;
  /**
   * The card's title line.
   *
   * ONE PER CLASS. See this module's header for why the frame's per-finding
   * titles are not reconstructible.
   */
  readonly titles: Readonly<Record<AuditClass, string>>;
  /** The navigation control on each card — the frame's `Show the loop`. */
  readonly show: string;
}

export interface AuditPanelOptions {
  readonly words: AuditWords;
}

/**
 * The card for one finding.
 *
 * The `select-issue` target is the finding's FIRST member, and `members` is a
 * sorted set with at least one entry established where the finding is built —
 * so this cannot name nothing. It is deliberately not the "most important"
 * member: a finding names a component, no member of it leads, and picking one by
 * a rule invented here would be a second ranking nothing else in the package
 * agrees with.
 */
function cardSpec(finding: AuditFinding, words: AuditWords): ElementSpec {
  const target = finding.members[0];
  return element(
    'li',
    {
      class: 'ig-audit-card',
      [AUDIT_KIND_ATTRIBUTE]: finding.kind,
      // THE SEVERITY IS PUBLISHED, NOT DRAWN FROM. A host styling the four
      // differently needs it, and on the card — which this package owns — it
      // carries no rule of its own, so it cannot collide the way it would on a
      // chip. See the header.
      'data-ig-audit-severity': finding.severity,
    },
    [
      element('span', { class: 'ig-audit-chip', [AUDIT_KIND_ATTRIBUTE]: finding.kind }, [
        words.classes[finding.kind],
      ]),
      element('p', { class: 'ig-audit-title' }, [words.titles[finding.kind]]),
      element('p', { class: 'ig-audit-detail' }, [finding.detail]),
      target === undefined
        ? null
        : element(
            'button',
            {
              type: 'button',
              class: 'ig-audit-show',
              'data-ig-command': 'select-issue',
              'data-ig-target': target,
            },
            [words.show],
          ),
    ],
  );
}

/**
 * The panel, or `null` when there is nothing to list.
 *
 * `null` RATHER THAN AN EMPTY PANEL, and it is not the same decision as the
 * header count's. The count is drawn at zero on purpose — `./surface.ts`:
 * *"a control that appears when there is bad news is a control the eye has to
 * re-find"* — because it IS the control. A list of nothing is not a control; it
 * is a heading over an empty region in a column whose space belongs to the
 * selection. So the ambient half stays put at zero and the list goes away.
 */
export function renderAuditPanel(
  overlay: AuditOverlay,
  options: AuditPanelOptions,
): ElementSpec | null {
  if (overlay.findings.length === 0) return null;
  const { words } = options;
  return element('section', { class: 'ig-audit-panel' }, [
    element('div', { class: 'ig-audit-panel-head' }, [
      // THE MARK IS THE FRAME'S, AND IT IS NOT A WORD. `◆` is the same glyph
      // §17a puts before the ambient count, so the panel and the chip that
      // counts it read as one thing. `aria-hidden`, because it says nothing a
      // reader needs said twice — the count and the heading beside it do.
      element('span', { class: 'ig-audit-mark', 'aria-hidden': 'true' }, ['◆']),
      element('span', { class: 'ig-audit-panel-count' }, [String(overlay.count)]),
      element('span', { class: 'ig-audit-panel-heading' }, [words.heading]),
    ]),
    // ORDERED BY THE CLASS TABLE, WHICH `auditOverlay` ALREADY DID. `findings`
    // arrives in `AUDIT_CLASSES` order because `auditDocument` concatenates its
    // four detectors in that order; re-sorting here would be a second opinion
    // about severity next to `AUDIT_CLASS_SPECS`, which is the one that ranks.
    element(
      'ul',
      { class: 'ig-audit-list' },
      overlay.findings.map((finding) => cardSpec(finding, words)),
    ),
  ]);
}
