# Phase 12 — Android app scaffold: Gradle, Compose skeleton, UniFFI-core bindings

> After phase 04 (store) merged. Runs in parallel with 05–11 as CI allows. Android-only forever; no iOS codepaths.

**Read first:** `AGENTS.md` §0 locked table (mobile row wins) + §5 env; `docs/rebuild/04-rebuild-architecture.md` §4.1 (mobile layout) + §0 mobile decisions; `docs/rebuild/01-product-spec.md` §5 MobileNav/mobile behaviors list.

**Reference implementation:** v4 Android native code — `git show v4-final:android/app/src/main/java/com/quizradar/app/MainActivity.java` (bridge discipline: which things must be kept OUT of any webview layer is the lesson; to be REPLACED by direct Compose consumption of UniFFI core), `git show v4-final:android/app/src/main/java/com/quizradar/app/QuizRadarWidgetProvider.java` (widget data contract, recreated via Glance in phase 14).

## Build

1. `apps/mobile-android/` Kotlin 2.x + AGP 8.5+ (gradle wrapper committed), compileSdk 35 / minSdk 26 / target 35; compose BOM; M3; `com.quizradar.app`; permissions: INTERNET, POST_NOTIFICATIONS (runtime request); `usesCleartextTraffic=false` (HTTPS only, better than v4).
2. **UniFFI bindings**: enable `quizradar-core` `uniffi` feature + `bindings/uniffi.toml` generating `quizradar_core.uniffi.kt`; integrate via gradle task (externalNativeBuild or preBuild copy from CI artifact; document honestly). Kotlin wrapper `QuizRadarEngine` exposing suspend fns (UniFFI async) with a `TokenProvider`/`HttpClient` Kotlin implementation of the core's traits (refresh handled here; tokens in **EncryptedSharedPreferences at app-private scope**).
3. Compose skeleton: `MainActivity` with `QuizRadarTheme` (map `01` §6 palette to Compose M3 color schemes), 3-tab bottom nav scaffold (dash/tasks/calendar + Focus) with placeholder honest-empty screens; system back handling through Compose predictive-back default (deletes v4's hand-rolled modal stack contract).
4. **Preview/qc**: `preview-android/screens` script optional; app icon generation via `sharp` in tooling (NOT python/Edge — tooling makes mipmaps from an provided SVG; if source absent, honest placeholder icons + STATUS note).
5. CI: extend `.github/workflows/ci.yml` android job: `gradlew ktlint` + `gradlew assembleDebug` + native unit tests; cache gradle + rust target.
6. STATUS §Commands: record gradle/uniffi commands (from clean-machine instructions).

## Acceptance
- [ ] `gradlew assembleDebug` locally green (or honest blocker recorded + CI-green required before phase 13)
- [ ] `QuizRadarEngine` Kotlin bindings compile + smoke test (call core `version()` from Kotlin) in androidTest/robolectric
- [ ] ktlint clean; no cleartext traffic allowed in manifest; no secrets in repo
- [ ] STATUS updated; phase 12 ticked

## Commit
`phase(12): android scaffold + uniFFI core bindings + compose skeleton`
