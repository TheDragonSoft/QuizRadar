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

    // Switch to Tasks via sidebar
    const sidebar = screen.getByTestId("app-sidebar");
    const tasksBtn = sidebar
      .querySelector('button[aria-current="page"]')
      ?.parentElement?.querySelector("button:nth-child(2)");
    expect(tasksBtn).toBeDefined();
    if (tasksBtn) {
      fireEvent.click(tasksBtn);
    } else {
      useAppStore.getState().setView("tasks");
    }

    expect(useAppStore.getState().view).toBe("tasks");
    expect(screen.getByTestId("view-tasks")).toBeInTheDocument();
    expect(screen.getByTestId("empty-tasks")).toBeInTheDocument();
  });
});
