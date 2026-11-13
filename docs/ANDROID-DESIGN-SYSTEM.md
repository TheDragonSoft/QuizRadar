# QuizRadar Android design system — "Quiet instrument"

Operate-mode polish for the native app. The brand palette is LOCKED (theme-role
colors + `StatusColors` + `CustomEventPink`, the NextUp starfield hero, the
three theme modes Light/Dark/AMOLED — `QuizRadarTheme.kt`). What changes is the
craft: hierarchy, spacing rhythm, control shapes, and chrome density. Every
rule below is a build requirement, not a suggestion. Reference research:
Fantastical's DayTicker, Amie's day chips, Notion Calendar's week header
(single tappable day strip that IS the pager).

## 1. Radius & elevation system (declare once)

- Cards & list containers: **16dp** radius, **1dp `outlineVariant` border,
  NO shadow** (never border + shadow together — the ghost card).
- Sheets: 28dp top radius, drag handle 32x4dp muted.
- Buttons/chips: **full pill** (CircleShape) — pills are for small controls
  only; FAB stays the default M3 Fab with a soft shadow (no zero-blur halos).
- Text fields: 12dp radius, 1dp outlineVariant unfocused, primary 2dp focused.

## 2. Typography scale (one hierarchy, no kickers/eyebrows)

| Role | Style |
|---|---|
| Screen title | titleLarge 22sp/600, tracking -0.01em |
| Section header | titleMedium 16sp/600 |
| Card title | titleMedium 16sp/600 |
| Body | bodyMedium 14sp/400, lineHeight 20sp |
| Support/muted | bodySmall 12sp, onSurfaceVariant |
| Meta/label | labelMedium 12sp/500 |
| Calendar numerals | tabular figures (fontFeatureSettings "tnum"), 15sp/600 day numbers |

Never center-align body text; headings carry their own weight (no small
uppercase label above a heading, no section numbers, no gradient text).

## 3. Buttons (one system, no mixing)

| Kind | Look |
|---|---|
| Primary | FilledButton, pill, 48dp min height, 24dp horizontal padding |
| Secondary | TonalButton pill, same metrics |
| Tertiary | TextButton (no pill background) |
| Destructive | FilledButton with errorContainer/onErrorContainer |
| Disabled | surfaceVariant container + onSurfaceVariant 38% content — never reduced opacity of an enabled look |
| Icon button | 48dp min touch target, onSurfaceVariant icon |
| Selected toggle (mode/segment chips) | SegmentedButton or FilterChip with a leading check icon + selectedContainer color — color alone never carries selection |

No 2dp-bordered outlined buttons in flows; outlined is reserved for
"outside the card" actions only.

## 4. Chips

One filter-chip system: 32dp height, pill, unselected = surfaceVariant
container + onSurfaceVariant label; selected = secondaryContainer +
onSecondaryContainer + leading 16dp check. Touch targets >= 48dp via
min-height. Labels are content words ("Quizzes", "Mon 9"), never "Clear"
alone — a destructive/chip action names its object ("Reset filters").

## 5. Spacing rhythm

Screen horizontal padding 20dp. Vertical rhythm: 8/12/16/24/32 — tight inside
groups, generous between; more space ABOVE a section header than below it.
Card inner padding 16dp; list row min height 56dp.

## 6. Calendar chrome (the header the user flagged)

Collapse the three stacked chrome rows into two:

- **Title row (48dp):** `Nov 8 – 14` titleLarge (tabular), tap opens the
  Material3 DatePickerDialog; the timetable source ("Semester Schedule")
  becomes a muted subtitle UNDER the range at labelMedium, never competing
  with the controls; right side: Today as a compact TonalButton pill +
  Day/3-Day/Week as a SegmentedButton group (text labels, no bare icon).
- **Day strip (64dp):** the ONLY pager. Seven visible cells per page
  (weekday labelMedium + date number 15sp/600 tabular), paged horizontally
  in 3-day windows with snapping, selected day = filled primary pill +
  onPrimary content, today = 4dp accent dot under the number, days with
  items = 2dp StatusColors dots. Tapping a cell selects + scrolls the grid.
  The standalone arrow/dots pager row is DELETED; swipe on the strip or tap
  cells to navigate. TalkBack: each cell is selectable with a state
  description; the strip is one horizontally scrollable collection.
- Grid/agenda content: unchanged behavior, restyled per sections 1-5
  (16dp cards, no double borders, honest "—" for missing rooms).
- Motion: `animateContentSize()` on the window; 200ms tween, exponential
  ease-out, skipped when `Settings.Global.ANIMATOR_DURATION_SCALE == 0`.

## 7. Acceptance (every screen, every pass)

- Light, Dark and AMOLED screenshots; no raw `Color(0xFF…)` escapes tokens.
- Empty, loading, error and disabled states render real content.
- TalkBack: every control has a state description; nothing is color-only.
- Largest font scale: no fixed heights clip text.
- Every number traceable to the store; honesty copy untouched.
