/**
 * The overlay grammar, attached to a viewer scene.
 *
 * ## The constraint this module is shaped by
 *
 * Layer 2 does not know where an edge is. `index.ts` records the `together-with`
 * connector as *the one declared crossing* precisely because "only the layer
 * that computes the layout knows where its endpoints are", and that argument
 * binds anything that needs a position — an arrowhead, a chip on a node, a
 * sentence beside a line.
 *
 * So this module draws every treatment that can be stated WITHOUT a position,
 * and declares the rest as marks for whoever owns the layout.
 *
 * ## The line, and it was drawn by evidence rather than by taste
 *
 * **An overlay that REUSES the path's own position can be drawn here. One that
 * needs a NEW position cannot.**
 *
 * A halo is the path again, stroked wider. A marching or dotted ghost is the
 * path again, patterned differently. Neither moves, so neither needs to know
 * where the path goes, and cloning a solved `d` is enough.
 *
 * A conflict's second version is the case that looks identical and is not: it
 * has to sit BESIDE the line, and "beside" is the path's perpendicular — which
 * cannot be recovered from a `d` this layer does not interpret. Four review
 * rounds each found a different way that goes wrong: three strokes where a pair
 * was promised, a companion hidden underneath its twin, a companion that had
 * lost the relationship's own double-line shape, and finally a vertical offset
 * sliding ALONG a `together-with` connector that happens to run vertically —
 * `connectorPath` emits exactly that whenever the two boxes are equal width.
 *
 * Each fix was correct and the next round found the next property, because the
 * missing thing was never a property: it was the geometry. So the companion is
 * no longer drawn here at all. It travels as the `second-version` mark, placed
 * by the layer that computed the layout — the same treatment `node-chip`,
 * `terminal-cross` and `inline-reason` already get, and the same argument
 * `index.ts` makes for the `together-with` connector living in the viewer.
 *
 * What is left genuinely cannot be drawn here: `node-chip` sits on two nodes,
 * `terminal-cross` and `inline-reason` need the line's end, and
 * `second-version` needs its perpendicular. Those travel as
 * {@link EdgeOverlay.marks} for the composer to place, declared rather than
 * half-drawn here.
 *
 * ## How an edge is recognised
 *
 * Viewer edge paths publish no per-edge identity — only the `together-with`
 * connector carries one — so an edge is matched by the accessible name the
 * viewer gives it: `${from} ${treatment.label} ${to}`.
 *
 * The label is read from the viewer's OWN `treatmentFor`, never from a copy, so
 * a renamed relationship moves both sides at once. What stays local is the
 * SHAPE of that sentence, and a shape cannot be imported — so `render.test.ts`
 * pins it with a positive control that attaches to a real rendered scene. If
 * the viewer restyles its label, that control goes red rather than the overlays
 * silently ceasing to attach, which is the failure mode worth buying a test.
 *
 * Publishing an identity on edge paths would be better and is deliberately NOT
 * done here: `keyAt` reads `GROUP_ATTRIBUTE` as POINTER identity, so adding one
 * would change what a click on an edge means. That belongs to the leaf that
 * owns edge selection, not to a grammar.
 *
 * ## Attach to a freshly rendered scene, never to your own output
 *
 * The consequence of matching on the accessible name is that overlaying REWRITES
 * that name — the states are announced there — so an overlaid edge no longer
 * matches. A host renders a new scene on every state change and attaches to
 * that, which is the intended shape and is why this is a boundary rather than a
 * defect.
 *
 * Attaching to an already-overlaid scene is out of contract. It fails SAFELY
 * rather than silently: nothing matches, the scene keeps the overlays it
 * already had, and every edge is reported in {@link AttachResult.unattached}.
 * `render.test.ts` pins that, so the behaviour is a decision rather than an
 * accident. What it must never do is double the announcement, and it does not.
 *
 * ## No timer
 *
 * The marching dash is a CSS animation, which is what §17b asks for. The rule
 * is that nothing changes STATE on its own — no `setTimeout`, no `setInterval`,
 * no self-dismissal. A chip persists until the write settles, and a settled
 * failure persists until the user acts on it.
 */

import type { ProjectedEdge } from '@issuegraph/store';
import {
  type AttrValue,
  type ElementSpec,
  type Scene,
  type SpecChild,
  type Theme,
  element,
  resolveTheme,
  treatmentFor,
} from '@issuegraph/viewer';

import {
  HALO_OPACITY,
  STATE_ATTRIBUTE,
  type EdgeOverlay,
  overlayFor,
  overlayLabel,
} from './grammar.ts';

/** The class every mark this module adds carries, so a host can find them. */
export const OVERLAY_CLASS = 'ig-overlay';

/** The class the viewer puts on an edge path. Matched, never written. */
const EDGE_CLASS = 'ig-edge';

/** The class the viewer puts on a terminal marker. NEVER matched — see below. */
const TERMINAL_CLASS = 'ig-terminal';

/**
 * The class the viewer puts on a `together-with` connector.
 *
 * A `together-with` relationship is NOT drawn as an edge path — `graph.ts:657`
 * skips it outright, because it shares a rank rather than ordering anything —
 * so it is drawn as an enclosure plus this connector. Without matching it, one
 * of the five relationships could never be overlaid at all: every state on a
 * `together-with` came back `unattached`.
 */
const CONNECTOR_CLASS = 'ig-connector';

/** The attribute the connector publishes its edge identity on. */
const GROUP_ATTRIBUTE = 'data-ig-group';

export interface OverlayOptions {
  readonly theme?: Theme | undefined;
}

export interface AttachResult {
  readonly scene: Scene;
  /**
   * Every overlay applied, keyed by edge. Marks this module could not place —
   * the ones needing a position — travel here for the composer that owns the
   * layout.
   */
  readonly overlays: readonly EdgeOverlay[];
  /** Overlays whose edge the scene does not draw. Never silently dropped. */
  readonly unattached: readonly EdgeOverlay[];
}

/** The accessible name the viewer gives an edge, reconstructed from its parts. */
function edgeName(edge: ProjectedEdge): string {
  return `${edge.from} ${treatmentFor(edge.kind).label} ${edge.to}`;
}

function classesOf(attrs: Readonly<Record<string, AttrValue>> | undefined): readonly string[] {
  const value = attrs?.['class'];
  return typeof value === 'string' ? value.split(' ').filter((name) => name !== '') : [];
}

function isEdgePath(spec: ElementSpec): boolean {
  const names = classesOf(spec.attrs);
  return names.includes(EDGE_CLASS) || names.includes(CONNECTOR_CLASS);
}

/**
 * Which overlay this element carries, if any.
 *
 * TWO KEYS, AND IDENTITY IS THE BETTER ONE. A connector publishes
 * `edgeIdentity(field, from, to)` on `data-ig-group`, and that string IS
 * `StoredEdge.id` — the same function derives both — so `ProjectedEdge.id`
 * matches it with no new dependency and no reconstruction. An ordinary edge
 * path publishes no identity at all, which is the only reason the accessible
 * name is used for those.
 */
function overlayOn(
  spec: ElementSpec,
  byIdentity: ReadonlyMap<string, EdgeOverlay>,
  byName: ReadonlyMap<string, EdgeOverlay>,
): { readonly key: string; readonly overlay: EdgeOverlay } | null {
  const group = spec.attrs?.[GROUP_ATTRIBUTE];
  if (typeof group === 'string') {
    const overlay = byIdentity.get(group);
    if (overlay !== undefined) return { key: group, overlay };
  }
  const label = spec.attrs?.['aria-label'];
  if (typeof label === 'string' && classesOf(spec.attrs).includes(EDGE_CLASS)) {
    const overlay = byName.get(label);
    if (overlay !== undefined) return { key: label, overlay };
  }
  return null;
}

/**
 * The edge's own path, cloned into an overlay stroke.
 *
 * Every geometric attribute is carried across untouched and every identifying
 * one is dropped: an overlay is decoration, so it must not answer to a name,
 * take focus, or be read out a second time by a screen reader.
 */
function clonePath(spec: ElementSpec, overrides: Readonly<Record<string, AttrValue>>): ElementSpec {
  const { class: _class, role: _role, 'aria-label': _label, ...geometry } = spec.attrs ?? {};
  return {
    tag: spec.tag,
    ns: spec.ns,
    attrs: { ...geometry, 'aria-hidden': 'true', ...overrides },
  };
}

/**
 * The marks that can be drawn from the edge's own path, and nothing else.
 *
 * Order matters and is drawn back-to-front: the halo sits BEHIND the edge so it
 * reads as a glow around the line rather than a second line over it, and the
 * dash and the conflict's second version sit in front.
 */
function overlayMarks(
  spec: ElementSpec,
  overlay: EdgeOverlay,
  edge: ProjectedEdge,
  theme: Theme,
): { readonly behind: readonly ElementSpec[]; readonly front: readonly ElementSpec[] } {
  const behind: ElementSpec[] = [];
  const front: ElementSpec[] = [];

  // EVERY CLONE INHERITS THE TREATMENT, rather than the edge getting it and the
  // clones being re-specified one property at a time. Six of this PR's review
  // findings were one class — a clone that did not inherit the hue, the
  // opacity, the dash, the stroke count or the position of the thing it was
  // cloned from — and each was fixed on its own until the shape of the mistake
  // was visible. Deriving it once is what stops the seventh.
  const inherited: Record<string, AttrValue> =
    overlay.line?.opacity === null || overlay.line?.opacity === undefined
      ? {}
      : { opacity: overlay.line.opacity };

  if (overlay.halo) {
    behind.push(
      clonePath(spec, {
        ...inherited,
        class: `${OVERLAY_CLASS} ig-overlay-halo`,
        // From the grammar, never from the stylesheet — see `HALO_OPACITY`.
        opacity: HALO_OPACITY,
        // Widened from the theme's own stroke rather than from a literal, so a
        // host thickening its lines keeps the halo proportionate to them.
        'stroke-width': theme.metrics['--ig-stroke'] * 3,
        'stroke-dasharray': null,
      }),
    );
  }

  const line = overlay.line;
  if (line !== null && line.dash !== null) {
    // EVERY dash the table declares, not just the marching one. `invalid` asks
    // for `dotted` and an earlier draft drew only `marching`, so the dotted
    // ghost silently never appeared — the table declared a shape channel that
    // nothing rendered, which is a field that lies rather than a missing case.
    //
    // Drawn on a CLONE so the kind's own dash survives underneath: the pattern
    // is one of the four channels the type identity rests on, and writing
    // `stroke-dasharray` onto the edge itself would spend it.
    front.push(
      clonePath(spec, {
        ...inherited,
        class: `${OVERLAY_CLASS} ig-overlay-dash ig-overlay-${line.dash}`,
        // THE HUE HAS TO BE STATED. The clone drops `class`, so it is no longer
        // `.ig-edge` and the viewer's `.ig-edge[data-edge=…]` hue rules stop
        // applying to it — a `currentColor` stroke then resolved to the
        // inherited body-text grey and painted OVER the edge, collapsing the
        // hue channel exactly while a write was pending.
        //
        // The state's own hue where it has one (a refusal is red), and the
        // RELATIONSHIP's hue where it does not (a pending write is still a
        // `blocked-by`). Both are read from their owning table — the viewer's
        // `treatmentFor` for the kind — never copied.
        stroke: `var(${line.hueToken ?? treatmentFor(edge.kind).hueToken})`,
        'stroke-dasharray': null,
      }),
    );
  }

  return { behind, front };
}

/**
 * The attributes the overlay writes onto the edge's own path.
 *
 * The name is rebuilt from `base` — the edge's own reconstructed name — rather
 * than read back off the element. Reading the element makes the function
 * accumulate: attaching twice produced `… — writing — writing`, because the
 * second pass took the first pass's output as its starting point. Deriving it
 * from the edge every time makes a second attach a no-op, which is what a
 * caller re-rendering on every state change will do.
 */
function edgeAttributes(base: string, overlay: EdgeOverlay): Record<string, AttrValue> {
  const opacity = overlay.line?.opacity;
  return {
    [STATE_ATTRIBUTE]: overlay.attribute,
    // Re-announced, so a reader who cannot see the halo or the ghost still
    // learns the edge is selected, writing, or refused.
    'aria-label': overlayLabel(base, overlay),
    // The table is the single source for this number; the stylesheet
    // deliberately carries no opacity rule for a state.
    ...(opacity === null || opacity === undefined ? {} : { opacity }),
  };
}

/**
 * Walk a spec tree, overlaying every edge an overlay was supplied for.
 *
 * Rebuilt rather than mutated: an `ElementSpec` is `readonly` throughout, and a
 * scene that changed under a host holding a previous one would defeat exactly
 * the memoisation the viewer canonicalises its state order to enable.
 */
function overlayTree(
  spec: ElementSpec,
  context: OverlayContext,
): ElementSpec {
  const children = spec.children ?? [];
  const next: SpecChild[] = [];

  for (const child of children) {
    if (typeof child === 'string') {
      next.push(child);
      continue;
    }

    // THE TERMINAL IS NEVER TOUCHED, and this is the line that keeps the four
    // redundant channels alive. An overlay adds marks beside the type's own
    // dash, terminal, glyph and hue; it never stands in for one. `failed`'s ✕
    // travels as a MARK for the composer to add beside the terminal, which is
    // why there is no branch here that would draw over it.
    if (classesOf(child.attrs).includes(TERMINAL_CLASS)) {
      next.push(child);
      continue;
    }

    if (!isEdgePath(child)) {
      next.push(overlayTree(child, context));
      continue;
    }

    const match = overlayOn(child, context.byIdentity, context.byName);
    if (match === null || match.overlay.states.length === 0) {
      next.push(child);
      continue;
    }

    const edge = context.edgeOf.get(match.key);
    if (edge === undefined) {
      next.push(child);
      continue;
    }
    context.attached.add(match.key);

    // PER STROKE, NOT PER EDGE — and this is the class fix, not a preference.
    //
    // `serialize-with` is drawn as TWO `.ig-edge` paths, and an earlier
    // revision drew the stroke-derived marks ONCE for the pair. That is what
    // produced a single-stroke conflict companion beside a double-stroke
    // original, and it would have produced a halo around one of two parallel
    // lines next. Every mark built here is CLONED FROM A STROKE, so it belongs
    // to that stroke: clone them all and the kind's shape survives for free
    // instead of being re-derived for each new case.
    //
    // The marks that are genuinely per-edge — the chips, the ✕, the reason —
    // are not built here at all. They need a position this layer does not have,
    // so they travel as declared marks and are placed once by the composer.
    const { behind, front } = overlayMarks(child, match.overlay, edge, context.theme);

    next.push(
      ...behind,
      { ...child, attrs: { ...child.attrs, ...edgeAttributes(edgeName(edge), match.overlay) } },
      ...front,
    );
  }

  return { ...spec, children: next };
}

/** Everything the walk carries down. Grouped so the recursion takes one value. */
interface OverlayContext {
  readonly byIdentity: ReadonlyMap<string, EdgeOverlay>;
  readonly byName: ReadonlyMap<string, EdgeOverlay>;
  readonly edgeOf: ReadonlyMap<string, ProjectedEdge>;
  /** Keys that matched at least one element. */
  readonly attached: Set<string>;
  readonly theme: Theme;
}

/**
 * Overlay a scene's edges with the states their projection carries.
 *
 * Takes `ProjectedEdge`s rather than resolved overlays because an edge's kind
 * and endpoints are what identify it in the scene, and asking a caller to hand
 * those over separately is asking it to keep two things in step.
 */
export function attachEdgeOverlays(
  scene: Scene,
  edges: readonly ProjectedEdge[],
  options: OverlayOptions = {},
): AttachResult {
  const theme = resolveTheme(options.theme);
  const overlays = edges.map(overlayFor);

  const byIdentity = new Map<string, EdgeOverlay>();
  const byName = new Map<string, EdgeOverlay>();
  const edgeOf = new Map<string, ProjectedEdge>();
  for (const [index, overlay] of overlays.entries()) {
    const edge = edges[index];
    if (edge === undefined || overlay.states.length === 0) continue;
    byIdentity.set(edge.id, overlay);
    edgeOf.set(edge.id, edge);
    const name = edgeName(edge);
    byName.set(name, overlay);
    edgeOf.set(name, edge);
  }

  const attached = new Set<string>();
  const context: OverlayContext = {
    byIdentity,
    byName,
    edgeOf,
    attached,
    theme,
  };
  const root = overlayTree(scene.root, context);

  // REPORTED, NOT DROPPED. An overlay whose edge the scene does not draw is
  // ordinary — the graph projection has a node budget and falls back to
  // clusters — but it is also what a broken match looks like, and the two must
  // not be indistinguishable. A host can surface it; a test can pin it.
  //
  // Either key counts: a `together-with` is only ever drawn as a connector, so
  // it matches by identity and never by name.
  const unattached = overlays.filter((overlay, index) => {
    const edge = edges[index];
    if (edge === undefined || overlay.states.length === 0) return false;
    return !attached.has(edge.id) && !attached.has(edgeName(edge));
  });

  return { scene: { ...scene, root }, overlays, unattached };
}

/**
 * The `writing…`, `retry` and reason marks, as controls a host can dispatch.
 *
 * Positioned by whoever calls it — see the module note. It renders the control,
 * publishing what it does as data on `data-ig-overlay`, the same contract
 * `scale/render.ts` established: layer 2 publishes the control, and the mount
 * that owns the state wires it.
 *
 * The reason mark carries the store's `InvalidCode` and NO sentence. A host
 * keys its own message off the code, for the same reason `change.ts` ships
 * counts rather than prose.
 */
export function renderOverlayMark(
  overlay: EdgeOverlay,
  mark: EdgeOverlay['marks'][number],
  reasonCode?: string,
): ElementSpec {
  switch (mark) {
    case 'node-chip':
      return element(
        'span',
        { class: `${OVERLAY_CLASS} ig-overlay-chip`, 'data-ig-overlay': 'writing' },
        // The one word this package renders, and it is a STATE name rather than
        // a message — the same thing `grammar.ts` already announces to a screen
        // reader, so a host that translates translates one vocabulary.
        ['writing…'],
      );
    case 'terminal-cross':
      return element(
        'span',
        {
          class: `${OVERLAY_CLASS} ig-overlay-cross`,
          'data-ig-overlay': 'failed',
          role: 'img',
          'aria-label': 'failed',
        },
        // THE GLYPH IS THE MARK. An earlier draft returned this span EMPTY,
        // carrying colour and typography and no shape — so `failed` lost the
        // one cue that separates it from `invalid` without colour, which is the
        // whole reason a terminal mark is drawn rather than a hue changed.
        //
        // A glyph rather than a word, for the same reason the viewer's edge
        // vocabulary uses ⊘ ⇄ ⧉ ≡ ⑃: it is the non-colour channel, and it needs
        // no translation.
        ['✕'],
      );
    case 'inline-reason':
      // A SLOT, NOT A GLYPH — and the distinction is deliberate rather than an
      // oversight of the same class as the empty ✕ above. This element is
      // EMPTY because the sentence is the host's: the package publishes the
      // store's stable `InvalidCode` and the host keys its own message off it,
      // exactly as `change.ts` ships counts rather than prose. `data-ig-slot`
      // says so out loud, so an empty element here reads as intended rather
      // than as the bug it looked like one case up.
      return element('span', {
        class: `${OVERLAY_CLASS} ig-overlay-reason`,
        'data-ig-overlay': 'reason',
        'data-ig-slot': 'reason',
        'data-ig-code': reasonCode ?? null,
      });
    case 'second-version':
      // Also a slot. The held version is DRAWN by `attachEdgeOverlays` as the
      // companion stroke; what a host adds here is whatever labels or offers to
      // act on it — view-diff, retry-on-latest, discard-mine. Never a merge.
      return element('span', {
        class: `${OVERLAY_CLASS} ig-overlay-held`,
        'data-ig-overlay': 'conflict',
        'data-ig-slot': 'held-version',
        'aria-label': overlayLabel('', overlay).trim(),
      });
  }
}
