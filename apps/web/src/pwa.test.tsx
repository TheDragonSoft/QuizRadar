import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { getWasmEngine } from "./pwadapters/wasmBridge";
import { pwaRpcHandler, toRustAssessment } from "./pwadapters/rpcAdapter";
import { setupMockIndexedDb } from "./test/mockIndexedDb";
import { APP_VERSION } from "./generated/version";
import { HelpView } from "./views/HelpView";
import type { Assessment, GetStatePayload, ScheduleData } from "./state/types";

describe("Phase 11: PWA Companion Tier", () => {
  let teardownIdb: () => void;

  beforeEach(() => {
    teardownIdb = setupMockIndexedDb();
  });

  afterEach(() => {
    teardownIdb();
  });

  describe("1. WASM Engine Parity (QuizRadarWasm)", () => {
    it("parses golden email fixture with 100% parity to desktop core", async () => {
      const wasm = await getWasmEngine();
      // The compiled WASM must carry the same version truth as the repo.
      // A hardcoded literal here drifts the moment the version is stamped.
      expect(wasm.version()).toBe(APP_VERSION);

      const repoRoot = path.resolve(process.cwd(), "../..");
      const schedulePath = path.join(repoRoot, "core/tests/fixtures/schedule/schedule.json");
      const emailFixturePath = path.join(
        repoRoot,
        "core/tests/fixtures/email/01-explicit-midterm-slot.json",
      );

      const scheduleJson = fs.readFileSync(schedulePath, "utf8");
      const emailCase = JSON.parse(fs.readFileSync(emailFixturePath, "utf8"));

      const refDate = emailCase.ref_date;
      const parsedJson = wasm.parse_email(
        JSON.stringify(emailCase.emails[0]),
        scheduleJson,
        refDate,
      );

      const assessment = JSON.parse(parsedJson);
      expect(assessment.title).toBe("CSE241 Midterm Exam");
      expect(assessment.course_id).toBe("CSE241");
      expect(assessment.date_iso).toBe("2026-10-18");
      expect(assessment.room).toBe("Lab A");
      expect(assessment.assessment_type).toBe("Midterm Exam");
    });

    it("derives radar order, dashboard, and study tasks via WASM", async () => {
      const wasm = await getWasmEngine();
      const repoRoot = path.resolve(process.cwd(), "../..");
      const scheduleJson = fs.readFileSync(
        path.join(repoRoot, "core/tests/fixtures/schedule/schedule.json"),
        "utf8",
      );

      const assessments: Assessment[] = [
        {
          id: "exam-1",
          courseId: "CSE 341",
          courseName: "Operating Systems",
          title: "Midterm Exam",
          assessmentType: "Midterm",
          dateIso: "2026-10-19",
          dayName: "Monday",
          startTime: "09:00",
          endTime: "10:30",
          displayTime: "09:00 – 10:30",
          room: "B-201",
          isUpcoming: true,
          daysUntil: 9,
          urgencyLevel: "medium",
          priorityScore: 75,
          topics: ["Process Scheduling", "Virtual Memory"],
          warnings: [],
          source: "email",
          weightagePercent: 25,
        },
      ];

      const refDate = "2026-10-10";

      // 1. Radar order
      const rustAssessments = assessments.map(toRustAssessment);
      const orderedJson = wasm.radar_order(JSON.stringify(rustAssessments), refDate);
      const ordered = JSON.parse(orderedJson) as Array<Record<string, unknown>>;
      expect(ordered).toHaveLength(1);
      expect(ordered[0].id).toBe("exam-1");

      // 2. Dashboard summary
      const dashboardJson = wasm.derive_dashboard(
        JSON.stringify(ordered),
        JSON.stringify({}),
        JSON.stringify([]),
        refDate,
      );
      const dashboard = JSON.parse(dashboardJson);
      expect(dashboard.all_upcoming).toHaveLength(1);
      expect(dashboard.readiness_percent).toBe(0);

      // 3. Tasks derivation
      const tasksJson = wasm.derive_tasks(
        JSON.stringify(ordered),
        scheduleJson,
        JSON.stringify({}),
        refDate,
      );
      const tasksPayload = JSON.parse(tasksJson);
      expect(tasksPayload.readiness_cards).toHaveLength(1);
      expect(tasksPayload.readiness_cards[0].total_count).toBe(2);
    });

    it("exports valid standard ICS calendar and generates practice MCQs locally", async () => {
      const wasm = await getWasmEngine();
      const assessment: Assessment = {
        id: "exam-2",
        courseId: "CSE 341",
        courseName: "Operating Systems",
        title: "Final Exam",
        assessmentType: "Final",
        dateIso: "2026-12-15",
        dayName: "Tuesday",
        startTime: "10:00",
        endTime: "12:00",
        displayTime: "10:00 – 12:00",
        room: "Hall A",
        isUpcoming: true,
        daysUntil: 65,
        urgencyLevel: "upcoming",
        priorityScore: 50,
        topics: ["Deadlocks", "File Systems", "Concurrency"],
        warnings: [],
        source: "email",
      };

      // ICS Export
      const rustAssessment = toRustAssessment(assessment);
      const ics = wasm.export_ics(JSON.stringify([rustAssessment]), "exam-2");
      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("SUMMARY:[CSE 341] Final Exam");
      expect(ics).toContain("LOCATION:Room Hall A");
      expect(ics).toContain("END:VCALENDAR");

      // Practice quiz generator
      const quizJson = wasm.generate_practice_quiz(JSON.stringify(rustAssessment));
      const quiz = JSON.parse(quizJson);
      expect(quiz.questions.length).toBeGreaterThanOrEqual(3);
      for (const q of quiz.questions) {
        expect(q.question).toBeTruthy();
        expect(q.options.length).toBe(4);
        expect(q.correct_index).toBeGreaterThanOrEqual(0);
        expect(q.correct_index).toBeLessThan(4);
      }
    });

    it("merges scanned assessments honestly preserving user owned fields", async () => {
      const wasm = await getWasmEngine();
      const existing: Assessment[] = [
        {
          id: "moodle-1",
          title: "Lab Quiz 1",
          assessmentType: "Quiz",
          dateIso: "2026-10-15",
          isUpcoming: true,
          urgencyLevel: "high",
          priorityScore: 80,
          topics: [],
          warnings: [],
          source: "moodle",
          achievedScore: 85,
          maxScore: 100,
          weightagePercent: 10,
        },
      ];

      const incoming: Assessment[] = [
        {
          id: "moodle-1",
          title: "Lab Quiz 1 (Rescheduled)",
          assessmentType: "Quiz",
          dateIso: "2026-10-16",
          isUpcoming: true,
          urgencyLevel: "high",
          priorityScore: 80,
          topics: [],
          warnings: [],
          source: "moodle",
        },
        {
          id: "moodle-2",
          title: "Lab Quiz 2",
          assessmentType: "Quiz",
          dateIso: "2026-10-25",
          isUpcoming: true,
          urgencyLevel: "medium",
          priorityScore: 50,
          topics: [],
          warnings: [],
          source: "moodle",
        },
      ];

      const mergeResultJson = wasm.merge_sync(
        JSON.stringify(existing.map(toRustAssessment)),
        JSON.stringify(incoming.map(toRustAssessment)),
      );
      const result = JSON.parse(mergeResultJson);
      expect(result.counts.added).toBe(1); // moodle-2
      expect(result.counts.updated).toBe(1); // moodle-1

      const updatedQuiz1 = result.merged.find((a: Record<string, unknown>) => a.id === "moodle-1");
      expect(updatedQuiz1.title).toBe("Lab Quiz 1 (Rescheduled)");
      // Preserved user-owned fields
      expect(updatedQuiz1.achieved_score).toBe(85);
      expect(updatedQuiz1.max_score).toBe(100);
      expect(updatedQuiz1.weightage_percent).toBe(10);
    });

    it("retires what a feed no longer reports, and keeps what it still reports", async () => {
      const wasm = await getWasmEngine();
      const previousRun = "registrar-2026-11-01T09:00:00Z";
      const thisRun = "registrar-2026-11-02T09:00:00Z";

      const existing: Assessment[] = [
        {
          id: "feed-registrar-cse241_quiz_1",
          title: "CSE241 Quiz 1",
          assessmentType: "Quiz",
          dateIso: "2026-11-20",
          isUpcoming: true,
          urgencyLevel: "high",
          priorityScore: 80,
          topics: [],
          warnings: [],
          source: "Registrar",
          lastSeenSourceRun: previousRun,
        },
        {
          id: "feed-registrar-cse241_quiz_2",
          title: "CSE241 Quiz 2",
          assessmentType: "Quiz",
          dateIso: "2026-12-01",
          isUpcoming: true,
          urgencyLevel: "medium",
          priorityScore: 50,
          topics: [],
          warnings: [],
          source: "Registrar",
          lastSeenSourceRun: previousRun,
        },
      ];

      // The feed still carries Quiz 2; Quiz 1 is no longer announced.
      const incoming: Assessment[] = [
        {
          id: "feed-registrar-cse241_quiz_2",
          title: "CSE241 Quiz 2",
          assessmentType: "Quiz",
          dateIso: "2026-12-01",
          isUpcoming: true,
          urgencyLevel: "medium",
          priorityScore: 50,
          topics: [],
          warnings: [],
          source: "Registrar",
        },
      ];

      const result = JSON.parse(
        wasm.merge_scan(
          JSON.stringify(existing.map(toRustAssessment)),
          JSON.stringify(incoming.map(toRustAssessment)),
          JSON.stringify([{ name: "Registrar", run_id: thisRun }]),
          "2026-11-02",
        ),
      );

      expect(result.retired).toBe(1);

      const retired = result.merged.find(
        (a: Record<string, unknown>) => a.id === "feed-registrar-cse241_quiz_1",
      );
      expect(retired.is_upcoming).toBe(false);
      expect(retired.retired_source_run).toBe(thisRun);
      expect(String(retired.warnings)).toContain("did not report this announcement again");

      const stillLive = result.merged.find(
        (a: Record<string, unknown>) => a.id === "feed-registrar-cse241_quiz_2",
      );
      expect(stillLive.is_upcoming).toBe(true);
      expect(stillLive.retired_source_run).toBeNull();
      expect(stillLive.last_seen_source_run).toBe(thisRun);
    });

    it("retires nothing when the feed did not run", async () => {
      const wasm = await getWasmEngine();
      const existing: Assessment[] = [
        {
          id: "feed-registrar-cse241_quiz_1",
          title: "CSE241 Quiz 1",
          assessmentType: "Quiz",
          dateIso: "2026-11-20",
          isUpcoming: true,
          urgencyLevel: "high",
          priorityScore: 80,
          topics: [],
          warnings: [],
          source: "Registrar",
          lastSeenSourceRun: "registrar-2026-11-01T09:00:00Z",
        },
      ];

      // The feed failed: it reported nothing, so it cannot claim that an
      // announcement vanished.
      const result = JSON.parse(
        wasm.merge_scan(JSON.stringify(existing.map(toRustAssessment)), "[]", "[]", "2026-11-02"),
      );

      expect(result.retired).toBe(0);
      expect(result.merged[0].is_upcoming).toBe(true);
      expect(result.merged[0].retired_source_run).toBeNull();
    });
  });

  describe("2. Browser RPC Adapter & Honest Degradation", () => {
    it("stores schedule and returns full assembled state", async () => {
      const schedule: ScheduleData = {
        semester: "Fall 2026",
        courses: [{ id: "CSE 341", name: "Operating Systems", color: "#1a73e8" }],
        slots: [
          {
            id: "slot-1",
            day: "Monday",
            dayIndex: 0,
            courseId: "CSE 341",
            courseName: "Operating Systems",
            type: "Lecture",
            startTime: "09:00",
            endTime: "10:30",
            displayTime: "09:00 – 10:30",
          },
        ],
      };

      const state = await pwaRpcHandler<GetStatePayload>("save_schedule", { schedule });
      expect(state.schedule.courses).toHaveLength(1);
      expect(state.schedule.courses[0].id).toBe("CSE 341");
      expect(state.config.autoSyncGcal).toBe(false);
    });

    it("reports honest error when Google Calendar sync is called in PWA mode", async () => {
      await expect(pwaRpcHandler("run_gcal_sync")).rejects.toThrow(
        "Calendar sync is unavailable in the browser companion tier — export .ics instead.",
      );
    });

    it("persists OAuth client IDs under the core's config keys so they survive a reload", async () => {
      // Regression: the browser tier wrote camelCase keys ("googleClientId")
      // while the state builder read snake_case ("google_client_id"), so a
      // saved client ID never came back and the sign-in kept asking for one.
      await pwaRpcHandler("update_config", {
        update: {
          googleClientId: "browser-google-client.apps.googleusercontent.com",
          teamsClientId: "11111111-2222-3333-4444-555555555555",
        },
      });

      const state = await pwaRpcHandler<GetStatePayload>("get_state");
      expect(state.config.googleClientId).toBe("browser-google-client.apps.googleusercontent.com");
      expect(state.config.teamsClientId).toBe("11111111-2222-3333-4444-555555555555");
    });

    it("generates secret-free backup payload", async () => {
      const backupJson = await pwaRpcHandler<string>("export_backup_file");
      const backup = JSON.parse(backupJson);
      expect(backup.schema_version).toBe(1);
      expect(backup.tier).toBe("pwa");
      // Security rule: No tokens or secrets in backup
      expect(backupJson).not.toContain("refresh_token");
      expect(backupJson).not.toContain("client_secret");
    });

    it("exports the schedule in the core's snake_case shape (backup contract)", async () => {
      await pwaRpcHandler("save_schedule", {
        schedule: {
          semester: "Fall 2026",
          courses: [{ id: "CSE241", name: "Digital Design", color: "#1a73e8" }],
          slots: [
            {
              id: "slot-1",
              day: "Friday",
              dayIndex: 5,
              courseId: "CSE241",
              courseName: "Digital Design",
              type: "Lecture",
              room: "Room 301",
              startTime: "09:00",
              endTime: "10:30",
              displayTime: "09:00 – 10:30",
            },
          ],
        },
      });

      const backup = JSON.parse(await pwaRpcHandler<string>("export_backup_file"));
      const slot = backup.schedule.slots[0];
      expect(slot.course_id).toBe("CSE241");
      expect(slot.day_index).toBe(5);
      expect(slot.start_time).toBe("09:00");
      expect(slot.end_time).toBe("10:30");
      // No camelCase leftovers in the exported contract.
      expect(slot.courseId).toBeUndefined();
      expect(slot.dayIndex).toBeUndefined();
    });

    it("upgrades a legacy camelCase-only slot so the WASM core can read it", async () => {
      // Older browser builds stored camelCase slots only; the WASM core needs
      // the snake_case contract, so the store adds the twins on read.
      const { upsertCourse, saveScheduleData } = await import("./pwadapters/idbStore");
      await upsertCourse({ id: "CSE241", name: "Digital Design", color: "#1a73e8" });
      await saveScheduleData({
        semester: "Fall 2026",
        courses: [{ id: "CSE241", name: "Digital Design", color: "#1a73e8" }],
        slots: [
          {
            id: "slot-legacy",
            day: "Friday",
            dayIndex: 5,
            courseId: "CSE241",
            courseName: "Digital Design",
            type: "Lecture",
            room: "Room 301",
            startTime: "09:00",
            endTime: "10:30",
            displayTime: "09:00 – 10:30",
          } as never,
        ],
      });

      // get_state runs the WASM dashboard/task derivation over the schedule.
      const state = await pwaRpcHandler<GetStatePayload>("get_state");
      expect(state.schedule.slots).toHaveLength(1);
      expect(state.schedule.slots[0].courseId).toBe("CSE241");
      expect(state.schedule.slots[0].dayIndex).toBe(5);
    });
  });

  describe("3. Service Worker & Offline Precache", () => {
    it("sw.js precaches WASM binary, manifest, and includes honest 503 offline response", () => {
      const swPath = path.resolve(process.cwd(), "public/sw.js");
      expect(fs.existsSync(swPath)).toBe(true);

      const swContent = fs.readFileSync(swPath, "utf8");

      // Precaching checks
      expect(swContent).toContain("/wasm/quizradar_wasm_bg.wasm");
      expect(swContent).toContain("/wasm/quizradar_wasm.js");
      expect(swContent).toContain("/manifest.webmanifest");
      expect(swContent).toContain("/icons/radar.svg");

      // Version prefix — derived from the stamped app version (single source
      // of truth: tooling/version.json), never a hardcoded literal.
      expect(swContent).toContain(`quizradar-v${APP_VERSION}`);

      // Offline 503 response
      expect(swContent).toContain("Offline — QuizRadar is in local mode");
      expect(swContent).toContain("503");
    });

    it("manifest.webmanifest specifies standalone portrait and valid icons", () => {
      const manifestPath = path.resolve(process.cwd(), "public/manifest.webmanifest");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

      expect(manifest.name).toBe("QuizRadar");
      expect(manifest.display).toBe("standalone");
      expect(manifest.orientation).toBe("portrait");
      expect(manifest.theme_color).toBe("#0b0f19");
      expect(manifest.icons.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("4. Platform Help & Capability Matrix View", () => {
    it("renders capability matrix documenting desktop, android, and pwa companionship limits", () => {
      render(<HelpView />);

      expect(screen.getByText("Platform Capabilities & Companion Help")).toBeInTheDocument();

      // Tier overview cards
      expect(screen.getByText("Desktop Tier")).toBeInTheDocument();
      expect(screen.getByText("Android Tier")).toBeInTheDocument();
      expect(screen.getByText("PWA Companion Tier")).toBeInTheDocument();

      // Capability matrix table
      expect(screen.getByText("Per-Tier Capability Matrix")).toBeInTheDocument();
      expect(screen.getByText("Pure Rust WASM")).toBeInTheDocument();
      expect(screen.getByText(/Unavailable · Export/)).toBeInTheDocument();

      // iOS Instructions
      expect(screen.getByText("Add to Home Screen (iOS / iPadOS)")).toBeInTheDocument();
      expect(screen.getByText("1. Open in Safari")).toBeInTheDocument();
      expect(screen.getByText("2. Tap Share")).toBeInTheDocument();
      expect(screen.getByText("3. Add to Home")).toBeInTheDocument();
      expect(screen.getByText("4. Launch App")).toBeInTheDocument();
    });
  });
});
