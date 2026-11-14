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
});
