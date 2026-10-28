## 2026-03-02 - Responsive Header Icon Buttons and Interactive Element Semantics

**Learning:** Interactive header elements (like brand home triggers or user profile badges) rendered as `<div>`s are inaccessible to keyboard users, and buttons using responsive display utilities (e.g. `hidden md:inline`) become unlabelled icon-only controls on small viewports if `aria-label` is omitted.
**Action:** Always semantize clickable containers as `<button>` elements with explicit `aria-label` attributes and implement ARIA tab roles (`role="tablist"`, `role="tab"`, `aria-selected`) with dynamic JS updates for tabbed view switchers.
