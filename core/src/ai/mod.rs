//! BYOK AI provider layer (phase 06, `prompts/p06-core-cal-ai.md` +
//! `docs/rebuild/05-ai-features-plan.md`):
//! - `provider.rs` — typed provider interface (honest errors; no
//!   OAuth-bearer AI fallback — key comes via `x-goog-api-key` header only)
//! - `gemini.rs` — Google Gemini implementation, key never in URL
//! - `quota.rs` — quota/rate tracking with honest error surfaces
//! - `practice.rs` — 5-MCQ practice quizzes; without a key, the honest
//!   deterministic fallback labels itself as on-device (no demo banks)
