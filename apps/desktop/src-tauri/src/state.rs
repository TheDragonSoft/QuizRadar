//! Desktop application state held by Tauri.
//!
//! Ties the SQLite [`quizradar_core::store::Store`], OS keyring, in-memory
//! access tokens, and background task cancellation together.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{FixedOffset, Local, NaiveDate, Offset, Utc};
use quizradar_core::auth::providers::{
    google_union_scopes, microsoft_union_scopes, refresh_token_params, GoogleCapability,
    MicrosoftCapability, ProviderCapability, GOOGLE_TOKEN_URL, MICROSOFT_TOKEN_URL,
};
use quizradar_core::sources::TokenProvider;
use quizradar_core::store::Store;
use serde::Deserialize;
use tokio::sync::RwLock;

use crate::keyring::{
    KeyringStore, KEY_GEMINI_API_KEY, KEY_GOOGLE_REFRESH_TOKEN, KEY_MICROSOFT_REFRESH_TOKEN,
};

pub const DEFAULT_GOOGLE_CLIENT_ID: &str =
    "341760934836-60toi8rjgkid0gmc69tmt598teghbgv4.apps.googleusercontent.com";
pub const DEFAULT_MICROSOFT_CLIENT_ID: &str = "14d82eec-204b-4c2f-b7e8-296a70dab67e";

#[derive(Debug, Clone)]
pub struct CachedToken {
    pub token: String,
    pub expires_at: Instant,
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
    pub cancel_requested: Arc<AtomicBool>,
    pub http_client: reqwest::Client,
    pub google_client_id: String,
    pub microsoft_client_id: String,
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
            cancel_requested: Arc::new(AtomicBool::new(false)),
            http_client,
            google_client_id: DEFAULT_GOOGLE_CLIENT_ID.to_string(),
            microsoft_client_id: DEFAULT_MICROSOFT_CLIENT_ID.to_string(),
        }
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
        let scopes = google_union_scopes(&[
            GoogleCapability::GmailRead,
            GoogleCapability::UserProfile,
            GoogleCapability::CalendarEvents,
            GoogleCapability::DriveAppdata,
            GoogleCapability::ClassroomRead,
        ]);
        let params = refresh_token_params(&self.google_client_id, &refresh_token, &scopes);

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
        let scopes = microsoft_union_scopes(&[
            MicrosoftCapability::OfflineAccess,
            MicrosoftCapability::UserProfile,
            MicrosoftCapability::MailRead,
            MicrosoftCapability::CalendarsRead,
        ]);
        let params = refresh_token_params(&self.microsoft_client_id, &refresh_token, &scopes);

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

    /// Returns Gemini API key from the OS keyring if present.
    pub fn get_gemini_api_key(&self) -> Result<Option<String>, String> {
        self.keyring.get_secret(KEY_GEMINI_API_KEY)
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
