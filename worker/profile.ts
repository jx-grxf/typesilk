import { emptyProfile, type Profile } from "../src/profile";
import { mergeProfiles, sanitizeProfile } from "../src/profile-merge";
import { currentUser } from "./auth";
import { fail, json, readJson, type Env } from "./http";

type Share = { device: string; data: string };
type SharedProfile = { epoch: number; profile: Profile };

const DEVICE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// old devices fold into this one, so a long-lived account never loses runs to the limit
const ARCHIVE = "archive";
const MAX_DEVICES = 12;
const MAX_PROFILE_BYTES = 256 * 1024;

const isDevice = (value: unknown): value is string => typeof value === "string" && DEVICE.test(value);

async function epochOf(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare("SELECT profile_epoch FROM users WHERE id = ?").bind(userId).first<{ profile_epoch: number }>();
  return row?.profile_epoch ?? 0;
}

async function sharesOf(db: D1Database, userId: string): Promise<Share[]> {
  const { results } = await db.prepare("SELECT device, data FROM profile_shares WHERE user_id = ? ORDER BY updated_at")
    .bind(userId).all<Share>();
  return results;
}

const parse = (share: Share): Profile => sanitizeProfile(JSON.parse(share.data));

/** Everything the account knows except what `device` itself sent. */
function othersOf(shares: Share[], device: string): Profile {
  const others = shares.filter((share) => share.device !== device);
  return others.length === 0 ? emptyProfile() : mergeProfiles(others.map(parse));
}

async function readProfile(db: D1Database, userId: string, device: string): Promise<SharedProfile> {
  const [epoch, shares] = await Promise.all([epochOf(db, userId), sharesOf(db, userId)]);
  return { epoch, profile: othersOf(shares, device) };
}

/** Stores the device's share unless the account was reset since the device last heard of it. */
async function writeProfile(db: D1Database, userId: string, device: string, epoch: number, share: unknown): Promise<SharedProfile & { stale: boolean }> {
  const shares = await sharesOf(db, userId);
  const current = await epochOf(db, userId);
  const others = othersOf(shares, device);
  if (epoch !== current) return { epoch: current, profile: others, stale: true };

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  const devices = shares.filter((row) => row.device !== ARCHIVE);
  const oldest = devices[0];
  if (oldest && !devices.some((row) => row.device === device) && devices.length >= MAX_DEVICES) {
    const archive = shares.find((row) => row.device === ARCHIVE);
    const folded = mergeProfiles([...(archive ? [parse(archive)] : []), parse(oldest)]);
    statements.push(
      db.prepare(
        `INSERT INTO profile_shares (user_id, device, data, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, device) DO UPDATE SET data = excluded.data`,
      ).bind(userId, ARCHIVE, JSON.stringify(folded), 0),
      db.prepare("DELETE FROM profile_shares WHERE user_id = ? AND device = ?").bind(userId, oldest.device),
    );
  }
  // the epoch is checked again inside the write, so a reset that lands in between still wins
  statements.push(
    db.prepare(
      `INSERT INTO profile_shares (user_id, device, data, updated_at)
       SELECT ?, ?, ?, ? WHERE (SELECT profile_epoch FROM users WHERE id = ?) = ?
       ON CONFLICT (user_id, device) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ).bind(userId, device, JSON.stringify(sanitizeProfile(share)), now, userId, epoch),
  );
  await db.batch(statements);
  return { epoch, profile: others, stale: false };
}

async function resetProfile(db: D1Database, userId: string): Promise<number> {
  await db.batch([
    db.prepare("DELETE FROM profile_shares WHERE user_id = ?").bind(userId),
    db.prepare("UPDATE users SET profile_epoch = profile_epoch + 1 WHERE id = ?").bind(userId),
  ]);
  return epochOf(db, userId);
}

/** GET reads the other devices, POST stores this one's share, DELETE resets the account's stats. */
export async function handleProfile(request: Request, env: Env, url: URL): Promise<Response> {
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
