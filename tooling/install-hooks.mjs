#!/usr/bin/env node
/**
 * Configures Git to use `tooling/git-hooks` for local multi-agent commit/push gates.
 * Runs automatically on `pnpm install` (`prepare`) or manually via `pnpm hooks:install`.
 */
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGit } from "./lib/agent-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const gitEntry = path.join(repoRoot, ".git");
const hooksDir = path.join(repoRoot, "tooling/git-hooks");

if (!existsSync(gitEntry) || !existsSync(hooksDir)) {
  process.exit(0);
}

for (const name of readdirSync(hooksDir)) {
  const hookPath = path.join(hooksDir, name);
  try {
    const content = readFileSync(hookPath, "utf8");
    if (content.includes("\r\n")) {
      writeFileSync(hookPath, content.replace(/\r\n/g, "\n"), "utf8");
    }
    chmodSync(hookPath, 0o755);
  } catch {
    // Windows NTFS ignores POSIX mode bits; Git for Windows reads the `#!` header directly.
  }
}

const res = runGit(repoRoot, ["config", "core.hooksPath", "tooling/git-hooks"], {
  allowFailure: true,
});
if (res !== null) {
  console.log("Installed QuizRadar git hooks (core.hooksPath = tooling/git-hooks).");
}
