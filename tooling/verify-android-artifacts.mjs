#!/usr/bin/env node
/**
 * Verify a debug/release APK or AAB ships the native Rust core for every ABI
 * the app advertises:
 *   node tooling/verify-android-artifacts.mjs --kind apk --path app-debug.apk
 *   node tooling/verify-android-artifacts.mjs --kind aab --path app-release.aab
 */
import { execFileSync } from "node:child_process";
import { parseCliArgs } from "./lib/agent-utils.mjs";
import { validateAndroidArtifact } from "./lib/android-artifacts.mjs";

const { flags } = parseCliArgs(process.argv.slice(2));
if (!flags.kind || !flags.path) {
  console.error(
    "usage: node tooling/verify-android-artifacts.mjs --kind apk|aab --path <artifact>",
  );
  process.exit(2);
}
function listArtifactEntries(path) {
  // CI runners provide Info-ZIP's `-Z1`; Windows JDK installs provide `jar tf`.
  const commands = [
    { command: "unzip", args: ["-Z1", path] },
    { command: "jar", args: ["tf", path] },
  ];
  for (const { command, args } of commands) {
    try {
      return execFileSync(command, args, {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      })
        .split(/\r?\n/)
        .filter(Boolean);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (command === "jar") {
        throw new Error(`could not list artifact entries with unzip or jar: ${detail}`);
      }
    }
  }
  throw new Error("no artifact listing tool is available");
}

let entries;
try {
  entries = listArtifactEntries(String(flags.path));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
const result = validateAndroidArtifact(String(flags.kind), entries);
console.log(JSON.stringify(result, null, 2));
for (const error of result.errors) console.error(error);
process.exit(result.valid ? 0 : 1);
