#!/usr/bin/env node
/**
 * Coverage ratchet — turn coverage numbers into a gate that actually bites.
 *
 * A coverage percentage nobody checks is decoration. This script reads the
 * summaries produced by the two coverage producers of the repo:
 *
 *   core → `cargo llvm-cov … --json` (LLVM coverage JSON export)
 *   web  → Vitest's v8 provider with the `json-summary` reporter
 *
 * and compares them against the floors committed in
 * `tooling/coverage-baseline.json`. A metric below its floor exits 1 and
 * names the metric. A missing or unreadable summary exits 2 — the ratchet
 * never passes silently because a file was not there.
 *
 * The floors live in the baseline file (not in a test-runner `thresholds`
 * block) so they can be ratcheted deliberately: bump a floor only after the
 * measurement moved, and never above what was actually measured.
 *
 * Exit codes:
 *   0  every tracked metric meets or beats its floor
 *   1  at least one metric is below its floor (or a positive floor could not
 *      be verified because the metric was not measured at all)
 *   2  an input is missing, unreadable or unparseable
 *
 * Usage:
 *   node tooling/coverage-ratchet.mjs
 *   node tooling/coverage-ratchet.mjs --update tooling/coverage-baseline.json
 *   node tooling/coverage-ratchet.mjs --root <dir>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

// `--root <dir>` repoints every lookup at another tree, exactly like
// tooling/generate-version.mjs: the value is resolved against the current
// working directory, and without the flag the repository that owns this
// script is used.
const rootArgIndex = process.argv.indexOf("--root");
if (rootArgIndex !== -1 && !process.argv[rootArgIndex + 1]) {
  console.error("coverage-ratchet: --root needs a directory argument.");
  process.exit(2);
}
const repoRoot =
  rootArgIndex !== -1
    ? path.resolve(process.cwd(), process.argv[rootArgIndex + 1])
    : path.resolve(scriptDir, "..");

// `--update <file>` rewrites the baseline from the measured summaries. The
// target path is resolved against the current working directory, like every
// other CLI path argument.
const updateArgIndex = process.argv.indexOf("--update");
if (updateArgIndex !== -1 && !process.argv[updateArgIndex + 1]) {
  console.error("coverage-ratchet: --update needs a file argument.");
  process.exit(2);
}
const updateTarget =
  updateArgIndex !== -1 ? path.resolve(process.cwd(), process.argv[updateArgIndex + 1]) : null;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    [
      "coverage-ratchet — compare measured coverage against the committed floors.",
      "",
      "  node tooling/coverage-ratchet.mjs [--root <dir>] [--update <file>]",
      "",
      "  --root <dir>     read summaries and the baseline from <dir> instead of the repo root",
      "  --update <file>  rewrite <file> from the measured summaries (floors of unmeasured",
      "                   metrics are written as 0, i.e. 'not enforced')",
      "",
      "Exit codes: 0 = all floors met, 1 = a floor was missed, 2 = unreadable input.",
    ].join("\n"),
  );
  process.exit(0);
}

/** The metrics every section tracks. */
const METRICS = ["lines", "branches", "functions"];

/**
 * Where each section's summary lives, relative to the repo root.
 *
 * `core` — the Rust core crate (`core/src/**`). The desktop shell and the
 * wasm binding are measured by the same llvm-cov run but are not part of the
 * core floor: the shell is thin glue with its own test job, the wasm binding
 * is exercised through the web tier.
 *
 * `web` — the Vitest v8 summary for `apps/web/src/**`.
 *
 * Both live under the gitignored `target/` tree so a coverage run never
 * leaves untracked files behind (and never feeds the lcov HTML report to
 * `pnpm lint` / `pnpm format:check`). The rust summary sits directly in
 * `target/` because `cargo llvm-cov --output-path` does not create missing
 * parent directories, while `target/` always exists after a cargo build.
 */
const SOURCES = [
  {
    section: "core",
    scope: "Rust core crate (core/src/**)",
    relative: path.join("target", "rust-coverage.json"),
  },
  {
    section: "web",
    scope: "Web tier (apps/web/src/**)",
    relative: path.join("target", "coverage", "web", "coverage-summary.json"),
  },
];

const BASELINE_RELATIVE = path.join("tooling", "coverage-baseline.json");

/** Read + parse a JSON file, reporting precisely why it could not be used. */
function readJson(file) {
  if (!existsSync(file)) {
    return { ok: false, error: `file not found: ${file}` };
  }
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `cannot read ${file}: ${detail}` };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `cannot parse JSON in ${file}: ${detail}` };
  }
}

/**
 * Normalize one metric entry of a coverage summary.
 * Accepts the istanbul/vitest shape (`total`/`covered`/`pct`) and the LLVM
 * export shape (`count`/`covered`/`percent`).
 */
function metricEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const count = Number.isFinite(entry.total)
    ? entry.total
    : Number.isFinite(entry.count)
      ? entry.count
      : null;
  const covered = Number.isFinite(entry.covered) ? entry.covered : null;
  let pct = Number.isFinite(entry.pct)
    ? entry.pct
    : Number.isFinite(entry.percent)
      ? entry.percent
      : null;
  if (pct === null && count !== null && covered !== null) {
    pct = count > 0 ? (covered / count) * 100 : null;
  }
  return { pct, count, covered };
}

/** A metric with no data points is "not measured", not "0%" and not "100%". */
function metricValue(entry) {
  if (!entry) return { pct: null, count: 0, covered: null };
  const empty = entry.count === 0 || entry.count === null;
  return {
    pct: empty ? null : entry.pct,
    count: entry.count ?? 0,
    covered: entry.covered,
  };
}

/** Is this llvm-cov source file part of the core crate? */
function isCoreRustSource(filename, root) {
  if (typeof filename !== "string" || filename === "") return false;
  const normalized = filename.replace(/\\/g, "/");
  const relative = path.relative(root, filename).replace(/\\/g, "/");
  if (relative && !relative.startsWith("..")) {
    return relative.startsWith("core/src/");
  }
  return /(^|\/)core\/src\//.test(normalized);
}

/** Summarize an istanbul/vitest `coverage-summary.json` (`total` section). */
function summarizeCoverageSummary(json) {
  const total = json?.total;
  if (!total || typeof total !== "object") {
    return {
      ok: false,
      error: 'no "total" section — expected an istanbul/vitest coverage-summary.json',
    };
  }
  const metrics = {};
  for (const metric of METRICS) {
    const entry = metricEntry(total[metric]);
    if (!entry) {
      return { ok: false, error: `"total.${metric}" is missing or malformed` };
    }
    metrics[metric] = metricValue(entry);
  }
  return { ok: true, metrics };
}

/**
 * Summarize an llvm-cov JSON export. Percentages are recomputed from the
 * per-file counts so the workspace total is a real ratio, not an average of
 * averages.
 */
function summarizeLlvmCov(json, root) {
  const data = json?.data;
  if (!Array.isArray(data)) {
    return { ok: false, error: 'no "data" array — expected an llvm-cov JSON export' };
  }
  const files = data.flatMap((entry) => (Array.isArray(entry?.files) ? entry.files : []));
  const inScope = files.filter((file) => isCoreRustSource(file?.filename, root));
  if (inScope.length === 0) {
    return {
      ok: false,
      error: `the llvm-cov export contains no source file under core/src/ (${files.length} file(s) reported)`,
    };
  }
  const metrics = {};
  for (const metric of METRICS) {
    let count = 0;
    let covered = 0;
    let seen = false;
    for (const file of inScope) {
      const entry = metricEntry(file?.summary?.[metric]);
      if (!entry || entry.count === null || entry.covered === null) continue;
      seen = true;
      count += entry.count;
      covered += entry.covered;
    }
    metrics[metric] = {
      pct: !seen || count === 0 ? null : (covered / count) * 100,
      count,
      covered: seen ? covered : null,
    };
  }
  return { ok: true, metrics };
}

/** Read one summary file and summarize it, whatever producer wrote it. */
function loadSection(source) {
  const file = path.join(repoRoot, source.relative);
  const read = readJson(file);
  if (!read.ok) {
    return { ok: false, error: read.error };
  }
  const json = read.value;
  let summary;
  if (json && typeof json === "object" && json.total && typeof json.total === "object") {
    summary = summarizeCoverageSummary(json);
  } else if (json && typeof json === "object" && Array.isArray(json.data)) {
    summary = summarizeLlvmCov(json, repoRoot);
  } else {
    return {
      ok: false,
      error: `${file} is not a recognizable coverage summary (expected a "total" or "data" section)`,
    };
  }
  if (!summary.ok) {
    return { ok: false, error: `${file}: ${summary.error}` };
  }
  return { ok: true, file, metrics: summary.metrics };
}

function formatPct(value) {
  return value === null || value === undefined ? "n/a" : `${value.toFixed(2)}%`;
}

function formatFloor(value) {
  return value === null || value === undefined ? "none" : `${value.toFixed(2)}%`;
}

/** Render the comparison table (also used by --update). */
function renderTable(rows) {
  const header = ["section", "metric", "measured", "floor", "status"];
  const body = rows.map((row) => [
    row.section,
    row.metric,
    formatPct(row.measured),
    formatFloor(row.floor),
    row.status,
  ]);
  const widths = header.map((cell, i) => Math.max(cell.length, ...body.map((r) => r[i].length)));
  const line = (cells) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

/**
 * Compare the measured metrics against the baseline floors.
 * Returns { rows, failures }.
 */
function compare(measured, baseline) {
  const rows = [];
  const failures = [];
  for (const source of SOURCES) {
    const section = baseline[source.section];
    for (const metric of METRICS) {
      const floor = section ? section[metric] : undefined;
      if (floor === undefined || floor === null) {
        rows.push({
          section: source.section,
          metric,
          measured: measured[source.section][metric].pct,
          floor: null,
          status: "not tracked",
        });
        continue;
      }
      const value = measured[source.section][metric].pct;
      if (value === null) {
        if (floor > 0) {
          rows.push({
            section: source.section,
            metric,
            measured: null,
            floor,
            status: "NOT MEASURED",
          });
          failures.push({
            section: source.section,
            metric,
            measured: null,
            floor,
            reason: "the summary carries no data for this metric, so the floor cannot be verified",
          });
        } else {
          rows.push({
            section: source.section,
            metric,
            measured: null,
            floor,
            status: "n/a (floor 0)",
          });
        }
        continue;
      }
      if (value < floor) {
        rows.push({
          section: source.section,
          metric,
          measured: value,
          floor,
          status: "BELOW FLOOR",
        });
        failures.push({
          section: source.section,
          metric,
          measured: value,
          floor,
          reason: `measured ${value.toFixed(2)}% is below the floor ${floor.toFixed(2)}%`,
        });
      } else {
        rows.push({
          section: source.section,
          metric,
          measured: value,
          floor,
          status: "ok",
        });
      }
    }
  }
  return { rows, failures };
}

/** Validate the baseline shape before trusting it. */
function validateBaseline(baseline, file) {
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) {
    return `the baseline ${file} is not a JSON object`;
  }
  for (const source of SOURCES) {
    const section = baseline[source.section];
    if (!section || typeof section !== "object") {
      return `the baseline ${file} has no "${source.section}" section`;
    }
    for (const metric of METRICS) {
      const floor = section[metric];
      if (floor === undefined || floor === null) continue;
      if (typeof floor !== "number" || !Number.isFinite(floor)) {
        return `the baseline ${file} has a non-numeric floor for ${source.section}.${metric}`;
      }
      if (floor < 0 || floor > 100) {
        return `the baseline ${file} has an out-of-range floor for ${source.section}.${metric}: ${floor}`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const measured = {};
for (const source of SOURCES) {
  const loaded = loadSection(source);
  if (!loaded.ok) {
    console.error(`coverage-ratchet: cannot read the coverage summary — ${loaded.error}`);
    console.error(
      "coverage-ratchet: run `pnpm coverage:rust` and `pnpm coverage:web` before the ratchet.",
    );
    process.exit(2);
  }
  measured[source.section] = loaded.metrics;
  console.log(`read ${source.section} coverage from ${loaded.file}`);
}

if (updateTarget) {
  const baseline = {};
  for (const source of SOURCES) {
    baseline[source.section] = {};
    for (const metric of METRICS) {
      const value = measured[source.section][metric].pct;
      // An unmeasured metric gets a floor of 0: "not enforced", explicitly.
      baseline[source.section][metric] = value === null ? 0 : Math.round(value * 100) / 100;
    }
  }
  const rows = SOURCES.flatMap((source) =>
    METRICS.map((metric) => ({
      section: source.section,
      metric,
      measured: measured[source.section][metric].pct,
      floor: baseline[source.section][metric],
      status: measured[source.section][metric].pct === null ? "n/a (floor 0)" : "measured",
    })),
  );
  writeFileSync(updateTarget, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log("");
  console.log(renderTable(rows));
  console.log("");
  console.log(`wrote the measured baseline to ${updateTarget}`);
  process.exit(0);
}

const baselineFile = path.join(repoRoot, BASELINE_RELATIVE);
const baselineRead = readJson(baselineFile);
if (!baselineRead.ok) {
  console.error(`coverage-ratchet: cannot read the coverage baseline — ${baselineRead.error}`);
  process.exit(2);
}
const baselineProblem = validateBaseline(baselineRead.value, baselineFile);
if (baselineProblem) {
  console.error(`coverage-ratchet: invalid coverage baseline — ${baselineProblem}`);
  process.exit(2);
}

const { rows, failures } = compare(measured, baselineRead.value);

console.log("");
console.log(renderTable(rows));
console.log("");

if (failures.length > 0) {
  console.error(
    `coverage-ratchet: FAILED — ${failures.length} metric(s) below the committed floor:`,
  );
  for (const failure of failures) {
    console.error(
      `  - ${failure.section}.${failure.metric}: ${failure.reason}` +
        (failure.measured === null
          ? ""
          : ` (gap ${(failure.floor - failure.measured).toFixed(2)} pts)`),
    );
  }
  console.error(
    "coverage-ratchet: raise coverage, or — deliberately — lower the floor in " +
      `${path.relative(repoRoot, baselineFile)} and run \`pnpm coverage:update\`.`,
  );
  process.exit(1);
}

console.log("coverage-ratchet: every tracked metric meets or beats the committed floor.");
process.exit(0);
