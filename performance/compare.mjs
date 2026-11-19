#!/usr/bin/env node
/** Compare two raw performance results and write machine/human reports. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCliArgs } from "../tooling/lib/agent-utils.mjs";
import {
  comparePerformanceResults,
  renderPerformanceMarkdown,
} from "../tooling/lib/performance.mjs";

const { flags } = parseCliArgs(process.argv.slice(2));
for (const required of ["base", "head", "surface", "json", "markdown"]) {
  if (!flags[required] || flags[required] === true) {
    console.error(
      `usage: node performance/compare.mjs --base base.json --head head.json --surface core|web|android|desktop [--thresholds performance/thresholds.json] --json comparison.json --markdown comparison.md`,
    );
    process.exit(2);
  }
}

const readJson = (file) => JSON.parse(readFileSync(path.resolve(String(file)), "utf8"));
const write = (file, content) => {
  const target = path.resolve(String(file));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
};

let comparison;
try {
  comparison = comparePerformanceResults({
    base: readJson(flags.base),
    head: readJson(flags.head),
    thresholds: readJson(flags.thresholds ?? "performance/thresholds.json"),
    surface: String(flags.surface),
  });
  write(flags.json, `${JSON.stringify(comparison, null, 2)}\n`);
  write(flags.markdown, renderPerformanceMarkdown(comparison));
  console.log(renderPerformanceMarkdown(comparison));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const failure = {
    schemaVersion: 1,
    surface: String(flags.surface),
    passed: false,
    scenarios: [{ id: "harness", status: "error", reason: message }],
  };
  write(flags.json, `${JSON.stringify(failure, null, 2)}\n`);
  write(
    flags.markdown,
    `## Performance comparison — ${flags.surface}\n\n**REVIEW REQUIRED:** ${message}\n`,
  );
  console.error(`performance comparison failed: ${message}`);
  process.exit(2);
}

process.exit(comparison.passed ? 0 : 1);
