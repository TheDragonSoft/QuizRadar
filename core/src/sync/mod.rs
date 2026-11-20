//! Pure-Rust peer sync codec, LAN pairing URI validator, and ISO/IEC 18004 QR
//! encoder — shared verbatim across Desktop (native), Android (UniFFI), and
//! Web/PWA (WASM).
//!
//! Zero platform dependencies, zero secrets/tokens.

pub mod pair;
pub mod qr;
