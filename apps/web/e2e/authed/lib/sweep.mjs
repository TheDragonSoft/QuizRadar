import { captureDomOutline, runAxe } from "./harness.mjs";

/**
 * The surfaces a full sweep visits, in the order the runner walks them.
 */
export const DEFAULT_SURFACE_IDS = [
  "dashboard",
  "tasks",
  "calendar",
  "focus",
  "help",
  "settings-account",
  "settings-courses",
  "settings-integrations",
];

const MODAL_PANEL_SELECTOR = '[data-testid="modal-stack-root"] [role="dialog"]';
const TOAST_CONTAINER_SELECTOR = '[data-testid="toast-container"]';
const ONBOARDING_MODAL_SELECTOR = '[data-testid="modal-onboarding"]';
const ONBOARDING_CLOSE_SELECTOR = '[data-testid="modal-onboarding"] button[aria-label="Close"]';
const ONBOARDING_SURFACE_ID = "modal:onboarding";
const MAX_SURFACES = 60;
const CLICK_TIMEOUT = 5000;
const RETRY_CLICK_TIMEOUT = 10000;
const RETRY_SETTLE_MS = 1200;
const MODAL_HIDE_TIMEOUT = 5000;
const DATA_CHANGE_PATTERN = /added|created|saved|updated|removed|deleted|marked|scheduled|moved/i;

/** Substrings that make a control unsafe to touch during a read-only sweep. */
const BLOCK_TERMS = [
  "delete",
  "remove",
  "disconnect",
  "wipe",
  "clear",
  "purge",
  "reset",
  "sign out",
  "signout",
  "log out",
  "logout",
  "revoke",
  "erase",
  "forget",
  "save",
  "submit",
  "apply",
  "confirm",
  "done",
  "complete",
  "finish",
  "mark",
  "start",
  "begin",
  "resume",
  "pause",
  "stop",
  "cancel",
  "undo",
  "redo",
  "archive",
  "install",
  "update",
  "send",
  "push",
  "sync",
  "scan",
  "export",
  "download",
  "upload",
  "import",
  "deauthorize",
  "unsubscrib",
  "today",
  "jump",
  "share",
  "copy",
  "duplicate",
  "print",
  "next",
  "prev",
  "previous",
  "back",
  "week",
  "month",
  "enable",
  "disable",
  "toggle",
  "switch",
];

/**
 * Whole words that make a control unsafe because it is a state toggle: the bare words
 * "on" and "off" are matched with word boundaries so a feed called "Money" is not
 * blocked by "on" while a control called "Turn on" is.
 */
const BLOCK_WHOLE_WORD_PATTERN = /\b(?:on|off)\b/i;

/** Substrings that mark a control as a harmless read-only exploration target. */
const ALLOW_TERMS = [
  "open",
  "add",
  "new",
  "create",
  "edit",
  "detail",
  "manage",
  "connect",
  "grant",
  "backup",
  "search",
  "schedule",
  "pick",
  "choose",
  "account",
  "profile",
  "more",
];

/** Test-id prefixes whose controls are navigation chrome and never exploration targets. */
const SKIPPED_TESTID_PREFIXES = ["topbar-nav-", "sidebar-nav-", "settings-nav-", "mobilenav-"];

/** Accessible names of the topbar Sync button in each of its states. */
const SYNC_LABELS = new Set(["sync", "scanning…", "synced", "sync failed"]);

/**
 * Extra guard: controls that would start an external authorization flow are skipped
 * even when they match the allow list, because leaving a consent screen behind is
 * not part of a read-only sweep.
 */
const EXTERNAL_FLOW_TERMS = [
  "oauth",
  "authorize",
  "authorise",
  "consent",
  "sign in",
  "signin",
  "log in",
  "login",
];
const EXTERNAL_FLOW_PATTERNS = [
  /\bconnect\b.*\b(google|microsoft|outlook|gmail|calendar|onedrive|drive)\b/i,
  /\b(grant|allow|enable)\b.*\b(google|microsoft|outlook|gmail|calendar|onedrive|drive)\b/i,
];

/** How each requested surface is reached, and what its capture is called. */
const RECIPES = {
  dashboard: {
    id: "view:dashboard",
    kind: "view",
    selector: '[data-testid="topbar-nav-dashboard"]',
    control: () => "the Dashboard tab in the topbar view switcher",
  },
  tasks: {
    id: "view:tasks",
    kind: "view",
    selector: '[data-testid="topbar-nav-tasks"]',
    control: () => "the Tasks tab in the topbar view switcher",
  },
  calendar: {
    id: "view:calendar",
    kind: "view",
    selector: '[data-testid="topbar-nav-calendar"]',
    control: () => "the Calendar tab in the topbar view switcher",
  },
  focus: {
    id: "view:focus",
    kind: "view",
    selector: '[data-testid="sidebar-nav-focus"]',
    control: () => "the Focus button in the sidebar",
    sidebar: true,
  },
  help: {
    id: "view:help",
    kind: "view",
    selector: '[data-testid="sidebar-nav-help"]',
    control: () => "the Help button in the sidebar",
    sidebar: true,
  },
  "settings-account": {
    id: "view:settings-account",
    kind: "view",
    selector: '[data-testid="settings-nav-account"]',
    control: (opened) =>
      opened
        ? "the Open settings button in the topbar and then the Account section in the settings rail"
        : "the Account section in the settings rail",
    settings: true,
    extra:
      "The three settings captures are scroll positions of the same page; this one shows Account.",
  },
  "settings-courses": {
    id: "view:settings-courses",
    kind: "view",
    selector: '[data-testid="settings-nav-courses"]',
    control: (opened) =>
      opened
        ? "the Open settings button in the topbar and then the Courses section in the settings rail"
        : "the Courses section in the settings rail",
    settings: true,
    extra:
      "The three settings captures are scroll positions of the same page; this one shows Courses.",
  },
  "settings-integrations": {
    id: "view:settings-integrations",
    kind: "view",
    selector: '[data-testid="settings-nav-integrations"]',
    control: (opened) =>
      opened
        ? "the Open settings button in the topbar and then the Integrations section in the settings rail"
        : "the Integrations section in the settings rail",
    settings: true,
    extra:
      "The three settings captures are scroll positions of the same page; this one shows Integrations.",
  },
};

/**
 * Sleeps for the given number of milliseconds.
 *
 * @param {number} ms Delay in milliseconds.
 * @returns {Promise<void>} Resolves after the delay.
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Removes URLs, emails and token-like fragments from text before it is stored or logged.
 *
 * @param {unknown} value Raw text.
 * @param {number} [maxLength] Maximum length of the result.
 * @returns {string} Safe, trimmed text.
 */
function redactText(value, maxLength = 300) {
  let text = value === null || value === undefined ? "" : String(value);
  text = text.replace(/\bhttps?:\/\/[^\s"'<>()]+/gi, (raw) => {
    try {
      const parsed = new URL(raw);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return raw.split("?")[0];
    }
  });
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
  text = text.replace(
    /([?&])(access_token|refresh_token|id_token|token|code|state|client_secret|api[_-]?key|session)=[^&\s"']+/gi,
    "$1[redacted]",
  );
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  text = text.replace(/\?[A-Za-z0-9_.\-]+=[^\s"'<>]*/g, "");
  text = text.replace(/\s+/g, " ").trim();
  if (maxLength > 0 && text.length > maxLength) {
    text = `${text.slice(0, Math.max(0, maxLength - 3))}...`;
  }
  return text;
}

/**
 * Starts the toast watcher: it polls the toast container and remembers every new text
 * together with the surface that was current when it appeared.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @returns {{ setSurface: (id: string) => void, take: () => Array<{ surfaceId: string, text: string }>, stop: () => void }} The watcher.
 */
function createToastWatcher(page) {
  const entries = [];
  let surfaceId = "start";
  let lastText = "";
  let stopped = false;

  async function poll() {
    if (stopped) {
      return;
    }
    let text = "";
    try {
      text = await page.evaluate((selector) => {
        const container = document.querySelector(selector);
        return container ? container.innerText || "" : "";
      }, TOAST_CONTAINER_SELECTOR);
    } catch {
      return;
    }
    const trimmed = String(text || "").trim();
    if (!trimmed || trimmed === lastText) {
      return;
    }
    lastText = trimmed;
    entries.push({ surfaceId, text: redactText(trimmed, 300) });
  }

  const timer = setInterval(() => {
    void poll();
  }, 350);

  return {
    setSurface(id) {
      surfaceId = String(id ?? "");
    },
    take() {
      const out = entries.splice(0, entries.length);
      return out;
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/**
 * Formats one captured console / page error / failed request entry.
 *
 * @param {unknown} entry The raw harness entry.
 * @returns {string} A safe one-line description.
 */
function formatConsoleEntry(entry) {
  if (entry === null || entry === undefined) {
    return "";
  }
  if (typeof entry === "string") {
    return `console: ${redactText(entry, 300)}`;
  }
  if (typeof entry !== "object") {
    return `console: ${redactText(entry, 300)}`;
  }
  const record = /** @type {Record<string, any>} */ (entry);
  const type = String(record.type || record.kind || record.source || "console").toLowerCase();
  const level = String(record.level || record.severity || "").toLowerCase();
  let text = "";
  if (typeof record.text === "string") {
    text = record.text;
  } else if (typeof record.message === "string") {
    text = record.message;
  } else if (typeof record.msg === "string") {
    text = record.msg;
  } else if (typeof record.description === "string") {
    text = record.description;
  } else if (record.error && typeof record.error.message === "string") {
    text = record.error.message;
  } else {
    try {
      const copy = { ...record };
      delete copy.type;
      delete copy.kind;
      delete copy.source;
      delete copy.level;
      delete copy.severity;
      delete copy.time;
      delete copy.timestamp;
      text = JSON.stringify(copy);
    } catch {
      text = "";
    }
  }
  let prefix = "console";
  if (type.includes("pageerror") || type.includes("page_error")) {
    prefix = "page error";
  } else if (type.includes("request") || type.includes("failed")) {
    prefix = "failed request";
  } else if (type.includes("console")) {
    prefix = "console";
  } else {
    prefix = type;
  }
  const suffix = level ? ` ${level}` : "";
  return `${prefix}${suffix}: ${redactText(text, 300)}`;
}

/**
 * Decides whether one captured console entry counts as a problem for a surface. Only
 * console error and warning lines, page errors, failed requests and HTTP responses
 * with a status of 400 or more qualify; benign console.log, console.info and
 * console.debug lines stay out of the problems list.
 *
 * @param {unknown} entry The raw harness entry.
 * @returns {boolean} True when the entry is a problem.
 */
function isProblemConsoleEntry(entry) {
  if (typeof entry === "string") {
    if (
      entry.startsWith("console.error") ||
      entry.startsWith("console.warning") ||
      entry.startsWith("pageerror") ||
      entry.startsWith("requestfailed")
    ) {
      return true;
    }
    const response = /^response (\d{3}):/.exec(entry);
    return Boolean(response && Number(response[1]) >= 400);
  }
  if (entry && typeof entry === "object") {
    const record = /** @type {Record<string, any>} */ (entry);
    const kind = String(record.type || record.kind || record.source || "").toLowerCase();
    const level = String(record.level || record.severity || "").toLowerCase();
    if (kind.includes("pageerror") || kind.includes("page_error")) {
      return true;
    }
    if (kind.includes("response")) {
      return Number(record.status ?? record.code ?? 0) >= 400;
    }
    if (kind.includes("request") || kind.includes("failed")) {
      return true;
    }
    if (kind.includes("console")) {
      return level.includes("error") || level.includes("warning");
    }
    return (
      kind.includes("error") ||
      kind.includes("warning") ||
      level.includes("error") ||
      level.includes("warning")
    );
  }
  return false;
}

/**
 * Formats the console entries added since a given index, keeping only the entries that
 * count as problems: console error and warning lines, page errors, failed requests and
 * HTTP responses with a status of 400 or more. Benign log, info and debug lines are
 * left out; console.txt itself still records every line.
 *
 * @param {unknown[]} entries The live console capture array.
 * @param {number} startIndex The index the surface started at.
 * @returns {string[]} Formatted console problems.
 */
function summarizeConsoleEntries(entries, startIndex) {
  const out = [];
  if (!Array.isArray(entries)) {
    return out;
  }
  for (const entry of entries.slice(startIndex)) {
    if (!isProblemConsoleEntry(entry)) {
      continue;
    }
    const text = formatConsoleEntry(entry);
    if (text) {
      out.push(text);
    }
  }
  return out;
}

/**
 * Routes collected toast texts to the surface they belong to.
 *
 * @param {Map<string, any>} recordsById Known surface records by id.
 * @param {Array<{ surfaceId: string, text: string }>} entries Collected toast texts.
 * @param {any} fallback Record used when the owning surface is unknown.
 * @returns {void}
 */
function assignMessages(recordsById, entries, fallback) {
  for (const entry of entries) {
    const text = entry && typeof entry.text === "string" ? entry.text : "";
    if (!text) {
      continue;
    }
    const target = recordsById.get(entry.surfaceId) || fallback;
    if (target && Array.isArray(target.messages)) {
      target.messages.push(text);
    }
  }
}

/**
 * Marks every interactive control on the page and returns a description of each one.
 * Elements that are not currently visible are skipped and never marked, because the
 * app keeps hidden branches in the DOM (the settings rail while another view shows,
 * the inert collapsed sidebar, inactive dashboard button variants) and clicking those
 * would only time out Playwright's actionability check. Stateful controls
 * ([role="switch"], [role="checkbox"], [role="radio"]) are skipped and never marked
 * either, because they change persisted state by definition.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @returns {Promise<Array<{ index: number, name: string, testid: string, disabled: boolean, inDialog: boolean }>>} The enumerated controls.
 */
async function enumerateCandidates(page) {
  try {
    return await page.evaluate(() => {
      /**
       * Returns true only for elements a real user can currently see and reach.
       *
       * @param {Element} el The element to inspect.
       * @returns {boolean} Whether the element is visible.
       */
      function isVisible(el) {
        if (!el || !el.isConnected) {
          return false;
        }
        if (typeof el.getClientRects !== "function" || el.getClientRects().length === 0) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          return false;
        }
        const style = window.getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number.parseFloat(style.opacity || "1") === 0
        ) {
          return false;
        }
        if (el.closest('[aria-hidden="true"]') || el.closest("[inert]")) {
          return false;
        }
        if (typeof el.checkVisibility === "function") {
          try {
            if (!el.checkVisibility()) {
              return false;
            }
          } catch {
            return false;
          }
        }
        return true;
      }

      const statefulRoles = new Set(["switch", "checkbox", "radio"]);
      const nodes = Array.from(
        document.querySelectorAll(
          'button, [role="button"], [role="tab"], a[href], [role="switch"], [role="checkbox"], [role="radio"]',
        ),
      );
      const out = [];
      for (const el of nodes) {
        if (!isVisible(el)) {
          continue;
        }
        const role = (el.getAttribute("role") || "").trim().toLowerCase();
        if (statefulRoles.has(role)) {
          continue;
        }
        const index = out.length;
        el.setAttribute("data-qa-sweep", String(index));
        const aria = el.getAttribute("aria-label");
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        const title = el.getAttribute("title") || "";
        const name = (aria || text || title).trim();
        const disabled =
          el.hasAttribute("disabled") ||
          el.getAttribute("aria-disabled") === "true" ||
          el.disabled === true;
        const inDialog = Boolean(el.closest('[role="dialog"]'));
        const testid = el.getAttribute("data-testid") || "";
        out.push({ index, name, testid, disabled, inDialog });
      }
      return out;
    });
  } catch {
    return [];
  }
}

/**
 * Removes the exploration markers from the page.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @returns {Promise<void>} Resolves when the markers are gone.
 */
async function removeMarkers(page) {
  try {
    await page.evaluate(() => {
      document
        .querySelectorAll("[data-qa-sweep]")
        .forEach((el) => el.removeAttribute("data-qa-sweep"));
    });
  } catch {
    // The page may be gone; nothing to clean up.
  }
}

/**
 * Applies the block list, the whole-word "on"/"off" toggle words, the allow list and
 * the skip rules to the enumerated controls.
 *
 * @param {Array<{ index: number, name: string, testid: string, disabled: boolean, inDialog: boolean }>} items Enumerated controls.
 * @returns {Array<{ index: number, name: string, testid: string, disabled: boolean, inDialog: boolean }>} Safe candidates.
 */
function filterCandidates(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || item.disabled || !item.name || item.inDialog) {
      continue;
    }
    const testid = String(item.testid || "");
    const lowerTestid = testid.toLowerCase();
    if (SKIPPED_TESTID_PREFIXES.some((prefix) => lowerTestid.startsWith(prefix))) {
      continue;
    }
    const name = String(item.name || "");
    const lowerName = name.toLowerCase();
    if (SYNC_LABELS.has(lowerName)) {
      continue;
    }
    const haystack = `${lowerName} ${lowerTestid}`;
    if (BLOCK_TERMS.some((term) => haystack.includes(term))) {
      continue;
    }
    if (BLOCK_WHOLE_WORD_PATTERN.test(haystack)) {
      continue;
    }
    if (!ALLOW_TERMS.some((term) => lowerName.includes(term))) {
      continue;
    }
    if (EXTERNAL_FLOW_TERMS.some((term) => lowerName.includes(term))) {
      continue;
    }
    if (EXTERNAL_FLOW_PATTERNS.some((pattern) => pattern.test(name))) {
      continue;
    }
    const key = lowerName;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Lists the currently rendered modal panels.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @returns {Promise<string[]>} The data-testid of each open modal panel.
 */
async function listModalPanels(page) {
  try {
    return await page.evaluate((selector) => {
      return Array.from(document.querySelectorAll(selector)).map(
        (el) => el.getAttribute("data-testid") || "",
      );
    }, MODAL_PANEL_SELECTOR);
  } catch {
    return [];
  }
}

/**
 * Counts the pages currently owned by the browser context.
 *
 * @param {any} context The Playwright browser context.
 * @returns {number} The number of open pages.
 */
function countPages(context) {
  try {
    if (context && typeof context.pages === "function") {
      return context.pages().length;
    }
  } catch {
    // Fall through.
  }
  return 0;
}

/**
 * Clicks a navigation control, expanding the collapsed sidebar once if needed.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @param {string} selector The control selector.
 * @param {object} options Click options.
 * @param {string} options.label Human readable name of the control.
 * @param {boolean} [options.sidebar] Whether the control lives in the collapsible sidebar.
 * @param {string[]} options.notes Notes collected by the sweep.
 * @param {Array<{ surfaceId: string, name: string }>} options.clickLog Every click performed.
 * @param {string} [options.surfaceId] The surface the click belongs to.
 * @returns {Promise<{ ok: boolean, reason: string, extras: string[] }>} The click outcome.
 */
async function clickControl(page, selector, options) {
  const { label, sidebar, notes, clickLog, surfaceId } = options;
  const extras = [];
  const locator = page.locator(selector).first();

  let visible = true;
  try {
    await locator.waitFor({ state: "visible", timeout: CLICK_TIMEOUT });
  } catch {
    visible = false;
  }

  if (visible) {
    try {
      await locator.click({ timeout: CLICK_TIMEOUT });
      clickLog.push({ surfaceId: surfaceId || "", name: label });
      return { ok: true, reason: "", extras };
    } catch {
      // Fall through to the one honest retry below.
    }
  }

  // One honest retry: give any smooth scroll and re-render time to settle before the
  // control is targeted again with a longer budget.
  await sleep(RETRY_SETTLE_MS);
  try {
    const retryTarget = page.locator(selector).first();
    await retryTarget.waitFor({ state: "visible", timeout: RETRY_CLICK_TIMEOUT });
    await retryTarget.click({ timeout: RETRY_CLICK_TIMEOUT });
    clickLog.push({ surfaceId: surfaceId || "", name: label });
    return { ok: true, reason: "", extras };
  } catch {
    // Fall through to the sidebar retry when the control lives in the sidebar.
  }

  if (!sidebar) {
    return {
      ok: false,
      reason: `the control "${label}" was not clickable`,
      extras,
    };
  }

  const toggle = page
    .locator('[data-testid="app-topbar"] button[aria-label="Toggle sidebar"]')
    .first();
  try {
    await toggle.waitFor({ state: "visible", timeout: CLICK_TIMEOUT });
    await toggle.click({ timeout: CLICK_TIMEOUT });
    clickLog.push({ surfaceId: surfaceId || "", name: "the Toggle sidebar button in the topbar" });
    extras.push("The sidebar was collapsed, so it was expanded before navigating.");
    notes.push("The sidebar was collapsed and was expanded before navigating.");
    await sleep(500);
  } catch {
    return {
      ok: false,
      reason: `the control "${label}" was hidden and the sidebar could not be expanded`,
      extras,
    };
  }

  try {
    await locator.waitFor({ state: "visible", timeout: CLICK_TIMEOUT });
    await locator.click({ timeout: CLICK_TIMEOUT });
    clickLog.push({ surfaceId: surfaceId || "", name: label });
    return { ok: true, reason: "", extras };
  } catch {
    return {
      ok: false,
      reason: `the control "${label}" stayed hidden after the sidebar was expanded`,
      extras,
    };
  }
}

/**
 * Opens the settings view when it is not already open.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @param {Array<{ surfaceId: string, name: string }>} clickLog Every click performed.
 * @returns {Promise<{ ok: boolean, reason: string, opened: boolean }>} The open outcome.
 */
async function ensureSettingsOpen(page, clickLog) {
  const view = page.locator('[data-testid="view-settings"]').first();
  try {
    if (await view.isVisible()) {
      return { ok: true, reason: "", opened: false };
    }
  } catch {
    // Treat an unreadable view as closed.
  }
  const button = page
    .locator('[data-testid="app-topbar"] button[aria-label="Open settings"]')
    .first();
  try {
    await button.waitFor({ state: "visible", timeout: CLICK_TIMEOUT });
    await button.click({ timeout: CLICK_TIMEOUT });
    clickLog.push({ surfaceId: "", name: "the Open settings button in the topbar" });
  } catch {
    return { ok: false, reason: "the topbar settings button was not available", opened: false };
  }
  try {
    await view.waitFor({ state: "visible", timeout: CLICK_TIMEOUT });
  } catch {
    return { ok: false, reason: "the settings view did not open", opened: true };
  }
  await sleep(400);
  return { ok: true, reason: "", opened: true };
}

/**
 * Dismisses a modal panel without touching anything else inside it.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @param {string} panelTestId The data-testid of the panel.
 * @param {string[]} problems Problems collected on the parent surface.
 * @param {string} controlName Name of the control that opened the modal.
 * @param {string[]} notes Notes collected by the sweep.
 * @param {Array<{ surfaceId: string, name: string }>} clickLog Every click performed.
 * @returns {Promise<boolean>} True when the modal closed.
 */
async function closeModal(page, panelTestId, problems, controlName, notes, clickLog) {
  const panel = page.locator(`[data-testid="${panelTestId}"]`).last();
  try {
    await page.keyboard.press("Escape");
  } catch {
    // Ignore a failing key press.
  }
  await sleep(400);
  if (!(await panel.isVisible().catch(() => false))) {
    return true;
  }
  try {
    await panel.locator('button[aria-label="Close"]').first().click({ timeout: 3000 });
    clickLog.push({ surfaceId: "", name: `the Close button inside ${panelTestId}` });
  } catch {
    // Fall through to the text based close.
  }
  await sleep(400);
  if (!(await panel.isVisible().catch(() => false))) {
    return true;
  }
  try {
    await panel
      .locator("button")
      .filter({ hasText: /^(close|cancel)$/i })
      .first()
      .click({ timeout: 3000 });
    clickLog.push({ surfaceId: "", name: `the Close or Cancel button inside ${panelTestId}` });
  } catch {
    // The modal stays open; the problem is recorded below.
  }
  await sleep(400);
  if (await panel.isVisible().catch(() => false)) {
    problems.push("a modal did not close");
    notes.push(`The modal opened by "${controlName}" did not close.`);
    return false;
  }
  return true;
}

/**
 * Captures the onboarding wizard as a modal surface the first time it is seen.
 *
 * The wizard is a real surface worth auditing, so it is captured exactly once. Later
 * appearances only produce the "captured once and reused" note.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @param {object} context The sweep bookkeeping.
 * @param {any[]} context.records Every surface record collected so far.
 * @param {Map<string, any>} context.recordsById Surface records by id.
 * @param {any} context.watcher The toast watcher.
 * @param {string[]} context.notes Notes collected by the sweep.
 * @param {unknown[]} context.consoleEntries The live console capture array.
 * @param {string} context.surfaceId The surface the wizard appeared on.
 * @returns {Promise<void>} Resolves when the wizard has been handled.
 */
async function captureOnboardingIfNeeded(page, context) {
  const { records, recordsById, watcher, notes, consoleEntries, surfaceId } = context || {};
  if (!Array.isArray(records) || !recordsById || typeof recordsById.has !== "function") {
    return;
  }
  if (recordsById.has(ONBOARDING_SURFACE_ID)) {
    if (Array.isArray(notes)) {
      notes.push(`The modal "${ONBOARDING_SURFACE_ID}" was captured once and reused.`);
    }
    return;
  }
  if (records.length >= MAX_SURFACES) {
    if (Array.isArray(notes)) {
      notes.push(
        `The modal "${ONBOARDING_SURFACE_ID}" was not captured because the sweep reached the ${MAX_SURFACES} surface cap.`,
      );
    }
    return;
  }
  const consoleStart = Array.isArray(consoleEntries) ? consoleEntries.length : 0;
  const modalRecord = await captureSurface(page, {
    id: ONBOARDING_SURFACE_ID,
    kind: "modal",
    note: `Opened by the app while ${surfaceId || "the app"} was being explored.`,
    problems: [],
    messages: [],
  });
  records.push(modalRecord);
  recordsById.set(ONBOARDING_SURFACE_ID, modalRecord);
  if (watcher) {
    watcher.setSurface(ONBOARDING_SURFACE_ID);
    assignMessages(recordsById, watcher.take(), modalRecord);
    watcher.setSurface(surfaceId || "start");
  }
  if (Array.isArray(consoleEntries)) {
    modalRecord.problems.push(...summarizeConsoleEntries(consoleEntries, consoleStart));
  }
}

/**
 * Closes the onboarding wizard overlay when it blocks the page.
 *
 * The wizard is a full screen overlay, so every control underneath it is not clickable.
 * Only the wizard's own Close button is ever touched. Never throws.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @param {object} [context] The sweep bookkeeping used to capture the wizard once.
 * @returns {Promise<boolean>} True when the wizard was closed.
 */
async function closeOnboardingOverlay(page, context) {
  try {
    const modal = page.locator(ONBOARDING_MODAL_SELECTOR).first();
    const visible = await modal.isVisible().catch(() => false);
    if (!visible) {
      return false;
    }
    await captureOnboardingIfNeeded(page, context);
    const close = page.locator(ONBOARDING_CLOSE_SELECTOR).first();
    await close.click({ timeout: 3000 }).catch(() => {});
    await modal.waitFor({ state: "hidden", timeout: MODAL_HIDE_TIMEOUT }).catch(() => {});
    return !(await modal.isVisible().catch(() => false));
  } catch {
    return false;
  }
}

/**
 * Re-applies the exploration markers and finds the control with the same accessible name.
 *
 * Used by the click retry: the page may have re-rendered, so the marker index of the
 * original candidate is not trusted any more. Only controls that pass the allow list,
 * the block list and the skip rules again are retried.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @param {string} name The accessible name of the control to re-target.
 * @returns {Promise<{ index: number, candidates: Array<{ index: number, name: string, testid: string, disabled: boolean, inDialog: boolean }> }>} The new marker index (-1 when the control is gone) and the refreshed candidates.
 */
async function reapplySweepMarkers(page, name) {
  const items = await enumerateCandidates(page);
  const safeItems = filterCandidates(items);
  const target = String(name || "")
    .trim()
    .toLowerCase();
  const match = safeItems.find(
    (item) =>
      String(item.name || "")
        .trim()
        .toLowerCase() === target,
  );
  return { index: match ? match.index : -1, candidates: safeItems };
}

/**
 * Explores one surface by clicking its safe controls, never inside a dialog.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @param {any} record The surface record to enrich.
 * @param {object} options Exploration options.
 * @param {number} options.maxClicks Maximum number of clicks on this surface.
 * @param {number} options.deadline Timestamp after which the sweep must stop.
 * @param {any} options.watcher The toast watcher.
 * @param {string[]} options.notes Notes collected by the sweep.
 * @param {Array<{ surfaceId: string, name: string }>} options.clickLog Every click performed.
 * @param {Map<string, any>} options.recordsById Surface records by id.
 * @param {any[]} options.records Every surface record collected so far.
 * @param {any} options.context The Playwright browser context.
 * @param {unknown[]} options.consoleEntries The live console capture array.
 * @returns {Promise<void>} Resolves when the surface has been explored.
 */
async function exploreSurface(page, record, options) {
  const {
    maxClicks,
    deadline,
    watcher,
    notes,
    clickLog,
    recordsById,
    records,
    context,
    consoleEntries,
  } = options;
  const extras = [];
  const explored = [];
  const sweepProblems = [];
  let clicks = 0;

  const overlayContext = {
    records,
    recordsById,
    watcher,
    notes,
    consoleEntries,
    surfaceId: record.id,
  };

  await closeOnboardingOverlay(page, overlayContext);
  await removeMarkers(page);
  let candidates = filterCandidates(await enumerateCandidates(page));
  const attemptedNames = new Set();
  let cursor = 0;

  while (cursor < candidates.length) {
    const candidate = candidates[cursor];
    cursor += 1;
    if (!candidate) {
      continue;
    }
    const candidateKey = String(candidate.name || "")
      .trim()
      .toLowerCase();
    if (attemptedNames.has(candidateKey)) {
      continue;
    }
    attemptedNames.add(candidateKey);

    if (clicks >= maxClicks) {
      extras.push(`Exploration stopped after ${maxClicks} click(s).`);
      break;
    }
    if (Date.now() >= deadline) {
      notes.push(`The time budget was exhausted while exploring ${record.id}.`);
      extras.push("The time budget was exhausted while exploring this surface.");
      break;
    }

    await closeOnboardingOverlay(page, overlayContext);

    const beforePanels = await listModalPanels(page);
    const pagesBefore = countPages(context);
    let failure = null;
    let clicked = false;
    try {
      await page
        .locator(`[data-qa-sweep="${candidate.index}"]`)
        .first()
        .click({ timeout: CLICK_TIMEOUT });
      clicked = true;
    } catch (err) {
      failure = err;
    }

    if (!clicked) {
      // One honest retry: let the smooth scroll and any re-render settle, re-mark the
      // same control by its accessible name and give the click a longer budget.
      await sleep(RETRY_SETTLE_MS);
      await closeOnboardingOverlay(page, overlayContext);
      const remap = await reapplySweepMarkers(page, candidate.name);
      if (remap.index >= 0) {
        try {
          await page
            .locator(`[data-qa-sweep="${remap.index}"]`)
            .first()
            .click({ timeout: RETRY_CLICK_TIMEOUT });
          clicked = true;
          failure = null;
        } catch (err) {
          failure = err;
        }
      } else if (!failure) {
        failure = new Error("the control was no longer available for the retry");
      }
      // The markers were re-applied, so the remaining candidates are refreshed and the
      // controls that were already tried are skipped.
      candidates = remap.candidates;
      cursor = 0;
    }

    if (!clicked) {
      sweepProblems.push(
        `the control named "${redactText(candidate.name, 160)}" could not be clicked: ${redactText(
          failure && failure.message ? failure.message : failure,
          200,
        )}`,
      );
      continue;
    }

    clicks += 1;
    const safeName = redactText(candidate.name, 160);
    explored.push(safeName);
    clickLog.push({ surfaceId: record.id, name: safeName });

    await sleep(700);

    if (countPages(context) > pagesBefore) {
      sweepProblems.push(
        `the control named "${safeName}" opened a new browser page; the sweep ignored it`,
      );
      notes.push(`The control "${safeName}" on ${record.id} opened a new browser page.`);
    }

    const afterPanels = await listModalPanels(page);
    const newPanels = afterPanels.filter((panel) => panel && !beforePanels.includes(panel));
    if (newPanels.length > 0) {
      const panelTestId = newPanels[newPanels.length - 1];
      const modalKey = panelTestId.startsWith("modal-")
        ? panelTestId.slice("modal-".length)
        : panelTestId;
      const modalSurfaceId = `modal:${modalKey}`;
      if (recordsById.has(modalSurfaceId)) {
        notes.push(`The modal "${modalSurfaceId}" was captured once and reused.`);
      } else if (records.length >= MAX_SURFACES) {
        notes.push(
          `The modal "${modalSurfaceId}" was not captured because the sweep reached the ${MAX_SURFACES} surface cap.`,
        );
      } else {
        const consoleStart = consoleEntries.length;
        const modalRecord = await captureSurface(page, {
          id: modalSurfaceId,
          kind: "modal",
          note: `Opened from ${record.id} by the control named ${safeName}.`,
          problems: [],
          messages: [],
        });
        records.push(modalRecord);
        recordsById.set(modalSurfaceId, modalRecord);
        watcher.setSurface(modalSurfaceId);
        assignMessages(recordsById, watcher.take(), modalRecord);
        watcher.setSurface(record.id);
        modalRecord.problems.push(...summarizeConsoleEntries(consoleEntries, consoleStart));
      }
      await closeModal(page, panelTestId, sweepProblems, safeName, notes, clickLog);
    } else {
      try {
        await page.keyboard.press("Escape");
      } catch {
        // A stray Escape is harmless.
      }
      await sleep(200);
    }

    const toastEntries = watcher.take();
    assignMessages(recordsById, toastEntries, record);
    const changed = toastEntries.some((entry) => DATA_CHANGE_PATTERN.test(entry.text || ""));
    if (changed) {
      sweepProblems.push(`the control named "${safeName}" appears to have changed data`);
      extras.push(`Exploration stopped because "${safeName}" appears to have changed data.`);
      break;
    }
  }

  await removeMarkers(page);
  record.problems = [...(record.problems || []), ...sweepProblems];
  record.note = `${record.note}${extras.length ? ` ${extras.join(" ")}` : ""}${
    explored.length ? ` Explored: ${explored.join(", ")}.` : ""
  }`;
}

/**
 * Captures one surface: screenshot, DOM outline and accessibility scan.
 *
 * Never throws: on failure it returns a record with an empty Buffer and a note that
 * says the capture failed. A failed axe scan never looks like "0 violations": the scan
 * error is pushed into problems and the record carries axeStatus "failed".
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @param {object} options Capture options.
 * @param {string} options.id The surface id.
 * @param {string} [options.kind] "view", "modal" or "variant".
 * @param {string} [options.note] How the surface was reached.
 * @param {string[]} [options.problems] Problems already known for this surface.
 * @param {string[]} [options.messages] Toast texts already known for this surface.
 * @returns {Promise<{ id: string, kind: string, screenshot: Buffer, dom: any[], axe: any[], axeStatus?: ("ok"|"failed"), problems: string[], messages: string[], note: string }>} The surface record; axeStatus is omitted when no scan was attempted.
 */
export async function captureSurface(page, { id, kind, note, problems = [], messages = [] } = {}) {
  const surfaceId = String(id ?? "surface");
  const surfaceKind = kind ? String(kind) : "view";
  const baseNote = String(note ?? "");
  const problemList = Array.isArray(problems) ? problems.map((entry) => String(entry)) : [];
  const messageList = Array.isArray(messages) ? messages.map((entry) => String(entry)) : [];

  let screenshot = Buffer.alloc(0);
  let dom = [];
  let axe = [];
  let axeStatus = "";
  const failures = [];

  try {
    if (!page) {
      throw new Error("no page was provided");
    }
    try {
      const buffer = await page.screenshot({ fullPage: true });
      screenshot = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    } catch (err) {
      failures.push("screenshot");
      screenshot = Buffer.alloc(0);
    }
    try {
      const outline = await captureDomOutline(page);
      dom = Array.isArray(outline) ? outline : outline ? [outline] : [];
    } catch {
      failures.push("DOM outline");
      dom = [];
    }
    try {
      const scan = await runAxe(page);
      if (scan && scan.ok) {
        axe = Array.isArray(scan.violations) ? scan.violations : [];
        axeStatus = "ok";
      } else {
        axe = [];
        axeStatus = "failed";
        const reason = scan && scan.error ? String(scan.error) : "the reason was not reported";
        problemList.push(`the axe scan failed: ${reason}`);
      }
    } catch {
      failures.push("axe scan");
      axe = [];
      axeStatus = "failed";
    }
    if (failures.length > 0) {
      screenshot = Buffer.alloc(0);
    }
  } catch (err) {
    failures.push("capture");
    screenshot = Buffer.alloc(0);
    dom = [];
    axe = [];
  }

  let finalNote = baseNote;
  if (failures.length > 0) {
    finalNote = `${baseNote} The capture failed (${failures.join(", ")}).`.trim();
    problemList.push(`the capture failed (${failures.join(", ")})`);
  }

  return {
    id: surfaceId,
    kind: surfaceKind,
    screenshot,
    dom,
    axe,
    ...(axeStatus ? { axeStatus } : {}),
    problems: problemList,
    messages: messageList,
    note: finalNote,
  };
}

/**
 * Walks the whole signed-in app and records a capture for every surface it reaches.
 *
 * Never throws: every failure is recorded as a note or a problem instead.
 *
 * @param {object} options Sweep options.
 * @param {import("playwright").Page} options.page The Playwright page.
 * @param {any} options.context The Playwright browser context.
 * @param {string[]} [options.surfaces] The surfaces to visit.
 * @param {number} [options.maxClicksPerSurface] Maximum exploratory clicks per surface.
 * @param {number} [options.budgetMs] Wall-clock budget for the whole sweep.
 * @param {unknown[]} [options.consoleEntries] The live console capture array.
 * @returns {Promise<{ surfaces: any[], notes: string[] }>} The collected surfaces and report notes.
 */
export async function runSweep({
  page,
  context,
  surfaces,
  maxClicksPerSurface,
  budgetMs,
  consoleEntries,
} = {}) {
  const notes = [];
  const records = [];
  const recordsById = new Map();

  try {
    if (!page) {
      return {
        surfaces: [],
        notes: ["The sweep could not start because no page was provided."],
      };
    }

    const requested =
      Array.isArray(surfaces) && surfaces.length > 0 ? surfaces : DEFAULT_SURFACE_IDS;
    const maxClicks =
      Number.isFinite(maxClicksPerSurface) && maxClicksPerSurface > 0
        ? Math.floor(maxClicksPerSurface)
        : 8;
    const budget = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : 15 * 60 * 1000;
    const consoleLog = Array.isArray(consoleEntries) ? consoleEntries : [];
    const deadline = Date.now() + budget;
    const clickLog = [];
    const watcher = createToastWatcher(page);
    let settingsOpened = false;

    try {
      for (const requestedId of requested) {
        const key = String(requestedId ?? "");
        const recipe = RECIPES[key];
        if (!recipe) {
          notes.push(`The surface "${key}" is not part of the sweep and was skipped.`);
          continue;
        }
        if (Date.now() >= deadline) {
          notes.push("The time budget was exhausted, so the remaining surfaces were skipped.");
          break;
        }
        if (records.length >= MAX_SURFACES) {
          notes.push(`The sweep stopped after ${MAX_SURFACES} surfaces.`);
          break;
        }

        const consoleStart = consoleLog.length;
        let openedSettings = false;
        let extras = [];

        // The onboarding wizard is a full screen overlay, so it must not block the
        // navigation to the next surface either.
        await closeOnboardingOverlay(page, {
          records,
          recordsById,
          watcher,
          notes,
          consoleEntries: consoleLog,
          surfaceId: recipe.id,
        });

        if (recipe.settings) {
          const opened = await ensureSettingsOpen(page, clickLog);
          if (!opened.ok) {
            notes.push(`The surface "${key}" was skipped: ${opened.reason}.`);
            continue;
          }
          openedSettings = opened.opened;
          settingsOpened = true;
        }

        const clicked = await clickControl(page, recipe.selector, {
          label: recipe.control(openedSettings),
          sidebar: Boolean(recipe.sidebar),
          notes,
          clickLog,
          surfaceId: recipe.id,
        });
        extras = extras.concat(clicked.extras);
        if (!clicked.ok) {
          notes.push(`The surface "${key}" was skipped: ${clicked.reason}.`);
          continue;
        }
        await sleep(600);

        watcher.setSurface(recipe.id);
        const pending = watcher.take();
        const note = `Reached by clicking ${recipe.control(openedSettings)}.${recipe.extra ? ` ${recipe.extra}` : ""}`;
        const record = await captureSurface(page, {
          id: recipe.id,
          kind: recipe.kind,
          note,
          problems: [],
          messages: [],
        });
        records.push(record);
        recordsById.set(record.id, record);
        assignMessages(recordsById, pending, record);
        record.problems.push(...summarizeConsoleEntries(consoleLog, consoleStart));

        await exploreSurface(page, record, {
          maxClicks,
          deadline,
          watcher,
          notes,
          clickLog,
          recordsById,
          records,
          context,
          consoleEntries: consoleLog,
        });
      }

      if (settingsOpened) {
        const back = page
          .locator('[data-testid="view-settings"] button[aria-label="Back to dashboard"]')
          .first();
        try {
          await back.waitFor({ state: "visible", timeout: CLICK_TIMEOUT });
          await back.click({ timeout: CLICK_TIMEOUT });
          clickLog.push({
            surfaceId: "",
            name: "the Back to dashboard button in the settings view",
          });
          await sleep(600);
        } catch {
          notes.push("The sweep could not leave the settings view automatically.");
        }
      }

      await runDarkVariant(page, records, recordsById, notes, clickLog, consoleLog);
      await runMobileVariants(page, records, recordsById, notes, clickLog, consoleLog);
    } finally {
      watcher.stop();
    }

    for (const click of clickLog) {
      notes.push(`Clicked "${redactText(click.name, 120)}" on ${click.surfaceId || "the app"}.`);
    }
    notes.push(`The sweep visited ${records.length} surface(s).`);
  } catch (err) {
    notes.push(
      `The sweep stopped early: ${redactText(err && err.message ? err.message : err, 300)}`,
    );
  }

  return { surfaces: records, notes };
}

/**
 * Captures the dashboard in dark mode and restores the light theme.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @param {any[]} records Every surface record collected so far.
 * @param {Map<string, any>} recordsById Surface records by id.
 * @param {string[]} notes Notes collected by the sweep.
 * @param {Array<{ surfaceId: string, name: string }>} clickLog Every click performed.
 * @param {unknown[]} consoleEntries The live console capture array.
 * @returns {Promise<void>} Resolves when the variant is done or skipped.
 */
async function runDarkVariant(page, records, recordsById, notes, clickLog, consoleEntries) {
  const surfaceId = "variant:dark-dashboard";
  try {
    const dashboard = page.locator('[data-testid="topbar-nav-dashboard"]').first();
    await dashboard.waitFor({ state: "visible", timeout: CLICK_TIMEOUT });
    await dashboard.click({ timeout: CLICK_TIMEOUT });
    clickLog.push({
      surfaceId,
      name: "the Dashboard tab in the topbar view switcher",
    });
    await sleep(600);

    const darkButton = page
      .locator('[data-testid="app-topbar"] button[aria-label="Switch to dark mode"]')
      .first();
    if ((await darkButton.count()) === 0) {
      const lightButton = page
        .locator('[data-testid="app-topbar"] button[aria-label="Switch to light mode"]')
        .first();
      if ((await lightButton.count()) > 0) {
        notes.push("The dark-theme variant was skipped because the app was already in dark mode.");
      } else {
        notes.push("The dark-theme variant was skipped because no theme toggle was found.");
      }
      return;
    }

    const consoleStart = consoleEntries.length;
    await darkButton.click({ timeout: CLICK_TIMEOUT });
    clickLog.push({ surfaceId, name: "the Switch to dark mode button in the topbar" });
    await sleep(600);

    if (records.length < MAX_SURFACES) {
      const record = await captureSurface(page, {
        id: surfaceId,
        kind: "variant",
        note: "Reached by clicking the Switch to dark mode button in the topbar after returning to the dashboard.",
        problems: [],
        messages: [],
      });
      records.push(record);
      recordsById.set(record.id, record);
      record.problems.push(...summarizeConsoleEntries(consoleEntries, consoleStart));
    } else {
      notes.push(
        `The dark-theme variant was skipped because the sweep reached the ${MAX_SURFACES} surface cap.`,
      );
    }

    const restore = page
      .locator('[data-testid="app-topbar"] button[aria-label="Switch to light mode"]')
      .first();
    if ((await restore.count()) > 0) {
      await restore.click({ timeout: CLICK_TIMEOUT });
      clickLog.push({ surfaceId, name: "the Switch to light mode button in the topbar" });
      await sleep(400);
    } else {
      notes.push("The light theme could not be restored automatically.");
    }
  } catch (err) {
    notes.push(
      `The dark-theme variant failed: ${redactText(err && err.message ? err.message : err, 300)}`,
    );
  }
}

/**
 * Captures the dashboard, calendar and tasks in a narrow mobile viewport.
 *
 * @param {import("playwright").Page} page The Playwright page.
 * @param {any[]} records Every surface record collected so far.
 * @param {Map<string, any>} recordsById Surface records by id.
 * @param {string[]} notes Notes collected by the sweep.
 * @param {Array<{ surfaceId: string, name: string }>} clickLog Every click performed.
 * @param {unknown[]} consoleEntries The live console capture array.
 * @returns {Promise<void>} Resolves when the variants are done or skipped.
 */
async function runMobileVariants(page, records, recordsById, notes, clickLog, consoleEntries) {
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(600);

    const mobileNav = page.locator('[data-testid="app-mobilenav"]').first();
    const visible = await mobileNav.isVisible().catch(() => false);
    if (!visible) {
      notes.push(
        "The mobile variants were skipped because the mobile bottom navigation was not visible.",
      );
      return;
    }

    for (const view of ["dashboard", "calendar", "tasks"]) {
      const surfaceId = `variant:mobile-${view}`;
      if (records.length >= MAX_SURFACES) {
        notes.push(
          `The mobile variants were stopped because the sweep reached the ${MAX_SURFACES} surface cap.`,
        );
        break;
      }
      const button = page.locator(`[data-testid="mobilenav-${view}"]`).first();
      try {
        await button.waitFor({ state: "visible", timeout: CLICK_TIMEOUT });
        const consoleStart = consoleEntries.length;
        await button.click({ timeout: CLICK_TIMEOUT });
        clickLog.push({
          surfaceId,
          name: `the ${view} item in the mobile bottom navigation`,
        });
        await sleep(600);
        const record = await captureSurface(page, {
          id: surfaceId,
          kind: "variant",
          note: `Reached by clicking the ${view} item in the mobile bottom navigation after switching to the 390x844 viewport.`,
          problems: [],
          messages: [],
        });
        records.push(record);
        recordsById.set(record.id, record);
        record.problems.push(...summarizeConsoleEntries(consoleEntries, consoleStart));
      } catch (err) {
        notes.push(
          `The mobile ${view} variant was skipped: ${redactText(
            err && err.message ? err.message : err,
            300,
          )}`,
        );
      }
    }
  } catch (err) {
    notes.push(
      `The mobile viewport variants failed: ${redactText(
        err && err.message ? err.message : err,
        300,
      )}`,
    );
  } finally {
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await sleep(400);
    } catch {
      // The viewport could not be restored; the sweep still finishes.
    }
  }
}
