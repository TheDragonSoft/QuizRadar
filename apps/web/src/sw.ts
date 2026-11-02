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
 *
 * Cold offline start (the installed PWA opened with NO network — the user
 * must see their own last snapshot, not a broken or empty screen):
 *
 * - Every precache entry is added INDEPENDENTLY. `cache.addAll` is atomic:
 *   one renamed icon, one moved WASM file or one flaky response aborts the
 *   whole `install`, the service worker NEVER activates, and the app loses
 *   ALL offline support without saying so. A failed entry is reported
 *   (`console.warn`) instead of being swallowed.
 * - Precache paths are resolved against the service worker's own URL, so a
 *   sub-path deployment (`https://host/quizradar/`) precaches the files that
 *   actually live there instead of 404ing on absolute `/wasm/...` paths.
 * - The shell document (`index.html`) is the one entry the install cannot do
 *   without. If it fails, the install fails loudly: a service worker that
 *   cannot serve the app is worse than no service worker at all.
 * - The hashed entry JS/CSS chunks are discovered from the shell document and
 *   precached too. Without them a cold offline start loads HTML that cannot
 *   execute — a blank screen instead of the user's last snapshot. Their lazy
 *   imports are followed as well, so the whole built module graph is cached.
 * - Cached entries are looked up with `ignoreVary`. The precache stores each
 *   entry with a bare request (no `Origin` header) while the page's module
 *   script requests carry one; a server answering `Vary: Origin` would
 *   otherwise make every precached asset miss and break the offline start.
 *
 * This file is the service worker ENTRY and therefore exports NOTHING: the
 * built `public/sw.js` is registered as a CLASSIC worker, and a classic
 * script may not contain `export` statements. The testable logic lives in
 * `swHelpers.ts`; `src/sw.test.ts` guards both invariants.
 */
import { APP_VERSION } from "./generated/version";
import {
  CACHE_FAMILY,
  CACHE_NAME,
  CROSS_ORIGIN_CACHE,
  apiPrefix,
  installServiceWorker,
  matchCached,
  shellUrl,
} from "./swHelpers";

/**
 * The service worker global scope — or `null` when this module is imported
 * outside a worker (e.g. by the vitest suite), so importing it never
 * explodes and never registers listeners on the window.
 */
function getServiceWorkerScope(): ServiceWorkerGlobalScope | null {
  if (typeof self === "undefined") return null;
  const candidate = self as unknown as {
    registration?: unknown;
    skipWaiting?: unknown;
  };
  if (typeof candidate.registration === "undefined") return null;
  if (typeof candidate.skipWaiting !== "function") return null;
  return candidate as unknown as ServiceWorkerGlobalScope;
}

const sw = getServiceWorkerScope();

if (sw) {
  sw.addEventListener("install", (event) => {
    event.waitUntil(installServiceWorker(sw, caches));
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
                  key.startsWith(CACHE_FAMILY) && key !== CACHE_NAME && key !== CROSS_ORIGIN_CACHE,
              )
              .map((key) => caches.delete(key)),
          ),
        )
        .then(() => sw.clients.claim()),
    );
  });

  sw.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    const base = sw.location.href;

    // Network-first for API endpoints with honest 503 JSON fallback
    if (url.pathname.startsWith(apiPrefix(base)) || url.hostname.includes("googleapis.com")) {
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
      matchCached(caches, event.request).then((cached) => {
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
              const fallback = await matchCached(caches, shellUrl(base));
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
}
