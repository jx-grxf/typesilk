import { currentAccount, signInProviders } from "./account";
import { openDeleteAccount, openNames, openSignIn, signOutNow } from "./account-view";
import { dailyNumber } from "./daily";
import type { Command } from "./palette";
import { QUOTE_LENGTHS } from "./quotes";
import { CARET_MOTIONS, CARETS, FONTS, GOALS, LAYOUTS, MODES, themeLevel, THEMES, type Settings } from "./settings";
import { SOUND_PACKS } from "./sound";
import { availableSizes, LANGUAGES, type Language } from "./words";

export type CommandContext = {
  settings: Settings;
  level: number;
  hasWeakKeys: boolean;
  change(patch: Partial<Settings>): void;
  restart(): void;
  showProfile(): void;
  openCustom(): void;
  openSettings(): void;
  previewTheme(theme: Settings["theme"]): void;
  previewSound(pack: Settings["soundPack"]): void;
};

const SIZES: { label: string; value: Settings["textSize"] }[] = [
  { label: "small", value: "s" },
  { label: "medium", value: "m" },
  { label: "large", value: "l" },
];

/** Everything the command palette can do, built fresh each time it opens. */
export function commands(ctx: CommandContext): Command[] {
  const { settings, change } = ctx;
  const list: Command[] = [];
  const pick = <K extends keyof Settings>(group: string, key: K, values: readonly Settings[K][], label = (v: Settings[K]) => String(v)): void => {
    for (const value of values) {
      list.push({ group, label: label(value), current: settings[key] === value, run: () => change({ [key]: value } as Partial<Settings>) });
    }
  };
  const toggle = (group: string, key: keyof Settings): void => {
    const on = settings[key] as boolean;
    list.push({ group, label: on ? "turn off" : "turn on", run: () => change({ [key]: !on } as Partial<Settings>) });
  };
  list.push({ group: "test", label: "restart", run: ctx.restart });
  list.push({ group: "test", label: `daily #${dailyNumber()}`, current: settings.mode === "daily", run: () => change({ mode: "daily" }) });
  if (ctx.hasWeakKeys) list.push({ group: "test", label: "train weak keys", run: () => change({ mode: "train" }) });
  list.push({ group: "go to", label: "daily leaderboard", run: () => location.assign("/daily") });
  list.push({ group: "go to", label: "profile", run: ctx.showProfile });
  if (currentAccount()) {
    list.push({ group: "account", label: "edit name", run: () => openNames() });
    list.push({ group: "account", label: "sign out", run: signOutNow });
    list.push({ group: "account", label: "delete account", run: openDeleteAccount });
  } else if (signInProviders().length > 0) {
    list.push({ group: "account", label: "sign in", run: () => openSignIn() });
  }
  pick("mode", "mode", MODES);
  pick("time", "time", [15, 30, 60], (v) => `${v} seconds`);
  pick("words", "count", [25, 50, 100], (v) => `${v} words`);
  pick("quote length", "quoteLength", QUOTE_LENGTHS);
  list.push({ group: "custom text", label: "edit", run: ctx.openCustom });
  toggle("custom shuffle", "customShuffle");
  pick("language", "language", Object.keys(LANGUAGES) as Language[]);
  pick("word list", "wordList", availableSizes(settings.language), (v) => (v === "200" ? "200 most common" : `${v} most common`));
  toggle("punctuation", "punctuation");
  toggle("numbers", "numbers");
  for (const theme of THEMES) {
    if (themeLevel(theme) > ctx.level) continue;
    list.push({
      group: "theme",
      label: theme,
      current: settings.theme === theme,
      preview: () => ctx.previewTheme(theme),
      run: () => change({ theme }),
    });
  }
  pick("layout", "layout", LAYOUTS);
  pick("font", "font", FONTS);
  pick("text size", "textSize", SIZES.map((size) => size.value), (v) => SIZES.find((size) => size.value === v)!.label);
  pick("caret", "caret", CARETS);
  pick("caret movement", "caretMotion", CARET_MOTIONS);
  pick("daily goal", "dailyGoal", GOALS, (v) => (v === 0 ? "off" : `${v} words`));
  toggle("focus", "focusMode");
  toggle("live stats", "liveStats");
  toggle("letter motion", "letterFx");
  toggle("flow line", "flowLine");
  toggle("ghost", "ghost");
  toggle("sound", "sound");
  for (const pack of SOUND_PACKS) {
    list.push({
      group: "sound pack",
      label: pack,
      current: settings.soundPack === pack,
      preview: () => ctx.previewSound(pack),
      run: () => change({ soundPack: pack, sound: true }),
    });
  }
  list.push({ group: "open", label: "settings", run: ctx.openSettings });
  list.push({ group: "open", label: "profile", run: ctx.showProfile });
  return list;
}
