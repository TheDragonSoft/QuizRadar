#!/usr/bin/env node
/**
 * Validate release tag/version metadata:
 *   node tooling/validate-release.mjs --tag v5.18.0 [--version 5.18.0]
 * Version defaults to tooling/version.json when omitted.
 */
import { readFileSync } from "node:fs";
import { parseCliArgs } from "./lib/agent-utils.mjs";
import { validateReleaseMetadata } from "./lib/release-metadata.mjs";

const { flags } = parseCliArgs(process.argv.slice(2));
if (!flags.tag) {
  console.error("usage: node tooling/validate-release.mjs --tag v5.18.0 [--version 5.18.0]");
  process.exit(2);
}
const version =
  typeof flags.version === "string" && flags.version !== ""
    ? flags.version
    : JSON.parse(readFileSync("tooling/version.json", "utf8")).version;
const result = validateReleaseMetadata({ tag: String(flags.tag), version });
console.log(JSON.stringify(result, null, 2));
for (const error of result.errors) console.error(error);
process.exit(result.valid ? 0 : 1);
