# QuizRadar Testing Playbook — Reusable Cross-Platform Verification System

_How this repo is verified end to end across **Web (PWA + WASM)**, **Desktop (Tauri 2 + WebView2)**,
and **Mobile (Android Compose + UniFFI)** — designed as a turnkey, drop-in testing architecture
for other local-first and multi-shell apps._

The system has **seven layers**, ordered from cheapest static invariants to live multi-surface
visual & interactive sweeps. Every bug found in Layer 6 or 7 is locked down with a deterministic
regression test in Layers 1–5 so it can never recur silently.

| # | Layer | Catches | Speed |
|---|-------|---------|-------|
| 1 | Static & anti-pattern gates | Style, types, stale wire maps, secrets, banned copy/slop | seconds |
| 2 | Unit + golden-fixture tests | Logic regressions, honesty violations, state rollbacks | seconds–1 min |
| 3 | Property tests (`proptest`) | Parser/planner panics and impossible outputs on arbitrary input | seconds |
| 4 | Cross-language contract tests | Core↔UI wire-shape drift (`serde` ↔ TypeScript ↔ UniFFI) | seconds |
| 5 | Deterministic visual baselines | Pixel drift on first-run Light & Dark surfaces | ~1 min |
| 6 | Automated Web + Tauri UI Sweep (`tooling/ui-sweep.mjs`) | Double modal chrome, stacked dialogs, WCAG contrast (`oklch` + gradients), tiny fonts, missing a11y labels, dead controls | ~90 s |
| 7 | Android Emulator + ARTEMIS Closed-Loop Sweep | Edge-to-edge insets, M3 token drift, clipped icons, sheet interactions, Light/Dark device parity | ~3–5 min |

---

## 1. Static & Anti-Pattern Gates (Run Always)

```powershell
pnpm lint                                     # ESLint flat config across workspace
pnpm typecheck                                # tsc --noEmit per package
pnpm format:check                             # Prettier formatting gate
node tooling/generate-version.mjs --check     # All 5 version sinks in lockstep
node apps/web/src/contract/regenerate.mjs --check # Rust <-> TS wire map freshness
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
```

Why these gates catch real defects instead of bikeshedding:

- **Self-verifying wire maps:** `apps/web/src/contract/regenerate.mjs` parses Rust `#[derive(Serialize, Deserialize)]` structs and fails CI if Rust fields change without updating TypeScript.
- **Anti-pattern source scanner:** `apps/web/src/audit/antipatterns.test.ts` scans non-test source files and fails the build if fabricated demo strings, hardcoded secrets, or banned defaults (`auto_sync_gcal: true`) reappear.
- **Copy conformance gate:** `apps/web/src/copy/conformance.test.ts` executes every template function in `copy.ts` and rejects dishonest promises or missing disclosure strings.

---

## 2. Unit & Golden-Fixture Suites

```powershell
pnpm test                 # Vitest + Testing Library (Web + Desktop IPC shape)
cargo test --workspace    # Rust core golden fixtures + Tauri desktop unit tests
# Android JVM + Robolectric Compose tests:
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
Set-Location apps\mobile-android ; .\gradlew.bat ktlintCheck testDebugUnitTest
```

- **Web (`apps/web/src/**/__tests__/`):** Exercises real Zustand store transitions, single-shell modal stacking (`UiSweepRegressions.test.tsx`), IndexedDB/WASM round-trips (`pwa.test.tsx`), and structural accessibility (`accessibility.test.tsx`).
- **Core (`core/tests/`):** Verifies email/ICS parsing, timetable snapping, conflict clustering, and Drive merge preservation against golden JSON/ICS fixtures.
- **Android (`apps/mobile-android/app/src/test/`):** Runs JNA-backed UniFFI smoke tests, Robolectric Compose navigation tests (`ComposeUiSmokeTest`), and honesty formatting checks (`HonestyFormattingTest`).

---

## 3. Property Tests (Parsers & Planner)

```powershell
cargo test -p quizradar-core --test property_email --test property_ics --test property_plan
```

Machine-checked invariants across arbitrary generated inputs:

- **Never panics** on arbitrary UTF-8 strings, malformed `.ics` blocks, or degenerate schedules.
- **Zero fabrication:** Missing room, instructor, or date always stays `None` (rendered as `"—"` in UI), never a invented hall or fallback timestamp.
- **Planner bounds:** Radar never surfaces past items as upcoming; readiness stays within `0..=100`; study blocks are strictly conflict-free 90-minute windows.

---

## 4. Cross-Language Contract Tests (Rust ↔ TypeScript)

```powershell
pnpm --dir apps/web vitest run src/contract
node apps/web/src/contract/regenerate.mjs     # Re-stamp when Rust structs change
```

Validates field presence, optionality parity, enum variants, and snake_case/camelCase boundary adapters so Core↔UI shape mismatches cannot ship.

---

## 5. Deterministic Visual Regression Baselines (Playwright)

```powershell
pnpm --dir apps/web exec playwright test                       # Compare against baselines
pnpm --dir apps/web exec playwright test --update-snapshots=all # Re-stamp intentional UI updates
```

- Baselines live in `apps/web/e2e-baselines/` (genuine first-run Light & Dark states).
- Frozen clock (`page.clock.setFixedTime`), UTC timezone, `reducedMotion: "reduce"`, and awaited web fonts (`document.fonts.status === "loaded"`) eliminate flake.

---

## 6. Automated Web + Desktop UI Sweep (`tooling/ui-sweep.mjs`)

This single-command harness drives every view, sub-tab, responsive breakpoint (`1440×900` desktop + `390×844` mobile), Light & Dark theme, all 13 modals, stacked modal flows, and the live **Tauri 2 WebView2** binary — producing a 1:1 screenshot gallery and a machine-readable JSON audit report.

```powershell
# 1. Capture baseline BEFORE edits
node tooling/ui-sweep.mjs --phase=before --out-dir=./screenshots/web/before --report=./audit-before.json

# 2. Apply UI/UX & functional fixes, then capture AFTER
node tooling/ui-sweep.mjs --phase=after  --out-dir=./screenshots/web/after  --report=./audit-after.json
```

### Built-In Structural & Visual Invariants Checked on Every Screenshot

1. **`stacked-visible-dialogs` (Critical):** At most **one** `[role="dialog"]` inside `modal-stack-root` may be visible at any instant; parent modals in a LIFO stack must be hidden (`hidden` + `aria-hidden="true"`) until the top modal closes.
2. **`double-modal-chrome` (Critical):** A modal component rendered inside `ModalStack`'s outer `.modal-panel` shell must never wrap itself in a second bordered/shadowed card ("window-inside-a-window"). Large bespoke layouts opt into `flush: true` in `modalRegistry.ts`.
3. **`nested-scroll-containers` (High):** Prevents scroll-trapping double vertical scrollbars inside dialogs.
4. **`contrast-low` (High/Medium):** Uses an offscreen `1×1` HTML5 `<canvas>` (`willReadFrequently: true`) to resolve **any CSS Color 4 value** (`oklch()`, `color-mix()`, `rgb()`) AND parses `linear-gradient(...)` color stops so text over gradients and translucent chips is audited against its worst-case background stop (`>= 4.5:1` body, `>= 3.0:1` large text).
5. **`offscreen-x` (High):** Flags any visible element extending past `window.innerWidth` outside an intentional horizontal scroll container.
6. **`tiny-font` (Medium):** Enforces `>= 11px` minimum computed font size across all visible text nodes.
7. **`missing-a11y-name` (Medium):** Every visible `<button>`, `<input>`, and `<select>` must expose an accessible name (`aria-label`, `aria-labelledby`, `<label for="...">`, wrapping `<label>`, or text content).

### Zero-PII Desktop Sandbox Protocol (Tauri 2 + WebView2 CDP)

Never attach automated sweeps to a developer's live `%LOCALAPPDATA%` database or OS credential store. `apps/desktop/src-tauri` honors two test-isolation environment variables used automatically by `tooling/ui-sweep.mjs`:

- `QUIZRADAR_DATA_DIR=<temp-dir>` — redirects SQLite (`quizradar.db`) away from `%LOCALAPPDATA%\com.quizradar.app`.
- `QUIZRADAR_EPHEMERAL_KEYRING=1` — switches `KeyringStore` to an in-memory map for the process lifetime so Windows Credential Manager / macOS Keychain / Secret Service are never read or mutated.
- `WEBVIEW2_USER_DATA_FOLDER=<temp-dir>\wv2` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` — isolates browser storage and exposes CDP so Playwright inspects the real native Tauri window.

---

## 7. Android Emulator + ARTEMIS Closed-Loop Sweep

For Android (`apps/mobile-android`) or any native mobile target:

1. **Cross-compile native core & assemble debug APK:**
   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
   Set-Location apps\mobile-android
   .\gradlew.bat buildAndroidRustLibs assembleDebug
   adb -s emulator-5554 install -r app\build\outputs\apk\debug\app-debug.apk
   ```
2. **Diagnose & observe with ARTEMIS MCP:**
   - Call `mobile_diagnose` first if device state is unknown; confirm user device choice if multiple devices are attached.
   - Use **ARTEMIS Flash** (`mobile_run_task` with `mode="flash"`) for deterministic UI navigation, file-picker backup imports, checkbox toggles, Pomodoro Start/Pause/Reset, Practice Quiz MCQ selection, and sheet openings; use `mobile_get_device_state` to inspect the live accessibility XML tree (`bounds`, `clickable`, `content-desc`).
3. **Verify Android-specific visual invariants on every screen (Light & Dark):**
   - `enableEdgeToEdge()` + `WindowCompat.getInsetsController` status/navigation bar icon legibility in both `cmd uimode night no` and `cmd uimode night yes`.
   - Complete M3 `ColorScheme` mapping (`surfaceContainer`, `secondaryContainer`, `outlineVariant`) so default Material lavender (`#E8DEF8`) never leaks into `NavigationBar` or `ModalBottomSheet`.
   - Icon buttons use `IconButton` / `OutlinedIconButton` (never `OutlinedButton(Modifier.size(48.dp))`, whose default `24.dp` horizontal padding crushes icons to `0dp` width).
   - Clean up temporary `/sdcard/Download/*` seed files and reset `cmd uimode night no` when finished.

---

## Porting This Testing System to Another App

1. Copy `tooling/ui-sweep.mjs` and replace `SEED_DATA` + route/modal selectors with the target app's views and dialogs; keep `runDomAudit()` verbatim (it is framework-agnostic).
2. Enforce a single outer modal container (`ModalStack` + `modalRegistry` `flush` flag) so child views never draw duplicate dialog borders or simultaneous stacked backdrops.
3. Add `DATA_DIR` + `EPHEMERAL_KEYRING` env overrides to any desktop shell (Tauri / Electron) so CDP sweeps run in a clean temp directory with zero risk to user data.
4. Pair every UI sweep with a 1:1 **Before & After** visual artifact (`carousel` slides + JSON issue counts) so human review takes minutes instead of hours.
