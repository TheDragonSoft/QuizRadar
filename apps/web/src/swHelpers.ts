/**
 * QuizRadar service worker — the pure, testable half.
 *
 * These helpers live in their own module because the service worker itself
 * (`sw.ts`) must NOT export anything: `public/sw.js` is registered as a
 * CLASSIC worker, and a classic script may not contain `export` statements.
 * The browser would reject it with a SyntaxError, the worker would never
 * register, and the installed PWA would silently lose ALL offline support.
 *
 * The shipped bundle is guarded by `src/sw.test.ts`, which asserts that the
 * built `public/sw.js` contains no export statement.
 */
import { SW_CACHE_KEY_PREFIX } from "./generated/version";

export const CACHE_NAME = `${SW_CACHE_KEY_PREFIX}-shell`;
export const CROSS_ORIGIN_CACHE = `${SW_CACHE_KEY_PREFIX}-cross-origin`;

/**
 * The precache list, as paths RELATIVE to the service worker scope.
 *
 * The leading "./" is load-bearing: `new URL("./wasm/x", sw.location.href)`
 * stays inside the scope (`https://host/quizradar/wasm/x`), while an
 * absolute "/wasm/x" escapes to the origin root and 404s for every
 * sub-path deployment.
 */
export const PRECACHE_PATHS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/radar.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./wasm/quizradar_wasm.js",
  "./wasm/quizradar_wasm_bg.wasm",
] as const;

/** The app shell. Without it there is nothing to open offline. */
export const SHELL_PATH = "./index.html";

/**
 * The cache family ("quizradar-") derived from the stamped version, so the
 * old-cache sweep keeps working across version bumps without a literal.
 */
export const CACHE_FAMILY = `${SW_CACHE_KEY_PREFIX.replace(/-v[0-9].*$/, "")}-`;

/** Resolves the precache list against the service worker scope. */
export function precacheUrls(base: string): string[] {
  return PRECACHE_PATHS.map((path) => new URL(path, base).href);
}

/** The absolute URL of the app shell inside the service worker scope. */
export function shellUrl(base: string): string {
  return new URL(SHELL_PATH, base).href;
}

/** The scope-relative API prefix (`/api/` at the root, `<scope>/api/` below). */
export function apiPrefix(base: string): string {
  return new URL("./api/", base).pathname;
}

export interface PrecacheFailure {
  url: string;
  error: string;
}

/** A request the Cache API can look up (a `Request` or a URL string). */
export type CacheMatchRequest = Request | string;

/**
 * The slice of the Cache API the fetch handler needs.
 *
 * `ignoreVary` is NOT optional here. The precache stores every entry with a
 * bare request (a URL string, no `Origin` header), while the page's module
 * script and stylesheet requests DO carry an `Origin` header. A server that
 * answers with `Vary: Origin` therefore makes every precached asset fail to
 * match: the offline start loads the HTML and then fails to load the
 * JavaScript — a blank screen instead of the user's last snapshot.
 */
export interface CacheMatchStorage<T> {
  match(request: CacheMatchRequest, options?: { ignoreVary?: boolean }): Promise<T | undefined>;
}

/**
 * Looks a request up in the caches, ignoring the `Vary` header.
 *
 * See {@link CacheMatchStorage} for why this is required for the app shell.
 */
export async function matchCached<T>(
  cacheStorage: CacheMatchStorage<T>,
  request: CacheMatchRequest,
): Promise<T | undefined> {
  return cacheStorage.match(request, { ignoreVary: true });
}

export interface PrecacheOutcome {
  /** The URLs that made it into the cache. */
  cached: string[];
  /** The URLs that did NOT — one broken entry must not abort the install. */
  failed: PrecacheFailure[];
  /** True when the app shell itself is cached (the install's hard requirement). */
  shellCached: boolean;
}

/** The slice of the Cache API the install step needs (faked in the tests). */
export interface PrecacheTarget {
  add(request: string): Promise<void>;
}

/** A cache that can also hand back the shell document it stored. */
export interface ShellCache extends PrecacheTarget {
  match(request: string): Promise<{ text(): Promise<string> } | undefined>;
}

/** The slice of `CacheStorage` the install step needs. */
export interface CacheStorageLike {
  open(name: string): Promise<ShellCache>;
}

/** The slice of the service worker global scope the install step needs. */
export interface ServiceWorkerScopeLike {
  readonly location: { readonly href: string };
  skipWaiting(): Promise<void>;
}

export interface InstallShellOptions {
  /** The URL that must be cached for the install to count as usable. */
  shell?: string;
  /** Called once per failed URL — the failure must be observable, not silent. */
  onFailure?: (failure: PrecacheFailure) => void;
}

/**
 * Adds every URL to the cache INDEPENDENTLY.
 *
 * Unlike `cache.addAll` this never rejects because of a single bad URL: a
 * missing icon or a flaky network costs that ONE asset, not the whole
 * offline capability. The outcome reports exactly what was cached and what
 * failed, so the caller can decide whether the result is good enough (the
 * shell is the only hard requirement).
 */
export async function installShell(
  cache: PrecacheTarget,
  urls: string[],
  options: InstallShellOptions = {},
): Promise<PrecacheOutcome> {
  const cached: string[] = [];
  const failed: PrecacheFailure[] = [];

  await Promise.all(
    urls.map(async (url) => {
      try {
        await cache.add(url);
        cached.push(url);
      } catch (error) {
        const failure: PrecacheFailure = {
          url,
          error: error instanceof Error ? error.message : String(error),
        };
        failed.push(failure);
        options.onFailure?.(failure);
      }
    }),
  );

  const shell = options.shell;
  return {
    cached,
    failed,
    shellCached: shell === undefined ? true : cached.includes(shell),
  };
}

/**
 * Extracts the same-origin asset URLs the shell document pulls in — the
 * hashed Vite entry chunk and its stylesheet. Those file names change with
 * every build, so the shell document is the only place that knows them.
 */
export function extractShellAssetUrls(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const found = new Set<string>();
  const pattern = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const raw = match[1];
    if (!raw || raw.startsWith("data:") || raw.startsWith("#")) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    // Cross-origin assets (fonts on a CDN) are not ours to precache.
    if (resolved.origin !== base.origin) continue;
    found.add(resolved.href);
  }
  return [...found];
}

/**
 * Extracts the module specifiers a built JS chunk imports.
 *
 * Vite emits hashed chunks and the entry chunk loads most of them lazily
 * (`import("./rpcAdapter-<hash>.js")`). Those lazy chunks ARE the app: the
 * core bridge, the source adapters and the event plumbing live there. A
 * precache that only holds the shell and the entry chunk boots into a
 * half-working app offline. The specifiers are recoverable from the chunk
 * source itself, which is the only place that knows the build hashes.
 */
export function extractChunkImportUrls(source: string, baseUrl: string): string[] {
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g, // import { x } from "./chunk.js"
    /\bimport\s*["']([^"']+)["']/g, // import "./chunk.js"
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // import("./chunk.js")
  ];
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      // Only relative specifiers point at our own build output.
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
      try {
        found.add(new URL(specifier, baseUrl).href);
      } catch {
        // Not a resolvable URL — nothing to precache.
      }
    }
  }
  return [...found];
}

/**
 * Precache the built module graph: the chunks the shell document references
 * plus every chunk they import, statically or lazily.
 *
 * One level at a time, each entry added independently: a chunk that cannot
 * be fetched costs that chunk (reported, not swallowed), never the install.
 */
export async function precacheModuleGraph(
  cache: ShellCache,
  entryUrls: string[],
  options: InstallShellOptions = {},
): Promise<PrecacheOutcome> {
  const cached: string[] = [];
  const failed: PrecacheFailure[] = [];
  const visited = new Set<string>();
  let level = [...entryUrls];

  while (level.length > 0) {
    const pending = level.filter((url) => !visited.has(url));
    for (const url of pending) visited.add(url);

    const outcome = await installShell(cache, pending, { onFailure: options.onFailure });
    cached.push(...outcome.cached);
    failed.push(...outcome.failed);

    const next: string[] = [];
    for (const url of outcome.cached) {
      if (!url.endsWith(".js")) continue;
      const chunk = await cache.match(url);
      if (!chunk) continue;
      const source = await chunk.text();
      for (const imported of extractChunkImportUrls(source, url)) {
        if (!visited.has(imported)) next.push(imported);
      }
    }
    level = next;
  }

  return { cached, failed, shellCached: true };
}

export interface InstallServiceWorkerOptions {
  /** The cache the shell lives in (defaults to the versioned shell cache). */
  cacheName?: string;
  /** Called once per failed URL — the failure must be observable, not silent. */
  onFailure?: (failure: PrecacheFailure) => void;
}

/**
 * The whole install step, as a function so it can be exercised directly.
 *
 * It RESOLVES even when individual assets fail: a renamed icon or a flaky
 * network costs that one asset, not the entire offline capability. The only
 * hard requirement is the app shell — without it the service worker cannot
 * serve the app, so the install fails loudly instead of pretending.
 */
export async function installServiceWorker(
  scope: ServiceWorkerScopeLike,
  cacheStorage: CacheStorageLike,
  options: InstallServiceWorkerOptions = {},
): Promise<PrecacheOutcome> {
  const report = options.onFailure ?? reportPrecacheFailure;
  const base = scope.location.href;
  const cache = await cacheStorage.open(options.cacheName ?? CACHE_NAME);
  const shell = shellUrl(base);

  const outcome = await installShell(cache, precacheUrls(base), { shell, onFailure: report });

  // The entry chunks carry a build hash, so the shell document is the only
  // place that knows their names. Precache them as well, otherwise an
  // offline start gets HTML that cannot execute. Their own (lazy) imports
  // are followed, otherwise the offline app boots but cannot talk to the
  // core at all.
  const shellResponse = await cache.match(shell);
  if (shellResponse) {
    const html = await shellResponse.text();
    const assets = extractShellAssetUrls(html, shell).filter(
      (url) => !outcome.cached.includes(url),
    );
    const graph = await precacheModuleGraph(cache, assets, { onFailure: report });
    outcome.cached.push(...graph.cached);
    outcome.failed.push(...graph.failed);
  }

  if (!outcome.shellCached) {
    throw new Error(
      `[QuizRadar SW] The app shell (${shell}) could not be cached — this build cannot serve the app offline.`,
    );
  }

  await scope.skipWaiting();
  return outcome;
}

/** The default failure reporter: honest and loud, never silent. */
export function reportPrecacheFailure(failure: PrecacheFailure): void {
  console.warn(`[QuizRadar SW] Could not precache ${failure.url}: ${failure.error}`);
}
