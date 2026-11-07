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

use rusqlite::{params, Connection};

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
pub const SCHEMA_VERSION: u32 = 4;

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
    // Topic keys become content-addressed (`plan::dashboard::
    // topic_key_for_text`). No table shape changes — the data does: the
    // positional `"{id}::{index}"` rows in `topics_done` are rewritten
    // through each assessment's CURRENT topic list by the Rust step below
    // (an index→text table lives in the `assessments` row, not in SQL).
    (3, "SELECT 1;"),
    // Milestone 1: Non-AI Suite Extensions.
    // Adds course credits and absence limits, slot week parity, attendance sessions,
    // flashcards (Leitner boxes), quiz attempt history, mistake bank, and study focus sessions.
    (
        4,
        "ALTER TABLE slots ADD COLUMN week_parity TEXT;
         ALTER TABLE courses ADD COLUMN credits REAL;
         ALTER TABLE courses ADD COLUMN max_absences INTEGER;

         CREATE TABLE attendance (
             id TEXT PRIMARY KEY NOT NULL,
             slot_id TEXT NOT NULL,
             course_id TEXT NOT NULL,
             date_iso TEXT NOT NULL,
             status TEXT NOT NULL,
             updated_at TEXT
         );
         CREATE UNIQUE INDEX idx_attendance_slot_date ON attendance(slot_id, date_iso);
         CREATE INDEX idx_attendance_course ON attendance(course_id);

         CREATE TABLE flashcards (
             id TEXT PRIMARY KEY NOT NULL,
             course_id TEXT,
             assessment_id TEXT,
             topic TEXT,
             front TEXT NOT NULL,
             back TEXT NOT NULL,
             box_level INTEGER NOT NULL DEFAULT 1,
             next_review_iso TEXT,
             last_reviewed_iso TEXT,
             updated_at TEXT
         );
         CREATE INDEX idx_flashcards_course ON flashcards(course_id);

         CREATE TABLE quiz_attempts (
             id TEXT PRIMARY KEY NOT NULL,
             assessment_id TEXT NOT NULL,
             course_id TEXT,
             timestamp TEXT NOT NULL,
             score INTEGER NOT NULL,
             total_questions INTEGER NOT NULL,
             passed INTEGER NOT NULL
         );
         CREATE INDEX idx_quiz_attempts_assessment ON quiz_attempts(assessment_id);

         CREATE TABLE mistake_bank (
             id TEXT PRIMARY KEY NOT NULL,
             attempt_id TEXT,
             assessment_id TEXT NOT NULL,
             course_id TEXT,
             question_id TEXT NOT NULL,
             question_text TEXT NOT NULL,
             options TEXT NOT NULL,
             selected_index INTEGER NOT NULL,
             correct_index INTEGER NOT NULL,
             explanation TEXT,
             timestamp TEXT NOT NULL,
             resolved INTEGER NOT NULL DEFAULT 0,
             updated_at TEXT
         );
         CREATE INDEX idx_mistake_bank_assessment ON mistake_bank(assessment_id);

         CREATE TABLE study_sessions (
             id TEXT PRIMARY KEY NOT NULL,
             course_id TEXT,
             assessment_id TEXT,
             topic TEXT,
             duration_minutes INTEGER NOT NULL,
             timestamp TEXT NOT NULL,
             date_iso TEXT NOT NULL
         );
         CREATE INDEX idx_study_sessions_date ON study_sessions(date_iso);
         CREATE INDEX idx_study_sessions_course ON study_sessions(course_id);",
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
        // Migration 3 is a DATA migration (positional topic keys →
        // content-addressed keys through each assessment's current topic
        // list); it needs Rust, not SQL, and runs once, right after the
        // ladder crosses version 3.
        if from < 3 {
            migrate_topic_keys_to_content_addressing(&self.conn)?;
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

/// Migration-3 data step: rewrite positional `topics_done` keys
/// (`"{assessment_id}::{index}"`) into content-addressed keys through each
/// assessment's CURRENT topic list. Idempotent (content keys never match the
/// legacy pattern); rows whose assessment or index no longer resolve are
/// deleted — the positional scheme had already lost them, and carrying the
/// dead rows would fabricate completion state. Remap/drop counts land in
/// `kv_meta` under `topic_key_migration_v3` so the step is inspectable.
pub(crate) fn migrate_topic_keys_to_content_addressing(
    conn: &Connection,
) -> Result<(), StoreError> {
    // Index→text table per assessment, straight from the stored radar.
    let mut topic_table: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT id, topics FROM assessments")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (id, topics_json) = row?;
            let topics: Vec<String> = serde_json::from_str(&topics_json).unwrap_or_default();
            topic_table.insert(id, topics);
        }
    }

    let rows: Vec<(String, i64, Option<String>)> = {
        let mut stmt = conn.prepare("SELECT key, done, updated_at FROM topics_done")?;
        let mapped = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;
        mapped.collect::<Result<Vec<_>, _>>()?
    };

    let mut remapped = 0usize;
    let mut dropped = 0usize;
    let mut updates: Vec<(String, String, i64, Option<String>)> = Vec::new();
    let mut stale_keys: Vec<String> = Vec::new();
    for (key, done, updated_at) in rows {
        let legacy = crate::plan::dashboard::parse_legacy_topic_key(&key);
        let Some((assessment_id, index)) = legacy else {
            continue; // already content-addressed
        };
        stale_keys.push(key);
        match topic_table
            .get(&assessment_id)
            .and_then(|topics| topics.get(index))
        {
            Some(topic_text) => {
                updates.push((
                    crate::plan::dashboard::topic_key_for_text(&assessment_id, topic_text),
                    assessment_id,
                    done,
                    updated_at,
                ));
                remapped += 1;
            }
            None => dropped += 1,
        }
    }

    let tx = conn.unchecked_transaction()?;
    for (new_key, _assessment_id, done, updated_at) in &updates {
        if done == &1 {
            tx.execute(
                "INSERT INTO topics_done (key, done, updated_at) VALUES (?1, 1, ?2) \
                 ON CONFLICT(key) DO UPDATE SET done = 1, updated_at = excluded.updated_at",
                params![new_key, updated_at],
            )?;
        }
    }
    for key in &stale_keys {
        tx.execute("DELETE FROM topics_done WHERE key = ?1", [key])?;
    }
    let summary = serde_json::json!({ "remapped": remapped, "dropped": dropped });
    tx.execute(
        "INSERT INTO kv_meta (key, value) VALUES ('topic_key_migration_v3', ?1) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [&summary.to_string()],
    )?;
    tx.commit()?;
    Ok(())
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
        // A recycled process id may have left an old file behind.
        let _ = std::fs::remove_file(dir.join(&name));
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
        // A recycled process id may have left an old file behind; re-zeros of
        // a stale schema would make migration 1 collide with existing tables.
        let _ = std::fs::remove_file(&path);
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
    fn migration_3_remaps_positional_topic_keys_through_current_topics() {
        // A v2-era file: positional `topics_done` keys against a topic list
        // the next scan would reorder. THE regression: index 1 pointed at
        // "Trees"; after remap the completion must belong to the TEXT.
        let dir = std::env::temp_dir().join("quizradar_p04_db_tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("topic_keys_{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(INITIAL_SCHEMA_SQL).unwrap();
            conn.execute_batch(MIGRATIONS[1].1).unwrap();
            conn.pragma_update(None, "user_version", 2).unwrap();
            conn.execute(
                "INSERT INTO assessments (id, title, assessment_type, urgency_level, priority_score, topics, warnings, source)
                 VALUES ('a1', 'Quiz 1', 'Class Quiz', 'upcoming', 10, ?1, '[]', 'Gmail')",
                [r#"["Loops","Trees"]"#],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO topics_done (key, done) VALUES ('a1::1', 1)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO topics_done (key, done) VALUES ('a1::9', 1)",
                [],
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), SCHEMA_VERSION);

        let done: Vec<(String, i64)> = {
            let mut stmt = db
                .conn()
                .prepare("SELECT key, done FROM topics_done")
                .unwrap();
            let rows = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap();
            rows.collect::<Result<Vec<_>, _>>().unwrap()
        };
        let trees_key = crate::plan::dashboard::topic_key_for_text("a1", "Trees");
        assert_eq!(
            done,
            vec![(trees_key, 1)],
            "index 1 → 'Trees', dangling index 9 gone"
        );

        let counts: Option<String> = db
            .conn()
            .query_row(
                "SELECT value FROM kv_meta WHERE key = 'topic_key_migration_v3'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            counts.as_deref(),
            Some(r#"{"dropped":1,"remapped":1}"#),
            "the one-shot step is inspectable, not silent"
        );
        let _ = std::fs::remove_file(&path);
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
