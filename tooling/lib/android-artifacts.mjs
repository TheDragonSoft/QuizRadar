/**
 * Android native-core artifact validation.
 *
 * The old CI check used one regex across `lib/(arm64-v8a|x86_64)/…`, so an
 * APK containing either ABI passed. This module independently requires BOTH
 * supported ABIs and rejects any advertised ABI the Rust core is not built
 * for (a 32-bit device would crash with UnsatisfiedLinkError on first core
 * call). It is pure so `pnpm test:tooling` can cover APK, AAB, malformed and
 * partial listings without shipping binary fixtures.
 */

export const REQUIRED_ABIS = ["arm64-v8a", "x86_64"];
export const SUPPORTED_ABIS = new Set(REQUIRED_ABIS);
const CORE_LIBRARY_BASENAME = "libquizradar_core.so";

/** Accepts the `unzip -Z1` entries of an APK or AAB. */
export function validateAndroidArtifact(kind, entries) {
  const errors = [];
  if (kind !== "apk" && kind !== "aab") {
    return {
      valid: false,
      required: [],
      forbidden: [],
      errors: [`unknown artifact kind "${kind}" (expected apk or aab)`],
    };
  }
  if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
    return {
      valid: false,
      required: [],
      forbidden: [],
      errors: ["entries must be an array of strings"],
    };
  }

  const stripAabModule = (entry) =>
    kind === "aab" && entry.startsWith("base/") ? entry.slice("base/".length) : entry;
  const normalized = entries.map(stripAabModule);
  const coreEntries = new Set(
    normalized
      .filter((entry) => entry.endsWith(`/${CORE_LIBRARY_BASENAME}`))
      .map((entry) => entry.slice(0, -(CORE_LIBRARY_BASENAME.length + 1))),
  );

  const required = [];
  for (const abi of REQUIRED_ABIS) {
    const present = coreEntries.has(`lib/${abi}`);
    required.push({ abi, present });
    if (!present) errors.push(`${kind} is missing lib/${abi}/${CORE_LIBRARY_BASENAME}`);
  }

  const forbidden = [
    ...new Set(
      normalized
        .map((entry) => /^lib\/([^/]+)\/.+\.so$/.exec(entry)?.[1])
        .filter(Boolean)
        .filter((abi) => !SUPPORTED_ABIS.has(abi)),
    ),
  ];
  for (const abi of forbidden) {
    errors.push(
      `${kind} advertises unsupported native ABI lib/${abi}/ (the core is built only for ${REQUIRED_ABIS.join(", ")})`,
    );
  }

  return { valid: errors.length === 0, required, forbidden, errors };
}
