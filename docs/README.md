# QuizRadar Documentation System

QuizRadar uses a strict **4-tier documentation system** enforced by `tooling/agent-gate.mjs` so docs stay current and never bloat.

## The 4 Tiers

| Tier | Location | Purpose | Rule |
|---|---|---|---|
| **1. Entrypoints** | `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `PRIVACY.md`, `SECURITY.md` | Public overview, single engineering rulebook, legal | No duplicated command lists; `CLAUDE.md` & `CONTRIBUTING.md` point to `AGENTS.md`. |
| **2. Evergreen Docs** | `docs/*.md` (allowlisted below) | Current system truth only — no history, no "Round X" essays | Updated in place when behavior changes; hard line budgets enforced in CI. |
| **3. Decisions (ADRs)** | [`docs/adr/`](./adr/README.md) | Architectural decisions & maintainer overrides (`NNNN-slug.md`) | Append-only; never edited after acceptance, only superseded by a newer ADR. |
| **4. Change History** | `changes/*.md` → `CHANGELOG.md` + `docs/worklog/` | Per-branch summaries, verification logs, handoffs | Created via `pnpm agent:note`; auto-archived by `tooling/version-rollup.mjs` on merge to `main`. |

## Evergreen Doc Manifest (Allowlist)

| File | Scope | Budget |
|---|---|---:|
| [`docs/README.md`](./README.md) | This documentation system index | ≤ 80 lines |
| [`docs/STATUS.md`](./STATUS.md) | Live version/schema snapshot & canonical verification commands | ≤ 100 lines |
| [`docs/product-spec.md`](./product-spec.md) | Product behavior, honesty doctrine, domain glossary, verbatim AI consent | ≤ 180 lines |
| [`docs/architecture.md`](./architecture.md) | Locked stack, repo layout, storage/sync/auth, banned v4 patterns | ≤ 180 lines |
| [`docs/android-design.md`](./android-design.md) | Native Android Compose M3 "Quiet instrument" design tokens & rules | ≤ 120 lines |
| [`docs/testing.md`](./testing.md) | 7-layer verification playbook & per-PR performance regression gate | ≤ 200 lines |
| [`docs/release.md`](./release.md) | Versioning, signing keys, Forgejo/GitHub release pipeline | ≤ 120 lines |
| [`docs/oauth.md`](./oauth.md) | Google CASA Tier 2 & Microsoft Entra verification runbook | ≤ 120 lines |
| [`docs/roadmap.md`](./roadmap.md) | Active product & commercial roadmap | ≤ 100 lines |

## Rules for Documenting Changes

1. **Feature / bug / refactor / CI work:** Run `pnpm agent:note ...` to add `changes/<slug>.md`. If you changed behavior, update the matching evergreen doc above in the same PR.
2. **Architectural choice or rule exception:** Add a short numbered file under `docs/adr/NNNN-slug.md` and link it from `docs/adr/README.md`.
3. **One-off audits, demos, screenshots, scratch notes:** Put them in PR descriptions, Forgejo/GitHub issues, or gitignored `scratch/` — **never** commit them under `docs/`.
4. **Historical reference:** Pre-purge docs (v5.0 rebuild specs, past audits, Round 1–16 logs) remain intact under git tag `docs-pre-purge-2026-11`; legacy v4 code lives under `v4-final`.
