## 2026-03-02 - Accessible Color Swatches and Dynamic Modal Sub-rows

**Learning:** Purely visual circle swatches in dynamic modal pickers are invisible to screen readers unless given an accessible group role (`role="group"` with `aria-labelledby`), human-readable labels (`aria-label="Select [Color] theme color"`), selection state announcements (`aria-pressed="true|false"`), and explicit `:focus-visible` ring styling for keyboard navigators. Similarly, dynamically injected row elements like class timetable slots must have contextual `aria-label`s on their unlabeled inputs to ensure screen reader users understand the purpose of each control.

**Action:** Whenever generating swatch buttons or repeatable form rows in modal dialogs, always pair programmatic selection state (`aria-pressed`), accessible descriptions, and `:focus-visible` keyboard rings.
