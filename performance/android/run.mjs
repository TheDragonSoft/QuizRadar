#!/usr/bin/env node
/** Alternate two staging APKs on one emulator and compare cold-start samples. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs } from "../../tooling/lib/agent-utils.mjs";
import {
  comparePerformanceResults,
  renderPerformanceMarkdown,
} from "../../tooling/lib/performance.mjs";

const { flags } = parseCliArgs(process.argv.slice(2));
if (!flags["base-apk"] || !flags["head-apk"]) {
  console.error(
    "usage: node performance/android/run.mjs --base-apk <apk> --head-apk <apk> [--samples 7] [--serial emulator-5554] [--output-dir performance/results/android]",
  );
  process.exit(2);
}
const samples = Number(flags.samples ?? 7);
if (!Number.isInteger(samples) || samples < 1)
  throw new Error("--samples must be a positive integer");
const outputDir = path.resolve(String(flags["output-dir"] ?? "performance/results/android"));
mkdirSync(outputDir, { recursive: true });
const apks = {
  base: path.resolve(String(flags["base-apk"])),
  head: path.resolve(String(flags["head-apk"])),
};
const revisions = {
  base: String(flags["base-revision"] ?? "base"),
  head: String(flags["head-revision"] ?? "head"),
};
const collected = { base: new Map(), head: new Map() };
const sampleScript = fileURLToPath(new URL("./sample.mjs", import.meta.url));

function sample(revision, index) {
  const output = path.join(outputDir, `${revision}-${index}.json`);
  const args = [
    sampleScript,
    "--apk",
    apks[revision],
    "--revision",
    revisions[revision],
    "--output",
    output,
  ];
  if (flags.serial) args.push("--serial", String(flags.serial));
  execFileSync(process.execPath, args, { stdio: ["ignore", "inherit", "inherit"] });
  const result = JSON.parse(readFileSync(output, "utf8"));
  if (index === "warmup") return;
  for (const scenario of result.scenarios) {
    if (!collected[revision].has(scenario.id)) {
      collected[revision].set(scenario.id, { ...scenario, samples: [] });
    }
    collected[revision].get(scenario.id).samples.push(...scenario.samples);
  }
}

sample("base", "warmup");
sample("head", "warmup");
for (let index = 0; index < samples; index += 1) {
  const order = index % 2 === 0 ? ["base", "head"] : ["head", "base"];
  for (const revision of order) sample(revision, index);
}

const results = {};
for (const revision of ["base", "head"]) {
  results[revision] = {
    schemaVersion: 1,
    surface: "android",
    revision: revisions[revision],
    environment: { profile: "staging", processCold: true, interleaved: true },
    scenarios: [...collected[revision].values()],
  };
  writeFileSync(
    path.join(outputDir, `${revision}.json`),
    `${JSON.stringify(results[revision], null, 2)}\n`,
  );
}
const comparison = comparePerformanceResults({
  base: results.base,
  head: results.head,
  thresholds: JSON.parse(readFileSync(path.resolve("performance/thresholds.json"), "utf8")),
  surface: "android",
});
writeFileSync(path.join(outputDir, "comparison.json"), `${JSON.stringify(comparison, null, 2)}\n`);
writeFileSync(path.join(outputDir, "comparison.md"), renderPerformanceMarkdown(comparison));
console.log(renderPerformanceMarkdown(comparison));
process.exit(comparison.passed ? 0 : 1);
