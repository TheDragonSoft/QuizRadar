//! QuizRadar v5 core — one pure-Rust crate for the parsers, planner,
//! derivations, calendar outputs, SQLite store, source fetchers, PKCE auth
//! and the BYOK AI layer.
//!
//! Core purity rules (`AGENTS.md` §3, `docs/rebuild/04-rebuild-architecture.md`
//! §0): no tao/wry/tauri/Android dependencies, no DOM/HTML, no platform crates.
//! Every shell — Tauri desktop, Android via UniFFI, PWA via WASM — binds this
//! same crate and only owns thin glue (OAuth redirect mechanics, token
//! storage, event loops).
//!
//! Honesty doctrine: this crate never fabricates data — no invented rooms,
//! dates, counts, countdowns or success messages. Unknown fields stay `None`
//! and render as "—" in the UI; estimates carry an inference note.

#![cfg_attr(not(test), deny(clippy::unwrap_used))]

pub mod ai;
pub mod auth;
pub mod cal;
pub mod parse;
pub mod plan;
pub mod sources;
#[cfg(not(target_arch = "wasm32"))]
pub mod store;
pub mod types;

// The UniFFI surface is native-only: it exposes the SQLite store and the
// reqwest/tokio source fetchers, none of which exist on wasm32. The browser
// tier binds the pure modules through `core/bindings/wasm` instead.
#[cfg(all(feature = "uniffi", not(target_arch = "wasm32")))]
pub mod ffi;

#[cfg(all(feature = "uniffi", not(target_arch = "wasm32")))]
uniffi::setup_scaffolding!();

/// Crate name for shells' about/version surfaces.
pub const CRATE_NAME: &str = env!("CARGO_PKG_NAME");

/// Single version truth flows from `tooling/version.json` into the workspace
/// `Cargo.toml` (`tooling/generate-version.mjs` stamps it; CI fails when a
/// sink is stale).
pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");
