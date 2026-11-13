import { spawn, execFileSync } from "node:child_process";
import dns from "node:dns";
import { createRequire } from "node:module";
import path from "node:path";
import { WEB_DIR, REPO_DIR } from "./args.mjs";

// Vite binds exactly one address and `localhost` resolves to the IPv6 loopback (::1)
// FIRST on this Windows host, so the dev server would listen on ::1 only while the
// OAuth providers still see `http://localhost:4317`. Resolving IPv4 first mirrors the
// `NODE_OPTIONS: --dns-result-order=ipv4first` injection in
// `apps/web/playwright.config.ts`.
if (typeof dns.setDefaultResultOrder === "function") dns.setDefaultResultOrder("ipv4first");

const VITE_PORT = "4317";
const WASM_BUILD_REL = "../../tooling/build-wasm.mjs";
const READY_TIMEOUT_MS = 180_000;
const WASM_BUILD_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 500;
const PROBE_TIMEOUT_MS = 2_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when `url` answers within the probe timeout. */
async function probe(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

/** Strips query strings and hashes from any absolute URL embedded in text. */
function scrubUrls(text) {
  return String(text ?? "").replace(/https?:\/\/[^\s"'<>)\]}]+/g, (raw) => {
    try {
      const u = new URL(raw);
      return `${u.origin}${u.pathname}`;
    } catch {
      return raw.split("?")[0].split("#")[0];
    }
  });
}

/** URL reduced to origin + pathname so query strings never leak into reports. */
function safeUrl(raw) {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(raw ?? "")
      .split("?")[0]
      .split("#")[0];
  }
}

/** Kills a process and its child tree; never throws. */
function killTree(proc) {
  try {
    if (!proc?.pid || proc.exitCode !== null) return;
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch {
        proc.kill("SIGTERM");
      }
    }
  } catch {
    /* never throw */
  }
}

/** Runs the wasm build step with a hard timeout; resolves { code, output } or rejects. */
function runWasmBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WASM_BUILD_REL], { cwd: WEB_DIR, stdio: "pipe" });
    let output = "";
    let settled = false;
    child.stdout?.on("data", (c) => {
      output += c.toString();
    });
    child.stderr?.on("data", (c) => {
      output += c.toString();
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree(child);
      reject(new Error(`the wasm build timed out after ${WASM_BUILD_TIMEOUT_MS} ms`));
    }, WASM_BUILD_TIMEOUT_MS);
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

/** Ensures a Vite dev server answers at `baseUrl`; returns { started, stop }. */
export async function ensureServer({ baseUrl }) {
  const url = new URL(baseUrl);
  const requestedHost = url.hostname || "127.0.0.1";
  const port = url.port || VITE_PORT;
  // Vite binds exactly ONE address, and `localhost` resolves to the IPv6 loopback
  // (::1) first on this Windows host, so binding the name `localhost` would make Vite
  // listen on ::1 only. The bind therefore uses the IPv4 loopback literal, while the
  // URL the browser opens stays `http://localhost:4317` — the origin the OAuth
  // providers validate. The probe uses that same literal.
  const bindHost = requestedHost === "localhost" ? "127.0.0.1" : requestedHost;
  const probeUrl = `http://${bindHost}:${port}`;
  if (await probe(probeUrl)) return { started: false, stop: async () => {} };
  const build = await runWasmBuild();
  if (build.code !== 0) {
    throw new Error(
      `wasm build failed (exit ${build.code}) in ${path.join(REPO_DIR, "apps", "web")}:\n${build.output.slice(-2000)}`,
    );
  }
  const isWin = process.platform === "win32";
  const args = ["exec", "vite", "--host", bindHost, "--port", port, "--strictPort"];
  const server = isWin
    ? spawn("pnpm.cmd", args, { cwd: WEB_DIR, shell: true, stdio: "pipe" })
    : spawn("pnpm", args, { cwd: WEB_DIR, detached: true, stdio: "pipe" });
  let serverOutput = "";
  server.stdout?.on("data", (c) => {
    serverOutput += c.toString();
  });
  server.stderr?.on("data", (c) => {
    serverOutput += c.toString();
  });
  server.on("error", (err) => {
    serverOutput += `\nspawn error: ${err.message}`;
  });
  const stop = async () => {
    killTree(server);
  };
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      await stop();
      throw new Error(
        `dev server exited (${server.exitCode}) for ${path.join(REPO_DIR, "apps", "web")}:\n${serverOutput.slice(-2000)}`,
      );
    }
    if (await probe(probeUrl)) return { started: true, stop };
    await sleep(POLL_INTERVAL_MS);
  }
  await stop();
  throw new Error(
    `dev server did not answer ${baseUrl} within ${READY_TIMEOUT_MS} ms:\n${serverOutput.slice(-2000)}\nVite must be reachable at the base URL; the harness binds the IPv4 loopback literal, so the base URL has to resolve to it.`,
  );
}

/** Lazily loads Playwright: prefers "playwright", falls back to "@playwright/test". */
let playwrightPromise = null;
function loadPlaywright() {
  if (!playwrightPromise) {
    playwrightPromise = (async () => {
      try {
        return await import("playwright");
      } catch {
        return await import("@playwright/test");
      }
    })();
  }
  return playwrightPromise;
}

/**
 * Launches a persistent Chromium context on `profileDir`; returns { context, page }.
 * Keep this context alive: the web tier holds its OAuth token in memory only.
 *
 * When `baseUrl` points at the literal name `localhost`, Chromium is told to resolve
 * that name to the IPv4 loopback. The OAuth providers validate the CALLING PAGE'S
 * ORIGIN string, so the browser has to keep showing `http://localhost:4317`, while the
 * socket has to reach the address Vite actually bound. The resolver rule matches only
 * the literal name `localhost`, so accounts.google.com and login.microsoftonline.com
 * are untouched.
 */
export async function launchBrowser({ profileDir, headless, baseUrl }) {
  const pw = await loadPlaywright();
  const launchOptions = {
    headless: headless === undefined ? true : Boolean(headless),
    viewport: { width: 1440, height: 900 },
    timezoneId: "UTC",
  };
  let hostname = "";
  try {
    hostname = baseUrl ? new URL(baseUrl).hostname : "";
  } catch {
    hostname = "";
  }
  if (hostname === "localhost") {
    launchOptions.args = ["--host-resolver-rules=MAP localhost 127.0.0.1"];
  }
  const context = await pw.chromium.launchPersistentContext(profileDir, launchOptions);
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  return { context, page };
}

/** Closes the first-run onboarding modal when present; never throws. */
export async function dismissOnboarding(page) {
  try {
    const modal = page.locator('[data-testid="modal-onboarding"]');
    await modal.waitFor({ state: "visible", timeout: 15_000 });
    await page
      .locator('[data-testid="modal-onboarding"] button[aria-label="Close"]')
      .first()
      .click({ timeout: 5_000 });
    await modal.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  } catch {
    /* wizard not shown (already completed) or already gone */
  }
}

/**
 * Collects console errors, page errors, failed requests and HTTP >= 400 responses.
 * URLs are stripped of query/hash; no bodies, headers, cookies or tokens are recorded.
 */
export function attachConsoleCapture(page) {
  const entries = [];
  const clip = (value, max = 300) => String(value ?? "").slice(0, max);
  page.on("console", (m) => {
    entries.push(`console.${m.type() || "log"}: ${clip(scrubUrls(m.text()))}`);
  });
  page.on("pageerror", (e) => {
    entries.push(`pageerror: ${clip(scrubUrls(e?.message ?? e))}`);
  });
  page.on("requestfailed", (r) => {
    const reason = r.failure()?.errorText || "failed";
    entries.push(`requestfailed: ${safeUrl(r.url())} - ${clip(reason, 120)}`);
  });
  page.on("response", (res) => {
    const status = res.status();
    if (status >= 400) entries.push(`response ${status}: ${safeUrl(res.url())}`);
  });
  return { entries };
}

/**
 * Snapshots interactive elements (button, a[href], input, select, textarea, [role], [tabindex]).
 * Attributes only - never input values, tokens or cookies.
 */
export async function captureDomOutline(page) {
  return await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(
      "button, a[href], input, select, textarea, [role], [tabindex]",
    )) {
      const aria = {};
      for (const attr of el.attributes)
        if (attr.name.startsWith("aria-")) aria[attr.name] = attr.value;
      const attr = (name) => {
        const v = el.getAttribute(name);
        return v && v.trim() ? v.trim() : "";
      };
      let name = attr("aria-label");
      if (!name) {
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (text) name = text.slice(0, 120);
      }
      if (!name) name = attr("title");
      out.push({
        tag: el.tagName.toLowerCase(),
        role: attr("role"),
        name,
        testid: attr("data-testid"),
        disabled:
          Boolean(el.disabled) || el.hasAttribute("disabled") || attr("aria-disabled") === "true",
        aria,
      });
    }
    return out;
  });
}

/** Reduces a thrown error to a short message whose URLs carry no query strings. */
function shortError(err) {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const text = scrubUrls(raw).replace(/\s+/g, " ").trim().slice(0, 200);
  return text || "the axe scan failed for an unknown reason";
}

/**
 * Runs axe-core against the current page and returns the trimmed violations.
 * The result distinguishes a clean scan ({ ok: true }) from a scan that could not
 * run ({ ok: false, error }), so a broken scan is never mistaken for "0 violations".
 * Never throws.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @returns {Promise<{ ok: boolean, violations: Array, error: string }>} The scan outcome;
 *   error is a short human-readable reason, free of URLs with query strings.
 */
export async function runAxe(page) {
  const failed = (error) => ({ ok: false, violations: [], error });
  try {
    const require = createRequire(path.join(WEB_DIR, "package.json"));
    let axeScriptPath = "";
    try {
      axeScriptPath = require.resolve("axe-core/axe.min.js");
    } catch {
      return failed("axe-core is not installed in the web app");
    }
    try {
      await page.addScriptTag({ path: axeScriptPath });
    } catch {
      return failed("the axe-core script could not be injected into the page");
    }
    const raw = await page.evaluate(async () => {
      if (!window.axe || typeof window.axe.run !== "function") return null;
      const result = await window.axe.run(document);
      return (result.violations || []).map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: (v.nodes || []).slice(0, 10).map((n) => (n.target || []).join(" ")),
      }));
    });
    if (!Array.isArray(raw)) {
      return failed("the axe scan did not run in the page");
    }
    return { ok: true, violations: raw, error: "" };
  } catch (err) {
    return failed(shortError(err));
  }
}
