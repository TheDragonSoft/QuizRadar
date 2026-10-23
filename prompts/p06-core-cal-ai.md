# Phase 06 — Core: Google Calendar push, ICS export, AI provider layer

> After phase 05. Completes the core: calendar outgoing + the BYOK AI layer.

**Read first:** `AGENTS.md` §8 (AI security items); `docs/rebuild/05-ai-features-plan.md` (whole doc — model choices, quota design, consent copy, degradation ladder); `docs/rebuild/02-current-architecture.md` §5.6 (gcal event shape) + §6 (six AI call sites → v5 keeps 4); `docs/rebuild/01-product-spec.md` §4.6 (assessment modal actions) + §4.7 (practice).

**Reference implementation:** `git show v4-final:src/gcal.rs` (event body format, idempotent upsert via sync-map, honest scope reporting), `git show v4-final:src/gemini.rs` (extraction prompts, JSON-response-mode, timetable-vision prompt at :266–418, practice generation :836–977), and `git show v4-final:static/app.js` on-device practice fallback generator (9324–9383 area) for the honest fallback authoring.

## Build

1. `core/src/cal/gcal.rs` — push/update upcoming assessments to primary calendar: idempotent via `synced_gcal_map` from the store; 404⇒recreate; 403/401⇒`needs_scope` report (never mark synced); event body per v4 format (⚡ `[CODE] title`, topics/warnings/strategy sections, inference note, −1d/−2h reminders) using the *user's* data only; times: IANA-offset computed by caller-injected offset fn (fix c7 stringly seams). Template URL builder for "Add to Calendar" links.
2. `core/src/cal/ics.rs` — export single/all: RFC5545, floating local times, `UID:quizradar-<id>@quizradar.local`, 2 VALARMs, escaping, honest PRODID fixed to v5 (`-//QuizRadar//v5//EN`).
3. `core/src/ai/provider.rs` — traits: `ChatJson { prompt: StructuredPrompt } -> Result<RawJson>` + `Vision { image_b64, mime, prompt } -> RawJson`; `QuotaTracker` (in-store kv: per-day counters, reset midnight **Pacific** as documented — the only place the impl cares), `AiCreditNote { source: either }` typing.
4. `core/src/ai/gemini.rs` — `x-goog-api-key` header ONLY; model ladder per `05` §3.1: `flash-lite` for email extraction + practice, `flash` for vision import + optimize; `responseMimeType: application/json`, temp 0.1–0.2; rich typed errors: 400 invalid key ⇒ advise check, 429 ⇒ quota + fallback note, 5xx/network ⇒ retryable; **no OAuth-bearer fallback** (§06 of 05; `03` E2).
5. `core/src/ai/tasks.rs` — the four tasks with typed prompts + parser (strict JSON w/ lenient fence-strip):
   a. `extract_assessment(email_ctx, schedule)` → typed assessment drafts (same schema as parse::email output for merge-ability),
   b. `extract_timetable(image)` → courses/slots/semester (strict "never invent unknowns" schema; None-preserving),
   c. `optimize_plan(assessments, schedule)` → readiness/tasks (validated against real completion state — never trusts AI topics),
   d. `generate_practice(assessment)` → 5 MCQs (validate: every option non-empty, `correct_index` in range).
   Every call-site: pre-check quota, post-record usage, all failures return **typed `AiUnavailable { reason }`** so callers fall back to deterministic paths.
6. `core/src/ai/practice_fallback.rs` — deterministic on-device question authoring from assessment topics (topical MCQ framework quiz; explicitly labeled `authored_locally` in payload). No demo question banks, no invented professor quotes.
7. `core/src/ai/mod.rs` docs: consent copy constants (from `05` §5.1) exported for UI use (one English line, UI shall not paraphrase loosely).

## Acceptance
- [ ] Httpmocked tests: gemini 200/400/429/timeout paths; quota reset behavior; practice fallback determinism
- [ ] GCal push idempotency test (two runs ⇒ 0 new events second run)
- [ ] ICS export unit tests (escaping, VALARM count, UID stability)
- [ ] `03` §E2 banned pattern absent: grep proves no `Authorization: Bearer` in `core/src/ai/`
- [ ] STATUS updated; AI consent copy included in STATUS verbatim check

## Commit
`phase(6): core calendar push/ICS + BYOK AI provider layer`
