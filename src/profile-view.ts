import { summary, yearGrid, type Cell, type Days } from "./activity";
import { renderHeatmap } from "./heatmap";
import { levelOf, type Profile } from "./profile";
import type { Language } from "./words";

const SVG = "http://www.w3.org/2000/svg";
const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 30;
const TOP = 18;
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];

const number = new Intl.NumberFormat("en-GB");
const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short" });

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function minutes(ms: number): string {
  const total = Math.round(ms / 60000);
  return total < 60 ? `${total} min` : `${Math.floor(total / 60)} h ${total % 60} min`;
}

function tipText(cell: Cell): string {
  const date = dayFormat.format(cell.date);
  if (!cell.stat) return `<b>${date}</b><span>no typing</span>`;
  const { words, runs, ms, best } = cell.stat;
  return `<b>${date}</b><span>${number.format(words)} words · ${runs} ${runs === 1 ? "run" : "runs"}</span><span>${minutes(ms)} · best ${best} wpm</span>`;
}

function activity(days: Days): HTMLElement {
  const weeks = yearGrid(days);
  const { words, active, longest } = summary(days);
  const figure = document.createElement("figure");
  figure.className = "activity";
  const head = document.createElement("figcaption");
  head.innerHTML = `<span><b>${number.format(words)}</b> words in the last year</span><span>${active} active ${active === 1 ? "day" : "days"} · longest streak ${longest}</span>`;

  const width = LEFT + weeks.length * STEP;
  const height = TOP + 7 * STEP;
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `${words} words typed on ${active} days in the last year` });
  WEEKDAYS.forEach((label, row) => {
    if (!label) return;
    const text = svg("text", { x: 0, y: TOP + row * STEP + CELL - 2, class: "axis" });
    text.textContent = label;
    root.append(text);
  });
  const cells: Cell[] = [];
  weeks.forEach((week, column) => {
    const first = week[0]!;
    if (first.date.getDate() <= 7 && column > 0) {
      const text = svg("text", { x: LEFT + column * STEP, y: 11, class: "axis" });
      text.textContent = monthFormat.format(first.date);
      root.append(text);
    }
    for (const cell of week) {
      const row = (cell.date.getDay() + 6) % 7;
      const rect = svg("rect", {
        x: LEFT + column * STEP, y: TOP + row * STEP, width: CELL, height: CELL, rx: 2,
        class: `day l${cell.level}`, "data-i": cells.length,
      });
      rect.style.animationDelay = `${column * 9}ms`;
      cells.push(cell);
      root.append(rect);
    }
  });

  const tip = document.createElement("div");
  tip.className = "tip";
  const board = document.createElement("div");
  board.className = "activity-board";
  board.append(root, tip);
  root.addEventListener("pointermove", (event) => {
    const target = event.target as SVGElement;
    const index = target.getAttribute("data-i");
    if (index === null) {
      figure.classList.remove("hover");
      return;
    }
    const cell = cells[Number(index)]!;
    const box = target.getBoundingClientRect();
    const frame = board.getBoundingClientRect();
    tip.innerHTML = tipText(cell);
    // kept inside the board so the last weeks of the year don't push it off screen
    const half = 98;
    const x = Math.min(Math.max(box.left - frame.left + box.width / 2, half), frame.width - half);
    tip.style.transform = `translate(${x}px, ${box.top - frame.top}px)`;
    figure.classList.add("hover");
  });
  root.addEventListener("pointerleave", () => figure.classList.remove("hover"));

  const legend = document.createElement("div");
  legend.className = "board-legend";
  legend.innerHTML = '<span>less</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>more</span>';
  figure.append(head, board, legend);
  return figure;
}

/** "time:30:english:p:" reads as "time 30 · english · punctuation". */
export function setupName(key: string): string {
  const [mode, length, language, punctuation, numbers, size] = key.split(":");
  const parts = [length && length !== "0" ? `${mode} ${length}` : mode, language];
  if (punctuation) parts.push("punctuation");
  if (numbers) parts.push("numbers");
  if (size) parts.push(`${size} words`);
  return parts.join(" · ");
}

function records(profile: Profile): HTMLElement {
  const section = document.createElement("section");
  section.className = "records";
  const title = document.createElement("h3");
  title.textContent = "Records";
  section.append(title);
  const entries = Object.entries(profile.bests).sort(([, a], [, b]) => b.wpm - a.wpm);
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Finish a run of at least five seconds to set your first record.";
    section.append(empty);
  }
  for (const [key, best] of entries) {
    const row = document.createElement("div");
    row.className = "stat";
    row.innerHTML = `<span class="stat-label">${setupName(key)}</span><span class="stat-value">${Math.round(best.wpm)} <small>wpm · ${Math.round(best.accuracy)}%</small></span>`;
    section.append(row);
  }
  return section;
}

export function renderProfile(root: HTMLElement, profile: Profile, language: Language): void {
  root.replaceChildren();
  const head = document.createElement("header");
  head.className = "profile-head";
  const typedMs = Object.values(profile.days).reduce((sum, day) => sum + day.ms, 0);
  head.innerHTML = `<h2>Your typing</h2><dl>
    <div><dt>level</dt><dd>${levelOf(profile.xp)}</dd></div>
    <div><dt>streak</dt><dd>${profile.streakDays} ${profile.streakDays === 1 ? "day" : "days"}</dd></div>
    <div><dt>runs</dt><dd>${number.format(profile.tests)}</dd></div>
    <div><dt>words</dt><dd>${number.format(Math.round(profile.totalChars / 5))}</dd></div>
    <div><dt>typed</dt><dd>${minutes(typedMs)}</dd></div>
  </dl>`;
  const back = document.createElement("p");
  back.className = "again";
  back.innerHTML = "<kbd>esc</kbd> back to typing";
  const parts = [head, activity(profile.days), records(profile), renderHeatmap(profile.keys, language), back];
  parts.forEach((part, i) => {
    part.classList.add("rise");
    part.style.animationDelay = `${i * 60}ms`;
  });
  root.append(...parts);
}
