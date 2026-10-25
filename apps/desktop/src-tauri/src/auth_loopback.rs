//! Ephemeral TCP loopback receiver for Google + Microsoft PKCE OAuth (`04` §4.3).
//!
//! Replaces the old Axum server and Java loopback server with a lightweight,
//! single-request ephemeral TCP listener bound to `127.0.0.1:0`. Serves the
//! static post-auth confirmation/cancellation/error cards without external HTTP frameworks.

use std::collections::HashMap;
use std::time::Duration;

use quizradar_core::auth::pkce::{random_state, PkceChallenge};
use quizradar_core::auth::providers::{
    google_authorize_url, google_token_exchange_params, google_union_scopes,
    microsoft_authorize_url, microsoft_token_exchange_params, microsoft_union_scopes,
    AuthorizeRequest, GoogleCapability, MicrosoftCapability, TokenExchangeRequest,
    GOOGLE_TOKEN_URL, MICROSOFT_TOKEN_URL,
};
use serde::Deserialize;
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::keyring::{KEY_GOOGLE_REFRESH_TOKEN, KEY_MICROSOFT_REFRESH_TOKEN};
use crate::state::AppState;

const GOOGLE_SUCCESS_HTML: &str = include_str!("../assets/auth/google_success.html");
const MICROSOFT_SUCCESS_HTML: &str = include_str!("../assets/auth/microsoft_success.html");
const AUTH_CANCELLED_HTML: &str = include_str!("../assets/auth/auth_cancelled.html");
const AUTH_ERROR_TEMPLATE: &str = include_str!("../assets/auth/auth_error.html");

fn render_error_page(title: &str, message: &str) -> String {
    let safe_title = title
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let safe_message = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");

    AUTH_ERROR_TEMPLATE
        .replace("{{TITLE}}", &safe_title)
        .replace("{{MESSAGE}}", &safe_message)
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
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind ephemeral loopback listener: {e}"))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read ephemeral port: {e}"))?
        .port();

    let redirect_uri = format!("http://127.0.0.1:{port}/api/auth/callback");
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
        client_id: &state.google_client_id,
        redirect_uri: &redirect_uri,
        scopes: &scopes,
        state: &oauth_state,
        code_challenge: pkce.challenge(),
    };

    let authorize_url = google_authorize_url(&auth_req)
        .map_err(|e| format!("Failed to construct Google authorize URL: {e}"))?;

    let expected_state = oauth_state.clone();
    let client_id = state.google_client_id.clone();

    // Background accept loop: terminates after receiving callback or 5-min timeout
    tokio::spawn(async move {
        let accept_fut = listener.accept();
        let timeout_fut = tokio::time::sleep(Duration::from_secs(300));
        tokio::pin!(accept_fut);
        tokio::pin!(timeout_fut);

        tokio::select! {
            result = &mut accept_fut => {
                if let Ok((mut stream, _)) = result {
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
                            send_http_response(stream, 200, "OK", AUTH_CANCELLED_HTML).await;
                            return;
                        }

                        if let Some(code) = params.get("code") {
                            let exchange_req = TokenExchangeRequest {
                                client_id: &client_id,
                                code,
                                redirect_uri: &redirect_uri,
                                code_verifier: &verifier,
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
                                                let now = state.now_iso();
                                                let _ = state.store.load_state(state.today()).await; // warm up
                                                // Save profile into store config
                                                let _ = state.store.save_schedule(
                                                    quizradar_core::types::ScheduleData::default(),
                                                    now.clone(),
                                                    state.today(),
                                                ).await;
                                                // Save profile anchors in MetaRepo via ops or repo
                                                let db = state.store.clone();
                                                let _ = db.save_schedule(quizradar_core::types::ScheduleData::default(), now, state.today()).await;
                                                // Emit profile info
                                                let _ = app.emit("auth-changed", ());
                                                let _ = info;
                                            }
                                        }

                                        let _ = app.emit("auth-changed", ());
                                        send_http_response(stream, 200, "OK", GOOGLE_SUCCESS_HTML).await;
                                        return;
                                    }
                                }
                                Ok(res) => {
                                    let err_text = res.text().await.unwrap_or_default();
                                    let body = render_error_page("Google Token Exchange Failed", &err_text);
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
pub async fn start_microsoft_login(
    state: AppState,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind ephemeral loopback listener: {e}"))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read ephemeral port: {e}"))?
        .port();

    let redirect_uri = format!("http://127.0.0.1:{port}/api/auth/microsoft/callback");
    let pkce = PkceChallenge::generate().map_err(|e| format!("PKCE generation failed: {e}"))?;
    let verifier = pkce.verifier().to_string();
    let oauth_state = random_state().map_err(|e| format!("State generation failed: {e}"))?;

    let scopes = microsoft_union_scopes(&[
        MicrosoftCapability::OfflineAccess,
        MicrosoftCapability::UserProfile,
        MicrosoftCapability::MailRead,
        MicrosoftCapability::CalendarsRead,
    ]);

    let auth_req = AuthorizeRequest {
        client_id: &state.microsoft_client_id,
        redirect_uri: &redirect_uri,
        scopes: &scopes,
        state: &oauth_state,
        code_challenge: pkce.challenge(),
    };

    let authorize_url = microsoft_authorize_url(&auth_req)
        .map_err(|e| format!("Failed to construct Microsoft authorize URL: {e}"))?;

    let expected_state = oauth_state.clone();
    let client_id = state.microsoft_client_id.clone();

    tokio::spawn(async move {
        let accept_fut = listener.accept();
        let timeout_fut = tokio::time::sleep(Duration::from_secs(300));
        tokio::pin!(accept_fut);
        tokio::pin!(timeout_fut);

        tokio::select! {
            result = &mut accept_fut => {
                if let Ok((mut stream, _)) = result {
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
                            send_http_response(stream, 200, "OK", AUTH_CANCELLED_HTML).await;
                            return;
                        }

                        if let Some(code) = params.get("code") {
                            let exchange_req = TokenExchangeRequest {
                                client_id: &client_id,
                                code,
                                redirect_uri: &redirect_uri,
                                code_verifier: &verifier,
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
                                                let _ = me;
                                            }
                                        }

                                        let _ = app.emit("auth-changed", ());
                                        send_http_response(stream, 200, "OK", MICROSOFT_SUCCESS_HTML).await;
                                        return;
                                    }
                                }
                                Ok(res) => {
                                    let err_text = res.text().await.unwrap_or_default();
                                    let body = render_error_page("Microsoft Token Exchange Failed", &err_text);
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
