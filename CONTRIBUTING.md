# Contributing to QuizRadar

Human contributors and AI agents share one protocol defined in **[`AGENTS.md`](./AGENTS.md)** and indexed in **[`docs/README.md`](./docs/README.md)**.

## Quickstart

1. **Install dependencies & git hooks:** `pnpm install` (automatically installs `tooling/git-hooks`).
2. **Check workspace & required gates:** `pnpm agent:preflight` (canonical commands live in [`docs/STATUS.md`](./docs/STATUS.md)).
3. **Branch & push (Forgejo-first):** Branch from `main`, push to **`origin` (Forgejo)** — commits mirror automatically to GitHub (`TheDragonSoft/QuizRadar`). See [ADR-0004](./docs/adr/0004-forgejo-first-git-and-ci.md).
4. **Record your change:** Never edit `tooling/version.json` or `CHANGELOG.md` on feature branches. Run:
   ```bash
   pnpm agent:note --bump <patch|minor|major|none> --surfaces <core,web,...> --agent human --summary "<what & why>" --verify "<commands run>"
   ```
5. **Commit with Conventional Commits:** `feat(scope):`, `fix(scope):`, `perf(scope):`, `refactor(scope):`, `test(scope):`, `docs(scope):`, `chore(scope):`, `ci(scope):`.
