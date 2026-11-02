## 2026-03-31 - Semantic Triggers and Modal Escape Handling for Header Action Pills

**Learning:** Header profile badges/pills are frequently styled as interactive containers (`<div onclick="...">`), making them completely unreachable via standard keyboard navigation (`Tab` / `Enter` / `Space`) and inaccessible to screen readers without explicit ARIA semantics. Additionally, modal controllers that bind global `Escape` key handlers can easily drift from actual close helper identifiers (e.g. `closeAccountProfileModal` vs `closeAccountModal`), leading to unhandled runtime errors that trap keyboard users inside open sheets.

**Action:** Always render top-bar profile triggers as semantic `<button type="button">` elements with explicit `aria-label` attributes and text-alignment resets, and verify modal dismissal stacks during keyboard shortcut audits.
