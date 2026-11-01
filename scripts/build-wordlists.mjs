// Builds public/words/{english,german}.txt from published frequency lists.
// Run with: node scripts/build-wordlists.mjs
import { writeFileSync } from "node:fs";

const SIZES = { english: 20000, german: 10000 };
const FILLERS = new Set("uh um umm hmm mm mmm huh eh ah ahh oh ohh ha hah heh aw ow yo ya gonna wanna gotta ain".split(" "));
const FRAGMENTS = new Set("s t m d ll re ve".split(" "));
// past this rank subtitle lists are mostly names and noise unless the word also shows up in prose
const PLAIN_RANK = 3000;

const dropped = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wiktionary rate-limits bursts, so requests go one by one and back off on 429. */
async function text(url, attempt = 0) {
  const response = await fetch(url, { headers: { "user-agent": "typesilk word list build (github.com/jx-grxf/typesilk)" } });
  if (response.status === 429 && attempt < 5) {
    await sleep(2000 * 2 ** attempt);
    return text(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function inOrder(items, fn) {
  const out = [];
  for (const item of items) {
    out.push(await fn(item));
    await sleep(400);
  }
  return out;
}

async function wiktionary(page) {
  const url = `https://en.wiktionary.org/w/api.php?action=parse&format=json&prop=wikitext&page=${encodeURIComponent(page)}`;
  const wikitext = JSON.parse(await text(url)).parse.wikitext["*"];
  return [...wikitext.matchAll(/\[\[[^|\]]+\|([^\]]+)\]\]/g)].map((m) => m[1].trim());
}

/** Fetched at build time only and never stored in the repository. */
async function blocklist() {
  const lists = await inOrder(["en", "de"], (language) =>
    text(`https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/${language}`));
  return new Set(lists.join("\n").split("\n").map((w) => w.trim().toLowerCase()).filter((w) => w && !w.includes(" ")));
}

// plain words that happen to contain a blocked one
const HARMLESS = new Set((
  "cocktail cocktails peacock peacocks cockpit cockroach cockroaches cockney cockles woodcock hitchcock hancock babcock "
  + "therapist therapists pakistan pakistani spice spices spiced spicer compass scatter scattered assess assist assume "
  + "titles titled titans teaspoon impasse tetanus molasses montenegro talcum harpoon saltwater twinkling buttery butters "
  + "sexton sussex wessex skeeter dickson witherspoon cummings milford "
  + "österreichische österreichischen englische englischen russische russischen militärische militärischen "
  + "künstlerische künstlerischen olympischen ungarische ungarischen philosophischen gegnerischen israelischen"
).split(" "));
const SHORT_ENDINGS = ["s", "es"];
const LONG_ENDINGS = ["ed", "er", "ers", "ing", "en", "e", "n"];

/** The word itself, or the word minus an ending, is on the blocklist. Long endings need a long stem. */
function blockedForm(lower, blocked) {
  if (blocked.has(lower)) return true;
  const stem = (ending) => lower.slice(0, lower.length - ending.length);
  return SHORT_ENDINGS.some((e) => lower.endsWith(e) && stem(e).length >= 3 && blocked.has(stem(e)))
    || LONG_ENDINGS.some((e) => lower.endsWith(e) && stem(e).length >= 5 && blocked.has(stem(e)));
}

/**
 * Web corpora carry spam inside compounds. A compound only counts when the other half is a real
 * word of at least four letters, so "class" or "Anlass" stay.
 */
function offensive(word, blocked, vocabulary) {
  const lower = word.toLowerCase();
  if (HARMLESS.has(lower)) return false;
  let hit = blockedForm(lower, blocked);
  for (let cut = 3; !hit && cut <= lower.length - 3; cut++) {
    const head = lower.slice(0, cut);
    const tail = lower.slice(cut);
    hit = (blocked.has(head) && tail.length >= 4 && vocabulary.has(tail))
      || (head.length >= 4 && vocabulary.has(head) && blockedForm(tail, blocked) && !vocabulary.has(lower.slice(cut - 1)));
  }
  if (hit) dropped.add(word);
  return hit;
}

/** Rank of the first lowercase and the first capitalised spelling of each word in a cased list. */
function casing(words) {
  const map = new Map();
  words.forEach((word, rank) => {
    const key = word.toLowerCase();
    const entry = map.get(key) ?? { lower: Infinity, upper: Infinity };
    if (word === key) entry.lower = Math.min(entry.lower, rank);
    else if (word[0] !== word[0].toLowerCase()) entry.upper = Math.min(entry.upper, rank);
    map.set(key, entry);
  });
  return map;
}

/** Mostly capitalised in running text, so a name or a place rather than an everyday word. */
function properNoun(word, cased) {
  const entry = cased.get(word.toLowerCase());
  return entry !== undefined && entry.upper < entry.lower;
}

const wikipediaPages = ["", "/10001-20000", "/20001-30000", "/30001-40000", "/40001-50000", "/50001-60000"].map((p) => `Wiktionary:Frequency lists/English/Wikipedia (2016)${p}`);
const englishCasing = casing((await inOrder(wikipediaPages, wiktionary)).flat());

async function english() {
  const blocked = await blocklist();
  const raw = await text("https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt");
  const vocabulary = new Set(raw.split("\n").map((line) => line.split(" ")[0]).filter((w) => w.length >= 3));
  const out = [];
  const seen = new Set();
  for (const line of raw.split("\n")) {
    let word = line.split(" ")[0]?.trim() ?? "";
    if (!/^[a-z]+('[a-z]+)?$/.test(word)) continue;
    if (FILLERS.has(word) || FRAGMENTS.has(word)) continue;
    if (word.length === 1 && word !== "a" && word !== "i") continue;
    if (offensive(word, blocked, vocabulary) || properNoun(word, englishCasing)) continue;
    if (out.length >= PLAIN_RANK && !(englishCasing.get(word)?.lower < Infinity)) continue;
    if (word === "i" || word.startsWith("i'")) word = "I" + word.slice(1);
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length === SIZES.english) break;
  }
  return out;
}

async function german() {
  const blocked = await blocklist();
  const spoken = new Set(
    (await text("https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt"))
      .split("\n").map((line) => line.split(" ")[0]),
  );
  const words = (await inOrder([
    "Wiktionary:Frequency lists/German/Mixed web 3M",
    "Wiktionary:Frequency lists/German/Mixed web 3M/10000-50000",
  ], wiktionary)).flat();
  // a word that is lowercase in running text only looks capitalised at the start of sentences
  const firstLower = new Map();
  words.forEach((word, rank) => {
    if (word === word.toLowerCase() && !firstLower.has(word)) firstLower.set(word, rank);
  });
  const vocabulary = new Set([...spoken, ...words.map((w) => w.toLowerCase())].filter((w) => w.length >= 3));
  const out = [];
  const seen = new Set();
  for (const [rank, raw] of words.entries()) {
    const lowerRank = firstLower.get(raw.toLowerCase());
    const word = lowerRank !== undefined && lowerRank < rank * 4 ? raw.toLowerCase() : raw;
    // one optional capital at the start, so no brands like eBay
    if (!/^[A-ZÄÖÜa-zäöüß][a-zäöüß]+$/.test(word)) continue;
    if (word.length > 1 && word === word.toUpperCase()) continue;
    const key = word.toLowerCase();
    // the first spelling is the common one: "die" before the sentence-initial "Die"
    if (seen.has(key)) continue;
    seen.add(key);
    if (!spoken.has(key) || offensive(word, blocked, vocabulary)) continue;
    const capital = word[0] !== key[0];
    if (capital && (word.length < 3 || properNoun(word, englishCasing))) continue;
    out.push(word);
    if (out.length === SIZES.german) break;
  }
  return out;
}

for (const [language, build] of [["english", english], ["german", german]]) {
  const words = await build();
  writeFileSync(`public/words/${language}.txt`, words.join("\n") + "\n");
  console.log(`${language}: ${words.length} words`);
}
if (process.env.SHOW_DROPPED) writeFileSync(process.env.SHOW_DROPPED, [...dropped].join("\n"));
