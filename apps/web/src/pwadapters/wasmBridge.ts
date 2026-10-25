/**
 * Bridge to QuizRadar's WASM engine (`QuizRadarWasm`).
 * Handles initialization in both browser environments (via fetch) and
 * test/Node environments (via fs).
 */

import initWasm, { initSync, QuizRadarWasm } from "../../public/wasm/quizradar_wasm.js";

let wasmInstance: QuizRadarWasm | null = null;
let initPromise: Promise<QuizRadarWasm> | null = null;

export async function getWasmEngine(): Promise<QuizRadarWasm> {
  if (wasmInstance) return wasmInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const isTestOrNode =
      typeof process !== "undefined" &&
      (Boolean(process.env?.VITEST) ||
        typeof (process as unknown as { versions?: { node?: string } }).versions?.node !==
          "undefined");

    if (!isTestOrNode) {
      // Real browser environment
      await initWasm({ module_or_path: "/wasm/quizradar_wasm_bg.wasm" });
    } else {
      // Node.js / Vitest / JSDOM environment
      const fs = await import(/* @vite-ignore */ "node:fs");
      const path = await import(/* @vite-ignore */ "node:path");
      const cwd = process.cwd();
      const wasmPath = path.resolve(
        cwd,
        cwd.endsWith("web")
          ? "public/wasm/quizradar_wasm_bg.wasm"
          : "apps/web/public/wasm/quizradar_wasm_bg.wasm",
      );
      const wasmBuffer = fs.readFileSync(wasmPath);
      initSync({ module: wasmBuffer });
    }
    wasmInstance = new QuizRadarWasm();
    return wasmInstance;
  })();

  return initPromise;
}

export function resetWasmEngineForTest(): void {
  wasmInstance = null;
  initPromise = null;
}
