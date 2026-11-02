//! The one local database (`04` §4.4): a single SQLite file (rusqlite,
//! bundled) that replaces v4's `5 JSON files + 2 token files + CWD roulette`
//! (`03` §A-table). This module owns only the schema, migrations and the
//! `Db` connection handle; the typed operations live in [`super::repo`].
//!
//! Honesty rules encoded here:
//! - every field v4 could leave unset is a `NULL`-able column ("—" at the
//!   display layer, never a default hall string),
//! - secrets never have a table: OAuth tokens live in the OS keyring /
//!   EncryptedSharedPreferences / memory only — `tokens_meta` records
//!   account *metadata* (name/email), never credentials (`03` §B6),
//! - `journal_mode=WAL` (item 5) so a crash mid-write can never lose the
//!   previous state the way v4's hand-rolled tmp+rename could.

use std::path::Path;

use rusqlite::Connection;

use thiserror::Error;

/// Store-layer error surface. Errors are honest strings — they may be shown
/// to the user verbatim, so they never embed tokens, paths or PII.
#[derive(Debug, Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("invalid stored data: {0}")]
    Json(#[from] serde_json::Error),
    /// Drive/HTTP transport failure (timeouts, HTTP status codes). reqwest's
    /// Display carries method + API endpoint but never request headers, so
    /// no bearer token can leak through this variant.
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    /// A caller tried to store something the store will not accept
    /// (invalid feed URL, malformed times, duplicate ids, …). The message is
    /// user-presentable; no secrets are interpolated.
    #[error("{0}")]
    Validation(String),
    #[error(
        "the local database was written by a newer QuizRadar build (schema {found} > {supported}); \
         refusing to open it half-read — install the latest build instead"
    )]
    SchemaTooNew { found: u32, supported: u32 },
}

/// The schema this build ships. Written by [`Db::apply_migrations`].
pub const SCHEMA_VERSION: u32 = 2;

pub(crate) const INITIAL_SCHEMA_SQL: &str = "
CREATE TABLE courses (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    bg TEXT,
    border TEXT
);

CREATE TABLE slots (
    id TEXT PRIMARY KEY NOT NULL,
    day TEXT NOT NULL,
    day_index INTEGER NOT NULL DEFAULT 0,
    course_id TEXT NOT NULL,
    course_name TEXT NOT NULL,
    slot_type TEXT NOT NULL,
    group_name TEXT,
    room TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    display_time TEXT,
    has_quiz INTEGER NOT NULL DEFAULT 0,
    quiz_title TEXT
);
CREATE INDEX idx_slots_course ON slots(course_id);

CREATE TABLE assessments (
    id TEXT PRIMARY KEY NOT NULL,
    course_id TEXT,
    course_name TEXT,
    title TEXT NOT NULL,
    assessment_type TEXT NOT NULL,
    date_iso TEXT,
    day_name TEXT,
    start_time TEXT,
    end_time TEXT,
    display_time TEXT,
    room TEXT,
    group_name TEXT,
    instructor TEXT,
    is_upcoming INTEGER NOT NULL DEFAULT 1,
    days_until INTEGER,
    urgency_level TEXT NOT NULL,
    priority_score INTEGER NOT NULL DEFAULT 0,
    topics TEXT NOT NULL,
    warnings TEXT NOT NULL,
    ai_inference_note TEXT,
    ai_study_plan TEXT,
    estimated_study_hours REAL,
    elearning_url TEXT,
    google_cal_url TEXT,
    gcal_synced INTEGER NOT NULL DEFAULT 0,
    gcal_event_id TEXT,
    color TEXT,
    bg TEXT,
    border TEXT,
    semester TEXT,
    email_subject TEXT,
    email_sent_date TEXT,
    source TEXT NOT NULL,
    source_icon TEXT,
    weightage_percent REAL,
    achieved_score REAL,
    max_score REAL,
    conflict_warning TEXT,
    updated_at TEXT
);
CREATE INDEX idx_assessments_date ON assessments(date_iso);

CREATE TABLE topics_done (
    key TEXT PRIMARY KEY NOT NULL,
    done INTEGER NOT NULL,
    updated_at TEXT
);

CREATE TABLE grades (
    assessment_id TEXT PRIMARY KEY NOT NULL,
    achieved_score REAL,
    max_score REAL,
    weightage_percent REAL,
    updated_at TEXT
);

CREATE TABLE events (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    course_id TEXT,
    event_type TEXT,
    date_iso TEXT,
    start_time TEXT,
    end_time TEXT,
    room TEXT,
    notes TEXT,
    color TEXT,
    updated_at TEXT
);

CREATE TABLE feeds (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT
);

-- Non-secret configuration values, each stored as JSON (typed readbacks in
-- repo::ConfigRepo). Secrets are banned here by policy: AI keys and OAuth
-- tokens belong to platform storage, never to the database.
CREATE TABLE config_kv (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
);

-- Account metadata per OAuth provider. No columns can hold a token or key —
-- enforced by this schema being the only credential-shaped table (`03` §B6).
CREATE TABLE tokens_meta (
    provider TEXT PRIMARY KEY NOT NULL,
    account_name TEXT,
    account_email TEXT,
    account_picture TEXT,
    updated_at TEXT
);

-- Generic meta key/value: schema_version marker, last_*_sync stamps, the
-- schedule dataset's updated_at for backup replace-if-newer merges.
CREATE TABLE kv_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
);
";

/// Ordered migration steps. Each entry upgrades a database *at* the previous
/// version to the recorded one; `m1_upgrades_into(m2)` semantics. Never edit
/// an applied schema — append a new `(version, sql)` step.
pub const MIGRATIONS: &[(u32, &str)] = &[
    (1, INITIAL_SCHEMA_SQL),
    // Source provenance: which scan last saw an announcement, and the scan
    // in which the source stopped reporting it (the announcement was
    // cancelled upstream). Both are nullable text; an existing database
    // simply has no provenance until the next scan reports the item.
    (
        2,
        "ALTER TABLE assessments ADD COLUMN last_seen_source_run TEXT;
         ALTER TABLE assessments ADD COLUMN retired_source_run TEXT;",
    ),
];

/// One SQLite handle. Cheap to share behind a mutex (see
/// [`super::Store`], the async facade); [`repo`] repositories borrow it.
pub struct Db {
    conn: Connection,
}

impl Db {
    /// Opens (creating if needed) the database at `path` and brings its
    /// schema to [`SCHEMA_VERSION`]. Applies migrations immediately — the
    /// store is always open-and-ready, never "migrate later".
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        let mut db = Self::initialize(Connection::open(path)?)?;
        db.apply_migrations()?;
        Ok(db)
    }

    /// In-memory database for tests and shell-embedded scratch instances.
    pub fn open_in_memory() -> Result<Self, StoreError> {
        let mut db = Self::initialize(Connection::open_in_memory()?)?;
        db.apply_migrations()?;
        Ok(db)
    }

    fn initialize(conn: Connection) -> Result<Self, StoreError> {
        // WAL keeps the previous semester intact if the process dies
        // mid-write (v4's atomic-rename anxiety, now offloaded to SQLite).
        // In-memory databases silently keep their journal mode, which is
        // fine — they never outlive a crash.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        // Traffic from two runtimes (desktop poll + Android refresh) must
        // queue instead of erroring immediately.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(Self { conn })
    }

    /// Wraps an already-open connection (tests share this path; kept
    /// non-test-public so MIGRATIONS conformance owns every open).
    #[cfg_attr(not(test), allow(dead_code))]
    fn from_connection(conn: Connection) -> Self {
        Self { conn }
    }

    /// Current schema version (0 for an empty/new database).
    pub fn schema_version(&self) -> Result<u32, StoreError> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))?;
        Ok(u32::try_from(version).unwrap_or(0))
    }

    /// Applies every pending migration step inside its own transaction and
    /// stamps `user_version`. Called on open; exposed for migrations tests.
    pub fn apply_migrations(&mut self) -> Result<(), StoreError> {
        let from = self.schema_version()?;
        let supported = MIGRATIONS
            .iter()
            .map(|(version, _)| *version)
            .max()
            .unwrap_or(0);
        if from > supported {
            return Err(StoreError::SchemaTooNew {
                found: from,
                supported,
            });
        }
        for (version, sql) in MIGRATIONS {
            if *version <= from {
                continue;
            }
            {
                let tx = self.conn.transaction()?;
                tx.execute_batch(sql)?;
                tx.pragma_update(None, "user_version", *version)?;
                tx.commit()?;
            }
        }
        Ok(())
    }

    /// The last schema version this build can upgrade to.
    pub fn supported_schema_version(&self) -> u32 {
        MIGRATIONS
            .iter()
            .map(|(version, _)| *version)
            .max()
            .unwrap_or(0)
    }

    /// Begins a real transaction. Repositories run inside this when the
    /// caller (importer, backup merge, shell mutation) needs all-or-nothing
    /// semantics; single-statement writes may run outside one.
    pub(crate) fn transaction(&self) -> Result<rusqlite::Transaction<'_>, StoreError> {
        self.conn.unchecked_transaction().map_err(StoreError::Sql)
    }

    /// Borrowed handle for read paths (`read_snapshot`, `ops::load_state`).
    /// Hidden behind `pub(crate)`: the connection is never handed to shells.
    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
    }
}

impl std::fmt::Debug for Db {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never print connection details (path could appear in odd logs).
        f.debug_struct("Db").finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use super::*;

    fn temporary_file_db(dir: &std::path::Path, name: &str) -> Db {
        let path = dir.join(name);
        Db::open(&path).unwrap()
    }

    #[test]
    fn fresh_database_reaches_current_schema_version() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
        assert_eq!(db.supported_schema_version(), SCHEMA_VERSION);
    }

    #[test]
    fn migrations_apply_on_file_db_and_reopen_is_idempotent() {
        let dir = std::env::temp_dir().join("quizradar_p04_db_tests");
        std::fs::create_dir_all(&dir).unwrap();
        let name = format!("migrate_{}.db", std::process::id());
        {
            let db = temporary_file_db(&dir, &name);
            assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
        }
        // Reopen: migrations are no-ops, data survives.
        let db = Db::open(&dir.join(&name)).unwrap();
        assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
        let _ = std::fs::remove_file(dir.join(&name));
    }

    #[test]
    fn schema_version_zero_legacy_file_is_upgraded() {
        // Simulate a database created before any migration stamp: empty
        // tables, user_version forced to 0.
        let dir = std::env::temp_dir().join("quizradar_p04_db_tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("legacy_{}.db", std::process::id()));
        {
            let conn = Connection::open(&path).unwrap();
            conn.pragma_update(None, "user_version", 0).unwrap();
        }
        let mut db = Db::open(&path).unwrap();
        db.apply_migrations().unwrap();
        assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn newer_schema_is_refused_honestly() {
        let conn = Connection::open_in_memory().unwrap();
        // Pretend the file comes from a future build.
        conn.pragma_update(None, "user_version", 999_u32).unwrap();
        let mut db = Db::from_connection(conn);
        assert_eq!(db.schema_version().unwrap(), 999);
        let error = db.apply_migrations().unwrap_err();
        match error {
            StoreError::SchemaTooNew { found, supported } => {
                assert_eq!(found, 999);
                assert_eq!(supported, SCHEMA_VERSION);
            }
            other => panic!("expected SchemaTooNew, got {other:?}"),
        }
    }

    #[test]
    fn tables_have_known_names_and_nullified_unknowns() {
        let db = Db::open_in_memory().unwrap();
        let tx = db.transaction().unwrap();
        tx.execute(
            "INSERT INTO assessments (id, title, assessment_type, urgency_level, priority_score, topics, warnings, source)
             VALUES ('a1', 'Quiz 1', 'Class Quiz', 'upcoming', 10, '[]', '[]', 'Gmail')",
            [],
        )
        .unwrap();
        let room: Option<String> = tx
            .query_row("SELECT room FROM assessments WHERE id = 'a1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(room, None, "unknowns stay NULL — the display renders “—”");
        tx.commit().unwrap();
    }
}
