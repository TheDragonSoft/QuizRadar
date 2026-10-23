# Phase 11 — PWA tier: WASM core + service worker + install story

> After phase 10. The web tier shares 100% of the React UI; this phase makes it runnable in a browser against WASM core + browser fetch adapters.

**Read first:** `AGENTS.md`; `docs/rebuild/04-rebuild-architecture.md` §0 (PWA = companion tier) + §4.5 (browser fetch adapters); `docs/rebuild/02-current-architecture.md` §5.1–5.5 (browser-side feasibility facts); `docs/rebuild/03-issues-and-pain-points.md` §1/§2 of "same-problem" choices (accepted PWA limitations: 1h GIS tokens, no background scans).

## Build

1. **WASM core bindings**: `core/bindings/wasm/` wasm-bindgen crate exposing the store + parse/plan/derive as an in-browser `QuizRadarWasm` engine (IndexedDB persistence via `sql.js` or `idb` serialization — pick one and document; keep the SAME schema version). Tojs build script wired in `apps/web/vite.config.ts` (wasm target build into `apps/web/public/wasm/`).
2. **Browser adapters** `apps/web/src/pwadapters/`: implement the same `Rpc` interface used by tauri via (a) local wasm engine calls + (b) browser fetches for sources requiring tokens: Gmail/Graph/moodle/feeds via `fetch` with browser-held tokens (GIS token client for Google — 1h memory-ish; MSAL browser for Microsoft; classroom scope request included). Every adapter = per-source feature-flag on the browser reality (e.g., "Calendar sync unavailable on this device — export .ics instead" honest errors exactly as in `01` §4.8).
3. **Service worker**: Workbox generateSW — precache all local assets (JS/CSS/fonts/wasm/icons), network-first for future API paths with honest 503 JSON `{ error: "Offline — QuizRadar is in local mode" }`, cache-first cross-origin, old-cache sweep, SW version derives from version tooling (no literals).
4. **Manifest**: v5 manifest.webmanifest (standalone portrait, theme `#0b0f19`, 4 icon sizes from provided asset pipeline later; placeholder icons acceptable if honest) + iOS meta tags; Add-to-Home-Screen instructions panel in Help (the only iOS path — marketing honesty per `04` §0 trade-offs).
5. **Install/help page**: `/help` route documenting per-tier capability matrix (Desktop = full; Android app = full; PWA = companionship limits explicit) — this is a BRAND REQUIREMENT.
6. Tests: wasm engine parity fixtures (same golden set as phase 02 rerun via wasm path), SW precache includes wasm, offline 503 shape.

## Acceptance
- [ ] `pnpm build` emits PWA-ready dist; lighthouse installability checks (manual run noted in STATUS; CI optional)
- [ ] Browser session: import/demo-course → derive → dashboard renders identical numbers to desktop fixture cases
- [ ] Offline relaunch renders cached shell + honest offline note (manual evidence in STATUS)
- [ ] STATUS updated; phase 11 ticked

## Commit
`phase(11): pwa tier (wasm core + adapters + service worker + help parity page)`
