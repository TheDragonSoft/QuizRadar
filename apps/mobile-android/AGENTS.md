# apps/mobile-android — Android surface guide

Scoped extension of the **root `AGENTS.md`** — read it first. Android-only,
forever (root §0): Kotlin + Jetpack Compose M3 (+ Glance widget), bound to the
pure `core/` crate via UniFFI.

## Scope & boundaries

- UI and shell glue only — parsing, planning, conflicts, storage belong in
  `core/`. The Kotlin tier must not reimplement core logic.
- After `core/src/types.rs` or `core/src/ffi.rs` changes, regenerate bindings
  **immediately**: `.\gradlew.bat uniffiGenerate` (root §6.2).
- Tokens live in **EncryptedSharedPreferences** (AES256-GCM); OAuth is a PKCE
  public client with a custom scheme — the bundled Google **client id** ships,
  **no client secret ever** (root §3.2 amendment). A user-supplied id wins.

## Non-negotiables

- **No telemetry/analytics** (root §9). Don't add `track*` calls or an
  `AnalyticsManager` — if you find one, delete it.
- **Honesty copy**: a missing room or field renders the spec's placeholder,
  never a plausible default (root §3.1).
- **No vendored/extracted dependency sources in the repo** — no
  `m3extract/`-style scratch dirs of unzipped jars; keep reference study
  material outside the repo.
- Deep link `quizradar://action` and the OAuth redirect handler must never
  perform destructive actions or sync without confirmation.

## Commands

```powershell
.\gradlew.bat ktlintCheck testDebugUnitTest   # from apps/mobile-android
.\gradlew.bat assembleDebug
.\gradlew.bat uniffiGenerate                  # after core contract changes
```

## UI previews & screenshots

- Screens take the shared `QuizRadarViewModel`, so full-screen `@Preview`s need
  a factory — prefer **leaf-component previews** (params-only composables) in
  the debug source set (`app/src/debug/java/...`), which never ships.
- **JVM screen captures** (no emulator): `AndroidUiCaptureTest` renders the
  production screens with Robolectric native graphics + the REAL Rust-backed
  ViewModel (in-memory engine, seeded with relative dates) and writes PNGs to
  `apps/web/public/android-ui/`, where the web workbench's
  `Phone (Android app)/` section displays them. Regenerate:
  `.\gradlew.bat testDebugUnitTest --tests "*AndroidUiCaptureTest*"`.
  The PNGs are machine-local and gitignored (root §3.8).
- **Before/after for Compose changes**: before editing, copy
  `apps/web/public/android-ui/` to `target/android-ui-before/`; after the
  change, re-run the capture test, then
  `node tooling/ui-compare.mjs target/android-ui-before apps/web/public/android-ui`
  and open `target/ui-compare/index.html` — the maintainer sees the visual
  diff. (Full flow incl. web tier: `apps/web/AGENTS.md` → Before/after.)
- Real-device/emulator captures for docs go through the maintainer's tooling —
  don't commit screenshot PNGs (root §3.8).
