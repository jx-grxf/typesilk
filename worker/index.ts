import { plausible } from "../src/activity";
import { dailyNumber, dailyWords } from "../src/daily";
import { CLEAR_WORD, replay } from "../src/replay";
import { LANGUAGES, registerWords, type Language } from "../src/words";
import { validDisplayName, validUsername } from "./names";
import { isDevice, readProfile, resetProfile, writeProfile } from "./profile";
import { signTicket, verifyTicket } from "./ticket";

export type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  RATE_LIMIT: RateLimit;
  TICKET_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

type Provider = "github" | "google";
type SessionUser = { id: string; username: string | null; display_name: string | null };
type Profile = { id: string; username: string | null; displayName: string | null };

const SESSION_COOKIE = "__Host-typesilk_session";
const OAUTH_COOKIE = "__Host-typesilk_oauth";
const SESSION_SECONDS = 30 * 24 * 3600;
const OAUTH_SECONDS = 600;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_PROFILE_BYTES = 256 * 1024;
const MAX_KEYS = 8000;
const TICKET_MS = 26 * 3600 * 1000;
const BOARD_SIZE = 100;
const DUPLICATE_GAP_MS = 16;
// a local clock may be up to a day from UTC, so three daily numbers are "today" for someone
const CLOCK_SKEW_DAYS = 1;
// the ticket comes from the server clock and the run from the browser's; they can disagree a little
const CLOCK_TOLERANCE_MS = 5000;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

const fail = (error: string, status: number): Response => json({ error }, status);

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function enabledProviders(env: Env): Provider[] {
  if (!env.TICKET_SECRET) return [];
  const providers: Provider[] = [];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) providers.push("github");
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push("google");
  return providers;
}

async function currentUser(request: Request, env: Env): Promise<SessionUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT users.id, users.username, users.display_name
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.banned_at IS NULL`,
  ).bind(await sha256(token), Date.now()).first<SessionUser>();
}

async function readJson(request: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    // a body that isn't JSON is the caller's mistake, answered with a 400
    return null;
  }
}

function startLogin(provider: Provider, request: Request, env: Env, verifier: string, challenge: string): Response {
  const state = randomToken();
  const redirectUri = `${new URL(request.url).origin}/api/auth/${provider}/callback`;
  const target = provider === "github"
    ? new URL("https://github.com/login/oauth/authorize")
    : new URL("https://accounts.google.com/o/oauth2/v2/auth");
  const params = target.searchParams;
  params.set("client_id", provider === "github" ? env.GITHUB_CLIENT_ID! : env.GOOGLE_CLIENT_ID!);
  params.set("redirect_uri", redirectUri);
  params.set("state", state);
  params.set("code_challenge", challenge);
  params.set("code_challenge_method", "S256");
  if (provider === "google") {
    params.set("response_type", "code");
    // no email scope: nothing here needs it, so Google never hands it over
    params.set("scope", "openid");
  } else {
    params.set("allow_signup", "true");
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Cache-Control": "no-store",
      "Set-Cookie": cookie(OAUTH_COOKIE, `${provider}.${state}.${verifier}`, OAUTH_SECONDS),
    },
  });
}

async function fetchIdentity(provider: Provider, code: string, verifier: string, redirectUri: string, env: Env): Promise<{ id: string; login: string | null; name: string | null } | null> {
  const body = new URLSearchParams({ code, redirect_uri: redirectUri, code_verifier: verifier });
  if (provider === "github") {
    body.set("client_id", env.GITHUB_CLIENT_ID!);
    body.set("client_secret", env.GITHUB_CLIENT_SECRET!);
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json" },
      body,
    });
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token) return null;
    const userResponse = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token.access_token}`, "User-Agent": "typesilk", Accept: "application/vnd.github+json" },
    });
    if (!userResponse.ok) return null;
    const user = (await userResponse.json()) as { id: number; login: string; name: string | null };
    return { id: String(user.id), login: user.login, name: user.name };
  }
  body.set("client_id", env.GOOGLE_CLIENT_ID!);
  body.set("client_secret", env.GOOGLE_CLIENT_SECRET!);
  body.set("grant_type", "authorization_code");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) return null;
  const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userResponse.ok) return null;
  const user = (await userResponse.json()) as { sub: string };
  // only the stable id: a Google account's real name and photo are not ours to publish
  return { id: user.sub, login: null, name: null };
}

async function finishLogin(provider: Provider, request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const stored = readCookie(request, OAUTH_COOKIE)?.split(".") ?? [];
  const home = (query: string, cookies: string[] = []): Response => {
    const headers = new Headers({ Location: `/${query}`, "Cache-Control": "no-store" });
    headers.append("Set-Cookie", cookie(OAUTH_COOKIE, "", 0));
    for (const value of cookies) headers.append("Set-Cookie", value);
    return new Response(null, { status: 302, headers });
  };
  const code = url.searchParams.get("code");
  if (stored.length !== 3 || stored[0] !== provider || !code || stored[1] !== url.searchParams.get("state")) {
    return home("?signin=failed");
  }
  let identity: Awaited<ReturnType<typeof fetchIdentity>> = null;
  try {
    identity = await fetchIdentity(provider, code, stored[2]!, `${url.origin}${url.pathname}`, env);
  } catch (error) {
    // a provider outage should land on the sign-in message, not on a page of JSON
    console.error(error);
  }
  if (!identity) return home("?signin=failed");

  const known = await env.DB.prepare("SELECT user_id FROM identities WHERE provider = ? AND provider_id = ?")
    .bind(provider, identity.id).first<{ user_id: string }>();
  let userId = known?.user_id;
  const now = Date.now();
  if (userId) {
    const banned = await env.DB.prepare("SELECT banned_at FROM users WHERE id = ?").bind(userId).first<{ banned_at: number | null }>();
    if (banned?.banned_at) return home("?signin=blocked");
  } else {
    userId = crypto.randomUUID();
    const displayName = validDisplayName(identity.name ?? identity.login);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)")
        .bind(userId, displayName, now),
      env.DB.prepare("INSERT INTO identities (provider, provider_id, user_id) VALUES (?, ?, ?)")
        .bind(provider, identity.id, userId),
    ]);
  }
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at < ?").bind(userId, now),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256(token), userId, now + SESSION_SECONDS * 1000),
  ]);
  const suggestion = !known && identity.login ? `?signin=new&name=${encodeURIComponent(identity.login)}` : !known ? "?signin=new" : "";
  return home(suggestion, [cookie(SESSION_COOKIE, token, SESSION_SECONDS)]);
}

function profileOf(user: SessionUser): Profile {
  return { id: user.id, username: user.username, displayName: user.display_name };
}

async function updateProfile(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail("bad_request", 400);
  const displayName = validDisplayName(body.displayName);
  if (!displayName) return fail("bad_display_name", 400);
  let username = user.username;
  if (!username) {
    username = validUsername(body.username);
    if (!username) return fail("bad_username", 400);
  } else if (body.username !== undefined && validUsername(body.username) !== username) {
    return fail("username_locked", 409);
  }
  try {
    await env.DB.prepare("UPDATE users SET username = ?, display_name = ? WHERE id = ?").bind(username, displayName, user.id).run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) return fail("username_taken", 409);
    throw error;
  }
  return json({ user: { ...profileOf(user), username, displayName } });
}

function clearSession(): Record<string, string> {
  return { "Set-Cookie": cookie(SESSION_COOKIE, "", 0) };
}

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

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && Object.hasOwn(LANGUAGES, value);
}

function isCurrentDaily(value: unknown, now: number): value is number {
  return Number.isInteger(value) && Math.abs((value as number) - dailyNumber(new Date(now))) <= CLOCK_SKEW_DAYS;
}

async function issueTicket(request: Request, env: Env, user: SessionUser): Promise<Response> {
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

async function submitRun(request: Request, env: Env, user: SessionUser): Promise<Response> {
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

async function readBoard(request: Request, env: Env, daily: number, language: Language): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT users.username, users.display_name, daily_runs.wpm, daily_runs.accuracy
     FROM daily_runs JOIN users ON users.id = daily_runs.user_id
     WHERE daily_runs.daily = ? AND daily_runs.language = ? AND daily_runs.flagged = 0
       AND users.banned_at IS NULL AND users.username IS NOT NULL
     ORDER BY daily_runs.wpm DESC, daily_runs.accuracy DESC, daily_runs.created_at ASC
     LIMIT ?`,
  ).bind(daily, language, BOARD_SIZE).all<{ username: string; display_name: string | null; wpm: number; accuracy: number }>();
  const user = await currentUser(request, env);
  let you: { rank: number; wpm: number; accuracy: number } | null = null;
  if (user) {
    const mine = await env.DB.prepare("SELECT wpm, accuracy FROM daily_runs WHERE user_id = ? AND daily = ? AND language = ? AND flagged = 0")
      .bind(user.id, daily, language).first<{ wpm: number; accuracy: number }>();
    if (mine) you = { ...mine, rank: (await boardPosition(env, daily, language, mine.wpm)).rank };
  }
  const { total } = await boardPosition(env, daily, language, 0);
  return json({
    daily,
    language,
    today: dailyNumber(new Date()),
    total,
    you,
    entries: results.map((row, index) => ({
      rank: index + 1,
      username: row.username,
      displayName: row.display_name ?? row.username,
      wpm: row.wpm,
      accuracy: row.accuracy,
    })),
  });
}

async function handleProfile(request: Request, env: Env, url: URL): Promise<Response> {
  const method = request.method;
  if (method !== "GET" && method !== "POST" && method !== "DELETE") return fail("method_not_allowed", 405);
  if (!env.TICKET_SECRET) return fail("signin_off", 503);
  const user = await currentUser(request, env);
  if (!user) return fail("signin_required", 401);
  if (method === "DELETE") return json({ epoch: await resetProfile(env.DB, user.id) });
  if (method === "GET") {
    const device = url.searchParams.get("device");
    if (!isDevice(device)) return fail("bad_request", 400);
    return json(await readProfile(env.DB, user.id, device));
  }
  const body = await readJson(request, MAX_PROFILE_BYTES);
  if (!body || !isDevice(body.device) || !Number.isInteger(body.epoch)) return fail("bad_request", 400);
  const { stale, ...shared } = await writeProfile(env.DB, user.id, body.device, body.epoch as number, body.profile);
  return json(shared, stale ? 409 : 200);
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  if (method !== "GET" && method !== "HEAD") {
    // a cross-site form could still reach these with a Lax cookie on some flows, the Origin check can't be faked by a page
    if (request.headers.get("Origin") !== url.origin) return fail("forbidden", 403);
    const limited = await env.RATE_LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") ?? "unknown" });
    if (!limited.success) return fail("rate_limited", 429);
  }

  const auth = path.match(/^\/api\/auth\/(github|google)(\/callback)?$/);
  if (auth && method === "GET") {
    const provider = auth[1] as Provider;
    if (!enabledProviders(env).includes(provider)) return fail("signin_off", 503);
    if (auth[2]) return finishLogin(provider, request, env);
    const verifier = randomToken();
    return startLogin(provider, request, env, verifier, await pkceChallenge(verifier));
  }

  if (path === "/api/me" && method === "GET") {
    const user = await currentUser(request, env);
    return json({ user: user ? profileOf(user) : null, providers: enabledProviders(env) });
  }

  const board = path.match(/^\/api\/daily\/(\d{1,6})\/([a-z]+)$/);
  if (board && method === "GET") {
    if (!isLanguage(board[2])) return fail("not_found", 404);
    return readBoard(request, env, Number(board[1]), board[2]);
  }

  if (path === "/api/profile") return handleProfile(request, env, url);

  const known = ["/api/me", "/api/logout", "/api/daily/ticket", "/api/daily/runs"];
  if (!known.includes(path)) return fail("not_found", 404);
  if (method !== "POST" && !(path === "/api/me" && method === "DELETE")) return fail("method_not_allowed", 405);
  if (!env.TICKET_SECRET) return fail("signin_off", 503);

  const user = await currentUser(request, env);
  if (path === "/api/logout") {
    const token = readCookie(request, SESSION_COOKIE);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return json({ ok: true }, 200, clearSession());
  }
  if (!user) return fail("signin_required", 401);
  if (path === "/api/me" && method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM daily_runs WHERE user_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM profile_shares WHERE user_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM identities WHERE user_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
    ]);
    return json({ ok: true }, 200, clearSession());
  }
  if (path === "/api/me") return updateProfile(request, env, user);
  if (path === "/api/daily/ticket") return issueTicket(request, env, user);
  return submitRun(request, env, user);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (error) {
      console.error(error);
      return fail("server_error", 500);
    }
  },
} satisfies ExportedHandler<Env>;
