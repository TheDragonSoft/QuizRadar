---
target: Android app (apps/mobile-android)
total_score: 27
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
target_identity: "file:D:\\Projects\\QuizRadar\\apps\\mobile-android"
timestamp: 2026-11-04T23-31-31Z
slug: apps-mobile-android
---

# QuizRadar Android UI/UX Critique (apps/mobile-android)

Method: design review only (detector not applicable, native platform). Live walkthrough on emulator-5554: full onboarding (4 steps), Dashboard, Tasks, Calendar, Focus, Practice Quiz, Add-menu, Search, Settings, light + dark, plus code-level checks.

## Ratings by base

- Visual design & aesthetics: 7/10 — on-token, clean cards, starry-sky dark hero; onboarding step 3 mostly dead space
- Navigation & IA: 7/10 — bottom nav + drawer + sheets sound; "Import Backup File" under the Add menu
- Onboarding & task flows: 6/10 — step 3 connect action invisible; step 2 routes core import to Settings; primary CTA is the negative path
- Feedback & empty states: 6.5/10 — honest counts, but dead-end empties and a spurious toast
- Accessibility: 8/10 — labeled icon buttons, stateDescription for connected dot, closed drawer invisibleToUser, contrast-documented StatusColors
- Copy & clarity: 6/10 — "OAuth client ID", "BYOK", ASCII "->", misattributed empty-state copy
- Consistency & platform fit: 7/10 — adaptive rail ≥600dp, 840dp cap, predictive back; checklist rows render inconsistently
- Error handling & honesty: 8/10 — Retry on load error, drafts preserved on failed save, honest no-op scans
  Overall: 6.9/10 — 27/40 Nielsen ("Good", low end).

## Nielsen heuristics (0-4)

1 Visibility of system status 3 — sync spinner + toasts; no per-source scan progress on mobile
2 Match system & real world 3 — student language good; OAuth client ID / BYOK jargon
3 User control & freedom 3 — Skip everywhere; back stack reverse order; sheets dismiss
4 Consistency & standards 3 — checklist row layouts differ; settings rows collide with controls
5 Error prevention 3 — debounced autosave; draft-preserving event sheet
6 Recognition over recall 2 — step 3 primary action has no visible affordance; AI import hidden in Settings
7 Flexibility & efficiency 2 — search exists; no quick actions; widget pin only accelerator
8 Aesthetic & minimalist 3 — clean; step-3 dead space and clipped rows cost it
9 Error recovery 3 — Retry button; causes named in toasts
10 Help & documentation 2 — no Help entry in drawer; onboarding only guidance
Total: 27/40.

## Design specificity

Authored: token theme faithfully ports the web tokens (same hexes; documented contrast math in QuizRadarTheme.kt:107-129), real radar squircle mark, dark hero starfield. Detector: not applicable (native).

## Priority issues

1. [P1] Onboarding step 3: connect action invisible — cards not clickable, hit target is a ~126px unlabeled strip at the card's right edge (x≈922-1048). Fix: whole card clickable + visible "Connect" trailing button; halve dead space. (OnboardingWizardScreen.kt step-3 cards) — adapt
2. [P1] Text collides with trailing controls (recurring): SetupChecklistCard.kt:140-152 (OAuth row) and Settings "Background scan" row, in light and dark. Fix: fixed lane for trailing control, text weight(1f) with end padding, shorten copy. — layout
3. [P1] Step 2 routes the core action out of the wizard ("open Settings -> AI Course Import"); primary CTA labeled "Continue Without Courses". Fix: inline AI import + Add Course in step 2; retitle primary "Continue". — onboard
4. [P2] Spurious "Gemini key removed" toast: OnboardingWizardScreen.kt:836 calls saveGeminiApiKey(keyInput) default announce=true; empty field announces a removal that never happened. Fix: announce=false when unchanged/empty (:814 precedent).
5. [P2] Empty states honest but passive: Tasks "No exams matching this course filter." with zero courses (wrong attribution); Practice Quiz no CTA; Calendar blank grid. Fix: port web's four-state pattern + CTAs. — onboard
6. [P3] Copy polish: replace ASCII "->" with "→"; move Import Backup File out of Add menu; relabel BYOK field.

## Persona red flags

- Jordan: taps the big Google card, nothing happens; stalls on "OAuth client ID".
- Casey: thumb zone fine; wizard primary CTA below the fold on step 3.
- Riley: "course filter" copy fails the promise-vs-reality test.

## Strengths

- Honesty as designed system (counts, named failures, no fake success).
- Token + motion foundation shared with web; documented contrast ratios.
- Android a11y discipline in code (semantics, state descriptions, theme-aware status colors).

## Questions to consider

- Should empty states celebrate the first catch instead of only announcing absence?
- What would a visible Connect affordance on step 3 change for first-run conversion?
