# GitHub Copilot & Automated Agent Instructions — QuizRadar

Always follow **[`AGENTS.md`](../AGENTS.md)** and **[`docs/STATUS.md`](../docs/STATUS.md)** as the canonical repository rules.

## Key Rules for Every PR / Bot Session (Copilot, Jules, Bolt, Palette, Codex)

1. **Start with preflight:** Run `node tooling/agent-preflight.mjs` (`pnpm agent:preflight`) to inspect current SemVer, branch drift, active worktrees, pending `changes/*.md` notes, and required test gates.
2. **Core purity & Locked stack (`AGENTS.md` §1, §3):**
   - Pure Rust domain logic lives in `core/` (compiled natively for Tauri Desktop, via UniFFI for Android Kotlin/Compose, and to WASM for Web/PWA).
   - Zero backend servers, zero telemetry, zero fabricated data (missing room renders `"—"`), PKCE OAuth only (respecting the scoped desktop override in `AGENTS.md` §3.2).
   - User-facing web strings belong in `apps/web/src/copy.ts`.
   - If `core/src/types.rs` or `core/src/ffi.rs` changes, re-stamp `node apps/web/src/contract/regenerate.mjs` and regenerate Kotlin UniFFI bindings (`./gradlew uniffiGenerate` in `apps/mobile-android`).
3. **Conflict-free versioning & handoff (`changes/<slug>.md`):**
   - **Do NOT edit `tooling/version.json`, `CHANGELOG.md`, or append task logs to `docs/STATUS.md` in PRs.**
   - Every PR touching `core/` or `apps/` (or containing `feat:` / `fix:` / `perf:` commits) MUST commit a handoff & SemVer fragment in `changes/<slug>.md`:
     ```bash
     node tooling/agent-note.mjs --bump patch --surfaces web --agent copilot --summary "Concise description of change" --verify "pnpm lint; pnpm typecheck; pnpm test" --handoff "None"
     ```
   - Merging to `main` automatically bumps SemVer across all 5 sinks + `Cargo.lock`, updates `CHANGELOG.md`, and archives fragments into `docs/worklog/`.
4. **Conventional Commits:** Every commit subject must match `<type>(optional-scope): <description>` (`feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore`, `ci`, `build`, `style`, `revert`), validated in CI by `node tooling/agent-gate.mjs --ci`.
