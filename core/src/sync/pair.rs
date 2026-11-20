//! Pure-Rust serverless & ephemeral-LAN peer sync codec (`quizradar://pair`
//! and `quizradar://lan`).
//!
//! Single implementation shared across Desktop (native), Android (UniFFI), and
//! Web/PWA (WASM). Uses raw DEFLATE (`miniz_oxide`) + Base64URL without padding,
//! wire-compatible with browser `CompressionStream("deflate-raw")` and Java
//! `Deflater(nowrap=true)`.

use std::net::Ipv4Addr;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::sync::qr::MAX_QR_BYTE_CAPACITY;

/// Offline compressed peer sync URI prefix (`quizradar://pair?d=...`).
pub const PAIR_SYNC_PREFIX: &str = "quizradar://pair?d=";

/// Ephemeral Desktop LAN HTTPS pairing URI prefix (`quizradar://lan?...`).
pub const LAN_PAIR_PREFIX: &str = "quizradar://lan?";

/// Maximum decompressed payload size (32 MB, matching `REFUSE_TRUNCATE_BYTES`).
pub const MAX_DECOMPRESSED_BYTES: usize = 32_000_000;

const LOSSLESS_STRIP_KEYS: &[&str] = &["google_cal_url", "conflict_warning", "display_time"];
const VERBOSE_STRIP_KEYS: &[&str] = &[
    "google_cal_url",
    "conflict_warning",
    "display_time",
    "raw_text",
    "ai_study_plan",
];
const TRUNCATE_KEYS: &[&str] = &["snippet", "notes", "ai_inference_note"];

/// Result of encoding a `BackupPayload` JSON for offline QR pairing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairQrResult {
    pub link: String,
    pub compacted: bool,
    pub fits_qr: bool,
    pub byte_len: usize,
}

/// Result of conditionally compacting a `BackupPayload` JSON.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompactPayloadResult {
    pub json: String,
    pub compacted: bool,
}

/// Parsed and SSRF-validated ephemeral Desktop LAN HTTPS pairing URI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LanPairUri {
    pub host: String,
    pub port: u16,
    pub token: String,
    pub fingerprint_b64url: String,
    pub version: u8,
}

fn truncate_chars(value: &str, max_chars: usize) -> Option<String> {
    let char_count = value.chars().count();
    if char_count <= max_chars {
        return None;
    }
    let keep = max_chars.saturating_sub(3);
    let prefix: String = value.chars().take(keep).collect();
    Some(format!("{prefix}..."))
}

fn compact_json_value(value: Value, strip_keys: &[&str], truncate_keys: &[&str]) -> Value {
    match value {
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| compact_json_value(item, strip_keys, truncate_keys))
                .collect(),
        ),
        Value::Object(map) => {
            let mut out = Map::with_capacity(map.len());
            for (k, v) in map {
                if v.is_null() || strip_keys.iter().any(|&sk| sk == k) {
                    continue;
                }
                if truncate_keys.iter().any(|&tk| tk == k) {
                    if let Value::String(ref s) = v {
                        if let Some(shortened) = truncate_chars(s, 160) {
                            out.insert(k, Value::String(shortened));
                            continue;
                        }
                    }
                }
                out.insert(k, compact_json_value(v, strip_keys, truncate_keys));
            }
            Value::Object(out)
        }
        other => other,
    }
}

/// Stage 1 (lossless) compaction: strips `null` optional fields and recomputable
/// derived fields (`google_cal_url`, `conflict_warning`, `display_time`) without
/// removing `ai_study_plan`, `ai_inference_note`, or user `notes`.
pub fn strip_lossless_pair_sync_fields(payload_json: &str) -> Result<String, String> {
    let parsed: Value = serde_json::from_str(payload_json)
        .map_err(|e| format!("Invalid sync payload JSON: {e}"))?;
    let compacted = compact_json_value(parsed, LOSSLESS_STRIP_KEYS, &[]);
    serde_json::to_string(&compacted)
        .map_err(|e| format!("Failed to serialize compacted sync payload: {e}"))
}

/// Stage 2 (full) compaction: strips `null` optional fields, derived fields,
/// verbose `raw_text` / `ai_study_plan`, and truncates `snippet` / `notes` /
/// `ai_inference_note` (> 160 Unicode chars) across assessments and custom events.
pub fn compact_pair_sync_payload_verbose(payload_json: &str) -> Result<String, String> {
    let parsed: Value = serde_json::from_str(payload_json)
        .map_err(|e| format!("Invalid sync payload JSON: {e}"))?;
    let compacted = compact_json_value(parsed, VERBOSE_STRIP_KEYS, TRUNCATE_KEYS);
    serde_json::to_string(&compacted)
        .map_err(|e| format!("Failed to serialize compacted sync payload: {e}"))
}

/// Compresses `payload_json` via raw DEFLATE + Base64URL into `quizradar://pair?d=...`.
pub fn encode_pair_sync_link(payload_json: &str) -> String {
    let compressed = miniz_oxide::deflate::compress_to_vec(payload_json.as_bytes(), 9);
    let encoded = URL_SAFE_NO_PAD.encode(&compressed);
    format!("{PAIR_SYNC_PREFIX}{encoded}")
}

/// Conditionally compacts `payload_json` in two stages when its compressed link
/// exceeds `max_link_bytes`.
pub fn compact_payload_if_needed(
    payload_json: &str,
    max_link_bytes: usize,
) -> Result<CompactPayloadResult, String> {
    let full_link = encode_pair_sync_link(payload_json);
    if full_link.len() <= max_link_bytes {
        return Ok(CompactPayloadResult {
            json: payload_json.to_string(),
            compacted: false,
        });
    }
    let lossless_json = strip_lossless_pair_sync_fields(payload_json)?;
    if encode_pair_sync_link(&lossless_json).len() <= max_link_bytes {
        return Ok(CompactPayloadResult {
            json: lossless_json,
            compacted: true,
        });
    }
    let verbose_json = compact_pair_sync_payload_verbose(&lossless_json)?;
    Ok(CompactPayloadResult {
        json: verbose_json,
        compacted: true,
    })
}

/// Encodes `payload_json` into a QR-ready `quizradar://pair?d=...` link using
/// two-stage compaction only when the full link exceeds `max_link_bytes`.
pub fn encode_pair_sync_qr(
    payload_json: &str,
    max_link_bytes: usize,
) -> Result<PairQrResult, String> {
    let max_bytes = if max_link_bytes == 0 {
        MAX_QR_BYTE_CAPACITY
    } else {
        max_link_bytes
    };
    let full_link = encode_pair_sync_link(payload_json);
    if full_link.len() <= max_bytes {
        let byte_len = full_link.len();
        return Ok(PairQrResult {
            link: full_link,
            compacted: false,
            fits_qr: true,
            byte_len,
        });
    }
    let lossless_json = strip_lossless_pair_sync_fields(payload_json)?;
    let lossless_link = encode_pair_sync_link(&lossless_json);
    if lossless_link.len() <= max_bytes {
        let byte_len = lossless_link.len();
        return Ok(PairQrResult {
            link: lossless_link,
            compacted: true,
            fits_qr: true,
            byte_len,
        });
    }
    let verbose_json = compact_pair_sync_payload_verbose(&lossless_json)?;
    let verbose_link = encode_pair_sync_link(&verbose_json);
    let byte_len = verbose_link.len();
    Ok(PairQrResult {
        link: verbose_link,
        compacted: true,
        fits_qr: byte_len <= max_bytes,
        byte_len,
    })
}

/// Extracts the base64url `?d=` payload parameter from a `quizradar://pair` URI
/// or raw base64url token.
pub fn extract_pair_payload_param(raw_input: &str) -> Result<String, String> {
    let trimmed = raw_input.trim();
    if trimmed.is_empty() {
        return Err("Paste a quizradar://pair?d=... sync link first.".to_string());
    }

    if trimmed.starts_with("quizradar://") || trimmed.starts_with("com.quizradar.app://") {
        let query = trimmed
            .split_once('?')
            .map(|(_, q)| q)
            .ok_or_else(|| "Invalid sync link: missing ?d= payload.".to_string())?;
        for pair in query.split('&') {
            if let Some(val) = pair.strip_prefix("d=") {
                let d = val.trim();
                if !d.is_empty() {
                    return Ok(d.to_string());
                }
            }
        }
        return Err("Invalid sync link: missing ?d= payload.".to_string());
    }

    if trimmed
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Ok(trimmed.to_string());
    }

    Err("Unrecognized sync link format. Expected quizradar://pair?d=...".to_string())
}

/// Decodes and validates a `quizradar://pair?d=...` link back into `BackupPayload` JSON.
pub fn decode_pair_sync_link(raw_input: &str) -> Result<String, String> {
    let token = extract_pair_payload_param(raw_input)?;
    let compressed = URL_SAFE_NO_PAD
        .decode(token.as_bytes())
        .map_err(|_| "Corrupted sync link (invalid base64url encoding).".to_string())?;

    let decompressed =
        miniz_oxide::inflate::decompress_to_vec_with_limit(&compressed, MAX_DECOMPRESSED_BYTES)
            .map_err(|_| "Corrupted sync link (failed to decompress payload).".to_string())?;

    let json = String::from_utf8(decompressed)
        .map_err(|_| "Corrupted sync link (invalid UTF-8 payload).".to_string())?;

    let parsed: Value = serde_json::from_str(&json)
        .map_err(|_| "Sync link payload is not valid JSON.".to_string())?;

    let obj = parsed
        .as_object()
        .ok_or_else(|| "Sync link is not a valid QuizRadar sync payload.".to_string())?;
    let has_assessments = obj.get("assessments").is_some_and(Value::is_array);
    let has_schedule = obj.get("schedule").is_some_and(Value::is_object);
    if !has_assessments || !has_schedule {
        return Err("Sync link is not a valid QuizRadar sync payload.".to_string());
    }

    Ok(json)
}

/// Returns `true` only for RFC 1918 private, link-local, or loopback IPv4 addresses.
/// Prevents SSRF: a malicious QR code can never point Android at a public internet host.
#[must_use]
pub fn is_allowed_lan_ipv4(ip: Ipv4Addr) -> bool {
    ip.is_private() || ip.is_link_local() || ip.is_loopback()
}

fn is_valid_b64url(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Builds a validated `quizradar://lan?...` URI for ephemeral Desktop LAN HTTPS pairing.
pub fn build_lan_pair_uri(
    host: Ipv4Addr,
    port: u16,
    token: &str,
    fingerprint_sha256: &[u8; 32],
) -> Result<String, String> {
    if !is_allowed_lan_ipv4(host) {
        return Err(format!(
            "Refusing to advertise non-LAN address {host} for local pairing."
        ));
    }
    if port < 1024 {
        return Err(format!("Invalid ephemeral pairing port {port}."));
    }
    if token.len() < 32 || !is_valid_b64url(token) {
        return Err("LAN pairing token must be at least 32 base64url characters.".to_string());
    }
    let fp = URL_SAFE_NO_PAD.encode(fingerprint_sha256);
    Ok(format!(
        "{LAN_PAIR_PREFIX}h={host}&p={port}&t={token}&fp={fp}&v=1"
    ))
}

/// Parses and strictly validates a `quizradar://lan?...` URI.
pub fn parse_lan_pair_uri(raw_input: &str) -> Result<LanPairUri, String> {
    let trimmed = raw_input.trim();
    let query = trimmed
        .strip_prefix(LAN_PAIR_PREFIX)
        .ok_or_else(|| "Unrecognized LAN pairing URI. Expected quizradar://lan?...".to_string())?;

    let mut host_str: Option<&str> = None;
    let mut port_str: Option<&str> = None;
    let mut token_str: Option<&str> = None;
    let mut fp_str: Option<&str> = None;
    let mut version_str: Option<&str> = None;

    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            match k {
                "h" => host_str = Some(v),
                "p" => port_str = Some(v),
                "t" => token_str = Some(v),
                "fp" => fp_str = Some(v),
                "v" => version_str = Some(v),
                _ => {}
            }
        }
    }

    let version: u8 = version_str
        .unwrap_or("1")
        .parse()
        .map_err(|_| "Invalid LAN pairing protocol version.".to_string())?;
    if version != 1 {
        return Err(format!(
            "Unsupported LAN pairing version {version}; update QuizRadar on both devices."
        ));
    }

    let raw_host = host_str.ok_or_else(|| "LAN pairing URI is missing host (h).".to_string())?;
    let ip: Ipv4Addr = raw_host
        .parse()
        .map_err(|_| "LAN pairing URI host must be a valid IPv4 address.".to_string())?;
    if !is_allowed_lan_ipv4(ip) {
        return Err(format!(
            "Refusing LAN pairing to non-local address {ip} (only private Wi-Fi/hotspot IPv4 addresses are allowed)."
        ));
    }

    let port: u16 = port_str
        .ok_or_else(|| "LAN pairing URI is missing port (p).".to_string())?
        .parse()
        .map_err(|_| "Invalid LAN pairing port.".to_string())?;
    if port < 1024 {
        return Err("LAN pairing port must be an unprivileged port (>= 1024).".to_string());
    }

    let token =
        token_str.ok_or_else(|| "LAN pairing URI is missing session token (t).".to_string())?;
    if token.len() < 32 || !is_valid_b64url(token) {
        return Err("LAN pairing session token is malformed.".to_string());
    }

    let fp = fp_str.ok_or_else(|| {
        "LAN pairing URI is missing TLS certificate fingerprint (fp).".to_string()
    })?;
    if !is_valid_b64url(fp) {
        return Err("LAN pairing TLS fingerprint is malformed.".to_string());
    }
    let decoded_fp = URL_SAFE_NO_PAD
        .decode(fp.as_bytes())
        .map_err(|_| "LAN pairing TLS fingerprint is not valid base64url.".to_string())?;
    if decoded_fp.len() != 32 {
        return Err("LAN pairing TLS fingerprint must be a 32-byte SHA-256 digest.".to_string());
    }

    Ok(LanPairUri {
        host: ip.to_string(),
        port,
        token: token.to_string(),
        fingerprint_b64url: fp.to_string(),
        version,
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_pair_sync_link() {
        let sample = r##"{"schema_version":1,"client_device_id":"quizradar-desktop","updated_at":"2026-11-20T12:00:00Z","schedule":{"courses":[{"id":"CSE241","name":"Data Structures","color":"#1a73e8"}],"slots":[]},"assessments":[{"id":"a1","course_id":"CSE241","title":"Midterm 1"}],"completed_topics":{"a1::h1":true},"grades":{},"custom_events":[],"feeds":[]}"##;
        let link = encode_pair_sync_link(sample);
        assert!(link.starts_with(PAIR_SYNC_PREFIX));
        let decoded = decode_pair_sync_link(&link).unwrap();
        let a: Value = serde_json::from_str(sample).unwrap();
        let b: Value = serde_json::from_str(&decoded).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn two_stage_compaction_targets_real_backup_payload_fields() {
        let study_plan = "Step 1: Review binary trees and heaps. ".repeat(30);
        let inference = "Inferred from Monday announcement email. ".repeat(10);
        let event_notes = "Bring scientific calculator and formula sheet. ".repeat(10);
        let cal_url = format!(
            "https://calendar.google.com/calendar/render?action=TEMPLATE&details={}",
            "x".repeat(300)
        );
        let sample = serde_json::json!({
            "schema_version": 1,
            "client_device_id": "quizradar-desktop",
            "updated_at": "2026-11-20T12:00:00Z",
            "schedule": { "semester": null, "courses": [], "slots": [] },
            "assessments": [{
                "id": "a1",
                "course_id": "CSE241",
                "title": "Midterm 1",
                "room": null,
                "display_time": "Sun Oct 18",
                "conflict_warning": "Within 48h",
                "google_cal_url": cal_url,
                "ai_study_plan": study_plan,
                "ai_inference_note": inference,
            }],
            "completed_topics": {},
            "grades": {},
            "custom_events": [{
                "id": "ev1",
                "title": "Prep",
                "room": null,
                "notes": event_notes,
            }],
            "feeds": [],
        })
        .to_string();

        // Stage 1 preserves ai_study_plan & notes while dropping nulls and derived fields.
        let full_len = encode_pair_sync_link(&sample).len();
        let stage1 = encode_pair_sync_qr(&sample, full_len - 1).unwrap();
        assert!(stage1.compacted);
        assert!(stage1.fits_qr);
        let stage1_val: Value =
            serde_json::from_str(&decode_pair_sync_link(&stage1.link).unwrap()).unwrap();
        assert!(stage1_val["assessments"][0].get("google_cal_url").is_none());
        assert!(stage1_val["assessments"][0].get("room").is_none());
        assert!(stage1_val["assessments"][0]["ai_study_plan"].is_string());

        // Stage 2 drops ai_study_plan and truncates ai_inference_note + custom_events[].notes.
        let stage2 = compact_payload_if_needed(&sample, 120).unwrap();
        assert!(stage2.compacted);
        let stage2_val: Value = serde_json::from_str(&stage2.json).unwrap();
        assert!(stage2_val["assessments"][0].get("ai_study_plan").is_none());
        assert!(
            stage2_val["assessments"][0]["ai_inference_note"]
                .as_str()
                .unwrap()
                .chars()
                .count()
                <= 160
        );
        assert!(
            stage2_val["custom_events"][0]["notes"]
                .as_str()
                .unwrap()
                .chars()
                .count()
                <= 160
        );
    }

    #[test]
    fn lan_pair_uri_round_trips_and_blocks_public_ips() {
        let token = "A".repeat(43);
        let fp = [0xABu8; 32];
        let uri = build_lan_pair_uri(Ipv4Addr::new(192, 168, 1, 42), 51823, &token, &fp).unwrap();
        let parsed = parse_lan_pair_uri(&uri).unwrap();
        assert_eq!(parsed.host, "192.168.1.42");
        assert_eq!(parsed.port, 51823);
        assert_eq!(parsed.token, token);
        assert_eq!(parsed.version, 1);

        // Public IPv4 must be rejected (SSRF protection)
        let bad_public = format!(
            "quizradar://lan?h=8.8.8.8&p=51823&t={token}&fp={}&v=1",
            URL_SAFE_NO_PAD.encode(fp)
        );
        assert!(parse_lan_pair_uri(&bad_public).is_err());

        // Short token must be rejected
        let bad_token = format!(
            "quizradar://lan?h=192.168.1.42&p=51823&t=short&fp={}&v=1",
            URL_SAFE_NO_PAD.encode(fp)
        );
        assert!(parse_lan_pair_uri(&bad_token).is_err());
    }
}
