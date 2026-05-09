// ALLin-PokerTimer Service Worker (Phase A → Phase D)
// - precache: app shell HTML + manifest + icons
// - runtime cache: HTML = network-first (allowlist 化), static = stale-while-revalidate
// - 簡易 LRU: RUNTIME_CACHE は MAX_RUNTIME_ENTRIES 件で最古から間引く
// - cross-origin (Firestore / Google APIs) はスルー（IndexedDB 側に既存）
//
// Phase D: navigate cache の path allowlist 化（auth-aware page を cache に積まない）/
//          RUNTIME_CACHE の簡易 LRU eviction / CACHE_VERSION を v2 に bump（旧 cache 全消し）。
//
// 本ファイルは vanilla JS（ESM 不可 / TS 不可）。Next.js は中身を transform しない。

/* eslint-disable */
// @ts-nocheck

const CACHE_VERSION = "v2";
const SHELL_CACHE = `allin-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `allin-runtime-${CACHE_VERSION}`;

// runtime cache の上限。超過分は cache.keys() の挿入順 (Cache API 仕様) で
// 先頭（= 最古）から間引く。SHELL_CACHE は precache のみで eviction しない。
const MAX_RUNTIME_ENTRIES = 50;

// App shell — auth-free / data-free な静的 routes のみ precache する。
// 動的 route (`/groups/[gid]` / `/tournaments/[tid]` 等) は runtime cache に倒す。
const SHELL_URLS = [
  "/",
  "/login",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-icon-180.png",
];

// navigate (HTML) cache に積んでよい pathname の allowlist。
// `/groups/...` / `/tournaments/...` / `/settings` / `/account` / `/structures/...` /
// `/join/...` 等は auth-aware で共用端末漏えいのリスクがあるため cache 書込を skip。
// query string / hash は無視し pathname のみで判定する。
const NAVIGATE_CACHE_ALLOWLIST = ["/", "/login"];

function shouldCacheNavigate(pathname) {
  return NAVIGATE_CACHE_ALLOWLIST.some((p) =>
    p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`),
  );
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const removeCount = keys.length - maxEntries;
  await Promise.all(keys.slice(0, removeCount).map((k) => cache.delete(k)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        // 個別に addAll を分割して 1 件失敗で全体が崩れないよう best-effort で precache する。
        // 例えば deploy 直後で /login が一時的に 404 でも、icon の precache は成功させたい。
        Promise.all(
          SHELL_URLS.map((url) =>
            cache.add(url).catch(() => {
              // 個別 entry の precache 失敗は warn 相当 (SW では console 利用可)
              // app の動作には致命的ではないため continue。
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // cross-origin (Firestore / Google Auth / fonts.googleapis.com 等) は SW で扱わない
  if (url.origin !== self.location.origin) return;

  // HTML navigation: network-first, fallback to cache, last fallback to "/"
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, url));
    return;
  }

  // Next.js static assets / public icons: stale-while-revalidate
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/sounds/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // それ以外（/api/* / /sw.js 自身 / dev HMR endpoint 等）はネットワーク直行
});

async function networkFirst(req, url) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok && shouldCacheNavigate(url.pathname)) {
      // put → trim を順序保証する。await せず trim を先に走らせると新エントリが
      // cache.keys() に乗らず間引きが 1 cycle 遅れて 50 → 51 に振れる。
      await cache.put(req, res.clone());
      // eviction 失敗は次の put で再評価されるため握る。
      trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES).catch(() => {});
    }
    return res;
  } catch {
    // allowlist 外でも cache に残っていれば返すが、Phase D 以降 cache.put を
    // skip しているため `/groups/...` 等は基本 hit しない。最終的に `/` shell に着地。
    const cached = await cache.match(req);
    if (cached) return cached;
    const shell = await caches.match("/");
    if (shell) return shell;
    return new Response("offline", { status: 503, statusText: "offline" });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then(async (res) => {
      if (res && res.ok) {
        // put → trim の順序保証。await を入れずに trim を走らせると新エントリが
        // index に入る前に keys() を取られて間引きが 1 cycle 遅れる。
        await cache.put(req, res.clone());
        // eviction の失敗は static asset の蓄積で quota error を起こさないため握る。
        trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES).catch(() => {});
      }
      return res;
    })
    .catch(() => null);
  return cached ?? (await network) ?? new Response("", { status: 504 });
}
