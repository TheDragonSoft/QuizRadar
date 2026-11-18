---
bump: minor
surfaces: [web, android]
agent: Antigravity
branch: feat/qr-code-pairing
date: 2026-11-18
---

### Summary

Add ISO/IEC 18004 QR code generation, SVG/Compose rendering, BarcodeDetector image scanning, and automatic payload compaction for serverless quizradar://pair device pairing across Web/Desktop and Android, and fix single-parameter ktlint formatting in QuizRadarCore.kt.

### Verification

- pnpm --dir apps/web exec vitest run src/lib/qrCode.test.ts src/lib/pairSync.test.ts, pnpm format:check, pnpm lint, node tooling/agent-gate.mjs --ci

### Handoff / Follow-ups

- None
