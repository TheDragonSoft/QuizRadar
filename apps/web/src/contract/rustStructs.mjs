/**
 * Machine-derived view of the Rust core's wire contract.
 *
 * The web tier re-implements a thin mirror of the core's DTO semantics in
 * `src/state/types.ts`; this module is what keeps that mirror honest. It
 * reads the Rust sources — never the TypeScript — and extracts the field
 * names, wire names (serde `rename`), Rust types and enum labels that the
 * core actually puts on the wire.
 *
 * `regenerate.mjs` writes the result to `src/testdata/contract/rust-structs.json`
 * and the contract test re-derives it at run time, so a change in
 * `core/src/**` that nobody mirrored into TypeScript fails the suite instead
 * of silently shipping.
 *
 * The parser is deliberately small: it understands rustfmt's layout (one
 * field per line, blocks closed by a `}` in column 0) and nothing else. It
 * is not a Rust compiler — it only needs to be right about the structs the
 * IPC payload is built from.
 */

import { createHash } from "node:crypto";

/** `#[serde(rename = "…")]` on a field or enum variant. */
const RENAME_ATTR = /^#\[serde\([^)]*rename\s*=\s*"([^"]+)"[^)]*\)\]$/;
/** `#[serde(rename_all = "camelCase")]` on a struct or enum. */
const RENAME_ALL_ATTR = /^#\[serde\(rename_all\s*=\s*"([^"]+)"[^)]*\)\]$/;
/** `pub name: Type,` inside a struct body. */
const FIELD_LINE = /^pub(?:\([^)]*\))?\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?),?\s*$/;
/** `Variant,` / `Variant(String),` inside an enum body. */
const VARIANT_LINE = /^([A-Z][A-Za-z0-9_]*)(\s*\([^)]*\))?,?\s*$/;

/** `course_id` → `courseId` (serde's `rename_all = "camelCase"`). */
export function camelCase(name) {
  return name.replace(/_([a-z0-9])/g, (_match, chr) => chr.toUpperCase());
}

/** sha256 of a source file — used to detect "core changed, contract stale". */
export function hashSource(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Index of the line that closes the block opened at `startLine`. */
function findBlockEnd(lines, startLine) {
  for (let index = startLine + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "}") {
      return index;
    }
  }
  return -1;
}

/** Every string literal inside `text` (the arm labels of a `match`). */
export function stringLiterals(text) {
  const literals = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      let value = "";
      index += 1;
      while (index < text.length && text[index] !== '"') {
        if (text[index] === "\\") {
          index += 1;
          value += text[index] ?? "";
        } else {
          value += text[index];
        }
        index += 1;
      }
      literals.push(value);
    }
    index += 1;
  }
  return literals;
}

/** Body of a function, extracted by balanced braces (strings are skipped). */
export function functionBody(source, functionName) {
  const signature = new RegExp(`fn\\s+${functionName}\\s*\\(`);
  const match = signature.exec(source);
  if (!match) {
    return null;
  }
  const open = source.indexOf("{", match.index);
  if (open < 0) {
    return null;
  }
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      index += 1;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === "\\") {
          index += 1;
        }
        index += 1;
      }
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }
  return null;
}

/**
 * Every `pub struct` in `source`, keyed by struct name.
 *
 * Each field carries its Rust name, its wire name (serde `rename`, or the
 * struct's `rename_all`), the raw Rust type and whether the type is an
 * `Option<…>` (i.e. nullable on the wire).
 */
export function extractStructs(source, file) {
  const lines = source.split(/\r?\n/);
  const structs = {};

  for (let index = 0; index < lines.length; index += 1) {
    const declaration = /^\s*pub\s+struct\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[index]);
    if (!declaration) {
      continue;
    }
    const name = declaration[1];
    const end = findBlockEnd(lines, index);
    if (end < 0) {
      continue;
    }

    // A struct-level `#[serde(rename_all = "…")]` rewrites every wire name.
    let renameAll = null;
    for (let back = index - 1; back >= 0 && back >= index - 3; back -= 1) {
      const attribute = RENAME_ALL_ATTR.exec(lines[back].trim());
      if (attribute) {
        renameAll = attribute[1];
        break;
      }
    }

    const fields = [];
    let pendingRename = null;
    for (const line of lines.slice(index + 1, end)) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("//")) {
        continue;
      }
      const rename = RENAME_ATTR.exec(trimmed);
      if (rename) {
        pendingRename = rename[1];
        continue;
      }
      if (trimmed.startsWith("#[")) {
        continue;
      }
      const field = FIELD_LINE.exec(trimmed);
      if (!field) {
        continue;
      }
      const rustType = field[2].replace(/,\s*$/, "").trim();
      let wireName = pendingRename ?? field[1];
      if (!pendingRename && renameAll === "camelCase") {
        wireName = camelCase(field[1]);
      }
      fields.push({
        rustName: field[1],
        wireName,
        rustType,
        optional: /^Option</.test(rustType),
      });
      pendingRename = null;
    }

    structs[name] = { source: file, fields };
    index = end;
  }

  return structs;
}

/**
 * Every `pub enum` in `source`, keyed by enum name. A variant's wire name is
 * its serde `rename` when present, else the enum-level `rename_all` when
 * present (`lowercase` etc.), otherwise the variant name verbatim — which is
 * exactly serde's default enum representation.
 */
export function extractEnums(source, file) {
  const lines = source.split(/\r?\n/);
  const enums = {};

  for (let index = 0; index < lines.length; index += 1) {
    const declaration = /^\s*pub\s+enum\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[index]);
    if (!declaration) {
      continue;
    }
    const name = declaration[1];
    const end = findBlockEnd(lines, index);
    if (end < 0) {
      continue;
    }

    // serde `rename_all` on the enum: scan backwards over attributes/doc
    // comments from the declaration, same as the struct path.
    let enumRenameAll = null;
    for (let back = index - 1; back >= 0; back -= 1) {
      const trimmed = lines[back].trim();
      if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("#[")) {
        const attribute = RENAME_ALL_ATTR.exec(trimmed);
        if (attribute) {
          enumRenameAll = attribute[1];
          break;
        }
        continue;
      }
      break;
    }

    const variants = [];
    let pendingRename = null;
    for (const line of lines.slice(index + 1, end)) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("//")) {
        continue;
      }
      const rename = RENAME_ATTR.exec(trimmed);
      if (rename) {
        pendingRename = rename[1];
        continue;
      }
      if (trimmed.startsWith("#[")) {
        continue;
      }
      const variant = VARIANT_LINE.exec(trimmed);
      if (!variant) {
        continue;
      }
      let wireName = pendingRename ?? variant[1];
      if (!pendingRename && enumRenameAll === "lowercase") {
        wireName = wireName.toLowerCase();
      }
      variants.push({ name: variant[1], wireName });
      pendingRename = null;
    }

    enums[name] = { source: file, variants };
    index = end;
  }

  return enums;
}

/** Index of the `)` that closes the `(` at `openIndex`, or -1. */
export function matchingParen(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** The text of `impl <Type> { … }`, or `null` when there is no such block. */ export function implBlock(
  source,
  implType,
) {
  const pattern = new RegExp(`impl\\s+${implType}\\s*(<[^>]*>)?\\s*\\{`);
  const match = pattern.exec(source);
  if (!match) {
    return null;
  }
  const open = source.indexOf("{", match.index);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      index += 1;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === "\\") {
          index += 1;
        }
        index += 1;
      }
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }
  return null;
}

/**
 * The labels a hand-written `Serialize`/`as_str` implementation emits —
 * e.g. `AssessmentSource::as_str` returns `"Gmail"`, `"Microsoft Teams"`, …
 * These are the labels that actually reach the wire, not the variant names.
 *
 * `implType` scopes the lookup to one `impl` block: `types.rs` has an
 * `as_str` on both `AssessmentType` and `AssessmentSource`.
 */
export function extractMatchLabels(source, functionName, implType) {
  const scope = implType ? implBlock(source, implType) : source;
  if (scope === null) {
    return [];
  }
  const body = functionBody(scope, functionName);
  if (body === null) {
    return [];
  }
  return stringLiterals(body);
}

/** Files whose `pub struct` declarations make up the IPC payload. */
export const STRUCT_SOURCES = [
  "core/src/types.rs",
  "core/src/plan/dashboard.rs",
  "core/src/plan/tasks.rs",
  "core/src/plan/conflicts.rs",
  "apps/desktop/src-tauri/src/commands/state.rs",
];

/** Files whose `pub enum` declarations make up the wire enums. */
export const ENUM_SOURCES = ["core/src/types.rs", "core/src/plan/conflicts.rs"];

/**
 * Hand-written `as_str` / label helpers — these decide what actually
 * reaches the wire for the enums that serialize themselves.
 */
export const LABEL_SOURCES = [
  {
    file: "core/src/types.rs",
    function: "as_str",
    impl: "AssessmentType",
    label: "AssessmentType",
  },
  {
    file: "core/src/types.rs",
    function: "as_str",
    impl: "AssessmentSource",
    label: "AssessmentSource",
  },
  { file: "core/src/store/repo.rs", function: "urgency_label", label: "UrgencyLevelStored" },
];

/** The UniFFI surface of the core. */
export const FFI_SOURCE = "core/src/ffi.rs";

/**
 * Build the whole contract map from the Rust sources.
 *
 * `readFile` is injected so the caller decides where the repository lives;
 * the contract test re-uses this to prove the committed JSON still matches
 * the Rust sources.
 */
export function buildContract(readFile) {
  const sourceHashes = {};
  const structs = {};
  const enums = {};
  const enumLabels = {};

  const read = (file) => {
    const source = readFile(file);
    sourceHashes[file] = hashSource(source);
    return source;
  };

  for (const file of STRUCT_SOURCES) {
    Object.assign(structs, extractStructs(read(file), file));
  }
  for (const file of ENUM_SOURCES) {
    Object.assign(enums, extractEnums(read(file), file));
  }
  for (const entry of LABEL_SOURCES) {
    const source = readFile(entry.file);
    sourceHashes[entry.file] = hashSource(source);
    enumLabels[entry.label] = extractMatchLabels(source, entry.function, entry.impl);
  }

  const ffiExports = extractFfiExports(read(FFI_SOURCE));

  return {
    generatedBy: "apps/web/src/contract/regenerate.mjs",
    note: "Machine-derived from the Rust sources. Do not edit by hand.",
    sourceFiles: Object.keys(sourceHashes).sort(),
    sourceHashes,
    structs,
    enums,
    enumLabels,
    ffiExports,
  };
}

/**
 * The `#[uniffi::export]` functions of `core/src/ffi.rs` with their
 * parameter list and return type — the Rust-side API surface the shells
 * bind to. Methods exported through `impl NativeStore { … }` are recorded
 * as `NativeStore.get_state` so both tiers are visible in one map.
 */
export function extractFfiExports(source) {
  const lines = source.split(/\r?\n/);
  const exports = {};

  const record = (name, lines, startLine) => {
    let returnType = "()";
    let buffer = "";
    let afterParams = false;
    for (let scan = startLine; scan < lines.length; scan += 1) {
      buffer += `${lines[scan]}\n`;
      const open = buffer.indexOf("(");
      if (open >= 0 && !afterParams && matchingParen(buffer, open) >= 0) {
        afterParams = true;
      }
      if (afterParams && buffer.includes("->")) {
        const arrow = buffer.indexOf("->");
        const tail = buffer.slice(arrow + 2);
        const terminator = tail.search(/[{;]/);
        returnType = (terminator < 0 ? tail : tail.slice(0, terminator)).trim();
        break;
      }
      if (afterParams && buffer.includes(";")) {
        break;
      }
    }
    const open = buffer.indexOf("(");
    const close = open >= 0 ? matchingParen(buffer, open) : -1;
    const parameters =
      close > open
        ? buffer
            .slice(open + 1, close)
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
        : [];

    exports[name] = { parameters, returns: returnType };
  };

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith("#[uniffi::export]")) {
      continue;
    }
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim() === "") {
      cursor += 1;
    }
    const signature = /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(
      lines[cursor],
    );
    if (signature) {
      record(signature[1], lines, cursor);
      continue;
    }
    // `#[uniffi::export] impl NativeStore { … }` — export every method.
    const implStart = /^\s*impl\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(lines[cursor]);
    if (!implStart) {
      continue;
    }
    const block = implBlock(lines.slice(cursor).join("\n"), implStart[1]);
    if (block === null) {
      continue;
    }
    const blockLines = block.split(/\r?\n/);
    for (let scan = 0; scan < blockLines.length; scan += 1) {
      const method = /^\s*pub\s+(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(
        blockLines[scan],
      );
      if (method) {
        record(`${implStart[1]}.${method[1]}`, blockLines, scan);
      }
    }
  }

  return exports;
}
