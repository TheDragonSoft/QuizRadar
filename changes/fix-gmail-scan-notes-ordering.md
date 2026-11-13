---
bump: patch
surfaces: [core]
agent: OpenCode (GLM-5.3)
branch: fix/gmail-scan-notes-ordering
date: 2026-11-12
---

### Summary

Gmail scan no longer discards search-phase notes: a second shadowing notes declaration silently dropped per-query truncation warnings and the partial-query-failure warning; the partial-failure note now names every failed query with its error instead of only the first. Email cache ordering and CACHED_REFRESH_LIMIT selection no longer treat Gmail ids as a chronological contract (per-query newest-first concatenation is not globally newest-first); both rank by internalDate with id as deterministic tiebreak. Four regression tests added; GmailRunStats fields unchanged so no UniFFI/WASM contract regen.

### Verification

- cargo test -p quizradar-core (402 passed: 328 unit + 74 integration/property/fixture)
- cargo clippy -p quizradar-core --all-targets -- -D warnings
- cargo fmt --all --check

### Handoff / Follow-ups

- Deferred review items: Mutex/atomic fetch-pipeline simplification
- strict text/plain MIME two-pass gate (attachments in format=full carry attachmentId without data, so hardening not correctness)
- encoded-body bound does not cover 4-byte UTF-8 worst case (emoji truncates at ~22.5k chars, not 30k)
- GmailRunStats naming (cache_refreshed counts attempts)
- per-message fetch error strings collapsed to a count. authed_get already retries 429/5xx with Retry-After, no retry work needed.
