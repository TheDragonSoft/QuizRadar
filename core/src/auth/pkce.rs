//! PKCE (RFC 7636) primitives + single-use OAuth state registry.
//!
//! `AGENTS.md` §3.2 / `04` §4.3: **no client_secret type exists anywhere in
//! this crate** — public clients authenticate with `code_verifier` +
//! `code_challenge` (S256) only. State values are random, single-use and
//! expire after 15 minutes (`02` §5.1 parity, enforced structurally here).
//!
//! Core owns no clock: every timestamp is injected by the caller
//! (unix millis), mirroring the plan modules' injected reference dates.

use std::collections::HashMap;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use thiserror::Error;

/// How long a pending OAuth state stays valid (`02` §5.1: single-use, 15 min).
pub const STATE_TTL_MS: i64 = 15 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum AuthError {
    #[error("PKCE verifier must be 43-128 characters from the RFC 7636 unreserved set")]
    InvalidVerifier,
    #[error("entropy source unavailable: {0}")]
    Randomness(String),
    #[error("unknown OAuth state — callback replayed, forged or already consumed")]
    UnknownState,
    #[error("OAuth state expired (the 15-minute window elapsed); start the flow again")]
    ExpiredState,
    #[error(
        "redirect URI is not a PKCE-safe target (loopback http://127.0.0.1|localhost, https:// origin, or a custom app scheme)"
    )]
    InvalidRedirect,
}

/// `code_verifier` + `code_challenge` pair (method `S256`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PkceChallenge {
    verifier: String,
    challenge: String,
}

impl PkceChallenge {
    /// Generates a fresh 256-bit verifier and derives its S256 challenge.
    pub fn generate() -> Result<Self, AuthError> {
        let bytes = random_bytes(32)?;
        Self::from_verifier(URL_SAFE_NO_PAD.encode(bytes))
    }

    /// Builds a challenge from a caller-supplied verifier (platforms that
    /// already hold one). The verifier is validated per RFC 7636 §4.1.
    pub fn from_verifier(verifier: String) -> Result<Self, AuthError> {
        let verifier = verifier.trim().to_string();
        let len = verifier.chars().count();
        if !(43..=128).contains(&len) {
            return Err(AuthError::InvalidVerifier);
        }
        if !verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~'))
        {
            return Err(AuthError::InvalidVerifier);
        }
        let digest = Sha256::digest(verifier.as_bytes());
        Ok(Self {
            verifier,
            challenge: URL_SAFE_NO_PAD.encode(digest),
        })
    }

    #[must_use]
    pub fn verifier(&self) -> &str {
        &self.verifier
    }

    #[must_use]
    pub fn challenge(&self) -> &str {
        &self.challenge
    }

    /// The `code_challenge_method` sent alongside the challenge.
    #[must_use]
    pub fn method(&self) -> &'static str {
        "S256"
    }
}

/// Fresh random `state` for one authorization attempt (base64url, 256-bit).
pub fn random_state() -> Result<String, AuthError> {
    Ok(URL_SAFE_NO_PAD.encode(random_bytes(32)?))
}

/// Registry of authorization attempts. Single-use is structural: [`consume`]
/// removes the entry before any check, so a replayed callback can never pass
/// twice, and a consumed-then-retried state reads as unknown.
#[derive(Debug, Default, Clone)]
pub struct PendingStates {
    issued: HashMap<String, i64>,
}

impl PendingStates {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a fresh state issued at `now_ms`; returns it.
    pub fn issue(&mut self, now_ms: i64) -> Result<String, AuthError> {
        self.prune(now_ms);
        let state = random_state()?;
        self.issued.insert(state.clone(), now_ms);
        Ok(state)
    }

    /// Consumes `state` exactly once. Unknown/replayed →
    /// [`AuthError::UnknownState`]; older than 15 minutes (even on first use)
    /// → [`AuthError::ExpiredState`].
    pub fn consume(&mut self, state: &str, now_ms: i64) -> Result<(), AuthError> {
        let Some(issued_at) = self.issued.remove(state) else {
            return Err(AuthError::UnknownState);
        };
        if now_ms.saturating_sub(issued_at) > STATE_TTL_MS {
            return Err(AuthError::ExpiredState);
        }
        Ok(())
    }

    /// Open attempts (honest diagnostics for settings surfaces).
    #[must_use]
    pub fn pending_count(&self) -> usize {
        self.issued.len()
    }

    fn prune(&mut self, now_ms: i64) {
        self.issued
            .retain(|_, issued_at| now_ms.saturating_sub(*issued_at) <= STATE_TTL_MS);
    }
}

fn random_bytes(n: usize) -> Result<Vec<u8>, AuthError> {
    let mut buf = vec![0u8; n];
    getrandom::getrandom(&mut buf).map_err(|e| AuthError::Randomness(e.to_string()))?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    #[test]
    fn challenge_matches_rfc7636_appendix_b_vector() {
        // https://datatracker.ietf.org/doc/html/rfc7636#appendix-B
        let challenge =
            PkceChallenge::from_verifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".to_string())
                .unwrap();
        assert_eq!(challenge.method(), "S256");
        assert_eq!(
            challenge.challenge(),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn generated_verifier_is_valid_and_pairs_with_challenge() {
        let challenge = PkceChallenge::generate().unwrap();
        assert_eq!(challenge.verifier().chars().count(), 43);
        // Re-deriving from the verifier reproduces the same challenge.
        let rebuilt = PkceChallenge::from_verifier(challenge.verifier().to_string()).unwrap();
        assert_eq!(rebuilt.challenge(), challenge.challenge());
    }

    #[test]
    fn verifier_validation_rejects_short_and_foreign_charset() {
        assert_eq!(
            PkceChallenge::from_verifier("too-short".to_string()),
            Err(AuthError::InvalidVerifier)
        );
        assert_eq!(
            PkceChallenge::from_verifier(format!("{}+", "a".repeat(43))),
            Err(AuthError::InvalidVerifier)
        );
        assert_eq!(
            PkceChallenge::from_verifier("a".repeat(129)),
            Err(AuthError::InvalidVerifier)
        );
        // Boundary lengths are accepted.
        assert!(PkceChallenge::from_verifier("a".repeat(43)).is_ok());
        assert!(PkceChallenge::from_verifier("a".repeat(128)).is_ok());
    }

    #[test]
    fn state_is_consumed_exactly_once() {
        let mut states = PendingStates::new();
        let state = states.issue(1_000).unwrap();
        assert_eq!(states.pending_count(), 1);
        assert!(states.consume(&state, 2_000).is_ok());
        assert_eq!(states.pending_count(), 0);
        // Replay of the consumed state reads as unknown, never as success.
        assert_eq!(states.consume(&state, 3_000), Err(AuthError::UnknownState));
    }

    #[test]
    fn state_expires_after_15_minutes() {
        let mut states = PendingStates::new();
        let state = states.issue(0).unwrap();
        assert_eq!(
            states.consume(&state, STATE_TTL_MS + 1),
            Err(AuthError::ExpiredState)
        );
        // A different, still-fresh state survives the same registry.
        let fresh = states.issue(1_000).unwrap();
        assert!(states.consume(&fresh, 1_000 + STATE_TTL_MS).is_ok());
    }

    #[test]
    fn unknown_state_is_rejected() {
        let mut states = PendingStates::new();
        assert_eq!(
            states.consume("forged-value", 1_000),
            Err(AuthError::UnknownState)
        );
    }

    #[test]
    fn issue_prunes_expired_entries() {
        let mut states = PendingStates::new();
        let _ = states.issue(0).unwrap();
        let _ = states.issue(STATE_TTL_MS + 1).unwrap();
        // The age-0 entry is pruned on the next issue (its 15-min window has
        // elapsed); the fresh one survives.
        assert_eq!(states.pending_count(), 1);
    }
}
