# ADR-0002: Ephemeral Desktop-Only LAN HTTPS Pairing Session

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

Students want fast local two-way sync between QuizRadar Desktop and Android on the same Wi-Fi/hotspot without relying on Google Drive or manually passing JSON files. The v4 persistent Axum HTTP server (`--lan`) was deleted because it ran persistently over cleartext HTTP and duplicated API routes.

## Decision

Authorize an **ephemeral, on-demand Desktop-only LAN HTTPS pairing session** (`apps/desktop/src-tauri/src/lan_pair.rs`) that displays a QR code containing the local HTTPS URL, a pinned per-session self-signed TLS certificate SHA-256 fingerprint, and a single-use 256-bit bearer token.

## Scope & Guardrails

- Exchanges **data-only** `BackupPayload` JSON (zero OAuth tokens or secrets).
- Auto-closes immediately after **1 bidirectional sync or 5 minutes**, whichever comes first.
- Keeps `android:usesCleartextTraffic="false"` and HTTPS-only networking intact.
- Never turn this into a persistent daemon or expose non-sync routes on it. Do not revert it as the deleted v4 Axum server.
