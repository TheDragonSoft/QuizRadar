//! Typed local storage (phase 04, `prompts/p04-core-store-backup.md`):
//! - `db.rs` — one SQLite schema (rusqlite, bundled) replacing the v4
//!   JSON-file sprawl; `room` stays `null`-representable everywhere
//! - `sync.rs` — additive merge rules (topics true-only, grades upsert)
//! - `backup.rs` — Drive-appDataFolder data-only backup + v4 backup importer
//!
//! Secrets never live here: OAuth tokens/keys are platform-side (OS keyring,
//! EncryptedSharedPreferences, memory-only PWA tokens).
