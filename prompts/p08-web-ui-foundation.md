# Phase 08 — Web UI foundation: tokens, chrome, app framework

> After phase 07. Builds the design system + app chrome that phases 09–10 fill. UI = React 19 + Vite + Tailwind + zustand; NO inline onclick strings (components only); all strings typed in one i18n-ish module (`apps/web/src/copy.ts`).

**Read first:** `AGENTS.md`; `docs/rebuild/01-product-spec.md` §5 (screen/modal inventory) + §6 (design language) + §4.8 (day-rollover, sync-footer honesty); `docs/rebuild/02-current-architecture.md` §1.2–1.5 frontend findings; `docs/rebuild/03-issues-and-pain-points.md` §C10 (perf), §A9 (no demo-mode hacks).

## Build

1. **Tokens & theme** `src/tokens.css` + `tailwind.config`: exact palette from `01` §6 (accent 1a73e8, hover 1557b0, surfaces f8fafc/ffffff, dark base 0b0f19 slate scale, exam-glow rgba(220,38,38,.14), custom-event pink db2777, 8-color course palette). Dark mode: `class` strategy; smooth crossfade applied via CSS only; reduced-motion respect.
2. **App chrome** `src/components/`:
   - `TopBar`: sync button (label per state machine), global search input (palette opens in phase 10), theme toggle, user chip (real name/email or honest placeholder "Sign in"), settings gear (with spin stage), update pill slot.
   - `Sidebar` (desktop ≥1024px): brand mini-calendar, nav tabs, mini month calendar (pure), course filter checkboxes + layer toggles (exams/classes), **sync honesty footer** (`computeSyncStatusSummary` semantics: "Signed in · Auto-scan off" / "Radar Active · N sources" / "No sources connected").
   - `MobileNav` (M3 bottom, 4 destinations incl. Focus) responsive breakpoint behavior from v4 (sidebar collapses <1024).
   - `ModalStack` declarative: any modal can open; Escape + focus-trap + restore (port focus discipline from v4 `initModalA11y`); Android-back is consumed by phase 13's native shell — web only needs Escape/order.
   - `Toast` queue + `PullToRefresh` component (touch devices only, viewport-safe).
3. **State layer** `src/state/store.ts`: zustand slices mapping phase-07 IPC `get_state` shape; typed invoke helper `rpc<T>(fn, args)`; local **swr-style cache** (`state cache key v5`) with stale-while-revalidate (offline-first honesty per 01 §4.8); day-rollover watchdog (30 s + visibility) triggering re-derive via `recalculate_deadline` core command (wired in phase 09).
4. **View shell**: `AppView` switcher with fade transitions (`view-transition` class), three view stubs with empty states ("Add your first course…" honesty) — content in phase 09.
5. **Copy module** `src/copy.ts`: every user-facing string imported once (source of truth for later i18n); includes the sync footer honesty strings and empty-state lines verbatim from `01`.
6. Storybook-lite dev rig (`/dev` route when VITE_DEV_ONLY) listing components without touching real state (replaces the banned `?demo=` hack from v4).
7. Tests: component tests for theme toggle persistence, modal stack escape ordering, sidebar responsive collapse, pull-to-refresh gating by modal-open state.

## Acceptance
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green; ≥8 component tests
- [ ] Runs inside the Tauri window against phase-07 honest stubs (empty-state visuals visible)
- [ ] Zero CDN dependencies (fonts local, icons local via lucide-react npm)
- [ ] No version literals in UI (consume `__APP_VERSION__`)
- [ ] STATUS updated; `01` §5 chrome items ticked

## Commit
`phase(8): web UI foundation (tokens, chrome, modal stack, state layer)`
