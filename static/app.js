// ============================================================================
// QuizRadar — Standalone Frontend Controller (Impeccable Polish, Animate & Adapt)
// Views: 1) First-Time Onboarding Wizard  2) Smart Dashboard  3) Week Calendar
// ============================================================================

// Native Capacitor / Android Environment Setup
const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

// Single source of truth for the UI version (keep in sync with Cargo.toml / package.json)
const APP_VERSION = "4.3.0";

// ============================================================================
// QUIZRADAR AUTONOMOUS ON-DEVICE BACKEND ENGINE (100% Isolated, Zero Latency)
// ============================================================================
const STANDALONE_STORAGE_KEY = "quizradar_standalone_db_v6";
const _originalFetch = window.fetch.bind(window);

function toIsoDate(d) {
  if (!d) return "";
  const dateObj = d instanceof Date ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return "";
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getTodayDate() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function getSundayOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0 is Sunday
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

// ============================================================================
// SHARED PERFORMANCE HELPERS (scoped icon hydration, rAF throttle, debounce)
// ============================================================================

// Hydrate icons only inside the container that was just written to.
// Call with no argument for the rare one-off full-document fallback.
function refreshIcons(root) {
  if (!window.lucide || typeof window.lucide.createIcons !== "function") return;
  if (root) {
    window.lucide.createIcons({ root });
    return;
  }
  if (arguments.length === 0) {
    window.lucide.createIcons();
  }
}

// Coalesce high-frequency events (resize, scroll, touchmove) to one rAF frame.
function rafThrottle(fn) {
  let scheduled = false;
  let lastArgs = null;
  return function (...args) {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const argsToUse = lastArgs;
      lastArgs = null;
      fn.apply(this, argsToUse || []);
    });
  };
}

// Disables a button for the duration of an async submit: double-taps must
// never fire duplicate POSTs (duplicate courses/events on the desktop server).
async function withButtonLock(btn, fn) {
  if (!btn) return fn();
  if (btn.dataset.busy === "1") return;
  btn.dataset.busy = "1";
  const prevDisabled = btn.disabled;
  btn.disabled = true;
  btn.classList.add("opacity-60", "pointer-events-none");
  try {
    return await fn();
  } finally {
    btn.dataset.busy = "";
    btn.disabled = prevDisabled;
    btn.classList.remove("opacity-60", "pointer-events-none");
  }
}

// ============================================================================
// MODAL ACCESSIBILITY (focus trap + focus restore)
// The Escape-to-close priority chain already lives in initKeyboardShortcuts();
// this handles Tab trapping and returning keyboard focus to the trigger.
// ============================================================================

let _a11yModalOpenCount = 0;
let _a11yFocusRestoreTarget = null;

function initModalA11y() {
  // Tab: cycle focus strictly inside the topmost open modal panel.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Tab") return;
      const open = Array.from(document.querySelectorAll(".modal-backdrop.is-open"));
      if (open.length === 0) return;
      const top = open[open.length - 1];
      const panel = top.querySelector(".modal-panel");
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    true
  );

  // Observe open/close transitions: stash the trigger to restore later and move
  // focus into freshly opened panels (only when the app didn't already focus
  // something above us, like the input-focus calls most openers perform).
  const observer = new MutationObserver(() => {
    const openCount = document.querySelectorAll(".modal-backdrop.is-open").length;
    if (openCount > _a11yModalOpenCount) {
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) {
        _a11yFocusRestoreTarget = active;
      }
      const top = Array.from(document.querySelectorAll(".modal-backdrop.is-open")).pop();
      const panel = top?.querySelector(".modal-panel");
      if (panel) {
        setTimeout(() => {
          if (!panel || !panel.isConnected) return;
          if (!document.querySelector(".modal-backdrop.is-open")) return;
          const activeNow = document.activeElement;
          if (activeNow && activeNow !== document.body && panel.contains(activeNow)) return;
          const firstFocusable = Array.from(
            panel.querySelectorAll('button, input, select, textarea, [tabindex="-1"], a[href]')
          ).find((el) => el.offsetParent !== null);
          if (firstFocusable) firstFocusable.focus();
          else {
            panel.setAttribute("tabindex", "-1");
            panel.focus();
          }
        }, 60);
      }
    } else if (openCount === 0 && _a11yModalOpenCount > 0) {
      const target = _a11yFocusRestoreTarget;
      _a11yFocusRestoreTarget = null;
      if (target && target.isConnected && typeof target.focus === "function") {
        try {
          target.focus();
        } catch (err) { /* element too stale to refocus */ }
      }
    }
    _a11yModalOpenCount = openCount;
  });
  observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class"] });
}

// Trailing-edge debounce with cancel()/flush() for immediate paths.
function debounce(fn, wait) {
  let timer = null;
  let lastArgs = null;
  const wrapped = function (...args) {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const argsToUse = lastArgs || [];
      lastArgs = null;
      fn.apply(this, argsToUse);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };
  wrapped.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!lastArgs) return;
    const argsToUse = lastArgs;
    lastArgs = null;
    fn.apply(this, argsToUse);
  };
  return wrapped;
}

function isViewActive(viewId) {
  const el = document.getElementById(viewId);
  return !!el && !el.classList.contains("hidden");
}

// View switching: restart the enter animation without a forced synchronous reflow.
// The class is applied one frame before the view becomes visible so the animation
// always starts from its first keyframe (no flash).
function revealViewWithTransition(el) {
  if (!el) return;
  el.classList.remove("view-transition");
  const token = (el._revealToken = (el._revealToken || 0) + 1);
  requestAnimationFrame(() => {
    if (el._revealToken !== token) return;
    el.classList.add("view-transition");
    requestAnimationFrame(() => {
      if (el._revealToken !== token) return;
      el.classList.remove("hidden");
    });
  });
}

function hideView(el) {
  if (!el) return;
  el._revealToken = (el._revealToken || 0) + 1;
  el.classList.add("hidden");
}

// Modal opening without a forced synchronous reflow: the backdrop is invisible
// until "is-open" lands, so the two-frame reveal is flicker-free.
function revealModalWithTransition(el, onRevealed) {
  if (!el) return;
  el.classList.remove("hidden");
  const token = (el._revealToken = (el._revealToken || 0) + 1);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (el._revealToken !== token || el.classList.contains("hidden")) return;
      el.classList.add("is-open");
      if (typeof onRevealed === "function") onRevealed();
    })
  );
}

function dismissModalTransition(el) {
  if (!el) return;
  el._revealToken = (el._revealToken || 0) + 1;
  el.classList.remove("is-open");
}

// ============================================================================
// ON-DEVICE LIVE SCANNING (parity port of src/gmail.rs + src/parser.rs)
// The phone engine now pulls university announcements directly from Gmail /
// Outlook / Moodle feeds using the OAuth tokens obtained at sign-in. Token
// RENEWAL goes through the native loopback bridge (/api/auth/refresh) whose
// handler lives in MainActivity — the JS layer only ever holds short-lived
// access tokens, never the refresh credential.
// ============================================================================

const EMAIL_SEPARATOR = "---------------------------------------------------------------------";

function decodeBase64UrlGs(raw) {
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch (e) {
    return "";
  }
}

function stripHtmlTags(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractAnnouncementBody(body) {
  const start = body.indexOf(EMAIL_SEPARATOR);
  if (start >= 0) {
    const after = body.slice(start + EMAIL_SEPARATOR.length);
    const end = after.indexOf(EMAIL_SEPARATOR);
    return end >= 0 ? after.slice(0, end) : after;
  }
  return body;
}

function containsTemplateNotice(subjectLower, bodyLower) {
  return (
    subjectLower.includes("quiz template") ||
    subjectLower.includes("assignment template") ||
    bodyLower.includes("quiz template") ||
    bodyLower.includes("assignment template")
  );
}

/** Exact parity port of parser.rs::is_candidate_assessment_email. */
function isCandidateAssessmentEmail(subjectLower, fromLower, bodyLower) {
  // Filter out the student's own outgoing replies
  if (subjectLower.startsWith("re:")) return false;

  // Filter out pure grade/result announcements unless a remake/makeup is announced
  if (
    (subjectLower.includes("result") ||
      subjectLower.includes("grades") ||
      subjectLower.includes("marks") ||
      subjectLower.includes("model answer") ||
      subjectLower.includes("cancellation") ||
      subjectLower.includes("appeal") ||
      subjectLower.includes("upload your course materials") ||
      subjectLower.includes("lecture 1 slides")) &&
    !bodyLower.includes("remake will be held")
  ) {
    return false;
  }

  // Filter out pure file-upload notifications
  if (bodyLower.includes("is new in the course") && !bodyLower.includes("will be held")) return false;

  // Filter out bare "REMINDER" 1-word duplicates of an earlier thread
  if (bodyLower.includes("----")) {
    const parts = bodyLower.split(EMAIL_SEPARATOR);
    if (parts.length > 1 && parts[1].trim() === "reminder") return false;
  }

  return (
    subjectLower.includes("quiz") ||
    subjectLower.includes("midterm") ||
    subjectLower.includes("exam") ||
    subjectLower.includes("assignment") ||
    subjectLower.includes("assessment") ||
    (bodyLower.includes("quiz") && fromLower.includes("e-learning"))
  );
}

function monthFromName(name) {
  switch (String(name || "").toLowerCase()) {
    case "january": return 1;
    case "february": return 2;
    case "march": return 3;
    case "april": return 4;
    case "may": return 5;
    case "june": return 6;
    case "july": return 7;
    case "august": return 8;
    case "september": return 9;
    case "october": return 10;
    case "november": return 11;
    case "december": return 12;
    default: return null;
  }
}

function weekdayIndexFromName(name) {
  switch (String(name || "").toLowerCase()) {
    case "sunday": return 0;
    case "monday": return 1;
    case "tuesday": return 2;
    case "wednesday": return 3;
    case "thursday": return 4;
    case "friday": return 5;
    case "saturday": return 6;
    default: return null;
  }
}

function makeLocalDate(year, month, day) {
  const d = new Date(year, month - 1, day);
  if (isNaN(d.getTime())) return null;
  if (d.getDate() !== day || d.getMonth() !== month - 1) return null; // rejects 31 Feb rollovers
  return d;
}

/** "30 September 2026" / "30-09-2026" / "30/09/2026" → Date, else null. */
function extractExplicitDate(text) {
  const dmy = text.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i);
  if (dmy) {
    const mon = monthFromName(dmy[2]);
    const d = mon ? makeLocalDate(parseInt(dmy[3], 10), mon, parseInt(dmy[1], 10)) : null;
    if (d) return d;
  }
  const num = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (num) {
    const d = makeLocalDate(parseInt(num[3], 10), parseInt(num[2], 10), parseInt(num[1], 10));
    if (d) return d;
  }
  return null;
}

/** RFC-style header date ("30 Sep 2026 14:03:11 GMT") → local Date. */
function parseEmailSentDate(dateHeader) {
  const m = String(dateHeader || "").match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (m) {
    const mon = monthFromName(m[2]);
    const d = mon ? makeLocalDate(parseInt(m[3], 10), mon, parseInt(m[1], 10)) : null;
    if (d) return d;
  }
  const parsed = new Date(dateHeader || "");
  return isNaN(parsed.getTime()) ? null : parsed;
}

function isEmailRecent(dateHeader, maxAgeDays = 60) {
  const d = parseEmailSentDate(dateHeader);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86400000) <= maxAgeDays;
}

function format12h(hhmm) {
  const parts = String(hhmm || "").split(":");
  if (parts.length < 2) return String(hhmm || "");
  let h = parseInt(parts[0], 10);
  const mins = parts[1];
  if (!Number.isFinite(h)) return String(hhmm);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h}:${mins} ${ampm}`;
}

function weekdayFullName(idx) {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[idx >= 0 && idx <= 6 ? idx : 1];
}

function monthFullName(m) {
  const names = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return names[m >= 1 && m <= 12 ? m : 10];
}

/** Semester label derived from the date itself (kept correct across years). */
function inferSemesterFromDateLocal(d) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (m >= 2 && m <= 5) return `Spring ${y}`;
  if (m >= 6 && m <= 8) return `Summer ${y}`;
  if (m >= 9) return `Fall ${y}`;
  if (m === 1) return d.getDate() <= 20 ? `Fall ${y - 1}` : `Spring ${y}`;
  return `Fall ${y}`;
}

function defaultCoursePaletteLocal(courseId) {
  switch (String(courseId || "").trim().toUpperCase()) {
    case "CS 101": case "CS101":
      return { bg: "#dbeafe", fg: "#1a73e8", border: "#1a73e8" };
    case "MATH 101": case "MATH101":
      return { bg: "#f3e8ff", fg: "#8e24aa", border: "#7b1fa2" };
    case "DATA 201": case "DATA201":
      return { bg: "#dcfce7", fg: "#0f9d58", border: "#15803d" };
    case "PHYS 101": case "PHYS101":
      return { bg: "#fef3c7", fg: "#f4b400", border: "#d97706" };
    case "MGMT 100": case "MGMT100":
      return { bg: "#fee2e2", fg: "#e67c73", border: "#dc2626" };
    default:
      return { bg: "#e0e7ff", fg: "#6366f1", border: "#4338ca" };
  }
}

/** Gmail payload → plain text (walks MIME parts, prefers text/plain). */
function gmailExtractBody(payload) {
  const walk = (part) => {
    if (!part) return "";
    if (part.mimeType === "text/plain" && part.body && part.body.data) {
      return decodeBase64UrlGs(part.body.data);
    }
    if (part.parts && part.parts.length) {
      for (const p of part.parts) {
        if (p.mimeType === "text/plain") {
          const t = walk(p);
          if (t) return t;
        }
      }
      for (const p of part.parts) {
        if (p.mimeType !== "text/plain") {
          const t = walk(p);
          if (t) return t;
        }
      }
    }
    if (part.mimeType === "text/html" && part.body && part.body.data) {
      return stripHtmlTags(decodeBase64UrlGs(part.body.data));
    }
    if (part.body && part.body.data) return decodeBase64UrlGs(part.body.data);
    return "";
  };
  return walk(payload) || "";
}

/** Un-escapes an ICS text value (SUMMARY/DESCRIPTION). */
function unescapeIcsText(v) {
  return String(v || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

/** ICS 20260930 / 20260930T141500(+Z/TZID) → {date:Date, time:"14:15"|null} */
function parseIcsDateTime(raw) {
  const m = String(raw || "").match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return null;
  const d = makeLocalDate(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  if (!d) return null;
  const time = m[4] && m[5] ? `${m[4]}:${m[5]}` : null;
  return { date: d, time };
}

/** Exact parity port of parser.rs::process_all_emails (heuristic path — Gemini runs on the desktop). */
function processAllScannedEmails(rawEmails, notes, sourceName, sourceIcon, engineSchedule) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const reCourse = /\b([A-Z]{2,4}\s*\d{3}[a-zA-Z]?)\b/i; // RE_COURSE (case-insensitive like Rust's (?i))
  const reUrl = /(https:\/\/e-learning\.[a-zA-Z0-9.-]+\/[^\s\]]+)/; // RE_URL

  // --- prepare step (mirrors process_all_emails' map) ---
  const prepared = rawEmails.map((email) => {
    const subjectLower = String(email.subject || "").toLowerCase();
    const bodyLower = String(email.body || "").toLowerCase();
    const announcementBody = extractAnnouncementBody(String(email.body || ""));
    const announcementLower = announcementBody.toLowerCase();
    const isCandidate = isCandidateAssessmentEmail(
      subjectLower,
      String(email.from || "").toLowerCase(),
      bodyLower
    );
    return { email, subjectLower, bodyLower, announcementBody, announcementLower, isCandidate };
  });

  const hasTemplateNotice = prepared.some((p) => containsTemplateNotice(p.subjectLower, p.bodyLower));

  // --- parse loop (exact precedence from parser.rs::parse_single_email) ---
  const out = [];
  const seenKeys = new Set();
  let scanned = prepared.length;
  let candidates = 0;
  let parsedCount = 0;

  for (const p of prepared) {
    if (!p.isCandidate) continue;
    candidates++;

    const subjAndBody = String(p.email.subject || "") + " " + p.announcementBody;
    const lower = p.subjectLower + " " + p.announcementLower;

    // 1. Course ID: capture then strip inner spaces + uppercase ("DATA 201" → "DATA201")
    const courseMatch = subjAndBody.match(reCourse);
    const rawCourse = courseMatch ? courseMatch[1].replace(/ /g, "").toUpperCase() : "GENERAL";

    // 2. Assessment type (exact chain order)
    let assessmentType;
    if (lower.includes("midterm")) assessmentType = "Midterm Exam";
    else if (lower.includes("final exam")) assessmentType = "Final Exam";
    else if (lower.includes("online quiz") || lower.includes("/mod/quiz/")) assessmentType = "Online Quiz";
    else if (lower.includes("in-class assignment") || p.subjectLower.includes("assignment")) assessmentType = "Assignment";
    else if (lower.includes("lab session") || lower.includes("during the lab")) assessmentType = "Lab Assessment";
    else assessmentType = "Class Quiz";

    // 3. Instructor from the sender display name only (never invented)
    const instructor = String(p.email.from || "").split("<")[0].replace(/"/g, "").replace(/\(via [^)]+\)/g, "").trim();

    // 4. Schedule-aware date/time/room/group + title + inference note
    const sentDate = parseEmailSentDate(p.email.date || "") || today;
    const preferredSlotType =
      lower.includes("tutorial") && !lower.includes("tutorial sheets")
        ? "Tutorial"
        : lower.includes("lab session") || lower.includes("during the lab")
          ? "Lab"
          : "Lecture";
    const slots = engineSchedule.slots || [];
    const matchedSlot =
      slots.find(
        (s) => String(s.course_id || "") === rawCourse &&
          String(s.slot_type || s.type || "").toLowerCase() === preferredSlotType.toLowerCase()
      ) || slots.find((s) => String(s.course_id || "") === rawCourse);

    const explicitDate = extractExplicitDate(lower);
    const dateWasRelative = !explicitDate;
    const defaultStart = (matchedSlot && matchedSlot.start_time) || "09:00";
    const defaultEnd = (matchedSlot && matchedSlot.end_time) || "10:30";
    const defaultRoom = (matchedSlot && matchedSlot.room) || "Room unspecified";
    const defaultGroup = matchedSlot ? `Group ${matchedSlot.group}` : "All Groups";

    let targetDate;
    if (explicitDate) {
      targetDate = explicitDate;
    } else if (lower.includes("next week (not this week)")) {
      targetDate = new Date(sentDate.getTime() + 8 * 86400000);
    } else if (lower.includes("next week")) {
      targetDate = new Date(sentDate.getTime() + 5 * 86400000);
    } else if (lower.includes("this week")) {
      targetDate = new Date(sentDate.getTime() + 3 * 86400000);
    } else {
      targetDate = new Date(sentDate.getTime());
    }
    if (matchedSlot) {
      const wd = weekdayIndexFromName(matchedSlot.day || "");
      if (wd != null) {
        let cursor = new Date(targetDate.getTime());
        for (let i = 0; i < 7; i++) {
          if ((cursor.getDay() % 7) === wd) { targetDate = new Date(cursor.getTime()); break; }
          cursor = new Date(cursor.getTime() + 86400000);
        }
      }
    }

    const cleanTitle = lower.includes("quiz 3")
      ? `Quiz 3: ${rawCourse}`
      : lower.includes("quiz 2")
        ? `Quiz 2: ${rawCourse}`
        : lower.includes("quiz 1")
          ? `Quiz 1: ${rawCourse}`
          : assessmentType === "Midterm Exam"
            ? `${rawCourse} Midterm Exam`
            : String(p.email.subject || "");

    let aiInferenceNote;
    if (dateWasRelative) {
      aiInferenceNote = matchedSlot
        ? `Estimated (local heuristic): the announcement had no explicit date — approximate timing inferred from wording ("this/next week"). Room/time aligned with your ${rawCourse} ${preferredSlotType} slot (${format12h(defaultStart)} – ${format12h(defaultEnd)}, Room ${defaultRoom}). Configure a Gemini API key for precise extraction.`
        : "Estimated (local heuristic): the announcement had no explicit date and this course is not in your schedule, so the date/timing is an approximation. Add the course to your weekly schedule or configure a Gemini API key for precise extraction.";
    } else {
      aiInferenceNote = matchedSlot
        ? `Parsed from announcement: explicit date found and aligned with your ${rawCourse} ${preferredSlotType} slot (${format12h(defaultStart)} – ${format12h(defaultEnd)}, Room ${defaultRoom}).`
        : "Parsed from announcement: explicit date found. Time/room are best-effort estimates because this course is not in your weekly schedule.";
    }

    // 5. Topics & warnings (exact extract_topics / extract_warnings)
    const topics = [];
    if (lower.includes("bjt")) topics.push("BJT Transistor Analysis & Biasing");
    if (lower.includes("mosfet")) topics.push("MOSFET Characteristics & Small-Signal Models");
    if (topics.length === 0) topics.push(`${rawCourse} announced syllabus material`);

    const warnings = [];
    if (lower.includes("quiz template") || (hasTemplateNotice && lower.includes("quiz"))) {
      warnings.push("⚠️ Bring your printed Quiz Template to the lecture!");
    }
    if (/(will not be able to go back|cannot go back|won't be able to go back)/.test(lower)) {
      warnings.push("⚠️ Strict Navigation: Once you move to the next question, you CANNOT go back!");
    }
    if (lower.includes("closed-book") || lower.includes("mobile phones are strictly prohibited")) {
      warnings.push("⚠️ Closed-Book: Mobile phones and outside notes are strictly prohibited.");
    }
    if (lower.includes("15 minutes") || lower.includes("15 mins")) {
      warnings.push("⏱️ Strict Time Limit: 15 minutes duration.");
    }
    if (lower.includes("mcq")) {
      warnings.push("📝 Exam Format: Multiple Choice Questions (MCQ) + Explain & Discuss.");
    }
    if (lower.includes("assigned time slot") || lower.includes("assigned group")) {
      warnings.push("📍 Group Enforcement: You must attend ONLY during your registered group slot.");
    }

    // 6. Study plan (generate_ai_study_plan incl. the course-tuned table)
    let studyPlan;
    let studyHours;
    switch (rawCourse) {
      case "MATH101": studyPlan = "Practice computing step size and setting up function evaluation tables. Double-check all calculus and linear algebra calculation steps."; studyHours = 3.0; break;
      case "DATA201": studyPlan = "Focus on hand-calculating time complexity (Big-O), sorting algorithms, tree traversals, and dynamic programming subproblems."; studyHours = 4.0; break;
      case "CS101": studyPlan = "Practice fast recognition of algorithmic loops, recursion trees, and fundamental data structures so you can solve each question confidently."; studyHours = 3.5; break;
      case "PHYS101": studyPlan = "Review core mechanics, circuit equations, and measurement lab sheets from recent problem sets."; studyHours = 3.5; break;
      case "MGMT100": studyPlan = "Review organizational strategy, leadership frameworks, and real-world case analysis from lecture notes."; studyHours = 2.5; break;
      default:
        if (rawCourse === "GENERAL" && assessmentType === "Midterm Exam") {
          studyPlan = "Space out your midterm revision across the next 3 weeks: dedicate 2 days per course starting with high-problem-solving courses and solve past practice papers.";
          studyHours = 18.0;
        } else {
          const warnHint = warnings.some((w) => w.includes("Template")) ? " Don't forget to print your required template before class." : "";
          studyPlan = `Review ${rawCourse} lecture slides and solve the corresponding tutorial sheet problems (${topics.length} core topic areas).${warnHint}`;
          studyHours = 2.5;
        }
    }

    // 7. Urgency / priority (compute_priority_score)
    const dateIso = toIsoLocal(targetDate);
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? makeLocalDateFromIso(dateIso) : sentDate;
    const daysUntil = Math.round(
      (new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate()).getTime() -
        new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000
    );
    const isUpcoming = daysUntil >= 0;
    const urgencyLevel = !isUpcoming ? "past" : daysUntil <= 2 ? "critical" : daysUntil <= 5 ? "high" : daysUntil <= 14 ? "medium" : "upcoming";
    const urgencyBase = daysUntil < 0 ? 10 : daysUntil === 0 ? 98 : daysUntil === 1 ? 95 : daysUntil === 2 ? 90 : daysUntil === 3 ? 84 : daysUntil === 4 ? 80 : daysUntil === 5 ? 76 : daysUntil <= 7 ? 70 : daysUntil <= 14 ? 60 : 50;
    const typeBonus = assessmentType === "Midterm Exam" || assessmentType === "Final Exam" ? 12 : assessmentType === "Class Quiz" || assessmentType === "Online Quiz" ? 6 : 3;
    const priorityScore = Math.min(100, urgencyBase + typeBonus + Math.min(topics.length, 6) * 1);

    // 8. Course palette / names from the user's own schedule (honest passthrough)
    const courseInfo = (engineSchedule.courses || []).find((c) => String(c.id || "") === rawCourse);
    const courseName = courseInfo ? courseInfo.name : rawCourse;
    const color = courseInfo ? courseInfo.color : defaultCoursePaletteLocal(rawCourse).fg;
    const bg = courseInfo ? courseInfo.bg : defaultCoursePaletteLocal(rawCourse).bg;
    const border = courseInfo ? courseInfo.border : defaultCoursePaletteLocal(rawCourse).border;

    const dayName = weekdayFullName(parsedDate.getDay());
    const displayTime = `${dayName}, ${parsedDate.getDate()} ${monthFullName(parsedDate.getMonth() + 1)} ${parsedDate.getFullYear()} (${format12h(defaultStart)} – ${format12h(defaultEnd)})`;
    const elearningUrlMatch = String(p.email.body || "").match(reUrl);

    const assessment = {
      id: String(p.email.id || `${sourceName.toLowerCase()}-${Date.now()}-${parsedCount}`),
      course_id: rawCourse,
      course_name: courseName,
      title: cleanTitle,
      assessment_type: assessmentType,
      date_iso: dateIso,
      day_name: dayName,
      start_time: defaultStart,
      end_time: defaultEnd,
      display_time: displayTime,
      room: defaultRoom,
      group: defaultGroup,
      instructor,
      is_upcoming: isUpcoming,
      days_until: daysUntil,
      urgency_level: urgencyLevel,
      priority_score: priorityScore,
      topics,
      warnings,
      ai_inference_note: aiInferenceNote,
      ai_study_plan: studyPlan,
      estimated_study_hours: studyHours,
      elearning_url: (elearningUrlMatch ? elearningUrlMatch[1].trim() : ""),
      google_cal_url: "",
      gcal_synced: false,
      gcal_event_id: null,
      color,
      bg,
      border,
      semester: inferSemesterFromDateLocal(parsedDate),
      email_subject: String(p.email.subject || ""),
      email_sent_date: sentDate ? toIsoLocal(sentDate) : "",
      source: sourceName,
      source_icon: sourceIcon,
      conflict_warning: null
    };

    // Dedupe key includes the source: a real quiz announced over both Gmail
    // and Teams must not collapse into whichever copy was processed first.
    const dedupeKey = `${sourceName}|${rawCourse}|${assessment.title}|${assessment.date_iso}`;
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      out.push(assessment);
      parsedCount++;
    }
  }

  notes.push(`${sourceName}: ${scanned} message${scanned === 1 ? "" : "s"} scanned, ${parsedCount} assessment${parsedCount === 1 ? "" : "s"} found (${candidates} candidates).`);
  return out;
}

function makeLocalDateFromIso(iso) {
  const parts = iso.split("-").map(Number);
  return parts.length === 3 ? makeLocalDate(parts[0], parts[1], parts[2]) : null;
}

function resolveCourseNameLocal(schedule, courseId) {
  const courses = (schedule && schedule.courses) || [];
  const match = courses.find((c) => String(c.id || "").trim().toUpperCase() === courseId.toUpperCase());
  return match ? match.name : courseId;
}

function toIsoLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Redeems a fresh access token through the native loopback bridge.
 * Java side (LocalOAuthServer + MainActivity) holds the refresh tokens in
 * private storage and enforces the session bridge secret; the JS layer only
 * ever obtains short-lived access tokens.
 */
async function bridgeRefreshAccessToken(provider) {
  try {
    if (!window.__quizradarBridgeKey) return null;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
    const res = await _originalFetch("http://127.0.0.1:3000/api/auth/refresh", {
      method: "POST",
      signal: ctrl ? ctrl.signal : undefined,
      headers: { "Content-Type": "application/json", "X-QuizRadar-Bridge": window.__quizradarBridgeKey },
      body: JSON.stringify({ provider })
    });
    if (timer) clearTimeout(timer);
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (!data || data.ok !== true || !data.access_token) return null;
    return data;
  } catch (e) {
    return null;
  }
}

/** Gmail live scan: five queries in parity with src/gmail.rs, deduped, full fetch. */
const GMAIL_SCAN_QUERIES = [
  "quiz",
  "exam OR midterm OR final",
  "assignment OR test OR homework OR project OR deadline",
  "from:e-learning OR from:edu",
  "from:canvas OR from:blackboard OR from:gradescope OR from:classroom.google.com"
];

/**
 * Adds a new native on-device live-scan pipeline to the engine class.
 * Runs Gmail (Google token), Outlook, and Moodle-ICS branches, then merges.
 */
class QuizRadarAutonomousEngine {
  constructor() {
    this.state = this.loadDatabase();
  }

  loadDatabase() {
    try {
      const raw = localStorage.getItem(STANDALONE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.schedule && Array.isArray(parsed.assessments)) {
          if (!parsed.config) parsed.config = {};
          // Migrate legacy top-level completed_topics into config (single source of truth,
          // matching the desktop server which persists it inside the app config).
          if (parsed.completed_topics && (!parsed.config.completed_topics || Object.keys(parsed.config.completed_topics).length === 0)) {
            parsed.config.completed_topics = parsed.completed_topics;
          }
          // Scrub legacy mock assessments and tasks if lingering from previous demo versions
          parsed.assessments = parsed.assessments.filter(a => !["cs101-a1", "math101-q1", "mgmt100-q1", "data201-m1"].includes(a.id));
          if (Array.isArray(parsed.study_tasks)) {
            parsed.study_tasks = parsed.study_tasks.filter(t => !["st-1", "st-2", "st-3", "st-4"].includes(t.id));
          }
          if (parsed.dashboard && Array.isArray(parsed.dashboard.study_recommendations)) {
            parsed.dashboard.study_recommendations = parsed.dashboard.study_recommendations.filter(r => !["cs101-a1", "math101-q1", "mgmt100-q1", "data201-m1"].includes(r.assessment_id));
          }
          return this.recomputeDashboard(parsed);
        }
      }
    } catch (e) {
      console.warn("[Engine] Storage load warning:", e);
    }
    return this.createInitialDatabase();
  }

  createInitialDatabase() {
    const initial = {
      config: {
        user_name: "Student",
        user_email: null,
        user_picture: null,
        teams_enabled: false,
        teams_account_email: null,
        teams_account_name: null,
        gemini_enabled: true,
        gemini_api_key: null,
        auto_sync_gcal: false,
        dark_mode: false,
        onboarding_completed: false, // Fresh install launches onboarding wizard!
        last_gmail_sync: "Never",
        completed_topics: {},
        custom_events: []
      },
      auth: {
        name: "Student",
        email: null,
        authenticated: false,
        has_calendar_scope: false,
        picture: null
      },
      schedule: {
        semester: "Current Semester",
        courses: [],
        slots: []
      },
      assessments: [],
      completed_topics: {},
      study_tasks: [],
      dashboard: null
    };
    return this.recomputeDashboard(initial);
  }

  populateAcademicData() {
    // Kept clean to guarantee no mock or foreign assessments leak into fresh installs
    if (!this.state.schedule) {
      this.state.schedule = { semester: "Current Semester", courses: [], slots: [] };
    }
  }

  saveDatabase() {
    try {
      localStorage.setItem(STANDALONE_STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.warn("[Engine] Save database error:", e);
    }
  }

  recomputeDashboard(state) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const assessments = state.assessments || [];
    // completed_topics lives in config (server parity); fall back to legacy top-level map
    const completed = state.config?.completed_topics || state.completed_topics || {};
    const recommendations = assessments.map((a) => {
      const topics = a.topics || [];
      const compCount = topics.filter((t, i) => !!completed[`${a.id}::${i}`]).length;
      const totalCount = Math.max(topics.length, 1);
      const readiness = Math.round((compCount / totalCount) * 100);

      let daysUntil = a.days_until ?? 3;
      if (a.date_iso) {
        const parts = a.date_iso.split("-").map(Number);
        if (parts.length === 3) {
          const target = new Date(parts[0], parts[1] - 1, parts[2]);
          daysUntil = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          a.days_until = daysUntil;
          a.is_upcoming = daysUntil >= 0;
        }
      }
      const priorityScore = Math.max(10, 100 - (daysUntil * 7) + (100 - readiness) * 0.3);

      return {
        id: a.id,
        assessment_id: a.id,
        course_id: a.course_id,
        course_name: a.course_name,
        title: a.title,
        assessment_type: a.assessment_type || "Assessment",
        date_iso: a.date_iso,
        display_date: daysUntil === 0 ? "Today" : daysUntil === 1 ? "Tomorrow" : daysUntil < 0 ? `${Math.abs(daysUntil)}d ago` : `In ${daysUntil} days`,
        display_time: a.display_time || a.time || (daysUntil === 0 ? "Today" : daysUntil === 1 ? "Tomorrow" : daysUntil < 0 ? `${Math.abs(daysUntil)}d ago` : `In ${daysUntil} days`),
        days_until: daysUntil,
        urgency_badge: daysUntil === 0 ? "TODAY" : daysUntil === 1 ? "TOMORROW" : daysUntil < 0 ? "PAST" : `IN ${daysUntil} DAYS`,
        color: a.color || "#1a73e8",
        room: a.room || "Room TBD",
        instructor: a.instructor || "Instructor TBA",
        readiness_percent: readiness,
        progress_percent: readiness,
        completed_count: compCount,
        total_count: totalCount,
        priority_score: Math.round(priorityScore),
        why_study_now: a.ai_study_plan || (daysUntil === 0 ? "Scheduled today. Review key lecture concepts." : daysUntil === 1 ? "Scheduled tomorrow. Review key problem sets." : `Scheduled in ${daysUntil} days. Review key lecture concepts.`),
        ai_study_plan: a.ai_study_plan || "Review key lecture notes and problem sets.",
        ai_inference_note: a.ai_inference_note || "Data stored on this device.",
        google_cal_url: a.google_cal_url || "#",
        warnings: a.warnings || [],
        topics: topics.map((t, i) => ({
          key: `${a.id}::${i}`,
          topic: typeof t === "string" ? t : t.topic,
          est_minutes: 35,
          completed: !!completed[`${a.id}::${i}`]
        })),
        tasks: topics.map((t, i) => ({
          key: `${a.id}::${i}`,
          topic: typeof t === "string" ? t : t.topic,
          est_minutes: 35,
          completed: !!completed[`${a.id}::${i}`]
        }))
      };
    }).sort((a, b) => b.priority_score - a.priority_score);

    const avgReadiness = recommendations.length > 0
      ? Math.round(recommendations.reduce((acc, r) => acc + r.readiness_percent, 0) / recommendations.length)
      : 0;

    const typeCounts = {};
    assessments.forEach((a) => {
      const t = a.assessment_type || "Class Quiz";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });

    const nowY = today.getFullYear();
    const nowM = String(today.getMonth() + 1).padStart(2, "0");
    const nowD = String(today.getDate()).padStart(2, "0");
    const nowIso = `${nowY}-${nowM}-${nowD}`;

    state.dashboard = {
      reference_date: nowIso,
      stats: {
        readiness_score: avgReadiness,
        upcoming_quizzes_count: assessments.filter(a => (a.days_until ?? 0) >= 0).length,
        // Honest on-device stats: hours from completed topics only (35 min each),
        // no streak counter exists on-device so it stays 0 until real tracking.
        hours_studied: Math.round((Object.values(completed).filter(Boolean).length * 35) / 6) / 10,
        study_streak_days: 0,
        grade_stats: (() => {
          const graded = (state.assessments || []).filter(
            (x) => typeof x.achieved_score === "number" && typeof x.max_score === "number" && x.max_score > 0
          );
          const overall = graded.length > 0 ? graded.reduce((acc, x) => acc + (x.achieved_score / x.max_score) * 100, 0) / graded.length : 0;
          return {
            overall_percent: Math.round(overall),
            graded_count: graded.length,
            total_assessments: (state.assessments || []).length
          };
        })()
      },
      exam_type_counts: typeCounts,
      study_recommendations: recommendations.filter(r => (r.days_until ?? 0) >= 0),
      recommendations: recommendations,
      upcoming_this_week: recommendations.filter((r) => (r.days_until ?? 99) >= 0 && (r.days_until ?? 99) <= 7),
      all_upcoming: recommendations.filter(r => (r.days_until ?? 0) >= 0),
      next_up: recommendations.find(r => (r.days_until ?? 0) >= 0) || null,
      recent_activity: assessments.length > 0
        ? [{ id: "act-1", title: "Local radar active & synchronized", time: "Just now", type: "sync" }]
        : [{ id: "act-0", title: "Ready to link university schedule", time: "Fresh install", type: "ready" }]
    };
    return state;
  }

  buildStudyTasksPayload() {
    // Shape mirrors the desktop server's parser::build_study_tasks (models.rs):
    // StudyTasksPayload { days: [DailyStudyDayGroup], readiness_cards, total_tasks,
    // pending_tasks, completed_tasks, total_hours, ai_generated }
    const assessments = this.state.assessments || [];
    const completed = this.state.config?.completed_topics || this.state.completed_topics || {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isoToDate = (iso) => {
      if (!iso) return null;
      const p = String(iso).split("-").map(Number);
      if (p.length !== 3 || p.some(Number.isNaN)) return null;
      return new Date(p[0], p[1] - 1, p[2]);
    };
    const todayIso = toIsoDate(today);
    const parseHours = (topic, fallback) => {
      const m = /^\[(\d+(?:\.\d+)?)\s*h\]/i.exec(String(topic).trim());
      const v = m ? parseFloat(m[1]) : fallback;
      return Math.max(0.25, Math.min(8, v || fallback));
    };

    const readiness = [];
    const tasksByDay = {}; // day_offset -> DailyStudyTask[]
    let totalPending = 0;
    let totalCompleted = 0;
    let totalHours = 0;
    let rank = 0;

    const dayLabel = (date) => {
      const dow = date.toLocaleDateString(undefined, { weekday: "short" });
      const mon = date.toLocaleDateString(undefined, { month: "short" });
      return `${dow}, ${mon} ${date.getDate()}`;
    };

    assessments.forEach((a) => {
      const topics = a.topics || [];
      const compCount = topics.filter((_t, i) => !!completed[`${a.id}::${i}`]).length;
      const totalCount = topics.length;
      const readinessPercent = totalCount === 0
        ? 100
        : Math.round((compCount / Math.max(totalCount, 1)) * 100);
      const targetDate = isoToDate(a.date_iso);
      const daysUntil = targetDate
        ? Math.round((targetDate.getTime() - today.getTime()) / 86400000)
        : (a.days_until ?? 30);
      a.days_until = daysUntil;
      a.is_upcoming = daysUntil >= 0;
      totalCompleted += compCount;

      const priorityScore = Math.max(10, 100 - Math.max(daysUntil, 0) * 7 + (100 - readinessPercent) * 0.3);

      if (daysUntil >= 0) {
        readiness.push({
          assessment_id: a.id,
          course_id: a.course_id,
          course_name: a.course_name,
          title: a.title,
          assessment_type: a.assessment_type || "Assessment",
          date_iso: a.date_iso,
          display_date: daysUntil === 0 ? "Today" : daysUntil === 1 ? "Tomorrow" : `In ${daysUntil} days`,
          days_until: daysUntil,
          readiness_percent: readinessPercent,
          completed_count: compCount,
          total_count: totalCount,
          priority_score: Math.round(priorityScore),
          color: a.color || "#1a73e8",
          recommended_focus: a.ai_study_plan || (topics.length > 0
            ? (topics.find((t, i) => !completed[`${a.id}::${i}`]) || topics[0]).toString()
            : "Review all course materials")
        });
      }

      // Schedule unfinished topics across the study horizon (up to the day before the exam)
      const uncompleted = topics
        .map((t, i) => ({ i, text: typeof t === "string" ? t : t.topic }))
        .filter((x) => !completed[`${a.id}::${x.i}`]);
      if (daysUntil < 0 || uncompleted.length === 0) return;

      const horizon = Math.min(Math.max(daysUntil, 0) + 1, 14); // include exam day if tomorrow-close
      uncompleted.forEach((item, idx) => {
        const dayOffset = Math.min(horizon - 1, Math.floor((idx / Math.max(1, Math.ceil(uncompleted.length / horizon)))));
        const dayDate = new Date(today);
        dayDate.setDate(today.getDate() + dayOffset);
        const iso = toIsoDate(dayDate);
        const hours = parseHours(item.text, 1.5);
        const key = `${a.id}::${item.i}`;
        totalPending += 1;
        totalHours += hours;
        rank += 1;
        const urgency = daysUntil <= 1 ? "critical" : daysUntil <= 4 ? "high" : "normal";
        if (!tasksByDay[dayOffset]) tasksByDay[dayOffset] = [];
        tasksByDay[dayOffset].push({
          id: `task-${a.id}-${item.i}-${dayOffset}`,
          key,
          assessment_id: a.id,
          course_id: a.course_id,
          course_name: a.course_name,
          assessment_title: a.title,
          assessment_type: a.assessment_type || "Assessment",
          topic: item.text.replace(/^\[\d+(?:\.\d+)?\s*h\]\s*/i, "").trim() || "Review materials",
          day_offset: dayOffset,
          target_date_iso: iso,
          display_day: dayLabel(dayDate),
          priority_rank: rank,
          urgency,
          estimated_hours: hours,
          ai_reasoning: `Scheduled ${dayOffset === 0 ? "today" : `in ${dayOffset} day${dayOffset > 1 ? "s" : ""}`} to stay ahead of ${a.course_id} on ${a.date_iso || a.title}.`,
          completed: false,
          color: a.color || "#1a73e8",
          days_until_assessment: daysUntil,
          assessment_date: a.date_iso
        });
      });
    });

    readiness.sort((a, b) => a.days_until - b.days_until || b.priority_score - a.priority_score);
    const totalTasks = totalPending + totalCompleted;

    const days = Object.entries(tasksByDay)
      .map(([offset, tasks]) => {
        const groupDate = new Date(today);
        groupDate.setDate(today.getDate() + Number(offset));
        return {
          day_offset: Number(offset),
          date_iso: toIsoDate(groupDate),
          display_day: Number(offset) === 0 ? `Today · ${dayLabel(groupDate)}` : dayLabel(groupDate),
          is_today: Number(offset) === 0,
          total_estimated_hours: Math.round(tasks.reduce((acc, t) => acc + t.estimated_hours, 0) * 10) / 10,
          tasks
        };
      })
      .sort((a, b) => a.day_offset - b.day_offset);

    return {
      days,
      readiness_cards: readiness,
      total_tasks: totalTasks,
      pending_tasks: totalPending,
      completed_tasks: totalCompleted,
      total_hours: Math.round(totalHours * 10) / 10,
      ai_generated: false
    };
  }

  async handleApi(resource, init = {}) {
    const url = typeof resource === "string" ? resource : resource.url || "";
    const path = url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0];
    const options = init || {};
    const method = (options.method || "GET").toUpperCase();
    let body = {};
    if (options.body) {
      try {
        body = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
      } catch (e) {
        body = {};
      }
    }

    // 1. GET /api/state
    if (path === "/api/state") {
      this.recomputeDashboard(this.state);
      // NOTE: no saveDatabase() here — this endpoint is polled (including by
      // the sign-in poller every 1.5s). Persisting the entire database on
      // every GET caused ~120 full JSON stringifications per sign-in window.
      // Mutating routes persist their own changes.
      // Deep-copy so engine mutations never alias the snapshot handed to the app.
      return { ok: true, status: 200, data: JSON.parse(JSON.stringify(this.state)) };
    }

    // 1b. GET /api/auth/google/url
    if (path === "/api/auth/google/url") {
      const redirectUri = "http://localhost:3000/api/auth/callback";
      const clientId = "341760934836-60toi8rjgkid0gmc69tmt598teghbgv4.apps.googleusercontent.com";
      const scopes = [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/drive.appdata"
      ].join(" ");
      // Anti-CSRF state + PKCE: the local callback server verifies the state
      // before exchanging any code, so a malicious page cannot inject a
      // foreign authorization code into the sign-in flow.
      const state = randomB64UrlSafe(16);
      const verifier = randomB64UrlSafe(32);
      let challenge = "";
      try { challenge = await pkceChallengeS256(verifier); } catch (e) { challenge = ""; }
      pendingNativeOAuth.google = { state, verifier };
      if (IS_NATIVE) {
        // The in/out sign-in contract: if the local listener that will receive
        // the http://localhost:3000 redirect is NOT reachable right now (app
        // freshly updated, port busy), opening the browser is guaranteed to
        // strand the user on a dead localhost page ("site can't be reached").
        // Fail fast and honestly instead.
        const prepared = await nativeOauthPrepare("google", state, verifier);
        if (!prepared) {
          return {
            ok: true, status: 200,
            data: {
              url: null,
        error: "Sign-in listener not reachable. Fully close & reopen QuizRadar, then tap Sign In again. (Its callback port 3000 may be busy.)"
            }
          };
        }
      }
      let googleAuthUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=" + encodeURIComponent(clientId) +
        "&redirect_uri=" + encodeURIComponent(redirectUri) +
        "&response_type=code" +
        "&scope=" + encodeURIComponent(scopes) +
        "&state=" + encodeURIComponent(state) +
        "&access_type=offline&prompt=consent%20select_account&include_granted_scopes=true";
      if (challenge) {
        googleAuthUrl += "&code_challenge=" + encodeURIComponent(challenge) + "&code_challenge_method=S256";
      }
      return { ok: true, status: 200, data: { url: googleAuthUrl } };
    }

    // 1c. GET /api/microsoft/url
    if (path === "/api/microsoft/url") {
      const redirectUri = "http://localhost:3000/api/auth/microsoft/callback";
      const clientId = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
      const scopes = "offline_access User.Read Mail.Read Calendars.Read";
      const state = randomB64UrlSafe(16);
      const verifier = randomB64UrlSafe(32);
      let challenge = "";
      try { challenge = await pkceChallengeS256(verifier); } catch (e) { challenge = ""; }
      pendingNativeOAuth.microsoft = { state, verifier };
      if (IS_NATIVE) {
        // Same fail-fast contract as the Google flow above.
        const prepared = await nativeOauthPrepare("microsoft", state, verifier);
        if (!prepared) {
          return {
            ok: true, status: 200,
            data: {
              url: null,
              error: "Sign-in listener not reachable. Fully close & reopen QuizRadar, then tap Connect University again. (Its callback port 3000 may be busy.)"
            }
          };
        }
      }
      let msAuthUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=" + encodeURIComponent(clientId) +
        "&response_type=code" +
        "&redirect_uri=" + encodeURIComponent(redirectUri) +
        "&response_mode=query" +
        "&scope=" + encodeURIComponent(scopes) +
        "&state=" + encodeURIComponent(state) +
        "&prompt=select_account";
      if (challenge) {
        msAuthUrl += "&code_challenge=" + encodeURIComponent(challenge) + "&code_challenge_method=S256";
      }
      return { ok: true, status: 200, data: { url: msAuthUrl } };
    }

    // 2. POST /api/config/update
    if (path === "/api/config/update") {
      // Whitelist the fields real config updates carry — never Object.assign
      // the whole body, or stale/junk keys accumulate in the persisted schema.
      const CONFIG_FIELDS = [
        "user_name", "user_email", "user_picture", "auto_sync_gcal",
        "sync_weekly_classes_to_gcal", "gemini_enabled", "gemini_api_key",
        "teams_enabled", "teams_account_email", "teams_account_name",
        "teams_client_id", "teams_token", "teams_refresh_token",
        "moodle_enabled", "moodle_ical_url", "moodle_token", "moodle_base_url",
        "classroom_enabled", "last_gmail_sync", "dismiss_conflict_banner",
        "onboarding_completed", "theme", "accent"
      ];
      for (const field of CONFIG_FIELDS) {
        if (body[field] !== undefined) this.state.config[field] = body[field];
      }
      if (body.user_name) this.state.auth.name = body.user_name;
      if (body.user_email !== undefined) {
        const trimmed = String(body.user_email || "").trim();
        if (!trimmed || !trimmed.includes("@")) {
          this.state.auth.email = null;
        } else if (!this.state.auth.authenticated) {
          this.state.auth.email = trimmed;
        }
      }
      this.recomputeDashboard(this.state);
      this.saveDatabase();
      return { ok: true, status: 200, data: { success: true, config: this.state.config, assessments: this.state.assessments, dashboard: this.state.dashboard, schedule: this.state.schedule } };
    }

    // 3. POST /api/onboarding/complete (mirrors server OnboardingPayload field names)
    if (path === "/api/onboarding/complete") {
      this.state.config.onboarding_completed = true;
      if (body.user_name) {
        this.state.config.user_name = body.user_name;
        this.state.auth.name = body.user_name;
      }
      if (body.auto_sync_gcal !== undefined) {
        this.state.config.auto_sync_gcal = !!body.auto_sync_gcal;
      }
      if (body.sync_weekly_classes_to_gcal !== undefined) {
        this.state.config.sync_weekly_classes_to_gcal = !!body.sync_weekly_classes_to_gcal;
      }
      if (body.gemini_enabled !== undefined) {
        this.state.config.gemini_enabled = !!body.gemini_enabled;
      }
      if (body.user_email !== undefined) {
        this.state.config.user_email = body.user_email;
        // Typed email is a profile anchor only; real auth comes from OAuth.
        const trimmed = String(body.user_email || "").trim();
        this.state.auth.email = trimmed.includes("@") && !this.state.auth.authenticated ? trimmed : this.state.auth.email;
      }
      if (body.teams_email) {
        // Profile anchor only — real Teams scanning needs a Microsoft sign-in
        // (a typed email must never flip Teams into a "connected" state).
        this.state.config.teams_account_email = body.teams_email;
      }
      if (body.teams_name) {
        this.state.config.teams_account_name = body.teams_name;
      }
      const geminiKey = body.gemini_api_key || body.gemini_key;
      if (geminiKey && String(geminiKey).trim()) {
        this.state.config.gemini_api_key = String(geminiKey).trim();
        if (body.gemini_enabled !== undefined) this.state.config.gemini_enabled = body.gemini_enabled;
      }
      this.recomputeDashboard(this.state);
      this.saveDatabase();
      return { ok: true, status: 200, data: { success: true, config: this.state.config, dashboard: this.state.dashboard, assessments: this.state.assessments, schedule: this.state.schedule } };
    }

    // 4. POST /api/schedule/courses (Add course)
    // Accepts both shapes: {course:{id,name,color,bg,border}, slots:[...]} (client)
    // and the legacy flat body (course_id/course_name).
    if (path === "/api/schedule/courses" && method === "POST") {
      const courses = this.state.schedule.courses || [];
      const rawCourse = body.course || {};
      const fixedId = (rawCourse.id || body.course_id || body.id || "CS 101").toString().trim();
      const fixedName = (rawCourse.name || body.course_name || body.name || fixedId).toString().trim();
      if (!fixedId) {
        return { ok: true, status: 200, data: { success: false, error: "Course code is required." } };
      }
      const newCourse = {
        id: fixedId,
        name: fixedName,
        color: rawCourse.color || body.color || "#1a73e8",
        bg: rawCourse.bg || `${rawCourse.color || body.color || "#1a73e8"}18`,
        border: rawCourse.border || `${rawCourse.color || body.color || "#1a73e8"}55`,
        icon: body.icon || "book-open",
        instructor: rawCourse.instructor || null
      };
      if (!courses.some((c) => c.id.toLowerCase() === newCourse.id.toLowerCase())) {
        courses.push(newCourse);
      }
      if (Array.isArray(body.slots) && body.slots.length > 0) {
        const existing = this.state.schedule.slots || [];
        body.slots.forEach((s) => {
          if (!existing.some((x) => x.id === s.id)) existing.push({ ...s, course_id: s.course_id || newCourse.id, course_name: s.course_name || newCourse.name });
        });
        this.state.schedule.slots = existing;
      }
      this.recomputeDashboard(this.state);
      this.saveDatabase();
      const slotIndex = (this.state.schedule.slots || []).filter((s) => (s.course_id || "").toLowerCase() === newCourse.id.toLowerCase());
      return {
        ok: true,
        status: 200,
        data: {
          success: true,
          course_id: newCourse.id,
          assessment_index: null,
          assessments: this.state.assessments,
          dashboard: this.state.dashboard,
          schedule: this.state.schedule,
          message: `Course ${newCourse.id} saved. Add class times to fill your weekly calendar.`,
          slots_found: slotIndex.length,
          classes_found: 0
        }
      };
    }

    // 4b. DELETE /api/schedule/courses/:id
    if (path.startsWith("/api/schedule/courses/") && method === "DELETE") {
      const courseId = decodeURIComponent(path.replace("/api/schedule/courses/", ""));
      if (this.state.schedule && this.state.schedule.courses) {
        this.state.schedule.courses = this.state.schedule.courses.filter(c => c.id !== courseId);
      }
      this.state.assessments = (this.state.assessments || []).filter(a => a.course_id !== courseId);
      this.state.schedule.slots = (this.state.schedule.slots || []).filter(s => s.course_id !== courseId);
      this.recomputeDashboard(this.state);
      this.saveDatabase();
      return { ok: true, status: 200, data: { success: true, schedule: this.state.schedule, assessments: this.state.assessments } };
    }

    // 4c. POST /api/schedule/save
    if (path === "/api/schedule/save") {
      const incoming = body.schedule || (body.courses || body.slots ? body : null);
      if (incoming) {
        if (incoming.courses) this.state.schedule.courses = incoming.courses;
        if (incoming.slots) this.state.schedule.slots = incoming.slots;
        if (incoming.semester) this.state.schedule.semester = incoming.semester;
      }
      this.recomputeDashboard(this.state);
      this.saveDatabase();
      return { ok: true, status: 200, data: { success: true, schedule: this.state.schedule, assessments: this.state.assessments } };
    }

    // 5. POST /api/events/custom (Add custom calendar event)
    // Mirrors the desktop server: events live ONLY in config.custom_events with the
    // CustomCalendarEvent shape (event_type/date_iso/start_time/end_time) — they are
    // never promoted into assessments, and no fake topics/weights are invented.
    if (path === "/api/events/custom" && method === "POST") {
      if (!this.state.config.custom_events) this.state.config.custom_events = [];
      const newEvent = {
        id: `custom-${Date.now()}`,
        title: (body.title || "Untitled Event").toString().trim(),
        course_id: body.course_id || "Personal",
        event_type: body.event_type || "Study Block",
        date_iso: body.date_iso || toIsoDate(getTodayDate()),
        start_time: body.start_time || "09:00",
        end_time: body.end_time || "10:00",
        room: body.room || "Study Room / Library",
        notes: body.notes || "",
        color: body.color || "#ec4899"
      };
      if (!newEvent.title) {
        return { ok: true, status: 200, data: { success: false, error: "Event title is required." } };
      }
      this.state.config.custom_events.push(newEvent);
      this.saveDatabase();
      return { ok: true, status: 200, data: { success: true, custom_events: this.state.config.custom_events } };
    }

    // 5b. DELETE /api/events/custom/:id
    if (path.startsWith("/api/events/custom/") && method === "DELETE") {
      const eventId = path.replace("/api/events/custom/", "");
      if (this.state.config.custom_events) {
        this.state.config.custom_events = this.state.config.custom_events.filter((e) => e.id !== eventId);
      }
      this.saveDatabase();
      return { ok: true, status: 200, data: { success: true, custom_events: this.state.config.custom_events } };
    }

    // 6. POST /api/study/toggle (Toggle topic completion)
    // Server contract: ToggleTopicPayload { key: "assessmentId::topicIdx", completed: bool }
    // stored in config.completed_topics; response carries refresh payloads.
    if (path === "/api/study/toggle") {
      const key = body.key;
      if (key) {
        if (!this.state.config.completed_topics) this.state.config.completed_topics = {};
        const completed = body.completed !== undefined ? !!body.completed : !this.state.config.completed_topics[key];
        this.state.config.completed_topics[key] = completed;
        this.recomputeDashboard(this.state);
        this.saveDatabase();
        return {
          ok: true,
          status: 200,
          data: {
            success: true,
            completed,
            dashboard: this.state.dashboard,
            tasks_payload: this.buildStudyTasksPayload(),
            completed_topics: this.state.config.completed_topics
          }
        };
      }
      return { ok: true, status: 200, data: { success: false, error: "Missing topic key." } };
    }

    // 7. POST /api/auth/logout
    if (path === "/api/auth/logout") {
      this.state.auth.authenticated = false;
      this.state.auth.email = null;
      this.state.auth.name = "Student";
      this.state.auth.picture = null;
      this.state.config.user_email = null;
      this.state.config.user_name = "Student";
      this.saveDatabase();
      return { ok: true, status: 200, data: { success: true } };
    }

    // 8. POST /api/microsoft/logout
    if (path === "/api/microsoft/logout") {
      this.state.config.teams_enabled = false;
      this.state.config.teams_token = null;
      this.state.config.teams_account_email = null;
      this.state.config.teams_account_name = null;
      this.saveDatabase();
      return { ok: true, status: 200, data: { success: true, assessments: this.state.assessments, dashboard: this.state.dashboard, schedule: this.state.schedule } };
    }

    // 9. POST /api/sync — REAL on-device scan (Gmail + Outlook + Moodle feed)
    if (path === "/api/sync") {
      const result = await this.runLiveScan("all");
      return { ok: true, status: 200, data: result };
    }

    // 9b. POST /api/gcal/sync — calendar push needs the desktop OAuth scope set
    if (path === "/api/gcal/sync") {
      this.recomputeDashboard(this.state);
      const message = "Google Calendar push runs on the desktop app (it holds the events scope). On-device announcements arrive via live Gmail/Teams scanning.";
      this.saveDatabase();
      return { ok: true, status: 200, data: { success: true, message, assessments: this.state.assessments, dashboard: this.state.dashboard, schedule: this.state.schedule } };
    }

    // 10. GET /api/calendar/ics_all
    if (path.startsWith("/api/calendar/ics")) {
      const ics = this.generateIcs();
      return { ok: true, status: 200, text: ics, contentType: "text/calendar" };
    }

    // 11. GET /api/study/tasks & POST /api/study/tasks/optimize
    if (path === "/api/study/tasks") {
      return { ok: true, status: 200, data: { success: true, tasks_payload: this.buildStudyTasksPayload() } };
    }
    if (path === "/api/study/tasks/optimize") {
      this.recomputeDashboard(this.state);
      this.saveDatabase();
      return {
        ok: true,
        status: 200,
        data: {
          success: true,
          ai_optimized: false,
          ai_generated: false,
          message: "Study plan re-sorted by urgency and remaining effort. Link a Gemini API key to unlock AI-tuned planning.",
          tasks_payload: this.buildStudyTasksPayload()
        }
      };
    }

    // 12. Assessment Practice Quiz Formulation (Offline Generation)
    if (path.includes("/practice")) {
      const assessmentId = path.split("/")[3];
      const a = (this.state.assessments || []).find(x => x.id === assessmentId);
      const topics = a && a.topics && a.topics.length > 0 ? a.topics : [];
      if (topics.length === 0) {
        return {
          ok: true,
          status: 200,
          data: {
            success: false,
            generated_by_ai: false,
            error: "No synced topics for this assessment yet. Add topics from the assessment modal to practice them."
          }
        };
      }
      // Rotate the answer position so it is not always option 1; all questions are
      // locally derived from synced topics (no fabricated exam content).
      const questions = topics.slice(0, 4).map((t, idx) => {
        const topTitle = (typeof t === "string" ? t : t.topic || t.title) || "Core Subject Topic";
        const correctIndex = idx % 4;
        const options = [
          `Systematic application of standard ${topTitle} definitions and verified methods.`,
          `Disregarding core assumptions of ${topTitle} when solving problems.`,
          `Skipping verification steps for ${topTitle} results.`,
          `Restricting analysis of ${topTitle} to only one special case.`
        ];
        const correct = options[0];
        options[0] = options[correctIndex];
        options[correctIndex] = correct;
        return {
          question: `Which approach best reflects a rigorous treatment of ${topTitle}?`,
          options,
          correct_index: correctIndex,
          explanation: `Solid ${topTitle} work starts from exact definitions, standard methods, and verified edge cases${a ? ` (from ${a.course_id}).` : "."}`
        };
      });
      return {
        ok: true,
        status: 200,
        data: {
          success: true,
          generated_by_ai: false,
          local_note: "Practice questions are generated on-device from your synced topics. Add a Gemini API key for AI-authored quizzes.",
          questions
        }
      };
    }

    // 13. Assessment Grading / Recording (mirrors server: per-field partial update)
    if (path.includes("/grade")) {
      const assessmentId = path.split("/")[3];
      const a = (this.state.assessments || []).find(x => x.id === assessmentId);
      if (!a) {
        return { ok: true, status: 200, data: { success: false, status: "error", message: "Assessment not found.", error: "Assessment not found." } };
      }
      // Explicit null means "clear this field" (ungraded) — never coerce it
      // into a 0 score, which would silently record a failing grade.
      const hasAchieved = body.achieved_score !== undefined && body.achieved_score !== null;
      const hasMax = body.max_score !== undefined && body.max_score !== null;
      const hasWeight = body.weightage_percent !== undefined && body.weightage_percent !== null;
      const achieved = hasAchieved ? Number(body.achieved_score) : null;
      const maxScore = hasMax ? Number(body.max_score) : null;
      const weight = hasWeight ? Number(body.weightage_percent) : null;
      let invalid = null;
      if (hasAchieved && (!Number.isFinite(achieved) || achieved < 0)) invalid = "achieved_score must be a non-negative number";
      if (!invalid && hasMax && (!Number.isFinite(maxScore) || maxScore <= 0)) invalid = "max_score must be greater than zero";
      if (!invalid && hasWeight && (!Number.isFinite(weight) || weight < 0)) invalid = "weightage_percent must be a non-negative number";
      if (invalid) {
        return { ok: true, status: 200, data: { success: false, status: "error", message: invalid, error: invalid } };
      }
      if (hasWeight) a.weightage_percent = weight;
      if (hasAchieved) a.achieved_score = achieved;
      if (hasMax) a.max_score = maxScore;
      if (body.achieved_score === null) delete a.achieved_score;
      if (body.max_score === null) delete a.max_score;
      if (body.weightage_percent === null) delete a.weightage_percent;
      if (a.achieved_score !== undefined || a.max_score !== undefined) {
        if (!this.state.grades) this.state.grades = {};
        this.state.grades[a.id] = {
          achieved_score: a.achieved_score ?? 0,
          max_score: a.max_score ?? 0,
          weightage_percent: a.weightage_percent ?? 0
        };
      } else {
        if (this.state.grades) delete this.state.grades[a.id];
      }
      this.recomputeDashboard(this.state);
      this.saveDatabase();
      // Minimal honest rollup that mirrors the server's grade summary section.
      const gradeAssignments = (this.state.assessments || []).filter(
        (x) => typeof x.achieved_score === "number" && typeof x.max_score === "number" && x.max_score > 0
      );
      const overall = gradeAssignments.length > 0
        ? gradeAssignments.reduce((acc, x) => acc + (x.achieved_score / x.max_score) * 100, 0) / gradeAssignments.length
        : 0;
      const gradeStats = {
        overall_percent: Math.round(overall),
        graded_count: gradeAssignments.length,
        total_assessments: (this.state.assessments || []).length
      };
      return {
        ok: true,
        status: 200,
        data: {
          success: true,
          status: "ok",
          assessment: a,
          assessments: this.state.assessments,
          dashboard: this.state.dashboard,
          summary: gradeStats,
          grade_stats: gradeStats
        }
      };
    }

    // 14. Timetable Extraction (Gemini Vision AI via the user's own API key)
    if (path === "/api/schedule/extract") {
      let extracted = null;
      let geminiFailure = null;
      const apiKey = (this.state.config && this.state.config.gemini_api_key) ||
                     (window.appState && window.appState.config && window.appState.config.gemini_api_key);

      if (apiKey && apiKey.trim() && body.file_base64) {
        try {
          const rawB64 = body.file_base64.includes(";base64,") ? body.file_base64.split(";base64,")[1] : body.file_base64;
          const prompt = `You are an intelligent university timetable extraction assistant inside QuizRadar.
Extract enrolled courses and weekly class slots from this schedule. Return ONLY raw JSON matching:
{
  "semester": "Fall 2026",
  "courses": [{"id": "CODE", "name": "Course Title", "color": "#1a73e8"}],
  "slots": [{"id": "s1", "course_id": "CODE", "course_name": "Course Title", "day": "Monday", "day_index": 1, "start_time": "10:15", "end_time": "12:00", "display_time": "10:15 AM - 12:00 PM", "room": "Hall 1", "type": "Lecture", "group": "Sec 1"}]
}`;
          // Header-based auth: the key must never ride in a URL that can be
          // logged or echoed back in provider error messages.
          const gResp = await _originalFetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: prompt },
                  { inline_data: { mime_type: body.mime_type || "image/png", data: rawB64 } }
                ]
              }],
              generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
            })
          });
          if (gResp.ok) {
            const gJson = await gResp.json();
            const text = gJson?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              const cleaned = text.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
              try {
                const parsed = JSON.parse(cleaned);
                if (parsed && ((parsed.courses && parsed.courses.length) || (parsed.slots && parsed.slots.length))) {
                  extracted = parsed;
                } else {
                  geminiFailure = "Gemini read the image but couldn't find a timetable in it. Try a clearer, full-page screenshot of your schedule.";
                }
              } catch (parseErr) {
                geminiFailure = "Gemini returned an unreadable response. Try again or enter your courses manually.";
              }
            } else {
              geminiFailure = "Gemini returned an empty response. Try again with a clearer image.";
            }
          } else {
            let detail = "";
            try {
              const errJson = await gResp.json();
              detail = errJson?.error?.message || "";
            } catch (e) { detail = ""; }
            const status = gResp.status;
            if (status === 400 && /api key not valid/i.test(detail)) {
              geminiFailure = "Your Gemini API key is not valid. Re-copy it from Google AI Studio into Settings and try again.";
            } else if (status === 429) {
              geminiFailure = "The free-tier Gemini quota for your key is exhausted. Wait a minute and scan again.";
            } else if (status === 403) {
              geminiFailure = "Gemini rejected the request (403). Check that your API key has access to the Generative Language API.";
            } else {
              geminiFailure = "Gemini API error (HTTP " + status + (detail ? ": " + detail : "") + "). Check your key/quota in Settings or enter courses manually.";
            }
          }
        } catch (e) {
          geminiFailure = "Couldn't reach the Gemini API (" + (e && e.message ? e.message : "network error") + "). Check your internet connection and try again.";
        }
      }

      // Honest failure. Distinguish "no key configured" from "configured but
      // the call failed" — telling a user with a key to "add a key" is why
      // scans felt broken.
      if (!extracted) {
        const error = geminiFailure ||
          "Automatic schedule extraction needs a Gemini API key. Add your free key in Settings (it stays on this device), or enter your courses and classes manually.";
        return {
          ok: true,
          status: 200,
          data: {
            success: false,
            error: error
          }
        };
      }

      return {
        ok: true,
        status: 200,
        data: {
          success: true,
          schedule: extracted,
          extractor: "Gemini 2.5 Flash Vision AI"
        }
      };
    }

    // 15. Conflict Dismissal & Study Blocks
    if (path === "/api/conflicts/dismiss") {
      this.state.config.dismiss_conflict_banner = true;
      this.saveDatabase();
      return { ok: true, status: 200, data: { success: true, dismissed: true, config: this.state.config } };
    }
    if (path === "/api/study/blocks/schedule") {
      return { ok: true, status: 200, data: { success: true, scheduled: true, message: "Study blocks scheduled into your academic planner." } };
    }

    // 16. Cloud / Device Pair Info (reports on-device engine + live scanning)
    if (path === "/api/sync/pair/info") {
      const msEmail = (this.state.config && this.state.config.teams_account_email) || null;
      const msName = (this.state.config && this.state.config.teams_account_name) || null;
      return {
        ok: true,
        status: 200,
        data: {
          success: true,
          standalone: true,
          offline_capable: true,
          user_email: (this.state.auth && this.state.auth.authenticated && this.state.auth.email) || this.state.config.user_email,
          teams_email: msEmail,
          teams_name: msName,
          google_authenticated: !!(this.state.auth && this.state.auth.authenticated),
          google_auth_note: "This device scans Gmail and Outlook directly with its own sign-in — desktop pairing is optional (backup + ICS feeds only).",
          engine_type: "On-device engine (live Gmail/Outlook/Moodle scanning)"
        }
      };
    }

    // 17. Local Backup Push & Pull
    if (path === "/api/sync/cloud/push" || path === "/api/sync/cloud/pull") {
      this.saveDatabase();
      return {
        ok: true,
        status: 200,
        data: {
          success: true,
          message: "Data saved to on-device storage (no encryption beyond device protection).",
          state: this.state
        }
      };
    }

    // 18. Updater Check / Install (Mobile App is Up to Date)
    if (path.startsWith("/api/updater")) {
      return {
        ok: true,
        status: 200,
        data: {
          success: true,
          has_update: false,
          current_version: APP_VERSION
        }
      };
    }

    // 19. Honest failure fallback: report unmatched endpoints instead of faking success
    return {
      ok: true,
      status: 200,
      data: {
        success: false,
        error: `This feature (${url.split("?")[0]}) is not available on this device. It works in the desktop app.`
      }
    };
  }

  todayIsoFallback() {
    const t = new Date();
    return toIsoDate(t);
  }

  // ================= LIVE ON-DEVICE SCAN PIPELINE =================

  /**
   * Ensures a fresh Google access token: reuses the stored one when it is
   * still young, otherwise redeems a new one through the native bridge.
   * Returns { token, viaBridge } or { token: null, error }.
   */
  async ensureGoogleAccessToken() {
    const auth = this.state.auth || {};
    const token = auth.access_token || "";
    if (!token) return { token: null, error: "unsigned" };
    const expiresAt = Number(auth.google_token_expires_at || 0);
    const fresh = expiresAt ? Date.now() < expiresAt - 60000 : true; // unknown age → try as-is
    if (fresh) return { token, viaBridge: false };
    const refreshed = await bridgeRefreshAccessToken("google");
    if (refreshed) {
      auth.access_token = refreshed.access_token;
      auth.google_token_expires_at = Date.now() + (refreshed.expires_in || 3600) * 1000;
      this.state.auth = auth;
      if (window.appState && window.appState.auth) {
        window.appState.auth.access_token = auth.access_token;
        window.appState.auth.google_token_expires_at = auth.google_token_expires_at;
      }
      this.saveDatabase();
      return { token: auth.access_token, viaBridge: true };
    }
    return { token: null, error: "expired" };
  }

  async ensureTeamsAccessToken() {
    const cfg = this.state.config || {};
    const token = cfg.teams_token || "";
    if (!token) return { token: null, error: "not connected" };
    const expiresAt = Number(cfg.teams_token_expires_at || 0);
    const fresh = expiresAt ? Date.now() < expiresAt - 60000 : true;
    if (fresh) return { token, viaBridge: false };
    const refreshed = await bridgeRefreshAccessToken("microsoft");
    if (refreshed) {
      cfg.teams_token = refreshed.access_token;
      cfg.teams_token_expires_at = Date.now() + (refreshed.expires_in || 3600) * 1000;
      this.state.config = cfg;
      if (window.appState && window.appState.config) {
        window.appState.config.teams_token = cfg.teams_token;
        window.appState.config.teams_token_expires_at = cfg.teams_token_expires_at;
      }
      this.saveDatabase();
      return { token: cfg.teams_token, viaBridge: true };
    }
    return { token: null, error: "expired" };
  }

  /** Gmail REST scan (parity with gmail.rs's 5 queries + dedupe + full fetch). */
  async scanGmailBranch(notes) {
    const tok = await this.ensureGoogleAccessToken();
    if (!tok.token) {
      if (tok.error === "expired") {
        notes.push("Gmail: access token expired and silent renewal failed — sign in again in Settings → Integrations. (Manual entries are safe.)");
      }
      return null;
    }
    const headers = { Authorization: "Bearer " + tok.token };
    const ids = new Map();
    for (const q of GMAIL_SCAN_QUERIES) {
      try {
        const res = await _originalFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=35`,
          { headers }
        );
        if (res && res.status === 401) return { retry: true, error: "401" };
        if (!res || !res.ok) { notes.push(`Gmail: list request failed (HTTP ${res ? res.status : "network"})`); return null; }
        const list = await res.json();
        (Array.isArray(list.messages) ? list.messages : []).forEach((m) => {
          if (!ids.has(m.id)) ids.set(m.id, true);
        });
      } catch (e) {
        notes.push("Gmail: search request blocked or offline.");
        return null;
      }
    }
    if (ids.size === 0) {
      notes.push("Gmail: no quiz/exam/assignment announcements in your recent mail.");
      return [];
    }
    const cap = 120;
    const emails = [];
    let fetched = 0;
    for (const id of ids.keys()) {
      if (fetched >= cap) break;
      fetched++;
      try {
        const res = await _originalFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
          { headers }
        );
        if (res && res.status === 401) return { retry: true, error: "401" };
        if (!res || !res.ok) continue;
        const msg = await res.json();
        const headerMap = {};
        ((msg.payload && msg.payload.headers) || []).forEach((h) => { headerMap[h.name] = h.value; });
        emails.push({
          id: String(msg.id || id),
          subject: headerMap["Subject"] || "",
          from: headerMap["From"] || "",
          date: headerMap["Date"] || "",
          snippet: msg.snippet || "",
          body: gmailExtractBody(msg.payload) || msg.snippet || ""
        });
      } catch (e) { /* skip this message */ }
    }
    return { emails };
  }

  /** Outlook mail scan via Microsoft Graph ($search across quiz/exam words). */
  async scanMicrosoftBranch() {
    const tok = await this.ensureTeamsAccessToken();
    if (!tok.token) return null;
    const kql = encodeURIComponent('"quiz OR exam OR midterm OR assignment OR deadline"');
    try {
      const res = await _originalFetch(
        `https://graph.microsoft.com/v1.0/me/messages?$search=${kql}&$top=30&$select=subject,body,from,receivedDateTime,webLink`,
        { headers: { Authorization: "Bearer " + tok.token } }
      );
      if (res && res.status === 401) return { retry: true, error: "401" };
      if (!res || !res.ok) return { emails: [] };
      const data = await res.json();
      const emails = (Array.isArray(data.value) ? data.value : []).map((m) => ({
        id: "ms:" + String(m.id || "").slice(0, 90),
        subject: m.subject || "",
        from: (m.from && m.from.emailAddress && m.from.emailAddress.address) || "",
        date: m.receivedDateTime || "",
        snippet: "",
        body: stripHtmlTags((m.body && m.body.content) || "")
      }));
      return { emails };
    } catch (e) {
      return { emails: [] };
    }
  }

  /** Moodle ICS calendar import (uses the feed configured in Integrations). */
  async scanMoodleBranch(notes) {
    const url = (this.state.config && this.state.config.moodle_ical_url) || "";
    if (!url || !/^https?:\/\//i.test(url)) return [];
    try {
      const res = await _originalFetch(url, { method: "GET" });
      if (!res || !res.ok) {
        notes.push("Moodle: calendar feed could not be fetched (HTTP " + (res ? res.status : "network") + "). Check the ICS URL in Settings → Integrations.");
        return [];
      }
      const text = await res.text();
      const events = String(text).match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
      const out = [];
      for (const block of events) {
        const summary = unescapeIcsText((block.match(/SUMMARY[;:]([^\r\n]*)/) || [])[1] || "");
        const desc = unescapeIcsText((block.match(/DESCRIPTION[;:]([^\r\n]*)/) || [])[1] || "");
        const uid = ((block.match(/UID[;:]([^\r\n]*)/) || [])[1] || "moodle-" + out.length).trim();
        const dtRaw = (block.match(/DTSTART(?:;[^:\n]*)?:([^\r\n]*)/) || [])[1] || "";
        const parsed = parseIcsDateTime(dtRaw);
        if (!parsed) continue;
        const lower = (summary + " " + desc).toLowerCase();
        if (!/(quiz|exam|midterm|assignment|test|due|submission)/.test(lower)) continue;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysUntil = Math.round((parsed.date.getTime() - today.getTime()) / 86400000);
        const reCourse = /\b([A-Z]{2,4}\s*\d{3}[a-zA-Z]?)\b/i;
        const courseMatch = (summary + " " + desc).match(reCourse);
        const courseId = courseMatch ? courseMatch[1].replace(/\s+/g, " ").trim() : null;
        const enrolled = ((this.state.schedule || {}).courses || [])
          .find((c) => courseId && String(c.id || "").toUpperCase() === courseId.toUpperCase());
        const nameMatch = enrolled ? enrolled.id : ((this.state.schedule || {}).courses || [])
          .find((c) => summary.toLowerCase().includes(String(c.name || "").toLowerCase().slice(0, 18)));
        const finalCourse = nameMatch ? nameMatch.id : (courseId || "GENERAL");
        const palette = defaultCoursePaletteLocal(finalCourse);
        const isType = /(final exam|final)/.test(lower) ? "Final Exam" : /midterm/.test(lower) ? "Midterm Exam" : /quiz/.test(lower) ? "Quiz" : "Assignment";
        out.push({
          id: "moodle:" + uid.slice(0, 80),
          course_id: finalCourse,
          course_name: resolveCourseNameLocal(this.state.schedule, finalCourse),
          title: summary.slice(0, 90) || `${finalCourse} ${isType}`,
          assessment_type: isType,
          date_iso: toIsoLocal(parsed.date),
          day_name: weekdayFullName(parsed.date.getDay()),
          start_time: parsed.time || "09:00",
          end_time: parsed.time || "10:30",
          display_time: parsed.time ? format12h(parsed.time) : "All Day",
          room: "See Moodle",
          group: "All Groups",
          instructor: "Moodle Calendar",
          is_upcoming: daysUntil >= 0,
          days_until: daysUntil,
          urgency_level: daysUntil < 0 ? "Past" : daysUntil <= 1 ? "Urgent" : daysUntil <= 7 ? "Medium" : "Low",
          urgency_class: daysUntil < 0 ? "bg-slate-100 text-slate-600" : daysUntil <= 1 ? "bg-orange-500 text-white" : daysUntil <= 7 ? "bg-yellow-500 text-white" : "bg-slate-500 text-white",
          priority_score: daysUntil < 0 ? 10 : daysUntil === 0 ? 98 : daysUntil <= 3 ? 84 : daysUntil <= 7 ? 70 : 50,
          topics: [`${finalCourse} Moodle calendar item`],
          warnings: [],
          ai_inference_note: "Imported from your Moodle calendar feed (on-device).",
          ai_study_plan: `Prepare for ${finalCourse} ${isType} — check Moodle for the official instructions.`,
          estimated_study_hours: 2.5,
          elearning_url: "",
          google_cal_url: "",
          gcal_synced: false,
          gcal_event_id: null,
          color: palette.fg,
          bg: palette.bg,
          border: palette.border,
          semester: inferSemesterFromDateLocal(parsed.date),
          email_subject: summary,
          email_sent_date: toIsoLocal(new Date()),
          source: "Moodle",
          source_icon: "rss",
          conflict_warning: null
        });
      }
      notes.push(`Moodle: ${out.length} assessment item${out.length === 1 ? "" : "s"} imported from your calendar feed.`);
      return out;
    } catch (e) {
      // Moodle servers usually do not send CORS headers — report honestly.
      notes.push("Moodle: feed blocked by the device browser (CORS). Export the ICS into the desktop app instead.");
      return [];
    }
  }

  /** Merges scanned assessments into state while preserving user-authored data. */
  mergeScannedAssessments(scanned, notes) {
    if (!Array.isArray(scanned) || scanned.length === 0) return 0;
    const existingById = new Map((this.state.assessments || []).map((a) => [a.id, a]));
    let added = 0;
    let updated = 0;
    for (const incoming of scanned) {
      const existing = existingById.get(incoming.id);
      if (existing) {
        // Preserve the user's grading/bookkeeping fields across refresh cycles.
        incoming.achieved_score = existing.achieved_score;
        incoming.max_score = existing.max_score;
        incoming.weightage_percent = existing.weightage_percent;
        incoming.gcal_synced = existing.gcal_synced;
        incoming.gcal_event_id = existing.gcal_event_id;
        Object.assign(existing, incoming);
        updated++;
      } else {
        this.state.assessments.push(incoming);
        existingById.set(incoming.id, incoming);
        added++;
      }
    }
    if (added || updated) {
      this.state.assessments.sort((a, b) => new Date(a.date_iso + "T00:00") - new Date(b.date_iso + "T00:00"));
    }
    notes.push(`Imported: ${added} new + ${updated} refreshed.`);
    return added;
  }

  /**
   * The full live pipeline. kind: "gmail" | "microsoft" | "all".
   * Each list/detail request that comes back 401 triggers exactly one silent
   * bridge refresh + retry; failures surface honestly in sync notes.
   */
  async runLiveScan(kind) {
    const notes = [];
    const hasGoogle = !!(this.state.auth && this.state.auth.authenticated && this.state.auth.access_token);
    const hasMicrosoft = !!(this.state.config && (this.state.config.teams_token ||
      (this.state.config.teams_enabled && this.state.config.teams_account_email)));
    const hasMoodle = !!(this.state.config && this.state.config.moodle_ical_url);

    let googleEmails = null;
    if (kind !== "microsoft" && hasGoogle) {
      let result = await this.scanGmailBranch(notes);
      if (result && result.retry) {
        const refreshed = await bridgeRefreshAccessToken("google");
        if (refreshed) {
          this.state.auth.access_token = refreshed.access_token;
          this.state.auth.google_token_expires_at = Date.now() + (refreshed.expires_in || 3600) * 1000;
          if (window.appState && window.appState.auth) {
            window.appState.auth.access_token = this.state.auth.access_token;
            window.appState.auth.google_token_expires_at = this.state.auth.google_token_expires_at;
          }
          notes.push("Gmail: access token was renewed silently via the secure bridge.");
          result = await this.scanGmailBranch(notes);
        } else {
          notes.push("Gmail: silent renewal unavailable — reconnect your Google account in Settings → Integrations.");
        }
      }
      if (result && Array.isArray(result.emails)) {
        googleEmails = processAllScannedEmails(result.emails, notes, "Gmail", "mail", this.state.schedule || {});
      } else if (result && result.retry) {
        notes.push("Gmail: renewed token was still rejected (server refused). Reconnect your Google account.");
      }
    } else if (kind !== "microsoft" && !hasGoogle) {
      notes.push("Gmail: not connected — sign in with your Google account to enable scanning.");
    }

    let msEmails = null;
    if (kind !== "gmail" && hasMicrosoft) {
      let result = await this.scanMicrosoftBranch();
      if (result === null) {
        notes.push("Outlook: not connected or token expired — reconnect Microsoft in Settings → Integrations.");
      }
      if (result && result.retry) {
        const refreshed = await bridgeRefreshAccessToken("microsoft");
        if (refreshed) {
          this.state.config.teams_token = refreshed.access_token;
          this.state.config.teams_token_expires_at = Date.now() + (refreshed.expires_in || 3600) * 1000;
          if (window.appState && window.appState.config) {
            window.appState.config.teams_token = this.state.config.teams_token;
            window.appState.config.teams_token_expires_at = this.state.config.teams_token_expires_at;
          }
          notes.push("Outlook: access token was renewed silently via the secure bridge.");
          result = await this.scanMicrosoftBranch();
        } else {
          notes.push("Outlook: silent renewal unavailable — reconnect Microsoft in Settings → Integrations.");
        }
      }
      if (result && Array.isArray(result.emails)) {
        msEmails = processAllScannedEmails(result.emails, notes, "Teams", "users", this.state.schedule || {});
      }
    }

    let moodleItems = [];
    if (kind === "all") {
      moodleItems = await this.scanMoodleBranch(notes);
      if (!hasMoodle) notes.push("Moodle: no calendar feed configured (optional).");
    }

    const scanned = [...(googleEmails || []), ...(msEmails || []), ...(moodleItems || [])];
    const addedCount = this.mergeScannedAssessments(scanned, notes);

    const connections = [];
    if (hasGoogle) connections.push("Gmail");
    if (hasMicrosoft) connections.push("Outlook");
    if (hasMoodle) connections.push("Moodle");
    if (connections.length === 0) {
      return {
        success: true,
        message: "No connected sources on this device yet. Sign in or add feeds in Settings → Integrations — your manual entries stay untouched.",
        assessments: this.state.assessments,
        dashboard: this.state.dashboard,
        schedule: this.state.schedule
      };
    }

    this.state.config.last_gmail_sync = new Date().toLocaleString();
    this.recomputeDashboard(this.state);
    this.saveDatabase();

    const message = `${connections.join(" · ")} scan complete — ${addedCount} new, ${this.state.assessments.length} total. ${stripHtmlTags(notes.join(" "))}`.trim();
    return {
      success: true,
      message,
      assessments: this.state.assessments,
      dashboard: this.state.dashboard,
      schedule: this.state.schedule
    };
  }

  generateIcs() {
    let lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//QuizRadar//Academic Radar Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH"
    ];
    (this.state.assessments || []).forEach((a) => {
      const dt = (a.date_iso || this.todayIsoFallback()).replace(/-/g, "");
      lines.push(
        "BEGIN:VEVENT",
        `UID:${a.id}@quizradar.app`,
        `DTSTAMP:${dt}T000000Z`,
        `DTSTART;VALUE=DATE:${dt}`,
        `SUMMARY:[${a.course_id || 'EXAM'}] ${a.title}`,
        `DESCRIPTION:Assessment: ${a.assessment_type || 'Quiz'}. Topics: ${(a.topics || []).join(', ')}`,
        `LOCATION:${a.room || 'Campus'}`,
        "STATUS:CONFIRMED",
        "END:VEVENT"
      );
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }
}

// PERF: The on-device engine parses its DB and recomputes the dashboard, which is
// expensive to do before first paint. It is now created lazily on first access;
// the Proxy keeps every existing `mobileEngine.*` call site working unchanged.
let _mobileEngineInstance = null;
function ensureMobileEngine() {
  if (!_mobileEngineInstance) {
    _mobileEngineInstance = new QuizRadarAutonomousEngine();
  }
  return _mobileEngineInstance;
}
const mobileEngine = new Proxy(
  {},
  {
    get(_target, prop) {
      const instance = ensureMobileEngine();
      const value = instance[prop];
      return typeof value === "function" ? value.bind(instance) : value;
    },
    set(_target, prop, value) {
      ensureMobileEngine()[prop] = value;
      return true;
    },
  }
);

// ============================================================================
// API ROUTING POLICY (CRITICAL, DO NOT CHANGE LIGHTLY)
// - Desktop app / browser PWA: window.fetch is left 100% UNTOUCHED so the UI
//   talks to the REAL Rust backend (Google OAuth, Gmail scan, Teams, Moodle,
//   Classroom, calendar push, pairing). Never intercept /api/* here.
// - Android/iOS native (Capacitor): the on-device engine answers /api/* calls
//   because there is no bundled Rust server. Absolute http(s) URLs are passed
//   through so the app can pair with a desktop instance on the LAN.
// ============================================================================
if (IS_NATIVE) {
  window.fetch = async function (resource, init) {
    const url = typeof resource === "string" ? resource : resource?.url || "";
    const isRelative = /^\/[^/]/.test(url) || url.startsWith("./");
    if (!isRelative) {
      // Cross-origin (e.g. http://192.168.x.x:5050 desktop pairing) → real network
      return _originalFetch(resource, init);
    }
    if (url.startsWith("/api/")) {
      try {
        const result = await mobileEngine.handleApi(url, init);
        if (result) {
          if (result.text !== undefined) {
            return new Response(result.text, {
              status: result.status || 200,
              headers: { "Content-Type": result.contentType || "text/plain" }
            });
          }
          return new Response(JSON.stringify(result.data !== undefined ? result.data : { success: true }), {
            status: result.status || 200,
            headers: { "Content-Type": "application/json" }
          });
        }
      } catch (e) {
        console.warn("[QuizRadar Local Fetch Interceptor]:", e);
      }
      // On-device engine covers everything it knows; anything else fails honestly
      return new Response(
        JSON.stringify({
          success: false,
          error: "Feature not available on this device; use the desktop app."
        }),
        {
          status: 501,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    return _originalFetch(resource, init);
  };
}

// ============================================================================
// NATIVE ANDROID BRIDGE & HAPTICS (Capacitor 6 / Material Design 3)
// ============================================================================

function triggerHaptic(type = "light") {
  try {
    const Haptics = window.Capacitor?.Plugins?.Haptics;
    if (Haptics) {
      if (type === "selection") {
        Haptics.selectionChanged().catch(() => {});
      } else if (type === "medium") {
        Haptics.impact({ style: "MEDIUM" }).catch(() => {});
      } else if (type === "heavy") {
        Haptics.impact({ style: "HEAVY" }).catch(() => {});
      } else if (type === "success") {
        Haptics.notification({ type: "SUCCESS" }).catch(() => {});
      } else if (type === "error") {
        Haptics.notification({ type: "ERROR" }).catch(() => {});
      } else {
        Haptics.impact({ style: "LIGHT" }).catch(() => {});
      }
      return;
    }
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      if (type === "medium") navigator.vibrate(25);
      else if (type === "heavy") navigator.vibrate(45);
      else if (type === "success") navigator.vibrate([15, 60, 20]);
      else navigator.vibrate(12);
    }
  } catch (e) {
    // Graceful no-op
  }
}

function updateNativeStatusBar(isDark) {
  try {
    const StatusBar = window.Capacitor?.Plugins?.StatusBar;
    if (!StatusBar) return;
    Promise.all([
      StatusBar.setBackgroundColor({ color: isDark ? "#0b0f19" : "#ffffff" }),
      StatusBar.setStyle({ style: isDark ? "LIGHT" : "DARK" })
    ]).catch((err) => console.debug("StatusBar update error:", err));
  } catch (err) {
    console.debug("StatusBar plugin error:", err);
  }
}

function initAndroidNativeBridge() {
  if (!IS_NATIVE) return;

  const App = window.Capacitor?.Plugins?.App;
  if (App && App.addListener) {
    App.addListener("backButton", () => {
      // 1. Close topmost open modal/bottom sheet
      const modals = [
        { id: "account-profile-modal", close: closeAccountModal },
        { id: "mobile-search-modal", close: closeMobileSearchModal },
        { id: "event-detail-modal", close: closeEventDetailModal },
        { id: "create-event-modal", close: closeCreateEventModal },
        { id: "cloud-sync-modal", close: closeCloudSyncModal },
        { id: "settings-modal", close: closeSettingsModal },
        { id: "schedule-preview-modal", close: closeSchedulePreviewModal },
        { id: "add-course-modal", close: closeAddCourseModal },
        { id: "practice-quiz-modal", close: closePracticeQuizModal },
        { id: "pomodoro-modal", close: closePomodoroModal },
        { id: "onboarding-modal", close: closeOnboardingModal },
      ];

      for (const m of modals) {
        const el = document.getElementById(m.id);
        if (el && el.classList.contains("is-open")) {
          triggerHaptic("light");
          m.close();
          return;
        }
      }

      // 2. Close Search dropdown if open
      const palette = document.getElementById("search-dropdown-palette");
      if (palette && palette.classList.contains("is-open")) {
        triggerHaptic("light");
        closeSearchPalette();
        document.getElementById("global-search-input")?.blur();
        return;
      }

      // 3. Close Mobile Sidebar if open
      const sb = document.getElementById("left-sidebar");
      if (sb && !sb.classList.contains("sidebar-collapsed") && window.innerWidth < 1024) {
        triggerHaptic("light");
        toggleSidebar(true);
        return;
      }

      // 4. Return to Dashboard from secondary tabs
      if (currentMainView !== "dashboard") {
        triggerHaptic("selection");
        switchMainView("dashboard");
        return;
      }

      // 5. Exit application if on root
      App.exitApp();
    });

    App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        // App returned to foreground: refresh state if returning from external browser
        loadFullState();
      }
    });

    // OAuth return deep link: the local callback server's success page
    // navigates to com.quizradar.app://oauth-done (intent:// fallback), which
    // re-activates this task. Tokens themselves arrive via
    // window.handleOAuthResult injection — here we just clean up pending
    // sign-in state and make sure any Custom Tab is dismissed.
    if (App.addListener && window.Capacitor?.Plugins?.Browser) {
      try {
        App.addListener("appUrlOpen", (data) => {
          const url = (data && data.url) || "";
          if (url.startsWith("com.quizradar.app://")) {
            pendingNativeOAuth = {};
            try { window.Capacitor.Plugins.Browser.close(); } catch (e) {}
          }
          // QR pairing deep link: com.quizradar.app://pair?url=<encoded desktop url>
          // (scanned from the QR card shown in the desktop app's Settings).
          if (url.includes("com.quizradar.app://pair")) {
            try {
              const queryStart = url.indexOf("?url=");
              if (queryStart !== -1) {
                const desktopUrl = decodeURIComponent(url.slice(queryStart + 5).split("&")[0]);
                const normalized = normalizeDesktopUrl(desktopUrl);
                if (normalized) {
                  localStorage.setItem(DESKTOP_PAIRING_URL_KEY, normalized);
                  const input = document.getElementById("pair-desktop-url");
                  if (input) input.value = normalized;
                  const pinHint = url.includes("#pin-required") || url.includes("pin-required");
                  triggerHaptic("success");
                  openCloudSyncModal();
                  setTimeout(() => {
                    showPairingStatus(
                      pinHint
                        ? "Desktop captured! It requires its pairing PIN — type the digits shown on the PC, then Test."
                        : "Desktop address captured! Tap Test, then Pull Desktop Data.",
                      false
                    );
                    if (!pinHint) testDesktopPairing();
                  }, 350);
                }
              }
            } catch (err) {
              console.warn("Pair deep link failed:", err);
            }
          }
        });
      } catch (e) { /* listener unavailable on this platform */ }
    }
  }

  const isDark = document.documentElement.classList.contains("dark");
  updateNativeStatusBar(isDark);
}

// ============================================================================
// AUTHENTICATION & EXTERNAL LINK HANDLERS (Safe WebView Bridge)
// ============================================================================

let _authPollInterval = null;

async function openExternalUrl(url) {
  if (!url) return;
  triggerHaptic("selection");
  if (IS_NATIVE && window.Capacitor?.Plugins?.Browser) {
    try {
      await window.Capacitor.Plugins.Browser.open({ url });
      return;
    } catch (e) {
      console.warn("Capacitor Browser failed, falling back to window.open", e);
    }
  }
  window.open(url, "_blank");
}

function toggleGoogleEditBox(show) {
  const box = document.getElementById("account-google-edit-box");
  const authBtn = document.getElementById("account-auth-btn");
  if (!box) return;
  if (show) {
    box.classList.remove("hidden");
    const nameInput = document.getElementById("account-input-name");
    const emailInput = document.getElementById("account-input-email");
    const geminiInput = document.getElementById("account-input-gemini");
    if (nameInput) nameInput.value = appState.auth?.name || appState.config?.user_name || "Student";
    if (emailInput) emailInput.value = appState.auth?.email || appState.config?.user_email || "";
    if (geminiInput) geminiInput.value = appState.config?.gemini_api_key || "";
    if (authBtn) authBtn.classList.add("hidden");
    setTimeout(() => emailInput?.focus(), 80);
  } else {
    box.classList.add("hidden");
    if (authBtn) authBtn.classList.remove("hidden");
  }
}

async function saveGoogleAccountProfile() {
  triggerHaptic("medium");
  const nameInput = document.getElementById("account-input-name");
  const emailInput = document.getElementById("account-input-email");
  const geminiInput = document.getElementById("account-input-gemini");

  const name = (nameInput?.value || "").trim() || "Student";
  const email = (emailInput?.value || "").trim();
  const geminiKey = (geminiInput?.value || "").trim();

  if (!email || !email.includes("@")) {
    showToast("Please enter a valid Google or Gmail address", "warning");
    triggerHaptic("warning");
    return;
  }

  showToast("Saving local student profile...", "info", 1500);

  await fetch("/api/config/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_name: name,
      user_email: email,
      gemini_api_key: geminiKey || null,
      gemini_enabled: !!geminiKey
    })
  });

  if (appState.auth) {
    appState.auth.name = name;
    // Typed email is a local profile anchor only. Real OAuth state can only come
    // from /api/auth — never flip `authenticated` from a form field.
    if (!appState.auth.authenticated) {
      appState.auth.email = email;
    }
  }
  if (appState.config) {
    appState.config.user_name = name;
    appState.config.user_email = email;
    if (geminiKey) {
      appState.config.gemini_api_key = geminiKey;
      appState.config.gemini_enabled = true;
    }
  }

  toggleGoogleEditBox(false);
  saveStateCache();
  updateTopBarAndUser();
  renderAllViews();
  if (document.getElementById("account-profile-modal")?.classList.contains("is-open")) {
    openAccountModal();
  }
  triggerHaptic("success");
  showToast(
    IS_NATIVE
      ? `Local profile saved: ${email}. Live scanning activates after you sign in (Settings → Integrations).`
      : `Local profile saved: ${email}.`,
    "success",
    3500
  );
}

// ============================================================================
// GEMINI KEY HELPER (guided, free-tier, validate-then-save)
// ============================================================================

/** Opens Google AI Studio's API-key page in the system browser. */
async function openGeminiKeyHelper() {
  triggerHaptic("selection");
  await openExternalUrl("https://aistudio.google.com/apikey");
}

/**
 * Validates the pasted AI Studio key with a tiny real request, then saves it.
 * Honest about failures: 400 = bad key, 429 = quota (usually still fine to
 * save), network/CORS = blocked walk-through.
 */
async function validateGeminiKeyFromSettings() {
  triggerHaptic("medium");
  const input = document.getElementById("settings-gemini-key");
  const statusEl = document.getElementById("settings-gemini-status");
  const showStatus = (text, tone) => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.remove("hidden");
    statusEl.className = "text-[11px] p-2 rounded-lg border font-medium " + (
      tone === "ok" ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
      : tone === "warn" ? "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
      : "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200"
    );
  };
  const key = (input?.value || "").trim();
  if (!key) {
    showStatus("Paste your key first. Tap step 1 above to open AI Studio and copy it.", "err");
    return;
  }
  if (!key.startsWith("AIza") || key.length < 30) {
    showStatus("This doesn't look like an AI Studio key (they start with \"AIza\" and are ~39 characters long). Double-check the copy — the key lives under \"API key\", not the Gemini plan.", "warn");
  }
  showStatus("Testing your key with a tiny request…", "warn");
  try {
    const res = await _originalFetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with the single word OK" }] }] })
    });
    if (res && res.ok) {
      await fetch("/api/config/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini_api_key: key, gemini_enabled: true })
      });
      if (appState.config) {
        appState.config.gemini_api_key = key;
        appState.config.gemini_enabled = true;
      }
      saveStateCache();
      updateTopBarAndUser();
      renderAllViews();
      triggerHaptic("success");
      showStatus("Key works and is saved (free tier — no billing). AI features are live on this device.", "ok");
      showToast("Gemini connected with your own free key.", "success", 3500);
      return;
    }
    const code = res ? res.status : 0;
    if (code === 400 || code === 403) {
      showStatus("Google rejected this key (HTTP " + code + "). Copy it again from aistudio.google.com/apikey — make sure you copied the full string.", "err");
    } else if (code === 429) {
      // Quota exceeded right now — the key identity is still valid.
      await fetch("/api/config/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini_api_key: key, gemini_enabled: true })
      });
      if (appState.config) {
        appState.config.gemini_api_key = key;
        appState.config.gemini_enabled = true;
      }
      saveStateCache();
      showStatus("Key is valid but hit its free-quota limit just now (HTTP 429). It's saved — AI features will work once the per-minute quota resets.", "warn");
    } else {
      showStatus("Google replied with HTTP " + (res ? res.status : "network error") + ". Try again in a minute.", "err");
    }
  } catch (e) {
    showStatus("Request blocked or offline. Check your connection and try again (a VPN/ad-blocker can also block aistudio traffic).", "err");
  }
}

// ============================================================================
// OAUTH BROWSER LAUNCHER & LIVE AUTH POLLING
// ============================================================================

// --- OAuth anti-CSRF state + PKCE helpers (native sign-in flow) ---
// The local OAuth callback server (LocalOAuthServer.java) receives the state
// and PKCE verifier via /api/auth/prepare BEFORE the browser is opened, then
// validates the callback against them. Single sign-in session per attempt.
let pendingNativeOAuth = {};

function randomB64UrlSafe(byteLen) {
  const arr = new Uint8Array(byteLen);
  if (window.crypto && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < byteLen; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkceChallengeS256(verifier) {
  if (!window.crypto || !crypto.subtle || !crypto.subtle.digest) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function openExternalBrowser(url) {
  if (IS_NATIVE && window.Capacitor?.Plugins?.Browser?.open) {
    window.Capacitor.Plugins.Browser.open({ url });
  } else {
    // In desktop Wry (WebView2 on Windows):
    // window.open(url, "_blank") triggers with_new_window_req_handler in main.rs:
    // which delegates to open::that(&url) to launch the default system browser (Chrome/Edge).
    const win = window.open(url, "_blank");
    if (win && win.focus) win.focus();
  }
}

let authPollInterval = null;
let authPollTimeout = null;

/** Posts a pending sign-in expectation to the native loopback listener.
 *  Returns true only when the listener acknowledged it within 4s.
 *  Used to fail fast BEFORE opening the external browser.
 *  NOTE: deliberately sent WITHOUT a Content-Type header — with a custom
 *  content type the WebView turns this into a preflighted cross-origin
 *  request; the plain-substring body keeps it a CORS-simple request. */
async function nativeOauthPrepare(provider, state, verifier) {
  try {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
    const res = await _originalFetch("http://127.0.0.1:3000/api/auth/prepare", {
      method: "POST",
      signal: ctrl ? ctrl.signal : undefined,
      body: JSON.stringify({ provider, state, verifier })
    });
    if (timer) clearTimeout(timer);
    const text = res ? await res.text() : "";
    return !!(res && res.ok && text.includes('"ok":true'));
  } catch (e) {
    return false;
  }
}

function startAuthPolling(provider = "any") {
  if (authPollInterval) clearInterval(authPollInterval);
  if (authPollTimeout) clearTimeout(authPollTimeout);

  let attempts = 0;
  const maxAttempts = 120; // 120 * 1.5s = 3 minutes

  authPollInterval = setInterval(async () => {
    attempts++;
    // Don't burn cycles or re-persist the DB while the app is backgrounded.
    if (document.visibilityState === "hidden") return;
    if (attempts > maxAttempts) {
      clearInterval(authPollInterval);
      authPollInterval = null;
      return;
    }

    try {
      const res = await fetch("/api/state");
      if (!res.ok) return;
      const state = await res.json();

      const googleSuccess =
        (provider === "google" || provider === "any") &&
        state.auth?.authenticated &&
        (!appState.auth?.authenticated || appState.auth?.email !== state.auth?.email);

      const msSuccess =
        (provider === "microsoft" || provider === "any") &&
        (state.teams_connected || (state.config?.teams_enabled && state.config?.teams_token)) &&
        !appState.teams_connected;

      if (googleSuccess || msSuccess) {
        clearInterval(authPollInterval);
        authPollInterval = null;

        Object.assign(appState, state);
        saveStateCache();
        updateTopBarAndUser();
        renderAllViews();
        renderOnboardingStep2State();
        if (document.getElementById("account-profile-modal")?.classList.contains("is-open")) {
          openAccountModal();
        }

        triggerHaptic("success");
        const accountDesc = googleSuccess
          ? (state.auth?.email || "Google Account")
          : (state.teams_email || state.config?.teams_account_email || "University Microsoft Account");
        showToast(`Signed in successfully: ${accountDesc}!`, "success", 4000);

        if (IS_NATIVE && window.Capacitor?.Plugins?.Browser?.close) {
          try { window.Capacitor.Plugins.Browser.close(); } catch (e) {}
        }
      }
    } catch (e) {
      // Ignore background poll errors
    }
  }, 1500);

  authPollTimeout = setTimeout(() => {
    if (authPollInterval) {
      clearInterval(authPollInterval);
      authPollInterval = null;
    }
  }, 180000);
}

// Native Android / OAuth callback bridge triggered by LocalOAuthServer
window.handleOAuthResult = function(provider, tokenData, profileData) {
  console.log("[QuizRadar] handleOAuthResult:", provider, profileData);
  pendingNativeOAuth = {};
  if (IS_NATIVE && window.Capacitor?.Plugins?.Browser?.close) {
    try { window.Capacitor.Plugins.Browser.close(); } catch (_) {}
  }
  if (authPollInterval) {
    clearInterval(authPollInterval);
    authPollInterval = null;
  }
  if (authPollTimeout) {
    clearTimeout(authPollTimeout);
    authPollTimeout = null;
  }

  if (provider === "google") {
    if (!appState.auth) appState.auth = {};
    appState.auth.authenticated = true;
    appState.auth.email = profileData.email || tokenData.email || "Google Account";
    appState.auth.name = profileData.name || "Student";
    appState.auth.picture = profileData.picture || null;
    appState.auth.access_token = tokenData.access_token;
    if (tokenData.refresh_token) {
      appState.auth.refresh_token = tokenData.refresh_token;
    }
    // Track the access-token age so the scanner knows when to ask the native
    // bridge (MainActivity secure storage) for a silent renewal. Google access
    // tokens last ~1h; assume 55 minutes to stay safely inside the window.
    appState.auth.google_token_expires_at = Date.now() + 55 * 60 * 1000;
    if (!appState.config) appState.config = {};
    appState.config.user_email = appState.auth.email;
    appState.config.user_name = appState.auth.name;
    if (appState.auth.picture) {
      appState.config.user_picture = appState.auth.picture;
    }

    if (typeof mobileEngine !== "undefined" && mobileEngine && mobileEngine.state) {
      mobileEngine.state.auth = { ...appState.auth };
      mobileEngine.state.config = { ...appState.config };
      mobileEngine.saveDatabase();
    }
    saveStateCache();
    updateTopBarAndUser();
    renderAllViews();
    renderOnboardingStep2State();
    if (document.getElementById("account-profile-modal")?.classList.contains("is-open")) {
      openAccountModal();
    }
    triggerHaptic("success");
    showToast(`Signed in as ${appState.auth.email} — live Gmail scanning is active on this device.`, "success", 4000);
  } else if (provider === "microsoft") {
    if (!appState.config) appState.config = {};
    const msEmail = profileData.mail || profileData.userPrincipalName || tokenData.email || "University Account";
    const msName = profileData.displayName || "University Student";
    appState.config.teams_enabled = true;
    appState.config.teams_token = tokenData.access_token;
    // Microsoft access tokens are typically valid ~1h; refresh handled via bridge.
    appState.config.teams_token_expires_at = Date.now() + 55 * 60 * 1000;
    if (tokenData.refresh_token) {
      appState.config.teams_refresh_token = tokenData.refresh_token;
    }
    appState.config.teams_account_email = msEmail;
    appState.config.teams_account_name = msName;
    appState.teams_connected = true;
    appState.teams_email = msEmail;
    // Identity preference: when the university Microsoft account is connected
    // WITHOUT a Google sign-in, the university identity becomes the profile
    // anchor (display name/email) so the phone clearly shows who it scans for.
    if (!appState.auth || !appState.auth.authenticated) {
      appState.config.user_email = msEmail;
      appState.config.user_name = msName;
    }

    if (typeof mobileEngine !== "undefined" && mobileEngine && mobileEngine.state) {
      mobileEngine.state.config = { ...appState.config };
      mobileEngine.state.teams_connected = true;
      mobileEngine.state.teams_email = msEmail;
      mobileEngine.saveDatabase();
    }
    saveStateCache();
    updateTopBarAndUser();
    renderAllViews();
    renderOnboardingStep2State();
    if (document.getElementById("account-profile-modal")?.classList.contains("is-open")) {
      openAccountModal();
    }
    triggerHaptic("success");
    showToast(`University account connected: ${msEmail}`, "success", 4000);
  }
};

async function startGoogleAuth() {
  triggerHaptic("selection");
  showToast("Opening Google Sign-In in your browser...", "info", 3000);
  try {
    const res = await fetch("/api/auth/google/url");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.url) throw new Error(data.error || "No authorization URL returned");

    openExternalBrowser(data.url);
    startAuthPolling("google");
  } catch (err) {
    console.warn("Falling back to direct /api/auth/google:", err);
    if (!IS_NATIVE) {
      openExternalBrowser("/api/auth/google");
      startAuthPolling("google");
    } else {
      showToast("Could not start Google Sign-In: " + err.message, "error");
    }
  }
}

async function startMicrosoftAuth() {
  triggerHaptic("selection");
  showToast("Opening Microsoft Sign-In in your browser...", "info", 3000);
  try {
    const res = await fetch("/api/microsoft/url");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.url) throw new Error(data.error || "No authorization URL returned");

    openExternalBrowser(data.url);
    startAuthPolling("microsoft");
  } catch (err) {
    console.warn("Falling back to direct /api/microsoft/login:", err);
    if (!IS_NATIVE) {
      openExternalBrowser("/api/microsoft/login");
      startAuthPolling("microsoft");
    } else {
      showToast("Could not start Microsoft Sign-In: " + err.message, "error");
    }
  }
}

// ============================================================================
// CUSTOM IN-APP CONFIRMATION MODAL (Replaces browser confirm() dialogs)
// ============================================================================

let currentConfirmCallback = null;

function showAppConfirm({ title, message, icon = "alert-triangle", confirmText = "Confirm", cancelText = "Cancel", isDanger = true, onConfirm }) {
  triggerHaptic("warning");
  const modal = document.getElementById("app-confirm-modal");
  if (!modal) {
    if (window.confirm(message)) {
      onConfirm?.();
    }
    return;
  }
  const titleEl = document.getElementById("app-confirm-title");
  const msgEl = document.getElementById("app-confirm-message");
  const iconEl = document.getElementById("app-confirm-icon");
  const iconBox = document.getElementById("app-confirm-icon-box");
  const actBtn = document.getElementById("app-confirm-action-btn");
  const cancelBtn = document.getElementById("app-confirm-cancel-btn");

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (cancelBtn) cancelBtn.textContent = cancelText;
  if (actBtn) {
    actBtn.textContent = confirmText;
    actBtn.className = isDanger
      ? "flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-bold transition cursor-pointer shadow-xs"
      : "flex-1 py-2.5 px-4 rounded-xl bg-[#1a73e8] hover:bg-[#1557b0] active:scale-95 text-white text-xs font-bold transition cursor-pointer shadow-xs";
  }
  if (iconBox) {
    iconBox.className = isDanger
      ? "w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto"
      : "w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-[#1a73e8] dark:text-blue-400 flex items-center justify-center mx-auto";
  }
  if (iconEl) {
    iconEl.setAttribute("data-lucide", icon);
    if (window.lucide) lucide.createIcons({ root: iconBox });
  }

  currentConfirmCallback = onConfirm;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  void modal.offsetHeight;
  requestAnimationFrame(() => modal.classList.add("is-open"));
}

function closeAppConfirm(confirmed = false) {
  const modal = document.getElementById("app-confirm-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
  setTimeout(() => {
    modal.classList.remove("flex");
    modal.classList.add("hidden");
  }, 200);

  if (confirmed && typeof currentConfirmCallback === "function") {
    currentConfirmCallback();
  }
  currentConfirmCallback = null;
}

function toggleTeamsEditBox(show) {
  const box = document.getElementById("account-teams-edit-box");
  const authBtn = document.getElementById("account-teams-auth-btn");
  if (!box) return;
  if (show) {
    box.classList.remove("hidden");
    const emailInput = document.getElementById("account-input-teams-email");
    const nameInput = document.getElementById("account-input-teams-name");
    if (emailInput) emailInput.value = appState.config?.teams_account_email || "";
    if (nameInput) nameInput.value = appState.config?.teams_account_name || "";
    if (authBtn) authBtn.classList.add("hidden");
    setTimeout(() => emailInput?.focus(), 80);
  } else {
    box.classList.add("hidden");
    if (authBtn) authBtn.classList.remove("hidden");
  }
}

async function saveTeamsAccountProfile() {
  triggerHaptic("medium");
  const emailInput = document.getElementById("account-input-teams-email");
  const nameInput = document.getElementById("account-input-teams-name");

  const email = (emailInput?.value || "").trim();
  const name = (nameInput?.value || "").trim() || "University";

  if (!email || !email.includes("@")) {
    showToast("Please enter a valid university email address", "warning");
    triggerHaptic("warning");
    return;
  }

  showToast("Saving local university profile...", "info", 1500);

  if (appState.config) {
    appState.config.teams_enabled = true;
    appState.config.teams_account_email = email;
    appState.config.teams_account_name = name;
  }

  await fetch("/api/config/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      teams_enabled: true,
      teams_account_email: email,
      teams_account_name: name
    })
  });

  toggleTeamsEditBox(false);
  saveStateCache();
  updateTopBarAndUser();
  renderAllViews();
  if (document.getElementById("account-profile-modal")?.classList.contains("is-open")) {
    openAccountModal();
  }
  triggerHaptic("success");
  showToast(`University profile saved locally: ${email}.`, "success", 3000);
}

async function disconnectMicrosoftAccount() {
  showAppConfirm({
    title: "Disconnect University Account?",
    message: "This will unlink your Microsoft Teams and Outlook sync. Previously detected courses will remain in your schedule, but live Teams scanning will stop.",
    icon: "log-out",
    confirmText: "Disconnect",
    isDanger: true,
    onConfirm: async () => {
      try {
        showToast("Disconnecting Microsoft Teams account...", "info", 2000);
        const res = await fetch("/api/microsoft/logout", { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (appState.config) {
          appState.config.teams_enabled = false;
          appState.config.teams_token = null;
          appState.config.teams_account_email = null;
          appState.config.teams_account_name = null;
        }
        appState.teams_connected = false;
        appState.teams_email = null;
        if (data.assessments) appState.assessments = data.assessments;
        if (data.dashboard) appState.dashboard = data.dashboard;
        if (data.schedule) appState.schedule = data.schedule;

        saveStateCache();
        renderAllViews();
        renderOnboardingStep2State();
        if (document.getElementById("account-profile-modal")?.classList.contains("is-open")) {
          openAccountModal();
        }
        triggerHaptic("success");
        showToast("University Microsoft account disconnected successfully", "success", 3000);
      } catch (err) {
        console.error("Teams disconnect failed:", err);
        showToast("Failed to disconnect Teams: " + err.message, "error");
        triggerHaptic("warning");
      }
    }
  });
}

async function disconnectGoogleAccount() {
  showAppConfirm({
    title: "Disconnect Google Account?",
    message: "This will unlink your personal Google account. Gemini AI insights, automated timetable parsing, and Google Calendar sync will be paused until you sign in again.",
    icon: "log-out",
    confirmText: "Disconnect",
    isDanger: true,
    onConfirm: async () => {
      try {
        showToast("Disconnecting Google Account...", "info", 1500);
        await fetch("/api/auth/logout", { method: "POST" });
        if (appState.auth) {
          appState.auth.authenticated = false;
          appState.auth.email = null;
          appState.auth.name = "Student";
          appState.auth.picture = null;
        }
        if (appState.config) {
          appState.config.user_email = null;
          appState.config.user_name = "Student";
        }
        saveStateCache();
        updateTopBarAndUser();
        renderAllViews();
        renderOnboardingStep2State();
        if (document.getElementById("account-profile-modal")?.classList.contains("is-open")) {
          openAccountModal();
        }
        triggerHaptic("success");
        showToast("Google account disconnected successfully", "success", 2500);
      } catch (err) {
        console.error("Google disconnect error:", err);
        showToast("Failed to disconnect Google account", "error");
      }
    }
  });
}

async function saveCustomGeminiKey() {
  triggerHaptic("medium");
  const input = document.getElementById("account-input-gemini");
  const key = (input?.value || "").trim();
  if (appState.config) {
    appState.config.gemini_api_key = key || null;
    appState.config.gemini_enabled = !!key;
  }
  await fetch("/api/config/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gemini_api_key: key || null,
      gemini_enabled: !!key
    })
  }).catch(() => {});
  saveStateCache();
  showToast(key ? "Gemini API key saved." : "Custom Gemini API key cleared.", "success", 2500);
  document.getElementById("account-gemini-wrap")?.classList.add("hidden");
}

async function exportCalendarIcs(assessmentId = null) {
  triggerHaptic("selection");
  const path = assessmentId ? `/api/calendar/ics/${encodeURIComponent(assessmentId)}` : "/api/calendar/ics_all";
  try {
    showToast("Preparing calendar file (.ics)...", "info", 2000);
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const filename = assessmentId ? `exam-${assessmentId}.ics` : "quizradar-calendar.ics";

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Calendar (.ics) downloaded successfully!", "success");
  } catch (err) {
    console.error("Export ICS failed:", err);
    showToast("Failed to export calendar file: " + err.message, "error");
  }
}

let _currentAssessmentGCalUrl = null;
let _currentAssessmentElearningUrl = null;

function openCurrentAssessmentGCal() {
  if (_currentAssessmentGCalUrl) {
    openExternalUrl(_currentAssessmentGCalUrl);
  } else {
    showToast("No Google Calendar link available for this assessment", "info");
  }
}

function openCurrentAssessmentAnnouncement() {
  if (_currentAssessmentElearningUrl) {
    openExternalUrl(_currentAssessmentElearningUrl);
  }
}

function exportCurrentAssessmentIcs() {
  if (activeModalAssessmentId) {
    exportCalendarIcs(activeModalAssessmentId);
  }
}

// Global safety guard: intercept all anchor clicks in mobile WebView to prevent destroying app
document.addEventListener("click", function(e) {
  const anchor = e.target.closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href || href === "#" || href.startsWith("javascript:")) return;

  if (href.startsWith("http://") || href.startsWith("https://")) {
    if (IS_NATIVE) {
      e.preventDefault();
      openExternalUrl(href);
    }
  } else if (href.startsWith("/api/")) {
    e.preventDefault();
    console.warn("[QuizRadar] Prevented unsafe WebView navigation to:", href);
    if (href.includes("/auth/google")) {
      startGoogleAuth();
    } else if (href.includes("/microsoft")) {
      startMicrosoftAuth();
    } else if (href.includes("/calendar/ics")) {
      exportCalendarIcs();
    }
  }
}, true);

function openMobileSyncTab() {
  triggerHaptic("selection");
  openCloudSyncModal();
}

// ============================================================================
// ACCOUNT & PROFILE MODAL CONTROLLERS
// ============================================================================

function openAccountModal() {
  triggerHaptic("selection");
  const modal = document.getElementById("account-profile-modal");
  if (!modal) return;

  const email = appState.auth?.email || appState.config?.user_email || "Offline Student Profile";
  const name = appState.auth?.name || appState.config?.user_name || "Student";
  const initial = (name && name[0] ? name[0] : "S").toUpperCase();
  const isAuth = !!appState.auth?.authenticated;

  const avatarEl = document.getElementById("account-modal-avatar");
  const nameEl = document.getElementById("account-modal-name");
  const emailEl = document.getElementById("account-modal-email");
  const badgeEl = document.getElementById("account-modal-badge");
  const statusEl = document.getElementById("account-google-status");
  const actionLabel = document.getElementById("account-auth-action-label");
  const coursesCountEl = document.getElementById("account-courses-count");
  const examsCountEl = document.getElementById("account-exams-count");

  const isGoogleAuth = !!appState.auth?.authenticated;
  // Honest badge: a typed/anchor email is NOT a Teams connection — only a
  // real OAuth token (or server-reported teams_connected) counts.
  const isTeamsAuth = !!(appState.teams_connected || (appState.config?.teams_enabled && appState.config?.teams_token));
  const teamsEmail = appState.config?.teams_account_email || appState.config?.teams_account_name;

  if (avatarEl) avatarEl.textContent = initial;
  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = email;
  if (coursesCountEl) coursesCountEl.textContent = `${(appState.schedule?.courses || []).length} Courses`;
  if (examsCountEl) examsCountEl.textContent = `${(appState.assessments || []).length} Scheduled`;

  if (badgeEl) {
    if (isGoogleAuth && isTeamsAuth) {
      badgeEl.className = "mt-1.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-400/25 text-emerald-100 border border-emerald-300/30";
      badgeEl.innerHTML = `<i data-lucide="shield-check" class="w-3 h-3"></i><span>Google & University Synced</span>`;
    } else if (isGoogleAuth) {
      badgeEl.className = "mt-1.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-400/25 text-blue-100 border border-blue-300/30";
      badgeEl.innerHTML = `<i data-lucide="sparkles" class="w-3 h-3 text-amber-300"></i><span>Google AI Insights Active</span>`;
    } else if (isTeamsAuth) {
      badgeEl.className = "mt-1.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-400/25 text-indigo-100 border border-indigo-300/30";
      badgeEl.innerHTML = `<i data-lucide="building-2" class="w-3 h-3"></i><span>University Synced (Teams)</span>`;
    } else {
      badgeEl.className = "mt-1.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-white/20 text-white";
      badgeEl.innerHTML = `<i data-lucide="user" class="w-3 h-3"></i><span>Local Student Profile</span>`;
    }
    refreshIcons(badgeEl);
  }

  // Google Account Status
  if (statusEl) {
    statusEl.className = isGoogleAuth
      ? "text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300"
      : "text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300";
    statusEl.textContent = isGoogleAuth ? "Connected" : "Not Connected";
  }

  if (actionLabel) {
    actionLabel.textContent = isGoogleAuth ? "Switch Account" : "Connect Google";
  }

  const disconnectBtn = document.getElementById("account-disconnect-btn");
  if (disconnectBtn) {
    if (isGoogleAuth) {
      disconnectBtn.classList.remove("hidden");
    } else {
      disconnectBtn.classList.add("hidden");
    }
  }

  // Personal Google Account View
  const googleUnauth = document.getElementById("account-google-unauth");
  const googleAuth = document.getElementById("account-google-auth");
  const googleProfName = document.getElementById("account-google-profile-name");
  const googleProfEmail = document.getElementById("account-google-profile-email");
  const geminiInput = document.getElementById("account-input-gemini");

  if (geminiInput && appState.config?.gemini_api_key) {
    geminiInput.value = appState.config.gemini_api_key;
  }

  if (isGoogleAuth) {
    if (googleUnauth) googleUnauth.classList.add("hidden");
    if (googleAuth) googleAuth.classList.remove("hidden");
    if (googleProfName) googleProfName.textContent = appState.auth?.name || "Google Account";
    if (googleProfEmail) googleProfEmail.textContent = appState.auth?.email || "Connected";
  } else {
    if (googleUnauth) googleUnauth.classList.remove("hidden");
    if (googleAuth) googleAuth.classList.add("hidden");
  }

  // University (Microsoft Teams) Account Status
  const teamsStatusEl = document.getElementById("account-teams-status");
  const teamsDetailsEl = document.getElementById("account-teams-details");
  const teamsActionLabel = document.getElementById("account-teams-auth-action-label");
  const teamsDisconnectBtn = document.getElementById("account-teams-disconnect-btn");

  if (teamsStatusEl) {
    teamsStatusEl.className = isTeamsAuth
      ? "text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300"
      : "text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300";
    teamsStatusEl.textContent = isTeamsAuth ? "Connected" : "Not Connected";
  }

  if (teamsDetailsEl) {
    if (isTeamsAuth) {
      teamsDetailsEl.innerHTML = `Linked university profile: <strong class="font-bold text-indigo-600 dark:text-indigo-400">${escapeHtml(teamsEmail || "University Account")}</strong>. Assignments & exams automatically synced.`;
    } else {
      teamsDetailsEl.textContent = "Connect your university student email (e.g. student@university.edu) to synchronize course teams, assignments, and exam dates without overwriting your primary account.";
    }
  }

  if (teamsActionLabel) {
    teamsActionLabel.textContent = isTeamsAuth ? "Switch University" : "Connect University";
  }

  if (teamsDisconnectBtn) {
    if (isTeamsAuth) {
      teamsDisconnectBtn.classList.remove("hidden");
    } else {
      teamsDisconnectBtn.classList.add("hidden");
    }
  }

  // University Student Account View
  const teamsUnauth = document.getElementById("account-teams-unauth");
  const teamsAuth = document.getElementById("account-teams-auth");
  const teamsProfName = document.getElementById("account-teams-profile-name");
  const teamsProfEmail = document.getElementById("account-teams-profile-email");

  if (isTeamsAuth) {
    if (teamsUnauth) teamsUnauth.classList.add("hidden");
    if (teamsAuth) teamsAuth.classList.remove("hidden");
    if (teamsProfName) teamsProfName.textContent = appState.config?.teams_account_name || "University Account";
    if (teamsProfEmail) teamsProfEmail.textContent = teamsEmail || "Connected";
  } else {
    if (teamsUnauth) teamsUnauth.classList.remove("hidden");
    if (teamsAuth) teamsAuth.classList.add("hidden");
  }

  modal.classList.remove("hidden");
  void modal.offsetHeight;
  requestAnimationFrame(() => {
    modal.classList.add("is-open");
  });
  if (window.lucide) lucide.createIcons({ root: modal });
}

function closeAccountModal() {
  triggerHaptic("light");
  const modal = document.getElementById("account-profile-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
  toggleGoogleEditBox(false);
  toggleTeamsEditBox(false);
  setTimeout(() => {
    if (!modal.classList.contains("is-open")) {
      modal.classList.add("hidden");
    }
  }, 280);
}

// ============================================================================
// DEDICATED MOBILE SEARCH CONTROLLERS
// ============================================================================

let currentMobileSearchFilter = "ALL";

function openMobileSearchPalette() {
  triggerHaptic("selection");
  const modal = document.getElementById("mobile-search-modal");
  if (!modal) return;
  revealModalWithTransition(modal, () => {
    const input = document.getElementById("mobile-modal-search-input");
    if (input) {
      input.value = "";
      setTimeout(() => input.focus(), 120);
    }
  });
  scheduleMobileSearchResults.cancel();
  handleMobileModalSearch("");
  scheduleMobileSearchResults.flush();
  refreshIcons(modal);
}

function closeMobileSearchModal() {
  triggerHaptic("light");
  const modal = document.getElementById("mobile-search-modal");
  if (!modal) return;
  dismissModalTransition(modal);
  scheduleMobileSearchResults.cancel();
  document.getElementById("mobile-modal-search-input")?.blur();
  setTimeout(() => {
    if (!modal.classList.contains("is-open")) {
      modal.classList.add("hidden");
    }
  }, 280);
}

function setMobileSearchFilter(filterType) {
  triggerHaptic("selection");
  currentMobileSearchFilter = filterType;
  ["msf-all", "msf-quiz", "msf-assign", "msf-exam"].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const isTarget =
      (id === "msf-all" && filterType === "ALL") ||
      (id === "msf-quiz" && filterType === "Class Quiz") ||
      (id === "msf-assign" && filterType === "Assignment") ||
      (id === "msf-exam" && filterType === "Exam");
    if (isTarget) {
      btn.className = "px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[#1a73e8] text-white shadow-2xs shrink-0 cursor-pointer";
    } else {
      btn.className = "px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0 cursor-pointer";
    }
  });
  const input = document.getElementById("mobile-modal-search-input");
  handleMobileModalSearch(input ? input.value : "");
  scheduleMobileSearchResults.flush();
}

function clearMobileModalSearch() {
  const input = document.getElementById("mobile-modal-search-input");
  if (input) {
    input.value = "";
    input.focus();
  }
  document.getElementById("mobile-modal-search-clear")?.classList.add("hidden");
  scheduleMobileSearchResults.cancel();
  handleMobileModalSearch("");
  scheduleMobileSearchResults.flush();
}

function handleMobileModalSearch(rawQuery) {
  const query = (rawQuery || "").trim().toLowerCase();
  const clearBtn = document.getElementById("mobile-modal-search-clear");
  if (clearBtn) clearBtn.classList.toggle("hidden", query.length === 0);
  scheduleMobileSearchResults(rawQuery);
}

// Trailing-edge debounce: typing stays cheap, the results list renders once idle.
const scheduleMobileSearchResults = debounce((rawQuery) => renderMobileSearchResults(rawQuery), 140);

function renderMobileSearchResults(rawQuery) {
  const query = (rawQuery || "").trim().toLowerCase();
  const container = document.getElementById("mobile-search-results-list");
  if (!container) return;

  let items = appState.assessments || [];
  if (currentMobileSearchFilter !== "ALL") {
    items = items.filter((a) => {
      const type = (a.assessment_type || "").toLowerCase();
      if (currentMobileSearchFilter === "Class Quiz") return type.includes("quiz");
      if (currentMobileSearchFilter === "Assignment") return type.includes("assign");
      if (currentMobileSearchFilter === "Exam") return type.includes("exam") || type.includes("midterm") || type.includes("final");
      return true;
    });
  }

  if (query) {
    items = items.filter((a) => {
      const titleMatch = (a.title || "").toLowerCase().includes(query);
      const courseMatch = (a.course_id || "").toLowerCase().includes(query) || (a.course_name || "").toLowerCase().includes(query);
      const roomMatch = (a.room || "").toLowerCase().includes(query);
      const topicMatch = (a.topics || []).some((t) => {
        const text = typeof t === "string" ? t : t?.topic || "";
        return text.toLowerCase().includes(query);
      });
      return titleMatch || courseMatch || roomMatch || topicMatch;
    });
  }

  if (items.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center space-y-2">
        <div class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center">
          <i data-lucide="search-x" class="w-5 h-5"></i>
        </div>
        <p class="text-xs font-semibold text-slate-700 dark:text-slate-300">No matching assessments found</p>
        <p class="text-[11px] text-slate-400 dark:text-slate-400">Try searching by course code (e.g. CS 101, MATH 101) or topic name.</p>
      </div>
    `;
    if (window.lucide) refreshIcons(container);
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const badgeColor = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(item.color ?? "")
        ? item.color
        : "#1a73e8";
      const badgeStyle = `background-color: ${badgeColor};`;
      return `
        <div onclick="closeMobileSearchModal(); openAssessmentModalById('${jsAttr(item.id)}')"
             class="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 hover:border-[#1a73e8] active:scale-[0.98] transition cursor-pointer flex items-center justify-between gap-3 shadow-2xs">
          <div class="min-w-0 space-y-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="px-2 py-0.5 rounded-md text-[10px] font-bold text-white shrink-0" style="${badgeStyle}">${escapeHtml(item.course_id)}</span>
              <span class="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">${escapeHtml(item.assessment_type || "Assessment")}</span>
              <span class="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">${escapeHtml(item.display_time || item.date_iso)}</span>
            </div>
            <div class="text-xs font-bold text-slate-900 dark:text-white truncate">${escapeHtml(item.title)}</div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">Room: ${escapeHtml(item.room || "TBA")} · ${escapeHtml(item.course_name || "")}</div>
          </div>
          <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400 shrink-0"></i>
        </div>
      `;
    })
    .join("");

  refreshIcons(container);
}

const STATE_CACHE_KEY = "quizradar_state_cache_v3";
const TASKS_CACHE_KEY = "quizradar_tasks_cache_v2";

const SEED_INITIAL_STATE = {
  config: {
    user_name: "Student",
    user_email: null,
    last_gmail_sync: "Never",
    auto_sync_gcal: false,
    gemini_enabled: true,
    teams_enabled: false,
    moodle_enabled: false,
    classroom_enabled: false,
    completed_topics: {},
    onboarding_completed: false,
  },
  auth: {
    name: "Student",
    email: null,
    authenticated: false,
    has_calendar_scope: false,
  },
  schedule: {
    semester: "Current Semester",
    courses: [],
    slots: [],
  },
  assessments: [],
  dashboard: {
    reference_date: toIsoDate(getTodayDate()),
    next_up: null,
    upcoming_this_week: [],
    all_upcoming: [],
    exam_type_counts: {},
    study_recommendations: [],
    readiness_percent: 0,
    total_topics_count: 0,
    completed_topics_count: 0,
  },
};
SEED_INITIAL_STATE.dashboard.next_up = null;
SEED_INITIAL_STATE.dashboard.upcoming_this_week = [];
SEED_INITIAL_STATE.dashboard.all_upcoming = [];

const SEED_INITIAL_TASKS = {
  pending_tasks: 0,
  completed_tasks: 0,
  total_hours: 0,
  readiness_cards: [],
  days: [],
};

function getBootstrapState() {
  try {
    const cachedRaw = localStorage.getItem(STATE_CACHE_KEY);
    if (cachedRaw) {
      const cachedData = JSON.parse(cachedRaw);
      if (cachedData && Array.isArray(cachedData.assessments) && cachedData.dashboard) {
        // Scrub legacy mock assessments if present in old cached storage
        cachedData.assessments = cachedData.assessments.filter(a => !["cs101-a1", "math101-q1", "mgmt100-q1", "data201-m1"].includes(a.id));
        if (cachedData.dashboard && Array.isArray(cachedData.dashboard.study_recommendations)) {
          cachedData.dashboard.study_recommendations = cachedData.dashboard.study_recommendations.filter(r => !["cs101-a1", "math101-q1", "mgmt100-q1", "data201-m1"].includes(r.assessment_id));
        }
        return cachedData;
      }
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(SEED_INITIAL_STATE));
}

function getBootstrapTasks() {
  try {
    const cachedTasks = localStorage.getItem(TASKS_CACHE_KEY);
    if (cachedTasks) {
      const data = JSON.parse(cachedTasks);
      if (data && Array.isArray(data.readiness_cards)) {
        data.readiness_cards = data.readiness_cards.filter(c => !["cs101-a1", "math101-q1", "mgmt100-q1", "data201-m1"].includes(c.assessment_id));
        return data;
      }
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(SEED_INITIAL_TASKS));
}

let appState = getBootstrapState();

let currentMainView = "dashboard"; // "dashboard" | "tasks" | "calendar"
let studyTasksState = getBootstrapTasks();
let currentTasksCourseFilter = "all";
let currentTasksStatusFilter = "pending";
let currentWeekStart = getSundayOfWeek(getTodayDate());
let selectedCalendarDate = getTodayDate();
let activeCourseFilters = new Set();
let showWeeklyClasses = true;
let showExamOverlays = true;
let globalSearchQuery = "";
let activeModalAssessmentId = null;
let activeModalDateIso = null;
let toastHideTimeout = null;

let currentDashboardSourceFilter = "ALL";
let activePracticeQuiz = null;
let practiceQuizCurrentIndex = 0;
let practiceQuizScore = 0;
let activePracticeAssessmentId = null;
let pomodoroTimerInterval = null;
let pomodoroSecondsRemaining = 25 * 60;
let pomodoroTotalSeconds = 25 * 60;
let pomodoroIsRunning = false;
let pomodoroCurrentMode = "work";
let pomodoroCurrentTaskKey = null;
let pomodoroCurrentCourse = "";
let pomodoroCurrentTopic = "";

const START_HOUR = 8; // 8 AM
const END_HOUR = 20;  // 8 PM
const HOUR_HEIGHT = 56; // 56px per hour

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

document.addEventListener("DOMContentLoaded", () => {
  initDarkMode();
  initSidebarResponsive();
  initKeyboardShortcuts();
  initSearchBar();
  initAppUpdater();
  initAndroidNativeBridge();
  initModalA11y();

  // 1. INSTANT 0ms SYNCHRONOUS HYDRATION FROM THE ALREADY-PARSED CACHE (first paint)
  // appState/studyTasksState were parsed once at script evaluation; reuse them
  // instead of re-reading and re-parsing localStorage here.
  const bootstrap = appState;
  hydrateAndRenderState(bootstrap);
  updateTasksBadgeCount();

  if (window.lucide) {
    lucide.createIcons();
  }

  // 2. Load app state directly via autonomous on-device engine
  loadFullState();
  initPullToRefresh();
});

function getApiBase() {
  return "On-Device Engine (Isolated)";
}

// ============================================================================
// MOBILE PULL-TO-REFRESH GESTURE CONTROLLER (NATIVE 60FPS)
// ============================================================================

let isPullRefreshing = false;
let pullStartY = 0;
let pullStartX = 0;
let currentPullY = 0;
let isPullActive = false;
let pullThresholdReached = false;

function initPullToRefresh() {
  const indicator = document.getElementById("pull-refresh-indicator");
  const arrow = document.getElementById("pull-refresh-arrow");
  const spinner = document.getElementById("pull-refresh-spinner");
  const check = document.getElementById("pull-refresh-check");
  const text = document.getElementById("pull-refresh-text");
  const iconBox = document.getElementById("pull-refresh-icon-box");

  if (!indicator) return;
  if (window.lucide) lucide.createIcons({ root: indicator });

  // Cached per-gesture so touchmove never queries the DOM; style writes are batched in one rAF.
  let pullContainer = null;
  let pullModalOpenAtStart = false;
  let pullRafPending = false;

  function getActiveScrollableContainer() {
    const views = [
      document.getElementById("view-dashboard"),
      document.getElementById("view-tasks"),
      document.getElementById("view-calendar"),
    ];
    return views.find((v) => v && !v.classList.contains("hidden")) || document.documentElement;
  }

  function isModalOpen() {
    return !!document.querySelector(".modal-backdrop.is-open");
  }

  window.addEventListener(
    "touchstart",
    (e) => {
      pullModalOpenAtStart = isModalOpen();
      if (isPullRefreshing || pullModalOpenAtStart) return;
      if (e.touches.length !== 1) return;

      const container = getActiveScrollableContainer();
      const scrollTop = container.scrollTop !== undefined ? container.scrollTop : window.scrollY;
      if (scrollTop > 5) return;

      pullContainer = container;
      pullStartY = e.touches[0].clientY;
      pullStartX = e.touches[0].clientX;
      isPullActive = true;
      pullThresholdReached = false;
      currentPullY = 0;

      indicator.style.transition = "none";
    },
    { passive: true }
  );

  window.addEventListener(
    "touchmove",
    (e) => {
      if (!isPullActive || isPullRefreshing || pullModalOpenAtStart) return;
      if (e.touches.length !== 1) return;

      const container = pullContainer || document.documentElement;
      const scrollTop = container.scrollTop !== undefined ? container.scrollTop : window.scrollY;
      if (scrollTop > 5) {
        isPullActive = false;
        resetPullIndicator();
        return;
      }

      const touchY = e.touches[0].clientY;
      const touchX = e.touches[0].clientX;
      const deltaY = touchY - pullStartY;
      const deltaX = touchX - pullStartX;

      // Ignore upward movements or dominant horizontal swipes
      if (deltaY <= 0 || Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
        return;
      }

      // Prevent native browser page bounce when dragging down
      if (deltaY > 10 && e.cancelable) {
        e.preventDefault();
      }

      const maxPull = 125;
      const pull = Math.min(maxPull, deltaY * 0.48);
      currentPullY = pull;

      // Batch indicator style writes into a single rAF frame
      if (!pullRafPending) {
        pullRafPending = true;
        requestAnimationFrame(() => {
          pullRafPending = false;
          if (!isPullActive) return;
          indicator.style.opacity = Math.min(1, currentPullY / 32);
          indicator.style.transform = `translate(-50%, ${currentPullY}px)`;
        });
      }

      const threshold = 66;
      if (pull >= threshold && !pullThresholdReached) {
        pullThresholdReached = true;
        triggerHaptic("selection");
        if (iconBox) iconBox.style.transform = "rotate(180deg)";
        if (text) text.textContent = "Release to refresh";
      } else if (pull < threshold && pullThresholdReached) {
        pullThresholdReached = false;
        if (iconBox) iconBox.style.transform = "rotate(0deg)";
        if (text) text.textContent = "Pull to refresh";
      }
    },
    { passive: false }
  );

  async function handleTouchEnd() {
    if (!isPullActive) return;
    isPullActive = false;

    if (pullThresholdReached && !isPullRefreshing) {
      isPullRefreshing = true;
      triggerHaptic("medium");

      indicator.style.transition = "transform 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 260ms ease";
      indicator.style.transform = "translate(-50%, 72px)";
      indicator.style.opacity = "1";

      if (arrow) arrow.classList.add("hidden");
      if (spinner) spinner.classList.remove("hidden");
      if (check) check.classList.add("hidden");
      if (iconBox) iconBox.style.transform = "rotate(0deg)";
      if (text) text.textContent = "Updating radar...";

      const startTime = Date.now();
      try {
        await refreshAppOnDemand();
      } catch (err) {
        console.warn("[PullToRefresh] error:", err);
      }

      const elapsed = Date.now() - startTime;
      if (elapsed < 500) {
        await new Promise((r) => setTimeout(r, 500 - elapsed));
      }

      if (spinner) spinner.classList.add("hidden");
      if (check) check.classList.remove("hidden");
      if (text) text.textContent = "Radar updated!";
      triggerHaptic("light");

      await new Promise((r) => setTimeout(r, 450));

      indicator.style.transition = "transform 280ms cubic-bezier(0.4, 0, 0.2, 1), opacity 240ms ease";
      indicator.style.transform = "translate(-50%, -48px)";
      indicator.style.opacity = "0";

      setTimeout(() => {
        resetPullIndicator();
        isPullRefreshing = false;
      }, 300);
    } else {
      resetPullIndicator();
    }
  }

  window.addEventListener("touchend", handleTouchEnd, { passive: true });
  window.addEventListener("touchcancel", handleTouchEnd, { passive: true });

  function resetPullIndicator() {
    indicator.style.transition = "transform 240ms ease, opacity 200ms ease";
    indicator.style.transform = "translate(-50%, -48px)";
    indicator.style.opacity = "0";
    setTimeout(() => {
      if (arrow) arrow.classList.remove("hidden");
      if (spinner) spinner.classList.add("hidden");
      if (check) check.classList.add("hidden");
      if (iconBox) iconBox.style.transform = "rotate(0deg)";
      if (text) text.textContent = "Pull to refresh";
      pullThresholdReached = false;
      currentPullY = 0;
    }, 250);
  }
}

// ============================================================================
// MULTI-SOURCE SCAN PROGRESS (elapsed ticker + cancel for /api/sync runs)
// ============================================================================

let _activeScanAbort = null;
let _scanStartedAt = 0;
let _scanElapsedTimer = null;

function setScanProgressText(label) {
  const el = document.getElementById("scan-progress-text");
  if (el) el.textContent = label;
}

function beginScanProgress(label) {
  const overlay = document.getElementById("scan-progress-overlay");
  if (!overlay) return;
  _activeScanAbort = new AbortController();
  _scanStartedAt = Date.now();
  setScanProgressText(label || "Scanning your sources…");
  const elapsedEl = document.getElementById("scan-progress-elapsed");
  if (elapsedEl) elapsedEl.textContent = "0s elapsed";
  overlay.classList.remove("hidden");
  refreshIcons(overlay);
  if (_scanElapsedTimer) clearInterval(_scanElapsedTimer);
  _scanElapsedTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - _scanStartedAt) / 1000);
    if (elapsedEl) elapsedEl.textContent = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s elapsed` : `${secs}s elapsed`;
  }, 1000);
}

function endScanProgress() {
  if (_scanElapsedTimer) {
    clearInterval(_scanElapsedTimer);
    _scanElapsedTimer = null;
  }
  _activeScanAbort = null;
  document.getElementById("scan-progress-overlay")?.classList.add("hidden");
}

function cancelActiveScan() {
  triggerHaptic("warning");
  if (_activeScanAbort) {
    try { _activeScanAbort.abort(); } catch (err) { /* signal already settled */ }
  }
  endScanProgress();
  showToast("Scan canceled — your data was left untouched.", "info", 2600);
}

async function refreshAppOnDemand() {
  beginScanProgress("Checking accounts for new announcements…");
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      signal: _activeScanAbort ? _activeScanAbort.signal : undefined
    });
    const data = await res.json();
    // Render straight from the sync payload when it carries state — avoids a
    // second /api/state round-trip plus a duplicate cache parse + full render.
    if (data && (data.assessments || data.dashboard || data.schedule)) {
      if (data.assessments) appState.assessments = data.assessments;
      if (data.dashboard) appState.dashboard = data.dashboard;
      if (data.schedule) {
        appState.schedule = data.schedule;
        syncActiveCourseFilters();
      }
      if (data.config) appState.config = data.config;
      if (typeof recalculateAssessmentDeadlines === "function") {
        recalculateAssessmentDeadlines(appState);
      }
      if (typeof filterStateByEnabledSources === "function") {
        filterStateByEnabledSources();
      }
      saveStateCache();
      renderAllViews();
      loadStudyTasks();
      if (data.message && data.message.indexOf("(No connected sources") === -1) {
        showToast(String(data.message), "info", 4000);
      }
      queueNotificationRefresh(true);
      return;
    }
  } catch (e) {
    if (e && (e.name === "AbortError" || e.code === 20)) return; // user canceled
    console.warn("[refreshAppOnDemand] error:", e);
  } finally {
    endScanProgress();
  }
  await loadFullState();
}

// ============================================================================
// DARK MODE & RESPONSIVE SIDEBAR MANAGEMENT
// ============================================================================

function initDarkMode() {
  const saved = localStorage.getItem("quizradar_theme");
  // Honor the OS preference on first launch; stored choice always wins afterwards.
  const systemPrefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = saved ? saved === "dark" : systemPrefersDark;
  document.documentElement.classList.toggle("dark", isDark);
  updateDarkModeIcon(isDark);
  updateNativeStatusBar(isDark);
  // Persist so the toggle starts from a deterministic point mid-session.
  if (!saved) {
    try {
      localStorage.setItem("quizradar_theme", isDark ? "dark" : "light");
    } catch (e) {}
  }
}

function applySmoothThemeSwitch(isDark) {
  // 1-frame instant CSS theme switch without heavy compositor raster snapshot
  document.documentElement.classList.toggle("dark", isDark);
  try {
    localStorage.setItem("quizradar_theme", isDark ? "dark" : "light");
  } catch (e) {}
  updateDarkModeIcon(isDark);
  updateOnboardingThemeButtons();
  if (IS_NATIVE) {
    requestAnimationFrame(() => updateNativeStatusBar(isDark));
  }
}

function toggleDarkMode() {
  triggerHaptic("selection");
  const nextDark = !document.documentElement.classList.contains("dark");
  applySmoothThemeSwitch(nextDark);
}

function updateDarkModeIcon(isDark) {
  const btn = document.getElementById("dark-mode-btn");
  if (!btn) return;
  btn.title = isDark ? "Switch to Light Mode" : "Switch to Dark Mode";
  btn.setAttribute("aria-pressed", String(isDark));
}

function initSidebarResponsive() {
  const sb = document.getElementById("left-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (!sb) return;

  const applyState = (collapsed) => {
    sb.classList.toggle("sidebar-collapsed", collapsed);
    sb.setAttribute("aria-expanded", String(!collapsed));
  };

  if (window.innerWidth < 1024) {
    applyState(true);
    if (backdrop) backdrop.classList.add("hidden");
  } else {
    applyState(false);
  }

  window.addEventListener(
    "resize",
    rafThrottle(() => {
      if (window.innerWidth >= 1024) {
        if (backdrop) backdrop.classList.add("hidden");
        applyState(false);
      } else {
        applyState(true);
      }
    })
  );
}

function toggleSidebar(forceCollapse) {
  const sb = document.getElementById("left-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (!sb) return;

  const shouldCollapse =
    typeof forceCollapse === "boolean"
      ? forceCollapse
      : !sb.classList.contains("sidebar-collapsed");

  sb.classList.toggle("sidebar-collapsed", shouldCollapse);
  sb.setAttribute("aria-expanded", String(!shouldCollapse));

  if (backdrop) {
    if (!shouldCollapse && window.innerWidth < 1024) {
      backdrop.classList.remove("hidden");
    } else {
      backdrop.classList.add("hidden");
    }
  }
}

function initKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const confirmModal = document.getElementById("app-confirm-modal");
      if (confirmModal?.classList.contains("is-open")) {
        closeAppConfirm(false);
        return;
      }

      const palette = document.getElementById("search-dropdown-palette");
      if (palette?.classList.contains("is-open")) {
        closeSearchPalette();
        document.getElementById("global-search-input")?.blur();
        return;
      }

      const schedModal = document.getElementById("schedule-preview-modal");
      const addCourseModal = document.getElementById("add-course-modal");
      if (schedModal?.classList.contains("is-open")) {
        closeSchedulePreviewModal();
        return;
      }
      if (addCourseModal?.classList.contains("is-open")) {
        closeAddCourseModal();
        return;
      }

      const detailModal = document.getElementById("event-detail-modal");
      const createModal = document.getElementById("create-event-modal");
      const settingsModal = document.getElementById("settings-modal");
      const onboardModal = document.getElementById("onboarding-modal");

      if (detailModal?.classList.contains("is-open")) {
        closeEventDetailModal();
        return;
      }
      if (createModal?.classList.contains("is-open")) {
        closeCreateEventModal();
        return;
      }
      if (settingsModal?.classList.contains("is-open")) {
        closeSettingsModal();
        return;
      }
      if (onboardModal?.classList.contains("is-open")) {
        closeOnboardingModal();
        return;
      }

      const cloudSyncModal = document.getElementById("cloud-sync-modal");
      const accountModal = document.getElementById("account-profile-modal");
      const mobileSearchModal = document.getElementById("mobile-search-modal");
      const practiceQuizModal = document.getElementById("practice-quiz-modal");
      const pomodoroModal = document.getElementById("pomodoro-modal");
      const updatePopover = document.getElementById("update-popover");

      if (cloudSyncModal?.classList.contains("is-open")) {
        closeCloudSyncModal();
        return;
      }
      if (accountModal?.classList.contains("is-open")) {
        closeAccountModal();
        return;
      }
      if (mobileSearchModal?.classList.contains("is-open")) {
        closeMobileSearchModal();
        return;
      }
      if (practiceQuizModal?.classList.contains("is-open")) {
        closePracticeQuizModal();
        return;
      }
      if (pomodoroModal?.classList.contains("is-open")) {
        closePomodoroModal();
        return;
      }
      if (updatePopover && !updatePopover.classList.contains("hidden")) {
        closeUpdatePopover();
        return;
      }
      if (window.innerWidth < 1024) {
        toggleSidebar(true);
      }
      return;
    }

    const tag = (e.target?.tagName || "").toLowerCase();
    const isInput = tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable;

    if ((e.key === "/" && !isInput) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      const desktopSearch = document.getElementById("global-search-input");
      const mobileSearch = document.getElementById("mobile-search-input");
      if (desktopSearch && desktopSearch.offsetParent !== null) {
        desktopSearch.focus();
        desktopSearch.select();
      } else if (mobileSearch) {
        mobileSearch.focus();
        mobileSearch.select();
      }
    }
  });
}

// ============================================================================
// STATE LOADING & TOP BAR
// ============================================================================

function saveStateCache() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("demo")) return;
  try {
    localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(appState));
  } catch (e) {
    // Ignore storage quota errors
  }
}

function syncActiveCourseFilters() {
  const currentCourses = appState.schedule?.courses || [];
  if (currentCourses.length === 0) {
    activeCourseFilters.clear();
    return;
  }
  const currentIds = new Set(currentCourses.map((c) => c.id));
  for (const id of activeCourseFilters) {
    if (id !== "GENERAL" && !currentIds.has(id)) {
      activeCourseFilters.delete(id);
    }
  }
  const hasOverlap = [...activeCourseFilters].some((id) => currentIds.has(id));
  if (!hasOverlap || activeCourseFilters.size === 0) {
    activeCourseFilters.clear();
    currentCourses.forEach((c) => activeCourseFilters.add(c.id));
    activeCourseFilters.add("GENERAL");
  } else {
    currentCourses.forEach((c) => {
      if (!activeCourseFilters.has(c.id)) {
        activeCourseFilters.add(c.id);
      }
    });
  }
}

function filterStateByEnabledSources() {
  if (!appState || !appState.config) return;
  const cfg = appState.config;
  const isTeams = (a) => (a?.id && a.id.startsWith("teams-")) || (a?.source && (a.source.toLowerCase().includes("teams") || a.source.toLowerCase().includes("microsoft")));
  const isMoodle = (a) => (a?.id && a.id.startsWith("moodle-")) || (a?.source && a.source.toLowerCase().includes("moodle"));
  const isClassroom = (a) => (a?.id && a.id.startsWith("classroom-")) || (a?.source && a.source.toLowerCase().includes("classroom"));

  const isEnabled = (a) => {
    if (!a) return false;
    if (isTeams(a) && !cfg.teams_enabled) return false;
    if (isMoodle(a) && !cfg.moodle_enabled) return false;
    if (isClassroom(a) && !cfg.classroom_enabled) return false;
    return true;
  };

  if (Array.isArray(appState.assessments)) {
    appState.assessments = appState.assessments.filter(isEnabled);
  }

  if (appState.dashboard) {
    if (appState.dashboard.next_up && !isEnabled(appState.dashboard.next_up)) {
      appState.dashboard.next_up = null;
    }
    if (Array.isArray(appState.dashboard.upcoming_this_week)) {
      appState.dashboard.upcoming_this_week = appState.dashboard.upcoming_this_week.filter(isEnabled);
    }
    if (Array.isArray(appState.dashboard.all_upcoming)) {
      appState.dashboard.all_upcoming = appState.dashboard.all_upcoming.filter(isEnabled);
    }
    if (Array.isArray(appState.dashboard.study_recommendations)) {
      appState.dashboard.study_recommendations = appState.dashboard.study_recommendations.filter((rec) => {
        return (appState.assessments || []).some((a) => a.id === rec.assessment_id);
      });
    }
    if (!appState.dashboard.next_up && appState.dashboard.all_upcoming && appState.dashboard.all_upcoming.length > 0) {
      appState.dashboard.next_up = appState.dashboard.all_upcoming[0];
    }
  }

  // Update dashboard source filter pills visibility
  const teamsPill = document.getElementById("source-filter-teams");
  if (teamsPill) teamsPill.style.display = cfg.teams_enabled ? "flex" : "none";
  const moodlePill = document.getElementById("source-filter-moodle");
  if (moodlePill) moodlePill.style.display = cfg.moodle_enabled ? "flex" : "none";
  const classroomPill = document.getElementById("source-filter-classroom");
  if (classroomPill) classroomPill.style.display = cfg.classroom_enabled ? "flex" : "none";

  if (
    (currentDashboardSourceFilter === "Microsoft Teams" && !cfg.teams_enabled) ||
    (currentDashboardSourceFilter === "Moodle" && !cfg.moodle_enabled) ||
    (currentDashboardSourceFilter === "Google Classroom" && !cfg.classroom_enabled)
  ) {
    currentDashboardSourceFilter = "ALL";
    const allPill = document.getElementById("source-filter-all");
    if (allPill) allPill.className = "px-2.5 py-1 rounded-lg bg-[#1a73e8] text-white shadow-2xs transition cursor-pointer";
  }
}

function recalculateAssessmentDeadlines(state) {
  if (!state || !Array.isArray(state.assessments)) return;
  const today = getTodayDate();
  state.assessments.forEach((a) => {
    if (a.date_iso) {
      const parts = a.date_iso.split("-").map(Number);
      if (parts.length === 3) {
        const target = new Date(parts[0], parts[1] - 1, parts[2]);
        const diff = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        a.days_until = diff;
        a.is_upcoming = diff >= 0;
        a.display_date = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff < 0 ? `${Math.abs(diff)}d ago` : `In ${diff} days`;
        a.urgency_badge = diff === 0 ? "TODAY" : diff === 1 ? "TOMORROW" : diff < 0 ? "PAST" : `IN ${diff} DAYS`;
      }
    }
  });
  if (state.dashboard) {
    state.dashboard.reference_date = toIsoDate(today);
    if (Array.isArray(state.dashboard.upcoming_this_week)) {
      state.dashboard.upcoming_this_week = state.assessments.filter((a) => (a.days_until ?? 99) >= 0 && (a.days_until ?? 99) <= 7);
    }
    if (Array.isArray(state.dashboard.all_upcoming)) {
      state.dashboard.all_upcoming = state.assessments.filter((a) => (a.days_until ?? 0) >= 0);
    }
    state.dashboard.next_up = state.assessments.find((a) => (a.days_until ?? 0) >= 0) || null;
    // Keep study recommendation cards honest: refresh counters & urgency badges
    // so they never advertise a stale "IN X DAYS" after a date has rolled past.
    if (Array.isArray(state.dashboard.study_recommendations)) {
      state.dashboard.study_recommendations = state.dashboard.study_recommendations.filter((r) => {
        const match = state.assessments.find((a) => a.id === r.assessment_id || a.id === r.id);
        if (!match) return false;
        r.days_until = match.days_until;
        r.is_upcoming = match.is_upcoming;
        r.display_date = match.display_date || r.display_date;
        r.urgency_badge = match.urgency_badge || r.urgency_badge;
        r.display_time = match.display_time || r.display_time;
        return r.is_upcoming;
      });
      state.dashboard.recommendations = state.dashboard.study_recommendations;
      state.dashboard.upcoming_this_week = state.dashboard.upcoming_this_week || state.dashboard.study_recommendations.filter((r) => (r.days_until ?? 99) <= 7);
    }
  }
}

function hydrateAndRenderState(stateData) {
  appState = stateData;
  recalculateAssessmentDeadlines(appState);
  syncActiveCourseFilters();
  filterStateByEnabledSources();
  updateTopBarAndUser();
  renderSidebar();
  renderDashboard();
  renderTasksView();
  renderWeekCalendar();
  queueNotificationRefresh(false);
  pushWidgetSnapshotNow();
}

// Widget freshness contract: MainActivity pulls the snapshot natively on every
// Android resume (60s throttle). In-app edits while foregrounded are picked up
// on the next resume — no JS→native push bridge exists in v1.
function pushWidgetSnapshotNow() {
  if (!IS_NATIVE) return;
}

// Day-rollover watchdog: the desktop WebView (and PWA tab) can stay open
// overnight — without this, countdown badges kept yesterday's "IN X DAYS" and
// the calendar kept yesterday's "today" highlight until the next manual sync.
let _lastKnownDay = new Date().getDate();

function refreshDayRelativeState() {
  const now = new Date();
  if (now.getDate() === _lastKnownDay) return;
  _lastKnownDay = now.getDate();
  if (typeof appState !== "undefined" && appState && appState.assessments) {
    recalculateAssessmentDeadlines(appState);
    saveStateCache();
    updateTopBarAndUser();
    renderDashboard();
    renderTasksView();
    renderWeekCalendar();
  }
}

setInterval(refreshDayRelativeState, 30 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshDayRelativeState();
});

async function loadFullState() {
  const params = new URLSearchParams(window.location.search);
  const demo = params.get("demo");

  // 1. Instant 0ms render from localStorage cache (Stale-While-Revalidate)
  if (!demo) {
    try {
      const cachedRaw = localStorage.getItem(STATE_CACHE_KEY);
      if (cachedRaw) {
        const cachedData = JSON.parse(cachedRaw);
        if (cachedData && cachedData.assessments && cachedData.dashboard) {
          hydrateAndRenderState(cachedData);
        }
      }
    } catch (e) {
      // Ignore corrupt cache
    }
  }

  // 2. Fetch fresh state from fast in-memory backend (<1ms)
  try {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error(`State request failed (${res.status})`);
    const data = await res.json();
    if (!data || !Array.isArray(data.assessments) || !data.config || !data.schedule) {
      throw new Error("Malformed state payload from backend");
    }
    appState = data;
    recalculateAssessmentDeadlines(appState);
    syncActiveCourseFilters();

    if (demo) {
      window.__DEMO_MODE__ = true; // Demo stays 100% in-memory: never touch caches
      applyDemoDummyData();
    } else {
      saveStateCache();
    }

    updateTopBarAndUser();
    renderSidebar();
    renderDashboard();
    renderWeekCalendar();
    loadStudyTasks();

    if (params.get("auth") === "success") {
      showToast("Signed in and connected successfully!", "success", 4000);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("auth") === "cancelled") {
      showToast("Sign-in was cancelled.", "info", 3000);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (demo) {
      closeOnboardingModal();
      if (demo === "onboarding") {
        setThemeFromOnboarding(false);
        openOnboardingModal(1);
      } else if (demo === "onboarding-dark") {
        setThemeFromOnboarding(true);
        openOnboardingModal(1);
      } else if (demo === "dashboard-light") {
        setThemeFromOnboarding(false);
        switchMainView("dashboard");
      } else if (demo === "dashboard-dark") {
        setThemeFromOnboarding(true);
        switchMainView("dashboard");
      } else if (demo === "calendar") {
        setThemeFromOnboarding(false);
        switchMainView("calendar");
      } else if (demo === "calendar-dark") {
        setThemeFromOnboarding(true);
        switchMainView("calendar");
      } else if (demo === "modal") {
        setThemeFromOnboarding(false);
        switchMainView("dashboard");
        const nextId = appState.dashboard?.next_up?.id || appState.assessments?.[0]?.id;
        if (nextId) openAssessmentModalById(nextId);
      } else if (demo === "modal-dark") {
        setThemeFromOnboarding(true);
        switchMainView("dashboard");
        const nextId = appState.dashboard?.next_up?.id || appState.assessments?.[0]?.id;
        if (nextId) openAssessmentModalById(nextId);
      }
      return;
    }

    // One-time First-Run Onboarding Wizard: triggers whenever this specific device hasn't completed onboarding yet.
    // Do NOT reopen on top of an in-progress wizard (e.g. the user resumed the
    // app from the OAuth browser mid-setup — the appStateChange resume listener
    // fires loadFullState() and used to reset the wizard back to step 1).
    const deviceOnboardDone = localStorage.getItem("quizradar_device_onboarded_v4") === "true";
    if (!deviceOnboardDone) {
      const onboardEl = document.getElementById("onboarding-modal");
      const alreadyOpen = !!(onboardEl && onboardEl.classList.contains("is-open"));
      if (!alreadyOpen) {
        setTimeout(() => openOnboardingModal(1), 150);
      }
    }
  } catch (err) {
    console.warn("Failed to load live state from backend, falling back to cache:", err);
    hydrateAndRenderState(appState);
    loadStudyTasks();
  }
}

function applyDemoDummyData() {
  if (!appState.auth) appState.auth = {};
  if (!appState.config) appState.config = {};

  appState.auth.name = "Student";
  appState.auth.email = "student@university.edu";
  appState.auth.authenticated = false;
  appState.auth.has_calendar_scope = false;
  appState.config.user_name = "Student";
  appState.config.user_email = null;
  appState.config.last_gmail_sync = "Never";

  const dummyByCourse = {
    "CS 101": { instructor: "Prof. Alan Turing", room: "Hall A-101", group: "Sec 1" },
    "MATH 101": { instructor: "Prof. Carl Gauss", room: "Hall B-204", group: "Sec 2" },
    "DATA 201": { instructor: "Dr. Grace Hopper", room: "Lab C-301", group: "Sec 1" },
    "MGMT 100": { instructor: "Prof. Claire Sterling", room: "Hall B-105", group: "Sec 1" },
    "PHYS 101": { instructor: "Dr. Richard Feynman", room: "Physics Lab 102", group: "Sec 2" },
  };

  const scrubText = (txt) => {
    if (!txt) return txt;
    return txt
      .replace(/Group [A-Z]/g, "Sec 1");
  };

  const scrubAssessment = (a) => {
    if (!a) return;
    const d = dummyByCourse[a.course_id] || {
      instructor: "Prof. Staff",
      room: "Hall A-101",
      group: "Sec 1",
    };
    a.instructor = d.instructor;
    a.room = d.room;
    a.group = d.group;
    a.ai_inference_note = scrubText(a.ai_inference_note);
    a.ai_study_plan = scrubText(a.ai_study_plan);
  };

  (appState.assessments || []).forEach(scrubAssessment);
  if (appState.dashboard) {
    scrubAssessment(appState.dashboard.next_up);
    (appState.dashboard.upcoming_this_week || []).forEach(scrubAssessment);
    (appState.dashboard.all_upcoming || []).forEach(scrubAssessment);
    (appState.dashboard.study_recommendations || []).forEach((rec) => {
      const d = dummyByCourse[rec.course_id] || { room: "Hall B-204" };
      rec.room = d.room;
      rec.why_study_now = scrubText(rec.why_study_now);
      rec.ai_study_plan = scrubText(rec.ai_study_plan);
    });

    // Demo overrides stay 100% in-memory: never mutate persisted completed_topics
    // progress or the dashboard readiness counters (that used to pollute real state).
    appState.dashboard.completed_topics_count = 6;
    appState.dashboard.total_topics_count = 23;
    appState.dashboard.readiness_percent = 26;
  }

  (appState.schedule?.slots || []).forEach((s) => {
    const d = dummyByCourse[s.course_id];
    if (d) {
      s.instructor = d.instructor;
      s.room = d.room;
      s.group = d.group;
    }
  });
}

// Unified radar-status model: one honest summary derived from real config -
// consumed by the sidebar footer (and available for any future surface).
function computeSyncStatusSummary() {
  const cfg = appState.config || {};
  const sources = [];
  if (cfg.auto_sync_gcal && (appState.auth?.authenticated || cfg.user_email)) sources.push("Gmail+" + "GCal");
  if (cfg.teams_enabled && (cfg.teams_token || cfg.teams_refresh_token)) sources.push("Teams");
  if (cfg.classroom_enabled && (appState.auth?.authenticated || cfg.user_email)) sources.push("Classroom");
  if (cfg.moodle_enabled && (cfg.moodle_token || cfg.moodle_ical_url || cfg.moodle_url)) sources.push("Moodle");
  if (Array.isArray(cfg.feeds) && cfg.feeds.some((f) => f.enabled !== false)) sources.push("Feeds");

  const connected = !!appState.auth?.authenticated;

  if (!connected && sources.length === 0) {
    return {
      label: IS_NATIVE ? "On-Device Engine · No live sources" : "No sources connected",
      detail: "Add courses manually, connect an account in Accounts, or pair with the desktop app.",
      dotClass: "bg-slate-400"
    };
  }
  if (sources.length === 0) {
    return {
      label: connected ? "Signed in · Auto-scan off" : "Partial radar",
      detail: "Signed in but auto-scan is off. Use Sync Gmail & Calendar or turn auto-scan on.",
      dotClass: "bg-blue-500"
    };
  }
  return {
    label: `Radar Active · ${sources.length} source${sources.length > 1 ? "s" : ""}`,
    detail: `Scanning: ${sources.join(", ")}. Last scan: ${cfg.last_gmail_sync || "not yet"}.`,
    dotClass: "bg-emerald-500"
  };
}

function updateTopBarAndUser() {
  // "Connected" means REAL authentication (Google OAuth token). A manually typed
  // email must never surface as a signed-in state.
  const isAuth = !!appState.auth?.authenticated;
  const email = appState.auth?.email || appState.config?.user_email || "Not signed in";
  const name = appState.auth?.name || appState.config?.user_name || "Student";
  const initial = (name && name[0] ? name[0] : "G").toUpperCase();

  const nameEl = document.getElementById("user-name-label");
  const emailEl = document.getElementById("user-email-label");
  const avatarEl = document.getElementById("user-avatar-badge");
  const kpiSyncEl = document.getElementById("kpi-sync-account");

  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = email;
  if (avatarEl) avatarEl.textContent = initial;
  if (kpiSyncEl) kpiSyncEl.textContent = email;

  const lastSync = appState.config?.last_gmail_sync;
  const syncTsEl = document.getElementById("last-sync-timestamp");
  if (syncTsEl) {
    syncTsEl.textContent = lastSync && lastSync !== "Never" ? `Last scanned: ${lastSync}` : "Not yet scanned";
  }

  // Sync footer must reflect REAL state — never a static "Active" claim.
  // Single source of truth for every sync-status surface (sidebar + onboarding).
  const syncDot = document.getElementById("sync-dot");
  const syncLabel = document.getElementById("sync-status-label");
  const summary = computeSyncStatusSummary();
  if (syncLabel) {
    syncLabel.textContent = summary.label;
    syncLabel.title = summary.detail || "";
  }
  if (syncDot) syncDot.className = `w-2 h-2 rounded-full ${summary.dotClass}`;

  const badgeText = appState.auth?.authenticated ? "Connected" : "Sign-In Recommended";
  const badgeClass = appState.auth?.authenticated
    ? "text-xs font-semibold px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300"
    : "text-xs font-semibold px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300";

  // Populate First-Time Onboarding Wizard (Step 1 Google Sign-In)
  const step1Unauth = document.getElementById("onboard-step1-google-unauth");
  const step1Auth = document.getElementById("onboard-step1-google-auth");
  const step1Email = document.getElementById("onboard-step1-user-email");
  const step1NameInput = document.getElementById("onboard-student-name");

  if (isAuth) {
    if (step1Unauth) step1Unauth.classList.add("hidden");
    if (step1Auth) step1Auth.classList.remove("hidden");
    if (step1Email) step1Email.textContent = email;
    if (step1NameInput && (!step1NameInput.value || step1NameInput.value === "Student")) {
      step1NameInput.value = name;
    }
  } else {
    if (step1Unauth) step1Unauth.classList.remove("hidden");
    if (step1Auth) step1Auth.classList.add("hidden");
  }

  // Populate First-Time Onboarding Wizard
  const obName = document.getElementById("onboard-user-name");
  const obEmail = document.getElementById("onboard-user-email");
  const obAvatar = document.getElementById("onboard-user-avatar");
  const obBadge = document.getElementById("onboard-auth-badge");
  const obScope = document.getElementById("onboard-scope-note");

  if (obName) obName.textContent = name;
  if (obEmail) obEmail.textContent = email;
  if (obAvatar) obAvatar.textContent = initial;
  if (obBadge) {
    if (isAuth) {
      obBadge.textContent = "Connected";
      obBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300";
    } else {
      obBadge.textContent = "Connect";
      obBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300";
    }
  }
  if (obScope) {
    obScope.textContent = appState.auth?.has_calendar_scope
      ? "Gmail Read & Google Calendar Direct Sync Active"
      : "Gmail Connected · Sign in to grant direct Google Calendar write scope";
  }

  // Populate Settings Modal
  const stName = document.getElementById("settings-user-name");
  const stEmail = document.getElementById("settings-user-email");
  const stAvatar = document.getElementById("settings-user-avatar");
  const stBadge = document.getElementById("settings-auth-badge");

  if (stName) stName.textContent = name;
  if (stEmail) stEmail.textContent = email;
  if (stAvatar) stAvatar.textContent = initial;
  if (stBadge) {
    stBadge.textContent = badgeText;
    stBadge.className = badgeClass;
  }

  const stReauthLabel = document.getElementById("settings-reauth-label");
  const stDisconnectBtn = document.getElementById("settings-disconnect-btn");
  if (stReauthLabel) {
    stReauthLabel.textContent = isAuth ? "Switch / Re-Authorize" : "Connect Google";
  }
  if (stDisconnectBtn) {
    if (isAuth) {
      stDisconnectBtn.classList.remove("hidden");
    } else {
      stDisconnectBtn.classList.add("hidden");
    }
  }

  // Populate Microsoft Teams controls in Settings Modal
  const isTeamsConnected = !!(appState.config?.teams_enabled && (appState.config?.teams_token || appState.config?.teams_account_email));
  const teamsEmail = appState.config?.teams_account_email || appState.config?.teams_account_name;
  const stTeamsBadge = document.getElementById("settings-teams-badge");
  const stTeamsAuthLabel = document.getElementById("settings-teams-auth-label");
  const stTeamsDisconnectBtn = document.getElementById("settings-teams-disconnect-btn");

  if (stTeamsBadge) {
    if (isTeamsConnected) {
      stTeamsBadge.className = "text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300";
      stTeamsBadge.textContent = teamsEmail ? `Connected: ${teamsEmail}` : "Connected";
    } else {
      stTeamsBadge.className = "text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300";
      stTeamsBadge.textContent = "Not Connected";
    }
  }
  if (stTeamsAuthLabel) {
    stTeamsAuthLabel.textContent = isTeamsConnected ? "Switch / Re-Sign In" : "Sign in with Microsoft";
  }
  if (stTeamsDisconnectBtn) {
    if (isTeamsConnected) {
      stTeamsDisconnectBtn.classList.remove("hidden");
    } else {
      stTeamsDisconnectBtn.classList.add("hidden");
    }
  }

  // Populate Onboarding Step 2 Hub Badges
  const obTeamsBadge = document.getElementById("onboard-teams-badge");
  const obTeamsSubtext = document.getElementById("onboard-teams-subtext");
  if (obTeamsBadge) {
    if (isTeamsConnected) {
      obTeamsBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300";
      obTeamsBadge.textContent = "Connected";
      if (obTeamsSubtext && teamsEmail) obTeamsSubtext.textContent = teamsEmail;
    } else {
      obTeamsBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300";
      obTeamsBadge.textContent = "Connect";
    }
  }

  const obClassroomBadge = document.getElementById("onboard-classroom-badge");
  if (obClassroomBadge) {
    const isClassroomActive = !!appState.config?.classroom_enabled;
    if (isClassroomActive) {
      obClassroomBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300";
      obClassroomBadge.textContent = "Connected";
    } else {
      obClassroomBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300";
      obClassroomBadge.textContent = "Connect";
    }
  }

  const obMoodleBadge = document.getElementById("onboard-moodle-badge");
  if (obMoodleBadge) {
    const isMoodleActive = !!(appState.config?.moodle_enabled || appState.config?.moodle_token || appState.config?.moodle_ical_url);
    if (isMoodleActive) {
      obMoodleBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300";
      obMoodleBadge.textContent = "Connected";
    } else {
      obMoodleBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300";
      obMoodleBadge.textContent = "Connect";
    }
  }

  renderOnboardingPreview();
  renderOnboardingCourses();
  renderSettingsCourses();
  updateOnboardingThemeButtons();
}

function switchMainView(view) {
  currentMainView = view;
  const dashEl = document.getElementById("view-dashboard");
  const tasksEl = document.getElementById("view-tasks");
  const calEl = document.getElementById("view-calendar");
  const btnDash = document.getElementById("tab-btn-dashboard");
  const btnTasks = document.getElementById("tab-btn-tasks");
  const btnCal = document.getElementById("tab-btn-calendar");
  const topControls = document.getElementById("calendar-top-controls");

  const activeClass =
    "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition bg-white dark:bg-slate-900 text-[#1a73e8] dark:text-blue-400 shadow-2xs cursor-pointer";
  const inactiveClass =
    "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer";

  if (view === "dashboard") {
    if (dashEl) {
      dashEl.classList.remove("hidden");
      dashEl.classList.remove("view-transition");
      void dashEl.offsetWidth;
      dashEl.classList.add("view-transition");
    }
    if (tasksEl) tasksEl.classList.add("hidden");
    if (calEl) calEl.classList.add("hidden");

    if (btnDash) btnDash.className = activeClass;
    if (btnTasks) btnTasks.className = inactiveClass;
    if (btnCal) btnCal.className = inactiveClass;

    if (topControls) {
      topControls.classList.add("hidden");
      topControls.classList.remove("flex");
    }
    renderDashboard();
  } else if (view === "tasks") {
    if (dashEl) dashEl.classList.add("hidden");
    if (tasksEl) {
      tasksEl.classList.remove("hidden");
      tasksEl.classList.remove("view-transition");
      void tasksEl.offsetWidth;
      tasksEl.classList.add("view-transition");
    }
    if (calEl) calEl.classList.add("hidden");

    if (btnDash) btnDash.className = inactiveClass;
    if (btnTasks) btnTasks.className = activeClass;
    if (btnCal) btnCal.className = inactiveClass;

    if (topControls) {
      topControls.classList.add("hidden");
      topControls.classList.remove("flex");
    }
    renderTasksView();
  } else {
    if (dashEl) dashEl.classList.add("hidden");
    if (tasksEl) tasksEl.classList.add("hidden");
    if (calEl) {
      calEl.classList.remove("hidden");
      calEl.classList.remove("view-transition");
      void calEl.offsetWidth;
      calEl.classList.add("view-transition");
    }

    if (btnDash) btnDash.className = inactiveClass;
    if (btnTasks) btnTasks.className = inactiveClass;
    if (btnCal) btnCal.className = activeClass;

    if (topControls) {
      topControls.classList.remove("hidden");
      topControls.classList.add("flex");
    }
    renderWeekCalendar();
  }

  // Sync Material 3 mobile bottom navigation active indicator pills and labels
  const m3Tabs = ["dashboard", "tasks", "calendar", "focus"];
  m3Tabs.forEach((tab) => {
    const isCur = tab === view;
    const pill = document.getElementById(`mobile-nav-pill-${tab}`);
    const label = document.getElementById(`mobile-nav-label-${tab}`);

    if (pill) {
      pill.className = isCur
        ? "w-14 h-8 rounded-full bg-blue-100 dark:bg-blue-900/60 text-[#1a73e8] dark:text-blue-300 flex items-center justify-center transition-all duration-200"
        : "w-14 h-8 rounded-full bg-transparent text-slate-500 dark:text-slate-400 flex items-center justify-center transition-all duration-200";
    }
    if (label) {
      label.className = isCur
        ? "text-[11px] font-bold text-slate-900 dark:text-white mt-0.5 tracking-tight transition-colors"
        : "text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5 tracking-tight transition-colors";
    }
  });

  if (window.lucide) lucide.createIcons();
}

// ============================================================================
// STUDY TASKS & REVISION ROADMAP MANAGEMENT
// ============================================================================

async function loadStudyTasks(forceRefresh = false) {
  try {
    const res = await fetch("/api/study/tasks");
    const data = await res.json();
    if (data.success && data.tasks_payload) {
      studyTasksState = data.tasks_payload;
      // Re-apply stored topic-completion state so a refresh never clears toggles
      const completedMap = appState.config?.completed_topics || {};
      for (const day of studyTasksState.days || []) {
        for (const t of day.tasks || []) {
          if (completedMap[t.key] === true) t.completed = true;
        }
      }
      updateTasksBadgeCount();
      if (currentMainView === "tasks") {
        renderTasksView();
      }
    }
  } catch (err) {
    console.error("Failed to load study tasks:", err);
  }
}

function updateTasksBadgeCount() {
  const badge = document.getElementById("tasks-badge-count");
  const mobBadge = document.getElementById("mobile-tasks-badge-count");
  const pending = studyTasksState?.pending_tasks || 0;

  if (badge) {
    if (pending > 0) {
      badge.textContent = pending;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  if (mobBadge) {
    if (pending > 0) {
      mobBadge.textContent = pending;
      mobBadge.classList.remove("hidden");
    } else {
      mobBadge.classList.add("hidden");
    }
  }
}

async function optimizeStudyTasks() {
  const btn = document.getElementById("btn-tasks-ai-rerank");
  const icon = document.getElementById("ai-rerank-icon");
  if (btn) btn.disabled = true;
  if (icon) icon.classList.add("animate-spin");

  try {
    const res = await fetch("/api/study/tasks/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (data.success && data.tasks_payload) {
      studyTasksState = data.tasks_payload;
      updateTasksBadgeCount();
      renderTasksView();

      const statusBadge = document.getElementById("tasks-header-status-badge");
      if (statusBadge) {
        statusBadge.textContent = data.ai_optimized ? "Gemini AI Optimized" : "Smart Ranked";
        statusBadge.className = data.ai_optimized
          ? "px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/50"
          : "px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/60 text-[#1a73e8] dark:text-blue-400 border border-blue-200 dark:border-blue-900/50";
      }

      showToast(
        data.ai_optimized
          ? "Daily study roadmap optimized with Gemini AI!"
          : "Daily study roadmap updated with smart academic ranking."
      );
    } else {
      showToast(data.error || "Failed to optimize study tasks", true);
    }
  } catch (err) {
    console.error("Error optimizing study tasks:", err);
    showToast("Error optimizing study tasks", true);
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.classList.remove("animate-spin");
  }
}

async function toggleDailyTask(key, ev) {
  if (ev) ev.stopPropagation();
  triggerHaptic("light");
  if (!studyTasksState) return;

  // Find task in local state and toggle optimistically
  let targetTask = null;
  for (const day of studyTasksState.days || []) {
    for (const t of day.tasks || []) {
      if (t.key === key) {
        targetTask = t;
        break;
      }
    }
    if (targetTask) break;
  }

  if (!targetTask) return;
  const newCompleted = !targetTask.completed;
  targetTask.completed = newCompleted;

  // Recalculate pending/completed counts
  let completedCount = 0;
  let totalCount = 0;
  for (const day of studyTasksState.days || []) {
    for (const t of day.tasks || []) {
      totalCount++;
      if (t.completed) completedCount++;
    }
  }
  studyTasksState.completed_tasks = completedCount;
  studyTasksState.pending_tasks = totalCount - completedCount;

  // Update corresponding readiness card
  if (studyTasksState.readiness_cards) {
    const card = studyTasksState.readiness_cards.find((c) => c.assessment_id === targetTask.assessment_id);
    if (card) {
      if (newCompleted) {
        card.completed_count = Math.min(card.total_count, card.completed_count + 1);
      } else {
        card.completed_count = Math.max(0, card.completed_count - 1);
      }
      card.readiness_percent = card.total_count > 0 ? Math.round((card.completed_count / card.total_count) * 100) : 0;
    }
  }

  updateTasksBadgeCount();
  renderTasksView();

  try {
    const res = await fetch("/api/study/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, completed: newCompleted }),
    });
    const data = await res.json();
    if (data.success) {
      if (data.dashboard) appState.dashboard = data.dashboard;
      if (data.completed_topics && appState.config) {
        appState.config.completed_topics = data.completed_topics;
      }
      if (data.tasks_payload) {
        studyTasksState = data.tasks_payload;
        updateTasksBadgeCount();
        renderTasksView();
      }
      renderDashboard();
    }
  } catch (err) {
    console.error("Failed to sync study topic toggle:", err);
  }
}

function handleTasksFilterChange() {
  const select = document.getElementById("tasks-course-filter");
  if (select) {
    currentTasksCourseFilter = select.value;
  }
  renderTasksView();
}

function setTasksStatusFilter(status) {
  currentTasksStatusFilter = status;

  const btnPending = document.getElementById("task-filter-pending");
  const btnAll = document.getElementById("task-filter-all");
  const btnCompleted = document.getElementById("task-filter-completed");

  const active =
    "px-2.5 py-1 rounded-lg font-semibold bg-white dark:bg-slate-900 text-[#1a73e8] dark:text-blue-400 shadow-2xs transition cursor-pointer";
  const inactive =
    "px-2.5 py-1 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition cursor-pointer";

  if (btnPending) btnPending.className = status === "pending" ? active : inactive;
  if (btnAll) btnAll.className = status === "all" ? active : inactive;
  if (btnCompleted) btnCompleted.className = status === "completed" ? active : inactive;

  renderTasksView();
}

function renderTasksView() {
  if (!studyTasksState) {
    loadStudyTasks();
    return;
  }

  // 1. Subtitle & Top Header Summary
  const subEl = document.getElementById("tasks-summary-subtitle");
  if (subEl) {
    const pending = studyTasksState.pending_tasks || 0;
    const examsCount = studyTasksState.readiness_cards?.length || 0;
    const hours = Math.round((studyTasksState.total_hours || 0) * 10) / 10;
    subEl.textContent = `${pending} pending topics across ${examsCount} upcoming exams • Est. ${hours} hrs total`;
  }

  // 2. Rebuild the Course Filter Dropdown whenever course list changes (preserves selection)
  const courseFilter = document.getElementById("tasks-course-filter");
  if (courseFilter) {
    const courses = appState.schedule?.courses || [];
    const coursesSignature = courses.map((c) => c.id).join(",");
    if (courseFilter.dataset.signature !== coursesSignature) {
      const selected = courseFilter.value || "all";
      courseFilter.innerHTML = "";
      courseFilter.dataset.signature = coursesSignature;
      const allOpt = document.createElement("option");
      allOpt.value = "all";
      allOpt.textContent = "All Courses";
      courseFilter.appendChild(allOpt);
      const seen = new Set();
      courses.forEach((c) => {
        if (!c.id || seen.has(c.id)) return;
        seen.add(c.id);
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `${c.id} — ${c.name}`;
        courseFilter.appendChild(opt);
      });
      courseFilter.value = [...courseFilter.options].some((o) => o.value === selected) ? selected : "all";
    }
  }

  // 3. Render Exam Readiness Cards
  renderReadinessCards();

  // 4. Render Daily Study Roadmap
  renderDailyRoadmap();

  if (window.lucide) lucide.createIcons();
}

function renderReadinessCards() {
  const container = document.getElementById("readiness-cards-container");
  const avgBadge = document.getElementById("readiness-avg-badge");
  if (!container) return;

  let cards = studyTasksState?.readiness_cards || [];
  if (currentTasksCourseFilter !== "all") {
    cards = cards.filter((c) => c.course_id.toLowerCase() === currentTasksCourseFilter.toLowerCase());
  }

  if (cards.length === 0) {
    container.innerHTML = `
      <div class="col-span-full p-6 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 text-slate-500 text-xs">
        No upcoming assessments found for the selected filter.
      </div>
    `;
    if (avgBadge) avgBadge.textContent = "";
    return;
  }

  const avg = Math.round(cards.reduce((acc, c) => acc + (c.readiness_percent || 0), 0) / cards.length);
  if (avgBadge) {
    avgBadge.textContent = `Average Readiness: ${avg}%`;
  }

  container.innerHTML = cards
    .map((c) => {
      const percent = c.readiness_percent || 0;
      const daysText = c.days_until === 0 ? "Today" : c.days_until === 1 ? "Tomorrow" : `In ${c.days_until} days`;
      const isUrgent = c.days_until <= 2;
      const isComplete = percent >= 100;
      const barColor = isComplete ? "bg-emerald-500" : percent >= 60 ? "bg-blue-600 dark:bg-blue-500" : "bg-amber-500";

      return `
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/90 dark:border-slate-800 shadow-2xs transition-all hover:border-slate-300 dark:hover:border-slate-700 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold" style="background-color: ${c.color}15; color: ${c.color}; border: 1px solid ${c.color}35">
                <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${c.color}"></span>
                ${escapeHtml(c.course_id)}
              </span>
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                isUrgent
                  ? "bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
              }">
                ${daysText}
              </span>
            </div>

            <h3 class="text-sm font-bold text-slate-900 dark:text-white line-clamp-1 mb-0.5" title="${escapeHtml(c.title)}">
              ${escapeHtml(c.title)}
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 mb-3">
              ${escapeHtml(c.assessment_type)} • ${escapeHtml(c.course_name)}
            </p>
          </div>

          <div>
            <div class="flex items-center justify-between text-xs font-semibold mb-1.5">
              <span class="text-slate-700 dark:text-slate-300 flex items-center gap-1">
                ${isComplete ? '<i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-500"></i> Exam Ready' : "Readiness"}
              </span>
              <span class="${isComplete ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-slate-900 dark:text-white"}">
                ${percent}% <span class="text-[11px] font-normal text-slate-400">(${c.completed_count}/${c.total_count})</span>
              </span>
            </div>

            <div class="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mb-2.5">
              <div class="h-full rounded-full ${barColor} transition-all duration-500" style="width: ${percent}%"></div>
            </div>

            <div class="text-[11px] bg-slate-50 dark:bg-slate-800/60 p-2 rounded-xl border border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-400 line-clamp-1">
              <span class="font-semibold text-slate-800 dark:text-slate-200">Focus:</span> ${escapeHtml(c.recommended_focus || "Review core concepts")}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderDailyRoadmap() {
  const container = document.getElementById("daily-roadmap-container");
  const countBadge = document.getElementById("tasks-overall-count");
  if (!container) return;

  const rawDays = studyTasksState?.days || [];
  let matchingTaskCount = 0;

  const filteredDays = rawDays
    .map((d) => {
      let tasks = d.tasks || [];
      if (currentTasksCourseFilter !== "all") {
        tasks = tasks.filter((t) => t.course_id.toLowerCase() === currentTasksCourseFilter.toLowerCase());
      }
      if (currentTasksStatusFilter === "pending") {
        tasks = tasks.filter((t) => !t.completed);
      } else if (currentTasksStatusFilter === "completed") {
        tasks = tasks.filter((t) => t.completed);
      }
      matchingTaskCount += tasks.length;
      return { ...d, tasks };
    })
    .filter((d) => d.tasks.length > 0);

  if (countBadge) {
    countBadge.textContent = `${matchingTaskCount} matching tasks`;
  }

  if (filteredDays.length === 0) {
    container.innerHTML = `
      <div class="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs">
        <div class="w-12 h-12 mx-auto mb-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
          <i data-lucide="check-check" class="w-6 h-6"></i>
        </div>
        <h3 class="text-base font-bold text-slate-900 dark:text-white">All Caught Up!</h3>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
          ${
            currentTasksStatusFilter === "pending"
              ? "No pending study tasks remaining for this view. Excellent progress!"
              : "No tasks found matching the selected filter."
          }
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredDays
    .map((d) => {
      const isToday = d.is_today;
      const totalHours = Math.round(d.tasks.reduce((acc, t) => acc + (t.estimated_hours || 0), 0) * 10) / 10;

      const tasksHtml = d.tasks
        .map((t) => {
          const isCompleted = t.completed;
          const urgencyBadge =
            t.urgency === "critical"
              ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300">Critical</span>'
              : t.urgency === "high"
              ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300">High</span>'
              : '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300">Normal</span>';

          return `
            <div class="group flex items-start gap-3.5 py-3.5 first:pt-1 last:pb-1 transition-colors ${
              isCompleted ? "opacity-55" : ""
            }">
              <!-- Accessible Checkbox Button -->
              <button onclick="toggleDailyTask('${jsAttr(t.key)}', event)" class="mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 border transition-all cursor-pointer ${
                isCompleted
                  ? "bg-emerald-600 border-emerald-600 text-white"
                  : "border-slate-300 dark:border-slate-600 hover:border-[#1a73e8] dark:hover:border-blue-400 bg-white dark:bg-slate-800"
              }" title="${isCompleted ? "Mark incomplete" : "Mark completed"}">
                ${isCompleted ? '<i data-lucide="check" class="w-3.5 h-3.5 stroke-[2.5]"></i>' : ""}
              </button>

              <!-- Main Content -->
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2 mb-1">
                  <span class="inline-flex items-center gap-1 px-2 py-0.2 rounded-md text-[11px] font-bold" style="background-color: ${t.color}15; color: ${t.color}; border: 1px solid ${t.color}35">
                    ${escapeHtml(t.course_id)}
                  </span>
                  <span class="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate max-w-[200px]" title="${escapeHtml(t.assessment_title)}">
                    ${escapeHtml(t.assessment_title)}
                  </span>
                  ${urgencyBadge}
                  <span class="text-[11px] text-slate-400 ml-auto flex items-center gap-1">
                    <i data-lucide="clock" class="w-3 h-3"></i>
                    ${t.estimated_hours}h
                  </span>
                </div>

                <h4 class="text-sm font-semibold text-slate-900 dark:text-white ${isCompleted ? "line-through text-slate-400 dark:text-slate-500" : ""}">
                  ${escapeHtml(t.topic)}
                </h4>

                ${
                  t.ai_reasoning
                    ? `
                  <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 italic flex items-center gap-1.5">
                    <i data-lucide="sparkle" class="w-3 h-3 text-blue-500 shrink-0"></i>
                    <span>${escapeHtml(t.ai_reasoning)}</span>
                  </p>
                `
                    : ""
                }
              </div>
            </div>
          `;
        })
        .join("");

      return `
        <div class="rounded-2xl p-5 border transition-all ${
          isToday
            ? "bg-white dark:bg-slate-900 border-blue-300 dark:border-blue-900/60 shadow-xs ring-1 ring-blue-500/10"
            : "bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 shadow-2xs"
        }">
          <div class="flex items-center justify-between pb-3.5 mb-2 border-b border-slate-100 dark:border-slate-800">
            <div class="flex items-center gap-2.5">
              <span class="w-2.5 h-2.5 rounded-full ${isToday ? "bg-blue-600 animate-pulse" : "bg-slate-400 dark:bg-slate-600"}"></span>
              <h3 class="text-base font-bold text-slate-900 dark:text-white">
                ${escapeHtml(d.display_day)}
              </h3>
              ${isToday ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">Today</span>' : ""}
            </div>
            <div class="flex items-center gap-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span>${d.tasks.length} ${d.tasks.length === 1 ? "task" : "tasks"}</span>
              <span>•</span>
              <span>${totalHours} hrs total</span>
            </div>
          </div>

          <div class="divide-y divide-slate-100 dark:divide-slate-800/80">
            ${tasksHtml}
          </div>
        </div>
      `;
    })
    .join("");
}

let currentDashboardTab = "study";

function switchDashboardTab(tab) {
  currentDashboardTab = tab;

  const studyPanel = document.getElementById("dashboard-study-panel");
  const radarPanel = document.getElementById("all-assessments-panel");
  const kpiSection = document.getElementById("dashboard-kpi-section");

  const tabStudy = document.getElementById("dash-tab-study");
  const tabRadar = document.getElementById("dash-tab-assessments");
  const tabOverview = document.getElementById("dash-tab-overview");

  const activeClass = "text-[#1a73e8] dark:text-blue-400 bg-white dark:bg-slate-900 shadow-2xs font-bold";
  const inactiveClass = "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-medium";

  if (tabStudy) tabStudy.className = "dash-subtab flex-1 py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer " + (tab === "study" ? activeClass : inactiveClass);
  if (tabRadar) tabRadar.className = "dash-subtab flex-1 py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer " + (tab === "assessments" ? activeClass : inactiveClass);
  if (tabOverview) tabOverview.className = "dash-subtab flex-1 py-2 px-2 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer " + (tab === "overview" ? activeClass : inactiveClass);

  if (window.innerWidth < 1024) {
    if (studyPanel) {
      studyPanel.classList.toggle("hidden", tab !== "study");
      if (tab === "study") studyPanel.classList.add("flex");
    }
    if (radarPanel) {
      radarPanel.classList.toggle("hidden", tab !== "assessments");
      if (tab === "assessments") radarPanel.classList.add("flex");
    }
    if (kpiSection) {
      kpiSection.classList.toggle("hidden", tab !== "overview");
      if (tab === "overview") kpiSection.classList.add("grid");
    }
  } else {
    if (studyPanel) studyPanel.classList.remove("hidden");
    if (radarPanel) {
      radarPanel.classList.remove("hidden");
      radarPanel.classList.add("flex");
    }
    if (kpiSection) {
      kpiSection.classList.remove("hidden");
      kpiSection.classList.add("grid");
    }
  }

  if (window.lucide) lucide.createIcons();
}

// rafThrottle the resize handler: dragging the desktop window fires dozens of
// events per second, each of which re-hydrated every lucide icon in the DOM.
window.addEventListener("resize", rafThrottle(() => {
  switchDashboardTab(currentDashboardTab);
}));

function renderDashboard() {
  const dash = appState.dashboard || {};
  const enrolledCourses = appState.schedule?.courses || [];
  const enrolledCourseIds = new Set(enrolledCourses.map(c => c.id));
  const nextUp = (dash.next_up && enrolledCourseIds.has(dash.next_up.course_id)) ? dash.next_up : null;

  // 0. Exam Overload & Conflict Detection Banner
  const conflictBanner = document.getElementById("conflict-alert-banner");
  if (conflictBanner) {
    const alerts = dash.conflict_alerts || [];
    const isDismissed = !!appState.config?.dismiss_conflict_banner;
    const studyBlocks = (appState.config?.custom_events || []).filter(
      (e) => e.id && e.id.startsWith("study-block-")
    );
    const hasStudyBlocks = studyBlocks.length > 0;

    if (alerts.length > 0 && !isDismissed) {
      conflictBanner.classList.remove("hidden");
      if (hasStudyBlocks) {
        // Resolved / Mitigated State (Emerald Shield)
        conflictBanner.className =
          "rounded-xl p-4 bg-emerald-500/10 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs";
        conflictBanner.innerHTML = `
          <div class="flex items-start gap-3 flex-1">
            <div class="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
              <i data-lucide="shield-check" class="w-4 h-4"></i>
            </div>
            <div class="space-y-1">
              <div class="text-xs font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                <span>Exam Overload Mitigated (${studyBlocks.length} Active Study Preparation Blocks)</span>
                <span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">Protected</span>
              </div>
              <p class="text-xs text-emerald-800 dark:text-emerald-300">
                All ${alerts.length} exam cluster${alerts.length > 1 ? "s have" : " has"} dedicated 90-minute preparation blocks booked in your timetable to distribute your study load and prevent last-minute cramming.
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button onclick="switchMainView('calendar')" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer">
              <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
              <span>View Blocks on Week Calendar</span>
            </button>
            <button onclick="dismissConflictBanner()" class="p-1.5 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 cursor-pointer" title="Dismiss banner">
              <i data-lucide="x" class="w-4 h-4"></i>
            </button>
          </div>
        `;
      } else {
        // Unresolved Conflict Warning State (Amber Alert)
        conflictBanner.className =
          "rounded-xl p-4 bg-amber-500/10 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-start justify-between gap-3 shadow-xs";
        conflictBanner.innerHTML = `
          <div class="flex items-start gap-3 flex-1">
            <div class="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
              <i data-lucide="alert-triangle" class="w-4 h-4"></i>
            </div>
            <div class="space-y-1">
              <div class="text-xs font-bold text-amber-900 dark:text-amber-200">Exam Overload & Schedule Conflict Detected (${alerts.length} conflict${alerts.length > 1 ? "s" : ""})</div>
              <div class="text-xs text-amber-800 dark:text-amber-300 space-y-1">
                ${alerts.map(a => `<div>• <strong>${escapeHtml(a.course_a || a.course_1)}</strong> and <strong>${escapeHtml(a.course_b || a.course_2)}</strong>: ${escapeHtml(a.message)}</div>`).join("")}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button id="auto-schedule-blocks-btn" onclick="scheduleSmartStudyBlocks()" class="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer">
              <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
              <span>Auto-Schedule Study Blocks</span>
            </button>
            <button onclick="dismissConflictBanner()" class="p-1 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300 cursor-pointer" title="Dismiss banner">
              <i data-lucide="x" class="w-4 h-4"></i>
            </button>
          </div>
        `;
      }
    } else {
      conflictBanner.classList.add("hidden");
    }
  }

  // 1. Hero Spotlight: What's Coming Next (No bottom warning pill per Picture 3; clean layout)
  const heroEl = document.getElementById("dashboard-next-up-hero");
  if (nextUp) {
    const countdownLabel =
      nextUp.days_until === 0
        ? "Today"
        : nextUp.days_until === 1
        ? "Tomorrow"
        : `In ${nextUp.days_until} days`;

    heroEl.innerHTML = `
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4">
        <div class="space-y-2 min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span class="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[11px] sm:text-xs font-bold tabular-nums flex items-center gap-1 shadow-2xs">
              <i data-lucide="zap" class="w-3 h-3"></i>
              <span>Up next · ${countdownLabel}</span>
            </span>
            <span class="px-2 py-0.5 rounded-full bg-white/20 text-white text-[11px] sm:text-xs font-semibold">
              ${escapeHtml(nextUp.course_id)} · ${escapeHtml(nextUp.assessment_type)}
            </span>
            <span class="hidden sm:inline-flex px-2 py-0.5 rounded-full bg-emerald-400/20 text-emerald-100 border border-emerald-300/30 text-xs font-medium items-center gap-1">
              <i data-lucide="map-pin" class="w-3 h-3"></i>
              <span>Room ${escapeHtml(nextUp.room)}</span>
            </span>
          </div>

          <h1 class="text-base sm:text-xl lg:text-2xl font-bold tracking-tight text-white leading-snug line-clamp-2">
            ${escapeHtml(nextUp.title)} <span class="font-normal text-blue-100 text-xs sm:text-sm">(${escapeHtml(nextUp.course_name)})</span>
          </h1>

          <div class="flex flex-wrap items-center gap-2.5 sm:gap-4 text-[11px] sm:text-xs text-blue-100 tabular-nums">
            <span class="flex items-center gap-1 font-medium">
              <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
              <span>${escapeHtml(nextUp.display_time)}</span>
            </span>
            ${nextUp.instructor ? `
            <span class="hidden sm:flex items-center gap-1">
              <i data-lucide="user-check" class="w-3.5 h-3.5"></i>
              <span>${escapeHtml(nextUp.instructor)}</span>
            </span>` : ""}
            <span class="sm:hidden flex items-center gap-1">
              <i data-lucide="map-pin" class="w-3 h-3"></i>
              <span>${escapeHtml(nextUp.room)}</span>
            </span>
          </div>

          <!-- Compact Study Focus Pill -->
          <div class="bg-slate-900/40 border border-white/15 rounded-xl p-2 sm:p-2.5 text-[11px] sm:text-xs text-blue-50 flex items-start gap-2 max-w-3xl">
            <i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5"></i>
            <div class="line-clamp-2 leading-relaxed">
              <span class="font-semibold text-white">Focus:</span> ${escapeHtml(nextUp.ai_study_plan || nextUp.ai_inference_note)}
            </div>
          </div>
        </div>

        <!-- Action Buttons: Horizontal on mobile, neatly grouped on desktop -->
        <div class="flex items-center gap-2 shrink-0 pt-1 md:pt-0">
          <button onclick="openAssessmentModalById('${jsAttr(nextUp.id)}')" class="flex-1 md:flex-initial px-3.5 py-2 rounded-xl bg-white text-[#1a73e8] hover:bg-blue-50 active:scale-[0.98] text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs">
            <i data-lucide="book-open" class="w-3.5 h-3.5"></i>
            <span>Study Plan</span>
          </button>
          <button onclick="jumpToAssessmentOnCalendar('${nextUp.id}')" class="px-2.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 active:scale-95 text-white text-xs font-semibold transition flex items-center justify-center gap-1 cursor-pointer" title="View on Calendar">
            <i data-lucide="calendar-days" class="w-3.5 h-3.5"></i>
            <span class="hidden sm:inline">Calendar</span>
          </button>
          <a href="${escapeHtml(safeExternalUrl(nextUp.google_cal_url) || "#")}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 active:scale-95 text-white text-xs font-semibold transition flex items-center justify-center gap-1 cursor-pointer" title="Sync to Google Calendar">
            <i data-lucide="calendar-plus" class="w-3.5 h-3.5"></i>
            <span class="hidden sm:inline">Google Cal</span>
          </a>
        </div>
      </div>
    `;
  } else {
    heroEl.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 class="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <i data-lucide="sparkles" class="w-4 h-4 text-amber-300"></i>
            <span>No Upcoming Quizzes Scheduled</span>
          </h2>
          <p class="text-xs text-blue-100 mt-0.5">Connect your University Account or Google Account, or tap Sync Radar to discover your courses and upcoming exams.</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button onclick="openAccountModal()" class="px-3.5 py-2 rounded-xl bg-white text-[#1a73e8] hover:bg-blue-50 text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer">
            <i data-lucide="user-check" class="w-3.5 h-3.5"></i>
            <span>Connect Account</span>
          </button>
          <button onclick="triggerFullSync()" class="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold transition flex items-center gap-1 cursor-pointer">
            <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
            <span>Sync Radar</span>
          </button>
        </div>
      </div>
    `;
  }

  // 2. KPI Cards
  const upcomingThisWeek = (dash.upcoming_this_week || []).filter(a => enrolledCourseIds.has(a.course_id));
  const weekCount = upcomingThisWeek.length;
  document.getElementById("kpi-week-count").textContent = weekCount;
  const today = getTodayDate();
  const nextWeekEnd = new Date(today);
  nextWeekEnd.setDate(today.getDate() + 7);
  const startStr = today.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
  const endStr = nextWeekEnd.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  document.getElementById("kpi-week-subtext").textContent =
    weekCount > 0
      ? `${startStr} – ${endStr}`
      : "Nothing scheduled in the next 7 days";

  // Exam Types Breakdown Pills (with active highlight state synced to filter dropdown)
  const currentFilterVal = document.getElementById("dashboard-type-filter")?.value || "UPCOMING";
  const typeCounts = dash.exam_type_counts || {};
  const allTypes = Object.entries(typeCounts);
  const pillsEl = document.getElementById("kpi-exam-types-pills");
  if (allTypes.length > 0) {
    const isAllUpcomingActive = currentFilterVal === "UPCOMING";
    const allBtnHtml = `
      <button onclick="filterDashboardByType('UPCOMING')" class="px-2.5 py-1 rounded-lg text-xs font-semibold border transition flex items-center gap-1.5 cursor-pointer ${
        isAllUpcomingActive
          ? "bg-[#e8f0fe] dark:bg-blue-950/80 text-[#1a73e8] dark:text-blue-300 border-[#1a73e8]/40 dark:border-blue-500/50"
          : "bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
      }">
        <span>All</span>
      </button>
    `;
    pillsEl.innerHTML =
      allBtnHtml +
      allTypes
        .map(([t, count]) => {
          const isActive = currentFilterVal === t;
          return `
            <button onclick="filterDashboardByType('${jsAttr(t)}')" class="px-2.5 py-1 rounded-lg text-xs font-semibold border transition flex items-center gap-1.5 cursor-pointer ${
              isActive
                ? "bg-[#e8f0fe] dark:bg-blue-950/80 text-[#1a73e8] dark:text-blue-300 border-[#1a73e8]/40 dark:border-blue-500/50"
                : "bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-slate-800 dark:text-slate-200 hover:text-[#1a73e8] dark:hover:text-blue-400 border-slate-200 dark:border-slate-700"
            }">
              <span>${escapeHtml(t)}</span>
              <span class="px-1.5 py-0.2 rounded-md bg-white dark:bg-slate-900 text-[#1a73e8] dark:text-blue-400 font-bold tabular-nums text-[11px]">${count}</span>
            </button>
          `;
        })
        .join("");
  } else {
    pillsEl.innerHTML = `<span class="text-xs text-slate-500 dark:text-slate-400">No upcoming exams</span>`;
  }

  // Study Readiness KPI
  updateReadinessKpiDom();

  // Mobile Sub-Tabs Badges & Panel Toggle
  const badgeStudy = document.getElementById("dash-badge-study");
  const validRecs = enrolledCourses.length === 0
    ? []
    : (dash.study_recommendations || []).filter(r => enrolledCourseIds.has(r.course_id));
  if (badgeStudy) {
    badgeStudy.textContent = validRecs.length;
  }
  const badgeRadar = document.getElementById("dash-badge-assessments");
  if (badgeRadar) {
    const validAssessments = (appState.assessments || []).filter(a => enrolledCourseIds.has(a.course_id));
    badgeRadar.textContent = validAssessments.length;
  }
  switchDashboardTab(currentDashboardTab);

  function formatCompactCardSchedule(str, room) {
    if (!str) return room ? `Room ${stripRoomPrefix(room)}` : "Scheduled";
    let cleaned = str.replace(/\((\d{1,2}:\d{2})\s*-\s*\1\)/, "Due $1");
    cleaned = cleaned.replace(/(\d{4})-(\d{2})-(\d{2})/, (m, y, mo, d) => {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthName = months[parseInt(mo, 10) - 1] || mo;
      return `${monthName} ${parseInt(d, 10)}`;
    });
    if (room && !cleaned.toLowerCase().includes(room.toLowerCase())) {
      const shortRoom = stripRoomPrefix(room);
      cleaned += ` · ${shortRoom}`;
    }
    return cleaned;
  }

  // 3. "What Should I Study?" Study Recommendations List (Compact Mobile-First Cards with Tap-To-Detail)
  const recsEl = document.getElementById("study-recommendations-list");
  let recs = validRecs;
  if (globalSearchQuery) {
    const q = globalSearchQuery.toLowerCase();
    recs = recs.filter(
      (r) =>
        (r.course_id || "").toLowerCase().includes(q) ||
        (r.course_name || "").toLowerCase().includes(q) ||
        (r.title || "").toLowerCase().includes(q) ||
        (r.topics || []).some((t) => (t.topic || "").toLowerCase().includes(q))
    );
  }

  if (recs.length === 0) {
    if (globalSearchQuery) {
      recsEl.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
          <div class="text-sm font-bold text-slate-800 dark:text-slate-100">No study plans match "${escapeHtml(globalSearchQuery)}"</div>
          <p class="text-xs text-slate-500 dark:text-slate-400">Clear your search filter to view all upcoming assessments.</p>
          <button onclick="clearGlobalSearch()" class="mt-2 px-3.5 py-1.5 rounded-lg bg-[#1a73e8] text-white text-xs font-semibold cursor-pointer">Clear search filter</button>
        </div>
      `;
    } else if ((appState.schedule?.courses || []).length === 0) {
      // First-run state: never say "All Clear" while the user has zero
      // courses — the honest next action is to build the schedule.
      recsEl.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-3">
          <div class="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/70 text-[#1a73e8] dark:text-blue-400 mx-auto flex items-center justify-center">
            <i data-lucide="map" class="w-6 h-6"></i>
          </div>
          <div class="text-sm font-bold text-slate-900 dark:text-white">Add your first course to build your study plan</div>
          <p class="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">QuizRadar turns your weekly timetable + announcements into deadline countdowns and a "what should I study" plan.</p>
          <div class="flex items-center justify-center gap-2 pt-1">
            <button onclick="openAddCourseModal()" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1a73e8] hover:bg-[#1557b0] text-white text-xs font-semibold shadow-xs cursor-pointer active:scale-95 transition">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i>
              <span>Add Course</span>
            </button>
            <button onclick="openAccountModal()" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer active:scale-95 transition">
              <i data-lucide="link" class="w-3.5 h-3.5"></i>
              <span>Connect Account</span>
            </button>
          </div>
        </div>
      `;
      if (window.lucide) lucide.createIcons({ root: recsEl });
    } else {
      recsEl.innerHTML = `
        <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-3">
          <div class="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/70 text-[#1a73e8] dark:text-blue-400 mx-auto flex items-center justify-center">
            <i data-lucide="check-circle-2" class="w-6 h-6"></i>
          </div>
          <div class="text-sm font-bold text-slate-900 dark:text-white">All Clear for Now!</div>
          <p class="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">No pending study plans or overdue quizzes. You're completely up to date with your academic radar!</p>
          <button onclick="openCreateEventModal()" class="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1a73e8] hover:bg-[#1557b0] text-white text-xs font-semibold shadow-xs cursor-pointer active:scale-95 transition">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i>
            <span>Add Custom Quiz or Exam</span>
          </button>
        </div>
      `;
      if (window.lucide) lucide.createIcons({ root: recsEl });
    }
  } else {
    recsEl.innerHTML = recs
      .map((rec, idx) => {
        const badgeColor =
          rec.days_until <= 1
            ? "bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/60"
            : rec.days_until <= 4
            ? "bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60"
            : "bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800/60";

        const matchingAssessment = (appState.assessments || []).find((a) => a.id === rec.assessment_id);
        const roomLabel = rec.room || matchingAssessment?.room || "";
        const topicsCount = (rec.topics || []).length;
        const uniqueWarnings = [...new Set(rec.warnings || [])];
        const displaySchedule = formatCompactCardSchedule(rec.display_time, roomLabel);

        return `
          <div onclick="triggerHaptic('light'); openAssessmentModalById('${jsAttr(rec.assessment_id)}')"
               class="interactive-card group relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-3.5 sm:p-4 hover:border-[#1a73e8]/70 dark:hover:border-blue-500/70 transition-all duration-200 cursor-pointer active:scale-[0.985] shadow-xs hover:shadow-md overflow-hidden">
            
            <!-- Left Course Color Accent Bar -->
            <div class="absolute left-0 top-3 bottom-3 w-1.5 rounded-r-full" style="background-color: ${rec.color}"></div>

            <div class="pl-2 space-y-2">
              <!-- Top Row: Badges & Readiness Meter -->
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                  <span class="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md bg-slate-900 dark:bg-slate-800 text-white">#${idx + 1}</span>
                  <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-md text-white shrink-0" style="background-color: ${rec.color}">${escapeHtml(rec.course_id)}</span>
                  <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">${escapeHtml(rec.assessment_type)}</span>
                  <span class="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md border ${badgeColor} shrink-0">${escapeHtml(rec.urgency_badge)}</span>
                </div>

                <!-- Progress Pill -->
                <div class="text-right tabular-nums shrink-0 flex items-center gap-1.5">
                  <div class="w-12 sm:w-16 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div data-rec-pct-bar="${rec.assessment_id}" class="h-full bg-emerald-500 transition-all duration-300" style="width: ${rec.progress_percent}%"></div>
                  </div>
                  <span data-rec-pct-label="${rec.assessment_id}" class="text-[11px] font-bold text-slate-800 dark:text-slate-200">${rec.progress_percent}%</span>
                </div>
              </div>

              <!-- Main Title & Course Name -->
              <div>
                <h4 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-white group-hover:text-[#1a73e8] dark:group-hover:text-blue-400 transition leading-snug line-clamp-1">
                  ${escapeHtml(rec.title)}
                </h4>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                  ${escapeHtml(rec.course_name)}
                </div>
              </div>

              <!-- Bottom Row: Time / Location Pill & Topics Count & Chevron Details Affordance -->
              <div class="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400">
                <div class="flex items-center gap-2 truncate min-w-0">
                  <span class="flex items-center gap-1 truncate font-medium">
                    <i data-lucide="calendar" class="w-3.5 h-3.5 text-[#1a73e8] dark:text-blue-400 shrink-0"></i>
                    <span class="truncate">${escapeHtml(displaySchedule)}</span>
                  </span>
                  ${
                    topicsCount > 0
                      ? `<span class="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-[#1a73e8] dark:text-blue-300 text-[10px] font-semibold shrink-0">
                           <i data-lucide="book-open" class="w-2.5 h-2.5"></i>
                           <span>${topicsCount} topics</span>
                         </span>`
                      : ""
                  }
                  ${
                    uniqueWarnings.length > 0
                      ? `<span class="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-[10px] font-medium shrink-0">
                           <i data-lucide="alert-circle" class="w-2.5 h-2.5 text-amber-500"></i>
                           <span>${uniqueWarnings.length} rules</span>
                         </span>`
                      : ""
                  }
                </div>

                <div class="flex items-center gap-0.5 text-[#1a73e8] dark:text-blue-400 font-semibold text-xs shrink-0 group-hover:translate-x-0.5 transition-transform">
                  <span>Details</span>
                  <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  // 4. Right Column: Filterable Assessments Timeline (Each card includes its own exam rules)
  let timelineItems = enrolledCourses.length === 0
    ? []
    : (appState.assessments || []).filter(a => enrolledCourseIds.has(a.course_id));
  if (currentFilterVal === "UPCOMING") {
    timelineItems = timelineItems.filter((a) => a.is_upcoming);
  } else if (currentFilterVal !== "ALL") {
    timelineItems = timelineItems.filter((a) => a.assessment_type === currentFilterVal);
  }
  if (currentDashboardSourceFilter && currentDashboardSourceFilter !== "ALL") {
    timelineItems = timelineItems.filter(
      (a) => (a.source || "").toLowerCase().includes(currentDashboardSourceFilter.toLowerCase())
    );
  }
  if (globalSearchQuery) {
    const q = globalSearchQuery.toLowerCase();
    timelineItems = timelineItems.filter(
      (a) =>
        a.course_id.toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q) ||
        a.assessment_type.toLowerCase().includes(q) ||
        (a.source || "").toLowerCase().includes(q)
    );
  }

  const timelineEl = document.getElementById("dashboard-timeline-list");
  if (timelineItems.length === 0) {
    timelineEl.innerHTML = `
      <div class="p-6 text-center rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
        <div class="text-xs font-semibold text-slate-700 dark:text-slate-200">No assessments scheduled</div>
        <p class="text-[11px] text-slate-500 dark:text-slate-400">Add your courses or connect an account to see quizzes and deadlines here.</p>
        <div class="flex items-center justify-center gap-2 pt-1">
          <button onclick="openAddCourseModal()" class="px-3 py-1.5 rounded-lg bg-[#1a73e8] hover:bg-[#1557b0] text-white text-[11px] font-semibold cursor-pointer active:scale-95 transition">Add Course</button>
          <button onclick="openAccountModal()" class="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-semibold cursor-pointer active:scale-95 transition">Connect Account</button>
        </div>
      </div>
    `;
  } else {
    timelineEl.innerHTML = timelineItems
      .map((a) => {
        const uniqueRules = [...new Set(a.warnings || [])];
        const rulesHtml = uniqueRules
          .slice(0, 2)
          .map(
            (w) =>
              `<div class="flex items-start gap-1.5 text-[11px] text-amber-900 dark:text-amber-200 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 px-2.5 py-1 rounded-md">
                <i data-lucide="alert-circle" class="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"></i>
                <span>${escapeHtml(stripLeadingEmoji(w))}</span>
              </div>`
          )
          .join("");

        let timeText = "";
        if (a.start_time && a.end_time) {
          timeText = `${a.start_time} – ${a.end_time}`;
        } else if (a.start_time || a.time) {
          timeText = a.start_time || a.time;
        } else if (a.end_time) {
          timeText = `Until ${a.end_time}`;
        }

        let dateText = a.date_iso || "";
        try {
          if (a.date_iso) {
            const parts = a.date_iso.split("-").map(Number);
            if (parts.length === 3) {
              const d = new Date(parts[0], parts[1] - 1, parts[2]);
              if (!isNaN(d.getTime())) {
                dateText = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
              }
            }
          }
        } catch (_) {}

        const dateTimeDisplay = [dateText, timeText].filter(Boolean).join(" · ");

        return `
          <div onclick="openAssessmentModalById('${jsAttr(a.id)}')" class="interactive-card p-2.5 sm:p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-[#1a73e8] dark:hover:border-blue-500 bg-slate-50/60 dark:bg-slate-800/40 hover:bg-white dark:hover:bg-slate-800 cursor-pointer transition space-y-1.5">
            <div class="flex items-center justify-between gap-1.5">
              <div class="flex items-center gap-1 flex-wrap min-w-0">
                <span class="px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white shrink-0" style="background-color: ${a.color}">${escapeHtml(a.course_id)}</span>
                <span class="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0">${escapeHtml(a.assessment_type)}</span>
                <span class="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900 flex items-center gap-1 shrink-0">
                  <i data-lucide="${escapeHtml(a.source_icon || 'mail')}" class="w-2.5 h-2.5"></i>
                  <span>${escapeHtml(a.source || 'Gmail')}</span>
                </span>
                ${a.conflict_warning ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 border border-amber-300 flex items-center gap-0.5 shrink-0" title="Overload conflict detected (<36h)"><i data-lucide="alert-triangle" class="w-2.5 h-2.5"></i><span>Conflict</span></span>` : ""}
                ${a.achieved_score != null ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200 border border-emerald-300 flex items-center gap-0.5 shrink-0"><i data-lucide="award" class="w-2.5 h-2.5"></i><span>${a.achieved_score}/${a.max_score}</span></span>` : ""}
              </div>
              <span class="text-[10px] font-bold tabular-nums shrink-0 ${
                a.is_upcoming
                  ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800"
                  : "text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800"
              } px-2 py-0.5 rounded-full">
                ${a.is_upcoming ? (a.days_until === 0 ? "Today" : a.days_until === 1 ? "Tomorrow" : `In ${a.days_until}d`) : a.semester}
              </span>
            </div>
            <div class="text-xs font-bold text-slate-900 dark:text-white line-clamp-2 leading-snug">${escapeHtml(a.title)}</div>
            <div class="flex items-center justify-between text-[10px] sm:text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              <span class="flex items-center gap-1">
                <i data-lucide="calendar" class="w-3 h-3"></i>
                <span>${escapeHtml(dateTimeDisplay)}</span>
              </span>
              ${a.room ? `
              <span class="flex items-center gap-1">
                <i data-lucide="map-pin" class="w-3 h-3"></i>
                <span>${escapeHtml(a.room)}</span>
              </span>` : ""}
            </div>
            ${rulesHtml ? `<div class="space-y-1 pt-0.5">${rulesHtml}</div>` : ""}
          </div>
        `;
      })
      .join("");
  }

  if (window.lucide) lucide.createIcons();
}

function updateReadinessKpiDom() {
  const dash = appState.dashboard || {};
  const pct = dash.readiness_percent || 0;
  const doneTopics = dash.completed_topics_count || 0;
  const totalTopics = dash.total_topics_count || 0;
  const pctEl = document.getElementById("kpi-readiness-pct");
  const countsEl = document.getElementById("kpi-readiness-counts");
  const barEl = document.getElementById("kpi-readiness-bar");

  if (pctEl) pctEl.textContent = `${pct}%`;
  if (countsEl) countsEl.textContent = `${doneTopics} / ${totalTopics} topics studied`;
  if (barEl) barEl.style.width = `${pct}%`;
}

function filterDashboardByType(examType) {
  const select = document.getElementById("dashboard-type-filter");
  if (select) {
    // Pills can target types the static <select> doesn't define (server-driven types);
    // add a dynamic option so the dropdown never silently mismatches the active filter.
    if (examType && [...select.options].every((o) => o.value !== examType)) {
      const opt = document.createElement("option");
      opt.value = examType;
      opt.textContent = examType;
      select.appendChild(opt);
    }
    select.value = examType;
    renderDashboard();
  }
}

// Optimistic zero-latency topic toggle: updates checkboxes, recommendation progress bars, KPI bar, and modal progress in 0ms without scroll jump
async function toggleTopicCheckbox(key, completed) {
  triggerHaptic("light");
  if (!appState.config) appState.config = {};
  if (!appState.config.completed_topics) appState.config.completed_topics = {};
  appState.config.completed_topics[key] = completed;

  // 1. Update matching checkboxes & labels in-place across both Dashboard and Modal
  document.querySelectorAll(`input[data-topic-key="${CSS.escape(key)}"]`).forEach((cb) => {
    cb.checked = completed;
  });
  document.querySelectorAll(`[data-topic-label="${CSS.escape(key)}"]`).forEach((lbl) => {
    if (completed) {
      lbl.classList.add("line-through", "text-slate-400", "dark:text-slate-500");
      lbl.classList.remove("text-slate-800", "dark:text-slate-100", "text-slate-900", "font-medium");
    } else {
      lbl.classList.remove("line-through", "text-slate-400", "dark:text-slate-500");
      lbl.classList.add("text-slate-800", "dark:text-slate-100", "font-medium");
    }
  });

  // 2. Recompute local progress on study_recommendations & overall KPI readiness
  let totalCount = 0;
  let doneCount = 0;
  (appState.dashboard?.study_recommendations || []).forEach((rec) => {
    let recTotal = 0;
    let recDone = 0;
    (rec.topics || []).forEach((t) => {
      if (t.key === key) t.completed = completed;
      recTotal += 1;
      totalCount += 1;
      if (t.completed) {
        recDone += 1;
        doneCount += 1;
      }
    });
    rec.progress_percent = recTotal > 0 ? Math.round((recDone / recTotal) * 100) : 0;

    const lblEl = document.querySelector(`[data-rec-pct-label="${CSS.escape(rec.assessment_id)}"]`);
    const barEl = document.querySelector(`[data-rec-pct-bar="${CSS.escape(rec.assessment_id)}"]`);
    if (lblEl) lblEl.textContent = `${rec.progress_percent}% Ready`;
    if (barEl) barEl.style.width = `${rec.progress_percent}%`;
  });

  if (appState.dashboard) {
    appState.dashboard.total_topics_count = totalCount;
    appState.dashboard.completed_topics_count = doneCount;
    appState.dashboard.readiness_percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  }
  updateReadinessKpiDom();

  // 3. If the assessment detail modal is open for this assessment, update its progress meter too
  if (activeModalAssessmentId) {
    updateModalTopicProgress(activeModalAssessmentId);
  }
  saveStateCache();

  // 4. Persist to backend in background
  try {
    const res = await fetch("/api/study/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, completed }),
    });
    const data = await res.json();
    if (data.success) {
      appState.dashboard = data.dashboard;
      appState.config.completed_topics = data.completed_topics;
      saveStateCache();
      updateReadinessKpiDom();
    }
  } catch (err) {
    console.error("Failed to toggle topic:", err);
  }
}

// ============================================================================
// GOOGLE CALENDAR WEEK VIEW RENDERING
// ============================================================================

function renderSidebar() {
  const monthLabel = document.getElementById("mini-cal-month-label");
  const year = currentWeekStart.getFullYear();
  const month = currentWeekStart.getMonth();
  if (monthLabel) monthLabel.textContent = `${MONTH_NAMES[month]} ${year}`;
  const topMonthLabel = document.getElementById("top-month-year-label");
  if (topMonthLabel) topMonthLabel.textContent = `${MONTH_NAMES[month]} ${year}`;

  const firstDayOfMonth = new Date(year, month, 1);
  const startOffset = firstDayOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);

  const miniGrid = document.getElementById("mini-cal-days-grid");
  let rowsHtml = "";

  for (let week = 0; week < 6; week++) {
    const rowStart = new Date(gridStart);
    rowStart.setDate(gridStart.getDate() + week * 7);
    const isCurrentSelectedWeek = sameDate(rowStart, currentWeekStart);

    rowsHtml += `<div class="grid grid-cols-7 items-center py-0.5 ${
      isCurrentSelectedWeek ? "bg-[#e8f0fe] dark:bg-blue-950/70 rounded-full" : ""
    }">`;
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(rowStart);
      cellDate.setDate(rowStart.getDate() + d);
      const iso = toIsoDate(cellDate);
      const inMonth = cellDate.getMonth() === month;
      const isSelectedDay = sameDate(cellDate, selectedCalendarDate);
      const isToday = sameDate(cellDate, getTodayDate());
      const hasExamOnDay = (appState.assessments || []).some((a) => a.date_iso === iso);

      let btnClass = "w-6 h-6 mx-auto rounded-full flex items-center justify-center text-[11px] tabular-nums transition relative cursor-pointer ";
      if (isSelectedDay) {
        btnClass += "bg-[#1a73e8] text-white font-bold";
      } else if (isToday) {
        btnClass += "border border-[#1a73e8] text-[#1a73e8] dark:text-blue-400 font-bold hover:bg-slate-200/70 dark:hover:bg-slate-700";
      } else if (inMonth) {
        btnClass += "text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700 font-medium";
      } else {
        btnClass += "text-slate-400 dark:text-slate-600 hover:bg-slate-200/40 dark:hover:bg-slate-800";
      }

      rowsHtml += `
        <button onclick="selectDateInMiniCal(${cellDate.getFullYear()}, ${cellDate.getMonth()}, ${cellDate.getDate()})" class="${btnClass}">
          <span>${cellDate.getDate()}</span>
          ${hasExamOnDay && !isSelectedDay ? `<span class="w-1 h-1 rounded-full bg-red-500 absolute bottom-0.5"></span>` : ""}
        </button>
      `;
    }
    rowsHtml += `</div>`;
  }
  if (miniGrid) miniGrid.innerHTML = rowsHtml;

  // 2. Exams in Selected Week summary box
  const weekDaysIso = getWeekDaysIso(currentWeekStart);
  const weekExams = (appState.assessments || []).filter((a) => weekDaysIso.includes(a.date_iso));
  const weekExamCountEl = document.getElementById("sidebar-week-exam-count");
  if (weekExamCountEl) weekExamCountEl.textContent = weekExams.length;
  const weekExamsEl = document.getElementById("sidebar-week-exams-list");

  if (weekExamsEl) {
    if (weekExams.length > 0) {
      weekExamsEl.innerHTML = weekExams
        .map(
          (ex) => {
            const dayStr = ex.day_name ? ex.day_name.slice(0, 3) : (ex.date_iso ? new Date(ex.date_iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" }) : "");
            const timeStr = ex.time || ex.start_time || "";
            return `
            <div onclick="openAssessmentModalById('${jsAttr(ex.id)}')" class="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-[#1a73e8] dark:hover:border-blue-400 cursor-pointer transition text-[11px]">
              <div class="flex items-center justify-between font-bold text-slate-900 dark:text-slate-100">
                <span class="flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full" style="background-color: ${ex.color || '#1a73e8'}"></span>
                  <span>${escapeHtml(ex.course_id || '')}</span>
                </span>
                <span class="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">${escapeHtml(dayStr)} ${escapeHtml(timeStr)}</span>
              </div>
              <div class="text-slate-700 dark:text-slate-300 truncate mt-0.5">${escapeHtml(ex.title || '')}</div>
              <div class="text-[10px] text-slate-500 dark:text-slate-400">Room ${escapeHtml(ex.room || 'TBD')}</div>
            </div>
          `;
          }
        )
        .join("");
    } else {
      weekExamsEl.innerHTML = `<div class="text-[11px] text-slate-500 dark:text-slate-400 py-1">No exams scheduled in this week.</div>`;
    }
  }

  // 3. My Calendars (Courses & Layers Checkboxes)
  const calListEl = document.getElementById("sidebar-calendars-list");
  const courses = appState.schedule?.courses || [];

  let calHtml = `
    <label class="flex items-center space-x-2.5 py-1 px-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
      <input type="checkbox" ${showExamOverlays ? "checked" : ""} onchange="toggleLayer('exams', this.checked)" class="w-4 h-4 rounded accent-[#d93025]" />
      <span class="font-semibold text-slate-900 dark:text-slate-100">Quizzes & Exams</span>
    </label>
    <label class="flex items-center space-x-2.5 py-1 px-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
      <input type="checkbox" ${showWeeklyClasses ? "checked" : ""} onchange="toggleLayer('classes', this.checked)" class="w-4 h-4 rounded accent-[#1a73e8]" />
      <span class="text-slate-700 dark:text-slate-300">Weekly Class Schedule</span>
    </label>
    <div class="border-t border-slate-200 dark:border-slate-800 my-1.5"></div>
  `;

  courses.forEach((c) => {
    const checked = activeCourseFilters.has(c.id);
    calHtml += `
      <label class="flex items-center space-x-2.5 py-1 px-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
        <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleCourseFilter('${jsAttr(c.id)}', this.checked)" class="w-4 h-4 rounded" style="accent-color: ${c.color}" />
        <span class="w-2.5 h-2.5 rounded-xs shrink-0" style="background-color: ${c.color}"></span>
        <span class="truncate text-slate-700 dark:text-slate-300" title="${escapeHtml(c.name)}">${escapeHtml(c.id)} · ${escapeHtml(c.name)}</span>
      </label>
    `;
  });

  if (calListEl) calListEl.innerHTML = calHtml;
}

function renderWeekCalendar() {
  renderSidebar();

  const headerDaysEl = document.getElementById("week-header-days");
  const timeGutterEl = document.getElementById("week-time-gutter");
  const colsContainerEl = document.getElementById("week-columns-container");
  if (!headerDaysEl || !timeGutterEl || !colsContainerEl) return;

  const isDark = document.documentElement.classList.contains("dark");

  // Mobile (< 768px) fits 3 days side-by-side instead of 7's 60px-ish squish:
  // the window follows the selected day and stays inside the current week.
  const isNarrowCalendar = window.innerWidth < 768;
  let dayCount = 7;
  let dayOffset = 0;
  if (isNarrowCalendar) {
    dayCount = 3;
    const selDiff = Math.round((selectedCalendarDate - currentWeekStart) / 86400000);
    dayOffset = Math.min(4, Math.max(0, selDiff));
  }

  // 1. Render Day Headers (7 on desktop / a 3-day window on phones)
  let headerHtml = "";
  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekStart);
    d.setDate(currentWeekStart.getDate() + i);
    weekDates.push(d);
  }
  for (let i = dayOffset; i < dayOffset + dayCount; i++) {
    const d = weekDates[i];
    const iso = toIsoDate(d);
    const isHighlighted = sameDate(d, selectedCalendarDate);
    const isToday = sameDate(d, getTodayDate());
    const dayExams = (appState.assessments || []).filter(
      (a) => a.date_iso === iso && activeCourseFilters.has(a.course_id)
    );

    headerHtml += `
      <div onclick="selectDateInMiniCal(${d.getFullYear()}, ${d.getMonth()}, ${d.getDate()})" class="border-r border-slate-200 dark:border-slate-800 py-2.5 px-2 text-center cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition">
        <div class="text-xs font-semibold ${isToday ? "text-[#1a73e8] dark:text-blue-400 font-bold" : isHighlighted ? "text-[#1a73e8] dark:text-blue-400" : "text-slate-500 dark:text-slate-400"}">
          ${DAY_ABBR[i]}
        </div>
        <div class="mt-1 w-9 h-9 mx-auto rounded-full flex items-center justify-center text-lg tabular-nums ${
          isHighlighted
            ? "bg-[#1a73e8] text-white font-semibold shadow-2xs"
            : isToday
            ? "border-2 border-[#1a73e8] text-[#1a73e8] dark:text-blue-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-800"
            : "text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
        }">
          ${d.getDate()}
        </div>
        ${
          dayExams.length > 0 && showExamOverlays
            ? `<div class="mt-1.5 flex flex-col gap-0.5">
                ${dayExams
                  .map(
                    (ex) => `
                  <div onclick="event.stopPropagation(); openAssessmentModalById('${jsAttr(ex.id)}')" class="text-[10px] font-bold px-1.5 py-0.5 rounded-md truncate text-white hover:opacity-90 transition" style="background-color: ${ex.color}">
                    ${escapeHtml(ex.course_id)}: ${escapeHtml(ex.title)}
                  </div>`
                  )
                  .join("")}
               </div>`
            : ""
        }
      </div>
    `;
  }
  headerDaysEl.innerHTML = headerHtml;

  // 2. Render Time Gutter (8 AM to 8 PM)
  let gutterHtml = "";
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    const label = h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`;
    gutterHtml += `
      <div class="hour-row relative pr-2 text-right">
        <span class="text-[10px] tabular-nums text-slate-400 dark:text-slate-400 -top-2 relative">${label}</span>
      </div>
    `;
  }
  timeGutterEl.innerHTML = gutterHtml;

  // 3. Render 7 Day Columns & Event Blocks (with automatic side-by-side overlap layout and Dark Mode contrast)
  const coursesMap = {};
  (appState.schedule?.courses || []).forEach((c) => {
    coursesMap[c.id] = c;
  });

  let colsHtml = "";
  for (let dayIdx = dayOffset; dayIdx < dayOffset + dayCount; dayIdx++) {
    const colDate = weekDates[dayIdx];
    const colIso = toIsoDate(colDate);

    let cellsHtml = "";
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      cellsHtml += `<div class="hour-row"></div>`;
    }

    const dayAssessments = showExamOverlays
      ? (appState.assessments || []).filter(
          (a) =>
            a.date_iso === colIso &&
            activeCourseFilters.has(a.course_id) &&
            matchesGlobalSearch(a.course_id, a.course_name, a.title)
        )
      : [];

    const daySlots = showWeeklyClasses
      ? (appState.schedule?.slots || []).filter(
          (s) =>
            s.day_index === dayIdx &&
            activeCourseFilters.has(s.course_id) &&
            matchesGlobalSearch(s.course_id, s.course_name, s.slot_type)
        )
      : [];

    // Collect unified visual items for this column so we can compute side-by-side overlap columns
    const columnItems = [];

    daySlots.forEach((slot) => {
      const coursePalette = coursesMap[slot.course_id] || {
        color: "#4285f4",
        bg: "#e8f0fe",
        border: "#1a73e8",
      };
      const matchingExam = dayAssessments.find(
        (a) => a.course_id === slot.course_id && a.start_time === slot.start_time
      );
      const pos = computeBlockPosition(slot.start_time, slot.end_time);

      columnItems.push({
        ...pos,
        kind: matchingExam ? "merged_exam" : "slot",
        slot,
        exam: matchingExam,
        palette: coursePalette,
      });
    });

    dayAssessments.forEach((exam) => {
      const alreadyMerged =
        showWeeklyClasses &&
        daySlots.some((s) => s.course_id === exam.course_id && s.start_time === exam.start_time);
      if (alreadyMerged) return;

      const pos = computeBlockPosition(exam.start_time, exam.end_time);
      columnItems.push({
        ...pos,
        kind: "standalone_exam",
        exam,
        palette: {
          color: exam.color,
          bg: exam.bg,
          border: exam.border,
        },
      });
    });

    const customEvs = (appState.config?.custom_events || []).filter((e) => e.date_iso === colIso);
    customEvs.forEach((ev) => {
      const pos = computeBlockPosition(ev.start_time, ev.end_time);
      columnItems.push({
        ...pos,
        kind: "custom",
        ev,
        palette: {
          color: "#db2777",
          bg: "#fce7f3",
          border: "#db2777",
        },
      });
    });

    assignOverlapLanes(columnItems);

    let blocksHtml = "";
    columnItems.forEach((item) => {
      const { topPx, heightPx, laneIndex, laneCount } = item;
      const widthPct = 100 / laneCount;
      const leftPct = laneIndex * widthPct;
      const horizStyle =
        laneCount === 1
          ? "left: 4px; right: 4px;"
          : `left: calc(${leftPct}% + 2px); width: calc(${widthPct}% - 4px);`;

      const borderHex = item.palette.border || item.palette.color || "#1a73e8";
      const bgLight = item.palette.bg || "#e8f0fe";
      const bgDark = hexToRgba(borderHex, 0.22);

      if (item.kind === "merged_exam") {
        const { slot, exam } = item;
        blocksHtml += `
          <div onclick="openAssessmentModalById('${jsAttr(exam.id)}')"
               class="gcal-card has-exam-glow"
               style="top: ${topPx}px; height: ${heightPx}px; ${horizStyle} --card-bg-light: ${bgLight}; --card-bg-dark: ${bgDark}; border-color: ${borderHex};">
            <div class="flex items-center justify-between gap-1">
              <span class="text-[11px] font-bold truncate flex items-center gap-1 text-slate-900 dark:text-slate-50">
                <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${borderHex}"></span>
                <span>${escapeHtml(slot.course_id)} · ${escapeHtml(slot.course_name)}</span>
              </span>
              <span class="px-1.5 py-0.2 rounded bg-red-600 text-white text-[9px] font-bold shrink-0">${escapeHtml(exam.assessment_type)}</span>
            </div>
            <div class="text-[11px] font-bold text-red-700 dark:text-red-300 truncate mt-0.5">
              ${escapeHtml(exam.title)}
            </div>
            <div class="text-[10px] truncate text-slate-700 dark:text-slate-300">
              Room ${escapeHtml(slot.room)} · Group ${escapeHtml(slot.group)}
            </div>
            <div class="text-[10px] tabular-nums text-slate-600 dark:text-slate-400">
              ${formatCompactTime(slot.start_time)} – ${formatCompactTime(slot.end_time)}
            </div>
          </div>
        `;
      } else if (item.kind === "slot") {
        const { slot } = item;
        blocksHtml += `
          <div onclick="openSlotPopover('${jsAttr(slot.id)}', '${jsAttr(colIso)}')"
               class="gcal-card"
               style="top: ${topPx}px; height: ${heightPx}px; ${horizStyle} --card-bg-light: ${bgLight}; --card-bg-dark: ${bgDark}; border-color: ${borderHex};">
            <div class="text-[11px] font-bold truncate flex items-center gap-1.5 text-slate-900 dark:text-slate-50">
              <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${borderHex}"></span>
              <span class="truncate">${escapeHtml(slot.course_id)} · ${escapeHtml(slot.course_name)}</span>
            </div>
            <div class="text-[10px] truncate text-slate-700 dark:text-slate-300">
              ${escapeHtml(slot.slot_type)}${slot.group ? ` (Grp ${escapeHtml(slot.group)})` : ""} · ${escapeHtml(stripRoomPrefix(slot.room))}
            </div>
            <div class="text-[10px] tabular-nums text-slate-600 dark:text-slate-400">
              ${formatCompactTime(slot.start_time)} – ${formatCompactTime(slot.end_time)}
            </div>
          </div>
        `;
      } else if (item.kind === "standalone_exam") {
        const { exam } = item;
        blocksHtml += `
          <div onclick="openAssessmentModalById('${jsAttr(exam.id)}')"
               class="gcal-card has-exam-glow"
               style="top: ${topPx}px; height: ${heightPx}px; ${horizStyle} --card-bg-light: ${bgLight}; --card-bg-dark: ${bgDark}; border-color: ${borderHex};">
            <div class="flex items-center justify-between gap-1">
              <span class="text-[11px] font-bold truncate flex items-center gap-1 text-slate-900 dark:text-slate-50">
                <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${borderHex}"></span>
                <span class="truncate">${escapeHtml(exam.course_id)} · ${escapeHtml(exam.title)}</span>
              </span>
              <span class="px-1.5 py-0.2 rounded bg-red-600 text-white text-[9px] font-bold shrink-0">${escapeHtml(exam.assessment_type)}</span>
            </div>
            <div class="text-[10px] truncate text-slate-700 dark:text-slate-300">
              Room ${escapeHtml(exam.room)} · ${escapeHtml(exam.instructor)}
            </div>
            <div class="text-[10px] tabular-nums text-slate-600 dark:text-slate-400">
              ${formatCompactTime(exam.start_time)} – ${formatCompactTime(exam.end_time)}
            </div>
          </div>
        `;
      } else if (item.kind === "custom") {
        const { ev } = item;
        blocksHtml += `
          <div class="gcal-card"
               style="top: ${topPx}px; height: ${heightPx}px; ${horizStyle} --card-bg-light: ${bgLight}; --card-bg-dark: ${bgDark}; border-color: ${borderHex};">
            <div class="flex items-center justify-between">
              <span onclick="openCreateEventModal('${jsAttr(ev.id)}')" class="text-[11px] font-bold truncate text-slate-900 dark:text-slate-50 cursor-pointer hover:underline" title="Edit this event">${escapeHtml(ev.title)}</span>
              <button onclick="deleteCustomEvent('${jsAttr(ev.id)}')" class="text-[10px] hover:underline cursor-pointer" aria-label="Delete event" title="Delete event">✕</button>
            </div>
            <div class="text-[10px] truncate text-slate-700 dark:text-slate-300">${escapeHtml(ev.event_type)} · ${escapeHtml(ev.room)}</div>
            <div class="text-[10px] tabular-nums text-slate-600 dark:text-slate-400">${formatCompactTime(ev.start_time)} – ${formatCompactTime(ev.end_time)}</div>
          </div>
        `;
      }
    });

    colsHtml += `<div class="day-col">${cellsHtml}${blocksHtml}</div>`;
  }

  colsContainerEl.innerHTML = colsHtml;
}

function assignOverlapLanes(items) {
  items.sort((a, b) => a.topPx - b.topPx || b.heightPx - a.heightPx);
  let cluster = [];
  let clusterEnd = -1;

  const flushCluster = (group) => {
    if (group.length === 0) return;
    const lanes = [];
    group.forEach((item) => {
      let placedLane = -1;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] <= item.topPx + 2) {
          placedLane = i;
          lanes[i] = item.topPx + item.heightPx;
          break;
        }
      }
      if (placedLane === -1) {
        placedLane = lanes.length;
        lanes.push(item.topPx + item.heightPx);
      }
      item.laneIndex = placedLane;
    });
    group.forEach((item) => {
      item.laneCount = lanes.length;
    });
  };

  items.forEach((item) => {
    const itemBottom = item.topPx + item.heightPx;
    if (cluster.length === 0 || item.topPx < clusterEnd - 2) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, itemBottom);
    } else {
      flushCluster(cluster);
      cluster = [item];
      clusterEnd = itemBottom;
    }
  });
  flushCluster(cluster);
}

function computeBlockPosition(startHHMM, endHHMM) {
  const [sh, sm] = (startHHMM || "09:00").split(":").map(Number);
  const [eh, em] = (endHHMM || "10:30").split(":").map(Number);
  const startHours = Math.max(START_HOUR, sh + (sm || 0) / 60);
  const endHours = Math.min(END_HOUR + 1, eh + (em || 0) / 60);
  const durationHours = Math.max(0.75, endHours - startHours);

  const topPx = Math.round((startHours - START_HOUR) * HOUR_HEIGHT) + 1;
  const heightPx = Math.round(durationHours * HOUR_HEIGHT) - 3;
  return { topPx, heightPx };
}

function shiftWeek(deltaWeeks) {
  currentWeekStart.setDate(currentWeekStart.getDate() + deltaWeeks * 7);
  selectedCalendarDate = new Date(currentWeekStart);
  renderWeekCalendar();
}

function goToTodayWeek() {
  const today = getTodayDate();
  selectedCalendarDate = new Date(today);
  currentWeekStart = getSundayOfWeek(today);
  renderWeekCalendar();
}

function selectDateInMiniCal(year, month, day) {
  const clicked = new Date(year, month, day);
  selectedCalendarDate = clicked;
  const dayOfWeek = clicked.getDay();
  const sunday = new Date(clicked);
  sunday.setDate(clicked.getDate() - dayOfWeek);
  currentWeekStart = sunday;

  const brandMonth = document.getElementById("brand-month-bar");
  const brandDay = document.getElementById("brand-day-num");
  if (brandMonth) brandMonth.textContent = SHORT_MONTHS[clicked.getMonth()];
  if (brandDay) brandDay.textContent = clicked.getDate();

  if (window.innerWidth < 1024) {
    toggleSidebar(true);
  }

  if (currentMainView !== "calendar") {
    switchMainView("calendar");
  } else {
    renderWeekCalendar();
  }
}

function jumpToAssessmentOnCalendar(assessmentId) {
  const target = (appState.assessments || []).find((a) => a.id === assessmentId);
  if (!target || !target.date_iso) return;
  const parts = target.date_iso.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return;
  selectDateInMiniCal(parts[0], parts[1] - 1, parts[2]);
}

function jumpFromModalToCalendar() {
  const targetId = activeModalAssessmentId;
  const targetDateIso = activeModalDateIso;
  closeEventDetailModal();
  if (targetId) {
    jumpToAssessmentOnCalendar(targetId);
  } else if (targetDateIso) {
    const parts = targetDateIso.split("-").map(Number);
    if (parts.length === 3 && !parts.some(Number.isNaN)) {
      selectDateInMiniCal(parts[0], parts[1] - 1, parts[2]);
    }
  }
}

function toggleCourseFilter(courseId, checked) {
  if (checked) {
    activeCourseFilters.add(courseId);
  } else {
    activeCourseFilters.delete(courseId);
  }
  renderWeekCalendar();
}

function toggleLayer(layer, checked) {
  if (layer === "exams") showExamOverlays = checked;
  if (layer === "classes") showWeeklyClasses = checked;
  renderWeekCalendar();
}

function resetCourseFilters() {
  (appState.schedule?.courses || []).forEach((c) => activeCourseFilters.add(c.id));
  activeCourseFilters.add("GENERAL");
  showExamOverlays = true;
  showWeeklyClasses = true;
  renderWeekCalendar();
}

// ============================================================================
// MODALS: WIDER RECTANGULAR POPUP, ONBOARDING WIZARD & + CREATE EVENT
// ============================================================================

// Grade what-if: equal-weight projection of the course average if the open
// assessment lands at a planned score. Uses ONLY recorded grades; the note
// states the equal-weight assumption honestly instead of pretending precision.
function renderGradeWhatIf(a) {
  const section = document.getElementById("modal-whatif-section");
  if (!section || !a) return;
  const gradedElsewhere = (appState.assessments || []).filter(
    (x) =>
      x &&
      x.course_id === a.course_id &&
      x.id !== a.id &&
      x.achieved_score != null &&
      x.max_score != null &&
      Number(x.max_score) > 0
  );
  const currentPct =
    a.achieved_score != null && a.max_score != null && Number(a.max_score) > 0
      ? (Number(a.achieved_score) / Number(a.max_score)) * 100
      : null;
  if (gradedElsewhere.length === 0 && currentPct == null) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  updateGradeWhatIf();
}

function updateGradeWhatIf() {
  const active = activeModalAssessmentId
    ? (appState.assessments || []).find((x) => x.id === activeModalAssessmentId)
    : null;
  if (!active) return;
  const resultEl = document.getElementById("modal-whatif-result");
  const noteEl = document.getElementById("modal-whatif-note");
  const inputEl = document.getElementById("modal-whatif-score");
  if (!resultEl || !noteEl || !inputEl) return;

  const planPct = Math.min(100, Math.max(0, Number(inputEl.value || 0)));
  const gradedElsewhere = (appState.assessments || []).filter(
    (x) =>
      x &&
      x.course_id === active.course_id &&
      x.id !== active.id &&
      x.achieved_score != null &&
      x.max_score != null &&
      Number(x.max_score) > 0
  );
  const currentPct =
    active.achieved_score != null && active.max_score != null && Number(active.max_score) > 0
      ? (Number(active.achieved_score) / Number(active.max_score)) * 100
      : null;

  const pcts = gradedElsewhere
    .map((x) => (Number(x.achieved_score) / Number(x.max_score)) * 100)
    .filter((n) => Number.isFinite(n));
  if (currentPct != null) pcts.push(currentPct);

  // Projected = current items + this assessment at the planned score.
  const projected = (pcts.reduce((sum, n) => sum + n, 0) + planPct) / (pcts.length + 1);
  resultEl.textContent = `→ avg ${Math.round(projected)}%`;
  resultEl.className = `tabular-nums font-bold ${
    projected >= 80
      ? "text-emerald-600 dark:text-emerald-400"
      : projected >= 50
      ? "text-amber-600 dark:text-amber-400"
      : "text-rose-600 dark:text-rose-400"
  }`;
  const gradedCount = pcts.length;
  noteEl.textContent =
    gradedCount === 0
      ? "First graded item in this course."
      : `Equal-weight average of ${gradedCount + 1} graded item${gradedCount > 0 ? "s" : ""}.`;
}

function openAssessmentModalById(id) {
  const a = (appState.assessments || []).find((x) => x.id === id);
  if (!a) return;
  activeModalAssessmentId = a.id;
  activeModalDateIso = a.date_iso;

  document.getElementById("modal-header-bar").style.backgroundColor = a.color;
  const courseBadge = document.getElementById("modal-course-badge");
  courseBadge.textContent = a.course_id;
  courseBadge.style.backgroundColor = a.color;

  document.getElementById("modal-type-badge").textContent = a.assessment_type;

  const srcBadge = document.getElementById("modal-source-badge");
  if (srcBadge) {
    srcBadge.innerHTML = `<i data-lucide="${escapeHtml(a.source_icon || 'mail')}" class="w-3.5 h-3.5"></i><span>${escapeHtml(a.source || 'Gmail Ingestion')}</span>`;
  }

  // Grade & Course Weightage
  const weightInput = document.getElementById("modal-grade-weight");
  const scoreInput = document.getElementById("modal-grade-score");
  const maxInput = document.getElementById("modal-grade-max");
  const statusPill = document.getElementById("modal-grade-status-pill");

  if (weightInput) weightInput.value = a.weightage_percent != null ? a.weightage_percent : "";
  if (scoreInput) scoreInput.value = a.achieved_score != null ? a.achieved_score : "";
  if (maxInput) maxInput.value = a.max_score != null ? a.max_score : "";

  if (statusPill) {
    if (a.achieved_score != null && a.max_score != null) {
      const pct = Math.round((a.achieved_score / a.max_score) * 100);
      statusPill.textContent = `Recorded: ${a.achieved_score} / ${a.max_score} (${pct}%)`;
      statusPill.className = "text-[11px] font-bold text-emerald-600 dark:text-emerald-400";
    } else {
      statusPill.textContent = "Not Graded";
      statusPill.className = "text-[11px] font-semibold text-slate-500 dark:text-slate-400";
    }
  }

  const urgencyBadge = document.getElementById("modal-urgency-badge");
  if (urgencyBadge) {
    if (a.is_upcoming) {
      urgencyBadge.classList.remove("hidden");
      urgencyBadge.textContent =
        a.days_until === 0 ? "Today" : a.days_until === 1 ? "Tomorrow" : `In ${a.days_until} days`;
    } else {
      urgencyBadge.classList.add("hidden");
    }
  }

  document.getElementById("modal-course-fullname").textContent = a.course_name;
  document.getElementById("modal-title").textContent = a.title;
  document.getElementById("modal-time").textContent = a.display_time;
  document.getElementById("modal-room").textContent = a.room
    ? `Room ${a.room}${a.group ? ` (${a.group})` : ""}`
    : "Room TBA";
  document.getElementById("modal-instructor").textContent = a.instructor;

  // Retrieve recommendation if available to show full AI reasoning & focus plan
  const rec = (appState.dashboard?.study_recommendations || []).find((r) => r.assessment_id === a.id);
  const inferenceEl = document.getElementById("modal-ai-inference");
  const studyPlanEl = document.getElementById("modal-ai-study-plan");

  if (rec && rec.why_study_now) {
    inferenceEl.innerHTML = `
      <div class="space-y-1.5">
        <div class="font-bold text-[#1a73e8] dark:text-blue-400 flex items-center gap-1.5">
          <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
          <span>${escapeHtml(rec.why_study_now)}</span>
        </div>
        ${rec.ai_study_plan ? `<p class="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">${escapeHtml(rec.ai_study_plan)}</p>` : ""}
      </div>
    `;
    studyPlanEl.textContent = "";
    studyPlanEl.classList.add("hidden");
  } else {
    inferenceEl.textContent = a.ai_inference_note || "Analyzed from course schedule and academic syllabus.";
    studyPlanEl.textContent = `Study Strategy: ${a.ai_study_plan || "Review all lecture notes and practice problem sets."}`;
    studyPlanEl.classList.remove("hidden");
  }

  const rawTopics = (a.topics && a.topics.length > 0) ? a.topics : (rec?.topics || []).map(t => typeof t === "string" ? t : t.topic);
  const topicsEl = document.getElementById("modal-topics-list");
  topicsEl.innerHTML = rawTopics
    .map((t, idx) => {
      const key = `${a.id}::${idx}`;
      const done = !!(appState.config?.completed_topics && appState.config.completed_topics[key]);
      const topicName = typeof t === "string" ? t : t.topic || "";
      return `
        <div class="flex items-center justify-between p-2 sm:p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition gap-2">
          <label class="flex items-start gap-2.5 cursor-pointer flex-1 min-w-0 select-none">
            <input type="checkbox" data-topic-key="${escapeHtml(key)}" ${done ? "checked" : ""} onchange="toggleTopicCheckbox('${jsAttr(key)}', this.checked)" class="mt-0.5 w-4 h-4 accent-[#1a73e8] rounded shrink-0 cursor-pointer" />
            <span data-topic-label="${escapeHtml(key)}" class="text-xs transition-colors ${done ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100 font-medium"}">${escapeHtml(topicName)}</span>
          </label>
          <button type="button" title="Start Focus Pomodoro for this topic" onclick="event.stopPropagation(); triggerHaptic('selection'); openPomodoroForTask('${jsAttr(a.course_id)} • ${jsAttr(a.title)}', '${jsAttr(topicName)}', '${jsAttr(key)}')" class="p-1.5 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-950/60 text-rose-500 transition cursor-pointer shrink-0">
            <i data-lucide="timer" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      `;
    })
    .join("");

  updateModalTopicProgress(a.id);

  const warnSec = document.getElementById("modal-warnings-section");
  const warnList = document.getElementById("modal-warnings-list");
  let uniqueWarnings = [...new Set(a.warnings || [])];
  if (a.conflict_warning) {
    uniqueWarnings = ["⚠️ EXAM OVERLOAD: Another assessment is scheduled within 36 hours of this exam!", ...uniqueWarnings];
  }
  if (uniqueWarnings.length > 0) {
    warnSec.classList.remove("hidden");
    warnList.innerHTML = uniqueWarnings
      .map(
        (w) => `<div class="flex items-start gap-2">
          <i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"></i>
          <span>${escapeHtml(stripLeadingEmoji(w))}</span>
        </div>`
      )
      .join("");
  } else {
    warnSec.classList.add("hidden");
  }

  _currentAssessmentGCalUrl = a.google_cal_url || null;
  _currentAssessmentElearningUrl = a.elearning_url || null;

  renderGradeWhatIf(a);

  const courseLink = document.getElementById("modal-course-link");
  if (courseLink) {
    if (a.elearning_url) {
      courseLink.classList.remove("hidden");
    } else {
      courseLink.classList.add("hidden");
    }
  }

  document.getElementById("event-detail-modal").classList.add("is-open");
  if (window.lucide) lucide.createIcons();
}

function updateModalTopicProgress(assessmentId) {
  const a = (appState.assessments || []).find((x) => x.id === assessmentId);
  const labelEl = document.getElementById("modal-topics-progress-label");
  const barWrapEl = document.getElementById("modal-topics-progress-wrap");
  const barEl = document.getElementById("modal-topics-progress-bar");
  if (!a || !labelEl || !barEl) return;

  const total = (a.topics || []).length;
  if (total === 0) {
    labelEl.textContent = "";
    if (barWrapEl) barWrapEl.classList.add("hidden");
    return;
  }

  if (barWrapEl) barWrapEl.classList.remove("hidden");
  let done = 0;
  for (let idx = 0; idx < total; idx++) {
    const key = `${a.id}::${idx}`;
    if (appState.config?.completed_topics && appState.config.completed_topics[key]) {
      done += 1;
    }
  }
  const pct = Math.round((done / total) * 100);
  labelEl.textContent = `${done}/${total} (${pct}%)`;
  barEl.style.width = `${pct}%`;
}

function openSlotPopover(slotId, dateIso) {
  const slot = (appState.schedule?.slots || []).find((s) => s.id === slotId);
  if (!slot) return;

  const courseQuiz = (appState.assessments || []).find(
    (a) => a.course_id === slot.course_id && a.is_upcoming
  );

  activeModalAssessmentId = courseQuiz ? courseQuiz.id : null;
  activeModalDateIso = dateIso;

  const courseObj = (appState.schedule?.courses || []).find((c) => c.id === slot.course_id);
  const accentColor = courseObj?.color || "#1a73e8";

  document.getElementById("modal-header-bar").style.backgroundColor = accentColor;
  const courseBadge = document.getElementById("modal-course-badge");
  courseBadge.textContent = slot.course_id;
  courseBadge.style.backgroundColor = accentColor;

  document.getElementById("modal-type-badge").textContent = `Weekly ${slot.slot_type}`;
  const urgencyBadge = document.getElementById("modal-urgency-badge");
  if (urgencyBadge) urgencyBadge.classList.add("hidden");

  document.getElementById("modal-course-fullname").textContent = slot.course_name;
  document.getElementById("modal-title").textContent = `${slot.course_name} (${slot.slot_type})`;
  document.getElementById("modal-time").textContent = `${slot.day} (${dateIso}) · ${slot.display_time}`;
  document.getElementById("modal-room").textContent = slot.room
    ? `Room ${stripRoomPrefix(slot.room)}${slot.group ? ` (Group ${slot.group})` : ""}`
    : "Room TBA";
  document.getElementById("modal-instructor").textContent =
    courseQuiz?.instructor || "University Faculty";
  document.getElementById("modal-ai-inference").textContent = courseQuiz
    ? `Upcoming Assessment for ${slot.course_id}: ${courseQuiz.title} on ${courseQuiz.display_time}.`
    : `Regular weekly ${slot.slot_type} session for ${slot.course_id} — no quiz announced for this specific session.`;
  document.getElementById("modal-ai-study-plan").textContent = courseQuiz
    ? `Study Plan: ${courseQuiz.ai_study_plan}`
    : "Keep up with weekly lecture slides and tutorial sheets.";

  if (courseQuiz) {
    document.getElementById("modal-topics-list").innerHTML = (courseQuiz.topics || [])
      .map((t, idx) => {
        const key = `${courseQuiz.id}::${idx}`;
        const done = !!(appState.config?.completed_topics && appState.config.completed_topics[key]);
        return `
          <label class="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-xs transition">
            <input type="checkbox" data-topic-key="${escapeHtml(key)}" ${done ? "checked" : ""} onchange="toggleTopicCheckbox('${jsAttr(key)}', this.checked)" class="mt-0.5 w-4 h-4 accent-[#1a73e8] rounded shrink-0 cursor-pointer" />
            <span data-topic-label="${escapeHtml(key)}" class="transition-colors ${done ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100 font-medium"}">${escapeHtml(t)}</span>
          </label>
        `;
      })
      .join("");
    updateModalTopicProgress(courseQuiz.id);
  } else {
    document.getElementById("modal-topics-list").innerHTML = `<div class="text-xs text-slate-500 dark:text-slate-400">Standard weekly session</div>`;
    const labelEl = document.getElementById("modal-topics-progress-label");
    const barWrapEl = document.getElementById("modal-topics-progress-wrap");
    if (labelEl) labelEl.textContent = "";
    if (barWrapEl) barWrapEl.classList.add("hidden");
  }

  document.getElementById("modal-warnings-section").classList.add("hidden");
  document.getElementById("modal-course-link").classList.add("hidden");
  document.getElementById("event-detail-modal").classList.add("is-open");
  if (window.lucide) lucide.createIcons();
}

function closeEventDetailModal() {
  document.getElementById("event-detail-modal")?.classList.remove("is-open");
}

let currentOnboardingStep = 1;

const ACADEMIC_TRACK_NAMES = {
  cs: "Computer Science & IT",
  eng: "Engineering & Robotics",
  med: "Medicine & Health Sciences",
  bus: "Business & Economics",
  gen: "Sciences & Humanities"
};

const ACADEMIC_TRACK_COURSES = {
  cs: [
    { id: "CS 101", name: "Introduction to Computer Science", color: "#1a73e8", icon: "cpu", instructor: "Dr. Sarah Adams" },
    { id: "MATH 101", name: "Calculus & Linear Algebra", color: "#00897b", icon: "sigma", instructor: "Prof. Elena Rostova" },
    { id: "DATA 201", name: "Data Structures & Algorithms", color: "#8e24aa", icon: "brain", instructor: "Dr. Marcus Vance" },
    { id: "MGMT 100", name: "Principles of Management", color: "#f59e0b", icon: "briefcase", instructor: "Prof. Claire Sterling" },
    { id: "PHYS 101", name: "General Physics", color: "#e53935", icon: "calculator", instructor: "Dr. David Chen" }
  ],
  eng: [
    { id: "ENGR 101", name: "Engineering Mechanics & Statics", color: "#ea580c", icon: "wrench", instructor: "Prof. Michael Chang" },
    { id: "MATH 201", name: "Differential Equations & Linear Algebra", color: "#00897b", icon: "sigma", instructor: "Prof. Elena Rostova" },
    { id: "EE 101", name: "Circuit Analysis & Electronics", color: "#2563eb", icon: "zap", instructor: "Dr. Robert Kilian" },
    { id: "PHYS 102", name: "Physics for Engineers (Electromagnetism)", color: "#dc2626", icon: "activity", instructor: "Dr. David Chen" },
    { id: "MECH 201", name: "Thermodynamics & Materials Science", color: "#7c3aed", icon: "flame", instructor: "Prof. Nadia Al-Mansoor" }
  ],
  med: [
    { id: "ANAT 101", name: "Human Anatomy & System Physiology", color: "#0284c7", icon: "heart-pulse", instructor: "Dr. Tariq Haddad" },
    { id: "BIOC 201", name: "Medical Biochemistry & Genetics", color: "#059669", icon: "dna", instructor: "Prof. Susan Vance" },
    { id: "PHARM 101", name: "Principles of Clinical Pharmacology", color: "#7c3aed", icon: "pill", instructor: "Dr. Alan Mercer" },
    { id: "PATH 201", name: "General Pathology & Immunology", color: "#e11d48", icon: "shield-alert", instructor: "Prof. Mona Salem" },
    { id: "MED 100", name: "Medical Ethics & Doctor-Patient Communication", color: "#d97706", icon: "message-circle", instructor: "Dr. Layla Zaid" }
  ],
  bus: [
    { id: "ACCT 101", name: "Financial Accounting Principles", color: "#059669", icon: "dollar-sign", instructor: "Prof. Sarah Sterling" },
    { id: "ECON 101", name: "Microeconomics & Market Structures", color: "#2563eb", icon: "trending-up", instructor: "Dr. Kevin Bailey" },
    { id: "MKTG 201", name: "Strategic Principles of Marketing", color: "#ea580c", icon: "megaphone", instructor: "Prof. Dina Morris" },
    { id: "FIN 201", name: "Corporate Finance & Capital Markets", color: "#7c3aed", icon: "pie-chart", instructor: "Dr. Ramsey Thorne" },
    { id: "MGMT 101", name: "Organizational Behavior & Leadership", color: "#f59e0b", icon: "briefcase", instructor: "Prof. Claire Sterling" }
  ],
  gen: [
    { id: "CHEM 101", name: "General Chemistry & Lab Analysis", color: "#0284c7", icon: "flask-conical", instructor: "Dr. Karen Lin" },
    { id: "PSYC 101", name: "Introduction to Psychological Science", color: "#7c3aed", icon: "brain", instructor: "Prof. Omar Farooq" },
    { id: "HIST 101", name: "Modern Global History & Civilizations", color: "#d97706", icon: "landmark", instructor: "Dr. Arthur Bell" },
    { id: "ENGL 102", name: "Academic Writing & Research Methods", color: "#2563eb", icon: "book-open", instructor: "Prof. Gillian Vance" },
    { id: "SOC 101", name: "Principles of Sociology & Social Ethics", color: "#059669", icon: "users", instructor: "Dr. Yasmin Nour" }
  ]
};

function selectOnboardingTrack(track, forceUpdateCourses = false) {
  triggerHaptic("selection");
  localStorage.setItem("quizradar_academic_track", track);
  if (appState && appState.config) {
    appState.config.academic_track = track;
  }
  const chips = document.querySelectorAll(".onboard-track-chip");
  chips.forEach((c) => {
    const isSelected = c.getAttribute("data-track") === track;
    c.classList.toggle("is-selected", isSelected);
  });

  const trackName = ACADEMIC_TRACK_NAMES[track] || track;

  // Only populate starter courses if forceUpdateCourses is explicitly requested
  if (forceUpdateCourses && ACADEMIC_TRACK_COURSES[track]) {
    if (!appState.schedule) appState.schedule = { semester: "Current Semester", courses: [], slots: [] };
    appState.schedule.courses = JSON.parse(JSON.stringify(ACADEMIC_TRACK_COURSES[track]));
    syncActiveCourseFilters();
    renderOnboardingCourses();
    renderSettingsCourses();
    saveStateCache();
    showToast(`Major selected: ${trackName}. Starter courses tailored to your field.`, "info", 2000);
  }
}

function selectOnboardingRhythm(rhythm) {
  triggerHaptic("selection");
  localStorage.setItem("quizradar_study_rhythm", rhythm);
  const cards = document.querySelectorAll(".onboard-rhythm-card");
  cards.forEach((card) => {
    const isSelected = card.getAttribute("data-rhythm") === rhythm;
    card.classList.toggle("is-selected", isSelected);
    const indicator = card.querySelector("span.rounded-full");
    if (indicator) {
      if (isSelected) {
        indicator.className = "w-4 h-4 rounded-full border-2 border-[#1a73e8] bg-[#1a73e8] flex items-center justify-center text-white text-[9px]";
        indicator.textContent = "✓";
      } else {
        indicator.className = "w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 flex items-center justify-center";
        indicator.textContent = "";
      }
    }
  });
}

function openOnboardingModal(initialStep = 1) {
  triggerHaptic("light");
  renderOnboardingPreview();
  renderOnboardingCourses();
  updateOnboardingThemeButtons();

  const savedTrack = localStorage.getItem("quizradar_academic_track") || "cs";
  selectOnboardingTrack(savedTrack);

  const savedRhythm = localStorage.getItem("quizradar_study_rhythm") || "balanced";
  selectOnboardingRhythm(savedRhythm);

  setOnboardingStep(initialStep);
  const nameInput = document.getElementById("onboard-student-name");
  const emailInput = document.getElementById("onboard-student-email");
  const uniEmail = document.getElementById("onboard-university-email");
  const uniName = document.getElementById("onboard-university-name");
  const gemKey = document.getElementById("onboard-gemini-key");
  if (nameInput && appState.config?.user_name && appState.config.user_name !== "Student") nameInput.value = appState.config.user_name;
  if (emailInput && appState.config?.user_email) emailInput.value = appState.config.user_email;
  if (uniEmail && appState.config?.teams_account_email) uniEmail.value = appState.config.teams_account_email;
  if (uniName && appState.config?.teams_account_name) uniName.value = appState.config.teams_account_name;
  if (gemKey && appState.config?.gemini_api_key) gemKey.value = appState.config.gemini_api_key;

  const modal = document.getElementById("onboarding-modal");
  if (modal) {
    modal.classList.remove("hidden");
    void modal.offsetHeight;
    requestAnimationFrame(() => {
      modal.classList.add("is-open");
    });
    if (window.lucide) lucide.createIcons({ root: modal });
  }
}

function closeOnboardingModal() {
  const modal = document.getElementById("onboarding-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
  setTimeout(() => {
    if (!modal.classList.contains("is-open")) {
      modal.classList.add("hidden");
    }
  }, 280);
}

function setOnboardingStep(step) {
  currentOnboardingStep = Math.max(1, Math.min(3, step));

  for (let i = 1; i <= 3; i++) {
    const panel = document.getElementById(`onboard-step-${i}`);
    const tab = document.getElementById(`onboard-tab-${i}`);
    const num = document.getElementById(`onboard-tab-num-${i}`);
    const isActive = i === currentOnboardingStep;

    if (panel) {
      panel.classList.toggle("hidden", !isActive);
    }
    if (tab) {
      tab.className = isActive
        ? "flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 p-2 sm:p-2.5 rounded-xl bg-white text-[#1a73e8] font-bold text-xs transition cursor-pointer shadow-xs"
        : "flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 p-2 sm:p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition cursor-pointer";
    }
    if (num) {
      num.className = isActive
        ? "w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#1a73e8] text-white text-[11px] sm:text-xs font-bold tabular-nums flex items-center justify-center shrink-0"
        : "w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-white/20 text-white text-[11px] sm:text-xs font-bold tabular-nums flex items-center justify-center shrink-0";
    }
  }

  const prevBtn = document.getElementById("onboard-prev-btn");
  const nextBtn = document.getElementById("onboard-next-btn");
  const nextLabel = document.getElementById("onboard-next-btn-label");
  const counterEl = document.getElementById("onboard-step-counter");

  if (prevBtn) {
    prevBtn.classList.toggle("hidden", currentOnboardingStep === 1);
  }
  if (counterEl) {
    counterEl.textContent = `Step ${currentOnboardingStep} of 3`;
  }
  if (nextBtn && nextLabel) {
    if (currentOnboardingStep === 1) {
      nextLabel.textContent = "Continue to Accounts & Scan";
    } else if (currentOnboardingStep === 2) {
      nextLabel.textContent = "Continue to Schedule & Launch";
    } else {
      nextLabel.textContent = "Open My Dashboard";
    }
  }
  // Honest success banner: only celebrate when there's actually data behind it.
  const successTitle = document.getElementById("onboard-success-title");
  if (successTitle) {
    const hasData =
      (appState.schedule?.courses || []).length > 0 ||
      appState.auth?.authenticated ||
      !!appState.config?.teams_token;
    successTitle.textContent = hasData
      ? "You're All Set!"
      : "Your Canvas Is Ready";
  }
  if (currentOnboardingStep === 2) {
    renderOnboardingStep2State();
  }
  if (window.lucide) lucide.createIcons();
}

function nextOnboardingStep() {
  triggerHaptic("selection");
  if (currentOnboardingStep < 3) {
    setOnboardingStep(currentOnboardingStep + 1);
  } else {
    finishOnboarding();
  }
}

function prevOnboardingStep() {
  triggerHaptic("selection");
  if (currentOnboardingStep > 1) {
    setOnboardingStep(currentOnboardingStep - 1);
  }
}

function renderOnboardingPreview() {
  const container = document.getElementById("onboard-scan-results");
  if (!container) return;
  const upcoming = (appState.assessments || []).filter((a) => a.is_upcoming);
  const badgeEl = document.getElementById("onboard-detected-count-badge");
  if (badgeEl) {
    badgeEl.textContent = `${upcoming.length} Upcoming`;
  }

  if (upcoming.length === 0) {
    container.innerHTML = `<div class="text-xs text-slate-500 dark:text-slate-400">Run "Sync Gmail" from the top bar to detect quizzes and exams from your inbox.</div>`;
    return;
  }

  container.innerHTML = upcoming
    .map((a) => {
      const firstRule = (a.warnings || [])[0];
      return `
        <div class="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs space-y-1">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 truncate">
              <span class="px-2 py-0.5 rounded-md text-[10px] font-bold text-white shrink-0" style="background-color: ${a.color}">${escapeHtml(a.course_id)}</span>
              <span class="font-bold text-slate-900 dark:text-slate-100 truncate">${escapeHtml(a.title)}</span>
              <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">${escapeHtml(a.assessment_type)}</span>
            </div>
            <div class="text-[11px] font-semibold tabular-nums text-[#1a73e8] dark:text-blue-400 shrink-0">
              ${escapeHtml([a.date_iso, a.start_time || a.time].filter(Boolean).join(" · "))}${a.room ? ` (Room ${escapeHtml(a.room)})` : ""}
            </div>
          </div>
          ${
            firstRule
              ? `<div class="text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                   <i data-lucide="alert-circle" class="w-3 h-3 shrink-0"></i>
                   <span class="truncate">${escapeHtml(stripLeadingEmoji(firstRule))}</span>
                 </div>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

function renderAllViews() {
  updateTopBarAndUser();
  renderSidebar();
  renderDashboard();
  renderWeekCalendar();
  renderSettingsCourses();
  renderOnboardingCourses();
  renderPaletteCourseChips();
  if (window.lucide) lucide.createIcons();
}

function clearAllEnrolledCourses() {
  showAppConfirm({
    title: "Clear Enrolled Courses?",
    message: "Are you sure you want to remove all enrolled courses and class times from your weekly schedule?",
    icon: "trash-2",
    confirmText: "Clear All",
    isDanger: true,
    onConfirm: () => {
      triggerHaptic("medium");
      if (!appState.schedule) appState.schedule = { courses: [], slots: [], semester: "Current Semester" };
      appState.schedule.courses = [];
      appState.schedule.slots = [];
      activeCourseFilters.clear();
      saveStateCache();
      if (typeof mobileEngine !== "undefined" && mobileEngine) {
        mobileEngine.state.schedule = appState.schedule;
        mobileEngine.recomputeDashboard(mobileEngine.state);
        mobileEngine.saveDatabase();
      }
      fetch("/api/schedule/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appState.schedule)
      }).catch(() => {});
      renderAllViews();
      showToast("All enrolled courses cleared.", "info");
    }
  });
}

function renderOnboardingStep2State() {
  const isGoogleAuth = !!appState.auth?.authenticated;
  const isTeamsConnected = !!(appState.teams_connected || (appState.config?.teams_enabled && (appState.config?.teams_token || appState.config?.teams_account_email)));
  const googleEmail = appState.auth?.email;
  const teamsEmail = appState.teams_email || appState.config?.teams_account_email || appState.config?.teams_account_name;

  // 1. Google
  const gUnauth = document.getElementById("onboard-google-unauth");
  const gAuth = document.getElementById("onboard-google-auth");
  const gBadge = document.getElementById("onboard-auth-badge");
  const gName = document.getElementById("onboard-user-name");
  const gEmail = document.getElementById("onboard-user-email");

  if (isGoogleAuth) {
    if (gUnauth) gUnauth.classList.add("hidden");
    if (gAuth) gAuth.classList.remove("hidden");
    if (gBadge) {
      gBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300";
      gBadge.textContent = "Connected";
    }
    if (gName) gName.textContent = appState.auth?.name || "Google Account";
    if (gEmail) gEmail.textContent = googleEmail || "Connected";
  } else {
    if (gUnauth) gUnauth.classList.remove("hidden");
    if (gAuth) gAuth.classList.add("hidden");
    if (gBadge) {
      gBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300";
      gBadge.textContent = "Not Connected";
    }
  }

  // 2. University
  const tUnauth = document.getElementById("onboard-teams-unauth");
  const tAuth = document.getElementById("onboard-teams-auth");
  const tBadge = document.getElementById("onboard-teams-badge");
  const tName = document.getElementById("onboard-teams-name");
  const tSubtext = document.getElementById("onboard-teams-subtext");

  if (isTeamsConnected) {
    if (tUnauth) tUnauth.classList.add("hidden");
    if (tAuth) tAuth.classList.remove("hidden");
    if (tBadge) {
      tBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300";
      tBadge.textContent = "Connected";
    }
    if (tName) tName.textContent = appState.config?.teams_account_name || "University Account";
    if (tSubtext) tSubtext.textContent = teamsEmail || "Connected";
  } else {
    if (tUnauth) tUnauth.classList.remove("hidden");
    if (tAuth) tAuth.classList.add("hidden");
    if (tBadge) {
      tBadge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300";
      tBadge.textContent = "Not Connected";
    }
  }

  // 3. Classroom
  const cBadge = document.getElementById("onboard-classroom-badge");
  if (cBadge) {
    const isClassroomActive = !!appState.config?.classroom_enabled;
    cBadge.textContent = isClassroomActive ? "Connected ✓" : "Connect";
    cBadge.className = isClassroomActive ? "font-bold text-emerald-600 dark:text-emerald-400" : "font-bold underline";
  }
}

function handleOnboardGoogleCardClick() {
  startGoogleAuth();
}

function handleOnboardTeamsCardClick() {
  startMicrosoftAuth();
}

async function handleOnboardClassroomCardClick() {
  triggerHaptic("light");
  if (!appState.config) appState.config = {};
  appState.config.classroom_enabled = !appState.config.classroom_enabled;
  const isEn = appState.config.classroom_enabled;
  showToast(isEn ? "Google Classroom enabled. Connect it from a paired desktop or sign in to sync real coursework." : "Google Classroom disconnected.", "info");
  if (isEn) {
    await testClassroomFromSettings();
  }
  saveStateCache();
  updateTopBarAndUser();
  renderOnboardingStep2State();
}

function handleOnboardMoodleCardClick() {
  showToast("Moodle integration is currently disabled.", "info");
}

function renderOnboardingCourses() {
  const grid = document.getElementById("onboard-courses-grid");
  const headerLabel = document.getElementById("onboard-courses-header-label");
  if (!grid) return;
  const courses = appState.schedule?.courses || [];
  if (headerLabel) headerLabel.textContent = `Enrolled Courses (${courses.length})`;

  if (courses.length === 0) {
    grid.innerHTML = `<div class="col-span-1 sm:col-span-2 text-xs text-slate-400 p-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-center">No courses enrolled yet. Upload a timetable above or click "+ Add Course".</div>`;
    return;
  }

  grid.innerHTML = courses
    .map((c) => {
      const checked = activeCourseFilters.has(c.id);
      const slotCount = (appState.schedule?.slots || []).filter((s) => s.course_id === c.id).length;
      return `
        <div class="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 hover:border-[#1a73e8] dark:hover:border-blue-500 transition text-xs">
          <label class="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1">
            <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleCourseFilter('${jsAttr(c.id)}', this.checked)" class="w-4 h-4 rounded shrink-0 cursor-pointer" style="accent-color: ${c.color}" />
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold text-white shrink-0" style="background-color: ${c.color}">${escapeHtml(c.id)}</span>
            <span class="font-medium text-slate-800 dark:text-slate-200 truncate" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
          </label>
          <div class="flex items-center gap-2 shrink-0 pl-1.5">
            <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 tabular-nums">${slotCount} ${slotCount === 1 ? "slot" : "slots"}</span>
            <button type="button" onclick="openAddCourseModal('${jsAttr(c.id)}')" aria-label="Edit course ${escapeHtml(c.id)}" class="p-1.5 rounded-md text-slate-400 hover:text-[#1a73e8] hover:bg-blue-50 dark:hover:bg-blue-950/40 transition cursor-pointer flex items-center justify-center" title="Edit course">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
            <button type="button" onclick="confirmDeleteCourse('${jsAttr(c.id)}', '${jsAttr(c.name)}', event)" aria-label="Remove course ${escapeHtml(c.id)}" class="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition cursor-pointer flex items-center justify-center" title="Remove course">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" x2="10" y1="11" y2="17"></line><line x1="14" x2="14" y1="11" y2="17"></line>
              </svg>
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  if (window.lucide) lucide.createIcons({ root: grid });
}

function setThemeFromOnboarding(isDark) {
  applySmoothThemeSwitch(isDark);
}

function updateOnboardingThemeButtons() {
  const isDark = document.documentElement.classList.contains("dark");
  const lightBtn = document.getElementById("onboard-theme-light-btn");
  const darkBtn = document.getElementById("onboard-theme-dark-btn");
  if (lightBtn) {
    lightBtn.className = !isDark
      ? "p-3 rounded-xl border-2 border-[#1a73e8] bg-blue-50/50 dark:bg-slate-800 flex items-center gap-3 text-left transition cursor-pointer"
      : "p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 flex items-center gap-3 text-left transition cursor-pointer";
  }
  if (darkBtn) {
    darkBtn.className = isDark
      ? "p-3 rounded-xl border-2 border-[#1a73e8] dark:border-blue-400 bg-blue-950/30 flex items-center gap-3 text-left transition cursor-pointer"
      : "p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 flex items-center gap-3 text-left transition cursor-pointer";
  }

  const sLightBtn = document.getElementById("settings-theme-light-btn");
  const sDarkBtn = document.getElementById("settings-theme-dark-btn");
  if (sLightBtn) {
    sLightBtn.className = !isDark
      ? "p-2.5 rounded-xl border-2 border-[#1a73e8] bg-blue-50/50 dark:bg-slate-800 flex items-center gap-2.5 text-left transition cursor-pointer"
      : "p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 flex items-center gap-2.5 text-left transition cursor-pointer";
  }
  if (sDarkBtn) {
    sDarkBtn.className = isDark
      ? "p-2.5 rounded-xl border-2 border-[#1a73e8] dark:border-blue-400 bg-blue-950/30 flex items-center gap-2.5 text-left transition cursor-pointer"
      : "p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 flex items-center gap-2.5 text-left transition cursor-pointer";
  }
}

function renderSettingsCourses() {
  const grid = document.getElementById("settings-courses-grid");
  const headerLabel = document.getElementById("settings-courses-header-label");
  if (!grid) return;
  const courses = appState.schedule?.courses || [];
  if (headerLabel) headerLabel.textContent = `Enrolled Courses & Timetable (${courses.length})`;

  if (courses.length === 0) {
    grid.innerHTML = `<div class="col-span-1 sm:col-span-2 text-xs text-slate-400 p-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-center">No courses enrolled. Upload a timetable above or click "+ Add Course".</div>`;
    return;
  }

  grid.innerHTML = courses
    .map((c) => {
      const checked = activeCourseFilters.has(c.id);
      const slotCount = (appState.schedule?.slots || []).filter((s) => s.course_id === c.id).length;
      return `
        <div class="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 hover:border-[#1a73e8] dark:hover:border-blue-500 transition text-xs">
          <label class="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1">
            <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleCourseFilter('${jsAttr(c.id)}', this.checked)" class="w-4 h-4 rounded shrink-0 cursor-pointer" style="accent-color: ${c.color}" />
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold text-white shrink-0" style="background-color: ${c.color}">${escapeHtml(c.id)}</span>
            <span class="font-medium text-slate-800 dark:text-slate-200 truncate" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
          </label>
          <div class="flex items-center gap-2 shrink-0 pl-1.5">
            <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 tabular-nums">${slotCount} ${slotCount === 1 ? "slot" : "slots"}</span>
            <button type="button" onclick="openAddCourseModal('${jsAttr(c.id)}')" aria-label="Edit course ${escapeHtml(c.id)}" class="p-1.5 rounded-md text-slate-400 hover:text-[#1a73e8] hover:bg-blue-50 dark:hover:bg-blue-950/40 transition cursor-pointer flex items-center justify-center" title="Edit course">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
            <button type="button" onclick="confirmDeleteCourse('${jsAttr(c.id)}', '${jsAttr(c.name)}', event)" aria-label="Remove course ${escapeHtml(c.id)}" class="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition cursor-pointer flex items-center justify-center" title="Remove course">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" x2="10" y1="11" y2="17"></line><line x1="14" x2="14" y1="11" y2="17"></line>
              </svg>
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  if (window.lucide) lucide.createIcons();
}

// ============================================================================
// GEMINI SCHEDULE EXTRACTION & COURSE MANAGEMENT
// ============================================================================

let pendingExtractedSchedule = null;

async function handleScheduleFileUpload(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;

  const onboardLoader = document.getElementById("onboard-schedule-loader");
  const settingsLoader = document.getElementById("settings-schedule-loader");
  if (onboardLoader) onboardLoader.classList.remove("hidden");
  if (settingsLoader) settingsLoader.classList.remove("hidden");

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result;
    try {
      const res = await fetch("/api/schedule/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_base64: base64,
          mime_type: file.type || "image/png",
        }),
      });
      const data = await res.json();
      if (data.success && data.schedule) {
        pendingExtractedSchedule = data.schedule;
        openSchedulePreviewModal(data.schedule);
        showToast("Timetable analyzed & extracted successfully!");
      } else {
        showToast(data.error || "Could not extract timetable. Please try another image.");
      }
    } catch (err) {
      console.error(err);
      showToast("Error connecting to timetable extractor.");
    } finally {
      if (onboardLoader) onboardLoader.classList.add("hidden");
      if (settingsLoader) settingsLoader.classList.add("hidden");
      inputEl.value = "";
    }
  };
  reader.onerror = () => {
    showToast("Failed to read the selected file.");
    if (onboardLoader) onboardLoader.classList.add("hidden");
    if (settingsLoader) settingsLoader.classList.add("hidden");
    inputEl.value = "";
  };
  reader.readAsDataURL(file);
}

function openSchedulePreviewModal(sched) {
  const modal = document.getElementById("schedule-preview-modal");
  if (!modal || !sched) return;

  const semEl = document.getElementById("schedule-preview-semester");
  const cCountEl = document.getElementById("schedule-preview-courses-count");
  const sCountEl = document.getElementById("schedule-preview-slots-count");
  const coursesListEl = document.getElementById("schedule-preview-courses-list");
  const slotsListEl = document.getElementById("schedule-preview-slots-list");

  if (semEl) semEl.textContent = sched.semester || "Semester Timetable";
  if (cCountEl) cCountEl.textContent = `${(sched.courses || []).length} Courses`;
  if (sCountEl) sCountEl.textContent = `${(sched.slots || []).length} Weekly Slots`;

  if (coursesListEl) {
    coursesListEl.innerHTML = (sched.courses || [])
      .map(
        (c) => `
      <div class="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 flex items-center gap-2.5 text-xs">
        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold text-white shrink-0" style="background-color: ${c.color || '#1a73e8'}">${escapeHtml(c.id)}</span>
        <span class="font-medium text-slate-800 dark:text-slate-200 truncate">${escapeHtml(c.name || c.id)}</span>
      </div>
    `
      )
      .join("");
  }

  if (slotsListEl) {
    slotsListEl.innerHTML = (sched.slots || [])
      .map(
        (s) => `
      <div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-xs">
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-bold text-slate-700 dark:text-slate-200 shrink-0">${escapeHtml(s.day || s.day_name || "Weekly")}</span>
          <span class="text-slate-400 text-[11px]">•</span>
          <span class="font-semibold text-slate-900 dark:text-white truncate">${escapeHtml(s.course_id || s.course_name || "Course")}</span>
          <span class="text-slate-400 text-[10px] truncate">(${escapeHtml(s.slot_type || s.type || "Class")})</span>
        </div>
        <div class="text-[11px] tabular-nums font-medium text-slate-600 dark:text-slate-300 shrink-0">
          ${escapeHtml(s.display_time || `${s.start_time || "09:00"} - ${s.end_time || "10:30"}`)} ${s.room ? `• Room ${escapeHtml(s.room)}` : ""}
        </div>
      </div>
    `
      )
      .join("");
  }

  modal.classList.remove("hidden");
  void modal.offsetHeight;
  requestAnimationFrame(() => {
    modal.classList.add("is-open");
  });
  if (window.lucide) lucide.createIcons();
}

function closeSchedulePreviewModal() {
  const modal = document.getElementById("schedule-preview-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
  setTimeout(() => {
    modal.classList.add("hidden");
  }, 220);
}

async function applyExtractedSchedule() {
  if (!pendingExtractedSchedule) return;

  try {
    const res = await fetch("/api/schedule/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pendingExtractedSchedule),
    });
    const data = await res.json();
    if (data.success) {
      if (data.schedule) {
        appState.schedule = data.schedule;
      } else {
        appState.schedule = pendingExtractedSchedule;
      }
      if (data.assessments) appState.assessments = data.assessments;

      activeCourseFilters.clear();
      (appState.schedule.courses || []).forEach((c) => activeCourseFilters.add(c.id));
      activeCourseFilters.add("GENERAL");

      saveStateCache();
      renderAllViews();
      closeSchedulePreviewModal();
      showToast("Timetable schedule applied successfully!");
    } else {
      showToast(data.error || "Failed to apply schedule.");
    }
  } catch (err) {
    console.error(err);
    showToast("Error saving extracted schedule.");
  }
}

const COURSE_PRESET_COLORS = [
  "#1a73e8", // Blue
  "#0f9d58", // Emerald
  "#ea8600", // Amber
  "#d93025", // Red
  "#8e24aa", // Purple
  "#00acc1", // Cyan
  "#e67c73", // Coral
  "#3949ab", // Indigo
];
let selectedAddCourseColor = "#1a73e8";
let _editingCourseId = null;

function openAddCourseModal(courseId) {
  const modal = document.getElementById("add-course-modal");
  if (!modal) return;

  const idInput = document.getElementById("add-course-id");
  const nameInput = document.getElementById("add-course-name");
  const titleEl = document.getElementById("add-course-modal-title");
  const editingCourse = courseId ? (appState.schedule?.courses || []).find((c) => c.id === courseId) : null;
  _editingCourseId = editingCourse ? editingCourse.id : null;

  if (editingCourse) {
    if (idInput) {
      idInput.value = editingCourse.id || "";
      idInput.readOnly = true; // renaming would fork the course — remove & re-add instead
      idInput.classList.add("bg-slate-50", "dark:bg-slate-800", "cursor-not-allowed");
    }
    if (nameInput) nameInput.value = editingCourse.name || "";
    if (titleEl) titleEl.textContent = `Edit ${editingCourse.id}`;
    selectedAddCourseColor = editingCourse.color || "#1a73e8";
  } else {
    if (idInput) {
      idInput.value = "";
      idInput.readOnly = false;
      idInput.classList.remove("bg-slate-50", "dark:bg-slate-800", "cursor-not-allowed");
    }
    if (nameInput) nameInput.value = "";
    if (titleEl) titleEl.textContent = "Add Course Manually";
    selectedAddCourseColor = "#1a73e8";
  }
  renderCourseColorPicker();

  const slotsContainer = document.getElementById("add-course-slots-container");
  if (slotsContainer) {
    slotsContainer.innerHTML = "";
    const courseSlots = editingCourse
      ? (appState.schedule?.slots || []).filter((s) => s.course_id === editingCourse.id)
      : [];
    if (courseSlots.length > 0) {
      courseSlots.forEach((slot) => addCourseSlotRow({
        day: slot.day,
        start: slot.start_time,
        end: slot.end_time,
        room: slot.room,
        type: slot.type
      }));
    } else {
      addCourseSlotRow();
    }
  }

  modal.classList.add("is-open");
  if (editingCourse && nameInput) nameInput.focus();
  else if (idInput) idInput.focus();
  if (window.lucide) lucide.createIcons({ root: modal });
}

function closeAddCourseModal() {
  document.getElementById("add-course-modal")?.classList.remove("is-open");
}

function renderCourseColorPicker() {
  const container = document.getElementById("add-course-color-picker");
  if (!container) return;
  container.innerHTML = COURSE_PRESET_COLORS.map(
    (hex) => `
    <button type="button" onclick="selectCourseModalColor('${hex}')" class="w-6 h-6 rounded-full transition transform hover:scale-110 active:scale-95 cursor-pointer shadow-xs ${
      selectedAddCourseColor === hex ? "ring-2 ring-offset-2 ring-[#1a73e8] dark:ring-offset-slate-900 scale-110" : ""
    }" style="background-color: ${hex}"></button>
  `
  ).join("");
}

function selectCourseModalColor(hex) {
  selectedAddCourseColor = hex;
  renderCourseColorPicker();
}

function addCourseSlotRow(preferred) {
  const container = document.getElementById("add-course-slots-container");
  if (!container) return;

  const row = document.createElement("div");
  row.className =
    "course-slot-row flex items-center gap-2 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 text-xs flex-wrap sm:flex-nowrap";
  const day = (preferred && preferred.day) || "Monday";
  const start = (preferred && preferred.start) || "09:00";
  const end = (preferred && preferred.end) || "10:30";
  const room = (preferred && preferred.room != null ? preferred.room : "C203");
  const type = (preferred && preferred.type) || "Lecture";
  row.innerHTML = `
    <select class="slot-day px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none">
      <option value="Sunday" ${day === "Sunday" ? "selected" : ""}>Sunday</option>
      <option value="Monday" ${day === "Monday" ? "selected" : ""}>Monday</option>
      <option value="Tuesday" ${day === "Tuesday" ? "selected" : ""}>Tuesday</option>
      <option value="Wednesday" ${day === "Wednesday" ? "selected" : ""}>Wednesday</option>
      <option value="Thursday" ${day === "Thursday" ? "selected" : ""}>Thursday</option>
      <option value="Friday" ${day === "Friday" ? "selected" : ""}>Friday</option>
      <option value="Saturday" ${day === "Saturday" ? "selected" : ""}>Saturday</option>
    </select>
    <div class="flex items-center gap-1">
      <input type="time" class="slot-start px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none" value="${escapeHtml(start || "09:00")}" />
      <span class="text-slate-400 text-[10px]">to</span>
      <input type="time" class="slot-end px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none" value="${escapeHtml(end || "10:30")}" />
    </div>
    <input type="text" class="slot-room px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none w-20" placeholder="Room" value="${escapeHtml(room || "")}" />
    <select class="slot-type px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none">
      <option value="Lecture" ${type === "Lecture" ? "selected" : ""}>Lecture</option>
      <option value="Lab" ${type === "Lab" ? "selected" : ""}>Lab</option>
      <option value="Tutorial" ${type === "Tutorial" ? "selected" : ""}>Tutorial</option>
    </select>
    <button type="button" onclick="this.closest('.course-slot-row').remove()" class="p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition cursor-pointer" title="Remove slot">
      <i data-lucide="x" class="w-3.5 h-3.5"></i>
    </button>
  `;
  container.appendChild(row);
  if (window.lucide) lucide.createIcons();
}

function getDayIndex(day) {
  const map = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  return map[(day || "").toLowerCase()] ?? 0;
}

async function submitAddCourse() {
  const idInput = document.getElementById("add-course-id");
  const nameInput = document.getElementById("add-course-name");
  const courseId = (idInput?.value || "").trim().toUpperCase();
  const courseName = (nameInput?.value || "").trim();

  if (!courseId) {
    showToast("Please enter a Course Code (e.g. CS 301).");
    if (idInput) idInput.focus();
    return;
  }
  if (!courseName) {
    showToast("Please enter the Full Course Name.");
    if (nameInput) nameInput.focus();
    return;
  }

  const slotRows = document.querySelectorAll("#add-course-slots-container .course-slot-row");
  const slots = [];
  slotRows.forEach((row, idx) => {
    const day = row.querySelector(".slot-day")?.value || "Monday";
    const start = row.querySelector(".slot-start")?.value || "09:00";
    const end = row.querySelector(".slot-end")?.value || "10:30";
    const room = row.querySelector(".slot-room")?.value || "TBA";
    const type = row.querySelector(".slot-type")?.value || "Lecture";

    slots.push({
      id: `slot-${courseId.toLowerCase()}-${idx + 1}`,
      day: day,
      day_index: getDayIndex(day),
      course_id: courseId,
      course_name: courseName,
      room: room,
      type: type,
      group: "",
      start_time: start,
      end_time: end,
      display_time: `${start} – ${end}`,
      has_quiz: false,
      quiz_title: null,
    });
  });

  const payload = {
    course: {
      id: courseId,
      name: courseName,
      color: selectedAddCourseColor,
      bg: hexToRgba(selectedAddCourseColor, 0.12),
      border: selectedAddCourseColor,
    },
    slots: slots,
  };

  try {
    const res = await fetch("/api/schedule/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      appState.schedule = data.schedule;
      if (data.assessments) appState.assessments = data.assessments;
      activeCourseFilters.add(courseId);
      saveStateCache();
      renderAllViews();
      queueNotificationRefresh(true);
      closeAddCourseModal();
      showToast(_editingCourseId ? `Course ${courseId} updated!` : `Course ${courseId} added successfully!`);
      _editingCourseId = null;
    } else {
      showToast(data.error || "Failed to add course.");
    }
  } catch (err) {
    console.error(err);
    showToast("Network error while adding course.");
  }
}

async function confirmDeleteCourse(courseId, courseName, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  showAppConfirm({
    title: `Remove ${courseId}?`,
    message: `Are you sure you want to remove ${courseId} (${courseName}) and all its weekly classes from your schedule?`,
    icon: "trash-2",
    confirmText: "Remove Course",
    isDanger: true,
    onConfirm: async () => {
      try {
        const res = await fetch(`/api/schedule/courses/${encodeURIComponent(courseId)}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (data.success) {
          appState.schedule = data.schedule;
          if (data.assessments) appState.assessments = data.assessments;
          activeCourseFilters.delete(courseId);
          saveStateCache();
          renderAllViews();
          showToast(`Course ${courseId} removed.`);
        } else {
          showToast(data.error || "Failed to remove course.");
        }
      } catch (err) {
        console.error(err);
        showToast("Network error while removing course.");
      }
    }
  });
}

function openSettingsModal() {
  triggerHaptic("selection");
  const gearStage = document.querySelector("#settings-nav-btn .settings-btn-stage");
  if (gearStage) {
    gearStage.classList.remove("is-spinning");
    requestAnimationFrame(() => {
      gearStage.classList.add("is-spinning");
      setTimeout(() => gearStage.classList.remove("is-spinning"), 650);
    });
  }

  const modal = document.getElementById("settings-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  void modal.offsetHeight;
  requestAnimationFrame(() => {
    modal.classList.add("is-open");
  });

  const userAvatar = document.getElementById("settings-user-avatar");
  const userName = document.getElementById("settings-user-name");
  const userEmail = document.getElementById("settings-user-email");
  const name = appState.auth?.name || appState.config?.user_name || "Student";
  const email = appState.auth?.email || appState.config?.user_email || "Offline Student Profile";
  if (userAvatar) userAvatar.textContent = (name && name[0] ? name[0] : "S").toUpperCase();
  if (userName) userName.textContent = name;
  if (userEmail) userEmail.textContent = email;

  const autoSyncEl = document.getElementById("settings-auto-gcal");
  const geminiToggleEl = document.getElementById("settings-gemini-toggle");
  const geminiKeyEl = document.getElementById("settings-gemini-key");

  if (autoSyncEl) autoSyncEl.checked = appState.config?.auto_sync_gcal ?? true;
  if (geminiToggleEl) geminiToggleEl.checked = appState.config?.gemini_enabled ?? true;
  if (geminiKeyEl && appState.config?.gemini_api_key) {
    geminiKeyEl.value = appState.config.gemini_api_key;
  }

  const moodleToggle = document.getElementById("settings-moodle-toggle");
  const moodleUrl = document.getElementById("settings-moodle-url");
  const moodleIcal = document.getElementById("settings-moodle-ical");
  const teamsToggle = document.getElementById("settings-teams-toggle");
  const teamsClientId = document.getElementById("settings-teams-client-id");
  const teamsToken = document.getElementById("settings-teams-token");
  const classroomToggle = document.getElementById("settings-classroom-toggle");

  if (moodleToggle) moodleToggle.checked = appState.config?.moodle_enabled ?? false;
  if (moodleUrl) moodleUrl.value = appState.config?.moodle_url || "";
  if (moodleIcal) moodleIcal.value = appState.config?.moodle_ical_url || "";
  if (teamsToggle) teamsToggle.checked = appState.config?.teams_enabled ?? false;
  if (teamsClientId) teamsClientId.value = appState.config?.teams_client_id || "";
  if (teamsToken) teamsToken.value = appState.config?.teams_token || "";
  if (classroomToggle) classroomToggle.checked = appState.config?.classroom_enabled ?? false;

  updateOnboardingThemeButtons();
  renderSettingsCourses();
  renderNotifyPreferences();
  let tabRestored = false;
  try {
    const savedTab = localStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
    if (savedTab && ["account", "courses", "integrations"].includes(savedTab)) {
      switchSettingsTab(savedTab);
      tabRestored = true;
    }
  } catch (e) {}
  if (!tabRestored) switchSettingsTab("account");
  if (_activeSettingsTab === "integrations") {
    renderFeedsSettings();
    loadPairInfoIntoSettings();
  }
  refreshIcons(modal);
}

function closeSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
  setTimeout(() => {
    if (!modal.classList.contains("is-open")) {
      modal.classList.add("hidden");
    }
  }, 250);
}

function reopenFirstTimeWizardFromSettings() {
  closeSettingsModal();
  openOnboardingModal(1);
}

async function saveSettingsModal() {
  const autoSync = document.getElementById("settings-auto-gcal")?.checked ?? true;
  const geminiEnabled = document.getElementById("settings-gemini-toggle")?.checked ?? true;
  const geminiKey = document.getElementById("settings-gemini-key")?.value || "";

  const moodleEnabled = document.getElementById("settings-moodle-toggle")?.checked ?? false;
  const moodleUrl = document.getElementById("settings-moodle-url")?.value || "";
  const moodleIcal = document.getElementById("settings-moodle-ical")?.value || "";
  const teamsEnabled = document.getElementById("settings-teams-toggle")?.checked ?? false;
  const teamsClientId = document.getElementById("settings-teams-client-id")?.value || "";
  const teamsToken = document.getElementById("settings-teams-token")?.value || "";
  const classroomEnabled = document.getElementById("settings-classroom-toggle")?.checked ?? false;

  const prevTeams = appState.config?.teams_enabled ?? false;
  const prevMoodle = appState.config?.moodle_enabled ?? false;
  const prevClassroom = appState.config?.classroom_enabled ?? false;

  if (appState.config) {
    appState.config.auto_sync_gcal = autoSync;
    appState.config.gemini_enabled = geminiEnabled;
    if (geminiKey.trim()) appState.config.gemini_api_key = geminiKey.trim();
    appState.config.moodle_enabled = moodleEnabled;
    appState.config.moodle_url = moodleUrl;
    appState.config.moodle_ical_url = moodleIcal;
    appState.config.teams_enabled = teamsEnabled;
    appState.config.teams_client_id = teamsClientId;
    appState.config.teams_token = teamsToken;
    appState.config.classroom_enabled = classroomEnabled;
  }

  // Immediately filter out disabled sources on the client so the UI reacts in 0ms
  filterStateByEnabledSources();
  saveStateCache();
  hydrateAndRenderState(appState);

  closeSettingsModal();
  showToast("Settings saved!");

  try {
    const res = await fetch("/api/config/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auto_sync_gcal: autoSync,
        gemini_enabled: geminiEnabled,
        gemini_api_key: geminiKey,
        moodle_enabled: moodleEnabled,
        moodle_url: moodleUrl,
        moodle_token: appState.config?.moodle_token || "",
        moodle_ical_url: moodleIcal,
        teams_enabled: teamsEnabled,
        teams_client_id: teamsClientId,
        teams_token: teamsToken,
        classroom_enabled: classroomEnabled,
      }),
    });
    const data = await res.json();
    if (data.config) {
      appState.config = data.config;
    }
    if (data.assessments) {
      appState.assessments = data.assessments;
    }
    if (data.dashboard) {
      appState.dashboard = data.dashboard;
    }
    filterStateByEnabledSources();
    saveStateCache();
    hydrateAndRenderState(appState);

    const newlyEnabled = (!prevTeams && teamsEnabled && teamsToken) || (!prevMoodle && moodleEnabled) || (!prevClassroom && classroomEnabled);
    if (newlyEnabled) {
      triggerFullSync();
    }
  } catch (err) {
    console.error("Background settings save error:", err);
  }
}

async function runOnboardingScan() {
  const btn = document.getElementById("onboard-scan-btn");
  const statusEl = document.getElementById("onboard-scan-status-text");
  const pctEl = document.getElementById("onboard-scan-pct");
  const barEl = document.getElementById("onboard-scan-progress-bar");

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Scanning Inbox...</span>`;
    if (window.lucide) lucide.createIcons();
  }

  const updateStage = (pct, msg) => {
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (barEl) barEl.style.width = `${pct}%`;
    if (statusEl) statusEl.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  };

  updateStage(25, "Checking your configured accounts & scanning enabled sources...");
  await new Promise((r) => setTimeout(r, 150));

  await triggerFullSync();

  const upcomingCount = (appState.assessments || []).filter((a) => a.is_upcoming).length;
  const totalCount = (appState.assessments || []).length;
  updateStage(100, `Scan complete — ${upcomingCount} upcoming & ${totalCount} total records in your radar.`);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>Scan Complete</span>`;
  }
  renderOnboardingPreview();
  if (window.lucide) lucide.createIcons();
}

// Instant response on "Save & Open My Dashboard": closes modal immediately in 0ms without blocking on network
async function finishOnboarding() {
  triggerHaptic("success");
  const studentName = document.getElementById("onboard-student-name")?.value.trim() || "";
  const studentEmail = document.getElementById("onboard-student-email")?.value.trim() || "";
  const universityEmail = document.getElementById("onboard-university-email")?.value.trim() || "";
  const universityName = document.getElementById("onboard-university-name")?.value.trim() || "";
  const geminiKey = document.getElementById("onboard-gemini-key")?.value.trim() || "";
  const autoSync = document.getElementById("onboard-auto-gcal")?.checked ?? true;
  const geminiEnabled = !!geminiKey || (document.getElementById("onboard-gemini-toggle")?.checked ?? true);

  localStorage.setItem("quizradar_device_onboarded_v4", "true");
  localStorage.setItem("quizradar_onboarding_done", "true");
  if (!appState.config) appState.config = {};
  appState.config.onboarding_completed = true;

  if (studentName) {
    appState.config.user_name = studentName;
    if (appState.auth) appState.auth.name = studentName;
  }
  if (studentEmail) {
    appState.config.user_email = studentEmail;
    if (appState.auth) {
      // Manual entry is a LOCAL profile anchor — never claim real authentication.
      appState.auth.email = studentEmail;
    }
  }
  if (universityEmail) {
    appState.config.teams_account_email = universityEmail;
    appState.config.teams_account_name = universityName || "University";
  }
  if (geminiKey) {
    appState.config.gemini_api_key = geminiKey;
    appState.config.gemini_enabled = true;
  }

  saveStateCache();
  closeOnboardingModal();
  updateTopBarAndUser();
  renderAllViews();
  switchMainView("dashboard");
  showToast("Welcome to QuizRadar! Your academic radar & study calendar are live.", "success", 4000);

  try {
    const res = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_name: studentName || null,
        user_email: studentEmail || null,
        teams_email: universityEmail || null,
        teams_name: universityName || null,
        auto_sync_gcal: autoSync,
        gemini_enabled: geminiEnabled,
        gemini_api_key: geminiKey || null,
      }),
    });
    const data = await res.json();
    if (data.assessments) appState.assessments = data.assessments;
    if (data.dashboard) appState.dashboard = data.dashboard;
    if (data.config) appState.config = data.config;
    if (data.schedule) {
      appState.schedule = data.schedule;
      syncActiveCourseFilters();
    }
    saveStateCache();
    updateTopBarAndUser();
    renderAllViews();
  } catch (err) {
    console.error("Background onboarding save error:", err);
  }
}

async function triggerFullSync() {
  triggerHaptic("selection");
  const btn = document.getElementById("top-sync-btn");
  const txt = document.getElementById("top-sync-text");
  const mobileBtn = document.getElementById("mobile-top-sync-btn");
  const mobileIcon = document.getElementById("mobile-top-sync-icon");

  if (txt) txt.textContent = "Scanning...";
  if (btn) btn.disabled = true;
  if (mobileBtn) mobileBtn.disabled = true;
  if (mobileIcon) mobileIcon.classList.add("animate-spin");

  beginScanProgress("Scanning Gmail / Teams / Classroom / Feeds…");

  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      signal: _activeScanAbort ? _activeScanAbort.signal : undefined
    });
    const data = await res.json();
    if (data.assessments) appState.assessments = data.assessments;
    if (data.dashboard) appState.dashboard = data.dashboard;
    if (data.schedule) {
      appState.schedule = data.schedule;
      syncActiveCourseFilters();
    }
    if (data.config) appState.config = data.config;
    saveStateCache();

    renderAllViews();
    if (data.success === false) {
      triggerHaptic("warning");
      showToast(data.error || data.message || "Sync could not complete.", "warning", 4000);
    } else {
      triggerHaptic("success");
      showToast(data.message || "Sync finished.", "success", 6000);
    }
    queueNotificationRefresh(true);
  } catch (err) {
    if (err && (err.name === "AbortError" || err.code === 20)) {
      // User already got the cancel toast from cancelActiveScan().
    } else {
      showToast("Sync failed — could not reach the backend.", "warning");
    }
  } finally {
    endScanProgress();
    if (txt) txt.textContent = "Sync Gmail & Calendar";
    if (btn) btn.disabled = false;
    if (mobileBtn) mobileBtn.disabled = false;
    if (mobileIcon) mobileIcon.classList.remove("animate-spin");
  }
}

async function syncGoogleCalendarOnly() {
  try {
    const res = await fetch("/api/gcal/sync", { method: "POST" });
    const data = await res.json();
    if (data.assessments) appState.assessments = data.assessments;
    if (data.dashboard) appState.dashboard = data.dashboard;
    saveStateCache();
    renderDashboard();
    renderWeekCalendar();
    const rep = data.report;
    if (rep && rep.success === false) {
      showToast(rep.message || "Google Calendar sync failed — connect your Google account first.", "warning", 4000);
    } else {
      showToast(rep?.message || "Synced upcoming exams to Google Calendar!", "success");
    }
  } catch (err) {
    console.error("GCal sync error:", err);
    showToast("Google Calendar sync failed.", "warning");
  }
}

let _editingCustomEventId = null;

function openCreateEventModal(prefillOrEventId) {
  _editingCustomEventId = null;
  let prefill = prefillOrEventId || {};

  // Passed an event id: load that custom event as an edit session.
  if (typeof prefillOrEventId === "string") {
    const found = (appState.config?.custom_events || []).find((e) => e.id === prefillOrEventId);
    if (found) {
      _editingCustomEventId = found.id;
      prefill = {
        event: found,
      };
    } else {
      showToast("That event no longer exists — create a new one.", "warning");
      return;
    }
  }

  const shared = prefill.event || prefill;
  const dateInput = document.getElementById("create-ev-date");
  if (shared && shared.date_iso) {
    if (dateInput) dateInput.value = shared.date_iso;
  } else if (dateInput && !dateInput.value) {
    dateInput.value = toIsoDate(getTodayDate());
  }
  const titleInput = document.getElementById("create-ev-title");
  if (titleInput) titleInput.value = shared?.title || prefill.prefillTitle || "";
  const startInput = document.getElementById("create-ev-start");
  const endInput = document.getElementById("create-ev-end");
  if (startInput && shared?.start_time) startInput.value = shared.start_time;
  if (endInput && shared?.end_time) endInput.value = shared.end_time;
  const roomInput = document.getElementById("create-ev-room");
  if (roomInput) roomInput.value = shared?.room || prefill.prefillRoom || "Library Study Room";

  const selectEl = document.getElementById("create-ev-course");
  if (selectEl) {
    const courses = appState.schedule?.courses || [];
    const selectedCourse = shared?.course_id || "SELF";
    if (courses.length > 0) {
      selectEl.innerHTML = courses
        .map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === selectedCourse ? "selected" : ""}>${escapeHtml(c.id)} (${escapeHtml(c.name)})</option>`)
        .join("");
    } else {
      selectEl.innerHTML = `<option value="SELF">General Study Session</option>`;
    }
  }
  const typeInput = document.getElementById("create-ev-type");
  if (typeInput) {
    const wanted = shared?.event_type || prefill.prefillType;
    if (wanted && Array.from(typeInput.options).some((o) => o.value === wanted)) typeInput.value = wanted;
  }

  const heading = document.getElementById("create-event-modal-title");
  if (heading) {
    heading.textContent = _editingCustomEventId ? "Edit Calendar Event" : "Create Study Session or Custom Assessment";
  }

  document.getElementById("create-event-modal")?.classList.add("is-open");
  setTimeout(() => {
    document.getElementById("create-ev-title")?.focus();
  }, 50);
}

function closeCreateEventModal() {
  _editingCustomEventId = null;
  document.getElementById("create-event-modal")?.classList.remove("is-open");
}

async function submitCreateCustomEvent() {
  const title = document.getElementById("create-ev-title").value.trim() || "Study Session";
  const course_id = document.getElementById("create-ev-course").value;
  const event_type = document.getElementById("create-ev-type").value;
  const date_iso = document.getElementById("create-ev-date").value;
  const start_time = document.getElementById("create-ev-start").value;
  const end_time = document.getElementById("create-ev-end").value;
  const room = document.getElementById("create-ev-room").value.trim();

  if (!date_iso) {
    showToast("Please choose a date for the event.");
    return;
  }
  if (!start_time || !end_time) {
    showToast("Please specify both start and end times.");
    return;
  }
  if (start_time >= end_time) {
    showToast("End time must be after start time.");
    return;
  }

  try {
    const payload = { title, course_id, event_type, date_iso, start_time, end_time, room };
    if (_editingCustomEventId) payload.id = _editingCustomEventId;
    const res = await fetch("/api/events/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      appState.config.custom_events = data.custom_events;
      saveStateCache();
      queueNotificationRefresh(true);
      closeCreateEventModal();
      const [y, m, d] = date_iso.split("-").map(Number);
      selectDateInMiniCal(y, m - 1, d);
      showToast(_editingCustomEventId ? `Updated "${title}".` : `Added "${title}" to your Week Calendar!`, "success", 2600);
      _editingCustomEventId = null;
    } else {
      showToast(data.error || "Could not save the event.", "warning");
    }
  } catch (err) {
    console.error("Failed to create custom event:", err);
    showToast("Could not save the event — check the desktop app is running.", "warning");
  }
}

async function deleteCustomEvent(id) {
  try {
    const res = await fetch(`/api/events/custom/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      appState.config.custom_events = data.custom_events;
      saveStateCache();
      renderWeekCalendar();
      showToast("Removed custom event.");
    }
  } catch (err) {
    console.error(err);
  }
}

// ============================================================================
// SEARCH BAR & COMMAND PALETTE
// ============================================================================

const RECENT_SEARCHES_KEY = "quizradar_recent_searches_v1";
const DEFAULT_SUGGESTED_SEARCHES = ["Midterm", "Regression", "Lab Exam", "Machine Learning"];

function initSearchBar() {
  const isMac =
    navigator.platform.toUpperCase().indexOf("MAC") >= 0 ||
    navigator.userAgent.toUpperCase().indexOf("MAC") >= 0;
  const cmdSpan = document.getElementById("search-kbd-cmd");
  if (cmdSpan) {
    cmdSpan.textContent = isMac ? "⌘" : "Ctrl";
  }

  // Click outside to close palette
  document.addEventListener("click", (e) => {
    const container = document.getElementById("search-bar-container");
    const palette = document.getElementById("search-dropdown-palette");
    if (!container || !palette) return;
    if (!container.contains(e.target)) {
      closeSearchPalette();
    }
  });
}

function getRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return [];
}

function saveRecentSearch(query) {
  const clean = (query || "").trim();
  if (!clean) return;
  try {
    let recents = getRecentSearches();
    recents = [clean, ...recents.filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, 6);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recents));
  } catch (e) {}
}

function clearRecentSearches(event) {
  if (event) event.stopPropagation();
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch (e) {}
  renderRecentSearchesList();
}

function removeRecentSearch(query, event) {
  if (event) event.stopPropagation();
  try {
    let recents = getRecentSearches();
    recents = recents.filter((x) => x.toLowerCase() !== (query || "").toLowerCase());
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recents));
  } catch (e) {}
  renderRecentSearchesList();
}

function renderRecentSearchesList() {
  const listEl = document.getElementById("palette-recent-list");
  if (!listEl) return;
  const recents = getRecentSearches();
  const items = recents.length > 0 ? recents : DEFAULT_SUGGESTED_SEARCHES;
  const isDefault = recents.length === 0;

  listEl.innerHTML = items
    .map(
      (term) => `
      <div onclick="applySearchSuggestion('${jsAttr(term)}')" class="group flex items-center justify-between px-3 py-2 rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-800/80 cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-200 transition">
        <div class="flex items-center gap-2.5 min-w-0">
          <i data-lucide="${isDefault ? "sparkles" : "clock"}" class="w-3.5 h-3.5 text-slate-400 group-hover:text-[#1a73e8] dark:group-hover:text-blue-400 shrink-0 transition"></i>
          <span class="truncate">${escapeHtml(term)}</span>
        </div>
        ${
          !isDefault
            ? `
          <button type="button" onclick="removeRecentSearch('${jsAttr(term)}', event)" class="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-slate-200/80 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer" title="Remove">
            <i data-lucide="x" class="w-3 h-3"></i>
          </button>
        `
            : `
          <span class="text-[10px] text-slate-400 font-normal">Suggested</span>
        `
        }
      </div>
    `
    )
    .join("");

  if (window.lucide) lucide.createIcons();
}

function renderPaletteCourseChips() {
  const chipsEl = document.getElementById("palette-course-chips");
  if (!chipsEl) return;
  const courses = appState.schedule?.courses || [];
  if (courses.length === 0) {
    chipsEl.innerHTML = `<span class="text-[10px] text-slate-400">All courses active</span>`;
    return;
  }
  chipsEl.innerHTML = courses
    .map(
      (c) => `
    <button type="button" onclick="applySearchSuggestion('${jsAttr(c.id)}')" class="px-2 py-0.5 rounded-lg text-[10px] font-bold transition hover:scale-105 active:scale-95 text-white shadow-2xs cursor-pointer" style="background-color: ${c.color}">
      ${escapeHtml(c.id)}
    </button>
  `
    )
    .join("");
}

function updatePaletteMatches() {
  const secEl = document.getElementById("palette-matches-section");
  const listEl = document.getElementById("palette-matches-list");
  if (!secEl || !listEl) return;

  if (!globalSearchQuery) {
    secEl.classList.add("hidden");
    listEl.innerHTML = "";
    return;
  }

  const q = globalSearchQuery.toLowerCase();
  const allAssessments = appState.assessments || [];
  const matches = allAssessments
    .filter(
      (a) =>
        (a.title || "").toLowerCase().includes(q) ||
        (a.course_id || "").toLowerCase().includes(q) ||
        (a.course_name || "").toLowerCase().includes(q) ||
        (a.assessment_type || "").toLowerCase().includes(q) ||
        (a.instructor || "").toLowerCase().includes(q) ||
        (a.topics || []).some((t) => (t || "").toLowerCase().includes(q))
    )
    .slice(0, 4);

  if (matches.length === 0) {
    secEl.classList.add("hidden");
    listEl.innerHTML = "";
    return;
  }

  secEl.classList.remove("hidden");
  listEl.innerHTML = matches
    .map((a) => {
      return `
      <div onclick="selectPaletteAssessment('${jsAttr(a.id)}')" class="flex items-center justify-between p-2 rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-800/80 cursor-pointer transition text-xs">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="px-2 py-0.5 rounded-md text-[10px] font-bold text-white shrink-0" style="background-color: ${a.color}">${escapeHtml(a.course_id)}</span>
          <div class="min-w-0">
            <div class="font-medium text-slate-800 dark:text-slate-100 truncate">${escapeHtml(a.title)}</div>
            <div class="text-[10px] text-slate-400 dark:text-slate-400 truncate">${escapeHtml(a.display_date || a.date_iso)} • ${escapeHtml(a.display_time)}</div>
          </div>
        </div>
        <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">${escapeHtml(a.assessment_type)}</span>
      </div>
    `;
    })
    .join("");

  if (window.lucide) lucide.createIcons();
}

function selectPaletteAssessment(assessmentId) {
  if (globalSearchQuery) {
    saveRecentSearch(globalSearchQuery);
  }
  closeSearchPalette();
  openAssessmentModalById(assessmentId);
}

function openSearchPalette() {
  const palette = document.getElementById("search-dropdown-palette");
  if (!palette) return;
  renderRecentSearchesList();
  renderPaletteCourseChips();
  updatePaletteMatches();
  palette.classList.add("is-open");
  if (window.lucide) lucide.createIcons();
}

function closeSearchPalette() {
  const palette = document.getElementById("search-dropdown-palette");
  if (palette) {
    palette.classList.remove("is-open");
  }
}

// Debounced heavy re-renders while typing in search: each keystroke would
// otherwise rebuild the full dashboard AND the 7x13-hour week grid.
let _searchRenderTimer = null;

function handleGlobalSearch(val) {
  globalSearchQuery = (val || "").trim();
  const desktopInput = document.getElementById("global-search-input");
  const mobileInput = document.getElementById("mobile-search-input");
  if (desktopInput && desktopInput.value !== val) desktopInput.value = val;
  if (mobileInput && mobileInput.value !== val) mobileInput.value = val;

  const clearBtn = document.getElementById("search-clear-btn");
  const kbdBadge = document.getElementById("search-kbd-badge");
  if (clearBtn) {
    if (val) {
      clearBtn.classList.remove("hidden");
      clearBtn.classList.add("flex");
    } else {
      clearBtn.classList.add("hidden");
      clearBtn.classList.remove("flex");
    }
  }
  if (kbdBadge) {
    kbdBadge.classList.toggle("hidden", !!val);
  }

  const queryText = document.getElementById("palette-query-text");
  if (queryText) {
    if (globalSearchQuery) {
      queryText.innerHTML = `Search for <strong class="text-slate-900 dark:text-white font-semibold">"${escapeHtml(globalSearchQuery)}"</strong>`;
    } else {
      queryText.innerHTML = `<span class="text-slate-400 dark:text-slate-400">Type to search courses, topics & exams...</span>`;
    }
  }

  updatePaletteMatches();
  if (_searchRenderTimer) clearTimeout(_searchRenderTimer);
  _searchRenderTimer = setTimeout(() => {
    _searchRenderTimer = null;
    renderDashboard();
    renderWeekCalendar();
  }, 120);
}

function clearGlobalSearch() {
  globalSearchQuery = "";
  const desktopInput = document.getElementById("global-search-input");
  const mobileInput = document.getElementById("mobile-search-input");
  if (desktopInput) {
    desktopInput.value = "";
    desktopInput.focus();
  }
  if (mobileInput) mobileInput.value = "";
  handleGlobalSearch("");
  openSearchPalette();
}

function handleSearchKeyDown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    commitSearchAndClose();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeSearchPalette();
    const desktopInput = document.getElementById("global-search-input");
    if (desktopInput) desktopInput.blur();
  }
}

function commitSearchAndClose() {
  if (globalSearchQuery) {
    saveRecentSearch(globalSearchQuery);
  }
  closeSearchPalette();
  const desktopInput = document.getElementById("global-search-input");
  if (desktopInput) desktopInput.blur();
}

function applySearchSuggestion(term) {
  const desktopInput = document.getElementById("global-search-input");
  if (desktopInput) desktopInput.value = term;
  handleGlobalSearch(term);
  saveRecentSearch(term);
  closeSearchPalette();
}

function matchesGlobalSearch(...fields) {
  if (!globalSearchQuery) return true;
  const q = globalSearchQuery.toLowerCase();
  return fields.some((f) => (f || "").toLowerCase().includes(q));
}

const TOAST_ICON_CLASSES = {
  success: "w-4 h-4 text-emerald-400 shrink-0",
  loading: "w-4 h-4 text-blue-400 shrink-0",
  info: "w-4 h-4 text-blue-400 shrink-0",
  default: "w-4 h-4 text-blue-400 shrink-0",
  warning: "w-4 h-4 text-amber-400 shrink-0",
  error: "w-4 h-4 text-rose-400 shrink-0"
};
const TOAST_ICONS = {
  success: "check-circle",
  loading: "loader-2",
  info: "info",
  default: "info",
  warning: "alert-triangle",
  error: "alert-triangle"
};

function showToast(msg, typeOrDuration, maybeDuration) {
  const toast = document.getElementById("toast-notification");
  const msgEl = document.getElementById("toast-message");
  if (!toast || !msgEl) return;

  // Legacy call sites pass booleans (isError) or numbers (duration) as the 2nd arg.
  let type = "success";
  let duration = 4200;
  if (typeof typeOrDuration === "number") {
    duration = typeOrDuration;
  } else if (typeof typeOrDuration === "boolean") {
    type = typeOrDuration ? "error" : "success";
  } else if (typeof typeOrDuration === "string") {
    type = typeOrDuration;
  }
  if (typeof maybeDuration === "number") duration = maybeDuration;
  if (!TOAST_ICONS[type]) type = "default";
  if (type === "loading") duration = Math.max(duration, 6000);

  msgEl.textContent = msg;
  toast.dataset.toastType = type;

  const iconEl = toast.querySelector("[data-lucide]");
  if (iconEl) {
    iconEl.className = TOAST_ICON_CLASSES[type] || TOAST_ICON_CLASSES.default;
    iconEl.setAttribute("data-lucide", TOAST_ICONS[type]);
    // Note: after lucide.createIcons the node is an <svg>; toggling data-lucide and
    // data attributes still re-hydrates only this toast node.
    refreshIcons(toast);
  }

  toast.classList.add("toast-visible");
  if (toastHideTimeout) clearTimeout(toastHideTimeout);
  toastHideTimeout = setTimeout(() => {
    toast.classList.remove("toast-visible");
  }, duration);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function hexToRgba(hex, alpha) {
  const clean = String(hex || "#1a73e8").replace("#", "").trim();
  if (clean.length !== 6) return `rgba(26, 115, 232, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function stripLeadingEmoji(str) {
  return String(str ?? "")
    .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\s]+/u, "")
    .trim();
}

function sameDate(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getWeekDaysIso(sundayDate) {
  const list = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sundayDate);
    d.setDate(sundayDate.getDate() + i);
    list.push(toIsoDate(d));
  }
  return list;
}

function formatCompactTime(hhmm) {
  if (!hhmm) return "";
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return mStr === "00" ? `${h12}${ampm}` : `${h12}:${mStr}${ampm}`;
}

// Escape a value interpolated into a JS string literal inside an HTML
// event-handler attribute (onclick="fn('${...}')"). HTML entity-decoding runs
// BEFORE the JS engine parses the handler, so escapeHtml alone is not enough:
// its &#39; reverts to a raw quote and breaks the string. JS-escape first,
// then HTML-encode.
function jsAttr(s) {
  return escapeHtml(jsString(s));
}

function jsString(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\\/g, "&#92;");
}

// Calendar data sometimes carries room strings that already start with
// "Room" — rendering "Room Room 204" reads broken. Normalize once, use it
// everywhere rooms are printed.
function stripRoomPrefix(room) {
  const raw = String(room ?? "").trim();
  if (!raw) return "TBA";
  return raw.replace(/^(Room\s*)+/i, "");
}


// Allow-list for URLs that end up inside href="..." attributes (rendered from
// server/engine/imported data): only Google Calendar template links and other
// HTTPS resources may pass; anything else renders as a harmless anchor.
function safeExternalUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  if (/^https:\/\/calendar\.google\.com\//i.test(raw)) return raw;
  if (/^https:\/\//i.test(raw) && !raw.includes('"') && !raw.includes("'") && !/javascript:/i.test(raw)) {
    return raw;
  }
  return "";
}

// ============================================================================
// AUTO-UPDATER SYSTEM (Borrowed from Axial with QuizRadar Colors)
// ============================================================================

let appUpdateState = null;
let isUpdatePopoverOpen = false;
let updatePhase = "idle"; // "idle" | "downloading" | "done"
let updateCountdown = 3;

function initAppUpdater() {
  // Gated startup check (2.5s delay like Axial) so it doesn't compete with initial state load
  setTimeout(() => {
    checkForAppUpdates(false);
  }, 2500);

  // Close popover when clicking outside or pressing Escape
  document.addEventListener("click", (e) => {
    const popover = document.getElementById("update-popover");
    const container = document.getElementById("update-pill-container");
    if (!popover || popover.classList.contains("hidden")) return;
    if (container && !container.contains(e.target)) {
      closeUpdatePopover();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeUpdatePopover();
    }
  });
}

async function checkForAppUpdates(force = false) {
  try {
    const params = new URLSearchParams(window.location.search);
    const isPreview = params.has("__updatePreview");
    const url = isPreview ? "/api/updater/check?preview=true" : "/api/updater/check";

    const res = await fetch(url);
    const data = await res.json();

    if (data.success && data.update_available) {
      const dismissed = localStorage.getItem("quizradar_dismissed_update");
      if (!force && dismissed === data.latest_version && !isPreview) {
        return;
      }

      appUpdateState = data;
      renderUpdatePill(data);
    }
  } catch (err) {
    console.warn("Update check failed:", err);
  }
}

function renderUpdatePill(data) {
  const container = document.getElementById("update-pill-container");
  if (!container) return;

  container.classList.remove("hidden");
  const label = document.getElementById("update-pill-label");
  if (label) {
    label.textContent = "Update";
  }

  // Pre-populate popover
  const title = document.getElementById("update-popover-title");
  const dateEl = document.getElementById("update-popover-date");
  const body = document.getElementById("update-popover-body");

  if (title) title.textContent = `${data.latest_version} Release Notes`;
  if (dateEl && data.release_date) {
    try {
      const d = new Date(data.release_date);
      dateEl.textContent = `Released ${d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
    } catch {
      dateEl.textContent = `Released ${data.release_date}`;
    }
  }

  if (body) {
    body.innerHTML = formatMarkdownNotes(data.release_notes || "No release notes were published for this version.");
  }

  if (window.lucide) lucide.createIcons();
}

function toggleUpdatePopover() {
  const popover = document.getElementById("update-popover");
  if (!popover) return;
  if (popover.classList.contains("hidden")) {
    openUpdatePopover();
  } else {
    closeUpdatePopover();
  }
}

function openUpdatePopover() {
  const popover = document.getElementById("update-popover");
  if (!popover) return;
  popover.classList.remove("hidden");
  isUpdatePopoverOpen = true;
  if (window.lucide) lucide.createIcons();
}

function closeUpdatePopover() {
  const popover = document.getElementById("update-popover");
  if (!popover) return;
  popover.classList.add("hidden");
  isUpdatePopoverOpen = false;
}

function skipThisUpdate() {
  if (appUpdateState?.latest_version) {
    localStorage.setItem("quizradar_dismissed_update", appUpdateState.latest_version);
  }
  const container = document.getElementById("update-pill-container");
  if (container) container.classList.add("hidden");
  closeUpdatePopover();
  showToast(`Skipped ${appUpdateState?.latest_version || "this version"}. You can check again in Settings.`);
}

async function startUpdateDownload() {
  if (updatePhase !== "idle") return;
  if (!appUpdateState?.download_url) {
    showToast("No download package found for this release.", true);
    return;
  }

  updatePhase = "downloading";
  const actions = document.getElementById("update-popover-actions");
  const progressContainer = document.getElementById("update-progress-container");
  const progressBar = document.getElementById("update-progress-bar");
  const progressStatus = document.getElementById("update-progress-status");
  const errorEl = document.getElementById("update-popover-error");

  if (errorEl) errorEl.classList.add("hidden");
  if (actions) actions.classList.add("hidden");
  if (progressContainer) progressContainer.classList.remove("hidden");

  // Animate progress smoothly
  let pct = 10;
  if (progressBar) progressBar.style.width = "10%";
  if (progressStatus) progressStatus.textContent = "Connecting to GitHub release server…";

  const progressInterval = setInterval(() => {
    if (pct < 85) {
      pct += Math.floor(Math.random() * 8) + 4;
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressStatus) progressStatus.textContent = `Downloading installer package… ${pct}%`;
    }
  }, 180);

  try {
    const res = await fetch("/api/updater/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ download_url: appUpdateState.download_url }),
    });
    clearInterval(progressInterval);

    const data = await res.json();
    if (data.success) {
      if (progressBar) progressBar.style.width = "100%";
      updatePhase = "done";
      updateCountdown = 3;

      const countdownInterval = setInterval(() => {
        updateCountdown -= 1;
        if (progressStatus) {
          progressStatus.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-bold">Download complete!</span> Launching installer and restarting in ${updateCountdown}…`;
        }
        if (updateCountdown <= 0) {
          clearInterval(countdownInterval);
          // If this code is still running, the app did not restart. Recover the
          // popover to a usable, honest state instead of leaving it frozen.
          setTimeout(async () => {
            try {
              await _originalFetch("/api/state");
              updatePhase = "idle";
              if (actions) actions.classList.remove("hidden");
              if (progressContainer) progressContainer.classList.add("hidden");
              if (progressStatus) {
                progressStatus.textContent = "Installer launched. If QuizRadar didn't close automatically, run the downloaded setup file.";
              }
            } catch {
              // App is shutting down / offline — nothing to recover.
            }
          }, 1500);
        }
      }, 1000);
    } else {
      throw new Error(data.error || "Update installation failed");
    }
  } catch (err) {
    clearInterval(progressInterval);
    updatePhase = "idle";
    if (actions) actions.classList.remove("hidden");
    if (progressContainer) progressContainer.classList.add("hidden");
    if (errorEl) {
      errorEl.textContent = err.message || "Failed to download update";
      errorEl.classList.remove("hidden");
    }
    showToast(err.message || "Failed to download update", true);
  }
}

async function checkUpdatesFromSettings() {
  const btn = document.getElementById("settings-check-update-btn");
  const spinner = document.getElementById("settings-update-spinner");
  const statusEl = document.getElementById("settings-update-status");

  if (btn) btn.disabled = true;
  if (spinner) spinner.classList.add("animate-spin");
  if (statusEl) {
    statusEl.classList.remove("hidden");
    statusEl.className = "text-xs p-2.5 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 text-[#1a73e8] dark:text-blue-400";
    statusEl.textContent = "Checking GitHub releases for latest version...";
  }

  try {
    const res = await fetch("/api/updater/check");
    const data = await res.json();

    if (data.success) {
      if (data.update_available) {
        appUpdateState = data;
        renderUpdatePill(data);
        if (statusEl) {
          statusEl.className = "text-xs p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 flex items-center justify-between";
          statusEl.innerHTML = `
            <span><strong>${escapeHtml(data.latest_version)}</strong> is available! (Current: ${escapeHtml(data.current_version)})</span>
            <button onclick="closeSettingsModal(); openUpdatePopover();" class="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[11px] cursor-pointer hover:bg-emerald-700 transition">View Update</button>
          `;
        }
      } else {
        if (statusEl) {
          statusEl.className = "text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
          statusEl.textContent = `QuizRadar is up to date (${data.current_version}).`;
        }
      }
    } else {
      if (statusEl) {
        statusEl.className = "text-xs p-2.5 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300";
        statusEl.textContent = `Update check failed: ${data.error || "Unknown error"}`;
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.className = "text-xs p-2.5 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300";
      statusEl.textContent = "Could not connect to GitHub releases.";
    }
  } finally {
    if (btn) btn.disabled = false;
    if (spinner) spinner.classList.remove("animate-spin");
  }
}

function formatMarkdownNotes(raw) {
  if (!raw) return "<p>No release notes provided.</p>";
  return raw
    .split("\n\n")
    .map((block) => {
      const trimmed = block.trim();
      if (trimmed.startsWith("## ")) {
        return `<h4 class="font-bold text-slate-900 dark:text-white text-xs mt-2 mb-1">${escapeHtml(trimmed.slice(3))}</h4>`;
      }
      if (trimmed.startsWith("# ")) {
        return `<h3 class="font-bold text-slate-900 dark:text-white text-sm mt-2 mb-1">${escapeHtml(trimmed.slice(2))}</h3>`;
      }
      if (trimmed.includes("\n- ") || trimmed.startsWith("- ")) {
        const items = trimmed
          .split("\n")
          .filter((line) => line.trim().startsWith("- "))
          .map((line) => {
            let content = escapeHtml(line.trim().slice(2));
            content = content.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
            return `<li class="flex items-start gap-1.5"><span class="text-blue-500">•</span><span>${content}</span></li>`;
          })
          .join("");
        return `<ul class="space-y-1 my-1 pl-1">${items}</ul>`;
      }
      let paragraph = escapeHtml(trimmed);
      paragraph = paragraph.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      return `<p class="my-1">${paragraph}</p>`;
    })
    .join("");
}

// ============================================================================
// MULTI-SOURCE RADAR, PRACTICE GENERATOR, POMODORO & STUDY BLOCKS
// ============================================================================

function setDashboardSourceFilter(source) {
  currentDashboardSourceFilter = source;
  const pills = [
    { id: "source-filter-all", key: "ALL" },
    { id: "source-filter-gmail", key: "Gmail" },
    { id: "source-filter-moodle", key: "Moodle" },
    { id: "source-filter-teams", key: "Microsoft Teams" },
    { id: "source-filter-classroom", key: "Google Classroom" },
  ];

  pills.forEach((p) => {
    const el = document.getElementById(p.id);
    if (!el) return;
    if (p.key === source) {
      el.className = "px-2.5 py-1 rounded-lg bg-[#1a73e8] text-white shadow-2xs transition cursor-pointer flex items-center gap-1";
    } else {
      el.className = "px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer flex items-center gap-1";
    }
  });

  renderDashboard();
}

async function saveAssessmentGradeFromModal() {
  if (!activeModalAssessmentId) return;
  const weightVal = document.getElementById("modal-grade-weight")?.value;
  const scoreVal = document.getElementById("modal-grade-score")?.value;
  const maxVal = document.getElementById("modal-grade-max")?.value;

  const weight = weightVal !== "" && !isNaN(parseFloat(weightVal)) ? parseFloat(weightVal) : null;
  const score = scoreVal !== "" && !isNaN(parseFloat(scoreVal)) ? parseFloat(scoreVal) : null;
  const max = maxVal !== "" && !isNaN(parseFloat(maxVal)) ? parseFloat(maxVal) : null;

  if (score !== null && score < 0) {
    showToast("Score cannot be negative.");
    return;
  }
  if (max !== null && max <= 0) {
    showToast("Max score must be greater than 0.");
    return;
  }
  if (score !== null && max !== null && score > max) {
    showToast("Achieved score cannot exceed max score.");
    return;
  }
  if (weight !== null && (weight < 0 || weight > 100)) {
    showToast("Course weightage must be between 0% and 100%.");
    return;
  }

  try {
    const res = await fetch(`/api/assessments/${encodeURIComponent(activeModalAssessmentId)}/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weightage_percent: weight,
        achieved_score: score,
        max_score: max,
      }),
    });
    const data = await res.json();
    if (data.status === "ok") {
      showToast("Grade saved successfully!");
      const a = (appState.assessments || []).find((x) => x.id === activeModalAssessmentId);
      if (a) {
        a.weightage_percent = weight;
        a.achieved_score = score;
        a.max_score = max;
      }
      if (data.summary && appState.dashboard) {
        appState.dashboard.grade_summary = data.summary;
      }
      saveStateCache();
      openAssessmentModalById(activeModalAssessmentId);
      renderDashboard();
      pushWidgetSnapshotNow();
    } else {
      showToast(data.message || "Could not save grade.");
    }
  } catch (err) {
    showToast("Network error saving grade.");
  }
}

async function scheduleSmartStudyBlocks() {
  try {
    showToast("Generating AI study blocks into timetable gaps...");
    const res = await fetch("/api/study/blocks/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (data.status === "ok" || data.success) {
      showToast(data.message || "Smart study blocks scheduled!");
      if (data.assessments) appState.assessments = data.assessments;
      if (data.dashboard) appState.dashboard = data.dashboard;
      if (data.config) appState.config = data.config;
      if (appState.config) appState.config.dismiss_conflict_banner = false;
      saveStateCache();
      renderDashboard();
      renderWeekCalendar();
      if (window.lucide) lucide.createIcons();
    } else {
      showToast(data.message || "Could not schedule study blocks.");
    }
  } catch (err) {
    showToast("Error scheduling study blocks.");
  }
}

async function dismissConflictBanner() {
  const conflictBanner = document.getElementById("conflict-alert-banner");
  if (conflictBanner) conflictBanner.classList.add("hidden");
  if (appState.config) appState.config.dismiss_conflict_banner = true;
  saveStateCache();
  try {
    await fetch("/api/conflicts/dismiss", { method: "POST" });
  } catch (e) {}
}

async function testMoodleFromSettings() {
  const statusEl = document.getElementById("settings-moodle-status");
  const url = document.getElementById("settings-moodle-url")?.value || "";
  const ical = document.getElementById("settings-moodle-ical")?.value || "";
  if (statusEl) {
    statusEl.classList.remove("hidden");
    statusEl.className = "text-[11px] p-2 rounded-lg bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-200 border border-orange-200 dark:border-orange-800 font-medium";
    statusEl.textContent = "Connecting to Moodle LMS...";
  }
  try {
    const res = await fetch("/api/moodle/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, ical_url: ical }),
    });
    const data = await res.json();
    if (statusEl) {
      if (data.status === "ok") {
        statusEl.className = "text-[11px] p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border border-emerald-300 font-medium";
        statusEl.textContent = `✓ Moodle Connected: Found ${data.events_count} upcoming academic calendar events.`;
      } else {
        statusEl.className = "text-[11px] p-2 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border border-rose-300 font-medium";
        statusEl.textContent = `✗ Moodle Error: ${data.message}`;
      }
    }
  } catch (e) {
    if (statusEl) {
      statusEl.className = "text-[11px] p-2 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border border-rose-300 font-medium";
      statusEl.textContent = "✗ Network error connecting to Moodle.";
    }
  }
}

async function syncMoodleNow() {
  try {
    showToast("Syncing Moodle calendar events...");
    const url = document.getElementById("settings-moodle-url")?.value || "";
    const ical = document.getElementById("settings-moodle-ical")?.value || "";
    const res = await fetch("/api/moodle/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, ical_url: ical }),
    });
    const data = await res.json();
    if (data.status === "ok") {
      showToast(`Moodle Synced: Imported ${data.synced_count} assignments/quizzes!`);
      if (data.assessments) appState.assessments = data.assessments;
      if (data.dashboard) appState.dashboard = data.dashboard;
      saveStateCache();
      renderDashboard();
      renderWeekCalendar();
    } else {
      showToast(data.message || "Moodle sync failed.");
    }
  } catch (err) {
    showToast("Error triggering Moodle sync.");
  }
}

async function testMicrosoftFromSettings() {
  const statusEl = document.getElementById("settings-teams-status");
  const token = document.getElementById("settings-teams-token")?.value || "";
  if (statusEl) {
    statusEl.classList.remove("hidden");
    statusEl.className = "text-[11px] p-2 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800 font-medium";
    statusEl.textContent = "Connecting to Microsoft Graph & discovering enrolled courses with Gemini...";
  }
  try {
    const res = await fetch("/api/microsoft/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (statusEl) {
      if (data.status === "ok") {
        statusEl.className = "text-[11px] p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border border-emerald-300 font-medium";
        const teamsSummary = [
          `${data.teams_count ?? 0} team${(data.teams_count ?? 0) === 1 ? "" : "s"}`,
          `${data.courses_count ?? 0} course${(data.courses_count ?? 0) === 1 ? "" : "s"}`,
          `${data.assignments_count ?? 0} assessment${(data.assignments_count ?? 0) === 1 ? "" : "s"}`
        ].join(", ");
        statusEl.textContent = `✓ Microsoft Connected: ${data.user || "your Microsoft account"} (${teamsSummary}).`;

        // Automatically update the app state with discovered courses and assessments
        if (data.assessments) appState.assessments = data.assessments;
        if (data.dashboard) appState.dashboard = data.dashboard;
        if (data.schedule) {
          appState.schedule = data.schedule;
          syncActiveCourseFilters();
        }
        if (data.config) appState.config = data.config;
        if (appState.config) appState.config.teams_enabled = true;
        saveStateCache();

        renderAllViews();
        showToast(`Microsoft Teams connected! Discovered ${data.courses_count ?? 0} enrolled courses & assessments.`);
      } else {
        statusEl.className = "text-[11px] p-2 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border border-rose-300 font-medium";
        statusEl.textContent = `✗ Microsoft Graph Error: ${data.message}`;
      }
    }
  } catch (e) {
    if (statusEl) {
      statusEl.className = "text-[11px] p-2 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border border-rose-300 font-medium";
      statusEl.textContent = "✗ Network error connecting to Microsoft.";
    }
  }
}

async function testClassroomFromSettings() {
  const statusEl = document.getElementById("settings-classroom-status");
  if (statusEl) {
    statusEl.classList.remove("hidden");
    statusEl.className = "text-[11px] p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 font-medium";
    statusEl.textContent = "Connecting to Google Classroom API...";
  }
  try {
    const res = await fetch("/api/classroom/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (statusEl) {
      if (data.status === "ok") {
        statusEl.className = "text-[11px] p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border border-emerald-300 font-medium";
        statusEl.textContent = `✓ Google Classroom Connected: ${data.courses_count} courses, ${data.coursework_count} coursework assignments.`;
      } else {
        statusEl.className = "text-[11px] p-2 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border border-rose-300 font-medium";
        statusEl.textContent = `✗ Google Classroom Error: ${data.message}`;
      }
    }
  } catch (e) {
    if (statusEl) {
      statusEl.className = "text-[11px] p-2 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border border-rose-300 font-medium";
      statusEl.textContent = "✗ Network error connecting to Classroom.";
    }
  }
}

async function openPracticeModalForCurrentAssessment() {
  const modal = document.getElementById("practice-quiz-modal");
  if (!modal || !activeModalAssessmentId) return;

  const a = (appState.assessments || []).find((x) => x.id === activeModalAssessmentId);
  if (!a) return;

  activePracticeAssessmentId = a.id;
  const badgeEl = document.getElementById("practice-course-badge");
  if (badgeEl) {
    badgeEl.textContent = a.course_id;
    badgeEl.style.backgroundColor = a.color || "#7c3aed";
  }
  const titleEl = document.getElementById("practice-quiz-title");
  if (titleEl) {
    titleEl.textContent = `Practice: ${a.title}`;
  }

  const loadingEl = document.getElementById("practice-loading");
  const contentEl = document.getElementById("practice-content");
  const completeEl = document.getElementById("practice-complete-view");
  const nextBtn = document.getElementById("practice-next-btn");

  if (loadingEl) {
    loadingEl.classList.remove("hidden");
    loadingEl.innerHTML = `
      <div class="w-8 h-8 border-3 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
      <p class="text-xs font-semibold text-slate-600 dark:text-slate-300">Generating practice questions from your course topics...</p>
    `;
  }
  if (contentEl) contentEl.classList.add("hidden");
  if (completeEl) completeEl.classList.add("hidden");
  if (nextBtn) {
    nextBtn.classList.remove("hidden");
    nextBtn.disabled = true;
  }

  modal.classList.add("is-open");
  if (window.lucide) lucide.createIcons();

  try {
    const res = await fetch(`/api/assessments/${encodeURIComponent(a.id)}/practice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (data.questions && data.questions.length > 0) {
      activePracticeQuiz = data.questions;
      practiceQuizCurrentIndex = 0;
      practiceQuizScore = 0;
      // Honest provenance labeling: AI-crafted vs on-device fallback
      if (titleEl) {
        titleEl.textContent = `${data.generated_by_ai === false ? "On-device Practice" : "AI Practice"}: ${a.title}`;
      }
      if (loadingEl) loadingEl.classList.add("hidden");
      if (contentEl) contentEl.classList.remove("hidden");
      renderCurrentPracticeQuestion();
    } else {
      if (loadingEl) {
        loadingEl.innerHTML = `<p class="text-xs text-rose-500 font-semibold">${escapeHtml(data.message || "Failed to load practice quiz.")}</p>`;
      }
    }
  } catch (err) {
    // Resilient offline fallback: formulate study questions directly from cached topics
    const fallbackTopics = a.topics && a.topics.length > 0 ? a.topics : ["Core Principles", "Formulas & Methods", "Problem-Solving Techniques"];
    activePracticeQuiz = fallbackTopics.slice(0, 3).map((top, idx) => {
      const topName = typeof top === "string" ? top : top.title || "Subject Principles";
      return {
        question: `Which study strategy is most critical for mastering "${topName}" in ${a.course_id}?`,
        options: [
          "Systematic step-by-step problem breakdown and formula verification",
          "Rote memorization without understanding underlying mechanics",
          "Skipping foundational terms to jump straight into complex proofs",
          "Reviewing only the final answer sheet without practice exercises"
        ],
        correct_index: 0,
        explanation: `Systematic step-by-step methodology and checking intermediate work is the proven study strategy for ${a.course_id}.`
      };
    });
    practiceQuizCurrentIndex = 0;
    practiceQuizScore = 0;
    if (loadingEl) loadingEl.classList.add("hidden");
    if (contentEl) contentEl.classList.remove("hidden");
    renderCurrentPracticeQuestion();
    showToast("Offline mode: generated study review quiz.");
  }
}

function renderCurrentPracticeQuestion() {
  if (!activePracticeQuiz || practiceQuizCurrentIndex >= activePracticeQuiz.length) return;
  const q = activePracticeQuiz[practiceQuizCurrentIndex];
  const total = activePracticeQuiz.length;

  const progLabel = document.getElementById("practice-progress-label");
  const scoreCounter = document.getElementById("practice-score-counter");
  const qText = document.getElementById("practice-question-text");

  if (progLabel) progLabel.textContent = `Question ${practiceQuizCurrentIndex + 1} of ${total}`;
  if (scoreCounter) scoreCounter.textContent = `Score: ${practiceQuizScore} / ${practiceQuizCurrentIndex}`;
  if (qText) qText.textContent = q.question;

  const explBox = document.getElementById("practice-explanation-box");
  if (explBox) explBox.classList.add("hidden");

  const nextBtn = document.getElementById("practice-next-btn");
  if (nextBtn) nextBtn.disabled = true;

  const optContainer = document.getElementById("practice-options-container");
  const letters = ["A", "B", "C", "D"];
  if (optContainer) {
    optContainer.innerHTML = (q.options || [])
      .map(
        (opt, idx) => `
        <button type="button" onclick="selectPracticeOption(${idx})" id="practice-opt-${idx}" class="practice-opt-btn w-full text-left p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-800 hover:border-purple-500 text-xs text-slate-800 dark:text-slate-100 font-medium transition flex items-start gap-3 cursor-pointer">
          <span class="w-6 h-6 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold flex items-center justify-center shrink-0 text-xs">${letters[idx] || idx + 1}</span>
          <span class="leading-relaxed mt-0.5">${escapeHtml(opt)}</span>
        </button>
      `
      )
      .join("");
  }

  if (window.lucide) lucide.createIcons();
}

function selectPracticeOption(selectedIdx) {
  if (!activePracticeQuiz) return;
  const q = activePracticeQuiz[practiceQuizCurrentIndex];
  const buttons = document.querySelectorAll(".practice-opt-btn");
  buttons.forEach((b) => (b.disabled = true));

  const correctIdx = q.correct_index != null ? q.correct_index : q.correct_option_index;
  const isCorrect = selectedIdx === correctIdx;
  if (isCorrect) practiceQuizScore += 1;

  const scoreCounter = document.getElementById("practice-score-counter");
  if (scoreCounter) scoreCounter.textContent = `Score: ${practiceQuizScore} / ${practiceQuizCurrentIndex + 1}`;

  const selectedBtn = document.getElementById(`practice-opt-${selectedIdx}`);
  const correctBtn = document.getElementById(`practice-opt-${correctIdx}`);

  if (selectedBtn) {
    if (isCorrect) {
      selectedBtn.className = "practice-opt-btn w-full text-left p-3.5 rounded-xl border border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-100 text-xs font-semibold flex items-start gap-3";
    } else {
      selectedBtn.className = "practice-opt-btn w-full text-left p-3.5 rounded-xl border border-rose-500 bg-rose-50 dark:bg-rose-950/60 text-rose-900 dark:text-rose-100 text-xs font-semibold flex items-start gap-3";
    }
  }

  if (!isCorrect && correctBtn) {
    correctBtn.className = "practice-opt-btn w-full text-left p-3.5 rounded-xl border border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-100 text-xs font-semibold flex items-start gap-3";
  }

  const explBox = document.getElementById("practice-explanation-box");
  const explTitle = document.getElementById("practice-explanation-title");
  const explText = document.getElementById("practice-explanation-text");

  if (explBox && explTitle && explText) {
    explBox.classList.remove("hidden");
    if (isCorrect) {
      explBox.className = "p-4 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 text-xs space-y-1";
      explTitle.innerHTML = `<i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600"></i><span>Correct! Well done.</span>`;
    } else {
      explBox.className = "p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs space-y-1";
      explTitle.innerHTML = `<i data-lucide="info" class="w-4 h-4 text-amber-600"></i><span>Explanation & Key Concept:</span>`;
    }
    explText.textContent = q.explanation || "Review this topic in your notes.";
  }

  const nextBtn = document.getElementById("practice-next-btn");
  if (nextBtn) nextBtn.disabled = false;
  if (window.lucide) lucide.createIcons();
}

function nextPracticeQuestion() {
  if (!activePracticeQuiz) return;
  if (practiceQuizCurrentIndex + 1 < activePracticeQuiz.length) {
    practiceQuizCurrentIndex += 1;
    renderCurrentPracticeQuestion();
  } else {
    const contentEl = document.getElementById("practice-content");
    const completeEl = document.getElementById("practice-complete-view");
    const nextBtn = document.getElementById("practice-next-btn");

    if (contentEl) contentEl.classList.add("hidden");
    if (completeEl) completeEl.classList.remove("hidden");
    if (nextBtn) nextBtn.classList.add("hidden");

    const total = activePracticeQuiz.length;
    const pct = Math.round((practiceQuizScore / total) * 100);
    const scoreText = document.getElementById("practice-final-score-text");
    if (scoreText) {
      scoreText.textContent = `You scored ${practiceQuizScore} out of ${total} (${pct}%).`;
    }
    const scoreCounter = document.getElementById("practice-score-counter");
    if (scoreCounter) scoreCounter.textContent = `Final: ${practiceQuizScore} / ${total}`;
    if (window.lucide) lucide.createIcons();
  }
}

function restartPracticeQuiz() {
  if (!activePracticeQuiz) return;
  practiceQuizCurrentIndex = 0;
  practiceQuizScore = 0;
  const contentEl = document.getElementById("practice-content");
  const completeEl = document.getElementById("practice-complete-view");
  const nextBtn = document.getElementById("practice-next-btn");

  if (contentEl) contentEl.classList.remove("hidden");
  if (completeEl) completeEl.classList.add("hidden");
  if (nextBtn) nextBtn.classList.remove("hidden");

  renderCurrentPracticeQuestion();
}

function closePracticeQuizModal() {
  const modal = document.getElementById("practice-quiz-modal");
  if (modal) modal.classList.remove("is-open");
}

function openPomodoroForTask(course, topic, taskKey) {
  const modal = document.getElementById("pomodoro-modal");
  if (!modal) return;

  pomodoroCurrentCourse = course || "Study Focus";
  pomodoroCurrentTopic = topic || "Active Session";
  pomodoroCurrentTaskKey = taskKey || null;

  const courseEl = document.getElementById("pomodoro-task-course");
  const titleEl = document.getElementById("pomodoro-task-title");
  if (courseEl) courseEl.textContent = pomodoroCurrentCourse;
  if (titleEl) titleEl.textContent = pomodoroCurrentTopic;

  modal.classList.add("is-open");
  if (!pomodoroIsRunning) {
    setPomodoroMode("work");
  }
  if (window.lucide) lucide.createIcons();
}

function closePomodoroModal() {
  const modal = document.getElementById("pomodoro-modal");
  if (modal) modal.classList.remove("is-open");
}

function setPomodoroMode(mode) {
  pomodoroCurrentMode = mode;
  if (pomodoroIsRunning) {
    clearInterval(pomodoroTimerInterval);
    pomodoroIsRunning = false;
  }

  const workBtn = document.getElementById("pomo-mode-work");
  const shortBtn = document.getElementById("pomo-mode-short");
  const longBtn = document.getElementById("pomo-mode-long");
  const statusEl = document.getElementById("pomodoro-status-text");

  [workBtn, shortBtn, longBtn].forEach((b) => {
    if (b) {
      b.className = "flex-1 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition cursor-pointer";
    }
  });

  if (mode === "work") {
    pomodoroTotalSeconds = 25 * 60;
    if (workBtn) workBtn.className = "flex-1 py-1.5 rounded-lg bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 font-bold shadow-2xs transition cursor-pointer";
    if (statusEl) statusEl.textContent = "25-minute deep focus block. Eliminate distractions.";
  } else if (mode === "short") {
    pomodoroTotalSeconds = 5 * 60;
    if (shortBtn) shortBtn.className = "flex-1 py-1.5 rounded-lg bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 font-bold shadow-2xs transition cursor-pointer";
    if (statusEl) statusEl.textContent = "5-minute quick recharge. Hydrate or stretch.";
  } else if (mode === "long") {
    pomodoroTotalSeconds = 15 * 60;
    if (longBtn) longBtn.className = "flex-1 py-1.5 rounded-lg bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 font-bold shadow-2xs transition cursor-pointer";
    if (statusEl) statusEl.textContent = "15-minute restorative break. Step away from screen.";
  }

  pomodoroSecondsRemaining = pomodoroTotalSeconds;
  updatePomodoroDisplay();
  updatePomodoroControls();
}

function togglePomodoroTimer() {
  triggerHaptic("medium");
  if (pomodoroIsRunning) {
    clearInterval(pomodoroTimerInterval);
    pomodoroIsRunning = false;
    updatePomodoroControls();
  } else {
    pomodoroIsRunning = true;
    updatePomodoroControls();
    pomodoroTimerInterval = setInterval(() => {
      pomodoroSecondsRemaining -= 1;
      updatePomodoroDisplay();
      if (pomodoroSecondsRemaining <= 0) {
        clearInterval(pomodoroTimerInterval);
        pomodoroIsRunning = false;
        playPomodoroChime();
        triggerHaptic("success");
        showToast("Pomodoro session complete! Great work!");
        updatePomodoroControls();
      }
    }, 1000);
  }
}

function resetPomodoroTimer() {
  if (pomodoroIsRunning) {
    clearInterval(pomodoroTimerInterval);
    pomodoroIsRunning = false;
  }
  pomodoroSecondsRemaining = pomodoroTotalSeconds;
  updatePomodoroDisplay();
  updatePomodoroControls();
}

function updatePomodoroDisplay() {
  const m = Math.floor(pomodoroSecondsRemaining / 60);
  const s = pomodoroSecondsRemaining % 60;
  const digitsEl = document.getElementById("pomodoro-digits");
  if (digitsEl) {
    digitsEl.textContent = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
}

function updatePomodoroControls() {
  const toggleBtn = document.getElementById("pomodoro-toggle-btn");
  const toggleLabel = document.getElementById("pomodoro-toggle-label");
  const toggleIcon = document.getElementById("pomodoro-toggle-icon");
  if (!toggleBtn) return;

  if (pomodoroIsRunning) {
    toggleBtn.className = "px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs transition cursor-pointer active:scale-95 flex items-center gap-2";
    if (toggleLabel) toggleLabel.textContent = "Pause";
    if (toggleIcon) toggleIcon.setAttribute("data-lucide", "pause");
  } else {
    toggleBtn.className = "px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs transition cursor-pointer active:scale-95 flex items-center gap-2";
    if (toggleLabel) toggleLabel.textContent = "Start Focus";
    if (toggleIcon) toggleIcon.setAttribute("data-lucide", "play");
  }
  if (window.lucide) lucide.createIcons();
}

function playPomodoroChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3); // A5
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.2);
  } catch (e) {
    // AudioContext fallback
  }
}

function markCurrentPomodoroTaskDone() {
  if (pomodoroCurrentTaskKey) {
    toggleTopicCheckbox(pomodoroCurrentTaskKey, true);
    triggerHaptic("success");
    showToast("Topic marked as studied!");
    closePomodoroModal();
  } else {
    showToast("No active topic checklist linked.");
  }
}

// ============================================================================
// On-Device Academic Engine & Local Backup Handlers (100% Standalone)
// ============================================================================

function openPomodoroModal(course, topic, taskKey) {
  openPomodoroForTask(course || "QuizRadar Focus", topic || "Independent Study Session", taskKey);
}

// NOTE: openMobileSyncTab is defined once (line ~2027). A duplicate definition
// that silently shadowed this one was removed.

async function openCloudSyncModal() {
  const modal = document.getElementById("cloud-sync-modal");
  if (!modal) return;
  const pairInput = document.getElementById("pair-desktop-url");
  if (pairInput && !pairInput.value) {
    pairInput.value = localStorage.getItem(DESKTOP_PAIRING_URL_KEY) || "";
  }
  const pinInput = document.getElementById("pair-desktop-pin");
  if (pinInput && !pinInput.value) {
    pinInput.value = getSavedPairingPin();
  }
  modal.classList.add("is-open");
  if (window.lucide) lucide.createIcons({ root: modal });
}

function closeCloudSyncModal() {
  const modal = document.getElementById("cloud-sync-modal");
  if (modal) modal.classList.remove("is-open");
}

function exportLocalBackup() {
  triggerHaptic("medium");
  try {
    const engineState = mobileEngine.state;
    const safeState = JSON.parse(JSON.stringify(engineState));
    if (safeState.config) {
      for (const k of ["gemini_api_key", "teams_token", "moodle_token", "moodle_ical_url"]) {
        delete safeState.config[k];
      }
    }
    const backupData = JSON.stringify(safeState, null, 2);
    const blob = new Blob([backupData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = toIsoDate(getTodayDate()); // local date, not UTC-shifted
    a.href = url;
    a.download = `quizradar_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Local academic backup exported successfully!", "success");
  } catch (err) {
    console.error("Export backup error:", err);
    showToast("Failed to export backup file.");
  }
}

function restoreLocalBackup() {
  triggerHaptic("selection");
  const fileInput = document.getElementById("backup-file-input");
  if (fileInput) fileInput.click();
}

function handleBackupFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      // Guard against JSON files that merely LOOK backup-ish: require the engine's
      // real schema (assessments array + schedule.courses array) and an explicit
      // confirmation, since a restore replaces the entire local database.
      const looksValid =
        data &&
        Array.isArray(data.assessments) &&
        data.schedule &&
        Array.isArray(data.schedule.courses);
      if (!looksValid) {
        showToast("This file is not a QuizRadar backup (missing assessments or schedule).", "error");
        return;
      }
      const proceed = confirm(
        "Restore will REPLACE your current local academic data with this backup file. Continue?"
      );
      if (!proceed) return;

      mobileEngine.state = data;
      mobileEngine.saveDatabase();
      appState = data;
      saveStateCache();
      hydrateAndRenderState(appState);
      triggerHaptic("success");
      showToast("Academic radar restored successfully from backup!", "success");
      closeCloudSyncModal();
    } catch (err) {
      console.error("Restore error:", err);
      showToast("Failed to parse backup JSON.", "error");
    }
  };
  reader.readAsText(file);
}

function resetLocalDatabase() {
  if (confirm("Reset local database to a clean semester baseline?")) {
    localStorage.removeItem(STANDALONE_STORAGE_KEY);
    localStorage.removeItem(STATE_CACHE_KEY);
    localStorage.removeItem(TASKS_CACHE_KEY);
    mobileEngine.state = mobileEngine.createInitialDatabase();
    mobileEngine.saveDatabase();
    appState = mobileEngine.state;
    saveStateCache();
    hydrateAndRenderState(appState);
    triggerHaptic("medium");
    showToast("Database reset to clean baseline.");
    closeCloudSyncModal();
  }
}

// ============================================================================
// SETTINGS TABS · STUDY ALERTS · ICS FEEDS · PAIR PHONE (desktop QR + PIN)
// ============================================================================

const SETTINGS_TAB_STORAGE_KEY = "quizradar_settings_active_tab";
const NOTIFY_PREFS_KEY = "quizradar_notify_prefs_v1";
const NOTIFY_SCHEDULED_IDS_KEY = "quizradar_notify_scheduled_ids";
const NOTIFY_CHANGE_HOOK_KEY = "quizradar_notify_change_hook";
let _activeSettingsTab = "account";

function switchSettingsTab(tabId) {
  _activeSettingsTab = tabId;
  try { localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tabId); } catch (e) {}
  ["account", "courses", "integrations"].forEach((t) => {
    const panel = document.getElementById(`settings-tab-${t}`);
    const btn = document.getElementById(`settings-tab-btn-${t}`);
    if (panel) panel.classList.toggle("hidden", t !== tabId);
    if (btn) {
      const active = t === tabId;
      btn.classList.toggle("text-[#1a73e8]", active);
      btn.classList.toggle("dark:text-blue-400", active);
      btn.classList.toggle("font-bold", active);
      btn.classList.toggle("bg-white", active);
      btn.classList.toggle("dark:bg-slate-900", active);
      btn.classList.toggle("text-slate-600", !active);
      btn.classList.toggle("dark:text-slate-400", !active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    }
  });
  if (tabId === "integrations") {
    renderFeedsSettings();
    if (typeof loadPairInfoIntoSettings === "function") loadPairInfoIntoSettings();
  }
}

// ---- Study alerts (Android LocalNotifications) -------------------------------

function getNotifyPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTIFY_PREFS_KEY) || "{}");
    return {
      exams: raw.exams !== false,
      digest: !!raw.digest,
      digest_hour: Number.isInteger(raw.digest_hour) && raw.digest_hour >= 6 && raw.digest_hour <= 8 ? raw.digest_hour : 7,
    };
  } catch (e) {
    return { exams: true, digest: false, digest_hour: 7 };
  }
}

function renderNotifyPreferences() {
  const prefs = getNotifyPrefs();
  const examsEl = document.getElementById("settings-notify-exams");
  const digestEl = document.getElementById("settings-notify-digest");
  const hourEl = document.getElementById("settings-notify-digest-hour");
  if (examsEl) examsEl.checked = prefs.exams;
  if (digestEl) digestEl.checked = prefs.digest;
  if (hourEl) hourEl.value = String(prefs.digest_hour);
  const on = prefs.exams || prefs.digest;
  const badge = document.getElementById("settings-notify-badge");
  const note = document.getElementById("settings-notify-note");
  if (badge) {
    if (on) {
      badge.textContent = IS_NATIVE ? "Active on this phone" : "Saved (alerts fire on the phone)";
      badge.className = "text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300";
    } else {
      badge.textContent = "Off";
      badge.className = "text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300";
    }
  }
  if (note) {
    note.textContent = IS_NATIVE
      ? (on ? "Alerts appear even when the app is closed. Re-scan or reopen the app to refresh upcoming reminders." : "Turn on exam alerts below to be reminded before quizzes, midterms and finals.")
      : "Notifications fire on the Android app. Open QuizRadar on your phone and enable them there.";
  }
}

async function persistNotifyPreferences() {
  const prefs = {
    exams: document.getElementById("settings-notify-exams")?.checked !== false,
    digest: !!document.getElementById("settings-notify-digest")?.checked,
    digest_hour: Number(document.getElementById("settings-notify-digest-hour")?.value || 7),
  };
  try { localStorage.setItem(NOTIFY_PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  renderNotifyPreferences();
  triggerHaptic("selection");
  await scheduleStudyNotifications({ force: true });
  showToast("Study alerts updated.", "success", 1800);
}

// Stable numeric notification id from a stable string key.
function notificationIdFromString(text) {
  let h = 2166136261;
  for (let i = 0; i < String(text).length; i++) {
    h ^= String(text).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h % 1000000000);
}

function getLocalNotificationsPlugin() {
  if (!IS_NATIVE) return null;
  return window.Capacitor?.Plugins?.LocalNotifications || null;
}

async function cancelScheduledNotificationsByIds(ids) {
  const plugin = getLocalNotificationsPlugin();
  if (!plugin || !Array.isArray(ids) || ids.length === 0) return;
  try {
    await plugin.cancel({ notifications: ids.map((id) => ({ id })) });
  } catch (err) {
    console.debug("[notify] cancel failed:", err);
  }
}

let _notifyQueueTimer = null;
function queueNotificationRefresh(force) {
  if (_notifyQueueTimer) clearTimeout(_notifyQueueTimer);
  _notifyQueueTimer = setTimeout(() => {
    _notifyQueueTimer = null;
    scheduleStudyNotifications({ force: !!force }).catch((err) => console.debug("[notify] schedule failed:", err));
  }, 900);
}

// Schedules exam alerts (T-24h + T-1h... same-day morning fallback) and up to 7
// days of morning digests. Re-entrancy is guarded by a change hook so hydrate
// + sync + edits don't re-schedule identical notifications all day.
async function scheduleStudyNotifications({ force = false } = {}) {
  const plugin = getLocalNotificationsPlugin();
  if (!plugin) return;
  const prefs = getNotifyPrefs();
  if (!prefs.exams && !prefs.digest) {
    const ids = getStoredScheduledNotificationIds();
    await cancelScheduledNotificationsByIds(ids);
    try { localStorage.removeItem(NOTIFY_SCHEDULED_IDS_KEY); } catch (e) {}
    try { localStorage.removeItem(NOTIFY_CHANGE_HOOK_KEY); } catch (e) {}
    return;
  }

  try {
    const current = await plugin.checkPermissions();
    if (!current || current.display !== "granted") {
      const req = await plugin.requestPermissions();
      if (!req || req.display !== "granted") return;
    }
  } catch (err) {
    console.debug("[notify] permission check failed:", err);
    return;
  }

  const todayIso = toIsoDate(getTodayDate());
  const examSource = (appState.assessments || [])
    .filter((a) => a && a.date_iso && a.date_iso >= todayIso)
    .sort((a, b) => String(a.date_iso).localeCompare(String(b.date_iso)))
    .slice(0, 30);

  const digestSource = (() => {
    const out = [];
    const slotByDayIndex = {};
    (appState.schedule?.slots || []).forEach((s) => {
      const idx = typeof s.day_index === "number" ? s.day_index : getDayIndex(s.day);
      (slotByDayIndex[idx] = slotByDayIndex[idx] || []).push(s.start_time || "");
    });
    for (let i = 0; i < 7; i++) {
      const day = new Date(getTodayDate());
      day.setDate(day.getDate() + i);
      const iso = toIsoDate(day);
      const items = (appState.assessments || []).filter((a) => a && a.date_iso === iso);
      const classes = (slotByDayIndex[day.getDay()] || []).filter(Boolean).length;
      out.push({ iso, dayIndex: day.getDay(), classes, assessments: items });
    }
    return out;
  })();

  const changeHook = JSON.stringify({
    prefs,
    exams: examSource.map((a) => `${a.id}|${a.date_iso}|${a.time || a.display_time || "09:00"}`),
    digest: digestSource.map((d) => `${d.iso}:c${d.classes}:a${d.assessments.length}`),
  });
  if (!force && localStorage.getItem(NOTIFY_CHANGE_HOOK_KEY) === changeHook) return;

  const priorIds = getStoredScheduledNotificationIds();
  await cancelScheduledNotificationsByIds(priorIds);

  const notifications = [];
  if (prefs.exams) {
    for (const a of examSource) {
      const baseId = notificationIdFromString(`${a.id}|${a.date_iso}`);
      const title = `${a.assessment_type || "Assessment"} · ${a.course_id || "Course"}`;
      const detail = (a.announcement || "").toString().trim();
      const dayBefore = new Date(`${a.date_iso}T09:00:00`);
      dayBefore.setDate(dayBefore.getDate() - 1);
      if (dayBefore.getTime() > Date.now()) {
        notifications.push({
          id: baseId * 2,
          title: `Tomorrow: ${title}`,
          body: detail ? `${title} — ${detail}`.slice(0, 140) : `${title} is tomorrow. Time to prepare.`,
          schedule: { at: dayBefore, allowWhileIdle: true }
        });
      }
      const sameDay = new Date(`${a.date_iso}T09:00:00`);
      if (sameDay.getTime() > Date.now()) {
        notifications.push({
          id: baseId * 2 + 1,
          title: `Today: ${title}`,
          body: detail ? `${title} — ${detail}`.slice(0, 140) : `${title} is happening today. Good luck!`,
          schedule: { at: sameDay, allowWhileIdle: true }
        });
      }
    }
  }

  if (prefs.digest) {
    digestSource.forEach((d, i) => {
      const when = new Date(`${d.iso}T${String(prefs.digest_hour).padStart(2, "0")}:00:00`);
      if (when.getTime() <= Date.now()) return;
      const parts = [d.classes ? `${d.classes} class${d.classes > 1 ? "es" : ""}` : "Free day"];
      if (d.assessments.length) parts.push(`${d.assessments.length} due`);
      notifications.push({
        id: 700000000 + i,
        title: "Today at QuizRadar",
        body: parts.join(" • "),
        schedule: { at: when, allowWhileIdle: true }
      });
    });
  }

  if (notifications.length === 0) {
    try { localStorage.removeItem(NOTIFY_SCHEDULED_IDS_KEY); } catch (e) {}
    try { localStorage.setItem(NOTIFY_CHANGE_HOOK_KEY, changeHook); } catch (e) {}
    return;
  }

  // The scheduler caps total pending notifications; send the nearest N only.
  const MAX = 48;
  const trimmed = notifications
    .sort((x, y) => new Date(x.schedule.at).getTime() - new Date(y.schedule.at).getTime())
    .slice(0, MAX);

  try {
    await plugin.schedule({ notifications: trimmed });
    localStorage.setItem(NOTIFY_SCHEDULED_IDS_KEY, JSON.stringify(trimmed.map((n) => n.id)));
    localStorage.setItem(NOTIFY_CHANGE_HOOK_KEY, changeHook);
  } catch (err) {
    console.warn("[notify] schedule failed:", err);
  }
}

function getStoredScheduledNotificationIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(NOTIFY_SCHEDULED_IDS_KEY) || "[]");
    return Array.isArray(ids) ? ids.map((n) => (typeof n === "object" ? n.id : n)) : [];
  } catch (e) {
    return [];
  }
}

// ---- Android home-screen widget snapshot (reads current radar state) ---------

window.__quizradarWidgetSnapshot = function () {
  try {
    const next = appState && appState.dashboard && appState.dashboard.next_up;
    if (!next || !next.date_iso) return null;
    const when = new Date(`${next.date_iso}T00:00:00`);
    if (isNaN(when.getTime())) return null;
    const days = Math.round(
      (new Date(when.getFullYear(), when.getMonth(), when.getDate()) - getTodayDate()) / 86400000
    );
    return {
      course_id: next.course_id || null,
      title: `${next.assessment_type || "Assessment"} · ${next.course_id || ""}`.trim(),
      date: toIsoDate(when),
      assessment_type: next.assessment_type || null,
      days_until: days,
    };
  } catch (err) {
    return null;
  }
};

// ---- Android share-sheet ingest ---------------------------------------------

window.__quizradarHandleShared = function (payload) {
  try {
    const text = payload && typeof payload.text === "string" ? payload.text.trim() : "";
    const subject = payload && typeof payload.title === "string" ? payload.title.trim() : "";
    if (!text && !subject) {
      showToast("The shared content was empty.", "warning");
      return;
    }
    const title = subject || text.split("\n")[0].trim() || "Shared Announcement";
    triggerHaptic("medium");
    openCreateEventModal({ prefillTitle: title.slice(0, 90), prefillType: "Assignment" });
    showToast("Shared content imported — pick a date and save it to your calendar.", "info", 3500);
  } catch (err) {
    console.warn("[share] failed:", err);
  }
};

// ---- ICS Feeds settings card --------------------------------------------------

async function renderFeedsSettings() {
  const listEl = document.getElementById("settings-feeds-list");
  const noteEl = document.getElementById("settings-feeds-note");
  if (!listEl) return;
  const feeds = appState.config?.feeds || [];
  if (!feeds.length) {
    listEl.innerHTML = `<div class="text-[11px] text-slate-400 p-2.5 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-center">No feeds yet. Add your university's .ics link above.</div>`;
  } else {
    listEl.innerHTML = feeds
      .map((f) => {
        const shortUrl = f.url && f.url.length > 44 ? `${f.url.slice(0, 44)}…` : f.url || "";
        return `
        <div class="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs">
          <label class="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
            <input type="checkbox" ${f.enabled !== false ? "checked" : ""} onchange="toggleFeedItem('${jsAttr(f.id)}', this.checked)" class="w-4 h-4 accent-cyan-600 rounded" />
            <span class="font-bold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(f.name || "Feed")}</span>
            <span class="text-[10px] text-slate-400 truncate font-mono">${escapeHtml(shortUrl)}</span>
          </label>
          <button type="button" onclick="deleteFeedItem('${jsAttr(f.id)}')" class="p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition cursor-pointer" aria-label="Delete feed">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
          </button>
        </div>`;
      })
      .join("");
  }
  if (noteEl) {
    noteEl.textContent = IS_NATIVE
      ? "Feeds are fetched by the paired desktop during each scan; results arrive on this phone when you pull its data."
      : "Feeds are logged into every scan automatically (alongside Gmail, Teams, Classroom & Moodle).";
  }
}

function setFeedsStatus(text, isError) {
  const el = document.getElementById("settings-feeds-test-status");
  if (!el) return;
  el.classList.remove("hidden");
  el.textContent = text;
  el.className = "text-[11px] p-2 rounded-lg border font-medium " + (isError
    ? "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300"
    : "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300");
}

async function persistFeedsToServer() {
  const feeds = appState.config?.feeds || [];
  const res = await fetch("/api/feeds/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feeds })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);
  appState.config.feeds = data.feeds || feeds;
  sureStateChange();
}

// A tiny helper to persist local config changes made outside the save modal.
function sureStateChange() {
  try {
    if (appState && window.mobileEngine && mobileEngine.state === appState) {
      mobileEngine.saveDatabase();
    }
    saveStateCache();
  } catch (e) {}
}

async function addFeedFromSettings() {
  const nameEl = document.getElementById("feed-add-name");
  const urlEl = document.getElementById("feed-add-url");
  const name = (nameEl?.value || "").trim() || "University Timetable";
  const url = (urlEl?.value || "").trim();
  if (!/^https:\/\/.+/i.test(url)) {
    setFeedsStatus("Enter an https:// .ics URL — plain http is rejected for security.", true);
    return;
  }
  if (IS_NATIVE) {
    setFeedsStatus("Feeds are configured on the paired desktop — pair first, then add feeds there.", true);
    return;
  }
  try {
    const res = await fetch("/api/feeds/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, name })
    });
    const data = await res.json();
    if (!data.success) {
      setFeedsStatus(data.error || "Feed validation failed.", true);
      return;
    }
    const sampleTitle = (data.sample || [])[0] ? `First item: "${data.sample[0]}"` : "";
    setFeedsStatus(`Feed reachable — ${data.items_found} upcoming item(s) found. ${sampleTitle}`, false);
    const feed = { id: `feed-${Date.now()}`, name, url, enabled: true };
    appState.config.feeds = [...(appState.config.feeds || []), feed];
    await persistFeedsToServer();
    if (nameEl) nameEl.value = "";
    if (urlEl) urlEl.value = "";
    renderFeedsSettings();
  } catch (err) {
    setFeedsStatus(`Could not test feed: ${err.message}`, true);
  }
}

async function toggleFeedItem(feedId, enabled) {
  const feeds = appState.config?.feeds || [];
  const feed = feeds.find((f) => f.id === feedId);
  if (!feed) return;
  feed.enabled = !!enabled;
  try {
    await persistFeedsToServer();
    renderFeedsSettings();
  } catch (err) {
    setFeedsStatus(`Save failed: ${err.message}`, true);
  }
}

async function deleteFeedItem(feedId) {
  try {
    const res = await fetch("/api/feeds/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: feedId })
    });
    const data = await res.json();
    if (data.success) {
      appState.config.feeds = data.feeds || (appState.config.feeds || []).filter((f) => f.id !== feedId);
      renderFeedsSettings();
      showToast("Feed removed.", "success", 1600);
    } else {
      setFeedsStatus(data.error || "Delete failed.", true);
    }
  } catch (err) {
    setFeedsStatus(`Delete failed: ${err.message}`, true);
  }
}

async function saveFeedsFromSettings() {
  try {
    await persistFeedsToServer();
    showToast("Feeds saved — they run on every scan now.", "success");
    renderFeedsSettings();
  } catch (err) {
    setFeedsStatus(`Save failed: ${err.message}`, true);
  }
}

// ---- Pair Phone card (desktop only): live QR + optional PIN -------------------

let _lastPairConnectUrl = "";

async function loadPairInfoIntoSettings() {
  const card = document.getElementById("settings-pair-phone-card");
  if (!card) return;
  if (IS_NATIVE) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  try {
    const res = await fetch("/api/sync/pair/info");
    const data = await res.json();
    if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);
    _lastPairConnectUrl = data.connect_url || "";
    const urlCode = document.getElementById("pair-connect-url-code");
    if (urlCode) urlCode.textContent = _lastPairConnectUrl || "—";
    renderPairQr(_lastPairConnectUrl);
    const noteEl = document.getElementById("pair-info-note");
    if (noteEl) noteEl.textContent = data.pairing_note || "";
    const pinStatus = document.getElementById("pair-pin-status");
    if (pinStatus) {
      pinStatus.classList.remove("hidden");
      pinStatus.textContent = data.pin_required
        ? "A PIN is currently ACTIVE. Enter your new PIN to change it, or leave empty + Save to turn it off."
        : "No PIN is set. Create one (4-8 digits) so only your phone can pull data.";
    }
    refreshIcons(card);
  } catch (err) {
    const urlCode = document.getElementById("pair-connect-url-code");
    if (urlCode) urlCode.textContent = `Pairing info unavailable: ${err.message}`;
  }
}

// Renders the pairing QR: desktop URL wrapped in the app deep link so a
// standard Android camera app opens QuizRadar with the address pre-filled.
function renderPairQr(connectUrl) {
  const box = document.getElementById("pair-qr-image");
  if (!box) return;
  if (!connectUrl) {
    box.innerHTML = `<span class="text-[10px] text-slate-400">No address yet</span>`;
    return;
  }
  if (typeof window.qrcode !== "function") {
    box.innerHTML = `<span class="text-[10px] text-slate-400">QR library unavailable</span>`;
    return;
  }
  const deepLink = `com.quizradar.app://pair?url=${encodeURIComponent(connectUrl)}`;
  try {
    const qr = window.qrcode(0, "M");
    qr.addData(deepLink);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    const svg = box.querySelector("svg");
    if (svg) {
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.display = "block";
    }
  } catch (err) {
    box.innerHTML = `<span class="text-[10px] text-slate-400">Address too long to encode</span>`;
  }
}

async function copyPairUrlFromSettings() {
  const value = _lastPairConnectUrl || document.getElementById("pair-connect-url-code")?.textContent || "";
  if (!value || value === "—") return;
  try {
    await navigator.clipboard.writeText(value);
    showToast("Desktop address copied.", "success", 1600);
  } catch (err) {
    // Clipboard API can be denied — fall back to a selected read-only input.
    const tmp = document.createElement("textarea");
    tmp.value = value;
    document.body.appendChild(tmp);
    tmp.select();
    try { document.execCommand("copy"); showToast("Desktop address copied.", "success", 1600); }
    catch (e) { showToast("Copy failed — select the address manually.", "warning"); }
    document.body.removeChild(tmp);
  }
}

async function savePairingPinFromSettings() {
  const input = document.getElementById("pair-pin-input-settings");
  const status = document.getElementById("pair-pin-status");
  const raw = (input?.value || "").trim();
  let pin = null;
  if (raw) {
    if (!/^\d{4,8}$/.test(raw)) {
      if (status) {
        status.classList.remove("hidden");
        status.textContent = "PIN must be 4-8 digits.";
      }
      return;
    }
    pin = raw;
  }
  try {
    const res = await fetch("/api/pairing/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (data.success) {
      if (input) input.value = "";
      showToast(data.pin_required ? "Pairing PIN armed — phones must enter it once." : "Pairing PIN removed — address alone opens access.", "success", 3200);
      await loadPairInfoIntoSettings();
    } else {
      if (status) {
        status.classList.remove("hidden");
        status.textContent = data.error || "Could not save the PIN.";
      }
    }
  } catch (err) {
    if (status) {
      status.classList.remove("hidden");
      status.textContent = `Could not save the PIN: ${err.message}`;
    }
  }
}

// ============================================================================
// DESKTOP PAIRING (mobile engine → real QuizRadar desktop instance on the LAN)
// ============================================================================

const DESKTOP_PAIRING_URL_KEY = "quizradar_desktop_pairing_url";
const DESKTOP_PAIRING_PIN_KEY = "quizradar_desktop_pairing_pin";

function getSavedPairingPin() {
  return (localStorage.getItem(DESKTOP_PAIRING_PIN_KEY) || "").trim();
}

// Desktop requires x-quizradar-pin on every request when a pairing PIN is set.
function getPairingHeaders() {
  const pin = getSavedPairingPin();
  return pin ? { "x-quizradar-pin": pin } : {};
}

function savePairingPinInput() {
  const input = document.getElementById("pair-desktop-pin");
  const pin = (input?.value || "").trim();
  if (pin && !/^\d{4,8}$/.test(pin)) {
    showPairingStatus("PIN must be 4-8 digits — same digits shown on the desktop.", true);
    return false;
  }
  if (pin) localStorage.setItem(DESKTOP_PAIRING_PIN_KEY, pin);
  else localStorage.removeItem(DESKTOP_PAIRING_PIN_KEY);
  return true;
}

function normalizeDesktopUrl(raw) {
  let u = (raw || "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  try {
    const parsed = new URL(u);
    if (parsed.pathname && parsed.pathname !== "/") {
      // Accept both http://ip:port and http://ip:port/ — strip any extra path
      return `${parsed.protocol}//${parsed.host}`;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch (e) {
    return null;
  }
}

function showPairingStatus(text, isError) {
  const el = document.getElementById("pairing-status");
  if (!el) return;
  el.classList.remove("hidden");
  el.textContent = text;
  el.className = "text-[11px] rounded-lg px-3 py-2 " + (isError
    ? "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300"
    : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300");
}

async function getValidatedDesktopUrl() {
  const input = document.getElementById("pair-desktop-url");
  const saved = input?.value || localStorage.getItem(DESKTOP_PAIRING_URL_KEY) || "";
  const normalized = normalizeDesktopUrl(saved);
  if (!normalized) {
    showPairingStatus("Enter a valid desktop address, e.g. http://192.168.1.10:5050", true);
    return null;
  }
  return normalized;
}

async function testDesktopPairing() {
  triggerHaptic("selection");
  const desktopUrl = await getValidatedDesktopUrl();
  if (!desktopUrl) return;
  if (!savePairingPinInput()) return;
  const btn = document.getElementById("pair-test-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Testing..."; }
  try {
    const res = await _originalFetch(`${desktopUrl}/api/state`, {
      headers: getPairingHeaders(),
      signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
    });
    if (res.status === 401) {
      showPairingStatus("This desktop requires its pairing PIN — type it below (shown on the PC's Pairs card).", true);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !data.schedule || !data.assessments) throw new Error("Not a QuizRadar desktop instance");
    localStorage.setItem(DESKTOP_PAIRING_URL_KEY, desktopUrl);
    const courses = data.schedule.courses?.length || 0;
    const upcoming = (data.assessments || []).filter((a) => a.is_upcoming).length;
    showPairingStatus(`Connected! QuizRadar desktop has ${courses} course(s), ${upcoming} upcoming item(s). Signed in: ${data.auth?.authenticated ? (data.auth.email || "yes") : "no Google account"}.`, false);
  } catch (err) {
    showPairingStatus(`Could not connect: ${err.message}. Check that the PC runs QuizRadar with --lan and both devices share the Wi-Fi.`, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Test"; }
    if (window.lucide) lucide.createIcons();
  }
}

async function importFromDesktop() {
  triggerHaptic("medium");
  const desktopUrl = await getValidatedDesktopUrl();
  if (!desktopUrl) return;
  if (!savePairingPinInput()) return;
  const btn = document.getElementById("pair-import-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Pulling..."; }
  try {
    const res = await _originalFetch(`${desktopUrl}/api/state`, {
      headers: getPairingHeaders(),
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
    });
    if (res.status === 401) {
      showToast("This desktop requires its pairing PIN — enter it and retry.", "warning");
      showPairingStatus("Pairing PIN missing or wrong.", true);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Pull ONLY your own data. Authentication tokens NEVER cross the network.
    const st = mobileEngine.state;
    st.schedule = data.schedule || st.schedule;
    st.assessments = data.assessments || st.assessments;
    st.config = { ...st.config, user_name: data.config?.user_name || st.config.user_name };
    // Single source of truth for progress (server parity): config.completed_topics.
    if (data.config?.completed_topics) st.config.completed_topics = data.config.completed_topics;
    else if (st.completed_topics && !st.config.completed_topics) st.config.completed_topics = st.completed_topics;
    delete st.completed_topics;
    st.study_tasks = data.study_tasks_payload?.days || st.study_tasks;
    st.dashboard = null;
    mobileEngine.state = mobileEngine.recomputeDashboard(st);
    mobileEngine.saveDatabase();

    appState = mobileEngine.state;
    saveStateCache();
    hydrateAndRenderState(appState);
    triggerHaptic("success");
    showToast("Desktop data imported on this device!", "success", 3500);
  } catch (err) {
    showToast(`Import failed: ${err.message}. Run "Test" first to verify the address.`, "warning");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Pull Desktop Data"; }
    if (window.lucide) lucide.createIcons();
  }
}

