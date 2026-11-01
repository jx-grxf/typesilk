import { createWordSource, type Language } from "./words";

const FIRST_DAILY = Date.UTC(2026, 10, 1);
export const DAILY_WORDS = 40;

/** Daily #1 was 1 November 2026; the number follows the calendar day of the reader's own timezone. */
export function dailyNumber(date = new Date()): number {
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((day - FIRST_DAILY) / 86400000) + 1;
}

/** Small seeded generator, so every reader gets the same words for the same day. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}

/** The same words for everyone typing the same daily in the same language. */
export function dailyWords(number: number, language: Language): string[] {
  const random = mulberry32(hash(`typesilk daily ${number} ${language}`));
  return createWordSource(language, { punctuation: true, numbers: false, size: "1k" }, random)(DAILY_WORDS);
}

export type DailyResult = { wpm: number; accuracy: number };
/** First finished try per daily and language, keyed like "12:english". */
export type Dailies = Record<string, DailyResult>;

export const dailyKey = (number: number, language: Language): string => `${number}:${language}`;
