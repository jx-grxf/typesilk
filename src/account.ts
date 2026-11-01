import type { RunLog } from "./replay";
import type { Language } from "./words";

export type Account = { id: string; username: string | null; displayName: string | null };
export type Provider = "github" | "google";
export type DailyRank = { wpm: number; accuracy: number; rank: number; total: number; first: boolean; hidden: boolean };

export const PROVIDER_NAMES: Record<Provider, string> = { github: "GitHub", google: "Google" };

let account: Account | null = null;
let providers: Provider[] = [];
const tickets = new Map<string, Promise<string | null>>();

export const currentAccount = (): Account | null => account;
export const signInProviders = (): Provider[] => providers;

async function post(path: string, body: unknown = {}, method = "POST"): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, status: response.status, data: (await response.json()) as Record<string, unknown> };
}

/** The site works without any of this, so a failed request just leaves you signed out. */
export async function loadAccount(): Promise<void> {
  try {
    const response = await fetch("/api/me");
    if (!response.ok) return;
    const me = (await response.json()) as { user: Account | null; providers: Provider[] };
    account = me.user;
    providers = me.providers;
  } catch (error) {
    console.warn("account unavailable", error);
  }
}

/** Resolves to an error code, or null when the name was saved. */
export async function saveNames(username: string, displayName: string): Promise<string | null> {
  try {
    const { ok, data } = await post("/api/me", { username, displayName });
    if (!ok) return String(data.error);
    account = data.user as Account;
    tickets.clear();
    return null;
  } catch {
    return "offline";
  }
}

export async function signOut(): Promise<void> {
  await post("/api/logout");
  account = null;
  tickets.clear();
}

export async function deleteAccount(): Promise<boolean> {
  const { ok } = await post("/api/me", {}, "DELETE");
  if (ok) {
    account = null;
    tickets.clear();
  }
  return ok;
}

/** Asked for before the first key, because the server won't rank a run older than its ticket. */
export function prepareTicket(daily: number, language: Language): void {
  if (!account?.username) return;
  const key = `${daily}:${language}`;
  if (tickets.has(key)) return;
  tickets.set(
    key,
    post("/api/daily/ticket", { daily, language })
      .then(({ ok, data }) => (ok ? String(data.ticket) : null))
      .catch(() => null),
  );
}

/** Null means the run could not be ranked: no ticket, offline, or the server said no. */
export async function submitDaily(daily: number, language: Language, log: RunLog): Promise<DailyRank | null> {
  const ticket = await tickets.get(`${daily}:${language}`);
  if (!ticket) return null;
  try {
    const { ok, data } = await post("/api/daily/runs", { ticket, keys: log.keys, gaps: log.gaps });
    return ok ? (data as DailyRank) : null;
  } catch {
    return null;
  }
}
