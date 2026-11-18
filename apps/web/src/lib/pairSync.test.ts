import { describe, it, expect } from "vitest";
import {
  PAIR_SYNC_PREFIX,
  compactPairSyncPayload,
  decodePairSyncLink,
  encodePairSyncLink,
  encodePairSyncQrPayload,
  extractPairPayloadParam,
} from "./pairSync";

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

  it("rejects malformed or missing payload links cleanly", async () => {
    expect(() => extractPairPayloadParam("")).toThrow();
    expect(() => extractPairPayloadParam("https://example.com/foo")).toThrow();
    await expect(decodePairSyncLink("quizradar://pair")).rejects.toThrow();
    await expect(decodePairSyncLink("quizradar://pair?d=not_valid_deflate")).rejects.toThrow();
  });
});
