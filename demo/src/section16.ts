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

import { renderViewer } from '@issuegraph/viewer';

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
  return projectDocument(explained, landed, host, scenario.caveats);
}

function draw(): void {
  const { viewer } = projection();
  const cases = [
    ['s16a-rail', 'linear', false],
    ['s16a-column', 'linear', false],
    ['s16b-column', 'graph', true],
    ['s16b-expanded', 'graph', false],
  ] as const;

  let styled = false;
  for (const [id, projectionName, compact] of cases) {
    const host = document.getElementById(id);
    if (host === null) continue;
    const result = renderViewer(viewer, { projection: projectionName, compact });
    // ONE STYLESHEET FOR THE PAGE. The viewer emits the same bytes every time,
    // so installing it per case would be four identical copies of one rule set.
    if (!styled) {
      const style = document.createElement('style');
      style.textContent = result.styles;
      document.head.append(style);
      styled = true;
    }
    host.innerHTML = result.markup;
  }
}

draw();
