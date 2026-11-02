export type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  RACE: DurableObjectNamespace;
  RATE_LIMIT: RateLimit;
  RATE_LIMIT_READ: RateLimit;
  TICKET_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

const MAX_BODY_BYTES = 128 * 1024;

/** A whole IPv6 /64 belongs to one subscriber, so it counts as one client. */
export function clientKey(request: Request): string {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!ip.includes(":") || ip.includes(".")) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const front = head.split(":").filter(Boolean);
  const back = tail.split(":").filter(Boolean);
  const groups = [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  return `${groups.slice(0, 4).map((group) => group.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });

export const fail = (error: string, status: number): Response => json({ error }, status);

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readJson(request: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown> | null> {
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
