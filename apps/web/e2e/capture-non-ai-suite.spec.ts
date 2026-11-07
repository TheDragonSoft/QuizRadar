import { test } from "@playwright/test";
import { bootApp } from "./helpers/app";
import { LIGHT_PROJECT } from "./helpers/theme";
import * as path from "node:path";
import * as fs from "node:fs";

const OUTPUT_DIR = path.resolve(process.cwd(), "docs/screenshots/non-ai-suite");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== LIGHT_PROJECT,
    "Showcase captures run once on the light project.",
  );
});

test("capture non-ai suite showcase mock app screenshots", async ({ page }) => {
  await bootApp(page, "dark");

  // Seed rich academic snapshot into __QUIZRADAR_STORE__
  await page.evaluate(() => {
    const store = (window as any).__QUIZRADAR_STORE__;
    if (!store) return;

    const sampleCourses = [
      { id: "CS301", name: "Data Structures & Algorithms", instructor: "Prof. Dijkstra", credits: 4, targetGrade: "A" },
      { id: "MATH220", name: "Linear Algebra & Differential Eq", instructor: "Prof. Gauss", credits: 4, targetGrade: "A-" },
      { id: "PHYS150", name: "University Physics: Mechanics", instructor: "Prof. Newton", credits: 3, targetGrade: "B+" },
      { id: "ENG102", name: "Technical Writing & Ethics", instructor: "Prof. Orwell", credits: 2, targetGrade: "A" },
    ];

    const sampleSlots = [
      { id: "slot-1", courseId: "CS301", courseName: "Data Structures", day: "Monday", startTime: "10:00", endTime: "11:30", room: "Hall B-101", type: "Lecture" },
      { id: "slot-2", courseId: "MATH220", courseName: "Linear Algebra", day: "Monday", startTime: "13:00", endTime: "14:30", room: "Turing 204", type: "Lecture" },
      { id: "slot-3", courseId: "PHYS150", courseName: "Physics", day: "Tuesday", startTime: "09:00", endTime: "10:30", room: "Science 310", type: "Lecture" },
      { id: "slot-4", courseId: "CS301", courseName: "Data Structures Lab", day: "Wednesday", startTime: "14:00", endTime: "16:00", room: "Lab C-12", type: "Lab" },
      { id: "slot-5", courseId: "ENG102", courseName: "Tech Writing", day: "Thursday", startTime: "11:00", endTime: "12:30", room: "Humanities 105", type: "Seminar" },
    ];

    // Dates relative to October 29, 2026 (the fixed baseline time)
    const sampleAssessments = [
      {
        id: "asm-1",
        title: "Midterm Exam: Trees, Graphs & Dynamic Programming",
        courseId: "CS301",
        courseName: "Data Structures & Algorithms",
        assessmentType: "exam",
        dateIso: "2026-11-03",
        startTime: "10:00",
        endTime: "12:00",
        displayTime: "10:00 - 12:00",
        room: "Auditorium A",
        requiredStudyHours: 18,
        topics: [
          { id: "t1", title: "Binary Search Trees & AVL Balancing", completed: true },
          { id: "t2", title: "Dijkstra & Prim Graph Algorithms", completed: true },
          { id: "t3", title: "Memoization & DP Table Optimization", completed: false },
          { id: "t4", title: "Amortized Analysis & Fibonacci Heaps", completed: false },
        ],
      },
      {
        id: "asm-2",
        title: "Quiz 3: Eigenvalues & Matrix Diagonalization",
        courseId: "MATH220",
        courseName: "Linear Algebra",
        assessmentType: "quiz",
        dateIso: "2026-11-02",
        startTime: "13:00",
        endTime: "14:00",
        displayTime: "13:00 - 14:00",
        room: "Turing 204",
        requiredStudyHours: 8,
        topics: [
          { id: "t5", title: "Characteristic Polynomials & Determinants", completed: true },
          { id: "t6", title: "Eigenspaces & Geometric Multiplicity", completed: false },
        ],
      },
      {
        id: "asm-3",
        title: "Lab Practical: Conservation of Momentum",
        courseId: "PHYS150",
        courseName: "Physics",
        assessmentType: "practical",
        dateIso: "2026-11-06",
        startTime: "09:00",
        endTime: "11:00",
        displayTime: "09:00 - 11:00",
        room: "Science 310",
        requiredStudyHours: 6,
        topics: [
          { id: "t7", title: "Elastic and Inelastic Collisions", completed: true },
        ],
      },
    ];

    const sampleFlashcards = [
      {
        id: "fc-1",
        courseId: "CS301",
        question: "What is the worst-case time complexity of lookup in an unbalanced BST vs an AVL tree?",
        answer: "Unbalanced BST: O(n) when degenerated into a linked list. AVL Tree: Strictly guaranteed O(log n) via rotations.",
        box: 3,
        reviewCount: 4,
        nextReviewDate: "2026-10-30",
      },
      {
        id: "fc-2",
        courseId: "MATH220",
        question: "Under what exact condition is an n x n square matrix diagonalizable?",
        answer: "It must have n linearly independent eigenvectors (or the sum of dimensions of its eigenspaces equals n).",
        box: 2,
        reviewCount: 2,
        nextReviewDate: "2026-10-29",
      },
      {
        id: "fc-3",
        courseId: "PHYS150",
        question: "In an inelastic collision between two isolated bodies, which quantities are conserved?",
        answer: "Total linear momentum is always conserved; kinetic energy is NOT conserved (dissipated as thermal/sound energy).",
        box: 1,
        reviewCount: 1,
        nextReviewDate: "2026-10-29",
      },
    ];

    const sampleMistakes = [
      {
        id: "mst-1",
        question: "Failed to perform a double left-right rotation when balance factor was +2 and left child was -1.",
        userAnswer: "Performed single right rotation",
        correctAnswer: "Left rotate left child first, then right rotate root node",
        courseId: "CS301",
        timestamp: "2026-10-28T16:30:00Z",
        resolved: false,
      },
      {
        id: "mst-2",
        question: "Assumed zero eigenvalue means matrix has no inverse.",
        userAnswer: "False",
        correctAnswer: "True: det(A) = product of eigenvalues = 0, so A is singular",
        courseId: "MATH220",
        timestamp: "2026-10-27T11:15:00Z",
        resolved: true,
      },
    ];

    store.setState((prev: any) => ({
      ...prev,
      data: {
        ...prev.data,
        schedule: {
          ...prev.data.schedule,
          semester: "Fall 2026",
          courses: sampleCourses,
          slots: sampleSlots,
        },
        assessments: sampleAssessments,
      },
      flashcards: sampleFlashcards,
      mistakes: sampleMistakes,
      gradingScale: "4.0",
      studyStreakDays: 6,
      studyMinutesByCourse: {
        CS301: 420,
        MATH220: 280,
        PHYS150: 190,
        ENG102: 60,
      },
    }));
  });

  await page.waitForTimeout(600);

  // 1. Desktop: Calendar View (Dual-Pane with Cushion Deficit & Roadmap)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("topbar-view-switcher").getByRole("tab", { name: "Calendar", exact: true }).click();
  await page.waitForSelector('[data-testid="calendar-split-container"]', { state: "visible" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-01-calendar-dual-pane.png") });

  // 2. Desktop: Tasks View -> Grade Center Tab (GPA 4 Scales, Distribution, What-If)
  await page.getByTestId("topbar-view-switcher").getByRole("tab", { name: "Tasks", exact: true }).click();
  await page.waitForSelector('[data-testid="tasks-view"]', { state: "visible" });
  await page.getByRole("button", { name: /Grade Center/i }).click();
  await page.waitForSelector('[data-testid="gpa-summary-card"]', { state: "visible" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-02-grade-center-gpa.png") });

  // 3. Desktop: Focus View (Leitner Flashcard Review, Mistake Bank & Study Timer)
  await page.getByTestId("topbar-view-switcher").getByRole("tab", { name: "Focus", exact: true }).click();
  await page.waitForSelector('[data-testid="focus-view"]', { state: "visible" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-03-focus-flashcards-mistakes.png") });

  // 4. Desktop: Settings View (Canvas/Blackboard LMS Guides & Week A/B Parity)
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.waitForSelector('[data-testid="view-settings"]', { state: "visible" });
  // Scroll to LMS Feeds
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="settings-lms-guides"]');
    if (el) el.scrollIntoView({ behavior: "instant" });
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-04-settings-lms-guides.png") });

  // 5. Mobile Viewport (Android 412x915): Calendar View (Agenda Mode with Attendance Tracker)
  await page.setViewportSize({ width: 412, height: 915 });
  await page.getByRole("button", { name: "Back to dashboard" }).click();
  await page.waitForTimeout(300);
  await page.getByTestId("topbar-view-switcher").getByRole("tab", { name: "Calendar", exact: true }).click();
  await page.waitForSelector('[data-testid="calendar-agenda-view"]', { state: "visible" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "mobile-01-calendar-agenda-attendance.png") });

  // 6. Mobile Viewport (Android 412x915): Focus Analytics & Study Streak
  await page.getByTestId("topbar-view-switcher").getByRole("tab", { name: "Focus", exact: true }).click();
  await page.waitForSelector('[data-testid="focus-view"]', { state: "visible" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "mobile-02-focus-analytics-streak.png") });

  // 7. Mobile Viewport (Android 412x915): Mobile Grade Center
  await page.getByTestId("topbar-view-switcher").getByRole("tab", { name: "Tasks", exact: true }).click();
  await page.waitForSelector('[data-testid="tasks-view"]', { state: "visible" });
  await page.getByRole("button", { name: /Grade Center/i }).click();
  await page.waitForSelector('[data-testid="gpa-summary-card"]', { state: "visible" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "mobile-03-grade-center-mobile.png") });
});
