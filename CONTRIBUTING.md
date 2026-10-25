# Contributing to QuizRadar

Thank you for your interest in contributing to QuizRadar! QuizRadar is a local-first, zero-server academic dashboard designed for university students to track quizzes, exams, assignments, study tasks, and schedules.

---

## 1. Golden Rules & Architectural Principles

Before writing code, please review these core rules:

1. **Honesty Doctrine:** Never fabricate data, rooms, countdowns, grades, or fake success indicators. If data is unknown or missing, render `"—"`. Estimations must be explicitly labeled with provenance.
2. **Zero Secrets in Code or Git:** Never commit API keys, OAuth client secrets, tokens, or credentials. Use PKCE for OAuth. Secrets live exclusively in OS Keyring (Desktop), EncryptedSharedPreferences (Android), or ephemeral memory (Web/PWA).
3. **Core Purity:** All core domain logic, parsers, conflict detectors, study block generators, SQLite persistence, and source integrations live strictly in the Rust `core/` crate. Shells (`apps/desktop`, `apps/mobile-android`, `apps/web`) are thin UI wrappers.
4. **Single Source of Truth for Versions:** Never hardcode version literals. Update `tooling/version.json` and run `node tooling/generate-version.mjs --apply`.

---

## 2. Prerequisites & Development Environment

- **Rust:** Stable toolchain (`rustup update stable`) with `rustfmt` and `clippy`.
- **Node.js:** Node.js 20+ with `pnpm` (v9+).
- **Java:** JDK 21 (Temurin / Adoptium recommended).
- **Android SDK:** Compile SDK 35, Command-line Tools, Build Tools 34.0.0+.

---

## 3. Verification Commands

All pull requests must pass the complete workspace quality gates before merging:

### Web Tier (React 19 + TypeScript + Vite)

```powershell
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

### Rust Core (`core/`)

```powershell
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

### Android App (`apps/mobile-android/`)

```powershell
cd apps/mobile-android
.\gradlew.bat ktlintCheck testDebugUnitTest
```

---

## 4. Conventional Commits & Pull Requests

We follow conventional commit format:

- `feat(scope): ...`
- `fix(scope): ...`
- `test(scope): ...`
- `docs(scope): ...`
- `chore(scope): ...`
- `phase(N): ...` (for rebuild phase milestones)

Ensure your branch is clean, formatted, tested, and contains no committed test databases or personal tokens.
