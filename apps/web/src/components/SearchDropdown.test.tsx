/**
 * The top-bar search is the app-wide search (01 §4.8): typing must re-render
 * the dashboard and the week calendar. The query used to live only inside the
 * input's local state — `setSearchQuery` was defined in the store but never
 * called, so nothing downstream ever filtered.
 *
 * These tests pin the wiring: the input feeds the store, the clear button
 * empties it, and Escape drops it.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SearchDropdown } from "./SearchDropdown";
import { useAppStore, initialFullState } from "../state/store";

describe("TopBar search dropdown", () => {
  beforeEach(() => {
    useAppStore.setState({
      data: initialFullState,
      openModals: [],
      searchQuery: "",
    });
  });

  it("publishes the typed query to the store so the views can filter", () => {
    render(<SearchDropdown />);
    const input = screen.getByRole("combobox");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "bio" } });

    expect(useAppStore.getState().searchQuery).toBe("bio");
  });

  it("clears the store query when the query is cleared", () => {
    render(<SearchDropdown />);
    const input = screen.getByRole("combobox");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "bio" } });
    fireEvent.click(screen.getByLabelText(/clear search/i));

    expect(useAppStore.getState().searchQuery).toBe("");
  });

  it("drops the store query on Escape", () => {
    render(<SearchDropdown />);
    const input = screen.getByRole("combobox");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "bio" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(useAppStore.getState().searchQuery).toBe("");
  });
});
