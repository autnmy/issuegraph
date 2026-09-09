/**
 * §17d's findings panel: the three RELATIONSHIP findings, as a list.
 *
 * `./surface.ts` draws the ambient half — the persistent header count and the
 * left-bar on an affected rail row. Neither says what was found. This module
 * draws the list, so a reader who sees a count has somewhere to read it.
 *
 * ## Three classes, not four — the fourth is `./refused.ts`'
 *
 * `encoding-refused` is drawn OUTSIDE this panel, and SPEC is why: a refusal is
 * *"surfaced on the issue itself, because until it parses the issue has no
 * edges at all and would otherwise look simply unencoded"*. The other three
 * say something about a relationship that exists; that one says the
 * relationships cannot be read.
 *
 * SO THERE ARE TWO COUNTS NOW, AND THEY ARE DIFFERENT NUMBERS ON PURPOSE.
 * `./surface.ts`'s ambient count stays every finding — it is the persistent
 * control, it sits in the workspace chrome beside both surfaces, and a reader
 * works through all four classes. The count in THIS panel's head is this
 * panel's own cards, because it is enclosed by the list it counts. See
 * {@link renderAuditPanel}.
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
 * frame's other three buttons are remedies and are deferred. Without this one
 * the panel is a paragraph you cannot act on or navigate from, sitting at the
 * top of a column whose whole job is the selection.
 *
 * IT PUBLISHES `reveal-issue`, NOT the `select-issue` the inspector's hold rows
 * use, and the difference is the whole of the control's safety. `select-issue`
 * is a POINTER: with a relationship draft awaiting its target, `workspace/host
 * .ts` reads a pointer as CHOOSING that target and emits the create proposal.
 * So "go and look" would have declared a relationship — a write, from the one
 * surface whose stated rule is that it never offers one. `reveal-issue` moves
 * the selection and abandons the draft, and can produce no edit at all.
 *
 * AND IT IS DRAWN ONLY FOR A LOADED MEMBER — see {@link navigableMember}.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

import type { IssueRef } from '@issuegraph/store';
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
  /**
   * The refused block's own heading — the frame's `Encoding refused`.
   *
   * THE LAST THREE BELONG TO `./refused.ts`, AND THEY LIVE HERE ANYWAY. §17d is
   * one section and its words are one record: a host wiring the audit supplies
   * `AuditWords` once, and splitting a second record off for the fourth class
   * would let a host supply half a section. `classes` and `titles` are already
   * total over `AuditClass`, which includes `encoding-refused` — so the words
   * for that class were never going to sit anywhere else.
   */
  readonly refusedHeading: string;
  /** The outward link's label. The package draws the `↗`. */
  readonly refusedOpen: string;
  /** The reveal control's label — the frame's `Rewrite from editor`. */
  readonly refusedRewrite: string;
}

export interface AuditPanelOptions {
  readonly words: AuditWords;
  /**
   * The keys the surface being drawn actually carries, so navigation can only
   * name somewhere the reader can arrive.
   *
   * REQUIRED, AND IT IS THE CALLER'S ANSWER RATHER THAN ONE DERIVED HERE. The
   * audit reads a document that is not always the document on screen: a host
   * audits the whole repository it holds and renders a page of it — the demo's
   * own projection audits `held` while drawing `landed`, which can be empty —
   * so a ref present in `AuditInput.document` may still have no row to reach.
   * The overlay cannot see that difference, and neither can this module.
   *
   * THE SAME SET AND THE SAME RULE `holdRow` ALREADY USES. A hold's subject
   * control is withheld for "a subject the inspector could not resolve", which
   * is this question asked one panel over; `renderWorkspace` computes the set
   * once, off the NORMALIZED document it draws, and hands it to both.
   */
  readonly known: ReadonlySet<string>;
}

/**
 * The navigable member of a finding, or `undefined` when it has none.
 *
 * THE FIRST MEMBER THE DRAWN SURFACE CARRIES, and the filter is not defensive
 * tidying. An encoding refusal is a fact the HOST asserted about an issue it
 * read, and `findings.ts` keeps one whose ref lies outside the loaded document
 * ON PURPOSE — filtering findings to the loaded set would drop them on exactly
 * the issues a paging boundary has not reached. So a finding's members are not
 * all rows, and a control targeting one that is not advertises a move it cannot
 * make: the mount reconciles the unknown selection straight back away.
 *
 * IT ASKS THE CALLER, NOT THE OVERLAY, AND THE DIFFERENCE IS NOT PEDANTRY. An
 * earlier revision used `overlay.rowFor`, which answers "does the AUDIT's
 * document carry this ref" — a different question, and the two come apart
 * exactly where a host audits more than it draws. The demo does: it audits the
 * repository it holds and renders a page of it, so a ref can be audited, have
 * an overlay row, and still reach a view with nothing in it.
 *
 * FIRST RATHER THAN "MOST IMPORTANT": a finding names a component, no member of
 * it leads, and a rule invented here would be a second ranking nothing else in
 * the package agrees with.
 */
function navigableMember(
  finding: AuditFinding,
  known: ReadonlySet<string>,
): IssueRef | undefined {
  return finding.members.find((ref) => known.has(ref));
}

/**
 * The card for one finding.
 *
 * A card whose finding names no loaded issue draws no control — see
 * {@link navigableMember}. It keeps its chip, title and sentence, because the
 * FINDING is still true and still worth reading; what it loses is a move that
 * would not have moved anything.
 */
function cardSpec(
  finding: AuditFinding,
  known: ReadonlySet<string>,
  words: AuditWords,
): ElementSpec {
  const target = navigableMember(finding, known);
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
              // `reveal-issue`, NEVER `select-issue`. The latter is a POINTER,
              // and with a draft awaiting its target `workspace/host.ts` reads a
              // pointer as choosing that target and emits the create proposal —
              // so this button would declare a relationship. §17d's surface
              // "offers navigation and never a remedy", and a control that can
              // write is a remedy whatever its label says.
              'data-ig-command': 'reveal-issue',
              // THE NAME IS THE FINDING'S OWN SENTENCE, AND THAT IS A CLASS
              // REMOVED RATHER THAN A THIRD ATTEMPT AT IT.
              //
              // Several findings mean several of these buttons, and in the one
              // navigation mode that strips the surrounding card — a screen
              // reader's BUTTON LIST — the name is all a reader has. Three
              // revisions tried to SUMMARISE a finding into that name, and each
              // summary collided on a shape the last had not met: the host's
              // word alone collided everywhere; adding the ref collided when
              // one issue carried two findings; adding the class collided when
              // two findings shared a class AND a target — `a blocked-by y` and
              // `a blocked-by z`, two closed blockers on one issue.
              //
              // The PATTERN is the defect. Any hand-picked subset of a
              // finding's attributes has two findings that agree on it, so
              // counting the collisions was never going to end. `detail` is the
              // one value that cannot collide by construction: `findings.ts`
              // composes it from the specific edge or members the finding is
              // about, and documents it as "what the reader can be told, in one
              // sentence" — so two findings with one sentence are one finding.
              //
              // IT ADDS NO ENGLISH. `detail` is already this card's visible
              // prose, so nothing is announced that is not on screen, and the
              // host's word still leads. Appended, never interpolated, the
              // `WorkspaceWords.whyRank` idiom.
              //
              // A LONG NAME IS THE RIGHT TRADE. In a button list a name is an
              // identifier before it is a label, and a distinct sentence beats
              // a short ambiguous phrase; the VISIBLE label stays the short
              // word.
              //
              // `WorkspaceWords.remove` has the same shape one leaf over and is
              // deliberately untouched — filed as #176 rather than widened.
              'data-ig-target': target,
              'aria-label': `${words.show} ${finding.detail}`,
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
 *
 * IT IS THE LISTED FINDINGS THAT DECIDE, NOT `overlay.findings`. A document
 * whose only findings are encoding refusals has a non-zero count, a bar on
 * every affected row, and NOTHING for this panel to list — so it draws the
 * refused block and no panel at all. Testing the overlay instead would have
 * drawn a panel whose head said `2` above an empty list.
 */
export function renderAuditPanel(
  overlay: AuditOverlay,
  options: AuditPanelOptions,
): ElementSpec | null {
  const listed = overlay.findings.filter((finding) => finding.kind !== 'encoding-refused');
  if (listed.length === 0) return null;
  const { words } = options;
  return element(
    'section',
    {
      class: 'ig-audit-panel',
      // A `section` WITH NO NAME IS NOT A LANDMARK AT ALL — the implicit `region`
      // role is conditional on an accessible name, so an unnamed one is exposed
      // as nothing and a reader navigating by landmark cannot find the panel.
      // `firstpass/render.ts` already names its own section from its words; this
      // is the same rule one leaf over.
      'aria-label': words.heading,
      // A TAB STOP, AND THE REASON IS NOW THE SECOND ONE ALONE. It was the
      // scroll container itself while #177's half-column bound sat on this
      // element; since §17d's fourth class moved to `./refused.ts` the bound and
      // the scrolling belong to the REGION holding both surfaces, and this panel
      // does not shrink inside it. So "there is content only scrolling reaches"
      // is no longer a fact about the panel — but the stop stays, because:
      //
      // ITS CARDS CANNOT BE RELIED ON TO CARRY THE KEYBOARD. `cardSpec` draws
      // its navigation control only for a member the drawn document actually
      // holds, so an audit whose findings all name issues outside the loaded
      // page renders no button at all. That panel has no focusable descendant,
      // and browsers disagree about putting a generic scroll container in the
      // tab order — some do, some never have. Declaring it removes the
      // disagreement rather than depending on which engine is running.
      //
      // It is already named, so this makes a NAMED region focusable rather than
      // adding an anonymous stop. `styles.ts` draws the ring it now needs.
      tabindex: '0',
    },
    [
    element('div', { class: 'ig-audit-panel-head' }, [
      // THE MARK IS THE FRAME'S, AND IT IS NOT A WORD. `◆` is the same glyph
      // §17a puts before the ambient count, so the panel and the chip that
      // counts it read as one thing. `aria-hidden`, because it says nothing a
      // reader needs said twice — the count and the heading beside it do.
      element('span', { class: 'ig-audit-mark', 'aria-hidden': 'true' }, ['◆']),
      // THIS PANEL'S OWN CARDS, NOT `overlay.count`, AND THE TWO ARE NOW
      // DIFFERENT NUMBERS. `./surface.ts`'s header count is the persistent
      // control §17d gives one job — "always the same click" — and it counts
      // every finding, because the reader works through all four classes. This
      // number is ENCLOSED IN THE SAME BOUNDED, SCROLLING SECTION AS THE LIST
      // UNDER IT, so once `encoding-refused` moved to `./refused.ts` it would
      // have printed `4` directly above three cards.
      //
      // THE FRAME AGREES: §17d's panel head reads `3 encoding problems` over
      // exactly its own three cards, with the refusal a separate card outside.
      // A count enclosed by the thing it counts is a count OF that thing.
      element('span', { class: 'ig-audit-panel-count' }, [String(listed.length)]),
      // A REAL HEADING, AT THE LEVEL ITS PLACE IN THE ZONE EARNS. A `span` left
      // the panel invisible to heading navigation and put a gap in the column's
      // outline; the caps are the stylesheet's, as they are for every other
      // heading here, so the host's word stays a word.
      //
      // `h2`, NOT `h3`, AND THE LEVEL FOLLOWS THE COMPOSITION. It was an `h3`
      // while the panel was drawn INSIDE `.ig-inspector`, under that column's
      // own `h2`. The panel is a SIBLING of it now, and `renderWorkspace`
      // concatenates the panel first — so an `h3` announced a level three
      // before the level two it claimed to sit under, describing a nesting the
      // markup does not have. Two peers, two `h2`s.
      element('h2', { class: 'ig-audit-panel-heading' }, [words.heading]),
    ]),
    // ORDERED BY THE CLASS TABLE, WHICH `auditOverlay` ALREADY DID. `findings`
    // arrives in `AUDIT_CLASSES` order because `auditDocument` concatenates its
    // four detectors in that order; re-sorting here would be a second opinion
    // about severity next to `AUDIT_CLASS_SPECS`, which is the one that ranks.
    element(
      'ul',
      { class: 'ig-audit-list' },
      listed.map((finding) => cardSpec(finding, options.known, words)),
    ),
    ],
  );
}
