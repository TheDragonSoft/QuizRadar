---
target: apps/web/src/views/DashboardView.tsx
total_score: 26
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 1
target_identity: "file:D:\\Projects\\QuizRadar\\apps\\web\\src\\views\\DashboardView.tsx"
target_fingerprint: "sha256:e41968148df9f6b8f62501546d35bb5a1caf8f75d7355be46fdd30df80b11169"
target_path: "D:\\Projects\\QuizRadar\\apps\\web\\src\\views\\DashboardView.tsx"
timestamp: 2026-11-08T00-32-08Z
slug: apps-web-src-views-dashboardview-tsx
---

# Impeccable Design Critique: QuizRadar Dashboard Surface

**Target**: `apps/web/src/views/DashboardView.tsx`  
**Related Components**: `apps/web/src/components/TimelineHorizon.tsx`, `apps/web/src/components/ConflictBanner.tsx`  
**Visual Artifacts Evaluated**: `after-desktop-timeline-horizon.png`, `after-desktop-widescreen-mission-control.png`, `after-desktop-widescreen-mission-control-scrolled.png`

---

## Design Health Score

| #         | Heuristic                       |   Score   | Key Issue                                                                                            |
| --------- | ------------------------------- | :-------: | ---------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status     |     2     | Hero banner displays "No Upcoming Quizzes Scheduled" while Horizon renders Midterm tomorrow.         |
| 2         | Match System / Real World       |     2     | Astrophysics jargon ("celestial academic bodies", "gravity windows") creates cognitive friction.     |
| 3         | User Control and Freedom        |     3     | Sticky hero canopy consumes ~35% of vertical space with no minimize/collapse affordance.             |
| 4         | Consistency and Standards       |     2     | Upcoming assessments are fractured across three different locations on widescreen.                   |
| 5         | Error Prevention                |     3     | Strong conflict mitigation logic, but horizon lacks end-of-runway scroll indicator.                  |
| 6         | Recognition Rather Than Recall  |     3     | Truncated timetable blocks (`Digital ...`, `Calculu...`) force students to recall course details.    |
| 7         | Flexibility and Efficiency      |     3     | Strong shortcuts (`Ctrl+K`), but lacks horizontal keyboard scrub for timeline runway.                |
| 8         | Aesthetic and Minimalist Design |     2     | Visual clutter: sticky canopy, multi-hue gradients, starlight particles, and up to 6 chips per card. |
| 9         | Error Recovery                  |     3     | Clear search recovery CTA, but contradictory sync counts lack inline diagnostic hints.               |
| 10        | Help and Documentation          |     3     | Contextual tooltips present, but lacks 1-sentence onboarding for logarithmic time scale.             |
| **Total** |                                 | **26/40** | **Acceptable (Band: 20–27)**                                                                         |

---

## Design Specificity Verdict

### LLM Assessment

QuizRadar delivers a distinctive, non-generic personality that decisively rejects category-interchangeable SaaS templates. Its **Astronomical Timeline Horizon** reflects an authentic academic insight: student perception of time is non-linear ($\log(1+d)$ expands critical 48h windows while compressing distant milestones).

However, the design currently suffers from **thematic inflation**: astrophysics terminology (_"approaching celestial academic bodies"_, _"gravity windows"_, _"orbital trajectory"_) overcomplicates what should feel like a serene academic cockpit. The observatory metaphor works best as an ambient sanctuary (deep contrast, peaceful dark sky pacing), not a sci-fi flight simulator.

### Deterministic Scan

- **CLI Scan**: 0 syntax/structural findings across `.tsx` target files.
- **Rendered DOM Evaluation**:
  - `radial-halo`: Flagged solar halo in `DashboardView.tsx` (confirmed **false positive**; daylight sun disk restricted to light themes via `dark:hidden`).
  - `dark-glow`: Flagged red/amber shadows in `TimelineHorizon.tsx` and `tokens.css` (confirmed **intentional domain spec** for 48h exam crunch states per `01-product-spec.md` §6.1).
  - `ai-color-palette`: Flagged multi-hue linear gradients in `TimelineHorizon.tsx:181, 366`.

### Visual Overlays

Overlays were evaluated via Playwright capture runs (`after-desktop-timeline-horizon.png`, `after-desktop-widescreen-mission-control.png`).

---

## Overall Impression

QuizRadar has transitioned from a generic SaaS layout to a purposeful, high-craft academic observatory. The logarithmic temporal curve and one-click balanced conflict scheduler are elite, product-defining features. The primary obstacles are viewport cannibalization by the sticky hero, selector divergence causing contradictory status copy, and over-indexing on aerospace jargon.

---

## What's Working

1. **Logarithmic Time Horizon (`TimelineHorizon.tsx`)**: The mathematical projection $\log(1+d) / \log(1+28)$ expands $T-0$ to $T-2$ days where active prep occurs, reflecting the student mental model far better than linear calendars.
2. **The Emerald Shield State (`ConflictBanner.tsx`)**: The transition from high-anxiety amber conflict alerts to an emerald `ShieldCheck` status upon drafting a balanced flight path provides tangible emotional relief.
3. **Observatory Atmosphere & Nocturnal Comfort**: Pitch AMOLED surfaces (`#000000` / `#0A0B10`) paired with subtle star sheens create a restful study environment for nocturnal sessions.

---

## Priority Issues

### [P0] Data Inconsistency Between Hero Spotlight and Timeline Horizon

- **Why it matters**: The hero banner announces _"No Upcoming Quizzes Scheduled"_ directly above an exam card labeled _"Tomorrow"_, shattering student trust in the radar's completeness.
- **Fix**: Unify the upcoming item pipeline. `NextUpHero` must select from the same unified assessment and custom event set that powers `TimelineHorizon`.
- **Suggested command**: `$impeccable harden apps/web/src/views/DashboardView.tsx`

### [P1] Viewport Cannibalization by Sticky Hero Canopy

- **Why it matters**: The sticky canopy consumes 240px+ of fixed vertical height, locking ~35% of the viewport and causing scrolled content to be awkwardly clipped underneath.
- **Fix**: Unpin the hero banner from `sticky top-0` so it scrolls naturally with document flow, or collapse it into a slim 36px ticker when scrolled past the fold.
- **Suggested command**: `$impeccable layout apps/web/src/views/DashboardView.tsx`

### [P2] Thematic Metaphor Inflation (Astrophysics Jargon)

- **Why it matters**: Phrases like _"approaching celestial academic bodies"_ and _"gravity windows"_ force extraneous cognitive translation on tired students seeking simple clarity.
- **Fix**: Clarify copy into calm, reassuring academic language (e.g. _"Timeline Horizon · Next 30 Days"_, _"48-Hour Exam Cluster"_, _"Balanced Study Runway"_).
- **Suggested command**: `$impeccable clarify apps/web/src/components/TimelineHorizon.tsx`

### [P2] Widescreen Triple-Redundancy of Upcoming Deadlines

- **Why it matters**: On viewports $\ge 1200\text{px}$, upcoming assessments appear simultaneously in the Horizon, the right-pane Upcoming Radar list, and the Calendar Grid, crowding out study topic checklists.
- **Fix**: Let the Timeline Horizon own chronological projection; remove the redundant right-pane "Upcoming Radar" list and expand the Daily Study Roadmap and topic mastery checklists.
- **Suggested command**: `$impeccable distill apps/web/src/views/DashboardView.tsx`

### [P3] Stacked Confirmation Toasts Obscuring Controls

- **Why it matters**: Success toasts accumulate in the bottom-right corner without auto-dismissal, permanently blocking the lower pane and timetable actions.
- **Fix**: Implement a 4-second auto-dismiss timer and cap visible toasts to a maximum of 2.
- **Suggested command**: `$impeccable polish apps/web/src/views/DashboardView.tsx`

---

## Persona Red Flags

### Alex (Power User / Honors CS Student)

- **Horizon Horizontal Scrub**: Horizon requires horizontal swiping to inspect events beyond 7 days, which is slower than a dense, vertically scrubbable agenda.
- **Calendar Block Truncation**: Severe text truncation in calendar blocks (`Digital ... Lecture · R...`) forces extra clicks to read room numbers.

### Jordan (First-Timer / Freshman)

- **Contradictory Status**: Seeing "No Upcoming Quizzes Scheduled" above "Midterm Tomorrow" causes immediate confusion about whether imports succeeded.
- **Aerospace Jargon**: Space-mission terminology makes the app feel like flight-control software rather than a calming academic planner.

### Morgan (Stressed / Working Student)

- **Anxiety-Inducing Beacons**: Flashing red warning beacons (`animate-ping`) and `CRUNCH ORBIT` copy induce panic rather than providing calm reassurance.
- **Sleep & Shift Buffers**: Lack of explicit bedtime and work-shift buffer tags leaves Morgan uncertain whether auto-scheduled blocks clash with employment or rest.

---

## Minor Observations

1. **Sidebar Footer Encoding**: Sidebar displays `• Nb sources connected` (truncation defect for `No sources connected`).
2. **Track Shimmer Distraction**: Continuous linear shimmer across the logarithmic track creates peripheral eye distraction.
3. **Card Micro-Badge Density**: Up to 6 separate chips per horizon card creates visual clutter.

---

## Questions to Consider

1. What if the Timeline Horizon was the **only** chronological projection on the dashboard, retiring the redundant right-pane list to give study plans maximum breathing room?
2. What if QuizRadar spoke with the quiet calm of an air-traffic controller ("Two exams detected in 48h · Balanced study runway ready") rather than flashing red emergency beacons?
3. What if the hero canopy scrolled naturally with the page, returning 240 vertical pixels directly to the student's timetable?
