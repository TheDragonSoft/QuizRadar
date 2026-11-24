# Architecture Decision Records (ADRs)

Short, immutable records of architectural decisions and scoped overrides to `AGENTS.md`. Once accepted, an ADR is **never edited** — if a decision changes, add a newer ADR that supersedes it.

## Index

| ID | Title | Date | Status |
|---|---|---|---|
| [0001](./0001-desktop-oauth-secret.md) | Desktop-only bundled Google OAuth secret & Android public client ID | 2026-10-28 (amended 2026-11-05) | Accepted |
| [0002](./0002-ephemeral-lan-https-pairing.md) | Ephemeral Desktop-only LAN HTTPS QR pairing session | 2026-11-20 | Accepted |
| [0003](./0003-zero-key-trial-ai-relay.md) | Opt-in stateless Zero-Key Trial AI Relay (Cloudflare Worker) | 2026-11-21 | Accepted |
| [0004](./0004-forgejo-first-git-and-ci.md) | Forgejo-first Git remote & split Forgejo/GitHub CI | 2026-11-24 | Accepted |

## Template (for new ADRs)

Create `docs/adr/NNNN-short-slug.md` with: **Status**, **Date**, **Context**, **Decision**, **Scope / Guardrails**, and **Consequences**, then add a row above.
