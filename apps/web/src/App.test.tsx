import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { useStore } from "./store/useStore";

describe("App shell", () => {
  beforeEach(() => {
    useStore.setState({ view: "dashboard" });
  });

  it("renders all three view placeholders + the empty modal stack layer", () => {
    render(<App />);
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(document.querySelector("[data-testid='view-dashboard']")).toBeInTheDocument();
  });

  it("switches views via the nav stub and renders honest placeholder copy", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    fireEvent.click(within(nav).getByRole("button", { name: "Tasks" }));
    expect(useStore.getState().view).toBe("tasks");
    expect(document.querySelector("[data-testid='view-tasks']")).toBeInTheDocument();
    expect(screen.getByText(/Not wired yet — the readiness grid/i)).toBeInTheDocument();
  });
});
