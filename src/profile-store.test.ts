import { describe, expect, it } from "vitest";
import { applyRun, emptyProfile, type Profile } from "./profile";
import { mergeProfiles, sanitizeProfile } from "./profile-merge";
import { ProfileStore } from "./profile-store";

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length(): number { return this.items.size; }
  clear(): void { this.items.clear(); }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string): void { this.items.delete(key); }
  setItem(key: string, value: string): void { this.items.set(key, value); }
}

/** The same rules as the worker, without D1. */
class FakeServer {
  epoch = 0;
  shares = new Map<string, Profile>();

  private others(device: string): Profile {
    return mergeProfiles([...this.shares].filter(([id]) => id !== device).map(([, share]) => share));
  }

  request = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const reply = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
    if (init.method === "DELETE") {
      this.shares.clear();
      return reply({ epoch: ++this.epoch });
    }
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body)) as { device: string; epoch: number; profile: unknown };
      if (body.epoch !== this.epoch) return reply({ epoch: this.epoch, profile: this.others(body.device) }, 409);
      this.shares.set(body.device, sanitizeProfile(body.profile));
      return reply({ epoch: this.epoch, profile: this.others(body.device) });
    }
    const device = new URL(url, "http://x").searchParams.get("device")!;
    return reply({ epoch: this.epoch, profile: this.others(device) });
  };
}

function type(store: ProfileStore, runs: number, wpm: number): void {
  for (let i = 0; i < runs; i++) applyRun(store.profile, { key: "time:30:english::", wpm, accuracy: 100, chars: 100, series: [], countsForRecord: true }, "2026-11-01");
  store.save();
}

async function settle(store: ProfileStore): Promise<void> {
  await store.flush();
}

describe("ProfileStore", () => {
  it("adds up two browsers that typed before signing in", async () => {
    const server = new FakeServer();
    const chrome = new ProfileStore(new MemoryStorage(), server.request);
    const safari = new ProfileStore(new MemoryStorage(), server.request);
    type(chrome, 14, 93);
    type(safari, 3, 86);

    chrome.connect("u1");
    await settle(chrome);
    safari.connect("u1");
    await settle(safari);
    expect(safari.profile.tests).toBe(17);
    expect(safari.profile.bests["time:30:english::"]?.wpm).toBe(93);

    type(safari, 1, 70);
    await settle(safari);
    chrome.disconnect();
    chrome.connect("u1");
    await settle(chrome);
    expect(chrome.profile.tests).toBe(18);
    expect(server.shares.size).toBe(2);
  });

  it("keeps only this browser's runs after signing out", async () => {
    const server = new FakeServer();
    server.shares.set("other", { ...emptyProfile(), tests: 10, xp: 400 });
    const storage = new MemoryStorage();
    const store = new ProfileStore(storage, server.request);
    type(store, 2, 60);
    store.connect("u1");
    await settle(store);
    expect(store.profile.tests).toBe(12);

    store.disconnect();
    expect(store.profile.tests).toBe(2);
    expect(new ProfileStore(storage, server.request).profile.tests).toBe(2);
  });

  it("starts empty for another account in the same browser", async () => {
    const server = new FakeServer();
    const store = new ProfileStore(new MemoryStorage(), server.request);
    type(store, 5, 60);
    store.connect("u1");
    await settle(store);
    store.disconnect();

    // the fake server has one account; u2's is empty
    server.shares.clear();
    store.connect("u2");
    await settle(store);
    expect(store.profile.tests).toBe(0);
  });

  it("hands its runs to the next account once the old one is deleted", async () => {
    const server = new FakeServer();
    const store = new ProfileStore(new MemoryStorage(), server.request);
    type(store, 4, 60);
    store.connect("u1");
    await settle(store);
    store.release();

    server.shares.clear();
    store.connect("u2");
    await settle(store);
    expect(store.profile.tests).toBe(4);
    expect([...server.shares.values()][0]?.tests).toBe(4);
  });

  it("drops its share when the account was reset on another device", async () => {
    const server = new FakeServer();
    const a = new ProfileStore(new MemoryStorage(), server.request);
    const b = new ProfileStore(new MemoryStorage(), server.request);
    type(a, 3, 60);
    a.connect("u1");
    await settle(a);
    b.connect("u1");
    await settle(b);
    expect(b.profile.tests).toBe(3);

    expect(await b.reset()).toBe(true);
    type(a, 1, 60);
    await settle(a);
    expect(a.profile.tests).toBe(0);
    expect(server.shares.size).toBe(0);
  });

  it("keeps runs typed while a sync is on its way", async () => {
    const server = new FakeServer();
    server.shares.set("other", { ...emptyProfile(), tests: 10 });
    const store = new ProfileStore(new MemoryStorage(), server.request);
    store.connect("u1");
    type(store, 1, 60);
    await settle(store);
    expect(store.profile.tests).toBe(11);
    expect(server.shares.get([...server.shares.keys()].find((id) => id !== "other")!)?.tests).toBe(1);
  });
});
