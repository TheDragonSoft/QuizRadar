import { describe, it, expect } from "vitest";
import {
  PAIR_SYNC_PREFIX,
  compactPairSyncPayload,
  decodePairSyncLink,
  encodePairSyncLink,
  encodePairSyncQrPayload,
  extractPairPayloadParam,
  stripLosslessPairSyncFields,
} from "./pairSync";
import { getWasmEngine } from "../pwadapters/wasmBridge";

describe("pairSync codec (quizradar://pair)", () => {
  it("round-trips a data-only BackupPayload JSON via deflate-raw + base64url", async () => {
    const sample = JSON.stringify({
      schema_version: 1,
      client_device_id: "quizradar-desktop",
      updated_at: "2026-11-16T22:00:00Z",
      schedule: {
        courses: [{ id: "CSE241", name: "Data Structures", color: "#1a73e8" }],
        slots: [],
      },
      assessments: [
        {
          id: "a1",
          course_id: "CSE241",
          title: "Midterm 1",
          assessment_type: "Midterm Exam",
          date_iso: "2026-11-24",
          topics: ["Trees", "Graphs"],
        },
      ],
      completed_topics: { "a1::h1234": true },
      grades: {},
      custom_events: [],
      feeds: [],
    });

    const link = await encodePairSyncLink(sample);
    expect(link.startsWith(PAIR_SYNC_PREFIX)).toBe(true);
    expect(link.length).toBeLessThan(sample.length + PAIR_SYNC_PREFIX.length);

    const decoded = await decodePairSyncLink(link);
    expect(JSON.parse(decoded)).toEqual(JSON.parse(sample));
  });

  it("compacts verbose assessment raw_text and long snippets for QR encoding", async () => {
    const verbose = JSON.stringify({
      schema_version: 1,
      client_device_id: "quizradar-desktop",
      updated_at: "2026-11-16T22:00:00Z",
      schedule: { courses: [], slots: [] },
      assessments: [
        {
          id: "a1",
          course_id: "CSE241",
          title: "Quiz 2",
          raw_text: "A".repeat(4000),
          snippet: "B".repeat(300),
        },
      ],
      completed_topics: {},
      grades: {},
      custom_events: [],
      feeds: [],
    });

    const compacted = JSON.parse(compactPairSyncPayload(verbose));
    expect(compacted.assessments[0].raw_text).toBeUndefined();
    expect(compacted.assessments[0].snippet.length).toBeLessThanOrEqual(160);

    const qrResult = await encodePairSyncQrPayload(verbose);
    expect(qrResult.fitsQr).toBe(true);
    expect(qrResult.link.startsWith(PAIR_SYNC_PREFIX)).toBe(true);
  });

  it("compacts real BackupPayload derived, null, and verbose fields across assessments and custom_events", async () => {
    const realistic = JSON.stringify({
      schema_version: 1,
      client_device_id: "quizradar-desktop",
      updated_at: "2026-11-16T22:00:00Z",
      schedule: { semester: null, courses: [], slots: [] },
      assessments: [
        {
          id: "a1",
          course_id: "CSE241",
          title: "Midterm 1",
          room: null,
          group: null,
          display_time: "Sunday, 18 October 2026 (9:00 AM - 10:30 AM)",
          conflict_warning: "Within 48h of GSE211 Quiz 2",
          google_cal_url:
            "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Midterm",
          ai_study_plan: "Step 1: Review trees and heaps.\n".repeat(120),
          ai_inference_note: "Inferred from announcement sent on Oct 10. ".repeat(10),
        },
      ],
      completed_topics: {},
      grades: {},
      custom_events: [
        {
          id: "ev1",
          title: "Review Session",
          room: null,
          notes: "Bring lab notes and textbook chapters 1-5. ".repeat(10),
        },
      ],
      feeds: [],
    });

    // Lossless stage removes null and derived fields while keeping ai_study_plan and notes intact.
    const lossless = JSON.parse(stripLosslessPairSyncFields(realistic));
    expect(lossless.schedule.semester).toBeUndefined();
    expect(lossless.assessments[0].room).toBeUndefined();
    expect(lossless.assessments[0].google_cal_url).toBeUndefined();
    expect(lossless.assessments[0].conflict_warning).toBeUndefined();
    expect(lossless.assessments[0].display_time).toBeUndefined();
    expect(lossless.assessments[0].ai_study_plan).toContain("Step 1:");
    expect(lossless.custom_events[0].notes).toContain("Bring lab notes");

    // Full compaction also drops ai_study_plan and truncates ai_inference_note & custom_events[].notes.
    const compacted = JSON.parse(compactPairSyncPayload(realistic));
    expect(compacted.assessments[0].ai_study_plan).toBeUndefined();
    expect(compacted.assessments[0].ai_inference_note.length).toBeLessThanOrEqual(160);
    expect(compacted.assessments[0].ai_inference_note.endsWith("...")).toBe(true);
    expect(compacted.custom_events[0].notes.length).toBeLessThanOrEqual(160);
    expect(compacted.custom_events[0].notes.endsWith("...")).toBe(true);
  });

  it("round-trips payloads exceeding stream high-water marks (>64KB) without deadlocking", async () => {
    const bigAssessments = Array.from({ length: 180 }, (_, idx) => ({
      id: `a-${idx}`,
      course_id: `CSE${100 + (idx % 10)}`,
      title: `Assessment ${idx} covering unique topic ${idx * 7919}`,
      assessment_type: "Quiz",
      date_iso: "2026-11-24",
      topics: [`Topic ${idx}-A`, `Topic ${idx}-B`, `Topic ${idx}-C`],
      ai_study_plan: `Detailed plan ${idx}: ${"focus ".repeat(40)}`,
    }));
    const largePayload = JSON.stringify({
      schema_version: 1,
      client_device_id: "quizradar-desktop",
      updated_at: "2026-11-16T22:00:00Z",
      schedule: { courses: [], slots: [] },
      assessments: bigAssessments,
      completed_topics: {},
      grades: {},
      custom_events: [],
      feeds: [],
    });
    expect(largePayload.length).toBeGreaterThan(65_536);

    const link = await encodePairSyncLink(largePayload);
    const decoded = await decodePairSyncLink(link);
    expect(JSON.parse(decoded)).toEqual(JSON.parse(largePayload));
  });

  it("interoperates wire-for-wire with Rust core WASM deflate-raw codec and LAN URI validator", async () => {
    const wasm = await getWasmEngine();
    const sample = JSON.stringify({
      schema_version: 1,
      client_device_id: "quizradar-android",
      updated_at: "2026-11-20T12:00:00Z",
      schedule: { courses: [{ id: "CSE241", name: "Algorithms", color: "#1a73e8" }], slots: [] },
      assessments: [{ id: "a1", course_id: "CSE241", title: "Final Exam" }],
      completed_topics: { "a1::h1": true },
      grades: {},
      custom_events: [],
      feeds: [],
    });

    // Rust WASM encode -> Web CompressionStream decode
    const rustLink = wasm.encode_pair_sync_link(sample);
    const decodedByWeb = await decodePairSyncLink(rustLink);
    expect(JSON.parse(decodedByWeb)).toEqual(JSON.parse(sample));

    // Web CompressionStream encode -> Rust WASM decode
    const webLink = await encodePairSyncLink(sample);
    const decodedByRust = wasm.decode_pair_sync_link(webLink);
    expect(JSON.parse(decodedByRust)).toEqual(JSON.parse(sample));

    // SSRF guard in Rust WASM rejects public IPv4 LAN URIs
    const validFp = `${"A".repeat(42)}A`;
    const validLan = `quizradar://lan?h=192.168.1.42&p=51823&t=${"A".repeat(43)}&fp=${validFp}&v=1`;
    expect(JSON.parse(wasm.parse_lan_pair_uri(validLan)).host).toBe("192.168.1.42");
    const publicLan = `quizradar://lan?h=8.8.8.8&p=51823&t=${"A".repeat(43)}&fp=${validFp}&v=1`;
    expect(() => wasm.parse_lan_pair_uri(publicLan)).toThrow(/non-local address/);
  });

  it("rejects malformed or missing payload links cleanly", async () => {
    expect(() => extractPairPayloadParam("")).toThrow();
    expect(() => extractPairPayloadParam("https://example.com/foo")).toThrow();
    await expect(decodePairSyncLink("quizradar://pair")).rejects.toThrow();
    await expect(decodePairSyncLink("quizradar://pair?d=not_valid_deflate")).rejects.toThrow();
  });
});
