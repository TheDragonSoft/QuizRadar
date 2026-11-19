#!/usr/bin/env node
/** Alternate two core benchmark binaries and compare their median samples. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCliArgs } from "../../tooling/lib/agent-utils.mjs";
import {
  comparePerformanceResults,
  renderPerformanceMarkdown,
} from "../../tooling/lib/performance.mjs";

const { flags } = parseCliArgs(process.argv.slice(2));
for (const name of ["base-bin", "head-bin"]) {
  if (!flags[name] || flags[name] === true) {
    console.error(
      "usage: node performance/core/run.mjs --base-bin <exe> --head-bin <exe> [--samples 15] [--output-dir performance/results/core]",
    );
    process.exit(2);
  }
}
const samples = Number(flags.samples ?? 15);
if (!Number.isInteger(samples) || samples < 1)
  throw new Error("--samples must be a positive integer");
const outputDir = path.resolve(String(flags["output-dir"] ?? "performance/results/core"));
mkdirSync(outputDir, { recursive: true });
const binaries = {
  base: path.resolve(String(flags["base-bin"])),
  head: path.resolve(String(flags["head-bin"])),
};
const revisions = {
  base: String(flags["base-revision"] ?? "base"),
  head: String(flags["head-revision"] ?? "head"),
};
const collected = { base: new Map(), head: new Map() };

function sample(revision, index) {
  const output = path.join(outputDir, `${revision}-${index}.json`);
  execFileSync(binaries[revision], ["--revision", revisions[revision], "--output", output], {
    stdio: ["ignore", "inherit", "inherit"],
  });
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
    surface: "core",
    revision: revisions[revision],
    environment: { profile: "release", interleaved: true },
    scenarios: [...collected[revision].values()],
  };
  writeFileSync(
    path.join(outputDir, `${revision}.json`),
    `${JSON.stringify(results[revision], null, 2)}\n`,
    "utf8",
  );
}
const comparison = comparePerformanceResults({
  base: results.base,
  head: results.head,
  thresholds: JSON.parse(readFileSync(path.resolve("performance/thresholds.json"), "utf8")),
  surface: "core",
});
writeFileSync(path.join(outputDir, "comparison.json"), `${JSON.stringify(comparison, null, 2)}\n`);
writeFileSync(path.join(outputDir, "comparison.md"), renderPerformanceMarkdown(comparison));
console.log(renderPerformanceMarkdown(comparison));
process.exit(comparison.passed ? 0 : 1);
