import { describe, expect, it } from "vitest";
import { validateAndroidArtifact } from "../lib/android-artifacts.mjs";
import { validateReleaseMetadata } from "../lib/release-metadata.mjs";

describe("android native-core artifact validation", () => {
  it("requires both supported ABIs in an APK", () => {
    const result = validateAndroidArtifact("apk", [
      "classes.dex",
      "lib/arm64-v8a/libquizradar_core.so",
      "lib/x86_64/libquizradar_core.so",
    ]);
    expect(result).toMatchObject({ valid: true, forbidden: [] });
    expect(result.required).toEqual([
      { abi: "arm64-v8a", present: true },
      { abi: "x86_64", present: true },
    ]);
  });

  it("rejects an APK with only one supported ABI", () => {
    const result = validateAndroidArtifact("apk", [
      "lib/arm64-v8a/libquizradar_core.so",
      "lib/x86/libjna.so",
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("missing lib/x86_64/libquizradar_core.so");
    expect(result.forbidden).toEqual(["x86"]);
  });

  it("validates AAB base-module paths independently", () => {
    const result = validateAndroidArtifact("aab", [
      "base/manifest/AndroidManifest.xml",
      "base/lib/arm64-v8a/libquizradar_core.so",
      "base/lib/x86_64/libquizradar_core.so",
    ]);
    expect(result.valid).toBe(true);
    expect(validateAndroidArtifact("aab", ["base/lib/arm64-v8a/libquizradar_core.so"]).valid).toBe(
      false,
    );
  });

  it("fails malformed and empty listings loudly", () => {
    expect(validateAndroidArtifact("apk", []).valid).toBe(false);
    expect(validateAndroidArtifact("aab", "not-an-array" as unknown as string[]).valid).toBe(false);
    expect(validateAndroidArtifact("zip", []).errors[0]).toContain("unknown artifact kind");
    expect(validateAndroidArtifact("apk", [42] as unknown as string[]).valid).toBe(false);
  });
});

describe("release tag/version validation", () => {
  it("accepts matching strict tags and derives prerelease status", () => {
    expect(validateReleaseMetadata({ tag: "v5.18.0", version: "5.18.0" })).toEqual({
      valid: true,
      prerelease: false,
      errors: [],
    });
    expect(
      validateReleaseMetadata({ tag: "v5.18.0-rc.1", version: "5.18.0-rc.1" }).prerelease,
    ).toBe(true);
    expect(
      validateReleaseMetadata({ tag: "v5.18.0-alpha.1", version: "5.18.0-alpha.1" }).prerelease,
    ).toBe(true);
  });

  it("rejects mismatched, non-SemVer, and missing metadata", () => {
    expect(validateReleaseMetadata({ tag: "v5.18.0", version: "5.19.0" }).valid).toBe(false);
    expect(validateReleaseMetadata({ tag: "release-5", version: "5.0.0" }).valid).toBe(false);
    expect(validateReleaseMetadata({ tag: "", version: "5.0.0" }).valid).toBe(false);
    expect(validateReleaseMetadata({ tag: "v5.0.0", version: "" }).valid).toBe(false);
  });
});
