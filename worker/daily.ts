import { plausible } from "../src/activity";
import { dailyNumber, dailyWords } from "../src/daily";
import { CLEAR_WORD, replay } from "../src/replay";
import { LANGUAGES, registerWords, type Language } from "../src/words";
import { currentUser, type SessionUser } from "./auth";
import { fail, json, readJson, sha256, type Env } from "./http";
import { signTicket, verifyTicket } from "./ticket";

const MAX_KEYS = 8000;
const TICKET_MS = 26 * 3600 * 1000;
const BOARD_SIZE = 100;
const BOARD_CACHE_SECONDS = 30;
const DUPLICATE_GAP_MS = 16;
// a local clock may be up to a day from UTC, so three daily numbers are "today" for someone
const CLOCK_SKEW_DAYS = 1;
// the ticket comes from the server clock and the run from the browser's; they can disagree a little
const CLOCK_TOLERANCE_MS = 5000;

async function ensureWords(language: Language, request: Request, env: Env): Promise<boolean> {
  if (language !== "english" && language !== "german") return true;
  if (loadedLists.has(language)) return true;
  const response = await env.ASSETS.fetch(new URL(`/words/${language}.txt`, request.url));
  if (!response.ok) return false;
  // the daily only ever draws from the first thousand, and splitting 20,000 lines costs real CPU
  registerWords(language, (await response.text()).split("\n", 1000));
  loadedLists.add(language);
  return true;
}
const loadedLists = new Set<Language>();

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && Object.hasOwn(LANGUAGES, value);
}

function isCurrentDaily(value: unknown, now: number): value is number {
  return Number.isInteger(value) && Math.abs((value as number) - dailyNumber(new Date(now))) <= CLOCK_SKEW_DAYS;
}

export async function issueTicket(request: Request, env: Env, user: SessionUser): Promise<Response> {
  if (!user.username) return fail("username_required", 409);
  const body = await readJson(request);
  const now = Date.now();
  if (!body || !isLanguage(body.language) || !isCurrentDaily(body.daily, now)) return fail("bad_request", 400);
  const ticket = await signTicket({ user: user.id, daily: body.daily, language: body.language, issuedAt: now }, env.TICKET_SECRET!);
  return json({ ticket });
}

async function boardPosition(env: Env, daily: number, language: string, wpm: number): Promise<{ rank: number; total: number }> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(wpm > ?), 0) AS ahead
     FROM daily_runs JOIN users ON users.id = daily_runs.user_id
     WHERE daily = ? AND language = ? AND flagged = 0 AND users.banned_at IS NULL`,
  ).bind(wpm, daily, language).first<{ total: number; ahead: number }>();
  return { rank: (row?.ahead ?? 0) + 1, total: row?.total ?? 0 };
}

export async function submitRun(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail("bad_request", 400);
  const ticket = await verifyTicket(body.ticket, env.TICKET_SECRET!);
  const now = Date.now();
  if (!ticket || ticket.user !== user.id || !isLanguage(ticket.language) || now - ticket.issuedAt > TICKET_MS) {
    return fail("bad_ticket", 400);
  }
  const { keys, gaps } = body;
  const validLog = Array.isArray(keys) && Array.isArray(gaps) && keys.length === gaps.length && keys.length > 0 && keys.length <= MAX_KEYS
    // a longer "key" would type several letters for the price of one and dodge the accuracy count
    && keys.every((key) => typeof key === "string" && (key.length === 1 || key === CLEAR_WORD))
    && gaps.every((gap) => typeof gap === "number" && Number.isFinite(gap) && gap >= 0);
  if (!validLog) return fail("bad_log", 400);
  const log = { keys: keys as string[], gaps: gaps as number[] };

  if (!(await ensureWords(ticket.language, request, env))) return fail("unavailable", 503);
  const result = replay(dailyWords(ticket.daily, ticket.language), log);
  if (!result.finished) return fail("not_finished", 422);
  if (now - ticket.issuedAt + CLOCK_TOLERANCE_MS < result.durationMs) return fail("bad_ticket", 400);

  // gaps are rounded so a copied run with a little noise added still matches. The keys alone
  // wouldn't do: every perfect run of the same daily has the same ones.
  const logHash = await sha256(JSON.stringify({ keys: log.keys, gaps: log.gaps.map((gap) => Math.round(gap / DUPLICATE_GAP_MS)) }));
  const duplicate = await env.DB.prepare("SELECT 1 FROM daily_runs WHERE daily = ? AND language = ? AND log_hash = ? LIMIT 1")
    .bind(ticket.daily, ticket.language, logHash).first();
  const flagged = duplicate || !plausible(log.gaps.slice(1), result.rawWpm) ? 1 : 0;

  // the primary key keeps the first finished run; a later one changes nothing
  await env.DB.prepare(
    `INSERT INTO daily_runs (user_id, daily, language, wpm, accuracy, duration_ms, log_hash, flagged, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  ).bind(user.id, ticket.daily, ticket.language, result.wpm, result.accuracy, Math.round(result.durationMs), logHash, flagged, now).run();

  const counted = await env.DB.prepare("SELECT wpm, accuracy, flagged, log_hash FROM daily_runs WHERE user_id = ? AND daily = ? AND language = ?")
    .bind(user.id, ticket.daily, ticket.language).first<{ wpm: number; accuracy: number; flagged: number; log_hash: string }>();
  if (!counted) return fail("unavailable", 503);
  const position = await boardPosition(env, ticket.daily, ticket.language, counted.wpm);
  return json({
    wpm: counted.wpm,
    accuracy: counted.accuracy,
    first: counted.log_hash === logHash,
    hidden: counted.flagged === 1,
    ...position,
  });
}

type BoardEntry = { rank: number; username: string; displayName: string; wpm: number; accuracy: number };
type PublicBoard = { total: number; entries: BoardEntry[] };

async function loadBoard(env: Env, daily: number, language: Language): Promise<PublicBoard> {
  const [list, count] = await env.DB.batch([
    env.DB.prepare(
      `SELECT users.username, users.display_name, daily_runs.wpm, daily_runs.accuracy
       FROM daily_runs JOIN users ON users.id = daily_runs.user_id
       WHERE daily_runs.daily = ? AND daily_runs.language = ? AND daily_runs.flagged = 0
         AND users.banned_at IS NULL AND users.username IS NOT NULL
       ORDER BY daily_runs.wpm DESC, daily_runs.accuracy DESC, daily_runs.created_at ASC
       LIMIT ?`,
    ).bind(daily, language, BOARD_SIZE),
    env.DB.prepare(
      `SELECT COUNT(*) AS total FROM daily_runs JOIN users ON users.id = daily_runs.user_id
       WHERE daily = ? AND language = ? AND flagged = 0 AND users.banned_at IS NULL`,
    ).bind(daily, language),
  ]);
  const rows = list!.results as { username: string; display_name: string | null; wpm: number; accuracy: number }[];
  return {
    total: (count!.results[0] as { total: number } | undefined)?.total ?? 0,
    entries: rows.map((row, index) => ({
      rank: index + 1,
      username: row.username,
      displayName: row.display_name ?? row.username,
      wpm: row.wpm,
      accuracy: row.accuracy,
    })),
  };
}

// the board is the same for everyone, so one D1 read serves every viewer for a while; only "you" is per person
async function cachedBoard(request: Request, env: Env, daily: number, language: Language): Promise<PublicBoard> {
  const cache = typeof caches === "undefined" ? undefined : caches.default;
  const key = new Request(new URL(`/api/daily/${daily}/${language}`, request.url));
  const hit = await cache?.match(key);
  if (hit) return (await hit.json()) as PublicBoard;
  const board = await loadBoard(env, daily, language);
  await cache?.put(key, new Response(JSON.stringify(board), { headers: { "Cache-Control": `public, max-age=${BOARD_CACHE_SECONDS}` } }));
  return board;
}

export async function readBoard(request: Request, env: Env, daily: number, language: Language): Promise<Response> {
  const board = await cachedBoard(request, env, daily, language);
  const user = await currentUser(request, env);
  let you: { rank: number; wpm: number; accuracy: number } | null = null;
  if (user) {
    const mine = await env.DB.prepare("SELECT wpm, accuracy FROM daily_runs WHERE user_id = ? AND daily = ? AND language = ? AND flagged = 0")
      .bind(user.id, daily, language).first<{ wpm: number; accuracy: number }>();
    if (mine) you = { ...mine, rank: (await boardPosition(env, daily, language, mine.wpm)).rank };
  }
  return json({ daily, language, today: dailyNumber(new Date()), total: board.total, you, entries: board.entries });
}
