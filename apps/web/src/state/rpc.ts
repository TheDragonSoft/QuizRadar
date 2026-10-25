/**
 * Typed RPC bridge between the web tier and desktop Tauri 2 shell (or mock/fallback).
 * Encapsulates Tauri's `@tauri-apps/api/core` invoke with environment awareness.
 */

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

export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (mockHandler) {
    const mocked = mockHandler<T>(fn, args);
    if (mocked !== null) {
      return mocked;
    }
  }

  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<T>(fn, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`RPC ${fn} failed: ${message}`);
    }
  }

  // Non-Tauri fallback (browser / headless / tests)
  throw new Error(`RPC call "${fn}" is not available in non-desktop environment`);
}
