/**
 * Shared zero-dependency utilities for QuizRadar's multi-agent coordination,
 * conflict-free handoff fragments (`changes/*.md`), SemVer bumping, and git gates.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const VALID_BUMPS = ["none", "patch", "minor", "major"];
export const BUMP_RANK = { none: 0, patch: 1, minor: 2, major: 3 };

export const VALID_SURFACES = ["core", "web", "desktop", "android", "tooling", "docs", "ci"];

export const CONVENTIONAL_TYPES = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "test",
  "docs",
  "chore",
  "ci",
  "build",
  "style",
  "revert",
  "phase",
];

const IGNORED_CHANGE_FILES = new Set(["README.md", "_TEMPLATE.md"]);

/**
 * Parse `--flag value` and `--boolean-flag` CLI arguments.
 */
export function parseCliArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const eqIdx = token.indexOf("=");
    if (eqIdx !== -1) {
      flags[token.slice(2, eqIdx)] = token.slice(eqIdx + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { flags, positionals };
}

/**
 * Execute git safely via `execFileSync` (never invokes a shell).
 */
export function runGit(repoRoot, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    if (allowFailure) return null;
    const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";
    throw new Error(`git ${args.join(" ")} failed: ${stderr.trim() || err.message}`);
  }
}

/**
 * Parse a SemVer string `MAJOR.MINOR.PATCH[-prerelease]`.
 */
export function parseSemver(raw) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    String(raw).trim(),
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    version: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ""}`,
  };
}

/**
 * Compare two SemVer objects/strings per SemVer 2.0 precedence.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareSemver(aInput, bInput) {
  const a = typeof aInput === "string" ? parseSemver(aInput) : aInput;
  const b = typeof bInput === "string" ? parseSemver(bInput) : bInput;
  if (!a || !b) throw new Error(`Invalid semver comparison: ${JSON.stringify([aInput, bInput])}`);
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  if (a.prerelease === b.prerelease) return 0;
  // A pre-release version has lower precedence than the normal version.
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  return a.prerelease.localeCompare(b.prerelease);
}

/**
 * Increment a SemVer string by `patch`, `minor`, or `major`.
 * `none` returns the normalized current version unchanged.
 */
export function bumpSemver(currentRaw, bump) {
  const parsed = parseSemver(currentRaw);
  if (!parsed) {
    throw new Error(`Invalid current SemVer "${currentRaw}"`);
  }
  if (!VALID_BUMPS.includes(bump)) {
    throw new Error(`Invalid bump level "${bump}" (expected ${VALID_BUMPS.join("|")})`);
  }
  if (bump === "none") return parsed.version;
  // If bumping out of a pre-release (e.g. 5.0.0-alpha.1 + patch -> 5.0.0), drop prerelease on patch
  if (parsed.prerelease && bump === "patch") {
    return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  }
  if (bump === "major") return `${parsed.major + 1}.0.0`;
  if (bump === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

export function maxBump(a = "none", b = "none") {
  return (BUMP_RANK[a] ?? 0) >= (BUMP_RANK[b] ?? 0) ? a : b;
}

/**
 * Sanitize a git branch name or free-form label into a safe filename slug.
 */
export function toSafeSlug(raw) {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

/**
 * Map a repo-relative file path to its QuizRadar architecture surface.
 */
export function surfaceForPath(relPath) {
  const p = relPath.replace(/\\/g, "/");
  if (p.startsWith("core/")) return "core";
  if (p.startsWith("apps/web/")) return "web";
  if (p.startsWith("apps/desktop/")) return "desktop";
  if (p.startsWith("apps/mobile-android/")) return "android";
  if (p.startsWith(".github/")) return "ci";
  if (p.startsWith("tooling/")) return "tooling";
  if (p.startsWith("docs/") || p.startsWith("changes/") || p.endsWith(".md")) {
    return "docs";
  }
  return "tooling";
}

/**
 * Derive unique ordered surfaces from a list of modified paths.
 */
export function inferSurfacesFromPaths(paths) {
  const seen = new Set();
  for (const p of paths) {
    if (!p) continue;
    seen.add(surfaceForPath(p));
  }
  return VALID_SURFACES.filter((s) => seen.has(s));
}

/**
 * Parse a `changes/<slug>.md` fragment with simple YAML-subset frontmatter.
 */
export function parseFragment(rawContent, fileName = "unknown.md") {
  const normalized = rawContent.replace(/\r\n/g, "\n");
  const fmMatch = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!fmMatch) {
    return {
      fileName,
      slug: fileName.replace(/\.md$/i, ""),
      valid: false,
      errors: ["Missing YAML frontmatter block (`--- ... ---`) at top of file."],
      bump: null,
      surfaces: [],
      agent: "unknown",
      branch: "",
      date: "",
      summary: "",
      verification: "",
      handoff: "",
      body: normalized.trim(),
    };
  }

  const [, fmText, bodyRaw] = fmMatch;
  const meta = {};
  for (const line of fmText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const val = trimmed.slice(colon + 1).trim();
    meta[key] = val;
  }

  const parseList = (rawVal) => {
    if (!rawVal) return [];
    const inner = rawVal.replace(/^\[|\]$/g, "");
    return inner
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  };

  const unquote = (v) => (v ? v.replace(/^["']|["']$/g, "").trim() : "");

  const bump = unquote(meta.bump).toLowerCase();
  const surfaces = parseList(meta.surfaces).map((s) => s.toLowerCase());
  const agent = unquote(meta.agent) || "unspecified";
  const branch = unquote(meta.branch) || "";
  const date = unquote(meta.date) || "";

  // Extract markdown sections (`### Summary`, `### Verification`, `### Handoff...`)
  const sections = {};
  let currentHeading = "preamble";
  sections[currentHeading] = [];
  for (const line of bodyRaw.split("\n")) {
    const headingMatch = /^#{2,3}\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      const title = headingMatch[1].toLowerCase();
      if (title.startsWith("summary")) currentHeading = "summary";
      else if (title.startsWith("verif")) currentHeading = "verification";
      else if (title.startsWith("handoff") || title.startsWith("follow"))
        currentHeading = "handoff";
      else currentHeading = title;
      sections[currentHeading] = sections[currentHeading] ?? [];
      continue;
    }
    sections[currentHeading].push(line);
  }

  const cleanSection = (key) => (sections[key] ?? []).join("\n").trim();
  const summary = cleanSection("summary") || cleanSection("preamble");
  const verification = cleanSection("verification");
  const handoff = cleanSection("handoff");

  const errors = [];
  if (!VALID_BUMPS.includes(bump)) {
    errors.push(
      `Invalid or missing \`bump: ${meta.bump ?? ""}\` (expected one of: ${VALID_BUMPS.join(", ")}).`,
    );
  }
  if (surfaces.length === 0) {
    errors.push(
      `Missing \`surfaces: [...]\` (expected one or more of: ${VALID_SURFACES.join(", ")}).`,
    );
  } else {
    const unknown = surfaces.filter((s) => !VALID_SURFACES.includes(s));
    if (unknown.length > 0) {
      errors.push(
        `Unknown surface(s): ${unknown.join(", ")} (valid: ${VALID_SURFACES.join(", ")}).`,
      );
    }
  }
  if (!summary || summary.length < 8) {
    errors.push("`### Summary` must describe what changed (at least 8 characters).");
  }
  if (/\bTODO\b|<describe|fill in/i.test(summary)) {
    errors.push("`### Summary` still contains placeholder text (`TODO` / template copy).");
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push(`Invalid \`date: ${date}\` (expected YYYY-MM-DD).`);
  }

  return {
    fileName,
    slug: fileName.replace(/\.md$/i, ""),
    valid: errors.length === 0,
    errors,
    bump,
    surfaces,
    agent,
    branch,
    date,
    summary,
    verification,
    handoff,
    body: bodyRaw.trim(),
  };
}

/**
 * Serialize a fragment object into canonical Markdown (`changes/<slug>.md`).
 */
export function serializeFragment({
  bump = "patch",
  surfaces = ["tooling"],
  agent = "agent",
  branch = "",
  date = new Date().toISOString().slice(0, 10),
  summary = "",
  verification = "",
  handoff = "",
}) {
  const lines = [
    "---",
    `bump: ${bump}`,
    `surfaces: [${surfaces.join(", ")}]`,
    `agent: ${agent}`,
    `branch: ${branch}`,
    `date: ${date}`,
    "---",
    "",
    "### Summary",
    "",
    summary.trim(),
    "",
    "### Verification",
    "",
    verification.trim() || "- Not yet recorded.",
    "",
    "### Handoff / Follow-ups",
    "",
    handoff.trim() || "- None.",
    "",
  ];
  return lines.join("\n");
}

/**
 * Read and parse all active change fragments in `<repoRoot>/changes/*.md`.
 */
export function listFragments(repoRoot) {
  const dir = path.join(repoRoot, "changes");
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md") && !IGNORED_CHANGE_FILES.has(d.name))
    .map((d) => d.name)
    .sort();

  return entries.map((name) => {
    const fullPath = path.join(dir, name);
    const parsed = parseFragment(readFileSync(fullPath, "utf8"), name);
    return { ...parsed, path: fullPath };
  });
}

/**
 * Validate a Conventional Commit subject line.
 */
export function validateConventionalCommit(rawMessage) {
  const firstLine = String(rawMessage).replace(/\r\n/g, "\n").split("\n")[0].trim();
  if (!firstLine) {
    return { ok: false, reason: "Commit message is empty." };
  }
  if (/^(Merge |Revert "|fixup! |squash! )/.test(firstLine)) {
    return { ok: true, type: "merge", breaking: false, subject: firstLine };
  }
  const re = new RegExp(
    `^(${CONVENTIONAL_TYPES.join("|")})(\\([a-zA-Z0-9._/-]+\\))?(!)?:\\s+(.+)$`,
  );
  const match = re.exec(firstLine);
  if (!match) {
    return {
      ok: false,
      reason: `Subject "${firstLine}" must follow Conventional Commits: <type>(optional-scope): <description> (types: ${CONVENTIONAL_TYPES.join(", ")}).`,
    };
  }
  const [, type, scopeRaw, bang, description] = match;
  if (description.trim().length < 3) {
    return { ok: false, reason: "Commit description after `:` must be at least 3 characters." };
  }
  if (firstLine.length > 140) {
    return {
      ok: false,
      reason: `Commit subject is ${firstLine.length} chars (keep <= 140 chars; put details in body or changes/<slug>.md).`,
    };
  }
  const breaking = Boolean(bang) || /\nBREAKING CHANGE:/i.test(String(rawMessage));
  return {
    ok: true,
    type,
    scope: scopeRaw ? scopeRaw.slice(1, -1) : null,
    breaking,
    description: description.trim(),
    subject: firstLine,
  };
}

/**
 * Infer the highest SemVer bump implied by a list of commit `{ subject, body }` items.
 * Auto-generated `chore(release):` commits are ignored.
 */
export function classifyCommitsBump(commits) {
  let bump = "none";
  for (const c of commits) {
    const full = `${c.subject}\n${c.body ?? ""}`;
    if (/^chore\(release\):/i.test(c.subject.trim())) continue;
    const parsed = validateConventionalCommit(full);
    if (!parsed.ok) continue;
    if (parsed.breaking) {
      bump = maxBump(bump, "major");
    } else if (parsed.type === "feat") {
      bump = maxBump(bump, "minor");
    } else if (parsed.type === "fix" || parsed.type === "perf" || parsed.type === "revert") {
      bump = maxBump(bump, "patch");
    }
  }
  return bump;
}

/**
 * Find the highest ancestor SemVer tag `vMAJOR.MINOR.PATCH` strictly less than
 * `targetVersion` (or <= if `inclusive` is true).
 */
export function findPreviousSemverTag(
  repoRoot,
  targetVersion,
  { toRef = "HEAD", inclusive = false } = {},
) {
  const mergedTagsRaw = runGit(repoRoot, ["tag", "--merged", toRef, "--list", "v*"], {
    allowFailure: true,
  });
  if (!mergedTagsRaw) return null;

  const target = parseSemver(targetVersion);
  const candidates = mergedTagsRaw
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((tag) => ({ tag, semver: parseSemver(tag) }))
    .filter((entry) => entry.semver !== null)
    .filter((entry) => {
      if (!target) return true;
      const cmp = compareSemver(entry.semver, target);
      return inclusive ? cmp <= 0 : cmp < 0;
    });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => compareSemver(b.semver, a.semver));
  return candidates[0].tag;
}
