## 2026-10-24 - Semantic Buttons for Header Action Pills & Mobile Navigation
**Learning:** In desktop and mobile header navigation bars, interactive elements rendered as `<div>` with `onclick` listeners block keyboard focus and screen reader interaction. Replacing them with `<button type="button">` combined with explicit `aria-label`s ensures full keyboard accessibility while preserving existing Tailwind CSS flex layout.
**Action:** Always wrap interactive navigation pills and brand triggers in semantic `<button type="button">` with `aria-label` attributes.
