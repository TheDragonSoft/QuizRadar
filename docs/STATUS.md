# STATUS — QuizRadar Live Operational Snapshot

_Auto-maintained version snapshot & canonical verification commands (hard cap `<= 100` lines in `tooling/agent-gate.mjs`). Never log per-task work here — use `pnpm agent:note` (`changes/<slug>.md`)._

## Snapshot

- **Current Version:** `5.20.0` (source of truth: `tooling/version.json` → 5 stamped sinks)
- **Database Schema:** `SCHEMA_VERSION = 6` (SQLite `core/src/store/db.rs` + PWA IndexedDB `apps/web/src/pwadapters/idbStore.ts`)
- **Primary Remote:** `origin` = Forgejo (`git@forgejo:GordyTheKat/QuizRadar.git`, auto-mirrored to GitHub `TheDragonSoft/QuizRadar`)
- **Active CI:** Fast checks in `.forgejo/workflows/` (`devbox-host`); releases, Pages, SemVer rollup & emulator suites in `.github/workflows/`

## Canonical Verification Commands

### Agent, Version & Docs Gates

```bash
pnpm agent:preflight                              # version, worktrees, conflict radar, required gates
node tooling/generate-version.mjs --check         # all 5 version sinks match tooling/version.json
node apps/web/src/contract/regenerate.mjs --check # Rust <-> TS wire contract map is fresh
pnpm agent:note --validate                        # all changes/*.md fragments valid
pnpm test:tooling                                 # version rollup, agent-gate, perf & CI meta-tests
```

### Rust Workspace (`core/` + `apps/desktop/src-tauri/`)

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo test -p quizradar-desktop
```

### Web, PWA & Landing (`apps/web/`, `apps/landing/`, `workers/`)

```bash
pnpm --dir apps/web build:wasm
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --dir apps/web exec playwright test --grep-invert @visual
```

### Android (`apps/mobile-android/`, Temurin JDK 21 + NDK r27b)

```bash
# Linux/macOS: ./gradlew ... | Windows PowerShell: .\gradlew.bat ...
cd apps/mobile-android && ./gradlew ktlintCheck lintRelease testDebugUnitTest assembleDebug
```

### Performance Regression Gate (`performance/`)

```bash
pnpm perf:core -- --base-bin <base> --head-bin <head> --samples 15
pnpm perf:web -- --base-dist <base> --head-dist <head> --samples 15
pnpm perf:review
```

## Quick Links

- **Rules & Workflow:** [`AGENTS.md`](../AGENTS.md) · [`docs/README.md`](./README.md)
- **Specs & Architecture:** [`docs/product-spec.md`](./product-spec.md) · [`docs/architecture.md`](./architecture.md) · [`docs/android-design.md`](./android-design.md)
- **Runbooks:** [`docs/testing.md`](./testing.md) · [`docs/release.md`](./release.md) · [`docs/oauth.md`](./oauth.md)
- **Decisions & Roadmap:** [`docs/adr/`](./adr/README.md) · [`docs/roadmap.md`](./roadmap.md)
- **History:** [`CHANGELOG.md`](../CHANGELOG.md) · [`docs/worklog/`](./worklog/README.md) · git tag `docs-pre-purge-2026-11`
