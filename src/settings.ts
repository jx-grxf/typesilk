import type { Language } from "./words";

const KEY = "typesilk.settings";

export type Mode = "time" | "words" | "perfect" | "endless" | "train";
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
  language: Language;
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
  volume: number;
};

export const DEFAULTS: Settings = {
  mode: "time",
  time: 30,
  count: 50,
  language: "english",
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
  volume: 0.5,
};

export function loadSettings(): Settings {
  try {
    const stored = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") } as Settings;
    if (!THEMES.includes(stored.theme)) stored.theme = DEFAULTS.theme;
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
  const length = s.mode === "time" ? s.time : s.mode === "endless" ? 0 : s.count;
  return [s.mode, length, s.language, s.punctuation ? "p" : "", s.numbers ? "n" : ""].join(":");
}
