import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "./tokens.css";
import "./style.css";
import "./design.css";
import type { Days } from "./activity";
import { BADGES, medal } from "./badges";
import { renderCard } from "./card";
import { renderHeatmap } from "./heatmap";
import { renderActivity } from "./profile-view";
import { DEFAULTS, THEMES, type Settings } from "./settings";
import { applySpringTokens, Spring, SPRINGS } from "./spring";
import type { KeyStats } from "./training";
import { buildPanel, segment, toggleWord, type Segment } from "./ui";

const root = document.documentElement;
applySpringTokens(root);
const segments: Segment[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", html = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

function section(title: string, note: string, ...children: HTMLElement[]): HTMLElement {
  const node = el("section", "ds-section");
  node.append(el("h2", "", title), el("p", "ds-note", note), ...children);
  return node;
}

function luminance(color: string): number {
  const probe = el("i");
  probe.style.color = color;
  document.body.append(probe);
  const [r, g, b] = getComputedStyle(probe).color.match(/[\d.]+/g)!.map(Number).map((c) => c / 255) as [number, number, number];
  probe.remove();
  const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const ROLES: [string, string][] = [
  ["--bg", "the page"],
  ["--ink", "typed text, primary text, values"],
  ["--muted", "secondary text, labels, the active word"],
  ["--dim", "untyped text and other large quiet text"],
  ["--rule", "hairlines between rows and sections, never text"],
  ["--accent", "caret, mistakes, records, the selected item"],
];

function colours(): HTMLElement {
  const grid = el("div", "ds-swatches");
  const paint = (): void => {
    grid.replaceChildren();
    const style = getComputedStyle(root);
    const bg = luminance(style.getPropertyValue("--bg"));
    for (const [token, use] of ROLES) {
      const value = style.getPropertyValue(token).trim();
      const l = luminance(value);
      const ratio = (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05);
      const card = el("div", "ds-swatch");
      const chip = el("span", "ds-chip");
      chip.style.background = `var(${token})`;
      card.append(chip, el("div", "", `<b>${token}</b><span>${value}${token === "--bg" ? "" : ` · ${ratio.toFixed(1)}:1`}</span><small>${use}</small>`));
      grid.append(card);
    }
  };
  paint();
  root.addEventListener("ds-theme", paint);
  return grid;
}

function type(): HTMLElement {
  const wrap = el("div", "ds-type");
  wrap.append(
    el("div", "hero", '<span class="hero-number">246</span><span class="hero-unit">wpm</span>'),
    el("p", "ds-title", "Your typing"),
    el("p", "coach", "<p>Your weakest keys are <b>d l o</b>. <kbd>t</kbd> trains them.</p>"),
    el("p", "", "Body text at 16px for settings, rows and hints."),
    el("p", "ds-label", "labels and captions, italic and muted"),
    el("p", "ds-figures", "Figures: 0123456789 · 98% · 1,240 words"),
  );
  return wrap;
}

function typing(): HTMLElement {
  const line = el("div", "ds-typing");
  const word = (text: string, classes: string[], wordClass = ""): string =>
    `<span class="word ${wordClass}">${[...text].map((ch, i) => `<span class="l ${classes[i] ?? ""}">${ch}</span>`).join("")}</span>`;
  line.innerHTML = [
    word("quick", ["ok", "ok", "ok", "ok", "ok"]),
    word("brown", ["ok", "bad", "ok", "missed", "missed"], "flawed"),
    word("fox", ["ok", "ok", "ok", "bad x"]).replace("</span></span>", '</span><span class="l bad x">e</span></span>'),
    word("jumps", ["ok", "ok"], "active"),
    word("over", []),
    word("the", []),
  ].join("");
  const legend = el("p", "ds-note", "typed · wrong letter · missed letters with the word underlined · an extra letter · the active word · untyped");
  const carets = el("div", "ds-carets");
  for (const shape of ["line", "block", "underline"]) carets.append(el("span", `ds-caret ${shape}`, `<i></i><span>a</span><small>${shape}</small>`));
  const wrap = el("div");
  wrap.append(line, legend, carets);
  return wrap;
}

function springCurve(stiffness: number, damping: number): string {
  const spring = new Spring(0, stiffness, damping);
  spring.target = 1;
  const points: string[] = [];
  for (let i = 0; i <= 90; i++) {
    points.push(`${(i / 90) * 300},${100 - spring.x * 80}`);
    spring.step(1 / 90);
  }
  return points.join(" ");
}

function motion(): HTMLElement {
  const wrap = el("div", "ds-motion");
  for (const [name, [k, d]] of Object.entries(SPRINGS)) {
    const card = el("div", "ds-spring");
    card.innerHTML = `<svg viewBox="0 0 300 110" aria-hidden="true"><line x1="0" x2="300" y1="20" y2="20" class="grid"/><polyline points="${springCurve(k, d)}"/></svg>
      <b>${name === "soft" ? "--spring" : "--spring-snappy"}</b><small>stiffness ${k}, damping ${d}. ${name === "soft" ? "Views, panels, things that arrive." : "Underlines, highlights, things that follow you."}</small>
      <div class="ds-track"><i style="transition-timing-function: var(${name === "soft" ? "--spring" : "--spring-snappy"}); transition-duration: var(${name === "soft" ? "--spring-ms" : "--spring-snappy-ms"})"></i></div>`;
    wrap.append(card);
  }
  const play = el("button", "share", "play");
  play.type = "button";
  play.addEventListener("click", () => wrap.classList.toggle("moved"));
  const durations = el("p", "ds-note", "Fades: <b>--fast</b> 160 ms for colour and hover, <b>--fade</b> 280 ms for overlays, <b>--theme</b> 500 ms for a theme change. Nothing loops while you type, and reduced motion turns movement off.");
  const outer = el("div");
  outer.append(wrap, play, durations);
  return outer;
}

function sampleKeys(): KeyStats {
  const stats: KeyStats = {};
  [..."abcdefghijklmnopqrstuvwxyz"].forEach((key, i) => {
    stats[key] = { hits: 60, misses: (i * 7) % 5, time: 60 * 130, timed: 60 };
  });
  stats.q = { hits: 40, misses: 12, time: 40 * 180, timed: 40 };
  return stats;
}

function sampleDays(): Days {
  const days: Days = {};
  const today = new Date();
  for (let i = 0; i < 200; i++) {
    if ((i * 37) % 100 > 52) continue;
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const words = 60 + ((i * 131) % 1400);
    days[key] = { words, runs: Math.ceil(words / 90), ms: words * 600, best: 70 + (i % 40) };
  }
  return days;
}

function components(): HTMLElement {
  const wrap = el("div", "ds-components");
  const seg = segment(["time", "words", "quote", "zen"].map((v) => ({ label: v, value: v })), "time", () => {});
  segments.push(seg);
  const segRow = el("div", "ds-row");
  segRow.append(seg.root, toggleWord("punctuation", true, () => {}), toggleWord("numbers", false, () => {}));

  const stats = el("div", "stats ds-stats", ["accuracy|98%", "raw|112", "consistency|91%"].map((s) => {
    const [label, value] = s.split("|");
    return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
  }).join(""));

  const hints = el("p", "hint", "<kbd>tab</kbd> restart &nbsp; <kbd>esc</kbd> settings &nbsp; <kbd>⌘k</kbd> commands");

  const palette = el("div", "ds-palette");
  palette.innerHTML = `<div class="ds-palette-input">theme</div>
    <div class="pal-row current"><span class="pal-group">theme</span><span class="pal-label">noir</span></div>
    <div class="pal-row" aria-selected="true"><span class="pal-group">theme</span><span class="pal-label">paper</span></div>
    <div class="pal-row"><span class="pal-group">theme</span><span class="pal-label">forest</span></div>`;

  const panel = el("div", "ds-panel");
  const settings: Settings = { ...DEFAULTS };
  segments.push(...buildPanel(panel, settings, () => {}, { prompt: () => "really?", run: async () => true }, () => 12));

  const card = el("img", "ds-card");
  card.alt = "Result card in the current theme";
  const paintCard = (): void => {
    void renderCard({ wpm: 112, accuracy: 98, raw: 116, consistency: 91, seconds: 30, series: [80, 96, 104, 110, 108, 115, 112, 118, 114, 112], setup: "time 30 · english", date: new Date() })
      .then((blob) => { card.src = URL.createObjectURL(blob); });
  };
  paintCard();
  root.addEventListener("ds-theme", paintCard);

  const label = (text: string): HTMLElement => el("h3", "ds-component", text);
  wrap.append(
    label("Segments and toggle words"), segRow,
    label("Key hints"), hints,
    label("Stat rows"), stats,
    label("Command palette rows"), palette,
    label("Settings rows"), panel,
    label("Badges"), medals(),
    label("Key heatmap"), renderHeatmap(sampleKeys(), "english"),
    label("Activity"), renderActivity(sampleDays()),
    label("Result card"), card,
  );
  return wrap;
}

function medals(): HTMLElement {
  const row = el("div", "ds-medals");
  for (const id of ["sixty", "hundred", "one-fifty", "two-hundred"]) {
    const badge = BADGES.find((b) => b.id === id)!;
    const pair = el("div", "ds-medal");
    pair.append(medal(badge, true), medal(badge, false, [2, 3]));
    pair.append(el("small", "", `${badge.rarity}: earned, and locked with progress`));
    row.append(pair);
  }
  return row;
}

function header(): HTMLElement {
  const head = el("header", "ds-head");
  head.append(el("a", "logo", "typesilk"), el("h1", "", "Design"));
  (head.firstElementChild as HTMLAnchorElement).href = "/";
  const controls = el("div", "ds-controls");
  const theme = segment(THEMES.map((value) => ({ label: value, value })), "noir", (value) => {
    root.dataset.theme = value;
    root.dispatchEvent(new Event("ds-theme"));
  });
  const font = segment([{ label: "serif", value: "serif" }, { label: "mono", value: "mono" }], "serif", (value) => {
    root.dataset.font = value;
    requestAnimationFrame(() => segments.forEach((s) => s.sync()));
    root.dispatchEvent(new Event("ds-theme"));
  });
  segments.push(theme, font);
  controls.append(theme.root, font.root);
  head.append(controls);
  return head;
}

const principles = el("ol", "ds-principles");
principles.innerHTML = [
  "<b>Type is the interface.</b> Headline-sized letters carry the test; size and weight make the hierarchy, figures are lining and tabular.",
  "<b>One colour for what matters.</b> The accent marks the caret, mistakes, records and the selected item, and nothing else.",
  "<b>Hairlines between things.</b> Rows and sections are split by 1 px rules. Only overlays (palette, editor) get a surface of their own.",
  "<b>Everything that moves, moves on a spring.</b> Positions retarget one spring instead of restarting an animation; colours fade fast.",
  "<b>Numbers are measured.</b> Every figure on screen comes from your keystrokes; there are no estimates and no decoration that pretends to be data.",
].map((item) => `<li>${item}</li>`).join("");

const main = el("main", "ds");
main.append(
  header(),
  section("Principles", "The material is a printed page: ink on paper, set large, with one colour for what matters.", principles),
  section("Colour", "Six roles per theme, defined in src/tokens.css. Ratios are against --bg; text below 24 px uses --muted or --ink.", colours()),
  section("Type", "Newsreader for everything by default, JetBrains Mono as the alternative. Italic marks labels and asides.", type()),
  section("Typing states", "The letters you type and the caret, as they look during a run.", typing()),
  section("Motion", "Two springs, computed in src/spring.ts and handed to CSS as linear() curves.", motion()),
  section("Components", "Rendered by the same code the app uses.", components()),
);
document.body.append(main);
void document.fonts.ready.then(() => {
  segments.forEach((s) => s.sync());
  document.body.classList.add("ready");
});
window.addEventListener("resize", () => segments.forEach((s) => s.sync()));
