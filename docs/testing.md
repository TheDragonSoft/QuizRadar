# QuizRadar Testing & Performance Guide

_7-layer verification system across Rust core, Web/PWA, Desktop (Tauri 2), and Android (Compose M3). Canonical command cheatsheet lives in [`docs/STATUS.md`](./STATUS.md)._

---

## 1. Seven Verification Layers

| # | Layer | What It Catches | Blocking |
|---|---|---|---|
| 1 | **Static & hygiene gates** | Formatting, clippy/eslint, types, version sinks, wire-map drift, secrets, doc allowlist/budgets, banned v4 strings, copy conformance | Always |
| 2 | **Unit & golden fixtures** | Parser/planner/storage/honesty regressions across Rust (`core/tests/`), Vitest (`apps/web`), Tauri IPC (`apps/desktop`), and Robolectric/JNA (`apps/mobile-android`) | Always |
| 3 | **Property tests (`proptest`)** | Panics or fabricated outputs on arbitrary UTF-8, malformed `.ics`, or degenerate schedules (`property_email`, `property_ics`, `property_plan`) | Always |
| 4 | **Cross-language contracts** | `serde` ↔ TypeScript ↔ UniFFI drift (`apps/web/src/contract/regenerate.mjs --check`, `vitest run src/contract`) | Always |
| 5 | **Playwright browser E2E** | Behavioral smoke (`--grep-invert @visual`, blocking) and pixel baselines (`--grep @visual`, `apps/web/e2e-baselines/`, non-blocking until runner baselines re-stamped) | Smoke: Yes; Visual: Signal |
| 6 | **Android Emulator & UI Workbench** | Live API 35 emulator sweeps, M3 token/inset parity, and Ladle before/after captures (`tooling/capture-workbench.mjs` + `tooling/ui-compare.mjs`) | CI + UI PRs |
| 7 | **Performance regression gate** | Base-vs-head median (`p50`) slowdowns across Core, Web, Android, and Desktop (`performance/`) | PR gate (`performance-review`) |

## 2. Key Invariants & Isolation

- **Anti-pattern & copy gates:** `apps/web/src/audit/antipatterns.test.ts` blocks banned v4 literals/defaults; `apps/web/src/copy/conformance.test.ts` checks every `copy.ts` template and verifies the verbatim AI consent disclosure against `docs/product-spec.md`.
- **Zero-PII Desktop Sandbox (Tauri 2 + WebView2):** Never run automated desktop checks against a live profile. Always set:
  - `QUIZRADAR_DATA_DIR=<temp-dir>` (isolates `quizradar.db`)
  - `QUIZRADAR_EPHEMERAL_KEYRING=1` (in-memory keyring)
  - `WEBVIEW2_USER_DATA_FOLDER=<temp-dir>/wv2` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`
- **CI Placement (see [ADR-0004](./adr/0004-forgejo-first-git-and-ci.md)):**
  - Fast single-pass checks run on **Forgejo Actions** (`.forgejo/workflows/devbox-ci.yml` on `devbox-host`).
  - Full matrix, Playwright, API 35 Android Emulator, and `performance.yml` run on **GitHub Actions**.

## 3. Per-PR Performance Regression Gate (`performance/`)

Answers one question: **did this PR make a measured scenario slower than its merge base beyond both relative and absolute limits?**

- **Methodology:** Base and head run on the **same runner** in **interleaved order** (`base,head`, `head,base`, …) using production builds, fixed fixtures, frozen clocks, and zero external network calls. Warmups are discarded; missing scenarios or crashes fail the gate.
- **Gate metric:** Median (`p50`) must regress by **both** the relative and absolute limits in `performance/thresholds.json` to block. Never loosen thresholds silently — intentional regressions require a reviewed `performance/thresholds.json` edit with justification.

| Surface | Sampler | Samples | Default Blocking Rule | Scenarios |
|---|---|---:|---|---|
| `core` | `quizradar-performance-core` (`Instant` + `black_box`) | 15 | `>10%` and `>0.25 ms` | `email.parse_batch`, `ics.parse`, `ics.export`, `planner.dashboard`, `planner.study_tasks`, `store.load_state`, `store.save_schedule`, `store.backup_export` |
| `web` | Production Vite build + Chromium (`performance/web`) | 15 | `>15%` and `>50 ms` (10 ms nav floor) | `startup.app_shell`, `startup.first_contentful_paint`, `navigation.calendar`, `navigation.tasks`, `navigation.dashboard` |
| `android` | ADB cold-start staging (`performance/android`) | 7 | `>15%` and `>150 ms` | `startup.total_time` |
| `desktop` | Windows WebView2/CDP (`performance/desktop`) | 5 | `>15%` and `>100 ms` | Desktop startup & IPC latency |

Raw evidence writes to gitignored `performance/results/` and uploads as CI artifacts. Aggregate verdicts with `pnpm perf:review`.
