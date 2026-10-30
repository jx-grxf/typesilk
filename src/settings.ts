import type { Language } from "./words";

const KEY = "typesilk.settings";

export type Mode = "time" | "words" | "perfect" | "endless" | "train";
export const THEMES = ["noir", "paper", "forest", "klein"] as const;
export type Theme = (typeof THEMES)[number];
export type Layout = "tape" | "lines";
export type TextSize = "s" | "m" | "l";

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
