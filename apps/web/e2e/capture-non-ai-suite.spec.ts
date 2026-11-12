import { test } from "@playwright/test";
import { bootApp } from "./helpers/app";
import { LIGHT_PROJECT } from "./helpers/theme";
import * as path from "node:path";
import * as fs from "node:fs";

// OPT-IN capture script (run via `pnpm e2e:showcase`). Output lands in the
// untracked staging dir unless the operator explicitly points
// QUIZRADAR_SHOWCASE_DIR at a tracked folder — a run in this repo must never
// rewrite `docs/screenshots/` as a side effect.
const REPO_DOCS = process.env.QUIZRADAR_SHOWCASE_DIR
  ? path.resolve(process.env.QUIZRADAR_SHOWCASE_DIR)
  : path.resolve(process.cwd(), "e2e-results/showcase/non-ai-suite");

if (!fs.existsSync(REPO_DOCS)) {
  fs.mkdirSync(REPO_DOCS, { recursive: true });
}

async function saveScreen(page: any, name: string) {
  const target = path.join(REPO_DOCS, name);
  await page.screenshot({ path: target });
}

// Seed shapes mirror the CURRENT app state schema (apps/web/src/state/types.ts):
// Course.color, ScheduleSlot.dayIndex/displayTime, Assessment
// urgencyLevel/priorityScore/warnings/source/topics: string[],
// Flashcard.front/back/boxLevel and the MistakeItem
// questionText/options/selectedIndex/correctIndex/explanation shape.
const sampleCourses = [
  { id: "CS301", name: "Data Structures & Algorithms", color: "#3b82f6", credits: 4 },
  { id: "MATH220", name: "Linear Algebra & Differential Eq", color: "#f59e0b", credits: 4 },
  { id: "PHYS150", name: "University Physics: Mechanics", color: "#10b981", credits: 3 },
  { id: "ENG102", name: "Technical Writing & Ethics", color: "#8b5cf6", credits: 2 },
];

const sampleSlots = [
  {
    id: "slot-1",
    courseId: "CS301",
    courseName: "Data Structures",
    day: "Monday",
    dayIndex: 1,
    startTime: "10:00",
    endTime: "11:30",
    displayTime: "10:00 - 11:30",
    room: "Hall B-101",
    type: "Lecture",
  },
  {
    id: "slot-2",
    courseId: "MATH220",
    courseName: "Linear Algebra",
    day: "Monday",
    dayIndex: 1,
    startTime: "13:00",
    endTime: "14:30",
    displayTime: "13:00 - 14:30",
    room: "Turing 204",
    type: "Lecture",
  },
  {
    id: "slot-3",
    courseId: "PHYS150",
    courseName: "Physics",
    day: "Tuesday",
    dayIndex: 2,
    startTime: "09:00",
    endTime: "10:30",
    displayTime: "09:00 - 10:30",
    room: "Science 310",
    type: "Lecture",
  },
  {
    id: "slot-4",
    courseId: "CS301",
    courseName: "Data Structures Lab",
    day: "Wednesday",
    dayIndex: 3,
    startTime: "14:00",
    endTime: "16:00",
    displayTime: "14:00 - 16:00",
    room: "Lab C-12",
    type: "Lab",
  },
  {
    id: "slot-5",
    courseId: "ENG102",
    courseName: "Tech Writing",
    day: "Thursday",
    dayIndex: 4,
    startTime: "11:00",
    endTime: "12:30",
    displayTime: "11:00 - 12:30",
    room: "Humanities 105",
    type: "Seminar",
  },
];

const sampleAssessments = [
  {
    id: "asm-1",
    title: "Midterm Exam: Trees, Graphs & Dynamic Programming",
    courseId: "CS301",
    courseName: "Data Structures & Algorithms",
    assessmentType: "exam",
    dateIso: "2026-11-03",
    isUpcoming: true,
    startTime: "10:00",
    endTime: "12:00",
    displayTime: "10:00 - 12:00",
    room: "Auditorium A",
    requiredStudyHours: 18,
    urgencyLevel: "high",
    priorityScore: 90,
    warnings: [],
    source: "showcase",
    topics: [
      "Binary Search Trees & AVL Balancing",
      "Dijkstra & Prim Graph Algorithms",
      "Memoization & DP Table Optimization",
      "Amortized Analysis & Fibonacci Heaps",
    ],
  },
  {
    id: "asm-2",
    title: "Quiz 3: Eigenvalues & Matrix Diagonalization",
    courseId: "MATH220",
    courseName: "Linear Algebra",
    assessmentType: "quiz",
    dateIso: "2026-11-02",
    isUpcoming: true,
    startTime: "13:00",
    endTime: "14:00",
    displayTime: "13:00 - 14:00",
    room: "Turing 204",
    requiredStudyHours: 8,
    urgencyLevel: "high",
    priorityScore: 80,
    warnings: [],
    source: "showcase",
    topics: ["Characteristic Polynomials & Determinants", "Eigenspaces & Geometric Multiplicity"],
  },
  {
    id: "asm-3",
    title: "Lab Practical: Conservation of Momentum",
    courseId: "PHYS150",
    courseName: "Physics",
    assessmentType: "practical",
    dateIso: "2026-11-06",
    isUpcoming: true,
    startTime: "09:00",
    endTime: "11:00",
    displayTime: "09:00 - 11:00",
    room: "Science 310",
    requiredStudyHours: 6,
    urgencyLevel: "medium",
    priorityScore: 60,
    warnings: [],
    source: "showcase",
    topics: ["Elastic and Inelastic Collisions"],
  },
];

const sampleFlashcards = [
  {
    id: "fc-1",
    courseId: "CS301",
    topic: "Binary Search Trees & AVL Balancing",
    front: "What is the worst-case time complexity of lookup in an unbalanced BST vs an AVL tree?",
    back: "Unbalanced BST: O(n) when degenerated into a linked list. AVL Tree: Strictly guaranteed O(log n) via rotations.",
    boxLevel: 3,
    reviewCount: 4,
    nextReviewIso: "2026-10-30",
  },
  {
    id: "fc-2",
    courseId: "MATH220",
    topic: "Eigenspaces & Geometric Multiplicity",
    front: "Under what exact condition is an n x n square matrix diagonalizable?",
    back: "It must have n linearly independent eigenvectors (or the sum of dimensions of its eigenspaces equals n).",
    boxLevel: 2,
    reviewCount: 2,
    nextReviewIso: "2026-10-29",
  },
  {
    id: "fc-3",
    courseId: "PHYS150",
    topic: "Elastic and Inelastic Collisions",
    front: "In an inelastic collision between two isolated bodies, which quantities are conserved?",
    back: "Total linear momentum is always conserved; kinetic energy is NOT conserved (dissipated as thermal/sound energy).",
    boxLevel: 1,
    reviewCount: 1,
    nextReviewIso: "2026-10-29",
  },
];

const sampleMistakes = [
  {
    id: "mst-1",
    assessmentId: "asm-1",
    courseId: "CS301",
    topic: "Binary Search Trees & AVL Balancing",
    questionId: "mst-1-q",
    questionText:
      "Failed to perform a double left-right rotation when balance factor was +2 and left child was -1.",
    options: [
      "Left rotate left child first, then right rotate root node",
      "Performed single right rotation",
    ],
    selectedIndex: 1,
    correctIndex: 0,
    explanation:
      "A balance factor of +2 with a left child of -1 is the LR case: rotate the left child left, then the root right.",
    timestamp: "2026-10-28T16:30:00Z",
    resolved: false,
  },
  {
    id: "mst-2",
    assessmentId: "asm-2",
    courseId: "MATH220",
    topic: "Characteristic Polynomials & Determinants",
    questionId: "mst-2-q",
    questionText: "Assumed zero eigenvalue means matrix has no inverse.",
    options: ["True: det(A) = product of eigenvalues = 0, so A is singular", "False"],
    selectedIndex: 1,
    correctIndex: 0,
    explanation: "A zero eigenvalue makes the determinant zero, so the matrix is singular.",
    timestamp: "2026-10-27T11:15:00Z",
    resolved: true,
  },
];

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== LIGHT_PROJECT,
    "Showcase captures run once on the light project.",
  );
});

test("capture desktop non-ai suite showcase", async ({ page }) => {
  test.setTimeout(180_000);

  await bootApp(page, "dark");

  // Seed data. Store keys that no longer exist (`studyStreakDays`,
  // `studyMinutesByCourse`) were removed — study metrics now come from the
  // localStorage ledger key `quizradar_local_study_stats_v1`
  // (apps/web/src/lib/studyStats.ts), which is seeded below and announced via
  // the same event the app itself dispatches on a recorded session.
  await page.evaluate(
    ({ courses, slots, assessments, flashcards, mistakes, studyStats }: any) => {
      const store = (window as any).__QUIZRADAR_STORE__;
      if (!store) return;
      store.setState((prev: any) => ({
        ...prev,
        data: {
          ...prev.data,
          dashboard: {
            ...(prev.data?.dashboard || {}),
            studyRecommendations: [],
          },
          schedule: {
            ...prev.data.schedule,
            semester: "Fall 2026",
            courses,
            slots,
          },
          assessments,
        },
        flashcards,
        mistakeBank: mistakes,
        gradingScale: "4.0",
      }));
      localStorage.setItem("quizradar_local_study_stats_v1", JSON.stringify(studyStats));
      window.dispatchEvent(new Event("quizradar:study-stats-updated"));
    },
    {
      courses: sampleCourses,
      slots: sampleSlots,
      assessments: sampleAssessments,
      flashcards: sampleFlashcards,
      mistakes: sampleMistakes,
      studyStats: {
        totalMinutes: 950,
        totalSessions: 23,
        dailyMinutes: {
          "2026-10-23": 120,
          "2026-10-24": 95,
          "2026-10-25": 140,
          "2026-10-26": 160,
          "2026-10-27": 150,
          "2026-10-28": 165,
          "2026-10-29": 120,
        },
        lastUpdated: "2026-10-29",
      },
    },
  );

  await page.waitForTimeout(400);

  // Set widescreen viewport
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  // 1. Calendar View
  await page
    .getByTestId("topbar-view-switcher")
    .getByRole("tab", { name: "Calendar", exact: true })
    .click();
  await page.waitForSelector('[data-testid="calendar-view"]', { state: "visible" });
  await page.waitForTimeout(500);
  await saveScreen(page, "desktop-01-calendar-week-grid.png");

  // 2. Tasks View -> Daily Study Roadmap
  await page
    .getByTestId("topbar-view-switcher")
    .getByRole("tab", { name: "Tasks", exact: true })
    .click();
  await page.waitForSelector('[data-testid="tasks-view"]', { state: "visible" });
  await page.waitForTimeout(500);
  await saveScreen(page, "desktop-02-tasks-study-roadmap.png");

  // 3. Tasks View -> Grade Center Tab
  await page.getByTestId("tab-grades").click();
  await page.waitForSelector('[data-testid="gpa-summary-card"]', { state: "visible" });
  await page.waitForTimeout(500);
  await saveScreen(page, "desktop-03-grade-center-gpa.png");

  // 4. Focus View
  await page.getByTestId("sidebar-nav-focus").click();
  await page.waitForSelector('[data-testid="focus-view"]', { state: "visible" });
  await page.waitForTimeout(500);
  await saveScreen(page, "desktop-04-focus-flashcards-mistakes.png");

  // 5. Settings View
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.waitForSelector('[data-testid="view-settings"]', { state: "visible" });
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="settings-canvas-card"]');
    if (el) el.scrollIntoView({ behavior: "instant" });
  });
  await page.waitForTimeout(500);
  await saveScreen(page, "desktop-05-settings-lms-guides.png");

  // Mobile Viewport Captures
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(400);

  // 6. Mobile Calendar View
  await page.getByTestId("mobilenav-calendar").click();
  await page.waitForSelector('[data-testid="calendar-view"]', { state: "visible" });
  await page.waitForTimeout(500);
  await saveScreen(page, "mobile-01-calendar-view.png");

  // 7. Mobile Grade Center
  await page.getByTestId("mobilenav-tasks").click();
  await page.waitForSelector('[data-testid="tasks-view"]', { state: "visible" });
  await page.getByTestId("tab-grades").click();
  await page.waitForSelector('[data-testid="gpa-summary-card"]', { state: "visible" });
  await page.waitForTimeout(500);
  await saveScreen(page, "mobile-02-tasks-grade-center.png");

  // 8. Mobile Focus View
  await page.getByTestId("mobilenav-focus").click();
  await page.waitForSelector('[data-testid="focus-view"]', { state: "visible" });
  await page.waitForTimeout(500);
  await saveScreen(page, "mobile-03-focus-analytics-streak.png");
});
