import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OnboardingWizardModal } from "./OnboardingWizardModal";
import { useAppStore, initialFullState } from "../state/store";
import { setupMockIndexedDb } from "../test/mockIndexedDb";

describe("OnboardingWizardModal Appearance Theme Picker", () => {
  let teardownIdb: () => void;

  beforeEach(() => {
    teardownIdb = setupMockIndexedDb();
    useAppStore.setState({
      data: initialFullState,
      theme: "solar",
    });
  });

  afterEach(() => {
    teardownIdb();
    vi.restoreAllMocks();
  });

  it("renders all three concrete Observatory themes and updates theme selection", () => {
    render(<OnboardingWizardModal modalId="onboarding" onClose={vi.fn()} />);

    const solarBtn = screen.getByRole("button", { name: /Solar Dawn \(Light\)/i });
    const obsidianBtn = screen.getByRole("button", { name: /Obsidian Cosmic \(Dark\)/i });
    const amoledBtn = screen.getByRole("button", { name: /AMOLED Cosmic Stardust/i });

    expect(solarBtn).toHaveAttribute("aria-pressed", "true");
    expect(obsidianBtn).toHaveAttribute("aria-pressed", "false");
    expect(amoledBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(obsidianBtn);
    expect(useAppStore.getState().theme).toBe("obsidian");

    fireEvent.click(amoledBtn);
    expect(useAppStore.getState().theme).toBe("amoled-nebula");

    fireEvent.click(solarBtn);
    expect(useAppStore.getState().theme).toBe("solar");
  });

  it("displays welcoming Get Started guidance in step 1", () => {
    render(<OnboardingWizardModal modalId="onboarding" onClose={vi.fn()} />);
    expect(screen.getByText(/Get Started:/i)).toBeInTheDocument();
  });

  it("tucks Moodle URLs under progressive disclosure in step 2 and offers 1-tap Course Pack sharing in step 3", () => {
    const openShareCoursePack = vi.fn();
    const onClose = vi.fn();
    useAppStore.setState({
      data: {
        ...initialFullState,
        schedule: {
          ...initialFullState.schedule,
          courses: [
            {
              id: "ECE210",
              name: "Digital Systems",
              color: "#1a73e8",
              credits: 3,
              aliases: [],
            },
          ],
        },
      },
      openShareCoursePack,
    });

    render(<OnboardingWizardModal modalId="onboarding" onClose={onClose} />);

    // Step 1 -> Step 2: Moodle URLs sit inside a collapsed <details> disclosure.
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    const advancedSummary = screen.getByText(/Advanced:.*Moodle/i);
    expect(advancedSummary.closest("details")).not.toHaveAttribute("open");

    // Step 2 -> Step 3: Viral 1-tap Course Pack share card appears for enrolled courses.
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(
      screen.getByText(/Your semester is mapped! Share a course with your classmates in 1 tap\?/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Share ECE210/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(openShareCoursePack).toHaveBeenCalledWith("ECE210");
  });
});
