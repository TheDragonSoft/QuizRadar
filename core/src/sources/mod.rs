//! Source fetchers + the honest sync orchestrator (phase 05,
//! `prompts/p05-core-sources-sync.md`): Gmail (5 queries, dedupe, 60-day
//! window), Teams (Graph + honest heuristic fallback that never invents
//! deadlines), Moodle (iCal + REST), .ics feeds (https-only, ≤10), Classroom
//! (due-date-gated). Empty results are reported honestly — a scan says what
//! ran and what was found, never "connection active" theatre.
