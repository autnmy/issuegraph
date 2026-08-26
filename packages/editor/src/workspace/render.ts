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
  type SpecChild,
  type Theme,
  type ViewerDocument,
  KEY_ATTRIBUTE,
  element,
  normalizeDocument,
  renderMarkup,
  renderViewer,
  resolveTheme,
  themeCss,
  viewerStylesheet,
} from '@issuegraph/viewer';

import type { AuditInput, AuditSeverity } from '../audit/findings.ts';
import { auditStylesheet } from '../audit/styles.ts';
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

import { type InspectorRelationship, type InspectorView, inspectorView } from './inspector.ts';
import { type RailWindow, type RailWindowOptions, railWindow } from './rail.ts';
import { type WorkspaceSelection, INITIAL_SELECTION, selectedKey } from './selection.ts';
import { workspaceStylesheet } from './styles.ts';

/** The four fixed positions. A closed union, which is what keeps `zone` safe. */
export const ZONES = Object.freeze(['header', 'rail', 'canvas', 'inspector'] as const);

export type Zone = (typeof ZONES)[number];

export interface WorkspaceWords {
  /** Shown in the inspector when nothing is selected. */
  readonly nothingSelected: string;
  /** The control that clears an edge filter. */
  readonly clearFilter: string;
  /** Names the relationships list. */
  readonly relationships: string;
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

function inspectorSpec(view: InspectorView, words: WorkspaceWords): ElementSpec {
  const subject = view.subject;
  return element('div', { class: 'ig-inspector', 'data-subject': subject.kind }, [
    subject.kind === 'none'
      ? element('p', { class: 'ig-inspector-empty' }, [words.nothingSelected])
      : null,
    subject.kind === 'issue'
      ? element('div', { class: 'ig-inspector-issue' }, [
          element('h2', { class: 'ig-inspector-title' }, [subject.issue.title]),
          element('span', { class: 'ig-inspector-key' }, [subject.issue.key]),
          subject.position === null
            ? null
            : element(
                'p',
                {
                  class: 'ig-inspector-position',
                  'data-ready': subject.position.ready ? 'true' : 'false',
                },
                // A HELD SLOT PRINTS THE VIEWER'S EM DASH, not a number. It has
                // no position in the sequence, and printing one would claim work
                // is queued that nothing can start.
                [subject.position.rank === null ? '—' : String(subject.position.rank)],
              ),
          subject.position === null || subject.position.holds.length === 0
            ? null
            : element(
                'ul',
                { class: 'ig-inspector-holds' },
                subject.position.holds.map((hold) =>
                  element('li', { class: 'ig-inspector-hold', 'data-family': hold.family }, [
                    hold.reason,
                  ]),
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
              [words.clearFilter],
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
  });

  const inspector = inspectorView(document, selection);

  const markup = [
    `<div class="ig-workspace">`,
    overlay === null ? '' : zone('header', renderAuditHeader(overlay, { filtered })),
    zone(
      'rail',
      [
        railSpacer(rail.before, 'before'),
        renderMarkup(markRail(railRender.scene.root, (key) => severityByKey.get(key))),
        railSpacer(rail.after, 'after'),
      ].join(''),
    ),
    zone('canvas', canvas.markup),
    zone('inspector', renderMarkup(inspectorSpec(inspector, options.words))),
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
      ...(overlay === null ? [] : [auditStylesheet]),
      workspaceStylesheet,
    ].join('\n'),
    // THE NORMALIZE PASS REPORTS FIRST, because it is now the one that actually
    // drops anything; the zones re-normalize an already-sound document and find
    // nothing left. Still deduped: the two zones each normalize what they are
    // given, so an identical string from both would otherwise state one input
    // error twice, and nothing here carries zone attribution to tell them
    // apart. Insertion order is preserved.
    diagnostics: [
      ...new Set([...sound.diagnostics, ...railRender.diagnostics, ...canvas.diagnostics]),
    ],
  };
}
