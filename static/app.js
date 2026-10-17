// ============================================================================
// QuizRadar — Standalone Frontend Controller (Impeccable Polish, Animate & Adapt)
// Views: 1) First-Time Onboarding Wizard  2) Smart Dashboard  3) Week Calendar
// ============================================================================

let appState = {
  config: {},
  auth: {},
  schedule: { semester: "", courses: [], slots: [] },
  assessments: [],
  dashboard: {
    reference_date: "2026-10-17",
    next_up: null,
    upcoming_this_week: [],
    all_upcoming: [],
    exam_type_counts: {},
    study_recommendations: [],
    total_topics_count: 0,
    completed_topics_count: 0,
    readiness_percent: 0,
  },
};

let currentMainView = "dashboard"; // "dashboard" | "calendar"
let currentWeekStart = new Date(2026, 9, 18); // Sunday, Oct 18, 2026
let selectedCalendarDate = new Date(2026, 9, 18);
let activeCourseFilters = new Set();
let showWeeklyClasses = true;
let showExamOverlays = true;
let globalSearchQuery = "";
let activeModalAssessmentId = null;
let activeModalDateIso = null;
let toastHideTimeout = null;

const START_HOUR = 8; // 8 AM
const END_HOUR = 20;  // 8 PM
const HOUR_HEIGHT = 56; // 56px per hour

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

document.addEventListener("DOMContentLoaded", async () => {
  initDarkMode();
  initSidebarResponsive();
  initKeyboardShortcuts();

  if (window.lucide) {
    lucide.createIcons();
  }
  await loadFullState();

  const params = new URLSearchParams(window.location.search);
  if (params.get("auth") === "success") {
    showToast("Signed in with Google! Scanned Gmail with Gemini AI & synced Calendar.");
    window.history.replaceState({}, document.title, "/");
  }
});

// ============================================================================
// DARK MODE & RESPONSIVE SIDEBAR MANAGEMENT
// ============================================================================

let themeTransitionTimeout = null;

function initDarkMode() {
  const saved = localStorage.getItem("quizradar_theme");
  const isDark = saved === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  updateDarkModeIcon(isDark);
}

function applySmoothThemeSwitch(isDark) {
  const root = document.documentElement;
  root.classList.add("theme-transitioning");
  if (themeTransitionTimeout) {
    clearTimeout(themeTransitionTimeout);
  }
  root.classList.toggle("dark", isDark);
  localStorage.setItem("quizradar_theme", isDark ? "dark" : "light");
  updateDarkModeIcon(isDark);
  updateOnboardingThemeButtons();

  themeTransitionTimeout = setTimeout(() => {
    root.classList.remove("theme-transitioning");
    themeTransitionTimeout = null;
  }, 240);
}

function toggleDarkMode() {
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

  if (window.innerWidth < 1024) {
    sb.classList.add("sidebar-collapsed");
    if (backdrop) backdrop.classList.add("hidden");
  }

  window.addEventListener("resize", () => {
    if (window.innerWidth >= 1024 && backdrop) {
      backdrop.classList.add("hidden");
    }
  });
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

const STATE_CACHE_KEY = "quizradar_state_cache_v2";

function saveStateCache() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("demo")) return;
  try {
    localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(appState));
  } catch (e) {
    // Ignore storage quota errors
  }
}

function hydrateAndRenderState(stateData) {
  appState = stateData;
  if (activeCourseFilters.size === 0 && appState.schedule?.courses) {
    appState.schedule.courses.forEach((c) => activeCourseFilters.add(c.id));
    activeCourseFilters.add("GENERAL");
  }
  updateTopBarAndUser();
  renderSidebar();
  renderDashboard();
  renderWeekCalendar();
}

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
    const data = await res.json();
    appState = data;

    if (activeCourseFilters.size === 0 && appState.schedule?.courses) {
      appState.schedule.courses.forEach((c) => activeCourseFilters.add(c.id));
      activeCourseFilters.add("GENERAL");
    }

    if (demo) {
      applyDemoDummyData();
    } else {
      saveStateCache();
    }

    updateTopBarAndUser();
    renderSidebar();
    renderDashboard();
    renderWeekCalendar();

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

    // One-time First-Run Onboarding Wizard: only opens the very first time the app is used
    const localOnboardDone = localStorage.getItem("quizradar_onboarding_done") === "true";
    if (!appState.config.onboarding_completed && !localOnboardDone) {
      openOnboardingModal(1);
    }
  } catch (err) {
    console.error("Failed to load state:", err);
  }
}

function applyDemoDummyData() {
  if (!appState.auth) appState.auth = {};
  if (!appState.config) appState.config = {};

  appState.auth.name = "Alex Mercer";
  appState.auth.email = "alex.mercer@university.edu";
  appState.auth.authenticated = true;
  appState.auth.has_calendar_scope = true;
  appState.config.user_name = "Alex Mercer";
  appState.config.user_email = "alex.mercer@university.edu";
  appState.config.last_gmail_sync = "2026-10-17 09:30";

  const dummyByCourse = {
    GSE211: { instructor: "Prof. Elena Rostova", room: "Hall B-204", group: "Sec 1" },
    CSE263: { instructor: "Dr. Marcus Vance", room: "Lab C-301", group: "Sec 2" },
    CSE261: { instructor: "Prof. Claire Sterling", room: "Hall A-110", group: "Sec 1" },
    CSE252: { instructor: "Dr. David Chen", room: "Embedded Lab 102", group: "Sec 2" },
    CSE241: { instructor: "Prof. Arthur Pendelton", room: "Room D-205", group: "Sec 1" },
    CSE262: { instructor: "Dr. Sarah Jenkins", room: "Hall C-115", group: "Sec 1" },
  };

  const scrubText = (txt) => {
    if (!txt) return txt;
    return txt
      .replace(/C212 O/g, "Hall B-204")
      .replace(/C203 O/g, "Lab C-301")
      .replace(/D202 O/g, "Hall A-110")
      .replace(/D114 O/g, "Hall A-110")
      .replace(/L102 O/g, "Embedded Lab 102")
      .replace(/Group [A-Z]/g, "Sec 1");
  };

  const scrubAssessment = (a) => {
    if (!a) return;
    const d = dummyByCourse[a.course_id] || {
      instructor: "Prof. Elena Rostova",
      room: "Hall B-204",
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

    // Mark a couple of sample topics completed in demo mode so readiness progress bar looks realistic
    const recs = appState.dashboard.study_recommendations || [];
    if (recs[0]?.topics?.[0]) {
      recs[0].topics[0].completed = true;
      if (!appState.config.completed_topics) appState.config.completed_topics = {};
      appState.config.completed_topics[recs[0].topics[0].key] = true;
      recs[0].progress_percent = Math.round((1 / recs[0].topics.length) * 100);
    }
    if (recs[1]?.topics?.[0]) {
      recs[1].topics[0].completed = true;
      appState.config.completed_topics[recs[1].topics[0].key] = true;
      recs[1].progress_percent = Math.round((1 / recs[1].topics.length) * 100);
    }
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

function updateTopBarAndUser() {
  const email = appState.auth?.email || appState.config?.user_email || "Not signed in";
  const name = appState.auth?.name || appState.config?.user_name || "Connect Google Account";
  const initial = (name && name[0] ? name[0] : "G").toUpperCase();

  const nameEl = document.getElementById("user-name-label");
  const emailEl = document.getElementById("user-email-label");
  const avatarEl = document.getElementById("user-avatar-badge");
  const kpiSyncEl = document.getElementById("kpi-sync-account");

  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = email;
  if (avatarEl) avatarEl.textContent = initial;
  if (kpiSyncEl) kpiSyncEl.textContent = email;

  const lastSync = appState.config?.last_gmail_sync || "2026-10-17 19:35";
  const syncTsEl = document.getElementById("last-sync-timestamp");
  if (syncTsEl) syncTsEl.textContent = `Last scanned: ${lastSync}`;

  const badgeText = appState.auth?.authenticated ? "Connected" : "Sign-In Recommended";
  const badgeClass = appState.auth?.authenticated
    ? "text-xs font-semibold px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300"
    : "text-xs font-semibold px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300";

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
    obBadge.textContent = badgeText;
    obBadge.className = badgeClass;
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

  renderOnboardingPreview();
  renderOnboardingCourses();
  renderSettingsCourses();
  updateOnboardingThemeButtons();
}

function switchMainView(view) {
  currentMainView = view;
  const dashEl = document.getElementById("view-dashboard");
  const calEl = document.getElementById("view-calendar");
  const btnDash = document.getElementById("tab-btn-dashboard");
  const btnCal = document.getElementById("tab-btn-calendar");
  const topControls = document.getElementById("calendar-top-controls");

  if (view === "dashboard") {
    dashEl.classList.remove("hidden");
    dashEl.classList.remove("view-transition");
    void dashEl.offsetWidth;
    dashEl.classList.add("view-transition");

    calEl.classList.add("hidden");
    btnDash.className =
      "flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition bg-white dark:bg-slate-900 text-[#1a73e8] dark:text-blue-400 shadow-2xs cursor-pointer";
    btnCal.className =
      "flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer";
    topControls.classList.add("hidden");
    topControls.classList.remove("flex");
    renderDashboard();
  } else {
    dashEl.classList.add("hidden");
    calEl.classList.remove("hidden");
    calEl.classList.remove("view-transition");
    void calEl.offsetWidth;
    calEl.classList.add("view-transition");

    btnCal.className =
      "flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition bg-white dark:bg-slate-900 text-[#1a73e8] dark:text-blue-400 shadow-2xs cursor-pointer";
    btnDash.className =
      "flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer";
    topControls.classList.remove("hidden");
    topControls.classList.add("flex");
    renderWeekCalendar();
  }
  if (window.lucide) lucide.createIcons();
}

// ============================================================================
// DASHBOARD VIEW RENDERING
// ============================================================================

function renderDashboard() {
  const dash = appState.dashboard || {};
  const nextUp = dash.next_up;

  // 1. Hero Spotlight: What's Coming Next (No bottom warning pill per Picture 3; clean layout)
  const heroEl = document.getElementById("dashboard-next-up-hero");
  if (nextUp) {
    const countdownLabel =
      nextUp.days_until === 0
        ? "Today"
        : nextUp.days_until === 1
        ? "Tomorrow morning"
        : `In ${nextUp.days_until} days`;

    heroEl.innerHTML = `
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        <div class="space-y-3 max-w-3xl">
          <div class="flex flex-wrap items-center gap-2">
            <span class="px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950 text-xs font-bold tabular-nums flex items-center gap-1.5 shadow-2xs">
              <i data-lucide="zap" class="w-3.5 h-3.5"></i>
              <span>Up next · ${countdownLabel}</span>
            </span>
            <span class="px-2.5 py-0.5 rounded-full bg-white/20 text-white text-xs font-semibold">
              ${escapeHtml(nextUp.course_id)} · ${escapeHtml(nextUp.assessment_type)}
            </span>
            <span class="px-2.5 py-0.5 rounded-full bg-emerald-400/20 text-emerald-100 border border-emerald-300/30 text-xs font-medium flex items-center gap-1">
              <i data-lucide="map-pin" class="w-3 h-3"></i>
              <span>Room ${escapeHtml(nextUp.room)} (${escapeHtml(nextUp.group)})</span>
            </span>
          </div>

          <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">
            ${escapeHtml(nextUp.title)} — <span class="font-normal text-blue-100">${escapeHtml(nextUp.course_name)}</span>
          </h1>

          <div class="flex flex-wrap items-center gap-4 text-xs text-blue-100 tabular-nums">
            <span class="flex items-center gap-1.5 font-medium">
              <i data-lucide="calendar" class="w-4 h-4"></i>
              <span>${escapeHtml(nextUp.display_time)}</span>
            </span>
            <span class="flex items-center gap-1.5">
              <i data-lucide="user-check" class="w-4 h-4"></i>
              <span>${escapeHtml(nextUp.instructor)}</span>
            </span>
          </div>

          <!-- Gemini Inference Pill -->
          <div class="bg-slate-900/35 border border-white/15 rounded-xl p-3.5 text-xs text-blue-50 flex items-start gap-2.5 max-w-[68ch]">
            <i data-lucide="sparkles" class="w-4 h-4 text-amber-300 shrink-0 mt-0.5"></i>
            <div class="leading-relaxed">
              <div class="font-semibold text-white">${escapeHtml(nextUp.ai_inference_note)}</div>
              <div class="text-blue-100 mt-1"><span class="font-semibold text-white">Study focus:</span> ${escapeHtml(nextUp.ai_study_plan)}</div>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap sm:flex-nowrap lg:flex-col gap-2.5 shrink-0">
          <button onclick="jumpToAssessmentOnCalendar('${nextUp.id}')" class="px-4 py-2.5 rounded-xl bg-white text-[#1a73e8] hover:bg-blue-50 active:scale-[0.98] text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-xs">
            <i data-lucide="calendar-days" class="w-4 h-4"></i>
            <span>View on Week Calendar</span>
          </button>
          <a href="${nextUp.google_cal_url}" target="_blank" class="px-4 py-2.5 rounded-xl bg-blue-500/30 hover:bg-blue-500/45 border border-white/25 text-white text-xs font-semibold transition flex items-center justify-center gap-2">
            <i data-lucide="calendar-plus" class="w-4 h-4"></i>
            <span>Sync to Google Calendar</span>
          </a>
          <button onclick="openAssessmentModalById('${nextUp.id}')" class="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition flex items-center justify-center gap-1.5 cursor-pointer">
            <span>Open Full Study Window</span>
          </button>
        </div>
      </div>
    `;
  } else {
    heroEl.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xl font-bold">No Upcoming Quizzes Scheduled</h2>
          <p class="text-xs text-blue-100 mt-1">Select "Sync Gmail & Calendar" in the top bar to scan your inbox with Gemini AI.</p>
        </div>
      </div>
    `;
  }

  // 2. KPI Cards
  const weekCount = (dash.upcoming_this_week || []).length;
  document.getElementById("kpi-week-count").textContent = weekCount;
  document.getElementById("kpi-week-subtext").textContent =
    weekCount > 0
      ? "Sun 18 Oct – Thu 22 Oct 2026"
      : "No quizzes in the next 7 days";

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
            <button onclick="filterDashboardByType('${escapeHtml(t)}')" class="px-2.5 py-1 rounded-lg text-xs font-semibold border transition flex items-center gap-1.5 cursor-pointer ${
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

  // 3. "What Should I Study?" Study Recommendations List
  // Entire card is clickable (Picture 4 feedback), no "View Full Details..." text link, and each quiz's rules are shown directly on its card
  const recsEl = document.getElementById("study-recommendations-list");
  let recs = dash.study_recommendations || [];
  if (globalSearchQuery) {
    const q = globalSearchQuery.toLowerCase();
    recs = recs.filter(
      (r) =>
        r.course_id.toLowerCase().includes(q) ||
        r.course_name.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.topics.some((t) => t.topic.toLowerCase().includes(q))
    );
  }

  if (recs.length === 0) {
    recsEl.innerHTML = `
      <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
        <div class="text-sm font-bold text-slate-800 dark:text-slate-100">No study plans match "${escapeHtml(globalSearchQuery)}"</div>
        <p class="text-xs text-slate-500 dark:text-slate-400">Clear your search filter to view all upcoming Fall 2026 assessments.</p>
        <button onclick="clearGlobalSearch()" class="mt-2 px-3.5 py-1.5 rounded-lg bg-[#1a73e8] text-white text-xs font-semibold cursor-pointer">Clear search filter</button>
      </div>
    `;
  } else {
    recsEl.innerHTML = recs
      .map((rec, idx) => {
        const badgeColor =
          rec.days_until <= 1
            ? "bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/60"
            : rec.days_until <= 4
            ? "bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60"
            : "bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800/60";

        const topicsChecklistHtml = (rec.topics || [])
          .map(
            (item) => `
            <label onclick="event.stopPropagation()" class="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/70 cursor-pointer transition border border-transparent hover:border-slate-200 dark:hover:border-slate-700">
              <input type="checkbox" data-topic-key="${escapeHtml(item.key)}" ${item.completed ? "checked" : ""} onchange="toggleTopicCheckbox('${escapeHtml(item.key)}', this.checked)" class="mt-0.5 w-4 h-4 accent-[#1a73e8] rounded cursor-pointer shrink-0" />
              <span data-topic-label="${escapeHtml(item.key)}" class="text-xs transition-colors ${item.completed ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-100 font-medium"}">${escapeHtml(item.topic)}</span>
            </label>
          `
          )
          .join("");

        const uniqueWarnings = [...new Set(rec.warnings || [])];
        const warnChips = uniqueWarnings
          .map(
            (w) =>
              `<div class="flex items-start gap-2 text-[11px] font-medium text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 px-3 py-1.5 rounded-lg">
                <i data-lucide="alert-circle" class="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"></i>
                <span>${escapeHtml(stripLeadingEmoji(w))}</span>
              </div>`
          )
          .join("");

        const matchingAssessment = (appState.assessments || []).find((a) => a.id === rec.assessment_id);
        const roomLabel = rec.room || matchingAssessment?.room || "";

        return `
          <div onclick="openAssessmentModalById('${rec.assessment_id}')" class="interactive-card bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-[#1a73e8] dark:hover:border-blue-500 cursor-pointer overflow-hidden group">
            <div class="h-1.5" style="background-color: ${rec.color}"></div>
            <div class="p-4 sm:p-5 space-y-3.5">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div class="flex flex-wrap items-center gap-1.5 mb-1.5">
                    <span class="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-md bg-slate-900 dark:bg-slate-800 text-white">Priority #${idx + 1}</span>
                    <span class="text-[11px] font-bold px-2 py-0.5 rounded-md text-white" style="background-color: ${rec.color}">${escapeHtml(rec.course_id)}</span>
                    <span class="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">${escapeHtml(rec.assessment_type)}</span>
                    <span class="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-md border ${badgeColor}">${escapeHtml(rec.urgency_badge)}</span>
                  </div>
                  <h4 class="text-base font-bold text-slate-900 dark:text-white group-hover:text-[#1a73e8] dark:group-hover:text-blue-400 transition">${escapeHtml(rec.title)} — <span class="font-normal text-slate-500 dark:text-slate-400 text-sm">${escapeHtml(rec.course_name)}</span></h4>
                  <div class="text-xs tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">${escapeHtml(rec.display_time)}${roomLabel ? ` · Room ${escapeHtml(roomLabel)}` : ""}</div>
                </div>

                <div class="text-right tabular-nums shrink-0">
                  <div data-rec-pct-label="${rec.assessment_id}" class="text-xs font-bold text-slate-900 dark:text-white">${rec.progress_percent}% Ready</div>
                  <div class="w-24 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mt-1">
                    <div data-rec-pct-bar="${rec.assessment_id}" class="h-full bg-emerald-500 transition-all duration-300" style="width: ${rec.progress_percent}%"></div>
                  </div>
                </div>
              </div>

              <!-- AI Study Recommendation Box -->
              <div class="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/60 rounded-xl p-3 text-xs space-y-1 max-w-[68ch]">
                <div class="font-bold text-[#1a73e8] dark:text-blue-400 flex items-center gap-1.5">
                  <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
                  <span>${escapeHtml(rec.why_study_now)}</span>
                </div>
                <p class="text-slate-700 dark:text-slate-300 leading-relaxed">${escapeHtml(rec.ai_study_plan)}</p>
              </div>

              <!-- Interactive Topics Checklist -->
              <div>
                <div class="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Topics to study (click to check off)</div>
                <div class="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl p-1">
                  ${topicsChecklistHtml}
                </div>
              </div>

              <!-- Specific Exam Rules attached directly to this Quiz/Exam -->
              ${
                warnChips
                  ? `<div class="space-y-1.5">
                       <div class="text-xs font-semibold text-amber-700 dark:text-amber-400">Exam rules & instructions</div>
                       ${warnChips}
                     </div>`
                  : ""
              }

              <div class="flex items-center justify-between pt-1 text-xs">
                <button onclick="event.stopPropagation(); jumpToAssessmentOnCalendar('${rec.assessment_id}')" class="text-[#1a73e8] dark:text-blue-400 hover:underline font-semibold flex items-center gap-1.5 cursor-pointer">
                  <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
                  <span>Show on Week Calendar</span>
                </button>
                <span class="text-[11px] font-medium text-slate-400 dark:text-slate-500 group-hover:text-[#1a73e8] dark:group-hover:text-blue-400 transition flex items-center gap-1">
                  <span>Click card for details</span>
                  <i data-lucide="arrow-up-right" class="w-3.5 h-3.5"></i>
                </span>
              </div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  // 4. Right Column: Filterable Assessments Timeline (Each card includes its own exam rules)
  let timelineItems = appState.assessments || [];
  if (currentFilterVal === "UPCOMING") {
    timelineItems = timelineItems.filter((a) => a.is_upcoming);
  } else if (currentFilterVal !== "ALL") {
    timelineItems = timelineItems.filter((a) => a.assessment_type === currentFilterVal);
  }
  if (globalSearchQuery) {
    const q = globalSearchQuery.toLowerCase();
    timelineItems = timelineItems.filter(
      (a) =>
        a.course_id.toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q) ||
        a.assessment_type.toLowerCase().includes(q)
    );
  }

  const timelineEl = document.getElementById("dashboard-timeline-list");
  if (timelineItems.length === 0) {
    timelineEl.innerHTML = `
      <div class="p-6 text-center rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
        <div class="text-xs font-semibold text-slate-700 dark:text-slate-200">No assessments match this filter</div>
        <button onclick="filterDashboardByType('ALL')" class="text-xs font-semibold text-[#1a73e8] dark:text-blue-400 hover:underline cursor-pointer">Show all semesters</button>
      </div>
    `;
  } else {
    timelineEl.innerHTML = timelineItems
      .map((a) => {
        const uniqueRules = [...new Set(a.warnings || [])];
        const rulesHtml = uniqueRules
          .map(
            (w) =>
              `<div class="flex items-start gap-1.5 text-[11px] text-amber-900 dark:text-amber-200 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 px-2.5 py-1 rounded-md">
                <i data-lucide="alert-circle" class="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"></i>
                <span>${escapeHtml(stripLeadingEmoji(w))}</span>
              </div>`
          )
          .join("");

        return `
          <div onclick="openAssessmentModalById('${a.id}')" class="interactive-card p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-[#1a73e8] dark:hover:border-blue-500 bg-slate-50/60 dark:bg-slate-800/40 hover:bg-white dark:hover:bg-slate-800 cursor-pointer transition space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <span class="px-2 py-0.5 rounded-md text-[10px] font-bold text-white" style="background-color: ${a.color}">${escapeHtml(a.course_id)}</span>
                <span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200">${escapeHtml(a.assessment_type)}</span>
              </div>
              <span class="text-[10px] font-bold tabular-nums ${
                a.is_upcoming
                  ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800"
                  : "text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800"
              } px-2 py-0.5 rounded-full">
                ${a.is_upcoming ? (a.days_until === 0 ? "Today" : a.days_until === 1 ? "Tomorrow" : `In ${a.days_until}d`) : a.semester}
              </span>
            </div>
            <div class="text-xs font-bold text-slate-900 dark:text-white">${escapeHtml(a.title)}</div>
            <div class="flex items-center justify-between text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              <span class="flex items-center gap-1">
                <i data-lucide="calendar" class="w-3 h-3"></i>
                <span>${escapeHtml(a.date_iso)} · ${escapeHtml(a.start_time)}–${escapeHtml(a.end_time)}</span>
              </span>
              <span class="flex items-center gap-1">
                <i data-lucide="map-pin" class="w-3 h-3"></i>
                <span>${escapeHtml(a.room)}</span>
              </span>
            </div>
            ${rulesHtml ? `<div class="space-y-1 pt-1">${rulesHtml}</div>` : ""}
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
    select.value = examType;
    renderDashboard();
  }
}

// Optimistic zero-latency topic toggle: updates checkboxes, recommendation progress bars, KPI bar, and modal progress in 0ms without scroll jump
async function toggleTopicCheckbox(key, completed) {
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
      const hasExamOnDay = (appState.assessments || []).some((a) => a.date_iso === iso);

      let btnClass = "w-6 h-6 mx-auto rounded-full flex items-center justify-center text-[11px] tabular-nums transition relative cursor-pointer ";
      if (isSelectedDay) {
        btnClass += "bg-[#1a73e8] text-white font-bold";
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
          (ex) => `
          <div onclick="openAssessmentModalById('${ex.id}')" class="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-[#1a73e8] dark:hover:border-blue-400 cursor-pointer transition text-[11px]">
            <div class="flex items-center justify-between font-bold text-slate-900 dark:text-slate-100">
              <span class="flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full" style="background-color: ${ex.color}"></span>
                <span>${escapeHtml(ex.course_id)}</span>
              </span>
              <span class="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">${escapeHtml(ex.day_name.slice(0, 3))} ${escapeHtml(ex.start_time)}</span>
            </div>
            <div class="text-slate-700 dark:text-slate-300 truncate mt-0.5">${escapeHtml(ex.title)}</div>
            <div class="text-[10px] text-slate-500 dark:text-slate-400">Room ${escapeHtml(ex.room)}</div>
          </div>
        `
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
        <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleCourseFilter('${c.id}', this.checked)" class="w-4 h-4 rounded" style="accent-color: ${c.color}" />
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

  // 1. Render 7 Day Headers (Sun 18 .. Sat 24)
  let headerHtml = "";
  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekStart);
    d.setDate(currentWeekStart.getDate() + i);
    weekDates.push(d);
    const iso = toIsoDate(d);
    const isHighlighted = sameDate(d, selectedCalendarDate);
    const dayExams = (appState.assessments || []).filter(
      (a) => a.date_iso === iso && activeCourseFilters.has(a.course_id)
    );

    headerHtml += `
      <div onclick="selectDateInMiniCal(${d.getFullYear()}, ${d.getMonth()}, ${d.getDate()})" class="border-r border-slate-200 dark:border-slate-800 py-2.5 px-2 text-center cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition">
        <div class="text-xs font-semibold ${isHighlighted ? "text-[#1a73e8] dark:text-blue-400" : "text-slate-500 dark:text-slate-400"}">
          ${DAY_ABBR[i]}
        </div>
        <div class="mt-1 w-9 h-9 mx-auto rounded-full flex items-center justify-center text-lg tabular-nums ${
          isHighlighted
            ? "bg-[#1a73e8] text-white font-semibold shadow-2xs"
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
                  <div onclick="event.stopPropagation(); openAssessmentModalById('${ex.id}')" class="text-[10px] font-bold px-1.5 py-0.5 rounded-md truncate text-white hover:opacity-90 transition" style="background-color: ${ex.color}">
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
        <span class="text-[10px] tabular-nums text-slate-400 dark:text-slate-500 -top-2 relative">${label}</span>
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
  for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
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
          <div onclick="openAssessmentModalById('${exam.id}')"
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
          <div onclick="openSlotPopover('${slot.id}', '${colIso}')"
               class="gcal-card"
               style="top: ${topPx}px; height: ${heightPx}px; ${horizStyle} --card-bg-light: ${bgLight}; --card-bg-dark: ${bgDark}; border-color: ${borderHex};">
            <div class="text-[11px] font-bold truncate flex items-center gap-1.5 text-slate-900 dark:text-slate-50">
              <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${borderHex}"></span>
              <span class="truncate">${escapeHtml(slot.course_id)} · ${escapeHtml(slot.course_name)}</span>
            </div>
            <div class="text-[10px] truncate text-slate-700 dark:text-slate-300">
              ${escapeHtml(slot.slot_type)} (Grp ${escapeHtml(slot.group)}) · Room ${escapeHtml(slot.room)}
            </div>
            <div class="text-[10px] tabular-nums text-slate-600 dark:text-slate-400">
              ${formatCompactTime(slot.start_time)} – ${formatCompactTime(slot.end_time)}
            </div>
          </div>
        `;
      } else if (item.kind === "standalone_exam") {
        const { exam } = item;
        blocksHtml += `
          <div onclick="openAssessmentModalById('${exam.id}')"
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
              <span class="text-[11px] font-bold truncate text-slate-900 dark:text-slate-50">${escapeHtml(ev.title)}</span>
              <button onclick="deleteCustomEvent('${ev.id}')" class="text-[10px] hover:underline cursor-pointer">✕</button>
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
  currentWeekStart = new Date(2026, 9, 18);
  selectedCalendarDate = new Date(2026, 9, 18);
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
  if (!target) return;
  const [y, m, d] = target.date_iso.split("-").map(Number);
  selectDateInMiniCal(y, m - 1, d);
}

function jumpFromModalToCalendar() {
  const targetId = activeModalAssessmentId;
  const targetDateIso = activeModalDateIso;
  closeEventDetailModal();
  if (targetId) {
    jumpToAssessmentOnCalendar(targetId);
  } else if (targetDateIso) {
    const [y, m, d] = targetDateIso.split("-").map(Number);
    selectDateInMiniCal(y, m - 1, d);
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
  document.getElementById("modal-room").textContent = `Room ${a.room} (${a.group})`;
  document.getElementById("modal-instructor").textContent = a.instructor;
  document.getElementById("modal-ai-inference").textContent = a.ai_inference_note;
  document.getElementById("modal-ai-study-plan").textContent = `Study Strategy: ${a.ai_study_plan}`;

  const topicsEl = document.getElementById("modal-topics-list");
  topicsEl.innerHTML = (a.topics || [])
    .map((t, idx) => {
      const key = `${a.id}::${idx}`;
      const done = !!(appState.config?.completed_topics && appState.config.completed_topics[key]);
      return `
        <label class="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-xs transition">
          <input type="checkbox" data-topic-key="${escapeHtml(key)}" ${done ? "checked" : ""} onchange="toggleTopicCheckbox('${escapeHtml(key)}', this.checked)" class="mt-0.5 w-4 h-4 accent-[#1a73e8] rounded shrink-0 cursor-pointer" />
          <span data-topic-label="${escapeHtml(key)}" class="transition-colors ${done ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-100 font-medium"}">${escapeHtml(t)}</span>
        </label>
      `;
    })
    .join("");

  updateModalTopicProgress(a.id);

  const warnSec = document.getElementById("modal-warnings-section");
  const warnList = document.getElementById("modal-warnings-list");
  const uniqueWarnings = [...new Set(a.warnings || [])];
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

  document.getElementById("modal-gcal-link").href = a.google_cal_url;
  document.getElementById("modal-ics-link").href = `/api/calendar/ics/${a.id}`;

  const courseLink = document.getElementById("modal-course-link");
  if (a.elearning_url) {
    courseLink.href = a.elearning_url;
    courseLink.classList.remove("hidden");
  } else {
    courseLink.classList.add("hidden");
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
  document.getElementById("modal-room").textContent = `Room ${slot.room} (Group ${slot.group})`;
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
            <input type="checkbox" data-topic-key="${escapeHtml(key)}" ${done ? "checked" : ""} onchange="toggleTopicCheckbox('${escapeHtml(key)}', this.checked)" class="mt-0.5 w-4 h-4 accent-[#1a73e8] rounded shrink-0 cursor-pointer" />
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

function openOnboardingModal(initialStep = 1) {
  renderOnboardingPreview();
  renderOnboardingCourses();
  updateOnboardingThemeButtons();
  setOnboardingStep(initialStep);
  document.getElementById("onboarding-modal")?.classList.add("is-open");
  if (window.lucide) lucide.createIcons();
}

function closeOnboardingModal() {
  document.getElementById("onboarding-modal")?.classList.remove("is-open");
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
        ? "flex items-center gap-2.5 p-2.5 rounded-xl bg-white text-[#1a73e8] font-bold text-xs transition text-left cursor-pointer shadow-xs"
        : "flex items-center gap-2.5 p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition text-left cursor-pointer";
    }
    if (num) {
      num.className = isActive
        ? "w-6 h-6 rounded-full bg-[#1a73e8] text-white text-xs font-bold tabular-nums flex items-center justify-center shrink-0"
        : "w-6 h-6 rounded-full bg-white/20 text-white text-xs font-bold tabular-nums flex items-center justify-center shrink-0";
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
      nextLabel.textContent = "Continue to Inbox Scan";
    } else if (currentOnboardingStep === 2) {
      nextLabel.textContent = "Continue to Courses & Sync";
    } else {
      nextLabel.textContent = "Launch My Dashboard";
    }
  }
  if (window.lucide) lucide.createIcons();
}

function nextOnboardingStep() {
  if (currentOnboardingStep < 3) {
    setOnboardingStep(currentOnboardingStep + 1);
  } else {
    finishOnboarding();
  }
}

function prevOnboardingStep() {
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
    container.innerHTML = `<div class="text-xs text-slate-500 dark:text-slate-400">Click "Scan Inbox Now" to detect quizzes and exams.</div>`;
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
              ${escapeHtml(a.date_iso)} · ${escapeHtml(a.start_time)} (Room ${escapeHtml(a.room)})
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

function renderOnboardingCourses() {
  const grid = document.getElementById("onboard-courses-grid");
  if (!grid) return;
  const courses = appState.schedule?.courses || [];
  grid.innerHTML = courses
    .map((c) => {
      const checked = activeCourseFilters.has(c.id);
      return `
        <label class="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 hover:border-[#1a73e8] dark:hover:border-blue-500 cursor-pointer transition text-xs">
          <div class="flex items-center gap-2.5 min-w-0">
            <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleCourseFilter('${c.id}', this.checked)" class="w-4 h-4 rounded shrink-0 cursor-pointer" style="accent-color: ${c.color}" />
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold text-white shrink-0" style="background-color: ${c.color}">${escapeHtml(c.id)}</span>
            <span class="font-medium text-slate-800 dark:text-slate-200 truncate">${escapeHtml(c.name)}</span>
          </div>
        </label>
      `;
    })
    .join("");
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
  if (!grid) return;
  const courses = appState.schedule?.courses || [];
  grid.innerHTML = courses
    .map((c) => {
      const checked = activeCourseFilters.has(c.id);
      return `
        <label class="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 hover:border-[#1a73e8] dark:hover:border-blue-500 cursor-pointer transition text-xs">
          <div class="flex items-center gap-2.5 min-w-0">
            <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleCourseFilter('${c.id}', this.checked)" class="w-4 h-4 rounded shrink-0 cursor-pointer" style="accent-color: ${c.color}" />
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold text-white shrink-0" style="background-color: ${c.color}">${escapeHtml(c.id)}</span>
            <span class="font-medium text-slate-800 dark:text-slate-200 truncate">${escapeHtml(c.name)}</span>
          </div>
        </label>
      `;
    })
    .join("");
}

function openSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.classList.add("flex", "is-open");

  const autoSyncEl = document.getElementById("settings-auto-gcal");
  const geminiToggleEl = document.getElementById("settings-gemini-toggle");
  const geminiKeyEl = document.getElementById("settings-gemini-key");

  if (autoSyncEl) autoSyncEl.checked = appState.config?.auto_sync_gcal ?? true;
  if (geminiToggleEl) geminiToggleEl.checked = appState.config?.gemini_enabled ?? true;
  if (geminiKeyEl && appState.config?.gemini_api_key) {
    geminiKeyEl.value = appState.config.gemini_api_key;
  }

  updateOnboardingThemeButtons();
  renderSettingsCourses();
  if (window.lucide) lucide.createIcons();
}

function closeSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
}

function reopenFirstTimeWizardFromSettings() {
  closeSettingsModal();
  openOnboardingModal(1);
}

async function saveSettingsModal() {
  const autoSync = document.getElementById("settings-auto-gcal")?.checked ?? true;
  const geminiEnabled = document.getElementById("settings-gemini-toggle")?.checked ?? true;
  const geminiKey = document.getElementById("settings-gemini-key")?.value || "";

  if (appState.config) {
    appState.config.auto_sync_gcal = autoSync;
    appState.config.gemini_enabled = geminiEnabled;
    if (geminiKey.trim()) appState.config.gemini_api_key = geminiKey.trim();
  }
  saveStateCache();

  closeSettingsModal();
  showToast("Settings saved!");

  try {
    const res = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auto_sync_gcal: autoSync,
        gemini_enabled: geminiEnabled,
        gemini_api_key: geminiKey,
      }),
    });
    const data = await res.json();
    if (data.assessments) appState.assessments = data.assessments;
    if (data.dashboard) appState.dashboard = data.dashboard;
    if (data.config) appState.config = data.config;
    saveStateCache();
    renderDashboard();
    renderWeekCalendar();
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

  updateStage(25, "Connecting to Gmail API & fetching university announcements...");
  await new Promise((r) => setTimeout(r, 220));
  updateStage(60, "Cross-referencing emails against 6 Fall 2026 courses & 14 weekly slots...");

  await triggerFullSync();

  const upcomingCount = (appState.assessments || []).filter((a) => a.is_upcoming).length;
  const totalCount = (appState.assessments || []).length;
  updateStage(100, `Scan complete — ${upcomingCount} upcoming assessments & ${totalCount} total records resolved!`);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>Scan Complete</span>`;
  }
  renderOnboardingPreview();
  if (window.lucide) lucide.createIcons();
}

// Instant response on "Save & Open My Dashboard": closes modal immediately in 0ms without blocking on network
async function finishOnboarding() {
  const autoSync = document.getElementById("onboard-auto-gcal")?.checked ?? true;
  const geminiEnabled = document.getElementById("onboard-gemini-toggle")?.checked ?? true;
  const geminiKey = document.getElementById("onboard-gemini-key")?.value || "";

  localStorage.setItem("quizradar_onboarding_done", "true");
  appState.config.onboarding_completed = true;
  saveStateCache();
  closeOnboardingModal();
  switchMainView("dashboard");
  showToast("Setup saved! Your Dashboard & Calendar are ready.");

  try {
    const res = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auto_sync_gcal: autoSync,
        gemini_enabled: geminiEnabled,
        gemini_api_key: geminiKey,
      }),
    });
    const data = await res.json();
    if (data.assessments) appState.assessments = data.assessments;
    if (data.dashboard) appState.dashboard = data.dashboard;
    if (data.config) appState.config = data.config;
    saveStateCache();
    renderDashboard();
    renderWeekCalendar();
  } catch (err) {
    console.error("Background onboarding save error:", err);
  }
}

async function triggerFullSync() {
  const btn = document.getElementById("top-sync-btn");
  const txt = document.getElementById("top-sync-text");
  if (txt) txt.textContent = "Scanning...";
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/sync", { method: "POST" });
    const data = await res.json();
    if (data.assessments) appState.assessments = data.assessments;
    if (data.dashboard) appState.dashboard = data.dashboard;
    if (data.config) appState.config = data.config;
    saveStateCache();

    updateTopBarAndUser();
    renderDashboard();
    renderWeekCalendar();
    showToast(data.message || "Synced Gmail & Google Calendar!");
  } catch (err) {
    showToast("Sync completed using local cache.");
  } finally {
    if (txt) txt.textContent = "Sync Gmail & Calendar";
    if (btn) btn.disabled = false;
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
    showToast(data.report?.message || "Synced upcoming exams to Google Calendar!");
  } catch (err) {
    console.error("GCal sync error:", err);
  }
}

function openCreateEventModal() {
  document.getElementById("create-event-modal")?.classList.add("is-open");
  setTimeout(() => {
    document.getElementById("create-ev-title")?.focus();
  }, 50);
}

function closeCreateEventModal() {
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

  try {
    const res = await fetch("/api/events/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, course_id, event_type, date_iso, start_time, end_time, room }),
    });
    const data = await res.json();
    if (data.success) {
      appState.config.custom_events = data.custom_events;
      saveStateCache();
      closeCreateEventModal();
      const [y, m, d] = date_iso.split("-").map(Number);
      selectDateInMiniCal(y, m - 1, d);
      showToast(`Added "${title}" to your Week Calendar!`);
    }
  } catch (err) {
    console.error("Failed to create custom event:", err);
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

function handleGlobalSearch(val) {
  globalSearchQuery = (val || "").trim();
  const desktopInput = document.getElementById("global-search-input");
  const mobileInput = document.getElementById("mobile-search-input");
  if (desktopInput && desktopInput.value !== val) desktopInput.value = val;
  if (mobileInput && mobileInput.value !== val) mobileInput.value = val;

  renderDashboard();
  renderWeekCalendar();
}

function clearGlobalSearch() {
  globalSearchQuery = "";
  const desktopInput = document.getElementById("global-search-input");
  const mobileInput = document.getElementById("mobile-search-input");
  if (desktopInput) desktopInput.value = "";
  if (mobileInput) mobileInput.value = "";
  renderDashboard();
  renderWeekCalendar();
}

function matchesGlobalSearch(...fields) {
  if (!globalSearchQuery) return true;
  const q = globalSearchQuery.toLowerCase();
  return fields.some((f) => (f || "").toLowerCase().includes(q));
}

function showToast(msg) {
  const toast = document.getElementById("toast-notification");
  const msgEl = document.getElementById("toast-message");
  if (!toast || !msgEl) return;
  msgEl.textContent = msg;
  toast.classList.add("toast-visible");
  if (toastHideTimeout) clearTimeout(toastHideTimeout);
  toastHideTimeout = setTimeout(() => {
    toast.classList.remove("toast-visible");
  }, 4200);
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

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
