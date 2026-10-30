import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { useAppStore, initialFullState } from "./state/store";

describe("App shell", () => {
  beforeEach(() => {
    useAppStore.setState({
      view: "dashboard",
      data: initialFullState,
      openModals: [],
      toasts: [],
    });
  });

  it("renders topbar, desktop sidebar, empty dashboard, and mobile nav", () => {
    render(<App />);
    expect(screen.getByTestId("app-topbar")).toBeInTheDocument();
    expect(screen.getByTestId("app-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("app-mobilenav")).toBeInTheDocument();
    expect(screen.getByTestId("view-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("empty-dashboard-no-courses")).toBeInTheDocument();
  });

  it("switches views and renders honest empty-state view content", () => {
    render(<App />);

    // v4 parity: the view switcher lives in the top bar, not the rail.
    const switcher = screen.getByTestId("topbar-view-switcher");
    const tasksBtn = screen.getByRole("tab", { name: /tasks/i });
    expect(switcher).toContainElement(tasksBtn);

    fireEvent.click(tasksBtn);

    expect(useAppStore.getState().view).toBe("tasks");
    expect(screen.getByTestId("view-tasks")).toBeInTheDocument();
    expect(screen.getByTestId("empty-tasks")).toBeInTheDocument();
  });
});
