import { Spring } from "./spring";
import { copyCard, saveCard, type CardData } from "./card";
import { renderHeatmap } from "./heatmap";
import { levelOf, levelProgress, type RunReward } from "./profile";
import type { KeyStats } from "./training";
import type { Language } from "./words";

export type ResultData = {
  wpm: number;
  raw: number;
  accuracy: number;
  consistency: number;
  seconds: number;
  series: number[];
  reward: RunReward;
  xp: number;
  failedAt: { word: number; total: number } | null;
  weakKeys: string[];
  trend: number | null;
  progress: number[];
  streakDays: number;
  /** Author and work of a quote. */
  source: string | null;
  keys: KeyStats;
  language: Language;
  /** Short name of the setup for the share image, like "time 30 · english". */
  setup: string;
};

let currentCard: CardData | null = null;

/** Keyboard path to the same actions as the buttons. */
export function shareResult(action: "copy" | "save"): Promise<void> | null {
  if (!currentCard) return null;
  return action === "copy" ? copyCard(currentCard) : saveCard(currentCard);
}

function actionButton(label: string, done: string, action: "copy" | "save"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "share";
  button.textContent = label;
  button.addEventListener("click", () => {
    button.blur();
    shareResult(action)
      ?.then(() => { button.textContent = done; })
      .catch(() => { button.textContent = "not allowed here"; })
      .finally(() => setTimeout(() => { button.textContent = label; }, 1600));
  });
  return button;
}

const SVG = "http://www.w3.org/2000/svg";
const WIDTH = 1200;
const HEIGHT = 170;
const PAD = { left: 36, right: 6, top: 10, bottom: 24 };

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function niceMax(value: number): number {
  const step = value > 150 ? 50 : value > 60 ? 25 : 10;
  return Math.max(step, Math.ceil(value / step) * step);
}

type ChartLabels = { title: string; description: string; tick(i: number): string; point(i: number): string };

function buildChart(series: number[], labels: ChartLabels): HTMLElement {
  const wrap = document.createElement("figure");
  wrap.className = "chart";
  const title = document.createElement("figcaption");
  title.textContent = labels.title;
  const root = svg("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: "img", "aria-label": labels.description });
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(...series));
  const xAt = (i: number): number => PAD.left + (series.length > 1 ? (i / (series.length - 1)) * plotW : 0);
  const yAt = (v: number): number => PAD.top + plotH * (1 - v / max);

  for (const tick of [0, max / 2, max]) {
    root.append(svg("line", { x1: PAD.left, x2: WIDTH - PAD.right, y1: yAt(tick), y2: yAt(tick), class: "grid" }));
    const label = svg("text", { x: PAD.left - 10, y: yAt(tick) + 4, "text-anchor": "end", class: "axis" });
    label.textContent = String(tick);
    root.append(label);
  }
  const step = series.length <= 12 ? 2 : series.length <= 30 ? 5 : series.length <= 60 ? 10 : 20;
  for (let index = 0; index < series.length; index++) {
    if (index !== 0 && (index + 1) % step !== 0) continue;
    const last = index === series.length - 1;
    const label = svg("text", { x: xAt(index), y: HEIGHT - 5, "text-anchor": index === 0 ? "start" : last ? "end" : "middle", class: "axis" });
    label.textContent = labels.tick(index);
    root.append(label);
  }

  const d = series.map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join("");
  const line = svg("path", { d, class: "line", pathLength: 1 });
  const cross = svg("line", { y1: PAD.top, y2: PAD.top + plotH, class: "cross" });
  const dot = svg("circle", { r: 5, class: "dot" });
  root.append(line, cross, dot);

  const tip = document.createElement("div");
  tip.className = "tip";
  wrap.append(title, root, tip);

  const hit = svg("rect", { x: PAD.left, y: 0, width: plotW, height: HEIGHT, fill: "transparent" });
  root.append(hit);
  hit.addEventListener("pointermove", (event) => {
    const rect = root.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const index = Math.max(0, Math.min(series.length - 1, Math.round(((x - PAD.left) / plotW) * (series.length - 1))));
    const value = series[index] ?? 0;
    cross.setAttribute("x1", String(xAt(index)));
    cross.setAttribute("x2", String(xAt(index)));
    dot.setAttribute("cx", String(xAt(index)));
    dot.setAttribute("cy", String(yAt(value)));
    tip.innerHTML = `<b>${Math.round(value)} wpm</b><span>${labels.point(index)}</span>`;
    tip.style.transform = `translate(${(xAt(index) / WIDTH) * rect.width}px, ${(yAt(value) / HEIGHT) * rect.height}px)`;
    wrap.classList.add("hover");
  });
  hit.addEventListener("pointerleave", () => wrap.classList.remove("hover"));

  const details = document.createElement("details");
  const rows = series.map((v, i) => `<tr><td>${labels.point(i)}</td><td>${Math.round(v)}</td></tr>`).join("");
  details.innerHTML = `<summary>view as table</summary><table><thead><tr><th>point</th><th>wpm</th></tr></thead><tbody>${rows}</tbody></table>`;
  wrap.append(details);
  return wrap;
}

function stat(label: string, value: string): HTMLElement {
  const node = document.createElement("div");
  node.className = "stat";
  node.innerHTML = `<span class="stat-label">${label}</span><span class="stat-value">${value}</span>`;
  return node;
}

function countUp(node: HTMLElement, target: number): void {
  const spring = new Spring(0, 90, 18);
  spring.target = target;
  let last = performance.now();
  const frame = (now: number): void => {
    spring.step(Math.min((now - last) / 1000, 1 / 30));
    last = now;
    node.textContent = String(Math.max(0, Math.round(spring.x)));
    if (!spring.settled && node.isConnected) requestAnimationFrame(frame);
    else node.textContent = String(target);
  };
  requestAnimationFrame(frame);
}

function badgeText(data: ResultData): string {
  const { reward, failedAt } = data;
  if (failedAt) return `Broken at word ${failedAt.word} of ${failedAt.total}.`;
  if (reward.isBest) return `New best, up ${Math.round(data.wpm - (reward.previousBest ?? 0))} wpm.`;
  if (reward.previousBest === null) {
    return reward.recorded ? "First run. Your ghost is ready." : "Too short to count as a record.";
  }
  return `${Math.round(reward.previousBest - data.wpm)} wpm from your best.`;
}

export function renderResults(root: HTMLElement, data: ResultData): void {
  root.replaceChildren();

  const top = document.createElement("div");
  top.className = "result-top";

  const headline = document.createElement("div");
  headline.className = "headline";
  const hero = document.createElement("div");
  hero.className = `hero ${data.reward.isBest ? "best" : ""}`;
  const number = document.createElement("span");
  number.className = "hero-number";
  number.textContent = "0";
  const unit = document.createElement("span");
  unit.className = "hero-unit";
  unit.textContent = "wpm";
  hero.append(number, unit);
  const badge = document.createElement("p");
  badge.className = "badge";
  badge.textContent = badgeText(data);
  headline.append(hero, badge);
  if (data.source) {
    const source = document.createElement("p");
    source.className = "source";
    source.textContent = data.source;
    headline.append(source);
  }

  const stats = document.createElement("div");
  stats.className = "stats";
  stats.append(
    stat("accuracy", `${Math.round(data.accuracy)}%`),
    stat("raw", String(Math.round(data.raw))),
    stat("consistency", `${Math.round(data.consistency)}%`),
    stat("time", `${Math.round(data.seconds)}s`),
  );
  top.append(headline, stats);

  const coach = document.createElement("div");
  coach.className = "coach";
  if (data.weakKeys.length > 0) {
    const caps = data.weakKeys.map((key) => `<b>${key}</b>`).join(" ");
    coach.innerHTML = `<p>Your weakest keys are ${caps}. <kbd>t</kbd> trains them.</p>`;
  } else {
    coach.innerHTML = "<p>Your weak keys show up after a few runs.</p>";
  }
  if (data.trend !== null) {
    const trend = document.createElement("p");
    const rounded = Math.round(data.trend);
    trend.textContent = `${rounded >= 0 ? "Up" : "Down"} ${Math.abs(rounded)} wpm over your last five runs.`;
    coach.append(trend);
  }

  const xp = document.createElement("div");
  xp.className = "xp";
  const level = levelOf(data.xp);
  const levelUp = data.reward.levelAfter > data.reward.levelBefore;
  const days = data.streakDays === 1 ? "1 day" : `${data.streakDays} days`;
  xp.innerHTML = `<div class="xp-row"><span>${levelUp ? `Level ${level}, new` : `Level ${level}`}</span><span>${days} streak</span><span>+${data.reward.xpGained} xp</span></div><div class="xp-track"><div class="xp-fill"></div></div>`;
  const fill = xp.querySelector<HTMLElement>(".xp-fill")!;
  fill.style.transform = "scaleX(0)";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.transform = `scaleX(${levelProgress(data.xp)})`;
  }));

  const again = document.createElement("div");
  again.className = "again";
  again.innerHTML = "<span><kbd>tab</kbd> one more</span>";
  const share = document.createElement("span");
  share.className = "share-row";
  share.append(actionButton("copy image", "copied", "copy"), actionButton("save image", "saved", "save"));
  again.append(share);
  currentCard = {
    wpm: data.wpm,
    accuracy: data.accuracy,
    raw: data.raw,
    consistency: data.consistency,
    seconds: data.seconds,
    series: data.series,
    setup: data.setup,
    date: new Date(),
  };

  const parts: HTMLElement[] = [top];
  if (data.series.length >= 2) {
    parts.push(buildChart(data.series, {
      title: "Speed during this run",
      description: "Words per minute for each second of the run",
      tick: (i) => `${i + 1}s`,
      point: (i) => `second ${i + 1}`,
    }));
  }
  parts.push(coach, renderHeatmap(data.keys, data.language));
  if (data.progress.length >= 3) {
    parts.push(buildChart(data.progress, {
      title: "Your progress in this setup",
      description: "Words per minute of each past run in this setup",
      tick: (i) => `#${i + 1}`,
      point: (i) => `run ${i + 1}`,
    }));
  }
  parts.push(xp, again);
  parts.forEach((part, i) => {
    part.classList.add("rise");
    part.style.animationDelay = `${i * 60}ms`;
  });
  root.append(...parts);
  countUp(number, Math.round(data.wpm));
}
