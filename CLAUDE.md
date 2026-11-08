# CLAUDE.md — QuizRadar Agent Entrypoint

Read **[`AGENTS.md`](./AGENTS.md)** and **[`docs/STATUS.md`](./docs/STATUS.md)** first — they are the single canonical source of truth for QuizRadar's architecture, honesty doctrine, security rules, and multi-agent coordination.

## Mandatory 4-Step Session Loop

1. **Preflight first:** Run `pnpm agent:preflight` before making edits. Check active `git worktree` peers, `CONFLICT RADAR` file-overlap warnings, and pending `changes/*.md` handoffs from other agents.
2. **Isolate your branch/worktree:** Never commit directly to `main` or share a dirty working tree with a concurrent agent session.
3. **Verify honestly:** Run every required gate listed by `pnpm agent:preflight` (note: local Windows shell is PowerShell 5.1 — avoid `&&`; run commands separately or use `; if ($?) { ... }`). Never fabricate rooms (`"—"` when missing), stats, or unexecuted test claims.
4. **Leave a conflict-free handoff & version note (`changes/<slug>.md`):**
   - **Never** edit `tooling/version.json`, the 5 stamped version sinks, or append task logs to `docs/STATUS.md` on feature branches.
   - Instead, run:
     ```powershell
     pnpm agent:note --bump <patch|minor|major|none> --surfaces <core,web,desktop,android,tooling,docs,ci> --agent claude --summary "<what changed & why>" --verify "<exact commands run>" --handoff "<follow-ups or None>"
     ```
   - Commit with Conventional Commits (`feat(scope): ...`, `fix(scope): ...`, etc.). GitHub Actions (`.github/workflows/version-bump.yml`) automatically rolls up `changes/*.md` into SemVer, all 5 sinks, `CHANGELOG.md`, and `docs/worklog/` on merge to `main`.
