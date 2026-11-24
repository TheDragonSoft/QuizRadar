# QuizRadar Product Specification

_Current product contract across Desktop (Tauri 2), Android (Jetpack Compose M3), and Web Companion (WASM PWA). All user-facing honesty copy lives in `apps/web/src/copy.ts`._

---

## 1. Core Promise & Honesty Doctrine

- **Core promise:** Resolve fuzzy university announcements ("Class Quiz 1 next week, not this week, during your lecture") into exact dates, times, and rooms by cross-referencing each announcement against the student's own weekly timetable.
- **Data honesty:**
  - Zero central user database; data stays on the user's device. OAuth tokens never leave the device.
  - Dates come strictly from explicit announcements, timetable slots, or clearly labeled **estimates** carrying an `ai_inference_note` or heuristic provenance note.
  - Missing room, instructor, or grade always renders `"—"` (or `"Not Graded"`), never a placeholder hall or coerced `0`.
  - Every scan reports real per-source counts and errors honestly (empty results are valid).

## 2. Domain Glossary (Invariants)

| Term | Semantics |
|---|---|
| **Course** | `{id ("CSE241"), name, aliases[], color, credits}`. Manual entry, syllabus import, or shareable Course Pack. |
| **ScheduleSlot** | Weekly recurring class (`day_index 0–6`, `course_id`, `room`, `type`, `group`, `start_time/end_time`, Week A/B parity). |
| **Assessment** | Exam/quiz/lab/assignment with `date_iso`, `start_time`, `end_time`, `room`, `instructor`, `topics[]`, `warnings[]`, `ai_inference_note`, `source`, `elearning_url`, `google_cal_url`, and grade fields (`weightage/achieved/max`). |
| **Type ladder** | `Class Quiz` (default) · `Online Quiz` · `Midterm Exam` · `Final Exam` · `Lab Assessment` · `Assignment`. |
| **Urgency & Priority** | `critical` (≤2d), `high` (≤5d), `medium` (≤14d), `upcoming`, `past`. Composite priority `0–100` drives "What Should I Study?". |
| **Topic key & Readiness** | Content-addressed topic completion keys (`h<fnv1a64>`). Readiness % = completed ÷ total topics across upcoming exams. |
| **Dedupe & Merge** | Dedupe on `(source, course_id, title, date_iso)`. Refreshes and peer merges preserve user grades, topics, and GCal links. |
| **Study blocks & Conflicts** | Auto-placed 90-min free-window blocks day-before-exam mitigate conflict alerts (two exams within 48h). |

## 3. Feature Surface

- **Onboarding & Imports:** Blank-canvas first-run wizard (zero preloaded courses), multi-syllabus PDF/photo importer (1–6 docs with additive review modal), 1-tap Shareable Course Packs (`#course=` / `quizradar://course?d=` + QR, data-only), and v4 JSON backup import.
- **Sources & Scanning:** Gmail (5 academic search queries, 60-day window, candidate filter rejecting grade/cancellation noise), Microsoft Teams/Outlook Graph (with honest heuristic fallback), Moodle (iCal + REST), Google Classroom (due-date-gated), and up to 10 HTTPS `.ics` feeds.
- **Core Views:**
  - **Dashboard:** 7-day KPIs, readiness %, source sync status, conflict banner + smart study blocks, "What Should I Study?" cards, filterable timeline.
  - **Tasks & Grades:** Daily study roadmap, readiness grid, multi-scale GPA engine (4.0 / 4.33 / 5.0 / 10.0) with what-if grade projector, study cushion/deficit.
  - **Calendar:** 7-day desktop / 3-day mobile grid + agenda toggle, overlap lanes, Week A/B parity, custom events, printable PDF schedule, `.ics` export, Google Calendar push.
  - **Focus:** Pomodoro timer, Leitner 5-box flashcards, mistake bank, attendance tracker, practice quizzes (AI or labeled on-device fallback).
  - **Settings:** Account connect/disconnect, courses & aliases, sources/feeds, AI key & trial toggle, backup/restore/reset, peer sync (QR / ephemeral LAN / Drive AppData), desktop updater.
- **Platform Capabilities:** Android Glance widgets (`TodayScheduleWidget` 4×2 & 2×1), T-24h / T-3h / morning digest notifications, Android share-sheet ingest (`ACTION_SEND`), day-rollover watchdog, keyboard shortcuts (`1–4`, `/`, `Ctrl/⌘K`, `Esc`), Light/Dark/AMOLED themes (`solar`, `obsidian`, `amoled-nebula`).

## 4. AI Model, Consent & Privacy (Brand-Critical)

1. **Modes:** AI is **off by default** (`gemini_enabled = false`). Supports BYOK Google Gemini (`x-goog-api-key` header) and an opt-in stateless Zero-Key Trial AI Relay ([ADR-0003](./adr/0003-zero-key-trial-ai-relay.md)); BYOK always takes priority.
2. **Verbatim enable-time disclosure (enforced by `apps/web/src/copy/conformance.test.ts`):**
   > Your email announcements and timetable images are sent to Google's Gemini API when AI is used. On Google's free tier, Google may use that content to improve its products.
   Paired with `"Turn off to stay fully local."`
3. **Zero OAuth-bearer AI fallback:** Never retry AI calls with a user's Google OAuth access token.
4. **Quota & deterministic fallbacks:** Content-hashed local cache, model laddering (`flash-lite` for bulk extraction/quizzes, `flash` for vision/study plans), local quota counter, and labeled deterministic fallbacks when offline or rate-limited (429). Never invoke AI on render paths.
