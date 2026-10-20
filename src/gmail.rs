use crate::auth::get_valid_access_token;
use crate::models::CachedEmail;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use futures::stream::{self, StreamExt};
use regex::Regex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::LazyLock;
use std::time::Duration;

const CACHE_FILE: &str = "quiz_emails_cache.json";
const MAX_CACHED_EMAILS: usize = 500;
const MAX_BODY_CHARS: usize = 4500;
const MAX_ENCODED_BODY_CHARS: usize = MAX_BODY_CHARS * 4;
const CACHED_REFRESH_LIMIT: usize = 10;

static GMAIL_HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to build shared Gmail HTTP client")
});

// Static precompiled regexes to avoid re-compilation overhead during HTML stripping
static RE_STYLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<(script|style)[^>]*>.*?</(script|style)>").unwrap());
static RE_TAGS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());
static RE_WS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ \t]+").unwrap());

pub fn load_cached_emails() -> Vec<CachedEmail> {
    if let Ok(raw) = fs::read_to_string(CACHE_FILE) {
        if let Ok(list) = serde_json::from_str::<Vec<CachedEmail>>(&raw) {
            return list;
        }
    }
    Vec::new()
}

pub fn save_cached_emails(emails: &[CachedEmail]) {
    if emails.len() > MAX_CACHED_EMAILS {
        let mut newest: Vec<&CachedEmail> = emails.iter().collect();
        newest.sort_by(|a, b| b.id.cmp(&a.id));
        newest.truncate(MAX_CACHED_EMAILS);
        if let Ok(json) = serde_json::to_string(&newest) {
            let _ = fs::write(CACHE_FILE, json);
        }
        return;
    }
    if let Ok(json) = serde_json::to_string(emails) {
        let _ = fs::write(CACHE_FILE, json);
    }
}

fn decode_base64url(input: &str) -> String {
    let cleaned = input.trim().replace('-', "+").replace('_', "/");
    // Try URL_SAFE_NO_PAD on original trimmed first
    let raw_trimmed = input.trim().trim_end_matches('=');
    if let Ok(bytes) = URL_SAFE_NO_PAD.decode(raw_trimmed) {
        return String::from_utf8_lossy(&bytes).to_string();
    }
    // Fallback standard padding
    let mut padded = cleaned;
    while !padded.len().is_multiple_of(4) {
        padded.push('=');
    }
    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&padded) {
        return String::from_utf8_lossy(&bytes).to_string();
    }
    String::new()
}

fn decode_base64url_limited(input: &str, max_encoded_chars: usize) -> String {
    let trimmed = input.trim();
    if trimmed.len() <= max_encoded_chars {
        return decode_base64url(trimmed);
    }
    let mut end = max_encoded_chars;
    while end > 0 && !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    decode_base64url(&trimmed[..end])
}

fn truncate_trimmed(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    let mut out = String::with_capacity(trimmed.len().min(max_chars.saturating_mul(4)));
    for ch in trimmed.chars().take(max_chars) {
        out.push(ch);
    }
    out
}

fn strip_html_tags(html: &str) -> String {
    let without_scripts = RE_STYLE.replace_all(html, " ");
    let plain = RE_TAGS.replace_all(&without_scripts, " ");
    let decoded = plain
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#39;", "'")
        .replace("&quot;", "\"");
    RE_WS.replace_all(&decoded, " ").trim().to_string()
}

fn extract_mime_body(payload: &Value) -> String {
    fn walk(node: &Value, html_acc: &mut String) -> Option<String> {
        if let Some(data) = node
            .get("body")
            .and_then(|b| b.get("data"))
            .and_then(|d| d.as_str())
        {
            let mime = node.get("mimeType").and_then(|m| m.as_str()).unwrap_or("");
            let decoded = decode_base64url_limited(data, MAX_ENCODED_BODY_CHARS);
            if mime == "text/html" {
                if html_acc.len() < MAX_BODY_CHARS * 4 {
                    let stripped = strip_html_tags(&decoded);
                    if !stripped.is_empty() {
                        if !html_acc.is_empty() {
                            html_acc.push('\n');
                        }
                        html_acc.push_str(&stripped);
                    }
                }
            } else {
                let text = truncate_trimmed(&decoded, MAX_BODY_CHARS);
                if !text.is_empty() {
                    return Some(text);
                }
            }
        }

        if let Some(parts) = node.get("parts").and_then(|p| p.as_array()) {
            for part in parts {
                if let Some(text) = walk(part, html_acc) {
                    return Some(text);
                }
            }
        }
        None
    }

    let mut html_acc = String::new();
    if let Some(plain) = walk(payload, &mut html_acc) {
        return plain;
    }
    truncate_trimmed(&html_acc, MAX_BODY_CHARS)
}

fn parse_gmail_message(msg_id: String, msg: &Value) -> CachedEmail {
    let null_payload = Value::Null;
    let payload = msg.get("payload").unwrap_or(&null_payload);

    let mut subject = "(No Subject)".to_string();
    let mut from = "(Unknown Sender)".to_string();
    let mut date = String::new();

    if let Some(headers) = payload.get("headers").and_then(|h| h.as_array()) {
        for h in headers {
            let name = h.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let val = h.get("value").and_then(|v| v.as_str()).unwrap_or("");
            if name.eq_ignore_ascii_case("subject") {
                subject = val.to_string();
            } else if name.eq_ignore_ascii_case("from") {
                from = val.to_string();
            } else if name.eq_ignore_ascii_case("date") {
                date = val.to_string();
            }
        }
    }

    let snippet = msg
        .get("snippet")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    let body = extract_mime_body(payload);

    CachedEmail {
        id: msg_id,
        subject,
        from,
        date,
        snippet,
        body,
    }
}

async fn search_message_ids(
    client: &reqwest::Client,
    token: &str,
    query: &str,
) -> Result<Vec<String>, String> {
    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?q={}&maxResults=35",
        crate::urlencoding::encode(query)
    );
    let resp = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Gmail search failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Gmail search failed (HTTP {})", resp.status()));
    }
    let v = resp
        .json::<Value>()
        .await
        .map_err(|e| format!("Gmail search failed: {}", e))?;
    let mut ids = Vec::new();
    if let Some(arr) = v.get("messages").and_then(|m| m.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
                ids.push(id.to_string());
            }
        }
    }
    Ok(ids)
}

async fn fetch_gmail_message(
    client: &reqwest::Client,
    token: &str,
    msg_id: String,
) -> (String, Option<CachedEmail>) {
    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}?format=full",
        msg_id
    );
    let mut parsed = None;
    if let Ok(resp) = client.get(&url).bearer_auth(token).send().await {
        if resp.status().is_success() {
            if let Ok(msg) = resp.json::<Value>().await {
                parsed = Some(parse_gmail_message(msg_id.clone(), &msg));
            }
        }
    }
    (msg_id, parsed)
}

fn cached_email_equals(a: &CachedEmail, b: &CachedEmail) -> bool {
    a.id == b.id
        && a.subject == b.subject
        && a.from == b.from
        && a.date == b.date
        && a.snippet == b.snippet
        && a.body == b.body
}

pub async fn sync_gmail_messages() -> Result<Vec<CachedEmail>, String> {
    let token = get_valid_access_token().await?;
    let client = &*GMAIL_HTTP_CLIENT;

    let queries = [
        "quiz",
        "exam OR midterm OR final",
        "assignment OR test OR homework OR project OR deadline",
        "from:e-learning OR from:edu",
        "from:canvas OR from:blackboard OR from:gradescope OR from:classroom.google.com",
    ];

    let query_results = futures::future::join_all(
        queries
            .iter()
            .map(|query| search_message_ids(client, &token.token, query)),
    )
    .await;

    let mut message_ids = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut first_error: Option<String> = None;
    for res in query_results {
        match res {
            Ok(ids) => {
                for id in ids {
                    if seen_ids.insert(id.clone()) {
                        message_ids.push(id);
                    }
                }
            }
            Err(e) => {
                if first_error.is_none() {
                    first_error = Some(e);
                }
            }
        }
    }

    if message_ids.is_empty() {
        if let Some(err) = first_error {
            return Err(err);
        }
    }

    let existing = load_cached_emails();
    let mut by_id: HashMap<String, CachedEmail> =
        existing.into_iter().map(|e| (e.id.clone(), e)).collect();

    // Fetch messages not yet cached; refresh at most the 10 newest cached ones
    let mut to_fetch = Vec::new();
    let mut cached_refresh_count = 0usize;
    for msg_id in &message_ids {
        if by_id.contains_key(msg_id) {
            if cached_refresh_count >= CACHED_REFRESH_LIMIT {
                continue;
            }
            cached_refresh_count += 1;
        }
        to_fetch.push(msg_id.clone());
    }

    let mut fetched: Vec<(String, Option<CachedEmail>)> = stream::iter(to_fetch)
        .map(|msg_id| fetch_gmail_message(client, &token.token, msg_id))
        .buffer_unordered(8)
        .collect()
        .await;
    fetched.sort_by(|a, b| a.0.cmp(&b.0));

    let mut cache_changed = false;
    for (msg_id, parsed) in fetched {
        if let Some(email) = parsed {
            match by_id.get(&msg_id) {
                Some(previous) if cached_email_equals(previous, &email) => {}
                _ => cache_changed = true,
            }
            by_id.insert(msg_id, email);
        }
    }

    let mut all_emails: Vec<CachedEmail> = by_id.into_values().collect();
    // Preserve stable ordering (newest first roughly by id hex descending)
    all_emails.sort_by(|a, b| b.id.cmp(&a.id));

    if cache_changed || all_emails.len() > MAX_CACHED_EMAILS {
        save_cached_emails(&all_emails);
    }
    Ok(all_emails)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_base64url_standard() {
        assert_eq!(decode_base64url("SGVsbG8gV29ybGQ"), "Hello World");
    }

    #[test]
    fn test_decode_base64url_with_padding() {
        assert_eq!(decode_base64url("SGVsbG8="), "Hello");
        assert_eq!(decode_base64url("SGVsbG8gV29ybGQ="), "Hello World");
    }

    #[test]
    fn test_decode_base64url_url_safe_chars() {
        // "hello?world~" encoded in URL safe base64 without pad: aGVsbG8_d29ybGR-
        // or chars with - and _
        // URL_SAFE_NO_PAD: "-" for +, "_" for /
        let encoded = URL_SAFE_NO_PAD.encode(b"subject?test/check+123");
        assert_eq!(decode_base64url(&encoded), "subject?test/check+123");
    }

    #[test]
    fn test_decode_base64url_whitespace_trimming() {
        assert_eq!(decode_base64url("  SGVsbG8gV29ybGQ  \n\r"), "Hello World");
    }

    #[test]
    fn test_decode_base64url_standard_base64_fallback() {
        // Standard base64 uses + and / which fall back to standard decode after replacing - and _
        let encoded = base64::engine::general_purpose::STANDARD.encode(b"hello/world+test");
        assert_eq!(decode_base64url(&encoded), "hello/world+test");
    }

    #[test]
    fn test_decode_base64url_empty_string() {
        assert_eq!(decode_base64url(""), "");
        assert_eq!(decode_base64url("   "), "");
    }

    #[test]
    fn test_decode_base64url_invalid_input() {
        assert_eq!(decode_base64url("!!!invalid_base64_chars###"), "");
    }

    #[test]
    fn test_decode_base64url_invalid_utf8() {
        // Encoded non-UTF-8 bytes 0xFF, 0xFE
        let invalid_utf8_b64 = URL_SAFE_NO_PAD.encode(&[0xFF, 0xFE]);
        let decoded = decode_base64url(&invalid_utf8_b64);
        assert!(decoded.contains('\u{FFFD}'));
    }
}
