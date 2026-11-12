#!/usr/bin/env node
/**
 * Authenticated end-to-end UX sweep runner for the QuizRadar web app.
 *
 * The runner boots the web tier, signs in with the user's own Google/Microsoft
 * accounts (when not skipped), presses the app's own Sync button, sweeps the
 * product surfaces and writes machine-readable + human-readable evidence into
 * an output directory under apps/web/e2e-results/.
 *
 * Hard rules honoured by this file:
 *   - nothing is written outside the output directory except two disclosed
 *     exceptions: the WASM build this runner may trigger writes
 *     apps/web/public/wasm/ and the Rust target/ directory (both gitignored),
 *     and the persistent Chromium profile directory is written;
 *   - nothing here writes an access token, a cookie, a client secret or a URL
 *     with a query string to disk; module output passes through a redaction
 *     pass first. Screenshots of signed-in surfaces are the one exception:
 *     they contain the user's own name and email address, because that is
 *     what the app renders (see the honesty array);
 *   - the OAuth token lives in JS memory only, so page.reload() is never called;
 *   - the runner never clicks destructive controls itself.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { REPO_DIR, WEB_DIR, assertNotCI, parseArgs } from "./lib/args.mjs";
import {
  attachConsoleCapture,
  dismissOnboarding,
  ensureServer,
  launchBrowser,
} from "./lib/harness.mjs";
import {
  ensureTeamsClientId,
  grantMicrosoftScanAccess,
  readAccountState,
  signInWithGoogle,
  signInWithMicrosoft,
  triggerScan,
} from "./lib/signin.mjs";
import { captureSurface, runSweep } from "./lib/sweep.mjs";

const EXIT_OK = 0;
const EXIT_HARNESS_FAILURE = 1;
const EXIT_USAGE = 2;

const SCAN_TIMEOUT_MS = 120000;
const SWEEP_MAX_CLICKS = 8;
const SWEEP_BUDGET_MS = 15 * 60 * 1000;
const APP_BOOT_TIMEOUT_MS = 60000;

/**
 * The mode-dependent honesty statement about which tier the sweep exercised.
 */
function tierHonestyStatement(mode) {
  return mode === "smoke"
    ? "The sweep exercised the WEB tier against the signed-out app; the desktop Tauri shell was not exercised."
    : "The sweep exercised the WEB tier with the user's own signed-in session; the desktop Tauri shell was not exercised.";
}

/** Honesty statements that hold for every run; the tier statement is prepended in main(). */
const HONESTY_STATEMENTS = [
  "In the web tier the Sync button only fetches the user's public .ics feeds — the Google and Microsoft tokens were not used to fetch Gmail or Outlook mail.",
  "Only the surfaces listed under coverage were opened; every other control — above all everything on the safety blocklist (delete, disconnect, save, import, ...) — was deliberately not clicked, so those paths are UNVERIFIED, not verified-good. The one deliberate exception is the app's own Sync button, pressed once by the scan phase.",
];

/**
 * Converts a surface id into a filesystem-safe file name.
 * Every character outside [a-z0-9-_] becomes a dash.
 */
function safeFileName(id) {
  return String(id).replace(/[^a-z0-9_-]/g, "-");
}

/**
 * Removes anything that could leak a credential, an email address or a query string.
 */
function redact(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/(https?:\/\/[^\s"'<>]*)\?[^\s"'<>]*/g, "$1")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted-token]");
}

/**
 * Applies {@link redact} to every string inside an arbitrary JSON value.
 */
function redactDeep(value) {
  if (typeof value === "string") return redact(value);
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item));
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = redactDeep(item);
    return output;
  }
  return value;
}

/**
 * Normalises a module result into the { ok, status, detail } shape used in the report.
 */
function asStatus(result, fallbackDetail = "No outcome was reported.") {
  if (!result || typeof result !== "object") {
    return { ok: false, status: "failed", detail: fallbackDetail };
  }
  return {
    ok: Boolean(result.ok),
    status: typeof result.status === "string" ? result.status : "unknown",
    detail: redact(String(result.detail ?? "")),
  };
}

/**
 * Prints the plain-text banner that tells the operator what is about to happen.
 */
function printBanner(options, outDir) {
  console.log("QuizRadar authenticated UX sweep");
  console.log(`  base URL:  ${options.baseUrl}`);
  console.log(`  evidence:  ${outDir}`);
  console.log(
    `  profile:   ${options.profileDir}   (a persistent Chromium profile: it keeps YOUR Google/Microsoft session cookies on this machine. Delete that folder to sign the harness browser out.)`,
  );
  console.log(
    `  mode:      ${options.skipSignin ? "smoke run (sign-in skipped)" : "signed-in sweep"}`,
  );
  if (!options.skipSignin) {
    console.log(
      "ACTION NEEDED: finish the Google/Microsoft sign-in in the popup windows when they open.",
    );
  }
}

/**
 * Runs one sign-in step, prints its real status and turns a thrown error into a failed status.
 */
async function runStatusStep(label, action) {
  let result;
  try {
    result = await action();
  } catch (error) {
    result = { ok: false, status: "failed", detail: error?.message ?? String(error) };
  }
  const status = asStatus(result);
  console.log(`  ${label.padEnd(13)}${status.status}`);
  return status;
}

/**
 * Runs the Google/Microsoft sign-in phase and records the real outcomes.
 */
async function runSignInPhase({ page, context, options, report }) {
  const signIn = report.signIn;
  const timeoutMs = options.signinTimeoutMs;

  signIn.teamsClientId = await runStatusStep("Teams id:", () =>
    ensureTeamsClientId({ page, clientId: options.teamsClientId }),
  );
  signIn.google = await runStatusStep("Google:", () =>
    signInWithGoogle({ page, context, timeoutMs }),
  );
  signIn.microsoft = await runStatusStep("Microsoft:", () =>
    signInWithMicrosoft({ page, context, timeoutMs }),
  );

  if (!options.grantScanAccess) {
    signIn.grantScanAccess = {
      ok: false,
      status: "skipped",
      detail: "Skipped because --no-grant-scan-access was passed.",
    };
    console.log(`  ${"Scan grant:".padEnd(13)}${signIn.grantScanAccess.status}`);
  } else if (!signIn.microsoft.ok) {
    signIn.grantScanAccess = {
      ok: false,
      status: "skipped",
      detail: `Skipped because the Microsoft sign-in did not succeed (status: ${signIn.microsoft.status}).`,
    };
    console.log(`  ${"Scan grant:".padEnd(13)}${signIn.grantScanAccess.status}`);
  } else {
    signIn.grantScanAccess = await runStatusStep("Scan grant:", () =>
      grantMicrosoftScanAccess({ page, context, timeoutMs }),
    );
  }

  if (signIn.teamsClientId.status === "needs-teams-client-id") {
    console.log(
      "  Teams id:   needs your Azure app (client) id — pass --teams-client-id <id> (a public id, not a secret) and re-run.",
    );
  }
  if (signIn.microsoft.status === "needs-teams-client-id") {
    console.log(
      "  Microsoft:   needs your Azure app (client) id — pass --teams-client-id <id> (a public id, not a secret) and re-run.",
    );
  }

  let account = { googleConnected: false, teamsConnected: false, canGrantScanAccess: false };
  try {
    account = await readAccountState(page);
  } catch (error) {
    report.errors.push(`Could not read the account state: ${error?.message ?? String(error)}`);
  }
  signIn.accountState = {
    googleConnected: Boolean(account.googleConnected),
    teamsConnected: Boolean(account.teamsConnected),
    canGrantScanAccess: Boolean(account.canGrantScanAccess),
  };
  console.log(
    `  ${"Account:".padEnd(13)}google=${signIn.accountState.googleConnected} teams=${signIn.accountState.teamsConnected} grantPossible=${signIn.accountState.canGrantScanAccess}`,
  );
}

/**
 * Runs the app's own Sync button and captures the progress overlay while it runs.
 */
async function runScanPhase({ page, report, state }) {
  let overlaySurface = null;
  let result;
  try {
    result = await triggerScan({
      page,
      timeoutMs: SCAN_TIMEOUT_MS,
      onOverlay: async ({ page }) => {
        try {
          overlaySurface = await captureSurface(page, {
            id: "modal:scan-progress",
            kind: "modal",
            note: "The scan overlay while it is running.",
          });
        } catch (error) {
          report.errors.push(
            `Could not capture the scan overlay: ${error?.message ?? String(error)}`,
          );
        }
      },
    });
  } catch (error) {
    result = { ok: false, status: "failed", detail: error?.message ?? String(error) };
  }
  state.overlaySurface = overlaySurface;
  report.scan = asStatus(result, "The scan phase did not report an outcome.");
  const detail = report.scan.detail ? ` — ${report.scan.detail}` : "";
  console.log(`  ${"Scan:".padEnd(13)}${report.scan.status}${detail}`);
  return report.scan;
}

/**
 * Runs the product sweep and merges the captured scan overlay in as the first surface.
 */
async function runSweepPhase({ page, context, options, report, state }) {
  let sweep = { surfaces: [], notes: [] };
  try {
    sweep = await runSweep({
      page,
      context,
      surfaces: options.surfaces ?? undefined,
      maxClicksPerSurface: SWEEP_MAX_CLICKS,
      budgetMs: SWEEP_BUDGET_MS,
      consoleEntries: state.consoleEntries,
    });
  } catch (error) {
    report.errors.push(`The sweep phase failed: ${error?.message ?? String(error)}`);
  }
  const surfaces = [...(sweep.surfaces ?? [])];
  if (state.overlaySurface) surfaces.unshift(state.overlaySurface);
  state.surfaces = surfaces;
  state.notes = [...(sweep.notes ?? [])];
  report.coverage.notes = state.notes.map((note) => redact(String(note)));
}

/**
 * Flattens the per-surface problems and messages into prefixed report arrays.
 */
function collectSurfaceFindings(surfaces) {
  const problems = [];
  const messages = [];
  for (const surface of surfaces) {
    const id = String(surface.id ?? "unknown");
    for (const problem of surface.problems ?? []) {
      problems.push(`${id}: ${redact(String(problem))}`);
    }
    for (const message of surface.messages ?? []) {
      messages.push(`${id}: ${redact(String(message))}`);
    }
  }
  return { problems, messages };
}

/**
 * Writes the screenshot, DOM and axe evidence files plus console.txt.
 */
function writeSurfaceEvidence({ outDir, surfaces, consoleEntries }) {
  const coverageSurfaces = [];
  for (const surface of surfaces) {
    const id = String(surface.id ?? "unknown");
    const safe = safeFileName(id);
    const screenshotRel = `screenshots/${safe}.png`;
    const domRel = `dom/${safe}.json`;
    const axeRel = `axe/${safe}.json`;
    if (surface.screenshot) {
      fs.writeFileSync(path.join(outDir, "screenshots", `${safe}.png`), surface.screenshot);
    }
    fs.writeFileSync(
      path.join(outDir, "dom", `${safe}.json`),
      JSON.stringify(redactDeep(surface.dom ?? []), null, 2),
    );
    fs.writeFileSync(
      path.join(outDir, "axe", `${safe}.json`),
      JSON.stringify(redactDeep(surface.axe ?? []), null, 2),
    );
    coverageSurfaces.push({
      id,
      kind: surface.kind ?? "unknown",
      screenshot: screenshotRel,
      dom: domRel,
      axe: axeRel,
      ...(surface.axeStatus ? { axeStatus: surface.axeStatus } : {}),
      axeViolationCount: Array.isArray(surface.axe) ? surface.axe.length : 0,
      problemCount: Array.isArray(surface.problems) ? surface.problems.length : 0,
      messageCount: Array.isArray(surface.messages) ? surface.messages.length : 0,
      note: redact(String(surface.note ?? "")),
    });
  }
  const consoleLines = (consoleEntries ?? []).map((entry) => redact(String(entry)));
  fs.writeFileSync(
    path.join(outDir, "console.txt"),
    consoleLines.length > 0 ? `${consoleLines.join("\n")}\n` : "",
  );
  return coverageSurfaces;
}

/**
 * Builds the human-readable summary of the run.
 */
function buildSummaryMarkdown({ report, outDir }) {
  const requested = report.coverage.requestedSurfaces ?? [];
  const captured = new Set(
    report.coverage.surfaces.map((surface) => String(surface.id).split(":").pop()),
  );
  const notCaptured = requested.filter((id) => !captured.has(String(id).split(":").pop()));
  const totalAxe = report.coverage.surfaces.reduce(
    (sum, surface) => sum + surface.axeViolationCount,
    0,
  );
  const lines = [];
  lines.push("# QuizRadar authenticated UX sweep");
  lines.push("");
  lines.push(
    `- Mode: ${report.mode === "smoke" ? "smoke run (sign-in skipped)" : "signed-in sweep"}`,
  );
  lines.push(`- Base URL: ${report.baseUrl}`);
  lines.push(`- Headless: ${report.headless}`);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt}`);
  lines.push(`- Duration: ${report.durationMs} ms`);
  lines.push(`- Evidence: ${outDir}`);
  lines.push(`- Chromium profile: ${report.profileDir}`);
  lines.push("");
  lines.push("## Coverage");
  lines.push("");
  lines.push(`- Surfaces captured: ${report.coverage.surfaceCount}`);
  lines.push(`- Total axe violations: ${totalAxe}`);
  lines.push(`- Problems: ${report.problems.length}`);
  lines.push(`- App-visible messages: ${report.messages.length}`);
  lines.push(
    `- Surfaces: ${report.coverage.surfaces.map((surface) => `${surface.id} (${surface.kind})`).join(", ") || "none"}`,
  );
  lines.push(`- Requested but not captured: ${notCaptured.join(", ") || "none"}`);
  if (report.coverage.notes.length > 0) {
    lines.push(`- Sweep notes: ${report.coverage.notes.length} recorded`);
    for (const note of report.coverage.notes.slice(0, 15)) {
      lines.push(`  - ${note}`);
    }
    if (report.coverage.notes.length > 15) {
      lines.push(
        `  - ... and ${report.coverage.notes.length - 15} more (full list in report.json)`,
      );
    }
  }
  lines.push("");
  lines.push("## Sign-in");
  lines.push("");
  lines.push(`- Teams client id: ${report.signIn.teamsClientId.status}`);
  lines.push(`- Google: ${report.signIn.google.status}`);
  lines.push(`- Microsoft: ${report.signIn.microsoft.status}`);
  lines.push(
    `- Scan access grant: ${report.signIn.grantScanAccess ? report.signIn.grantScanAccess.status : "skipped"}`,
  );
  lines.push(
    `- Account state: googleConnected=${report.signIn.accountState.googleConnected}, teamsConnected=${report.signIn.accountState.teamsConnected}, canGrantScanAccess=${report.signIn.accountState.canGrantScanAccess}`,
  );
  if (!report.signIn.attempted) {
    lines.push("- Sign-in was skipped: this was a smoke run, no account was signed in.");
  }
  lines.push("");
  lines.push("## Scan");
  lines.push("");
  lines.push(`- Status: ${report.scan.status}`);
  if (report.scan.detail) lines.push(`- Detail: ${report.scan.detail}`);
  lines.push("");
  lines.push("## Skipped / not done");
  lines.push("");
  lines.push("- The desktop Tauri shell was not exercised.");
  lines.push(
    "- Gmail and Outlook mail were not fetched: the web tier's Sync only reads public .ics feeds.",
  );
  if (notCaptured.length > 0) {
    lines.push(`- These requested surfaces were not captured: ${notCaptured.join(", ")}.`);
  }
  if (report.errors.length > 0) {
    lines.push(`- Recorded failures: ${report.errors.join(" | ")}`);
  }
  lines.push("");
  lines.push("## What this run did NOT prove");
  lines.push("");
  for (const statement of report.honesty) lines.push(`- ${statement}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Prints the final operator-facing summary.
 */
function printFinalSummary({ report, outDir }) {
  const totalAxe = report.coverage.surfaces.reduce(
    (sum, surface) => sum + surface.axeViolationCount,
    0,
  );
  console.log("");
  console.log("QuizRadar authenticated UX sweep — done");
  console.log(`  evidence:   ${outDir}`);
  console.log(`  surfaces:   ${report.coverage.surfaceCount}`);
  console.log(`  axe issues: ${totalAxe}`);
  console.log(`  ${"Teams id:".padEnd(13)}${report.signIn.teamsClientId.status}`);
  console.log(`  ${"Google:".padEnd(13)}${report.signIn.google.status}`);
  console.log(`  ${"Microsoft:".padEnd(13)}${report.signIn.microsoft.status}`);
  console.log(
    `  ${"Scan grant:".padEnd(13)}${report.signIn.grantScanAccess ? report.signIn.grantScanAccess.status : "skipped"}`,
  );
  console.log(`  ${"Scan:".padEnd(13)}${report.scan.status}`);
  for (const statement of report.honesty) console.log(`  honesty:    ${statement}`);
}

/**
 * Runs the whole sweep and returns the process exit code.
 */
async function main() {
  const options = parseArgs(process.argv);

  try {
    assertNotCI();
  } catch (error) {
    console.error(error?.message ?? String(error));
    return EXIT_HARNESS_FAILURE;
  }

  if (options.headless && !options.skipSignin) {
    console.error(
      "Interactive sign-in needs a visible browser. Drop --headless (or use --skip-signin for a smoke run).",
    );
    return EXIT_USAGE;
  }

  const outDir = path.resolve(WEB_DIR, options.outDir);
  for (const folder of ["", "screenshots", "dom", "axe"]) {
    fs.mkdirSync(path.join(outDir, folder), { recursive: true });
  }

  const startedAtDate = new Date();
  const mode = options.skipSignin ? "smoke" : "signed-in";
  const report = {
    tool: "quizradar-authenticated-ux-sweep",
    startedAt: startedAtDate.toISOString(),
    finishedAt: null,
    durationMs: null,
    baseUrl: options.baseUrl,
    headless: Boolean(options.headless),
    profileDir: options.profileDir,
    mode,
    outDir,
    webDir: WEB_DIR,
    repoDir: REPO_DIR,
    signIn: {
      attempted: !options.skipSignin,
      teamsClientId: {
        ok: false,
        status: "skipped",
        detail: "Sign-in was skipped for this run.",
      },
      google: { ok: false, status: "skipped", detail: "Sign-in was skipped for this run." },
      microsoft: {
        ok: false,
        status: "skipped",
        detail: "Sign-in was skipped for this run.",
      },
      grantScanAccess: null,
      accountState: {
        googleConnected: false,
        teamsConnected: false,
        canGrantScanAccess: false,
      },
    },
    scan: { ok: false, status: "skipped", detail: "The scan phase did not run." },
    coverage: {
      surfaceCount: 0,
      requestedSurfaces: options.surfaces,
      surfaces: [],
      notes: [],
    },
    problems: [],
    messages: [],
    honesty: [tierHonestyStatement(mode), ...HONESTY_STATEMENTS],
    errors: [],
  };
  if (mode === "smoke") {
    report.honesty.push("No signed-in session existed, so no identity data was rendered.");
  } else {
    report.honesty.push(
      "Screenshots of signed-in surfaces contain the user's own name and email address; the evidence folder is personal data on this machine and is gitignored.",
    );
  }

  const state = { consoleEntries: [], surfaces: [], notes: [], overlaySurface: null };
  let server = null;
  let context = null;
  let exitCode = EXIT_OK;

  try {
    server = await ensureServer({ baseUrl: options.baseUrl });
    const launched = await launchBrowser({
      profileDir: options.profileDir,
      headless: options.headless,
    });
    context = launched.context;
    const page = launched.page;
    const capture = attachConsoleCapture(page);
    state.consoleEntries = capture.entries;

    let booted = true;
    try {
      await page.goto(options.baseUrl, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="app-topbar"]', {
        state: "visible",
        timeout: APP_BOOT_TIMEOUT_MS,
      });
    } catch (error) {
      booted = false;
      const detail = `The app did not boot at ${options.baseUrl}. ${error?.message ?? String(error)}`;
      console.error(detail);
      report.errors.push(detail);
      exitCode = EXIT_HARNESS_FAILURE;
    }

    if (booted) {
      await dismissOnboarding(page);
      printBanner(options, outDir);

      if (!options.skipSignin) {
        await runSignInPhase({ page, context, options, report });
      } else {
        console.log("  Sign-in:    skipped (smoke run)");
      }

      await runScanPhase({ page, report, state });
      await runSweepPhase({ page, context, options, report, state });
    }
  } catch (error) {
    const detail = `The harness could not run: ${error?.message ?? String(error)}`;
    console.error(detail);
    report.errors.push(detail);
    exitCode = EXIT_HARNESS_FAILURE;
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (error) {
        report.errors.push(
          `Could not close the browser context: ${error?.message ?? String(error)}`,
        );
      }
    }
    if (server && server.started) {
      try {
        await server.stop();
      } catch (error) {
        report.errors.push(`Could not stop the dev server: ${error?.message ?? String(error)}`);
      }
    }
  }

  if (report.signIn.teamsClientId.status === "set") {
    report.honesty.push(
      "The harness filled the Microsoft Azure client id once via --teams-client-id (a public identifier, through the app's own Settings form).",
    );
  }

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startedAtDate.getTime();

  try {
    const coverageSurfaces = writeSurfaceEvidence({
      outDir,
      surfaces: state.surfaces,
      consoleEntries: state.consoleEntries,
    });
    const findings = collectSurfaceFindings(state.surfaces);
    report.coverage.surfaceCount = coverageSurfaces.length;
    report.coverage.surfaces = coverageSurfaces;
    report.problems = findings.problems;
    report.messages = findings.messages;
  } catch (error) {
    const detail = `Could not write the surface evidence: ${error?.message ?? String(error)}`;
    console.error(detail);
    report.errors.push(detail);
    exitCode = EXIT_HARNESS_FAILURE;
  }

  const redactedReport = redactDeep(report);

  try {
    fs.writeFileSync(
      path.join(outDir, "report.json"),
      `${JSON.stringify(redactedReport, null, 2)}\n`,
    );
  } catch (error) {
    console.error(`Could not write report.json: ${error?.message ?? String(error)}`);
    exitCode = EXIT_HARNESS_FAILURE;
  }

  try {
    fs.writeFileSync(
      path.join(outDir, "summary.md"),
      buildSummaryMarkdown({ report: redactedReport, outDir }),
    );
  } catch (error) {
    console.error(`Could not write summary.md: ${error?.message ?? String(error)}`);
    exitCode = EXIT_HARNESS_FAILURE;
  }

  printFinalSummary({ report, outDir });
  return exitCode;
}

/**
 * Flushes stdout/stderr and terminates the process with the given exit code.
 */
function finish(code) {
  process.exitCode = code;
  process.stdout.write("", () => {
    process.stderr.write("", () => {
      process.exit(code);
    });
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = path.resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  main().then(
    (code) => finish(code),
    (error) => {
      console.error(`The authenticated sweep crashed: ${error?.message ?? String(error)}`);
      finish(EXIT_HARNESS_FAILURE);
    },
  );
}
