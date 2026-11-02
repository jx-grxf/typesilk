import { currentAccount, loadAccount } from "./account";
import { awardBadges, type Badge } from "./badges";
import { TypingEngine } from "./engine";
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
let wordSpans: HTMLElement[] = [];
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
}

const me = (): RacePlayer | undefined => room?.players.find((p) => p.id === room!.you);

function render(previous: RoomState | null): void {
  if (!room) return;
  setStatus("");
  main.querySelectorAll(".race-view").forEach((node) => node.remove());
  const view = el("div", "race-view");
  if (room.phase === "lobby") view.append(...lobby());
  if (room.phase === "countdown") view.append(countdown(), typingArea(), tracks());
  if (room.phase === "racing") view.append(typingArea(), tracks());
  if (room.phase === "done") view.append(...results());
  status.before(view);
  if (room.phase === "racing" && previous?.phase !== "racing") {
    clearInterval(progressTimer);
    progressTimer = window.setInterval(sendProgress, PROGRESS_EVERY_MS);
  }
  if (room.phase !== "racing") clearInterval(progressTimer);
  if (room.phase === "racing") requestAnimationFrame(follow);
}

function lobby(): HTMLElement[] {
  const state = room!;
  const isHost = state.host === state.you;
  const parts: HTMLElement[] = [];

  const share = el("section", "race-share");
  const link = `${location.origin}/race/${state.code}`;
  share.append(el("p", "race-code", state.code));
  const copy = button("copy link", () => {
    void navigator.clipboard?.writeText(link).then(() => { copy.textContent = "copied"; }).catch(() => { copy.textContent = link; });
  }, "race-link");
  share.append(copy);
  parts.push(share);

  const setup = el("section", "race-setup");
  const language = el("div", "race-options");
  for (const value of Object.keys(LANGUAGES) as Language[]) {
    const option = button(value, () => send({ t: "setup", setup: { ...state.setup, language: value } }), "race-option");
    option.setAttribute("aria-pressed", String(state.setup.language === value));
    option.disabled = !isHost;
    language.append(option);
  }
  const length = el("div", "race-options");
  for (const value of RACE_LENGTHS) {
    const option = button(`${value} words`, () => send({ t: "setup", setup: { ...state.setup, words: value } }), "race-option");
    option.setAttribute("aria-pressed", String(state.setup.words === value));
    option.disabled = !isHost;
    length.append(option);
  }
  setup.append(el("p", "race-note", isHost ? "You set up the race." : "The host sets up the race."), language, length);
  parts.push(setup);

  const players = el("ol", "race-players");
  for (const player of state.players) {
    const row = el("li");
    row.append(el("b", "", player.name), el("span", "race-note", `${player.id === state.host ? "host · " : ""}${player.ready ? "ready" : "not ready"}`));
    players.append(row);
  }
  if (state.players.length < 2) players.append(el("li", "race-note", "Waiting for someone to join."));
  parts.push(players);

  const ready = me()?.ready ?? false;
  const toggle = button(ready ? "not ready" : "ready", () => send({ t: "ready", ready: !ready }), "race-start-button");
  const hint = el("p", "race-note", "enter toggles ready. The race starts when both are ready.");
  parts.push(toggle, hint);
  return parts;
}

function countdown(): HTMLElement {
  const node = el("p", "race-countdown", "3");
  clearInterval(countdownTimer);
  const end = performance.now() + (room!.startsIn ?? 0);
  const tick = (): void => {
    const left = Math.ceil((end - performance.now()) / 1000);
    node.textContent = left > 0 ? String(left) : "go";
    if (left <= 0) clearInterval(countdownTimer);
  };
  tick();
  countdownTimer = window.setInterval(tick, 100);
  return node;
}

function wordHtml(word: string, input: string, active: boolean): string {
  let html = "";
  const length = Math.max(word.length, input.length);
  for (let i = 0; i < length; i++) {
    const typed = input[i];
    const target = word[i];
    const cls = typed === undefined ? "todo" : target === undefined ? "bad extra" : typed === target ? "ok" : "bad";
    html += `<span class="${cls}${active && i === input.length ? " at" : ""}">${escapeHtml(typed ?? target ?? "")}</span>`;
  }
  if (active && input.length >= length) html += '<span class="todo at end"> </span>';
  return html;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function typingArea(): HTMLElement {
  const text = el("div", "race-text");
  wordSpans = words.map((word, i) => {
    const span = el("span", "race-word");
    span.innerHTML = wordHtml(word, engine?.inputs[i] ?? "", room?.phase === "racing" && engine?.wordIndex === i);
    return span;
  });
  text.append(...wordSpans.flatMap((span, i) => (i === 0 ? [span] : [document.createTextNode(" "), span])));
  return text;
}

function paintWord(index: number): void {
  const span = wordSpans[index];
  if (!span || !engine) return;
  span.innerHTML = wordHtml(words[index] ?? "", engine.inputs[index] ?? "", index === engine.wordIndex);
}

function follow(): void {
  const span = wordSpans[engine?.wordIndex ?? 0];
  const box = span?.parentElement;
  if (span && box) box.scrollTop = Math.max(0, span.offsetTop - box.offsetTop - span.offsetHeight);
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
  setStatus("Done. The server is checking your run.");
}

function typeKey(event: KeyboardEvent): void {
  if (room?.phase !== "racing" || !engine || finishSent) return;
  if (event.metaKey || (event.ctrlKey && event.key !== "Backspace")) return;
  const now = performance.now();
  const before = engine.wordIndex;
  if (event.key === "Backspace") {
    event.preventDefault();
    const whole = event.ctrlKey || event.altKey;
    if (engine.backspace(whole).kind === "ignored") return;
    recorder.record(whole ? CLEAR_WORD : BACKSPACE, now);
  } else if (event.key === " ") {
    event.preventDefault();
    const result = engine.space();
    if (result.kind === "ignored") return;
    recorder.record(" ", now);
    if (engine.wordIndex >= words.length) finish();
  } else if ([...event.key].length === 1) {
    event.preventDefault();
    const result = engine.insert(event.key);
    if (result.kind === "ignored") return;
    recorder.record(event.key, now);
    if (engine.lastWordDone) finish();
  } else {
    return;
  }
  paintWord(before);
  if (engine.wordIndex !== before) paintWord(engine.wordIndex);
  follow();
  paintTracks();
}

function results(): HTMLElement[] {
  const state = room!;
  const ranked = [...state.players].sort((a, b) => (a.finish?.place ?? 99) - (b.finish?.place ?? 99));
  const list = el("ol", "race-results");
  for (const player of ranked) {
    const row = el("li");
    const finish = player.finish;
    const place = finish?.place ? (finish.place === 1 ? "won" : `${finish.place}.`) : player.left ? "left" : finish ? "not counted" : "didn't finish";
    row.append(
      el("span", "race-place", place),
      el("b", "", player.id === state.you ? `${player.name} (you)` : player.name),
      el("span", "race-figure", finish ? `${Math.round(finish.wpm)} wpm` : "–"),
      el("span", "race-figure", finish ? `${Math.round(finish.accuracy)}%` : ""),
      el("span", "race-figure", finish ? `${(finish.ms / 1000).toFixed(2)}s` : ""),
    );
    list.append(row);
  }
  const parts: HTMLElement[] = [list];
  recordResult(state);
  if (earned.length > 0) parts.push(el("p", "race-note", `New badge: ${earned.map((badge) => badge.name).join(", ")}.`));
  if (state.host === state.you) parts.push(button("rematch", () => send({ t: "rematch" }), "race-start-button"), el("p", "race-note", "enter starts a rematch."));
  else parts.push(el("p", "race-note", "Waiting for the host to start a rematch."));
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
