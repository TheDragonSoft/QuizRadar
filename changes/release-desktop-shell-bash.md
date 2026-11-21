---
bump: none
surfaces: [ci]
agent: zcode
branch: ci/release-desktop-shell
date: 2026-11-21
---

### Summary

Fix the Windows desktop release leg: the v5.20.0 tag build failed the 'require updater signing credentials' guard with a PowerShell ParserError because the step is written in bash (if [ -z ...]) but release.yml's desktop job declares no default shell, so windows-latest ran it under pwsh. The TAURI_SIGNING_PRIVATE_KEY secret is present and masked in the run log - the guard never got to evaluate it. Set defaults.run.shell=bash for the whole desktop job (macOS/Linux were already bash by default; the one pwsh step, Stage Windows Portable ZIP, keeps its explicit shell: pwsh override).

### Verification

- Reviewed every run: step in the build-desktop job for shell compatibility (grep/apt/pnpm/cargo/for-loops are bash-safe, staging step explicitly pwsh)
- yaml structure validated by the CI hygiene gate

### Handoff / Follow-ups

- After merge, move the v5.20.0 tag to the fixed main head and re-push it so the release pipeline republishes (the current tag e6e0f65 embeds the broken workflow)
- no GitHub Release was published for v5.20.0 yet (publish step was skipped)
