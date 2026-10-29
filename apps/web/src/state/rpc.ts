/**
 * Typed RPC bridge between the web tier and desktop Tauri 2 shell (or mock/fallback).
 * Encapsulates Tauri's `@tauri-apps/api/core` invoke with environment awareness.
 */

import { isStatePayload, normalizeStatePayload } from "./ipcShape";

let mockHandler: (<T>(fn: string, args?: Record<string, unknown>) => Promise<T> | null) | null =
  null;

export function setRpcMockHandler(
  handler: (<T>(fn: string, args?: Record<string, unknown>) => Promise<T> | null) | null,
) {
  mockHandler = handler;
}

export function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * The core speaks snake_case, the UI speaks camelCase. Every state payload
 * that crosses the bridge is normalized here, so no view ever has to guess
 * which side produced it.
 */
function adaptResult<T>(result: T): T {
  if (isStatePayload(result)) {
    return normalizeStatePayload(result) as unknown as T;
  }
  return result;
}

export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (mockHandler) {
    const mocked = mockHandler<T>(fn, args);
    if (mocked !== null) {
      return adaptResult(await mocked);
    }
  }

  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return adaptResult(await invoke<T>(fn, args));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`RPC ${fn} failed: ${message}`);
    }
  }

  // Non-Tauri fallback (browser / PWA companion tier)
  const { pwaRpcHandler } = await import("../pwadapters/rpcAdapter");
  return adaptResult(await pwaRpcHandler<T>(fn, args));
}
