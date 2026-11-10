import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateEditAssessmentModal } from "./CreateEditAssessmentModal";
import { useAppStore, initialFullState } from "../state/store";
import type { Assessment, Course } from "../state/types";
import { copy } from "../copy";

const sampleCourses: Course[] = [
  {
    id: "CS101",
    name: "Intro to Computer Science",
    color: "#4f46e5",
  },
  {
    id: "MATH201",
    name: "Linear Algebra",
    color: "#059669",
  },
];

const sampleAssessment: Assessment = {
  id: "test-quiz-1",
  courseId: "CS101",
  courseName: "Intro to Computer Science",
  title: "Midterm 1",
  assessmentType: "Midterm Exam",
  dateIso: "2026-11-15",
  dayName: "Sunday",
  startTime: "10:00",
  endTime: "11:30",
  displayTime: "10:00 – 11:30",
  room: "Room 301",
  instructor: "Dr. Turing",
  isUpcoming: true,
  daysUntil: 10,
  urgencyLevel: "medium",
  priorityScore: 75,
  topics: ["Recursion", "Sorting"],
  warnings: [],
  source: "email",
};

describe("CreateEditAssessmentModal", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      data: {
        ...initialFullState,
        schedule: {
          ...initialFullState.schedule,
          courses: sampleCourses,
        },
        assessments: [sampleAssessment],
      },
    });
  });

  it("renders the creation modal with correct title, honesty placeholders, and provenance chip", () => {
    render(<CreateEditAssessmentModal modalId="create-edit-assessment" onClose={onClose} />);

    expect(
      screen.getByRole("heading", { name: copy.assessmentModal.titleAdd }),
    ).toBeInTheDocument();
    // Provenance chip for new manual assessment
    expect(screen.getByText(copy.assessmentModal.provenanceManual)).toBeInTheDocument();

    // Check placeholder for optional honesty doctrine fields
    const roomInput = screen.getByLabelText(/room/i);
    expect(roomInput).toHaveAttribute("placeholder", copy.assessmentModal.noValuePlaceholder);

    const instructorInput = screen.getByLabelText(/instructor/i);
    expect(instructorInput).toHaveAttribute("placeholder", copy.assessmentModal.noValuePlaceholder);
  });

  it("submits a new assessment with honesty doctrine null values when room/instructor omitted", async () => {
    const upsertSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ upsertAssessment: upsertSpy });

    render(<CreateEditAssessmentModal modalId="create-edit-assessment" onClose={onClose} />);

    // Course select
    fireEvent.change(screen.getByLabelText(/course/i), { target: { value: "MATH201" } });

    // Title input
    fireEvent.change(screen.getByLabelText(/assessment title/i), { target: { value: "Quiz 2" } });

    // Date
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: "2026-11-20" } });

    // Leave room and instructor completely empty

    // Submit form
    fireEvent.click(screen.getByRole("button", { name: copy.assessmentModal.saveAssessment }));

    await waitFor(() => {
      expect(upsertSpy).toHaveBeenCalledTimes(1);
    });

    const saved = upsertSpy.mock.calls[0][0] as Assessment;
    expect(saved.courseId).toBe("MATH201");
    expect(saved.title).toBe("Quiz 2");
    expect(saved.dateIso).toBe("2026-11-20");
    // Honesty doctrine: omitted room and instructor must be null (not fabricated empty string or filler)
    expect(saved.room).toBeNull();
    expect(saved.instructor).toBeNull();
    expect(saved.source).toBe("Custom");
    expect(onClose).toHaveBeenCalled();
  });

  it("pre-fills fields when editing existing assessment and shows edited provenance", async () => {
    render(
      <CreateEditAssessmentModal
        modalId="create-edit-assessment"
        props={{ assessment: sampleAssessment }}
        onClose={onClose}
      />,
    );

    expect(
      screen.getByRole("heading", { name: copy.assessmentModal.titleEdit }),
    ).toBeInTheDocument();
    expect(screen.getByText(copy.assessmentModal.provenanceEdited)).toBeInTheDocument();

    expect(screen.getByLabelText(/assessment title/i)).toHaveValue("Midterm 1");
    expect(screen.getByLabelText(/room/i)).toHaveValue("Room 301");
    expect(screen.getByLabelText(/instructor/i)).toHaveValue("Dr. Turing");
  });

  it("calls deleteAssessment when clicking delete in edit mode", async () => {
    const deleteSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ deleteAssessment: deleteSpy });

    render(
      <CreateEditAssessmentModal
        modalId="create-edit-assessment"
        props={{ assessment: sampleAssessment }}
        onClose={onClose}
      />,
    );

    const deleteBtn = screen.getByRole("button", { name: copy.assessmentModal.deleteAssessment });
    expect(deleteBtn).toBeInTheDocument();

    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("test-quiz-1");
    });
    expect(onClose).toHaveBeenCalled();
  });
});
