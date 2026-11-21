# Privacy Policy — QuizRadar

**Last Updated:** November 2026  
**Applies to:** QuizRadar Desktop (Windows, macOS, Linux), QuizRadar Android, and QuizRadar Web/PWA (`https://thedragonsoft.github.io/QuizRadar/`).

---

## 1. Local-First, Zero-Account Architecture

QuizRadar is engineered from the ground up as a **local-first application** with no user accounts, no central database, and no behavioral analytics:

- **No Central Database or Telemetry:** QuizRadar does not operate any central account server, analytics collector, ad network, or crash-tracking SDK.
- **Local Data Storage:** Your academic data — courses, weekly timetables, parsed assessments, grades, study tasks, attendance records, flashcards, and custom calendar events — is stored exclusively on your device:
  - **Desktop:** Local SQLite database inside your OS application-data directory.
  - **Android:** Local SQLite database inside app-private storage accessed via native UniFFI Rust bindings.
  - **Web/PWA:** Local browser IndexedDB persistence via the WebAssembly core engine.
- **Optional Local Wi-Fi Sync:** Desktop offers an optional, user-initiated ephemeral HTTPS pairing session on your local Wi-Fi network (pinned per-session TLS fingerprint + single-use bearer token) that transfers data-only academic JSON directly between your Desktop and Android devices and automatically closes after one sync or 5 minutes. OAuth tokens and secrets are never transmitted.

---

## 2. Google API Services User Data Policy (Limited Use Disclosure)

> **Google API Limited Use Compliance:**  
> QuizRadar's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

Specifically, for all Google Workspace API data (Gmail, Google Classroom, Google Calendar, and Google Drive):

- **On-Device Processing Only:** Emails, Classroom coursework, and calendar entries are fetched directly from Google's APIs to your own device over HTTPS and parsed locally. They are never sent to a QuizRadar database or backend server.
- **No Advertising or Data Brokerage:** QuizRadar never sells, rents, or uses Google user data for targeted advertising, profiling, or marketing.
- **No Generalized AI/ML Model Training:** QuizRadar does **not** use Google Workspace API data to develop, improve, or train generalized AI or machine-learning models. Optional AI features are off by default, require explicit user consent, and are never triggered unless you turn AI on.
- **No Human Access:** Because QuizRadar has no backend storing your data, no QuizRadar maintainer or employee ever reads your emails, coursework, grades, or calendar events.

---

## 3. OAuth Scopes Requested & Exact Purpose

All authentication uses PKCE (Proof Key for Code Exchange) with single-use random `state` validation (`core/src/auth/providers.rs`). You may connect or disconnect any provider at any time.

| Provider      | OAuth Scope                                                          | Why QuizRadar Requests It                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google**    | `https://www.googleapis.com/auth/gmail.readonly`                     | Read-only scan of course announcement emails on your device to detect quiz, midterm, lab, and assignment deadlines. QuizRadar never modifies, sends, or deletes emails.                   |
| **Google**    | `https://www.googleapis.com/auth/classroom.courses.readonly`         | Read-only list of your enrolled Google Classroom courses to match announcements and coursework to your timetable.                                                                         |
| **Google**    | `https://www.googleapis.com/auth/classroom.coursework.students`      | Read-only fetch of upcoming Google Classroom assignments and due dates for your exam radar.                                                                                               |
| **Google**    | `https://www.googleapis.com/auth/calendar.events`                    | User-initiated push of confirmed upcoming exam dates from your local radar to your primary Google Calendar.                                                                               |
| **Google**    | `https://www.googleapis.com/auth/drive.appdata`                      | Optional, user-initiated data-only JSON backup and restore inside your private hidden Google Drive `appDataFolder`. QuizRadar cannot view or access any other files in your Google Drive. |
| **Google**    | `https://www.googleapis.com/auth/userinfo.email`, `userinfo.profile` | Display your signed-in account name and email in Settings.                                                                                                                                |
| **Microsoft** | `openid`, `profile`, `email`, `User.Read`, `offline_access`          | Sign in to your university or personal Microsoft account and silently renew tokens on-device.                                                                                             |
| **Microsoft** | `Mail.Read`, `Calendars.Read`                                        | Optional, incrementally consented read-only scan of Outlook/Teams course emails and calendar events on your device.                                                                       |

---

## 4. Token & Credential Security

Each device scans with its own OAuth tokens obtained directly from Google or Microsoft. Tokens **never** leave your device, never enter backups, and never cross any network relay:

- **Desktop:** Stored in the native OS Keyring (Windows Credential Manager, macOS Keychain, Linux Secret Service).
- **Android:** Stored in hardware-backed `EncryptedSharedPreferences` via Android Keystore.
- **Web/PWA:** Maintained ephemerally in browser memory only (~1-hour session token) and cleared immediately when the tab closes.

---

## 5. Optional AI Features (BYOK Gemini & Stateless Free Starter AI Relay)

QuizRadar offers optional AI features (multi-syllabus PDF/photo extraction, timetable photo import, email parsing assistance, study plan optimization, and practice quiz generation) powered by Google Gemini. All AI features are **off by default** and have honest local deterministic fallbacks.

> **Consent Disclosure (Free-Tier Reality):**  
> _Your email announcements and timetable images are sent to Google's Gemini API when AI is used. On Google's free tier, Google may use that content to improve its products. Turn off to stay fully local._

You may choose either mode after giving explicit consent:

1. **Bring Your Own Key (BYOK Gemini — Recommended for Power Users):** You supply your own Google Gemini API key. Requests go directly from your device to `generativelanguage.googleapis.com` using the `x-goog-api-key` header.
2. **Opt-In Free Starter AI Relay (`https://trial-ai.quizradar.workers.dev`):** For first-run convenience without pasting an API key, you may opt in to QuizRadar's stateless Cloudflare Worker relay.
   - **Zero Payload Storage:** Syllabus PDFs, images, prompts, and Gemini responses pass strictly through volatile Worker memory and are never logged or persisted.
   - **Zero OAuth Tokens:** Any request carrying an `Authorization` header is immediately rejected (`400 AUTH_HEADER_FORBIDDEN`).
   - **Anonymous Daily Rate Limit Only:** To prevent abuse, the Worker stores only a daily SHA-256 hash of a random per-install identifier (`x-quizradar-install-id`) and IP hash in Cloudflare KV with a 25-hour auto-expiring TTL.

Turning **AI Features** off in Settings immediately stops all AI traffic in both BYOK and Starter AI modes.

---

## 6. Cloud Backups & Shareable Course Packs

- **Google Drive AppData Backup:** Strictly strips OAuth tokens, Moodle credentials, session cookies, and API keys before writing to your private `appDataFolder`.
- **1-Tap Shareable Course Packs (`qrpack1_`):** When you choose to share a course pack with classmates, QuizRadar explicitly excludes personal grades, attendance logs, study sessions, custom personal notes, and all credentials—sharing only course schedule slots, syllabus milestones, weights, and study topics.

---

## 7. Data Deletion & Revoking Access

- **Clear Local Data:** Use **Settings → Data Management → Reset All Data** at any time to wipe your local SQLite/IndexedDB database and all stored tokens from your device immediately.
- **Revoke Google Access:** Visit [Google Account Third-Party Access](https://myaccount.google.com/permissions) and remove QuizRadar.
- **Revoke Microsoft Access:** Visit [Microsoft Account App Permissions](https://account.live.com/consent/Manage) and remove QuizRadar.
- **Contact:** For privacy questions or security reports, open a private Security Advisory on [GitHub](https://github.com/TheDragonSoft/QuizRadar/security/advisories/new) or contact the maintainer via the repository.
