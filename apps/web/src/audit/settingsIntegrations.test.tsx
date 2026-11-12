/**
 * Behavior regressions for Settings → Integrations.
 *
 * 1. The destructive reset double-confirm must honestly name the FULL wipe
 *    scope. `resetDatabase` now purges flashcards, quiz history, the mistake
 *    bank, study stats, the legacy localStorage keys and the SWR snapshot on
 *    top of the schedule database — a dialog that only promised "courses and
 *    cached items" would hide data loss from the user (honesty doctrine,
 *    AGENTS §3 rule 1).
 * 2. Every form control in the section keeps an accessible name — the
 *    structural guard for the section the deslop edited.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SettingsIntegrationsSection } from "../views/settings/SettingsIntegrationsSection";
import { ModalStack } from "../components/ModalStack";
import { AppConfirmModal } from "../components/AppConfirmModal";
import { registerModal, type ModalComponent } from "../components/modalRegistry";
import { useAppStore, initialFullState } from "../state/store";
import type { GetStatePayload } from "../state/types";

registerModal("app-confirm", AppConfirmModal as unknown as ModalComponent);

function baseState(): GetStatePayload {
  return JSON.parse(JSON.stringify(initialFullState)) as GetStatePayload;
}

describe("Settings → Integrations", () => {
  beforeEach(() => {
    useAppStore.setState({
      data: baseState(),
      view: "settings",
      openModals: [],
      toasts: [],
    });
  });

  it("the destructive reset double-confirm names the full wipe scope", async () => {
    render(
      <>
        <SettingsIntegrationsSection />
        <ModalStack />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset All Local Data" }));

    // FIRST confirm too: a summary that only promised "courses and cached
    // data" would understate the wipe. Both dialogs come from the same
    // copy.ts scope statement, so neither can drift back to understatement.
    const firstDialog = await screen.findByRole("dialog", { name: "Reset All Local Data?" });
    expect(firstDialog).toHaveAttribute("aria-modal", "true");
    const firstMessage = firstDialog.textContent ?? "";
    for (const scope of [
      "courses",
      "timetable slots",
      "assessments",
      "cached items",
      "flashcards",
      "quiz history",
      "mistake bank",
      "study stats",
      "Permanently erase",
    ]) {
      expect(firstMessage, `first reset dialog must name "${scope}"`).toContain(scope);
    }

    fireEvent.click(screen.getByRole("button", { name: "Reset Everything" }));

    // Second (destructive) confirm: the honest, complete scope.
    const secondDialog = await screen.findByRole("dialog", { name: "Are you absolutely sure?" });
    const message = secondDialog.textContent ?? "";
    for (const scope of [
      "courses",
      "timetable slots",
      "assessments",
      "cached items",
      "flashcards",
      "quiz history",
      "mistake bank",
      "study stats",
      "permanently erased",
    ]) {
      expect(message, `reset dialog must name "${scope}"`).toContain(scope);
    }
  });

  it("labels every form control in the section", () => {
    const { container } = render(<SettingsIntegrationsSection />);

    const controls = Array.from(
      container.querySelectorAll<HTMLElement>("input, textarea, select"),
    ).filter((el) => (el as HTMLInputElement).type !== "hidden" && !el.closest("label"));

    const unnamed = controls.filter((el) => {
      if (el.id && container.querySelector(`label[for="${el.id}"]`)) return false;
      if (el.getAttribute("aria-label")?.trim()) return false;
      if (el.getAttribute("aria-labelledby")?.trim()) return false;
      return true;
    });

    expect(unnamed.map((el) => el.outerHTML)).toEqual([]);
  });
});
