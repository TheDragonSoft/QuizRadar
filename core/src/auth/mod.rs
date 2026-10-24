//! PKCE OAuth for Google + Microsoft (zero client secrets anywhere;
//! `04` §4.3):
//! - `providers.rs` — single scope registry consumed by GCal/Drive/
//!   Classroom/Gmail code (structurally fixes the v4 broken `classroom.*`
//!   scope bug) + authorize/token URL builders taking a `redirect`
//!   parameter (loopback / custom scheme / web origin)
//! - `pkce.rs` — verifier/challenge + random single-use 15-min state
//!
//! Token *storage* is platform-side (desktop: OS keyring; Android:
//! EncryptedSharedPreferences; PWA: memory-only access token).

pub mod pkce;
pub mod providers;
