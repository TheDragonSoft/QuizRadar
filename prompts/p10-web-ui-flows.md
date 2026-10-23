# Phase 10 — Web UI flows: onboarding, settings, accounts, AI, search, backups, updater, practice, pomodoro

> After phase 09. The alpha-finisher for web/desktop. Every flow must reuse the design system from phase 08 and core commands from 07.

**Read first:** `AGENTS.md`; `docs/rebuild/01-product-spec.md` §4.1 (onboarding), §4.9 (settings), §4.7 (practice/pomodoro), §4.8 (search/backups/pairing/updater notes), §5 (modal inventory); `docs/rebuild/05-ai-features-plan.md` §3–§5 (quota UX + consent copy — paste verbatim); `docs/rebuild/03-issues-and-pain-points.md` §C2–C3 (auth honesty; no manual-entry impersonates OAuth), §D list.

## Build

1. **Onboarding wizard** (3 steps, never resets mid-flow, opens on first-run per device): step-1 identity/tracks/rhythm/theme choice; step-2 connection hub — Google connect (real PKCE via `google_login_start`), Microsoft connect, Moodle card (URL+token/ical), Classroom toggle, Gemini optional key card (with the `05` §5.1 consent line + free-tier quota cap text), timetable upload → vision preview modal (apply/discard + manual fallback always); step-3 course enrollment manual grid + finish syncs once and shows honest results. Badges must be TRUE states only (connect/connected/error) — never default "Ready".
2. **Settings modal** (3 tabs, restored last tab): Account (user, connect/disconnect with wipe semantics, Gemini key validator + explicit ON/OFF with consent copy), Courses (grid edit/delete, re-open onboarding), Integrations (moodle/teams/classroom toggles + test/sync buttons; auto-gcal CONSENTS-FIRST (default off per delete-list); notify prefs placeholder state [mobile-only real]; **feeds list** add/toggle/delete (https-only error surfaces); pair/backup card = file export/import (from phase 07 commands) + optional "Pair phone URL" shown as read-only help — write local-IP helper only if trivial (honest fallback "no LAN helper in web tier"); updater check button (honest errors from phase-07 updater state).
3. **Search palette** desktop (⌘K, `/`, recents stored locally ≤6, suggestions, top-4 matches across title/course/instructor/topics, per-course chips w/ colors) + mobile sheet equivalent with type chips; results navigate (timeline row open modal / calendar jump).
4. **Practice quiz modal**: on demand per assessment; calls core `practice_generate`; if AI quota unavailable, honest `Authored locally from your topics` labeling; click-to-score, explanation reveal, restart. Pomodoro modal: 25/5/15, chime (WebAudio), task-done hookup to topic toggle.
5. **Backup & reset**: export (secret-scrubbed file via file-dialog), import (validates + explicit confirm), reset (double confirm + honest toast; rebuilds empty DB).
6. **Update pill** (desktop): poll `updater_check` on launch + delayed; pill + popover with release notes (markdown-lite render), skip-version persistence, download→install handoff over plugin events with honest progress + recovery copy if the app doesn't restart.
7. Tests: onboarding first-run gating; settings tab restoration; search matching top-4; practice fallback labeling; backup export scrub (grep output file for key names); update-dismiss persistence.

## Acceptance
- [ ] All remaining `01` §5 modal inventory items exist; §8 "System" checklist (desktop-relevant) ticked in STATUS
- [ ] Copy audit: every honesty string present verbatim (AI consent, empty scans, what-if note)
- [ ] lint/typecheck/test green
- [ ] STATUS updated + dogfood checklist started (`docs/STATUS.md` §Dogfood-notes)

## Commit
`phase(10): web flows (onboarding, settings, AI, search, backup, updater, practice)`
