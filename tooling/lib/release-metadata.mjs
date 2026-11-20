/** Release tag/version validation shared by local dry-runs and CI. */
import { parseSemver } from "./agent-utils.mjs";

/**
 * Validates a release tag against the version the version-rollup stamped.
 * Any SemVer prerelease component (including `rc`, not just alpha/beta)
 * makes the release a prerelease.
 */
export function validateReleaseMetadata({ tag, version }) {
  const errors = [];
  if (typeof tag !== "string" || tag.trim() === "") errors.push("release tag is missing");
  if (typeof version !== "string" || version.trim() === "")
    errors.push("release version is missing");
  if (errors.length > 0) return { valid: false, prerelease: false, errors };

  const parsed = parseSemver(tag);
  if (!parsed) {
    errors.push(`release tag "${tag}" is not strict SemVer as vX.Y.Z[-prerelease]`);
    return { valid: false, prerelease: false, errors };
  }
  if (parsed.version !== version) {
    errors.push(`release tag ${tag} does not match stamped version ${version}`);
  }
  return { valid: errors.length === 0, prerelease: parsed.prerelease !== null, errors };
}
