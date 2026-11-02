import { mulberry32 } from "./daily";
import type { RunLog } from "./replay";
import { createWordSource, LANGUAGES, type Language } from "./words";

/** No 0/O, 1/I/L, so a code read out loud or off a phone arrives intact. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const RACE_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
export const RACE_LENGTHS = [25, 50, 100] as const;
export type RaceLength = (typeof RACE_LENGTHS)[number];
export const COUNTDOWN_MS = 3000;

export type RaceSetup = { language: Language; words: RaceLength };
export const DEFAULT_SETUP: RaceSetup = { language: "english", words: 25 };

export type RacePhase = "lobby" | "countdown" | "racing" | "done";

export type RaceFinish = {
  wpm: number;
  accuracy: number;
  /** Server time from the start signal to the finish arriving. */
  ms: number;
  /** 1 for the winner; null when the replay didn't hold up and the run doesn't count. */
  place: number | null;
};

export type RacePlayer = { id: string; name: string; ready: boolean; chars: number; finish: RaceFinish | null; left: boolean };

export type RoomState = {
  t: "room";
  code: string;
  you: string;
  host: string;
  phase: RacePhase;
  setup: RaceSetup;
  /** Set from the countdown on; both sides draw the same words from it. */
  seed: number | null;
  /** Milliseconds until the start, sent with the countdown so no clocks need to agree. */
  startsIn: number | null;
  /** Counts up with every race in the room, so a client knows when a new one began. */
  round: number;
  players: RacePlayer[];
};

export type ClientMessage =
  | { t: "setup"; setup: RaceSetup }
  | { t: "ready"; ready: boolean }
  | { t: "progress"; chars: number }
  | { t: "finish"; log: RunLog }
  | { t: "rematch" };

export type ServerMessage = RoomState | { t: "progress"; id: string; chars: number } | { t: "error"; code: string };

export function raceWords(seed: number, setup: RaceSetup): string[] {
  return createWordSource(setup.language, { punctuation: false, numbers: false, size: "200" }, mulberry32(seed))(setup.words);
}

/** The most `correctChars` can reach on these words: every letter plus the space after each word. */
export const maxChars = (words: string[]): number => words.reduce((sum, word) => sum + word.length + 1, 0);

export function isRaceSetup(value: unknown): value is RaceSetup {
  if (typeof value !== "object" || value === null) return false;
  const { language, words } = value as Record<string, unknown>;
  return typeof language === "string" && Object.hasOwn(LANGUAGES, language) && RACE_LENGTHS.includes(words as RaceLength);
}
