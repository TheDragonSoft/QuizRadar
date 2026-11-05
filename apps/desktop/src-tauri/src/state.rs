//! Desktop application state held by Tauri.
//!
//! Ties the SQLite [`quizradar_core::store::Store`], OS keyring, in-memory
//! access tokens, and background task cancellation together.

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{FixedOffset, Local, NaiveDate, Offset, Utc};
use quizradar_core::auth::providers::{
    google_union_scopes, microsoft_union_scopes, refresh_token_params,
    refresh_token_params_with_secret, GoogleCapability, MicrosoftCapability, ProviderCapability,
    GOOGLE_TOKEN_URL, MICROSOFT_TOKEN_URL,
};
use quizradar_core::sources::TokenProvider;
use quizradar_core::store::Store;
use serde::Deserialize;
use tokio::sync::{watch, RwLock};

use crate::keyring::{
    KeyringStore, KEY_GEMINI_API_KEY, KEY_GOOGLE_CLIENT_SECRET, KEY_GOOGLE_REFRESH_TOKEN,
    KEY_MICROSOFT_REFRESH_TOKEN,
};

/// Environment-variable fallbacks for the OAuth client ids (handy for
/// portable installs and CI; never a secret — client ids are public).
pub const ENV_GOOGLE_CLIENT_ID: &str = "QUIZRADAR_GOOGLE_CLIENT_ID";
/// Environment-variable override for the Google client secret.
pub const ENV_GOOGLE_CLIENT_SECRET: &str = "QUIZRADAR_GOOGLE_CLIENT_SECRET";
pub const ENV_MICROSOFT_CLIENT_ID: &str = "QUIZRADAR_MICROSOFT_CLIENT_ID";

/// Environment-variable override for the Gemini API key.
///
/// Lets one shared key serve a private install without the key ever
/// entering the source: the OS keyring entry (Settings → AI) wins, then
/// this variable, then the [`GEMINI_KEY_FILENAME`] seed file next to the
/// executable.
pub const ENV_GEMINI_API_KEY: &str = "QUIZRADAR_GEMINI_API_KEY";

/// Optional seed file carrying the Gemini API key, looked up next to the
/// executable. A shipped private install can therefore carry a shared key
/// that never touches the repository or the git history.
pub const GEMINI_KEY_FILENAME: &str = "gemini.key";

/// Public (non-secret) client id of the "Microsoft Graph Command Line Tools"
/// registration. `docs/rebuild/02-current-architecture.md` §5.3 names it as
/// QuizRadar's Microsoft app ("... or user-supplied"), and a public client id
/// is not a secret, so it may ship. A user-supplied app id always wins.
pub const DEFAULT_MICROSOFT_CLIENT_ID: &str = "14d82eec-204b-4c2f-b7e8-296a70dab67e";

/// Google OAuth client id of the maintainer-provided registration (project
/// `gmail-summary-511914`, an **Installed**-type client; maintainer-provided
/// 2026-11-05 and shared with the Android app). A client id is a public
/// identifier, so it may ship.
pub const DEFAULT_GOOGLE_CLIENT_ID: &str =
    "341760934836-60toi8rjgkid0gmc69tmt598teghbgv4.apps.googleusercontent.com";

/// Client secret of the Google registration above.
///
/// The registration is an installed-app client, for which Google itself
/// states the secret "is not treated as a secret" — but its token endpoint
/// still refuses a secretless exchange with `invalid_request: client_secret
/// is missing` (verified against `oauth2.googleapis.com/token`), so the
/// desktop shell ships the secret that belongs to the client id it ships.
///
/// Scope of use: the desktop token exchange and the Google refresh grant
/// only. It never reaches the web/PWA bundle, the SQLite database, the UI,
/// the logs or any error string. Runtime overrides (OS keyring entry
/// `google_client_secret`, or `QUIZRADAR_GOOGLE_CLIENT_SECRET`) win, so the
/// secret can be rotated without touching the source.
pub const DEFAULT_GOOGLE_CLIENT_SECRET: &str = "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";

pub const GOOGLE_CLIENT_ID_INVALID: &str = "The Google OAuth client ID in Settings is not usable. Copy it again from Google Cloud Console → APIs & Services → Credentials (it looks like 1234567890-abc.apps.googleusercontent.com and contains no spaces).";

pub const MICROSOFT_CLIENT_ID_INVALID: &str = "The Microsoft application (client) ID in Settings is not usable. Copy it again from Azure portal → App registrations → your app → Overview (it is a GUID with no spaces).";

pub struct CachedToken {
    pub token: String,
    pub expires_at: Instant,
}

// A derived `Debug` would print the bearer token into any future `{:?}` /
// panic payload and therefore into `quizradar-boot.log` — the token must
// never leave the process in a debug dump.
impl std::fmt::Debug for CachedToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CachedToken")
            .field("token", &"[redacted]")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

impl CachedToken {
    #[must_use]
    pub fn is_valid(&self) -> bool {
        // Keep a 60s safety buffer so an almost-expired token isn't sent mid-flight
        Instant::now() + Duration::from_secs(60) < self.expires_at
    }
}

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub keyring: KeyringStore,
    pub google_token: Arc<RwLock<Option<CachedToken>>>,
    pub microsoft_token: Arc<RwLock<Option<CachedToken>>>,
    pub sync_in_flight: Arc<AtomicBool>,
    /// Cancellation epoch for the running source scan. A scan subscribes to
    /// it before it starts fetching; `cancel_sync` bumps the epoch, which
    /// aborts that scan's in-flight requests. The epoch (not a bool) means a
    /// cancel can never be "used up" by a later scan.
    pub cancel_tx: watch::Sender<u64>,
    pub http_client: reqwest::Client,
}

/// Normalizes a user-supplied OAuth client id. Client ids are public, but a
/// pasted value with spaces or an accidental secret in it must never reach a
/// provider request, so anything that is not a plausible id is rejected.
fn sanitize_client_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 256 || trimmed.chars().any(char::is_whitespace) {
        return None;
    }
    Some(trimmed.to_string())
}

/// Resolution order for an OAuth client id: the value saved in Settings →
/// the environment variable → (Microsoft only) the bundled public client id.
/// `Err` carries an honest, actionable message.
fn resolve_client_id(
    stored: Option<&str>,
    from_env: Option<&str>,
    fallback: Option<&str>,
    invalid_message: &str,
    missing_message: &str,
) -> Result<String, String> {
    for candidate in [stored, from_env, fallback] {
        let Some(raw) = candidate else { continue };
        if raw.trim().is_empty() {
            continue;
        }
        return sanitize_client_id(raw).ok_or_else(|| invalid_message.to_string());
    }
    Err(missing_message.to_string())
}

fn env_client_id(name: &str) -> Option<String> {
    env_value(name)
}

/// A trimmed, non-empty value from an environment variable.
fn env_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// A trimmed, non-empty secret. Blank values are skipped so a cleared
/// setting never shadows a later candidate.
fn normalize_secret(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// The first usable secret among the candidates, in priority order.
fn first_secret(candidates: impl IntoIterator<Item = Option<String>>) -> Option<String> {
    candidates
        .into_iter()
        .flatten()
        .find_map(|value| normalize_secret(&value))
}

/// Reads a seed file that carries a secret. A file that is missing, empty,
/// oversized or not a regular file yields nothing — never a guess.
fn read_seed_file(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > 4096 {
        return None;
    }
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| normalize_secret(&text))
}

/// The `gemini.key` seed file next to the running executable.
fn seed_file_key() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    read_seed_file(&dir.join(GEMINI_KEY_FILENAME))
}

impl AppState {
    pub fn new(store: Store, keyring: KeyringStore) -> Self {
        let http_client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();

        Self {
            store,
            keyring,
            google_token: Arc::new(RwLock::new(None)),
            microsoft_token: Arc::new(RwLock::new(None)),
            sync_in_flight: Arc::new(AtomicBool::new(false)),
            cancel_tx: {
                let (tx, _rx) = watch::channel(0_u64);
                tx
            },
            http_client,
        }
    }

    /// Requests cancellation of the running source scan. The scan observes
    /// the epoch change and drops its in-flight requests; nothing it fetched
    /// is written to the store (the merge happens after the fetch phase).
    pub fn request_cancel(&self) {
        let next = self.cancel_tx.borrow().wrapping_add(1);
        self.cancel_tx.send_replace(next);
    }

    /// A cancellation receiver positioned at the current epoch. A scan that
    /// holds one is aborted by the next [`AppState::request_cancel`] call.
    pub fn cancel_token(&self) -> watch::Receiver<u64> {
        self.cancel_tx.subscribe()
    }

    /// Effective Google OAuth client id (Settings → env → the bundled client
    /// id of the maintainer-provided registration).
    pub async fn effective_google_client_id(&self) -> Result<String, String> {
        let stored = self
            .store
            .get_config_string("google_client_id".to_string())
            .await
            .unwrap_or(None);
        let from_env = env_client_id(ENV_GOOGLE_CLIENT_ID);
        resolve_client_id(
            stored.as_deref(),
            from_env.as_deref(),
            Some(DEFAULT_GOOGLE_CLIENT_ID),
            GOOGLE_CLIENT_ID_INVALID,
            GOOGLE_CLIENT_ID_INVALID,
        )
    }

    /// Effective Google client secret (OS keyring → env → the bundled secret).
    ///
    /// The keyring entry lets the user rotate the secret from Settings →
    /// Account without a rebuild; the env var wins over the bundled value for
    /// portable installs. `Ok(None)` is possible only if the user explicitly
    /// cleared the override and the bundled secret was removed from the
    /// source — then Google reports "client_secret is missing" and the core
    /// explains it.
    pub async fn effective_google_client_secret(&self) -> Option<String> {
        if let Ok(Some(stored)) = self.keyring.get_secret(KEY_GOOGLE_CLIENT_SECRET) {
            let trimmed = stored.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
        env_client_id(ENV_GOOGLE_CLIENT_SECRET).or_else(|| {
            let bundled = DEFAULT_GOOGLE_CLIENT_SECRET.trim();
            if bundled.is_empty() {
                None
            } else {
                Some(bundled.to_string())
            }
        })
    }

    /// Effective Microsoft application (client) id (Settings → env → the
    /// bundled public Graph Command Line Tools client id).
    pub async fn effective_microsoft_client_id(&self) -> Result<String, String> {
        let stored = self
            .store
            .get_config_string("teams_client_id".to_string())
            .await
            .unwrap_or(None);
        let from_env = env_client_id(ENV_MICROSOFT_CLIENT_ID);
        resolve_client_id(
            stored.as_deref(),
            from_env.as_deref(),
            Some(DEFAULT_MICROSOFT_CLIENT_ID),
            MICROSOFT_CLIENT_ID_INVALID,
            MICROSOFT_CLIENT_ID_INVALID,
        )
    }

    /// Desktop reference date: local today (injected into core derivation).
    #[must_use]
    pub fn today(&self) -> NaiveDate {
        Local::now().date_naive()
    }

    /// Current UTC RFC3339 timestamp for row mutations.
    #[must_use]
    pub fn now_iso(&self) -> String {
        Utc::now().to_rfc3339()
    }

    /// Local fixed timezone offset for date/time conversion.
    #[must_use]
    pub fn local_offset(&self) -> FixedOffset {
        Local::now().offset().fix()
    }

    /// Human-readable local timestamp for the "Last synced" stamps
    /// (`2026-10-28 19:04`). The sync stamps are read back verbatim by the
    /// UI, so they are formatted for a person, not for a parser.
    #[must_use]
    pub fn now_local_stamp(&self) -> String {
        Local::now().format("%Y-%m-%d %H:%M").to_string()
    }

    /// Caches a Google access token in memory.
    pub async fn set_google_access_token(&self, token: String, expires_in_secs: u64) {
        let mut guard = self.google_token.write().await;
        *guard = Some(CachedToken {
            token,
            expires_at: Instant::now() + Duration::from_secs(expires_in_secs),
        });
    }

    /// Caches a Microsoft access token in memory.
    pub async fn set_microsoft_access_token(&self, token: String, expires_in_secs: u64) {
        let mut guard = self.microsoft_token.write().await;
        *guard = Some(CachedToken {
            token,
            expires_at: Instant::now() + Duration::from_secs(expires_in_secs),
        });
    }

    /// Clears cached access tokens from memory.
    pub async fn clear_memory_tokens(&self) {
        *self.google_token.write().await = None;
        *self.microsoft_token.write().await = None;
    }

    /// Retrieves a valid Google access token, refreshing silently via the OS keyring refresh token if needed.
    pub async fn get_google_access_token(&self) -> Result<String, String> {
        // 1. Check in-memory cache
        {
            let guard = self.google_token.read().await;
            if let Some(cached) = guard.as_ref() {
                if cached.is_valid() {
                    return Ok(cached.token.clone());
                }
            }
        }

        // 2. Read refresh token from keyring
        let refresh_token = self
            .keyring
            .get_secret(KEY_GOOGLE_REFRESH_TOKEN)?
            .ok_or_else(|| "Not signed in to Google (no refresh token in keyring)".to_string())?;

        // 3. Perform refresh
        let client_id = self.effective_google_client_id().await?;
        let scopes = google_union_scopes(&[
            GoogleCapability::GmailRead,
            GoogleCapability::UserProfile,
            GoogleCapability::CalendarEvents,
            GoogleCapability::DriveAppdata,
            GoogleCapability::ClassroomRead,
        ]);
        let params = refresh_token_params_with_secret(
            &client_id,
            &refresh_token,
            &scopes,
            self.effective_google_client_secret().await.as_deref(),
        );

        let resp = self
            .http_client
            .post(GOOGLE_TOKEN_URL)
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Google token refresh failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Google token refresh rejected ({status}): {body}"));
        }

        #[derive(Deserialize)]
        struct TokenResp {
            access_token: String,
            expires_in: Option<u64>,
            refresh_token: Option<String>,
        }

        let parsed: TokenResp = resp
            .json()
            .await
            .map_err(|e| format!("Unparseable Google refresh response: {e}"))?;

        if let Some(new_refresh) = parsed.refresh_token {
            let _ = self
                .keyring
                .set_secret(KEY_GOOGLE_REFRESH_TOKEN, &new_refresh);
        }

        let expires_in = parsed.expires_in.unwrap_or(3600);
        self.set_google_access_token(parsed.access_token.clone(), expires_in)
            .await;

        Ok(parsed.access_token)
    }

    /// Retrieves a valid Microsoft access token, refreshing silently via the OS keyring refresh token if needed.
    pub async fn get_microsoft_access_token(&self) -> Result<String, String> {
        // 1. Check in-memory cache
        {
            let guard = self.microsoft_token.read().await;
            if let Some(cached) = guard.as_ref() {
                if cached.is_valid() {
                    return Ok(cached.token.clone());
                }
            }
        }

        // 2. Read refresh token from keyring
        let refresh_token = self
            .keyring
            .get_secret(KEY_MICROSOFT_REFRESH_TOKEN)?
            .ok_or_else(|| {
                "Not signed in to Microsoft Teams (no refresh token in keyring)".to_string()
            })?;

        // 3. Perform refresh
        let client_id = self.effective_microsoft_client_id().await?;
        let scopes = microsoft_union_scopes(&[
            MicrosoftCapability::OfflineAccess,
            MicrosoftCapability::UserProfile,
            MicrosoftCapability::MailRead,
            MicrosoftCapability::CalendarsRead,
        ]);
        let params = refresh_token_params(&client_id, &refresh_token, &scopes);

        let resp = self
            .http_client
            .post(MICROSOFT_TOKEN_URL)
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Microsoft token refresh failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Microsoft token refresh rejected ({status}): {body}"
            ));
        }

        #[derive(Deserialize)]
        struct TokenResp {
            access_token: String,
            expires_in: Option<u64>,
            refresh_token: Option<String>,
        }

        let parsed: TokenResp = resp
            .json()
            .await
            .map_err(|e| format!("Unparseable Microsoft refresh response: {e}"))?;

        if let Some(new_refresh) = parsed.refresh_token {
            let _ = self
                .keyring
                .set_secret(KEY_MICROSOFT_REFRESH_TOKEN, &new_refresh);
        }

        let expires_in = parsed.expires_in.unwrap_or(3600);
        self.set_microsoft_access_token(parsed.access_token.clone(), expires_in)
            .await;

        Ok(parsed.access_token)
    }

    /// The effective Gemini API key: the OS keyring entry (Settings → AI)
    /// first, then the `QUIZRADAR_GEMINI_API_KEY` environment variable, then
    /// a `gemini.key` seed file next to the executable.
    ///
    /// The last two exist so a private install can ship one shared key
    /// without the secret entering the repository, the database or the
    /// build. The keyring always wins, so a user who pastes their own key
    /// in Settings overrides a shipped seed without editing anything.
    pub fn get_gemini_api_key(&self) -> Result<Option<String>, String> {
        let stored = self.keyring.get_secret(KEY_GEMINI_API_KEY);
        let fallback = first_secret([env_value(ENV_GEMINI_API_KEY), seed_file_key()]);
        match stored {
            Ok(Some(value)) => Ok(normalize_secret(&value).or(fallback)),
            Ok(None) => Ok(fallback),
            // A broken credential store must not hide a usable seed — but
            // with no seed either, the store's error is the honest answer.
            Err(error) => fallback.map_or(Err(error), |key| Ok(Some(key))),
        }
    }
}

/// Token provider for Google sources (Gmail, Classroom) backed by AppState.
pub struct DesktopGoogleTokenProvider {
    pub state: AppState,
}

impl TokenProvider for DesktopGoogleTokenProvider {
    fn bearer<'a>(
        &'a self,
        _capability: ProviderCapability,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send + 'a>>
    {
        Box::pin(async move { self.state.get_google_access_token().await })
    }
}

/// Token provider for Microsoft sources (Teams) backed by AppState.
pub struct DesktopMicrosoftTokenProvider {
    pub state: AppState,
}

impl TokenProvider for DesktopMicrosoftTokenProvider {
    fn bearer<'a>(
        &'a self,
        _capability: ProviderCapability,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send + 'a>>
    {
        Box::pin(async move { self.state.get_microsoft_access_token().await })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    const INVALID: &str = "invalid client id";
    const MISSING: &str = "client id missing";

    #[test]
    fn settings_value_wins_over_env_and_fallback() {
        let resolved = resolve_client_id(
            Some("stored-id"),
            Some("env-id"),
            Some("fallback-id"),
            INVALID,
            MISSING,
        );
        assert_eq!(resolved.unwrap(), "stored-id");
    }

    #[test]
    fn env_value_wins_over_the_bundled_fallback() {
        let resolved =
            resolve_client_id(None, Some("env-id"), Some("fallback-id"), INVALID, MISSING);
        assert_eq!(resolved.unwrap(), "env-id");
    }

    #[test]
    fn bundled_fallback_is_used_when_nothing_else_is_set() {
        let resolved = resolve_client_id(None, None, Some("fallback-id"), INVALID, MISSING);
        assert_eq!(resolved.unwrap(), "fallback-id");
    }

    #[test]
    fn blank_values_are_skipped_instead_of_shadowing_a_later_candidate() {
        let resolved =
            resolve_client_id(Some("   "), Some(""), Some("fallback-id"), INVALID, MISSING);
        assert_eq!(resolved.unwrap(), "fallback-id");
    }

    #[test]
    fn a_missing_client_id_reports_the_actionable_message() {
        let resolved = resolve_client_id(None, None, None, INVALID, MISSING);
        assert_eq!(resolved.unwrap_err(), MISSING);
    }

    #[test]
    fn an_unusable_client_id_is_rejected_instead_of_being_sent_to_the_provider() {
        let resolved = resolve_client_id(Some("has space"), None, None, INVALID, MISSING);
        assert_eq!(resolved.unwrap_err(), INVALID);
    }

    #[test]
    fn client_ids_are_trimmed_before_use() {
        let resolved = resolve_client_id(Some("  abc123  "), None, None, INVALID, MISSING);
        assert_eq!(resolved.unwrap(), "abc123");
    }

    #[test]
    fn the_bundled_google_client_is_always_available() {
        // The desktop ships a working Google client, so a fresh install can
        // sign in without the user configuring anything.
        let resolved = resolve_client_id(
            None,
            None,
            Some(DEFAULT_GOOGLE_CLIENT_ID),
            GOOGLE_CLIENT_ID_INVALID,
            GOOGLE_CLIENT_ID_INVALID,
        );
        assert_eq!(resolved.unwrap(), DEFAULT_GOOGLE_CLIENT_ID);
        assert!(DEFAULT_GOOGLE_CLIENT_ID.ends_with(".apps.googleusercontent.com"));
    }

    #[test]
    fn the_bundled_google_secret_is_never_blank() {
        assert!(!DEFAULT_GOOGLE_CLIENT_SECRET.trim().is_empty());
    }

    #[test]
    fn the_authorize_url_carries_the_client_id_but_never_the_secret() {
        use quizradar_core::auth::providers::{google_authorize_url, AuthorizeRequest};

        let scopes = google_union_scopes(&[GoogleCapability::GmailRead]);
        let url = google_authorize_url(&AuthorizeRequest {
            client_id: DEFAULT_GOOGLE_CLIENT_ID,
            redirect_uri: "http://127.0.0.1:49152",
            scopes: &scopes,
            state: "state-value",
            code_challenge: "challenge-value",
        })
        .unwrap();

        assert!(url.contains(DEFAULT_GOOGLE_CLIENT_ID));
        assert!(url.contains("code_challenge_method=S256"));
        // The secret belongs in the token exchange only — never in a URL that
        // ends up in the browser history or in a proxy log.
        assert!(!url.contains(DEFAULT_GOOGLE_CLIENT_SECRET));
    }

    #[test]
    fn the_keyring_key_wins_over_the_env_and_seed_candidates() {
        let resolved = first_secret([
            Some("  keyring-key  ".to_string()),
            Some("env-key".to_string()),
            Some("seed-key".to_string()),
        ]);
        assert_eq!(resolved.unwrap(), "keyring-key");
    }

    #[test]
    fn the_env_key_wins_over_the_seed_file() {
        let resolved = first_secret([
            None,
            Some("env-key".to_string()),
            Some("seed-key".to_string()),
        ]);
        assert_eq!(resolved.unwrap(), "env-key");
    }

    #[test]
    fn a_blank_candidate_never_shadows_a_later_one() {
        let resolved = first_secret([
            Some("   ".to_string()),
            Some("".to_string()),
            Some("seed-key".to_string()),
        ]);
        assert_eq!(resolved.unwrap(), "seed-key");
    }

    #[test]
    fn no_candidate_means_no_key_rather_than_a_blank_one() {
        assert!(first_secret([None, Some("  ".to_string())]).is_none());
    }

    #[test]
    fn a_seed_file_that_does_not_exist_yields_nothing() {
        let missing = std::env::temp_dir().join("quizradar-no-such-seed-file.key");
        let _ = std::fs::remove_file(&missing);
        assert!(read_seed_file(&missing).is_none());
    }

    #[test]
    fn a_seed_file_is_read_trimmed_and_never_invents_a_key() {
        let path = std::env::temp_dir().join("quizradar-seed-file-test.key");
        std::fs::write(&path, "  seed-key\n").unwrap();
        assert_eq!(read_seed_file(&path).unwrap(), "seed-key");

        std::fs::write(&path, "   \n").unwrap();
        assert!(
            read_seed_file(&path).is_none(),
            "an empty seed file is no key at all"
        );
        let _ = std::fs::remove_file(&path);
    }
}
