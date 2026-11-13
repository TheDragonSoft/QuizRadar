/**
 * Sign-in helpers for the authenticated QuizRadar web-app UX sweep.
 *
 * The helpers below only touch the safe, read-only or explicitly allowed controls:
 * the topbar settings button, the settings section navigation buttons, the OAuth
 * client id inputs, the "Sign in with Google" / "Sign in with Microsoft" buttons,
 * the "Grant mail & calendar access" button, the topbar Sync button and modal
 * Close/Cancel buttons. They never reload the page, never close the browser or the
 * browser context, and never disconnect, delete, revoke or purge anything.
 *
 * Every exported function is defensive: it never throws and always resolves with a
 * small result object. Tokens, cookies, authorization headers, client secrets and
 * URLs carrying a query string are never returned or logged.
 */

const DEFAULT_SIGNIN_TIMEOUT_MS = 600000;
const DEFAULT_SCAN_TIMEOUT_MS = 120000;
const SCAN_MODAL_OPEN_TIMEOUT_MS = 15000;
const TOAST_POLL_MS = 250;
const SCAN_TEXT_POLL_MS = 500;
const DETAILS_TITLE = "Advanced Settings & Custom OAuth Overrides";

/**
 * Pause for the given number of milliseconds.
 *
 * @param {number} ms Delay in milliseconds.
 * @returns {Promise<void>} Resolves once the delay has elapsed.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reduce a free-form string to something safe to print or return: query strings are
 * stripped from URLs, e-mail addresses are masked and long opaque blobs are removed.
 *
 * @param {unknown} value Raw text.
 * @returns {string} Sanitized, whitespace-collapsed text.
 */
function sanitizeText(value) {
  if (typeof value !== "string") return "";
  let text = value.replace(/https?:\/\/[^\s"'<>)\]]+/gi, (raw) => {
    try {
      const parsed = new URL(raw);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      const cut = raw.indexOf("?");
      return cut === -1 ? raw : raw.slice(0, cut);
    }
  });
  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
  text = text.replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Trim a string to a maximum length without leaving a dangling separator.
 *
 * @param {unknown} value Raw text.
 * @param {number} max Maximum number of characters.
 * @returns {string} Trimmed text.
 */
function trimTo(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length <= max) return text;
  return text.slice(0, max).trim();
}

/**
 * Build a short, human-readable failure phrase from an outcome message.
 *
 * @param {string} headline Stable headline such as "Google sign-in failed".
 * @param {string} message Raw provider or app message.
 * @returns {string} A short phrase, never longer than roughly 200 characters.
 */
function failureDetail(headline, message) {
  const safe = sanitizeText(message);
  if (!safe) return `${headline}.`;
  if (safe.toLowerCase().startsWith(headline.toLowerCase())) {
    const rest = safe
      .slice(headline.length)
      .replace(/^[\s:.\-—]+/, "")
      .trim();
    return rest ? `${headline}: ${trimTo(rest, 160)}` : `${headline}.`;
  }
  return `${headline}.`;
}

/**
 * Return the first element of a locator that is currently visible.
 *
 * @param {import("playwright").Locator} locator Locator to inspect.
 * @returns {Promise<import("playwright").Locator | null>} A visible locator or null.
 */
async function firstVisible(locator) {
  try {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible()) return candidate;
    }
  } catch {
    /* the locator is gone or the page changed */
  }
  return null;
}

/**
 * Check whether the text of a locator looks like a settled scan outcome.
 *
 * @param {string} text Captured modal text.
 * @returns {boolean} True when the text reports a result rather than progress.
 */
function looksLikeOutcome(text) {
  if (!text) return false;
  return /error|fail|denied|blocked|deny|cancell?ed|complete|finished|found|success|no results/i.test(
    text,
  );
}

/**
 * Close the onboarding modal when it is on screen, so it cannot shadow the
 * account buttons.
 *
 * @param {import("playwright").Page} page Active page.
 * @returns {Promise<boolean>} True when no onboarding modal blocks the screen.
 */
async function dismissOnboardingIfPresent(page) {
  try {
    const modal = await firstVisible(page.locator('[data-testid="modal-onboarding"]'));
    if (!modal) return true;
    const close = await firstVisible(modal.locator('button[aria-label="Close"]'));
    if (!close) return false;
    await close.click({ timeout: 10000 });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const still = await firstVisible(page.locator('[data-testid="modal-onboarding"]'));
      if (!still) return true;
      await sleep(150);
    }
    return !(await firstVisible(page.locator('[data-testid="modal-onboarding"]')));
  } catch {
    return false;
  }
}

/**
 * Open the full-screen settings view, clicking the topbar settings button when the
 * view is not on screen yet.
 *
 * @param {import("playwright").Page} page Active page.
 * @returns {Promise<boolean>} True when the settings view is visible.
 */
async function openSettings(page) {
  try {
    await dismissOnboardingIfPresent(page);
    const existing = await firstVisible(page.locator('[data-testid="view-settings"]'));
    if (existing) return true;
    const button = await firstVisible(
      page.locator('[data-testid="app-topbar"] button[aria-label="Open settings"]'),
    );
    if (!button) return false;
    await button.click({ timeout: 10000 });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const opened = await firstVisible(page.locator('[data-testid="view-settings"]'));
      if (opened) return true;
      await sleep(150);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Scroll the settings view to the Account section.
 *
 * @param {import("playwright").Page} page Active page.
 * @returns {Promise<boolean>} True when the settings view is open.
 */
async function openAccountSection(page) {
  try {
    const opened = await openSettings(page);
    if (!opened) return false;
    const nav = await firstVisible(page.locator('[data-testid="settings-nav-account"]'));
    if (nav) {
      try {
        await nav.click({ timeout: 10000 });
      } catch {
        /* navigation is a scroll only; a failure here is not fatal */
      }
      await sleep(200);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Expand the "Advanced Settings & Custom OAuth Overrides" disclosure inside the
 * settings view.
 *
 * @param {import("playwright").Page} page Active page.
 * @returns {Promise<boolean>} True when the disclosure is expanded.
 */
async function expandAdvancedDetails(page) {
  try {
    const details = await firstVisible(page.locator(`details:has-text("${DETAILS_TITLE}")`));
    if (!details) return false;
    const isOpen = await details.evaluate((element) => element.open === true);
    if (isOpen) return true;
    const summary = await firstVisible(
      page.locator(`details:has-text("${DETAILS_TITLE}") > summary`),
    );
    const fallback =
      summary || (await firstVisible(page.locator("summary").filter({ hasText: DETAILS_TITLE })));
    if (!fallback) return false;
    await fallback.click({ timeout: 10000 });
    await sleep(250);
    return await details.evaluate((element) => element.open === true);
  } catch {
    return false;
  }
}

/**
 * Scroll the settings view to the Integrations section and expand the advanced
 * OAuth overrides disclosure so the client id inputs are usable.
 *
 * @param {import("playwright").Page} page Active page.
 * @returns {Promise<boolean>} True when the integrations section is reachable.
 */
async function openIntegrationsSection(page) {
  try {
    const opened = await openSettings(page);
    if (!opened) return false;
    const nav = await firstVisible(page.locator('[data-testid="settings-nav-integrations"]'));
    if (nav) {
      try {
        await nav.click({ timeout: 10000 });
      } catch {
        /* navigation is a scroll only; a failure here is not fatal */
      }
      await sleep(200);
    }
    await expandAdvancedDetails(page);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the text of every visible toast, falling back to the toast container text.
 *
 * @param {import("playwright").Page} page Active page.
 * @returns {Promise<string[]>} The raw toast texts.
 */
async function readToastTexts(page) {
  const texts = [];
  try {
    const toasts = page.locator('[data-testid^="toast-"]:not([data-testid="toast-container"])');
    const count = await toasts.count();
    for (let index = 0; index < count; index += 1) {
      const text = await toasts
        .nth(index)
        .innerText({ timeout: 1000 })
        .catch(() => "");
      if (text && text.trim()) texts.push(text.trim());
    }
    if (texts.length === 0) {
      const container = await firstVisible(page.locator('[data-testid="toast-container"]'));
      if (container) {
        const text = await container.innerText({ timeout: 1000 }).catch(() => "");
        if (text && text.trim()) texts.push(text.trim());
      }
    }
  } catch {
    /* toasts may disappear between two reads */
  }
  return texts;
}

/**
 * Collect the text currently shown by the toast container.
 *
 * @param {import("playwright").Page} page Active page.
 * @returns {Promise<string>} The sanitized toast container text, or an empty string.
 */
async function collectToastText(page) {
  try {
    const container = await firstVisible(page.locator('[data-testid="toast-container"]'));
    if (!container) return "";
    const text = await container.innerText({ timeout: 1000 }).catch(() => "");
    return sanitizeText(text);
  } catch {
    return "";
  }
}

/**
 * Poll quickly for a toast that reports success or failure.
 *
 * @param {import("playwright").Page} page Active page.
 * @param {{ successNeedles?: string[], failureNeedles?: string[], timeoutMs?: number }} options
 *   Needle lists and the maximum wait.
 * @returns {Promise<{ ok: boolean, message: string }>} The outcome; never throws.
 */
async function waitForToastOutcome(page, { successNeedles = [], failureNeedles = [], timeoutMs }) {
  const deadline =
    Date.now() + (typeof timeoutMs === "number" ? timeoutMs : DEFAULT_SIGNIN_TIMEOUT_MS);
  const success = successNeedles.map((needle) => String(needle).toLowerCase());
  const failure = failureNeedles.map((needle) => String(needle).toLowerCase());
  try {
    while (Date.now() < deadline) {
      const texts = await readToastTexts(page);
      for (const text of texts) {
        const lower = text.toLowerCase();
        if (success.some((needle) => lower.includes(needle))) {
          return { ok: true, message: trimTo(sanitizeText(text), 300) };
        }
        if (failure.some((needle) => lower.includes(needle))) {
          return { ok: false, message: trimTo(sanitizeText(text), 300) };
        }
      }
      await sleep(TOAST_POLL_MS);
    }
  } catch {
    return { ok: false, message: "" };
  }
  return { ok: false, message: "" };
}

/**
 * Watch the browser context for sign-in popups and print one generic guidance line
 * when the Google or Microsoft consent page shows up.
 *
 * @param {import("playwright").BrowserContext} context Browser context.
 * @param {{ label: string }} options Human readable label such as "Microsoft sign-in".
 * @returns {{ pages: import("playwright").Page[], stop: () => void }} The watcher.
 */
function popupWatcher(context, { label }) {
  const pages = [];
  const announced = new WeakSet();
  let stopped = false;

  const announce = (popup) => {
    try {
      if (!popup || announced.has(popup)) return;
      const url = popup.url();
      if (!url || url.startsWith("about:")) return;
      const lower = url.toLowerCase();
      const wantsGoogle = String(label || "")
        .toLowerCase()
        .startsWith("google");
      const relevant = wantsGoogle
        ? lower.includes("accounts.google.com")
        : lower.includes("login.microsoftonline.com");
      if (!relevant) return;
      announced.add(popup);
      console.log(`ACTION NEEDED: finish the ${label} in the popup window that just opened.`);
    } catch {
      /* the popup may already be closed */
    }
  };

  const onPage = (popup) => {
    pages.push(popup);
    announce(popup);
    try {
      popup.on("framenavigated", (frame) => {
        try {
          if (frame === popup.mainFrame()) announce(popup);
        } catch {
          /* ignore frame errors */
        }
      });
    } catch {
      /* ignore popup errors */
    }
  };

  const timer = setInterval(() => {
    for (const popup of pages) announce(popup);
  }, 300);
  if (typeof timer.unref === "function") timer.unref();

  try {
    context.on("page", onPage);
  } catch {
    /* the context may already be closed */
  }

  return {
    pages,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      try {
        context.off("page", onPage);
      } catch {
        /* the context may already be closed */
      }
    },
  };
}

/**
 * Check whether a locator sits inside a card that belongs to one provider only.
 *
 * @param {import("playwright").Locator} locator Element to scope.
 * @param {string[]} vendorTokens Tokens that identify the wanted provider.
 * @param {string[]} otherTokens Tokens that identify the other provider.
 * @returns {Promise<boolean>} True when the nearest card mentions only the vendor.
 */
async function scopedToVendor(locator, vendorTokens, otherTokens) {
  try {
    return await locator.evaluate(
      (element, vendor, other) => {
        let node = element;
        for (let depth = 0; depth < 8; depth += 1) {
          const parent = node.parentElement;
          if (!parent) return false;
          node = parent;
          const lower = (parent.innerText || "").toLowerCase();
          if (!lower) continue;
          const hasVendor = vendor.some((token) => lower.includes(token));
          const hasOther = other.some((token) => lower.includes(token));
          if (hasVendor && !hasOther) return true;
          if (hasOther && !hasVendor) return false;
        }
        return false;
      },
      vendorTokens,
      otherTokens,
    );
  } catch {
    return false;
  }
}

/**
 * Detect whether one provider card reports an active connection.
 *
 * @param {import("playwright").Page} page Active page.
 * @param {string[]} vendorTokens Tokens that identify the provider card.
 * @param {string[]} otherTokens Tokens that identify the other provider card.
 * @returns {Promise<boolean>} True when the provider looks connected.
 */
async function detectVendorConnected(page, vendorTokens, otherTokens) {
  try {
    const root = await firstVisible(page.locator('[data-testid="view-settings"]'));
    if (!root) return false;

    const paragraphMatch = await root.evaluate(
      (rootElement, vendor, other) => {
        const nodes = rootElement.querySelectorAll("p, span, div, li");
        for (const element of nodes) {
          const text = (element.innerText || "").trim();
          if (!text || text.length > 400 || !/^connected\b/i.test(text)) continue;
          let node = element;
          for (let depth = 0; depth < 8; depth += 1) {
            const parent = node.parentElement;
            if (!parent) break;
            node = parent;
            const lower = (parent.innerText || "").toLowerCase();
            if (!lower) continue;
            const hasVendor = vendor.some((token) => lower.includes(token));
            const hasOther = other.some((token) => lower.includes(token));
            if (hasVendor && !hasOther) return true;
            if (hasOther && !hasVendor) break;
          }
        }
        return false;
      },
      vendorTokens,
      otherTokens,
    );
    if (paragraphMatch) return true;

    const disconnect = page.getByRole("button", { name: "Disconnect", exact: true });
    const count = await disconnect.count();
    for (let index = 0; index < count; index += 1) {
      if (await scopedToVendor(disconnect.nth(index), vendorTokens, otherTokens)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Read the current value of the Microsoft Azure client id override input.
 *
 * @param {import("playwright").Page} page Active page.
 * @returns {Promise<string>} The trimmed input value, or an empty string.
 */
async function readTeamsClientId(page) {
  try {
    const input = page.locator("#settings-ms-client-id");
    if ((await input.count()) === 0) return "";
    const value = await input
      .first()
      .inputValue({ timeout: 3000 })
      .catch(() => "");
    return (value || "").trim();
  } catch {
    return "";
  }
}

/**
 * Read the current value of the Google OAuth client id override input.
 *
 * @param {import("playwright").Page} page Active page.
 * @returns {Promise<string>} The trimmed input value, or an empty string.
 */
async function readGoogleClientId(page) {
  try {
    const input = page.locator("#settings-google-client-id");
    if ((await input.count()) === 0) return "";
    const value = await input
      .first()
      .inputValue({ timeout: 3000 })
      .catch(() => "");
    return (value || "").trim();
  } catch {
    return "";
  }
}

/**
 * Close the scan progress modal when it refuses to auto-close.
 *
 * @param {import("playwright").Locator} modal The scan modal locator.
 * @returns {Promise<void>} Resolves once a best-effort close was attempted.
 */
async function closeScanModal(modal) {
  try {
    const close = await firstVisible(modal.locator('button[aria-label="Close"]'));
    if (close) {
      await close.click({ timeout: 5000 }).catch(() => {});
      return;
    }
    for (const label of ["Close", "Cancel"]) {
      const button = await firstVisible(modal.getByRole("button", { name: label, exact: true }));
      if (button) {
        await button.click({ timeout: 5000 }).catch(() => {});
        return;
      }
    }
  } catch {
    /* best effort only */
  }
}

/**
 * Make sure the Microsoft Azure client id override is configured in Settings.
 *
 * An existing value is never overwritten; an empty field is filled with the supplied
 * public client id and the result is read back to confirm the value stuck.
 *
 * @param {{ page: import("playwright").Page, clientId?: string }} options Page and optional
 *   public Azure app client id.
 * @returns {Promise<{ ok: boolean, status: string, detail: string }>} The outcome.
 */
export async function ensureTeamsClientId({ page, clientId }) {
  try {
    if (!page) {
      return { ok: false, status: "failed", detail: "No page was provided." };
    }
    const opened = await openIntegrationsSection(page);
    if (!opened) {
      return {
        ok: false,
        status: "failed",
        detail: "The Integrations settings section is not available.",
      };
    }
    const input = page.locator("#settings-ms-client-id");
    if ((await input.count()) === 0) {
      await expandAdvancedDetails(page);
      if ((await input.count()) === 0) {
        return { ok: false, status: "failed", detail: "The Microsoft client id field is missing." };
      }
    }
    const current = await readTeamsClientId(page);
    if (current) {
      return {
        ok: true,
        status: "already-set",
        detail: "Microsoft client id is already configured.",
      };
    }
    const wanted = typeof clientId === "string" ? clientId.trim() : "";
    if (!wanted) {
      return {
        ok: false,
        status: "needs-teams-client-id",
        detail: "Microsoft sign-in needs an Azure app client id from the user.",
      };
    }
    await input.first().fill(wanted, { timeout: 10000 });
    try {
      await input.first().blur();
    } catch {
      await page.keyboard.press("Tab").catch(() => {});
    }
    await sleep(300);
    const after = await readTeamsClientId(page);
    if (after === wanted) {
      return { ok: true, status: "set", detail: "Microsoft client id is saved in Settings." };
    }
    return {
      ok: false,
      status: "failed",
      detail: "The Microsoft client id field did not keep the entered value.",
    };
  } catch {
    return { ok: false, status: "failed", detail: "Could not configure the Microsoft client id." };
  }
}

/**
 * Make sure the Google OAuth client id override is configured in Settings.
 *
 * Unlike the Microsoft override, the Google field is ALWAYS overwritten. The web tier
 * pre-fills it with the app's bundled client id, and that bundled id is exactly the one
 * Google rejects for the `http://localhost:4317` origin with `Error 400: origin_mismatch`.
 * Writing the wanted id through the app's own Settings form also proves the value the
 * app will use for the very next sign-in.
 *
 * @param {{ page: import("playwright").Page, clientId?: string }} options Page and optional
 *   public Google OAuth client id.
 * @returns {Promise<{ ok: boolean, status: string, detail: string }>} The outcome.
 */
export async function ensureGoogleClientId({ page, clientId }) {
  try {
    if (!page) {
      return { ok: false, status: "failed", detail: "No page was provided." };
    }
    const opened = await openIntegrationsSection(page);
    if (!opened) {
      return {
        ok: false,
        status: "failed",
        detail: "The Integrations settings section is not available.",
      };
    }
    const input = page.locator("#settings-google-client-id");
    if ((await input.count()) === 0) {
      await expandAdvancedDetails(page);
      if ((await input.count()) === 0) {
        return { ok: false, status: "failed", detail: "The Google client id field is missing." };
      }
    }
    const wanted = typeof clientId === "string" ? clientId.trim() : "";
    if (!wanted) {
      return {
        ok: false,
        status: "needs-google-client-id",
        detail: "Google sign-in needs a Google OAuth client id from the user.",
      };
    }
    // The Google field is pre-filled with the app's bundled client id, and that bundled id
    // is the one Google rejects for the `http://localhost:4317` origin, so the harness
    // ALWAYS overwrites it - unlike the Microsoft override, which may be the user's own
    // Azure app and must never be replaced.
    await input.first().fill(wanted, { timeout: 10000 });
    try {
      await input.first().blur();
    } catch {
      await page.keyboard.press("Tab").catch(() => {});
    }
    await sleep(300);
    const after = await readGoogleClientId(page);
    if (after === wanted) {
      return { ok: true, status: "set", detail: "Google client id is saved in Settings." };
    }
    return {
      ok: false,
      status: "failed",
      detail: "The Google client id field did not keep the entered value.",
    };
  } catch {
    return { ok: false, status: "failed", detail: "Could not configure the Google client id." };
  }
}

/**
 * Inspect the Account settings section and report which providers are connected.
 *
 * @param {import("playwright").Page} page Active page.
 * @returns {Promise<{ googleConnected: boolean, teamsConnected: boolean, canGrantScanAccess: boolean }>}
 *   The account state; every flag is false when anything goes wrong.
 */
export async function readAccountState(page) {
  const state = { googleConnected: false, teamsConnected: false, canGrantScanAccess: false };
  try {
    if (!page) return state;
    const opened = await openAccountSection(page);
    if (!opened) return state;
    state.googleConnected = await detectVendorConnected(page, ["google"], ["microsoft", "teams"]);
    state.teamsConnected = await detectVendorConnected(page, ["microsoft", "teams"], ["google"]);
    const grant = page.getByRole("button", { name: "Grant mail & calendar access", exact: true });
    state.canGrantScanAccess = (await grant.count()) > 0;
    return state;
  } catch {
    return { googleConnected: false, teamsConnected: false, canGrantScanAccess: false };
  }
}

/**
 * Sign in to Google from the Account settings section.
 *
 * The Google popup is opened by the app itself, so the caller has to finish the
 * account chooser in that window. The function only waits for the outcome toast.
 *
 * @param {{ page: import("playwright").Page, context: import("playwright").BrowserContext, timeoutMs?: number }} options
 *   Page, browser context and the maximum wait for the outcome toast.
 * @returns {Promise<{ ok: boolean, status: string, detail: string }>} The outcome.
 */
export async function signInWithGoogle({ page, context, timeoutMs }) {
  const limit = typeof timeoutMs === "number" ? timeoutMs : DEFAULT_SIGNIN_TIMEOUT_MS;
  let watcher = null;
  try {
    if (!page || !context) {
      return { ok: false, status: "failed", detail: "No page or browser context was provided." };
    }
    await dismissOnboardingIfPresent(page);
    const opened = await openAccountSection(page);
    if (!opened) {
      return {
        ok: false,
        status: "failed",
        detail: "The Account settings section is not available.",
      };
    }
    const state = await readAccountState(page);
    if (state.googleConnected) {
      return { ok: true, status: "already-connected", detail: "Google is already connected." };
    }
    const button = page.getByRole("button", { name: "Sign in with Google", exact: true }).first();
    if ((await button.count()) === 0) {
      return { ok: false, status: "failed", detail: "The Google sign-in button is not available." };
    }
    watcher = popupWatcher(context, { label: "Google sign-in" });
    await button.click({ timeout: 10000 });
    const outcome = await waitForToastOutcome(page, {
      successNeedles: ["Google account connected"],
      failureNeedles: ["Google sign-in failed", "Google sign-in needs a usable client ID"],
      timeoutMs: limit,
    });
    if (outcome.ok) {
      return {
        ok: true,
        status: "connected",
        detail: trimTo(outcome.message || "Google account connected.", 200),
      };
    }
    if (outcome.message) {
      if (outcome.message.toLowerCase().includes("needs a usable client id")) {
        return {
          ok: false,
          status: "failed",
          detail: failureDetail("Google sign-in needs a usable client id", outcome.message),
        };
      }
      return {
        ok: false,
        status: "failed",
        detail: failureDetail("Google sign-in failed", outcome.message),
      };
    }
    return { ok: false, status: "timeout", detail: "No Google sign-in toast within the timeout." };
  } catch {
    return { ok: false, status: "failed", detail: "Google sign-in could not be completed." };
  } finally {
    if (watcher) watcher.stop();
  }
}

/**
 * Sign in to Microsoft from the Account settings section.
 *
 * The web tier has no built-in Microsoft client id, so the function refuses to open
 * a popup when the Settings override is empty.
 *
 * @param {{ page: import("playwright").Page, context: import("playwright").BrowserContext, timeoutMs?: number }} options
 *   Page, browser context and the maximum wait for the outcome toast.
 * @returns {Promise<{ ok: boolean, status: string, detail: string }>} The outcome.
 */
export async function signInWithMicrosoft({ page, context, timeoutMs }) {
  const limit = typeof timeoutMs === "number" ? timeoutMs : DEFAULT_SIGNIN_TIMEOUT_MS;
  let watcher = null;
  try {
    if (!page || !context) {
      return { ok: false, status: "failed", detail: "No page or browser context was provided." };
    }
    await dismissOnboardingIfPresent(page);
    const opened = await openAccountSection(page);
    if (!opened) {
      return {
        ok: false,
        status: "failed",
        detail: "The Account settings section is not available.",
      };
    }
    const state = await readAccountState(page);
    if (state.teamsConnected) {
      return { ok: true, status: "already-connected", detail: "Microsoft is already connected." };
    }
    let clientId = await readTeamsClientId(page);
    if (!clientId) {
      await openIntegrationsSection(page);
      clientId = await readTeamsClientId(page);
    }
    if (!clientId) {
      return {
        ok: false,
        status: "needs-teams-client-id",
        detail: "Microsoft sign-in needs an Azure app client id configured in Settings.",
      };
    }
    await openAccountSection(page);
    const button = page
      .getByRole("button", { name: "Sign in with Microsoft", exact: true })
      .first();
    if ((await button.count()) === 0) {
      return {
        ok: false,
        status: "failed",
        detail: "The Microsoft sign-in button is not available.",
      };
    }
    watcher = popupWatcher(context, { label: "Microsoft sign-in" });
    await button.click({ timeout: 10000 });
    const outcome = await waitForToastOutcome(page, {
      successNeedles: ["Microsoft Teams connected", "Microsoft account connected"],
      failureNeedles: ["Microsoft sign-in failed"],
      timeoutMs: limit,
    });
    if (outcome.ok) {
      return {
        ok: true,
        status: "connected",
        detail: trimTo(outcome.message || "Microsoft connected.", 200),
      };
    }
    if (outcome.message) {
      return {
        ok: false,
        status: "failed",
        detail: failureDetail("Microsoft sign-in failed", outcome.message),
      };
    }
    return {
      ok: false,
      status: "timeout",
      detail: "No Microsoft sign-in toast within the timeout.",
    };
  } catch {
    return { ok: false, status: "failed", detail: "Microsoft sign-in could not be completed." };
  } finally {
    if (watcher) watcher.stop();
  }
}

/**
 * Grant Microsoft mail and calendar scanning access from the Account settings
 * section.
 *
 * @param {{ page: import("playwright").Page, context: import("playwright").BrowserContext, timeoutMs?: number }} options
 *   Page, browser context and the maximum wait for the outcome toast.
 * @returns {Promise<{ ok: boolean, status: string, detail: string }>} The outcome.
 */
export async function grantMicrosoftScanAccess({ page, context, timeoutMs }) {
  const limit = typeof timeoutMs === "number" ? timeoutMs : DEFAULT_SIGNIN_TIMEOUT_MS;
  let watcher = null;
  try {
    if (!page || !context) {
      return { ok: false, status: "failed", detail: "No page or browser context was provided." };
    }
    await dismissOnboardingIfPresent(page);
    const opened = await openAccountSection(page);
    if (!opened) {
      return {
        ok: false,
        status: "failed",
        detail: "The Account settings section is not available.",
      };
    }
    const button = page
      .getByRole("button", { name: "Grant mail & calendar access", exact: true })
      .first();
    if ((await button.count()) === 0) {
      const state = await readAccountState(page);
      if (state.teamsConnected) {
        return {
          ok: true,
          status: "already-granted",
          detail: "Microsoft mail and calendar access is already granted.",
        };
      }
      return { ok: false, status: "failed", detail: "Microsoft is not connected yet." };
    }
    watcher = popupWatcher(context, { label: "Microsoft consent" });
    await button.click({ timeout: 10000 });
    const outcome = await waitForToastOutcome(page, {
      successNeedles: ["Microsoft mail & calendar access granted"],
      failureNeedles: ["Microsoft consent failed"],
      timeoutMs: limit,
    });
    if (outcome.ok) {
      return {
        ok: true,
        status: "granted",
        detail: trimTo(outcome.message || "Microsoft mail and calendar access granted.", 200),
      };
    }
    if (outcome.message) {
      return {
        ok: false,
        status: "failed",
        detail: failureDetail("Microsoft consent failed", outcome.message),
      };
    }
    return {
      ok: false,
      status: "timeout",
      detail: "No Microsoft consent toast within the timeout.",
    };
  } catch {
    return { ok: false, status: "failed", detail: "Microsoft consent could not be completed." };
  } finally {
    if (watcher) watcher.stop();
  }
}

/**
 * Trigger the topbar Sync action and report what the scan modal said.
 *
 * The web tier only fetches public .ics feeds during a scan; no mail is read, so
 * the returned detail repeats the app wording without embellishing it.
 *
 * When `onOverlay` is supplied it is awaited exactly once, right after the scan
 * overlay becomes visible, so the caller can capture it (screenshot, DOM snapshot,
 * axe scan) before it auto-closes. A failing capture is swallowed and never changes
 * the returned status.
 *
 * @param {{ page: import("playwright").Page, timeoutMs?: number, onOverlay?: (context: { page: import("playwright").Page }) => Promise<void> | void }} options
 *   Page, the maximum wait for the scan modal to close and an optional overlay
 *   capture callback.
 * @returns {Promise<{ ok: boolean, status: string, detail: string }>} The outcome.
 */
export async function triggerScan({ page, timeoutMs, onOverlay }) {
  const limit = typeof timeoutMs === "number" ? timeoutMs : DEFAULT_SCAN_TIMEOUT_MS;
  try {
    if (!page) {
      return { ok: false, status: "failed", detail: "No page was provided." };
    }
    const syncButton = page.locator('[data-testid="app-topbar"] button[aria-label="Sync"]');
    let button = await firstVisible(syncButton);
    if (!button) {
      await sleep(1500);
      button = await firstVisible(syncButton);
    }
    if (!button) {
      const busy = await firstVisible(
        page.locator('[data-testid="app-topbar"] button[aria-label="Scanning…"]'),
      );
      if (busy) {
        return { ok: false, status: "failed", detail: "A scan is already running." };
      }
      return { ok: false, status: "failed", detail: "The topbar Sync button is not available." };
    }
    await button.click({ timeout: 10000 });

    const modal = page.locator('[data-testid="modal-scan-progress"]');
    const openDeadline = Date.now() + SCAN_MODAL_OPEN_TIMEOUT_MS;
    let visible = await firstVisible(modal);
    while (!visible && Date.now() < openDeadline) {
      await sleep(500);
      visible = await firstVisible(modal);
    }
    if (!visible) {
      return { ok: false, status: "failed", detail: "The scan modal never opened." };
    }

    if (typeof onOverlay === "function") {
      try {
        await onOverlay({ page });
      } catch {
        /* an overlay capture failure must not change the scan outcome */
      }
    }

    let lastText = "";
    let outcomeSeen = false;
    let hidden = false;
    const deadline = Date.now() + limit;
    while (Date.now() < deadline) {
      const stillVisible = await firstVisible(modal);
      if (!stillVisible) {
        hidden = true;
        break;
      }
      const text = sanitizeText(await stillVisible.innerText({ timeout: 2000 }).catch(() => ""));
      if (text) {
        lastText = text;
        if (looksLikeOutcome(text)) outcomeSeen = true;
      }
      await sleep(SCAN_TEXT_POLL_MS);
    }

    const toastText = await collectToastText(page);
    let detail = lastText;
    if (toastText) detail = detail ? `${detail} | ${toastText}` : toastText;

    if (hidden) {
      return { ok: true, status: "scanned", detail: trimTo(detail, 400) };
    }

    await closeScanModal(modal);
    if (outcomeSeen && lastText) {
      return { ok: false, status: "failed", detail: trimTo(detail, 400) };
    }
    return {
      ok: false,
      status: "timeout",
      detail: trimTo(detail || "The scan modal stayed open until the timeout.", 400),
    };
  } catch {
    return { ok: false, status: "failed", detail: "The scan could not be triggered." };
  }
}
