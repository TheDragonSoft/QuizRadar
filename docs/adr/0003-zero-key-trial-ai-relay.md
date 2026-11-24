# ADR-0003: Opt-In Stateless Zero-Key Trial AI Relay

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

First-run students often abandon syllabus PDF import and AI extraction when forced to create a Google AI Studio API key up front. However, QuizRadar's privacy promise forbids storing user data or receiving OAuth tokens on any server.

## Decision

Authorize an **opt-in, stateless Zero-Key Trial AI Relay** (`workers/trial-ai-relay/`, Cloudflare Worker over HTTPS) to power starter first-run AI extractions without requiring a user-supplied Gemini API key.

## Scope & Guardrails

- **Stateless & zero-PII persistence:** Never stores user payloads, emails, or syllabi; rejects `Authorization` headers (`400`); only tracks anonymous per-device rate-limit counters in KV.
- **Consent preserved:** Keeps AI off by default and preserves the verbatim free-tier disclosure (`docs/product-spec.md` §4).
- **BYOK always wins:** Power users with a Gemini API key in Settings bypass the relay entirely.
- Do not revert this as a zero-server spec violation.
