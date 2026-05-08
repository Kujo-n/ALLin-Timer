// ALLin-PokerTimer Service Worker (Phase A)
// - precache: app shell HTML + manifest + icons
// - runtime cache: HTML = network-first, static = stale-while-revalidate
// - cross-origin (Firestore / Google APIs) はスルー（IndexedDB 側に既存）
//
// 注: Phase A 範囲。Phase B では auto-advance fallback の文脈で更新する可能性あり。
// 本ファイルは vanilla JS（ESM 不可 / TS 不可）。Next.js は中身を transform しない。

/* eslint-disable */
// @ts-nocheck

const CACHE_VERSION = "v1";
const SHELL_CACHE = `allin-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `allin-runtime-${CACHE_VERSION}`;

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
    event.respondWith(networkFirst(request));
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

async function networkFirst(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    // 最終フォールバック: shell の "/" を返す（オフライン時の真っ白回避）
    const shell = await caches.match("/");
    if (shell) return shell;
    return new Response("offline", { status: 503, statusText: "offline" });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached ?? (await network) ?? new Response("", { status: 504 });
}
