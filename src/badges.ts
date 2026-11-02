import type { Profile } from "./profile";

export type Rarity = "common" | "rare" | "epic" | "legendary";
export const RARITIES: Rarity[] = ["common", "rare", "epic", "legendary"];

/** What a finished run tells the badges. Scripted-looking runs never reach this. */
export type RunFacts = {
  mode: string;
  seconds: number;
  wpm: number;
  accuracy: number;
  consistency: number;
  words: number;
  finished: boolean;
  quoteLength: string | null;
  language: string;
  backspaces: number;
  saidName: boolean;
  firstToday: boolean;
  /** A record beaten, not the first mark set in a mode. */
  newBest: boolean;
};

type Context = { profile: Profile; run: RunFacts | null; now: Date };

export type Badge = {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  glyph: string;
  /** Hidden until earned, so finding it is part of it. */
  secret?: boolean;
  /** What a secret badge shows while locked: enough to start looking, not the answer. */
  hint?: string;
  earned(ctx: Context): boolean;
  /** Where you stand on a badge you don't have yet, as [now, goal]. */
  progress?(profile: Profile): [number, number];
};

const comparable = (run: RunFacts | null): run is RunFacts =>
  run !== null && run.finished && run.mode !== "zen" && run.mode !== "custom";
const fast = (wpm: number, accuracy = 95) => (c: Context): boolean =>
  comparable(c.run) && c.run.seconds >= 30 && c.run.wpm >= wpm && c.run.accuracy >= accuracy;
const words = (profile: Profile): number => profile.totalChars / 5;
const bestWpm = (profile: Profile): number => Math.max(0, ...Object.values(profile.bests).map((best) => best.wpm));
const toSpeed = (goal: number) => (p: Profile): [number, number] => [Math.round(bestWpm(p)), goal];
const toStreak = (goal: number) => (p: Profile): [number, number] => [p.streakDays, goal];
const toWords = (goal: number) => (p: Profile): [number, number] => [Math.round(words(p)), goal];
const flawless = (c: Context): c is Context & { run: RunFacts } =>
  comparable(c.run) && c.run.seconds >= 30 && c.run.accuracy === 100;
const hourMs = 3_600_000;
const binge = (c: Context): boolean =>
  c.run !== null && c.profile.history.filter((entry) => entry.at !== undefined && c.now.getTime() - entry.at < hourMs).length >= 10;
const languagesToday = (c: Context): number => {
  const today = new Date(c.now);
  today.setHours(0, 0, 0, 0);
  const seen = new Set(c.profile.history.filter((entry) => (entry.at ?? 0) >= today.getTime()).map((entry) => entry.key.split(":")[2]));
  if (c.run) seen.add(c.run.language);
  return seen.size;
};
/** The run before this one was the slowest of the last ten in the same setup, and this one is a record. */
const comeback = (c: Context): boolean => {
  if (!comparable(c.run) || !c.run.newBest) return false;
  const key = c.profile.history.at(-1)?.key;
  const before = c.profile.history.filter((entry) => entry.key === key).slice(0, -1).slice(-10).map((entry) => entry.wpm);
  return before.length === 10 && before.at(-1) === Math.min(...before);
};
const palindrome = (n: number): boolean => n >= 101 && String(n) === [...String(n)].reverse().join("");

export const BADGES: Badge[] = [
  { id: "first-words", name: "First words", description: "Finish your first run.", rarity: "common", glyph: "¶", earned: (c) => c.profile.tests >= 1 },
  { id: "duel", name: "Duel", description: "Finish a race against someone.", rarity: "common", glyph: "vs", earned: (c) => c.profile.races.played >= 1 },
  { id: "sixty", name: "Sixty", description: "60 wpm over 30 seconds or more.", rarity: "common", glyph: "60", progress: toSpeed(60), earned: fast(60) },
  { id: "seven", name: "Seven", description: "Type on seven days in a row.", rarity: "common", glyph: "7", progress: toStreak(7), earned: (c) => c.profile.streakDays >= 7 },
  { id: "day-one", name: "Day one", description: "Finish a daily.", rarity: "common", glyph: "#", earned: (c) => Object.keys(c.profile.dailies).length >= 1 },
  { id: "thousand", name: "Thousand", description: "1,000 words typed in total.", rarity: "common", glyph: "1k", progress: toWords(1000), earned: (c) => words(c.profile) >= 1000 },

  { id: "hundred", name: "Hundred", description: "100 wpm over 30 seconds or more, 95% accurate.", rarity: "rare", glyph: "100", progress: toSpeed(100), earned: fast(100) },
  { id: "clean-sheet", name: "Clean sheet", description: "A whole minute without a single mistake.", rarity: "rare", glyph: "0", earned: (c) => comparable(c.run) && c.run.seconds >= 60 && c.run.accuracy === 100 },
  { id: "thirty", name: "Thirty", description: "Type on thirty days in a row.", rarity: "rare", glyph: "30", progress: toStreak(30), earned: (c) => c.profile.streakDays >= 30 },
  { id: "novel", name: "Novel", description: "50,000 words typed, about one novel.", rarity: "rare", glyph: "50k", progress: toWords(50000), earned: (c) => words(c.profile) >= 50000 },
  { id: "polyglot", name: "Polyglot", description: "A run of 30 seconds or more in all four languages.", rarity: "rare", glyph: "4", progress: (p) => [p.languages.length, 4], earned: (c) => c.profile.languages.length >= 4 },
  { id: "bookworm", name: "Bookworm", description: "Finish 25 quotes.", rarity: "rare", glyph: "“", progress: (p) => [p.quotes, 25], earned: (c) => c.profile.quotes >= 25 },
  { id: "regular", name: "Regular", description: "Play 30 dailies.", rarity: "rare", glyph: "D", progress: (p) => [Object.keys(p.dailies).length, 30], earned: (c) => Object.keys(c.profile.dailies).length >= 30 },
  { id: "victor", name: "Victor", description: "Win a race.", rarity: "rare", glyph: "V", earned: (c) => c.profile.races.won >= 1 },
  { id: "midnight", name: "Midnight", description: "Finish a run in the first five minutes of a new day.", rarity: "rare", glyph: "0:00", secret: true, hint: "Be there when the date turns.", earned: (c) => c.run !== null && c.run.finished && c.now.getHours() === 0 && c.now.getMinutes() < 5 },
  { id: "night-owl", name: "Night owl", description: "Finish a run between three and four in the morning.", rarity: "rare", glyph: "3:00", secret: true, hint: "Everyone else is asleep.", earned: (c) => c.run !== null && c.run.finished && c.now.getHours() === 3 },
  { id: "close-call", name: "Close call", description: "Save your streak in the last five minutes of the day.", rarity: "rare", glyph: "23:59", secret: true, hint: "Saved by the bell.", earned: (c) => c.run !== null && c.run.firstToday && c.profile.streakDays >= 2 && c.now.getHours() === 23 && c.now.getMinutes() >= 55 },
  { id: "pi", name: "Pi", description: "Finish a run at 3:14.", rarity: "rare", glyph: "π", secret: true, hint: "Endless digits, one minute a day.", earned: (c) => c.run !== null && c.run.finished && c.now.getHours() % 12 === 3 && c.now.getMinutes() === 14 },
  { id: "answer", name: "The answer", description: "Exactly 42 wpm without a mistake.", rarity: "rare", glyph: "42", secret: true, hint: "Slow down. The answer is a number.", earned: (c) => flawless(c) && Math.round(c.run.wpm) === 42 },
  { id: "mirror", name: "Mirror", description: "Speed and accuracy land on the same number.", rarity: "rare", glyph: "⇄", secret: true, hint: "Fast and right, in equal measure.", earned: (c) => comparable(c.run) && c.run.seconds >= 30 && c.run.accuracy < 100 && Math.round(c.run.wpm) === Math.floor(c.run.accuracy) },
  { id: "binge", name: "Binge", description: "Ten runs within an hour.", rarity: "rare", glyph: "10×", secret: true, hint: "Just one more.", earned: binge },
  { id: "self-aware", name: "Self-aware", description: "Type the name of this site.", rarity: "rare", glyph: "ts", secret: true, hint: "Say my name.", earned: (c) => c.run !== null && c.run.saidName },

  { id: "one-fifty", name: "One fifty", description: "150 wpm over 30 seconds or more, 95% accurate.", rarity: "epic", glyph: "150", progress: toSpeed(150), earned: fast(150) },
  { id: "metronome", name: "Metronome", description: "90% consistency at 80 wpm or more for a full minute.", rarity: "epic", glyph: "=", earned: (c) => comparable(c.run) && c.run.seconds >= 60 && c.run.wpm >= 80 && c.run.consistency >= 90 },
  { id: "rival", name: "Rival", description: "Win ten races.", rarity: "epic", glyph: "10V", progress: (p) => [p.races.won, 10], earned: (c) => c.profile.races.won >= 10 },
  { id: "photo-finish", name: "Photo finish", description: "Win a race by less than half a second.", rarity: "epic", glyph: "½", secret: true, hint: "Closer than a blink.", earned: (c) => c.profile.races.closest !== null && c.profile.races.closest < 500 },
  { id: "perfectionist", name: "Perfectionist", description: "Finish 100 words in perfect mode.", rarity: "epic", glyph: "P", earned: (c) => comparable(c.run) && c.run.mode === "perfect" && c.run.words >= 100 },
  { id: "marathon", name: "Marathon", description: "Keep an endless run going for ten minutes.", rarity: "epic", glyph: "10′", earned: (c) => c.run !== null && c.run.mode === "endless" && c.run.seconds >= 600 },
  { id: "hundred-days", name: "Hundred days", description: "Type on a hundred days in a row.", rarity: "epic", glyph: "100d", progress: toStreak(100), earned: (c) => c.profile.streakDays >= 100 },
  { id: "long-read", name: "Long read", description: "A long quote without a single mistake.", rarity: "epic", glyph: "§", earned: (c) => comparable(c.run) && c.run.mode === "quote" && c.run.quoteLength === "long" && c.run.accuracy === 100 },
  { id: "palindrome", name: "Palindrome", description: "Finish at a speed that reads the same both ways, like 121 wpm, without a mistake.", rarity: "epic", glyph: "121", secret: true, hint: "A speed you could read from either end.", earned: (c) => comparable(c.run) && c.run.seconds >= 30 && c.run.accuracy === 100 && palindrome(Math.round(c.run.wpm)) },
  { id: "exactly", name: "Exactly", description: "Exactly 100 wpm, without a mistake.", rarity: "epic", glyph: "=100", secret: true, hint: "A round number, and not a hair over.", earned: (c) => comparable(c.run) && c.run.seconds >= 30 && c.run.accuracy === 100 && Math.round(c.run.wpm) === 100 },
  { id: "comeback", name: "Comeback", description: "A new record right after your slowest run in ten.", rarity: "epic", glyph: "↺", secret: true, hint: "Fall first, then fly.", earned: comeback },
  { id: "world-tour", name: "World tour", description: "Runs in all four languages on the same day.", rarity: "epic", glyph: "4×", secret: true, hint: "One day, many tongues.", earned: (c) => languagesToday(c) >= 4 },
  { id: "no-looking-back", name: "No looking back", description: "A full minute without backspace, 98% accurate.", rarity: "epic", glyph: "→", secret: true, hint: "There is one key you never touch.", earned: (c) => comparable(c.run) && c.run.seconds >= 60 && c.run.backspaces === 0 && c.run.accuracy >= 98 },

  { id: "two-hundred", name: "Two hundred", description: "200 wpm over 30 seconds or more, 95% accurate.", rarity: "legendary", glyph: "200", progress: toSpeed(200), earned: fast(200) },
  { id: "flawless-200", name: "Flawless 200", description: "200 wpm over a full minute without a single mistake.", rarity: "legendary", glyph: "200!", earned: (c) => comparable(c.run) && c.run.seconds >= 60 && c.run.wpm >= 200 && c.run.accuracy === 100 },
  { id: "untouchable", name: "Untouchable", description: "100 words in perfect mode at 150 wpm or more.", rarity: "legendary", glyph: "U", earned: (c) => comparable(c.run) && c.run.mode === "perfect" && c.run.words >= 100 && c.run.wpm >= 150 },
  { id: "year-of-silk", name: "Year of silk", description: "Type on 365 days in a row.", rarity: "legendary", glyph: "365", progress: toStreak(365), earned: (c) => c.profile.streakDays >= 365 },
  { id: "library", name: "Library", description: "A million words typed.", rarity: "legendary", glyph: "1M", progress: toWords(1_000_000), earned: (c) => words(c.profile) >= 1_000_000 },
];

/** Marks newly earned badges on the profile and returns them, rarest first. */
export function awardBadges(profile: Profile, run: RunFacts | null, now = new Date()): Badge[] {
  const fresh = BADGES.filter((badge) => !profile.badges[badge.id] && badge.earned({ profile, run, now }));
  const date = now.toISOString().slice(0, 10);
  for (const badge of fresh) profile.badges[badge.id] = date;
  return fresh.sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity));
}

/** The rarest badges someone holds, newest first within a rarity. */
export function showcase(profile: Profile, count = 3): Badge[] {
  return BADGES.filter((badge) => profile.badges[badge.id])
    .sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || profile.badges[b.id]!.localeCompare(profile.badges[a.id]!))
    .slice(0, count);
}

const SVG = "http://www.w3.org/2000/svg";

/** Scalloped outline of a wax seal, used for the two rarest tiers. */
function sealPath(teeth: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const angle = (Math.PI * i) / teeth - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    points.push(`${(50 + r * Math.cos(angle)).toFixed(2)},${(50 + r * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join("L")}Z`;
}

/**
 * A medal with a seal's edge: common is a hairline ring, rare a double ring, epic a scalloped
 * accent edge, legendary a filled seal with its rarity engraved around the rim.
 */
export function medal(badge: Badge, earned: boolean, progress: [number, number] | null = null): SVGSVGElement {
  const hidden = badge.secret && !earned;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", `medal ${badge.rarity}${earned ? " earned" : " locked"}`);
  svg.setAttribute("aria-hidden", "true");
  const glyph = hidden ? "?" : badge.glyph;
  const size = glyph.length <= 1 ? 40 : glyph.length === 2 ? 34 : glyph.length === 3 ? 28 : 22;
  const id = `rim-${badge.id}`;
  let body = "";
  if (badge.rarity === "epic" || badge.rarity === "legendary") body += `<path class="seal" d="${sealPath(18, 48, 44)}"/>`;
  body += `<circle class="ring" cx="50" cy="50" r="${badge.rarity === "common" ? 44 : 40}"/>`;
  if (badge.rarity !== "common") body += `<circle class="ring inner" cx="50" cy="50" r="${badge.rarity === "rare" ? 37 : 34}"/>`;
  if (badge.rarity === "legendary" && !hidden) {
    body += `<path id="${id}" d="M50,50 m-29,0 a29,29 0 1,1 58,0" fill="none"/>
      <text class="rim"><textPath href="#${id}" startOffset="50%" text-anchor="middle">legendary</textPath></text>`;
  }
  if (!earned && progress) {
    const share = Math.min(progress[0] / progress[1], 1);
    const r = 44;
    const length = 2 * Math.PI * r;
    body += `<circle class="progress" cx="50" cy="50" r="${r}" stroke-dasharray="${(share * length).toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 50 50)"/>`;
  }
  body += `<text class="glyph" x="50" y="${badge.rarity === "legendary" ? 60 : 52}" font-size="${size}" text-anchor="middle" dominant-baseline="middle">${glyph}</text>`;
  svg.innerHTML = body;
  return svg;
}

const number = new Intl.NumberFormat("en-GB");

export function badgeCard(badge: Badge, profile: Profile): HTMLElement {
  const earned = profile.badges[badge.id];
  const hidden = badge.secret && !earned;
  const progress = !earned && !hidden && badge.progress ? badge.progress(profile) : null;
  const card = document.createElement("div");
  card.className = `badge-card ${badge.rarity}${earned ? " earned" : ""}`;
  card.append(medal(badge, Boolean(earned), progress));
  const date = earned ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(earned)) : "";
  const status = earned ? date : progress ? `${number.format(Math.min(progress[0], progress[1]))} of ${number.format(progress[1])}` : "";
  const text = document.createElement("div");
  text.className = "badge-copy";
  text.innerHTML = `<b>${hidden ? "Secret" : badge.name}</b><span>${hidden ? (badge.hint ?? "Keep typing.") : badge.description}</span><small>${badge.rarity}${status ? ` · ${status}` : ""}</small>`;
  card.append(text);
  return card;
}
