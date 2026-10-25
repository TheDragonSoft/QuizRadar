#!/usr/bin/env node
/**
 * Generates `latest.json` for Tauri 2 `tauri-plugin-updater`.
 *
 * Usage:
 *   node tooling/generate-updater-manifest.mjs \
 *     --artifacts-dir <dir> \
 *     --tag <tag> \
 *     --version <version> \
 *     [--repo <owner/repo>] \
 *     [--notes <notes>] \
 *     [--output <output-path>] \
 *     [--dry-run]
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArgs(args) {
  const result = {
    artifactsDir: "dist",
    tag: "",
    version: "",
    repo: "TheDragonSoft/QuizRadar",
    notes: "",
    output: "",
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--artifacts-dir" && i + 1 < args.length) {
      result.artifactsDir = args[++i];
    } else if (arg === "--tag" && i + 1 < args.length) {
      result.tag = args[++i];
    } else if (arg === "--version" && i + 1 < args.length) {
      result.version = args[++i];
    } else if (arg === "--repo" && i + 1 < args.length) {
      result.repo = args[++i];
    } else if (arg === "--notes" && i + 1 < args.length) {
      result.notes = args[++i];
    } else if (arg === "--output" && i + 1 < args.length) {
      result.output = args[++i];
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    }
  }

  if (!result.version && result.tag) {
    result.version = result.tag.replace(/^v/, "");
  }
  if (!result.tag && result.version) {
    result.tag = `v${result.version}`;
  }
  if (!result.output) {
    result.output = path.join(result.artifactsDir, "latest.json");
  }

  return result;
}

const config = parseArgs(process.argv.slice(2));

if (!config.version) {
  console.error("Error: --version or --tag is required.");
  process.exit(1);
}

const platforms = {};

let files = [];
try {
  files = readdirSync(config.artifactsDir);
} catch {
  if (!config.dryRun) {
    console.warn(`Artifacts directory "${config.artifactsDir}" does not exist.`);
  }
}

// Search for signatures and corresponding archives
for (const file of files) {
  if (!file.endsWith(".sig")) continue;

  const archiveName = file.slice(0, -4);
  if (!files.includes(archiveName)) continue;

  const sigPath = path.join(config.artifactsDir, file);
  const signature = readFileSync(sigPath, "utf8").trim();
  const url = `https://github.com/${config.repo}/releases/download/${config.tag}/${archiveName}`;

  if (
    archiveName.includes("x64") &&
    (archiveName.includes("windows") ||
      archiveName.endsWith(".nsis.zip") ||
      archiveName.endsWith(".msi.zip"))
  ) {
    platforms["windows-x86_64"] = { signature, url };
  } else if (
    archiveName.includes("darwin") ||
    archiveName.includes("macos") ||
    archiveName.endsWith(".app.tar.gz")
  ) {
    if (archiveName.includes("aarch64") || archiveName.includes("arm64")) {
      platforms["darwin-aarch64"] = { signature, url };
    } else {
      platforms["darwin-x86_64"] = { signature, url };
    }
  } else if (archiveName.includes("linux") || archiveName.endsWith(".AppImage.tar.gz")) {
    if (archiveName.includes("aarch64") || archiveName.includes("arm64")) {
      platforms["linux-aarch64"] = { signature, url };
    } else {
      platforms["linux-x86_64"] = { signature, url };
    }
  }
}

if (Object.keys(platforms).length === 0 && config.dryRun) {
  platforms["windows-x86_64"] = {
    signature: "dW50cnVzdGVkIGNvbW1lbnQ6IGRyeS1ydW4gc2lnbmF0dXJl",
    url: `https://github.com/${config.repo}/releases/download/${config.tag}/QuizRadar_${config.version}_x64-setup.nsis.zip`,
  };
}

const manifest = {
  version: config.version,
  notes: config.notes || `QuizRadar ${config.tag} release`,
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(config.output, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `Generated updater manifest ${config.output} with ${Object.keys(platforms).length} platform target(s).`,
);
