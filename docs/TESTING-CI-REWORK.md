# Testing & CI Rework — Durable Agent Handoff

_This file is intentionally durable (unlike `changes/*.md`, which is archived
after merge). Use it during the later documentation overhaul to understand the
new test/CI architecture, why the old timing harness was retired, and how to
extend the suites without weakening gates._

**Branch:** `test/performance-ci-hardening`  
**Date:** 2026-11-18  
**Bend decision:** evaluated and **not adopted**. See “Bend” below.

## Why this rework exists

The existing correctness stack was already strong (Rust fixtures/properties,
Vitest, Playwright, Robolectric, coverage ratchets), but it did not answer
whether a PR regressed runtime performance. This rework adds a dedicated,
versioned performance gate while preserving correctness coverage and hardening
release/CI invariants that the audit found weak.

## New performance suite

### Files added

| Path | Role |
|---|---|
| `performance/thresholds.json` | Source of truth for sample counts and regression gates. |
| `performance/core/Cargo.toml`, `performance/core/src/main.rs` | Non-shipped Rust sampler over public core APIs. |
| `performance/core/run.mjs` | Interleaves two sampler binaries and writes reports. |
| `performance/web/sample.mjs`, `performance/web/run.mjs` | Production PWA Chromium sampler and base/head runner. |
| `performance/android/sample.mjs`, `performance/android/run.mjs` | ADB staging process-cold startup sampler/runner. |
| `performance/desktop/sample.mjs`, `performance/desktop/run.mjs` | Windows Tauri/WebView2 CDP native sampler/runner. |
| `performance/compare.mjs` | CLI wrapper around tested comparator. |
| `performance/review.mjs` | Aggregates all surfaces and produces review report. |
| `tooling/lib/performance.mjs` | Pure statistics/comparison/report logic. |
| `tooling/__tests__/performance.test.ts` | Tests pass/fail/noise/missing/malformed/override behavior. |
| `.github/workflows/performance.yml` | Four-surface per-PR workflow plus `performance-review`. |
| `docs/PERFORMANCE-TESTING.md` | Dedicated performance guide. |

Root package scripts added: `perf:core`, `perf:web`, `perf:android`,
`perf:desktop`, `perf:review`. All require explicit base/head artifact flags;
they do not fabricate a baseline.

### Old performance tooling removed/renamed

| Old | New | What changed |
|---|---|---|
| `core/tests/email_eval_benchmark.rs` live `live_gemini_54_email_eval_benchmark` | **Removed** | Live-network latency/accuracy timing was ignored, quota-bound, non-deterministic, and never suitable as a PR gate. |
| `core/tests/email_eval_benchmark.rs` file | `core/tests/email_eval.rs` | Deterministic 54-case correctness evaluation preserved unchanged as a test, with its file/doc renamed to stop calling it a timing benchmark. |
| No repeatable core/browser/Android/desktop performance harness | `performance/` suite | New deterministic, production-profile suite. |

Historical latency records in `docs/worklog/` and `docs/archive/` were left
untouched; they are historical observations, not live gates.

### Gate design

- Compare PR base merge-base SHA and head SHA on one runner.
- Build both production artifacts, then alternate base/head samples.
- Gate on median; raw samples, p95, min/max and metadata are retained.
- Threshold must cross both relative and absolute floors.
- Missing/incompatible scenarios fail; the gate never self-updates.
- Required check: `performance-review`. It labels/comments only on failure and
  clears stale review state after a pass.
- Intentional regressions require a reviewed threshold change, not an ignored
  job.

### Local calibration evidence (same-build)

Recorded on 2026-11-18 and stored only as local gitignored artifacts:

- Core: 15 samples, all 8 scenarios pass; max same-build delta ±3.05%.
- Web: 7 samples, all 5 scenarios pass; max +7.22%/8.11 ms.
- Android: 7 samples, `startup.total_time` p50s 2398 vs 2446 ms (+2.00%).
- Desktop: 5 samples, all 4 scenarios pass; max +5.15%/45.85 ms.

The initial GitHub runner calibration has **not** yet been observed; first
Actions runs may need measured threshold adjustment via review.

## Correctness test additions

### Added

- `core/tests/property_academic.rs`: 100-case properties and deterministic
  controls for GPA, grade targets, cushion union/deficit, and week parity.
  11 tests pass locally.
- `tooling/__tests__/ciValidators.test.ts`: APK/AAB native-ABI and
  release-tag/version validation tests.
- `tooling/__tests__/performance.test.ts`: performance gate logic tests.

### Preserved

- `core/tests/property_plan.rs`, `property_email.rs`, `property_ics.rs`.
- Golden fixtures, Vitest unit/a11y/antipattern/copy suites, Playwright suites.
- Android Robolectric/Compose/JNA tests.

## CI/validators and release hardening

### Files added

| Path | Role |
|---|---|
| `tooling/lib/android-artifacts.mjs` | Pure validator requiring both supported ABIs. |
| `tooling/verify-android-artifacts.mjs` | CLI using `unzip -Z1` (CI/Linux) or `jar tf` fallback (Windows/JDK). |
| `tooling/lib/release-metadata.mjs` | Strict SemVer, tag/version equality, prerelease detection. |
| `tooling/validate-release.mjs` | Release metadata CLI used by release workflow. |

### CI changes

- `.github/workflows/ci.yml` now supports `workflow_call` with a `ref` input.
- Android ABI checks use the tested validator instead of an either-ABI regex.
- `android-emulator` consumes the exact `android-debug-apk` artifact, installs
  it, launches it, verifies process survival, scans logcat for fatal/native
  failures, and uploads evidence. It no longer duplicates the Android build.
- `android` runs `ktlintCheck`, explicit `lintRelease`, unit tests,
  debug/release assembly, and artifact validation.
- Blocking browser job uploads failure evidence; Playwright now retains traces
  and screenshots only on failure.
- `ci-success` aggregates every blocking CI job. Visual snapshots remain
  non-blocking until Linux baselines are verified.
- `agent-preflight.mjs` maps tooling changes to `pnpm test:tooling` and Android
  changes to `lintRelease`.

### Release changes

- Release invokes reusable full CI at the tagged ref; the old reduced
  validation subset is gone.
- `validate-release-metadata` fails on non-SemVer tags and tag/version
  mismatch; any prerelease component (`alpha`, `beta`, `rc`, …) marks
  prerelease.
- Desktop publishes only with `TAURI_SIGNING_PRIVATE_KEY`; password stays
  optional. Desktop artifact upload requires files.
- Android publishes only a signed `app-release.apk`; all four keystore secrets
  are required; `apksigner verify` always runs; unsigned fallback removed.
- APK and AAB both require native libraries for both supported ABIs.
- PWA deploys only after desktop and Android artifact builds succeed.

## Android-specific fixes

- `apps/mobile-android/app/src/main/java/com/quizradar/app/core/QuizRadarCore.kt`
  had a multiline single-parameter function signature failing the current
  ktlint `function-signature` rule. It is now single-line. No behavior changed.
- `apps/mobile-android/app/src/main/java/com/quizradar/app/core/PairSyncCodec.kt`
  compacted QR payloads with recursive Java regexes. A long escaped
  `raw_text` string caused `StackOverflowError` in the existing regression
  test. Compaction is now a linear JSON-string scanner; added a test covering
  escaped `raw_text` and long `snippet`/`notes` fields.
- `AndroidUiCaptureTest` now opts into experimental Material 3 APIs.
- The OAuth intent filter is explicitly annotated as a custom-scheme (not an
  https App Link) for lint.
- `app/lint-baseline.xml` contains only the three pre-existing `NewApi`
  findings generated by UniFFI's `java.lang.ref.Cleaner` code. New findings
  still fail `lintRelease`; do not refresh the baseline to hide regressions.

`app/build.gradle.kts` changed lint policy from `abortOnError = false` to
`true`; `lintRelease` is explicit in CI rather than re-enabling lint during
every `assembleRelease`.

## Bend evaluation

Bend was evaluated for the app/core and **not adopted**:

- No supported native Windows target for the Tauri shell, no documented
  Android target, and no WASM target.
- No stable documented Rust-to-Bend embedding/C ABI; generated JavaScript is
  sequential.
- QuizRadar workloads are parsing, I/O, SQLite, and small calculations, not
  balanced fork/join compute.
- Adding a second language/FFI boundary would risk divergent behavior across
  Tauri, UniFFI/Android, and WASM.

If a future measured hotspot is genuinely parallel and Bend later supports the
required targets/embedding, re-evaluate from its current documentation. Do not
port `core/` logic into Bend speculatively.

## Documentation overhaul checklist

When overhauling docs later:

1. Treat `docs/PERFORMANCE-TESTING.md` as the canonical performance guide and
   keep `docs/TESTING-PLAYBOOK.md` as the correctness/playbook index.
2. Keep required-check names exactly: `ci-success` and `performance-review`.
3. Keep the distinction between correctness tests and performance gates; do
   not merge them into one “test” command.
4. Preserve honesty language: emulator/process-cold, production profile,
   same-runner, same-build calibration, no physical-device claims.
5. Keep `tooling/version.json` untouched on feature branches; use
   `changes/<slug>.md`.
6. When adding scenarios, update both the performance guide and this handoff.
7. Do not reintroduce live network/API timing as a PR gate.

## Verification status at time of writing

Verified locally:

- Prettier, ESLint, TypeScript typecheck, release metadata, and APK ABI
  validator.
- Rust: full workspace, including `email_eval`, `property_academic`, and the
  desktop shell; core benchmark crate builds/runs. Coverage ratchet passes
  (core 91.40% lines / 87.78% functions; web 78.81% lines).
- Tooling: 45 tests, including performance comparator and CI validators.
- Web: 451 tests, landing 8 tests; WASM build current.
- Android: full `ktlintCheck lintRelease testDebugUnitTest assembleDebug
  assembleRelease bundleRelease` set passes; debug/release APK and release AAB
  pass native-ABI validation.
- Performance calibration runs for all four surfaces (same-build) pass.
- Windows Tauri release `--no-bundle` build, CDP attach, native IPC, and
  cleanup complete.
- Playwright behavioral specs pass. Three visual baselines differ by ~2%
  pixels; they remain deliberately non-blocking and were not re-stamped
  silently.

Pending / not claimed:

- Full GitHub Actions run for CI/performance workflow (requires PR push).
- Branch protection required-check configuration.
- A real base-vs-head performance comparison (all local runs used same-build
  calibration so far).
- Full visual baseline promotion to blocking remains intentionally deferred.
- Coordination with sibling worktree `chore/agent-ready` (`QuizRadar-pr41`),
  which independently touches the same Android QR-compaction and test files;
  rebase/merge must reconcile these rather than silently duplicate fixes.
