# OAuth Verification & First-Party Client Runbook

_Maintainer submission package for Google OAuth Restricted-Scope Verification (CASA Tier 2) and Microsoft Entra ID Multi-Tenant Publisher Verification._

---

## 1. Google OAuth Consent Screen & Brand Verification

Configure in **Google Cloud Console → APIs & Services → OAuth consent screen** (External / Production):

| Field | Exact Value |
|---|---|
| **App name** | `QuizRadar` |
| **Homepage** | `https://thedragonsoft.github.io/QuizRadar/` |
| **Privacy Policy** | `https://thedragonsoft.github.io/QuizRadar/privacy/` |
| **Terms of Service** | `https://thedragonsoft.github.io/QuizRadar/terms/` |
| **Authorized domains** | `thedragonsoft.github.io` (and `quizradar.app` if/when custom domain is active) |

Both `/privacy/` (containing the verbatim Google API Services User Data Policy — Limited Use disclosure) and `/terms/` are hosted on the same domain from `apps/landing/src/pages/`.

### Scope Justifications (defined once in `core/src/auth/providers.rs`)

1. `gmail.readonly` *(Restricted)*: On explicit user request ("Scan"), queries Gmail directly from the student's device using narrow academic filters to resolve announced deadlines against the local timetable. Read-only; never modifies/sends emails or stores them on a server.
2. `classroom.courses.readonly` & `classroom.coursework.students` *(Sensitive)*: Lists enrolled Google Classroom courses and due dates on-device for the unified radar.
3. `calendar.events` *(Sensitive)*: Solely on explicit user push to create/update upcoming exam events on the student's primary calendar.
4. `drive.appdata` *(Non-sensitive)*: Optional data-only JSON backup/restore in hidden `appDataFolder` (tokens stripped prior to serialization).
5. `userinfo.email` & `userinfo.profile` *(Non-sensitive)*: Displays connected account identity in Settings.

### Verification Demo Video (Unlisted YouTube, English, ≤ 3 min)

Show continuously: (1) homepage → footer `/privacy/` Limited Use disclosure; (2) Connect Google pausing 3s on the consent URL showing `client_id` + scopes; (3) Scan Now resolving Gmail announcements onto Radar; (4) Classroom item + Push to Google Calendar; (5) Drive AppData backup + Disconnect token wipe.

## 2. CASA Tier 2 Self-Audit Evidence Map (OWASP ASVS L2)

| Control | Implementation & Verification |
|---|---|
| **V2.1 PKCE & CSRF** | S256 PKCE + 128-bit single-use `state` (15-min expiry) in `core/src/auth/`; rejects plaintext non-loopback redirects. |
| **V3 Secret Storage** | OS Keyring (`keyring.rs`), Android `EncryptedSharedPreferences` (`EncryptedTokenStore.kt`), PWA 1h memory-only GIS tokens. |
| **V6 Data-Only Exports** | `importer.rs` and `export_course_pack` strip tokens/secrets/grades at type level; enforced by `tooling/agent-gate.mjs`. |
| **V9 Transport** | HTTPS-only outbound calls (`usesCleartextTraffic="false"`); ephemeral LAN sync uses SHA-256 cert pinning + single-use 256-bit bearer token. |
| **V10 AI Consent** | AI off by default; verbatim disclosure (`copy.ai.disclosure`); zero `Authorization: Bearer` AI calls; stateless Trial Relay rejects `Authorization` (`400`). |
| **V14 SAST & Hygiene** | CI runs `clippy -D warnings`, `eslint`, `tsc --noEmit`, `ktlintCheck`, `lintRelease`, `agent-gate.mjs --ci`. Run `cargo audit` & `pnpm audit --prod` before submission. |

## 3. Microsoft Entra ID Multi-Tenant Registration

1. **Entra Admin Center → App registrations → New registration:** Name `QuizRadar`, Multitenant + personal Microsoft accounts.
2. **Authentication (public client — no client secret):**
   - Mobile & desktop: `http://localhost` (Desktop Tauri), `com.quizradar.app://oauth/microsoft` (Android Custom Tabs).
   - Single-page application: `https://thedragonsoft.github.io/QuizRadar/app/`, `http://localhost:5173/`.
   - Leave Implicit/Hybrid checkboxes **unchecked** (Auth Code + PKCE only).
3. **Graph Delegated Permissions:** `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Mail.Read`, `Calendars.Read`.
4. **Branding:** Set Homepage, Privacy, Terms URLs as above and complete MPN Publisher Verification.
5. **CI Injection:** Set GitHub Actions variable `QUIZRADAR_MICROSOFT_CLIENT_ID` to the Entra GUID; `release.yml` and `pages.yml` inject it into Desktop (`QUIZRADAR_BUILD_MICROSOFT_CLIENT_ID`), Android (`BuildConfig.MICROSOFT_CLIENT_ID`), and Web (`VITE_MICROSOFT_CLIENT_ID`). User-supplied IDs in Settings always win.
