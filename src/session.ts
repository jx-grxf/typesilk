import { showDailyRank } from "./account-view";
import { prepareTicket } from "./account";
import { dailyNumber, dailyWords } from "./daily";
import { $, prefersReducedMotion, withTransition } from "./dom";
import { MIN_RATE_MS, consistency, rollingWpm, TypingEngine, wpm } from "./engine";
import { FlowMeter } from "./flow";
import { localDay } from "./profile";
import type { ProfileStore } from "./profile-store";
import { setupName } from "./profile-view";
import { QuietGate } from "./quiet-gate";
import { customWords, pickQuote, quoteLength, type Quote } from "./quotes";
import { recordRun } from "./record-run";
import { BACKSPACE, CLEAR_WORD, RunRecorder } from "./replay";
import { renderResults } from "./results";
import { recordKey, type Settings } from "./settings";
import type { Sound } from "./sound";
import { Stage } from "./stage";
import { recordKey as recordKeyStat, trend, weakKeys } from "./training";
import { createTrainingSource, createWordSource, loadWords } from "./words";

const CHUNK = 50;
const REFILL_AT = 30;
const PROGRESS_RUNS = 40;
const FALLBACK_TEXT = "Paste anything you like to practise here, a letter, notes or a page from a book.";
const FONT_FAMILIES: Record<Settings["font"], string> = { serif: "Newsreader Variable", mono: "JetBrains Mono Variable" };

type State = "idle" | "running" | "done" | "busy";
type Spring = { duration: number; easing: string };

export type SessionHooks = {
  /** Starting a test always means typing, so whatever covers the text closes first. */
  beforeRestart(): void;
  afterRun(firstToday: boolean): void;
};

/** One test at a time: its words, the keys typed into it, the moving text and the result. */
export class TypingSession {
  state: State = "busy";
  readonly recorder = new RunRecorder();
  readonly stage = new Stage($("scroller"), $("words"), $("caret"), $("ghost"), $("flow-line"));
  private readonly flow = new FlowMeter();
  private readonly resultShortcuts = new QuietGate(600);
  private readonly typingEl = $("typing");
  private readonly resultsEl = $("results");
  private readonly hudEl = $("hud");
  private readonly liveEl = $("live");
  private readonly comboEl = $("combo");

  private engine = new TypingEngine([]);
  private nextWords: (count: number) => string[] = () => [];
  private startedAt = 0;
  private lastKeyAt = 0;
  private gaps: number[] = [];
  private samples: number[] = [];
  private backspaces = 0;
  private trainingKeys: string[] = [];
  private ghostSeries: number[] | null = null;
  private hudText = "";
  private liveText = "";
  private fixedLength = 0;
  private currentQuote: Quote | null = null;
  private rafId = 0;
  private lastFrame = 0;

  constructor(
    private readonly settings: Settings,
    private readonly store: ProfileStore,
    private readonly sound: Sound,
    private readonly spring: Spring,
    private readonly hooks: SessionHooks,
  ) {
    // time mode has to end on time even if frames stop, for example in a background tab
    setInterval(() => {
      if (this.state === "running" && this.settings.mode === "time") this.tick(performance.now());
    }, 100);
  }

  get running(): boolean {
    return this.state === "running";
  }

  /** The mode runs until the person ends it, with esc or shift + enter. */
  get openEnded(): boolean {
    return this.settings.mode === "endless" || this.settings.mode === "zen";
  }

  get weakKeys(): string[] {
    return weakKeys(this.store.profile.keys);
  }

  elapsed(now: number): number {
    return Math.max(0, now - this.startedAt);
  }

  /** Letter shortcuts on the results page wait until the keyboard has been quiet for a moment. */
  shortcutsReady(now: number): boolean {
    return this.resultShortcuts.pass(now);
  }

  // a single rAF that sleeps as soon as nothing is moving
  kick(): void {
    if (this.rafId !== 0) return;
    this.lastFrame = performance.now() - 8;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.rafId = 0;
    const dt = Math.min((now - this.lastFrame) / 1000, 1 / 30);
    this.lastFrame = now;
    this.flow.update(dt);
    const moving = this.stage.update(dt, this.flow.value);
    if (this.state === "running") this.tick(performance.now());
    if (this.state === "running" || moving || !this.flow.settled) this.rafId = requestAnimationFrame(this.frame);
  };

  newTest(): void {
    const { settings } = this;
    const mode = settings.mode;
    this.trainingKeys = mode === "train" ? weakKeys(this.store.profile.keys, 5) : [];
    this.nextWords = () => [];
    let words: string[] = [];
    if (mode === "daily") {
      words = dailyWords(dailyNumber(), settings.language);
    } else if (mode === "quote") {
      this.currentQuote = pickQuote(settings.language, settings.quoteLength, this.currentQuote);
      words = this.currentQuote.text.split(" ");
    } else if (mode === "custom") {
      words = customWords(settings.customText.trim() || FALLBACK_TEXT, settings.customShuffle);
    } else if (mode !== "zen") {
      this.nextWords = mode === "train"
        ? createTrainingSource(settings.language, this.trainingKeys, Math.random, settings.wordList)
        : createWordSource(settings.language, { punctuation: settings.punctuation, numbers: settings.numbers, size: settings.wordList });
      const counted = mode === "words" || mode === "perfect" || mode === "train";
      words = this.nextWords(counted ? settings.count : CHUNK * 2);
    }
    this.fixedLength = mode === "words" || mode === "perfect" || mode === "train" || mode === "quote" || mode === "custom" || mode === "daily"
      ? words.length
      : 0;
    this.engine = new TypingEngine(words, mode === "zen");
    this.recorder.reset();
    if (mode === "daily") prepareTicket(dailyNumber(), settings.language);
    this.samples = [];
    this.backspaces = 0;
    this.flow.reset();
    this.stage.reset(this.engine.words);
    this.ghostSeries = settings.ghost && !prefersReducedMotion ? (this.store.profile.bests[recordKey(settings)]?.series ?? null) : null;
    this.stage.ghostVisible = this.ghostSeries !== null;
    document.body.classList.remove("focus", "show-results");
    this.state = "idle";
    this.renderHud();
    this.setEscLabel();
    this.kick();
  }

  /** Words are measured once, so they must never be measured with a fallback font. */
  async fontsReady(): Promise<void> {
    const family = FONT_FAMILIES[this.settings.font];
    await Promise.all([
      document.fonts.load(`400 64px "${family}"`),
      document.fonts.load(`italic 400 64px "${family}"`),
      // the daily draws from the 1k list, and everyone has to get the same words
      loadWords(this.settings.language, this.settings.mode === "daily" ? "1k" : this.settings.wordList),
    ]);
  }

  async restart(): Promise<void> {
    this.hooks.beforeRestart();
    if (this.state === "busy") return;
    const fromResults = this.state === "done";
    this.state = "busy";
    const fonts = this.fontsReady();
    if (!fromResults) {
      await this.typingEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 70, easing: "ease-in", fill: "forwards" }).finished;
    }
    await fonts;
    if (fromResults) {
      await withTransition(() => this.newTest());
      return;
    }
    this.newTest();
    for (const animation of this.typingEl.getAnimations()) animation.cancel();
    this.typingEl.animate(
      [{ opacity: 0, transform: "translateX(0.6rem)" }, { opacity: 1, transform: "none" }],
      { duration: this.spring.duration, easing: this.spring.easing },
    );
  }

  /** Puts the caret and every word back where the current layout wants them. */
  remeasure(): void {
    this.stage.remeasureAll(this.engine.wordIndex, this.engine.input.length);
  }

  redrawCaret(): void {
    this.stage.caretTo(this.engine.wordIndex, this.engine.input.length);
    this.kick();
  }

  private start(now: number): void {
    this.state = "running";
    this.startedAt = now;
    this.lastKeyAt = 0;
    this.gaps = [];
    if (this.settings.focusMode) document.body.classList.add("focus");
    this.setEscLabel();
  }

  private tick(now: number): void {
    const ms = this.elapsed(now);
    while (this.samples.length < Math.floor(ms / 1000)) this.samples.push(this.engine.correctChars);
    if (this.settings.mode === "time" && ms >= this.settings.time * 1000) {
      this.finish(this.settings.time * 1000);
      return;
    }
    const ghost = this.ghostSeries;
    if (ghost) {
      const seconds = ms / 1000;
      const whole = Math.floor(seconds);
      const from = whole === 0 ? 0 : (ghost[whole - 1] ?? ghost[ghost.length - 1] ?? 0);
      const to = ghost[whole] ?? from;
      this.stage.setGhost(from + (to - from) * (seconds - whole));
    }
    this.renderHud();
  }

  renderHud(): void {
    const { settings, engine } = this;
    const ms = this.state === "running" ? this.elapsed(performance.now()) : 0;
    let text: string;
    if (settings.mode === "time") text = String(Math.max(0, Math.ceil(settings.time - ms / 1000)));
    else if (this.fixedLength === 0) text = `${Math.floor(ms / 1000)}s`;
    else text = `${Math.min(engine.wordIndex, this.fixedLength)}/${this.fixedLength}`;
    if (settings.mode === "daily" && this.state !== "running") text = `daily #${dailyNumber()}`;
    if (settings.mode === "train" && this.state !== "running") {
      text = this.trainingKeys.length > 0 ? `training ${this.trainingKeys.join(" ")}` : "no weak keys yet";
    }
    if (text !== this.hudText) {
      this.hudEl.textContent = text;
      this.hudText = text;
    }
    // the first second of a run swings too wildly to be worth showing
    const live = settings.liveStats && this.state === "running" && ms >= 1000
      ? `${Math.round(wpm(engine.correctChars, ms))} wpm  ${Math.floor(engine.accuracy)}%`
      : "";
    if (live !== this.liveText) {
      this.liveEl.textContent = live;
      this.liveText = live;
    }
  }

  private setEscLabel(): void {
    $("esc-label").textContent = this.state === "running" && this.openEnded ? "finish" : this.state === "running" ? "stop" : "settings";
  }

  finish(durationMs: number, failedAtWord: number | null = null): void {
    if (this.state !== "running") return;
    this.state = "done";
    this.resultShortcuts.close(performance.now());
    document.body.classList.remove("focus", "pointer-awake");
    this.stage.hideGhost();
    const { settings, engine } = this;
    const profile = this.store.profile;
    const rateMs = Math.max(durationMs, MIN_RATE_MS);
    const rate = wpm(engine.correctChars, rateMs);
    const raw = wpm(engine.totalKeys, rateMs);
    const series = rollingWpm(this.samples);
    const key = recordKey(settings);
    const failed = failedAtWord !== null;
    const daily = settings.mode === "daily" ? dailyNumber() : null;
    const quote = settings.mode === "quote" ? this.currentQuote : null;
    const outcome = recordRun(profile, {
      key,
      mode: settings.mode,
      language: settings.language,
      daily,
      wpm: rate,
      rawWpm: raw,
      accuracy: engine.accuracy,
      chars: engine.correctChars,
      durationMs,
      samples: this.samples,
      series,
      gaps: this.gaps,
      words: engine.wordIndex,
      failed,
      quoteLength: quote ? quoteLength(quote) : null,
      backspaces: this.backspaces,
      saidName: engine.inputs.some((input) => input.toLowerCase() === "typesilk"),
    }, localDay());
    this.store.save();
    this.hooks.afterRun(outcome.firstToday);

    // the timer above the text grows into the big number on the results page
    void withTransition(() => {
      renderResults(this.resultsEl, {
        wpm: rate,
        raw,
        accuracy: engine.accuracy,
        consistency: consistency(series),
        seconds: durationMs / 1000,
        series,
        reward: outcome.reward,
        xp: profile.xp,
        failedAt: failed ? { word: failedAtWord + 1, total: this.fixedLength } : null,
        weakKeys: weakKeys(profile.keys),
        trend: trend(profile.history, key),
        progress: profile.history.filter((run) => run.key === key).slice(-PROGRESS_RUNS).map((run) => run.wpm),
        streakDays: profile.streakDays,
        source: quote ? `${quote.author}, ${quote.work}` : null,
        keys: profile.keys,
        language: settings.language,
        setup: daily === null ? setupName(key) : `daily #${daily} · ${settings.language}`,
        badges: outcome.badges,
        daily: outcome.daily,
      });
      if (daily !== null && !failed) showDailyRank(this.resultsEl, daily, settings.language, this.recorder.log);
      document.body.classList.add("show-results");
    });
    this.setEscLabel();
    this.kick();
  }

  private flashCombo(): void {
    const streak = this.engine.streak;
    if (streak < 25 || streak % 25 !== 0 || (streak > 25 && streak % 50 !== 0)) return;
    this.comboEl.textContent = String(streak);
    this.comboEl.animate(
      [
        { opacity: 0.5, transform: "translate(-50%,-50%) scale(0.92)" },
        { opacity: 0, transform: "translate(-50%,-50%) scale(1.06)" },
      ],
      { duration: 1100, easing: "cubic-bezier(.15,.7,.3,1)" },
    );
  }

  typeChar(ch: string, code: string, now: number): void {
    const { engine, stage } = this;
    if (this.state === "idle") this.start(now);
    const expected = engine.word[engine.input.length];
    const gap = this.lastKeyAt > 0 ? now - this.lastKeyAt : null;
    this.lastKeyAt = now;
    if (gap !== null) this.gaps.push(gap);
    this.recorder.record(ch, now);
    const result = engine.insert(ch);
    if (result.kind !== "char") return;

    if (expected !== undefined) recordKeyStat(this.store.profile.keys, expected, result.correct, gap);
    this.flow.key(now, result.correct, engine.streak);
    this.sound.key(code);
    stage.press(!result.correct);

    if (engine.free) stage.addTyped(result.wordIndex, ch);
    else if (result.extra) stage.addExtra(result.wordIndex, ch);
    else if (result.correct) stage.markCorrect(result.wordIndex, result.charIndex);
    else stage.markWrong(result.wordIndex, result.charIndex);

    stage.caretTo(engine.wordIndex, engine.input.length);

    if (!result.correct && this.settings.mode === "perfect") {
      this.finish(this.elapsed(now), engine.wordIndex);
      return;
    }
    if (result.correct) this.flashCombo();

    if (this.fixedLength > 0 && engine.lastWordDone) {
      this.finish(this.elapsed(now));
      return;
    }
    this.kick();
  }

  typeSpace(code: string, now: number): void {
    if (this.state !== "running") return;
    const { engine, stage } = this;
    this.lastKeyAt = now;
    this.recorder.record(" ", now);
    const result = engine.space();
    if (result.kind !== "commit") return;

    this.flow.key(now, result.perfect, engine.streak);
    this.sound.key(code);
    stage.press(!result.perfect);
    stage.wordDone(result.wordIndex, result.perfect, result.typedLength);
    if (!result.perfect && this.settings.mode === "perfect") {
      this.finish(this.elapsed(now), result.wordIndex);
      return;
    }

    if (this.fixedLength > 0 && engine.wordIndex >= engine.words.length) {
      this.finish(this.elapsed(now));
      return;
    }
    if (engine.free) {
      stage.append([""]);
    } else if (this.fixedLength === 0 && engine.words.length - engine.wordIndex < REFILL_AT) {
      const words = this.nextWords(CHUNK);
      engine.extend(words);
      stage.append(words);
    }
    stage.setActive(engine.wordIndex);
    stage.caretTo(engine.wordIndex, 0);
    this.kick();
  }

  typeBackspace(whole: boolean, code: string, now: number): void {
    if (this.state !== "running") return;
    const { engine, stage } = this;
    this.recorder.record(whole ? CLEAR_WORD : BACKSPACE, now);
    const before = engine.input;
    const result = engine.backspace(whole);
    if (result.kind === "ignored") return;
    this.backspaces++;
    this.sound.key(code);
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
    this.kick();
  }
}
