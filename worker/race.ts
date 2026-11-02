import { plausible } from "../src/activity";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  COUNTDOWN_MS,
  DEFAULT_SETUP,
  isRaceSetup,
  maxChars,
  RACE_CODE,
  raceWords,
  type ClientMessage,
  type RacePhase,
  type RacePlayer,
  type RaceSetup,
  type RoomState,
  type ServerMessage,
} from "../src/race-protocol";
import { BACKSPACE, CLEAR_WORD, replay, type RunLog } from "../src/replay";
import { currentUser } from "./auth";
import { fail, json, type Env } from "./http";
import { validDisplayName } from "./names";

const MAX_PLAYERS = 2;
const MAX_KEYS = 8000;
const MAX_GAP_MS = 60_000;
const MAX_RACE_MS = 5 * 60_000;
// a room nobody joins, or everyone left, is cleared after this
const ROOM_TTL_MS = 60 * 60_000;
// what an honest finish can arrive ahead of the run's own duration: the start signal's trip
const CLOCK_SLACK_MS = 400;
const MAX_MESSAGE = 2_000;
const MAX_FINISH_MESSAGE = 200_000;
// each socket may send in bursts of 40, refilled at 25 a second; typing sends about 5
const BUCKET_SIZE = 40;
const BUCKET_RATE = 25;

type Conn = RacePlayer & { socket: WebSocket; tokens: number; at: number };

export function newRaceCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  // 256 isn't a multiple of 31; the bias it leaves is a fraction of a percent and harmless for a room code
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

const roomOf = (env: Env, code: string): DurableObjectStub => env.RACE.get(env.RACE.idFromName(code));

/** POST /api/race: opens a room and returns its code. */
export async function createRace(env: Env): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newRaceCode();
    const response = await roomOf(env, code).fetch("https://race/init", { method: "POST", body: code });
    if (response.ok) return json({ code });
  }
  return fail("server_error", 500);
}

/** GET /api/race/:code with a WebSocket upgrade. The name comes from the account, or else from ?name. */
export async function joinRace(request: Request, env: Env, url: URL, code: string): Promise<Response> {
  if (!RACE_CODE.test(code)) return fail("not_found", 404);
  if (request.headers.get("Upgrade") !== "websocket") return fail("upgrade_required", 426);
  // a page elsewhere could open a socket with this visitor's cookies; only our own pages may
  if (request.headers.get("Origin") !== url.origin) return fail("forbidden", 403);
  const user = env.TICKET_SECRET ? await currentUser(request, env) : null;
  const name = user?.display_name ?? user?.username ?? validDisplayName(url.searchParams.get("name"));
  if (!name) return fail("bad_name", 400);
  const forward = new Request("https://race/join", { headers: { Upgrade: "websocket", "X-Race-Name": name } });
  return roomOf(env, code).fetch(forward);
}

function validLog(value: unknown): RunLog | null {
  if (typeof value !== "object" || value === null) return null;
  const { keys, gaps } = value as Record<string, unknown>;
  if (!Array.isArray(keys) || !Array.isArray(gaps) || keys.length !== gaps.length || keys.length === 0 || keys.length > MAX_KEYS) return null;
  const keyOk = (key: unknown): boolean => typeof key === "string" && (key === BACKSPACE || key === CLEAR_WORD || [...key].length === 1);
  const gapOk = (gap: unknown): boolean => Number.isInteger(gap) && (gap as number) >= 0 && (gap as number) <= MAX_GAP_MS;
  if (!keys.every(keyOk) || !gaps.every(gapOk)) return null;
  return { keys: keys as string[], gaps: gaps as number[] };
}

/** One race room. It lives in memory while people are connected; storage only remembers that the code was handed out. */
export class RaceRoom implements DurableObject {
  private conns: Conn[] = [];
  private code = "";
  private host = "";
  private phase: RacePhase = "lobby";
  private setup: RaceSetup = DEFAULT_SETUP;
  private seed: number | null = null;
  private startAt = 0;
  private round = 0;
  private words: string[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly state: DurableObjectState, _env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/init" && request.method === "POST") {
      if (await this.state.storage.get("code")) return new Response("taken", { status: 409 });
      await this.state.storage.put("code", await request.text());
      await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return new Response("ok");
    }
    if (path !== "/join") return new Response("not found", { status: 404 });

    const code = await this.state.storage.get<string>("code");
    if (!code) return fail("not_found", 404);
    this.code = code;
    const active = this.conns.filter((conn) => !conn.left);
    if (active.length >= MAX_PLAYERS) return fail("full", 409);
    if (this.phase !== "lobby") return fail("started", 409);

    const pair = new WebSocketPair();
    const socket = pair[1];
    socket.accept();
    const conn: Conn = {
      id: crypto.randomUUID(),
      name: request.headers.get("X-Race-Name") ?? "guest",
      ready: false,
      chars: 0,
      finish: null,
      left: false,
      socket,
      tokens: BUCKET_SIZE,
      at: Date.now(),
    };
    this.conns.push(conn);
    if (!this.host || !this.conns.some((other) => other.id === this.host && !other.left)) this.host = conn.id;
    socket.addEventListener("message", (event) => this.receive(conn, event.data));
    socket.addEventListener("close", () => this.leave(conn));
    socket.addEventListener("error", () => this.leave(conn));
    await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    this.broadcast();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async alarm(): Promise<void> {
    if (this.conns.some((conn) => !conn.left)) {
      await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return;
    }
    await this.state.storage.deleteAll();
  }

  private allow(conn: Conn): boolean {
    const now = Date.now();
    conn.tokens = Math.min(BUCKET_SIZE, conn.tokens + ((now - conn.at) / 1000) * BUCKET_RATE);
    conn.at = now;
    conn.tokens -= 1;
    return conn.tokens >= 0;
  }

  private receive(conn: Conn, data: unknown): void {
    if (conn.left) return;
    if (typeof data !== "string" || data.length > MAX_FINISH_MESSAGE) return this.kick(conn, 1009, "too big");
    if (!this.allow(conn)) return this.kick(conn, 1008, "too many messages");
    let message: ClientMessage;
    try {
      message = JSON.parse(data) as ClientMessage;
    } catch {
      return this.kick(conn, 1003, "not json");
    }
    if (message.t !== "finish" && data.length > MAX_MESSAGE) return this.kick(conn, 1009, "too big");

    switch (message.t) {
      case "setup":
        if (conn.id !== this.host || this.phase !== "lobby" || !isRaceSetup(message.setup)) return this.error(conn, "not_allowed");
        this.setup = { language: message.setup.language, words: message.setup.words };
        for (const other of this.conns) other.ready = false;
        return this.broadcast();
      case "ready":
        if (this.phase !== "lobby" || typeof message.ready !== "boolean") return this.error(conn, "not_allowed");
        conn.ready = message.ready;
        this.broadcast();
        return this.maybeStart();
      case "progress":
        return this.progress(conn, message.chars);
      case "finish":
        return this.finish(conn, message.log);
      case "rematch":
        if (conn.id !== this.host || this.phase !== "done") return this.error(conn, "not_allowed");
        return this.reset();
      default:
        return this.error(conn, "unknown");
    }
  }

  private maybeStart(): void {
    const active = this.conns.filter((conn) => !conn.left);
    if (active.length < MAX_PLAYERS || !active.every((conn) => conn.ready)) return;
    this.seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    this.words = raceWords(this.seed, this.setup);
    this.phase = "countdown";
    this.round++;
    this.startAt = Date.now() + COUNTDOWN_MS;
    this.broadcast(COUNTDOWN_MS);
    this.timers.push(setTimeout(() => {
      this.phase = "racing";
      this.broadcast();
    }, COUNTDOWN_MS));
    const round = this.round;
    this.timers.push(setTimeout(() => {
      if (this.round === round && this.phase === "racing") this.end();
    }, COUNTDOWN_MS + MAX_RACE_MS));
  }

  private progress(conn: Conn, chars: unknown): void {
    if (this.phase !== "racing" || conn.finish) return;
    if (!Number.isInteger(chars) || (chars as number) < 0 || (chars as number) > maxChars(this.words)) return this.error(conn, "bad_progress");
    conn.chars = chars as number;
    this.send({ t: "progress", id: conn.id, chars: conn.chars }, conn);
  }

  /** The server replays the keys against its own copy of the words; the browser's word on speed counts for nothing. */
  private finish(conn: Conn, value: unknown): void {
    if (this.phase !== "racing" || conn.finish) return this.error(conn, "not_allowed");
    const log = validLog(value);
    if (!log) return this.error(conn, "bad_log");
    const elapsed = Date.now() - this.startAt;
    const result = replay(this.words, log);
    const honest = result.finished
      && plausible(log.gaps.slice(1), result.rawWpm)
      && result.durationMs <= elapsed + CLOCK_SLACK_MS;
    const placed = this.conns.filter((other) => other.finish?.place != null).length;
    conn.finish = { wpm: result.wpm, accuracy: result.accuracy, ms: elapsed, place: honest ? placed + 1 : null };
    conn.chars = honest ? maxChars(this.words) : conn.chars;
    if (this.conns.every((other) => other.left || other.finish)) return this.end();
    this.broadcast();
  }

  private end(): void {
    this.phase = "done";
    this.clearTimers();
    this.broadcast();
  }

  private reset(): void {
    this.clearTimers();
    this.conns = this.conns.filter((conn) => !conn.left);
    for (const conn of this.conns) Object.assign(conn, { ready: false, chars: 0, finish: null });
    this.phase = "lobby";
    this.seed = null;
    this.words = [];
    this.broadcast();
  }

  private leave(conn: Conn): void {
    if (conn.left) return;
    conn.left = true;
    if (this.phase === "lobby") this.conns = this.conns.filter((other) => other !== conn);
    const next = this.conns.find((other) => !other.left);
    if (conn.id === this.host && next) this.host = next.id;
    if (!next) {
      this.clearTimers();
      this.conns = [];
      this.phase = "lobby";
      return;
    }
    if (this.phase === "countdown") return this.reset();
    if (this.phase === "racing" && this.conns.every((other) => other.left || other.finish)) return this.end();
    this.broadcast();
  }

  private kick(conn: Conn, code: number, reason: string): void {
    try {
      conn.socket.close(code, reason);
    } catch {
      // already closing
    }
    this.leave(conn);
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private error(conn: Conn, code: string): void {
    this.post(conn, { t: "error", code });
  }

  private post(conn: Conn, message: ServerMessage): void {
    try {
      conn.socket.send(JSON.stringify(message));
    } catch {
      this.leave(conn);
    }
  }

  private send(message: ServerMessage, except: Conn): void {
    for (const conn of this.conns) if (conn !== except && !conn.left) this.post(conn, message);
  }

  private broadcast(startsIn: number | null = null): void {
    const players: RacePlayer[] = this.conns.map(({ id, name, ready, chars, finish, left }) => ({ id, name, ready, chars, finish, left }));
    for (const conn of this.conns) {
      if (conn.left) continue;
      const room: RoomState = {
        t: "room",
        code: this.code,
        you: conn.id,
        host: this.host,
        phase: this.phase,
        setup: this.setup,
        seed: this.seed,
        startsIn,
        round: this.round,
        players,
      };
      this.post(conn, room);
    }
  }
}
