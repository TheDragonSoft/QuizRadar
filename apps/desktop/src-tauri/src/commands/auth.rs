//! Authentication and Keyring commands (`02` §4 table, `04` §4.3).
//!
//! Handles PKCE Google & Microsoft sign-in kickoff, logout token wipes from the
//! OS keyring, and direct keyring secrets access (refresh tokens, Gemini key).

use tauri::{AppHandle, Emitter, State};

use crate::auth_loopback::{start_google_login, start_microsoft_login};
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

#[tauri::command]
pub async fn microsoft_logout(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.keyring.delete_secret(KEY_MICROSOFT_REFRESH_TOKEN)?;
    *state.microsoft_token.write().await = None;
    let _ = app.emit("auth-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn logout(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.keyring.delete_secret(KEY_GOOGLE_REFRESH_TOKEN);
    let _ = state.keyring.delete_secret(KEY_MICROSOFT_REFRESH_TOKEN);
    state.clear_memory_tokens().await;
    let _ = app.emit("auth-changed", ());
    Ok(())
}

// ---------------------------------------------------------------------------
// Keyring generic commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_secret(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    state.keyring.get_secret(&key)
}

#[tauri::command]
pub async fn set_secret(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state.keyring.set_secret(&key, &value)
}

#[tauri::command]
pub async fn delete_secret(state: State<'_, AppState>, key: String) -> Result<(), String> {
    state.keyring.delete_secret(&key)
}
