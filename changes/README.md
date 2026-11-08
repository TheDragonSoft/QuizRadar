# Pending Agent Handoff & Version Fragments (`changes/`)

Each branch or AI agent task records its work as **one isolated Markdown file** in this directory (`changes/<slug>.md`) instead of editing `tooling/version.json` or appending essays to `docs/STATUS.md`.

## Why this exists

1. **Zero merge conflicts across parallel AI agents & git worktrees:** Multiple agents (Antigravity, Claude Code, Codex, Cursor, Jules/Bolt/Palette, Copilot) can work concurrently without colliding on `tooling/version.json`, the 5 version sinks, `CHANGELOG.md`, or `docs/STATUS.md`.
2. **Structured inter-agent handoffs:** Running `pnpm agent:preflight` reads pending fragments across all local worktrees so incoming agents see what sibling branches are changing, how they verified it, and any follow-ups left behind.
3. **Automatic SemVer & Changelog rollup on `main`:** When a PR merges into `main`, `.github/workflows/version-bump.yml` runs `node tooling/version-rollup.mjs --apply` to compute the next SemVer (`major` > `minor` > `patch` > `none`), stamp `tooling/version.json` + all 5 sinks + `Cargo.lock`, update `CHANGELOG.md`, archive full handoff details into `docs/worklog/YYYY-MM.md`, and remove the consumed fragment files.

## Quick usage

```powershell
pnpm agent:note --bump patch --surfaces core,web --agent antigravity --summary "Short description of what changed and why" --verify "cargo test --workspace; pnpm test" --handoff "Optional follow-up note for the next agent"
```

Validate or list pending notes at any time:

```powershell
pnpm agent:note --validate
pnpm agent:note --list
```
