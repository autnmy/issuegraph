/**
 * The picker's words. Supplied by the host, never by this package.
 *
 * Same contract, and the same reasoning, as
 * {@link ../reevaluate/words.ts ChangeWords}: the store deliberately stops at
 * data rather than prose, and a default vocabulary here would take that choice
 * back one layer down. It is sharper for this surface than for the summary,
 * because what is being worded is a RELATIONSHIP — "is blocked by" carries a
 * word order as well as a language, and a package that shipped the phrase would
 * ship an English clause its consumers could not translate or reverse.
 *
 * SO IT IS REQUIRED, NOT DEFAULTED, exactly as `StoreConfig.derive` is: a
 * default would be a second implementation of something this layer is not
 * entitled to decide.
 *
 * ## One vocabulary, read in two places
 *
 * {@link PickerWords.kinds} words both a picker OPTION ("is blocked by", chosen
 * from a list of five) and the DIRECTION STATEMENT it produces ("#530 is
 * blocked by #602"). One entry has to read in both positions, which is the same
 * constraint `ChangeWords.facets` carries for the summary and its chips.
 *
 * A host wanting two registers — a short label in the list, a full clause in
 * the statement — renders {@link ../picker/view.ts PickerView} itself. Nothing
 * in the default render is load-bearing for that.
 */

import type { EdgeKind } from '@issuegraph/store';

export interface PickerWords {
  /**
   * One relational phrase per kind.
   *
   * `Record<EdgeKind, string>` rather than a partial map: a kind with no phrase
   * would render as a bare reference pair, which reads as a DIFFERENT
   * relationship rather than as a missing label — and mistaking one
   * relationship for another is the encoding error this surface exists to
   * prevent. A kind added to the format fails a host's build here, which is
   * where it can be fixed.
   */
  readonly kinds: Readonly<Record<EdgeKind, string>>;
  /** Names the picker for a screen reader and for a visible heading. */
  readonly heading: string;
  /** The control that reverses a directed relationship. */
  readonly flip: string;
  /**
   * Marks the option the edge already carries.
   *
   * A word rather than a colour: "which one is it now" is the question the
   * picker is opened to answer, and a purely visual answer is unavailable to a
   * screen reader and to a host with a monochrome theme.
   */
  readonly current: string;
}
