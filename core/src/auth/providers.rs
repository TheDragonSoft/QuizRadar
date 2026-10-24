//! Declarative OAuth scope registry + PKCE URL builders (Google, Microsoft).
//!
//! Single source of truth for every scope the app can request (`03` §B5):
//! source fetchers never hardcode scope strings — the registry here is what
//! the authorization URLs are built from, which structurally fixes v4's
//! never-requested `classroom.*` scope bug.
//!
//! PKCE-only public clients (`AGENTS.md` §3.2): **no `client_secret` field,
//! parameter or function exists in this crate** — the exchange request
//! builders below cannot express one, and tests assert that.

use crate::auth::pkce::AuthError;

// ---------------------------------------------------------------------------
// Endpoints (02 §5.1/§5.3)
// ---------------------------------------------------------------------------

pub const GOOGLE_AUTHORIZE_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
pub const MICROSOFT_AUTHORIZE_URL: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
pub const MICROSOFT_TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

// ---------------------------------------------------------------------------
// Capability → scopes (the registry)
// ---------------------------------------------------------------------------

/// Google capabilities, each mapped to its exact scope list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoogleCapability {
    /// Gmail announcement scanning (the radar's five queries).
    GmailRead,
    /// "Signed in as …" profile anchors (name/email only; never tokens).
    UserProfile,
    /// Google Calendar push (phase 06).
    CalendarEvents,
    /// Drive appDataFolder data-only backup (phase 04 client).
    DriveAppdata,
    /// Classroom courses + courseWork reads. v4 shipped this feature with no
    /// scopes requested at all; v5 requests both read scopes here.
    ClassroomRead,
}

impl GoogleCapability {
    #[must_use]
    pub fn scopes(self) -> &'static [&'static str] {
        match self {
            Self::GmailRead => &["https://www.googleapis.com/auth/gmail.readonly"],
            Self::UserProfile => &[
                "https://www.googleapis.com/auth/userinfo.email",
                "https://www.googleapis.com/auth/userinfo.profile",
            ],
            Self::CalendarEvents => &["https://www.googleapis.com/auth/calendar.events"],
            Self::DriveAppdata => &["https://www.googleapis.com/auth/drive.appdata"],
            Self::ClassroomRead => &[
                "https://www.googleapis.com/auth/classroom.courses.readonly",
                "https://www.googleapis.com/auth/classroom.coursework.students",
            ],
        }
    }
}

/// Microsoft (Graph) capabilities; v4 parity scope set (`02` §5.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MicrosoftCapability {
    /// Refresh-token grant (required for silent renewal; token never leaves
    /// the device).
    OfflineAccess,
    /// `/me` profile anchors.
    UserProfile,
    /// Outlook mail reads (mail-source scanning).
    MailRead,
    /// Calendar reads.
    CalendarsRead,
}

impl MicrosoftCapability {
    #[must_use]
    pub fn scopes(self) -> &'static [&'static str] {
        match self {
            Self::OfflineAccess => &["offline_access"],
            Self::UserProfile => &["User.Read"],
            Self::MailRead => &["Mail.Read"],
            Self::CalendarsRead => &["Calendars.Read"],
        }
    }
}

/// One capability as handed to the platform's [`crate::sources::TokenProvider`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderCapability {
    Google(GoogleCapability),
    Microsoft(MicrosoftCapability),
}

impl From<GoogleCapability> for ProviderCapability {
    fn from(capability: GoogleCapability) -> Self {
        Self::Google(capability)
    }
}

impl From<MicrosoftCapability> for ProviderCapability {
    fn from(capability: MicrosoftCapability) -> Self {
        Self::Microsoft(capability)
    }
}

/// Union of scopes over several capabilities, first-occurrence order, deduped.
#[must_use]
pub fn google_union_scopes(capabilities: &[GoogleCapability]) -> Vec<&'static str> {
    union_scopes(capabilities.iter().map(|c| c.scopes()))
}

/// Union of Microsoft scopes over several capabilities (deduped, in order).
#[must_use]
pub fn microsoft_union_scopes(capabilities: &[MicrosoftCapability]) -> Vec<&'static str> {
    union_scopes(capabilities.iter().map(|c| c.scopes()))
}

fn union_scopes<'a, I: IntoIterator<Item = &'a [&'static str]>>(lists: I) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for scopes in lists {
        for scope in scopes {
            if !out.contains(scope) {
                out.push(scope);
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Redirect targets (loopback / custom scheme / web origin — 04 §4.3)
// ---------------------------------------------------------------------------

/// Shape of the redirect URI a platform may legally use with PKCE.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RedirectTarget {
    /// `http://127.0.0.1:<port>` or `http://localhost:<port>` (desktop).
    Loopback,
    /// `https://<origin>` (PWA/web).
    WebOrigin,
    /// Any non-http(s) custom scheme (`com.googleusercontent.apps.…:/oauthredirect`,
    /// `msauth.com.quizradar.app://auth`) — Android, RFC 8252.
    CustomScheme,
}

impl RedirectTarget {
    /// Classifies a redirect URI; `Err` for plaintext-HTTP non-loopback and
    /// other unusable shapes (the token would leave the device insecurely).
    pub fn classify(redirect_uri: &str) -> Result<Self, AuthError> {
        let trimmed = redirect_uri.trim();
        let lowered = trimmed.to_ascii_lowercase();
        if let Some(rest) = lowered.strip_prefix("http://") {
            let host = rest.split(['/', ':', '?']).next().unwrap_or("");
            if host == "127.0.0.1" || host == "localhost" {
                return Ok(Self::Loopback);
            }
            return Err(AuthError::InvalidRedirect);
        }
        if lowered.starts_with("https://") {
            return Ok(Self::WebOrigin);
        }
        // Custom scheme: `scheme:` or `scheme://…` with no http(s) prefix and
        // at least one letter before the colon.
        if let Some((scheme, _)) = trimmed.split_once(':') {
            if !scheme.is_empty()
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))
                && scheme
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic())
            {
                return Ok(Self::CustomScheme);
            }
        }
        Err(AuthError::InvalidRedirect)
    }
}

// ---------------------------------------------------------------------------
// URL / request builders (PKCE, zero secrets)
// ---------------------------------------------------------------------------

/// Inputs for an authorization URL. The challenge + state come from
/// [`crate::auth::pkce`] (generated, registered single-use).
pub struct AuthorizeRequest<'a> {
    pub client_id: &'a str,
    pub redirect_uri: &'a str,
    pub scopes: &'a [&'a str],
    pub state: &'a str,
    pub code_challenge: &'a str,
}

/// Google authorization URL (PKCE, no secret, no consent over-reach).
pub fn google_authorize_url(request: &AuthorizeRequest<'_>) -> Result<String, AuthError> {
    RedirectTarget::classify(request.redirect_uri)?;
    Ok(format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        GOOGLE_AUTHORIZE_URL,
        percent_encode(request.client_id),
        percent_encode(request.redirect_uri),
        percent_encode(&request.scopes.join(" ")),
        percent_encode(request.state),
        percent_encode(request.code_challenge),
    ))
}

/// Microsoft authorization URL (v2 endpoint, `prompt=select_account` parity
/// so the user explicitly picks the university account).
pub fn microsoft_authorize_url(request: &AuthorizeRequest<'_>) -> Result<String, AuthError> {
    RedirectTarget::classify(request.redirect_uri)?;
    Ok(format!(
        "{}?client_id={}&response_type=code&redirect_uri={}&response_mode=query&scope={}&state={}&code_challenge={}&code_challenge_method=S256&prompt=select_account",
        MICROSOFT_AUTHORIZE_URL,
        percent_encode(request.client_id),
        percent_encode(request.redirect_uri),
        percent_encode(&request.scopes.join(" ")),
        percent_encode(request.state),
        percent_encode(request.code_challenge),
    ))
}

/// Inputs for the authorization-code exchange (PKCE public client).
pub struct TokenExchangeRequest<'a> {
    pub client_id: &'a str,
    pub code: &'a str,
    pub redirect_uri: &'a str,
    pub code_verifier: &'a str,
}

/// Form body for the Google token exchange — structurally secret-free.
pub fn google_token_exchange_params(
    request: &TokenExchangeRequest<'_>,
) -> Vec<(&'static str, String)> {
    vec![
        ("client_id", request.client_id.to_string()),
        ("grant_type", "authorization_code".to_string()),
        ("code", request.code.to_string()),
        ("redirect_uri", request.redirect_uri.to_string()),
        ("code_verifier", request.code_verifier.to_string()),
    ]
}

/// Form body for the Microsoft token exchange — structurally secret-free.
pub fn microsoft_token_exchange_params(
    request: &TokenExchangeRequest<'_>,
) -> Vec<(&'static str, String)> {
    google_token_exchange_params(request)
}

/// Form body for a refresh-token grant (scopes repeated; still PKCE-class
/// public client, no secret).
pub fn refresh_token_params(
    client_id: &str,
    refresh_token: &str,
    scopes: &[&str],
) -> Vec<(&'static str, String)> {
    vec![
        ("client_id", client_id.to_string()),
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", refresh_token.to_string()),
        ("scope", scopes.join(" ")),
    ]
}

/// Minimal RFC 3986 percent-encoding for query values (unreserved set kept
/// literal). Avoids a regex/urlencoding dependency in the core.
#[must_use]
pub fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::auth::pkce::PendingStates;

    #[test]
    fn classroom_scopes_are_present_in_the_built_google_url() {
        // The structural fix for 03 §B5: building an authorize URL from the
        // Classroom capability must include BOTH read scopes.
        let url = google_authorize_url(&AuthorizeRequest {
            client_id: "test-client",
            redirect_uri: "http://127.0.0.1:49152/callback",
            scopes: &google_union_scopes(&[
                GoogleCapability::GmailRead,
                GoogleCapability::UserProfile,
                GoogleCapability::ClassroomRead,
            ]),
            state: "s3tate-value_",
            code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        })
        .unwrap();
        assert!(url.starts_with(GOOGLE_AUTHORIZE_URL));
        assert!(url.contains("scope="));
        assert!(url.contains("classroom.courses.readonly"));
        assert!(url.contains("classroom.coursework.students"));
        assert!(url.contains("gmail.readonly"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=s3tate-value_"));
        assert!(!url.contains("client_secret"));
    }

    #[test]
    fn microsoft_url_carries_the_v4_parity_scope_set() {
        let scopes = microsoft_union_scopes(&[
            MicrosoftCapability::OfflineAccess,
            MicrosoftCapability::UserProfile,
            MicrosoftCapability::MailRead,
            MicrosoftCapability::CalendarsRead,
        ]);
        let url = microsoft_authorize_url(&AuthorizeRequest {
            client_id: "14d82eec-204b-4c2f-b7e8-296a70dab67e",
            redirect_uri: "msauth.com.quizradar.app://auth",
            scopes: &scopes,
            state: "abc123",
            code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        })
        .unwrap();
        assert!(url.starts_with(MICROSOFT_AUTHORIZE_URL));
        assert!(url.contains("offline_access"));
        assert!(url.contains("User.Read"));
        assert!(url.contains("Mail.Read"));
        assert!(url.contains("Calendars.Read"));
        assert!(url.contains("prompt=select_account"));
        assert!(!url.contains("client_secret"));
    }

    #[test]
    fn exchange_and_refresh_params_cannot_express_a_secret() {
        let verifier = "a".repeat(43);
        let params = google_token_exchange_params(&TokenExchangeRequest {
            client_id: "cid",
            code: "auth-code",
            redirect_uri: "http://127.0.0.1:9/callback",
            code_verifier: &verifier,
        });
        assert!(params.iter().all(|(k, _)| *k != "client_secret"));
        assert!(params
            .iter()
            .any(|(k, v)| *k == "code_verifier" && v.len() == 43));

        let refresh = refresh_token_params(
            "cid",
            "refresh-token",
            microsoft_union_scopes(&[MicrosoftCapability::OfflineAccess]).as_slice(),
        );
        assert!(refresh.iter().all(|(k, _)| *k != "client_secret"));
        assert!(refresh.iter().any(|(k, _)| *k == "refresh_token"));
    }

    #[test]
    fn redirect_classification_accepts_platform_shapes_and_refuses_plaintext() {
        assert_eq!(
            RedirectTarget::classify("http://127.0.0.1:49152/callback"),
            Ok(RedirectTarget::Loopback)
        );
        assert_eq!(
            RedirectTarget::classify("http://localhost:3000/api/auth/callback"),
            Ok(RedirectTarget::Loopback)
        );
        assert_eq!(
            RedirectTarget::classify("https://pwa.quizradar.app/oauth"),
            Ok(RedirectTarget::WebOrigin)
        );
        assert_eq!(
            RedirectTarget::classify("com.googleusercontent.apps.123:/oauthredirect"),
            Ok(RedirectTarget::CustomScheme)
        );
        assert_eq!(
            RedirectTarget::classify("msauth.com.quizradar.app://auth"),
            Ok(RedirectTarget::CustomScheme)
        );
        // Plaintext HTTP off-loopback would leak authorization codes; junk
        // shapes are refused. Other schemes pass through as CustomScheme —
        // the platform must only ever pass its own registered scheme.
        assert!(RedirectTarget::classify("http://192.168.1.5/callback").is_err());
        assert!(RedirectTarget::classify("").is_err());
        assert!(RedirectTarget::classify("no-scheme-here").is_err());
    }

    #[test]
    fn google_url_refuses_insecure_redirect() {
        assert!(google_authorize_url(&AuthorizeRequest {
            client_id: "cid",
            redirect_uri: "http://insecure.example/callback",
            scopes: &[],
            state: "s",
            code_challenge: "c",
        })
        .is_err());
    }

    #[test]
    fn url_building_with_single_use_state_round_trips() {
        // The full handoff: registry-issued state + PKCE challenge land in the
        // URL; the callback consumes the state exactly once (15-min window).
        let mut states = PendingStates::new();
        let state = states.issue(1_000).unwrap();
        let challenge = crate::auth::pkce::PkceChallenge::generate().unwrap();
        let url = google_authorize_url(&AuthorizeRequest {
            client_id: "cid",
            redirect_uri: "http://127.0.0.1:8765/callback",
            scopes: &google_union_scopes(&[GoogleCapability::CalendarEvents]),
            state: &state,
            code_challenge: challenge.challenge(),
        })
        .unwrap();
        assert!(url.contains(&format!("state={state}")));
        assert!(url.contains(&format!(
            "code_challenge={}",
            percent_encode(challenge.challenge())
        )));
        assert!(states.consume(&state, 1_000 + 60_000).is_ok());
        assert_eq!(
            states.consume(&state, 1_000 + 60_000),
            Err(crate::auth::pkce::AuthError::UnknownState)
        );
    }

    #[test]
    fn percent_encode_keeps_unreserved_and_escapes_the_rest() {
        assert_eq!(percent_encode("aB3-._~"), "aB3-._~");
        assert_eq!(percent_encode("quiz exam"), "quiz%20exam");
        assert_eq!(percent_encode("a&b=c"), "a%26b%3Dc");
        assert_eq!(percent_encode("héllo"), "h%C3%A9llo");
        assert_eq!(percent_encode(""), "");
    }
}
