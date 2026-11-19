# QuizRadar Performance Testing — Per-PR Regression Gate

_This is the dedicated guide for the `performance/` suite. Correctness tests
remain in `docs/TESTING-PLAYBOOK.md`; this document explains only how runtime
performance is measured, compared, and gated._

## Purpose and honesty rules

The suite answers one question per PR: **did this change make a measured
operation slower than its merge base by more than the reviewed threshold?** It
does not claim absolute device performance, physical-device startup, network
latency, or user hardware behavior.

Rules encoded by the suite:

- Base and head run on the **same runner**, in **alternating order**, using
  **production profiles**.
- Inputs are fixed test fixtures; no wall clock is read by the core, and no
  external network is contacted.
- Raw samples, medians, p95 values, environment metadata, and logs are
  uploaded on every run.
- A missing scenario, changed scenario ID, crash, invalid sample, or
  insufficient sample count is an **error requiring review**, never a pass.
- The workflow never edits thresholds or creates baselines silently. An
  intentional regression needs a reviewed `performance/thresholds.json` change
  with written justification.

## Suite layout

| Path | Purpose |
|---|---|
| `performance/thresholds.json` | Versioned default and per-scenario gates. |
| `performance/core/` | Non-shipped Rust sampler crate plus base/head runner. |
| `performance/web/` | Production static-bundle Chromium sampler and runner. |
| `performance/android/` | ADB staging cold-start sampler and runner. |
| `performance/desktop/` | Windows WebView2/CDP native sampler and runner. |
| `performance/compare.mjs` | Compare two raw result files into JSON + Markdown. |
| `performance/review.mjs` | Aggregate all four surfaces into one verdict. |
| `tooling/lib/performance.mjs` | Tested statistics and gate logic. |
| `.github/workflows/performance.yml` | Per-PR four-surface workflow. |
| `performance/results/` | Machine-local evidence; gitignored and uploaded as artifacts. |

## Gate and statistics

- Gate metric: **median** (`p50`) of valid samples.
- Report metrics: count, min, p50, p95, max, mean, raw samples.
- Regression rule: head median is slower than base median by **both**
  scenario limits. This avoids blocking a 50% change on a 0.001 ms operation
  and avoids treating timer jitter as a regression.
- Warmups are discarded from aggregates.
- Base/head samples are interleaved (`base,head`, then `head,base`, …) to
  reduce thermal/order bias.
- Web uses 15 samples because the first live PR runs showed different
  navigation regressions on different runs at 7 samples. The relative and
  absolute thresholds were not loosened to accommodate that noise.

Initial thresholds (`performance/thresholds.json`):

| Surface | Samples | Blocking rule |
|---|---:|---|
| `core` | 15 | `>10%` and `>0.25 ms` |
| `web` | 15 | `>15%` and `>50 ms` |
| `android` | 7 | `>15%` and `>150 ms` |
| `desktop` | 5 | `>15%` and `>100 ms` |

Per-scenario overrides use the key `"<surface>.<scenario-id>"` in the
`scenarios` map. Example: `web.navigation.calendar` currently uses a 10 ms
noise floor because a normal view switch is much faster than startup.

Same-build calibration observed locally on 2026-11-18:

- Core: all eight scenarios stayed within ±3.05% and ±0.125 ms.
- Web: all five scenarios stayed within +7.22%/8.11 ms; navigation gates have
  lower absolute floors as documented above.
- Android: `startup.total_time` medians differed by 48 ms (+2.00%).
- Desktop: startup medians differed by +5.15%/45.9 ms; IPC by -4.89%.

These are calibration observations, not promises about any user device.

## Scenarios

### Core (`performance/core`)

A non-shipped workspace crate, `quizradar-performance-core`, samples public
Rust APIs with `Instant` and `black_box`. No Criterion dependency is added.

| Scenario | Workload |
|---|---|
| `email.parse_batch` | All email fixtures through `parse_emails`. |
| `ics.parse` | Moodle ICS fixture through `parse_ics_events`. |
| `ics.export` | 96 generated assessments through `export_ics_all_with_ref_date`. |
| `planner.dashboard` | 96 assessments through `build_dashboard_summary`. |
| `planner.study_tasks` | 96 assessments + timetable through `build_study_tasks_with_schedule`. |
| `store.load_state` | Seeded in-memory SQLite snapshot read. |
| `store.save_schedule` | Whole-timetable replace on seeded SQLite. |
| `store.backup_export` | v4-shape backup serialization. |

Reference date is pinned to `2026-10-17`. Fixture construction is outside the
timed region.

### Web/PWA (`performance/web`)

Production build (`pnpm --dir apps/web build`), static local HTTP server,
fresh Chromium context, fixed clock, UTC, reduced motion, and non-loopback
routes aborted. Setup (onboarding dismissal and JSON backup import through the
real modal) happens outside timing.

| Scenario | Meaning |
|---|---|
| `startup.app_shell` | Navigation start → `[data-testid="app-shell"]` visible. |
| `startup.first_contentful_paint` | Chromium paint entry; missing metric fails the sample. |
| `navigation.calendar` | Click Calendar → view visible + animation frame. |
| `navigation.tasks` | Click Tasks → view visible + animation frame. |
| `navigation.dashboard` | Click Dashboard → populated dashboard item visible. |

The populated scenario imports `core/tests/fixtures/v4_backup.json`, which
contains synthetic test data only.

### Android (`performance/android`)

Uses `staging`, not unrepresentative `debug`. The runner installs with a
throwaway test signing key, uninstalls any stale signature, and measures
`adb shell am start -W -n com.quizradar.app/.MainActivity` `TotalTime`.
Install time is excluded. Every sample requires a live `pidof`, and logcat must
not contain `FATAL EXCEPTION`, `ANR in com.quizradar.app`, or
`UnsatisfiedLinkError`.

This measures **process-cold emulator startup**, not first-install or
physical-device startup.

### Desktop (`performance/desktop`)

Windows `cargo tauri build --no-bundle` executable. Each sample gets a unique
temp directory, ephemeral keyring, isolated WebView2 profile, and unique CDP
port. The sampler measures process start → CDP ready → `app-shell` → successful
native `version` IPC, then warm Calendar navigation. It asserts Tauri
internals and the absence of `offline-banner`, so a web-only fallback cannot
pass. The process tree is killed in `finally`.

`QUIZRADAR_PERFORMANCE_SANDBOX=1` suppresses the update check **only** when
`QUIZRADAR_DATA_DIR` and `QUIZRADAR_EPHEMERAL_KEYRING` are also set. Normal
desktop launches are unchanged.

## Local commands

Run from the repository root. Base/head artifact flags are required; examples
use the same local build for a no-regression sanity run.

```powershell
pnpm perf:core -- --base-bin target/release/quizradar-performance-core.exe --head-bin target/release/quizradar-performance-core.exe --samples 15

pnpm perf:web -- --base-dist apps/web/dist --head-dist apps/web/dist --samples 15

pnpm perf:android -- --base-apk performance/artifacts/base.apk --head-apk performance/artifacts/head.apk --serial emulator-5554

pnpm perf:desktop -- --base-exe target/release/quizradar-desktop.exe --head-exe target/release/quizradar-desktop.exe --samples 5

pnpm perf:review
```

Build prerequisites:

```powershell
cargo build --release -p quizradar-performance-core
pnpm --dir apps/web build
# Android: apps/mobile-android/gradlew.bat assembleStaging, then test-sign.
cargo tauri build --no-bundle
```

For Android, sign both benchmark APKs with a throwaway keystore. Do **not**
use release secrets for a PR benchmark:

```powershell
keytool -genkeypair -v -keystore performance/artifacts/perf-test.keystore -storepass perf-test -keypass perf-test -alias perf-test -keyalg RSA -keysize 2048 -validity 1 -dname "CN=QuizRadar Performance Test, OU=CI, O=QuizRadar, C=US"
& "$env:ANDROID_HOME\build-tools\35.0.0\apksigner.bat" sign --ks performance/artifacts/perf-test.keystore --ks-pass pass:perf-test --key-pass pass:perf-test --ks-key-alias perf-test --out performance/artifacts/base.apk <base-unsigned.apk>
& "$env:ANDROID_HOME\build-tools\35.0.0\apksigner.bat" sign --ks performance/artifacts/perf-test.keystore --ks-pass pass:perf-test --key-pass pass:perf-test --ks-key-alias perf-test --out performance/artifacts/head.apk <head-unsigned.apk>
```

## CI workflow

`.github/workflows/performance.yml` runs on every PR and supports manual
dispatch with explicit base/head refs. Jobs:

1. `perf-core` — Ubuntu, two Rust sampler builds.
2. `perf-web` — Ubuntu, two production web builds.
3. `perf-android` — Ubuntu API 35 emulator, two staging builds + throwaway key.
4. `perf-desktop` — Windows, two Tauri `--no-bundle` builds.
5. `performance-review` — aggregates artifacts, applies the PR label/comment
   on failure, clears stale review state on success.

Each surface uploads `performance/results/<surface>` even when it fails. The
final required check name is **`performance-review`**. Branch protection must
require both `ci-success` and `performance-review`. Repository branch
protection settings are not modified or verified by the workflow itself.

On failure, `performance-review` adds `needs-performance-review` and one PR
comment containing the aggregate table. Fork PR tokens may be read-only; in
that case the comment/label step emits a warning and skips mutation, while the
blocking check and artifacts remain.

## Adding or changing a scenario

1. Add the scenario to the surface sampler with a stable snake_case ID and a
   fixed fixture/reference date.
2. If the change is meaningful for both base and head, run a same-commit
   calibration locally and record the observed noise.
3. Add a default or scenario-specific threshold only with justification in the
   PR handoff fragment.
4. Update `docs/PERFORMANCE-TESTING.md` and `docs/TESTING-CI-REWORK.md`.
5. Add comparator tests in `tooling/__tests__/performance.test.ts` if the gate
   logic changed.
6. Removing/renaming a scenario intentionally makes the old/base result
   missing and therefore requires review; never delete a gate to make a PR
   pass.

## Known limitations

- Android is emulator-only and process-cold; it does not represent
  physical-device startup or first-install cost.
- Desktop requires Windows/WebView2 and currently measures startup/IPC, not
  bundled installer startup.
- Web measures Chromium only; Firefox/WebKit are not performance-gated.
- The first live GitHub runner calibration may reveal higher CI noise. Treat
  any inconclusive run as review evidence, not as a silent pass.
- AI-provider latency is intentionally not benchmarked here; live model calls
  are non-deterministic, quota-bound, and must never gate a PR.
