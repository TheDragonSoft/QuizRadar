# Phase 02 — Core: types + email/ICS parsing with golden fixtures

> After phase 01. This is the single most logic-heavy phase — the honest merger of v4's parser (Rust) and engine parser (JS). Semantic spot-checks with the maintainer are expected for ambiguous rules; ASK, don't guess.

**Read first:** `AGENTS.md` §2–§3; `docs/rebuild/01-product-spec.md` §3 (glossary — exact semantics) and §4.2 (radar behavior); `docs/rebuild/02-current-architecture.md` §3 (schemas) + §6 (AI layer contract); `docs/rebuild/03-issues-and-pain-points.md` §A + §C (never port ❌ items); `docs/rebuild/reference-v4-audit.md` A6/A7 (parser defects fixed by design here).

**Reference implementation (port, then de-fabricate):**
- `git show v4-final:src/parser.rs` — full semantic detail (candidate filter, date inference, type ladder, topic/warning extraction, dashboard builder, deterministic planner).
- `git show v4-final:static/app.js` lines ~276–795 — the JS parity port (cross-check merge semantics: grade preservation, source-tagged dedupe).
- `git show v4-final:src/moodle.rs` `parse_moodle_ics_content` — ICS parser basis (reused for feeds).
- `git show v4-final:src/main.rs` bottom — 32 cargo tests to port as fixtures.

## Build

1. `core/src/types.rs` — final serde structs: `Course`, `ScheduleSlot`, `ScheduleData`, `Assessment` (EVERY field from `02` §3.3; `room: Option<String>`, `instructor: Option<String>`, dates as `chrono::NaiveDate`/`NaiveTime` internal + serde as ISO strings), `AssessmentType`/`UrgencyLevel`/`AssessmentSource` as enums with serde as-strings. **Unknown is representable**: no default room, no default instructor, no default palette.
2. `core/src/parse/email.rs`:
   - Candidate filtering (\`RE:\` replies, grade/result/cancellation/material notices rejected, 60-day recency, quiz/exam/assessment subject+sender rules) — port v4 semantics verbatim minus v4's dev-specific quirks.
   - Course code regex (`[A-Z]{2,4}\s?\d{3}[a-zA-Z]?`) against subject+body; else course = `None` (rendered "General" only at display time).
   - **Date inference ladder** (document exactly): explicit `d Mon YYYY` / `D/M/YYYY` → explicit `next week (not this week)` ⇒ sent+8d → `next week` ⇒ sent+5d → `this week` ⇒ sent+3d → explicit weekday ⇒ next occurrence → unverifiable ⇒ **assessment drafted with `date: None`** (honest: "no date in announcement — needs manual confirmation"), never invented.
   - Slot cross-reference: match preferred slot type (tutorial/lab/lecture) to inherit room/group/times when the date lands on a slot day.
   - Type ladder, urgency ladder, priority score 0–100, display-time formatting — extract to pure helpers with unit tests.
   - **Delete-list enforcement:** no student-name overrides, no per-email-ID branches, no BJT/MOSFET-only topic lists (generic topic extraction from bullet/lecture lines + explicit fallbacks worded honestly), no "(via …)" string surgery.
3. `core/src/parse/ics.rs` — VEVENT parser (hand-written state loop, no regex-per-line) with UTC `Z`, `TZID` ignoring-but-preserving, date-only `DTSTART;VALUE=DATE`, fold/unfold long lines. Shared by Moodle iCal + generic feeds.
4. `core/src/parse/merge.rs` — dedupe key `(source, course_id, title_lower, date_iso)`; refresh preserves user-owned fields (`grades`, `gcal_synced/event_id`, `completed topics` are touched only by their own APIs).
5. **Golden fixtures** `core/tests/fixtures/email/*.txt|json` + `ics/*.ics` + expected-output JSON: port the v4 tests + add cases: explicit date, week-relative anchors, this-week, no date at all, HTML-heavy body, forwarded-announcement `EMAIL_SEPARATOR` body extraction, moodle string, feed URL with embedded token (assert https-only validation), dedupe merge keeping user grade.
6. `core/src/plan/` stubs compile-only this phase (phase 03 fills).

## Acceptance
- [ ] `cargo test -p quizradar-core` green with ≥14 fixture cases (.email + .ics sides)
- [ ] Every derived assessment carries a truthful `inference_note` (heuristic vs explicit) — tested
- [ ] No date ever invented without source — tested (no-date case produces `date: None`)
- [ ] `cargo clippy -D warnings` + fmt clean; no `unwrap()` on user-input paths
- [ ] STATUS: §Commands updated; phase 02 ticked

## Commit
`phase(2): core types + email/ics parsing with golden fixtures`
