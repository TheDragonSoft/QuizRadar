# apps/web — Web UI surface guide

Scoped extension of the **root `AGENTS.md`** — read it first. This file covers
the React 19 + Vite SPA only (`apps/web`): the UI consumed by the Tauri desktop
webview and shipped as the PWA companion.

## Scope & boundaries

- This package owns the **browser UI and its local adapters**. `core/` logic,
  `apps/desktop/src-tauri` glue and the Android app are out of scope — route
  those changes to their own surfaces (see `apps/desktop/AGENTS.md`,
  `apps/mobile-android/AGENTS.md`).
- **Adapter seams are fixed.** Desktop IPC goes through `src/state/rpc.ts`
  (the only file allowed to import `@tauri-apps/api`); the browser tier goes
  through `src/pwadapters/*`. Views and components read **only** from the
  zustand store (`src/state/store.ts`) — never call `rpc()` from a component.
- `src/copy.ts` is honesty-critical: it carries the exact user-facing copy
  from `docs/rebuild/01-product-spec.md`. Never paraphrase, never invent
  success messages, rooms, countdowns or stats (root §3.1).

## Layout

| Path | What it is |
|---|---|
| `src/views/` | The six full screens (Dashboard, Tasks, Calendar, Focus, Help, Settings) |
| `src/components/` | Shared components + the modal registry |
| `src/state/` | zustand store, types, rpc bridge, SWR cache, watchdogs |
| `src/pwadapters/` | Browser-tier adapters (WASM bridge, IndexedDB, browser sources) |
| `src/contract/` | Wire-map contract + `regenerate.mjs` + spec/fixtures |
| `src/testdata/contract/` | **Real** payloads the Rust core produced (JSON) |
| `src/dev/` | In-app DevRig (`?dev=true` or `/dev`) |
| `src/stories/` | Ladle workbench stories (dev-only, see below) |

## Commands

```powershell
pnpm --dir apps/web dev          # Vite dev server :5173 (Tauri devUrl points here)
pnpm --dir apps/web ladle        # Component workbench :61000
pnpm --dir apps/web typecheck    # tsc --noEmit (both configs)
pnpm --dir apps/web test         # vitest
pnpm lint; pnpm format:check     # root-scoped gates — they scan this tree
```

## Contract changes

If `core/src/types.rs` or `core/src/ffi.rs` changed, run
`node apps/web/src/contract/regenerate.mjs` immediately (root §6.2). The
wire map is snake_case at the boundary and normalized to camelCase once in
`src/state/ipcShape.ts` (`normalizeStatePayload`) — no view ever re-normalizes.

## UI workbench (Ladle)

- Stories live in `src/stories/**/*.stories.tsx`. They are **dev-only**: never
  imported by app code, excluded from the shipped bundle, vitest and coverage.
- Run `pnpm --dir apps/web ladle` → `http://localhost:61000`. Useful URL
  params on any story URL:
  - `&theme=<id>` — `light` | `dark` | `obsidian` | `solar` |
    `amoled-nebula` | `system`. The app ships exactly these five ids:
    `light`/`dark` are generic MODES the app normalizes onto Solar/Obsidian,
    so they render the user's preferred theme for that mode, not distinct
    skins. The old AMOLED Pure/Sparkle variants were retired from the app.
    Without the param, the page attribute is the authority — Ladle's banner
    button (light/dark) works and survives story switches
    (`.ladle/theme-bridge.css` renders both vocabularies coherently).
  - `&mode=preview` — hides Ladle's sidebar/banner; the story fills the
    window (use with a 390×844 viewport for true phone rendering — Tailwind
    breakpoints follow the real viewport, not the canvas width).
- **Phone rendering**: views bleed to the screen edges against the shell's
  `px-4` main padding — always render them inside the app's phone shell
  (`Phone shell/*` stories, mirrored from `App.tsx`: TopBar, self-hiding
  Sidebar, PullToRefresh main, MobileNav). Bare views overflow horizontally
  and read as desktop fragments. The `Phone/*` section mounts those shell
  stories inside live 390×844 iframes (a real nested viewport — breakpoints
  follow it).
- Render **real views with real payloads**: `src/stories/workbenchFixtures.ts`
  composes `src/testdata/contract/*.json` through the app's own
  `normalizeStatePayload` and seeds the store. Do not hand-invent state shapes
  or fabricate data beyond what the core produces (root §3.1 — fixtures model
  unknown rooms as `"—"`, never a plausible-looking default).
- Modals render through the real `ModalStack` (`Modals/*` stories): keep
  `src/stories/modalSetup.ts` registrations in sync with `App.tsx`, one story
  per registered id.
- Themes: `.ladle/components.tsx` re-asserts the app theme after Ladle's own
  chrome writes `data-theme` (never via `applyThemeToDocument` inside the
  observer — its View Transitions path wedges initial load).
- If a component can't render without backend data, fix it at the seam
  (`setRpcMockHandler` in `state/rpc.ts` or store seeding) — never add
  shipped-code branches just to satisfy a story.
