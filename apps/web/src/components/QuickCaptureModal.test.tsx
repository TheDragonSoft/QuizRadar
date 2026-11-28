import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import type { AxeResults } from "axe-core";
import { QuickCaptureModal } from "./QuickCaptureModal";
import { initialFullState, useAppStore } from "../state/store";
import type { Assessment, GetStatePayload } from "../state/types";

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

describe("QuickCaptureModal (Stage 2 PR 3 — WhatsApp/Telegram/Discord ingest)", () => {
  beforeEach(() => {
    useAppStore.setState({
      data: JSON.parse(JSON.stringify(initialFullState)) as GetStatePayload,
      theme: "solar",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses forwarded text offline, shows honest preview, passes axe, and saves to radar", async () => {
    const resolved: Assessment = {
      id: "share-abc123",
      courseId: "ECE210",
      courseName: "Digital Systems",
      title: "Quiz 2",
      assessmentType: "Class Quiz",
      date: "2026-11-10",
      dateIso: "2026-11-10",
      startTime: "14:00",
      endTime: "15:30",
      room: "Eng 305",
      topics: ["Flip-Flops"],
      warnings: [],
      aiInferenceNote: "Estimated (local heuristic): next Tuesday tutorial",
      isUpcoming: true,
      urgencyLevel: "upcoming",
      priorityScore: 50,
    };

    const parseSharedAnnouncement = vi.fn().mockResolvedValue(resolved);
    const upsertAssessment = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();
    const onClose = vi.fn();

    useAppStore.setState({
      parseSharedAnnouncement,
      upsertAssessment,
      showToast,
    });

    const { container } = render(<QuickCaptureModal modalId="quick-capture" onClose={onClose} />);

    expect(await audit(container)).toHaveNoViolations();

    const textarea = screen.getByLabelText(/Announcement text/i);
    fireEvent.change(textarea, {
      target: { value: "ECE 210 Quiz 2 moved to next Tuesday tutorial" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Resolve Against Timetable/i }));

    await waitFor(() => {
      expect(parseSharedAnnouncement).toHaveBeenCalledWith(
        "ECE 210 Quiz 2 moved to next Tuesday tutorial",
      );
    });

    expect(await screen.findByDisplayValue("Quiz 2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ECE210")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Eng 305")).toBeInTheDocument();
    expect(await audit(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole("button", { name: /Add to Radar/i }));

    await waitFor(() => {
      expect(upsertAssessment).toHaveBeenCalledTimes(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
