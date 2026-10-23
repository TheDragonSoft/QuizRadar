# Phase 15 — Release engineering + CI pipeline

> After 11 + 14. Replaces v4's hand-painted release with a single generated pipeline. Version/source-of-truth and updater signatures land here.

**Read first:** `AGENTS.md` §6 (commit/CI discipline); `docs/rebuild/04-rebuild-architecture.md` §4.8 (pipeline contract); `docs/rebuild/02-current-architecture.md` §8 (v4 pipeline to NOT repeat: debug-only APK, unsigned everything, filename-fragile updater, 4× duped version steps); `docs/rebuild/03-issues-and-pain-points.md` §D (release issues list is the anti-checklist).

## Build

1. **Version pipeline**: `tooling/version.json` remains the ONLY bump point; `generate-version.mjs --apply` writes package.json + tauri.conf + gradle versionCode/Name + SW cache key + core `CARGO_PKG_VERSION` via build.rs passthrough; CI gate `--check`.
2. **Release workflow** `.github/workflows/release.yml` triggered on tag `v*`:
   - Desktop: `cargo tauri build` matrix (windows-latest: NSIS + portable zip; macos-latest: dmg; ubuntu-latest: deb + appimage optional) — updater artifacts in `latest.json` format for tauri-plugin-updater with **signing keys from repo secrets** (workflow documents key generation one-time, never commits keys).
   - Android: `assembleRelease` **signing a real keystore stored in repo (encoded) secrets (not in repo)** + `bundleRelease` AAB optional; version-code monotonic from version tooling.
   - Web/PWA: build + deploy to GH Pages (site URL becomes the real one — fixes v4 404 updater/link era; document in release notes template).
   - sha256 manifest generated; PR CI (already wired phase 01) must be the gate; release notes template driven by CHANGELOG (`tooling/` conventions: write CHANGELOG.md from merged phase commits since last tag + maintainer notes section).
3. **Updater honesty rule** (anti v4 `03` §D7): updater check hits `releases/latest` but marketplace-independent with explicit error when repo unreachable ("Update check unavailable — github link down"); ensure notes match explicit release URL; tests documented in STATUS.
4. **Secrets hygiene**: release.yml uses per-job least permissions; no `GITHUB_TOKEN` write except contents for release publish; updater private key NEVER in workflow logs (mask).
5. Manual runbook: `docs/STATUS.md` §Release-runbook (keys to generate once, how to rotate, how to test updater via `tauri dev --preview`).

## Acceptance
- [ ] Dry-run release on a pre-release tag in CI: all four artifacts produce + sha256 + latest.json; updater dry-check passes
- [ ] APK artifact is signed (verify via `apksigner verify`); unique versionCode bump tested on an increment
- [ ] `generate-version.mjs --check` gate fails when someone hardcodes a version (self-test proves)
- [ ] STATUS updated; runbook complete

## Commit
`phase(15): release pipeline (signed tauri updater, release apk, pwa deploy, notes)`
