# Contributing to QuizRadar

Thank you for contributing to QuizRadar — a local-first, zero-server academic dashboard for university students. Both human contributors and AI coding agents share the same workflow defined in [`AGENTS.md`](./AGENTS.md).

---

## 1. Golden Rules & Architectural Principles

1. **Honesty Doctrine:** Never fabricate data, rooms, countdowns, grades, or fake success indicators. Missing rooms render `"—"`. Estimations must be explicitly labeled with provenance.
2. **Zero Secrets in Code or Git:** Never commit API keys, OAuth client secrets, tokens, or credentials. Use PKCE for OAuth (see `AGENTS.md` §3.2 for the sole scoped desktop override). Secrets live exclusively in OS Keyring (Desktop), EncryptedSharedPreferences (Android), or ephemeral memory (Web/PWA).
3. **Core Purity:** Domain logic, parsers, conflict detection, study blocks, SQLite persistence, and source integrations live in the pure Rust `core/` crate. Shells (`apps/desktop`, `apps/mobile-android`, `apps/web`) stay thin UI wrappers.
4. **Conflict-Free Versioning (`changes/<slug>.md`):** Never hardcode version literals or edit `tooling/version.json` on feature branches. Record changes via `pnpm agent:note`; GitHub Actions (`.github/workflows/version-bump.yml`) automatically updates `tooling/version.json`, all 5 version sinks, `Cargo.lock`, `CHANGELOG.md`, and `docs/worklog/` on merge to `main`.

---

## 2. Multi-Agent & Contributor Workflow

1. **Install dependencies & local git hooks:**
   ```powershell
   pnpm install
   ```
   (`prepare` installs `tooling/git-hooks` automatically; run `pnpm hooks:install` manually anytime.)
2. **Run preflight before starting work:**
   ```powershell
   pnpm agent:preflight
   ```
3. **Create a branch/handoff note before pushing:**
   ```powershell
   pnpm agent:note --bump patch --surfaces core,web --agent human --summary "Describe your change" --verify "cargo test --workspace; pnpm test"
   ```

---

## 3. Verification Gates

### Web & Tooling (`apps/web/`, `tooling/`)

```powershell
pnpm --dir apps/web build:wasm
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

### Rust Workspace (`core/`, `apps/desktop/src-tauri/`)

```powershell
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

### Android App (`apps/mobile-android/`, JDK 21)

```powershell
cd apps/mobile-android
.\gradlew.bat ktlintCheck testDebugUnitTest
```

---

## 4. Conventional Commits

Commit messages are validated by local git hooks and CI (`tooling/agent-gate.mjs`):

- `feat(scope): ...` (minor bump)
- `fix(scope): ...` / `perf(scope): ...` (patch bump)
- `feat(scope)!: ...` or `BREAKING CHANGE:` footer (major bump)
- `refactor(scope): ...` / `test(scope): ...` / `docs(scope): ...` / `chore(scope): ...` / `ci(scope): ...`
