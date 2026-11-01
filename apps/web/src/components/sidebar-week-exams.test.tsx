import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useAppStore, initialFullState } from "../state/store";
import { copy } from "../copy";
import { Sidebar } from "./Sidebar";
import { assessmentKind } from "../lib/assessmentKind";
import type { GetStatePayload } from "../state/types";

/**
 * The rail's week panel (`sidebar-week-exams`). v4 titled it "Exams in
 * Selected Week" while listing quizzes and assignments alike, printed the
 * course code twice per row, and gave every row a dangling "—" room line.
 * These tests pin the honest, kind-differentiated replacement.
 */
describe("Sidebar week assessments panel", () => {
  const sampleState: GetStatePayload = {
    ...initialFullState,
    schedule: {
      semester: "Fall 2026",
      courses: [
        { id: "CSE263", name: "Data Structures", color: "#00acc1" },
        { id: "GSE211", name: "Engineering Graphics", color: "#ea8600" },
      ],
      slots: [],
    },
    assessments: [
      {
        id: "a-quiz",
        courseId: "CSE263",
        courseName: "Data Structures",
        title: "CSE263: In-Class Assessment 1",
        assessmentType: "Class Quiz",
        dateIso: "2026-11-01",
        dayName: "Sunday",
        startTime: "09:30",
        room: null,
        isUpcoming: true,
        urgencyLevel: "medium",
        priorityScore: 60,
        topics: [],
        warnings: [],
        source: "Gmail",
      },
      {
        id: "a-assignment",
        courseId: "GSE211",
        courseName: "Engineering Graphics",
        title: "GSE211: In-Class Assignment 4",
        assessmentType: "Assignment",
        dateIso: "2026-11-04",
        dayName: "Wednesday",
        startTime: "11:00",
        room: null,
        isUpcoming: true,
        urgencyLevel: "medium",
        priorityScore: 55,
        topics: [],
        warnings: [],
        source: "Gmail",
      },
      {
        id: "a-assignment-room",
        courseId: "CSE263",
        courseName: "Data Structures",
        title: "CSE263: Portfolio Submission",
        assessmentType: "Assignment",
        dateIso: "2026-11-05",
        dayName: "Thursday",
        startTime: "23:59",
        room: "Room B-402",
        isUpcoming: true,
        urgencyLevel: "medium",
        priorityScore: 55,
        topics: [],
        warnings: [],
        source: "Moodle",
      },
      {
        id: "a-courseless-exam",
        courseId: null,
        courseName: null,
        title: "Midterm Exam",
        assessmentType: "Midterm Exam",
        dateIso: "2026-11-07",
        dayName: "Saturday",
        startTime: "14:00",
        room: null,
        isUpcoming: true,
        urgencyLevel: "high",
        priorityScore: 90,
        topics: [],
        warnings: [],
        source: "Gmail",
      },
    ],
  };

  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        data: JSON.parse(JSON.stringify(sampleState)),
        view: "dashboard",
        selectedCourseIds: null,
        currentWeekStart: "2026-11-01",
        selectedCalendarDate: "2026-11-04",
        activeModalAssessmentId: null,
      });
    });
  });

  it("titles the panel honestly — it holds every assessment kind, not only exams", () => {
    render(<Sidebar />);
    expect(screen.getByText(copy.sidebar.weekExamsTitle)).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-week-exam-count")).toHaveTextContent("4");
  });

  // Round 7: the mini-calendar's arrows move the panel to ANY week, so the
  // title must not claim "this week" — the panel names the exact dates.
  it("names the exact week the panel lists instead of claiming 'this week'", () => {
    render(<Sidebar />);
    expect(screen.getByTestId("sidebar-week-exam-range")).toHaveTextContent("Nov 1 – Nov 7");
    expect(copy.sidebar.weekExamsTitle).not.toMatch(/this week/i);
  });

  it("moves the range with the selected week", () => {
    render(<Sidebar />);
    act(() => {
      useAppStore.setState({ currentWeekStart: "2026-10-25" });
    });
    expect(screen.getByTestId("sidebar-week-exam-range")).toHaveTextContent("Oct 25 – Oct 31");
  });

  it("differentiates quiz, assignment and exam kinds per row", () => {
    render(<Sidebar />);
    expect(screen.getByTestId("week-exam-kind-quiz")).toHaveTextContent("Quiz");
    expect(screen.getAllByTestId("week-exam-kind-assignment")).toHaveLength(2);
    expect(screen.getAllByTestId("week-exam-kind-assignment")[0]).toHaveTextContent("Assignment");
    expect(screen.getByTestId("week-exam-kind-exam")).toHaveTextContent("Exam");
  });

  it("strips the course-code prefix the row already shows above the title", () => {
    render(<Sidebar />);
    // The stripped title renders; the full stored title survives only as tooltip.
    expect(screen.getByText("In-Class Assessment 1")).toBeInTheDocument();
    const row = screen.getByText("In-Class Assessment 1").closest("button");
    expect(row?.textContent).not.toContain("CSE263: In-Class Assessment 1");
    expect(screen.getByText("Portfolio Submission")).toBeInTheDocument();
  });

  it("leads courseless rows with the title — never a bold '—' course placeholder", () => {
    render(<Sidebar />);
    const courselessRow = screen.getByText("Midterm Exam").closest("button");
    expect(courselessRow).not.toBeNull();
    expect(courselessRow?.textContent).toContain("Exam");
    // The only "—" allowed is the honest unknown-room slot inside a meta line.
    expect(courselessRow?.textContent).not.toMatch(/^—/);
  });

  it("shares one meta line between day/time and the room (dash = honest unknown)", () => {
    render(<Sidebar />);
    expect(screen.getByText("Sunday 09:30 · —")).toBeInTheDocument();
    expect(screen.getByText("Thursday 23:59 · Room B-402")).toBeInTheDocument();
    expect(screen.getByText("Saturday 14:00 · —")).toBeInTheDocument();
  });

  it("opens the assessment detail from a row click", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText("In-Class Assessment 1"));
    expect(useAppStore.getState().activeModalAssessmentId).toBe("a-quiz");
  });
});

describe("assessmentKind ladder (mirrors core from_import_label)", () => {
  it("maps the six core labels onto the four families", () => {
    expect(assessmentKind("Class Quiz")).toBe("quiz");
    expect(assessmentKind("Online Quiz")).toBe("quiz");
    expect(assessmentKind("Midterm Exam")).toBe("exam");
    expect(assessmentKind("Final Exam")).toBe("exam");
    expect(assessmentKind("Lab Assessment")).toBe("lab");
    expect(assessmentKind("Assignment")).toBe("assignment");
  });

  it("falls back through the same keyword ladder the core uses", () => {
    expect(assessmentKind("final")).toBe("exam");
    expect(assessmentKind("Quiz 3")).toBe("quiz");
    expect(assessmentKind("lab session")).toBe("lab");
    expect(assessmentKind("homework assignment")).toBe("assignment");
    // The ladder's default rung — an unclassified assessment is a quiz.
    expect(assessmentKind("")).toBe("quiz");
    expect(assessmentKind(null)).toBe("quiz");
  });
});
