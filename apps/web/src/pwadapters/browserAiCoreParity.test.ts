/**
 * Contract-style freshness pins between the browser AI tier and the Rust core.
 *
 * The browser tier MUST restate `core/src/ai/tasks.rs::TIMETABLE_INSTRUCTION`
 * (the PWA has no Tauri IPC, so the network call lives in TS) and
 * `core/src/ai/provider.rs`'s Flash model ladder. Nothing else keeps the two
 * in sync, so this test reads the Rust sources directly and fails when they
 * drift — the same pattern the wire-map contract tests use.
 *
 * ONE documented, allow-listed deviation: the core prompt's example course is
 * the v4 demo id "CS101" (`03-issues` demo-universe list), which the web
 * antipatterns scan bans from `apps/web/src` — so the browser copy uses the
 * neutral placeholder "ECE210"/"Digital Systems". The test normalizes ONLY
 * that example text before comparing; every honesty rule byte must match.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FLASH_MODEL_IDS, TIMETABLE_INSTRUCTION } from "./browserAi";
import { COURSE_PALETTE_PRESETS } from "../lib/coursePalette";

// Walk up from the vitest working directory (apps/web) to the repo root —
// robust to `--dir`, workspace runs and CI alike.
const repoRoot = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(resolve(dir, "core/src/ai/tasks.rs"))) return dir;
    dir = resolve(dir, "..");
  }
  throw new Error("repo root with core/src/ai/tasks.rs not found from cwd");
})();

function readCore(relPath: string): string {
  return readFileSync(resolve(repoRoot, relPath), "utf8");
}

function quotedStrings(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("browser AI tier is pinned to the Rust core", () => {
  it("TIMETABLE_INSTRUCTION matches core/src/ai/tasks.rs (example codes excluded)", () => {
    const rust = readCore("core/src/ai/tasks.rs");
    const coreMatch = /const TIMETABLE_INSTRUCTION: &str = r##"([\s\S]*?)"##;/.exec(rust);
    expect(
      coreMatch,
      "core TIMETABLE_INSTRUCTION not found — did tasks.rs change shape?",
    ).not.toBeNull();
    const corePrompt = coreMatch![1];

    // The shipped constant — the exact string the browser sends to Gemini.
    const browserPrompt = TIMETABLE_INSTRUCTION
      // The documented, allow-listed deviation: neutral example codes only.
      .replaceAll("ECE210", "CS101")
      .replaceAll("Digital Systems", "Introduction to Computer Science");

    expect(browserPrompt).toBe(corePrompt);
  });

  it("FLASH_MODEL_IDS matches AiModel::Flash::model_ids() in core/src/ai/provider.rs", () => {
    const rust = readCore("core/src/ai/provider.rs");
    const ladderMatch = /Self::Flash => &\[([\s\S]*?)\],/.exec(rust);
    expect(ladderMatch, "Flash ladder not found — did provider.rs change shape?").not.toBeNull();
    expect(FLASH_MODEL_IDS).toEqual(quotedStrings(ladderMatch![1]));
  });

  it("COURSE_PALETTE_PRESETS matches core/src/sources/mod.rs PALETTE_PRESETS", () => {
    const rust = readCore("core/src/sources/mod.rs");
    const paletteMatch = /const PALETTE_PRESETS: \[&str; 8\] = \[([\s\S]*?)\];/.exec(rust);
    expect(paletteMatch, "core PALETTE_PRESETS not found").not.toBeNull();
    expect([...COURSE_PALETTE_PRESETS]).toEqual(quotedStrings(paletteMatch![1]));
  });
});
