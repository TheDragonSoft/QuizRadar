import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SYNC_PROGRESS_EVENT } from "./ipcEvents";

/**
 * Cross-tier contract: the desktop shell emits the scan progress and the web
 * tier listens for it. The two live in different packages, so the event name
 * is pinned on both sides and asserted here.
 *
 * The bug this guards against: the shell emitted `source-progress` while the
 * overlay listened for `sync-progress`, so the overlay never received a
 * single pulse and sat on its staged "Connecting…" copy for the whole scan.
 */
describe("Scan progress event contract (desktop shell <-> web tier)", () => {
  const repoRoot = path.resolve(__dirname, "../../../..");
  const shellSource = readFileSync(
    path.join(repoRoot, "apps/desktop/src-tauri/src/commands/sync.rs"),
    "utf8",
  );

  it("the shell emits exactly the event the overlay listens for", () => {
    const eventConst = /pub const SYNC_PROGRESS_EVENT: &str = "([^"]+)";/.exec(shellSource);
    expect(eventConst).not.toBeNull();
    expect(eventConst![1]).toBe(SYNC_PROGRESS_EVENT);
  });

  it("the shell emits through the constant, not a hand-written name", () => {
    expect(shellSource).toContain("app_handle.emit(SYNC_PROGRESS_EVENT");
    // The old, mismatched name must not come back.
    expect(shellSource).not.toContain('"source-progress"');
  });

  it("the overlay subscribes to the pinned event name", () => {
    const overlay = readFileSync(
      path.join(repoRoot, "apps/web/src/components/ScanProgressModal.tsx"),
      "utf8",
    );
    expect(overlay).toContain("listen<ProgressPayload>(SYNC_PROGRESS_EVENT");
    expect(overlay).not.toContain('"source-progress"');
  });
});
