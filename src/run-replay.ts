import { TypingEngine } from "./engine";
import { BACKSPACE, CLEAR_WORD, type RunLog } from "./replay";

const SPEEDS = [1, 2, 4] as const;
/** A long think during the run shouldn't leave the replay standing still for as long. */
const MAX_PAUSE_MS = 1200;

type Controller = { toggle(): void };
let current: Controller | null = null;

/** Play or pause the replay on the results page, for the `r` key. */
export function toggleReplay(): void {
  current?.toggle();
}

function apply(engine: TypingEngine, key: string): void {
  if (key === " ") engine.space();
  else if (key === BACKSPACE) engine.backspace();
  else if (key === CLEAR_WORD) engine.backspace(true);
  else engine.insert(key);
}

function wordHtml(word: string, input: string, active: boolean): string {
  let html = "";
  const length = Math.max(word.length, input.length);
  for (let i = 0; i < length; i++) {
    const typed = input[i];
    const target = word[i];
    const cls = typed === undefined ? "todo" : target === undefined ? "bad extra" : typed === target ? "ok" : "bad";
    const caret = active && i === input.length ? " at" : "";
    html += `<span class="${cls}${caret}">${escape(typed ?? target ?? "")}</span>`;
  }
  if (active && input.length >= length) html += `<span class="todo at end"> </span>`;
  return html;
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** The words a run got to, so a 30-second run doesn't replay against a page of untouched text. */
export function reachedWords(words: string[], log: RunLog): string[] {
  const engine = new TypingEngine(words);
  for (const key of log.keys) apply(engine, key);
  return words.slice(0, Math.min(words.length, engine.wordIndex + 1));
}

/** The run typed again in front of you, key by key, at its recorded pace. */
export function buildReplay(words: string[], log: RunLog): HTMLElement {
  const shown = reachedWords(words, log);

  const wrap = document.createElement("figure");
  wrap.className = "replay";
  const head = document.createElement("figcaption");
  const title = document.createElement("span");
  title.textContent = "Replay of this run";
  const play = document.createElement("button");
  play.type = "button";
  play.className = "share";
  const speed = document.createElement("button");
  speed.type = "button";
  speed.className = "share";
  const controls = document.createElement("span");
  controls.className = "replay-controls";
  controls.append(play, speed);
  head.append(title, controls);
  const text = document.createElement("div");
  text.className = "replay-text";
  wrap.append(head, text);

  const spans = shown.map((word) => {
    const span = document.createElement("span");
    span.className = "replay-word";
    span.innerHTML = wordHtml(word, "", false);
    return span;
  });
  text.append(...spans.flatMap((span, i) => (i === 0 ? [span] : [document.createTextNode(" "), span])));

  let engine = new TypingEngine(shown);
  let index = 0;
  let timer = 0;
  let playing = false;
  let speedIndex = 0;

  const label = (): void => {
    play.innerHTML = playing ? "pause" : index > 0 && index >= log.keys.length ? "again" : "<kbd>r</kbd> play";
    speed.textContent = `${SPEEDS[speedIndex]}×`;
  };

  const paint = (wordIndex: number): void => {
    const span = spans[wordIndex];
    if (!span) return;
    span.innerHTML = wordHtml(shown[wordIndex] ?? "", engine.inputs[wordIndex] ?? "", wordIndex === engine.wordIndex);
  };

  const follow = (): void => {
    const span = spans[engine.wordIndex];
    if (span) text.scrollTop = Math.max(0, span.offsetTop - text.offsetTop - span.offsetHeight);
  };

  const reset = (): void => {
    engine = new TypingEngine(shown);
    index = 0;
    spans.forEach((_, i) => paint(i));
    text.scrollTop = 0;
  };

  const step = (): void => {
    if (!wrap.isConnected) return stop();
    if (index >= log.keys.length) return stop();
    const before = engine.wordIndex;
    apply(engine, log.keys[index]!);
    index++;
    paint(before);
    if (engine.wordIndex !== before) paint(engine.wordIndex);
    follow();
    const gap = Math.min(log.gaps[index] ?? 0, MAX_PAUSE_MS) / SPEEDS[speedIndex]!;
    timer = window.setTimeout(step, gap);
  };

  function stop(): void {
    clearTimeout(timer);
    playing = false;
    label();
  }

  const toggle = (): void => {
    if (playing) return stop();
    if (index >= log.keys.length) reset();
    playing = true;
    label();
    paint(engine.wordIndex);
    timer = window.setTimeout(step, 0);
  };

  play.addEventListener("click", () => {
    play.blur();
    toggle();
  });
  speed.addEventListener("click", () => {
    speed.blur();
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    label();
  });

  label();
  current = { toggle };
  return wrap;
}
