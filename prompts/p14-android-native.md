# Phase 14 — Android native edge: OAuth, widget, share ingest, notifications

> After phase 13. All native Android capabilities are built natively in Kotlin (maintainer decision) — this phase replaces every v4 `MainActivity/LocalOAuthServer/WidgetProvider/FGS` behavior with a proper implementation.

**Read first:** `AGENTS.md` §3 (no secrets) + §8; `docs/rebuild/04-rebuild-architecture.md` §4.3 (Android = custom-scheme PKCE, no loopback server), §5 (deleted: FGS + loopback server); `docs/rebuild/01-product-spec.md` §4.8 (notifications/widget/share/back-button/their exact behaviors + the `com.quizradar.app://` deep links). V4 honest reference: `git show v4-final:android/app/src/main/java/com/quizradar/app/OAuthSigninService.java` (only as a record of why FGS is NOT needed with custom schemes).

## Build

1. **PKCE OAuth, custom scheme** `com.quizradar.app://oauth/google` + `microsoft`:
   - Register URL intents only; `CustomTabsIntent` for the browser step; token exchange INSIDE the existing UniFFI `auth::providers` core functions (no Java crypto) using the code+verifier from Kotlin state; access token kept in memory by the Kotlin engine wrapper; refresh token encrypted in EncryptedSharedPreferences.
   - DELETES the v4 loopback `LocalOAuthServer` pattern completely: no foreground service, no `127.0.0.1:3000`, no specialUse FGS in the manifest — assert these absent in review.
2. **Glance countdown widget** `QuizRadarWidgetReceiver` + Glance `2x1` (v4 parity: course color bar, title, date, TODAY/Tomorrow/in Xd badge states via core field `widget_badge` computed in core from next-up assessment; update when data changes + a battery-conscious WorkManager 30-min periodic tick; widget data flows from the engine directly — no JS-style window bridge needed since Compose owns the UI).
3. **Share-sheet ingest**: manifest ACTION_SEND text/plain → route straight to a dedicated Compose "New Event" screen intent extra (`subject/text` with Gmail's `subject\n\ntext` split) → pre-filled create-event flow → save via core.
4. **Notifications** (first-party, no plugin): `ExamReminderWorker` (WorkManager) computing today/tomorrow T-24h + morning digests from core data (reuse phase-06/04/planning outputs via engine wrapper; FNV/hash id = core-provided `notification_id` for dedupe); permissions runtime requested; settings toggles (exams/digest + digest hour) wired to store; ≤48 nearest policy honored.
5. **Back-button + predictive back** handling inside Compose (sheet hierarchy closure) — replaces v4's hardcoded 11-modal close stack; deep-link `com.quizradar.app://pair` and `oauth/cancelled` handled via navigation destinations with honest cancel toasts.
6. Integration tests (instrumented if emulator available in CI, else Robolectric): OAuth token flow against mock IdP (wiremock), widget render after data change, notification scheduling math, share-ingest parse.

## Acceptance
- [ ] Instrumented/Robolectric tests: 4 green (oauth quiet flow, widget data contract, notif math, share ingest)
- [ ] Manifest inspection: zero `usesCleartextTraffic`, zero FGS specialUse, zero `android.intent.action.VIEW` on `http` schemes — grep-tested
- [ ] Widget visible on an API-34 emulator/screencap if available (STATUS note else)
- [ ] No client_secret strings anywhere in the APK (CI string-check job)
- [ ] STATUS updated; phase 14 ticked

## Commit
`phase(14): android native edge (pkce custom-scheme oauth, glance widget, share ingest, notifications)`
