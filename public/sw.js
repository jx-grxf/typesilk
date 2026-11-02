// Keeps typesilk usable offline. Pages come from the network first, hashed assets from the
// cache first, and word lists and sounds from the cache while a fresh copy loads behind them.
const CACHE = "typesilk";
const SHELL = ["/", "/me"];
const WORDS = ["english", "german", "spanish", "french"].map((language) => `/words/${language}.txt`);

async function precache() {
  const cache = await caches.open(CACHE);
  const response = await fetch("/", { cache: "no-cache" });
  if (!response.ok) return;
  const html = await response.clone().text();
  await cache.put("/", response);
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];
  await cache.addAll([...assets, ...WORDS]);
  // assets from older releases are never asked for again
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/assets/") && !assets.includes(path)) await cache.delete(request);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && SHELL.includes(new URL(request.url).pathname)) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (await cache.match("/")) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const fresh = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  if (hit) {
    event.waitUntil(fresh.catch(() => undefined));
    return hit;
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") event.respondWith(networkFirst(request));
  else if (url.pathname.startsWith("/assets/")) event.respondWith(cacheFirst(request));
  else if (url.pathname.startsWith("/words/") || url.pathname.startsWith("/sounds/") || url.pathname.startsWith("/icon-") || url.pathname.startsWith("/favicon")) event.respondWith(staleWhileRevalidate(request, event));
});
