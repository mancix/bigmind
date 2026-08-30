/**
 * Title ranking for wiki-link suggestions — the pure helper previously
 * embedded in the web editor's suggestion popup, now shared with mobile.
 */

export interface RankedCandidate {
  title: string;
}

export function rankTitles<T extends RankedCandidate>(
  candidates: T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: fuzzyScore(candidate.title.toLocaleLowerCase(), normalizedQuery),
    }))
    .filter(({ score }) => score >= 0)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ candidate }) => candidate);
}

export function fuzzyScore(value: string, query: string): number {
  if (!query) return 0;
  const exactIndex = value.indexOf(query);
  if (exactIndex >= 0) return exactIndex;

  let queryIndex = 0;
  let gapScore = value.length;
  for (
    let index = 0;
    index < value.length && queryIndex < query.length;
    index++
  ) {
    if (value[index] === query[queryIndex]) {
      gapScore += index;
      queryIndex += 1;
    }
  }
  return queryIndex === query.length ? gapScore : -1;
}
