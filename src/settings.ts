import { QUOTE_LENGTHS, type QuoteLength } from "./quotes";
import { SOUND_PACKS, type SoundPack } from "./sound";
import { effectiveSize, WORD_LIST_SIZES, type Language, type WordListSize } from "./words";

const KEY = "typesilk.settings";

export const MODES = ["time", "words", "quote", "zen", "custom", "perfect", "endless", "train"] as const;
export type Mode = (typeof MODES)[number];
export const THEMES = ["noir", "paper", "forest", "klein"] as const;
export type Theme = (typeof THEMES)[number];
export const LAYOUTS = ["tape", "lines", "classic"] as const;
export type Layout = (typeof LAYOUTS)[number];
export type TextSize = "s" | "m" | "l";
export const FONTS = ["serif", "mono"] as const;
export type Font = (typeof FONTS)[number];
export const CARETS = ["line", "block", "underline"] as const;
export type CaretStyle = (typeof CARETS)[number];
export const CARET_MOTIONS = ["off", "snappy", "smooth"] as const;
export type CaretMotion = (typeof CARET_MOTIONS)[number];

export type Settings = {
  mode: Mode;
  time: number;
  count: number;
  quoteLength: QuoteLength;
  customText: string;
  customShuffle: boolean;
  language: Language;
  wordList: WordListSize;
  punctuation: boolean;
  numbers: boolean;
  theme: Theme;
  layout: Layout;
  textSize: TextSize;
  font: Font;
  caret: CaretStyle;
  caretMotion: CaretMotion;
  liveStats: boolean;
  focusMode: boolean;
  letterFx: boolean;
  flowLine: boolean;
  ghost: boolean;
  sound: boolean;
  soundPack: SoundPack;
  volume: number;
};

export const DEFAULTS: Settings = {
  mode: "time",
  time: 30,
  count: 50,
  quoteLength: "all",
  customText: "",
  customShuffle: false,
  language: "english",
  wordList: "200",
  punctuation: false,
  numbers: false,
  theme: "noir",
  layout: "tape",
  textSize: "m",
  font: "serif",
  caret: "line",
  caretMotion: "snappy",
  liveStats: false,
  focusMode: true,
  letterFx: true,
  flowLine: true,
  ghost: true,
  sound: true,
  soundPack: "crisp",
  volume: 0.5,
};

export function loadSettings(): Settings {
  try {
    const stored = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") } as Settings;
    if (!THEMES.includes(stored.theme)) stored.theme = DEFAULTS.theme;
    if (!MODES.includes(stored.mode)) stored.mode = DEFAULTS.mode;
    if (!WORD_LIST_SIZES.includes(stored.wordList)) stored.wordList = DEFAULTS.wordList;
    if (!SOUND_PACKS.includes(stored.soundPack)) stored.soundPack = DEFAULTS.soundPack;
    if (!QUOTE_LENGTHS.includes(stored.quoteLength)) stored.quoteLength = DEFAULTS.quoteLength;
    if (!LAYOUTS.includes(stored.layout)) stored.layout = DEFAULTS.layout;
    if (!FONTS.includes(stored.font)) stored.font = DEFAULTS.font;
    if (!CARETS.includes(stored.caret)) stored.caret = DEFAULTS.caret;
    if (!CARET_MOTIONS.includes(stored.caretMotion)) stored.caretMotion = DEFAULTS.caretMotion;
    return stored;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

/** Records are kept per setup, because a 15s sprint and a 60s run aren't comparable. */
export function recordKey(s: Settings): string {
  const length =
    s.mode === "time" ? s.time
    : s.mode === "quote" ? s.quoteLength
    : s.mode === "endless" || s.mode === "zen" || s.mode === "custom" ? 0
    : s.count;
  const wordBased = s.mode !== "quote" && s.mode !== "zen" && s.mode !== "custom";
  const parts = [s.mode, length, s.language, s.punctuation ? "p" : "", s.numbers ? "n" : ""];
  // older records were all made with the short list, so only the long one gets a marker
  const size = effectiveSize(s.language, s.wordList);
  if (wordBased && size !== "200") parts.push(size);
  return parts.join(":");
}
