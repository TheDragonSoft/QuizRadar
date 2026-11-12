import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_BASE_URL = "http://127.0.0.1:4317";
const DEFAULT_SIGNIN_TIMEOUT_MS = 600000;
const VALUE_FLAGS = new Set([
  "--base-url",
  "--out",
  "--signin-timeout-ms",
  "--profile",
  "--surfaces",
  "--teams-client-id",
]);

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function isFalsy(value) {
  return /^(false|0|no|off)$/i.test(value);
}

/** Absolute path of the apps/web root (this file lives in apps/web/e2e/authed/lib). */
export const WEB_DIR = path.resolve(__dirname, "..", "..", "..");

/** Absolute path of the repository root. */
export const REPO_DIR = path.resolve(WEB_DIR, "..", "..");

/**
 * Parses node-style argv (argv[0] is node, argv[1] is this script) into sweep options.
 * Accepts "--flag value" and "--flag=value"; unknown flags are ignored.
 */
export function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    outDir: null,
    headless: false,
    skipSignin: false,
    signinTimeoutMs: DEFAULT_SIGNIN_TIMEOUT_MS,
    profileDir: path.join(os.homedir(), ".quizradar", "e2e-profile"),
    grantScanAccess: true,
    surfaces: null,
    teamsClientId: null,
  };
  let teamsClientIdSupplied = false;
  let index = 0;
  while (index < args.length) {
    const token = args[index++];
    if (typeof token !== "string" || !token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);
    let value = inline;
    if (value === undefined && VALUE_FLAGS.has(name)) {
      const next = args[index];
      if (typeof next === "string" && !next.startsWith("--")) {
        value = next;
        index += 1;
      }
    }
    if (name === "--base-url" && value !== undefined) options.baseUrl = value;
    else if (name === "--out" && value !== undefined) options.outDir = value;
    else if (name === "--profile" && value !== undefined) options.profileDir = value;
    else if (name === "--surfaces" && value !== undefined) {
      const requested = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      // An empty or whitespace-only value means "not specified", not "no surfaces".
      options.surfaces = requested.length > 0 ? requested : null;
    } else if (name === "--teams-client-id" && value !== undefined) {
      teamsClientIdSupplied = true;
      options.teamsClientId = value.trim() || null;
    } else if (name === "--signin-timeout-ms" && value !== undefined) {
      const parsed = Number(value);
      // Zero or negative would make every sign-in time out instantly; keep the default instead.
      if (Number.isFinite(parsed) && parsed > 0) options.signinTimeoutMs = parsed;
    } else if (name === "--headless")
      options.headless = inline === undefined ? true : !isFalsy(inline);
    else if (name === "--skip-signin")
      options.skipSignin = inline === undefined ? true : !isFalsy(inline);
    else if (name === "--grant-scan-access")
      options.grantScanAccess = inline === undefined ? true : !isFalsy(inline);
    else if (name === "--no-grant-scan-access")
      // Mirrors --grant-scan-access, negated: the bare flag (or a truthy value) skips the step.
      options.grantScanAccess = inline === undefined ? false : isFalsy(inline);
    // Unknown flags are intentionally ignored.
  }
  if (options.outDir === null) options.outDir = `e2e-results/authed/${localTimestamp()}`;
  if (!teamsClientIdSupplied) {
    options.teamsClientId = (process.env.QUIZRADAR_E2E_TEAMS_CLIENT_ID || "").trim() || null;
  }
  return options;
}

/** Throws when CI is detected: the authenticated sweep needs real accounts. */
export function assertNotCI() {
  if (process.env.CI) {
    throw new Error("The authenticated sweep needs real accounts and must never run in CI.");
  }
}
