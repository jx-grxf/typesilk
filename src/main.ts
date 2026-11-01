import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "./tokens.css";
import "./style.css";
import { plausible, recordDay } from "./activity";
import { awardBadges, type RunFacts } from "./badges";
import { dailyKey, dailyNumber, dailyWords } from "./daily";
import { loadAccount, currentAccount, prepareTicket, signInProviders } from "./account";
import { accountDialogOpen, closeAccountDialog, fillAvatar, onAccountChange, openDeleteAccount, openNames, openSignIn, renderAccountRow, showDailyRank, signOutNow, trapDialogFocus } from "./account-view";
import { BACKSPACE, CLEAR_WORD, RunRecorder } from "./replay";
import { MIN_RATE_MS, consistency, rollingWpm, TypingEngine, wpm } from "./engine";
import { FlowMeter } from "./flow";
import { applyRun, clearProfile, emptyProfile, levelOf, levelProgress, loadProfile, localDay, saveProfile } from "./profile";
import { renderProfile, setupName } from "./profile-view";
import { renderResults, shareResult } from "./results";
import { type Command, Palette } from "./palette";
import { customWords, pickQuote, QUOTE_LENGTHS, quoteLength, type Quote } from "./quotes";
import { CARET_MOTIONS, CARETS, FONTS, GOALS, LAYOUTS, loadSettings, MODES, recordKey, saveSettings, THEMES, type Mode, type Settings } from "./settings";
import { Sound, SOUND_PACKS } from "./sound";
import { applySpringTokens } from "./spring";
import { Stage } from "./stage";
import { recordKey as recordKeyStat, trend, weakKeys } from "./training";
import { buildPanel, segment, toggleWord, type Segment } from "./ui";
import { availableSizes, createTrainingSource, createWordSource, LANGUAGES, loadWords, type Language } from "./words";

const CHUNK = 50;
const REFILL_AT = 30;
const PROGRESS_RUNS = 40;
const TEST_KEYS: (keyof Settings)[] = [
  "mode", "time", "count", "quoteLength", "customText", "customShuffle",
  "language", "wordList", "punctuation", "numbers", "textSize", "layout", "font",
];
const FALLBACK_TEXT = "Paste anything you like to practise here, a letter, notes or a page from a book.";
const FONT_FAMILIES: Record<Settings["font"], string> = { serif: "Newsreader Variable", mono: "JetBrains Mono Variable" };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const settings = loadSettings();
// language landing pages link here; the bare URL stays the canonical one
const requestedLanguage = new URLSearchParams(location.search).get("lang");
if (requestedLanguage && Object.hasOwn(LANGUAGES, requestedLanguage)) {
  settings.language = requestedLanguage as Language;
  saveSettings(settings);
}
if (new URLSearchParams(location.search).get("mode") === "daily") {
  settings.mode = "daily";
  saveSettings(settings);
}
const entryParams = new URLSearchParams(location.search);
if (location.search) history.replaceState(null, "", location.pathname);
const recorder = new RunRecorder();
let profile = loadProfile();

const typingEl = $("typing");
const resultsEl = $("results");
const hudEl = $("hud");
const liveEl = $("live");
const comboEl = $("combo");
const panelEl = $("panel");

const stage = new Stage($("scroller"), $("words"), $("caret"), $("ghost"), $("flow-line"));
const flow = new FlowMeter();
const sound = new Sound();

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const root = document.documentElement;
const { soft: springSoft } = applySpringTokens(root);

let engine = new TypingEngine([]);
let nextWords: (count: number) => string[] = () => [];
let state: "idle" | "running" | "done" | "busy" = "busy";
let startedAt = 0;
let lastKeyAt = 0;
let gaps: number[] = [];
let samples: number[] = [];
let trainingKeys: string[] = [];
let ghostSeries: number[] | null = null;
let hudText = "";
let liveText = "";
let fixedLength = 0;
let currentQuote: Quote | null = null;

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

function isFixedLength(): boolean {
  return fixedLength > 0;
}

function newTest(): void {
  const mode = settings.mode;
  trainingKeys = mode === "train" ? weakKeys(profile.keys, 5) : [];
  nextWords = () => [];
  let words: string[] = [];
  if (mode === "daily") {
    words = dailyWords(dailyNumber(), settings.language);
  } else if (mode === "quote") {
    currentQuote = pickQuote(settings.language, settings.quoteLength, currentQuote);
    words = currentQuote.text.split(" ");
  } else if (mode === "custom") {
    words = customWords(settings.customText.trim() || FALLBACK_TEXT, settings.customShuffle);
  } else if (mode !== "zen") {
    nextWords = mode === "train"
      ? createTrainingSource(settings.language, trainingKeys, Math.random, settings.wordList)
      : createWordSource(settings.language, { punctuation: settings.punctuation, numbers: settings.numbers, size: settings.wordList });
    const counted = mode === "words" || mode === "perfect" || mode === "train";
    words = nextWords(counted ? settings.count : CHUNK * 2);
  }
  fixedLength = mode === "words" || mode === "perfect" || mode === "train" || mode === "quote" || mode === "custom" || mode === "daily"
    ? words.length
    : 0;
  engine = new TypingEngine(words, mode === "zen");
  recorder.reset();
  if (mode === "daily") prepareTicket(dailyNumber(), settings.language);
  samples = [];
  flow.reset();
  stage.reset(engine.words);
  ghostSeries = settings.ghost && !prefersReducedMotion ? (profile.bests[recordKey(settings)]?.series ?? null) : null;
  stage.ghostVisible = ghostSeries !== null;
  document.body.classList.remove("focus", "show-results");
  state = "idle";
  renderHud();
  setEscLabel();
  kick();
}

/** Swaps views as one morph where the browser supports it; elsewhere the change is instant. */
function withTransition(update: () => void): Promise<void> {
  if (prefersReducedMotion || !document.startViewTransition) {
    update();
    return Promise.resolve();
  }
  return document.startViewTransition(update).updateCallbackDone;
}

/** Words are measured once, so they must never be measured with a fallback font. */
async function fontsReady(): Promise<void> {
  const family = FONT_FAMILIES[settings.font];
  await Promise.all([
    document.fonts.load(`400 64px "${family}"`),
    document.fonts.load(`italic 400 64px "${family}"`),
    // the daily draws from the 1k list, and everyone has to get the same words
    loadWords(settings.language, settings.mode === "daily" ? "1k" : settings.wordList),
  ]);
}

async function restart(): Promise<void> {
  // starting a test always means typing, so it brings you out of the profile
  if (profileOpen()) hideProfile();
  if (state === "busy") return;
  const fromResults = state === "done";
  state = "busy";
  const fonts = fontsReady();
  if (!fromResults) {
    await typingEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 70, easing: "ease-in", fill: "forwards" }).finished;
  }
  await fonts;
  if (fromResults) {
    await withTransition(newTest);
    return;
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
  gaps = [];
  if (settings.focusMode) document.body.classList.add("focus");
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
  else if (!isFixedLength()) text = `${Math.floor(ms / 1000)}s`;
  else text = `${Math.min(engine.wordIndex, fixedLength)}/${fixedLength}`;
  if (settings.mode === "daily" && state !== "running") text = `daily #${dailyNumber()}`;
  if (settings.mode === "train" && state !== "running") {
    text = trainingKeys.length > 0 ? `training ${trainingKeys.join(" ")}` : "no weak keys yet";
  }
  if (text !== hudText) {
    hudEl.textContent = text;
    hudText = text;
  }
  // the first second of a run swings too wildly to be worth showing
  const live = settings.liveStats && state === "running" && ms >= 1000
    ? `${Math.round(wpm(engine.correctChars, ms))} wpm  ${Math.floor(engine.accuracy)}%`
    : "";
  if (live !== liveText) {
    liveEl.textContent = live;
    liveText = live;
  }
}

function setEscLabel(): void {
  const open = settings.mode === "endless" || settings.mode === "zen";
  $("esc-label").textContent = state === "running" && open ? "finish" : state === "running" ? "stop" : "settings";
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
  const firstToday = profile.lastDay !== localDay();
  const daily = settings.mode === "daily" ? dailyNumber() : null;
  const dailyEntry = daily === null ? null : dailyKey(daily, settings.language);
  const firstDaily = dailyEntry !== null && !profile.dailies[dailyEntry] && !failed;
  if (dailyEntry !== null && firstDaily) profile.dailies[dailyEntry] = { wpm: rate, accuracy: engine.accuracy };
  const reward = applyRun(
    profile,
    {
      key,
      wpm: rate,
      accuracy: engine.accuracy,
      chars,
      series: samples,
      countsForRecord: !failed && durationMs >= 5000 && settings.mode !== "zen" && settings.mode !== "custom" && settings.mode !== "daily",
    },
    localDay(),
  );
  const human = plausible(gaps, wpm(engine.totalKeys, rateMs));
  // zen has no target text, so anything typed there would count
  if (settings.mode !== "zen" && human) {
    recordDay(profile.days, localDay(), { chars, ms: durationMs, wpm: rate });
  }
  const finished = !failed && settings.mode !== "zen" && settings.mode !== "custom";
  if (finished && settings.mode === "quote") profile.quotes++;
  if (finished && durationMs >= 30000 && !profile.languages.includes(settings.language)) profile.languages.push(settings.language);
  const facts: RunFacts = {
    mode: settings.mode,
    seconds: durationMs / 1000,
    wpm: rate,
    accuracy: engine.accuracy,
    consistency: consistency(series),
    words: engine.wordIndex,
    finished: !failed,
    quoteLength: settings.mode === "quote" && currentQuote ? quoteLength(currentQuote) : null,
  };
  const newBadges = awardBadges(profile, human ? facts : null);
  saveProfile(profile);
  renderMeta(firstToday);

  // the timer above the text grows into the big number on the results page
  void withTransition(() => {
    renderResults(resultsEl, {
      wpm: rate,
      raw: wpm(engine.totalKeys, rateMs),
      accuracy: engine.accuracy,
      consistency: consistency(series),
      seconds: durationMs / 1000,
      series,
      reward,
      xp: profile.xp,
      failedAt: failed ? { word: failedAtWord + 1, total: fixedLength } : null,
      weakKeys: weakKeys(profile.keys),
      trend: trend(profile.history, key),
      progress: profile.history.filter((run) => run.key === key).slice(-PROGRESS_RUNS).map((run) => run.wpm),
      streakDays: profile.streakDays,
      source: settings.mode === "quote" && currentQuote ? `${currentQuote.author}, ${currentQuote.work}` : null,
      keys: profile.keys,
      language: settings.language,
      setup: daily === null ? setupName(recordKey(settings)) : `daily #${daily} · ${settings.language}`,
    badges: newBadges,
    daily: daily === null ? null : { number: daily, first: firstDaily, firstWpm: profile.dailies[dailyEntry!]?.wpm ?? null },
    });
    if (daily !== null && !failed) showDailyRank(resultsEl, daily, settings.language, recorder.log);
    document.body.classList.add("show-results");
  });
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
  if (gap !== null) gaps.push(gap);
  recorder.record(ch, now);
  const result = engine.insert(ch);
  if (result.kind !== "char") return;

  if (expected !== undefined) recordKeyStat(profile.keys, expected, result.correct, gap);
  flow.key(now, result.correct, engine.streak);
  sound.key(code);
  stage.press(!result.correct);

  if (engine.free) stage.addTyped(result.wordIndex, ch);
  else if (result.extra) stage.addExtra(result.wordIndex, ch);
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
  recorder.record(" ", now);
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
  if (engine.free) {
    stage.append([""]);
  } else if (!isFixedLength() && engine.words.length - engine.wordIndex < REFILL_AT) {
    const words = nextWords(CHUNK);
    engine.extend(words);
    stage.append(words);
  }
  stage.setActive(engine.wordIndex);
  stage.caretTo(engine.wordIndex, 0);
  kick();
}

function onBackspace(whole: boolean, code: string, now: number): void {
  if (state !== "running") return;
  recorder.record(whole ? CLEAR_WORD : BACKSPACE, now);
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
  // rows slide in one after another, so the panel reads top to bottom as it opens
  if (open) [...$("panel-body").children].forEach((row, i) => (row as HTMLElement).style.setProperty("--i", String(i)));
  if (open) requestAnimationFrame(() => segments.forEach((seg) => seg.sync()));
}

const SIZES: { label: string; value: Settings["textSize"] }[] = [
  { label: "small", value: "s" },
  { label: "medium", value: "m" },
  { label: "large", value: "l" },
];

function commands(): Command[] {
  const list: Command[] = [];
  const pick = <K extends keyof Settings>(group: string, key: K, values: readonly Settings[K][], label = (v: Settings[K]) => String(v)): void => {
    for (const value of values) {
      list.push({ group, label: label(value), current: settings[key] === value, run: () => change({ [key]: value } as Partial<Settings>) });
    }
  };
  const toggle = (group: string, key: keyof Settings): void => {
    const on = settings[key] as boolean;
    list.push({ group, label: on ? "turn off" : "turn on", run: () => change({ [key]: !on } as Partial<Settings>) });
  };
  list.push({ group: "test", label: "restart", run: () => void restart() });
  list.push({ group: "test", label: `daily #${dailyNumber()}`, current: settings.mode === "daily", run: () => change({ mode: "daily" }) });
  if (weakKeys(profile.keys).length > 0) list.push({ group: "test", label: "train weak keys", run: () => change({ mode: "train" }) });
  list.push({ group: "go to", label: "daily leaderboard", run: () => location.assign("/daily") });
  list.push({ group: "go to", label: "profile", run: () => showProfile() });
  const user = currentAccount();
  if (user) {
    list.push({ group: "account", label: "edit name", run: () => openNames() });
    list.push({ group: "account", label: "sign out", run: signOutNow });
    list.push({ group: "account", label: "delete account", run: openDeleteAccount });
  } else if (signInProviders().length > 0) {
    list.push({ group: "account", label: "sign in", run: () => openSignIn() });
  }
  pick("mode", "mode", MODES);
  pick("time", "time", [15, 30, 60], (v) => `${v} seconds`);
  pick("words", "count", [25, 50, 100], (v) => `${v} words`);
  pick("quote length", "quoteLength", QUOTE_LENGTHS);
  list.push({ group: "custom text", label: "edit", run: () => openCustom() });
  toggle("custom shuffle", "customShuffle");
  pick("language", "language", Object.keys(LANGUAGES) as Language[]);
  pick("word list", "wordList", availableSizes(settings.language), (v) => (v === "200" ? "200 most common" : `${v} most common`));
  toggle("punctuation", "punctuation");
  toggle("numbers", "numbers");
  for (const theme of THEMES) {
    list.push({
      group: "theme",
      label: theme,
      current: settings.theme === theme,
      preview: () => { root.dataset.theme = theme; },
      run: () => change({ theme }),
    });
  }
  pick("layout", "layout", LAYOUTS);
  pick("font", "font", FONTS);
  pick("text size", "textSize", SIZES.map((size) => size.value), (v) => SIZES.find((size) => size.value === v)!.label);
  pick("caret", "caret", CARETS);
  pick("caret movement", "caretMotion", CARET_MOTIONS);
  pick("daily goal", "dailyGoal", GOALS, (v) => (v === 0 ? "off" : `${v} words`));
  toggle("focus", "focusMode");
  toggle("live stats", "liveStats");
  toggle("letter motion", "letterFx");
  toggle("flow line", "flowLine");
  toggle("ghost", "ghost");
  toggle("sound", "sound");
  for (const pack of SOUND_PACKS) {
    list.push({
      group: "sound pack",
      label: pack,
      current: settings.soundPack === pack,
      preview: () => void sound.use(pack).then(() => sound.preview()),
      run: () => change({ soundPack: pack, sound: true }),
    });
  }
  list.push({ group: "open", label: "settings", run: () => setPanel(true) });
  list.push({ group: "open", label: "profile", run: () => showProfile() });
  return list;
}

const palette = new Palette($("palette"), $<HTMLInputElement>("palette-input"), $("palette-list"), $("palette-hl"), commands, () => applySettings());

const customEl = $("custom");
const customText = $<HTMLTextAreaElement>("custom-text");
const customShuffle = $("custom-shuffle");

function customOpen(): boolean {
  return document.body.classList.contains("custom-open");
}

function updateCustomCount(): void {
  const count = customWords(customText.value, false).length;
  $("custom-count").textContent = count === 1 ? "1 word" : `${count} words`;
}

function openCustom(): void {
  if (panelOpen()) setPanel(false);
  if (state === "running") void restart();
  customText.value = settings.customText;
  customShuffle.setAttribute("aria-pressed", String(settings.customShuffle));
  updateCustomCount();
  document.body.classList.add("custom-open");
  customEl.inert = false;
  customText.focus();
}

function closeCustom(): void {
  document.body.classList.remove("custom-open");
  customEl.inert = true;
  customText.blur();
}

function startCustom(): void {
  closeCustom();
  change({
    mode: "custom",
    customText: customText.value.trim(),
    customShuffle: customShuffle.getAttribute("aria-pressed") === "true",
  });
}

customText.addEventListener("input", updateCustomCount);
customText.addEventListener("keydown", (event) => {
  event.stopPropagation();
  if (event.key === "Escape") closeCustom();
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    startCustom();
  }
});
customShuffle.addEventListener("click", () => {
  customShuffle.setAttribute("aria-pressed", String(customShuffle.getAttribute("aria-pressed") !== "true"));
  customText.focus();
});
$("custom-cancel").addEventListener("click", closeCustom);
$("custom-start").addEventListener("click", startCustom);

const profileEl = $("profile");

function profileOpen(): boolean {
  return document.body.classList.contains("show-profile");
}

function showProfile(push = true): void {
  if (state === "running") void restart();
  if (panelOpen()) setPanel(false);
  void withTransition(() => {
    renderProfile(profileEl, profile, settings.language);
    renderAccountRow(profileEl);
    profileEl.scrollTop = 0;
    document.body.classList.add("show-profile");
  });
  if (push && location.pathname !== "/me") history.pushState(null, "", "/me");
}

function hideProfile(push = true): void {
  void withTransition(() => document.body.classList.remove("show-profile"));
  if (push && location.pathname === "/me") history.pushState(null, "", "/");
}

window.addEventListener("popstate", () => (location.pathname === "/me" ? showProfile(false) : hideProfile(false)));
$("daily-link").addEventListener("click", (event) => {
  (event.currentTarget as HTMLElement).blur();
  if (settings.mode === "daily") void restart();
  else change({ mode: "daily" });
});
for (const id of ["profile-button", "touch-profile"]) {
  $(id).addEventListener("click", (event) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).blur();
    if (profileOpen()) hideProfile();
    else showProfile();
  });
}
// the logo and the back link on the profile both lead back to the test
document.addEventListener("click", (event) => {
  const link = (event.target as HTMLElement).closest("#home-link, .profile-back");
  if (!link) return;
  event.preventDefault();
  (link as HTMLElement).blur();
  if (profileOpen()) hideProfile();
});
$("profile-link").addEventListener("click", (event) => {
  event.preventDefault();
  (event.currentTarget as HTMLElement).blur();
  showProfile();
});

function openPalette(): void {
  if (panelOpen()) setPanel(false);
  // a timed run would keep counting behind the palette
  if (state === "running") void restart();
  palette.open();
}

window.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (accountDialogOpen()) {
    if (event.key === "Escape") closeAccountDialog();
    trapDialogFocus(event);
    return;
  }
  if (palette.isOpen || customOpen()) return;

  const key = event.key.toLowerCase();
  const mod = event.metaKey || event.ctrlKey;
  if (mod && (key === "k" || (event.shiftKey && key === "p"))) {
    event.preventDefault();
    openPalette();
    return;
  }
  if (profileOpen()) {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      hideProfile();
      if (event.key === "Tab") void restart();
    }
    return;
  }

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
      if (settings.mode === "endless" || settings.mode === "zen") finish(elapsed(event.timeStamp));
      else void restart();
    } else {
      setPanel(true);
    }
    return;
  }
  if (state === "done") {
    if (event.key === "Enter") void restart();
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key.toLowerCase() === "t" && plain) change({ mode: "train" });
    if (event.key.toLowerCase() === "c" && plain) void shareResult("copy");
    if (event.key.toLowerCase() === "s" && plain) void shareResult("save");
    return;
  }
  if (state === "busy") return;

  if (event.key === "Enter" && event.shiftKey && settings.mode === "zen" && state === "running") {
    event.preventDefault();
    finish(elapsed(event.timeStamp));
    return;
  }

  const altGraph = event.getModifierState("AltGraph");
  if (event.key === "Backspace") {
    event.preventDefault();
    onBackspace(event.ctrlKey || event.altKey, event.code, event.timeStamp);
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
  root.dataset.font = settings.font;
  root.dataset.caret = settings.caret;
  sound.enabled = settings.sound;
  sound.setVolume(settings.volume);
  void sound.use(settings.soundPack);
  stage.layout = settings.layout;
  stage.caretStyle = settings.caret;
  stage.setMotion(prefersReducedMotion ? "off" : settings.caretMotion);
  stage.letterFx = settings.letterFx && !prefersReducedMotion;
  $("flow-track").style.display = settings.flowLine ? "" : "none";
  if (optionsWrap) {
    optionsWrap.dataset.mode = settings.mode;
    segments.forEach((seg) => seg.sync());
  }
}

function change(patch: Partial<Settings>): void {
  if (patch.mode === "custom" && settings.customText.trim() === "" && !("customText" in patch)) openCustom();
  Object.assign(settings, patch);
  saveSettings(settings);
  // a theme change crossfades the whole page instead of repainting colour by colour
  if ("theme" in patch) void withTransition(applySettings);
  else applySettings();
  if ("soundPack" in patch) void sound.use(settings.soundPack).then(() => sound.preview());
  renderMeta();
  if (TEST_KEYS.some((key) => key in patch)) void restart();
  else if ("caret" in patch) {
    stage.caretTo(engine.wordIndex, engine.input.length);
    kick();
  }
}

function renderMeta(flare = false): void {
  const level = $("level");
  level.querySelector("b")!.textContent = `Level ${levelOf(profile.xp)}`;
  level.querySelector<HTMLElement>(".level-fill")!.style.transform = `scaleX(${levelProgress(profile.xp)})`;
  const today = localDay();
  const yesterday = localDay(new Date(Date.now() - 86400000));
  const typedToday = profile.lastDay === today;
  const alive = typedToday || profile.lastDay === yesterday;

  const streak = $("streak");
  streak.hidden = !(alive && profile.streakDays > 0);
  streak.querySelector("b")!.textContent = String(profile.streakDays);
  streak.classList.toggle("lit", typedToday);
  streak.title = typedToday
    ? `${profile.streakDays}-day streak, today is in`
    : `${profile.streakDays}-day streak, type today to keep it`;
  if (flare && typedToday) {
    streak.classList.remove("flare");
    void streak.offsetWidth;
    streak.classList.add("flare");
  }

  const goal = $("goal");
  const words = profile.days[today]?.words ?? 0;
  goal.hidden = settings.dailyGoal === 0;
  goal.classList.toggle("done", words >= settings.dailyGoal);
  goal.title = `${words} of ${settings.dailyGoal} words today`;
  goal.querySelector<HTMLElement>(".goal-fill")!.style.transform = `scaleX(${Math.min(words / Math.max(settings.dailyGoal, 1), 1)})`;

  const daily = $("daily-link");
  const number = dailyNumber();
  const done = profile.dailies[dailyKey(number, settings.language)];
  daily.textContent = `daily #${number}`;
  daily.classList.toggle("open", !done);
  daily.title = done ? `Your first try today: ${Math.round(done.wpm)} wpm` : "Today's words, the same for everyone";
}

function buildControls(): void {
  const modeSeg = segment(MODES.map((value) => ({ label: value, value })), settings.mode, (mode: Mode) => change({ mode }));
  timeSeg = segment([15, 30, 60].map((value) => ({ label: String(value), value })), settings.time, (time) => change({ time }));
  countSeg = segment([25, 50, 100].map((value) => ({ label: String(value), value })), settings.count, (count) => change({ count }));
  const quoteSeg = segment(QUOTE_LENGTHS.map((value) => ({ label: value, value })), settings.quoteLength, (quoteLength) => change({ quoteLength }));
  timeSeg.root.classList.add("only-time");
  countSeg.root.classList.add("only-count");
  quoteSeg.root.classList.add("only-quote");
  const customEdit = document.createElement("button");
  customEdit.type = "button";
  customEdit.className = "toggle-word only-custom";
  customEdit.textContent = "edit text";
  customEdit.addEventListener("click", () => {
    customEdit.blur();
    openCustom();
  });
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
  optionsWrap.append(timeSeg.root, countSeg.root, quoteSeg.root, customEdit, extras);
  $("controls-left").append(modeSeg.root, optionsWrap);
  $("controls-right").append(languageSeg.root);
  segments = [modeSeg, timeSeg, countSeg, quoteSeg, languageSeg];
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
$("backdrop").addEventListener("click", () => {
  setPanel(false);
  palette.close();
  closeCustom();
});

// --- boot

// touch screens get a note instead of a test they can't take, until a real key arrives
if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) {
  document.body.classList.add("touch");
  const noticeKeyboard = (event: KeyboardEvent): void => {
    // a phone's on-screen keyboard fires keys too, but only into a field it opened for
    if ((event.target as HTMLElement).matches?.("input, textarea")) return;
    document.body.classList.add("has-keyboard");
    window.removeEventListener("keydown", noticeKeyboard, { capture: true });
  };
  window.addEventListener("keydown", noticeKeyboard, { capture: true });
}

async function boot(): Promise<void> {
  if (/Mac|iPhone|iPad/.test(navigator.platform)) {
    document.querySelectorAll(".palette-key").forEach((key) => { key.textContent = "⌘k"; });
    $("custom-key").textContent = "⌘ enter";
  }
  const version = $<HTMLAnchorElement>("version");
  version.textContent = `v${__APP_VERSION__}`;
  version.href = `https://github.com/jx-grxf/typesilk/releases/tag/v${__APP_VERSION__}`;
  buildControls();
  segments.push(...buildPanel($("panel-body"), settings, change, resetProfile));
  applySettings();
  renderMeta();
  await fontsReady();
  // badges for what someone already did before badges existed, without a fanfare
  if (awardBadges(profile, null).length > 0) saveProfile(profile);
  segments.forEach((seg) => seg.sync());
  newTest();
  if (location.pathname === "/me") showProfile(false);
  document.body.classList.add("ready");
}

function renderAccountChrome(): void {
  const user = currentAccount();
  const button = $("profile-button");
  fillAvatar(button.querySelector<HTMLElement>(".mini-avatar")!);
  button.querySelector<HTMLElement>(".profile-label")!.textContent = user?.username ?? "profile";
  if (profileOpen()) {
    renderProfile(profileEl, profile, settings.language);
    renderAccountRow(profileEl);
  }
  if (settings.mode === "daily") prepareTicket(dailyNumber(), settings.language);
}

void boot();
onAccountChange(renderAccountChrome);
void loadAccount().then(() => {
  renderAccountChrome();
  const signin = entryParams.get("signin");
  const user = currentAccount();
  if (signin === "failed") openSignIn("That sign-in didn't work. Try again.");
  else if (signin === "blocked") openSignIn("This account is blocked from the board.");
  else if (user && !user.username) openNames(entryParams.get("name") ?? "");
});
