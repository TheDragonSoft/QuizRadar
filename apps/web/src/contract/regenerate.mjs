/**
 * Regenerate `apps/web/src/testdata/contract/rust-structs.json` from the
 * Rust sources.
 *
 *   node apps/web/src/contract/regenerate.mjs          # write the file
 *   node apps/web/src/contract/regenerate.mjs --check  # fail if it is stale
 *
 * The Rust core is the source of truth for the wire format; this script is
 * the only thing that reads it. The contract test re-derives the same map
 * at run time and fails when the committed file or the Rust sources moved
 * without the TypeScript mirror being updated.
 *
 * See `README.md` in this folder for the full contract description.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import { buildContract } from "./rustStructs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const OUTPUT = join(REPO_ROOT, "apps", "web", "src", "testdata", "contract", "rust-structs.json");

function main() {
  const contract = buildContract((file) => readFileSync(join(REPO_ROOT, file), "utf8"));
  const serialized = `${JSON.stringify(contract, null, 2)}\n`;
  const checkOnly = process.argv.includes("--check");

  if (checkOnly) {
    let current = "";
    try {
      current = readFileSync(OUTPUT, "utf8");
    } catch {
      current = "";
    }
    if (current !== serialized) {
      process.stderr.write(
        `rust-structs.json is stale — run:\n  node ${relative(REPO_ROOT, join(HERE, "regenerate.mjs"))}\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write("rust-structs.json is up to date\n");
    return;
  }

  writeFileSync(OUTPUT, serialized, "utf8");
  const structCount = Object.keys(contract.structs).length;
  const enumCount = Object.keys(contract.enums).length;
  process.stdout.write(
    `wrote ${relative(REPO_ROOT, OUTPUT)} (${structCount} structs, ${enumCount} enums, ` +
      `${Object.keys(contract.ffiExports).length} ffi exports)\n`,
  );
}

main();
