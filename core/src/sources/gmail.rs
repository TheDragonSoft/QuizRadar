//! Gmail announcement fetcher (`02` §5.2 + `01` §4.2): the five v4 search
//! queries verbatim, newest-first ids, cross-query dedupe, skip-cached with a
//! refresh cap, 8-way bounded fetch concurrency, MIME walk (plain text wins,
//! HTML stripped through the shared char-scanner sanitizer).
//!
//! Fixes `03` §C3: v4 silently truncated bodies at 4,500 characters. v5 caps
//! at 30,000 and records `body_truncated: true` on the cached email whenever
//! content was dropped — consumers always know when a body is incomplete.
//!
//! The 60-day recency window (`01` §4.2) is applied where the cached
//! messages become assessments (`parse::email`), not here: the cache keeps
//! what Gmail returned, and the scan report says how many messages were
//! dropped as too old.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use futures::StreamExt;
use serde_json::Value;

use crate::auth::providers::{GoogleCapability, ProviderCapability};
use crate::parse::email::{strip_html_tags, PLACEHOLDER_SENDER, PLACEHOLDER_SUBJECT};
use crate::sources::{authed_get, net_err, Progress, TokenProvider};
use crate::types::CachedEmail;

pub const GMAIL_API_BASE: &str = "https://gmail.googleapis.com/gmail/v1";

/// The five v4 search queries, ported verbatim (`01` §4.2).
pub const SEARCH_QUERIES: [&str; 5] = [
    "quiz",
    "exam OR midterm OR final",
    "assignment OR test OR homework OR project OR deadline",
    "from:e-learning OR from:edu",
    "from:canvas OR from:blackboard OR from:gradescope OR from:classroom.google.com",
];

pub const MAX_RESULTS_PER_QUERY: usize = 35;
pub const MAX_PAGES_GMAIL: usize = 5;
pub const MAX_CACHED_EMAILS: usize = 500;
/// v4 capped at 4,500 (`03` §C3); v5 keeps 8× more and flags the rest.
pub const MAX_BODY_CHARS: usize = 30_000;
const MAX_ENCODED_BODY_CHARS: usize = MAX_BODY_CHARS * 4;
/// At most this many already-cached emails are re-fetched per scan.
pub const CACHED_REFRESH_LIMIT: usize = 10;
pub const FETCH_CONCURRENCY: usize = 8;

/// What actually ran — surfaced in sync notes, never summarized away.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct GmailRunStats {
    pub queries_run: usize,
    pub queries_failed: usize,
    pub unique_ids: usize,
    pub fetched: usize,
    pub cache_refreshed: usize,
    pub cache_skipped: usize,
    pub fetch_failures: usize,
    pub bodies_truncated: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GmailScan {
    /// The updated cache: merged old + newly fetched, newest-first by id
    /// (Gmail hex ids sort chronologically), capped at [`MAX_CACHED_EMAILS`].
    pub cache: Vec<CachedEmail>,
    pub stats: GmailRunStats,
    pub notes: Vec<String>,
}

/// One completed message fetch (id + parsed email or the honest failure).
type FetchedItem = (String, Result<Option<CachedEmail>, String>);
/// Shared sink for the bounded-concurrency fetch loop.
type FetchedSink = Mutex<Vec<FetchedItem>>;

/// Parameters shared by every message fetch in one scan.
struct FetchCtx<'a> {
    client: &'a reqwest::Client,
    provider: &'a dyn TokenProvider,
    capability: ProviderCapability,
    base_url: &'a str,
    progress: &'a Progress<'a>,
    found_hint: usize,
}

/// Runs the full Gmail scan. `base_url` is the API root — production passes
/// [`GMAIL_API_BASE`], tests pass a recorded-fixture server URL.
pub async fn scan_gmail(
    client: &reqwest::Client,
    provider: &dyn TokenProvider,
    base_url: &str,
    cached: &[CachedEmail],
    progress: &Progress<'_>,
) -> Result<GmailScan, String> {
    let capability = ProviderCapability::Google(GoogleCapability::GmailRead);

    // 1. Search: all five queries concurrently, newest-first ids preserved.
    progress.emit("searching", 0, 0);
    let results = futures::future::join_all(
        SEARCH_QUERIES
            .iter()
            .map(|query| search_message_ids(client, provider, capability, base_url, query)),
    )
    .await;

    let mut message_ids: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut first_error: Option<String> = None;
    let mut queries_failed = 0usize;
    let mut notes: Vec<String> = Vec::new();

    for (query, result) in SEARCH_QUERIES.iter().zip(results) {
        match result {
            Ok(search_res) => {
                if search_res.truncated {
                    notes.push(format!(
                        "Gmail search for '{query}' was truncated at {MAX_PAGES_GMAIL} pages."
                    ));
                }
                for id in search_res.ids {
                    if seen.insert(id.clone()) {
                        message_ids.push(id);
                    }
                }
            }
            Err(error) => {
                queries_failed += 1;
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }
    let stats = GmailRunStats {
        queries_run: SEARCH_QUERIES.len() - queries_failed,
        queries_failed,
        unique_ids: message_ids.len(),
        ..GmailRunStats::default()
    };

    // Honest error reporting:
    // If EVERY query failed, the scan failed completely.
    // If only some queries failed, continue with the successful ones and record an honest warning note.
    if queries_failed == SEARCH_QUERIES.len() {
        if let Some(error) = first_error {
            return Err(error);
        }
    } else if let Some(error) = first_error {
        notes.push(format!(
            "{queries_failed} of {} Gmail search queries failed: {error}",
            SEARCH_QUERIES.len()
        ));
    }

    // 2. Select fetch targets: uncached ids always; cached ids only up to the
    //    refresh cap (v4 parity — keeps a 500-message cache from refetching).
    let mut by_id: std::collections::HashMap<String, CachedEmail> = cached
        .iter()
        .map(|email| (email.id.clone(), email.clone()))
        .collect();
    let mut to_fetch: Vec<String> = Vec::new();
    let mut cache_refreshed = 0usize;
    let mut cache_skipped = 0usize;
    for id in &message_ids {
        if by_id.contains_key(id) {
            if cache_refreshed >= CACHED_REFRESH_LIMIT {
                cache_skipped += 1;
                continue;
            }
            cache_refreshed += 1;
        }
        to_fetch.push(id.clone());
    }

    // 3. Fetch with bounded concurrency + real per-item progress pulses.
    progress.emit("fetching", message_ids.len(), 0);
    let fetched: FetchedSink = Mutex::new(Vec::new());
    let done = AtomicUsize::new(0);
    let ctx = FetchCtx {
        client,
        provider,
        capability,
        base_url,
        progress,
        found_hint: message_ids.len(),
    };
    stream_fetch(&ctx, to_fetch, &fetched, &done).await;
    let fetched = Mutex::into_inner(fetched).unwrap_or_else(crate::sources::recover);

    let mut stats = stats;
    stats.cache_refreshed = cache_refreshed;
    stats.cache_skipped = cache_skipped;
    let mut notes: Vec<String> = Vec::new();
    let mut fetch_failures = 0usize;

    for (id, outcome) in fetched {
        match outcome {
            Ok(Some(email)) => {
                if email.body_truncated {
                    stats.bodies_truncated += 1;
                }
                stats.fetched += 1;
                by_id.insert(id, email);
            }
            // Fetches fail loudly per message; the caller sees the count.
            Ok(None) | Err(_) => fetch_failures += 1,
        }
    }
    stats.fetch_failures = fetch_failures;

    if fetch_failures > 0 {
        notes.push(format!(
            "Gmail: {fetch_failures} message fetch(es) failed and were skipped honestly."
        ));
    }
    if stats.bodies_truncated > 0 {
        notes.push(format!(
            "Gmail: {} body(ies) exceeded the {}-character cap and were flagged `body_truncated`.",
            stats.bodies_truncated, MAX_BODY_CHARS
        ));
    }

    // 4. Assemble the cache: newest-first by id, capped. Persistence is the
    //    caller's job (platform-side storage).
    let mut cache: Vec<CachedEmail> = by_id.into_values().collect();
    cache.sort_by(|a, b| b.id.cmp(&a.id));
    if cache.len() > MAX_CACHED_EMAILS {
        cache.truncate(MAX_CACHED_EMAILS);
    }

    progress.emit("done", stats.fetched, stats.fetched);
    Ok(GmailScan {
        cache,
        stats,
        notes,
    })
}

/// Bounded-concurrency fetch loop with per-item progress pulses.
async fn stream_fetch(
    ctx: &FetchCtx<'_>,
    ids: Vec<String>,
    sink: &FetchedSink,
    done: &AtomicUsize,
) {
    futures::stream::iter(ids)
        .map(|id| fetch_message(ctx.client, ctx.provider, ctx.capability, ctx.base_url, id))
        .buffer_unordered(FETCH_CONCURRENCY)
        .for_each(|(id, outcome)| async move {
            {
                let mut guard = sink.lock().unwrap_or_else(crate::sources::recover);
                guard.push((id, outcome));
            }
            let finished = done.fetch_add(1, Ordering::Relaxed) + 1;
            ctx.progress.emit("fetching", ctx.found_hint, finished);
        })
        .await;
}

struct SearchResult {
    ids: Vec<String>,
    truncated: bool,
}

async fn search_message_ids(
    client: &reqwest::Client,
    provider: &dyn TokenProvider,
    capability: ProviderCapability,
    base_url: &str,
    query: &str,
) -> Result<SearchResult, String> {
    let mut all_ids = Vec::new();
    let mut page_token: Option<String> = None;
    let mut truncated = false;
    let encoded_query = crate::auth::providers::percent_encode(query);

    for _page in 0..MAX_PAGES_GMAIL {
        let mut url = format!(
            "{base_url}/users/me/messages?q={encoded_query}&maxResults={MAX_RESULTS_PER_QUERY}"
        );
        if let Some(ref token) = page_token {
            url.push_str("&pageToken=");
            url.push_str(&crate::auth::providers::percent_encode(token));
        }
        let response = authed_get(client, provider, capability, &url).await?;
        if !response.status().is_success() {
            return Err(format!("Gmail search failed (HTTP {})", response.status()));
        }
        let value: Value = response
            .json()
            .await
            .map_err(|e| net_err("Gmail search response was not JSON", e))?;

        if let Some(messages) = value.get("messages").and_then(Value::as_array) {
            for item in messages {
                if let Some(id) = item.get("id").and_then(Value::as_str) {
                    all_ids.push(id.to_string());
                }
            }
        }

        page_token = value
            .get("nextPageToken")
            .and_then(Value::as_str)
            .map(str::to_string);

        if page_token.is_none() {
            break;
        }
    }

    if page_token.is_some() {
        truncated = true;
    }

    Ok(SearchResult {
        ids: all_ids,
        truncated,
    })
}

/// Fetch + parse one message. `Ok(None)` = Gmail returned a non-success for
/// this id (counted honestly, never treated as "message vanished forever").
async fn fetch_message(
    client: &reqwest::Client,
    provider: &dyn TokenProvider,
    capability: ProviderCapability,
    base_url: &str,
    msg_id: String,
) -> (String, Result<Option<CachedEmail>, String>) {
    let encoded_id = crate::auth::providers::percent_encode(&msg_id);
    let url = format!("{base_url}/users/me/messages/{encoded_id}?format=full");
    let response = match authed_get(client, provider, capability, &url).await {
        Ok(response) => response,
        Err(error) => return (msg_id, Err(error)),
    };
    if !response.status().is_success() {
        return (
            msg_id,
            Err(format!("Gmail fetch failed (HTTP {})", response.status())),
        );
    }
    match response.json::<Value>().await {
        Ok(message) => (
            msg_id.clone(),
            Ok(Some(parse_gmail_message(&msg_id, &message))),
        ),
        Err(e) => (
            msg_id,
            Err(net_err("Gmail message response was not JSON", e)),
        ),
    }
}

/// Gmail API message → [`CachedEmail`] (v4 field walk, honest placeholders
/// when headers are absent).
///
/// The placeholders are honest *labels* for a missing header — the parser
/// knows them and never turns one into a title or an instructor
/// (`parse::email::is_placeholder_header`).
fn parse_gmail_message(msg_id: &str, message: &Value) -> CachedEmail {
    let payload = message.get("payload").unwrap_or(&Value::Null);

    let mut subject = PLACEHOLDER_SUBJECT.to_string();
    let mut from = PLACEHOLDER_SENDER.to_string();
    let mut date = String::new();
    if let Some(headers) = payload.get("headers").and_then(Value::as_array) {
        for header in headers {
            let name = header.get("name").and_then(Value::as_str).unwrap_or("");
            let value = header.get("value").and_then(Value::as_str).unwrap_or("");
            if name.eq_ignore_ascii_case("subject") {
                subject = value.to_string();
            } else if name.eq_ignore_ascii_case("from") {
                from = value.to_string();
            } else if name.eq_ignore_ascii_case("date") {
                date = value.to_string();
            }
        }
    }

    let snippet = message
        .get("snippet")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let (body, body_truncated) = extract_mime_body(payload);

    CachedEmail {
        id: msg_id.to_string(),
        subject,
        from,
        date,
        snippet: Some(snippet),
        body,
        body_truncated,
    }
}

/// MIME walk (v4 port): the first decodable non-HTML part wins; HTML parts
/// accumulate into a fallback that is stripped and capped. Every drop of
/// content raises the truncation flag.
fn extract_mime_body(payload: &Value) -> (String, bool) {
    fn walk(node: &Value, html_acc: &mut String, truncated: &mut bool) -> Option<String> {
        if let Some(data) = node
            .get("body")
            .and_then(|body| body.get("data"))
            .and_then(Value::as_str)
        {
            let mime = node.get("mimeType").and_then(Value::as_str).unwrap_or("");
            let decoded = decode_base64url_limited(data, MAX_ENCODED_BODY_CHARS, truncated);
            if mime.eq_ignore_ascii_case("text/html") {
                let stripped = strip_html_tags(&decoded);
                if !stripped.is_empty() {
                    if !html_acc.is_empty() {
                        html_acc.push('\n');
                    }
                    html_acc.push_str(&stripped);
                }
            } else {
                let (text, was_truncated) = truncate_trimmed(&decoded, MAX_BODY_CHARS);
                if was_truncated {
                    *truncated = true;
                }
                if !text.is_empty() {
                    return Some(text);
                }
            }
        }
        if let Some(parts) = node.get("parts").and_then(Value::as_array) {
            for part in parts {
                if let Some(text) = walk(part, html_acc, truncated) {
                    return Some(text);
                }
            }
        }
        None
    }

    let mut html_acc = String::new();
    let mut truncated = false;
    if let Some(plain) = walk(payload, &mut html_acc, &mut truncated) {
        return (plain, truncated);
    }
    let (text, was_truncated) = truncate_trimmed(&html_acc, MAX_BODY_CHARS);
    (text, truncated || was_truncated)
}

/// v4's tolerant base64url decode: URL-safe first, standard-alphabet with
/// padding fallback, empty string on failure (never a panic).
fn decode_base64url(input: &str) -> String {
    let trimmed = input.trim();
    if let Ok(bytes) = URL_SAFE_NO_PAD.decode(trimmed.trim_end_matches('=')) {
        return String::from_utf8_lossy(&bytes).to_string();
    }
    let cleaned: String = trimmed
        .chars()
        .map(|c| match c {
            '-' => '+',
            '_' => '/',
            other => other,
        })
        .collect();
    let mut padded = cleaned.trim_end_matches('=').to_string();
    while !padded.len().is_multiple_of(4) {
        padded.push('=');
    }
    base64::engine::general_purpose::STANDARD
        .decode(&padded)
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .unwrap_or_default()
}

fn decode_base64url_limited(input: &str, max_encoded_chars: usize, truncated: &mut bool) -> String {
    let trimmed = input.trim();
    if trimmed.chars().count() <= max_encoded_chars {
        return decode_base64url(trimmed);
    }
    *truncated = true;
    let cut: String = trimmed.chars().take(max_encoded_chars).collect();
    decode_base64url(&cut)
}

/// Char-boundary-safe cap that reports whether it cut anything.
fn truncate_trimmed(text: &str, max_chars: usize) -> (String, bool) {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return (trimmed.to_string(), false);
    }
    (trimmed.chars().take(max_chars).collect(), true)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::sources::test_support::{last_path_segment, JsonResponder};
    use crate::sources::{http_client, FixedTokenProvider};
    use base64::engine::general_purpose::STANDARD;
    use wiremock::matchers::{method, path_regex};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn provider() -> FixedTokenProvider {
        FixedTokenProvider {
            access_token: "test-bearer".to_string(),
        }
    }

    fn message_json(id: &str, body: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "snippet": format!("snippet of {id}"),
            "payload": {
                "headers": [
                    {"name": "Subject", "value": "CSE241 Quiz 1 next week"},
                    {"name": "From", "value": "Professor X <x@uni.edu>"},
                    {"name": "Date", "value": "Sat, 10 Oct 2026 09:00:00 +0000"}
                ],
                "body": {"mimeType": "text/plain", "data": STANDARD.encode(body)}
            }
        })
    }

    async fn mount_search(server: &MockServer, ids: &[&str]) {
        let messages: Vec<serde_json::Value> = ids
            .iter()
            .map(|id| serde_json::json!({ "id": id }))
            .collect();
        Mock::given(method("GET"))
            .and(path_regex(r"^/users/me/messages$"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "messages": messages
            })))
            .mount(server)
            .await;
    }

    async fn mount_fetch(server: &MockServer, body: &'static str) {
        let closure: Box<dyn Fn(&wiremock::Request) -> serde_json::Value + Send + Sync> =
            Box::new(move |request| message_json(&last_path_segment(request), body));
        Mock::given(method("GET"))
            .and(path_regex(r"^/users/me/messages/(?<id>[^/]+)$"))
            .respond_with(JsonResponder(closure))
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn search_fetches_and_parses_messages() {
        let server = MockServer::start().await;
        mount_search(&server, &["id-b", "id-a", "id-b"]).await;
        mount_fetch(&server, "CSE241 Quiz 1 next week, chapters 1-3.").await;

        let client = http_client().unwrap();
        let progress = Progress::new("Gmail", &|_| {});
        let scan = scan_gmail(&client, &provider(), &server.uri(), &[], &progress)
            .await
            .unwrap();

        assert_eq!(scan.stats.queries_run, 5);
        // Deduped: "id-b" appeared twice in the search results.
        assert_eq!(scan.stats.unique_ids, 2);
        assert_eq!(scan.stats.fetched, 2);
        // Newest-first by id (hex-ish descending).
        assert_eq!(scan.cache[0].id, "id-b");
        assert_eq!(scan.cache[1].id, "id-a");
        let first = &scan.cache[0];
        assert_eq!(first.subject, "CSE241 Quiz 1 next week");
        assert_eq!(first.from, "Professor X <x@uni.edu>");
        assert_eq!(first.body, "CSE241 Quiz 1 next week, chapters 1-3.");
        assert!(!first.body_truncated);
        assert!(!scan.notes.iter().any(|note| note.contains("failed")));
    }

    #[tokio::test]
    async fn oversized_bodies_are_capped_and_flagged() {
        let server = MockServer::start().await;
        mount_search(&server, &["big"]).await;
        // A body larger than the cap — leaked to a 'static str for the
        // responder closure (test-only allocation).
        let huge: &'static str = Box::leak("x".repeat(MAX_BODY_CHARS + 500).into_boxed_str());
        mount_fetch(&server, huge).await;

        let client = http_client().unwrap();
        let progress = Progress::new("Gmail", &|_| {});
        let scan = scan_gmail(&client, &provider(), &server.uri(), &[], &progress)
            .await
            .unwrap();

        let email = &scan.cache[0];
        assert!(email.body_truncated, "30k cap must be recorded, not silent");
        assert_eq!(email.body.chars().count(), MAX_BODY_CHARS);
        assert!(scan
            .notes
            .iter()
            .any(|note| note.contains("body_truncated")));
    }

    #[tokio::test]
    async fn cached_emails_respect_the_refresh_cap() {
        let server = MockServer::start().await;
        let ids: Vec<String> = (0..12).map(|i| format!("msg-{i:02}")).collect();
        let id_refs: Vec<&str> = ids.iter().map(String::as_str).collect();
        mount_search(&server, &id_refs).await;
        mount_fetch(&server, "refreshed body").await;

        let cached: Vec<CachedEmail> = ids
            .iter()
            .map(|id| CachedEmail {
                id: id.clone(),
                subject: "old".to_string(),
                from: "old".to_string(),
                date: String::new(),
                snippet: None,
                body: "old".to_string(),
                body_truncated: false,
            })
            .collect();

        let client = http_client().unwrap();
        let progress = Progress::new("Gmail", &|_| {});
        let scan = scan_gmail(&client, &provider(), &server.uri(), &cached, &progress)
            .await
            .unwrap();

        // Only the newest CACHED_REFRESH_LIMIT cached messages are refreshed;
        // the rest are skipped and said so.
        assert_eq!(scan.stats.cache_refreshed, CACHED_REFRESH_LIMIT);
        assert_eq!(scan.stats.cache_skipped, 2);
        assert_eq!(scan.stats.fetched, CACHED_REFRESH_LIMIT);
        assert_eq!(scan.cache.len(), 12);
    }

    #[tokio::test]
    async fn all_queries_failing_is_a_loud_error_not_empty_success() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path_regex(r"^/users/me/messages$"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let client = http_client().unwrap();
        let progress = Progress::new("Gmail", &|_| {});
        let result = scan_gmail(&client, &provider(), &server.uri(), &[], &progress).await;
        let error = result.unwrap_err();
        assert!(error.contains("HTTP 500"), "honest failure: {error}");
    }

    #[tokio::test]
    async fn html_bodies_are_stripped_via_the_shared_sanitizer() {
        let server = MockServer::start().await;
        mount_search(&server, &["html1"]).await;
        // multipart: plain part empty, HTML part carries the content.
        let html = "<p>CSE241 <b>Quiz</b> & exam info</p><script>evil()</script>";
        let message = serde_json::json!({
            "id": "html1",
            "payload": {
                "headers": [{"name": "Subject", "value": "Quiz"}],
                "parts": [
                    {"mimeType": "text/plain", "body": {"data": STANDARD.encode("")}},
                    {"mimeType": "text/html", "body": {"data": STANDARD.encode(html)}}
                ]
            }
        })
        .to_string();
        Mock::given(method("GET"))
            .and(path_regex(r"^/users/me/messages/(?<id>[^/]+)$"))
            .respond_with(ResponseTemplate::new(200).set_body_string(message))
            .mount(&server)
            .await;

        let client = http_client().unwrap();
        let progress = Progress::new("Gmail", &|_| {});
        let scan = scan_gmail(&client, &provider(), &server.uri(), &[], &progress)
            .await
            .unwrap();
        assert_eq!(scan.cache[0].body, "CSE241 Quiz & exam info");
    }

    #[tokio::test]
    async fn base64_decode_handles_both_alphabets() {
        assert_eq!(decode_base64url("SGVsbG8gV29ybGQ"), "Hello World");
        assert_eq!(decode_base64url("SGVsbG8="), "Hello");
        let standard = STANDARD.encode("hello/world+test");
        assert_eq!(decode_base64url(&standard), "hello/world+test");
        assert_eq!(decode_base64url("!!!"), "");
    }

    #[tokio::test]
    async fn missing_headers_become_placeholders_not_data() {
        let server = MockServer::start().await;
        mount_search(&server, &["senderless", "subjectless"]).await;
        let messages = serde_json::json!({
            "senderless": {
                "id": "senderless",
                "payload": {
                    "headers": [
                        {"name": "Subject", "value": "CSE241 Quiz 1 next week"},
                        {"name": "Date", "value": "Sat, 17 Oct 2026 09:00:00 +0000"}
                    ],
                    "body": {"mimeType": "text/plain", "data": STANDARD.encode("CSE241 quiz 1 next week.")}
                }
            },
            "subjectless": {
                "id": "subjectless",
                "payload": {
                    "headers": [
                        {"name": "From", "value": "e-learning@univ.edu"},
                        {"name": "Date", "value": "Sat, 17 Oct 2026 09:00:00 +0000"}
                    ],
                    "body": {"mimeType": "text/plain", "data": STANDARD.encode("The online quiz opens on 25 October 2026.")}
                }
            }
        });
        let closure: Box<dyn Fn(&wiremock::Request) -> serde_json::Value + Send + Sync> =
            Box::new(move |request| {
                let id = last_path_segment(request);
                messages
                    .get(id.as_str())
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "id": id }))
            });
        Mock::given(method("GET"))
            .and(path_regex(r"^/users/me/messages/(?<id>[^/]+)$"))
            .respond_with(JsonResponder(closure))
            .mount(&server)
            .await;

        let client = http_client().unwrap();
        let progress = Progress::new("Gmail", &|_| {});
        let scan = scan_gmail(&client, &provider(), &server.uri(), &[], &progress)
            .await
            .unwrap();

        let senderless = scan
            .cache
            .iter()
            .find(|email| email.id == "senderless")
            .unwrap();
        assert_eq!(senderless.from, PLACEHOLDER_SENDER);
        let subjectless = scan
            .cache
            .iter()
            .find(|email| email.id == "subjectless")
            .unwrap();
        assert_eq!(subjectless.subject, PLACEHOLDER_SUBJECT);

        // The placeholders never become data: no instructor is invented from
        // a missing `From:` header and no placeholder becomes a title.
        let ref_date = chrono::NaiveDate::from_ymd_opt(2026, 10, 23).unwrap();
        let (items, _) = crate::parse::email::parse_emails(
            &scan.cache,
            &crate::types::ScheduleData::default(),
            ref_date,
        );
        assert_eq!(items.len(), 2);
        let senderless_item = items
            .iter()
            .find(|item| item.id == "senderless")
            .expect("the senderless announcement is parsed");
        assert_eq!(senderless_item.instructor, None);
        let subjectless_item = items
            .iter()
            .find(|item| item.id == "subjectless")
            .expect("the subjectless announcement is parsed");
        assert_eq!(
            subjectless_item.title,
            crate::parse::email::UNTITLED_ASSESSMENT,
            "a placeholder subject is not a title"
        );
    }
}
