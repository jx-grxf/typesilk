import type { KeyStats } from "./training";
import type { Language } from "./words";

const LAYOUTS: Record<Language, string[]> = {
  english: ["qwertyuiop", "asdfghjkl", "zxcvbnm"],
  german: ["qwertzuiopü", "asdfghjklöä", "yxcvbnmß"],
  spanish: ["qwertyuiop", "asdfghjklñ", "zxcvbnm"],
  french: ["azertyuiop", "qsdfghjklm", "wxcvbn"],
};
const MIN_SAMPLES = 5;

export type KeyHeat = { key: string; samples: number; missRate: number; ms: number | null; heat: number };

/** Letters that aren't keys of their own on this layout (é on QWERTY) count towards their base letter. */
function baseKey(letter: string, keys: Set<string>): string {
  if (keys.has(letter)) return letter;
  const base = letter.normalize("NFD").replace(/\p{M}/gu, "");
  return keys.has(base) ? base : letter;
}

export function keyHeat(stats: KeyStats, language: Language): KeyHeat[][] {
  const rows = LAYOUTS[language];
  const keys = new Set(rows.join(""));
  const merged = new Map<string, { hits: number; misses: number; time: number; timed: number }>();
  for (const [letter, stat] of Object.entries(stats)) {
    const key = baseKey(letter, keys);
    if (!keys.has(key)) continue;
    const into = merged.get(key) ?? { hits: 0, misses: 0, time: 0, timed: 0 };
    into.hits += stat.hits;
    into.misses += stat.misses;
    into.time += stat.time;
    into.timed += stat.timed;
    merged.set(key, into);
  }
  const rates = [...merged.values()]
    .filter((s) => s.hits + s.misses >= MIN_SAMPLES)
    .map((s) => s.misses / (s.hits + s.misses));
  // scaled to the worst key, so the map shows where you slip even when you rarely do
  const worst = Math.max(...rates, 0.02);
  return rows.map((row) => [...row].map((key) => {
    const s = merged.get(key);
    const samples = s ? s.hits + s.misses : 0;
    const missRate = s && samples > 0 ? s.misses / samples : 0;
    return {
      key,
      samples,
      missRate,
      ms: s && s.timed > 0 ? s.time / s.timed : null,
      heat: samples >= MIN_SAMPLES ? Math.min(missRate / worst, 1) : 0,
    };
  }));
}

export function renderHeatmap(stats: KeyStats, language: Language): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "heatmap";
  const caption = document.createElement("figcaption");
  caption.textContent = "Mistakes per key, across all your runs";
  const board = document.createElement("div");
  board.className = "board";
  board.setAttribute("role", "img");
  const described: string[] = [];
  keyHeat(stats, language).forEach((row, r) => {
    const line = document.createElement("div");
    line.className = "board-row";
    line.style.setProperty("--offset", String(r));
    for (const cell of row) {
      const key = document.createElement("span");
      key.className = "hk";
      key.textContent = cell.key;
      if (cell.samples < MIN_SAMPLES) {
        key.classList.add("sparse");
        key.title = `${cell.key}: not enough typed yet`;
      } else {
        const pct = Math.round(cell.missRate * 100);
        const speed = cell.ms === null ? "" : `, ${Math.round(cell.ms)} ms`;
        key.title = `${cell.key}: ${pct}% missed${speed}`;
        if (pct > 0) described.push(`${cell.key} ${pct}%`);
      }
      key.style.setProperty("--heat", cell.heat.toFixed(3));
      key.style.animationDelay = `${(r * 4 + line.childElementCount) * 14}ms`;
      line.append(key);
    }
    board.append(line);
  });
  board.setAttribute("aria-label", described.length > 0 ? `Missed keys: ${described.join(", ")}` : "No missed keys yet");
  const legend = document.createElement("div");
  legend.className = "board-legend";
  legend.innerHTML = '<span>fewer</span><i style="--heat:0"></i><i style="--heat:.33"></i><i style="--heat:.66"></i><i style="--heat:1"></i><span>more</span>';
  figure.append(caption, board, legend);
  return figure;
}
