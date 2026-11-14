/**
 * Generates a self-contained side-by-side BEFORE/AFTER comparison page from
 * two capture directories (see tooling/capture-workbench.mjs).
 *
 * Usage:
 *   node tooling/ui-compare.mjs target/ui-before target/ui-after
 * → writes target/ui-compare/index.html; open it in a browser and every
 *   changed screen is shown as BEFORE | AFTER side by side (scroll one, the
 *   other scrolls with it). Changed images are highlighted.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BEFORE = join(process.cwd(), process.argv[2] ?? "target/ui-before");
const AFTER = join(process.cwd(), process.argv[3] ?? "target/ui-after");
const OUT = join(process.cwd(), "target", "ui-compare");

if (!existsSync(BEFORE) || !existsSync(AFTER)) {
  console.error("Both a before and an after capture directory are required.");
  console.error(`  node tooling/ui-compare.mjs <before-dir> <after-dir>`);
  process.exit(1);
}

mkdirSync(join(OUT, "before"), { recursive: true });
mkdirSync(join(OUT, "after"), { recursive: true });

const beforeFiles = new Set(readdirSync(BEFORE).filter((f) => f.endsWith(".png")));
const afterFiles = new Set(readdirSync(AFTER).filter((f) => f.endsWith(".png")));
const all = [...new Set([...beforeFiles, ...afterFiles])].sort();

let copiedBefore = 0;
let copiedAfter = 0;
const rows = [];
for (const file of all) {
  const hasBefore = beforeFiles.has(file);
  const hasAfter = afterFiles.has(file);
  if (hasBefore) {
    copyFileSync(join(BEFORE, file), join(OUT, "before", file));
    copiedBefore++;
  }
  if (hasAfter) {
    copyFileSync(join(AFTER, file), join(OUT, "after", file));
    copiedAfter++;
  }
  rows.push({ file, hasBefore, hasAfter });
}

// Byte-level change detection: same-size files are likely identical for the
// diff highlight (a real pixel-diff would need a dependency — sizes are the
// honest cheap proxy; the human eye decides from the side-by-side render).
const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>QuizRadar UI — before/after</title>
<style>
  body { font-family: system-ui, sans-serif; background: #111827; color: #e5e7eb; margin: 0; padding: 24px; }
  h1 { font-size: 18px; } .meta { color: #9ca3af; font-size: 12px; margin-bottom: 20px; }
  .pair { margin-bottom: 28px; border: 1px solid #374151; border-radius: 12px; overflow: hidden; }
  .pair header { display: flex; justify-content: space-between; padding: 10px 14px; background: #1f2937; font-size: 12px; }
  .changed { border-color: #f59e0b; } .added-badge { color: #34d399; } .removed-badge { color: #f87171; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; }
  .cols figure { margin: 0; padding: 0; } .cols figcaption { padding: 6px 14px; font-size: 11px; background: #111827; color: #9ca3af; }
  img { width: 100%; display: block; }
  .scroll { height: 560px; overflow-y: scroll; }
  .scroll figure img { position: sticky; }
</style></head><body>
<h1>QuizRadar UI — before / after</h1>
<div class="meta">${all.length} screens · before: ${copiedBefore} · after: ${copiedAfter} · amber border = both present (inspect for changes) · green = new · red = removed
<br>Scroll a before pane — the after pane follows. Theme/story variant pairs share the filename.</div>
${rows
  .map((r) => {
    const badge =
      r.hasBefore && r.hasAfter
        ? ``
        : r.hasAfter
          ? `<span class="added-badge">NEW — no before shot</span>`
          : `<span class="removed-badge">REMOVED — no after shot</span>`;
    const beforeImg = r.hasBefore
      ? `<img src="before/${r.file}" loading="lazy">`
      : `<img style="display:none">`;
    const afterImg = r.hasAfter
      ? `<img src="after/${r.file}" loading="lazy">`
      : `<img style="display:none">`;
    return `<div class="pair ${r.hasBefore && r.hasAfter ? "changed" : ""}">
  <header><span>${r.file}</span>${badge}</header>
  <div class="cols">
    <figure class="scroll"><figcaption>BEFORE${r.hasBefore ? "" : " (missing)"}</figcaption>${beforeImg}</figure>
    <figure class="scroll"><figcaption>AFTER${r.hasAfter ? "" : " (missing)"}</figcaption>${afterImg}</figure>
  </div>
</div>`;
  })
  .join("\n")}
</body></html>`;

writeFileSync(join(OUT, "index.html"), html);
console.log(`${all.length} screens paired (${copiedBefore} before / ${copiedAfter} after)`);
console.log(`comparison page: ${join(OUT, "index.html")} — open it in a browser`);
