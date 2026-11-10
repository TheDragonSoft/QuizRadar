import { describe, it, expect, beforeEach } from "vitest";
import { hasLegacyPositionalKeys, loadCachedState, saveCachedState, SWR_CACHE_KEY } from "./swr";
import { isLegacyPositionalTopicKey } from "../pwadapters/idbStore";
import type { GetStatePayload } from "./types";
import { initialFullState } from "./store";

describe("SWR legacy positional topic key detection & cache invalidation", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("isLegacyPositionalTopicKey correctly identifies pre-v3 positional keys vs content keys", () => {
    expect(isLegacyPositionalTopicKey("quiz-1::0")).toBe(true);
    expect(isLegacyPositionalTopicKey("exam-2026::12")).toBe(true);
    expect(isLegacyPositionalTopicKey("course-a::999")).toBe(true);

    // Modern content keys or malformed keys should not be considered legacy positional
    expect(isLegacyPositionalTopicKey("quiz-1::binary-search")).toBe(false);
    expect(isLegacyPositionalTopicKey("exam-2026::chapter_1_basics")).toBe(false);
    expect(isLegacyPositionalTopicKey("not_a_key")).toBe(false);
    expect(isLegacyPositionalTopicKey("")).toBe(false);
    expect(isLegacyPositionalTopicKey("quiz-1::0::extra")).toBe(false);
  });

  it("hasLegacyPositionalKeys detects legacy keys in studyTasksPayload", () => {
    const cleanPayload: GetStatePayload = {
      ...initialFullState,
      studyTasksPayload: {
        totalTasks: 1,
        pendingTasks: 1,
        completedTasks: 0,
        aiGenerated: false,
        days: [
          {
            dayOffset: 0,
            date: "2026-11-01",
            displayDay: "Nov 1",
            isToday: false,
            tasks: [
              {
                id: "t1",
                key: "quiz-1::recursion",
                assessmentId: "quiz-1",
                title: "Study Recursion",
                courseId: "CS101",
                courseName: "CS",
                topicTitle: "Recursion",
                topicIndex: 0,
                dayOffset: 0,
                priorityRank: 1,
                reasoning: "Study Recursion",
                completed: false,
              },
            ],
          },
        ],
        readinessCards: [],
      },
    };

    expect(hasLegacyPositionalKeys(cleanPayload)).toBe(false);

    const legacyPayload: GetStatePayload = {
      ...cleanPayload,
      studyTasksPayload: {
        ...cleanPayload.studyTasksPayload,
        days: [
          {
            dayOffset: 0,
            date: "2026-11-01",
            displayDay: "Nov 1",
            isToday: false,
            tasks: [
              {
                id: "t1",
                key: "quiz-1::0",
                assessmentId: "quiz-1",
                title: "Study Recursion",
                courseId: "CS101",
                courseName: "CS",
                topicTitle: "Recursion",
                topicIndex: 0,
                dayOffset: 0,
                priorityRank: 1,
                reasoning: "Study Recursion",
                completed: false,
              },
            ],
          },
        ],
      },
    };

    expect(hasLegacyPositionalKeys(legacyPayload)).toBe(true);
  });

  it("hasLegacyPositionalKeys detects legacy keys in dashboard study recommendations", () => {
    const legacyRecPayload: GetStatePayload = {
      ...initialFullState,
      dashboard: {
        ...initialFullState.dashboard,
        studyRecommendations: [
          {
            assessmentId: "quiz-1",
            title: "Quiz 1",
            assessmentType: "Quiz",
            courseId: "CS101",
            courseName: "Intro to CS",
            dateIso: "2026-11-05",
            urgencyLevel: "high",
            daysUntil: 3,
            priorityScore: 80,
            topics: [
              {
                title: "Trees",
                topicIndex: 0,
                completed: false,
                key: "quiz-1::2",
              },
            ],
            whyStudyNow: "Coming soon",
          },
        ],
      },
    };

    expect(hasLegacyPositionalKeys(legacyRecPayload)).toBe(true);
  });

  it("loadCachedState returns null when cached payload contains legacy positional keys", () => {
    const legacyPayload: GetStatePayload = {
      ...initialFullState,
      dashboard: {
        ...initialFullState.dashboard,
        studyRecommendations: [
          {
            assessmentId: "quiz-1",
            title: "Quiz 1",
            assessmentType: "Quiz",
            courseId: "CS101",
            courseName: "Intro to CS",
            dateIso: "2026-11-05",
            urgencyLevel: "high",
            daysUntil: 3,
            priorityScore: 80,
            topics: [
              {
                title: "Trees",
                topicIndex: 0,
                completed: false,
                key: "quiz-1::0",
              },
            ],
            whyStudyNow: "Coming soon",
          },
        ],
      },
    };

    saveCachedState(legacyPayload);
    expect(window.localStorage.getItem(SWR_CACHE_KEY)).toBeTruthy();
    expect(loadCachedState()).toBeNull();
  });

  it("loadCachedState returns parsed snapshot when no legacy positional keys are present", () => {
    const cleanPayload: GetStatePayload = {
      ...initialFullState,
      assessments: [
        {
          id: "quiz-1",
          courseId: "CS101",
          courseName: "Intro to CS",
          title: "Quiz 1",
          assessmentType: "Class Quiz",
          dateIso: "2026-11-05",
          dayName: "Thursday",
          startTime: "09:00",
          endTime: "10:00",
          displayTime: "09:00 – 10:00",
          room: "101",
          isUpcoming: true,
          daysUntil: 3,
          urgencyLevel: "high",
          priorityScore: 80,
          topics: ["Trees"],
          warnings: [],
          source: "email",
        },
      ],
    };

    saveCachedState(cleanPayload);
    const loaded = loadCachedState();
    expect(loaded).not.toBeNull();
    expect(loaded?.assessments).toHaveLength(1);
    expect(loaded?.assessments[0].id).toBe("quiz-1");
  });
});
