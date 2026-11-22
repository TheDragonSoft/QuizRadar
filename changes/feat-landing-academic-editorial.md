---
bump: patch
surfaces: [web]
agent: antigravity
branch: feat/landing-academic-editorial
date: 2026-11-22
---

### Summary

Redesign the QuizRadar marketing website and /download/ hub (apps/landing) in the Academic Editorial Observatory aesthetic scoped to v5.20.0: add interactive Hero Timetable Resolver, single-image 3-theme (Obsidian, Solar, AMOLED) switcher with inline #views theme bar, visual zero-server campus data-flow diagram, deterministic ISO/IEC 18004 SVG QR code for Android APK downloads, iOS/iPadOS detection routing to Web Companion, tightly framed 2x Retina desktop & native Android screenshots, regenerated 1200x630 og-image.png, and WCAG AA / 390px mobile craft-floor polish. Added @fontsource-variable/newsreader and @fontsource-variable/jetbrains-mono to apps/landing/package.json solely as build-time self-hosted WOFF2 font assets (zero external CDN or runtime JS dependencies).

### Verification

- node tooling/generate-version.mjs --check
- pnpm --dir apps/landing typecheck
- pnpm --dir apps/landing test (10/10)
- pnpm --dir apps/landing build (root & ASTRO_BASE=/QuizRadar)
- pnpm lint
- pnpm format:check
- pnpm test:tooling (45/45)
- Playwright visual + jsQR audit across Obsidian/Solar/AMOLED/390px

### Handoff / Follow-ups

- Open a PR from feat/landing-academic-editorial to main to deploy via .github/workflows/pages.yml
- once v5.21.0 (Stage 1: Multi-Syllabus PDF Importer, 1-Tap Course Packs, Zero-Key Trial AI Relay) is tagged and released, follow up with a v5.21 marketing showcase pass.
