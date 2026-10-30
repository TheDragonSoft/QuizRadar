## 2026-10-30 - Non-semantic Interactive Header Elements
**Learning:** Top navigation bars in static single-page web dashboards often use clickable `div` elements with `onclick` handlers for brand links or profile badges, making them non-focusable and hidden from screen readers.
**Action:** Always convert interactive header containers with `onclick` handlers to semantic `<button type="button">` elements with appropriate `aria-label` attributes and reset button styles.
