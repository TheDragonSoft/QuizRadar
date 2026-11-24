# QuizRadar Roadmap

_Active product and commercial milestones beyond the v5.20.0 local-first baseline._

---

## Stage 1 — "15-Second Magic" Activation & Campus Virality

1. **Multi-Syllabus PDF & Photo Importer (Shipped):** Drag-and-drop 1–6 syllabi (PDF/PNG/JPEG/WebP) to extract courses, slots, deadlines, grade weights, and topics with additive preview merge.
2. **1-Tap Shareable Course Packs (Shipped):** Data-only compressed course bundle links (`#course=`, `quizradar://course?d=`, QR) with zero personal grades, notes, or tokens.
3. **Zero-Key Trial AI Relay (Shipped):** Stateless Cloudflare Worker (`workers/trial-ai-relay/`) powering opt-in first-run trial extractions; BYOK Gemini always takes priority.
4. **OAuth Verification & First-Party Clients (Code ready, external console pending):** Hosted `/privacy/` and `/terms/` pages and multi-tenant Microsoft Entra GUID plumbing shipped. Remaining: submit Google CASA Tier 2 review + register Entra app + set `QUIZRADAR_MICROSOFT_CLIENT_ID` in CI ([`docs/oauth.md`](./oauth.md)).

## Stage 2 — Opt-In E2EE Sync & LMS Connectors

1. **Opt-In End-to-End Encrypted Sync Server:** Clients encrypt `BackupPayload` locally (keys and OAuth tokens never leave the device); server stores opaque ciphertext for automatic delta sync across Desktop, Android, and Web.
2. **Browser Extension (Canvas / Blackboard / Brightspace):** Reads the student's authenticated LMS session locally and pushes assignments/calendars into QuizRadar with zero university IT approval.

## Stage 3 — Store Distribution & Sustainable Monetization

1. **Store Presence & OS Signing:** Google Play Store, Apple App Store (native iOS + WidgetKit), Microsoft Store / Winget, notarized macOS builds.
2. **Opt-In Anonymous Course Crowd-Verification:** Anonymized syllabus/date consensus across classmates.
3. **Freemium Model:** Free Forever local radar, ICS/calendar, heuristic parsing, Pomodoro, GPA tracker, serverless peer sync; QuizRadar Pro (~$5/mo or $29/yr) for managed zero-key AI + automatic E2EE sync.
