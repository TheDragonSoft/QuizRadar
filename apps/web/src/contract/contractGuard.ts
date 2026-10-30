/**
 * The Rust wire-contract guard.
 *
 * `src/state/ipcShape.ts` adapts the core's snake_case payloads to the
 * camelCase view model — it deliberately does not validate them. This guard
 * is the validating half of the contract: it checks a payload against the
 * Rust structs it claims to be, using the machine-derived map in
 * `src/testdata/contract/rust-structs.json`.
 *
 * The rules mirror what serde actually does on the wire:
 * - a missing non-`Option` field is an error (serde would fail to
 *   deserialize it),
 * - `null` is only legal where Rust says `Option<…>`,
 * - an unknown enum label is an error for the closed enums,
 * - an unknown *field* is accepted with a warning — serde ignores fields it
 *   does not know, and so does this guard,
 * - a date/time that the core's own serde adapters would reject is an error
 *   (no fabricated dates, no half-parsed times).
 */

import {
  RUST_ASSESSMENT_SOURCE_LABELS,
  RUST_ASSESSMENT_TYPES,
  RUST_CONFLICT_SEVERITIES,
  RUST_CONTRACT,
  RUST_URGENCY_EMIT_LABELS,
  RUST_URGENCY_STORED_LABELS,
} from "./contractSpec";

export type GuardCode =
  | "missing-required-field"
  | "null-not-allowed"
  | "type-mismatch"
  | "not-an-integer"
  | "negative-unsigned"
  | "invalid-date"
  | "invalid-time"
  | "unknown-enum-value"
  | "non-canonical-enum-label"
  | "unknown-field"
  | "unknown-struct"
  | "unchecked-type";

export interface GuardIssue {
  /** Dotted path of the offending value (`assessments[0].priority_score`). */
  path: string;
  code: GuardCode;
  message: string;
  severity: "error" | "warning";
}

export interface GuardResult {
  ok: boolean;
  errors: GuardIssue[];
  warnings: GuardIssue[];
  issues: GuardIssue[];
}

type Kind =
  | { kind: "string" }
  | { kind: "integer"; unsigned: boolean }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "date" }
  | { kind: "time" }
  | { kind: "string[]" }
  | { kind: "object"; struct: string }
  | { kind: "object[]"; struct: string }
  | { kind: "count-map" }
  | { kind: "string-map" }
  | { kind: "enum"; values: string[]; aliases: string[]; open: boolean }
  | { kind: "unchecked"; rustType: string };

/** A wire kind plus the nullability its Rust type carries (`Option<…>`). */
type ResolvedKind = Kind & { nullable: boolean };

const INTEGER_TYPES = new Set(["u8", "u16", "u32", "u64", "usize"]);
const SIGNED_INTEGER_TYPES = new Set(["i8", "i16", "i32", "i64", "isize"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `2026-10-23` — and a real calendar day, not just a shape. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** `09:00` — the core always serializes `HH:MM`. */
export function isHmTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

/** Resolve a Rust type to the JSON shape it puts on the wire. */
export function resolveKind(rustType: string): ResolvedKind {
  const optional = /^Option<(.+)>$/.exec(rustType);
  if (optional) {
    return { ...resolveKind(optional[1]), nullable: true };
  }
  if (rustType === "String") {
    return { kind: "string", nullable: false };
  }
  if (rustType === "bool") {
    return { kind: "boolean", nullable: false };
  }
  if (INTEGER_TYPES.has(rustType)) {
    return { kind: "integer", unsigned: true, nullable: false };
  }
  if (SIGNED_INTEGER_TYPES.has(rustType)) {
    return { kind: "integer", unsigned: false, nullable: false };
  }
  if (rustType === "f32" || rustType === "f64") {
    return { kind: "number", nullable: false };
  }
  if (rustType === "NaiveDate") {
    return { kind: "date", nullable: false };
  }
  if (rustType === "NaiveTime") {
    return { kind: "time", nullable: false };
  }
  if (rustType === "Vec<String>") {
    return { kind: "string[]", nullable: false };
  }
  if (rustType.startsWith("Vec<")) {
    const inner = rustType.slice(4, -1);
    return { kind: "object[]", struct: inner, nullable: false };
  }
  if (rustType === "BTreeMap<String, usize>") {
    return { kind: "count-map", nullable: false };
  }
  if (rustType === "HashMap<String, String>") {
    return { kind: "string-map", nullable: false };
  }
  if (rustType === "AssessmentType") {
    return {
      kind: "enum",
      values: RUST_ASSESSMENT_TYPES,
      aliases: [],
      open: false,
      nullable: false,
    };
  }
  if (rustType === "UrgencyLevel") {
    return {
      kind: "enum",
      values: RUST_URGENCY_EMIT_LABELS,
      aliases: RUST_URGENCY_STORED_LABELS,
      open: false,
      nullable: false,
    };
  }
  if (rustType === "AssessmentSource") {
    return {
      kind: "enum",
      values: RUST_ASSESSMENT_SOURCE_LABELS,
      aliases: [],
      open: true,
      nullable: false,
    };
  }
  if (rustType === "ConflictSeverity") {
    return {
      kind: "enum",
      values: RUST_CONFLICT_SEVERITIES,
      aliases: [],
      open: false,
      nullable: false,
    };
  }
  if (RUST_CONTRACT.structs[rustType]) {
    return { kind: "object", struct: rustType, nullable: false };
  }
  return { kind: "unchecked", rustType, nullable: false };
}

function issue(
  path: string,
  code: GuardCode,
  message: string,
  severity: "error" | "warning",
): GuardIssue {
  return { path, code, message, severity };
}

/**
 * Validate one value against one Rust struct.
 *
 * `structName` is a key of `rust-structs.json` — e.g. `"Assessment"`.
 */
export function validateRustPayload(value: unknown, structName: string): GuardResult {
  const issues: GuardIssue[] = [];
  validateValue(value, structName, structName, issues);
  const errors = issues.filter((entry) => entry.severity === "error");
  const warnings = issues.filter((entry) => entry.severity === "warning");
  return { ok: errors.length === 0, errors, warnings, issues };
}

function validateValue(
  value: unknown,
  structName: string,
  path: string,
  issues: GuardIssue[],
): void {
  const structSpec = RUST_CONTRACT.structs[structName];
  if (!structSpec) {
    issues.push(issue(path, "unknown-struct", `unknown Rust struct '${structName}'`, "error"));
    return;
  }
  if (!isRecord(value)) {
    issues.push(
      issue(
        path,
        "type-mismatch",
        `expected an object for '${structName}', got ${describe(value)}`,
        "error",
      ),
    );
    return;
  }

  const known = new Set(structSpec.fields.map((field) => field.wireName));
  for (const field of structSpec.fields) {
    const fieldPath = `${path}.${field.wireName}`;
    const present = Object.prototype.hasOwnProperty.call(value, field.wireName);
    const raw = value[field.wireName];

    if (!present) {
      if (!field.optional) {
        issues.push(
          issue(
            fieldPath,
            "missing-required-field",
            `'${field.wireName}' is required by ${structName} (${field.rustType})`,
            "error",
          ),
        );
      }
      continue;
    }
    if (raw === null) {
      if (field.optional) {
        continue;
      }
      issues.push(
        issue(
          fieldPath,
          "null-not-allowed",
          `'${field.wireName}' is ${field.rustType} in Rust — it must never be null`,
          "error",
        ),
      );
      continue;
    }
    validateScalar(raw, field.rustType, fieldPath, issues);
  }

  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      issues.push(
        issue(
          `${path}.${key}`,
          "unknown-field",
          `'${key}' is not a field of ${structName}; serde ignores unknown fields, so this is accepted`,
          "warning",
        ),
      );
    }
  }
}

function validateScalar(
  value: unknown,
  rustType: string,
  path: string,
  issues: GuardIssue[],
): void {
  const kind = resolveKind(rustType);

  switch (kind.kind) {
    case "string":
      if (typeof value !== "string") {
        issues.push(
          issue(path, "type-mismatch", `expected a string, got ${describe(value)}`, "error"),
        );
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") {
        issues.push(
          issue(path, "type-mismatch", `expected a boolean, got ${describe(value)}`, "error"),
        );
      }
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push(
          issue(path, "type-mismatch", `expected a number, got ${describe(value)}`, "error"),
        );
      }
      return;
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push(
          issue(path, "type-mismatch", `expected an integer, got ${describe(value)}`, "error"),
        );
        return;
      }
      if (!Number.isInteger(value)) {
        issues.push(issue(path, "not-an-integer", `expected an integer, got ${value}`, "error"));
        return;
      }
      if (kind.unsigned && value < 0) {
        issues.push(
          issue(
            path,
            "negative-unsigned",
            `'${rustType}' cannot be negative, got ${value}`,
            "error",
          ),
        );
      }
      return;
    }
    case "date":
      if (typeof value !== "string" || !isIsoDate(value)) {
        issues.push(
          issue(
            path,
            "invalid-date",
            `expected an ISO date (YYYY-MM-DD), got ${describe(value)}`,
            "error",
          ),
        );
      }
      return;
    case "time":
      if (typeof value !== "string" || !isHmTime(value)) {
        issues.push(
          issue(
            path,
            "invalid-time",
            `expected a 24-hour time (HH:MM), got ${describe(value)}`,
            "error",
          ),
        );
      }
      return;
    case "string[]":
      if (!Array.isArray(value)) {
        issues.push(
          issue(
            path,
            "type-mismatch",
            `expected an array of strings, got ${describe(value)}`,
            "error",
          ),
        );
        return;
      }
      value.forEach((entry, index) => {
        if (typeof entry !== "string") {
          issues.push(
            issue(
              `${path}[${index}]`,
              "type-mismatch",
              `expected a string, got ${describe(entry)}`,
              "error",
            ),
          );
        }
      });
      return;
    case "object":
      validateValue(value, kind.struct, path, issues);
      return;
    case "object[]": {
      if (!Array.isArray(value)) {
        issues.push(
          issue(path, "type-mismatch", `expected an array, got ${describe(value)}`, "error"),
        );
        return;
      }
      value.forEach((entry, index) => {
        validateValue(entry, kind.struct, `${path}[${index}]`, issues);
      });
      return;
    }
    case "count-map": {
      if (!isRecord(value)) {
        issues.push(
          issue(path, "type-mismatch", `expected a count map, got ${describe(value)}`, "error"),
        );
        return;
      }
      for (const [key, entry] of Object.entries(value)) {
        if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0) {
          issues.push(
            issue(
              `${path}.${key}`,
              "type-mismatch",
              `expected a non-negative integer count, got ${describe(entry)}`,
              "error",
            ),
          );
        }
      }
      return;
    }
    case "string-map": {
      if (!isRecord(value)) {
        issues.push(
          issue(path, "type-mismatch", `expected a string map, got ${describe(value)}`, "error"),
        );
        return;
      }
      for (const [key, entry] of Object.entries(value)) {
        if (typeof entry !== "string") {
          issues.push(
            issue(
              `${path}.${key}`,
              "type-mismatch",
              `expected a string, got ${describe(entry)}`,
              "error",
            ),
          );
        }
      }
      return;
    }
    case "enum": {
      if (typeof value !== "string") {
        issues.push(
          issue(path, "type-mismatch", `expected a label string, got ${describe(value)}`, "error"),
        );
        return;
      }
      if (kind.values.includes(value)) {
        return;
      }
      if (kind.aliases.includes(value)) {
        issues.push(
          issue(
            path,
            "non-canonical-enum-label",
            `'${value}' is the stored/import label; the core emits '${kind.values.find((label) => label.toLowerCase() === value.toLowerCase()) ?? value}' on the wire`,
            "warning",
          ),
        );
        return;
      }
      if (kind.open) {
        issues.push(
          issue(
            path,
            "non-canonical-enum-label",
            `'${value}' is a user feed label — legal, but not one of the core's own labels`,
            "warning",
          ),
        );
        return;
      }
      issues.push(
        issue(
          path,
          "unknown-enum-value",
          `'${value}' is not a value the Rust core emits (${kind.values.join(", ")})`,
          "error",
        ),
      );
      return;
    }
    case "unchecked":
      issues.push(
        issue(
          path,
          "unchecked-type",
          `no wire rule for Rust type '${kind.rustType}' — the value was not checked`,
          "warning",
        ),
      );
      return;
    default:
      return;
  }
}

function describe(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  return typeof value;
}
