#!/usr/bin/env node
/**
 * Create, update, list, or validate conflict-free agent handoff & version
 * fragments under `changes/<slug>.md`.
 *
 * Examples:
 *   pnpm agent:note --bump minor --surfaces core,web --agent antigravity \
 *     --summary "Add content-addressed topic keys" \
 *     --verify "cargo test --workspace; pnpm test" \
 *     --handoff "Android ViewModel still defaults academicTrack on direct derive"
 *
 *   pnpm agent:note --list
 *   pnpm agent:note --validate
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inferSurfacesFromPaths,
  listFragments,
  parseCliArgs,
  parseFragment,
  runGit,
  serializeFragment,
  toSafeSlug,
  VALID_BUMPS,
  VALID_SURFACES,
} from "./lib/agent-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const { flags } = parseCliArgs(process.argv.slice(2));
const repoRoot = flags.root
  ? path.resolve(process.cwd(), String(flags.root))
  : path.resolve(scriptDir, "..");

if (flags.help) {
  console.log(`Usage:
  node tooling/agent-note.mjs --bump <none|patch|minor|major> --summary "<text>" [options]
  node tooling/agent-note.mjs --list [--json]
  node tooling/agent-note.mjs --validate

Options:
  --bump <level>       SemVer impact: ${VALID_BUMPS.join(" | ")} (default: patch)
  --surfaces <list>    Comma-separated surfaces: ${VALID_SURFACES.join(", ")} (auto-detected if omitted)
  --agent <name>       Agent/author identifier (e.g. antigravity, claude, codex, jules, copilot, human)
  --slug <name>        Override output filename changes/<slug>.md (defaults to sanitized branch name)
  --branch <name>      Override recorded git branch name
  --date <YYYY-MM-DD>  Override recorded date
  --summary "<text>"   Concise description of what changed and why (used in CHANGELOG + handoffs)
  --verify "<text>"    Exact verification commands executed (honesty rule: never fabricate)
  --handoff "<text>"   Cross-agent follow-ups, caveats, or open items
  --root <dir>         Target repository root (used by sandbox tests)
`);
  process.exit(0);
}

if (flags.list) {
  const fragments = listFragments(repoRoot);
  if (flags.json) {
    console.log(JSON.stringify(fragments, null, 2));
    process.exit(0);
  }
  if (fragments.length === 0) {
    console.log("No pending change fragments in changes/*.md.");
    process.exit(0);
  }
  console.log(`Pending change fragments (${fragments.length}):`);
  for (const f of fragments) {
    const status = f.valid ? "OK" : `INVALID (${f.errors.join("; ")})`;
    console.log(
      `  - changes/${f.fileName} [${f.bump || "?"}] surfaces=[${f.surfaces.join(", ")}] agent=${f.agent} (${status})`,
    );
    if (f.summary) {
      console.log(`      ${f.summary.split("\n")[0]}`);
    }
  }
  process.exit(0);
}

if (flags.validate) {
  const fragments = listFragments(repoRoot);
  const invalid = fragments.filter((f) => !f.valid);
  if (invalid.length > 0) {
    console.error(`Invalid change fragment(s) found (${invalid.length}):`);
    for (const f of invalid) {
      console.error(`  - changes/${f.fileName}:`);
      for (const err of f.errors) console.error(`      * ${err}`);
    }
    process.exit(1);
  }
  console.log(
    `Validated ${fragments.length} change fragment(s) in changes/ — all structurally valid.`,
  );
  process.exit(0);
}

const currentBranch =
  (typeof flags.branch === "string" && flags.branch.trim()) ||
  runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true }) ||
  "detached";

const summary = typeof flags.summary === "string" ? flags.summary.trim() : "";
if (!summary) {
  console.error(
    'Missing required `--summary "<what changed and why>"` (or pass `--list` / `--validate` / `--help`).',
  );
  process.exit(1);
}

const bump = typeof flags.bump === "string" ? flags.bump.trim().toLowerCase() : "patch";
if (!VALID_BUMPS.includes(bump)) {
  console.error(`Invalid --bump "${bump}". Expected one of: ${VALID_BUMPS.join(", ")}.`);
  process.exit(1);
}

let surfaces = [];
if (typeof flags.surfaces === "string" && flags.surfaces.trim()) {
  surfaces = flags.surfaces
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
} else {
  const diffMain =
    runGit(repoRoot, ["diff", "--name-only", "main...HEAD"], { allowFailure: true }) ?? "";
  const statusPorcelain = runGit(repoRoot, ["status", "--porcelain"], { allowFailure: true }) ?? "";
  const statusFiles = statusPorcelain
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
  const inferred = inferSurfacesFromPaths([...diffMain.split("\n"), ...statusFiles]);
  surfaces = inferred.length > 0 ? inferred : ["tooling"];
}

const unknownSurfaces = surfaces.filter((s) => !VALID_SURFACES.includes(s));
if (unknownSurfaces.length > 0) {
  console.error(
    `Unknown surface(s): ${unknownSurfaces.join(", ")}. Expected: ${VALID_SURFACES.join(", ")}.`,
  );
  process.exit(1);
}

const date =
  typeof flags.date === "string" && flags.date.trim()
    ? flags.date.trim()
    : new Date().toISOString().slice(0, 10);

const rawSlugSource =
  typeof flags.slug === "string" && flags.slug.trim()
    ? flags.slug.trim()
    : currentBranch !== "main" &&
        currentBranch !== "master" &&
        currentBranch !== "HEAD" &&
        currentBranch !== "detached"
      ? currentBranch
      : `${date}-${summary.split(/\s+/).slice(0, 5).join("-")}`;

const slug = toSafeSlug(rawSlugSource);
if (!slug || slug === "readme" || slug === "template") {
  console.error(
    `Could not derive a valid filename slug from "${rawSlugSource}". Pass --slug <name>.`,
  );
  process.exit(1);
}

const formatBullets = (raw) => {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("-") || trimmed.startsWith("*")) return trimmed;
  return trimmed
    .split(/\s*;\s*|\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith("-") ? item : `- ${item}`))
    .join("\n");
};

const agent =
  typeof flags.agent === "string" && flags.agent.trim()
    ? flags.agent.trim()
    : process.env.AGENT_NAME || "ai-agent";

const content = serializeFragment({
  bump,
  surfaces,
  agent,
  branch: currentBranch,
  date,
  summary,
  verification: formatBullets(flags.verify),
  handoff: formatBullets(flags.handoff),
});

const checkParsed = parseFragment(content, `${slug}.md`);
if (!checkParsed.valid) {
  console.error(`Generated fragment failed validation:\n  - ${checkParsed.errors.join("\n  - ")}`);
  process.exit(1);
}

const outDir = path.join(repoRoot, "changes");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${slug}.md`);
writeFileSync(outFile, content, "utf8");

console.log(`Wrote agent handoff & version fragment: changes/${slug}.md`);
console.log(`  bump:     ${bump}`);
console.log(`  surfaces: ${surfaces.join(", ")}`);
console.log(`  agent:    ${agent}`);
console.log(`  branch:   ${currentBranch}`);
