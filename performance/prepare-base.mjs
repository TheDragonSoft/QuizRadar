#!/usr/bin/env node
/**
 * Backfill the benchmark harness (not application code) into a base checkout
 * that predates the performance suite. The base keeps its own production
 * sources; only the sampler package/workspace membership is added.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCliArgs } from "../tooling/lib/agent-utils.mjs";

const { flags } = parseCliArgs(process.argv.slice(2));
if (!flags["base-dir"]) {
  console.error("usage: node performance/prepare-base.mjs --base-dir perf-base");
  process.exit(2);
}
const baseDir = path.resolve(String(flags["base-dir"]));
const sourceCore = path.resolve("performance/core");
const targetCore = path.join(baseDir, "performance/core");
const manifest = path.join(baseDir, "Cargo.toml");
if (!existsSync(sourceCore) || !existsSync(manifest)) {
  throw new Error("performance/core and the base Cargo.toml must exist");
}

mkdirSync(path.dirname(targetCore), { recursive: true });
cpSync(sourceCore, targetCore, { recursive: true });
const toml = readFileSync(manifest, "utf8");
if (!toml.includes('"performance/core"')) {
  const updated = toml.replace(
    /members = \[(.*?)\]/s,
    (_match, members) => `members = [${members.trimEnd()}, "performance/core"]`,
  );
  if (updated === toml) throw new Error("could not add performance/core to the base workspace");
  writeFileSync(manifest, updated);
}
console.log(
  "Benchmark harness is available in the base workspace; production sources are unchanged.",
);
