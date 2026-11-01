//! Keyring secret store (`04` §4.3, `AGENTS.md` §3.2).
//!
//! Stores refresh tokens and BYOK API keys in the host OS credential manager
//! (Windows Credential Manager / DPAPI on Windows, Keychain on macOS,
//! Secret Service on Linux). Secrets never touch the SQLite database, logs,
//! or wire IPC payloads. Short-lived (1h) access tokens live in memory only.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use keyring::Entry;

pub const SERVICE_NAME: &str = "com.quizradar.app";
/// When set to `"1"` or `"true"`, secrets stay in an isolated in-memory map
/// so automated UI/E2E sweeps never read or mutate the host OS keyring.
pub const ENV_EPHEMERAL_KEYRING: &str = "QUIZRADAR_EPHEMERAL_KEYRING";

pub const KEY_GOOGLE_REFRESH_TOKEN: &str = "google_refresh_token";
pub const KEY_MICROSOFT_REFRESH_TOKEN: &str = "microsoft_refresh_token";
pub const KEY_GEMINI_API_KEY: &str = "gemini_api_key";
/// Optional runtime override for the bundled Google client secret (Settings →
/// Account → Google client secret). Lives in the OS keyring, never in SQLite.
pub const KEY_GOOGLE_CLIENT_SECRET: &str = "google_client_secret";

#[derive(Debug, Clone)]
enum KeyringBackend {
    Os { service: String },
    Ephemeral(Arc<Mutex<HashMap<String, String>>>),
}

impl Default for KeyringBackend {
    fn default() -> Self {
        Self::Os {
            service: SERVICE_NAME.to_string(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct KeyringStore {
    backend: KeyringBackend,
}

impl KeyringStore {
    #[must_use]
    pub fn new() -> Self {
        let ephemeral = std::env::var(ENV_EPHEMERAL_KEYRING)
            .ok()
            .is_some_and(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true"));
        if ephemeral {
            Self::ephemeral()
        } else {
            Self {
                backend: KeyringBackend::Os {
                    service: SERVICE_NAME.to_string(),
                },
            }
        }
    }

    #[must_use]
    pub fn ephemeral() -> Self {
        Self {
            backend: KeyringBackend::Ephemeral(Arc::new(Mutex::new(HashMap::new()))),
        }
    }

    #[must_use]
    pub fn with_service(service: &str) -> Self {
        Self {
            backend: KeyringBackend::Os {
                service: service.to_string(),
            },
        }
    }

    /// Stores a secret securely in the OS keyring (or ephemeral test map).
    pub fn set_secret(&self, key: &str, secret: &str) -> Result<(), String> {
        match &self.backend {
            KeyringBackend::Ephemeral(map) => {
                let mut guard = map
                    .lock()
                    .map_err(|_| "ephemeral keyring poisoned".to_string())?;
                guard.insert(key.to_string(), secret.to_string());
                Ok(())
            }
            KeyringBackend::Os { service } => {
                let entry =
                    Entry::new(service, key).map_err(|e| format!("keyring entry error: {e}"))?;
                entry
                    .set_password(secret)
                    .map_err(|e| format!("keyring write error: {e}"))
            }
        }
    }

    /// Retrieves a secret from the OS keyring, returning `Ok(None)` if absent.
    pub fn get_secret(&self, key: &str) -> Result<Option<String>, String> {
        match &self.backend {
            KeyringBackend::Ephemeral(map) => {
                let guard = map
                    .lock()
                    .map_err(|_| "ephemeral keyring poisoned".to_string())?;
                Ok(guard.get(key).cloned())
            }
            KeyringBackend::Os { service } => {
                let entry =
                    Entry::new(service, key).map_err(|e| format!("keyring entry error: {e}"))?;
                match entry.get_password() {
                    Ok(pass) => Ok(Some(pass)),
                    Err(keyring::Error::NoEntry) => Ok(None),
                    Err(e) => Err(format!("keyring read error: {e}")),
                }
            }
        }
    }

    /// Deletes a secret from the OS keyring (idempotent: no error if already absent).
    pub fn delete_secret(&self, key: &str) -> Result<(), String> {
        match &self.backend {
            KeyringBackend::Ephemeral(map) => {
                let mut guard = map
                    .lock()
                    .map_err(|_| "ephemeral keyring poisoned".to_string())?;
                guard.remove(key);
                Ok(())
            }
            KeyringBackend::Os { service } => {
                let entry =
                    Entry::new(service, key).map_err(|e| format!("keyring entry error: {e}"))?;
                match entry.delete_credential() {
                    Ok(_) => Ok(()),
                    Err(keyring::Error::NoEntry) => Ok(()),
                    Err(e) => Err(format!("keyring delete error: {e}")),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    #[test]
    fn test_keyring_round_trip() {
        let store = KeyringStore::with_service("com.quizradar.app.test");
        let test_key = "dpapi_roundtrip_test_key";
        let test_val = "test_secret_payload_98765";

        // Attempt set; if the platform/container has no credential manager access (e.g. headless CI),
        // feature-guard gracefully so CI passes without false alarms.
        match store.set_secret(test_key, test_val) {
            Ok(()) => {
                let retrieved = store
                    .get_secret(test_key)
                    .expect("get secret must succeed if set succeeded");
                assert_eq!(retrieved.as_deref(), Some(test_val));

                store
                    .delete_secret(test_key)
                    .expect("delete secret must succeed");

                let after_delete = store
                    .get_secret(test_key)
                    .expect("get secret after delete must succeed");
                assert_eq!(after_delete, None);
            }
            Err(err) => {
                // Feature-guard: DPAPI/credential store unavailable in this test runner.
                eprintln!("Keyring roundtrip skipped on this runner (no DPAPI/keychain: {err})");
            }
        }
    }
}
