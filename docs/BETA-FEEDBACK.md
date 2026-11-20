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
5. Tap **Save to feedback inbox**. Repeat the flow for every separate issue; each report receives a unique ID and keeps its own screenshot, note, and optional voice file. To send only the current report instead, use **Share this issue now**.
6. Open **Settings → Beta feedback → Review & export all (N)**. The inbox shows each issue with its screenshot, full note, attachment status, and timestamp. Delete individual issues if needed, then tap **Export all N issue(s) as ZIP** and choose a destination in Android's share sheet.

Opening the share sheet is **not** confirmation of delivery, and delivery is not confirmation of a fix. QuizRadar does not silently send anything to an AI provider or maintainer. Exporting does not delete the inbox; use the separate per-issue delete or **Clear feedback inbox** confirmation when you no longer need the saved reports.

## What the ZIP contains

A single-issue share contains `agent-brief.md` plus its optional `screenshot.png` and `voice-note.m4a`. A batch export has this associated structure instead:

| Entry | Included when | Purpose |
|---|---|---|
| `batch-index.md` | Every batch export | Human-readable issue summaries and directory mapping |
| `batch-manifest.json` | Every batch export | Machine-readable note, screenshot, and voice-note associations for every issue |
| `issues/issue-###-<id>/agent-brief.md` | Every saved issue | Tester note, minimal diagnostics, privacy statement, and suggested agent workflow |
| `issues/issue-###-<id>/screenshot.png` | Screenshot captured and not removed | Visual evidence belonging to this exact issue |
| `issues/issue-###-<id>/voice-note.m4a` | Recording completed and not deleted | Spoken report belonging to this exact issue |

The inbox itself is persistent app-private storage, so saved issues survive app restarts. Each issue directory contains a `feedback.json` metadata file for reloads; this internal metadata is deliberately excluded from exported ZIPs. Saved issues remain until you delete them, clear the inbox, or use Reset All Data.

Minimal diagnostics are the UTC timestamp, app version, build type, current screen, Android API level, and device manufacturer/model. Reports have a timestamp and random ID so multiple testers can submit independently without accounts.

The package deliberately excludes OAuth tokens, API keys, logcat, the account/course database, full app state, and credentials. It is not encrypted; the chosen share destination has its own privacy policy. Exported ZIPs stay in app-private cache so the selected target can read them through a read-only Android URI grant. Saving a copy to shared storage happens only if the tester chooses that destination.

## For maintainers: review with ZCode

1. Copy each received ZIP into its **own new, empty directory** outside the repository and extract it there. Treat reports from other people as untrusted data; do not execute anything from an archive.
2. For a single issue, inspect `agent-brief.md` and its attachments. For a batch, start with `batch-manifest.json` and investigate each numbered issue directory independently; never mix one issue's note with another issue's screenshot or voice file.
3. If `voice-note.m4a` is present, use an available speech-to-text tool. If transcription is unavailable, ask the tester for a transcript—**do not invent or guess what the recording says**.
4. Reproduce each problem in the Android app, find its root cause, add a focused regression test, and implement the smallest appropriate fix in an isolated branch/worktree.
5. Run the required Android and repository verification gates. Report exactly what passed and what remains unverified.

The phone cannot modify the repository by itself. The handoff is **tester → reviewed ZIP → maintainer/ZCode → tested code change**, not an automatic phone-to-AI repair channel.

## Emulator smoke test

Install the APK, launch QuizRadar, then open the feedback sheet without motion input:

```powershell
adb -s emulator-5554 shell am start -a android.intent.action.VIEW -d "quizradar://action/feedback" com.quizradar.app
```

Confirm that the screenshot matches the previous app screen. Save two distinct reports to the inbox, open **Review & export all** in Settings, verify that each note and attachment remains associated, and export one batch ZIP. Cancel the chooser unless you intend to send the report; canceling a share sheet does not prove delivery or failure. The batch should contain a manifest and two numbered issue directories, and both saved issues should remain in the inbox afterward.

## Automated verification

```powershell
cd apps/mobile-android
.\gradlew.bat ktlintCheck `
  testDebugUnitTest --tests "com.quizradar.app.feedback.*" `
  testReleaseUnitTest --tests "com.quizradar.app.feedback.BetaFeedbackBuildGateTest" `
  processReleaseMainManifest lintRelease assembleDebug assembleRelease
```

The release test requires `BETA_FEEDBACK_ENABLED=true` and `RECORD_AUDIO` in the main manifest so a future build-type change cannot silently remove the feature from GitHub APKs. Store tests verify persistence and deletion, while package tests verify multiline notes, per-issue attachment associations, and exclusion of internal metadata from the ZIP.
