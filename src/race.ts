import "@fontsource-variable/jetbrains-mono/wght.css";
import "./typing.css";
import { currentAccount, loadAccount } from "./account";
import { awardBadges, type Badge } from "./badges";
import { prefersReducedMotion } from "./dom";
import { TypingEngine } from "./engine";
import { FlowMeter } from "./flow";
import { recordRace } from "./profile";
import { ProfileStore } from "./profile-store";
import {
  maxChars,
  RACE_CODE,
  RACE_LENGTHS,
  raceWords,
  type ClientMessage,
  type RacePlayer,
  type RoomState,
  type ServerMessage,
} from "./race-protocol";
import { BACKSPACE, CLEAR_WORD, RunRecorder } from "./replay";
import { loadSettings } from "./settings";
import { Sound } from "./sound";
import { Stage } from "./stage";
import { LANGUAGES, type Language } from "./words";

const NAME_KEY = "typesilk.raceName";
const PROGRESS_EVERY_MS = 150;

const main = document.getElementById("race")!;
const status = document.getElementById("race-status")!;
const store = new ProfileStore();

let socket: WebSocket | null = null;
let room: RoomState | null = null;
let words: string[] = [];
let engine: TypingEngine | null = null;
const recorder = new RunRecorder();
const settings = loadSettings();
const sound = new Sound();
const flow = new FlowMeter();
const stageRoot = buildStageRoot();
const stage = new Stage(
  stageRoot.querySelector<HTMLElement>("#scroller")!,
  stageRoot.querySelector<HTMLElement>("#words")!,
  stageRoot.querySelector<HTMLElement>("#caret")!,
  stageRoot.querySelector<HTMLElement>("#ghost")!,
  stageRoot.querySelector<HTMLElement>("#flow-line")!,
);
const hud = stageRoot.querySelector<HTMLElement>("#hud")!;
let rafId = 0;
let lastFrame = 0;
let sentChars = 0;
let finishSent = false;
let progressTimer = 0;
let countdownTimer = 0;
let recordedRound = 0;
let earned: Badge[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void, className = "race-button"): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", () => {
    node.blur();
    onClick();
  });
  return node;
}

function send(message: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function readStoredName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // private windows may refuse; the name is asked again next time
  }
}

function setStatus(text: string): void {
  status.textContent = text;
}

/** /race: open a room, or type in a code someone sent. */
function renderStart(): void {
  const actions = el("div", "race-start");
  const create = button("Open a room", () => {
    create.disabled = true;
    setStatus("Opening a room.");
    void fetch("/api/race", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(async (response) => {
        if (response.status === 429) throw new Error("Too many rooms opened. Try again in a minute.");
        if (!response.ok) throw new Error("The room couldn't be opened. Try again.");
        const { code } = (await response.json()) as { code: string };
        location.assign(`/race/${code}`);
      })
      .catch((error: Error) => {
        create.disabled = false;
        setStatus(error.message);
      });
  });
  const join = el("form", "race-join");
  const input = el("input");
  input.name = "code";
  input.placeholder = "code";
  input.maxLength = 6;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Room code");
  const go = el("button", "race-button", "Join");
  go.type = "submit";
  join.append(input, go);
  join.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = input.value.trim().toUpperCase();
    if (RACE_CODE.test(code)) location.assign(`/race/${code}`);
    else setStatus("A code is six letters and digits.");
  });
  actions.append(create, join);
  status.before(actions);
}

/** Guests pick a name for the room; signed-in people race under their display name. */
function askName(code: string): void {
  const form = el("form", "race-join");
  const input = el("input");
  input.name = "race-name";
  input.placeholder = "your name";
  input.maxLength = 32;
  input.value = readStoredName();
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Your name in the race");
  input.setAttribute("data-1p-ignore", "");
  input.setAttribute("data-lpignore", "true");
  const go = el("button", "race-button", "Enter the room");
  go.type = "submit";
  form.append(input, go);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = input.value.replace(/\s+/g, " ").trim();
    if (!name) return setStatus("Pick a name your friend will see.");
    storeName(name);
    form.remove();
    connect(code, name);
  });
  status.before(form);
  input.focus();
}

function connect(code: string, name: string | null): void {
  setStatus("Joining the room.");
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const query = name ? `?name=${encodeURIComponent(name)}` : "";
  socket = new WebSocket(`${scheme}://${location.host}/api/race/${code}${query}`);
  socket.addEventListener("message", (event) => {
    try {
      receive(JSON.parse(String(event.data)) as ServerMessage);
    } catch (error) {
      console.warn("race message", error);
    }
  });
  socket.addEventListener("close", (event) => {
    socket = null;
    clearInterval(progressTimer);
    if (!room) setStatus("This room is full, already racing, or doesn't exist. Open a new one.");
    else if (event.code === 1008 || event.code === 1009) setStatus("The room closed the connection. Reload to rejoin.");
    else setStatus("The connection dropped. Reload to rejoin.");
  });
}

function receive(message: ServerMessage): void {
  if (message.t === "error") {
    console.warn("race error", message.code);
    return;
  }
  if (message.t === "progress") {
    const player = room?.players.find((p) => p.id === message.id);
    if (player) player.chars = message.chars;
    paintTracks();
    showOpponent();
    return;
  }
  const previous = room;
  room = message;
  if (message.phase === "countdown" && message.seed !== null && previous?.round !== message.round) startRound(message);
  render(previous);
}

function startRound(state: RoomState): void {
  words = raceWords(state.seed!, state.setup);
  engine = new TypingEngine(words);
  recorder.reset();
  sentChars = 0;
  finishSent = false;
  earned = [];
  flow.reset();
  if (!stageRoot.isConnected) status.before(stageRoot);
  // the stage measures letters when it builds the words, so it has to be visible first
  stageRoot.hidden = false;
  stage.reset(words);
  showOpponent();
  kick();
}

const me = (): RacePlayer | undefined => room?.players.find((p) => p.id === room!.you);

function render(previous: RoomState | null): void {
  if (!room) return;
  setStatus("");
  main.querySelectorAll(".race-view").forEach((node) => node.remove());
  const view = el("div", "race-view");
  if (room.phase === "lobby") view.append(...lobby());
  const live = room.phase === "countdown" || room.phase === "racing";
  if (live) view.append(tracks());
  if (room.phase === "done") view.append(...results());
  stageRoot.hidden = !live;
  document.body.classList.toggle("racing", live);
  document.body.classList.add("in-room");
  if (!stageRoot.isConnected) status.before(stageRoot);
  status.before(view);
  if (room.phase === "countdown") countdown();
  if (room.phase === "racing") {
    clearInterval(countdownTimer);
    hud.classList.remove("counting");
    showOpponent();
    kick();
  }
  if (room.phase === "racing" && previous?.phase !== "racing") {
    clearInterval(progressTimer);
    progressTimer = window.setInterval(sendProgress, PROGRESS_EVERY_MS);
  }
  if (room.phase !== "racing") clearInterval(progressTimer);
}

function matchup(state: RoomState): HTMLElement {
  const line = el("div", "race-matchup");
  const side = (player: RacePlayer | undefined, waiting: string): HTMLElement => {
    const node = el("div", "race-side");
    if (!player) {
      node.classList.add("empty");
      node.append(el("b", "", waiting), el("small", "", "send the link"));
      return node;
    }
    node.classList.toggle("is-ready", player.ready);
    const tags = [player.id === state.you ? "you" : "", player.id === state.host ? "host" : "", player.ready ? "ready" : "not ready"].filter(Boolean);
    node.append(el("b", "", player.name), el("small", "", tags.join(" · ")));
    return node;
  };
  const mine = state.players.find((p) => p.id === state.you);
  const other = state.players.find((p) => p.id !== state.you);
  line.append(side(mine, "you"), el("span", "race-vs", "vs"), side(other, "waiting…"));
  return line;
}

function lobby(): HTMLElement[] {
  const state = room!;
  const isHost = state.host === state.you;

  const share = el("div", "race-share");
  const link = `${location.origin}/race/${state.code}`;
  const code = el("p", "race-code", state.code);
  code.setAttribute("aria-label", `Room code ${state.code.split("").join(" ")}`);
  const copy = button("copy link", () => {
    void navigator.clipboard?.writeText(link).then(() => { copy.textContent = "copied"; }).catch(() => { copy.textContent = link; });
  }, "race-link");
  share.append(code, copy);

  const setup = el("dl", "race-setup");
  const options = <T,>(label: string, values: readonly T[], current: T, name: (value: T) => string, pick: (value: T) => void): HTMLElement => {
    const row = el("div");
    const list = el("dd", "race-options");
    for (const value of values) {
      const option = button(name(value), () => pick(value), "race-option");
      option.setAttribute("aria-pressed", String(current === value));
      option.disabled = !isHost;
      list.append(option);
    }
    row.append(el("dt", "", label), list);
    return row;
  };
  setup.append(
    options("language", Object.keys(LANGUAGES) as Language[], state.setup.language, String, (language) => send({ t: "setup", setup: { ...state.setup, language } })),
    options("length", RACE_LENGTHS, state.setup.words, (n) => `${n} words`, (words) => send({ t: "setup", setup: { ...state.setup, words } })),
  );
  if (!isHost) setup.append(el("p", "race-note", "The host picks these."));

  const ready = me()?.ready ?? false;
  const go = el("div", "race-go");
  go.append(
    button(ready ? "not ready" : "ready", () => send({ t: "ready", ready: !ready }), "race-start-button"),
    el("span", "race-note", state.players.length < 2 ? "enter toggles ready; it starts once you're both in and ready" : "enter toggles ready; it starts when you're both ready"),
  );
  return [share, matchup(state), setup, go];
}

function countdown(): void {
  const node = hud;
  node.classList.add("counting");
  clearInterval(countdownTimer);
  const end = performance.now() + (room!.startsIn ?? 0);
  const tick = (): void => {
    const left = Math.ceil((end - performance.now()) / 1000);
    node.textContent = left > 0 ? String(left) : "go";
    if (left <= 0) clearInterval(countdownTimer);
  };
  tick();
  countdownTimer = window.setInterval(tick, 100);
}

/** The same stage the test uses: words glide under a still caret, and the other player is the ghost caret. */
function buildStageRoot(): HTMLElement {
  const root = el("div", "race-stage");
  root.innerHTML = `<div id="anchor"><div id="hud"></div></div>
    <div id="viewport"><div id="scroller"><div id="words"></div><div id="ghost" aria-hidden="true"></div><div id="caret" aria-hidden="true"></div></div></div>
    <div id="flow-track" aria-hidden="true"><div id="flow-line"></div></div>`;
  root.hidden = true;
  return root;
}

function applyLook(): void {
  const html = document.documentElement;
  // classic keeps the setup above the text, which a race room doesn't have
  const layout = settings.layout === "classic" ? "lines" : settings.layout;
  html.dataset.layout = layout;
  html.dataset.size = settings.textSize;
  html.dataset.font = settings.font;
  html.dataset.caret = settings.caret;
  stage.layout = layout;
  stage.caretStyle = settings.caret;
  stage.letterFx = settings.letterFx && !prefersReducedMotion;
  stage.setMotion(prefersReducedMotion ? "off" : settings.caretMotion);
  stageRoot.querySelector<HTMLElement>("#flow-track")!.style.display = settings.flowLine ? "" : "none";
  sound.enabled = settings.sound;
  sound.setVolume(settings.volume);
  if (settings.sound) void sound.use(settings.soundPack);
}

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
  if (room?.phase === "racing" || moving || !flow.settled) rafId = requestAnimationFrame(frame);
}

function showOpponent(): void {
  const other = room?.players.find((p) => p.id !== room!.you && !p.left);
  stage.ghostVisible = other !== undefined;
  if (!other) return stage.hideGhost();
  stage.setGhost(other.chars);
  if (room?.phase === "racing") hud.textContent = `vs ${other.name}`;
  kick();
}

function tracks(): HTMLElement {
  const list = el("ul", "race-tracks");
  for (const player of room!.players) {
    const row = el("li");
    row.dataset.id = player.id;
    const track = el("span", "race-track");
    track.append(el("span", "race-fill"));
    row.append(el("b", "", player.id === room!.you ? `${player.name} (you)` : player.name), track);
    list.append(row);
  }
  queueMicrotask(paintTracks);
  return list;
}

function paintTracks(): void {
  if (!room || words.length === 0) return;
  const total = maxChars(words);
  for (const player of room.players) {
    const fill = main.querySelector<HTMLElement>(`.race-tracks li[data-id="${player.id}"] .race-fill`);
    const chars = player.id === room.you && engine ? engine.correctChars : player.chars;
    if (fill) fill.style.transform = `scaleX(${Math.min(chars / total, 1)})`;
  }
}

function sendProgress(): void {
  if (!engine || finishSent) return;
  const chars = engine.correctChars;
  if (chars === sentChars) return;
  sentChars = chars;
  send({ t: "progress", chars });
}

function finish(): void {
  if (finishSent) return;
  finishSent = true;
  sendProgress();
  send({ t: "finish", log: recorder.log });
  hud.textContent = "done";
  setStatus("The server is checking your run.");
}

function typeKey(event: KeyboardEvent): void {
  if (room?.phase !== "racing" || !engine || finishSent) return;
  if (event.metaKey || (event.ctrlKey && event.key !== "Backspace")) return;
  const now = performance.now();
  if (event.key === "Backspace") {
    event.preventDefault();
    typeBackspace(event.ctrlKey || event.altKey, event.code, now);
  } else if (event.key === " ") {
    event.preventDefault();
    typeSpace(event.code, now);
  } else if ([...event.key].length === 1) {
    event.preventDefault();
    typeChar(event.key, event.code, now);
  } else {
    return;
  }
  paintTracks();
  kick();
}

function typeChar(ch: string, code: string, now: number): void {
  const result = engine!.insert(ch);
  if (result.kind !== "char") return;
  recorder.record(ch, now);
  flow.key(now, result.correct, engine!.streak);
  sound.key(code);
  stage.press(!result.correct);
  if (result.extra) stage.addExtra(result.wordIndex, ch);
  else if (result.correct) stage.markCorrect(result.wordIndex, result.charIndex);
  else stage.markWrong(result.wordIndex, result.charIndex);
  stage.caretTo(engine!.wordIndex, engine!.input.length);
  if (engine!.lastWordDone) finish();
}

function typeSpace(code: string, now: number): void {
  const result = engine!.space();
  if (result.kind !== "commit") return;
  recorder.record(" ", now);
  flow.key(now, result.perfect, engine!.streak);
  sound.key(code);
  stage.press(!result.perfect);
  stage.wordDone(result.wordIndex, result.perfect, result.typedLength);
  if (engine!.wordIndex >= words.length) return finish();
  stage.setActive(engine!.wordIndex);
  stage.caretTo(engine!.wordIndex, 0);
}

function typeBackspace(whole: boolean, code: string, now: number): void {
  const before = engine!.input;
  const result = engine!.backspace(whole);
  if (result.kind === "ignored") return;
  recorder.record(whole ? CLEAR_WORD : BACKSPACE, now);
  sound.key(code);
  stage.press(false);
  const wordLength = engine!.word.length;
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
  stage.caretTo(engine!.wordIndex, engine!.input.length);
}

function results(): HTMLElement[] {
  const state = room!;
  const ranked = [...state.players].sort((a, b) => (a.finish?.place ?? 99) - (b.finish?.place ?? 99));
  const winner = ranked.find((p) => p.finish?.place === 1);
  const second = ranked.find((p) => p.finish?.place === 2);
  const headline = el("div", "race-headline");
  const title = !winner ? "No counted finish" : winner.id === state.you ? "You won" : `${winner.name} won`;
  headline.append(el("p", "race-winner", title));
  if (winner && second) headline.append(el("p", "race-note", `by ${((second.finish!.ms - winner.finish!.ms) / 1000).toFixed(2)} seconds`));

  const list = el("ol", "race-results");
  for (const player of ranked) {
    const row = el("li");
    row.classList.toggle("you", player.id === state.you);
    const finish = player.finish;
    const place = finish?.place ? (finish.place === 1 ? "first" : "second") : player.left ? "left" : finish ? "not counted" : "didn't finish";
    row.append(
      el("span", "race-place", place),
      el("b", "", player.id === state.you ? `${player.name} (you)` : player.name),
      el("span", "race-figure race-wpm", finish ? `${Math.round(finish.wpm)}` : "–"),
      el("span", "race-figure", finish ? `${Math.round(finish.accuracy)}%` : ""),
      el("span", "race-figure", finish ? `${(finish.ms / 1000).toFixed(2)}s` : ""),
    );
    list.append(row);
  }
  const parts: HTMLElement[] = [headline, list];
  if (ranked.some((p) => p.finish && !p.finish.place)) {
    parts.push(el("p", "race-note", "A run is not counted when the server's replay doesn't finish the text, looks scripted, or is faster than the time since the start."));
  }
  recordResult(state);
  if (earned.length > 0) parts.push(el("p", "race-badge", `New badge: ${earned.map((badge) => badge.name).join(", ")}`));
  const go = el("div", "race-go");
  if (state.host === state.you) go.append(button("rematch", () => send({ t: "rematch" }), "race-start-button"), el("span", "race-note", "or press enter"));
  else go.append(el("span", "race-note", "Waiting for the host to start a rematch."));
  parts.push(go);
  return parts;
}

/** Counts the race on the profile once, with the margin when this side won against a counted finish. */
function recordResult(state: RoomState): void {
  if (recordedRound === state.round) return;
  const mine = me()?.finish;
  if (!mine?.place) return;
  recordedRound = state.round;
  const other = state.players.find((p) => p.id !== state.you);
  const won = mine.place === 1 && other !== undefined;
  const margin = won && other.finish?.place ? other.finish.ms - mine.ms : null;
  recordRace(store.profile, won, margin);
  earned = awardBadges(store.profile, null);
  store.save();
}

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea")) return;
  if (event.key === "Enter" && room?.phase === "lobby") {
    event.preventDefault();
    send({ t: "ready", ready: !(me()?.ready ?? false) });
    return;
  }
  if (event.key === "Enter" && room?.phase === "done" && room.host === room.you) {
    event.preventDefault();
    send({ t: "rematch" });
    return;
  }
  typeKey(event);
});

async function boot(): Promise<void> {
  store.watchVisibility();
  applyLook();
  await document.fonts.ready;
  const code = (location.pathname.split("/")[2] ?? "").toUpperCase();
  if (!RACE_CODE.test(code)) {
    renderStart();
    return;
  }
  document.title = `Race ${code} | typesilk`;
  const reached = await loadAccount();
  const user = currentAccount();
  if (reached && user) {
    store.connect(user.id);
    if (user.displayName ?? user.username) return connect(code, null);
  }
  askName(code);
}

void boot();
