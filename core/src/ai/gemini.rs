//! The Google Gemini BYOK implementation of [`AiProvider`] (`05` §1–§3).
//!
//! Security shape (`AGENTS.md` §8, `05` §5.2, `03` §E2):
//! - the key travels in the `x-goog-api-key` **header only** — never in a
//!   URL query (proxies log URLs), and never as an OAuth bearer (the v4
//!   silent fallback that spent the user's Google identity without consent
//!   is structurally absent here);
//! - the key is scrubbed from every error string before it can reach
//!   notes/logs/UI;
//! - model ladder per `05` §3.3: `gemini-3.5-flash-lite` for the bulk
//!   extraction/practice tasks, `gemini-3.5-flash` for vision import and
//!   optimize; `responseMimeType: application/json`, temperature 0.1–0.2.
//!   (The `gemini-2.5-*` ids this ladder used to pin are retired for new
//!   projects — HTTP 404 "no longer available to new users", 2026-10-28.)

use serde_json::{json, Value};

use crate::ai::provider::{
    AiError, AiFuture, AiModel, AiProvider, QuotaLedger, RawJson, StructuredPrompt, UtcClock,
    VisionRequest,
};

/// Production Generative Language API root (tests point at the fixture
/// server).
pub const GEMINI_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";

/// v4's shared-client timeouts (10 s connect / 60 s total) so a stalled
/// request can never hang a scan or a button forever.
pub const CONNECT_TIMEOUT_SECS: u64 = 10;
pub const TOTAL_TIMEOUT_SECS: u64 = 60;

/// The BYOK Gemini provider. Constructed per session by the shell with the
/// user's key (platform-side storage), an injected clock (core owns no wall
/// clock) and the optional quota ledger (store-backed, phase-06 default).
pub struct GeminiProvider {
    client: reqwest::Client,
    api_key: Option<String>,
    base_url: String,
    clock: UtcClock,
    ledger: Option<std::sync::Arc<QuotaLedger>>,
}

impl GeminiProvider {
    #[must_use]
    pub fn new(
        client: reqwest::Client,
        api_key: Option<String>,
        base_url: impl Into<String>,
        clock: UtcClock,
        ledger: Option<std::sync::Arc<QuotaLedger>>,
    ) -> Self {
        Self {
            client,
            api_key: api_key
                .map(|key| key.trim().to_string())
                .filter(|key| !key.is_empty()),
            base_url: base_url.into(),
            clock,
            ledger,
        }
    }

    /// The production-configured provider (shared timeouts, real endpoint).
    pub fn production(
        api_key: Option<String>,
        clock: UtcClock,
        ledger: Option<std::sync::Arc<QuotaLedger>>,
    ) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(CONNECT_TIMEOUT_SECS))
            .timeout(std::time::Duration::from_secs(TOTAL_TIMEOUT_SECS))
            .build()
            .map_err(|e| format!("failed to build the Gemini HTTP client: {e}"))?;
        Ok(Self::new(client, api_key, GEMINI_API_BASE, clock, ledger))
    }

    fn generate_url(&self, model_id: &str) -> String {
        format!("{}/models/{}:generateContent", self.base_url, model_id)
    }

    async fn generate(
        &self,
        model: AiModel,
        temperature: f32,
        text_parts: Vec<Value>,
    ) -> Result<RawJson, AiError> {
        let key = self.api_key.as_ref().ok_or(AiError::NoKey)?;

        if let Some(ledger) = &self.ledger {
            // Client-side pre-check (Pacific-day ledger): a known-exhausted
            // quota fails here with the degrade copy instead of a doomed 429.
            ledger.pre_check((self.clock)(), model).await?;
        }

        // One-decimal quantization on the wire: an f32 0.1 widens to
        // 0.10000000149011612 as f64 — the config Google sees should be the
        // clean 0.1/0.2 the task asked for.
        let temperature = (f64::from(temperature) * 10.0).round() / 10.0;
        let payload = json!({
            "contents": [{ "parts": text_parts }],
            "generationConfig": {
                "temperature": temperature,
                "responseMimeType": "application/json"
            }
        });

        // Walk the tier's candidate ids: a model that is retired for this
        // key's project (404) or congested (503) is a model-level problem,
        // so the next candidate is tried. Every other failure (invalid key,
        // quota, transport) is the caller's problem and is returned as is.
        let mut last_error: Option<AiError> = None;
        for model_id in model.model_ids() {
            let response = self
                .client
                .post(self.generate_url(model_id))
                .header("x-goog-api-key", key.as_str())
                .json(&payload)
                .send()
                .await;

            let response = match response {
                Ok(response) => response,
                Err(error) => {
                    // A transport failure is not model-specific — retrying
                    // another id would only repeat it.
                    return Err(AiError::Retryable(redact_key(
                        &format!("network error: {}", error.without_url()),
                        key,
                    )));
                }
            };

            let status = response.status();
            if !status.is_success() {
                let detail = response.text().await.unwrap_or_default();
                let detail = redact_key(&detail, key);
                let error = map_status(status.as_u16(), &detail);
                if is_model_level_failure(status.as_u16()) {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }

            let value: Value = match response.json().await {
                Ok(value) => value,
                Err(error) => {
                    return Err(AiError::BadResponse(format!(
                        "unreadable response body: {error}"
                    )));
                }
            };

            let text = candidate_text(&value).ok_or_else(|| {
                AiError::BadResponse(format!(
                    "no candidate text (finishReason: {})",
                    value
                        .pointer("/candidates/0/finishReason")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                ))
            })?;

            let cleaned = strip_code_fences(&text);
            let parsed: Value = serde_json::from_str(&cleaned).map_err(|error| {
                AiError::BadResponse(format!("model text was not valid JSON: {error}"))
            })?;

            // Post-record: only a completed generation consumes quota, and
            // it is counted against the model that actually served it.
            if let Some(ledger) = &self.ledger {
                // A finished call is not retro-failed when only tracking broke.
                let _ = ledger.record_model((self.clock)(), model_id).await;
            }

            return Ok(RawJson {
                value: parsed,
                model: model_id.to_string(),
            });
        }

        Err(last_error.unwrap_or_else(|| {
            AiError::BadResponse("no model candidate answered the request".to_string())
        }))
    }
}

impl AiProvider for GeminiProvider {
    fn chat_json<'a>(&'a self, prompt: StructuredPrompt) -> AiFuture<'a, Result<RawJson, AiError>> {
        Box::pin(async move {
            let mut parts: Vec<Value> = vec![json!({ "text": prompt.instruction })];
            for context in prompt.context {
                parts.push(json!({ "text": context }));
            }
            self.generate(prompt.model, prompt.temperature, parts).await
        })
    }

    fn vision_json<'a>(&'a self, request: VisionRequest) -> AiFuture<'a, Result<RawJson, AiError>> {
        Box::pin(async move {
            let mime = if request.mime.trim().is_empty() {
                "image/png"
            } else {
                request.mime.trim()
            };
            let mut parts: Vec<Value> = vec![json!({ "text": request.prompt.instruction })];
            for context in request.prompt.context {
                parts.push(json!({ "text": context }));
            }
            parts.push(json!({
                "inline_data": {
                    "mime_type": mime,
                    "data": strip_data_url_prefix(&request.image_b64)
                }
            }));
            self.generate(request.prompt.model, request.prompt.temperature, parts)
                .await
        })
    }
}

/// Whether a failed status is a *model* problem (so another candidate id in
/// the same tier may still answer) rather than a caller problem.
///
/// - **404** — the model id is retired for this key's project ("no longer
///   available to new users"). Google retired the `gemini-2.5-*` ids this
///   way, which would otherwise break every freshly created key.
/// - **503** — the model is congested ("high demand"). Another model in the
///   tier usually serves the request.
///
/// Everything else (400 invalid key, 429 quota, 401) is the caller's own
/// credential or quota and must surface honestly instead of being retried
/// against another model.
fn is_model_level_failure(status: u16) -> bool {
    matches!(status, 404 | 503)
}

/// Maps non-2xx statuses onto the honest typed errors (`03` §E2): 400 with
/// an invalid-key message advises a re-copy; 429 carries the quota +
/// fallback note; 5xx and everything transport-shaped is retryable.
fn map_status(status: u16, detail: &str) -> AiError {
    let lowered = detail.to_ascii_lowercase();
    if (status == 400 || status == 403) && lowered.contains("api key not valid") {
        return AiError::InvalidKey;
    }
    match status {
        400 | 403 => AiError::BadResponse(format!("Gemini API error (HTTP {status}): {detail}")),
        404 => AiError::BadResponse(format!(
            "Gemini API error (HTTP 404): the model endpoint was not found. {detail}"
        )),
        429 => AiError::QuotaExhausted,
        s if s >= 500 => AiError::Retryable(format!("Gemini API error (HTTP {s}): {detail}")),
        s => AiError::BadResponse(format!("Gemini API error (HTTP {s}): {detail}")),
    }
}

/// Joins the candidate's text parts (the model may split a reply).
fn candidate_text(value: &Value) -> Option<String> {
    let parts = value.pointer("/candidates/0/content/parts")?.as_array()?;
    let mut text = String::new();
    for part in parts {
        if let Some(piece) = part.get("text").and_then(Value::as_str) {
            text.push_str(piece);
        }
    }
    (!text.is_empty()).then_some(text)
}

/// Lenient fence-strip (v4 parity): models occasionally wrap JSON in
/// ```json fences despite `responseMimeType`.
#[must_use]
pub fn strip_code_fences(text: &str) -> String {
    let trimmed = text.trim();
    let without_leading_fence = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```JSON"))
        .or_else(|| trimmed.strip_prefix("```"));
    match without_leading_fence {
        Some(rest) => {
            let body = rest.trim_start_matches(['\n', '\r']);
            match body.rfind("```") {
                Some(end) => body[..end].trim().to_string(),
                None => body.trim().to_string(),
            }
        }
        None => trimmed.to_string(),
    }
}

/// Strips a `data:<mime>;base64,` prefix when the shell passed a data URL.
#[must_use]
pub fn strip_data_url_prefix(image_b64: &str) -> &str {
    match image_b64.find(";base64,") {
        Some(index) => &image_b64[index + ";base64,".len()..],
        None => image_b64,
    }
}

/// Removes the API key from any error text (belt-and-braces: the key never
/// enters a URL, but error strings from lower layers are scrubbed anyway).
#[must_use]
pub fn redact_key(message: &str, key: &str) -> String {
    if key.is_empty() {
        return message.to_string();
    }
    message.replace(key, "[redacted]")
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;
    use crate::ai::provider::{fixed_clock, MemoryQuotaKv, QuotaLedger};
    use chrono::TimeZone;
    use wiremock::matchers::{body_partial_json, header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn clock() -> UtcClock {
        fixed_clock(
            chrono::Utc
                .with_ymd_and_hms(2026, 10, 24, 20, 0, 0)
                .unwrap(),
        )
    }

    fn provider(
        base_url: &str,
        api_key: Option<&str>,
        ledger: Option<std::sync::Arc<QuotaLedger>>,
        timeout: std::time::Duration,
    ) -> GeminiProvider {
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_millis(50))
            .timeout(timeout)
            .build()
            .unwrap();
        GeminiProvider::new(
            client,
            api_key.map(str::to_string),
            base_url,
            clock(),
            ledger,
        )
    }

    fn gemini_response(text: &str) -> Value {
        json!({
            "candidates": [{
                "content": { "parts": [{ "text": text }] },
                "finishReason": "STOP"
            }]
        })
    }

    fn prompt() -> StructuredPrompt {
        StructuredPrompt::new(AiModel::FlashLite, 0.1, "Return the JSON.").with_context("extra")
    }

    #[tokio::test]
    async fn success_returns_the_de_fenced_json_via_the_header_key() {
        let server = MockServer::start().await;
        // Matches ONLY with the header key and the JSON mime config — the
        // request shape is pinned by this mock existing at all.
        Mock::given(method("POST"))
            .and(path("/models/gemini-3.5-flash-lite:generateContent"))
            .and(header("x-goog-api-key", "k-test-123"))
            .and(body_partial_json(json!({
                "generationConfig": {
                    "temperature": 0.1,
                    "responseMimeType": "application/json"
                }
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(gemini_response("```json\n{\"ok\": true}\n```")),
            )
            .mount(&server)
            .await;
        // And the key must never ride in the URL.
        Mock::given(query_param("key", "k-test-123"))
            .respond_with(ResponseTemplate::new(500))
            .expect(0)
            .mount(&server)
            .await;

        let result = provider(
            &server.uri(),
            Some("k-test-123"),
            None,
            std::time::Duration::from_secs(5),
        )
        .chat_json(prompt())
        .await
        .unwrap();
        assert_eq!(result.value(), &json!({ "ok": true }));
        server.verify().await;
    }

    #[tokio::test]
    async fn no_key_fails_locally_without_a_request() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;

        let error = provider(&server.uri(), None, None, std::time::Duration::from_secs(5))
            .chat_json(prompt())
            .await
            .unwrap_err();
        assert_eq!(error, AiError::NoKey);
        assert!(error.to_string().contains("add your free key"));
        server.verify().await;
    }

    #[tokio::test]
    async fn invalid_key_400_advises_a_recopy() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({
                "error": {
                    "code": 400,
                    "message": "API key not valid. Please pass a valid API key.",
                    "status": "INVALID_ARGUMENT"
                }
            })))
            .mount(&server)
            .await;

        let error = provider(
            &server.uri(),
            Some("k-bad"),
            None,
            std::time::Duration::from_secs(5),
        )
        .chat_json(prompt())
        .await
        .unwrap_err();
        assert_eq!(error, AiError::InvalidKey);
        assert!(error
            .to_string()
            .contains("re-copy it from Google AI Studio"));
    }

    #[tokio::test]
    async fn quota_429_carries_the_fallback_note() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(429).set_body_json(json!({
                "error": { "code": 429, "message": "Resource has been exhausted (e.g. check quota)." }
            })))
            .mount(&server)
            .await;

        let error = provider(
            &server.uri(),
            Some("k"),
            None,
            std::time::Duration::from_secs(5),
        )
        .chat_json(prompt())
        .await
        .unwrap_err();
        assert_eq!(error, AiError::QuotaExhausted);
        assert!(error.to_string().contains("offline heuristics until"));
    }

    #[tokio::test]
    async fn a_retired_model_falls_back_to_the_next_candidate() {
        let server = MockServer::start().await;
        let ids = AiModel::FlashLite.model_ids();
        let (first, second) = (ids[0], ids[1]);

        // The first id is retired for this key's project — exactly what
        // Google answers for a key created after the retirement.
        Mock::given(method("POST"))
            .and(path(format!("/models/{first}:generateContent")))
            .respond_with(ResponseTemplate::new(404).set_body_json(json!({
                "error": {
                    "code": 404,
                    "message": "This model is no longer available to new users."
                }
            })))
            .mount(&server)
            .await;
        // The next id serves the request.
        Mock::given(method("POST"))
            .and(path(format!("/models/{second}:generateContent")))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(gemini_response("{\"ok\": true}")),
            )
            .mount(&server)
            .await;

        let result = provider(
            &server.uri(),
            Some("k"),
            None,
            std::time::Duration::from_secs(5),
        )
        .chat_json(prompt())
        .await
        .unwrap();

        assert_eq!(
            result.model(),
            second,
            "the response names the model that actually served it"
        );
        assert_eq!(result.value(), &json!({ "ok": true }));
    }

    #[tokio::test]
    async fn every_candidate_failing_reports_the_honest_error() {
        let server = MockServer::start().await;
        for id in AiModel::FlashLite.model_ids() {
            Mock::given(method("POST"))
                .and(path(format!("/models/{id}:generateContent")))
                .respond_with(ResponseTemplate::new(404).set_body_json(json!({
                    "error": { "code": 404, "message": "no longer available to new users" }
                })))
                .mount(&server)
                .await;
        }

        let error = provider(
            &server.uri(),
            Some("k"),
            None,
            std::time::Duration::from_secs(5),
        )
        .chat_json(prompt())
        .await
        .unwrap_err();

        assert!(matches!(error, AiError::BadResponse(_)), "{error}");
        assert!(
            error.to_string().contains("404"),
            "the last provider failure is reported, not swallowed: {error}"
        );
    }

    #[tokio::test]
    async fn a_quota_429_is_not_retried_against_another_model() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(429).set_body_json(json!({
                "error": { "code": 429, "message": "Resource has been exhausted." }
            })))
            .mount(&server)
            .await;

        let error = provider(
            &server.uri(),
            Some("k"),
            None,
            std::time::Duration::from_secs(5),
        )
        .chat_json(prompt())
        .await
        .unwrap_err();

        assert_eq!(
            error,
            AiError::QuotaExhausted,
            "the user's own quota is surfaced, not hidden behind another model"
        );
        let requests = server.received_requests().await.unwrap_or_default();
        assert_eq!(
            requests.len(),
            1,
            "a quota error stops the call instead of retrying the next model"
        );
    }

    #[tokio::test]
    async fn server_5xx_and_timeouts_are_retryable() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;
        let error = provider(
            &server.uri(),
            Some("k"),
            None,
            std::time::Duration::from_secs(5),
        )
        .chat_json(prompt())
        .await
        .unwrap_err();
        assert!(matches!(error, AiError::Retryable(_)), "{error}");

        // Timeout: the request must fail as retryable, not hang the caller.
        let slow = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(200).set_delay(std::time::Duration::from_millis(300)),
            )
            .mount(&slow)
            .await;
        let error = provider(
            &slow.uri(),
            Some("k"),
            None,
            std::time::Duration::from_millis(80),
        )
        .chat_json(prompt())
        .await
        .unwrap_err();
        assert!(matches!(error, AiError::Retryable(_)), "{error}");
        assert!(error.to_string().contains("temporarily unreachable"));
    }

    #[tokio::test]
    async fn unreadable_model_text_is_a_bad_response_not_a_crash() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(gemini_response("not json at all")),
            )
            .mount(&server)
            .await;
        let error = provider(
            &server.uri(),
            Some("k"),
            None,
            std::time::Duration::from_secs(5),
        )
        .chat_json(prompt())
        .await
        .unwrap_err();
        assert!(matches!(error, AiError::BadResponse(_)), "{error}");

        // Safety-blocked replies carry no text at all.
        let blocked = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "candidates": [{ "finishReason": "SAFETY" }]
            })))
            .mount(&blocked)
            .await;
        let error = provider(
            &blocked.uri(),
            Some("k"),
            None,
            std::time::Duration::from_secs(5),
        )
        .chat_json(prompt())
        .await
        .unwrap_err();
        assert!(error.to_string().contains("SAFETY"), "{error}");
    }

    #[tokio::test]
    async fn the_ledger_pre_checks_and_records_around_each_call() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(gemini_response("{\"a\":1}")))
            .expect(1)
            .mount(&server)
            .await;

        let ledger = std::sync::Arc::new(QuotaLedger::new(
            std::sync::Arc::new(MemoryQuotaKv::default()),
            Some(1),
        ));
        let gemini = provider(
            &server.uri(),
            Some("k"),
            Some(ledger.clone()),
            std::time::Duration::from_secs(5),
        );

        gemini.chat_json(prompt()).await.unwrap();
        // Second call: the limit (1) is already reached — the ledger blocks
        // BEFORE any HTTP request, so the mock's expect(1) still holds.
        let error = gemini.chat_json(prompt()).await.unwrap_err();
        assert_eq!(error, AiError::QuotaExhausted);
        server.verify().await;

        let snapshot = ledger.usage((clock())()).await.unwrap();
        assert_eq!(snapshot.counts.get("gemini-3.5-flash-lite"), Some(&1));
    }

    #[tokio::test]
    async fn vision_requests_send_inline_data_with_a_stripped_data_url() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/models/gemini-3.5-flash:generateContent"))
            .and(body_partial_json(json!({
                "contents": [{ "parts": [
                    { "text": "Read the timetable." },
                    { "inline_data": { "mime_type": "image/png", "data": "QUJD" } }
                ]}]
            })))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(gemini_response("{\"semester\":null}")),
            )
            .mount(&server)
            .await;

        let request = VisionRequest {
            image_b64: "data:image/png;base64,QUJD".to_string(),
            mime: "image/png".to_string(),
            prompt: StructuredPrompt::new(AiModel::Flash, 0.1, "Read the timetable."),
        };
        let result = provider(
            &server.uri(),
            Some("k"),
            None,
            std::time::Duration::from_secs(5),
        )
        .vision_json(request)
        .await
        .unwrap();
        assert_eq!(result.value(), &json!({ "semester": null }));
    }

    #[test]
    fn fence_stripping_is_lenient() {
        assert_eq!(strip_code_fences("{\"a\":1}"), "{\"a\":1}");
        assert_eq!(strip_code_fences("```json\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(strip_code_fences("```\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(strip_code_fences("  {\"a\":1}  "), "{\"a\":1}");
        assert_eq!(strip_code_fences("[{\"a\":1}]"), "[{\"a\":1}]");
    }

    #[test]
    fn data_url_prefix_is_stripped_only_when_present() {
        assert_eq!(strip_data_url_prefix("QUJD"), "QUJD");
        assert_eq!(strip_data_url_prefix("data:image/jpeg;base64,QUJD"), "QUJD");
    }

    #[test]
    fn error_strings_never_contain_the_key() {
        let scrubbed = redact_key("network error near ?key=k-test-123&x=1", "k-test-123");
        assert_eq!(scrubbed, "network error near ?key=[redacted]&x=1");
        assert!(!scrubbed.contains("k-test-123"));
    }
}
