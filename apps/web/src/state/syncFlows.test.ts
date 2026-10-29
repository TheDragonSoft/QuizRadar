import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore, initialFullState } from "./store";
import { setRpcMockHandler } from "./rpc";

/**
 * Regression coverage for the scan overlay flow:
 * - a finished scan must leave an honest, visible outcome (the overlay used
 *   to strand the user on a stale "Scanning…" stage with a Cancel button);
 * - a canceled scan must be reported as a cancellation, never as a failure,
 *   and must say that the data was left untouched.
 */
describe("Scan flows (overlay outcome + cancellation)", () => {
  beforeEach(() => {
    setRpcMockHandler(null);
    useAppStore.setState({
      data: {
        ...initialFullState,
        auth: { ...initialFullState.auth },
        config: { ...initialFullState.config },
      },
      toasts: [],
      syncStatus: "idle",
      syncOutcome: null,
      cancelRequested: false,
      openModals: [],
    });
  });

  it("keeps the honest counts and the source notes of a finished scan", async () => {
    setRpcMockHandler(((fn: string) => {
      if (fn === "run_sync") {
        return Promise.resolve({
          success: true,
          totalNew: 3,
          totalUpdated: 1,
          notes: ["Gmail: 3 announcements found"],
        });
      }
      if (fn === "get_state") return Promise.resolve(initialFullState);
      return null;
    }) as never);

    await useAppStore.getState().triggerSync();

    const outcome = useAppStore.getState().syncOutcome;
    expect(outcome?.status).toBe("success");
    expect(outcome?.totalNew).toBe(3);
    expect(outcome?.totalUpdated).toBe(1);
    expect(outcome?.notes).toContain("Gmail: 3 announcements found");

    const toast = useAppStore.getState().toasts.at(-1);
    expect(toast?.type).toBe("success");
    expect(toast?.message).toMatch(/3 new/);
    expect(toast?.message).toMatch(/1 updated/);
  });

  it("reports a failed scan with the backend's reason", async () => {
    setRpcMockHandler(((fn: string) => {
      if (fn === "run_sync") return Promise.reject(new Error("Gmail said no"));
      return null;
    }) as never);

    await useAppStore.getState().triggerSync();

    const outcome = useAppStore.getState().syncOutcome;
    expect(outcome?.status).toBe("error");
    expect(outcome?.message).toMatch(/Gmail said no/);

    const toast = useAppStore.getState().toasts.at(-1);
    expect(toast?.type).toBe("error");
  });

  it("aborts the running scan and reports it as a cancellation, not a failure", async () => {
    let rejectRun: (reason: Error) => void = () => {};
    const runPromise = new Promise<never>((_resolve, reject) => {
      rejectRun = reject;
    });
    let cancelCalled = false;

    setRpcMockHandler(((fn: string) => {
      if (fn === "run_sync") return runPromise;
      if (fn === "cancel_sync") {
        cancelCalled = true;
        return Promise.resolve(null);
      }
      return null;
    }) as never);

    const scan = useAppStore.getState().triggerSync();
    expect(useAppStore.getState().syncStatus).toBe("syncing");

    await useAppStore.getState().cancelSync();
    expect(cancelCalled).toBe(true);
    expect(useAppStore.getState().cancelRequested).toBe(true);

    // The backend aborts the scan and the pending call rejects.
    rejectRun(new Error("Scan canceled - your data was left untouched."));
    await scan;

    const outcome = useAppStore.getState().syncOutcome;
    expect(outcome?.status).toBe("canceled");
    expect(useAppStore.getState().syncStatus).toBe("idle");

    const toast = useAppStore.getState().toasts.at(-1);
    expect(toast?.type).toBe("info");
    expect(toast?.message).toMatch(/left untouched/i);
  });

  it("does not abort anything when no scan is running", async () => {
    let cancelCalled = false;
    setRpcMockHandler(((fn: string) => {
      if (fn === "cancel_sync") {
        cancelCalled = true;
        return Promise.resolve(null);
      }
      return null;
    }) as never);

    await useAppStore.getState().cancelSync();

    expect(cancelCalled).toBe(false);
    expect(useAppStore.getState().cancelRequested).toBe(false);
  });
});
