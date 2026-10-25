//! Provider seam for the BYOK AI layer (`05` §1, phase 06 item 3).
//!
//! - [`AiProvider`] — the typed interface every AI task calls: structured
//!   JSON chat and vision requests returning the model's raw JSON. v5 ships
//!   exactly one implementation ([`super::gemini::GeminiProvider`]); a relay
//!   provider someday is a second implementation, not a redesign.
//! - [`AiError`] / [`AiUnavailable`] — honest typed failures; **every**
//!   AI-task failure maps into an `AiUnavailable` so callers fall back to
//!   their deterministic paths (degradation ladder, `05` §3.5).
//! - [`QuotaLedger`] — client-side per-day usage counters in the store kv,
//!   keyed by the **Pacific** calendar day as Google documents its free-tier
//!   reset (`05` §2/§3.4). This is the one place the core cares about a real
//!   timezone; the day is computed from a caller-injected clock — the core
//!   still owns no wall clock.
//!
//! Security invariants (`AGENTS.md` §8, `05` §5.2, `03` §E2): the provider
//! trait carries no OAuth-bearer path — BYOK keys travel in provider-specific
//! headers only, and this module's sources are scanned by a test in `super`
//! to keep it that way.

use std::sync::Arc;

use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};

#[cfg(not(target_arch = "wasm32"))]
use crate::store::db::StoreError;
#[cfg(target_arch = "wasm32")]
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("store error: {0}")]
    Validation(String),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

/// A caller-injected UTC clock reading (shells pass `Utc::now`; tests pass
/// fixed instants). The core never reads the wall clock itself.
pub type UtcClock = Arc<dyn Fn() -> DateTime<Utc> + Send + Sync>;

/// A fixed `Utc::now()`-shaped clock for tests.
pub fn fixed_clock(instant: DateTime<Utc>) -> UtcClock {
    Arc::new(move || instant)
}

// ---------------------------------------------------------------------------
// Model ladder (`05` §3.3 — flash-lite for bulk extraction + practice,
// flash for the rare manual vision import + optimize button)
// ---------------------------------------------------------------------------

/// Which Gemini model a task uses. The id strings are the provider's
/// (`gemini-2.5-flash-lite` ≈ 1,000 RPD free tier; `gemini-2.5-flash` ≈ 250).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AiModel {
    /// Email extraction + practice quizzes (bulk, cheap tier).
    FlashLite,
    /// Timetable vision import + study-plan optimize (rare, user-triggered).
    Flash,
}

impl AiModel {
    /// The provider model id sent in the URL path.
    #[must_use]
    pub fn model_id(self) -> &'static str {
        match self {
            Self::FlashLite => "gemini-2.5-flash-lite",
            Self::Flash => "gemini-2.5-flash",
        }
    }
}

// ---------------------------------------------------------------------------
// Requests & responses
// ---------------------------------------------------------------------------

/// A structured JSON chat request. `instruction` is the task prompt;
/// `context` parts carry the serialized inputs (schedule, assessments…).
#[derive(Debug, Clone)]
pub struct StructuredPrompt {
    pub model: AiModel,
    /// 0.1–0.2 per v4 (`05` §3 tasks table).
    pub temperature: f32,
    pub instruction: String,
    pub context: Vec<String>,
}

impl StructuredPrompt {
    #[must_use]
    pub fn new(model: AiModel, temperature: f32, instruction: impl Into<String>) -> Self {
        Self {
            model,
            temperature,
            instruction: instruction.into(),
            context: Vec::new(),
        }
    }

    /// Builder-style context push (mirrors v4's multi-part contents).
    #[must_use]
    pub fn with_context(mut self, part: impl Into<String>) -> Self {
        self.context.push(part.into());
        self
    }
}

/// A vision request: one image plus the structured prompt.
#[derive(Debug, Clone)]
pub struct VisionRequest {
    /// Base64 image bytes; a `data:` URL prefix is tolerated and stripped.
    pub image_b64: String,
    /// `image/png`, `image/jpeg`, `application/pdf`, …
    pub mime: String,
    pub prompt: StructuredPrompt,
}

/// The model's response as raw JSON (already de-fenced by the provider —
/// fences are a transport artifact, not data).
#[derive(Debug, Clone, PartialEq)]
pub struct RawJson(pub serde_json::Value);

impl RawJson {
    #[must_use]
    pub fn value(&self) -> &serde_json::Value {
        &self.0
    }

    #[must_use]
    pub fn into_value(self) -> serde_json::Value {
        self.0
    }
}

// ---------------------------------------------------------------------------
// Errors — every one maps to an honest fallback reason
// ---------------------------------------------------------------------------

/// Typed provider failures (`03` §E2 fix: rich errors instead of silent
/// None). The `Display` copy is user-presentable.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AiError {
    #[error("AI features need a Gemini API key — add your free key from Google AI Studio in Settings (it stays on this device).")]
    NoKey,
    #[error("Your Gemini API key is not valid — re-copy it from Google AI Studio into Settings and try again.")]
    InvalidKey,
    #[error("Free Gemini limit reached for your key — QuizRadar uses its offline heuristics until the quota resets at midnight Pacific.")]
    QuotaExhausted,
    #[error("Gemini is temporarily unreachable ({0}) — try again in a moment, or continue with the offline heuristics.")]
    Retryable(String),
    #[error("Gemini returned an unreadable response: {0}")]
    BadResponse(String),
}

/// Why an AI task fell back to its deterministic path. Rendered verbatim in
/// the UI next to the fallback output — never swallowed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AiUnavailable {
    #[error("{0}")]
    Unavailable(#[from] AiError),
}

impl AiUnavailable {
    /// The user-facing reason string.
    #[must_use]
    pub fn reason(&self) -> String {
        self.to_string()
    }
}

// ---------------------------------------------------------------------------
// Provider trait (object-safe, teams.rs hook style)
// ---------------------------------------------------------------------------

pub type AiFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

/// The BYOK provider interface. Implementations must:
/// - never accept or transmit OAuth bearer tokens (`05` §5.2 — consent must
///   be explicit per key, not borrowed from a sign-in),
/// - redact the key from every error string,
/// - request `responseMimeType: application/json` and de-fence the reply.
pub trait AiProvider: Send + Sync {
    fn chat_json<'a>(&'a self, prompt: StructuredPrompt) -> AiFuture<'a, Result<RawJson, AiError>>;
    fn vision_json<'a>(&'a self, request: VisionRequest) -> AiFuture<'a, Result<RawJson, AiError>>;
}

// ---------------------------------------------------------------------------
// Provenance label (`AiCreditNote { source }`)
// ---------------------------------------------------------------------------

/// Where a payload came from — the provider or the honest on-device path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AiSource {
    /// Produced by the configured BYOK provider; the model id is recorded
    /// for the provenance chip.
    Provider { model: String },
    /// Produced by the deterministic on-device fallback.
    OnDevice,
}

/// One provenance note attached to AI-feature payloads (practice quizzes,
/// plans, extraction merges). v4's `generated_by_ai` flag grows the explicit
/// `authored_locally` label so on-device fallbacks are never mistaken for AI
/// output (`05` §4 fallback column).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiCreditNote {
    pub source: AiSource,
}

impl AiCreditNote {
    #[must_use]
    pub fn provider(model: AiModel) -> Self {
        Self {
            source: AiSource::Provider {
                model: model.model_id().to_string(),
            },
        }
    }

    #[must_use]
    pub fn on_device() -> Self {
        Self {
            source: AiSource::OnDevice,
        }
    }
}

// ---------------------------------------------------------------------------
// Quota ledger — in-store kv, Pacific-day reset (`05` §2, §3.4)
// ---------------------------------------------------------------------------

/// The config_kv key holding the usage record.
const QUOTA_KV_KEY: &str = "ai_quota_usage";

/// Async kv seam (single JSON value). Shells implement it over the store;
/// tests over an in-memory mutex. Failures surface as errors — quota
/// tracking is honest, not best-effort-silent.
pub trait QuotaKv: Send + Sync {
    fn load(
        &self,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<Output = Result<Option<serde_json::Value>, StoreError>>
                + Send
                + '_,
        >,
    >;
    fn save<'a>(
        &'a self,
        value: &'a serde_json::Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), StoreError>> + Send + 'a>>;
}

/// In-memory kv for tests.
#[derive(Default)]
pub struct MemoryQuotaKv(std::sync::Mutex<Option<serde_json::Value>>);

impl QuotaKv for MemoryQuotaKv {
    fn load(
        &self,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<Output = Result<Option<serde_json::Value>, StoreError>>
                + Send
                + '_,
        >,
    > {
        let guard = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        Box::pin(std::future::ready(Ok(guard.clone())))
    }

    fn save<'a>(
        &'a self,
        value: &'a serde_json::Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), StoreError>> + Send + 'a>>
    {
        let mut guard = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *guard = Some(value.clone());
        Box::pin(std::future::ready(Ok(())))
    }
}

/// Store-backed [`QuotaKv`] (phase 06): the usage record lives in the same
/// `config_kv` table as every other non-secret flag, through the same
/// mutex-serialized connection the async facade uses. Each access runs on
/// `spawn_blocking` so an async caller never blocks its runtime thread on
/// SQLite. The record carries day-keyed call counters only — never keys,
/// never tokens, never email content.
#[cfg(not(target_arch = "wasm32"))]
pub struct StoreQuotaKv(pub std::sync::Arc<std::sync::Mutex<crate::store::db::Db>>);

#[cfg(not(target_arch = "wasm32"))]
impl QuotaKv for StoreQuotaKv {
    fn load(
        &self,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<Output = Result<Option<serde_json::Value>, StoreError>>
                + Send
                + '_,
        >,
    > {
        let db = std::sync::Arc::clone(&self.0);
        Box::pin(async move {
            tokio::task::spawn_blocking(move || {
                let guard = db.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                crate::store::repo::ConfigRepo::new(guard.conn()).get_raw(QUOTA_KV_KEY)
            })
            .await
            .map_err(|error| {
                StoreError::Validation(format!("quota ledger task abandoned: {error}"))
            })
            .and_then(|outcome| outcome)
        })
    }

    fn save<'a>(
        &'a self,
        value: &'a serde_json::Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), StoreError>> + Send + 'a>>
    {
        let db = std::sync::Arc::clone(&self.0);
        let value = value.clone();
        Box::pin(async move {
            tokio::task::spawn_blocking(move || {
                let guard = db.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                crate::store::repo::ConfigRepo::new(guard.conn()).set_raw(QUOTA_KV_KEY, &value)
            })
            .await
            .map_err(|error| {
                StoreError::Validation(format!("quota ledger task abandoned: {error}"))
            })
            .and_then(|outcome| outcome)
        })
    }
}

/// The persisted usage record: one Pacific day + per-model counters. A
/// record whose `day` is not "today" counts as zero — the automatic
/// midnight-Pacific reset, with no pruning job to forget.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct QuotaUsageRecord {
    /// `YYYY-MM-DD` in the Pacific quota timezone.
    #[serde(default)]
    pub day: String,
    /// Per-model call counts for that day.
    #[serde(default)]
    pub counts: std::collections::BTreeMap<String, u32>,
}

impl QuotaUsageRecord {
    /// Count for `model` on the given Pacific day — a record stamped with
    /// any other day reads as zero (the automatic midnight-PT reset).
    #[must_use]
    pub fn used(&self, today: NaiveDate, model: AiModel) -> u32 {
        if self.day != today.format("%Y-%m-%d").to_string() {
            return 0;
        }
        self.counts.get(model.model_id()).copied().unwrap_or(0)
    }
}

/// One day's usage snapshot for the Settings line
/// "AI calls today: 37/~X (resets midnight PT)" (`05` §3.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuotaSnapshot {
    pub day: NaiveDate,
    pub counts: std::collections::BTreeMap<String, u32>,
}

impl QuotaSnapshot {
    /// Total calls today across all models.
    #[must_use]
    pub fn total(&self) -> u32 {
        self.counts.values().sum()
    }
}

/// The US Pacific quota day (PST −8 / PDT −7 with the post-2007 US DST
/// rule: DST from the second Sunday of March 02:00 local to the first
/// Sunday of November 02:00 local). This is the ONLY timezone math in the
/// core — Google's documented quota reset point (`05` §2).
///
/// Transition instants in UTC: DST starts at 10:00 UTC (02:00 PST), ends at
/// 09:00 UTC (02:00 PDT) — so the local *date* is unambiguous even across
/// transitions (they happen at 2 a.m. local, never at local midnight).
#[must_use]
pub fn pacific_date(now_utc: DateTime<Utc>) -> NaiveDate {
    let offset_secs = pacific_offset_seconds(now_utc);
    (now_utc + Duration::seconds(i64::from(offset_secs))).date_naive()
}

fn pacific_offset_seconds(now_utc: DateTime<Utc>) -> i32 {
    let year = now_utc.year();
    match (
        utc_instant(year, 3, nth_sunday(year, 3, 2), 10, 0),
        utc_instant(year, 11, nth_sunday(year, 11, 1), 9, 0),
    ) {
        (Some(start), Some(end)) if now_utc >= start && now_utc < end => -7 * 3600,
        // Unreachable for real calendar years; PST is the defensive default.
        _ => -8 * 3600,
    }
}

fn nth_sunday(year: i32, month: u32, nth: u32) -> u32 {
    let first = chrono::NaiveDate::from_ymd_opt(year, month, 1).unwrap_or_default();
    let days_from_sunday = first.weekday().num_days_from_sunday();
    let first_sunday = 1 + (7 - days_from_sunday) % 7;
    first_sunday + (nth - 1) * 7
}

fn utc_instant(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> Option<DateTime<Utc>> {
    let date = chrono::NaiveDate::from_ymd_opt(year, month, day)?;
    let naive = date.and_hms_opt(hour, minute, 0)?;
    Some(Utc.from_utc_datetime(&naive))
}

/// The client-side usage ledger: pre-checks before a provider call and
/// records after a successful one (`05` §3.4). Counters persist in the
/// store kv, keyed by the Pacific day, reset automatically at midnight PT.
pub struct QuotaLedger {
    kv: Arc<dyn QuotaKv>,
    /// Optional client-side hard stop. `None` = informational tracking
    /// only (the provider's own 429 remains the honest backstop).
    daily_limit: Option<u32>,
}

impl QuotaLedger {
    #[must_use]
    pub fn new(kv: Arc<dyn QuotaKv>, daily_limit: Option<u32>) -> Self {
        Self { kv, daily_limit }
    }

    /// Current usage snapshot at `now` (Pacific day of the injected clock
    /// reading).
    pub async fn usage(&self, now: DateTime<Utc>) -> Result<QuotaSnapshot, StoreError> {
        let today = pacific_date(now);
        let record = self.load_record().await?;
        Ok(QuotaSnapshot {
            day: today,
            counts: record_for_day(&record, today).counts,
        })
    }

    /// Pre-check: `Err(AiError::QuotaExhausted)` when the configured client
    /// limit is already reached for today (Pacific) — the honest degrade
    /// before wasting a doomed request.
    pub async fn pre_check(
        &self,
        now: DateTime<Utc>,
        model: AiModel,
    ) -> Result<QuotaSnapshot, AiError> {
        let snapshot = self.usage(now).await.map_err(kv_err)?;
        let used = snapshot.counts.get(model.model_id()).copied().unwrap_or(0);
        if let Some(limit) = self.daily_limit {
            if used >= limit {
                return Err(AiError::QuotaExhausted);
            }
        }
        Ok(snapshot)
    }

    /// Records one completed call. A kv failure surfaces as an error (the
    /// caller decides whether a broken ledger should fail a finished call —
    /// the provider treats tracking as non-fatal after success).
    pub async fn record(&self, now: DateTime<Utc>, model: AiModel) -> Result<(), StoreError> {
        let today = pacific_date(now);
        let today_key = today.format("%Y-%m-%d").to_string();
        let mut record = self.load_record().await?;
        if record.day != today_key {
            record = QuotaUsageRecord {
                day: today_key.clone(),
                counts: Default::default(),
            };
        }
        *record
            .counts
            .entry(model.model_id().to_string())
            .or_insert(0) += 1;
        self.kv
            .save(&serde_json::to_value(&record).map_err(StoreError::Json)?)
            .await
    }

    async fn load_record(&self) -> Result<QuotaUsageRecord, StoreError> {
        match self.kv.load().await? {
            None => Ok(QuotaUsageRecord::default()),
            Some(value) => serde_json::from_value(value).map_err(StoreError::Json),
        }
    }
}

fn record_for_day(record: &QuotaUsageRecord, today: NaiveDate) -> QuotaUsageRecord {
    let today_key = today.format("%Y-%m-%d").to_string();
    if record.day == today_key {
        record.clone()
    } else {
        QuotaUsageRecord {
            day: today_key,
            counts: Default::default(),
        }
    }
}

fn kv_err(error: StoreError) -> AiError {
    AiError::Retryable(format!("usage tracker unavailable: {error}"))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use chrono::TimeZone;

    fn utc_at(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, min, 0).unwrap()
    }

    #[test]
    fn pacific_day_tracks_pst_and_dst_boundaries() {
        // Winter: PST (−8). 06:59 UTC = 22:59 previous day; 08:00 UTC = midnight.
        assert_eq!(
            pacific_date(utc_at(2026, 1, 15, 6, 59)),
            NaiveDate::from_ymd_opt(2026, 1, 14).unwrap()
        );
        assert_eq!(
            pacific_date(utc_at(2026, 1, 15, 8, 0)),
            NaiveDate::from_ymd_opt(2026, 1, 15).unwrap()
        );
        // Summer: PDT (−7). The day flips at 07:00 UTC.
        assert_eq!(
            pacific_date(utc_at(2026, 6, 15, 6, 59)),
            NaiveDate::from_ymd_opt(2026, 6, 14).unwrap()
        );
        assert_eq!(
            pacific_date(utc_at(2026, 6, 15, 7, 0)),
            NaiveDate::from_ymd_opt(2026, 6, 15).unwrap()
        );
        // DST start 2026-03-08 10:00 UTC (02:00 PST → 03:00 PDT).
        assert_eq!(
            pacific_date(utc_at(2026, 3, 8, 9, 59)),
            NaiveDate::from_ymd_opt(2026, 3, 8).unwrap()
        );
        assert_eq!(
            pacific_date(utc_at(2026, 3, 8, 10, 0)),
            NaiveDate::from_ymd_opt(2026, 3, 8).unwrap()
        );
        // DST end 2026-11-01 09:00 UTC.
        assert_eq!(
            pacific_date(utc_at(2026, 11, 1, 8, 59)),
            NaiveDate::from_ymd_opt(2026, 11, 1).unwrap()
        );
        assert_eq!(
            pacific_date(utc_at(2026, 11, 1, 9, 0)),
            NaiveDate::from_ymd_opt(2026, 11, 1).unwrap()
        );
    }

    #[tokio::test]
    async fn counters_reset_at_the_pacific_midnight() {
        let kv = Arc::new(MemoryQuotaKv::default());
        let ledger = QuotaLedger::new(kv, None);
        let day_a = utc_at(2026, 10, 24, 20, 0); // 13:00 PDT Oct 24
        let day_b = utc_at(2026, 10, 25, 20, 0); // next Pacific day

        ledger.record(day_a, AiModel::FlashLite).await.unwrap();
        ledger.record(day_a, AiModel::FlashLite).await.unwrap();
        ledger.record(day_a, AiModel::Flash).await.unwrap();

        let today = ledger.usage(day_a).await.unwrap();
        assert_eq!(today.total(), 3);
        assert_eq!(today.counts.get("gemini-2.5-flash-lite"), Some(&2));
        assert_eq!(today.counts.get("gemini-2.5-flash"), Some(&1));

        let tomorrow = ledger.usage(day_b).await.unwrap();
        assert_eq!(
            tomorrow.total(),
            0,
            "a new Pacific day resets every counter"
        );
        // The stale day record is replaced (not accumulated into) on save.
        ledger.record(day_b, AiModel::FlashLite).await.unwrap();
        let snapshot = ledger.usage(day_b).await.unwrap();
        assert_eq!(snapshot.total(), 1);
    }

    #[tokio::test]
    async fn pre_check_blocks_only_when_the_client_limit_is_reached() {
        let kv = Arc::new(MemoryQuotaKv::default());
        let ledger = QuotaLedger::new(kv, Some(2));
        let now = utc_at(2026, 10, 24, 20, 0);

        ledger.pre_check(now, AiModel::FlashLite).await.unwrap();
        ledger.record(now, AiModel::FlashLite).await.unwrap();
        ledger.record(now, AiModel::FlashLite).await.unwrap();
        let error = ledger.pre_check(now, AiModel::FlashLite).await.unwrap_err();
        assert_eq!(error, AiError::QuotaExhausted);
        assert!(error.to_string().contains("midnight Pacific"));

        // A different model is unaffected (per-model counters).
        ledger.pre_check(now, AiModel::Flash).await.unwrap();
    }

    #[tokio::test]
    async fn a_stale_day_never_counts_against_today() {
        let kv = Arc::new(MemoryQuotaKv::default());
        kv.save(&serde_json::json!({
            "day": "2026-10-23",
            "counts": { "gemini-2.5-flash-lite": 999 }
        }))
        .await
        .unwrap();
        let ledger = QuotaLedger::new(kv, Some(10));
        let now = utc_at(2026, 10, 24, 20, 0);
        ledger.pre_check(now, AiModel::FlashLite).await.unwrap();
        // No error: yesterday's 999 calls do not block today.
    }

    #[tokio::test]
    async fn store_backed_kv_round_trips_through_config_kv() {
        // The production adapter: the usage record lives in the store's
        // config_kv table and survives reopen-shaped access patterns.
        let db = crate::store::db::Db::open_in_memory().unwrap();
        let kv: Arc<dyn QuotaKv> = Arc::new(StoreQuotaKv(Arc::new(std::sync::Mutex::new(db))));
        let ledger = QuotaLedger::new(kv, None);

        let now = utc_at(2026, 10, 24, 20, 0);
        assert_eq!(ledger.usage(now).await.unwrap().total(), 0);
        ledger.record(now, AiModel::FlashLite).await.unwrap();
        ledger.record(now, AiModel::FlashLite).await.unwrap();
        let snapshot = ledger.usage(now).await.unwrap();
        assert_eq!(snapshot.total(), 2);
        assert_eq!(snapshot.counts.get("gemini-2.5-flash-lite"), Some(&2));
    }
}
