use crate::auth::get_valid_access_token;
use crate::models::CachedEmail;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use regex::Regex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::LazyLock;

const CACHE_FILE: &str = "quiz_emails_cache.json";

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
    if let Ok(json) = serde_json::to_string_pretty(emails) {
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
    while padded.len() % 4 != 0 {
        padded.push('=');
    }
    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&padded) {
        return String::from_utf8_lossy(&bytes).to_string();
    }
    String::new()
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
    let mut plain_acc = String::new();
    let mut html_acc = String::new();

    if let Some(parts) = payload.get("parts").and_then(|p| p.as_array()) {
        for part in parts {
            let mime = part.get("mimeType").and_then(|m| m.as_str()).unwrap_or("");
            if let Some(data) = part
                .get("body")
                .and_then(|b| b.get("data"))
                .and_then(|d| d.as_str())
            {
                let decoded = decode_base64url(data);
                if mime == "text/plain" {
                    plain_acc.push_str(&decoded);
                    plain_acc.push('\n');
                } else if mime == "text/html" {
                    html_acc.push_str(&strip_html_tags(&decoded));
                    html_acc.push('\n');
                }
            }
            if part.get("parts").is_some() {
                let nested = extract_mime_body(part);
                if !nested.is_empty() {
                    plain_acc.push_str(&nested);
                    plain_acc.push('\n');
                }
            }
        }
    } else if let Some(data) = payload
        .get("body")
        .and_then(|b| b.get("data"))
        .and_then(|d| d.as_str())
    {
        let decoded = decode_base64url(data);
        let mime = payload
            .get("mimeType")
            .and_then(|m| m.as_str())
            .unwrap_or("");
        if mime == "text/html" {
            html_acc.push_str(&strip_html_tags(&decoded));
        } else {
            plain_acc.push_str(&decoded);
        }
    }

    if !plain_acc.trim().is_empty() {
        plain_acc.trim().chars().take(4500).collect()
    } else {
        html_acc.trim().chars().take(4500).collect()
    }
}

pub async fn sync_gmail_messages() -> Result<Vec<CachedEmail>, String> {
    let token = get_valid_access_token().await?;
    let client = reqwest::Client::new();

    let queries = [
        "quiz",
        "exam OR midterm OR final",
        "assignment OR test OR homework OR project OR deadline",
        "from:e-learning OR from:edu",
        "from:canvas OR from:blackboard OR from:gradescope OR from:classroom.google.com",
    ];

    let mut message_ids = Vec::new();
    let mut seen_ids = HashSet::new();

    for q in queries {
        let url = format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages?q={}&maxResults=35",
            crate::urlencoding::encode(q)
        );
        if let Ok(resp) = client.get(&url).bearer_auth(&token.token).send().await {
            if resp.status().is_success() {
                if let Ok(v) = resp.json::<Value>().await {
                    if let Some(arr) = v.get("messages").and_then(|m| m.as_array()) {
                        for item in arr {
                            if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
                                if seen_ids.insert(id.to_string()) {
                                    message_ids.push(id.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let existing = load_cached_emails();
    let mut by_id: HashMap<String, CachedEmail> =
        existing.into_iter().map(|e| (e.id.clone(), e)).collect();

    // Fetch any message not yet in cache (or up to 40 newest messages)
    let mut fetched_count = 0;
    for msg_id in message_ids {
        if by_id.contains_key(&msg_id) && fetched_count > 10 {
            continue;
        }
        let url = format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}?format=full",
            msg_id
        );
        if let Ok(resp) = client.get(&url).bearer_auth(&token.token).send().await {
            if resp.status().is_success() {
                if let Ok(msg) = resp.json::<Value>().await {
                    let payload = msg.get("payload").cloned().unwrap_or(Value::Null);
                    let mut subject = "(No Subject)".to_string();
                    let mut from = "(Unknown Sender)".to_string();
                    let mut date = String::new();

                    if let Some(headers) = payload.get("headers").and_then(|h| h.as_array()) {
                        for h in headers {
                            let name = h
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("")
                                .to_lowercase();
                            let val = h.get("value").and_then(|v| v.as_str()).unwrap_or("");
                            match name.as_str() {
                                "subject" => subject = val.to_string(),
                                "from" => from = val.to_string(),
                                "date" => date = val.to_string(),
                                _ => {}
                            }
                        }
                    }

                    let snippet = msg
                        .get("snippet")
                        .and_then(|s| s.as_str())
                        .unwrap_or("")
                        .to_string();
                    let body = extract_mime_body(&payload);

                    by_id.insert(
                        msg_id.clone(),
                        CachedEmail {
                            id: msg_id,
                            subject,
                            from,
                            date,
                            snippet,
                            body,
                        },
                    );
                    fetched_count += 1;
                }
            }
        }
    }

    let mut all_emails: Vec<CachedEmail> = by_id.into_values().collect();
    // Preserve stable ordering (newest first roughly by id hex descending)
    all_emails.sort_by(|a, b| b.id.cmp(&a.id));
    save_cached_emails(&all_emails);
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
