# CLAUDE.md — Agent Entrypoint

Read **[`AGENTS.md`](./AGENTS.md)** and **[`docs/STATUS.md`](./docs/STATUS.md)** first — they are the single source of truth for QuizRadar's rules, Forgejo-first Git/CI workflow, and verification commands.

## 4-Step Loop

1. Run `pnpm agent:preflight` before editing.
2. Work on an isolated branch/worktree; always fetch, push, and open PRs against **`origin` (Forgejo)**.
3. Run all required verification gates honestly (never fabricate results or missing rooms).
4. **Auto-finish:** Once verified, automatically run `pnpm agent:note --bump ... --surfaces ... --agent claude --summary "..." --verify "..."`, commit with Conventional Commits, and push to **`origin` (Forgejo)** without waiting to be asked. Never edit `tooling/version.json`, `CHANGELOG.md`, or add ad-hoc audit files to `docs/`.
