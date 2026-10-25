# Security Policy — QuizRadar

QuizRadar takes the security of university students and their academic data seriously. Because QuizRadar is a **zero-server, local-first application**, its threat model is focused on device security, cryptographic protocol compliance, and secure credential handling.

---

## 1. Supported Versions

Only the latest release of QuizRadar receives active security updates.

| Version | Supported          |
| ------- | ------------------ |
| 5.0.x   | :white_check_mark: |
| < 5.0.0 | :x:                |

---

## 2. Core Security Guarantees

1. **Zero Client Secrets:** QuizRadar never embeds OAuth client secrets, developer private keys, or shared credentials into source code, binaries, or distribution packages. All authentication uses standard PKCE (Proof Key for Code Exchange) OAuth 2.0 with single-use cryptographically random state parameters.
2. **OS-Backed Credential Storage:** Tokens and credentials never leave the host device.
   - **Desktop:** OS Keyring (Windows Credential Manager, macOS Keychain, Linux Secret Service).
   - **Android:** Android Keystore with `EncryptedSharedPreferences`.
   - **Web/PWA:** Memory-only ephemeral session tokens; zero persistent token storage.
3. **Data-Only Cloud Backups:** Google Drive AppData backups strictly filter out tokens, passwords, session cookies, and API keys before transmission.
4. **Supply Chain Integrity:** Desktop release bundles are cryptographically signed using minisign/Tauri updater keys. Android release packages are signed with Scheme v2/v3 signatures.

---

## 3. Reporting a Vulnerability

If you discover a security vulnerability or credential leak within QuizRadar, please report it privately:

- **Email:** `security@quizradar.app` (or open a private GitHub Security Advisory at `https://github.com/quizradar/quizradar/security/advisories/new`).
- **Include in your report:**
  - Description of the vulnerability and affected component (Desktop Tauri, Android, Web/WASM, or Rust Core).
  - Step-by-step reproduction instructions or a minimal Proof of Concept (PoC).
  - Potential impact on student data or local system integrity.

### What to Expect

- **Initial Response:** Within 48 hours acknowledging receipt of your report.
- **Triage & Status Updates:** Regular updates every 3 business days while diagnosing and validating a fix.
- **Coordinated Disclosure:** We request that you refrain from disclosing the vulnerability publicly until a patched release is published.

### Note on Rewards

QuizRadar is a free, non-commercial, zero-server open-source project maintained by university contributors. We do not maintain a monetary bug bounty program or crypto wallets, but we will gladly credit researchers in our release notes and Hall of Fame with their permission.
