## 2026-10-25 - ARIA Labels on Collapsible Header Buttons & Swatches
**Learning:** Buttons that collapse text labels on responsive breakpoints (e.g. `hidden sm:inline` or `hidden md:inline`) become icon-only controls on mobile/small viewports and require explicit `aria-label` attributes for screen reader accessibility. Color swatches and quick action icons in dynamic lists also need ARIA labels.
**Action:** When creating responsive buttons that hide text or dynamic icon-only buttons, always include descriptive `aria-label` attributes.
