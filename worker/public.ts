import { emptyProfile } from "../src/profile";
import { mergeProfiles, sanitizeProfile } from "../src/profile-merge";
import { toPublic, type PublicProfile } from "../src/public-profile-data";
import type { SessionUser } from "./auth";
import { fail, json, readJson, type Env } from "./http";

type Owner = { id: string; username: string; display_name: string | null };

const USERNAME = /^[a-z0-9_-]{3,20}$/;
const CACHE_SECONDS = 60;
// the most a profile can have: twelve devices and the archive they fold into
const MAX_SHARES = 13;

const edgeCache = (): Cache | undefined => (typeof caches === "undefined" ? undefined : caches.default);
const cacheKey = (origin: string, username: string): Request => new Request(new URL(`/api/u/${username}`, origin));

async function loadPublic(env: Env, username: string): Promise<PublicProfile | null> {
  const owner = await env.DB.prepare(
    "SELECT id, username, display_name FROM users WHERE username = ? AND public_profile = 1 AND banned_at IS NULL",
  ).bind(username).first<Owner>();
  if (!owner) return null;
  const { results } = await env.DB.prepare("SELECT data FROM profile_shares WHERE user_id = ? LIMIT ?")
    .bind(owner.id, MAX_SHARES).all<{ data: string }>();
  const profile = results.length === 0 ? emptyProfile() : mergeProfiles(results.map((row) => sanitizeProfile(JSON.parse(row.data))));
  return toPublic(profile, owner.username, owner.display_name);
}

/**
 * GET /api/u/:username. Private, missing and banned profiles all answer the same 404, so the
 * endpoint can't be used to find out which names exist. Both answers sit in the edge cache for a
 * minute, which keeps the merge of every device off D1 for repeat visits and scrapers alike.
 */
export async function readPublicProfile(request: Request, env: Env, name: string): Promise<Response> {
  const username = name.toLowerCase();
  if (!USERNAME.test(username)) return fail("not_found", 404);
  const cache = edgeCache();
  const key = cacheKey(request.url, username);
  const hit = await cache?.match(key);
  let body: PublicProfile | null;
  if (hit) {
    body = (await hit.json()) as PublicProfile | null;
  } else {
    body = await loadPublic(env, username);
    await cache?.put(key, new Response(JSON.stringify(body), { headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}` } }));
  }
  // browsers don't keep it, so turning a profile private takes effect on the next visit
  return body ? json(body) : fail("not_found", 404);
}

/** Drops the cached answer, so a change of visibility or a deleted account shows at once. */
export async function forgetPublicProfile(request: Request, username: string | null): Promise<void> {
  if (username) await edgeCache()?.delete(cacheKey(request.url, username));
}

/** POST /api/me/public with { public: boolean }. Needs a username, since that is the address. */
export async function setPublicProfile(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = await readJson(request);
  if (!body || typeof body.public !== "boolean") return fail("bad_request", 400);
  if (!user.username) return fail("username_required", 409);
  await env.DB.prepare("UPDATE users SET public_profile = ? WHERE id = ?").bind(body.public ? 1 : 0, user.id).run();
  await forgetPublicProfile(request, user.username);
  return json({ public: body.public });
}
