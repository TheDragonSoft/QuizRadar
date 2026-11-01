#!/usr/bin/env node
/**
 * Cross-build the Rust core for the Android ABIs the app ships, and stage the
 * resulting shared libraries where the Android Gradle plugin picks them up
 * (`apps/mobile-android/app/src/main/jniLibs/<abi>/`).
 *
 * WHY THIS EXISTS
 * ---------------
 * The app is a thin Kotlin shell around the Rust core (UniFFI). Without
 * `libquizradar_core.so` inside the APK the app cannot even start: the first
 * native call throws `UnsatisfiedLinkError`. The Gradle task that builds the
 * library used to exist but was never wired into the packaging, so both CI and
 * the release workflow happily produced an APK/AAB with no native core at all.
 * This script is the single, cross-platform place that builds it, and the
 * Gradle task calls it before the jniLibs are merged - a missing library is a
 * loud build failure now, never a silent broken release.
 *
 * USAGE
 * -----
 *   node tooling/build-android-libs.mjs              # release profile (what ships)
 *   node tooling/build-android-libs.mjs --debug      # debug profile (faster builds)
 *   node tooling/build-android-libs.mjs --abi arm64-v8a
 *
 * The Android NDK is located from (in order):
 *   1. $ANDROID_NDK_HOME / $ANDROID_NDK_ROOT / $ANDROID_NDK
 *   2. `ndk.dir` in apps/mobile-android/local.properties
 *   3. the newest NDK under the Android SDK (`$ANDROID_HOME` / `$ANDROID_SDK_ROOT`
 *      / the per-OS default SDK location).
 *
 * The Rust targets must be installed (`rustup target add aarch64-linux-android
 * x86_64-linux-android`).
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(repoRoot, "apps/mobile-android/app/src/main/jniLibs");
const isWindows = process.platform === "win32";

/**
 * ABI -> Rust target triple + NDK clang triple.
 *
 * The two differ: the Android ABI is named `arm64-v8a`, but both the Rust
 * target and the NDK compiler use `aarch64-linux-android`.
 */
const ABI_TARGETS = {
  "arm64-v8a": { rust: "aarch64-linux-android", clang: "aarch64-linux-android" },
  x86_64: { rust: "x86_64-linux-android", clang: "x86_64-linux-android" },
};

const args = process.argv.slice(2);
const debug = args.includes("--debug");
const profile = debug ? "debug" : "release";
const abiFilter = args.includes("--abi") ? args[args.indexOf("--abi") + 1] : null;
const abis = abiFilter ? [abiFilter] : Object.keys(ABI_TARGETS);

/**
 * Finds an NDK tool, tolerating the Windows executable extensions.
 *
 * On Windows the NDK ships `llvm-ar.exe` and `*-clang.cmd` batch wrappers;
 * on Linux/macOS the same tools are extensionless binaries. The extensionless
 * `*-clang` file on Windows is a bash script and cannot be executed there.
 */
function findTool(bin, name) {
  const candidates = isWindows ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const candidate of candidates) {
    const full = path.join(bin, candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

/** Candidate NDK roots, most specific first. */
function ndkCandidates() {
  const out = [];
  for (const key of ["ANDROID_NDK_HOME", "ANDROID_NDK_ROOT", "ANDROID_NDK"]) {
    if (process.env[key]) out.push(process.env[key]);
  }
  const localProps = path.join(repoRoot, "apps/mobile-android/local.properties");
  if (existsSync(localProps)) {
    const match = readFileSync(localProps, "utf8").match(/^ndk\.dir\s*=\s*(.+)$/m);
    if (match) out.push(match[1].trim().replace(/\\\\/g, "\\"));
  }
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), "Library/Android/sdk"),
    path.join(os.homedir(), "AppData/Local/Android/Sdk"),
    path.join(os.homedir(), "Android/Sdk"),
  ].filter(Boolean);
  for (const sdk of sdkRoots) {
    const ndkDir = path.join(sdk, "ndk");
    if (!existsSync(ndkDir)) continue;
    const versions = readdirSync(ndkDir)
      .filter((v) => statSync(path.join(ndkDir, v)).isDirectory())
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const v of versions.reverse()) out.push(path.join(ndkDir, v));
  }
  return out;
}

/** The host toolchain bin directory inside an NDK root (if it holds a toolchain). */
function ndkBin(root) {
  const prebuilt = path.join(root, "toolchains", "llvm", "prebuilt");
  if (!existsSync(prebuilt)) return null;
  for (const host of readdirSync(prebuilt)) {
    const bin = path.join(prebuilt, host, "bin");
    if (findTool(bin, "llvm-ar")) return bin;
  }
  return null;
}

function resolveNdk() {
  for (const candidate of ndkCandidates()) {
    if (!candidate) continue;
    const bin = ndkBin(candidate);
    if (bin) return { root: candidate, bin };
  }
  return null;
}

function run(cmd, cmdArgs, env) {
  execFileSync(cmd, cmdArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

const ndk = resolveNdk();
if (!ndk) {
  console.error(
    [
      "Android NDK not found.",
      "",
      "Install it (Android Studio -> SDK Manager -> SDK Tools -> NDK (Side by side)),",
      "then point one of these at it:",
      "  ANDROID_NDK_HOME / ANDROID_NDK_ROOT / ANDROID_NDK",
      "  or `ndk.dir` in apps/mobile-android/local.properties",
      "",
      `The build needs NDK 27.x for the ${abis.join(", ")} target(s).`,
    ].join("\n"),
  );
  process.exit(1);
}

const llvmAr = findTool(ndk.bin, "llvm-ar");
if (!llvmAr) {
  console.error(`NDK archiver missing in ${ndk.bin}`);
  process.exit(1);
}
// The debug symbols are dead weight in a shipped APK, and the release-profile
// library is still ~8 MB before stripping. Stripping here keeps the artifact
// deterministic no matter which NDK AGP happens to find for its own strip task.
const llvmStrip = findTool(ndk.bin, "llvm-strip");

console.log(`NDK: ${ndk.root}`);
console.log(`profile: ${profile}; ABIs: ${abis.join(", ")}`);

for (const abi of abis) {
  const spec = ABI_TARGETS[abi];
  if (!spec) {
    console.error(`Unknown ABI "${abi}" (known: ${Object.keys(ABI_TARGETS).join(", ")})`);
    process.exit(1);
  }
  const { rust: target, clang: clangTriple } = spec;
  const clang = findTool(ndk.bin, `${clangTriple}21-clang`);
  if (!clang) {
    console.error(
      `NDK compiler missing for ${abi}: ${path.join(ndk.bin, `${clangTriple}21-clang`)}`,
    );
    process.exit(1);
  }

  const envKey = target.replace(/-/g, "_");
  const env = {
    [`CC_${envKey}`]: clang,
    [`AR_${envKey}`]: llvmAr,
    [`CARGO_TARGET_${envKey.toUpperCase()}_LINKER`]: clang,
  };

  const cargoArgs = ["build", "-p", "quizradar-core", "--features", "uniffi", "--target", target];
  if (!debug) cargoArgs.push("--release");
  console.log(`\n--- cargo build ${target} (${profile}) ---`);
  run("cargo", cargoArgs, env);

  const built = path.join(repoRoot, "target", target, profile, "libquizradar_core.so");
  if (!existsSync(built)) {
    console.error(`Expected artifact missing: ${built}`);
    process.exit(1);
  }
  const destDir = path.join(outRoot, abi);
  mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, "libquizradar_core.so");
  copyFileSync(built, dest);
  if (llvmStrip) {
    run(llvmStrip, ["--strip-unneeded", dest], {});
  }
  const kb = (statSync(dest).size / 1024).toFixed(1);
  console.log(`staged ${path.relative(repoRoot, dest)} (${kb} KiB)`);
}

// Fail loudly if a requested ABI did not land - a half-staged APK would ship
// an app that only starts on some devices.
const missing = [];
for (const abi of abis) {
  const so = path.join(outRoot, abi, "libquizradar_core.so");
  if (!existsSync(so)) missing.push(abi);
}
if (missing.length > 0) {
  console.error(`Native core missing for: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("\nAndroid native core staged for: " + abis.join(", "));
