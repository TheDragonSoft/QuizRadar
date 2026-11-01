//! Authentication and Keyring commands (`02` §4 table, `04` §4.3).
//!
//! Handles PKCE Google & Microsoft sign-in kickoff, logout token wipes from the
//! OS keyring, and direct keyring secrets access (refresh tokens, Gemini key).

use tauri::{AppHandle, Emitter, State};

use crate::auth_loopback::{
    start_google_login, start_microsoft_login, start_microsoft_scanning_consent,
};
use crate::keyring::{KEY_GOOGLE_REFRESH_TOKEN, KEY_MICROSOFT_REFRESH_TOKEN};
use crate::state::AppState;

#[tauri::command]
pub async fn google_login_start(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    start_google_login(state.inner().clone(), app).await
}

#[tauri::command]
pub async fn google_logout(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.keyring.delete_secret(KEY_GOOGLE_REFRESH_TOKEN)?;
    *state.google_token.write().await = None;
    // Wipe the account identity too — leaving user_email/name/picture in the
    // config DB kept the signed-out account's name on the top bar (and on a
    // shared machine that is the next user's data).
    let _ = state
        .store
        .clear_profile_keys(vec![
            "user_email".to_string(),
            "user_name".to_string(),
            "user_picture".to_string(),
        ])
        .await;
    let _ = app.emit("auth-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn microsoft_login_start(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    start_microsoft_login(state.inner().clone(), app).await
}

/// Incremental consent for the mail + calendar scopes. Microsoft tenants that
/// restrict user consent show "Need admin approval" for those permissions;
/// this command re-runs the consent screen with the wider scope set so the
/// user can ask their administrator for exactly these permissions.
#[tauri::command]
pub async fn microsoft_scanning_consent_start(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    start_microsoft_scanning_consent(state.inner().clone(), app).await
}

#[tauri::command]
pub async fn microsoft_logout(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.keyring.delete_secret(KEY_MICROSOFT_REFRESH_TOKEN)?;
    *state.microsoft_token.write().await = None;
    let _ = state
        .store
        .clear_profile_keys(vec![
            "teams_account_name".to_string(),
            "teams_account_email".to_string(),
        ])
        .await;
    let _ = app.emit("auth-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn logout(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.keyring.delete_secret(KEY_GOOGLE_REFRESH_TOKEN);
    let _ = state.keyring.delete_secret(KEY_MICROSOFT_REFRESH_TOKEN);
    state.clear_memory_tokens().await;
    let _ = state
        .store
        .clear_profile_keys(vec![
            "user_email".to_string(),
            "user_name".to_string(),
            "user_picture".to_string(),
            "teams_account_name".to_string(),
            "teams_account_email".to_string(),
        ])
        .await;
    let _ = app.emit("auth-changed", ());
    Ok(())
}

// NOTE: there are deliberately NO generic get_secret/set_secret/delete_secret
// Tauri commands. A generic keyring IPC would hand every stored secret (Google
// and Microsoft refresh tokens, the Gemini key, the client-secret override)
// to any script running in the webview — the app's whole JS surface never
// needs raw keyring access, so the surface stays closed. Secrets move only
// through named flows (google_login_start, validate_gemini_key, …).
