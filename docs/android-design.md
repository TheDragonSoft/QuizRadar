# Android Design System — "Quiet Instrument"

Operate-mode polish for the native Android app (`apps/mobile-android`). The brand palette is locked (`QuizRadarTheme.kt`: theme-role colors, `StatusColors`, `CustomEventPink`, NextUp starfield hero, Light/Dark/AMOLED modes). Every rule below is a build requirement.

## 1. Radius & Elevation

- **Cards & list containers:** `16dp` radius, `1dp` `outlineVariant` border, **no shadow** (never border + shadow together).
- **Bottom sheets:** `28dp` top radius, muted `32×4dp` drag handle.
- **Buttons & chips:** full pill (`CircleShape`) for small controls; FAB uses default M3 soft shadow.
- **Text fields:** `12dp` radius, `1dp` `outlineVariant` unfocused, `2dp` `primary` focused.

## 2. Typography (One Hierarchy, No Eyebrows)

| Role | Style |
|---|---|
| Screen title | `titleLarge` 22sp/600, tracking `-0.01em` |
| Section / Card title | `titleMedium` 16sp/600 |
| Body | `bodyMedium` 14sp/400, lineHeight 20sp |
| Support / muted | `bodySmall` 12sp, `onSurfaceVariant` |
| Meta / label | `labelMedium` 12sp/500 |
| Calendar numerals | tabular figures (`fontFeatureSettings = "tnum"`), 15sp/600 |

Never center-align body text; no uppercase kickers above headings, no section numbers, no gradient text.

## 3. Buttons & Chips

| Kind | Specification |
|---|---|
| Primary / Secondary | `FilledButton` / `TonalButton`, pill, `48dp` min height, `24dp` horizontal padding |
| Tertiary / Destructive | `TextButton` (no pill) / `FilledButton` (`errorContainer` / `onErrorContainer`) |
| Disabled | `surfaceVariant` container + `onSurfaceVariant` 38% content (never lowered alpha) |
| Icon button | `48dp` min touch target, `onSurfaceVariant` icon |
| Filter chips | `32dp` height (`48dp` min touch target), pill; selected = `secondaryContainer` + leading `16dp` check icon (color never carries selection alone). Destructive chip labels name their object (`"Reset filters"`, never bare `"Clear"`). |

No `2dp`-bordered outlined buttons inside flows; outlined is reserved for outside-the-card actions only.

## 4. Spacing Rhythm

Screen horizontal padding `20dp`. Vertical rhythm `8 / 12 / 16 / 24 / 32dp` — tighter inside groups, more space above a section header than below. Card padding `16dp`; list row min height `56dp`.

## 5. Calendar Chrome

Two compact rows only:

- **Title row (`48dp`):** Tabular date range (`titleLarge`, tap opens M3 `DatePickerDialog`), timetable source muted underneath (`labelMedium`); right side has `Today` tonal pill + `Day / 3-Day / Week` `SegmentedButton` with text labels.
- **Day strip (`64dp`):** The single horizontal pager (7 visible cells, 3-day snapped windows). Selected day = filled `primary` pill; today = `4dp` accent dot; days with items = `2dp` `StatusColors` dots. TalkBack announces each cell as selectable with state description.
- **Motion:** `animateContentSize()` with 200ms exponential ease-out, skipped when `ANIMATOR_DURATION_SCALE == 0`.

## 6. Acceptance Checklist (Every Pass)

- Verify Light, Dark, and AMOLED renders; zero raw `Color(0xFF…)` escaping theme tokens.
- Empty, loading, error, and disabled states render honest content (`"—"` for missing rooms).
- TalkBack state descriptions on every control; no color-only state; no clipped text at largest font scale.
