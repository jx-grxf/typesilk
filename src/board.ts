import { avatarNode } from "./avatar";
import { dailyNumber } from "./daily";
import { LANGUAGES, type Language } from "./words";

type Entry = { rank: number; username: string; displayName: string; wpm: number; accuracy: number };
type Board = { daily: number; language: Language; today: number; total: number; you: { rank: number; wpm: number; accuracy: number } | null; entries: Entry[] };

const LANGUAGE_NAMES = Object.keys(LANGUAGES) as Language[];

function storedLanguage(): Language {
  try {
    const stored = (JSON.parse(localStorage.getItem("typesilk.settings") ?? "{}") as { language?: string }).language;
    if (stored && Object.hasOwn(LANGUAGES, stored)) return stored as Language;
  } catch (error) {
    console.warn("settings unreadable", error);
  }
  return "english";
}

const params = new URLSearchParams(location.search);
const requestedLanguage = params.get("lang");
const language: Language = requestedLanguage && Object.hasOwn(LANGUAGES, requestedLanguage) ? (requestedLanguage as Language) : storedLanguage();
const requestedDay = Number(params.get("day"));
const today = dailyNumber();
const day = Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= today + 1 ? requestedDay : today;

const pageUrl = (nextDay: number, nextLanguage: Language): string => `/daily?day=${nextDay}&lang=${nextLanguage}`;

function renderChrome(): void {
  document.getElementById("board-title")!.textContent = `Daily #${day}`;
  const languages = document.getElementById("board-languages")!;
  for (const name of LANGUAGE_NAMES) {
    const link = document.createElement("a");
    link.href = pageUrl(day, name);
    link.textContent = name;
    if (name === language) link.setAttribute("aria-current", "true");
    languages.append(link);
  }
  const days = document.getElementById("board-days")!;
  if (day > 1) {
    const previous = document.createElement("a");
    previous.href = pageUrl(day - 1, language);
    previous.textContent = `← #${day - 1}`;
    days.append(previous);
  }
  if (day < today) {
    const next = document.createElement("a");
    next.href = pageUrl(day + 1, language);
    next.textContent = `#${day + 1} →`;
    days.append(next);
  }
}

function row(entry: Entry): HTMLElement {
  const node = document.createElement("li");
  const rank = document.createElement("span");
  rank.className = "board-rank";
  rank.textContent = String(entry.rank);
  const who = document.createElement("span");
  who.className = "board-who";
  const face = document.createElement("span");
  face.className = "board-face";
  face.append(avatarNode(entry.username));
  const name = document.createElement("b");
  name.textContent = entry.displayName;
  const handle = document.createElement("small");
  handle.textContent = `@${entry.username}`;
  who.append(face, name, handle);
  const speed = document.createElement("span");
  speed.className = "board-wpm";
  speed.textContent = String(Math.round(entry.wpm));
  const accuracy = document.createElement("span");
  accuracy.className = "board-acc";
  accuracy.textContent = `${Math.floor(entry.accuracy)}%`;
  node.append(rank, who, speed, accuracy);
  return node;
}

async function load(): Promise<void> {
  const status = document.getElementById("board-status")!;
  const list = document.getElementById("board-list")!;
  status.textContent = "Loading…";
  try {
    const response = await fetch(`/api/daily/${day}/${language}`);
    if (!response.ok) throw new Error(String(response.status));
    const board = (await response.json()) as Board;
    list.replaceChildren(...board.entries.map(row));
    if (board.you) {
      status.textContent = `You're #${board.you.rank} of ${board.total}, ${Math.round(board.you.wpm)} wpm.`;
    } else if (board.total === 0) {
      status.textContent = "Nobody is on this board yet.";
    } else {
      status.textContent = board.total === 1 ? "1 typist." : `${board.total} typists.`;
    }
  } catch (error) {
    console.warn("board unavailable", error);
    status.textContent = "The board isn't available right now.";
  }
}

renderChrome();
void load();
