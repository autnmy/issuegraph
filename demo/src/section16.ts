/**
 * §16 beside its frames: the viewer with no editor attached.
 *
 * `main.ts` mounts the grooming WORKSPACE — three zones, with the viewer inside
 * two of them — which is the right surface for the sandbox and the wrong one
 * for a fidelity comparison: the frames draw one panel at fixed widths, and a
 * screenshot has to be of that. autnmy/descant#9097's done-when named the same
 * thing: "§16 IS that test — the viewer with no editor attached."
 *
 * IT IS A HOST, LIKE EVERY OTHER PAGE HERE, and re-implements nothing. The
 * document is the sandbox's own comp scenario, run through the same
 * `explainDocument` the store's deriver runs; the clock is FIXED so a
 * screenshot is a reproduction rather than a moment.
 */

import { type Scene, initialNavigationState, navigate, renderViewer } from '@issuegraph/viewer';

import { projectDocument } from './document.ts';
import { hostFacts, runningSince } from './host.ts';
import { explainDocument } from './order.ts';
import { SCENARIOS } from './seed.ts';

/**
 * The moment the page draws itself at.
 *
 * FIXED, and that is the point. The frames print `as of 14:32 · 2m ago`, and a
 * comparison whose freshness stamp moves between screenshots is a comparison
 * with a moving part in it.
 */
const OBSERVED_AT = new Date('2026-09-06T14:30:00Z');
const NOW = new Date('2026-09-06T14:32:00Z');

function projection(): ReturnType<typeof projectDocument> {
  const scenario = SCENARIOS.comp;
  const document = scenario.document();
  const landed = { issues: document.issues, edges: document.edges };
  const explained = explainDocument(landed, scenario.holds, scenario.ranking);
  const host = hostFacts({
    rows: explained.rows,
    observedAt: OBSERVED_AT,
    now: NOW,
    running: scenario.running === undefined ? undefined : runningSince(scenario.running, NOW),
  });
  // NO REFRESH CONTROL ON A FIXED-CLOCK SURFACE. The viewer draws one only when
  // the host supplies a word for it, and this page has nothing to re-read: its
  // clock is a constant so that a screenshot is a reproduction. An enabled
  // control that cannot do anything is worse than its absence — the same rule
  // the graph's refusal states about its own capsules.
  const withoutRefresh =
    host.freshness === undefined
      ? host
      : { ...host, freshness: { asOf: host.freshness.asOf, age: host.freshness.age } };
  return projectDocument(explained, landed, withoutRefresh, scenario.caveats);
}

/** What each panel is showing right now — the state a control moves. */
interface PanelState {
  projection: 'linear' | 'graph';
  compact: boolean;
}

const PANELS: ReadonlyMap<string, PanelState> = new Map([
  ['s16a-rail', { projection: 'linear', compact: false }],
  ['s16a-column', { projection: 'linear', compact: false }],
  ['s16b-column', { projection: 'graph', compact: true }],
  ['s16b-expanded', { projection: 'graph', compact: false }],
]);

/**
 * Draw every panel, and perform what its header publishes.
 *
 * THE COMMANDS ARE THE HOST'S TO PERFORM, on BOTH channels. The viewer draws a
 * control only for a host that has said it will complete the command, and §16e
 * puts the same command on a KEY — so a page that watched for clicks alone got
 * the toggle and lost `g`, advertising a shortcut that published nothing. The
 * key decision comes from the package's own `navigate`, not from a second
 * reading of what `g` means here.
 */
function draw(): void {
  const { viewer } = projection();
  let styled = false;

  const render = (id: string, state: PanelState): void => {
    const host = document.getElementById(id);
    if (host === null) return;
    const result = renderViewer(viewer, {
      projection: state.projection,
      compact: state.compact,
      // The page performs what the header publishes, so it says so — the viewer
      // draws no control for a host that has not.
      switchable: true,
    });
    // ONE STYLESHEET FOR THE PAGE. The viewer emits the same bytes every time,
    // so installing it per panel would be four identical copies of one rule set.
    if (!styled) {
      const style = document.createElement('style');
      style.textContent = result.styles;
      document.head.append(style);
      styled = true;
    }
    host.innerHTML = result.markup;
    scenes.set(id, result.scene);
  };

  const scenes = new Map<string, Scene>();

  /** Apply one published command to the panel it came from. */
  const perform = (id: string, command: string): void => {
    const state = PANELS.get(id);
    if (state === undefined) return;
    if (command === 'projection:linear') state.projection = 'linear';
    else if (command === 'projection:graph') state.projection = 'graph';
    else if (command === 'expand') state.compact = false;
    else if (command === 'collapse') state.compact = true;
    else return;
    render(id, state);
  };

  const panelOf = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element)) return null;
    const panel = target.closest('[id]');
    return panel !== null && PANELS.has(panel.id) ? panel.id : null;
  };

  for (const [id, state] of PANELS) render(id, state);

  document.addEventListener('click', (event) => {
    const id = panelOf(event.target);
    if (id === null || !(event.target instanceof Element)) return;
    const command = event.target.closest('[data-ig-command]')?.getAttribute('data-ig-command');
    if (command !== null && command !== undefined) perform(id, command);
  });

  document.addEventListener('keydown', (event) => {
    const id = panelOf(event.target);
    const scene = id === null ? undefined : scenes.get(id);
    if (id === null || scene === undefined) return;
    // THROUGH THE PACKAGE'S OWN REDUCER, so what `g` means here and what it
    // means in a mounted viewer are one answer rather than two.
    const result = navigate(scene, initialNavigationState, event.key);
    if (result.command.kind !== 'command') return;
    event.preventDefault();
    perform(id, result.command.command);
  });
}

draw();
