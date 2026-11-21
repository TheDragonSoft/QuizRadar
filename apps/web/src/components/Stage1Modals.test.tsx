import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import type { AxeResults } from "axe-core";
import { SyllabusPreviewModal } from "./SyllabusPreviewModal";
import { CoursePackShareModal } from "./CoursePackShareModal";
import { CoursePackImportModal } from "./CoursePackImportModal";
import { encodeCoursePackBrowser } from "../lib/coursePack";
import { initialFullState, useAppStore } from "../state/store";
import { setupMockIndexedDb } from "../test/mockIndexedDb";
import type { DesktopExtractedSyllabi, GetStatePayload } from "../state/types";

declare module "vitest" {
  interface Assertion<T> {
    toHaveNoViolations(): T;
  }
}

expect.extend(toHaveNoViolations);

async function audit(container: HTMLElement): Promise<AxeResults> {
  const results = await axe(container, {
    rules: {
      region: { enabled: false },
    },
  });
  return results as unknown as AxeResults;
}

describe("Stage 1 Growth Modals (Syllabus Preview, Course Pack Share & Import)", () => {
  let teardownIdb: () => void;

  beforeEach(() => {
    teardownIdb = setupMockIndexedDb();
    useAppStore.setState({
      data: JSON.parse(JSON.stringify(initialFullState)) as GetStatePayload,
      theme: "solar",
    });
  });

  afterEach(() => {
    teardownIdb();
    vi.restoreAllMocks();
  });

  it("renders SyllabusPreviewModal with honest drops/TBA, applies bundle, and offers 1-tap Share", async () => {
    const extracted: DesktopExtractedSyllabi = {
      schedule: {
        semester: "Fall 2026",
        courses: [
          {
            id: "ECE210",
            name: "Digital Systems",
            color: "#1a73e8",
            credits: 3,
            aliases: ["ECE 210"],
          },
        ],
        slots: [
          {
            id: "slot-1",
            day: "Mon",
            dayIndex: 1,
            courseId: "ECE210",
            courseName: "Digital Systems",
            type: "Lecture",
            room: "EE-301",
            startTime: "10:00",
            endTime: "11:30",
            displayTime: "10:00–11:30",
            hasQuiz: false,
            quizTitle: null,
          },
        ],
      },
      assessments: [
        {
          courseId: "ECE210",
          title: "Midterm Exam",
          assessmentType: "Midterm Exam",
          dateIso: "2026-11-05",
          weightagePercent: 30,
          topics: ["Logic Gates"],
          warnings: [],
        },
        {
          courseId: "ECE210",
          title: "Final Project",
          assessmentType: "Assignment",
          dateIso: null,
          weightagePercent: 25,
          topics: [],
          warnings: [],
        },
      ],
      droppedCourses: 0,
      droppedSlots: 1,
      droppedAssessments: 0,
      model: "gemini-3-flash-preview",
      fileErrors: ["lab-notes.png: illegible header"],
    };

    const openShareCoursePack = vi.fn();
    useAppStore.setState({ openShareCoursePack });

    const { container } = render(
      <SyllabusPreviewModal modalId="syllabus-preview" props={{ extracted }} onClose={vi.fn()} />,
    );

    expect(screen.getByText(/Digital Systems/)).toBeInTheDocument();
    expect(
      screen.getByText(/Honest notice: 0 course row\(s\), 1 slot\(s\), and 0 assessment\(s\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/lab-notes\.png/i)).toBeInTheDocument();
    expect(screen.getByText(/Date TBA/i)).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();

    expect(await audit(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole("button", { name: /Add Selected to Radar/i }));

    await waitFor(() => {
      expect(screen.getByText(/Syllabi Added to Your Radar/i)).toBeInTheDocument();
    });
    expect(useAppStore.getState().data.schedule.courses.map((c) => c.id)).toContain("ECE210");

    fireEvent.click(screen.getByRole("button", { name: /Share ECE210 Course Pack/i }));
    expect(openShareCoursePack).toHaveBeenCalledWith("ECE210");
  });

  it("renders CoursePackShareModal with privacy badge, HTTPS link, and QR matrix (axe clean)", async () => {
    const exported = await encodeCoursePackBrowser(
      "ECE210",
      {
        semester: "Fall 2026",
        courses: [{ id: "ECE210", name: "Digital Systems", color: "#1a73e8", credits: 3 }],
        slots: [],
      },
      [],
    );
    const exportCoursePack = vi.fn().mockResolvedValue(exported);
    useAppStore.setState({ exportCoursePack });

    const { container } = render(
      <CoursePackShareModal
        modalId="course-pack-share"
        props={{ courseId: "ECE210" }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("img", { name: /QR code for ECE210 Course Pack/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/never included/i)).toBeInTheDocument();
    expect((screen.getByLabelText("Classmate Share Link") as HTMLInputElement).value).toContain(
      "#course=",
    );
    expect(await audit(container)).toHaveNoViolations();
  });

  it("renders CoursePackImportModal from a shared link, marks onboarding complete, and merges into store", async () => {
    const exported = await encodeCoursePackBrowser(
      "ECE210",
      {
        semester: "Fall 2026",
        courses: [{ id: "ECE210", name: "Digital Systems", color: "#1a73e8", credits: 3 }],
        slots: [
          {
            id: "slot-1",
            day: "Tue",
            dayIndex: 2,
            courseId: "ECE210",
            courseName: "Digital Systems",
            type: "Lecture",
            room: null,
            startTime: "10:00",
            endTime: "11:30",
            displayTime: "10:00–11:30",
            hasQuiz: false,
            quizTitle: null,
          },
        ],
      },
      [],
    );

    const onClose = vi.fn();
    const { container } = render(
      <CoursePackImportModal
        modalId="course-pack-import"
        props={{ rawInput: exported.links.web_url }}
        onClose={onClose}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add Course to My Radar/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/ECE210 — Digital Systems/)).toBeInTheDocument();
    expect(await audit(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole("button", { name: /Add Course to My Radar/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(useAppStore.getState().data.schedule.courses.map((c) => c.id)).toContain("ECE210");
    expect(useAppStore.getState().data.config.onboardingCompleted).toBe(true);
  });
});
