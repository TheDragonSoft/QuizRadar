#!/usr/bin/env node
/** Aggregate all surface comparison reports into one review verdict. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCliArgs } from "../tooling/lib/agent-utils.mjs";

const { flags } = parseCliArgs(process.argv.slice(2));
const outputDir = path.resolve(String(flags.results ?? "performance/results"));
const surfaces = ["core", "web", "android", "desktop"];
const scenarios = [];
const missing = [];

for (const surface of surfaces) {
  const file = path.join(outputDir, surface, "comparison.json");
  try {
    const comparison = JSON.parse(readFileSync(file, "utf8"));
    if (comparison.surface !== surface)
      throw new Error(`comparison file names surface ${comparison.surface}`);
    for (const scenario of comparison.scenarios) scenarios.push({ surface, ...scenario });
  } catch (error) {
    missing.push(`${surface}: ${error instanceof Error ? error.message : String(error)}`);
    scenarios.push({
      surface,
      id: "harness",
      status: "error",
      reason: "comparison report missing or invalid",
    });
  }
}

const failedSurfaces = [
  ...new Set(
    scenarios
      .filter((scenario) => scenario.status === "regression" || scenario.status === "error")
      .map((scenario) => scenario.surface),
  ),
];
const report = {
  schemaVersion: 1,
  passed: failedSurfaces.length === 0 && missing.length === 0,
  failedSurfaces,
  missingSurfaces: missing,
  scenarios,
};

const markdown = [
  "## Performance review",
  "",
  `- Verdict: **${report.passed ? "PASS" : "REVIEW REQUIRED"}**`,
  `- Failing surfaces: ${failedSurfaces.length === 0 ? "none" : failedSurfaces.join(", ")}`,
  "",
  "| Surface | Scenario | Result |",
  "|---|---|---|",
  ...scenarios.map(
    (scenario) =>
      `| ${scenario.surface} | \`${scenario.id}\` | ${scenario.status === "error" ? `ERROR: ${scenario.reason}` : scenario.status.toUpperCase()} |`,
  ),
  "",
  "Per-scenario medians and raw samples are in each surface artifact. A regression requires code optimization or a reviewed threshold change; the gate never updates itself.",
  "",
].join("\n");

const markdownPath = path.join(outputDir, "performance-review.md");
const jsonPath = path.join(outputDir, "performance-review.json");
mkdirSync(outputDir, { recursive: true });
writeFileSync(markdownPath, markdown);
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(markdown);
process.exit(report.passed ? 0 : 1);
