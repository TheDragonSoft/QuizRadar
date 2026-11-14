---
bump: patch
surfaces: [core, desktop, android, web]
agent: antigravity
branch: fix/google-oauth-connection-state
date: 2026-11-14
---

### Summary

Fix post-sign-in OAuth connection state, profile hydration, and toast visibility across Android, core FFI, and Desktop. On Android, SettingsScreen, AppScaffold, SetupChecklistCard, and DashboardScreen subscribe reactively to StateFlow connection flags instead of non-reactive point-in-time reads; OAuthManager.handleRedirect persists expires_in and hydrates signed-in Google/Microsoft profile metadata; EncryptedTokenStore commits refresh tokens synchronously; QuizRadarViewModel.refreshState reloads profile and OAuth client ID state; and OnboardingWizardScreen and SettingsScreen mount SnackbarHost so OAuth feedback displays in place. Core FFI exchange_oauth_code formats provider errors via explain_oauth_error, and Desktop loopback listeners ignore empty preconnects and non-OAuth GET probes and hydrate Google userinfo on the fallback retry branch.

### Verification

- node tooling/generate-version.mjs --check
- node apps/web/src/contract/regenerate.mjs --check
- cargo fmt --all --check
- cargo clippy --workspace --all-targets -- -D warnings
- cargo test --workspace
- pnpm --dir apps/web build:wasm
- pnpm format:check
- pnpm lint
- pnpm typecheck
- pnpm test:tooling
- pnpm test
- pnpm --dir apps/web exec playwright test --grep-invert @visual
- ./gradlew ktlintCheck testDebugUnitTest assembleDebug uniffiGenerate (205 passed)

### Handoff / Follow-ups

- No physical Android device or emulator was attached locally (adb devices -l empty), so live interactive Google sign-in on device remains verified via Robolectric/MockServer, ViewModel, and Compose UI tests plus CI emulator checks.
