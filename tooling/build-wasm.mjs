#!/usr/bin/env node
/**
 * Build the WASM engine into apps/web/public/wasm/.
 *
 * Why this exists: `apps/web/src/pwadapters/wasmBridge.ts` statically imports
 * `public/wasm/quizradar_wasm.js`, and the PWA test suite loads the real Rust
 * core through it. The generated artifacts are gitignored (a compiled binary
 * never belongs in the repo), so a clean checkout has no WASM at all — the
 * web build and the vitest run both fail until this script runs.
 *
 * The CLI version of `wasm-bindgen` must match the `wasm-bindgen` crate in
 * Cargo.lock, otherwise the generated glue refuses to load the module.
 *
 * Usage:
 *   node tooling/build-wasm.mjs            # build if stale
 *   node tooling/build-wasm.mjs --force    # always rebuild
 *   node tooling/build-wasm.mjs --debug    # debug profile
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "apps/web/public/wasm");
const outName = "quizradar_wasm";
const target = "wasm32-unknown-unknown";
const release = !process.argv.includes("--debug");
const force = process.argv.includes("--force");

const profile = release ? "release" : "debug";
const profileDir = release ? "release" : "debug";
const artifact = path.join(repoRoot, "target", target, profileDir, "quizradar_wasm.wasm");

/** Run a command, failing loudly with the actual exit code. */
function run(cmd, args) {
  execFileSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

/** Newest mtime under a directory tree, in ms. 0 when the path is absent. */
function newestMtime(dir) {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs);
  }
  return newest;
}

function isStale() {
  const built = path.join(outDir, `${outName}_bg.wasm`);
  if (!existsSync(built)) return true;
  const builtAt = statSync(built).mtimeMs;
  const sourceAt = Math.max(
    newestMtime(path.join(repoRoot, "core", "src")),
    newestMtime(path.join(repoRoot, "core", "bindings", "wasm", "src")),
    statSync(path.join(repoRoot, "core", "Cargo.toml")).mtimeMs,
    statSync(path.join(repoRoot, "core", "bindings", "wasm", "Cargo.toml")).mtimeMs,
  );
  return sourceAt > builtAt;
}

function wasmBindgenVersion() {
  try {
    return execFileSync("wasm-bindgen", ["--version"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    }).trim();
  } catch {
    return null;
  }
}

const lock = readFileSync(path.join(repoRoot, "Cargo.lock"), "utf8");
const lockMatch = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock);
const expectedCli = lockMatch?.[1] ?? null;
const actualCli = wasmBindgenVersion();

if (!actualCli) {
  console.error(
    [
      "wasm-bindgen CLI not found on PATH.",
      "",
      `Install the version that matches Cargo.lock (${expectedCli ?? "unknown"}):`,
      `  cargo install wasm-bindgen-cli --version ${expectedCli ?? "0.2.x"} --locked`,
    ].join("\n"),
  );
  process.exit(1);
}

if (expectedCli && !actualCli.includes(expectedCli)) {
  console.error(
    [
      `wasm-bindgen CLI mismatch: Cargo.lock pins ${expectedCli}, CLI reports ${actualCli}.`,
      "The generated glue and the compiled module must come from the same version.",
      "",
      `  cargo install wasm-bindgen-cli --version ${expectedCli} --locked --force`,
    ].join("\n"),
  );
  process.exit(1);
}

if (!force && !isStale()) {
  console.log(`wasm: up to date (${outName}_bg.wasm) — skipping rebuild.`);
  process.exit(0);
}

console.log(`wasm: building quizradar-wasm (${profile}) for ${target}…`);
run("cargo", [
  "build",
  "-p",
  "quizradar-wasm",
  "--target",
  target,
  ...(release ? ["--release"] : []),
]);

if (!existsSync(artifact)) {
  console.error(`wasm: expected artifact missing at ${artifact}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
console.log("wasm: generating bindings…");
run("wasm-bindgen", ["--target", "web", "--out-dir", outDir, "--out-name", outName, artifact]);

// wasm-pack normally writes this manifest; the bridge imports the glue as an
// ES module, so the package must declare `type: module` for Node/Vite to
// treat `quizradar_wasm.js` as ESM rather than CommonJS.
const version = JSON.parse(
  readFileSync(path.join(repoRoot, "tooling", "version.json"), "utf8"),
).version;
writeFileSync(
  path.join(outDir, "package.json"),
  `${JSON.stringify(
    {
      name: "quizradar-wasm",
      type: "module",
      version,
      license: "MIT",
      files: [`${outName}_bg.wasm`, `${outName}.js`, `${outName}.d.ts`],
      main: `${outName}.js`,
      types: `${outName}.d.ts`,
      sideEffects: ["./snippets/*"],
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const bytes = statSync(path.join(outDir, `${outName}_bg.wasm`)).size;
console.log(
  `wasm: done → apps/web/public/wasm/${outName}_bg.wasm (${(bytes / 1024).toFixed(1)} KiB)`,
);
