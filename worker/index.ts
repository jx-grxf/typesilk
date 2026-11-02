import { deleteAccount, logout, readMe, updateNames } from "./account";
import { currentUser, handleAuth, type Provider, type SessionUser } from "./auth";
import { isLanguage, issueTicket, readBoard, submitRun } from "./daily";
import { clientKey, fail, type Env } from "./http";
import { handleProfile } from "./profile";
import { readPublicProfile, setPublicProfile } from "./public";
import { createRace, joinRace } from "./race";

export { RaceRoom } from "./race";

type SignedInRoute = (request: Request, env: Env, user: SessionUser) => Promise<Response>;

const SIGNED_IN: Record<string, SignedInRoute> = {
  "POST /api/me": updateNames,
  "POST /api/me/public": setPublicProfile,
  "DELETE /api/me": deleteAccount,
  "POST /api/daily/ticket": issueTicket,
  "POST /api/daily/runs": submitRun,
};
const SIGNED_IN_PATHS = new Set([...Object.keys(SIGNED_IN).map((route) => route.split(" ")[1]), "/api/logout"]);

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  const reading = method === "GET" || method === "HEAD";
  if (!reading) {
    // a cross-site form could still reach these with a Lax cookie on some flows, the Origin check can't be faked by a page
    if (request.headers.get("Origin") !== url.origin) return fail("forbidden", 403);
  }
  // every read hits D1 or a provider, so reads count too, just against a roomier budget
  const limited = await (reading ? env.RATE_LIMIT_READ : env.RATE_LIMIT).limit({ key: clientKey(request) });
  if (!limited.success) return fail("rate_limited", 429);

  const auth = path.match(/^\/api\/auth\/(github|google)(\/callback)?$/);
  if (auth && method === "GET") {
    return (await handleAuth(request, env, auth[1] as Provider, Boolean(auth[2]))) ?? fail("signin_off", 503);
  }

  if (path === "/api/me" && method === "GET") return readMe(request, env);

  const board = path.match(/^\/api\/daily\/(\d{1,6})\/([a-z]+)$/);
  if (board && method === "GET") {
    if (!isLanguage(board[2])) return fail("not_found", 404);
    return readBoard(request, env, Number(board[1]), board[2]);
  }

  if (path === "/api/profile") return handleProfile(request, env, url);

  const owner = path.match(/^\/api\/u\/([a-z0-9_-]{1,20})$/i);
  if (owner && method === "GET") return readPublicProfile(request, env, owner[1]!);

  if (path === "/api/race" && method === "POST") return createRace(env);
  const race = path.match(/^\/api\/race\/([A-Za-z0-9]{1,12})$/);
  if (race && method === "GET") return joinRace(request, env, url, race[1]!.toUpperCase());

  if (!SIGNED_IN_PATHS.has(path)) return fail("not_found", 404);
  const route = SIGNED_IN[`${method} ${path}`];
  const isLogout = path === "/api/logout" && method === "POST";
  if (!route && !isLogout) return fail("method_not_allowed", 405);
  if (!env.TICKET_SECRET) return fail("signin_off", 503);
  if (isLogout) return logout(request, env);
  const user = await currentUser(request, env);
  if (!user) return fail("signin_required", 401);
  // a rotating address can't buy a signed-in account more writes
  if (!(await env.RATE_LIMIT.limit({ key: `user:${user.id}` })).success) return fail("rate_limited", 429);
  return route!(request, env, user);
}

/** Every /u/name is the same page, which then asks the API for that name. */
async function publicProfilePage(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return fail("method_not_allowed", 405);
  if (!/^\/u\/[a-z0-9_-]{3,20}\/?$/i.test(url.pathname)) return env.ASSETS.fetch(new Request(new URL("/404", url), request));
  // this path wakes the worker, so it shares the budget of API reads
  if (!(await env.RATE_LIMIT_READ.limit({ key: clientKey(request) })).success) return fail("rate_limited", 429);
  const page = await env.ASSETS.fetch(new Request(new URL("/u", url), request));
  const response = new Response(page.body, page);
  // a profile is opt-in to be seen, not to be indexed
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

/** Every /race/CODE is the race page, which reads the code from the address. */
async function racePage(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return fail("method_not_allowed", 405);
  if (!/^\/race\/[A-Za-z0-9]{6}\/?$/.test(url.pathname)) return env.ASSETS.fetch(new Request(new URL("/404", url), request));
  if (!(await env.RATE_LIMIT_READ.limit({ key: clientKey(request) })).success) return fail("rate_limited", 429);
  const page = await env.ASSETS.fetch(new Request(new URL("/race", url), request));
  const response = new Response(page.body, page);
  // a room link is for the people in it, not for search results
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/u/")) return publicProfilePage(request, env, url);
    if (url.pathname.startsWith("/race/")) return racePage(request, env, url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (error) {
      console.error(error);
      return fail("server_error", 500);
    }
  },
} satisfies ExportedHandler<Env>;
