# ADR-0004: Forgejo-First Git Remote & Split Forgejo/GitHub CI

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

Primary development runs on a self-hosted homelab Forgejo instance (`http://192.168.2.212:3000`) with a dedicated `devbox-runner` (`devbox-host`) that provides warm Rust/Node/pnpm/Gradle caches and fast local feedback, while GitHub (`TheDragonSoft/QuizRadar`) provides free multi-OS runners (`windows-latest`, `macos-latest`), GitHub Pages, and Android Emulator (API 35) capacity.

## Decision

1. **Default Git remote (`origin` = Forgejo):** All fetches, branches, pushes, tags, and PRs target `origin` (`git@forgejo:GordyTheKat/QuizRadar.git`). Forgejo automatically mirrors pushed commits/tags to GitHub (`sync_on_commit`). Never push directly to the `github` remote unless explicitly requested.
2. **Forgejo Actions (`.forgejo/workflows/`):** Runs fast single-pass Linux/Rust/Web/Android checks on `devbox-runner` (`devbox-host` or `ubuntu-latest`, 14-day artifact retention). Because Forgejo ignores `.github/workflows/` whenever `.forgejo/workflows/` exists, keep Forgejo-optimized workflows in `.forgejo/workflows/`.
3. **GitHub Actions (`.github/workflows/`):** Reserved for multi-OS release builds (`release.yml`), GitHub Pages (`pages.yml`), automated SemVer rollups (`version-bump.yml`), and heavy parallel / Android Emulator / performance suites (`ci.yml`, `performance.yml`).

## Consequences

Every contributor and AI agent gets sub-minute local CI on Forgejo while keeping full multi-OS release coverage on GitHub without duplicate runner waste.
