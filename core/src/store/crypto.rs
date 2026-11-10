//! Key-management scaffolding, DB format detection, and non-destructive
//! backup migration for SQLite at rest (`AGENTS.md` §3.2, `05` §5.3).
//!
//! Security shape:
//! - 256-bit symmetric encryption key (`DbEncryptionKey`) held in memory and
//!   zeroized on drop.
//! - The key is sourced from the platform's secure credential storage
//!   (OS keyring on desktop, EncryptedSharedPreferences on Android).
//! - Secrets NEVER enter SQLite tables, log messages, or user-facing strings
//!   (`AGENTS.md` §3.2, §8). `Debug` on `DbEncryptionKey` always prints
//!   `"[REDACTED_DB_KEY]"`.
//! - Non-destructive migration doctrine: existing unencrypted user databases
//!   are safely backed up to `<name>.unencrypted.bak` before keyed access
//!   so user academic records (courses, grades, schedules) are never lost.

use std::fmt;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use super::db::StoreError;

/// SQLite standard header prefix: "SQLite format 3\0" (16 bytes).
pub const SQLITE_MAGIC_HEADER: &[u8; 16] = b"SQLite format 3\0";

/// Magic header for QuizRadar encrypted database envelope format.
pub const ENCRYPTED_ENVELOPE_MAGIC: &[u8; 16] = b"QRDB_ENC_V1\0\0\0\0\0";

/// 256-bit symmetric key for database encryption at rest.
#[derive(Clone, PartialEq, Eq)]
pub struct DbEncryptionKey {
    bytes: [u8; 32],
}

impl DbEncryptionKey {
    /// Creates a key from raw 32 bytes.
    #[must_use]
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self { bytes }
    }

    /// Parses a 64-character hexadecimal string into a 256-bit key.
    pub fn from_hex(hex: &str) -> Result<Self, StoreError> {
        let trimmed = hex.trim();
        if trimmed.len() != 64 {
            return Err(StoreError::Validation(format!(
                "invalid DB key length: expected 64 hex characters (32 bytes), got {}",
                trimmed.len()
            )));
        }
        let mut bytes = [0u8; 32];
        for (i, byte) in bytes.iter_mut().enumerate() {
            let start = i * 2;
            let pair = &trimmed[start..start + 2];
            *byte = u8::from_str_radix(pair, 16).map_err(|_| {
                StoreError::Validation("invalid hex digit in DB encryption key".to_string())
            })?;
        }
        Ok(Self { bytes })
    }

    /// Generates a fresh 256-bit key using cryptographically secure OS entropy.
    pub fn generate() -> Result<Self, StoreError> {
        let mut bytes = [0u8; 32];
        getrandom::getrandom(&mut bytes).map_err(|e| {
            StoreError::Validation(format!("failed to generate random entropy for DB key: {e}"))
        })?;
        Ok(Self { bytes })
    }

    /// Key byte slice.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.bytes
    }

    /// Formats the key as a 64-character lowercase hex string.
    #[must_use]
    pub fn to_hex(&self) -> String {
        self.bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}

impl Drop for DbEncryptionKey {
    fn drop(&mut self) {
        // Securely scrub key bytes from memory on drop
        for b in &mut self.bytes {
            *b = 0;
        }
    }
}

impl fmt::Debug for DbEncryptionKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Redact secret key material so it never touches logs or formatted dumps
        f.write_str("[REDACTED_DB_KEY]")
    }
}

/// Detected database file format on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DbFileFormat {
    /// File does not exist or is 0 bytes (brand-new DB).
    NewOrEmpty,
    /// Standard unencrypted SQLite file starting with `SQLite format 3\0`.
    PlaintextSqlite,
    /// QuizRadar encrypted envelope starting with `QRDB_ENC_V1\0\0\0\0\0`.
    EncryptedEnvelope,
    /// Unrecognized file header.
    Unknown,
}

/// Detects the format of a database file by inspecting its header bytes.
pub fn detect_db_format(path: &Path) -> Result<DbFileFormat, StoreError> {
    if !path.exists() {
        return Ok(DbFileFormat::NewOrEmpty);
    }
    let metadata = std::fs::metadata(path)
        .map_err(|e| StoreError::Validation(format!("failed to stat db at {}: {e}", path.display())))?;
    if metadata.len() == 0 {
        return Ok(DbFileFormat::NewOrEmpty);
    }

    let mut file = File::open(path)
        .map_err(|e| StoreError::Validation(format!("failed to open db at {}: {e}", path.display())))?;
    let mut header = [0u8; 16];
    let bytes_read = file
        .read(&mut header)
        .map_err(|e| StoreError::Validation(format!("failed to read db header at {}: {e}", path.display())))?;

    if bytes_read < 16 {
        return Ok(DbFileFormat::Unknown);
    }

    if &header == SQLITE_MAGIC_HEADER {
        Ok(DbFileFormat::PlaintextSqlite)
    } else if &header == ENCRYPTED_ENVELOPE_MAGIC {
        Ok(DbFileFormat::EncryptedEnvelope)
    } else {
        Ok(DbFileFormat::Unknown)
    }
}

/// Non-destructive migration safety: if the database file at `path` is an
/// unencrypted SQLite database, backs it up to `<path>.unencrypted.bak`
/// before keyed access or migration.
///
/// Does not overwrite an existing backup copy, ensuring original user data
/// is permanently preserved.
pub fn backup_unencrypted_if_present(path: &Path) -> Result<Option<PathBuf>, StoreError> {
    let format = detect_db_format(path)?;
    if format != DbFileFormat::PlaintextSqlite {
        return Ok(None);
    }

    let backup_path = path.with_extension("db.unencrypted.bak");
    if backup_path.exists() {
        // Backup already preserved from a prior run; keep it non-destructively
        return Ok(Some(backup_path));
    }

    std::fs::copy(path, &backup_path).map_err(|e| {
        StoreError::Validation(format!(
            "failed to create non-destructive backup at {}: {e}",
            backup_path.display()
        ))
    })?;

    Ok(Some(backup_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_from_hex_valid() {
        let hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let key = DbEncryptionKey::from_hex(hex).expect("valid hex key");
        assert_eq!(key.to_hex(), hex);
        assert_eq!(key.as_bytes()[0], 0x01);
        assert_eq!(key.as_bytes()[15], 0xef);
    }

    #[test]
    fn test_key_from_hex_invalid_length() {
        let err = DbEncryptionKey::from_hex("abcd").unwrap_err();
        assert!(matches!(err, StoreError::Validation(_)));
    }

    #[test]
    fn test_key_from_hex_invalid_chars() {
        let hex = "zz23456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let err = DbEncryptionKey::from_hex(hex).unwrap_err();
        assert!(matches!(err, StoreError::Validation(_)));
    }

    #[test]
    fn test_key_debug_redacted() {
        let key = DbEncryptionKey::generate().expect("generate key");
        let debug = format!("{key:?}");
        assert_eq!(debug, "[REDACTED_DB_KEY]");
        assert!(!debug.contains(&key.to_hex()));
    }

    #[test]
    fn test_detect_format_new_and_unencrypted() {
        let tmp = std::env::temp_dir().join(format!("qr_crypto_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);

        let nonexistent = tmp.join("does_not_exist.db");
        assert_eq!(
            detect_db_format(&nonexistent).unwrap(),
            DbFileFormat::NewOrEmpty
        );

        let empty = tmp.join("empty.db");
        std::fs::write(&empty, b"").expect("write empty");
        assert_eq!(detect_db_format(&empty).unwrap(), DbFileFormat::NewOrEmpty);

        let sqlite_file = tmp.join("test_sqlite.db");
        let mut content = Vec::from(*SQLITE_MAGIC_HEADER);
        content.extend_from_slice(&[0u8; 100]);
        std::fs::write(&sqlite_file, content).expect("write sqlite");
        assert_eq!(
            detect_db_format(&sqlite_file).unwrap(),
            DbFileFormat::PlaintextSqlite
        );

        let backup = backup_unencrypted_if_present(&sqlite_file).expect("backup succeeds");
        assert!(backup.is_some());
        let backup_path = backup.unwrap();
        assert!(backup_path.exists());
        assert_eq!(
            std::fs::read(&sqlite_file).unwrap(),
            std::fs::read(&backup_path).unwrap()
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
