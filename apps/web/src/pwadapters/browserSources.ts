/**
 * Browser-side source fetchers and memory-held tokens for the PWA tier.
 * Zero refresh tokens stored in localStorage (AGENTS §8).
 * 1h memory-only tokens for GIS / MSAL.
 */

import type { Assessment, FeedConfig, ScheduleData } from "../state/types";
import { getWasmEngine } from "./wasmBridge";

let memoryGoogleToken: string | null = null;
let memoryMsToken: string | null = null;
let memoryGeminiKey: string | null = null;

export function setMemoryGoogleToken(token: string | null): void {
  memoryGoogleToken = token;
}

export function getMemoryGoogleToken(): string | null {
  return memoryGoogleToken;
}

export function setMemoryMsToken(token: string | null): void {
  memoryMsToken = token;
}

export function getMemoryMsToken(): string | null {
  return memoryMsToken;
}

export function setMemoryGeminiKey(key: string | null): void {
  memoryGeminiKey = key;
}

export function getMemoryGeminiKey(): string | null {
  return memoryGeminiKey;
}

/**
 * Whether a key is currently held in memory. The UI asks this so it can say
 * "no key in this session" instead of waiting for a failed AI call to explain
 * it. It never returns the key itself.
 */
export function hasMemoryGeminiKey(): boolean {
  return (memoryGeminiKey ?? "").trim().length > 0;
}

// ---------------------------------------------------------------------------
// Browser-tier OAuth (PWA): 1h access tokens, memory-only, PKCE / GIS.
// Per docs/rebuild/04-rebuild-architecture.md §4.3 — the PWA tier never holds
// a refresh token; re-auth happens on the next session (honest limitation).
// ---------------------------------------------------------------------------

/** The Google scopes the browser tier requests (subset of the desktop loopback union). */
export const GOOGLE_BROWSER_SCOPES =
  "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.appdata openid email profile";

/**
 * Public OAuth **client identifier** for the browser tier's GIS token client.
 *
 * A client id is an identifier, not a credential: it carries no secret and
 * the browser flow (GIS token client, 1h memory-only token) never sends
 * one. The **browser tier ships no client secret at all** — the bundled
 * Google client is confidential and lives only in the desktop shell, so
 * this tier can only use it as a public identifier (GIS needs no secret).
 *
 * The user can override it in Settings → Account; the client's authorized
 * JavaScript origins must contain the origin the PWA is served from. The
 * bundled registration (project `quizradar-511922`) already authorizes the
 * dev origins `http://localhost:4317` and `http://127.0.0.1:4317`.
 */
export const DEFAULT_BROWSER_GOOGLE_CLIENT_ID =
  "438181858687-9etakn8k6fd1en8ra968russdpkjh9jr.apps.googleusercontent.com";

export const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
export const MICROSOFT_AUTHORIZE_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
export const MICROSOFT_TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export const MICROSOFT_ME_ENDPOINT = "https://graph.microsoft.com/v1.0/me";

/**
 * Stage 1 — sign-in scopes. Every scope here is a low user-consent impact
 * scope, so a tenant that requires administrator approval for mail/calendar
 * access can still let the user sign in.
 */
export const MICROSOFT_SIGNIN_SCOPES = "openid profile email User.Read offline_access";

/**
 * Stage 2 — the high-impact scopes needed to actually scan mail and
 * calendars. Requested only when the user asks for scanning access, because
 * many work tenants demand administrator approval for exactly these.
 */
export const MICROSOFT_SCAN_SCOPES =
  "openid profile email User.Read offline_access Mail.Read Calendars.Read";

/** Kept for the full-scope legacy path; the tiers now stage their consent. */
export const MICROSOFT_BROWSER_SCOPES = MICROSOFT_SCAN_SCOPES;

/**
 * Honest, actionable explanation for an OAuth provider error body.
 * Mirrors `core/src/auth/providers.rs::explain_oauth_error` (the desktop
 * shell uses the Rust twin; the browser tier cannot call the Rust core
 * directly, so the mapping is kept in lockstep by tests on both sides).
 */
export function explainOAuthError(provider: "google" | "microsoft", body: string): string {
  const trimmed = body.trim();
  const lower = trimmed.toLowerCase();

  if (provider === "google") {
    if (lower.includes("client_secret")) {
      return "This Google client ID belongs to a Web application client, and Google requires its client secret for the token exchange. Add the matching secret in Settings → Account (Google client secret), or switch to a Desktop app client ID, which needs no secret.";
    }
    if (lower.includes("redirect_uri_mismatch")) {
      return 'Google rejected the redirect URI for this client ID. Add "http://localhost" (any port) under the client\'s Authorized redirect URIs.';
    }
    if (lower.includes("invalid_client")) {
      return "Google rejected this client ID. Copy it again from Google Cloud Console → APIs & Services → Credentials.";
    }
    if (lower.includes("invalid_grant")) {
      return "Google rejected the authorization code. It is single-use and short-lived — start the sign-in again and finish it in the same browser session.";
    }
  }

  if (provider === "microsoft") {
    if (
      lower.includes("aadsts65001") ||
      lower.includes("consent_required") ||
      lower.includes("admin") ||
      lower.includes("authorization_pending")
    ) {
      return "Your Microsoft organization requires administrator approval for this permission, so the consent screen cannot finish on its own. Ask your tenant administrator to grant consent for the app, or sign in with a personal Microsoft account.";
    }
    if (lower.includes("invalid_client") || lower.includes("aadsts7000215")) {
      return "Microsoft rejected this application ID. Copy the Application (client) ID from Azure portal → App registrations — not its secret.";
    }
    if (lower.includes("redirect_uri") || lower.includes("aadsts50011")) {
      return 'Microsoft rejected the redirect URI. Register "http://localhost" (any port) as a Single-page application redirect URI for this app registration.';
    }
    if (lower.includes("invalid_scope")) {
      return "Microsoft rejected one of the requested permissions. Remove the scope from the app registration and try again.";
    }
  }

  if (!trimmed) return "The provider returned no error detail.";
  return trimmed;
}

export interface BrowserProfile {
  email: string | null;
  name: string | null;
  picture: string | null;
}

interface GsiTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
}

interface GsiTokenClient {
  requestAccessToken: (overrides?: { prompt?: string; scope?: string }) => void;
}

interface GsiGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: GsiTokenResponse) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }) => GsiTokenClient;
    };
  };
}

const GSI_SRC = "https://accounts.google.com/gsi/client";

function loadGsiScript(): Promise<GsiGlobal> {
  const w = window as unknown as { google?: GsiGlobal };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const onReady = () => {
      if (w.google?.accounts?.oauth2) resolve(w.google);
      else reject(new Error("Google Identity Services loaded without the oauth2 namespace"));
    };
    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Google Identity Services script")),
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", onReady, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Failed to load Google Identity Services script")),
      { once: true },
    );
    document.head.appendChild(script);
  });
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomB64Url(byteLength: number, cryptoImpl: Crypto = crypto): string {
  const bytes = new Uint8Array(byteLength);
  cryptoImpl.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** SHA-256 S256 PKCE challenge (RFC 7636) matching core/src/auth/pkce.rs. */
export async function pkceChallenge(
  verifier: string,
  cryptoImpl: Crypto = crypto,
): Promise<string> {
  const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Google sign-in on the browser tier: GIS token client → 1h access token
 * held in memory only, then fetch the profile for display anchors.
 * `clientId` is the OAuth "Web application" client ID configured in
 * Settings → Account (the browser tier never sends a client secret).
 */
export async function googleGisLogin(clientId: string): Promise<BrowserProfile> {
  const gsi = await loadGsiScript();

  const token = await new Promise<GsiTokenResponse>((resolve, reject) => {
    let settled = false;
    const client = gsi.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: GOOGLE_BROWSER_SCOPES,
      callback: (response) => {
        if (settled) return;
        settled = true;
        if (response?.access_token) resolve(response);
        else reject(new Error("Google returned no access token"));
      },
      error_callback: (error) => {
        if (settled) return;
        settled = true;
        const reason =
          error?.type === "popup_closed"
            ? "Google sign-in popup was closed"
            : error?.message || "Google sign-in failed";
        reject(new Error(explainOAuthError("google", reason)));
      },
    });
    client.requestAccessToken();
  });

  setMemoryGoogleToken(token.access_token);

  try {
    const resp = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (resp.ok) {
      const profile = (await resp.json()) as { email?: string; name?: string; picture?: string };
      return {
        email: profile.email ?? null,
        name: profile.name ?? null,
        picture: profile.picture ?? null,
      };
    }
    return { email: null, name: null, picture: null };
  } catch {
    // Token is valid; profile fetch failing is non-fatal (honest, not fabricated).
    return { email: null, name: null, picture: null };
  }
}

/**
 * Microsoft sign-in on the browser tier: auth-code + PKCE via a popup window,
 * code exchanged at the v2 token endpoint. The user registers this app's
 * origin (e.g. http://localhost:5173/) as a SPA redirect URI on their own
 * Azure app registration; the client ID is configured in Settings → Account.
 * Access token (1h) is held in memory only.
 *
 * `scopes` defaults to the sign-in-only set; the wider mail/calendar scopes
 * are requested through `grantScanningAccess` so a tenant that demands
 * administrator approval never blocks sign-in itself.
 */
export async function microsoftPkcePopupLogin(
  clientId: string,
  cryptoImpl: Crypto = crypto,
  scopes: string = MICROSOFT_SIGNIN_SCOPES,
  prompt = "select_account",
): Promise<BrowserProfile> {
  const redirectUri = `${window.location.origin}/`;
  const verifier = randomB64Url(48, cryptoImpl);
  const challenge = await pkceChallenge(verifier, cryptoImpl);
  const state = randomB64Url(16, cryptoImpl);

  const authorizeUrl = new URL(MICROSOFT_AUTHORIZE_ENDPOINT);
  authorizeUrl.searchParams.set("client_id", clientId.trim());
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_mode", "fragment");
  authorizeUrl.searchParams.set("scope", scopes);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("prompt", prompt);

  const popup = window.open(
    authorizeUrl.toString(),
    "quizradar-microsoft-auth",
    "popup=true,width=480,height=640",
  );
  if (!popup) {
    throw new Error("Popup blocked — allow popups for this site to connect Microsoft Teams.");
  }

  const code = await new Promise<string>((resolve, reject) => {
    const started = Date.now();
    const poll = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(poll);
        reject(new Error("Microsoft sign-in popup was closed before completing"));
        return;
      }
      if (Date.now() - started > 300_000) {
        window.clearInterval(poll);
        popup.close();
        reject(new Error("Microsoft sign-in timed out (5 minutes)"));
        return;
      }
      try {
        const href = popup.location.href;
        if (!href || href === "about:blank") return;
        if (!href.startsWith(redirectUri)) return;

        const hash = new URLSearchParams(href.split("#")[1] || "");
        const err = hash.get("error");
        if (err) {
          window.clearInterval(poll);
          popup.close();
          const raw = `Microsoft sign-in failed: ${err} — ${hash.get("error_description") || ""}`;
          reject(new Error(explainOAuthError("microsoft", raw)));
          return;
        }
        const returnedState = hash.get("state");
        const codeParam = hash.get("code");
        if (codeParam) {
          window.clearInterval(poll);
          popup.close();
          if (returnedState !== state) {
            reject(new Error("Microsoft sign-in state mismatch — possible CSRF; aborted"));
            return;
          }
          resolve(codeParam);
        }
      } catch {
        // Cross-origin while the popup is still on login.microsoftonline.com — keep polling
      }
    }, 400);
  });

  const tokenResp = await fetch(MICROSOFT_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId.trim(),
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: scopes,
    }),
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    throw new Error(
      explainOAuthError("microsoft", `HTTP ${tokenResp.status}: ${text.slice(0, 300)}`),
    );
  }

  const tokenJson = (await tokenResp.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error("Microsoft token endpoint returned no access token");
  }
  setMemoryMsToken(tokenJson.access_token);

  try {
    const meResp = await fetch(MICROSOFT_ME_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (meResp.ok) {
      const me = (await meResp.json()) as {
        displayName?: string;
        mail?: string;
        userPrincipalName?: string;
      };
      return {
        email: me.mail ?? me.userPrincipalName ?? null,
        name: me.displayName ?? null,
        picture: null,
      };
    }
    return { email: null, name: null, picture: null };
  } catch {
    return { email: null, name: null, picture: null };
  }
}

export interface BrowserScanResult {
  assessments: Assessment[];
  errors: string[];
  /** How many enabled feeds were actually fetched (a failed fetch is not one). */
  fetched: number;
  /**
   * The feeds that RAN in this scan, with the id of their run.
   *
   * A feed is its own source: one feed failing (or being deleted) must
   * never retire another feed's announcements. The run id is what lets a
   * later scan tell what a feed stopped reporting - the core decides what
   * that means.
   */
  sourceRuns: { name: string; runId: string }[];
}

/**
 * Scans public .ics feeds via browser fetch.
 * When CORS blocks a feed, records an honest error instead of pretending success.
 *
 * `signal` aborts the scan (the overlay's Cancel button): the in-flight
 * request is dropped and nothing is written.
 */
export async function scanBrowserFeeds(
  feeds: FeedConfig[],
  schedule: ScheduleData,
  todayIso: string,
  signal?: AbortSignal,
): Promise<BrowserScanResult> {
  const wasm = await getWasmEngine();
  const found: Assessment[] = [];
  const errors: string[] = [];
  const sourceRuns: { name: string; runId: string }[] = [];
  let fetched = 0;

  for (const feed of feeds) {
    if (!feed.enabled) continue;
    if (signal?.aborted) break;
    try {
      const resp = await fetch(feed.url, { mode: "cors", signal });
      if (!resp.ok) {
        errors.push(`Feed "${feed.name}" returned HTTP ${resp.status}`);
        continue;
      }
      const text = await resp.text();
      // The feed's OWN label becomes each item's source, exactly as on the
      // desktop - so a browser scan and a desktop scan agree on what an
      // item is and which feed it came from.
      const parsed = JSON.parse(
        wasm.parse_ics_feed(text, JSON.stringify(schedule), todayIso, feed.name),
      ) as Assessment[];
      found.push(...parsed);
      fetched += 1;
      sourceRuns.push({
        name: feed.name,
        runId: wasm.source_run_id(feed.name, new Date().toISOString()),
      });
    } catch (err) {
      if (signal?.aborted) break;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(
        `Feed "${feed.name}" failed: ${msg}. If blocked by CORS in the browser, export/import .ics instead.`,
      );
    }
  }

  return { assessments: found, errors, fetched, sourceRuns };
}

/**
 * Validates a user-supplied Gemini API key by pinging the model list endpoint.
 * Key travels in x-goog-api-key header only (AGENTS §8).
 */
export async function validateGeminiKeyBrowser(
  key: string,
): Promise<{ valid: boolean; error?: string }> {
  if (!key.trim()) {
    return { valid: false, error: "API key cannot be empty" };
  }

  try {
    const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
      headers: {
        "x-goog-api-key": key.trim(),
      },
    });

    if (resp.status === 200) {
      return { valid: true };
    }

    if (resp.status === 400 || resp.status === 403) {
      return { valid: false, error: "Invalid API key or unauthorized" };
    }

    return { valid: false, error: `Validation request returned HTTP ${resp.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Network error validating Gemini key: ${msg}` };
  }
}
