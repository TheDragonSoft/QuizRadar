# 05 — AI Feature Plan: free-forever for every user

_Goal: keep all four AI features (assessment extraction from emails, timetable vision import, study-plan optimization, practice quizzes) powered at **$0 per user**, without ever degrading the honesty doctrine or the "100% local privacy" brand._

---

## 1. The $0-per-user model: Bring Your Own Key (BYOK)

There are only three honest ways to run AI calls for a server-less app:

| Model | Cost/user | Privacy | Dev cost | Verdict |
|---|---|---|---|---|
| **1. BYOK — user pastes their own provider key** | $0 for you, $0 for user on a provider's free tier | Data flows user→provider directly | Lowest | ✅ Primary (already your pattern) |
| 2. Sponsored relay server (you pay per user) | ~$0.02–0.10/user/mo | Data via your server | Highest (infra + auth + billing) | Later, only if growth demands it |
| 3. Fully on-device model | free, private | Best | Very high for good results | Revisit for text-only tasks; not for vision |

v5 = Model 1, structured so Model 2 can be added later without UI redesign: the AI layer is a **provider interface** (`packages/core/ai/provider.ts`) with a default "manual key" implementation. A relay someday = a second provider implementation + settings-gated key.

## 2. Provider choice & free-tier reality (verified 2026-10)

**Primary: Google Gemini API (AI Studio keys)** — the only major provider with a real, generous free tier that includes vision:

- `gemini-2.5-flash` — free of charge on the free tier (input+output are free), installed quota ≈ **250 requests/day** per *project* (shown per project in AI Studio; Google does not print them in docs; RPD resets midnight Pacific).
- `gemini-2.5-flash-lite` / newer `*-lite` generations — free tier ≈ **1,000 requests/day**, ideal for the bulk email-extraction job.
- `gemini-2.5-pro` also has a (smaller ~100 RPD) free allocation — useful for the study-plan optimize endpoint.
- Free tier trade-off that MUST be surfaced: Google may use free-tier requests to improve products — i.e., **emails sent to Gemini are not private-local**. The settings copy must say this at enable-time (one toggle line), or the privacy badge is a lie.
- Key goes via `x-goog-api-key` header (never in URL) — as already done. Quota is **per project, not per key** (multiple keys don't multiply quota; show this in the helper copy so users stop creating keys).

Fallback providers to mention in the key helper (BYOK-compatible, CORS-friendly from the browser): OpenAI, OpenRouter (free models exist, quotas vary), Groq, Mistral (has a free "experiment" tier incl. an 8k context vision model — nice backup for timetable images). Implement the provider interface first for Gemini, keep the door open.

## 3. Making 250–1,000 RPD feel unlimited (quota design)

The user's real demand curve is small: a semester of maybe 200 candidate emails, a timetable import or two, occasional optimize/practice. The budget is only ever threatened by *waste*. Rules to bake into `packages/core/ai`:

1. **Cache by content, not id.** Cache key = `hash(provider, taskType, modelId, inputHash)` where `inputHash` = hash of email body + subject + timetable revision. Re-parses (schedule edits) reuse cache without a new call. Persist cache in the local DB (reuse the current `gemini_parsed_cache.json` idea).
2. **Only candidates that fail heuristics** go to AI first-run? No — flip: pay the flash-lite call per new candidate email (they're rare), but **never on dashboard renders/refreshes**, only on new-arrival ingestion.
3. **Model laddering** per task:
   - email extraction → `gemini-2.5-flash-lite` (1,000 RPD budget)
   - timetable image import → `gemini-2.5-flash` (rare, manual, user-triggered)
   - study-plan optimize → `gemini-2.5-flash` (user-triggered button, ~1 call)
   - practice quizzes → `gemini-2.5-flash-lite` (5 questions per exam, on-demand)
4. **Client quota tracker:** record each call (local-only) and show the user "AI calls today: 37/~X (resets midnight PT)" in Settings + degrade messaging at 80%.
5. **Degradation ladder (ality, not theatre):** every AI feature has a labeled deterministic fallback: heuristic extract (already good), deterministic study planner (already good), on-device practice from topics (already good). When quota hits 429, the UI shows "Free Gemini limit reached — using offline heuristics until midnight PT" — honest, tree-shaken, no silent theater.
6. **No AI on render paths.** `days_until`, urgency, readiness, dashboards never trigger calls (currently true; keep it as a lint rule on core).

Result: a typical user consumes **<15 calls/month**; the 250/1,000 daily budgets are effectively infinite; occasionally a heavy scan day on the lite model — still fine.

## 4. Features × AI mapping (v5)

| Feature | Trigger | Model | Fallback (must exist) | Notes |
|---|---|---|---|---|
| Email assessment extraction | during scan, new candidates only | flash-lite | heuristic extractor incl. relative-phrase anchoring | staffed by cache; merge rule = any non-empty AI field wins, `is_assessment=false` drops |
| Timetable image import (vision) | button in onboarding/settings | flash | manual course/slot editor (always available) | strict "never invent unknowns" schema; preview modal |
| Study-plan optimize | "Optimize with AI" button | flash | deterministic planner (topics modulo distribution) | recommendation recompute local-only |
| Practice quiz | button on assessment | flash-lite | on-device MCQs from topics (labeled) | 5 items; JSON response-mime |
| (Deliberately absent) | automatic background anything | — | — | no free-tier burn without user intent |

## 5. Consent, privacy, honesty (brand-critical)

1. **Enable-time disclosure:** Settings-AI panel and onboarding card include one plain sentence: "Your email announcements and timetable images are sent to Google's Gemini API when AI is used. On Google's free tier, Google may use that content to improve its products." + "Turn off to stay fully local."
2. **Remove the silent OAuth-bearer fallback.** Current v4.3.0 silently retries AI calls with the user's Google access token when no API key exists (most `gemini.rs` sites) — that is consent-invisible cost on the user's Google identity. v5: OAuth-AI is either **absent** or an explicit toggle ("Let QuizRadar ask Google to use my sign-in for AI") default-off.
3. **Optionally honor scope discipline for AI:** no personal Gmail bodies go through AI unless the email was a *candidate*; cache stored plaintext-local as today, but v5 stores the whole DB with OS keyring-backed encryption on desktop/mobile (fixes 03/E3).
4. **Show provenance per item:** every assessment carries `ai_inference_note` — v5 UI keeps this visibly (chip "AI-assisted estimate" vs "implied by timetable" vs "explicit in announcement"), preserving the established honesty doctrine.

## 6. Future options (when scale demands)

- **Sponsored relay (per-user free):** tiny Cloudflare Worker + KV: user signs in (Google), you allow N daily calls ≤1,000 RPD total at ~$2–5/1k requests with flash-lite — viable below ~2,000 MAU; turns the BYOK UI into "Done automatically."
- **On-device small models:** transformer.js/WebGPU for *text* classification (candidate filtering) once models are small enough — but vision import and JSON-structured outputs stay remote for reliability.
- **Campus partnerships:** university IT supplies one key + per-user proxy quotas — the "trust" version of Model 2.
