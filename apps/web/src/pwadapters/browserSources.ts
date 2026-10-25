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

export interface BrowserScanResult {
  assessments: Assessment[];
  errors: string[];
}

/**
 * Scans public .ics feeds via browser fetch.
 * When CORS blocks a feed, records an honest error instead of pretending success.
 */
export async function scanBrowserFeeds(
  feeds: FeedConfig[],
  schedule: ScheduleData,
  todayIso: string,
): Promise<BrowserScanResult> {
  const wasm = await getWasmEngine();
  const found: Assessment[] = [];
  const errors: string[] = [];

  for (const feed of feeds) {
    if (!feed.enabled) continue;
    try {
      const resp = await fetch(feed.url, { mode: "cors" });
      if (!resp.ok) {
        errors.push(`Feed "${feed.name}" returned HTTP ${resp.status}`);
        continue;
      }
      const text = await resp.text();
      const parsed = JSON.parse(
        wasm.parse_ics(text, JSON.stringify(schedule), todayIso),
      ) as Assessment[];
      found.push(...parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(
        `Feed "${feed.name}" failed: ${msg}. If blocked by CORS in the browser, export/import .ics instead.`,
      );
    }
  }

  return { assessments: found, errors };
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
