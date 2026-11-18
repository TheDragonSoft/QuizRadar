# QuizRadar Commercial Roadmap ($1M+ Path)

_Strategic plan for evolving QuizRadar from a local-first, open-source v5 engine into a mainstream, monetizable student product without sacrificing user trust._

---

## Current Baseline (v5.15.3+)

- **Core & Cross-Platform Parity:** Pure Rust `core/` powering Desktop (Tauri 2), Web Companion (WASM PWA), and Android (Jetpack Compose M3 + Glance widgets).
- **Independent Scanning & Serverless Peer Sync:** Both Desktop and Android scan sources independently and merge additively via `quizradar://pair?d=...` links, JSON backup, or Google Drive AppData.

---

## Phase 1 — "15-Second Magic" Activation (Highest Leverage)

1. **Multi-Syllabus PDF Importer:**
   - Drag-and-drop 4–6 course syllabi during onboarding or Settings.
   - Extract courses, exam/quiz dates, grade weights, and topic lists into a unified Review & Apply preview modal.
   - Gives immediate Day-1 value to every student regardless of whether their university uses Gmail, Outlook, Canvas, Blackboard, or Moodle.
2. **Zero-Key Trial AI Relay:**
   - Thin stateless relay (e.g., Cloudflare Worker) providing ~15–20 free AI extractions on first run with zero API-key setup.
   - BYOK Gemini remains available for power users who want unlimited free-tier usage.
3. **OAuth Verification & First-Party Clients:**
   - Complete Google OAuth restricted-scope verification (CASA audit) to eliminate the "Unverified App" warning screen.
   - Ship a first-party multi-tenant Microsoft Entra client ID so Teams works in one tap on Android and Desktop.

---

## Phase 2 — Opt-In E2EE Sync Server & LMS Connectors

Because both Desktop and Mobile scan independently, manual link/Drive sync should evolve into **automatic, zero-knowledge multi-device sync**:

1. **Opt-In End-to-End Encrypted (E2EE) Sync Server:**
   - Clients encrypt `BackupPayload` locally (keys never leave the user's devices; OAuth tokens are never synced).
   - Server stores only opaque ciphertext blobs and delivers instant delta sync across Desktop, Android, and iOS/Web.
   - Preserves the core honesty & privacy promise ("we cannot read your emails, grades, or tokens") while delivering seamless multi-device continuity.
2. **Browser Extension for Canvas / Blackboard / Brightspace:**
   - Lightweight Chrome/Edge/Firefox extension that reads the student's already-authenticated LMS session locally and pushes assignments/calendars into QuizRadar—zero university IT approval required.

---

## Phase 3 — Store Distribution, Campus Virality & Monetization

1. **Store Presence & Signing:**
   - Publish to **Google Play Store**, **Apple App Store** (native iOS shell + WidgetKit), **Microsoft Store / Winget**, and signed/notarized macOS builds.
2. **Opt-In Anonymous Course Crowd-Verification:**
   - *"12 other students in CSE241 confirmed Midterm 1 moved to Nov 14."* Anonymized syllabus/date consensus turns QuizRadar from a single-player utility into a viral campus wedge every September and January.
3. **Freemium Business Model:**
   - **Free Forever:** Local radar, ICS/calendar, heuristic parsing, Pomodoro, GPA tracker, serverless `quizradar://pair` sync.
   - **QuizRadar Pro (~$5/mo or $29/yr Semester Pass):** Managed zero-key AI (syllabus PDF extraction, AI practice quizzes from lecture notes, AI study-plan optimization) + automatic E2EE multi-device sync.
