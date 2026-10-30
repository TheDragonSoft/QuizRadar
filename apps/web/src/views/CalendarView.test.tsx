import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CalendarView } from "./CalendarView";
import { useAppStore, initialFullState } from "../state/store";
import type { GetStatePayload } from "../state/types";

/**
 * v4-parity contract for the week calendar (v4-final:static/app.js
 * `renderWeekCalendar`): the gcal-card blocks, the 8 AM – 8 PM 12-hour
 * gutter, the day-header exam chips, and the honest "—" for a missing room.
 */
describe("CalendarView — v4 parity", () => {
  const sampleState: GetStatePayload = {
    ...initialFullState,
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
          displayTime: "09:00 - 10:30",
        },
      ],
    },
    assessments: [
      {
        id: "a-quiz-1",
        courseId: "CSE241",
        courseName: "Digital Design",
        title: "Quiz 1: Logic Gates",
        assessmentType: "Class Quiz",
        dateIso: "2026-10-23",
        startTime: "09:00",
        endTime: "09:45",
        room: null,
        isUpcoming: true,
        daysUntil: 2,
        urgencyLevel: "critical",
        priorityScore: 85,
        topics: [],
        warnings: [],
        source: "GMAIL",
      },
      {
        id: "a-mid-1",
        courseId: "CSE241",
        courseName: "Digital Design",
        title: "Midterm",
        assessmentType: "Midterm",
        dateIso: "2026-10-23",
        startTime: "14:00",
        endTime: "15:30",
        room: null,
        instructor: "Dr. Smith",
        isUpcoming: true,
        daysUntil: 2,
        urgencyLevel: "high",
        priorityScore: 70,
        topics: [],
        warnings: [],
        source: "GMAIL",
      },
    ],
    config: {
      ...initialFullState.config,
      customEvents: [
        {
          id: "custom-1",
          title: "Study Session",
          eventType: "Study Session",
          dateIso: "2026-10-23",
          startTime: "18:00",
          endTime: "19:30",
          room: null,
        },
      ],
    },
  };

  beforeEach(() => {
    useAppStore.setState({
      data: JSON.parse(JSON.stringify(sampleState)),
      currentWeekStart: "2026-10-18",
      selectedCalendarDate: "2026-10-23",
      selectedCourseIds: null,
      layers: { exams: true, classes: true },
      searchQuery: "",
    });
  });

  it("renders the v4 8 AM – 8 PM gutter with 12-hour labels", () => {
    render(<CalendarView />);
    const gutter = screen.getByTestId("calendar-time-gutter");
    expect(gutter).toBeInTheDocument();
    expect(gutter).toHaveTextContent("8 AM");
    expect(gutter).toHaveTextContent("12 PM");
    expect(gutter).toHaveTextContent("8 PM");
    // 13 hourly rows (8 → 20 inclusive), exactly like v4.
    expect(gutter.querySelectorAll(".hour-row")).toHaveLength(13);
  });

  it("renders v4 gcal-card blocks for the merged slot+exam, the standalone exam and the custom event", () => {
    const { container } = render(<CalendarView />);
    const cards = container.querySelectorAll(".gcal-card");
    // merged slot+quiz, standalone midterm, custom study session
    expect(cards.length).toBe(3);
    // v4 tints every card with the course palette and a solid border.
    const card = cards[0] as HTMLElement;
    expect(card.style.getPropertyValue("--card-bg-light")).not.toBe("");
    expect(card.style.borderColor).not.toBe("");
  });

  it("merges a slot and an assessment that share the course and start time (v4 rule)", () => {
    const { container } = render(<CalendarView />);
    const merged = container.querySelectorAll(".has-exam-glow");
    // The slot + quiz at 09:00 collapse into ONE merged block, and it glows.
    expect(merged.length).toBe(2);
    const mergedText = merged[0].textContent || "";
    expect(mergedText).toContain("CSE241");
    expect(mergedText).toContain("Quiz 1: Logic Gates");
    expect(mergedText).toContain("Class Quiz");
    // The slot's own room survives the merge, without a doubled "Room Room".
    expect(mergedText).toContain("Room 301");
    expect(mergedText).not.toContain("Room Room");
  });

  it("shows 12-hour times on the blocks (v4 formatCompactTime)", () => {
    const { container } = render(<CalendarView />);
    const text = container.textContent || "";
    expect(text).toContain("9am – 10:30am");
    expect(text).toContain("2pm – 3:30pm");
  });

  it("renders an honest em dash for a missing room (never a fabricated room)", () => {
    // Sweep fix: the room line is the dash alone — "Room —" (prefix above an
    // em-dash) was exactly the half-honest rendering this replaced.
    const { container } = render(<CalendarView />);
    const text = container.textContent || "";
    expect(text).toContain("Midterm— · Dr. Smith");
    expect(text).toContain("Study Session · —");
    expect(text).not.toContain("Room —");
    expect(text).not.toContain("Hall B-204");
    expect(text).not.toContain("TBA");
  });

  it("renders the per-day assessment chips in the day header (v4 overlay chips)", () => {
    const { container } = render(<CalendarView />);
    const chip = container.querySelector('[title="CSE241: Quiz 1: Logic Gates"]') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.style.backgroundColor).not.toBe("");
    expect(chip.textContent).toBe("CSE241: Quiz 1: Logic Gates");
  });

  it("opens the assessment detail when a merged block is clicked", () => {
    const openDetail = vi.fn();
    useAppStore.setState({ openAssessmentDetail: openDetail });
    const { container } = render(<CalendarView />);
    const merged = container.querySelector(".has-exam-glow") as HTMLElement;
    fireEvent.click(merged);
    expect(openDetail).toHaveBeenCalledWith("a-quiz-1");
  });

  it("renders the custom event with its type, an honest room dash and an inline delete", () => {
    const { container } = render(<CalendarView />);
    const cards = Array.from(container.querySelectorAll(".gcal-card"));
    const custom = cards.find((c) => (c.textContent || "").includes("Study Session"));
    expect(custom).toBeDefined();
    expect(custom?.textContent).toContain("Study Session · —");
    expect(custom?.querySelector('button[aria-label="Delete event"]')).toBeTruthy();
  });
});
