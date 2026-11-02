import { clearSession, currentUser, enabledProviders, sessionToken, type SessionUser } from "./auth";
import { fail, json, readJson, sha256, type Env } from "./http";
import { validDisplayName, validUsername } from "./names";
import { forgetPublicProfile } from "./public";

type PublicUser = { id: string; username: string | null; displayName: string | null; publicProfile: boolean };

function publicUser(user: SessionUser): PublicUser {
  return { id: user.id, username: user.username, displayName: user.display_name, publicProfile: user.public_profile === 1 };
}

export async function readMe(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(request, env);
  return json({ user: user ? publicUser(user) : null, providers: enabledProviders(env) });
}

export async function updateNames(request: Request, env: Env, user: SessionUser): Promise<Response> {
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
  return json({ user: { ...publicUser(user), username, displayName } });
}

export async function deleteAccount(request: Request, env: Env, user: SessionUser): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM daily_runs WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM profile_shares WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM identities WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  await forgetPublicProfile(request, user.username);
  return json({ ok: true }, 200, clearSession());
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const token = sessionToken(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, clearSession());
}
