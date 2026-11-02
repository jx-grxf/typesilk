import { describe, expect, it } from "vitest";
import { clientKey } from "./http";
import { isBlocked, validDisplayName, validUsername } from "./names";
import { signTicket, verifyTicket } from "./ticket";

describe("validUsername", () => {
  it("accepts and lowercases plain names", () => {
    expect(validUsername(" Jx_Grxf-1 ")).toBe("jx_grxf-1");
  });

  it.each(["ab", "a".repeat(21), "with space", "émile", "admin", "typesilk", "h1tler", 42, null])("rejects %s", (name) => {
    expect(validUsername(name)).toBeNull();
  });
});

describe("validDisplayName", () => {
  it("normalises spaces and keeps non-Latin names", () => {
    expect(validDisplayName("  Jürgen   Müller ")).toBe("Jürgen Müller");
    expect(validDisplayName("山田太郎")).toBe("山田太郎");
    expect(validDisplayName("line\u2028break")).toBe("line break");
  });

  it.each(["", "   ", "x".repeat(33), "evil\u202Ename", "zero\u200Bwidth", 7])("rejects %j", (name) => {
    expect(validDisplayName(name)).toBeNull();
  });
});

describe("isBlocked", () => {
  it.each(["hitler", "h1tler", "goebbels88", "nazi", "n4zi_fan", "fuck", "fvck", "shit-head", "arschloch", "4rschl0ch", "fils de pute", "hijo de puta", "cabron"])("blocks %s", (name) => {
    expect(isBlocked(name)).toBe(true);
  });

  it.each(["analyse", "assassin", "scunthorpe", "hans", "mitte", "johannes", "jx-grxf", "fast-typer", "Jürgen Müller", "basement", "peacock"])("allows %s", (name) => {
    expect(isBlocked(name)).toBe(false);
  });
});

describe("tickets", () => {
  const ticket = { user: "u1", daily: 12, language: "german", issuedAt: 1000 };

  it("round-trips a signed ticket", async () => {
    expect(await verifyTicket(await signTicket(ticket, "secret"), "secret")).toEqual(ticket);
  });

  it("rejects another secret", async () => {
    expect(await verifyTicket(await signTicket(ticket, "secret"), "other")).toBeNull();
  });

  it("rejects a changed payload", async () => {
    const [, signature] = (await signTicket(ticket, "secret")).split(".");
    const forged = btoa(JSON.stringify({ ...ticket, user: "u2" })).replace(/=+$/, "");
    expect(await verifyTicket(`${forged}.${signature}`, "secret")).toBeNull();
  });

  it.each(["", "a.b.c", "!!!.???", 5, null])("rejects malformed %j", async (token) => {
    expect(await verifyTicket(token, "secret")).toBeNull();
  });
});

describe("clientKey", () => {
  const key = (ip?: string) => clientKey(new Request("https://typesilk.com/api/me", ip ? { headers: { "CF-Connecting-IP": ip } } : {}));

  it("keeps IPv4 addresses as they are", () => {
    expect(key("203.0.113.7")).toBe("203.0.113.7");
  });

  it("folds one IPv6 /64 into a single client", () => {
    expect(key("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(key("2001:db8:1:2::1"));
    expect(key("2001:DB8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(key("2001:db8:1:3::1")).not.toBe(key("2001:db8:1:2::1"));
  });

  it("handles compressed prefixes and a missing header", () => {
    expect(key("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(key("::1")).toBe("0:0:0:0::/64");
    expect(key()).toBe("unknown");
  });
});
