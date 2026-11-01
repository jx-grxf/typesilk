export type Ticket = { user: string; daily: number; language: string; issuedAt: number };

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signTicket(ticket: Ticket, secret: string): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify(ticket)));
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

export async function verifyTicket(token: unknown, secret: string): Promise<Ticket | null> {
  if (typeof token !== "string" || token.length > 1024) return null;
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await key(secret), fromBase64url(signature), encoder.encode(payload));
    if (!valid) return null;
    return JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as Ticket;
  } catch {
    // malformed base64 is just a bad ticket
    return null;
  }
}
