import { describe, expect, it } from "vitest";
import { useAppStore } from "./store";

describe("app store view switching", () => {
  it("starts on the dashboard view and switches honestly", () => {
    useAppStore.setState({ view: "dashboard" });
    expect(useAppStore.getState().view).toBe("dashboard");
    useAppStore.getState().setView("calendar");
    expect(useAppStore.getState().view).toBe("calendar");
  });
});
