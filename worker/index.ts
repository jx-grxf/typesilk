import { deleteAccount, logout, readMe, updateNames } from "./account";
import { currentUser, handleAuth, type Provider, type SessionUser } from "./auth";
import { isLanguage, issueTicket, readBoard, submitRun } from "./daily";
import { fail, type Env } from "./http";
import { handleProfile } from "./profile";

type SignedInRoute = (request: Request, env: Env, user: SessionUser) => Promise<Response>;

const SIGNED_IN: Record<string, SignedInRoute> = {
  "POST /api/me": updateNames,
  "DELETE /api/me": deleteAccount,
  "POST /api/daily/ticket": issueTicket,
  "POST /api/daily/runs": submitRun,
};
const SIGNED_IN_PATHS = new Set([...Object.keys(SIGNED_IN).map((route) => route.split(" ")[1]), "/api/logout"]);

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
    return (await handleAuth(request, env, auth[1] as Provider, Boolean(auth[2]))) ?? fail("signin_off", 503);
  }

  if (path === "/api/me" && method === "GET") return readMe(request, env);

  const board = path.match(/^\/api\/daily\/(\d{1,6})\/([a-z]+)$/);
  if (board && method === "GET") {
    if (!isLanguage(board[2])) return fail("not_found", 404);
    return readBoard(request, env, Number(board[1]), board[2]);
  }

  if (path === "/api/profile") return handleProfile(request, env, url);

  if (!SIGNED_IN_PATHS.has(path)) return fail("not_found", 404);
  const route = SIGNED_IN[`${method} ${path}`];
  const isLogout = path === "/api/logout" && method === "POST";
  if (!route && !isLogout) return fail("method_not_allowed", 405);
  if (!env.TICKET_SECRET) return fail("signin_off", 503);
  if (isLogout) return logout(request, env);
  const user = await currentUser(request, env);
  if (!user) return fail("signin_required", 401);
  return route!(request, env, user);
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
