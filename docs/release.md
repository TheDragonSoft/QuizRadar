# Release & Signing Runbook

_Zero-server binary releases with platform-native signing, Forgejo-first git mirroring, and automated SemVer rollups._

---

## 1. Day-to-Day Versioning & Release Flow

1. **Feature branches:** Never edit `tooling/version.json` or `CHANGELOG.md`. Commit a conflict-free fragment under `changes/<slug>.md` via `pnpm agent:note ...` and push to **`origin` (Forgejo)** (auto-mirrored to GitHub; see [ADR-0004](./adr/0004-forgejo-first-git-and-ci.md)).
2. **Merge to `main` (`.github/workflows/version-bump.yml`):**
   - Runs `node tooling/version-rollup.mjs --apply` to compute the highest SemVer bump across `changes/*.md` and Conventional Commits.
   - Updates `tooling/version.json`, all 5 version sinks (`apps/web/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, `Cargo.toml`, `apps/mobile-android/app/build.gradle.kts`, `apps/web/src/generated/version.ts`), `Cargo.lock`, `CHANGELOG.md`, and `docs/STATUS.md`; archives consumed fragments into `docs/worklog/YYYY-MM.md`.
   - If branch protection rejects a direct push to `main`, the workflow falls back to opening a `chore/release-rollup-vX.Y.Z` PR.
3. **Cutting a binary release (`.github/workflows/release.yml`):**
   - Push an annotated tag to Forgejo: `git tag -a vX.Y.Z -m "Release vX.Y.Z" && git push origin vX.Y.Z`. Forgejo mirrors the tag to GitHub, triggering `release.yml`.
   - `node tooling/validate-release.mjs --tag vX.Y.Z` enforces `tag == "v" + tooling/version.json` and classifies prereleases (`alpha`, `beta`, `rc`).
   - Builds updater-signed Desktop installers (Windows NSIS + portable zip, macOS DMG, Linux deb/AppImage), signed Android APK/AAB (`apksigner verify` mandatory — unsigned APKs are refused), deploys PWA to GitHub Pages, generates `SHA256SUMS.txt` + Tauri `latest.json`, and publishes the GitHub Release with `node tooling/generate-changelog.mjs --notes-only`.
   - **Note:** Desktop signing is Tauri updater minisign signatures, not Windows Authenticode or Apple notarization.

## 2. Signing Keys & CI Secrets (One-Time Setup)

- **Desktop Tauri Updater Keypair:**
  1. Generate: `cargo tauri signer generate -w quizradar.key` (never commit `quizradar.key`).
  2. Put the public key in `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
  3. Store private key in GitHub Secret `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if set).
- **Android Release Keystore:**
  1. Generate: `keytool -genkeypair -v -keystore quizradar-release.keystore -alias quizradar -keyalg RSA -keysize 2048 -validity 10000`.
  2. Base64-encode and set GitHub Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- **Key Rotation:** For Desktop updater keys, ship a bridge release or notify users on GitHub Releases before switching `pubkey`. For Android sideloading, users must reinstall on key change (or use Play App Signing).

## 3. Local Dry-Run Commands

```bash
pnpm version:dry-run                                                       # preview SemVer bump & changelog
node tooling/generate-version.mjs --check                                  # verify 5 version sinks
node tooling/validate-release.mjs --tag v5.20.0                            # validate tag & prerelease rules
node tooling/generate-changelog.mjs --notes-only                           # preview tag-scoped release notes
node tooling/generate-updater-manifest.mjs --dry-run --version 5.20.0 --output target/test-latest.json
```
