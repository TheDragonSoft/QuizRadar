/**
 * External-link guard for URLs that arrive from *scanned* data.
 *
 * Announcement bodies are attacker-influenced input: a quiz announcement can
 * carry `javascript:alert(1)` in a link, and the assessment record keeps
 * that string verbatim. Rendering it straight into an `href` hands the
 * sender script execution inside the app's origin (the desktop webview loads
 * the bundle from `tauri://localhost`, the PWA from its own origin).
 *
 * v4 had the same hole (`v4-final:static/app.js` applied `safeExternalUrl`
 * only to the Google Calendar link); v5 applies it to every outbound link.
 *
 * The rule is deliberately narrow: only `https://` links are allowed, and
 * quote characters are rejected outright so a URL can never break out of the
 * attribute it is rendered into.
 */

/** True when the string carries a C0 control character or DEL. */
function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Returns the URL when it is safe to put in an `href`, or `""` when it is not.
 *
 * Callers must render nothing (or a disabled affordance) for an empty
 * result — never `href="#"`, which silently pretends the link works.
 */
export function safeExternalUrl(url: string | null | undefined): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  if (raw.includes('"') || raw.includes("'") || raw.includes("<") || raw.includes(">")) return "";
  if (hasControlCharacters(raw)) return "";
  if (/^https:\/\/calendar\.google\.com\//i.test(raw)) return raw;
  if (!/^https:\/\//i.test(raw)) return "";
  return raw;
}
