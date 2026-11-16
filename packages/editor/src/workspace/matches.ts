/**
 * The one rule for which issues a typed search offers (#249): the issues whose
 * key or title holds the trimmed, lower-cased query, minus the ones the caller
 * excludes, at most `limit`. An empty query offers none. The single-edit target
 * search (`targetMatches`) and the batch Inspector's one-issue search both ask
 * it, so the two cannot come to disagree.
 */
export function issueMatches<T extends { readonly title: string }>(
  issues: readonly T[],
  keyOf: (issue: T) => string,
  query: string,
  excluded: (key: string) => boolean,
  limit = 8,
): readonly T[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  return issues
    .filter((issue) => !excluded(keyOf(issue)))
    .filter((issue) => keyOf(issue).toLowerCase().includes(needle) || issue.title.toLowerCase().includes(needle))
    .slice(0, limit);
}
