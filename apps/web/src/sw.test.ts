/**
 * Service worker regression suite (cold offline start).
 *
 * The failure mode these tests guard against is silent and total: the
 * service worker never activates, so the installed PWA opens to nothing the
 * next time the user is offline.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
// Importing the service worker entry must be side-effect free outside a
// worker (it guards its `self` usage) — this proves it does not explode.
import "./sw";
import {
  PRECACHE_PATHS,
  extractChunkImportUrls,
  extractShellAssetUrls,
  installServiceWorker,
  installShell,
  matchCached,
  precacheUrls,
  shellUrl,
  type CacheMatchStorage,
  type PrecacheFailure,
  type ShellCache,
} from "./swHelpers";

/** The `apps/web` package root (vitest runs with the package as cwd). */
const APP_ROOT = process.cwd();

/**
 * Where a precache entry comes from in the SOURCE tree:
 * - "./" and "./index.html" are the Vite entry document (apps/web/index.html),
 *   which the build emits as dist/index.html;
 * - everything else lives in apps/web/public/ and is copied verbatim.
 */
function sourceFileForPrecachePath(precachePath: string): string {
  const relative = precachePath.replace(/^\.\//, "");
  if (relative === "" || relative === "index.html") {
    return path.join(APP_ROOT, "index.html");
  }
  return path.join(APP_ROOT, "public", relative);
}

/** A stand-in for the Cache API: it records what was added and can fail. */
function fakeCache(
  options: {
    fail?: (url: string) => boolean;
    html?: string;
    /** Per-URL response bodies (e.g. the source of a built JS chunk). */
    sources?: Record<string, string>;
  } = {},
) {
  const stored: string[] = [];
  const cache: ShellCache = {
    add: async (request: string) => {
      if (options.fail?.(request)) {
        throw new Error(`404 Not Found: ${request}`);
      }
      stored.push(request);
    },
    match: async (request: string) => {
      if (!stored.includes(request)) return undefined;
      const source = options.sources?.[request] ?? options.html;
      if (source === undefined) return undefined;
      return { text: async () => source };
    },
  };
  return { stored, cache };
}

function fakeScope(href: string) {
  return {
    location: { href },
    skipWaiting: vi.fn(async () => {}),
  };
}

describe("Service worker — cold offline start", () => {
  describe("1. A broken precache entry must not kill the install", () => {
    it("installs and activates even when one precache URL fails, and reports it", async () => {
      const base = "https://app.example.test/sw.js";
      const broken = "https://app.example.test/icons/icon-192.png";
      const failures: PrecacheFailure[] = [];
      const { stored, cache } = fakeCache({ fail: (url) => url === broken });
      const scope = fakeScope(base);

      const outcome = await installServiceWorker(
        scope,
        { open: async () => cache },
        { onFailure: (failure) => failures.push(failure) },
      );

      // The install survived: the service worker takes over the page.
      expect(scope.skipWaiting).toHaveBeenCalledTimes(1);
      expect(outcome.shellCached).toBe(true);

      // Exactly the broken entry failed, and it was REPORTED (not swallowed).
      expect(outcome.failed).toHaveLength(1);
      expect(outcome.failed[0].url).toBe(broken);
      expect(failures).toHaveLength(1);
      expect(failures[0].url).toBe(broken);
      expect(failures[0].error).toContain("404");

      // Everything else still made it into the cache.
      expect(stored).toContain("https://app.example.test/index.html");
      expect(stored).toContain("https://app.example.test/wasm/quizradar_wasm_bg.wasm");
      expect(stored).not.toContain(broken);
    });

    it("reports every failure when the whole network is gone, but keeps the shell check honest", async () => {
      const base = "https://app.example.test/sw.js";
      const failures: PrecacheFailure[] = [];
      const { cache } = fakeCache({ fail: () => true });
      const scope = fakeScope(base);

      await expect(
        installServiceWorker(
          scope,
          { open: async () => cache },
          {
            onFailure: (failure) => failures.push(failure),
          },
        ),
      ).rejects.toThrow(/app shell/i);

      // Without the shell there is no app to open offline: the install fails
      // loudly instead of activating a worker that cannot serve anything.
      expect(scope.skipWaiting).not.toHaveBeenCalled();
      expect(failures.length).toBeGreaterThan(0);
    });

    it("adds every URL independently — one rejection never fails the batch", async () => {
      const urls = ["https://app.example.test/a", "https://app.example.test/b"];
      const { stored, cache } = fakeCache({ fail: (url) => url === urls[0] });
      const failures: PrecacheFailure[] = [];

      const outcome = await installShell(cache, urls, {
        onFailure: (failure) => failures.push(failure),
      });

      expect(outcome.cached).toEqual([urls[1]]);
      expect(outcome.failed.map((failure) => failure.url)).toEqual([urls[0]]);
      expect(failures).toHaveLength(1);
      expect(stored).toEqual([urls[1]]);
    });
  });

  describe("2. The precache list must point at files that really exist", () => {
    it("has a real file behind every precache entry", () => {
      const missing: string[] = [];
      for (const precachePath of PRECACHE_PATHS) {
        const file = sourceFileForPrecachePath(precachePath);
        if (!fs.existsSync(file)) {
          missing.push(`${precachePath} → ${file}`);
        }
      }
      // A renamed icon or a moved WASM file would otherwise kill offline
      // support silently. The WASM entries are generated by `pnpm build:wasm`.
      expect(missing).toEqual([]);
    });

    it("keeps the app shell in the precache list", () => {
      expect(PRECACHE_PATHS).toContain("./index.html");
      expect(PRECACHE_PATHS).toContain("./");
    });
  });

  describe("3. The WASM engine must be fully precached", () => {
    it("precaches both the wasm-bindgen loader and the .wasm binary", () => {
      expect(PRECACHE_PATHS).toContain("./wasm/quizradar_wasm.js");
      expect(PRECACHE_PATHS).toContain("./wasm/quizradar_wasm_bg.wasm");
    });

    it("caches the exact URL the app requests for the WASM binary", () => {
      // apps/web/src/pwadapters/wasmBridge.ts asks for
      // new URL("wasm/quizradar_wasm_bg.wasm", window.location.href).
      const requested = new URL("wasm/quizradar_wasm_bg.wasm", "https://app.example.test/").href;
      expect(precacheUrls("https://app.example.test/")).toContain(requested);
    });

    it("caches the URL the wasm-bindgen loader resolves for itself", () => {
      // public/wasm/quizradar_wasm.js defaults to
      // new URL("quizradar_wasm_bg.wasm", import.meta.url) — relative to the
      // LOADER's own URL, not the page.
      const loaderDefault = new URL(
        "quizradar_wasm_bg.wasm",
        "https://app.example.test/wasm/quizradar_wasm.js",
      ).href;
      expect(precacheUrls("https://app.example.test/")).toContain(loaderDefault);
    });
  });

  describe("4. Sub-path deployments must resolve inside the service worker scope", () => {
    it("keeps every precache URL inside the scope", () => {
      const base = "https://host.example/quizradar/sw.js";
      const scope = new URL("./", base).href;

      for (const url of precacheUrls(base)) {
        expect(url.startsWith(scope)).toBe(true);
      }
    });

    it("resolves the WASM binary under the deployment sub-path", () => {
      const base = "https://host.example/quizradar/sw.js";
      expect(precacheUrls(base)).toContain(
        "https://host.example/quizradar/wasm/quizradar_wasm_bg.wasm",
      );
      expect(shellUrl(base)).toBe("https://host.example/quizradar/index.html");
    });
  });

  describe("5. The hashed entry chunks must be precached with the shell", () => {
    it("discovers the entry JS and CSS the shell document needs", () => {
      const html = [
        "<!doctype html><html><head>",
        '<link rel="manifest" href="./manifest.webmanifest">',
        '<script type="module" crossorigin src="./assets/index-C1rPHMKr.js"></script>',
        '<link rel="stylesheet" crossorigin href="./assets/index-BMaqb34d.css">',
        "</head><body></body></html>",
      ].join("");
      const assets = extractShellAssetUrls(html, "https://app.example.test/index.html");

      expect(assets).toContain("https://app.example.test/assets/index-C1rPHMKr.js");
      expect(assets).toContain("https://app.example.test/assets/index-BMaqb34d.css");
      // The manifest is ours too, but it is already in the static list.
      expect(assets).toContain("https://app.example.test/manifest.webmanifest");
    });

    it("ignores cross-origin assets", () => {
      const html = '<script src="https://cdn.example.com/lib.js"></script>';
      expect(extractShellAssetUrls(html, "https://app.example.test/index.html")).toEqual([]);
    });

    it("precaches the entry chunks it discovers in the shell", async () => {
      const html = '<script type="module" src="./assets/index-C1rPHMKr.js"></script>';
      const { stored, cache } = fakeCache({ html });
      const scope = fakeScope("https://app.example.test/sw.js");

      await installServiceWorker(scope, { open: async () => cache });

      expect(stored).toContain("https://app.example.test/assets/index-C1rPHMKr.js");
    });
  });

  describe("6. The whole built module graph must be precached", () => {
    it("finds the static and lazy imports of a chunk", () => {
      const source = [
        'import{a}from"./core-BUhCcD2K.js";',
        'import"./event-D6xIiUZv.js";',
        'const x=await import("./rpcAdapter-CnE9D2pD.js");',
        'import"react";',
      ].join("");
      const urls = extractChunkImportUrls(source, "https://app.example.test/assets/index-abc.js");

      expect(urls).toContain("https://app.example.test/assets/core-BUhCcD2K.js");
      expect(urls).toContain("https://app.example.test/assets/event-D6xIiUZv.js");
      expect(urls).toContain("https://app.example.test/assets/rpcAdapter-CnE9D2pD.js");
      // Bare specifiers are package names, not files of ours.
      expect(urls).not.toContain("react");
    });

    it("precaches the lazy chunks the entry chunk imports, recursively", async () => {
      const html = '<script type="module" src="./assets/index-abc.js"></script>';
      const { stored, cache } = fakeCache({
        html,
        sources: {
          "https://app.example.test/assets/index-abc.js":
            'const p=import("./rpcAdapter-xyz.js");const b=import("./browserSources-1.js");',
          "https://app.example.test/assets/rpcAdapter-xyz.js": 'import"./core-9.js";',
        },
      });
      const scope = fakeScope("https://app.example.test/sw.js");

      await installServiceWorker(scope, { open: async () => cache });

      expect(stored).toContain("https://app.example.test/assets/index-abc.js");
      expect(stored).toContain("https://app.example.test/assets/rpcAdapter-xyz.js");
      expect(stored).toContain("https://app.example.test/assets/browserSources-1.js");
      // One level deeper: the lazy chunk's own import is cached too.
      expect(stored).toContain("https://app.example.test/assets/core-9.js");
    });

    it("reports a lazy chunk that cannot be fetched without killing the install", async () => {
      const html = '<script type="module" src="./assets/index-abc.js"></script>';
      const broken = "https://app.example.test/assets/rpcAdapter-xyz.js";
      const failures: PrecacheFailure[] = [];
      const { stored, cache } = fakeCache({
        html,
        sources: {
          "https://app.example.test/assets/index-abc.js": 'import("./rpcAdapter-xyz.js");',
        },
        fail: (url) => url === broken,
      });
      const scope = fakeScope("https://app.example.test/sw.js");

      const outcome = await installServiceWorker(
        scope,
        { open: async () => cache },
        { onFailure: (failure) => failures.push(failure) },
      );

      expect(scope.skipWaiting).toHaveBeenCalledTimes(1);
      expect(outcome.shellCached).toBe(true);
      expect(failures.map((failure) => failure.url)).toContain(broken);
      expect(stored).not.toContain(broken);
    });
  });

  describe("7. Cached assets must survive a `Vary: Origin` response", () => {
    it("serves a precached asset to the page's module-script request", async () => {
      // The Cache API compares the `Vary` header of the stored response with
      // the query request. The precache stores a BARE request (no Origin),
      // while the page's module script and stylesheet requests carry one —
      // so a server answering `Vary: Origin` makes every precached asset
      // miss, and the offline start loads HTML that cannot execute.
      const cachedResponse = { body: "cached chunk" };
      let seenOptions: { ignoreVary?: boolean } | undefined;

      const fakeCaches: CacheMatchStorage<{ body: string }> = {
        match: async (request, options) => {
          seenOptions = options;
          const queryOrigin =
            typeof request === "string" ? new URL(request).origin : "http://localhost:4173";
          // The stored (precached) request carries no Origin header.
          const storedHeaders: Record<string, string | undefined> = { Origin: undefined };
          const queryHeaders: Record<string, string | undefined> = { Origin: queryOrigin };
          const varies = ["Origin"];
          const differs = varies.some((name) => storedHeaders[name] !== queryHeaders[name]);
          if (differs && !options?.ignoreVary) return undefined;
          return cachedResponse;
        },
      };

      const found = await matchCached(fakeCaches, "http://localhost:4173/assets/index-C7aAxg8j.js");

      expect(seenOptions?.ignoreVary).toBe(true);
      expect(found).toBe(cachedResponse);
    });
  });

  describe("8. The shipped service worker must match the source", () => {
    it("ships a rebuilt public/sw.js without the atomic addAll", () => {
      const built = fs.readFileSync(path.join(APP_ROOT, "public/sw.js"), "utf8");

      // `cache.addAll` is atomic — one failure aborts the whole install.
      expect(built).not.toContain("addAll");
      expect(built).toContain("./wasm/quizradar_wasm_bg.wasm");
      expect(built).toContain("Could not precache");
    });

    it("ships a CLASSIC worker script (no export statements)", () => {
      const built = fs.readFileSync(path.join(APP_ROOT, "public/sw.js"), "utf8");

      // `navigator.serviceWorker.register(url)` registers a classic worker:
      // an `export` statement is a SyntaxError there, the worker never
      // registers, and the installed PWA loses ALL offline support.
      expect(built).not.toMatch(/\bexport\s*[{*]/);
    });

    it("ships the cache lookup that ignores Vary", () => {
      const built = fs.readFileSync(path.join(APP_ROOT, "public/sw.js"), "utf8");

      // Without `ignoreVary` the offline start 503s on every asset.
      expect(built).toContain("ignoreVary");
    });
  });
});
