# OAuth Verification & First-Party Client Submission Runbook

_Maintainer submission package for Google OAuth Restricted-Scope Verification (CASA Tier 2) and Microsoft Entra ID Multi-Tenant Publisher Verification (Stage 1 PR 3)._

---

## 1. Google OAuth Consent Screen & Brand Verification

Open **Google Cloud Console → APIs & Services → OAuth consent screen** for project `quizradar-511922` (or your production domain project once moved to a custom domain):

### 1.1 Exact App Information Fields

| Field | Exact Value |
| --- | --- |
| **App name** | `QuizRadar` |
| **App homepage** | `https://thedragonsoft.github.io/QuizRadar/` |
| **Application Privacy Policy link** | `https://thedragonsoft.github.io/QuizRadar/privacy/` |
| **Application Terms of Service link** | `https://thedragonsoft.github.io/QuizRadar/terms/` |
| **Authorized domains** | `thedragonsoft.github.io` (and `quizradar.app` if/when custom domain is active) |
| **User type** | External (Production) |

> **Why hosted `/privacy/` & `/terms/` matter:** Google Trust & Safety requires the Privacy Policy and Terms of Service URLs to live on the same verified domain as the App Homepage, linked visibly from the homepage footer, and to contain the verbatim **Google API Services User Data Policy — Limited Use** disclosure. Both are live in `apps/landing/src/pages/privacy.astro` and `apps/landing/src/pages/terms.astro`.

### 1.2 Exact Scope-by-Scope Justifications (Copy-Paste into Google Console)

Every scope below is defined once in `core/src/auth/providers.rs`:

1. **`https://www.googleapis.com/auth/gmail.readonly` (Restricted)**
   > QuizRadar is a local-first university exam radar. On explicit user request ("Scan"), the app queries the student's Gmail inbox directly from their own device using narrow academic search filters (quiz, exam, midterm, assignment, lab, course codes from the student's timetable) to detect announced deadlines and resolve relative dates ("Quiz 1 next week") against the student's local class schedule. QuizRadar is strictly read-only, never modifies or sends emails, and never stores Gmail messages on any backend server.
2. **`https://www.googleapis.com/auth/classroom.courses.readonly` & `https://www.googleapis.com/auth/classroom.coursework.students` (Sensitive)**
   > Used on-device to list the student's enrolled Google Classroom courses and fetch upcoming coursework due dates so they appear alongside exams on the student's unified academic radar and weekly timetable.
3. **`https://www.googleapis.com/auth/calendar.events` (Sensitive)**
   > Used solely when the student clicks "Push to Google Calendar" (or enables optional post-scan calendar push) to create or update upcoming exam events on the student's primary calendar so exam reminders appear across their calendar apps.
4. **`https://www.googleapis.com/auth/drive.appdata` (Non-sensitive / App-scoped)**
   > Used only when the student initiates Backup / Restore to store a data-only JSON backup of their QuizRadar courses, grades, and tasks in Google Drive's hidden `appDataFolder`. OAuth tokens and secrets are stripped prior to serialization, and QuizRadar cannot access any other files in Drive.
5. **`userinfo.email` & `userinfo.profile` (Non-sensitive)**
   > Displays the signed-in account name and email in Settings so the student can confirm which university/personal account is connected.

### 1.3 Mandatory Verification Demo Video Storyboard (Unlisted YouTube Link)

Google reviewers require a continuous screen recording (English, ≤ 3 minutes) showing:

1. **Homepage & Privacy Policy:** Open `https://thedragonsoft.github.io/QuizRadar/`, click **Privacy Policy** in the footer (`/privacy/`), highlighting the Limited Use disclosure.
2. **OAuth Consent Screen with visible `client_id`:** Launch QuizRadar Desktop (or Web Companion), click **Connect Google**, and pause 3 seconds on the browser address bar so the reviewer can read `client_id=620389124802-...` and the exact requested scopes on Google's consent screen.
3. **Gmail Read-Only Scan:** Click **Scan Now** in QuizRadar, show course announcements resolving into dated exam cards on the Radar Dashboard, and confirm no emails are modified.
4. **Google Classroom & Google Calendar Push:** Show a Classroom assignment appearing on the radar, then click **Push to Google Calendar** and show the created exam event in `calendar.google.com`.
5. **Drive AppData Backup & Disconnect:** Click **Backup to Google Drive**, then click **Disconnect Google** to demonstrate token wipe.

---

## 2. CASA Tier 2 Self-Audit Evidence Map

Requesting `gmail.readonly` triggers Google's **Cloud Application Security Assessment (CASA) Tier 2** annual review (mapped to OWASP ASVS Level 2). Because QuizRadar is a local-first client with zero central user database, its attack surface is minimal and every control is verifiable in code:

| CASA / OWASP ASVS Control | QuizRadar Implementation & Verification Evidence |
| --- | --- |
| **V2.1 / OAuth PKCE & CSRF State** | S256 PKCE + 128-bit single-use random `state` with 15-minute expiry (`core/src/auth/pkce.rs`, `core/src/auth/providers.rs`, `OAuthContinuityRegressionTest.kt`). Plaintext non-loopback redirects rejected (`RedirectTarget::classify`). |
| **V3 / Secure Credential Storage** | Zero tokens in SQLite, localStorage, backups, or logs. Desktop uses OS Keyring (`apps/desktop/src-tauri/src/keyring.rs`), Android uses `EncryptedSharedPreferences` (`EncryptedTokenStore.kt`), Web uses memory-only 1h GIS tokens (`browserSources.ts`). |
| **V6 / Data-Only Backups & Share Packs** | `core/src/store/importer.rs` and `export_course_pack` strip tokens, secrets, passwords, and personal grades at compile/type level; verified by unit tests and `tooling/agent-gate.mjs` secret scans. |
| **V9 / Transport Security** | HTTPS-only outbound network calls across Rust core, Desktop, Web, and Android (`android:usesCleartextTraffic="false"`). Ephemeral Desktop LAN sync uses self-signed TLS with SHA-256 cert pinning + single-use 256-bit bearer token (`lan_pair.rs`). |
| **V10 / AI Consent & Stateless Trial Relay** | AI is off by default (`gemini_enabled = false`), guarded in Rust Core (`core/src/ffi.rs`, `commands/ai.rs`), carries verbatim disclosure (`copy.ai.disclosure`), never sends `Authorization: Bearer` to Gemini (`no_authorization_bearer_pattern_in_the_ai_layer`), and the optional Cloudflare Worker (`workers/trial-ai-relay/src/index.ts`) rejects `Authorization` headers (`400`) and persists zero payloads. |
| **V14 / Automated SAST & Dependency Hygiene** | CI runs `cargo clippy --workspace --all-targets -- -D warnings`, `eslint .`, `tsc --noEmit`, `ktlintCheck`, `lintRelease`, `tooling/agent-gate.mjs --ci`, and `cargo test --workspace --locked`. Before CASA scan submission, run `cargo audit` and `pnpm audit --prod`. |

---

## 3. Microsoft Entra ID Multi-Tenant App Registration (1-Tap Teams on All Platforms)

To enable 1-tap Microsoft Teams / Outlook sign-in across **Desktop, Android, and Web/PWA** without requiring students to register their own Azure app:

1. Open **Microsoft Entra Admin Center (`https://entra.microsoft.com`) → Applications → App registrations → New registration**:
   - **Name:** `QuizRadar`
   - **Supported account types:** **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)**
2. Under **Authentication → Add a platform**, register all three **public client** redirect URIs (NO client secret is ever created or needed):
   - **Mobile and desktop applications:**
     - `http://localhost` (Desktop Tauri loopback PKCE)
     - `com.quizradar.app://oauth/microsoft` (Android native Custom Tabs PKCE)
   - **Single-page application (SPA):**
     - `https://thedragonsoft.github.io/QuizRadar/app/` (Production Web Companion PWA)
     - `http://localhost:5173/` (Local Vite dev)
   - Under **Implicit grant and hybrid flows:** leave both checkboxes **unchecked** (QuizRadar uses Auth Code + PKCE exclusively).
3. Under **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, add:
   - `openid`, `profile`, `email`, `offline_access`, `User.Read` (low-consent sign-in stage)
   - `Mail.Read`, `Calendars.Read` (incremental scanning stage)
4. Under **Branding & properties**, set:
   - **Home page URL:** `https://thedragonsoft.github.io/QuizRadar/`
   - **Privacy statement URL:** `https://thedragonsoft.github.io/QuizRadar/privacy/`
   - **Terms of service URL:** `https://thedragonsoft.github.io/QuizRadar/terms/`
   - Complete **Publisher verification** (Microsoft AI Cloud Partner Program MPN ID) to display the blue verified badge on university tenant consent screens.
5. **Bake the Application (client) GUID into all 3 platforms (zero code rewrite required):**
   - **One-step CI configuration:** Add a single public GitHub Actions Repository Variable (`Settings → Secrets and variables → Actions → Variables`) named **`QUIZRADAR_MICROSOFT_CLIENT_ID`** set to your Entra Application (client) GUID. `.github/workflows/release.yml` and `.github/workflows/pages.yml` automatically wire it into all 3 targets:
     - **Desktop release build:** `QUIZRADAR_BUILD_MICROSOFT_CLIENT_ID` (consumed by `apps/desktop/src-tauri/src/state.rs::bundled_microsoft_client_id()`).
     - **Android release build:** `QUIZRADAR_MICROSOFT_CLIENT_ID` or Gradle `-PquizradarMicrosoftClientId=<guid>` (populates `BuildConfig.MICROSOFT_CLIENT_ID`, consumed by `OAuthManager.resolveMicrosoftClientId()`, `MainActivity`, `EngineFfiTokens`, and `BackgroundScanWorker`).
     - **Web / PWA Pages build:** `VITE_MICROSOFT_CLIENT_ID` (consumed by `apps/web/src/pwadapters/browserSources.ts::getDefaultBrowserMicrosoftClientId()`).
   - A user-supplied ID in **Settings → Integrations / Sources** always takes precedence on every platform.
