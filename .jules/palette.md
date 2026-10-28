## 2026-10-21 - Keyboard Shortcut Event Handlers for Modal Dismissal
**Learning:** Modal close handlers invoked within global keyboard shortcut listeners (e.g., `Escape` key listeners) must strictly match exact function names (`closeAccountModal` vs `closeAccountProfileModal`), preventing runtime `ReferenceError` exceptions that break keyboard navigation and accessibility.
**Action:** Audit and verify that all keyboard shortcut event listeners map to valid, declared modal dismissal functions.
