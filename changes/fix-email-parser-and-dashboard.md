---
bump: patch
surfaces: [core]
agent: zcode
branch: fix/email-parser-and-dashboard
date: 2026-11-15
---

### Summary

Follow-up to the email hardening branch: rescue real assessment emails from the new survey/grade/org-event filters. Survey-phrase and bare-word survey hits now honor a subject_has_core_assessment escape; subject result/results/grades/marks notices reject only when no remake is announced AND no scheduling language coexists with a core assessment word (combined 'Quiz 3 grades - Quiz 4 moved to Sunday' emails stay candidates, 'Midterm Exam grades posted' stays rejected); org-event branding matches sender/subject only so a body-only 'cc: student affairs' footer can no longer drop a course quiz. Adds a_core_assessment_subject_survives_survey_grade_and_org_filters covering all three rescues plus preserved rejections.

### Verification

- cargo fmt --all --check
- cargo clippy -p quizradar-core --all-targets -- -D warnings
- cargo test -p quizradar-core (359 unit + all property/fixture suites, 0 failed)

### Handoff / Follow-ups

- Original branch gates (workspace clippy/test, web, android) were run pre-push by the author and are green in CI. Two pre-existing main-branch CI failures remain for tooling follow-up: ci.yml android-emulator script runs each line as a separate sh -c (cd does not persist, ./gradlew not found) and the browser visual baselines need a --update-snapshots refresh after the intentional dashboard UI changes.
