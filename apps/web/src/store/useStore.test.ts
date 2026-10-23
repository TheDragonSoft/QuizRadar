import { describe, expect, it } from "vitest";
import { useStore } from "./useStore";

describe("useStore stub", () => {
  it("starts on the dashboard view and switches honestly", () => {
    useStore.setState({ view: "dashboard" });
    expect(useStore.getState().view).toBe("dashboard");
    useStore.getState().setView("calendar");
    expect(useStore.getState().view).toBe("calendar");
  });
});
