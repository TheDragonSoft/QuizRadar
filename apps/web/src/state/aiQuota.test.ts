import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore, initialFullState } from "./store";
import { setRpcMockHandler } from "./rpc";

/**
 * The AI usage line in Settings used to render a hardcoded `0` and a
 * made-up `~250` denominator. It must now report what the device's own
 * ledger recorded — and say "not tracked" when the tier keeps no ledger,
 * rather than implying nothing was used.
 */
describe("AI quota usage (honest counter)", () => {
  beforeEach(() => {
    setRpcMockHandler(null);
    useAppStore.setState({
      data: {
        ...initialFullState,
        auth: { ...initialFullState.auth },
        config: { ...initialFullState.config },
      },
      aiQuota: null,
    });
  });

  it("shows the real number of calls the ledger recorded today", async () => {
    setRpcMockHandler(((fn: string) => {
      if (fn === "ai_quota_usage") {
        return Promise.resolve({
          callsToday: 3,
          perModel: { "gemini-3.5-flash-lite": 3 },
        });
      }
      return null;
    }) as never);

    await useAppStore.getState().refreshAiQuota();

    const quota = useAppStore.getState().aiQuota;
    expect(quota?.callsToday).toBe(3);
    expect(quota?.perModel["gemini-3.5-flash-lite"]).toBe(3);
  });

  it("reports 'not tracked' instead of a zero when the tier keeps no ledger", async () => {
    setRpcMockHandler(((fn: string) => {
      if (fn === "ai_quota_usage") {
        return Promise.resolve({ callsToday: null, perModel: {} });
      }
      return null;
    }) as never);

    await useAppStore.getState().refreshAiQuota();

    expect(useAppStore.getState().aiQuota?.callsToday).toBeNull();
  });

  it("never invents a zero when the ledger cannot be read", async () => {
    setRpcMockHandler(((fn: string) => {
      if (fn === "ai_quota_usage") return Promise.reject(new Error("no ledger"));
      return null;
    }) as never);

    await useAppStore.getState().refreshAiQuota();

    expect(useAppStore.getState().aiQuota?.callsToday).toBeNull();
  });

  it("keeps the session scope, so a session counter is never shown as a daily ledger", async () => {
    setRpcMockHandler(((fn: string) => {
      if (fn === "ai_quota_usage") {
        return Promise.resolve({
          callsToday: 2,
          perModel: { "gemini-3.5-flash": 2 },
          sessionScope: true,
          keyInMemory: true,
        });
      }
      return null;
    }) as never);

    await useAppStore.getState().refreshAiQuota();

    const quota = useAppStore.getState().aiQuota;
    expect(quota?.sessionScope).toBe(true);
    expect(quota?.keyInMemory).toBe(true);
  });

  it("keeps the 'no key in memory' signal the browser tier reports", async () => {
    setRpcMockHandler(((fn: string) => {
      if (fn === "ai_quota_usage") {
        return Promise.resolve({
          callsToday: 0,
          perModel: {},
          sessionScope: true,
          keyInMemory: false,
        });
      }
      return null;
    }) as never);

    await useAppStore.getState().refreshAiQuota();

    const quota = useAppStore.getState().aiQuota;
    expect(quota?.sessionScope).toBe(true);
    expect(quota?.keyInMemory).toBe(false);
  });
});
