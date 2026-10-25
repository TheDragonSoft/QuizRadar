# Privacy Policy — QuizRadar

**Last Updated:** October 2026  
**Applies to:** QuizRadar Desktop (Windows, macOS, Linux), QuizRadar Android, and QuizRadar Web/PWA.

---

## 1. Zero-Server & 100% Local-First Architecture

QuizRadar is engineered from the ground up as a **zero-server, local-first application**:

- **No Central Servers:** QuizRadar does not operate any backend servers, relays, tracking servers, or telemetry collectors.
- **No Analytics or Trackers:** There are zero third-party telemetry SDKs, zero crash-reporting servers, and zero ad networks embedded in any shell.
- **Local Data Storage:** All your academic data — including courses, class schedules, announcements, parsed assessments, grades, topics, and custom calendar events — is stored exclusively on your device:
  - **Desktop:** Local SQLite database encrypted or keyed to your user directory.
  - **Android:** Local SQLite database accessed via native UniFFI Rust bindings.
  - **Web/PWA:** Local browser IndexedDB persistence via WebAssembly core engine.

---

## 2. Authentication, Tokens & Credentials

QuizRadar connects directly from your device to university and identity providers (Google, Microsoft, Moodle) using standards-compliant PKCE OAuth:

- **No Client Secrets:** No client secrets exist in our source code, binaries, or distribution packages.
- **Per-Device Scans:** Each device scans using its own tokens obtained directly from the provider. Tokens never cross a network or sync to any intermediary server.
- **Secure Token Storage:**
  - **Desktop:** Stored in the native OS Keyring (Windows Credential Manager, macOS Keychain, Linux Secret Service).
  - **Android:** Stored in hardware-backed `EncryptedSharedPreferences` via Android Keystore.
  - **Web/PWA:** Maintained ephemerally in memory (1-hour GIS tokens) and cleared upon tab closure.

---

## 3. Optional Bring-Your-Own-Key (BYOK) AI Disclosure

QuizRadar offers optional AI-powered capabilities (email assessment parsing, timetable image vision import, study plan optimization, and practice quiz generation) powered by Google Gemini.

> **Consent Disclosure (Free-Tier Reality):**  
> _Your email announcements and timetable images are sent to Google's Gemini API when AI is used. On Google's free tier, Google may use that content to improve its products. Turn off to stay fully local._

- **BYOK Only:** You supply your own Google Gemini API key. Keys are transmitted directly from your device to Google endpoints via the standard `x-goog-api-key` HTTP header.
- **Zero AI on Core Render Paths:** AI is never invoked on UI renders, dashboard views, countdown calculations, or routine state refreshes.
- **Deterministic Offline Fallbacks:** Every AI feature has an honest, fully local deterministic fallback (heuristic email regex parsing, manual timetable editors, and local topic-based study planners). Disabling AI or reaching API limits degrades gracefully to offline mode with full transparency.

---

## 4. Cloud Backups (Google Drive AppData)

- If you choose to enable Google Drive AppData sync, QuizRadar writes an encrypted academic backup JSON directly to your private Google Drive `appDataFolder`.
- **Zero Secrets Uploaded:** OAuth tokens, Moodle passwords, session cookies, and API keys are strictly stripped before backup generation. Cloud payloads contain data only — never credentials.

---

## 5. Data Ownership, Export & Deletion

- **Full Data Portability:** You can export your full academic dataset at any time as a portable v4/v5 JSON backup or an iCalendar (`.ics`) file.
- **Immediate Deletion:** Clearing application data or disconnecting an account immediately removes local files, database records, and stored tokens from your device's secure storage. Because there are no QuizRadar servers, no residual data remains.
