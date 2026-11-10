---
bump: minor
surfaces: [android]
agent: antigravity
branch: fix/android-google-oauth-redirect
date: 2026-11-10
---

### Summary

fix(android): resolve Google OAuth 400 invalid_request error by using RFC 3986 package-path custom scheme (com.quizradar.app:/oauth/google)

### Verification

- cd apps/mobile-android && ./gradlew ktlintCheck testDebugUnitTest
- tested live with Google OAuth authorization endpoint

### Handoff / Follow-ups

- None - Google sign-in passes authorization policy check cleanly on Android
