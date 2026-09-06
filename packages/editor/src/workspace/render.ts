/**
 * The three-zone workspace: the package's top-level surface.
 *
 * Rail on the left, canvas in the centre, inspector on the right, with the
 * ambient audit count in the header. Every zone is COMPOSED from the leaf that
 * already owns it — this file assembles, it does not re-derive.
 *
 * | zone      | comes from                                            |
 * |-----------|-------------------------------------------------------|
 * | header    | `auditOverlay` + `renderAuditHeader`                   |
 * | rail      | `renderViewer(…, { projection: 'linear' })`, windowed  |
 * | canvas    | `renderScaleLadder`                                    |
 * | inspector | `inspectorView`, rendered here                         |
 *
 * ## The audit left-bar is applied to the rail's SPEC, never to its markup
 *
 * The rail's rows are layer 1's, and this package's standing rule is that
 * nothing splices a rendered string — that is the hand-rolled escaping surface
 * the spec grammar exists to remove, and `reevaluate/render.ts` records the
 * same decision when it nests `scene.root` rather than concatenating chips into
 * the rail.
 *
 * `scene.root` is DATA, and `KEY_ATTRIBUTE` is published, so {@link markRail}
 * walks the spec tree and adds `data-ig-audit` to the keyed rows. That is a
 * pure transform over a public value rather than a reach past a surface, and it
 * means no attribute in this file is ever escaped by anything but `renderMarkup`.
 *
 * ## A row's severity is the heaviest across its MEMBERS
 *
 * A `together-with` unit is one row and several refs, and a finding can name a
 * member that does not lead. Read off the lead alone, an affected unit renders
 * clean — which is the audit failing silently on exactly the rows where an
 * encoding error is hardest to see.
 *
 * ## The zone frames, and the one place a tag is written here
 *
 * Two of the four zones hand back a STRING rather than a spec — the ladder's
 * chrome and the audit header — so the frames are assembled by concatenation,
 * as `renderScaleLadder` already assembles its own canvas and chrome. What
 * makes that safe is not care: {@link ZONES} is a closed union of literals, so
 * no caller value can reach an attribute here at all, and `zones.test.ts` pins
 * it. Everything with a dynamic value in it goes through `renderMarkup`.
 *
 * ## Dark only
 *
 * The pass-2 brief carries "light + dark" over from pass 1; light was cut after
 * that pass, and dark-only is the decision rather than an omission. There is no
 * forked token set here and no second palette: the theme is the viewer's, and
 * `styles.ts` writes structure against its custom properties.
 */

import {
  type AttrValue,
  type ElementSpec,
  type HostFacts,
  type SpecChild,
  type Theme,
  type ViewerDocument,
  type ViewerHold,
  KEY_ATTRIBUTE,
  element,
  identity,
  normalizeDocument,
  renderMarkup,
  provenanceClause,
  renderViewer,
  resolveTheme,
  themeCss,
  viewerStylesheet,
} from '@issuegraph/viewer';

import type { ProjectedEdge } from '@issuegraph/store';

import type { AuditInput, AuditSeverity } from '../audit/findings.ts';
import { auditStylesheet } from '../audit/styles.ts';
import { edgeOverlayStylesheet } from '../overlay/styles.ts';
import {
  AUDIT_SEVERITY_ATTRIBUTE,
  type AuditOverlay,
  auditFilterKeeps,
  auditOverlay,
  heaviestRow,
  renderAuditHeader,
} from '../audit/surface.ts';
import { type ScaleState, INITIAL_SCALE_STATE } from '../scale/commands.ts';
import { renderScaleLadder } from '../scale/render.ts';
import { scaleLadderStylesheet } from '../scale/styles.ts';

import {
  type InspectorRelationship,
  type InspectorView,
  type InspectorWhyRank,
  inspectorView,
} from './inspector.ts';
import { type RailWindow, type RailWindowOptions, railWindow } from './rail.ts';
import {
  type WorkspaceSelection,
  INITIAL_SELECTION,
  selectedEdgeId,
  selectedKey,
} from './selection.ts';
import { workspaceStylesheet } from './styles.ts';

/** The four fixed positions. A closed union, which is what keeps `zone` safe. */
export const ZONES = Object.freeze(['header', 'rail', 'canvas', 'inspector'] as const);

export type Zone = (typeof ZONES)[number];

export interface WorkspaceWords {
  /** Shown in the inspector when nothing is selected. */
  readonly nothingSelected: string;
  /**
   * The control that returns to nothing selected.
   *
   * NAMED FOR WHAT IT DOES, after a round of review found the previous name
   * inviting a host to write the wrong sentence: called `clearFilter`, it read
   * as "widen the list back", and the fixture here duly labelled it "show every
   * relationship" — a button that emptied the panel it promised to fill. The
   * command it publishes is `clear`, and that is the whole of its behaviour.
   */
  readonly clearSelection: string;
  /** Names the relationships list. */
  readonly relationships: string;
  /**
   * §17a's `WHY RANK n` heading, without the number.
   *
   * THE NUMBER IS APPENDED, NOT INTERPOLATED INTO A HOST TEMPLATE. A rank is
   * the one part of this heading the package knows and the host does not, and
   * a `{n}` placeholder would make every host reimplement the substitution —
   * which is how a package that refuses to invent English ends up shipping a
   * tiny template language instead.
   */
  readonly whyRank: string;
  /**
   * The same heading for a HELD slot, which has no rank to name.
   *
   * A held slot's rank is `null` by construction (`@issuegraph/derive` assigns
   * `ready ? (rank += 1) : null`), so "why rank —" would be a heading about a
   * position that does not exist. The design's own §16d ruling is the same one:
   * a held unit prints the em dash rather than a number.
   */
  readonly whyHeld: string;
  /**
   * Joins the rest of a together unit: §17a ends *"then worked with #514 as one
   * unit"*, and this is that phrase minus the members, which the package names.
   */
  readonly workedAsOneUnit: string;
}

export interface WorkspaceOptions {
  /**
   * The words. Required, for the reason `ChangeWords` gives: this package does
   * not invent an English sentence, and a default would be one.
   */
  readonly words: WorkspaceWords;
  readonly selection?: WorkspaceSelection | undefined;
  /** The ladder's reader position — search, focus, opened isolates. */
  readonly scale?: ScaleState | undefined;
  /** Which slice of the order the rail draws. See {@link railWindow}. */
  readonly rail?: RailWindowOptions | undefined;
  /**
   * The audit's input, when the host has one.
   *
   * ABSENT MEANS "NOT RUN", NOT "CLEAN", and the two render differently: with
   * no input the header is left out entirely rather than drawn at zero, because
   * a zero the reader can trust and a zero nobody computed are different facts.
   */
  readonly audit?: AuditInput | undefined;
  /**
   * Whether the audit filter is narrowing the rail to affected rows.
   *
   * THE HEADER PUBLISHES THE TOGGLE, SO SOMETHING HAS TO HOLD ITS STATE.
   * `renderAuditHeader` draws a `button` with `aria-pressed`, and without this
   * option every render answered `false` and left the rail unnarrowed — a
   * control that could not complete the action it advertised, which is the
   * finding the scale ladder already records paying for once. The ladder's note
   * is also the resolution: layer 2 CAN narrow, and the assembling surface is
   * the layer that holds the state to narrow with.
   *
   * Ignored with no audit, because there is nothing to filter by.
   */
  readonly auditFiltered?: boolean | undefined;
  readonly theme?: Theme | undefined;
  /** The selector the theme's custom properties are written onto. */
  readonly themeSelector?: string | undefined;
  /**
   * The store's projection, for the canvas to draw each edge's write states.
   * See `ScaleLadderOptions.projected`; the workspace forwards it and reads
   * none of it, because the rail and the inspector draw no line to overlay.
   */
  readonly projected?: readonly ProjectedEdge[] | undefined;
}

export interface WorkspaceView {
  readonly selection: WorkspaceSelection;
  readonly rail: RailWindow;
  readonly inspector: InspectorView;
  /** `null` when no audit input was supplied — see {@link WorkspaceOptions.audit}. */
  readonly audit: AuditOverlay | null;
  /**
   * Whether the rail was narrowed to affected rows.
   *
   * DERIVED, not echoed: it is `auditFiltered` AND an audit to filter by, so a
   * caller reading this is reading what actually happened rather than what was
   * asked for.
   */
  readonly auditFiltered: boolean;
}

export interface WorkspaceResult {
  readonly view: WorkspaceView;
  /** The whole surface: the four zones inside one root. */
  readonly markup: string;
  /** Every stylesheet this surface needs, in install order. */
  readonly styles: string;
  readonly diagnostics: readonly string[];
}

/**
 * A zone frame.
 *
 * The only tag written by hand in this package, and it takes no caller value:
 * `zone` is one of {@link ZONES} and `inner` is already-rendered markup from
 * `renderMarkup` or from a sibling leaf's renderer.
 */
function zone(name: Zone, inner: string): string {
  return `<section class="ig-zone" data-zone="${name}">${inner}</section>`;
}

/**
 * The height the rows outside the window would have taken.
 *
 * WITHOUT THESE THE SCROLL CONTAINER CANNOT REACH THE ORDER. The rail zone
 * scrolls, and a zone containing only the drawn rows is exactly as tall as
 * those rows — so native scrolling stops at the end of the first window, and a
 * host has no scroll offset to turn into the next `start`. `addressOf` keeps
 * the MODEL complete, and a reader who cannot scroll to rank 287 does not care.
 *
 * ONE ROW HEIGHT FOR ALL OF THEM, which is an approximation and is stated as
 * one: a row carrying holds is taller than a bare one, so the scrollbar is
 * proportional rather than exact. That is the standard cost of fixed-height
 * virtualisation and the alternative — measuring rows — needs a mount, which
 * this package does not have and will not grow.
 *
 * `aria-hidden`, because a spacer is geometry: it names no row, and a reader
 * moving by rank uses the order rather than the scrollbar.
 */
function railSpacer(rows: number, edge: 'before' | 'after'): string {
  return rows === 0
    ? ''
    : renderMarkup(
        element('div', {
          class: 'ig-rail-spacer',
          'data-edge': edge,
          'aria-hidden': 'true',
          // Through `element`, so the one dynamic value here is escaped by the
          // same renderer as every other attribute in this package.
          style: `--ig-rail-rows:${String(rows)}`,
        }),
      );
}

/** The heaviest severity across a row's members, or `undefined` when clean. */
function severityForRow(
  overlay: AuditOverlay | null,
  members: readonly string[],
): AuditSeverity | undefined {
  // THE RANKING BELONGS NEXT TO THE WEIGHTS, which is why this delegates rather
  // than scanning. An earlier version walked `overlay.rows` and took the first
  // member it matched, on the stated grounds that those rows are "sorted" — and
  // they are, by `ref`, LEXICOGRAPHICALLY. So it returned whichever member
  // sorted earliest, and a `stale-blocker` on `a` masked a `cycle` on `b`: the
  // bar still appeared, understating what it was about. The comment asserting
  // the justification was the defect, not the loop.
  return overlay === null ? undefined : heaviestRow(overlay, members)?.severity;
}

/**
 * Add `data-ig-audit` to the rail's keyed rows.
 *
 * A total walk that rebuilds the tree rather than mutating it: `ElementSpec` is
 * `readonly` throughout, and a mutating walk would also be visible to the
 * caller's own copy of `scene.root`.
 */
function markRail(
  root: ElementSpec,
  severityOf: (key: string) => AuditSeverity | undefined,
): ElementSpec {
  // TYPED AS `ElementSpec -> ElementSpec` AT THE BOUNDARY, with the child walk
  // kept inside. A single function over `SpecChild` would hand `renderMarkup` a
  // union it does not take, and the obvious repair — casting the result back —
  // is the one this repository bans outright. The narrowing belongs where the
  // string case actually lives.
  const markChild = (child: SpecChild): SpecChild =>
    typeof child === 'string' ? child : markSpec(child);

  function markSpec(spec: ElementSpec): ElementSpec {
    const key = spec.attrs?.[KEY_ATTRIBUTE];
    // A KEY IS A STRING OR IT IS NOT A KEY. `AttrValue` admits numbers and
    // booleans, and `String(true)` would look up a row named "true" — which
    // resolves to nothing today and to something the day a host names an issue
    // that. Narrowed rather than coerced.
    const severity = typeof key === 'string' ? severityOf(key) : undefined;
    const children = spec.children?.map(markChild);
    const attrs: Readonly<Record<string, AttrValue>> | undefined =
      severity === undefined
        ? spec.attrs
        : { ...spec.attrs, [AUDIT_SEVERITY_ATTRIBUTE]: severity };
    return {
      ...spec,
      ...(attrs === undefined ? {} : { attrs }),
      ...(children === undefined ? {} : { children }),
    };
  }

  return markSpec(root);
}

/**
 * One relationship, as a row the reader can actually operate.
 *
 * THE COMMAND SITS ON A BUTTON, NOT ON THE `li`. A plain list item has no tab
 * stop and no native Enter/Space activation, so a `data-ig-command` on one is
 * reachable by pointer and by nothing else — and a host wiring the published
 * attributes cannot fix that without rebuilding the semantics this package
 * should have supplied. Every other command in the package is already on a
 * button; `refusalSpec`'s capsule is the same `li` + `button` shape.
 *
 * The `li` keeps the hue and the direction, because those describe the
 * relationship rather than the action.
 */
function relationshipSpec(relationship: InspectorRelationship): ElementSpec {
  return element(
    'li',
    {
      class: 'ig-relationship',
      'data-edge': relationship.field,
      // Omitted rather than falsified when the subject is not an issue: an edge
      // selection has no "my end", and `data-direction=""` would claim one.
      'data-direction': relationship.direction ?? undefined,
    },
    [
      element(
        'button',
        {
          type: 'button',
          class: 'ig-relationship-select',
          'data-ig-command': 'select-edge',
          'data-ig-target': relationship.edgeId,
        },
        [
          element('span', { class: 'ig-relationship-kind' }, [relationship.field]),
          element('span', { class: 'ig-relationship-ref' }, [relationship.from]),
          element('span', { class: 'ig-relationship-ref' }, [relationship.to]),
        ],
      ),
    ],
  );
}

/**
 * §17a's "why rank" block: the heading, and one sentence explaining the
 * position.
 *
 * THE SYMPTOM THIS PACKAGE WAS FILED FOR. `#122` names it exactly: the frame
 * gives the inspector a `WHY RANK 2` heading and a sentence, "the shipped
 * inspector shows raw tokens and no sentence, even though the package already
 * carries the function that composes provenance". It did, and this composes it.
 *
 * THE PROVENANCE CLAUSE IS LAYER 1's, AND THAT IS THE POINT. `provenanceClause`
 * is the same function the §16 rail row's provenance line is built from, so the
 * row and the panel state one fact one way. Switching on `RankProvenance` here
 * would be a second wording, free to drift from the row's the moment either is
 * edited — which is what the issue means by "composed from the existing
 * provenance model rather than a second implementation of it".
 *
 * A HOLD'S REASON IS RENDERED VERBATIM, exactly as layer 1's `holdLine` renders
 * it: `ViewerHold.reason` is host-authored, and rewording it here would put
 * this package in the business of explaining a hold whose vocabulary belongs to
 * the reader that produced it.
 *
 * WHAT DOES NOT APPEAR: a rank on a held slot. `@issuegraph/derive` assigns
 * `ready ? (rank += 1) : null`, so the two are exclusive and the heading says
 * which one it is. Frame 17a draws `#512` at rank 2 *and* "Held until #488
 * closes"; that state is unrepresentable, and PR #126 already ruled for §16
 * that the model wins and the em dash stands.
 */
function whyRankSpec(
  why: InspectorWhyRank,
  words: WorkspaceWords,
  holds: readonly ElementSpec[],
): ElementSpec {
  const held = why.rank === null;
  return element('div', { class: 'ig-why-rank', 'data-held': held ? 'true' : 'false' }, [
    element('h3', { class: 'ig-why-rank-heading' }, [
      held ? words.whyHeld : `${words.whyRank} ${String(why.rank)}`,
    ]),
    element('p', { class: 'ig-why-rank-sentence' }, [
      provenanceClause(why.provenance),
      why.unitPartners.length === 0
        ? null
        : element('span', { class: 'ig-why-rank-unit' }, [
            `${words.workedAsOneUnit} `,
            element('span', { class: 'ig-id' }, [why.unitPartners.join(', ')]),
          ]),
    ]),
    // THE HOLDS BELONG TO THE EXPLANATION, so they live inside this block
    // rather than beside it. They were briefly stated twice — once worded into
    // this sentence and once in the list below it — which is the panel telling
    // a reader the same cause in two voices.
    //
    // The LIST is what survived, because it is the half that carries the
    // holder as a control: `holdRow` publishes `select-issue` on the blocker,
    // under rules about when that control is withheld which a sentence could
    // not express. A reason inline would have discarded them.
    holds.length === 0 ? null : element('ul', { class: 'ig-inspector-holds' }, holds),
  ]);
}

/**
 * §17a's workspace header: what backlog this is, how much of it is encoded,
 * what is wrong with it, how fresh the read is, and the way into a first pass.
 *
 * IT IS UNCONDITIONAL NOW, AND THAT IS THE FIX. The zone used to be emitted
 * only when an audit overlay existed — `overlay === null ? '' : zone('header',
 * …)` — so the header WAS the audit header, and a workspace with no audit
 * input had no header at all. §17a's header carries five facts and the audit
 * count is one of them.
 *
 * WHAT IT DRAWS IS WHAT THE RAIL DOES NOT. §17a hoists the identity, the
 * counts and the freshness stamp into a header spanning all three zones, and
 * the rail below still draws the last two as layer 1's panel header — so this
 * carries the three facts that appear NOWHERE else today: what backlog this
 * is, what the audit found, and the way into a first pass.
 *
 * MOVING THE OTHER TWO IS ITS OWN CHANGE, not an omission here. Layer 1's panel
 * header is one element carrying the stamp, the refresh control, the count
 * chips AND the running-job NOW row; `SceneOptions.chrome` takes all of them or
 * none. §17a's header replaces some and its rail does not obviously replace the
 * NOW row, so which of them survives is a design ruling, and a half-made one
 * would either state a fact twice or drop a control on the way past.
 *
 * EVERY FACT COMES FROM THE PORT THAT ALREADY CARRIES IT. `ViewerDocument.host`
 * is commented "THE HOST-FACTS PORT", and #127 rejected deriving its numbers in
 * terms: "Reporting is not deriving — the host's number is still what gets
 * drawn." Counting the document here would give the header a second answer,
 * free to disagree with the rail beside it.
 *
 * OMITTED WHEN ABSENT, NEVER DEFAULTED, for the reason the audit count already
 * gives: a zero the reader can trust and a zero nobody computed are different
 * facts, and a header that invents either is worse than one that says less.
 */
function headerMarkup(host: HostFacts | undefined, auditHeader: string): string {

  // A STRING, not a spec, because one member of this zone already is one: the
  // audit header comes from its own leaf rendered, and it owns the filter
  // toggle's `aria-pressed` and the count's own omitted-when-absent rule. The
  // file's standing idiom applies — everything carrying a dynamic value goes
  // through `renderMarkup`, and only already-rendered markup is concatenated.
  const parts: string[] = [
    host?.identity === undefined || host.identity === ''
      ? ''
      : renderMarkup(element('span', { class: 'ig-workspace-identity' }, [host.identity])),

    auditHeader,
    host?.firstPass === undefined || host.firstPass === ''
      ? ''
      : renderMarkup(
          element(
            'button',
            { type: 'button', class: 'ig-workspace-firstpass', 'data-ig-command': 'first-pass' },
            [host.firstPass],
          ),
        ),
  ];

  return `<div class="ig-workspace-header">${parts.join('')}</div>`;
}

function inspectorSpec(
  view: InspectorView,
  words: WorkspaceWords,
  known: ReadonlySet<string>,
  leadOf: ReadonlyMap<string, string>,
): ElementSpec {
  const subject = view.subject;
  return element('div', { class: 'ig-inspector', 'data-subject': subject.kind }, [
    subject.kind === 'none'
      ? element('p', { class: 'ig-inspector-empty' }, [words.nothingSelected])
      : null,
    subject.kind === 'issue'
      ? element('div', { class: 'ig-inspector-issue' }, [
          element('h2', { class: 'ig-inspector-title' }, [subject.issue.title]),
          // LAYER 1's CHIP, not a second spelling of it. `identity` links the
          // qualified reference when the host gave a URL and prints it plain
          // when it did not — the rule for which is exactly the knowledge this
          // package must not carry a second copy of.
          identity(subject.issue),
          // THE RANK IS THE HEADING'S NOW, so there is no separate position
          // line: it printed the number, or the em dash for a held slot, which
          // is exactly what `WHY RANK n` and `WHY HELD` already say. Two
          // elements for one fact is how they come to disagree.
          subject.whyRank === null
            ? null
            : whyRankSpec(
                subject.whyRank,
                words,
                subject.whyRank.holds.map((hold) =>
                  holdRow(hold, known, (key) => leadOf.get(key) === leadOf.get(subject.issue.key)),
                ),
              ),
        ])
      : null,
    element(
      'div',
      { class: 'ig-inspector-relationships', 'data-filtered': view.filtered ? 'true' : 'false' },
      [
        element('h3', { class: 'ig-inspector-heading' }, [words.relationships]),
        view.filtered
          ? element(
              'button',
              { type: 'button', class: 'ig-inspector-clear', 'data-ig-command': 'clear' },
              [words.clearSelection],
            )
          : null,
        view.relationships.length === 0
          ? null
          : element(
              'ul',
              { class: 'ig-relationship-list' },
              view.relationships.map((relationship) => relationshipSpec(relationship)),
            ),
      ],
    ),
  ]);
}

/**
 * One hold in the inspector, with its cause and its subject on the markup.
 *
 * THE SUBJECT IS A CONTROL, NOT A SPAN. A held slot's holder is routinely not
 * among the members drawn — an ordinary blocker never is, a claimed serialize
 * peer sits in another component, an unresolvable reference is nowhere — so
 * before this the sentence was the only place the holder was named, and a
 * reader had to find it by hand. Publishing `select-issue` on it makes the
 * holder a deep link into the ONE selection every zone shares: the rail and
 * the canvas move to it, and the inspector re-renders on it. The same
 * `data-ig-command` protocol the relationship rows use, and the same reducer
 * (`selectionReducer`) answers it, so a host wires nothing new.
 *
 * ONLY FOR A SUBJECT THE DOCUMENT CARRIES. An unresolvable reference names an
 * issue that is in no document by definition, and a serialize peer can be a
 * weak node the host never listed; `inspectorView` answers `none` for a key it
 * cannot find, so a control for one would discard the reader's selection and
 * show nothing. The attribute is still published — the subject is a fact about
 * the hold either way — and only the control is withheld.
 *
 * AND NEVER FOR A SUBJECT IN THE INSPECTED SLOT. Two shapes reach that, and
 * the test is the SLOT rather than the key because the second one hides
 * behind a key test. A node blocked by itself is a groomed-graph defect the
 * reader still reports, as a hold whose subject is the issue being inspected —
 * and `selectionReducer` toggles a re-selection of the selected issue to
 * `none`, so a control there would close the inspector. And a
 * `together-member-unready` hold names a PARTNER in the same unit, which
 * `inspectorView` canonicalizes back to the lead already on show — the first
 * click changes nothing visible and the second clears the selection. Withheld,
 * on the same rule as above: the attribute stays, the control does not.
 *
 * `data-code` and `data-subject` mirror layer 1's `holdLine` exactly — same
 * names, same omit-when-absent rule — so a rule written against
 * `.ig-hold[data-subject]` on the rail has an exact twin in
 * `.ig-inspector-hold[data-subject]` here. Class-qualified on purpose: the
 * inspector's ROOT also carries a `data-subject` (`issue` / `edge`, what the
 * selection resolved to), so a bare `[data-subject]` reads both.
 */
function holdRow(
  hold: ViewerHold,
  known: ReadonlySet<string>,
  inInspectedSlot: (key: string) => boolean,
): ElementSpec {
  return element(
    'li',
    {
      class: 'ig-inspector-hold',
      'data-family': hold.family,
      'data-code': hold.code,
      'data-subject': hold.subject,
    },
    [
      // THE RUNNER'S WORD, as the rail draws it: the same hold must not read
      // `claimed …` in one zone and bare in the other.
      hold.family === 'tracker' && hold.label !== undefined && hold.label !== ''
        ? element('span', { class: 'ig-badge', 'data-hold': hold.label }, [hold.label])
        : null,
      hold.family === 'tracker' && hold.label !== undefined && hold.label !== '' ? ` ${hold.reason}` : hold.reason,
      hold.subject === undefined || !known.has(hold.subject) || inInspectedSlot(hold.subject)
        ? null
        : element(
            'button',
            {
              type: 'button',
              class: 'ig-inspector-hold-subject',
              'data-ig-command': 'select-issue',
              'data-ig-target': hold.subject,
            },
            [hold.subject],
          ),
    ],
  );
}

/** Render one document at one reader position, as the whole workspace. */
export function renderWorkspace(
  input: ViewerDocument,
  options: WorkspaceOptions,
): WorkspaceResult {
  const selection = options.selection ?? INITIAL_SELECTION;
  const theme = resolveTheme(options.theme);
  const overlay = options.audit === undefined ? null : auditOverlay(options.audit);

  // NORMALIZE ONCE, AT THE TOP, AND DERIVE EVERYTHING FROM THAT — this replaces
  // four separate defects rather than fixing them one at a time, and the class
  // is worth naming because it is not obvious from any one of them.
  //
  // Every zone normalizes the document it is handed; this function did NOT, so
  // it derived the window, the severity map, the filter set and the inspector's
  // relationships from the RAW input while the zones drew the normalized one.
  // Anything layer 1 drops — a duplicate placement, a self-edge, an edge naming
  // an issue the document does not carry — therefore survived in this
  // function's answers and vanished from the picture beside them. Two of the
  // shapes that reached: the inspector published a `select-edge` command for an
  // edge no zone had drawn, and a duplicate placement straddling a window
  // boundary became VALID whenever its earlier copy fell outside the window, so
  // the visible order changed with the scroll position.
  //
  // Normalizing here makes those unrepresentable instead of handled.
  // `normalizeDocument` is idempotent — measured: re-normalizing its own output
  // yields zero further diagnostics — so the zones' own passes now find nothing
  // left to drop, and this is the one place that reports what was dropped.
  const sound = normalizeDocument(input);
  const document = sound.document;
  // The keys a hold's subject control may name — see `holdRow`.
  const known: ReadonlySet<string> = new Set(document.issues.map((issue) => issue.key));
  // Which slot a key sits in, by lead — so a hold's subject that resolves to the
  // inspected slot gets no control. The same canonicalization `inspectorView`
  // applies, read off the same normalized slots.
  const leadOf: ReadonlyMap<string, string> = new Map(
    document.order.slots.flatMap((slot) => slot.members.map((member) => [member, slot.lead] as const)),
  );

  // THE FILTER NARROWS THE RAIL, AND ONLY THE RAIL. §17a gives the audit a
  // filter for focus and deliberately no mode; the canvas answers "what
  // surrounds this issue", which the filter says nothing about.
  //
  // It narrows BEFORE the window, or it would narrow only whichever rows the
  // window had already reached and read as doing nothing on a long backlog. On
  // members rather than the lead, for the reason the bar is: a finding can name
  // a member that does not lead its unit.
  const filtered = overlay !== null && options.auditFiltered === true;
  const railInput: ViewerDocument = filtered
    ? {
        ...document,
        order: {
          // EXCLUSIONS ARE ROWS TOO, and filtering only the slots left the clean
          // ones on screen while the header said the filter was on — the toggle
          // narrowing part of the rail and claiming to have narrowed it.
          slots: document.order.slots.filter((slot) =>
            slot.members.some((member) => auditFilterKeeps(overlay, member)),
          ),
          excluded: document.order.excluded.filter((exclusion) =>
            auditFilterKeeps(overlay, exclusion.key),
          ),
        },
      }
    : document;

  const rail = railWindow(railInput, options.rail ?? {});
  const railRender = renderViewer(rail.document, {
    projection: 'linear',
    theme,
    // The rail is where a selected ISSUE reads as current. An edge selection
    // resolves to no key, which is `selectedKey`'s whole job.
    selected: selectedKey(selection),
  });
  // Built once, over the window's rows, so a rail of 312 costs one pass rather
  // than one scan of `overlay.rows` per drawn row.
  const severityByKey = new Map<string, AuditSeverity>();
  for (const slot of rail.rows) {
    const severity = severityForRow(overlay, slot.members);
    if (severity !== undefined) severityByKey.set(slot.lead, severity);
  }
  // EXCLUSIONS CARRY A KEY AND RENDER A ROW, so the bar belongs on them too.
  // Built from the slots alone, the map missed exactly the row a
  // `dead-duplicate-ref` finding is about — the class most associated with an
  // exclusion in the first place — and the ambient warning went missing on the
  // one row it most obviously described.
  for (const exclusion of rail.document.order.excluded) {
    const severity = severityForRow(overlay, [exclusion.key]);
    if (severity !== undefined) severityByKey.set(exclusion.key, severity);
  }

  // THE CANVAS IS THE WHOLE DOCUMENT, NOT THE WINDOW. The window is the rail's
  // scrolling position and says nothing about what surrounds the selected
  // issue; handing the ladder a windowed document would make its budgets — and
  // therefore its refusal — depend on where the reader had scrolled to.
  const canvas = renderScaleLadder(document, {
    state: options.scale ?? INITIAL_SCALE_STATE,
    theme,
    // THE SAME ONE VALUE THE RAIL READ. Without this the canvas drew the
    // selected issue as ordinary while the rail marked it current, so the
    // single selection this surface advertises disagreed with itself between
    // two zones on every render.
    selected: selectedKey(selection),
    // AND ITS OTHER HALF. The union has two payloads, and reading only the
    // issue one left the canvas the single zone that could not see an edge
    // selection: the inspector filtered to the edge while the canvas drew it
    // as ordinary — the same disagreement the line above closed for issues,
    // still open for the other kind.
    selectedEdge: selectedEdgeId(selection),
    projected: options.projected,
  });

  const inspector = inspectorView(document, selection);

  const markup = [
    `<div class="ig-workspace">`,
    zone(
      'header',
      headerMarkup(document.host, overlay === null ? '' : renderAuditHeader(overlay, { filtered })),
    ),
    zone(
      'rail',
      [
        railSpacer(rail.before, 'before'),
        renderMarkup(markRail(railRender.scene.root, (key) => severityByKey.get(key))),
        railSpacer(rail.after, 'after'),
      ].join(''),
    ),
    zone('canvas', canvas.markup),
    zone('inspector', renderMarkup(inspectorSpec(inspector, options.words, known, leadOf))),
    `</div>`,
  ].join('');

  return {
    view: { selection, rail, inspector, audit: overlay, auditFiltered: filtered },
    markup,
    // THE THEME IS WRITTEN ONCE. Both leaves below emit their own copy of the
    // viewer's stylesheet and the theme rule, so taking `canvas.styles`
    // wholesale would install the custom properties two or three times over —
    // harmless to render and impossible to debug when a host overrides one.
    styles: [
      viewerStylesheet,
      themeCss(theme, options.themeSelector ?? ':root'),
      scaleLadderStylesheet,
      // THE CANVAS CAN DRAW A SELECTION HALO NOW, so the sheet that styles one
      // has to be installed. It is listed here rather than inherited from
      // `canvas.styles` for the reason directly above: that value carries its
      // own copy of the viewer sheet and the theme.
      // UNCONDITIONAL, unlike the audit sheet beside it. An audit overlay is a
      // whole zone a caller opts into; an edge selection arrives from a click
      // AFTER this render, so a sheet installed only when something is already
      // selected is one that is missing on exactly the render that first needs
      // it.
      edgeOverlayStylesheet,
      ...(overlay === null ? [] : [auditStylesheet]),
      workspaceStylesheet,
    ].join('\n'),
    // CONCATENATED, NOT DEDUPED — and the dedupe that used to sit here is worth
    // recording rather than deleting quietly, because it was CORRECT when it
    // was added and became wrong two commits later without being touched.
    //
    // It was added when both zones normalized the raw document independently
    // and reported the same defect twice. Normalizing once removed that source,
    // and the same `Set` then had only one thing left to collapse: the
    // deliberately REPEATED diagnostics a single pass emits, one per occurrence
    // — two identical self-edges, the same unknown member in several slots.
    // Understating how many times an input is malformed is worse than the
    // duplication it was guarding against, and it is a count a host acts on.
    //
    // Nothing replaces it, because nothing needs to: the zones now receive an
    // already-sound document, so they contribute nothing to this list at all.
    // `reports every occurrence, and the zones add nothing` pins both halves.
    diagnostics: [...sound.diagnostics, ...railRender.diagnostics, ...canvas.diagnostics],
  };
}
