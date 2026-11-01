export const ROUTES = ["/", "/about", "/daily", "/datenschutz", "/de", "/impressum", "/me", "/nutzungsbedingungen", "/privacy", "/terms"] as const;

export type TypedLetter = { char: string; wrong: boolean };
export type RouteMatch = { letters: TypedLetter[]; route: string | null };

/** Edit distance table from `typed` to `target`, kept whole so the wrong letters can be traced back. */
function distances(typed: string, target: string): number[][] {
  const table = Array.from({ length: typed.length + 1 }, (_, i) => [i, ...Array<number>(target.length).fill(0)]);
  table[0] = Array.from({ length: target.length + 1 }, (_, j) => j);
  for (let i = 1; i <= typed.length; i++) {
    const row = table[i]!;
    const above = table[i - 1]!;
    for (let j = 1; j <= target.length; j++) {
      const swap = above[j - 1]! + (typed[i - 1] === target[j - 1] ? 0 : 1);
      row[j] = Math.min(swap, above[j]! + 1, row[j - 1]! + 1);
    }
  }
  return table;
}

function markWrong(typed: string, target: string, table: number[][]): TypedLetter[] {
  const letters = [...typed].map((char) => ({ char, wrong: false }));
  let i = typed.length;
  let j = target.length;
  while (i > 0) {
    const here = table[i]![j]!;
    if (j > 0 && here === table[i - 1]![j - 1]! + (typed[i - 1] === target[j - 1] ? 0 : 1)) {
      letters[i - 1]!.wrong = typed[i - 1] !== target[j - 1];
      i--;
      j--;
    } else if (here === table[i - 1]![j]! + 1) {
      letters[i - 1]!.wrong = true;
      i--;
    } else {
      j--;
    }
  }
  return letters;
}

/**
 * Finds the page someone probably meant and marks the letters that kept them from it. "/" is
 * never suggested: it is one letter from every short path and the page always offers it anyway.
 */
export function closestRoute(path: string): RouteMatch {
  const typed = path.toLowerCase();
  let best: { route: string; distance: number; table: number[][] } | null = null;
  for (const route of ROUTES) {
    if (route === "/") continue;
    const table = distances(typed, route);
    const distance = table[typed.length]![route.length]!;
    if (!best || distance < best.distance) best = { route, distance, table };
  }
  // past a third of the path it stops being a typo and every letter would be marked
  if (!best || best.distance > Math.max(1, Math.floor(typed.length / 3))) {
    return { letters: [...path].map((char) => ({ char, wrong: true })), route: null };
  }
  const letters = markWrong(typed, best.route, best.table);
  return { letters: letters.map((letter, index) => ({ ...letter, char: path[index]! })), route: best.route };
}
