//! Ephemeral TCP loopback receiver for Google + Microsoft PKCE OAuth (`04` §4.3).
//!
//! Replaces the old Axum server and Java loopback server with a lightweight,
//! single-request ephemeral TCP listener bound to `127.0.0.1:0`. Serves the
//! static post-auth confirmation/cancellation/error cards without external HTTP frameworks.

use std::collections::HashMap;
use std::time::Duration;

use quizradar_core::auth::pkce::{random_state, PkceChallenge};
use quizradar_core::auth::providers::{
    explain_oauth_error, google_authorize_url, google_token_exchange_params, google_union_scopes,
    microsoft_authorize_url_with_prompt, microsoft_token_exchange_params, microsoft_union_scopes,
    AuthorizeRequest, GoogleCapability, MicrosoftCapability, OAuthProvider, TokenExchangeRequest,
    GOOGLE_TOKEN_URL, MICROSOFT_TOKEN_URL,
};
use serde::Deserialize;
use tauri::{Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::keyring::{KEY_GOOGLE_REFRESH_TOKEN, KEY_MICROSOFT_REFRESH_TOKEN};
use crate::state::AppState;

const GOOGLE_SUCCESS_HTML: &str = include_str!("../assets/auth/google_success.html");
const MICROSOFT_SUCCESS_HTML: &str = include_str!("../assets/auth/microsoft_success.html");
const AUTH_CANCELLED_HTML: &str = include_str!("../assets/auth/auth_cancelled.html");
const AUTH_ERROR_TEMPLATE: &str = include_str!("../assets/auth/auth_error.html");

fn render_error_page(title: &str, message: &str) -> String {
    let safe_title = escape_html(title);
    let safe_message = escape_html(message);

    AUTH_ERROR_TEMPLATE
        .replace("{{TITLE}}", &safe_title)
        .replace("{{MESSAGE}}", &safe_message)
}

/// Escapes the characters that would otherwise break out of the HTML card.
fn escape_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => {
                out.push('&');
                out.push_str("amp;");
            }
            '<' => {
                out.push('&');
                out.push_str("lt;");
            }
            '>' => {
                out.push('&');
                out.push_str("gt;");
            }
            '"' => {
                out.push('&');
                out.push_str("quot;");
            }
            '\'' => {
                out.push('&');
                out.push_str("#39;");
            }
            other => out.push(other),
        }
    }
    out
}

/// Brings the QuizRadar window to the front.
///
/// The OAuth round trip happens in the browser, so without this the user is
/// left staring at a browser tab while the app sits behind it. Focusing the
/// window is what makes "sign in" feel like it ended in the app.
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn parse_http_get_params(request_buffer: &[u8]) -> Option<(String, HashMap<String, String>)> {
    let req_str = std::str::from_utf8(request_buffer).ok()?;
    let first_line = req_str.lines().next()?;
    let mut parts = first_line.split_whitespace();

    if parts.next()? != "GET" {
        return None;
    }

    let uri = parts.next()?;
    let (path, query) = match uri.split_once('?') {
        Some((p, q)) => (p.to_string(), q),
        None => (uri.to_string(), ""),
    };

    let mut params = HashMap::new();
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            let key = urlencoding_decode(k);
            let val = urlencoding_decode(v);
            params.insert(key, val);
        }
    }

    Some((path, params))
}

fn urlencoding_decode(s: &str) -> String {
    let mut result = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) =
                u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16)
            {
                result.push(val);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            result.push(b' ');
            i += 1;
            continue;
        }
        result.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(result).unwrap_or_else(|_| s.to_string())
}

async fn send_http_response(
    mut stream: tokio::net::TcpStream,
    status_code: u16,
    status_text: &str,
    html_body: &str,
) {
    let response = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         Cache-Control: no-store\r\n\
         \r\n\
         {}",
        status_code,
        status_text,
        html_body.len(),
        html_body
    );

    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
}

#[derive(Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
}

/// Accepts the first callback that arrives on either loopback address.
///
/// Microsoft redirects to `http://localhost:<port>` and `localhost` may
/// resolve to `127.0.0.1` *or* `::1` depending on the machine, so both
/// loopback addresses are served when the host has IPv6. The listener stays
/// strictly on the loopback interface — no LAN exposure.
async fn accept_loopback(
    primary: &TcpListener,
    secondary: Option<&TcpListener>,
) -> std::io::Result<tokio::net::TcpStream> {
    match secondary {
        None => primary.accept().await.map(|(stream, _)| stream),
        Some(other) => {
            tokio::select! {
                result = primary.accept() => result.map(|(stream, _)| stream),
                result = other.accept() => result.map(|(stream, _)| stream),
            }
        }
    }
}

/// Binds the IPv6 loopback to the same port as an existing IPv4 listener, so
/// `http://localhost:<port>` callbacks are never dropped. Returns `None`
/// when the host has no usable IPv6 loopback.
async fn bind_ipv6_loopback(port: u16) -> Option<TcpListener> {
    TcpListener::bind(format!("[::1]:{port}")).await.ok()
}

/// Binds the **well-known** loopback port 80 (IPv4 and IPv6).
///
/// A Google "Web application" client normalizes a loopback redirect URI to
/// the default HTTP port: the browser is sent to `http://127.0.0.1` (or
/// `http://localhost`) instead of the ephemeral port the app asked for — the
/// app then sees "127.0.0.1 refused to connect". Listening on port 80 as
/// well makes that normalized callback land here. Loopback-only, so nothing
/// is exposed to the LAN.
async fn bind_well_known_loopback_port() -> (Option<TcpListener>, Option<TcpListener>) {
    let ipv4 = TcpListener::bind("127.0.0.1:80").await.ok();
    let ipv6 = TcpListener::bind("[::1]:80").await.ok();
    (ipv4, ipv6)
}

/// Accepts the first callback that arrives on any of the loopback listeners.
async fn accept_any(
    primary: &TcpListener,
    secondary: Option<&TcpListener>,
    tertiary: Option<&TcpListener>,
) -> std::io::Result<(tokio::net::TcpStream, std::net::SocketAddr)> {
    match (secondary, tertiary) {
        (None, None) => primary.accept().await,
        (Some(second), None) => {
            tokio::select! {
                result = primary.accept() => result,
                result = second.accept() => result,
            }
        }
        (None, Some(third)) => {
            tokio::select! {
                result = primary.accept() => result,
                result = third.accept() => result,
            }
        }
        (Some(second), Some(third)) => {
            tokio::select! {
                result = primary.accept() => result,
                result = second.accept() => result,
                result = third.accept() => result,
            }
        }
    }
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct GoogleUserInfo {
    email: Option<String>,
    name: Option<String>,
    picture: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct MicrosoftMeInfo {
    #[serde(alias = "displayName")]
    display_name: Option<String>,
    #[serde(alias = "mail", alias = "userPrincipalName")]
    user_principal_name: Option<String>,
}

/// Spawns the loopback listener for Google OAuth and returns the authorize URL.
pub async fn start_google_login(state: AppState, app: tauri::AppHandle) -> Result<String, String> {
    // Resolve the client id and its secret *before* binding a listener: an
    // unconfigured install must fail with an actionable message instead of
    // opening a doomed browser tab.
    let client_id = state.effective_google_client_id().await?;
    let client_secret = state.effective_google_client_secret().await;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind ephemeral loopback listener: {e}"))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read ephemeral port: {e}"))?
        .port();

    // Google's Desktop app clients register `http://127.0.0.1` (loopback, any
    // port, path ignored) — keeping the URI path-free matches that exactly.
    //
    // A Google *Web application* client (the bundled one) normalizes a loopback
    // redirect to the default HTTP port: the browser is sent to
    // `http://127.0.0.1` (port 80), not to the ephemeral port the app asked
    // for — hence "127.0.0.1 refused to connect". So the app listens on port
    // 80 as well and asks for exactly the URI the callback will use.
    let (port80_ipv4, port80_ipv6) = bind_well_known_loopback_port().await;
    let port80_ready = port80_ipv4.is_some() || port80_ipv6.is_some();
    let redirect_uri = if port80_ready {
        "http://127.0.0.1".to_string()
    } else {
        format!("http://127.0.0.1:{port}")
    };
    eprintln!(
        "[oauth] google: client_id={} redirect_uri={} ephemeral_port={} port80_ipv4={} port80_ipv6={}",
        client_id,
        redirect_uri,
        port,
        port80_ipv4.is_some(),
        port80_ipv6.is_some()
    );
    if !port80_ready {
        eprintln!(
            "[oauth] google: port 80 is not bindable — falling back to the ephemeral port; if Google redirects to http://127.0.0.1 the callback will fail until the client registers http://127.0.0.1"
        );
    }

    let pkce = PkceChallenge::generate().map_err(|e| format!("PKCE generation failed: {e}"))?;
    let verifier = pkce.verifier().to_string();
    let oauth_state = random_state().map_err(|e| format!("State generation failed: {e}"))?;

    let scopes = google_union_scopes(&[
        GoogleCapability::GmailRead,
        GoogleCapability::UserProfile,
        GoogleCapability::CalendarEvents,
        GoogleCapability::DriveAppdata,
        GoogleCapability::ClassroomRead,
    ]);

    let auth_req = AuthorizeRequest {
        client_id: &client_id,
        redirect_uri: &redirect_uri,
        scopes: &scopes,
        state: &oauth_state,
        code_challenge: pkce.challenge(),
    };

    let authorize_url = google_authorize_url(&auth_req)
        .map_err(|e| format!("Failed to construct Google authorize URL: {e}"))?;

    let expected_state = oauth_state.clone();

    // Background accept loop: terminates after receiving callback or 5-min timeout
    tokio::spawn(async move {
        let accept_fut = accept_any(&listener, port80_ipv4.as_ref(), port80_ipv6.as_ref());
        let timeout_fut = tokio::time::sleep(Duration::from_secs(300));
        tokio::pin!(accept_fut);
        tokio::pin!(timeout_fut);

        tokio::select! {
            result = &mut accept_fut => {
                if let Ok((mut stream, peer)) = result {
                    eprintln!("[oauth] google: callback accepted from {peer}");
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    if let Some((path, params)) = parse_http_get_params(&buf[..n]) {
                        eprintln!(
                            "[oauth] google: callback path={path} params={:?}",
                            params.keys().collect::<Vec<_>>()
                        );
                        let returned_state = params.get("state").map(|s| s.as_str());
                        if returned_state != Some(&expected_state) {
                            let body = render_error_page("Sign-In Error", "State mismatch or session expired.");
                            send_http_response(stream, 400, "Bad Request", &body).await;
                            return;
                        }

                        if params.contains_key("error") {
                            send_http_response(stream, 200, "OK", AUTH_CANCELLED_HTML).await;
                            return;
                        }

                        if let Some(code) = params.get("code") {
                            let exchange_req = TokenExchangeRequest {
                                client_id: &client_id,
                                code,
                                redirect_uri: &redirect_uri,
                                code_verifier: &verifier,
                                client_secret: client_secret.as_deref(),
                            };
                            let form_params = google_token_exchange_params(&exchange_req);

                            let resp = state.http_client
                                .post(GOOGLE_TOKEN_URL)
                                .form(&form_params)
                                .send()
                                .await;

                            match resp {
                                Ok(res) if res.status().is_success() => {
                                    if let Ok(tok) = res.json::<OAuthTokenResponse>().await {
                                        eprintln!("[oauth] google: token exchange succeeded");
                                        if let Some(ref_tok) = tok.refresh_token {
                                            let _ = state.keyring.set_secret(KEY_GOOGLE_REFRESH_TOKEN, &ref_tok);
                                        }
                                        let expires_in = tok.expires_in.unwrap_or(3600);
                                        state.set_google_access_token(tok.access_token.clone(), expires_in).await;

                                        // Fetch profile from Google userinfo
                                        if let Ok(userinfo_res) = state.http_client
                                            .get("https://www.googleapis.com/oauth2/v2/userinfo")
                                            .bearer_auth(&tok.access_token)
                                            .send()
                                            .await
                                        {
                                            if let Ok(info) = userinfo_res.json::<GoogleUserInfo>().await {
                                                // Persist the signed-in identity anchors so the UI
                                                // profile reflects the real account. NOTE: never call
                                                // `save_schedule` here — it REPLACES the whole timetable
                                                // (repo.rs `save_all`), i.e. a data wipe.
                                                let _ = state
                                                    .store
                                                    .set_config_string("user_email".to_string(), info.email.clone())
                                                    .await;
                                                let _ = state
                                                    .store
                                                    .set_config_string("user_name".to_string(), info.name.clone())
                                                    .await;
                                                let _ = state
                                                    .store
                                                    .set_config_string("user_picture".to_string(), info.picture.clone())
                                                    .await;
                                                // Emit profile info
                                                let _ = app.emit("auth-changed", ());
                                            }
                                        }

                                        let _ = app.emit("auth-changed", ());
                                        focus_main_window(&app);
                                        send_http_response(stream, 200, "OK", GOOGLE_SUCCESS_HTML).await;
                                        return;
                                    }
                                }
                                Ok(res) => {
                                    let err_text = res.text().await.unwrap_or_default();
                                    eprintln!(
                                        "[oauth] google: token exchange rejected: {}",
                                        err_text.chars().take(300).collect::<String>()
                                    );
                                    // The provider may expect the other loopback
                                    // shape back (port-less vs. the ephemeral
                                    // port). Retry once with the alternative
                                    // before giving up.
                                    if err_text.contains("redirect_uri_mismatch") {
                                        let alternate_uri = if redirect_uri.contains(':') && redirect_uri.rsplit(':').next().map(|p| p.chars().all(|c| c.is_ascii_digit()) && !p.is_empty()).unwrap_or(false) {
                                            "http://127.0.0.1".to_string()
                                        } else {
                                            format!("http://127.0.0.1:{port}")
                                        };
                                        eprintln!(
                                            "[oauth] google: retrying the exchange with redirect_uri={alternate_uri}"
                                        );
                                        let fallback_req = TokenExchangeRequest {
                                            client_id: &client_id,
                                            code,
                                            redirect_uri: &alternate_uri,
                                            code_verifier: &verifier,
                                            client_secret: client_secret.as_deref(),
                                        };
                                        let fallback_params =
                                            google_token_exchange_params(&fallback_req);
                                        let fallback = state
                                            .http_client
                                            .post(GOOGLE_TOKEN_URL)
                                            .form(&fallback_params)
                                            .send()
                                            .await;
                                        match fallback {
                                            Ok(res) if res.status().is_success() => {
                                                if let Ok(tok) = res.json::<OAuthTokenResponse>().await
                                                {
                                                    eprintln!(
                                                        "[oauth] google: token exchange succeeded with the port-less redirect URI"
                                                    );
                                                    if let Some(ref_tok) = tok.refresh_token {
                                                        let _ = state.keyring.set_secret(
                                                            KEY_GOOGLE_REFRESH_TOKEN,
                                                            &ref_tok,
                                                        );
                                                    }
                                                    let expires_in = tok.expires_in.unwrap_or(3600);
                                                    state
                                                        .set_google_access_token(
                                                            tok.access_token.clone(),
                                                            expires_in,
                                                        )
                                                        .await;
                                                    let _ = app.emit("auth-changed", ());
                                                    focus_main_window(&app);
                                                    send_http_response(
                                                        stream,
                                                        200,
                                                        "OK",
                                                        GOOGLE_SUCCESS_HTML,
                                                    )
                                                    .await;
                                                    return;
                                                }
                                            }
                                            Ok(res) => {
                                                let err_text = res.text().await.unwrap_or_default();
                                                let explained = explain_oauth_error(
                                                    OAuthProvider::Google,
                                                    &err_text,
                                                );
                                                let body = render_error_page(
                                                    "Google Sign-In Failed",
                                                    &explained,
                                                );
                                                send_http_response(stream, 400, "Bad Request", &body)
                                                    .await;
                                                return;
                                            }
                                            Err(err) => {
                                                let body = render_error_page(
                                                    "Network Error",
                                                    &err.to_string(),
                                                );
                                                send_http_response(
                                                    stream,
                                                    500,
                                                    "Internal Server Error",
                                                    &body,
                                                )
                                                .await;
                                                return;
                                            }
                                        }
                                    }
                                    let explained = explain_oauth_error(OAuthProvider::Google, &err_text);
                                    let body = render_error_page("Google Sign-In Failed", &explained);
                                    send_http_response(stream, 400, "Bad Request", &body).await;
                                    return;
                                }
                                Err(err) => {
                                    let body = render_error_page("Network Error", &err.to_string());
                                    send_http_response(stream, 500, "Internal Server Error", &body).await;
                                    return;
                                }
                            }
                        }
                    }
                    send_http_response(stream, 400, "Bad Request", AUTH_CANCELLED_HTML).await;
                }
            }
            _ = &mut timeout_fut => {
                // Expired without interaction, listener drops and closes port
            }
        }
    });

    Ok(authorize_url)
}

/// Spawns the loopback listener for Microsoft Teams OAuth and returns the authorize URL.
///
/// Stage 1 — sign-in. Only low user-consent-impact scopes are requested
/// (`openid profile email User.Read offline_access`), so a tenant that
/// requires administrator approval for mail/calendar access can still let the
/// user sign in and see who they are.
pub async fn start_microsoft_login(
    state: AppState,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let scopes = microsoft_union_scopes(&[
        MicrosoftCapability::SignIn,
        MicrosoftCapability::OfflineAccess,
    ]);
    start_microsoft_login_with(state, app, scopes, "select_account").await
}

/// Stage 2 — incremental consent for the sources that need administrator
/// approval (`Mail.Read`, `Calendars.Read`). Requested only when the user
/// explicitly asks to scan those sources, with `prompt=consent` so the
/// consent screen appears again for the wider scope set.
pub async fn start_microsoft_scanning_consent(
    state: AppState,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let scopes = microsoft_union_scopes(&[
        MicrosoftCapability::SignIn,
        MicrosoftCapability::OfflineAccess,
        MicrosoftCapability::MailRead,
        MicrosoftCapability::CalendarsRead,
        MicrosoftCapability::GroupRead,
        MicrosoftCapability::FilesRead,
    ]);
    start_microsoft_login_with(state, app, scopes, "consent").await
}

async fn start_microsoft_login_with(
    state: AppState,
    app: tauri::AppHandle,
    scopes: Vec<&'static str>,
    prompt: &str,
) -> Result<String, String> {
    let client_id = state.effective_microsoft_client_id().await?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind ephemeral loopback listener: {e}"))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read ephemeral port: {e}"))?
        .port();

    // Microsoft app registrations for "Mobile and desktop applications" expect
    // `http://localhost` (the port is ignored by the provider), so the
    // loopback URI has to use that exact host — `127.0.0.1` is rejected with
    // AADSTS50011.
    let redirect_uri = format!("http://localhost:{port}");
    let ipv6_listener = bind_ipv6_loopback(port).await;
    let pkce = PkceChallenge::generate().map_err(|e| format!("PKCE generation failed: {e}"))?;
    let verifier = pkce.verifier().to_string();
    let oauth_state = random_state().map_err(|e| format!("State generation failed: {e}"))?;

    let auth_req = AuthorizeRequest {
        client_id: &client_id,
        redirect_uri: &redirect_uri,
        scopes: &scopes,
        state: &oauth_state,
        code_challenge: pkce.challenge(),
    };

    let prompt = prompt.to_string();
    let authorize_url = microsoft_authorize_url_with_prompt(&auth_req, &prompt)
        .map_err(|e| format!("Failed to construct Microsoft authorize URL: {e}"))?;

    let expected_state = oauth_state.clone();

    tokio::spawn(async move {
        let accept_fut = accept_loopback(&listener, ipv6_listener.as_ref());
        let timeout_fut = tokio::time::sleep(Duration::from_secs(300));
        tokio::pin!(accept_fut);
        tokio::pin!(timeout_fut);

        tokio::select! {
            result = &mut accept_fut => {
                if let Ok(mut stream) = result {
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    if let Some((_path, params)) = parse_http_get_params(&buf[..n]) {
                        let returned_state = params.get("state").map(|s| s.as_str());
                        if returned_state != Some(&expected_state) {
                            let body = render_error_page("Sign-In Error", "State mismatch or session expired.");
                            send_http_response(stream, 400, "Bad Request", &body).await;
                            return;
                        }

                        if params.contains_key("error") {
                            let provider_error = params.get("error").map(String::as_str).unwrap_or("");
                            let description = params
                                .get("error_description")
                                .map(String::as_str)
                                .unwrap_or("");
                            if provider_error == "access_denied" {
                                // The consent screen bounced the user back —
                                // the usual cause is a tenant that requires
                                // administrator approval for these scopes.
                                let raw = format!("{provider_error} {description}");
                                let explained =
                                    explain_oauth_error(OAuthProvider::Microsoft, &raw);
                                let body =
                                    render_error_page("Microsoft Sign-In Not Approved", &explained);
                                send_http_response(stream, 400, "Bad Request", &body).await;
                                return;
                            }
                            send_http_response(stream, 200, "OK", AUTH_CANCELLED_HTML).await;
                            return;
                        }

                        if let Some(code) = params.get("code") {
                            let exchange_req = TokenExchangeRequest {
                                client_id: &client_id,
                                code,
                                redirect_uri: &redirect_uri,
                                code_verifier: &verifier,
                                // Microsoft public clients authenticate with
                                // PKCE alone — no secret.
                                client_secret: None,
                            };
                            let form_params = microsoft_token_exchange_params(&exchange_req);

                            let resp = state.http_client
                                .post(MICROSOFT_TOKEN_URL)
                                .form(&form_params)
                                .send()
                                .await;

                            match resp {
                                Ok(res) if res.status().is_success() => {
                                    if let Ok(tok) = res.json::<OAuthTokenResponse>().await {
                                        if let Some(ref_tok) = tok.refresh_token {
                                            let _ = state.keyring.set_secret(KEY_MICROSOFT_REFRESH_TOKEN, &ref_tok);
                                        }
                                        let expires_in = tok.expires_in.unwrap_or(3600);
                                        state.set_microsoft_access_token(tok.access_token.clone(), expires_in).await;

                                        // Fetch profile from Graph /me
                                        if let Ok(me_res) = state.http_client
                                            .get("https://graph.microsoft.com/v1.0/me")
                                            .bearer_auth(&tok.access_token)
                                            .send()
                                            .await
                                        {
                                            if let Ok(me) = me_res.json::<MicrosoftMeInfo>().await {
                                                // Persist the Teams identity anchors for the UI.
                                                let _ = state
                                                    .store
                                                    .set_config_string("teams_account_name".to_string(), me.display_name.clone())
                                                    .await;
                                                let _ = state
                                                    .store
                                                    .set_config_string("teams_account_email".to_string(), me.user_principal_name.clone())
                                                    .await;
                                            }
                                        }

                                        let _ = app.emit("auth-changed", ());
                                        focus_main_window(&app);
                                        send_http_response(stream, 200, "OK", MICROSOFT_SUCCESS_HTML).await;
                                        return;
                                    }
                                }
                                Ok(res) => {
                                    let err_text = res.text().await.unwrap_or_default();
                                    let explained =
                                        explain_oauth_error(OAuthProvider::Microsoft, &err_text);
                                    let body =
                                        render_error_page("Microsoft Sign-In Failed", &explained);
                                    send_http_response(stream, 400, "Bad Request", &body).await;
                                    return;
                                }
                                Err(err) => {
                                    let body = render_error_page("Network Error", &err.to_string());
                                    send_http_response(stream, 500, "Internal Server Error", &body).await;
                                    return;
                                }
                            }
                        }
                    }
                    send_http_response(stream, 400, "Bad Request", AUTH_CANCELLED_HTML).await;
                }
            }
            _ = &mut timeout_fut => {
                // Expired
            }
        }
    });

    Ok(authorize_url)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    #[test]
    fn the_error_card_escapes_markup_in_the_provider_message() {
        let body = render_error_page("T <b>", "a & b <script>alert(1)</script>");
        // The provider text must not be able to inject markup into the card.
        assert!(!body.contains("<script>alert(1)</script>"));
        assert!(!body.contains("T <b>"));
        // The escaped entity tails survive the round trip.
        assert!(body.contains("amp;"));
        assert!(body.contains("lt;"));
        assert!(body.contains("gt;"));
    }

    #[test]
    fn the_success_cards_offer_a_working_deep_link_back_to_the_app() {
        // The old button called window.close(), which Chrome blocks for tabs
        // the user opened - the app never came back into view.
        for card in [
            GOOGLE_SUCCESS_HTML,
            MICROSOFT_SUCCESS_HTML,
            AUTH_CANCELLED_HTML,
        ] {
            assert!(card.contains("quizradar://signed-in"), "missing deep link");
            assert!(
                !card.contains("window.close()"),
                "dead button left in place"
            );
        }
        assert!(AUTH_ERROR_TEMPLATE.contains("quizradar://signed-in"));
    }

    #[test]
    fn query_parameters_are_url_decoded() {
        let buffer = b"GET /?code=abc%2Ddef&state=xyz+123 HTTP/1.1\r\nHost: localhost\r\n\r\n";
        let (path, params) = parse_http_get_params(buffer).unwrap();
        assert_eq!(path, "/");
        assert_eq!(params.get("code").map(String::as_str), Some("abc-def"));
        assert_eq!(params.get("state").map(String::as_str), Some("xyz 123"));
    }
}
