import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "./style.css";
import { consistency, rollingWpm, TypingEngine, wpm } from "./engine";
import { FlowMeter } from "./flow";
import { applyRun, clearProfile, emptyProfile, levelOf, levelProgress, loadProfile, localDay, saveProfile } from "./profile";
import { renderResults } from "./results";
import { loadSettings, recordKey, saveSettings, type Mode, type Settings } from "./settings";
import { Sound } from "./sound";
import { springEasing } from "./spring";
import { Stage } from "./stage";
import { recordKey as recordKeyStat, trend, weakKeys } from "./training";
import { buildPanel, segment, toggleWord, type Segment } from "./ui";
import { createTrainingSource, createWordSource, LANGUAGES, type Language } from "./words";

const CHUNK = 50;
const REFILL_AT = 30;
const PROGRESS_RUNS = 40;
const MIN_RATE_MS = 1000; // a run ended after one key would otherwise show thousands of wpm
const TEST_KEYS: (keyof Settings)[] = ["mode", "time", "count", "language", "punctuation", "numbers", "textSize", "layout"];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const settings = loadSettings();
let profile = loadProfile();

const typingEl = $("typing");
const resultsEl = $("results");
const hudEl = $("hud");
const comboEl = $("combo");
const panelEl = $("panel");

const stage = new Stage($("scroller"), $("words"), $("caret"), $("ghost"), $("flow-line"));
const flow = new FlowMeter();
const sound = new Sound();

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const root = document.documentElement;
const springSoft = springEasing(170, 22);
const springSnappy = springEasing(300, 26);
root.style.setProperty("--spring", springSoft.easing);
root.style.setProperty("--spring-ms", `${springSoft.duration}ms`);
root.style.setProperty("--spring-snappy", springSnappy.easing);
root.style.setProperty("--spring-snappy-ms", `${springSnappy.duration}ms`);

let engine = new TypingEngine([]);
let nextWords: (count: number) => string[] = () => [];
let state: "idle" | "running" | "done" | "busy" = "busy";
let startedAt = 0;
let lastKeyAt = 0;
let samples: number[] = [];
let trainingKeys: string[] = [];
let ghostSeries: number[] | null = null;
let hudText = "";

let segments: Segment[] = [];
let timeSeg: Segment;
let countSeg: Segment;
let optionsWrap: HTMLElement;

// --- frame loop: a single rAF that sleeps as soon as nothing is moving

let rafId = 0;
let lastFrame = 0;

function kick(): void {
  if (rafId !== 0) return;
  lastFrame = performance.now() - 8;
  rafId = requestAnimationFrame(frame);
}

function frame(now: number): void {
  rafId = 0;
  const dt = Math.min((now - lastFrame) / 1000, 1 / 30);
  lastFrame = now;
  flow.update(dt);
  const moving = stage.update(dt, flow.value);
  if (state === "running") tickTest(performance.now());
  if (state === "running" || moving || !flow.settled) rafId = requestAnimationFrame(frame);
}

// --- test lifecycle

function modeLength(): number {
  return settings.mode === "words" || settings.mode === "perfect" || settings.mode === "train"
    ? settings.count
    : 0;
}

function isFixedLength(): boolean {
  return modeLength() > 0;
}

function newTest(): void {
  trainingKeys = settings.mode === "train" ? weakKeys(profile.keys, 5) : [];
  nextWords =
    settings.mode === "train"
      ? createTrainingSource(settings.language, trainingKeys)
      : createWordSource(settings.language, { punctuation: settings.punctuation, numbers: settings.numbers });
  const words = nextWords(isFixedLength() ? modeLength() : CHUNK * 2);
  engine = new TypingEngine(words);
  samples = [];
  flow.reset();
  stage.reset(words);
  ghostSeries = settings.ghost && !prefersReducedMotion ? (profile.bests[recordKey(settings)]?.series ?? null) : null;
  stage.ghostVisible = ghostSeries !== null;
  document.body.classList.remove("focus", "show-results");
  state = "idle";
  renderHud();
  setEscLabel();
  kick();
}

async function restart(): Promise<void> {
  if (state === "busy") return;
  const fromResults = state === "done";
  state = "busy";
  if (!fromResults) {
    await typingEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 70, easing: "ease-in", fill: "forwards" }).finished;
  }
  newTest();
  for (const animation of typingEl.getAnimations()) animation.cancel();
  typingEl.animate(
    [{ opacity: 0, transform: "translateX(0.6rem)" }, { opacity: 1, transform: "none" }],
    { duration: springSoft.duration, easing: springSoft.easing },
  );
}

function start(now: number): void {
  state = "running";
  startedAt = now;
  lastKeyAt = 0;
  document.body.classList.add("focus");
  setEscLabel();
}

function elapsed(now: number): number {
  return Math.max(0, now - startedAt);
}

function tickTest(now: number): void {
  const ms = elapsed(now);
  while (samples.length < Math.floor(ms / 1000)) samples.push(engine.correctChars);
  if (settings.mode === "time" && ms >= settings.time * 1000) {
    finish(settings.time * 1000);
    return;
  }
  if (ghostSeries) {
    const seconds = ms / 1000;
    const whole = Math.floor(seconds);
    const from = whole === 0 ? 0 : (ghostSeries[whole - 1] ?? ghostSeries[ghostSeries.length - 1] ?? 0);
    const to = ghostSeries[whole] ?? from;
    stage.setGhost(from + (to - from) * (seconds - whole));
  }
  renderHud();
}

function renderHud(): void {
  const ms = state === "running" ? elapsed(performance.now()) : 0;
  let text: string;
  if (settings.mode === "time") text = String(Math.max(0, Math.ceil(settings.time - ms / 1000)));
  else if (settings.mode === "endless") text = `${Math.floor(ms / 1000)}s`;
  else text = `${Math.min(engine.wordIndex, modeLength())}/${modeLength()}`;
  if (settings.mode === "train" && state !== "running") {
    text = trainingKeys.length > 0 ? `training ${trainingKeys.join(" ")}` : "no weak keys yet";
  }
  if (text !== hudText) {
    hudEl.textContent = text;
    hudText = text;
  }
}

function setEscLabel(): void {
  $("esc-label").textContent =
    state === "running" && settings.mode === "endless" ? "finish" : state === "running" ? "stop" : "settings";
}

function finish(durationMs: number, failedAtWord: number | null = null): void {
  if (state !== "running") return;
  state = "done";
  document.body.classList.remove("focus", "pointer-awake");
  stage.hideGhost();
  const chars = engine.correctChars;
  const rateMs = Math.max(durationMs, MIN_RATE_MS);
  const rate = wpm(chars, rateMs);
  const series = rollingWpm(samples);
  const key = recordKey(settings);
  const failed = failedAtWord !== null;
  const reward = applyRun(
    profile,
    {
      key,
      wpm: rate,
      accuracy: engine.accuracy,
      chars,
      series: samples,
      countsForRecord: !failed && durationMs >= 5000,
    },
    localDay(),
  );
  saveProfile(profile);
  renderMeta();

  renderResults(resultsEl, {
    wpm: rate,
    raw: wpm(engine.totalKeys, rateMs),
    accuracy: engine.accuracy,
    consistency: consistency(series),
    seconds: durationMs / 1000,
    series,
    reward,
    xp: profile.xp,
    failedAt: failed ? { word: failedAtWord + 1, total: modeLength() } : null,
    weakKeys: weakKeys(profile.keys),
    trend: trend(profile.history, key),
    progress: profile.history.filter((run) => run.key === key).slice(-PROGRESS_RUNS).map((run) => run.wpm),
    streakDays: profile.streakDays,
  });
  document.body.classList.add("show-results");
  setEscLabel();
  kick();
}

// --- keyboard

function maybeFlashCombo(): void {
  const streak = engine.streak;
  if (streak < 25 || streak % 25 !== 0 || (streak > 25 && streak % 50 !== 0)) return;
  comboEl.textContent = String(streak);
  comboEl.animate(
    [
      { opacity: 0.5, transform: "translate(-50%,-50%) scale(0.92)" },
      { opacity: 0, transform: "translate(-50%,-50%) scale(1.06)" },
    ],
    { duration: 1100, easing: "cubic-bezier(.15,.7,.3,1)" },
  );
}

function onChar(ch: string, code: string, now: number): void {
  if (state === "idle") start(now);
  const expected = engine.word[engine.input.length];
  const gap = lastKeyAt > 0 ? now - lastKeyAt : null;
  lastKeyAt = now;
  const result = engine.insert(ch);
  if (result.kind !== "char") return;

  if (expected !== undefined) recordKeyStat(profile.keys, expected, result.correct, gap);
  flow.key(now, result.correct, engine.streak);
  sound.key(code);
  stage.press(!result.correct);

  if (result.extra) stage.addExtra(result.wordIndex, ch);
  else if (result.correct) stage.markCorrect(result.wordIndex, result.charIndex);
  else stage.markWrong(result.wordIndex, result.charIndex);

  stage.caretTo(engine.wordIndex, engine.input.length);

  if (!result.correct && settings.mode === "perfect") {
    finish(elapsed(now), engine.wordIndex);
    return;
  }
  if (result.correct) maybeFlashCombo();

  if (isFixedLength() && engine.lastWordDone) {
    finish(elapsed(now));
    return;
  }
  kick();
}

function onSpace(code: string, now: number): void {
  if (state !== "running") return;
  lastKeyAt = now;
  const result = engine.space();
  if (result.kind !== "commit") return;

  flow.key(now, result.perfect, engine.streak);
  sound.key(code);
  stage.press(!result.perfect);
  stage.wordDone(result.wordIndex, result.perfect, result.typedLength);
  if (!result.perfect && settings.mode === "perfect") {
    finish(elapsed(now), result.wordIndex);
    return;
  }

  if (isFixedLength() && engine.wordIndex >= engine.words.length) {
    finish(elapsed(now));
    return;
  }
  if (!isFixedLength() && engine.words.length - engine.wordIndex < REFILL_AT) {
    const words = nextWords(CHUNK);
    engine.extend(words);
    stage.append(words);
  }
  stage.setActive(engine.wordIndex);
  stage.caretTo(engine.wordIndex, 0);
  kick();
}

function onBackspace(whole: boolean, code: string): void {
  if (state !== "running") return;
  const before = engine.input;
  const result = engine.backspace(whole);
  if (result.kind === "ignored") return;
  sound.key(code);
  stage.press(false);
  const wordLength = engine.word.length;

  if (result.kind === "delete") {
    if (result.extra) stage.removeExtra(result.wordIndex);
    else stage.clearLetter(result.wordIndex, result.charIndex);
  } else if (result.kind === "clear") {
    for (let i = before.length - 1; i >= 0; i--) {
      if (i >= wordLength) stage.removeExtra(result.wordIndex);
      else stage.clearLetter(result.wordIndex, i);
    }
  } else if (result.kind === "back") {
    stage.wordBack(result.wordIndex);
    stage.setActive(result.wordIndex);
  }
  stage.caretTo(engine.wordIndex, engine.input.length);
  kick();
}

function panelOpen(): boolean {
  return document.body.classList.contains("panel-open");
}

function setPanel(open: boolean): void {
  document.body.classList.toggle("panel-open", open);
  panelEl.inert = !open;
  if (open) requestAnimationFrame(() => segments.forEach((seg) => seg.sync()));
}

window.addEventListener("keydown", (event) => {
  if (event.isComposing) return;

  if (panelOpen()) {
    if (event.key === "Escape") setPanel(false);
    return;
  }

  if (event.key === "Tab") {
    event.preventDefault();
    void restart();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (state === "running") {
      if (settings.mode === "endless") finish(elapsed(event.timeStamp));
      else void restart();
    } else {
      setPanel(true);
    }
    return;
  }
  if (state === "done") {
    if (event.key === "Enter") void restart();
    if (event.key.toLowerCase() === "t" && !event.ctrlKey && !event.metaKey) change({ mode: "train" });
    return;
  }
  if (state === "busy") return;

  const altGraph = event.getModifierState("AltGraph");
  if (event.key === "Backspace") {
    event.preventDefault();
    onBackspace(event.ctrlKey || event.altKey, event.code);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !altGraph) return;
  if (event.key === " ") {
    event.preventDefault();
    onSpace(event.code, event.timeStamp);
    return;
  }
  if (event.key.length === 1 && !event.repeat) {
    event.preventDefault();
    onChar(event.key, event.code, event.timeStamp);
  }
});

// time mode has to end on time even if frames stop, for example in a background tab
setInterval(() => {
  if (state === "running" && settings.mode === "time") tickTest(performance.now());
}, 100);

// --- settings and chrome

function applySettings(): void {
  root.dataset.theme = settings.theme;
  root.dataset.size = settings.textSize;
  root.dataset.layout = settings.layout;
  sound.enabled = settings.sound;
  sound.setVolume(settings.volume);
  stage.layout = settings.layout;
  stage.letterFx = settings.letterFx && !prefersReducedMotion;
  $("flow-track").style.display = settings.flowLine ? "" : "none";
  if (optionsWrap) {
    optionsWrap.dataset.mode = settings.mode;
    segments.forEach((seg) => seg.sync());
  }
}

function change(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  saveSettings(settings);
  applySettings();
  if (TEST_KEYS.some((key) => key in patch)) void restart();
}

function renderMeta(): void {
  const level = $("level");
  level.querySelector("b")!.textContent = `Level ${levelOf(profile.xp)}`;
  level.querySelector<HTMLElement>(".level-fill")!.style.transform = `scaleX(${levelProgress(profile.xp)})`;
  const today = localDay();
  const yesterday = localDay(new Date(Date.now() - 86400000));
  const alive = profile.lastDay === today || profile.lastDay === yesterday;
  $("streak").textContent = alive && profile.streakDays > 0 ? `${profile.streakDays} day streak` : "";
}

function buildControls(): void {
  const modes: { label: string; value: Mode }[] = [
    { label: "time", value: "time" },
    { label: "words", value: "words" },
    { label: "perfect", value: "perfect" },
    { label: "endless", value: "endless" },
    { label: "train", value: "train" },
  ];
  const modeSeg = segment(modes, settings.mode, (mode) => change({ mode }));
  timeSeg = segment([15, 30, 60].map((value) => ({ label: String(value), value })), settings.time, (time) => change({ time }));
  countSeg = segment([25, 50, 100].map((value) => ({ label: String(value), value })), settings.count, (count) => change({ count }));
  timeSeg.root.classList.add("only-time");
  countSeg.root.classList.add("only-count");
  const languageSeg = segment(
    (Object.keys(LANGUAGES) as Language[]).map((value) => ({ label: value, value })),
    settings.language,
    (language) => change({ language }),
  );
  optionsWrap = document.createElement("div");
  optionsWrap.className = "options";
  optionsWrap.dataset.mode = settings.mode;
  const extras = document.createElement("div");
  extras.className = "extras";
  extras.append(
    toggleWord("punctuation", settings.punctuation, (punctuation) => change({ punctuation })),
    toggleWord("numbers", settings.numbers, (numbers) => change({ numbers })),
  );
  optionsWrap.append(timeSeg.root, countSeg.root, extras);
  $("controls-left").append(modeSeg.root, optionsWrap);
  $("controls-right").append(languageSeg.root);
  segments = [modeSeg, timeSeg, countSeg, languageSeg];
}

function resetProfile(): void {
  clearProfile();
  profile = emptyProfile();
  renderMeta();
  void restart();
}

let lastPointer = { x: -1, y: -1 };
window.addEventListener("pointermove", (event) => {
  if (!document.body.classList.contains("focus")) return;
  if (lastPointer.x >= 0 && Math.hypot(event.clientX - lastPointer.x, event.clientY - lastPointer.y) > 6) {
    document.body.classList.add("pointer-awake");
  }
  lastPointer = { x: event.clientX, y: event.clientY };
});
window.addEventListener("keydown", () => document.body.classList.remove("pointer-awake"));

window.addEventListener("resize", () => {
  segments.forEach((seg) => seg.sync());
  stage.remeasureAll(engine.wordIndex, engine.input.length);
});

$("open-settings").addEventListener("click", (event) => {
  (event.currentTarget as HTMLElement).blur();
  setPanel(true);
});
$("close-settings").addEventListener("click", () => setPanel(false));
$("backdrop").addEventListener("click", () => setPanel(false));

// --- boot

async function boot(): Promise<void> {
  const version = $<HTMLAnchorElement>("version");
  version.textContent = `v${__APP_VERSION__}`;
  version.href = `https://github.com/jx-grxf/typesilk/releases/tag/v${__APP_VERSION__}`;
  buildControls();
  segments.push(...buildPanel($("panel-body"), settings, change, resetProfile));
  applySettings();
  renderMeta();
  void sound.load();
  // words must be measured with the final font, or every position would be off
  await Promise.all([
    document.fonts.load('400 64px "Newsreader Variable"'),
    document.fonts.load('italic 400 64px "Newsreader Variable"'),
  ]);
  segments.forEach((seg) => seg.sync());
  newTest();
  document.body.classList.add("ready");
}

void boot();
