/**
 * Subsequence match with a score: letters in a row and letters at the start of a
 * word count more, so "lsm" finds "letter: smooth" before "language: spanish".
 * Returns null when the query is not a subsequence.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (q.length === 0) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const ch of q) {
    const index = t.indexOf(ch, from);
    if (index < 0) return null;
    const wordStart = index === 0 || /[\s:/-]/.test(t[index - 1] ?? "");
    score += 1;
    if (index === previous + 1) score += 3;
    if (wordStart) score += 4;
    score -= Math.min(index - from, 6) * 0.2;
    previous = index;
    from = index + 1;
  }
  return score - t.length * 0.01;
}

export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string): T[] {
  if (query.trim() === "") return items;
  return items
    .map((item, order) => ({ item, order, score: fuzzyScore(query, text(item)) }))
    .filter((entry): entry is { item: T; order: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.item);
}
