import { describe, it, expect, vi } from "vitest";
import { applyOptimistic } from "./optimistic";

describe("applyOptimistic framework", () => {
  it("synchronously calls optimistic update and resolves on successful network operation", async () => {
    let localValue = 10;
    const addToast = vi.fn();
    const onSuccess = vi.fn();

    const result = await applyOptimistic(
      () => {
        localValue = 20; // optimistic change
      },
      async () => {
        return { success: true, serverValue: 20 };
      },
      () => {
        localValue = 10; // rollback
      },
      {
        addToast,
        onSuccess,
        successToast: "Saved!",
      },
    );

    expect(localValue).toBe(20);
    expect(result).toEqual({ success: true, serverValue: 20 });
    expect(onSuccess).toHaveBeenCalledWith({ success: true, serverValue: 20 });
    expect(addToast).toHaveBeenCalledWith({
      type: "success",
      message: "Saved!",
    });
  });

  it("triggers rollback and displays error toast when network operation fails", async () => {
    let localValue = 10;
    const addToast = vi.fn();

    const result = await applyOptimistic(
      () => {
        localValue = 99; // optimistic change
      },
      async () => {
        throw new Error("Network offline");
      },
      () => {
        localValue = 10; // rollback
      },
      {
        addToast,
        errorToast: "Failed to update item",
      },
    );

    expect(result).toBeNull();
    expect(localValue).toBe(10); // Restored!
    expect(addToast).toHaveBeenCalledWith({
      type: "error",
      message: "Failed to update item",
    });
  });
});
