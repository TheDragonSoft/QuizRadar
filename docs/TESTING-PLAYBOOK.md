# QuizRadar testing playbook

_How this repo is tested so an agent (or a human) can verify a change end to end —
written to be reusable as a template for other local-first apps. Established during
the phase-18 audit (`docs/STATUS.md` → "Phase-18"); every command here is green on
the commit that introduced it._

The system has six layers, ordered from cheapest to most faithful. A change should
clear the layers below it before a human ever sees it, and the **sweep** (layer 6)
is the only one that replaces a human — it drives the real app like a user would.

| # | Layer | Catches | Speed |
|---|-------|---------|-------|
| 1 | Static gates | Style, types, stale generated files, secrets | seconds |
| 2 | Unit + fixture tests | Logic regressions, honesty violations | seconds–minutes |
| 3 | Property tests | Parser/planner panics and impossible outputs on arbitrary input | seconds |
| 4 | Contract tests | Core↔UI shape drift (the #1 source of real bugs here) | seconds |
| 5 | Visual regression | Pixel drift in the committed UI, both themes | ~1 min |
| 6 | Live sweep (agent-driven) | Dead buttons, broken flows, honest-copy violations — anything mocks can't see | ~1–2 h |

---

## 1. Static gates (run everything, always)

```powershell
pnpm lint                 # eslint (flat config) — tooling/.v4ref and scratch/ are ignored
pnpm typecheck            # tsc per package
pnpm format:check         # prettier
node tooling/generate-version.mjs --check   # 5 version sinks in sync
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
```

Rules that make these gates strong rather than decorative:

- **Generated files verify themselves.** `rust-structs.json` (the Rust wire map)
  fails the test suite if the Rust sources moved without regenerating
  (`node apps/web/src/contract/regenerate.mjs` re-stamps it).
- **The anti-pattern audit scans source text.** `src/audit/antipatterns.test.ts`
  fails the build if a banned v4 demo string (`MATH101`, `Hall B-204`,
  `auto_sync_gcal: true`, `?demo=`…) reappears anywhere in `apps/web/src`.
- **Copy is contract-tested.** Every template function in `copy.ts` must appear
  with sample arguments in `src/copy/conformance.test.ts`, and banned promises
  ("guaranteed", "never miss"…) fail the build.
- **Cross-tier event names are pinned.** `src/state/syncProgressContract.test.ts`
  reads the Rust source and fails if the shell's event name drifts from the web
  listener's.

## 2. Unit + fixture tests

```powershell
pnpm test                 # vitest, jsdom — 200 tests / 24 files
cargo test --workspace    # 241 core lib + fixtures + desktop suites
```

The web suite boots real components with Testing Library against a realistic
store fixture; the core suite pins parser outputs against golden email/ICS
fixtures (`core/tests/fixtures/`). Optimistic UI paths (topic toggles, grade
saves) are tested with rollback assertions.

## 3. Property tests (parsers and the planner)

```powershell
cargo test -p quizradar-core --test property_email --test property_ics --test property_plan
```

Each suite is **properties + deterministic controls**. The properties are
machine-checked over arbitrary input; the controls keep them from passing
vacuously:

- P1 never panics (arbitrary text/structs through the public API),
- no-fabrication (a populated room/instructor/date is always derivable from the
  input; missing facts stay `None`),
- date/time sanity (parsed dates are real calendar days; broken input yields
  `None`, never a fabricated default),
- planner honesty (radar never shows the past; readiness 0..=100 with the
  documented 0/0→100 semantic; roadmap tasks stay inside the 14-day horizon and
  the ≤5 prep-day window; alerts pair only dated upcoming items with honest
  4h/26h gaps; study blocks are free 90-min windows, and a dated-but-untimed
  event blacks out its whole day).

Proptest 1.12 notes: config goes in a per-block inner attribute
(`#![proptest_config(…)]`), and text strategies come from
`proptest::string::string_regex`.

## 4. Contract tests (Rust ↔ TypeScript)

```powershell
pnpm vitest run src/contract
node apps/web/src/contract/regenerate.mjs   # re-stamp when Rust structs change
```

`src/contract/` is the template for any Rust-core + web-UI app:

- `rustStructs.mjs` derives the wire format **from the Rust sources** (structs,
  enums, serde renames, FFI exports) into `testdata/contract/rust-structs.json`;
- `contractGuard.ts` validates any payload like serde would (missing required
  fields, null in non-Option, enum labels, date/time shapes);
- `contract.test.ts` asserts: freshness (1), fixtures deserialize (2), ≥13 drift
  mutations are rejected with the right error codes (3), the TS mirror declares
  every Rust field (4), optionality parity (5), the TS-only field set is exactly
  the documented list (6), enum parity incl. the recorded urgency-casing
  divergence (7), and the shape adapter actually fills the names the views read
  (8).

**Why this layer exists:** the three worst user-visible bugs in this app's
history were shape mismatches (classes failed to save, the calendar rendered
empty, the conflict banner printed "undefined and undefined"). All three are now
impossible to reintroduce silently.

## 5. Visual regression (Playwright)

```powershell
pnpm --dir apps/web exec playwright test                       # compare
pnpm --dir apps/web exec playwright test --update-snapshots=all # re-stamp
```

- Committed baselines live in `apps/web/e2e-baselines/` (dashboard, week
  calendar, settings modal × light/dark) and capture the **genuine first-run
  empty UI** — no injected fixtures (honesty doctrine).
- Determinism: the clock is frozen (`page.clock.setFixedTime`) before the app
  boots, timezone is pinned to UTC, fonts are awaited
  (`document.fonts.status === "loaded"`), the theme is seeded via an init
  script, and `NODE_OPTIONS=--dns-result-order=ipv4first` pins the dev server to
  IPv4 on Windows.
- Seeded/populated views are exercised in the **dev-only** store-handle flow
  (below), never in committed baselines.

## 6. The live sweep (agent-driven exploratory pass)

The layer that finds what everything above cannot: **dead buttons, flows that
silently do nothing, honesty violations in real copy, and state that renders
differently on real data.** Run it on the debug build with real (or
representative) data before every release.

### Setup

```powershell
cargo tauri build --debug --no-bundle      # target\debug\quizradar-desktop.exe
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333
start "" target\debug\quizradar-desktop.exe
```

The CDP port is the sweep's superpower: the agent drives the **real app** with
DOM-level clicks (reliable) while capturing console errors, and falls back to
OS-level automation only for what CDP can't reach. It also allows reading the
live store (`localStorage["quizradar_state_cache_v5"]`,
`window.__TAURI_INTERNAL__.invoke("get_state")`) without touching user data.

### The coverage matrix (enumerate before you click)

List every interactive element per surface, then strike them off:

- **Top bar** — brand, view switcher (each view), calendar controls (Today,
  prev/next), search field + `/` + Ctrl+K, Sync (overlay open → progress →
  complete/Cancel), Data & Backup modal, theme toggle (both themes), Settings
  (all tabs), account chip (signed out → sign in; signed in → profile).
- **Sidebar** — Create Study Event, Focus, Help, mini-calendar (month nav, day
  click → week jump), Exams-in-week list, My-calendars checkboxes, footer stamps.
- **Dashboard** — hero actions (Study Plan / Calendar / Google Cal), KPI pills,
  readiness bar, Sync Calendar, rec-card topics chip → checklist → optimistic
  toggle (watch the readiness KPI move), card → detail modal, timeline rows,
  type filter, source pills, empty states (first-run and all-clear).
- **Tasks** — summary line, course filter, readiness cards, roadmap checkboxes.
- **Calendar** — Today/prev/next, mini-cal jump, merged slot+exam card, plain
  slot → popover, standalone exam card → detail, custom event → edit/delete,
  layer checkboxes.
- **Detail modal** — topic checkboxes, grade editor + what-if projection,
  Export .ics (cancel the dialog), Start Focus Pomodoro, Practice Quiz,
  close (X and Escape).
- **All modals** — open each, exercise every input, Escape closes LIFO.
- **Keyboard** — `/`, Ctrl+K, Escape (modal stack order).
- **Themes** — repeat the critical surfaces in light and dark.

### Protocol per finding

1. Reproduce once, **screenshot the broken state** (the "before").
2. Diagnose in code; distinguish real bugs from harness artifacts
   (re-test dead-looking controls via CDP DOM clicks before calling them dead).
3. Fix; add the regression test at the lowest layer that can express it
   (unit → contract → visual → e2e).
4. Re-verify on the rebuilt app; screenshot the fixed state (the "after").
5. Log both paths in the review report.

Findings from the phase-18 sweep, for calibration: 2 dead-control false
positives (harness artifacts — proven via CDP), 7 real defects across honesty
copy, shape adaptation and a11y, and 1 parser fidelity fix — each with a
regression test.

### Instrumentation the sweep relies on

- `window.__QUIZRADAR_STORE__` — **dev builds only** (`main.tsx`,
  `import.meta.env.DEV`): lets the harness seed state and read the store.
  The production bundle never exposes it.
- The WebView2 data dir (`%LOCALAPPDATA%\com.quizradar.app`) holds the real
  SQLite DB (`quizradar.db`) next to the WebView2 profile (`EBWebView/`).
  When a rebuild seems to "not apply", clear **only**
  `EBWebView/Default/{Cache,Code Cache,Service Worker,GPU*}` — never the DB —
  and relaunch: the service worker/HTTP cache can pin a stale bundle.
- A destructive UI action must be attributable: if a schedule/stamp changes
  unexpectedly, `schedule_updated_at` and `last_gmail_sync` in `kv_meta` /
  `config_kv` tell you **when** (read the DB read-only:
  `python -c "import sqlite3; …"` with `mode=ro`), and the WAL keeps deleted
  row bytes recoverable until checkpoint.

### Honesty checks (run on real data)

- Undated items render **no countdown** (never "In 0d").
- Missing room renders "—", never "Room —", "TBA" or a default hall.
- Empty scan says what ran and found nothing; a canceled scan says canceled.
- 0/0 readiness reads 100 (documented semantic), never a fake percentage of a
  fake total.
- Every optimistic update has a visible rollback on failure.

## Cadence

- **Every commit:** layers 1–4 (CI runs them).
- **Before every push to main:** layer 5.
- **Before every release / after any UI phase:** layer 6 (full sweep), plus a
  fresh look at the honesty checks.
