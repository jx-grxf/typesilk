import { emptyProfile, type Profile } from "./profile";
import { mergeProfiles, sanitizeProfile, subtractProfile } from "./profile-merge";

// The local key predates sync: what it holds is this browser's own share of the profile.
const OWN_KEY = "typesilk.profile";
const SYNC_KEY = "typesilk.sync";
const PUSH_DELAY_MS = 2000;
const PULL_AFTER_MS = 60_000;
// browsers drop keepalive requests above 64 KB
const KEEPALIVE_BYTES = 60_000;

type SyncState = {
  device: string;
  /** The account this browser's share belongs to; another account starts from nothing. */
  owner: string | null;
  /** null until the server has told us, so a first sign-in adopts the account's epoch instead of resetting. */
  epoch: number | null;
  /** Every other device of the account, merged, as the server last sent it. */
  remote: Profile | null;
  dirty: boolean;
};

type Shared = { epoch: number; profile: unknown };

type Request = (url: string, init?: RequestInit) => Promise<Response>;

function readJson(storage: Storage, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function loadOwn(storage: Storage): Profile {
  const stored = readJson(storage, OWN_KEY);
  return { ...emptyProfile(), ...(typeof stored === "object" && stored !== null ? stored : {}) };
}

function loadSync(storage: Storage): SyncState {
  const stored = readJson(storage, SYNC_KEY) as Partial<SyncState> | null;
  return {
    device: typeof stored?.device === "string" ? stored.device : crypto.randomUUID(),
    owner: typeof stored?.owner === "string" ? stored.owner : null,
    epoch: typeof stored?.epoch === "number" ? stored.epoch : null,
    remote: stored?.remote ? sanitizeProfile(stored.remote) : null,
    dirty: stored?.dirty === true,
  };
}

const isEmpty = (profile: Profile): boolean => profile.tests === 0 && profile.xp === 0 && Object.keys(profile.keys).length === 0;

/**
 * Holds the profile the app shows and mutates: this browser's share plus, when signed in, every
 * other device's. Runs change `profile` in place and call `save()`.
 */
export class ProfileStore {
  profile: Profile;
  private own: Profile;
  private sync: SyncState;
  private user: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPull = 0;
  private edits = 0;
  private listeners: (() => void)[] = [];

  constructor(
    private storage: Storage = localStorage,
    private request: Request = (url, init) => fetch(url, init),
  ) {
    this.own = loadOwn(storage);
    this.sync = loadSync(storage);
    this.profile = this.view();
  }

  /** Sends on leaving the tab and catches up on returning, when the other browser may have typed. */
  watchVisibility(): void {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.flush(true);
      else if (this.user && Date.now() - this.lastPull > PULL_AFTER_MS) void this.enqueue(() => this.pull());
    });
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  save(): void {
    this.capture();
    if (this.user) {
      this.sync.dirty = true;
      this.edits++;
      clearTimeout(this.pushTimer);
      this.pushTimer = setTimeout(() => void this.flush(), PUSH_DELAY_MS);
    }
    this.persist();
  }

  /** Signed in: this browser's share belongs to `userId` from now on, and the rest of the account comes in. */
  connect(userId: string): void {
    if (this.user === userId) return;
    this.user = userId;
    if (this.sync.owner !== null && this.sync.owner !== userId) {
      this.own = emptyProfile();
      this.sync = { device: crypto.randomUUID(), owner: userId, epoch: null, remote: null, dirty: false };
      this.rebuild();
    } else if (this.sync.owner === null) {
      this.sync.owner = userId;
      this.sync.dirty = !isEmpty(this.own);
    }
    this.persist();
    void this.enqueue(() => this.pull());
  }

  /** Signed out: the other devices' stats leave this browser, its own runs stay. */
  disconnect(): void {
    this.user = null;
    clearTimeout(this.pushTimer);
    if (!this.sync.remote) return;
    this.capture();
    this.sync.remote = null;
    this.sync.dirty = false;
    this.rebuild();
    this.persist();
  }

  /** The account is gone, so the next one to sign in here may take this browser's runs. */
  release(): void {
    this.disconnect();
    this.sync = { ...this.sync, owner: null, epoch: null };
    this.persist();
  }

  /** Sends what is still waiting; signing out waits for this. */
  flush(leaving = false): Promise<void> {
    clearTimeout(this.pushTimer);
    if (!this.user || !this.sync.dirty) return this.queue;
    return this.enqueue(() => this.push(leaving));
  }

  /** Signed in this clears the whole account on every device. Resolves to false when the server couldn't be reached. */
  async reset(): Promise<boolean> {
    let epoch = this.sync.epoch;
    if (this.user) {
      try {
        const response = await this.request("/api/profile", { method: "DELETE" });
        if (!response.ok) return false;
        epoch = ((await response.json()) as { epoch: number }).epoch;
      } catch {
        return false;
      }
    }
    clearTimeout(this.pushTimer);
    this.own = emptyProfile();
    this.sync = { ...this.sync, epoch, remote: null, dirty: false };
    this.rebuild();
    this.persist();
    return true;
  }

  signedIn(): boolean {
    return this.user !== null;
  }

  private view(): Profile {
    return this.sync.remote ? mergeProfiles([this.own, this.sync.remote]) : structuredClone(this.own);
  }

  /** Takes this browser's share back out of what the app has changed. */
  private capture(): void {
    this.own = this.sync.remote ? subtractProfile(this.profile, this.sync.remote) : structuredClone(this.profile);
  }

  private rebuild(): void {
    this.profile = this.view();
    for (const listener of this.listeners) listener();
  }

  private persist(): void {
    try {
      this.storage.setItem(OWN_KEY, JSON.stringify(this.own));
      this.storage.setItem(SYNC_KEY, JSON.stringify(this.sync));
    } catch (error) {
      console.warn("profile not saved", error);
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((error: unknown) => console.warn("profile sync", error));
    return this.queue;
  }

  private receive(shared: Shared): void {
    this.capture();
    if (this.sync.epoch !== null && shared.epoch !== this.sync.epoch) {
      // the account was reset on another device; what this one still holds goes with it
      this.own = emptyProfile();
      this.sync.dirty = false;
    }
    this.sync.epoch = shared.epoch;
    this.sync.remote = sanitizeProfile(shared.profile);
    this.lastPull = Date.now();
    this.rebuild();
    this.persist();
  }

  private async pull(): Promise<void> {
    const user = this.user;
    if (!user) return;
    const response = await this.request(`/api/profile?device=${this.sync.device}`);
    if (!response.ok || this.user !== user) return;
    this.receive((await response.json()) as Shared);
    if (this.sync.dirty) await this.push();
  }

  private async push(leaving = false): Promise<void> {
    const user = this.user;
    if (!user || !this.sync.dirty) return;
    if (this.sync.epoch === null) return this.pull();
    const edits = this.edits;
    const body = JSON.stringify({ device: this.sync.device, epoch: this.sync.epoch, profile: this.own });
    const response = await this.request("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: leaving && body.length < KEEPALIVE_BYTES,
    });
    if (this.user !== user || (!response.ok && response.status !== 409)) return;
    if (edits === this.edits) this.sync.dirty = false;
    this.receive((await response.json()) as Shared);
  }
}
