## 2026-03-31 - Explicit Label-to-Input Association for Screen Readers & Touch Targets
**Learning:** Modal form inputs lacking explicit `for` attributes on `<label>` elements prevent screen readers (VoiceOver/TalkBack) from announcing input field names when focused and prevent tap/click target focusing on touch and desktop interfaces.
**Action:** Always pair every `<label>` with `for="[input-id]"` when creating or updating modal form fields.
