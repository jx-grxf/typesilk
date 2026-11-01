import { cookie, randomToken, readCookie, sha256, type Env } from "./http";
import { validDisplayName } from "./names";

export type Provider = "github" | "google";
export type SessionUser = { id: string; username: string | null; display_name: string | null };

const SESSION_COOKIE = "__Host-typesilk_session";
const OAUTH_COOKIE = "__Host-typesilk_oauth";
const SESSION_SECONDS = 30 * 24 * 3600;
const OAUTH_SECONDS = 600;

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function enabledProviders(env: Env): Provider[] {
  if (!env.TICKET_SECRET) return [];
  const providers: Provider[] = [];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) providers.push("github");
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push("google");
  return providers;
}

export async function currentUser(request: Request, env: Env): Promise<SessionUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT users.id, users.username, users.display_name
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.banned_at IS NULL`,
  ).bind(await sha256(token), Date.now()).first<SessionUser>();
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

export function clearSession(): Record<string, string> {
  return { "Set-Cookie": cookie(SESSION_COOKIE, "", 0) };
}

export function sessionToken(request: Request): string | null {
  return readCookie(request, SESSION_COOKIE);
}

/** GET /api/auth/:provider starts a sign-in, GET /api/auth/:provider/callback ends it. */
export async function handleAuth(request: Request, env: Env, provider: Provider, callback: boolean): Promise<Response | null> {
  if (!enabledProviders(env).includes(provider)) return null;
  if (callback) return finishLogin(provider, request, env);
  const verifier = randomToken();
  return startLogin(provider, request, env, verifier, await pkceChallenge(verifier));
}
