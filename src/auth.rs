use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;

const DEFAULT_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const DEFAULT_AUTH_URI: &str = "https://accounts.google.com/o/oauth2/v2/auth";

// Obfuscated default credentials for standalone desktop builds
const OAUTH_MASK: &[u8] = &[0x4F, 0x9B, 0x12, 0x7E, 0x33];

const MASKED_CLIENT_ID: &[u8] = &[
    0x7c, 0xaf, 0x23, 0x49, 0x05, 0x7f, 0xa2, 0x21, 0x4a, 0x0b, 0x7c, 0xad, 0x3f, 0x48, 0x03, 0x3b,
    0xf4, 0x7b, 0x46, 0x41, 0x25, 0xfc, 0x79, 0x17, 0x57, 0x7f, 0xfc, 0x7f, 0x1d, 0x05, 0x76, 0xef,
    0x7f, 0x0a, 0x06, 0x76, 0xa3, 0x66, 0x1b, 0x54, 0x27, 0xf9, 0x75, 0x08, 0x07, 0x61, 0xfa, 0x62,
    0x0e, 0x40, 0x61, 0xfc, 0x7d, 0x11, 0x54, 0x23, 0xfe, 0x67, 0x0d, 0x56, 0x3d, 0xf8, 0x7d, 0x10,
    0x47, 0x2a, 0xf5, 0x66, 0x50, 0x50, 0x20, 0xf6,
];

const MASKED_CLIENT_SECRET: &[u8] = &[
    0x08, 0xd4, 0x51, 0x2d, 0x63, 0x17, 0xb6, 0x7d, 0x4a, 0x7a, 0x36, 0xad, 0x4a, 0x49, 0x56, 0x39,
    0xf9, 0x55, 0x08, 0x07, 0x3a, 0xec, 0x22, 0x37, 0x7c, 0x06, 0xf6, 0x63, 0x29, 0x72, 0x08, 0xce,
    0x7e, 0x08, 0x0b,
];

fn unmask(masked: &[u8]) -> String {
    let unmasked: Vec<u8> = masked
        .iter()
        .enumerate()
        .map(|(i, &b)| b ^ OAUTH_MASK[i % OAUTH_MASK.len()])
        .collect();
    String::from_utf8(unmasked).unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthClientCredentials {
    pub client_id: String,
    pub client_secret: String,
    pub auth_uri: String,
    pub token_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredToken {
    #[serde(alias = "access_token")]
    pub token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default = "default_token_uri")]
    pub token_uri: String,
    #[serde(default = "default_client_id")]
    pub client_id: String,
    #[serde(default = "default_client_secret")]
    pub client_secret: String,
    #[serde(default)]
    pub scopes: Vec<String>,
}

fn default_token_uri() -> String {
    DEFAULT_TOKEN_URI.to_string()
}

fn default_client_id() -> String {
    if let Ok(val) = std::env::var("GOOGLE_CLIENT_ID") {
        if !val.trim().is_empty() {
            return val.trim().to_string();
        }
    }
    unmask(MASKED_CLIENT_ID)
}

fn default_client_secret() -> String {
    if let Ok(val) = std::env::var("GOOGLE_CLIENT_SECRET") {
        if !val.trim().is_empty() {
            return val.trim().to_string();
        }
    }
    unmask(MASKED_CLIENT_SECRET)
}

pub fn load_client_credentials() -> OAuthClientCredentials {
    let candidate_paths = [
        std::path::PathBuf::from("credentials.json"),
        std::path::PathBuf::from("data/credentials.json"),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("credentials.json")))
            .unwrap_or_else(|| std::path::PathBuf::from("credentials.json")),
    ];

    for path in candidate_paths {
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                let block = v.get("installed").or_else(|| v.get("web"));
                if let Some(b) = block {
                    let client_id = b
                        .get("client_id")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(default_client_id);
                    let client_secret = b
                        .get("client_secret")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(default_client_secret);
                    let auth_uri = b
                        .get("auth_uri")
                        .and_then(|x| x.as_str())
                        .unwrap_or(DEFAULT_AUTH_URI)
                        .to_string();
                    let token_uri = b
                        .get("token_uri")
                        .and_then(|x| x.as_str())
                        .unwrap_or(DEFAULT_TOKEN_URI)
                        .to_string();
                    return OAuthClientCredentials {
                        client_id,
                        client_secret,
                        auth_uri,
                        token_uri,
                    };
                }
            }
        }
    }

    OAuthClientCredentials {
        client_id: default_client_id(),
        client_secret: default_client_secret(),
        auth_uri: DEFAULT_AUTH_URI.to_string(),
        token_uri: DEFAULT_TOKEN_URI.to_string(),
    }
}

pub fn load_stored_token() -> Option<StoredToken> {
    let raw = fs::read_to_string("token.json").ok()?;
    serde_json::from_str::<StoredToken>(&raw).ok()
}

pub fn save_stored_token(token: &StoredToken) {
    if let Ok(json) = serde_json::to_string_pretty(token) {
        let _ = fs::write("token.json", json);
    }
}

pub fn build_google_oauth_url(port: u16, include_calendar: bool) -> String {
    let creds = load_client_credentials();
    let redirect_uri = format!("http://localhost:{}/api/auth/callback", port);

    let mut scopes = vec![
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
    ];
    if include_calendar {
        scopes.push("https://www.googleapis.com/auth/calendar.events");
    }
    let scope_str = scopes.join(" ");

    format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent&include_granted_scopes=true",
        crate::urlencoding::encode(&creds.client_id),
        crate::urlencoding::encode(&redirect_uri),
        crate::urlencoding::encode(&scope_str)
    )
}

pub async fn exchange_code_for_token(code: &str, port: u16) -> Result<StoredToken, String> {
    let creds = load_client_credentials();
    let redirect_uri = format!("http://localhost:{}/api/auth/callback", port);
    let client = reqwest::Client::new();

    let params = [
        ("code", code),
        ("client_id", creds.client_id.as_str()),
        ("client_secret", creds.client_secret.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
    ];

    let resp = client
        .post(&creds.token_uri)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token exchange HTTP error: {}", e))?;

    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid token JSON: {}", e))?;

    if !status.is_success() {
        return Err(format!("OAuth error: {}", body));
    }

    let access_token = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing access_token in response".to_string())?
        .to_string();

    let existing_refresh = load_stored_token().and_then(|t| t.refresh_token);
    let refresh_token = body
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or(existing_refresh);

    let scopes: Vec<String> = body
        .get("scope")
        .and_then(|v| v.as_str())
        .map(|s| s.split_whitespace().map(|x| x.to_string()).collect())
        .unwrap_or_else(|| {
            vec![
                "https://www.googleapis.com/auth/gmail.readonly".to_string(),
                "https://www.googleapis.com/auth/calendar.events".to_string(),
            ]
        });

    let stored = StoredToken {
        token: access_token,
        refresh_token,
        token_uri: creds.token_uri,
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        scopes,
    };

    save_stored_token(&stored);
    Ok(stored)
}

pub async fn get_valid_access_token() -> Result<StoredToken, String> {
    let mut stored = load_stored_token().ok_or_else(|| "No stored Google token found".to_string())?;
    let client = reqwest::Client::new();

    // Test if current token is valid via tokeninfo or user profile check, or refresh if needed
    let test_resp = client
        .get("https://gmail.googleapis.com/gmail/v1/users/me/profile")
        .bearer_auth(&stored.token)
        .send()
        .await;

    if let Ok(r) = test_resp {
        if r.status().is_success() {
            return Ok(stored);
        }
    }

    // Need to refresh using refresh_token
    let refresh_token = stored
        .refresh_token
        .clone()
        .ok_or_else(|| "Token expired and no refresh_token is available".to_string())?;

    let creds = load_client_credentials();
    let params = [
        ("client_id", creds.client_id.as_str()),
        ("client_secret", creds.client_secret.as_str()),
        ("refresh_token", refresh_token.as_str()),
        ("grant_type", "refresh_token"),
    ];

    let resp = client
        .post(&creds.token_uri)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token refresh network error: {}", e))?;

    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Token refresh JSON parse error: {}", e))?;

    if !status.is_success() {
        return Err(format!("Token refresh rejected: {}", body));
    }

    if let Some(new_token) = body.get("access_token").and_then(|v| v.as_str()) {
        stored.token = new_token.to_string();
        if let Some(scope_str) = body.get("scope").and_then(|v| v.as_str()) {
            stored.scopes = scope_str.split_whitespace().map(|s| s.to_string()).collect();
        }
        save_stored_token(&stored);
        Ok(stored)
    } else {
        Err("No access_token in refresh response".to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleUserProfile {
    pub authenticated: bool,
    pub email: Option<String>,
    pub name: Option<String>,
    pub picture: Option<String>,
    pub has_gmail_scope: bool,
    pub has_calendar_scope: bool,
}

pub async fn fetch_user_profile() -> GoogleUserProfile {
    let token = match get_valid_access_token().await {
        Ok(t) => t,
        Err(_) => {
            return GoogleUserProfile {
                authenticated: false,
                email: None,
                name: None,
                picture: None,
                has_gmail_scope: false,
                has_calendar_scope: false,
            };
        }
    };

    let client = reqwest::Client::new();
    let mut email = None;
    let mut name = None;
    let mut picture = None;

    // 1. Try Gmail profile
    if let Ok(resp) = client
        .get("https://gmail.googleapis.com/gmail/v1/users/me/profile")
        .bearer_auth(&token.token)
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<Value>().await {
                email = v
                    .get("emailAddress")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string());
            }
        }
    }

    // 2. Try OAuth2 userinfo if available
    if let Ok(resp) = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&token.token)
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<Value>().await {
                if email.is_none() {
                    email = v.get("email").and_then(|x| x.as_str()).map(|s| s.to_string());
                }
                name = v.get("name").and_then(|x| x.as_str()).map(|s| s.to_string());
                picture = v
                    .get("picture")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string());
            }
        }
    }

    if name.is_none() {
        if let Some(ref em) = email {
            let local = em.split('@').next().unwrap_or("Student");
            let formatted = local
                .split('.')
                .map(|part| {
                    let clean: String = part.chars().filter(|c| c.is_alphabetic()).collect();
                    let mut chars = clean.chars();
                    match chars.next() {
                        None => String::new(),
                        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
                    }
                })
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            if !formatted.is_empty() {
                name = Some(formatted);
            }
        }
    }

    let has_gmail_scope = token
        .scopes
        .iter()
        .any(|s| s.contains("gmail"))
        || email.is_some();
    let has_calendar_scope = token
        .scopes
        .iter()
        .any(|s| s.contains("calendar"));

    GoogleUserProfile {
        authenticated: email.is_some(),
        email,
        name,
        picture,
        has_gmail_scope,
        has_calendar_scope,
    }
}

/// Instant 0ms local profile lookup using stored token scopes + cached AppConfig user metadata.
/// Avoids blocking `/api/state` or server startup on external Google HTTP calls.
pub fn get_cached_user_profile(config: &crate::models::AppConfig) -> GoogleUserProfile {
    if let Some(token) = load_stored_token() {
        let has_gmail_scope = token
            .scopes
            .iter()
            .any(|s| s.contains("gmail"))
            || config.user_email.is_some();
        let has_calendar_scope = token
            .scopes
            .iter()
            .any(|s| s.contains("calendar"));

        GoogleUserProfile {
            authenticated: true,
            email: config.user_email.clone(),
            name: config.user_name.clone(),
            picture: config.user_picture.clone(),
            has_gmail_scope,
            has_calendar_scope,
        }
    } else {
        GoogleUserProfile {
            authenticated: config.user_email.is_some(),
            email: config.user_email.clone(),
            name: config.user_name.clone(),
            picture: config.user_picture.clone(),
            has_gmail_scope: config.user_email.is_some(),
            has_calendar_scope: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unmask_credentials() {
        let id = unmask(MASKED_CLIENT_ID);
        let sec = unmask(MASKED_CLIENT_SECRET);
        assert!(id.contains(".apps.googleusercontent.com"));
        assert!(sec.starts_with("GOCSPX-"));
    }
}
