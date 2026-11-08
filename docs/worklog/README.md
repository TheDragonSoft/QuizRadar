# Agent Worklog Archive (`docs/worklog/`)

Monthly logs (`YYYY-MM.md`) in this directory are generated automatically by `node tooling/version-rollup.mjs --apply` when `changes/*.md` fragments are rolled up on `main`.

- Need **current operational status, commands, or open backlog**? Read [`docs/STATUS.md`](../STATUS.md) and run `pnpm agent:preflight`.
- Need **in-flight branch handoffs**? Check [`changes/`](../../changes/) or run `pnpm agent:note --list`.
- Need **v5.0 rebuild history (Phases 01–20 & Audit Rounds 1–15)**? See [`docs/archive/STATUS-v5.0-rebuild.md`](../archive/STATUS-v5.0-rebuild.md).
