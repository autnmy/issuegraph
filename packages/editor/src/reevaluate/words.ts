/**
 * The words. Supplied by the host, never by this package.
 *
 * `@issuegraph/store` ships the change as COUNTS rather than as a sentence, so
 * that a host writes "3 rows moved · 1 promoted · 1 newly held" in its own
 * words, its own order and its own language. This package is the presentation
 * over that data, and shipping a default sentence here would take the choice
 * back one layer down — the host would have a summary it could not theme away
 * and could not translate.
 *
 * SO IT IS REQUIRED, NOT DEFAULTED, on the same reasoning `StoreConfig.derive`
 * is required: "a store cannot invent an order, and a default would be a second
 * implementation of one." A default vocabulary here would be a language choice
 * this package is not entitled to make.
 *
 * That is a narrow claim, and it is worth being exact about its edge. Layer 1
 * does write fixed strings for the rail itself. This module does not re-open
 * that decision; it only declines to add a SECOND fixed string exactly where
 * the store deliberately refused to add the first.
 *
 * ## One vocabulary, read in two places
 *
 * {@link ChangeWords.facets} words both the summary line ("3 **rows moved**")
 * and the per-row chips ("**promoted**"), so each entry has to read on its own
 * as well as after a number. A host wanting two registers renders the view
 * model itself; nothing here is load-bearing for that.
 */

import type { ChangeFacet } from './view.ts';

export interface ChangeWords {
  /**
   * One word or phrase per facet.
   *
   * `Record<ChangeFacet, string>` rather than a partial map: a facet with no
   * word would render a bare number, which reads as a different quantity rather
   * than as a missing label. Adding a facet fails a host's build here, which is
   * where it can be fixed.
   */
  readonly facets: Readonly<Record<ChangeFacet, string>>;
  /**
   * Shown, on its own and in the summary's own place, when the edit landed and
   * moved nothing. Not an empty state — the finding.
   */
  readonly unchanged: string;
  /**
   * Labels the order while a write is in flight and the rows are the ones from
   * before it. The rail is greyed a step; this says why.
   */
  readonly computing: string;
  /** The dismiss control. The only thing besides the next edit that clears the summary. */
  readonly dismiss: string;
  /** How a movement chip names its direction. */
  readonly direction: Readonly<Record<'up' | 'down', string>>;
}
