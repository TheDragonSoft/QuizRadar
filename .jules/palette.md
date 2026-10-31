## 2026-03-31 - Semantic Tab Roles and Keyboard Escape Resilience in Modals

**Learning:** Segmented mode switches inside dialogs (such as Pomodoro focus/break mode selectors) often mimic tab interfaces visually but omit `role="tablist"`, `role="tab"`, and `aria-selected` attributes, rendering their state invisible to screen readers. In addition, modal escape key dismissal loops rely on precise function names (`closeAccountModal` rather than outdated variants like `closeAccountProfileModal`), which can silently break keyboard escape behavior when desynchronized.

**Action:** Always provide `role="tablist"` and dynamic `aria-selected` updates on segmented controls, and verify that all modal escape hooks invoke matching, active close handlers.
