/**
 * QuizRadar Reusable UI Sweep & Interactive Audit Harness
 *
 * Captures deterministic 1:1 BEFORE / AFTER screenshots of every view, sub-tab,
 * empty & populated state, light & dark theme, desktop & mobile viewport, all 13
 * modals, stacked modal flows, and the live Tauri 2 desktop WebView2 shell —
 * while exercising interactive controls and running a structural/visual/a11y DOM
 * walker (WCAG contrast including CSS Color 4 / Tailwind oklch & linear-gradient
 * surfaces, single-shell modal invariants, stacked dialog visibility, viewport
 * overflow, minimum font size, and accessible control names).
 *
 * Usage:
 *   node tooling/ui-sweep.mjs --phase=before
 *   node tooling/ui-sweep.mjs --phase=after
 *   node tooling/ui-sweep.mjs --phase=after --out-dir=./out --report=./audit.json
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const WEB_DIR = path.join(REPO_ROOT, "apps", "web");

const requireWeb = createRequire(path.join(WEB_DIR, "package.json"));
const { chromium } = requireWeb("@playwright/test");

function getArg(prefix, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1) : fallback;
}

const PHASE = getArg("--phase", "after");
const BASE_URL = getArg("--url", "http://127.0.0.1:4318");
const OUT_DIR = path.resolve(
  getArg("--out-dir", path.join(REPO_ROOT, "tooling", ".screenshots", "web", PHASE)),
);
const REPORT_PATH = path.resolve(
  getArg("--report", path.join(REPO_ROOT, "tooling", ".screenshots", `web-audit-${PHASE}.json`)),
);
const FIXED_ISO = "2026-10-29T12:00:00Z";

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });

// ---------------------------------------------------------------------------
// Realistic, Honesty-Doctrine-Compliant Seed Data (Zero banned v4 strings)
// ---------------------------------------------------------------------------
const SEED_DATA = {
  courses: [
    { id: "CSE241", name: "Digital Logic Design", color: "#1a73e8" },
    { id: "ECE310", name: "Signals & Linear Systems", color: "#7c3aed" },
    { id: "CS305", name: "Operating Systems", color: "#059669" },
  ],
  slots: [
    {
      id: "slot-cse241-sun",
      day: "Sun",
      day_index: 0,
      dayIndex: 0,
      course_id: "CSE241",
      courseId: "CSE241",
      course_name: "Digital Logic Design",
      courseName: "Digital Logic Design",
      type: "Lecture",
      group: "Sec 1",
      room: "Eng 302",
      start_time: "09:00",
      startTime: "09:00",
      end_time: "10:30",
      endTime: "10:30",
      display_time: "09:00–10:30",
      displayTime: "09:00–10:30",
      has_quiz: false,
      hasQuiz: false,
      quiz_title: null,
      quizTitle: null,
    },
    {
      id: "slot-ece310-tue",
      day: "Tue",
      day_index: 2,
      dayIndex: 2,
      course_id: "ECE310",
      courseId: "ECE310",
      course_name: "Signals & Linear Systems",
      courseName: "Signals & Linear Systems",
      type: "Tutorial",
      group: "Tut B",
      room: null, // Tests honesty doctrine: missing room -> "—"
      start_time: "11:00",
      startTime: "11:00",
      end_time: "12:30",
      endTime: "12:30",
      display_time: "11:00–12:30",
      displayTime: "11:00–12:30",
      has_quiz: false,
      hasQuiz: false,
      quiz_title: null,
      quizTitle: null,
    },
    {
      id: "slot-cs305-thu",
      day: "Thu",
      day_index: 4,
      dayIndex: 4,
      course_id: "CS305",
      courseId: "CS305",
      course_name: "Operating Systems",
      courseName: "Operating Systems",
      type: "Lab",
      group: "Lab 2",
      room: "SysLab 104",
      start_time: "14:00",
      startTime: "14:00",
      end_time: "15:30",
      endTime: "15:30",
      display_time: "14:00–15:30",
      displayTime: "14:00–15:30",
      has_quiz: true,
      hasQuiz: true,
      quiz_title: "Kernel Threads Lab Check",
      quizTitle: "Kernel Threads Lab Check",
    },
  ],
  assessments: [
    {
      id: "asm-cse241-q2",
      course_id: "CSE241",
      courseId: "CSE241",
      course_name: "Digital Logic Design",
      courseName: "Digital Logic Design",
      title: "Class Quiz 2 — Karnaugh Maps & Latches",
      assessment_type: "Class Quiz",
      assessmentType: "Class Quiz",
      date_iso: "2026-10-30",
      dateIso: "2026-10-30",
      day_name: "Friday",
      dayName: "Friday",
      start_time: "10:00",
      startTime: "10:00",
      end_time: "10:45",
      endTime: "10:45",
      display_time: "10:00–10:45",
      displayTime: "10:00–10:45",
      room: null, // Honesty doctrine check: renders "—"
      instructor: "Dr. Nadia Mansour",
      is_upcoming: true,
      isUpcoming: true,
      days_until: 1,
      daysUntil: 1,
      urgency_level: "critical",
      urgencyLevel: "critical",
      priority_score: 95,
      priorityScore: 95,
      topics: [
        "4-Variable Karnaugh Map Implicants",
        "SR and D Latch Timing Diagrams",
        "Combinational Hazard Elimination",
      ],
      warnings: ["Closed book — no programmable calculators permitted"],
      ai_inference_note: "Snapped 'tomorrow morning lecture' to Friday 2026-10-30",
      aiInferenceNote: "Snapped 'tomorrow morning lecture' to Friday 2026-10-30",
      ai_study_plan:
        "Prioritize 4-variable K-map wrap-around prime implicants first, then sketch SR/D setup-and-hold timing waveforms.",
      aiStudyPlan:
        "Prioritize 4-variable K-map wrap-around prime implicants first, then sketch SR/D setup-and-hold timing waveforms.",
      estimated_study_hours: 3,
      estimatedStudyHours: 3,
      source: "Gmail",
      color: "#1a73e8",
      weightage_percent: 10,
      weightagePercent: 10,
    },
    {
      id: "asm-ece310-mid",
      course_id: "ECE310",
      courseId: "ECE310",
      course_name: "Signals & Linear Systems",
      courseName: "Signals & Linear Systems",
      title: "Midterm Exam — LTI Convolution & Fourier",
      assessment_type: "Midterm Exam",
      assessmentType: "Midterm Exam",
      date_iso: "2026-10-31",
      dateIso: "2026-10-31",
      day_name: "Saturday",
      dayName: "Saturday",
      start_time: "11:00",
      startTime: "11:00",
      end_time: "12:30",
      endTime: "12:30",
      display_time: "11:00–12:30",
      displayTime: "11:00–12:30",
      room: "Auditorium C",
      instructor: "Prof. Karim El-Sayed",
      is_upcoming: true,
      isUpcoming: true,
      days_until: 2,
      daysUntil: 2,
      urgency_level: "critical",
      urgencyLevel: "critical",
      priority_score: 92,
      priorityScore: 92,
      topics: [
        "Continuous-Time LTI Convolution Integrals",
        "BIBO Stability & Impulse Response",
        "Continuous-Time Fourier Series Coefficients",
        "Frequency Response of First-Order Filters",
      ],
      warnings: ["Bring university ID card", "Formula sheet attached to exam booklet"],
      estimated_study_hours: 6,
      estimatedStudyHours: 6,
      source: "Microsoft Teams",
      color: "#7c3aed",
      weightage_percent: 25,
      weightagePercent: 25,
    },
    {
      id: "asm-cs305-lab",
      course_id: "CS305",
      courseId: "CS305",
      course_name: "Operating Systems",
      courseName: "Operating Systems",
      title: "Lab Assessment 1 — POSIX Threads & Mutexes",
      assessment_type: "Lab Assessment",
      assessmentType: "Lab Assessment",
      date_iso: "2026-11-03",
      dateIso: "2026-11-03",
      day_name: "Tuesday",
      dayName: "Tuesday",
      start_time: "14:00",
      startTime: "14:00",
      end_time: "15:30",
      endTime: "15:30",
      display_time: "14:00–15:30",
      displayTime: "14:00–15:30",
      room: "SysLab 104",
      instructor: null,
      is_upcoming: true,
      isUpcoming: true,
      days_until: 5,
      daysUntil: 5,
      urgency_level: "high",
      urgencyLevel: "high",
      priority_score: 78,
      priorityScore: 78,
      topics: [
        "pthread_create & join Lifecycle",
        "Mutex Deadlock Avoidance Ordering",
        "Condition Variable Spurious Wakeups",
      ],
      warnings: [],
      elearning_url: "https://moodle.university.edu/mod/assign/view.php?id=4812",
      elearningUrl: "https://moodle.university.edu/mod/assign/view.php?id=4812",
      estimated_study_hours: 4,
      estimatedStudyHours: 4,
      source: "Moodle",
      color: "#059669",
      weightage_percent: 15,
      weightagePercent: 15,
    },
    {
      id: "asm-cse241-q1-past",
      course_id: "CSE241",
      courseId: "CSE241",
      course_name: "Digital Logic Design",
      courseName: "Digital Logic Design",
      title: "Online Quiz 1 — Boolean Algebra & DeMorgan",
      assessment_type: "Online Quiz",
      assessmentType: "Online Quiz",
      date_iso: "2026-10-18",
      dateIso: "2026-10-18",
      day_name: "Sunday",
      dayName: "Sunday",
      start_time: "18:00",
      startTime: "18:00",
      end_time: "18:30",
      endTime: "18:30",
      display_time: "18:00–18:30",
      displayTime: "18:00–18:30",
      room: null,
      instructor: "Dr. Nadia Mansour",
      is_upcoming: false,
      isUpcoming: false,
      days_until: -11,
      daysUntil: -11,
      urgency_level: "past",
      urgencyLevel: "past",
      priority_score: 0,
      priorityScore: 0,
      topics: ["Boolean Postulates", "DeMorgan Canonical SOP/POS"],
      warnings: [],
      source: "Google Classroom",
      color: "#1a73e8",
      achieved_score: 18,
      achievedScore: 18,
      max_score: 20,
      maxScore: 20,
      weightage_percent: 5,
      weightagePercent: 5,
    },
  ],
  topicsDone: [
    { key: "asm-cse241-q2::0", done: true, updated_at: FIXED_ISO },
    { key: "asm-ece310-mid::0", done: true, updated_at: FIXED_ISO },
  ],
  grades: [
    {
      assessment_id: "asm-cse241-q1-past",
      achieved_score: 18,
      max_score: 20,
      weightage_percent: 5,
      updated_at: FIXED_ISO,
    },
  ],
  events: [
    {
      id: "custom-ev-1",
      title: "Group Problem-Solving: Fourier Drills",
      course_id: "ECE310",
      courseId: "ECE310",
      event_type: "Study Session",
      eventType: "Study Session",
      date_iso: "2026-10-29",
      dateIso: "2026-10-29",
      start_time: "16:00",
      startTime: "16:00",
      end_time: "17:30",
      endTime: "17:30",
      room: "Library Quiet Zone 2",
      notes: "Work through 2024 past midterm problems 1-4",
      color: "#db2777",
    },
  ],
  feeds: [
    {
      id: "feed-eng-cal",
      name: "Engineering Faculty Exam Feed",
      url: "https://calendar.university.edu/feeds/engineering.ics",
      enabled: true,
    },
  ],
  config: [
    { key: "onboarding_completed", value: true },
    { key: "semester", value: "Fall 2026" },
    { key: "user_name", value: "Omar Hassan" },
    { key: "user_email", value: "o.hassan@student.university.edu" },
  ],
};

// ---------------------------------------------------------------------------
// Start Vite Dev Server if not already running on BASE_URL
// ---------------------------------------------------------------------------
async function ensureViteServer() {
  try {
    const res = await fetch(BASE_URL);
    if (res.ok) return null;
  } catch {
    // start server
  }

  const parsedUrl = new URL(BASE_URL);
  const viteBin = path.join(WEB_DIR, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(
    process.execPath,
    [viteBin, "--host", parsedUrl.hostname, "--port", parsedUrl.port || "4318", "--strictPort"],
    {
      cwd: WEB_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    },
  );

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok) return child;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  child.kill();
  throw new Error(`Vite failed to listen on ${BASE_URL} within 30s`);
}

// ---------------------------------------------------------------------------
// Browser In-Page Audit Inspector (CSS Color 4 + Gradient-Aware Contrast)
// ---------------------------------------------------------------------------
async function runDomAudit(page, stateId) {
  return await page.evaluate((id) => {
    const doc = globalThis.document;
    const win = globalThis.window;
    const gcs = globalThis.getComputedStyle;
    const cssEscape = globalThis.CSS.escape.bind(globalThis.CSS);
    const issues = [];

    // Offscreen 1x1 canvas resolves ANY CSS Color 4 syntax (rgb, oklch, color-mix, srgb) to sRGB
    const colorCanvas = doc.createElement("canvas");
    colorCanvas.width = 1;
    colorCanvas.height = 1;
    const colorCtx = colorCanvas.getContext("2d", { willReadFrequently: true });

    function parseCssColor(str) {
      if (!str || str === "transparent" || str === "rgba(0, 0, 0, 0)") return [0, 0, 0, 0];
      colorCtx.clearRect(0, 0, 1, 1);
      colorCtx.fillStyle = "rgba(0, 0, 0, 0)";
      colorCtx.fillStyle = str;
      colorCtx.fillRect(0, 0, 1, 1);
      const d = colorCtx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    }

    function extractGradientStops(bgImage) {
      if (!bgImage || bgImage === "none" || !bgImage.includes("gradient(")) return [];
      const matches = bgImage.match(
        /(?:rgba?|hsla?|oklch|oklab|lch|lab|color)\([^)]+\)|#[0-9a-fA-F]{3,8}/g,
      );
      if (!matches || matches.length === 0) return [];
      return matches.map(parseCssColor).filter((c) => c[3] > 0);
    }

    function compositeOver(fg, bg) {
      const a = fg[3] + bg[3] * (1 - fg[3]);
      if (a === 0) return [255, 255, 255, 0];
      return [
        (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / a,
        (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / a,
        (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / a,
        a,
      ];
    }

    function effectiveBgCandidates(el) {
      const layers = [];
      let cur = el;
      while (cur && cur.nodeType === 1) {
        const cs = gcs(cur);
        const rgba = parseCssColor(cs.backgroundColor);
        const gradStops = extractGradientStops(cs.backgroundImage);
        if (gradStops.length > 0) {
          layers.unshift({ kind: "gradient", stops: gradStops });
        }
        if (rgba[3] > 0) {
          layers.unshift({ kind: "solid", rgba });
        }
        cur = cur.parentElement;
      }
      const isDark = doc.documentElement.classList.contains("dark");
      let candidates = [isDark ? [11, 15, 25, 1] : [248, 250, 252, 1]];
      for (const layer of layers) {
        if (layer.kind === "solid") {
          candidates = candidates.map((base) => compositeOver(layer.rgba, base));
        } else {
          const next = [];
          for (const base of candidates) {
            for (const stop of layer.stops) {
              next.push(compositeOver(stop, base));
            }
          }
          candidates = next.slice(0, 8);
        }
      }
      return candidates;
    }

    function relLum([r, g, b]) {
      const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }

    function contrastRatio(fg, bg) {
      const compFg = fg[3] < 1 ? compositeOver(fg, bg) : fg;
      const l1 = relLum(compFg);
      const l2 = relLum(bg);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    function isVisible(el) {
      if (el.closest("[hidden]")) return false;
      const cs = gcs(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    // 1. Check stacked visible modal dialogs (inside modal-stack-root)
    const modalStackRoot = doc.querySelector('[data-testid="modal-stack-root"]');
    const visibleDialogs = modalStackRoot
      ? Array.from(modalStackRoot.querySelectorAll('[role="dialog"]')).filter(isVisible)
      : [];

    if (visibleDialogs.length > 1) {
      issues.push({
        stateId: id,
        rule: "stacked-visible-dialogs",
        severity: "critical",
        detail: `${visibleDialogs.length} modal [role="dialog"] windows visibly rendered simultaneously on screen`,
      });
    }

    // 2. Check double modal chrome & nested scrollbars inside each visible dialog
    for (const dlg of visibleDialogs) {
      const dlgRect = dlg.getBoundingClientRect();
      const dlgCs = gcs(dlg);
      const outerHasChrome =
        parseFloat(dlgCs.borderTopWidth) > 0 &&
        (dlgCs.boxShadow !== "none" || parseFloat(dlgCs.paddingTop) >= 12);

      const candidates = Array.from(dlg.querySelectorAll(":scope > div, :scope > div > div"));
      for (const child of candidates) {
        if (!isVisible(child)) continue;
        const r = child.getBoundingClientRect();
        const cs = gcs(child);
        const childHasBorder = parseFloat(cs.borderTopWidth) >= 1;
        const childHasShadow = cs.boxShadow && cs.boxShadow !== "none";
        const childHasRadius = parseFloat(cs.borderTopLeftRadius) >= 12;
        if (
          outerHasChrome &&
          r.width >= dlgRect.width * 0.72 &&
          r.height >= dlgRect.height * 0.5 &&
          childHasRadius &&
          (childHasShadow || (childHasBorder && parseFloat(cs.paddingTop) >= 16))
        ) {
          issues.push({
            stateId: id,
            rule: "double-modal-chrome",
            severity: "critical",
            detail: `Nested window card (${child.getAttribute("data-testid") || child.className.toString().slice(0, 60)}) inside outer .modal-panel`,
          });
          break;
        }
      }

      const outerScrolls = dlgCs.overflowY === "auto" || dlgCs.overflowY === "scroll";
      if (outerScrolls) {
        const innerScrollers = Array.from(dlg.querySelectorAll("*")).filter((el) => {
          if (!isVisible(el)) return false;
          const y = gcs(el).overflowY;
          return (y === "auto" || y === "scroll") && el.clientHeight > 120;
        });
        if (innerScrollers.length > 0) {
          issues.push({
            stateId: id,
            rule: "nested-scroll-containers",
            severity: "high",
            detail: `Dialog has overflow-y:${dlgCs.overflowY} AND ${innerScrollers.length} inner vertical scroll container(s)`,
          });
        }
      }
    }

    // 3. Walk elements for tiny-font, contrast-low, offscreen-x, missing-a11y-name
    const vw = win.innerWidth;
    const all = Array.from(doc.querySelectorAll("body *"));
    for (const el of all) {
      if (!isVisible(el)) continue;
      if (visibleDialogs.length > 0) {
        const topDlg = visibleDialogs[visibleDialogs.length - 1];
        if (!topDlg.contains(el) && el !== topDlg) continue;
      }

      const cs = gcs(el);
      const r = el.getBoundingClientRect();

      let inHorizScroll = false;
      let p = el.parentElement;
      while (p) {
        const ox = gcs(p).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden") {
          inHorizScroll = true;
          break;
        }
        p = p.parentElement;
      }
      if (!inHorizScroll && r.right > vw + 2) {
        issues.push({
          stateId: id,
          rule: "offscreen-x",
          severity: "high",
          detail: `<${el.tagName.toLowerCase()}> extends ${Math.round(r.right - vw)}px past viewport (${vw}px)`,
        });
      }

      const directText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join(" ")
        .trim();

      if (directText.length > 0) {
        const fontSize = parseFloat(cs.fontSize);
        if (fontSize < 10.9) {
          issues.push({
            stateId: id,
            rule: "tiny-font",
            severity: "medium",
            detail: `"${directText.slice(0, 40)}" uses ${fontSize}px (< 11px minimum)`,
          });
        }

        const isDisabled =
          el.closest("[disabled], [aria-disabled='true']") !== null || Number(cs.opacity) < 0.65;
        if (!isDisabled) {
          const fg = parseCssColor(cs.color);
          const bgCandidates = effectiveBgCandidates(el);
          const ratio = Math.min(...bgCandidates.map((bg) => contrastRatio(fg, bg)));
          const weight = parseInt(cs.fontWeight, 10) || 400;
          const isLarge = fontSize >= 24 || (fontSize >= 18.5 && weight >= 700);
          const minRatio = isLarge ? 3.0 : 4.5;
          if (ratio < minRatio - 0.15) {
            issues.push({
              stateId: id,
              rule: "contrast-low",
              severity: ratio < 3.0 ? "high" : "medium",
              detail: `"${directText.slice(0, 42)}" contrast ${ratio.toFixed(2)}:1 < ${minRatio}:1 (fg=${cs.color})`,
            });
          }
        }
      }

      const tag = el.tagName.toLowerCase();
      if (tag === "button" || tag === "select" || tag === "input") {
        if (tag === "input" && el.getAttribute("type") === "hidden") continue;
        const ariaLabel = el.getAttribute("aria-label") || "";
        const ariaLabelledBy = el.getAttribute("aria-labelledby") || "";
        const title = el.getAttribute("title") || "";
        const placeholder = el.getAttribute("placeholder") || "";
        const text = (el.textContent || "").trim();
        let hasLabelFor = false;
        if (el.id) {
          hasLabelFor = !!doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
        }
        const wrappedInLabel = !!el.closest("label");
        if (
          !ariaLabel &&
          !ariaLabelledBy &&
          !title &&
          !placeholder &&
          !text &&
          !hasLabelFor &&
          !wrappedInLabel
        ) {
          issues.push({
            stateId: id,
            rule: "missing-a11y-name",
            severity: "medium",
            detail: `<${tag}> (${el.className.toString().slice(0, 50)}) has no accessible label`,
          });
        }
      }
    }

    return issues;
  }, stateId);
}

// ---------------------------------------------------------------------------
// Helpers to boot Empty or Seeded Contexts
// ---------------------------------------------------------------------------
async function createContextAndPage(browser, { theme = "light", mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: theme,
    reducedMotion: "reduce",
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(FIXED_ISO));
  await page.addInitScript((mode) => {
    globalThis.window.localStorage.setItem("quizradar-theme", mode);
  }, theme);
  return { context, page };
}

async function seedIndexedDb(page, customSeed = SEED_DATA) {
  await page.evaluate(async (seed) => {
    await new Promise((resolve, reject) => {
      const req = globalThis.indexedDB.open("quizradar", 1);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        const stores = [
          "courses",
          "slots",
          "assessments",
          "topics_done",
          "grades",
          "events",
          "feeds",
          "config_kv",
          "tokens_meta",
        ];
        for (const name of stores) {
          if (!db.objectStoreNames.contains(name)) {
            if (name === "grades") db.createObjectStore(name, { keyPath: "assessment_id" });
            else if (["topics_done", "config_kv", "tokens_meta"].includes(name))
              db.createObjectStore(name, { keyPath: "key" });
            else db.createObjectStore(name, { keyPath: "id" });
          }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(
          [
            "courses",
            "slots",
            "assessments",
            "topics_done",
            "grades",
            "events",
            "feeds",
            "config_kv",
          ],
          "readwrite",
        );
        for (const s of [
          "courses",
          "slots",
          "assessments",
          "topics_done",
          "grades",
          "events",
          "feeds",
          "config_kv",
        ]) {
          tx.objectStore(s).clear();
        }
        for (const c of seed.courses || []) tx.objectStore("courses").put(c);
        for (const sl of seed.slots || []) tx.objectStore("slots").put(sl);
        for (const a of seed.assessments || []) tx.objectStore("assessments").put(a);
        for (const t of seed.topicsDone || []) tx.objectStore("topics_done").put(t);
        for (const g of seed.grades || []) tx.objectStore("grades").put(g);
        for (const e of seed.events || []) tx.objectStore("events").put(e);
        for (const f of seed.feeds || []) tx.objectStore("feeds").put(f);
        for (const kv of seed.config || []) tx.objectStore("config_kv").put(kv);
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    globalThis.window.localStorage.removeItem("quizradar_swr_state_v1");
  }, customSeed);
}

async function settle(page) {
  await page.waitForFunction(() => globalThis.document.fonts.status === "loaded", null, {
    timeout: 15_000,
  });
  await page.waitForFunction(
    () => !globalThis.document.documentElement.classList.contains("theme-transition"),
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(220);
}

async function snap(page, id, auditIssues, capturedList) {
  await settle(page);
  const filePath = path.join(OUT_DIR, `${id}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  const domIssues = await runDomAudit(page, id);
  auditIssues.push(...domIssues);
  capturedList.push({ id, file: filePath, issueCount: domIssues.length });
  console.log(`[${PHASE}] Captured ${id}.png (${domIssues.length} DOM/visual issues)`);
}

// ---------------------------------------------------------------------------
// Main Sweep Execution
// ---------------------------------------------------------------------------
async function main() {
  const viteProc = await ensureViteServer();
  const browser = await chromium.launch({ headless: true });

  const auditIssues = [];
  const functionalChecks = [];
  const capturedList = [];

  const recordCheck = (name, passed, detail) => {
    functionalChecks.push({ name, passed, detail });
    console.log(`  [check] ${passed ? "PASS" : "FAIL"} - ${name}: ${detail}`);
  };

  try {
    // =========================================================================
    // PART A: FIRST-RUN ONBOARDING & EMPTY STATES (Light + Dark)
    // =========================================================================
    {
      const { context, page } = await createContextAndPage(browser, { theme: "light" });
      await page.goto(BASE_URL);
      const wiz = page.getByTestId("modal-onboarding");
      await wiz.waitFor({ state: "visible" });
      await snap(page, "01-onboarding-step1-light", auditIssues, capturedList);

      await wiz.getByPlaceholder("Student Name").fill("Omar Hassan");
      await wiz.getByPlaceholder("student@university.edu").fill("o.hassan@student.university.edu");
      await wiz.getByRole("button", { name: /Medicine & Health Sciences/i }).click();
      await wiz.getByRole("button", { name: /Engineering & Sciences/i }).click();

      await wiz.getByRole("button", { name: /Next Step/i }).click();
      await snap(page, "02-onboarding-step2-light", auditIssues, capturedList);

      await wiz.getByRole("button", { name: /Next Step/i }).click();
      await snap(page, "03-onboarding-step3-light", auditIssues, capturedList);

      await wiz.getByRole("button", { name: "Close" }).click();
      await wiz.waitFor({ state: "detached" });
      await snap(page, "04-empty-dashboard-light", auditIssues, capturedList);

      await page.getByTestId("topbar-view-switcher").getByRole("tab", { name: "Tasks" }).click();
      await snap(page, "05-empty-tasks-light", auditIssues, capturedList);

      await page.getByTestId("topbar-view-switcher").getByRole("tab", { name: "Calendar" }).click();
      await snap(page, "06-empty-calendar-light", auditIssues, capturedList);

      const topBarText = await page.getByTestId("app-topbar").innerText();
      const hasOctober = topBarText.includes("October 2026");
      recordCheck(
        "topbar-calendar-month-label",
        hasOctober,
        hasOctober
          ? 'TopBar renders "October 2026" matching 2026-10-29'
          : `TopBar rendered wrong month in header: "${topBarText.replace(/\s+/g, " ").trim()}"`,
      );

      await page.getByTestId("app-sidebar").getByRole("button", { name: "Focus" }).click();
      await snap(page, "07-empty-focus-light", auditIssues, capturedList);

      await context.close();
    }

    {
      const { context, page } = await createContextAndPage(browser, { theme: "dark" });
      await page.goto(BASE_URL);
      const wiz = page.getByTestId("modal-onboarding");
      await wiz.waitFor({ state: "visible" });
      await snap(page, "01-onboarding-step1-dark", auditIssues, capturedList);
      await wiz.getByRole("button", { name: "Close" }).click();
      await wiz.waitFor({ state: "detached" });
      await snap(page, "04-empty-dashboard-dark", auditIssues, capturedList);
      await context.close();
    }

    // =========================================================================
    // PART B: ALL-CLEAR DASHBOARD "ADD CUSTOM QUIZ OR EXAM" MODAL CHECK
    // =========================================================================
    {
      const { context, page } = await createContextAndPage(browser, { theme: "light" });
      await page.goto(BASE_URL);
      await seedIndexedDb(page, {
        ...SEED_DATA,
        assessments: [],
        topicsDone: [],
        grades: [],
      });
      await page.reload();
      await page.getByText("All Clear for Now!").waitFor({ state: "visible" });
      await page.getByRole("button", { name: /Add Custom Quiz or Exam/i }).click();
      await page.waitForTimeout(250);
      await snap(page, "12-dashboard-all-clear-modal-light", auditIssues, capturedList);

      const bodyText = await page.locator("body").innerText();
      const hasBrokenPlaceholder = bodyText.includes("Modal content placeholder");
      recordCheck(
        "all-clear-add-custom-event-modal",
        !hasBrokenPlaceholder,
        hasBrokenPlaceholder
          ? "Clicked 'Add Custom Quiz or Exam' and got unregistered 'create-event' placeholder!"
          : "Opens registered CreateEditEventModal cleanly",
      );
      await context.close();
    }

    // =========================================================================
    // PART C: POPULATED DESKTOP VIEWS & INTERACTIVE FLOWS (Light)
    // =========================================================================
    {
      const { context, page } = await createContextAndPage(browser, { theme: "light" });
      await page.goto(BASE_URL);
      await seedIndexedDb(page);
      await page.reload();
      await page.getByTestId("view-dashboard").waitFor({ state: "visible" });
      await page.getByTestId("conflict-banner-unresolved").waitFor({ state: "visible" });

      const fakeAuthWhenUnconnected = await page.evaluate(async () => {
        const { useAppStore } = await import("/src/state/store.ts");
        return Boolean(useAppStore.getState().data.auth.authenticated);
      });
      recordCheck(
        "web-local-profile-no-fake-auth",
        !fakeAuthWhenUnconnected,
        !fakeAuthWhenUnconnected
          ? "Local user_email anchor stays unauthenticated until real OAuth sign-in"
          : "pwaRpcHandler fabricated auth.authenticated=true from local user_email without any OAuth token!",
      );

      await snap(page, "08-populated-dashboard-light", auditIssues, capturedList);

      const selectOptions = await page
        .getByTestId("all-assessments-panel")
        .locator("select option")
        .evaluateAll((opts) => opts.map((o) => o.getAttribute("value")));
      const requiredTypes = [
        "Class Quiz",
        "Online Quiz",
        "Midterm Exam",
        "Final Exam",
        "Lab Assessment",
        "Assignment",
      ];
      const missingTypes = requiredTypes.filter((t) => !selectOptions.includes(t));
      recordCheck(
        "dashboard-assessment-type-options",
        missingTypes.length === 0,
        missingTypes.length === 0
          ? "All 6 core AssessmentType variants are selectable"
          : `Missing AssessmentType options in dropdown: ${missingTypes.join(", ")}`,
      );

      const firstRec = page.getByTestId("rec-card-asm-cse241-q2");
      await firstRec.getByRole("button", { name: /3 topics/i }).click();
      await page.waitForTimeout(200);
      await snap(page, "10-dashboard-rec-expanded-light", auditIssues, capturedList);

      await page.getByTestId("all-assessments-panel").locator("select").selectOption("Assignment");
      await page.waitForTimeout(150);
      await snap(page, "11-dashboard-filtered-empty-light", auditIssues, capturedList);
      await page
        .getByTestId("timeline-empty-filtered")
        .getByRole("button", { name: /Clear Filters/i })
        .click();

      await page
        .getByTestId("conflict-banner-unresolved")
        .getByRole("button", { name: /Auto-Schedule Study Blocks/i })
        .click();
      await page.getByTestId("conflict-banner-mitigated").waitFor({ state: "visible" });
      await snap(page, "09-dashboard-conflict-mitigated-light", auditIssues, capturedList);

      await page.getByTestId("topbar-view-switcher").getByRole("tab", { name: "Tasks" }).click();
      await page.getByTestId("view-tasks").waitFor({ state: "visible" });
      await snap(page, "13-populated-tasks-light", auditIssues, capturedList);

      const perCardAvgCount = await page
        .locator('[data-testid^="readiness-card-"]')
        .evaluateAll(
          (cards) =>
            cards.filter((c) => /avg readiness/i.test(c.innerText || c.textContent || "")).length,
        );
      recordCheck(
        "tasks-readiness-card-no-misleading-avg",
        perCardAvgCount === 0,
        perCardAvgCount === 0
          ? "Individual exam readiness cards show single-exam readiness cleanly"
          : `${perCardAvgCount} individual readiness cards falsely label their score as 'avg'`,
      );

      const firstRoadmapCheck = page
        .locator('[data-testid^="roadmap-task-"] input[type="checkbox"]')
        .first();
      if ((await firstRoadmapCheck.count()) > 0) {
        await firstRoadmapCheck.click();
        await page.waitForTimeout(150);
      }
      const tasksSelect = page.getByTestId("view-tasks").locator("select").first();
      if ((await tasksSelect.count()) > 0) {
        await tasksSelect.selectOption("CSE241");
        await tasksSelect.selectOption("ALL");
      }

      await page.getByTestId("topbar-view-switcher").getByRole("tab", { name: "Calendar" }).click();
      await page.getByTestId("view-calendar").waitFor({ state: "visible" });
      await snap(page, "14-populated-calendar-light", auditIssues, capturedList);

      const calTopBarText = await page.getByTestId("app-topbar").innerText();
      const calHasOctober = calTopBarText.includes("October 2026");
      recordCheck(
        "topbar-populated-calendar-month-label",
        calHasOctober,
        calHasOctober
          ? 'Populated Calendar TopBar renders "October 2026" matching week of 2026-10-25..31'
          : `Populated Calendar TopBar rendered wrong month: "${calTopBarText.replace(/\s+/g, " ").trim()}"`,
      );

      const sundaySlot = page
        .getByTestId("calendar-day-col-2026-10-25")
        .locator(".gcal-card")
        .first();
      if ((await sundaySlot.count()) > 0) {
        await sundaySlot.click();
        await page.getByRole("dialog", { name: "Class details" }).waitFor({ state: "visible" });
        await snap(page, "15-calendar-slot-popover-light", auditIssues, capturedList);
        await page
          .getByRole("dialog", { name: "Class details" })
          .getByRole("button", { name: "Close" })
          .click();
      }

      await page.getByTestId("app-sidebar").getByRole("button", { name: "Focus" }).click();
      const focusView = page.getByTestId("view-focus");
      await focusView.waitFor({ state: "visible" });
      await snap(page, "16-populated-focus-light", auditIssues, capturedList);

      // Exercise FocusView controls (mode pills, Start/Pause, Reset, Practice Quiz tab)
      const shortBreakBtn = focusView.getByRole("button", { name: /Short Break/i });
      if ((await shortBreakBtn.count()) > 0) {
        await shortBreakBtn.click();
        await focusView.getByRole("button", { name: /Focus \(25m\)/i }).click();
        const startBtn = focusView.getByRole("button", { name: /^Start$/i });
        if ((await startBtn.count()) > 0) {
          await startBtn.click();
          await focusView.getByRole("button", { name: /^Pause$/i }).click();
          await focusView.getByRole("button", { name: /^Reset$/i }).click();
        }
        const practiceTab = focusView.getByRole("tab", { name: /Practice Quiz/i });
        if ((await practiceTab.count()) > 0) {
          await practiceTab.click();
          await page.waitForTimeout(150);
          await focusView.getByRole("tab", { name: /Focus Pomodoro/i }).click();
        }
      }
      const focusButtons = await focusView.locator("button").count();
      recordCheck(
        "focus-view-interactive-hub",
        focusButtons >= 3,
        focusButtons >= 3
          ? `FocusView provides ${focusButtons} interactive timer/practice controls`
          : `FocusView is a dead static placeholder (${focusButtons} buttons) even with active exams!`,
      );

      await page.getByTestId("app-sidebar").getByRole("button", { name: "Help & Tiers" }).click();
      await page.getByTestId("view-help").waitFor({ state: "visible" });
      await snap(page, "17-help-view-light", auditIssues, capturedList);

      await page
        .getByTestId("topbar-view-switcher")
        .getByRole("tab", { name: "Dashboard" })
        .click();
      await page.getByTestId("view-dashboard").waitFor({ state: "visible" });

      // =======================================================================
      // PART D: ALL 13 MODALS & STACKED MODAL FLOWS (Light)
      // =======================================================================

      await page.getByRole("button", { name: "Open settings" }).click();
      const settingsModal = page.getByTestId("modal-settings");
      await settingsModal.waitFor({ state: "visible" });
      await snap(page, "18-modal-settings-account-light", auditIssues, capturedList);

      const accountText = await settingsModal.innerText();
      const claimsBundledSecretOnWeb = accountText.includes("ID + secret, kept inside the app");
      recordCheck(
        "web-settings-account-honest-secret-copy",
        !claimsBundledSecretOnWeb,
        !claimsBundledSecretOnWeb
          ? "Web tier Account tab honestly describes secretless browser GIS sign-in"
          : "Web tier Account tab falsely claims bundled 'ID + secret, kept inside the app'",
      );

      await settingsModal.getByRole("tab", { name: "Courses" }).click();
      await snap(page, "19-modal-settings-courses-light", auditIssues, capturedList);

      await settingsModal.getByRole("button", { name: /^Add Course$/i }).click();
      await page.getByTestId("modal-add-course").waitFor({ state: "visible" });
      await snap(page, "21-modal-stacked-settings-add-course-light", auditIssues, capturedList);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(180);

      const settingsStillOpen = await settingsModal.isVisible();
      recordCheck(
        "stacked-modal-lifo-escape",
        settingsStillOpen,
        settingsStillOpen
          ? "Pressing Escape on stacked AddCourseModal cleanly restored SettingsModal"
          : "SettingsModal was lost after closing stacked child modal",
      );

      await settingsModal.getByRole("tab", { name: "Integrations" }).click();
      await snap(page, "20-modal-settings-integrations-light", auditIssues, capturedList);

      const feedSwitch = settingsModal.getByRole("switch", { name: /Enable feed/i }).first();
      const feedToggleCount = await feedSwitch.count();
      if (feedToggleCount >= 1) {
        await feedSwitch.click();
        await page.waitForTimeout(120);
        await feedSwitch.click();
        await page.waitForTimeout(120);
      }
      recordCheck(
        "settings-ics-feed-enable-toggle",
        feedToggleCount >= 1,
        feedToggleCount >= 1
          ? "Subscribed .ics feed row has an interactive enable/disable toggle"
          : "Subscribed .ics feed row has Delete only — missing enable/disable toggle (01 §4.9)",
      );

      const backupRoundTrip = await page.evaluate(async () => {
        try {
          const { useAppStore } = await import("/src/state/store.ts");
          const exp = await useAppStore.getState().exportBackupFile();
          const hasExportShape =
            exp && typeof exp === "object" && "saved" in exp && typeof exp.json === "string";
          const imp = await useAppStore.getState().importBackupFile(undefined, exp.json || "");
          const hasImportReport =
            imp && typeof imp === "object" && typeof imp.coursesImported === "number";
          return {
            ok: Boolean(hasExportShape && hasImportReport),
            detail: `exportShape=${Boolean(hasExportShape)}, importReport=${Boolean(hasImportReport)}`,
          };
        } catch (err) {
          return { ok: false, detail: String(err) };
        }
      });
      recordCheck("pwa-backup-export-import-contract", backupRoundTrip.ok, backupRoundTrip.detail);

      await settingsModal.getByRole("button", { name: /Reset All Local Data/i }).click();
      await page.getByTestId("modal-app-confirm").waitFor({ state: "visible" });
      await snap(page, "22-modal-stacked-settings-confirm-reset-light", auditIssues, capturedList);
      await page.getByTestId("modal-app-confirm").getByRole("button", { name: "Cancel" }).click();
      await settingsModal.getByRole("button", { name: "Close" }).first().click();
      await page.waitForTimeout(180);

      await page.evaluate(async () => {
        const { useAppStore } = await import("/src/state/store.ts");
        const st = useAppStore.getState();
        useAppStore.setState({
          data: {
            ...st.data,
            auth: {
              ...st.data.auth,
              authenticated: true,
              email: "o.hassan@student.university.edu",
              name: "Omar Hassan",
            },
          },
        });
        st.openModal("account-profile");
      });
      await page.getByTestId("modal-account-profile").waitFor({ state: "visible" });
      await snap(page, "23-modal-account-profile-light", auditIssues, capturedList);

      await page
        .getByTestId("modal-account-profile")
        .getByRole("button", { name: /Disconnect Google/i })
        .click();
      await page.getByTestId("modal-app-confirm").waitFor({ state: "visible" });
      await snap(page, "24-modal-stacked-profile-signout-light", auditIssues, capturedList);
      await page.getByTestId("modal-app-confirm").getByRole("button", { name: "Cancel" }).click();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(180);

      await page.getByTestId("timeline-row-asm-cse241-q2").click();
      const detailModal = page.getByTestId("modal-assessment-detail");
      await detailModal.waitFor({ state: "visible" });
      const whatIfInput = detailModal.locator('input[type="number"]').last();
      await whatIfInput.fill("85");
      await snap(page, "25-modal-assessment-detail-light", auditIssues, capturedList);

      const detailText = await detailModal.innerText();
      recordCheck(
        "assessment-detail-missing-room-emdash",
        detailText.includes("—"),
        detailText.includes("—")
          ? 'Missing room rendered honestly as "—"'
          : "Missing room did not render em-dash",
      );

      await detailModal.getByRole("button", { name: /Practice Quiz/i }).click();
      const quizModal = page.getByTestId("modal-practice-quiz");
      await quizModal.waitFor({ state: "visible" });
      await quizModal.getByText(/Question 1 of/i).waitFor({ state: "visible" });
      await quizModal.locator(".space-y-6 > div").first().locator("button").first().click();
      await snap(page, "29-modal-practice-quiz-light", auditIssues, capturedList);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(180);

      await page.getByTestId("timeline-row-asm-cse241-q2").click();
      await detailModal.waitFor({ state: "visible" });
      await detailModal.getByRole("button", { name: /Start Focus Pomodoro/i }).click();
      await page.getByTestId("modal-pomodoro").waitFor({ state: "visible" });
      await snap(page, "30-modal-pomodoro-light", auditIssues, capturedList);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(180);

      await page.getByTestId("sidebar-create-event").click();
      await page.getByTestId("modal-create-edit-event").waitFor({ state: "visible" });
      await snap(page, "26-modal-create-event-light", auditIssues, capturedList);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(180);

      await page
        .getByTestId("app-topbar")
        .getByRole("button", { name: /Data & Backup/i })
        .click();
      await page.getByTestId("modal-cloud-sync").waitFor({ state: "visible" });
      await snap(page, "27-modal-cloud-sync-light", auditIssues, capturedList);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(180);

      await page.keyboard.press("/");
      const searchModal = page.getByTestId("modal-search");
      await searchModal.waitFor({ state: "visible" });
      await searchModal
        .locator('input[type="text"], input[type="search"]')
        .first()
        .fill("Karnaugh");
      await page.waitForTimeout(150);
      await snap(page, "28-modal-search-palette-light", auditIssues, capturedList);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(180);

      await page.evaluate(async () => {
        const { useAppStore } = await import("/src/state/store.ts");
        useAppStore.setState({
          syncStatus: "idle",
          syncOutcome: {
            status: "success",
            totalNew: 2,
            totalUpdated: 1,
            notes: ["Gmail: 2 announcements resolved", "Engineering Feed: 1 assessment updated"],
          },
        });
        useAppStore.getState().openModal("scan-progress");
      });
      await page.getByTestId("modal-scan-progress").waitFor({ state: "visible" });
      await snap(page, "31-modal-scan-progress-light", auditIssues, capturedList);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(180);

      await page.evaluate(async () => {
        const { useAppStore } = await import("/src/state/store.ts");
        useAppStore.getState().openSchedulePreview({
          schedule: {
            semester: "Fall 2026",
            courses: [
              { id: "CSE241", name: "Digital Logic Design", color: "#1a73e8" },
              { id: "ECE310", name: "Signals & Linear Systems", color: "#7c3aed" },
            ],
            slots: [
              {
                id: "ext-1",
                day: "Sun",
                dayIndex: 0,
                courseId: "CSE241",
                courseName: "Digital Logic Design",
                type: "Lecture",
                group: "Sec 1",
                room: "Eng 302",
                startTime: "09:00",
                endTime: "10:30",
                displayTime: "09:00–10:30",
              },
              {
                id: "ext-2",
                day: "Tue",
                dayIndex: 2,
                courseId: "ECE310",
                courseName: "Signals & Linear Systems",
                type: "Tutorial",
                group: null,
                room: null,
                startTime: "11:00",
                endTime: "12:30",
                displayTime: "11:00–12:30",
              },
            ],
          },
          droppedCourses: 1,
          droppedSlots: 2,
        });
      });
      await page.getByTestId("modal-schedule-preview").waitFor({ state: "visible" });
      await snap(page, "32-modal-schedule-preview-light", auditIssues, capturedList);
      await page.keyboard.press("Escape");

      await context.close();
    }

    // =========================================================================
    // PART E: POPULATED DARK THEME VIEWS & MODALS
    // =========================================================================
    {
      const { context, page } = await createContextAndPage(browser, { theme: "dark" });
      await page.goto(BASE_URL);
      await seedIndexedDb(page);
      await page.reload();
      await page.getByTestId("view-dashboard").waitFor({ state: "visible" });

      await snap(page, "08-populated-dashboard-dark", auditIssues, capturedList);

      await page.getByTestId("topbar-view-switcher").getByRole("tab", { name: "Tasks" }).click();
      await snap(page, "13-populated-tasks-dark", auditIssues, capturedList);

      await page.getByTestId("topbar-view-switcher").getByRole("tab", { name: "Calendar" }).click();
      await snap(page, "14-populated-calendar-dark", auditIssues, capturedList);

      await page.getByTestId("app-sidebar").getByRole("button", { name: "Focus" }).click();
      await snap(page, "16-populated-focus-dark", auditIssues, capturedList);

      await page.getByTestId("app-sidebar").getByRole("button", { name: "Help & Tiers" }).click();
      await snap(page, "17-help-view-dark", auditIssues, capturedList);

      await page
        .getByTestId("topbar-view-switcher")
        .getByRole("tab", { name: "Dashboard" })
        .click();
      await page.getByRole("button", { name: "Open settings" }).click();
      const settingsModal = page.getByTestId("modal-settings");
      await settingsModal.waitFor({ state: "visible" });
      await snap(page, "18-modal-settings-account-dark", auditIssues, capturedList);

      await settingsModal.getByRole("tab", { name: "Integrations" }).click();
      await snap(page, "20-modal-settings-integrations-dark", auditIssues, capturedList);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(180);

      await page.getByTestId("timeline-row-asm-cse241-q2").click();
      await page.getByTestId("modal-assessment-detail").waitFor({ state: "visible" });
      await snap(page, "25-modal-assessment-detail-dark", auditIssues, capturedList);

      await context.close();
    }

    // =========================================================================
    // PART F: MOBILE VIEWPORT (390x844) SUB-TABS & BOTTOM NAVIGATION
    // =========================================================================
    {
      const { context, page } = await createContextAndPage(browser, {
        theme: "light",
        mobile: true,
      });
      await page.goto(BASE_URL);
      await seedIndexedDb(page);
      await page.reload();
      await page.getByTestId("view-dashboard").waitFor({ state: "visible" });

      await snap(page, "33-mobile-dashboard-study-light", auditIssues, capturedList);

      await page.getByRole("button", { name: /^Assessments\b/i }).click();
      await snap(page, "34-mobile-dashboard-assessments-light", auditIssues, capturedList);

      await page.getByRole("button", { name: /At a Glance/i }).click();
      await snap(page, "35-mobile-dashboard-overview-light", auditIssues, capturedList);

      const mobileNav = page.getByTestId("app-mobilenav");
      await mobileNav.getByRole("button", { name: "Tasks" }).click();
      await snap(page, "36-mobile-tasks-light", auditIssues, capturedList);

      await mobileNav.getByRole("button", { name: "Calendar" }).click();
      await snap(page, "37-mobile-calendar-light", auditIssues, capturedList);

      await mobileNav.getByRole("button", { name: "Focus" }).click();
      await snap(page, "38-mobile-focus-light", auditIssues, capturedList);

      await context.close();
    }

    {
      const { context, page } = await createContextAndPage(browser, {
        theme: "dark",
        mobile: true,
      });
      await page.goto(BASE_URL);
      await seedIndexedDb(page);
      await page.reload();
      await page.getByTestId("view-dashboard").waitFor({ state: "visible" });
      await snap(page, "33-mobile-dashboard-study-dark", auditIssues, capturedList);
      await context.close();
    }

    // =========================================================================
    // PART G: LIVE TAURI 2 DESKTOP SHELL OVER WEBVIEW2 CDP (Sandboxed AppData)
    // =========================================================================
    const exeSuffix = process.platform === "win32" ? ".exe" : "";
    const desktopExe = path.join(REPO_ROOT, "target", "debug", `quizradar-desktop${exeSuffix}`);
    if (fs.existsSync(desktopExe)) {
      const viteBin = path.join(WEB_DIR, "node_modules", "vite", "bin", "vite.js");
      let vite5173 = null;
      try {
        const res = await fetch("http://localhost:5173");
        if (!res.ok) throw new Error("not up");
      } catch {
        vite5173 = spawn(
          process.execPath,
          [viteBin, "--host", "localhost", "--port", "5173", "--strictPort"],
          { cwd: WEB_DIR, stdio: "ignore", env: { ...process.env } },
        );
        const dl = Date.now() + 20_000;
        while (Date.now() < dl) {
          try {
            const r = await fetch("http://localhost:5173");
            if (r.ok) break;
          } catch {
            await new Promise((r) => setTimeout(r, 250));
          }
        }
      }

      const tempAppData = fs.mkdtempSync(path.join(os.tmpdir(), `quizradar-tauri-${PHASE}-`));
      const wv2Dir = path.join(tempAppData, "wv2");
      fs.mkdirSync(wv2Dir, { recursive: true });

      const tauriChild = spawn(desktopExe, [], {
        cwd: REPO_ROOT,
        stdio: "ignore",
        env: {
          ...process.env,
          QUIZRADAR_DATA_DIR: tempAppData,
          QUIZRADAR_EPHEMERAL_KEYRING: "1",
          WEBVIEW2_USER_DATA_FOLDER: wv2Dir,
          WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9333",
        },
      });

      try {
        let cdpBrowser = null;
        const cdpDeadline = Date.now() + 25_000;
        while (Date.now() < cdpDeadline) {
          try {
            cdpBrowser = await chromium.connectOverCDP("http://127.0.0.1:9333");
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 400));
          }
        }
        if (cdpBrowser) {
          const pages = cdpBrowser.contexts().flatMap((c) => c.pages());
          const tauriPage = pages[0];
          if (tauriPage) {
            await tauriPage.waitForSelector('[data-testid="app-topbar"]', { timeout: 20_000 });
            await tauriPage.evaluate(() => {
              globalThis.document.documentElement.classList.remove("dark");
              globalThis.window.localStorage.setItem("quizradar-theme", "light");
            });
            await snap(tauriPage, "39-desktop-tauri-onboarding-light", auditIssues, capturedList);
            const onb = tauriPage.getByTestId("modal-onboarding");
            if ((await onb.count()) > 0 && (await onb.isVisible())) {
              await onb.getByRole("button", { name: "Close" }).click();
              await onb.waitFor({ state: "detached" });
            }
            await tauriPage.getByRole("button", { name: "Open settings" }).click();
            await tauriPage.getByTestId("modal-settings").waitFor({ state: "visible" });
            await snap(
              tauriPage,
              "40-desktop-tauri-settings-account-light",
              auditIssues,
              capturedList,
            );
          }
          await cdpBrowser.close().catch(() => {});
        }
      } finally {
        tauriChild.kill();
        if (vite5173) vite5173.kill();
        setTimeout(() => {
          fs.rmSync(tempAppData, { recursive: true, force: true });
        }, 1200);
      }
    }
  } finally {
    await browser.close();
    if (viteProc) {
      viteProc.kill();
    }
  }

  const byRule = {};
  for (const issue of auditIssues) {
    byRule[issue.rule] = (byRule[issue.rule] || 0) + 1;
  }
  const failedChecks = functionalChecks.filter((c) => !c.passed);

  const report = {
    phase: PHASE,
    capturedAt: new Date().toISOString(),
    screenshotsCount: capturedList.length,
    totalDomIssues: auditIssues.length,
    domIssuesByRule: byRule,
    failedFunctionalChecksCount: failedChecks.length,
    functionalChecks,
    domIssues: auditIssues,
    screenshots: capturedList,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n=== SWEEP SUMMARY (${PHASE.toUpperCase()}) ===`);
  console.log(`Screenshots captured: ${capturedList.length}`);
  console.log(`DOM/Visual issues:    ${auditIssues.length}`, byRule);
  console.log(`Failed func checks:   ${failedChecks.length} / ${functionalChecks.length}`);
  console.log(`Saved report to:      ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
