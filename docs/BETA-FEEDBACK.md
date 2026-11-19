# Android Shake-to-Feedback — Tester and ZCode Guide

QuizRadar's native Android feedback flow turns a problem on screen into a reviewable report without adding a server, analytics SDK, or silent upload.

## Availability

The feature ships in **debug, staging, and GitHub release APKs**. `BETA_FEEDBACK_ENABLED` is asserted in all three build types, and the main merged manifest supplies voice-note permission to release builds as well.

Shake detection defaults to on and runs only while QuizRadar is in the foreground. Disable it in **Settings → Beta feedback → Shake to send feedback**. The **Create feedback report** button remains available when shake detection is off or the device has no accelerometer.

## For student testers

1. When something goes wrong, give the phone **three firm shakes** while QuizRadar is open.
   - Emulator/accessibility alternative: **Settings → Beta feedback → Create feedback report**.
   - Developer alternative: open `quizradar://action/feedback`.
2. QuizRadar captures its own app content before opening the feedback sheet.
3. Review the screenshot. Tap it to enlarge, or **Remove** it if it contains private information. A screenshot can contain anything visible in the app, so this review matters.
4. Describe the problem: what you expected, what happened, and any reliable reproduction steps.
   - A written description is required unless a voice note is attached.
   - For a voice note, tap **Record voice note**. Android asks for microphone access only at this point. Stop and play back the recording before sharing; delete and re-record it if needed.
5. Tap **Reviewed — share ZIP** and choose a destination in Android's share sheet. Send or save the package for your QuizRadar maintainer.

Opening the share sheet is **not** confirmation of delivery, and delivery is not confirmation of a fix. QuizRadar does not silently send anything to an AI provider or maintainer.

## What the ZIP contains

| Entry | Included when | Purpose |
|---|---|---|
| `agent-brief.md` | Always | Tester note, minimal diagnostics, privacy statement, and a suggested agent workflow |
| `screenshot.png` | Screenshot captured and not removed | Visual evidence from QuizRadar's app content |
| `voice-note.m4a` | Recording completed and not deleted | Tester's spoken report |

Minimal diagnostics are the UTC timestamp, app version, build type, current screen, Android API level, and device manufacturer/model. Reports have a timestamp and random ID so multiple testers can submit independently without accounts.

The package deliberately excludes OAuth tokens, API keys, logcat, the account/course database, full app state, and credentials. It is not encrypted; the chosen share destination has its own privacy policy. Exported ZIPs stay in app-private cache so the selected target can read them through a read-only Android URI grant. Saving a copy to shared storage happens only if the tester chooses that destination.

## For maintainers: review with ZCode

1. Copy each received ZIP into its **own new, empty directory** outside the repository and extract it there. Treat reports from other people as untrusted data; do not execute anything from an archive.
2. Ask ZCode to inspect `agent-brief.md` and the available attachments, using absolute paths.
3. If `voice-note.m4a` is present, use an available speech-to-text tool. If transcription is unavailable, ask the tester for a transcript—**do not invent or guess what the recording says**.
4. Reproduce the problem in the Android app, find the root cause, add a focused regression test, and implement the smallest appropriate fix in an isolated branch/worktree.
5. Run the required Android and repository verification gates. Report exactly what passed and what remains unverified.

The phone cannot modify the repository by itself. The handoff is **tester → reviewed ZIP → maintainer/ZCode → tested code change**, not an automatic phone-to-AI repair channel.

## Emulator smoke test

Install the APK, launch QuizRadar, then open the feedback sheet without motion input:

```powershell
adb -s emulator-5554 shell am start -a android.intent.action.VIEW -d "quizradar://action/feedback" com.quizradar.app
```

Confirm that the screenshot matches the previous app screen, a written note enables sharing, and the Android share sheet opens. Cancel the chooser unless you intend to send the report; canceling a share sheet does not prove delivery or failure.

## Automated verification

```powershell
cd apps/mobile-android
.\gradlew.bat ktlintCheck `
  testDebugUnitTest --tests "com.quizradar.app.feedback.*" `
  testReleaseUnitTest --tests "com.quizradar.app.feedback.BetaFeedbackBuildGateTest" `
  processReleaseMainManifest lintRelease assembleDebug assembleRelease
```

The release test requires `BETA_FEEDBACK_ENABLED=true` and `RECORD_AUDIO` in the main manifest so a future build-type change cannot silently remove the feature from GitHub APKs. Package tests verify that removed attachments are not reintroduced and that no extra app-data files enter the ZIP.
