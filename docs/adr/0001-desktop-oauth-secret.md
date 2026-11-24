# ADR-0001: Desktop-Only Bundled Google OAuth Secret & Android Public Client ID

- **Status:** Accepted
- **Date:** 2026-10-28 (amended 2026-11-05)

## Context

Google's token endpoint (`oauth2.googleapis.com/token`) requires `client_secret` for Desktop/Installed OAuth clients even when PKCE is used (`invalid_request: client_secret is missing`). Requiring students to register their own Google Cloud project breaks out-of-the-box sign-in.

## Decision

1. **Desktop shell (`apps/desktop/src-tauri/src/state.rs`):** Ship `DEFAULT_GOOGLE_CLIENT_ID` (`341760934836-60toi8rjgkid0gmc69tmt598teghbgv4.apps.googleusercontent.com`) and `DEFAULT_GOOGLE_CLIENT_SECRET` solely for Google token exchange and refresh grants. Runtime overrides (OS keyring `google_client_secret` or `QUIZRADAR_GOOGLE_CLIENT_SECRET`) always take precedence.
2. **Android (`apps/mobile-android/`):** Ship the client **ID only** (PKCE public client — zero secret ever). A user-supplied ID in Settings always wins, and legacy placeholder IDs remain refused.

## Scope & Guardrails

- The secret must **never** enter `core/`, the WASM/PWA bundle, Android, SQLite, UI state, logs, error strings, or the OAuth authorize URL (verified by unit tests and line-scoped exemption in `tooling/agent-gate.mjs`).
- Do **not** revert this as a spec violation, and do **not** widen the exemption beyond those two named constants in `apps/desktop/src-tauri/src/state.rs`.
