# QuizRadar Commercial Roadmap ($1M+ Path)

_Strategic plan for evolving QuizRadar from a local-first, open-source v5 engine into a mainstream, monetizable student product without sacrificing user trust._

---

## Current Baseline (v5.20.0+)

- **Core & Cross-Platform Parity:** Pure Rust `core/` powering Desktop (Tauri 2), Web Companion (WASM PWA), and Android (Jetpack Compose M3 + Glance widgets).
- **Independent Scanning & Serverless Peer Sync:** Both Desktop and Android scan sources independently and merge additively via `quizradar://pair?d=...` links, ephemeral Desktop LAN HTTPS QR sync (`quizradar://lan?...`), JSON backup, or Google Drive AppData.

---

## Phase 1 — "15-Second Magic" Activation & Campus Virality (Highest Leverage)

1. **Multi-Syllabus PDF & Photo Importer (PR 1 — Shipped):**
   - Drag-and-drop 1–6 course syllabi (PDF, PNG, JPEG, WebP) during onboarding or Settings.
   - Extract courses (with credits and aliases), weekly slots, exam/quiz dates (or honest TBA when unscheduled), grade weights, and topic lists into a unified Review & Apply preview modal with additive, grade-safe merge.
   - Gives immediate Day-1 value to every student regardless of whether their university uses Gmail, Outlook, Canvas, Blackboard, or Moodle.
2. **1-Tap "Share Course Pack" Viral Links (PR 1 — Shipped):**
   - Data-only compressed course bundle links (`https://thedragonsoft.github.io/QuizRadar/app/#course=...` and `quizradar://course?d=...` + QR codes) sharing course slots, deadlines, weights, and topics with zero personal grades, notes, or tokens.
   - Classmates opening a shared link land directly on a 1-tap import preview bypassing blank-canvas setup.
3. **Zero-Key Trial AI Relay (PR 2 — Shipped):**
   - Thin stateless Cloudflare Worker (`workers/trial-ai-relay/`) providing free starter AI extractions on first run with zero API-key setup, opt-in per-device rate limiting, and explicit stateless disclosure.
   - BYOK Gemini remains available in Settings and always takes priority when configured.
4. **OAuth Verification & First-Party Clients:**
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
