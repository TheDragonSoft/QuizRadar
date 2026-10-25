/// <reference lib="webworker" />
/**
 * QuizRadar Service Worker (`sw.ts`).
 *
 * Requirements (Phase 11):
 * 1. Precache local shell assets (HTML, WASM, icons, manifest).
 * 2. Network-first for API paths with honest 503 JSON:
 *    `{ error: "Offline — QuizRadar is in local mode" }`.
 * 3. Cache-first for cross-origin assets (fonts, icons).
 * 4. Old-cache sweep on activate (removes previous version caches).
 * 5. SW cache key prefix derived from version tooling (no literals).
 */

import { SW_CACHE_KEY_PREFIX, APP_VERSION } from "./generated/version";

const CACHE_NAME = `${SW_CACHE_KEY_PREFIX}-shell`;
const CROSS_ORIGIN_CACHE = `${SW_CACHE_KEY_PREFIX}-cross-origin`;

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/radar.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/wasm/quizradar_wasm.js",
  "/wasm/quizradar_wasm_bg.wasm",
];

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("quizradar-") && key !== CACHE_NAME && key !== CROSS_ORIGIN_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Network-first for API endpoints with honest 503 JSON fallback
  if (url.pathname.startsWith("/api/") || url.hostname.includes("googleapis.com")) {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            JSON.stringify({
              error: "Offline — QuizRadar is in local mode",
              version: APP_VERSION,
            }),
            {
              status: 503,
              statusText: "Service Unavailable",
              headers: { "Content-Type": "application/json" },
            },
          ),
      ),
    );
    return;
  }

  // Cross-origin static assets: cache-first
  if (url.origin !== sw.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CROSS_ORIGIN_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      }),
    );
    return;
  }

  // Local assets: Stale-while-revalidate / cache-first with navigate fallback to /index.html
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          if (event.request.mode === "navigate") {
            const fallback = await caches.match("/index.html");
            if (fallback) return fallback;
          }
          if (cached) return cached;
          return new Response(JSON.stringify({ error: "Offline — QuizRadar is in local mode" }), {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "application/json" },
          });
        });

      return cached || fetchPromise;
    }),
  );
});
