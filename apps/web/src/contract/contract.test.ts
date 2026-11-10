/**
 * The Rust↔TypeScript contract test.
 *
 * The Rust core is the source of truth for every payload a shell receives.
 * This suite pins the whole chain to it:
 *
 *  1. the committed `rust-structs.json` is fresh (re-derived from the live
 *     Rust sources by `regenerate.mjs --check`),
 *  2. every committed fixture deserializes like serde would (zero errors),
 *  3. a payload that drifts from the Rust shape is rejected — with the guard
 *     code that names the drift,
 *  4. the TypeScript mirror (`src/state/types.ts`) declares every Rust field
 *     of the mapped structs — the missing set must equal `KNOWN_FIELD_GAPS`
 *     (currently empty),
 *  5. optionality parity: Rust `Option` ⇒ TS optional-or-nullable, Rust
 *     required ⇒ TS not nullable (rename targets are exempt from the first
 *     rule — they are adapter-normalized names and may be stricter),
 *  6. the TS-only property set equals `KNOWN_TS_ONLY_FIELDS` exactly,
 *  7. enum parity — including the recorded urgency-casing divergence and the
 *     adapter fold that resolves it,
 *  8. the adapter actually fills the names the views read (the roadmap row's
 *     `title`/`reasoning`, the conflict alert's ids and gap hours).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  camelCase,
  KNOWN_ENUM_DIVERGENCES,
  KNOWN_FIELD_GAPS,
  KNOWN_TS_ONLY_FIELDS,
  parseTsInterfaces,
  REPO_ROOT,
  RUST_ASSESSMENT_SOURCE_LABELS,
  RUST_ASSESSMENT_TYPES,
  RUST_CONFLICT_SEVERITIES,
  RUST_CONTRACT,
  RUST_TO_TS_MAPPINGS,
  RUST_URGENCY_EMIT_LABELS,
  RUST_URGENCY_STORED_LABELS,
  RUST_STORE_CONTRACT,
  RUST_STORE_MIGRATIONS,
  RUST_STORE_SCHEMA_VERSION,
  WEB_SRC,
  type RustToTsMapping,
} from "./contractSpec";
import {
  assessmentsFixture,
  clone,
  dashboardFixture,
  desktopAuthFixture,
  desktopConfigFixture,
  scheduleFixture,
  statePayloadFixture,
  studyTasksFixture,
} from "./contractFixtures";
import { validateRustPayload, type GuardCode } from "./contractGuard";
import { normalizeStatePayload } from "../state/ipcShape";
import type { GetStatePayload } from "../state/types";
import { IDB_MIGRATIONS, IDB_SCHEMA_VERSION } from "../pwadapters/idbStore";

/** The parsed TypeScript mirror of the wire structs. */
const TS_MIRROR_SOURCE = readFileSync(join(WEB_SRC, "state", "types.ts"), "utf8");
const TS_MIRROR = parseTsInterfaces(TS_MIRROR_SOURCE);

interface Cover {
  coveredBy: Set<string>;
  renames: Record<string, string>;
}

/** Wire name → the TS property that carries it (camelCase twin or rename). */
function fieldCover(mapping: RustToTsMapping): Cover {
  const struct = RUST_CONTRACT.structs[mapping.rustStruct];
  const renames = mapping.renames ?? {};
  const coveredBy = new Set<string>();
  for (const field of struct.fields) {
    coveredBy.add(camelCase(field.wireName));
    coveredBy.add(field.wireName);
    const rename = renames[field.wireName];
    if (rename) {
      coveredBy.add(rename);
    }
  }
  return { coveredBy, renames };
}

// 1 — generator freshness -----------------------------------------------------

describe("contract: the committed wire map is fresh", () => {
  it("rust-structs.json matches the live Rust sources", () => {
    const regenerate = join(WEB_SRC, "contract", "regenerate.mjs");
    expect(() =>
      execFileSync(process.execPath, [regenerate, "--check"], {
        cwd: REPO_ROOT,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});

// 2 — the committed fixtures deserialize like serde would ---------------------

describe("contract: committed fixtures pass the guard", () => {
  const cases: ReadonlyArray<[string, string, unknown]> = [
    ["assessments.json", "Assessment", assessmentsFixture],
    ["dashboard-summary.json", "DashboardSummary", dashboardFixture],
    ["study-tasks-payload.json", "StudyTasksPayload", studyTasksFixture],
    ["schedule.json", "ScheduleData", scheduleFixture],
    ["desktop-config.json", "DesktopConfig", desktopConfigFixture],
    ["desktop-auth.json", "DesktopAuthProfile", desktopAuthFixture],
  ];

  for (const [file, structName, payload] of cases) {
    it(`${file} deserializes as ${structName}`, () => {
      if (Array.isArray(payload)) {
        payload.forEach((entry, index) => {
          const result = validateRustPayload(entry, structName);
          expect(
            result.errors,
            `${file}[${index}]: ${result.errors.map((e) => `${e.path} ${e.code}`).join("; ")}`,
          ).toEqual([]);
          expect(result.ok).toBe(true);
        });
        return;
      }
      const result = validateRustPayload(payload, structName);
      expect(
        result.errors,
        `${file}: ${result.errors.map((e) => `${e.path} ${e.code}`).join("; ")}`,
      ).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }

  it("the full get_state payload deserializes on every layer", () => {
    const payload = clone(statePayloadFixture);
    expect(validateRustPayload(payload.config, "DesktopConfig").errors).toEqual([]);
    expect(validateRustPayload(payload.auth, "DesktopAuthProfile").errors).toEqual([]);
    expect(validateRustPayload(payload.schedule, "ScheduleData").errors).toEqual([]);
    expect(
      (payload.assessments as unknown[]).map((a) => validateRustPayload(a, "Assessment").ok),
    ).not.toContain(false);
    expect(validateRustPayload(payload.dashboard, "DashboardSummary").errors).toEqual([]);
    expect(validateRustPayload(payload.studyTasksPayload, "StudyTasksPayload").errors).toEqual([]);
  });
});

// 3 — drift is rejected, with the code that names it --------------------------

describe("contract: drift mutations are rejected", () => {
  const base = assessmentsFixture[0];

  /** Run one mutation against a fresh `Assessment` and return the guard result. */
  function mutateAssessment(mutate: (draft: Record<string, unknown>) => void) {
    const draft = clone(base) as Record<string, unknown>;
    mutate(draft);
    return validateRustPayload(draft, "Assessment");
  }

  /** One error-case row: the mutation plus the guard code that must fire. */
  const errorCases: ReadonlyArray<[string, (draft: Record<string, unknown>) => void, GuardCode]> = [
    ["a required field went missing", (d) => delete d.title, "missing-required-field"],
    ["null in a non-Option field", (d) => void (d.id = null), "null-not-allowed"],
    ["a string field carries a number", (d) => void (d.title = 42), "type-mismatch"],
    ["a number field carries a string", (d) => void (d.priority_score = "70"), "type-mismatch"],
    ["a u8 carries a fraction", (d) => void (d.priority_score = 3.5), "not-an-integer"],
    ["a u8 is negative", (d) => void (d.priority_score = -1), "negative-unsigned"],
    ["an impossible calendar day", (d) => void (d.date_iso = "2026-02-30"), "invalid-date"],
    ["a non-ISO date", (d) => void (d.date_iso = "30.10.2026"), "invalid-date"],
    ["an out-of-range time", (d) => void (d.start_time = "25:00"), "invalid-time"],
    ["a non-24h time", (d) => void (d.start_time = "9:00 AM"), "invalid-time"],
    [
      "an invented assessment type",
      (d) => void (d.assessment_type = "Pop Quiz"),
      "unknown-enum-value",
    ],
    ["an invented urgency", (d) => void (d.urgency_level = "URGENT"), "unknown-enum-value"],
    ["a non-string inside topics", (d) => void (d.topics = ["ok", 5]), "type-mismatch"],
  ];

  for (const [name, mutate, expectedCode] of errorCases) {
    it(`rejects ${name} (${expectedCode})`, () => {
      const result = mutateAssessment(mutate);
      expect(result.ok).toBe(false);
      expect(result.errors.map((issue) => issue.code)).toContain(expectedCode);
    });
  }

  it("rejects an impossible date on a conflict alert", () => {
    const alerts = dashboardFixture.conflict_alerts as Record<string, unknown>[];
    const draft = clone(alerts[0]);
    draft.date_a = "not-a-date";
    const result = validateRustPayload(draft, "ConflictAlert");
    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("invalid-date");
  });

  it("rejects month 13 on a roadmap task", () => {
    const days = studyTasksFixture.days as { tasks: Record<string, unknown>[] }[];
    const draft = clone(days[0].tasks[0]);
    draft.target_date_iso = "2026-13-01";
    const result = validateRustPayload(draft, "DailyStudyTask");
    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("invalid-date");
  });

  it("accepts an unknown field with a warning, like serde", () => {
    const result = mutateAssessment((d) => void (d.nonsense_field = 1));
    expect(result.ok).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toContain("unknown-field");
  });

  it("accepts the lower-case stored urgency with no casing warning (shapes unified)", () => {
    const result = mutateAssessment((d) => void (d.urgency_level = "critical"));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((issue) => issue.code)).not.toContain("non-canonical-enum-label");
  });

  it("accepts a user feed source label that is not one of the core's own", () => {
    const result = mutateAssessment((d) => void (d.source = "My Department Feed"));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// 4 + 5 + 6 — the mirror declares, and only over-declares knowingly -----------

describe("contract: the TypeScript mirror matches the Rust wire format", () => {
  /** Rust field → the TS property that covers it (or undefined). */
  function tsFieldFor(mapping: RustToTsMapping, wireName: string): string | undefined {
    const renames = mapping.renames ?? {};
    return renames[wireName] ?? camelCase(wireName);
  }

  it("every mapped struct exists in the mirror", () => {
    for (const mapping of RUST_TO_TS_MAPPINGS) {
      expect(TS_MIRROR[mapping.tsInterface], mapping.tsInterface).toBeDefined();
    }
  });

  it("declares every Rust field of every mapped struct", () => {
    const gaps: string[] = [];
    for (const mapping of RUST_TO_TS_MAPPINGS) {
      const mirror = TS_MIRROR[mapping.tsInterface];
      for (const field of RUST_CONTRACT.structs[mapping.rustStruct].fields) {
        const tsName = tsFieldFor(mapping, field.wireName);
        if (!(tsName && mirror[tsName])) {
          gaps.push(
            `${mapping.rustStruct}.${field.wireName} → ${mapping.tsInterface}.${String(tsName)}`,
          );
        }
      }
    }
    expect(gaps).toEqual([]);
    // And the recorded gap list stays empty with it.
    expect(KNOWN_FIELD_GAPS).toEqual([]);
  });

  it("every rename names a property that really exists in the interface", () => {
    for (const mapping of RUST_TO_TS_MAPPINGS) {
      const mirror = TS_MIRROR[mapping.tsInterface];
      for (const [wireName, tsName] of Object.entries(mapping.renames ?? {})) {
        expect(
          mirror[tsName],
          `${mapping.rustStruct}: rename ${wireName} → ${tsName} does not exist in ${mapping.tsInterface}`,
        ).toBeDefined();
      }
    }
  });

  it("keeps optionality parity (Rust Option ⇒ optional-or-nullable, Rust required ⇒ not nullable)", () => {
    const violations: string[] = [];
    for (const mapping of RUST_TO_TS_MAPPINGS) {
      const mirror = TS_MIRROR[mapping.tsInterface];
      for (const field of RUST_CONTRACT.structs[mapping.rustStruct].fields) {
        const tsName = tsFieldFor(mapping, field.wireName);
        const tsField = tsName ? mirror[tsName] : undefined;
        if (!tsField) {
          continue; // already a hard failure in the declaration test
        }
        if (field.optional && !(tsField.optional || tsField.nullable)) {
          violations.push(
            `${mapping.rustStruct}.${field.wireName} is Option in Rust but ${mapping.tsInterface}.${tsField.name} is required`,
          );
        }
        if (!field.optional && tsField.nullable) {
          violations.push(
            `${mapping.rustStruct}.${field.wireName} is required in Rust but ${mapping.tsInterface}.${tsField.name} admits null`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("declares exactly the known TS-only fields", () => {
    const tsOnly: string[] = [];
    for (const mapping of RUST_TO_TS_MAPPINGS) {
      const cover = fieldCover(mapping);
      const mirror = TS_MIRROR[mapping.tsInterface];
      for (const tsName of Object.keys(mirror)) {
        // snake_case alias properties on the mirror ARE wire names.
        if (RUST_CONTRACT.structs[mapping.rustStruct].fields.some((f) => f.wireName === tsName)) {
          continue;
        }
        if (!cover.coveredBy.has(tsName)) {
          tsOnly.push(`${mapping.tsInterface}.${tsName}`);
        }
      }
    }
    const declared = KNOWN_TS_ONLY_FIELDS.map((entry) => `${entry.tsInterface}.${entry.tsField}`);
    expect([...tsOnly].sort()).toEqual([...declared].sort());
  });
});

// 7 — enums -------------------------------------------------------------------

describe("contract: enums", () => {
  it("emits exactly the lower-case urgency variants (emit/store shapes unified)", () => {
    expect(RUST_URGENCY_EMIT_LABELS).toEqual(["critical", "high", "medium", "upcoming", "past"]);
    // The casing divergence was fixed in the core (serde rename_all) — the
    // record must stay empty so a future divergence re-registers itself.
    expect(KNOWN_ENUM_DIVERGENCES).toEqual([]);
  });

  it("declares exactly the mirror's lower-case urgency union", () => {
    const match = /export type UrgencyLevel = ([^;]+);/.exec(TS_MIRROR_SOURCE);
    expect(match).not.toBeNull();
    const declared =
      match?.[1]
        .split("|")
        .map((part) => part.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean) ?? [];
    expect(declared).toEqual(RUST_URGENCY_EMIT_LABELS);
  });

  it("stores the same ladder it emits", () => {
    expect(RUST_URGENCY_STORED_LABELS).toEqual(RUST_URGENCY_EMIT_LABELS);
  });

  it("the guard accepts the emit and stored labels without a casing warning", () => {
    for (const label of [...RUST_URGENCY_EMIT_LABELS, ...RUST_URGENCY_STORED_LABELS]) {
      const draft = clone(assessmentsFixture[0]) as Record<string, unknown>;
      draft.urgency_level = label;
      const result = validateRustPayload(draft, "Assessment");
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings.map((issue) => issue.code)).not.toContain("non-canonical-enum-label");
    }
  });

  it("keeps assessment types and conflict severities closed", () => {
    expect(RUST_ASSESSMENT_TYPES.length).toBeGreaterThanOrEqual(5);
    expect(RUST_CONFLICT_SEVERITIES).toEqual(["critical", "warning"]);
    const fixtures = assessmentsFixture as Record<string, unknown>[];
    for (const assessment of fixtures) {
      expect(RUST_ASSESSMENT_TYPES).toContain(assessment.assessment_type);
    }
    const alerts = dashboardFixture.conflict_alerts as Record<string, unknown>[];
    for (const alert of alerts) {
      expect(RUST_CONFLICT_SEVERITIES).toContain(alert.severity);
    }
  });

  it("treats an unknown source label as an open user feed label, not an error", () => {
    expect(RUST_ASSESSMENT_SOURCE_LABELS.length).toBeGreaterThanOrEqual(4);
  });
});

// 8 — the adapter fills the names the views read ------------------------------

describe("contract: the adapter fills the view model", () => {
  it("gives every roadmap row its title, reason and topic", () => {
    const normalized = normalizeStatePayload(
      clone(statePayloadFixture) as unknown as GetStatePayload,
    );
    const days = normalized.studyTasksPayload.days;
    expect(days.length).toBeGreaterThan(0);
    for (const day of days) {
      for (const task of day.tasks) {
        expect(task.title, `task ${task.id} title`).toBeTruthy();
        expect(task.reasoning, `task ${task.id} reasoning`).toBeTruthy();
        expect(task.topicTitle, `task ${task.id} topic`).toBeTruthy();
      }
    }
  });

  it("gives every conflict alert its ids, gap hours and courses", () => {
    const wire = dashboardFixture.conflict_alerts as Record<string, unknown>[];
    expect(wire.length).toBeGreaterThan(0);
    const normalized = normalizeStatePayload(
      clone(statePayloadFixture) as unknown as GetStatePayload,
    );
    const alerts = normalized.dashboard.conflictAlerts;
    expect(alerts.length).toBe(wire.length);
    alerts.forEach((alert, index) => {
      expect(alert.assessmentAId).toBe(wire[index].assessment_id_a);
      expect(alert.assessmentBId).toBe(wire[index].assessment_id_b);
      expect(alert.hoursBetween).toBe(wire[index].gap_hours);
      expect(alert.courseA).toBe(wire[index].course_a ?? null);
      expect(alert.isMitigated).toBe(wire[index].is_mitigated);
    });
  });

  it("folds the wire's urgency casing onto the mirror's union", () => {
    const normalized = normalizeStatePayload(
      clone(statePayloadFixture) as unknown as GetStatePayload,
    );
    for (const assessment of normalized.assessments) {
      expect(["critical", "high", "medium", "upcoming", "past"]).toContain(assessment.urgencyLevel);
      expect(assessment.urgencyLevel).toBe(assessment.urgencyLevel.toLowerCase());
    }
  });

  it("is idempotent", () => {
    const once = normalizeStatePayload(clone(statePayloadFixture) as unknown as GetStatePayload);
    const twice = normalizeStatePayload(clone(once) as unknown as GetStatePayload);
    expect(twice).toEqual(once);
  });
});

// 9 — dual-store migration lock -----------------------------------------------

describe("contract: SQLite and IndexedDB dual-store migration lock", () => {
  it("logical schema version matches exactly between SQLite and IndexedDB", () => {
    expect(IDB_SCHEMA_VERSION).toBe(RUST_STORE_SCHEMA_VERSION);
    expect(IDB_SCHEMA_VERSION).toBe(RUST_STORE_CONTRACT.schemaVersion);
  });

  it("both stores implement the identical ordered set of logical migrations", () => {
    expect(IDB_MIGRATIONS.length).toBe(RUST_STORE_MIGRATIONS.length);
    expect(IDB_MIGRATIONS.length).toBeGreaterThan(0);

    IDB_MIGRATIONS.forEach((idbStep, index) => {
      const rustStep = RUST_STORE_MIGRATIONS[index];
      expect(rustStep).toBeDefined();
      expect(idbStep.version).toBe(rustStep.version);
      expect(idbStep.description).toBe(rustStep.description);
      // Strictly sequential 1..N order
      expect(idbStep.version).toBe(index + 1);
    });
  });

  it("schema version equals the latest migration version in both stores", () => {
    const lastIdbStep = IDB_MIGRATIONS[IDB_MIGRATIONS.length - 1];
    const lastRustStep = RUST_STORE_MIGRATIONS[RUST_STORE_MIGRATIONS.length - 1];
    expect(lastIdbStep.version).toBe(IDB_SCHEMA_VERSION);
    expect(lastRustStep.version).toBe(RUST_STORE_SCHEMA_VERSION);
  });

  it("IndexedDB migration runners execute without error", () => {
    const createdStores = new Set<string>();
    const fakeDb = {
      objectStoreNames: {
        contains: (name: string) => createdStores.has(name),
      },
      createObjectStore: (name: string) => {
        createdStores.add(name);
        return {} as IDBObjectStore;
      },
    } as unknown as IDBDatabase;

    for (const step of IDB_MIGRATIONS) {
      if (step.migrate) {
        expect(() => step.migrate!(fakeDb)).not.toThrow();
      }
    }
    // All key stores from migrations 1, 4, 5 exist
    expect(createdStores.has("courses")).toBe(true);
    expect(createdStores.has("assessments")).toBe(true);
    expect(createdStores.has("attendance")).toBe(true);
    expect(createdStores.has("flashcards")).toBe(true);
    expect(createdStores.has("quiz_attempts")).toBe(true);
    expect(createdStores.has("mistake_bank")).toBe(true);
    expect(createdStores.has("study_sessions")).toBe(true);
    expect(createdStores.has("cached_emails")).toBe(true);
    expect(createdStores.has("email_ai_extractions")).toBe(true);
  });
});
