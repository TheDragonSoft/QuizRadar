# 04 — Rebuild Architecture (v5, **stack locked 2026-10-23**)

_Target: same product (see `01`), one codebase, zero fabricated data, zero embedded secrets, and a release pipeline a single maintainer can drive. Written for the context of the pain list in `03`._

---

## 0. LOCKED STACK — maintainer decisions (2026-10-23)

| Decision | Choice | Notes |
|---|---|---|
| Core logic | **One Rust crate (`core/`)** — parsers, planner, conflicts, study blocks, ICS, Drive backup, AI client, SQLite store | The "three implementations" sin (RC1) dies at the language level: desktop, Android, and PWA all bind the same crate |
| Desktop | **Tauri 2 (Rust shell) + React 19 + Vite UI** | IPC commands call the core in-process — keep current Axum HTTP server deleted; full Rust perf requested by maintainer; signed `tauri-plugin-updater`; OS keyring |
| Mobile | **Android-only, forever → Kotlin + Jetpack Compose**, **Glance** for the countdown widget, first-party notifications, share-sheet via intent filters, custom-scheme OAuth | **UniFFI/JNI** binds the Rust core (async via UniFFI async support); tokens in EncryptedSharedPreferences; this replaces the earlier Capacitor recommendation after the maintainer's choice |
| Native edge | Built **natively from scratch in Kotlin** (maintainer's explicit choice over porting `<Portal code borrows>`) | widget → Glance; share ingest → manifest ACTION_SEND → Compose modal; FGS OAuth server code deleted in favor of custom-scheme PKCE |
| PWA/web tier | **Kept as a companion tier**: same React UI + the core compiled to **WASM**; browser fetch adapters in TS | May be dropped later at near-zero cost (it shares 100% of its code with the desktop UI anyway) |
| Server philosophy | **Pure local, no server, ever** (maintainer decision) | All auth/source scanning runs per-device; accepted trade-off: PWA tier = 1h Google tokens (memory-only, re-auth) and no background scans |
| OAuth | **PKCE everywhere, zero client secrets**: desktop loopback, Android custom scheme (`com.googleusercontent.apps.*:/oauthredirect`), PWA origin | Kills `LocalOAuthServer.java`, the XOR-obfuscated secrets, and the OAuth foreground service |
| UI built twice (the honest cost) | React (desktop + PWA) **and** Compose (Android) | Chosen deliberately: logic/store/auth/AI implemented once in Rust; native mobile purity was preferred over a shared webview |

**Practical consequences**: `packages/core` TS idea from the original draft is superseded — the core is Rust and the Android app is native Kotlin. The decision matrix in §3 remains as historical rationale; where it conflicts with this table, **this table wins**.

---

## 1. Why the current shape must change (1 paragraph)

Today the AskRadar-contract lives in three implementations (Rust HTTP server, JS engine, Java OAuth server), the UI is one 453 KB global script, releases are hand-painted per platform with 8 version sources, and OAuth secrets are baked into two binaries. None of these four evils is fixable by patching: they are *structural*. v5 is therefore built as **one TypeScript core consumed by three thin shells**, with a build system that generates everything (versions, API types, Android assets, installers).

## 2. The deciding constraint

QuizRadar is a **local-first utility whose heavy logic is pure and platform-independent** (parsers, planners, derivations) while its *platform-specific* surface is thin (OAuth windows, notifications, haptics, widget, share sheet, updater, secure storage). The architecture that matches: **logic in TS shared by all platforms; UI in a modern component framework; native work only at the edges via mature plugin ecosystems.** The web is also a first-class target (their established install base: PWA/iPhone), which immediately rules out purely native stacks.

## 3. Framework decision matrix (historical rationale — §0 table wins on conflicts)

| Option | Desktop (Win/Mac/Linux) | Mobile (Android+iOS) | PWA | DevX cost | Verdict |
|---|---|---|---|---|---|
| **A) Tauri 2 (desktop) + Capacitor 7 (mobile) + React/Vite SPA + shared TS core** | Tauri 2: signed auto-updates, OS keyring, single instance, tiny bundles, real window lifecycle | Capacitor: mature plugins (notifications, haptics, statusbar, browser); you keep your working widget/share JAVA code | Same Vite build | Lowest UI port cost (reuse design + most behavior), two small shells | ✅ **Recommended** |
| B) Tauri 2 everywhere (incl. mobile) | same as A | Rust toolchain for Android/iOS, plugins thinner: widget/share extensions/foreground scenarios are DIY Kotlin/Swift; iOS store story rougher | same | One shell, but you re-write the native edge in a new dialect and lose the existing working Java | Runner-up: pick if you *love* Rust-and-one-toolchain more than velocity |
| C) Flutter | single raster UI, excellent notifications/widgets | same engine everywhere | ❌ no web (PWA lost — iPhone users stranded) | full Dart rewrite of products+UI | Only if you fully commit to native UX |
| D) Expo/React Native | desktop = RN Windows/Mac (painful, a tier below) | best-in-class mobile DevX (OTA, EAS) | partial | desktop is the wrong tier for this product | No — desktop is 50% of the product |
| E) Keep Axum + webview (status quo++) | keeps Rust OAuth/server | keeps Capacitor | keeps | RC1/RC2/RC3 remain; the pain doc is the rebuttal | ❌ rebuild |

**Recommendation: Option A.** Rationale in one line per row: (1) `static/` already is a Vite-shaped SPA — React/Vite + TS is a lift, not a leap; (2) your Android Java (widget provider, share ingest, keep-alive) is *working code* — Capacitor lets it live another day for free; (3) Tauri 2 gives you the four things the hand-rolled shell does badly: **signed updater, OS keyring, crash-safe window lifecycle, first-class desktop CI**; (4) the PWA survives untouched.

> If you would rather not maintain Capacitor at all, the honest fallback is **Option B (Tauri 2 mobile)** — but budget for writing the widget + share-sheet + notification-handler natively in Kotlin (and later Swift), which is the part Capacitor buys you today.

## 4. Target architecture

### 4.1 Monorepo layout (final, per §0)

```
quizradar-v5/
├─ core/                        # ★ THE SINGLE RUST CRATE (app logic; no UI, no platform crates)
│  ├─ src/
│  │  ├─ sources/{gmail.rs,teams.rs,moodle.rs,ics.rs,classroom.rs}   # fetchers w/ bearer adapters
│  │  ├─ parse/{email.rs,ics.rs,schedule.rs}
│  │  ├─ plan/{tasks.rs,readiness.rs,conflicts.rs,study_blocks.rs}
│  │  ├─ cal/{ics_export.rs,gcal.rs}
│  │  ├─ ai/{provider.rs,gemini.rs,quota.rs,practice.rs}             # BYOK, header-key only
│  │  ├─ store/{db.rs,sync.rs,backup.rs}                             # rusqlite + migrations + Drive
│  │  ├─ types.rs             # all serde structs (single truth for API payloads)
│  │  └─ auth/{pkce.rs,providers.rs}   # scope registry (fixes classroom.* scope bug);
│  │                                   # token *storage* is platform-side (keyring/ESP/none)
│  ├─ bindings/
│  │  ├─ uniffi.toml          # → Kotlin bindings for Android (UniFFI async supported)
│  │  └─ wasm/                # wasm-bindgen build for the PWA tier
│  └─ tests/fixtures/         # golden emails/ICS/schedules (port the 32 cargo tests)
├─ apps/
│  ├─ desktop/                # Tauri 2 + React 19/Vite SPA (wraps core as a lib, IPC commands)
│  │  └─ src-tauri/           # tauri.conf.json, updater, keyring command, opener
│  ├─ web/                    # the same React SPA → dist (desktop webview asset AND PWA)
│  │  ├─ src/ (React) · public/fonts · Workbox SW via plugin
│  └─ mobile-android/         # Kotlin 2.x + Compose M3 + Glance widget
│     ├─ app/ (Compose UI: 3 views + modals per `01` §5)
│     ├─ glance/ (countdown widget)
│     └─ uniffi/ (generated Kotlin bindings of core)
└─ tooling/ (version generator → tauri.conf/gradle/package.json/sw; signing; icons via sharp; release CI)
```

Rules enforced by lint/CI: `core/` depends on nothing platform (no tao/wry/tauri types); every shell is ≤ few hundred LOC of glue; **no string may contain "4.3.0"** — only `tooling/version.ts` generates it into package.json, tauri.conf, gradle, sw cache key; UI code never formats dates itself (core produces display strings).

### 4.2 The one HTTP contract (deleted)

There is **no HTTP server in v5 desktop**. Tauri IPC commands replace it (`list_state`, `run_scan`, `push_gcal`, `extract_schedule`, `save_grade`, `set_pin`, `check_update`, …). This deletes: port probing, CORS/session middleware, 6 inline HTML pages, the fetch interceptor, cookie token plumbing, and `/api/status`-class zombies. The phone pairing story becomes optional cloud sync instead of a LAN HTTP server (see 4.6). *If* you later want LAN pairing, make it a **desktop-only Tauri feature** sharing the same in-process logic — not a second API drawer.

### 4.3 Auth: PKCE everywhere, zero secrets (fixes RC7 and B10)

- Google: OAuth **desktop+web** client → loopback redirect `http://127.0.0.1:<random-port>` / PWA origin; **Android/iOS** client → custom scheme redirect (`com.googleusercontent.apps.<id>:/oauthredirect`); `code_verifier`/`challenge` PKCE; *no client_secret exists at all*.
- Microsoft: same pattern with `msauth.com.quizradar.app://auth`.
- Token storage: **desktop** → OS keyring (Tauri command); **Android** → EncryptedSharedPreferences via Kotlin (UniFFI never carries refresh tokens across the bridge); **PWA** → memory-only access token (GIS token client, ~1 h, silent re-auth) — never persist a refresh token in localStorage.
- Scope registry (`core/src/auth/providers.rs`) declares per-source scopes once (fixes the broken `classroom.*` scope bug structurally), consumed by GCal/Drive/Classroom/Gmail code.
- Deep-link return handling replaces `LocalOAuthServer.java` (−642 lines) and the 12-minute foreground service (−manifest `specialUse`, −1 menu of Android dev pain). **Google/Microsoft token exchange endpoints accept PKCE public clients** — this is the standard desktop/mobile pattern (RFC 8252).

### 4.4 Storage: one typed local DB (owned by the core)

- `core/src/store/db.rs`: single **SQLite via `rusqlite`** (desktop: bundled libsql; Android: AWS SDK-free rusqlite with bundled SQLite compiles fine under NDK; PWA: wasm build uses sql.js/IndexedDB serialization of the same schema) with one table per entity (`courses`, `slots`, `assessments`, `topics_done`, `grades`, `events`, `feeds`, `config_kv`, `tokens_meta`) — replacing `5 JSON files + 2 token files + CWD roulette`.
- Validation via serde + schema-versioned migrations shipped in the core (arity of "unknown" representable everywhere: room `null` renders "—", never a default hall).
- The v4 backup importer (`assessments[]` + `courses[]` + `completed_topics` + `grades` + `custom_events`) lives in the core so all three shells get it for free.

### 4.5 The scan pipeline (one implementation, all platforms)

Runs **in the Rust core**. HTTP: desktop/mobile use `reqwest` + rustls from the core directly; the PWA tier uses WASM core for all parsing/planning/derivation while thin TS fetch adapters do the network calls (Google/Graph/Moodle APIs are CORS-friendly from browsers — already proven by the v4 mobile engine). Tokens are passed INTO the core as plain strings; the core never persists secrets (platform storage decides). Per-platform adapters therefore only choose token storage + OAuth redirect mechanics. Desktop = Android = PWA = identical semantic surface. Long scans are async jobs with progress events (Tauri emit / Kotlin Flow / postMessage on web) — the "staged fiction" overlay becomes real per-source progress.

### 4.6 Sync story: per-device accounts (replace pairing complexity)

- Base model (v5 default): **every device connects its own accounts** (student logs into Google/MS on the device; tokens never leave it — matches the privacy brand).
- Optional **Cloud Backup via Drive appDataFolder** (scope already requested): each device pushes/pulls the *data-realm only* (no tokens ever). Conflicts resolved additive like today (topics true-only, grades upsert), plus `updated_at` per record.
- Desktop→phone QR pairing stays **as a bonus import feature later**; it is no longer the load-bearing story. The calendar-event fallback storage is **deleted** (visible-in-calendar + 8 KB cap + token smells).

### 4.7 UI: React (desktop+PWA) and Compose (Android), design preserved

- **React 19 + Vite + Tailwind** (desktop webview + PWA): componentize the 13 modals + 3 views from `01` §5; zustand; `apps/web/tokens/` keeps `#1a73e8`/`#0b0f19`/exam-glow/palettes; Inter self-hosted; lucide components.
- **Compose M3 (Android)** implements the same inventory in Material-3: bottom nav (dash/tasks/calendar/focus), bottom sheets, Glance 2×1 countdown widget, swipe-to-refresh via `PullToRefreshBox`, haptic feedback, system back-button integration for free (replaces the hardcoded modal stack list).
- Every modal is a component with a declarative API (no Escape-stack hardcoding on the web side: one `<ModalStack>`; Android back handled by predictive-back compose integration).
- All render-heavy surfaces use memoized selectors/composables (no string-literal DOM rebuilds; fixes C10).

### 4.8 Update & release pipeline (generated, not hand-painted)

- Desktop: **tauri-plugin-updater** (signature-verified archives) + GH Release from `tooling/release.ts` — kills the ⚠️ substring matching + unsigned EXE theater.
- Android: `assembleRelease` + a real **keystore**, minify on, versionCode/Name generated from `version.ts`; Glance widget + share-filter + notification channels ship in this app; debug builds only for test tracks.
- CI on PR: rustfmt/clippy + test the core, tsc/eslint/vitest for the React UI, assembleDebug for Android; **core contract tests are the parser/planner golden fixtures** (port the current 32 cargo tests + real email fixtures).
- No committed build artifacts anywhere: every platform app is built fresh in CI from versioned sources.

## 5. Features to deliberately **delete** in v5 (with reasons)

| Feature | Why deleted | Replaced by |
|---|---|---|
| `?demo=` URL hacks + in-code scrub IDs | fabrication channel, latent state pollution | a real storybook/dev build per UI |
| Calendar-event fallback sync | privacy + cap + visibility | Drive backup only |
| Teams-token-in-cloud-sync | token exfiltration | per-device tokens |
| `LocalOAuthServer.java` + FGS + embedded secrets | custom-scheme PKCE does the job | deep-link OAuth |
| `--lan` HTTP server as core desktop mode | unsafe posture, complexity | Tauri IPC + later opt-in pairing command |
| Demo-course palettes/plans/banks/`Hall B-204` room | honesty doctrine | derived-from-user palettes, "unknown room" |
| `auto_sync_gcal: true` default | scope-less push bug class | default false + first-push consent |
| Engine-vs-backend twin routes | triple maintenance (RC1) | one Rust core |
| Axum HTTP API on desktop | RC1/RC3 plumbing | Tauri IPC commands + UniFFI |

## 6. Migration & cutover plan

1. **Phase 0 — foundation (no user impact):** new monorepo; port design tokens (CSS vars + Compose theme mapping of the same hexes); set up rustfmt/clippy, tsc/eslint/vitest, CI; version generator.
2. **Phase 1 — core port with fixtures:** consolidate the v4 Rust logic (parser.rs, planner, derivations) plus the honest parts of the v4 JS engine into `core/` with golden-file tests (this is mostly *merging*, since the parser already exists in Rust — biggest risk is the planner + assessment merge semantics from the engine). Highest-risk phase; most review time here.
3. **Phase 2 — desktop Tauri shell + React UI:** 3 views + 13 modals per `01` §5 checklist wired to core via IPC commands with a fixture db; dogfood the new EXE for two weeks against the old one.
4. **Phase 3 — PWA tier:** same React app + wasm core; SW/manifest migrated; served from GH Pages or the real repo URL (fixes the 404 era).
5. **Phase 4 — Android Kotlin app:** Compose UI (1 view/day per §5 inventory), Glance widget, share ingest, notifications, custom-scheme PKCE OAuth, UniFFI glue; release pipeline to signed APK.
6. **Phase 5 — data migration + deprecation:** one-click v4 backup import (from `core`, exposed in every shell); README re-honesty pass (kill D1/C2 claims); freeze v4.
7. Parallel-run rule: never delete the v4 import path (it is your only user-data bridge).

## 7. Risk register (honest)

| Risk | Mitigation |
|---|---|
| UniFFI async binding of reqwest-based core calls on Android | UniFFI supports async interfaces exported to Kotlin (suspend functions); fall back to callback-style `run_scan(job_id)` + progress polling if friction grows |
| rusqlite under Android NDK | known-good pattern (bundled SQLite compiles for aarch64-armv7 with `libsqlite3-sys -bundle`); PWA/PWA-tier keeps sql.js fallback |
| UI built twice (React + Compose) → drift between desktop/mobile behaviors | acceptance checklist `01` §8 shared by both UIs + audit each feature desktop-vs-mobile in PR template |
| Componentizing 13 modals + Compose screens takes real time (the *only* expensive phases) | acceptance checklist in `01` §5 is the task list: 2 modals/day web, 1 screen/day Compose |
| Feature parity drift during rewrite | the checklist doc + core contract tests |
| Tauri updater requires signed updates (one-time semantics) | tooling release script generates keys once, stored in CI secret |
| Losing the widget/share/ingest "contracts" on rewrite | docs `01` §4.8 + `03` §C16 list exact contract names; Glance + intent filters replace them natively |
| Gemini CORS/keys | already CORS-OK from browsers via `x-goog-api-key` header (current engine proves it); in core the key flows header-only too |
