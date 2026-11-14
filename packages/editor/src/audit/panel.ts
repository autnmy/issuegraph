/**
 * §17d's findings panel: the three RELATIONSHIP findings, as a list.
 *
 * `./surface.ts` draws the ambient half — the persistent header count and the
 * left-bar on an affected rail row. Neither says what was found. This module
 * draws the list, so a reader who sees a count has somewhere to read it.
 *
 * ## Four classes, one list
 *
 * `encoding-refused` used to be drawn OUTSIDE this panel, in its own block,
 * because SPEC surfaces a refusal on the issue itself. Since #296 the export
 * draws an unreadable relationship as one more note in this list, counted in
 * the one count; `./refused.ts` supplies those notes (`refusedNotes`) and
 * the issue's own row still carries its mark.
 *
 * ONE COUNT, SINCE #296. This panel's title counted its own cards while the
 * header counted every finding, so the two disagreed by the unreadable ones.
 * The export keeps one count that includes them, so the title now counts every
 * finding too. See {@link renderAuditPanel}.
 *
 * EACH FINDING IS THE EXPORT'S NOTE: a state, a title, one sentence and its
 * remedies. The chip, the walk line and the `Show` button that the sections
 * below describe were removed with #296; their reasoning is kept as history of
 * what was drawn and why it no longer is.
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
 * ## The card is THREE lines, or FOUR when the finding carries a walk
 *
 * The frame draws a chip, a title, a mono line of the refs, and a prose
 * paragraph. This module long drew three, on this argument: `AuditFinding.detail`
 * ALREADY OPENS WITH THE MEMBERS — `${members.join(' · ')} form a blocked-by
 * cycle; …` — so *"drawing a members line beside it prints every reference
 * twice"*.
 *
 * THAT ARGUMENT WAS RIGHT ABOUT A LINE THE FRAME DOES NOT DRAW. The frame's
 * third line is `#544 → #551 → #560 → #544` — a WALK, not the `·`-joined set
 * the sentence opens with. Calling it "a mono line of the refs" was the slip:
 * the line that was declined and the line drawn below are not the same line, and
 * the refs are the only thing they have in common.
 *
 * SO THE COST IS CONCEDED RATHER THAN ARGUED AWAY. On a card that carries a
 * walk the refs really do appear twice, and the head three times. What buys it
 * is the one thing the sentence cannot say: `#544 · #551 · #560` does not say
 * who waits on whom, and a stuck group's ordering is the first thing a groomer
 * needs in order to pick an edge to cut. Direction appears nowhere else on the
 * card.
 *
 * `detail` IS LEFT BYTE-IDENTICAL, and composing the walk INTO it was the
 * alternative. It is rejected on §17d rather than on the accessible name — a
 * walk-composed sentence would be collision-free by the same construction the
 * current one is, so that cost is not real. The reason is that the frame draws a
 * SEPARATE line and this section is delivered as a frame/implementation pair, so
 * folding it into the sentence deviates from the artifact the work is measured
 * against; and it would give `detail` two shapes, since a component §6.6
 * declines to order has no walk to compose.
 *
 * THE ARROW GLYPH IS `aria-hidden`, AND THAT IS A GAP RATHER THAN A WIN. The
 * only thing the line adds is direction, and the glyph does not carry it: `→`
 * announces as "right arrow", not "waits on". Announcing the line anyway would
 * repeat three refs `detail` has just named, in a form that has lost the reason
 * it was drawn — the same trade `./refused.ts`'s `↗` makes. The
 * remaining options were a visually-hidden utility this package does not have,
 * or an `aria-label` on a `p` with no role, which is not reliably announced. So
 * a screen reader hears exactly what it heard before this line existed, and the
 * ordering is genuinely lost to it. Filed, not resolved here.
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
 * AND IT WAS DRAWN ONLY FOR A LOADED MEMBER; the remedies keep that rule.
 *
 * @see https://github.com/autnmy/issuegraph/blob/main/SPEC.md
 */

import type { IssueRef } from '@issuegraph/store';
import { type ElementSpec, element, svg } from '@issuegraph/viewer';

import type { AuditClass, AuditEdge, AuditFinding, EncodingRefusal } from './findings.ts';
import { refusedNotes } from './refused.ts';
import { AUDIT_FILTER_ATTRIBUTE } from './surface.ts';
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
  /**
   * Reads the panel's title after the count, in the form the count takes: the
   * export's "1 problem to fix" and "3 problems to fix". A PAIR since #296,
   * because one word after every count read "1 problems to fix".
   */
  readonly heading: { readonly one: string; readonly other: string };
  /**
   * The card's title line.
   *
   * ONE PER CLASS. See this module's header for why the frame's per-finding
   * titles are not reconstructible.
   */
  readonly titles: Readonly<Record<AuditClass, string>>;
  /**
   * The panel head's filter control — the frame's `filter the rail to these`.
   *
   * IT LIVES HERE NOW RATHER THAN IN THE HEADER. §17d draws it in the panel
   * head, and `RULINGS.md` §3 gives the header count one job instead: anchoring
   * this overlay. One control, one meaning, each.
   */
  readonly filter: string;
  /**
   * §17d's REMEDIES, one label per control the frame draws.
   *
   * `RULINGS.md` §3 makes these required and forbids auto-fix in the same
   * breath: *"Every button it draws costs one deliberate human keystroke."*
   * None of them writes. Each selects the finding's subject and hands the work
   * to the inspector, which already owns every edit affordance — so the label
   * names the reader's INTENT and the inspector performs it.
   *
   * ONE RECORD, NOT ONE PER CLASS, because the frame gives each class its own
   * wording rather than a shared verb: a `blocked-by` is removed, a
   * `duplicate-of` is repointed, and a cycle is neither.
   */
  readonly remedies: AuditRemedyWords;
  /*
   * THE LAST TWO BELONG TO `./refused.ts`, AND THEY LIVE HERE ANYWAY. §17d is
   * one section and its words are one record: a host wiring the audit supplies
   * `AuditWords` once. `titles` is already total over `AuditClass`, which
   * includes `encoding-refused`.
   *
   * `classes`, `show` AND `refusedHeading` LEFT THIS RECORD WITH #296: the
   * export's note draws no class chip and no `Show` button, and unreadable
   * relationships are notes in the panel, under its title, not a block with a
   * heading of its own.
   */
  /** The outward link's label — the export's "Open the issue". The package draws the `↗`. */
  readonly refusedOpen: string;
  /** The reveal control's label — the export's "Rewrite it here". */
  readonly refusedRewrite: string;
}

/**
 * The four remedy labels §17d draws, and no others.
 *
 * NOT TOTAL OVER `AuditClass`, unlike `titles`. The frame gives
 * `cycle` one remedy, `stale-blocker` two, `dead-duplicate-ref` one and
 * `encoding-refused` none — the refusal's own controls are `refusedOpen` and
 * `refusedRewrite`, which already exist. A record keyed by class would make a
 * host supply a label for a button nothing draws.
 */
export interface AuditRemedyWords {
  /** The frame's `pick one edge to drop`, on a cycle. */
  readonly pickEdge: string;
  /** The frame's `Remove the edge`, on a stale blocker. */
  readonly removeEdge: string;
  /**
   * The export's "Keep as history", on a duplicate of a closed issue and
   * nowhere else (q300 on #296: the board offers it there, and only "Remove
   * the relationship" on a closed blocker).
   *
   * Drawn from {@link AuditFinding.keepAsHistory}, which the class table sets
   * — `true` for `dead-duplicate-ref` alone.
   */
  readonly keepAsHistory: string;
  /** The frame's `Repoint or clear`, on a dead duplicate ref. */
  readonly repoint: string;
}

export interface AuditPanelOptions {
  readonly words: AuditWords;
  /**
   * The edge ids the drawn surface actually holds.
   *
   * THE SAME ARGUMENT `known` MAKES ONE FIELD UP, and it needs its own field
   * for the reason a review round proved: the endpoints do not answer it. Two
   * issues can both be on the drawn page while the edge between them is NOT —
   * `mount.ts` deliberately preserves such omissions — and a remedy gated on
   * the ends alone then publishes `select-edge` for an edge the host cannot
   * resolve, leaving the reader with a button that clears their selection and
   * opens an inspector with no subject.
   *
   * That was the first fix's mistake: "both ends drawn" is a PROXY for "the
   * edge is drawn", and this is the thing itself.
   */
  readonly edges: ReadonlySet<string>;
  /**
   * Whether the rail is currently narrowed to these findings.
   *
   * The panel DRAWS the state and never holds it: §2's ruling makes the filter
   * a thing the reader can see is on and clear in one click, and the host owns
   * which rows the rail is showing.
   */
  readonly filtered?: boolean | undefined;
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
  /**
   * The host's unreadable relationships, each drawn as a note in this panel
   * (#296) with its diagnostic and the line it stopped on. The same refusals
   * `AuditInput.encodingRefused` gave the audit, so each one the title counts
   * is a note here.
   */
  readonly refusals?: readonly EncodingRefusal[] | undefined;
  /**
   * Where an issue lives, for an unreadable note's "Open the issue" link. See
   * `./refused.ts`, which owns the rule that withholds an unsafe or absent URL.
   */
  readonly issueUrl?: ((ref: IssueRef) => string | null) | undefined;
}

/** A note's state, as the export's rules name the three it draws. */
export type NoteState = 'error' | 'attention' | 'neutral';

/**
 * The state a finding's note is drawn in, as the export's rules give each
 * class: a loop is the error state, a duplicate of a closed issue the
 * attention state, and a blocker already closed the neutral state.
 */
const NOTE_STATE: Readonly<Record<AuditClass, NoteState>> = Object.freeze({
  cycle: 'error',
  'dead-duplicate-ref': 'attention',
  'encoding-refused': 'attention',
  'stale-blocker': 'neutral',
});

/**
 * The SVG children of each state's icon, as the export's boards draw them: the
 * alert circle for the error state, the triangle for attention, the clock for
 * neutral. Built in the SVG namespace, because an icon built with `element`
 * draws nothing once mounted.
 */
const NOTE_ICON: Readonly<Record<NoteState, () => readonly ElementSpec[]>> = Object.freeze({
  error: () => [
    svg('circle', { cx: '12', cy: '12', r: '10' }),
    svg('line', { x1: '12', x2: '12', y1: '8', y2: '12' }),
    svg('line', { x1: '12', x2: '12.01', y1: '16', y2: '16' }),
  ],
  attention: () => [
    svg('path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }),
    svg('path', { d: 'M12 9v4' }),
    svg('path', { d: 'M12 17h.01' }),
  ],
  neutral: () => [
    svg('circle', { cx: '12', cy: '12', r: '9' }),
    svg('path', { d: 'M12 7v5l3 2' }),
  ],
});

/**
 * A note's icon, one per state (#296). Decoration: the title says what the
 * note is about, so the icon is hidden from the accessibility tree and from the
 * tab order.
 */
export function noteIcon(state: NoteState): ElementSpec {
  return svg(
    'svg',
    { class: 'ig-audit-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    NOTE_ICON[state](),
  );
}

/**
 * The note for one finding: a state, a title, a body and its remedies (#296).
 *
 * THE EXPORT'S NOTE AND NOTHING ELSE. It drew a mono chip naming the class
 * ("loop", "closed blocker"), a walk line, and a `Show` button beside the
 * remedies; the export's problems panel draws each problem as a note in its
 * state with its title, one sentence and its remedies, so the chip, the walk
 * and the button are gone. The class still rides `data-ig-audit-kind`, and the
 * state `data-s`, for the stylesheet and for a host.
 *
 * A REMEDY IS THE WAY OUT NOW. Each one selects its subject (an edge, or a
 * loop's head), which is the navigation the `Show` button gave and more; a
 * note whose subject is off the drawn page draws no remedy, and keeps its title
 * and sentence, because the finding is still true.
 */
function cardSpec(
  finding: AuditFinding,
  known: ReadonlySet<string>,
  edges: ReadonlySet<string>,
  words: AuditWords,
): ElementSpec {
  return element(
    'li',
    {
      class: 'ig-audit-card',
      [AUDIT_KIND_ATTRIBUTE]: finding.kind,
      // THE SEVERITY IS PUBLISHED, NOT DRAWN FROM. A host styling the four
      // differently needs it, and on the card, which this package owns, it
      // carries no rule of its own.
      'data-ig-audit-severity': finding.severity,
      'data-s': NOTE_STATE[finding.kind],
    },
    [
      noteIcon(NOTE_STATE[finding.kind]),
      element('div', { class: 'ig-audit-note-text' }, [
        element('p', { class: 'ig-audit-title' }, [words.titles[finding.kind]]),
        element('p', { class: 'ig-audit-detail' }, [finding.detail]),
        remedySpec(finding, known, edges, words),
      ]),
    ],
  );
}

/**
 * The remedy controls for one finding, or `null` where the frame draws none.
 *
 * NOT ONE OF THEM WRITES. `RULINGS.md` §3 requires remedies and forbids
 * auto-fix in one breath, and the mechanism it names is the same for all of
 * them: *"Taking a remedy selects the finding's issue or edge and hands the
 * work to the inspector, which already owns every edit affordance."* So every
 * button here publishes a SELECTION, and the label says what the reader has
 * decided to do once they are there.
 *
 * THE SUBJECT IS THE FINDING'S EDGE WHERE IT HAS ONE. {@link AuditFinding.edge}
 * carries it for the two edge classes; a cycle names no single edge on purpose
 * — choosing which to drop is the judgment §17d keeps with the owner — so its
 * remedy selects the walk's head instead and the reader picks from there.
 *
 * WITHHELD RATHER THAN DRAWN INERT when the subject is missing. A finding whose
 * edge the drawn document does not carry would give a button that selects
 * nothing: §17d's own `Show the loop` already declines for exactly that reason
 * one function up, and this follows it rather than inventing a second rule.
 */
function remedySpec(
  finding: AuditFinding,
  known: ReadonlySet<string>,
  edges: ReadonlySet<string>,
  words: AuditWords,
): ElementSpec | null {
  const { remedies } = words;
  // A SELECT-EDGE BUTTON, BUILT ONCE. The two edge classes differ only in their
  // label, so the shape is written once and the difference stays a word.
  // THE EDGE ITSELF MUST BE DRAWN — not merely its two ends.
  //
  // A remedy publishes `select-edge`, and the host resolves that against the
  // document IT is drawing, which is not always the one the audit read. A
  // remedy naming an edge that document does not hold is a button that clears
  // the reader's selection and opens an inspector with no subject.
  //
  // THE FIRST VERSION OF THIS GUARD ASKED WHETHER BOTH ENDS WERE KNOWN, and a
  // review round reproduced the hole: two issues drawn, the edge between them
  // omitted — which `mount.ts` does on purpose — and both remedies rendered
  // anyway. Endpoint presence is a PROXY for edge presence and they come apart
  // exactly where it matters.
  //
  // `Show the loop` follows the same rule one function up, asking `known` about
  // the ref it will actually navigate to. This asks `edges` about the id it
  // will actually select.
  const reachable = (edge: AuditEdge): boolean => edges.has(edge.id);
  const onEdge = (label: string, tag: string): ElementSpec | null =>
    finding.edge === undefined || !reachable(finding.edge)
      ? null
      : element(
          'button',
          {
            type: 'button',
            class: 'ig-audit-remedy',
            'data-ig-remedy': tag,
            // `select-edge`, WHICH SELECTS AND DOES NOT WRITE. The inspector
            // draws the edge's own controls once it is selected; this only
            // says which edge the reader is judging.
            'data-ig-command': 'select-edge',
            'data-ig-target': finding.edge.id,
            // THE FINDING'S OWN SENTENCE, for the reason `Show the loop`
            // records above: in a screen reader's button list the name is all
            // a reader has, and any hand-picked subset of a finding's
            // attributes has two findings that agree on it.
            'aria-label': `${label} ${finding.detail}`,
          },
          [label],
        );

  switch (finding.kind) {
    // THE BOARD'S REMEDIES (q300 on #296): a closed blocker offers only
    // "Remove the relationship"; a duplicate of a closed issue offers "Change
    // or remove" and "Keep as history". The second control is gated on the
    // finding's own field rather than on the class, so asking the finding keeps
    // the two in step instead of restating the table here.
    case 'stale-blocker': {
      const remove = onEdge(remedies.removeEdge, 'remove-edge');
      return remove === null ? null : element('div', { class: 'ig-audit-remedies' }, [remove]);
    }
    case 'dead-duplicate-ref': {
      const repoint = onEdge(remedies.repoint, 'repoint');
      const keep = finding.keepAsHistory ? onEdge(remedies.keepAsHistory, 'keep-as-history') : null;
      const both = [repoint, keep].filter((spec): spec is ElementSpec => spec !== null);
      return both.length === 0 ? null : element('div', { class: 'ig-audit-remedies' }, both);
    }
    case 'cycle': {
      // THE WALK'S HEAD, NOT AN EDGE. See this function's header: the cycle is
      // about a component, and the reader chooses the edge in the inspector.
      // `walk` is absent whenever the reader declined to order the component,
      // and then there is no defensible head to name — so no button.
      const head = finding.walk?.[0];
      // AND THE HEAD HAS TO BE DRAWN, for the reason `reachable` records above.
      if (head === undefined || !known.has(head)) return null;
      return element('div', { class: 'ig-audit-remedies' }, [
        element(
          'button',
          {
            type: 'button',
            class: 'ig-audit-remedy',
            'data-ig-remedy': 'pick-edge',
            // `reveal-issue`, NEVER `select-issue`, for the reason the
            // navigation control above records: with a draft awaiting its
            // target, `workspace/host.ts` reads a POINTER as choosing that
            // target and emits a create proposal — so `select-issue` here
            // would declare a relationship while claiming to remove one.
            'data-ig-command': 'reveal-issue',
            'data-ig-target': head,
            'aria-label': `${remedies.pickEdge} ${finding.detail}`,
          },
          [remedies.pickEdge],
        ),
      ]);
    }
    // NO REMEDY. The refusal's controls are `refusedOpen` and `refusedRewrite`
    // in `./refused.ts`, and this panel does not list that class at all.
    default:
      return null;
  }
}

/**
 * The panel, or `null` when the audit found nothing.
 *
 * `null` RATHER THAN AN EMPTY PANEL, and it is not the same decision as the
 * header count's. The count is drawn at zero on purpose — `./surface.ts`:
 * *"a control that appears when there is bad news is a control the eye has to
 * re-find"* — because it IS the control. A panel titled with nothing found is
 * not; so the ambient half stays put at zero and the panel goes away.
 *
 * EVERY FINDING DECIDES, SINCE #296, and the title counts them all, the same
 * number the header shows. Unreadable relationships are notes in this panel
 * too, drawn from {@link AuditPanelOptions.refusals} by `./refused.ts`.
 */
export function renderAuditPanel(
  overlay: AuditOverlay,
  options: AuditPanelOptions,
): ElementSpec | null {
  // EVERY FINDING DECIDES WHETHER THE PANEL IS DRAWN, AND THE COUNT (#296).
  // The panel used to count and appear for its own cards alone, so the header
  // said "6 problems" over a title reading "5 problems to fix", and a document
  // whose one finding was unreadable drew no panel, so no title, at all. The
  // export keeps one count that includes relationships that could not be read,
  // so the title counts every finding and stays at one. The unreadable ones are
  // notes here too, after the three relationship classes, as `AUDIT_CLASSES`
  // orders them; their own diagnostics come from the host's refusals.
  if (overlay.count === 0) return null;
  const listed = overlay.findings.filter((finding) => finding.kind !== 'encoding-refused');
  const { words } = options;
  const notes = [
    ...listed.map((finding) => cardSpec(finding, options.known, options.edges, words)),
    ...refusedNotes(options.refusals ?? [], { words, known: options.known, issueUrl: options.issueUrl }),
  ];
  // THE FORM THE COUNT TAKES, as the header's own problem / problems does.
  const heading = overlay.count === 1 ? words.heading.one : words.heading.other;
  return element(
    'section',
    {
      class: 'ig-audit-panel',
      // A `section` WITH NO NAME IS NOT A LANDMARK AT ALL — the implicit `region`
      // role is conditional on an accessible name, so an unnamed one is exposed
      // as nothing and a reader navigating by landmark cannot find the panel.
      // `firstpass/render.ts` already names its own section from its words; this
      // is the same rule one leaf over.
      'aria-label': heading,
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
      //
      // ONE TITLE, THE COUNT INSIDE IT (#288). The export draws the head as one
      // panel title, "3 problems to fix", so the count and the host's words are
      // one heading rather than a gold figure beside an uppercase label. The
      // host's `heading` still reads after the count, as it always has.
      //
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
      element('h2', { class: 'ig-audit-panel-heading' }, [
        element('span', { class: 'ig-audit-panel-count' }, [String(overlay.count)]),
        ` ${heading}`,
      ]),
      // §17d's OWN ENTRY POINT, drawn where the frame draws it. `RULINGS.md` §2
      // already settled what it does — *"The filter hides ROWS. It never
      // touches the ORDER"* — and §3 moved it here from the header count so
      // that count could become this panel's anchor.
      //
      // `aria-pressed` IS RIGHT HERE AND WRONG ON THE HEADER. This one really
      // is a toggle with an ON state; the header's is a disclosure.
      element(
        'button',
        {
          type: 'button',
          class: 'ig-audit-filter',
          'aria-pressed': options.filtered === true ? 'true' : 'false',
          // ONE CHANNEL, NOT TWO. The mount routes this on the published
          // attribute alone, and a control carrying `data-ig-command` as well
          // would be two entries in the a11y baseline for one button.
          [AUDIT_FILTER_ATTRIBUTE]: '',
        },
        [words.filter],
      ),
    ]),
    // ORDERED BY THE CLASS TABLE, WHICH `auditOverlay` ALREADY DID. `findings`
    // arrives in `AUDIT_CLASSES` order because `auditDocument` concatenates its
    // four detectors in that order; re-sorting here would be a second opinion
    // about severity next to `AUDIT_CLASS_SPECS`, which is the one that ranks.
    // NO EMPTY LIST, for a host that counted refusals it did not pass.
    notes.length === 0 ? null : element('ul', { class: 'ig-audit-list' }, notes),
    ],
  );
}
