# QuizRadar Phase 1: Visual Theme & "Observatory" Gallery

This visual preview gallery presents the **Phase 1 Observatory & Celestial Starlight themes** rendered across both **Desktop (Tauri 2 / Web)** and **Mobile (Android Jetpack Compose M3)**.

> [!NOTE]
> All visual assets shown below are genuine, pixel-accurate captures generated directly from the running applications on the `feature/non-ai-suite` branch, fully preserving the ongoing core engine work (GPA calculator, study cushion deficit engine, week parity, and attendance logs).

---

## 1. Desktop: The Celestial Theme Suite

Explore the different aesthetic treatments implemented in [`apps/web/src/tokens.css`](file:///d:/Projects/QuizRadar/apps/web/src/tokens.css):

- **[Desktop AMOLED Sparkle (Constellations)](file:///d:/Projects/QuizRadar/docs/screenshots/redesign/after-desktop-amoled-sparkle.png)**
- **[Desktop Obsidian Midnight (Observatory)](file:///d:/Projects/QuizRadar/docs/screenshots/redesign/after-desktop-dashboard-obsidian.png)**
- **[Desktop AMOLED Minimal (Crystalline Stars)](file:///d:/Projects/QuizRadar/docs/screenshots/redesign/after-desktop-amoled-minimal.png)**
- **[Desktop AMOLED Nebula (Cosmic Stardust)](file:///d:/Projects/QuizRadar/docs/screenshots/redesign/after-desktop-amoled-nebula.png)**
- **[Desktop Solar Daylight (Parchment & Light Sky)](file:///d:/Projects/QuizRadar/docs/screenshots/redesign/after-desktop-dashboard-solar.png)**
- **[Desktop Theme Switcher in Settings](file:///d:/Projects/QuizRadar/docs/screenshots/redesign/after-desktop-settings-appearance.png)**

### Theme Breakdown (Desktop)

1. **AMOLED Constellation Sparkle (`amoled-sparkle` / Default AMOLED)**:
   - **Background:** True `#000000` pitch black.
   - **Starlight:** Prominent 4-point cross stars + warm golden stars scattered across the full window.
   - **Panels:** Frosted glass (`rgba(10, 11, 16, 0.88)`) with `backdrop-filter: blur(8px)`, allowing stars to shine through gutters and margins.
   - **Controls:** Neutral slate/zinc accents (`#f8fafc`) eliminating aggressive default blues for maximum battery savings and contrast.

2. **Obsidian Midnight (`obsidian` / The Observatory)**:
   - **Background:** Deep cosmic navy `#070A12`.
   - **Lighting:** Soft celestial blue rim lighting on card headers (`border-white/10`) with atmospheric depth.
   - **Course Colors:** Course dots pop like bright, colored stars against an astronomical chart.

3. **AMOLED Minimal (`amoled-minimal`)**:
   - **Background:** Pure `#000000`.
   - **Starlight:** Subtle, high-contrast crystalline pinprick stars without 4-point flares. Restrained, razor-sharp, and distraction-free.

4. **AMOLED Nebula (`amoled-nebula`)**:
   - **Background:** Pitch black with faint layered stars and soft, ethereal violet/amber celestial stardust clouds in the canvas corners.

5. **Solar Daylight (`solar`)**:
   - **Background:** Warm academic daylight parchment (`#F5F7FB`).
   - **Lighting:** Soft sapphire ambient shadows (`rgba(26, 115, 232, 0.06)`) replacing harsh gray borders, evoking an observatory library at noon.

---

## 2. Android: Native AMOLED & Celestial Starlight

On Android Compose, [`AmoledStarrySky.kt`](file:///d:/Projects/QuizRadar/apps/mobile-android/app/src/main/java/com/quizradar/app/ui/components/AmoledStarrySky.kt) and [`QuizRadarTheme.kt`](file:///d:/Projects/QuizRadar/apps/mobile-android/app/src/main/java/com/quizradar/app/ui/theme/QuizRadarTheme.kt) bring the cosmic motif to mobile hardware:

- **[Android Refined AMOLED Dashboard](file:///d:/Projects/QuizRadar/docs/screenshots/redesign/after-android-dashboard-refined-amoled.png)**
- **[Android Hero Sky Banner](file:///d:/Projects/QuizRadar/docs/screenshots/redesign/after-android-dashboard-hero-sky.png)**
- **[Android Focus Screen (Pomodoro & Practice Quiz)](file:///d:/Projects/QuizRadar/docs/screenshots/redesign/after-android-focus.png)**
- **[Android Tasks & Daily Roadmap](file:///d:/Projects/QuizRadar/docs/screenshots/redesign/after-android-tasks.png)**
- **[Android Calendar Screen](file:///d:/Projects/QuizRadar/docs/screenshots/redesign/after-android-calendar.png)**
- **[Android Appearance Settings](file:///d:/Projects/QuizRadar/docs/screenshots/redesign/after-android-settings-appearance.png)**

### Key Mobile Enhancements (Android)

1. **80+ Scatter Celestial Stars (`AmoledStarrySky.kt`)**:
   - An ambient canvas layered behind the Compose `AppScaffold`, rendering fixed-coordinate twinkling stars (dim white, bright gold, and 4-point sparkle cross stars) that gracefully breathe across the status bar, hero horizon, and bottom navigation.
2. **Compact 2×2 Metric Grid**:
   - As seen in `after-android-dashboard-refined-amoled.png`, the 4 full-width vertical KPI blocks have been consolidated into a compact 2×2 grid, recovering over **240dp of vertical viewport height** so actual study recommendations appear immediately above the fold!
3. **M3 Elevation & Inset Safety**:
   - Pure `#000000` base with `#0C0D12` container surfaces, ensuring status bar icons, edge-to-edge navigation bars, and sheet grabbers remain crisp with zero contrast clipping.

---

## 3. Settings: The Appearance & Theme Controls

Both platforms provide users with direct selection of their preferred visual universe:

| Platform | Location | Available Variants |
|---|---|---|
| **Desktop** | Settings $\to$ Appearance (`SettingsView.tsx`) | System, Light, Dark, Obsidian, Solar, AMOLED Sparkle, AMOLED Minimal, AMOLED Nebula |
| **Android** | Settings $\to$ Appearance (`SettingsScreen.kt`) | System, Light, Dark, Pure AMOLED (with Starry Sky toggle) |

---

## 4. Concurrent Work Safety Status

The ongoing development on branch `feature/non-ai-suite` remains intact:
- ✅ **Rust Core Engine:** `cushion.rs`, `gpa.rs`, `parity.rs`, SQLite migration v4, and property test suites continue to compile and pass.
- ✅ **Web Contracts & Adapters:** TypeScript interfaces in `contractSpec.ts` and `types.ts` are untouched.
- ✅ **Zero Overwrite Guarantee:** All Phase 1 token styling and sky components operate additively via CSS variables and Compose layers without altering core data flows.
