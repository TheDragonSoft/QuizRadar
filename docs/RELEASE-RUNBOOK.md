# Release & Signing Runbook

QuizRadar requires **zero** backend servers and uses platform-native signing plus automated SemVer rollups.

---

## 1. How Versioning Works Day-to-Day (Multi-Agent Flow)

1. **On feature/fix branches:** Agents **never** edit `tooling/version.json` directly (preventing 5-sink merge conflicts across parallel worktrees). Instead, each branch commits a conflict-free handoff & version fragment under `changes/<slug>.md` via:
   ```powershell
   pnpm agent:note --bump <patch|minor|major|none> --surfaces <core,web,...> --agent <name> --summary "..." --verify "..."
   ```
2. **On merge to `main` (`.github/workflows/version-bump.yml`):**
   - Automatically runs `node tooling/version-rollup.mjs --apply`.
   - Computes the highest SemVer bump across `changes/*.md` fragments and Conventional Commits since the last `tooling/version.json` bump.
   - Updates `tooling/version.json`, stamps all 5 version sinks (`apps/web/package.json`, `apps/desktop/src-tauri/tauri.conf.json`, `Cargo.toml`, `apps/mobile-android/app/build.gradle.kts`, `apps/web/src/generated/version.ts`), updates workspace crate versions in `Cargo.lock`, updates `CHANGELOG.md`, archives full handoff logs into `docs/worklog/YYYY-MM.md`, deletes consumed `changes/*.md` files, and commits `chore(release): bump version to vX.Y.Z`.
3. **Cutting a Published Binary Release (`.github/workflows/release.yml`):**
   - Pushing an annotated tag matching `v*` (`git tag -a vX.Y.Z -m "Release vX.Y.Z"; git push origin vX.Y.Z`) builds signed Desktop installers (Windows NSIS + portable zip, macOS DMG, Linux deb/AppImage), signed Android APK/AAB, deploys the PWA to GitHub Pages, generates `SHA256SUMS.txt` + Tauri `latest.json`, and publishes the GitHub Release using tag-aware notes (`node tooling/generate-changelog.mjs --notes-only`, diffing strictly since the previous SemVer tag).

---

## 2. One-Time Setup: Signing Keys and GitHub Secrets

### Desktop Tauri Updater Signing Keypair

1. Generate a minisign keypair:
   ```powershell
   cargo tauri signer generate -w quizradar.key
   ```
2. Store the public key string in `apps/desktop/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
3. Store the private key string in GitHub Repository Secret `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if password-protected).
4. **Never commit `quizradar.key` or private keys to git** (guarded by `.gitignore` and `tooling/agent-gate.mjs`).

### Android Release Keystore

1. Generate a 2048-bit RSA release keystore:
   ```powershell
   keytool -genkeypair -v -keystore quizradar-release.keystore -alias quizradar -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Base64-encode for GitHub Actions:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("quizradar-release.keystore")) | Set-Clipboard
   ```
3. Configure GitHub Repository Secrets:
   - `ANDROID_KEYSTORE_BASE64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`

---

## 3. Key Rotation Procedure

- **Desktop Updater Key:** Generate a new keypair via `cargo tauri signer generate`, update `pubkey` in `tauri.conf.json`, and update `TAURI_SIGNING_PRIVATE_KEY` in GitHub Secrets. Because installed builds verify updates against their bundled public key, ship an intermediate bridge release or notify users on GitHub Releases when rotating.
- **Android Keystore:** For direct APK sideloading, users must reinstall if the signing key changes; for Google Play, use Play App Signing key rotation.

---

## 4. Local Dry-Run & Verification Commands

```powershell
# Preview pending SemVer bump and CHANGELOG entry without writing files
pnpm version:dry-run

# Check all 5 version sinks match tooling/version.json
pnpm generate:version:check

# Preview GitHub Release notes since the previous SemVer tag
node tooling/generate-changelog.mjs --notes-only

# Dry-run Tauri updater manifest generation
node tooling/generate-updater-manifest.mjs --dry-run --version 5.1.0 --output target/test-latest.json
```
