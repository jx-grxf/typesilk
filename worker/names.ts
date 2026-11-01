import german from "naughty-words/de.json";
import french from "naughty-words/fr.json";
import spanish from "naughty-words/es.json";
import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from "obscenity";

const RESERVED = new Set([
  "about", "admin", "administrator", "anonymous", "api", "daily", "datenschutz", "de", "design", "help", "me", "mod",
  "impressum", "moderator", "null", "nutzungsbedingungen", "official", "privacy", "root", "staff", "support", "system", "terms", "typesilk", "undefined",
]);

// neither list covers the names of Nazi leaders, which would otherwise pass as ordinary surnames
const NAMED = ["hitler", "goebbels", "himmler", "mengele"];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

// the lists spell "cabrón" with its accent and people type it without
const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const listed = new Set([...german, ...french, ...spanish].map(fold));

// compiling the patterns is the slow part, and only saving a name ever needs them
let matcher: RegExpMatcher | null = null;

function english(): RegExpMatcher {
  matcher ??= new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
  return matcher;
}

/** The lists are matched on whole words, so "Analyse" is not caught by a shorter entry inside it. */
function hasListedWord(text: string): boolean {
  const words = text.split(/[^\p{L}]+/u).filter(Boolean);
  for (let start = 0; start < words.length; start++) {
    for (let end = start + 1; end <= Math.min(words.length, start + 3); end++) {
      if (listed.has(words.slice(start, end).join(" "))) return true;
    }
  }
  return false;
}

export function isBlocked(text: string): boolean {
  const lower = fold(text);
  const plain = [...lower].map((ch) => LEET[ch] ?? ch).join("");
  const letters = plain.replace(/[^\p{L}]/gu, "");
  if (NAMED.some((name) => letters.includes(name))) return true;
  return hasListedWord(lower) || hasListedWord(plain) || english().hasMatch(text);
}

export function validUsername(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const username = input.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,20}$/.test(username)) return null;
  if (RESERVED.has(username) || isBlocked(username)) return null;
  return username;
}

/** Control, format and bidi characters are out: they can make a name look like someone else's. */
export function validDisplayName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.normalize("NFC").replace(/\s+/g, " ").trim();
  const length = [...name].length;
  if (length < 1 || length > 32) return null;
  if (/\p{C}/u.test(name) || isBlocked(name)) return null;
  return name;
}
