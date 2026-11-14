import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssessmentDetailModal } from "./AssessmentDetailModal";
import { useAppStore, initialFullState } from "../state/store";
import { setupMockIndexedDb } from "../test/mockIndexedDb";
import type { Assessment } from "../state/types";

const baseAssessment: Assessment = {
  id: "a-math-midterm",
  courseId: "MAT102",
  courseName: "Calculus II",
  title: "Midterm Examination",
  assessmentType: "Midterm Exam",
  dateIso: "2026-11-14",
  displayTime: "Saturday, 14 November 2026 (9:30 AM – 10:30 AM)",
  startTime: "09:30",
  endTime: "10:30",
  room: "Hall A",
  instructor: "Dr. Alan Turing",
  isUpcoming: true,
  daysUntil: 3,
  urgencyLevel: "high",
  priorityScore: 88,
  topics: ["Integration by Parts", "Taylor Series"],
  warnings: [],
  source: "Gmail",
  emailSubject: "MAT102 Midterm Details",
  emailSentDate: "2026-11-11",
  gcalSynced: false,
  achievedScore: null,
  maxScore: 20,
  weightagePercent: 30,
};

describe("AssessmentDetailModal Honesty Doctrine & Date Formatting", () => {
  let teardownIdb: () => void;

  beforeEach(() => {
    teardownIdb = setupMockIndexedDb();
  });

  afterEach(() => {
    teardownIdb();
    vi.restoreAllMocks();
  });

  it("uses neutral Study Priority & Roadmap heading when rationale is deterministic only", () => {
    useAppStore.setState({
      data: {
        ...initialFullState,
        schedule: {
          semester: "Fall 2026",
          courses: [{ id: "MAT102", name: "Calculus II", color: "#10b981" }],
          slots: [],
        },
        assessments: [baseAssessment],
        dashboard: {
          ...initialFullState.dashboard,
          studyRecommendations: [
            {
              assessmentId: "a-math-midterm",
              courseId: "MAT102",
              title: "Midterm Examination",
              assessmentType: "Midterm Exam",
              daysUntil: 3,
              urgencyLevel: "high",
              priorityScore: 88,
              progressPercent: 0,
              whyStudyNow: "Deterministic rank based on 3-day proximity and 2 remaining topics.",
              topics: [],
            },
          ],
        },
      },
    });

    const { container } = render(
      <AssessmentDetailModal
        modalId="assessment-detail"
        props={{ assessmentId: "a-math-midterm" }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Study Priority & Roadmap")).toBeInTheDocument();
    expect(screen.getByText("Deterministic Planner")).toBeInTheDocument();
    expect(screen.queryByText("AI Reasoning & Study Roadmap")).not.toBeInTheDocument();
    expect(screen.queryByText("AI-Verified")).not.toBeInTheDocument();
    expect(container.querySelector(".lucide-sparkles")).toBeNull();
  });

  it("shows AI Reasoning & Study Roadmap and AI-Verified when real AI output exists", () => {
    useAppStore.setState({
      data: {
        ...initialFullState,
        schedule: {
          semester: "Fall 2026",
          courses: [{ id: "MAT102", name: "Calculus II", color: "#10b981" }],
          slots: [],
        },
        assessments: [
          {
            ...baseAssessment,
            aiInferenceNote: "Resolved 'next Friday' relative to Nov 11 announcement.",
            aiStudyPlan: "Review Taylor Series remainder bounds tonight.",
          },
        ],
      },
    });

    const { container } = render(
      <AssessmentDetailModal
        modalId="assessment-detail"
        props={{ assessmentId: "a-math-midterm" }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("AI Reasoning & Study Roadmap")).toBeInTheDocument();
    expect(screen.getByText("AI-Verified")).toBeInTheDocument();
    expect(screen.queryByText("Study Priority & Roadmap")).not.toBeInTheDocument();
    expect(container.querySelector(".lucide-sparkles")).not.toBeNull();
  });

  it("does not mislabel Manual entry provenance as AI-Verified", () => {
    useAppStore.setState({
      data: {
        ...initialFullState,
        schedule: {
          semester: "Fall 2026",
          courses: [{ id: "MAT102", name: "Calculus II", color: "#10b981" }],
          slots: [],
        },
        assessments: [
          {
            ...baseAssessment,
            aiInferenceNote: "Manual entry",
          },
        ],
      },
    });

    render(
      <AssessmentDetailModal
        modalId="assessment-detail"
        props={{ assessmentId: "a-math-midterm" }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText("AI-Verified")).not.toBeInTheDocument();
    expect(screen.queryByText("AI Reasoning & Study Roadmap")).not.toBeInTheDocument();
    expect(screen.getByText("Study Priority & Roadmap")).toBeInTheDocument();
  });

  it("renders full exam Date & Time without truncation, formats ISO email date, and clarifies weight badge", () => {
    useAppStore.setState({
      data: {
        ...initialFullState,
        schedule: {
          semester: "Fall 2026",
          courses: [{ id: "MAT102", name: "Calculus II", color: "#10b981" }],
          slots: [],
        },
        assessments: [
          {
            ...baseAssessment,
            achievedScore: 17,
          },
        ],
      },
    });

    render(
      <AssessmentDetailModal
        modalId="assessment-detail"
        props={{ assessmentId: "a-math-midterm" }}
        onClose={vi.fn()}
      />,
    );

    const fullDateNode = screen.getByText("Saturday, 14 November 2026 (9:30 AM – 10:30 AM)");
    expect(fullDateNode).toBeInTheDocument();
    expect(fullDateNode.className).not.toContain("truncate");

    expect(screen.getByText("Nov 11, 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-11-11")).not.toBeInTheDocument();

    expect(screen.getByText("Recorded: 17/20 (30% weight)")).toBeInTheDocument();
  });
});
