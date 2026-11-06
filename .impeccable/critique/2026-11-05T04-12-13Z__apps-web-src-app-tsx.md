---
target: android and desktop app
total_score: 32
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:D:\\Projects\\QuizRadar\\apps\\web\\src\\App.tsx"
target_fingerprint: "sha256:8e77c81a1bd94c8236988b6f16aa5c5685399b041cb26406f08ed97dacf54196"
target_path: "D:\\Projects\\QuizRadar\\apps\\web\\src\\App.tsx"
timestamp: 2026-11-05T04-12-13Z
slug: apps-web-src-app-tsx
---
# Impeccable Critique: QuizRadar Desktop/Web & Android Apps

Method: dual-agent (A: d389c6a4-ca94-4f7a-8eb6-140917f8fd12 · B: 1b27b53d-f434-4350-9dbe-0fbc7f81c424)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|:-----:|-----------|
| 1 | Visibility of System Status | 4 | Excellent feedback across sources, sync indicators, and day watchdog. |
| 2 | Match System / Real World | 4 | Speaks university vernacular (quizzes, study blocks, syllabus topics, GPA). |
| 3 | User Control and Freedom | 3 | Auto-scheduled study blocks cannot be individually snoozed or fine-tuned. |
| 4 | Consistency and Standards | 3 | Navigation paradigm mismatch between desktop topbar/sidebar and mobile bottom/sheets. |
| 5 | Error Prevention | 4 | Smart defaults, confirmation guards on destructive actions, honest "—" rooms. |
| 6 | Recognition Rather Than Recall | 3 | SettingsView is an monolithic 9-section scroll with high recall demands. |
| 7 | Flexibility and Efficiency | 4 | Single-key shortcuts, Cmd+K search palette, mobile gestures, pull-to-refresh. |
| 8 | Aesthetic and Minimalist Design | 3 | Android Dashboard vertically overcrowded with 4 stacked KPI cards before timeline. |
| 9 | Error Recovery | 4 | Detailed scan error reporting, clear empty states with one-click clear filters. |
| 10 | Help and Documentation | 3 | Dedicated Help screen with tactile keycaps, but lacks inline contextual micro-tips. |
| **Total** | | **32/40** | **Good (80%)** |

## Design Specificity Verdict

**Verdict**: Deeply Grounded in Academic Radar Domain, with Category-Interchangeable Admin Clutter on Mobile.

- **LLM Assessment**: Grounded in real student exam stress, featuring the honest "Observatory" aesthetic (sun halo in light mode, twinkling constellation stars in dark mode, 48h ruby aura, emerald shield mitigation). However, the 4 generic SaaS KPI cards on Android create unnecessary administrative bloat.
- **Deterministic Scan**: Static regex scan clean (`0` findings). Dynamic markup inspection identified 9 technical UX omissions: missing `MODAL_TITLE_IDS["search-palette"]`, unlabelled checkboxes in Settings, missing ARIA Combobox/Listbox semantics in SearchPalette, and interactive element nesting in StudyRecommendationCard.
- **Visual Overlays**: Native CDP attachment on desktop; Android evaluated via Jetpack Compose hierarchy and screenshots.

## Overall Impression
QuizRadar excels in academic domain depth, honest data handling, and keyboard efficiency. However, the Android dashboard is vertically bloated by stacked SaaS metrics, the desktop has dual competing search patterns, and accessibility markup gaps need tightening.

## What's Working
1. **Uncompromising Honesty Doctrine**: Rejection of fake data (clean "—" fallbacks, 0-topic readiness withheld, exact scan reporting).
2. **Conflict-to-Shield Mitigation Arc**: Psychological transformation of exam stress into actionable calendar study blocks.
3. **High-Velocity Keyboard Architecture**: Single-letter accelerators (`D`/`T`/`C`/`F`/`?`/`S`), modal Esc hierarchy, and tactile keycaps.

## Priority Issues

- **[P1] Android Dashboard Vertical Overload & Information Hierarchy**:
  - *Why it matters*: Stacking 4 full-width KPI cards before the timeline buries upcoming exams under 900dp of scrolling.
  - *Fix*: Replace vertically stacked KPI cards with a compact 2x2 grid or horizontal carousel, or adopt an actionable Next-Up stream.
  - *Suggested command*: `$impeccable layout`

- **[P1] Dual Competing Search Paradigms on Desktop**:
  - *Why it matters*: Having an inline TopBar search input and a floating `Cmd+K` SearchPaletteModal causes interaction confusion.
  - *Fix*: Unify search into the universal `Cmd+K` / `/` SearchPaletteModal or connect the TopBar input directly to the palette.
  - *Suggested command*: `$impeccable clarify`

- **[P2] Technical Accessibility Gaps in Search Palette & Settings**:
  - *Why it matters*: Missing modal title ID (`search-palette`), unlabelled Teams/Classroom toggles, and missing combobox ARIA impair screen-reader users.
  - *Fix*: Add `MODAL_TITLE_IDS` entry, associate `<label>` tags with toggles, and add combobox/listbox ARIA attributes.
  - *Suggested command*: `$impeccable audit`

- **[P2] Monolithic Settings View Cognitive Overload**:
  - *Why it matters*: SettingsView is an 1,100-line continuous scroll across 9 disparate domains.
  - *Fix*: Introduce anchored pill sub-tabs ("Account & AI", "Timetable & Courses", "Sync & Feeds", "Preferences") with progressive disclosure.
  - *Suggested command*: `$impeccable distill`

- **[P3] Out-of-Reach Mobile Chrome Controls**:
  - *Why it matters*: Sync, Search, and Account sit at the top of the screen on Android, outside the one-handed thumb zone.
  - *Fix*: Support pull-to-refresh for sync and place search accessibility within thumb reach.
  - *Suggested command*: `$impeccable adapt`

## Persona Red Flags

- **Alex (Power User)**: Confused by dual search patterns (TopBar dropdown vs Cmd+K palette); cannot traverse timeline with J/K or arrow keys.
- **Jordan (First-Timer)**: Empty state shows "Scan now" before any sources are connected; timetable entry without Gemini API key is high friction.
- **Sam (Accessibility-Dependent User)**: Missing dialog name on search palette; unlabelled checkboxes in Settings; absolute pixel positioning in calendar lacks linear DOM narrative.
- **Casey (Distracted Mobile Student)**: Endless scrolling past 4 KPI cards on phone to check next quiz; top-bar actions unreachable one-handed on campus bus.

## Minor Observations
- Pomodoro completion lacks visual ripple when muted.
- Undated calendar exams render at 08:00 AM labeled "Time —" rather than in an All-Day header strip.
- Timeline filter pills and dropdown create 14 simultaneous choices.

## Questions to Consider
- What if the mobile dashboard abandoned SaaS KPI metric cards and focused 100% on a chronological Next-Up stream with inline syllabus mastery rings?
- Does a student need both a mini-calendar and a 7-day week calendar on desktop simultaneously?
- What would a dedicated 48-Hour Exam Mode look like, stripping away long-term roadmaps to show only immediate high-yield topics and room directions?
