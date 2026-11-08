import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Award,
  BarChart2,
  BookOpen,
  BrainCircuit,
  Calendar,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  GraduationCap,
  Link,
  Mail,
  Map as MapIcon,
  MapPin,
  Plus,
  RefreshCw,
  School,
  Search as SearchIcon,
  Sparkles,
  Timer,
  UserCheck,
  Users,
  X as XIcon,
  Zap,
} from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { ConflictBanner } from "../components/ConflictBanner";
import { StudyStatsCard } from "../components/StudyStatsCard";
import { CalendarGrid } from "../components/CalendarGrid";
import { DailyStudyRoadmap } from "../components/DailyStudyRoadmap";
import { TimelineHorizon } from "../components/TimelineHorizon";
import { useFeatureFlag, useFeatureFlagPayload } from "../lib/analytics";
import { assessmentKind } from "../lib/assessmentKind";
import { courseAccessibleChip, courseDisplayName, coursePalette } from "../lib/coursePalette";
import { matchesGlobalSearch } from "../lib/calendarLanes";
import { safeExternalUrl } from "../lib/safeUrl";
import { computeActiveSourceCount, formatLastSynced } from "../state/syncStatus";
import { formatIsoShortDate, parseIsoDate } from "../lib/weekRange";
import type { Assessment, StudyRecommendation } from "../state/types";

type MobileDashboardTab = "study" | "overview";

// ---------------------------------------------------------------------------
// v4 display helpers (v4-final:static/app.js::renderDashboard / formatCompactCardSchedule)
// ---------------------------------------------------------------------------

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** v4 `stripRoomPrefix`: renders "Room" once, never "Room Room 301". */
function stripRoomPrefix(room: string): string {
  return room.replace(/^Room\s+/i, "").trim();
}

/** v4 `formatCompactCardSchedule`: "Due 09:00" for same-time slots, "Oct 18"
 * dates, and the room appended when the display string does not carry it. */
function formatCompactCardSchedule(
  display: string | null | undefined,
  room?: string | null,
): string {
  if (!display) {
    return room
      ? copy.dashboard.roomLabel(stripRoomPrefix(room))
      : copy.dashboard.scheduleScheduled;
  }
  let cleaned = display.replace(/\((\d{1,2}:\d{2})\s*-\s*\1\)/, `Due $1`);
  cleaned = cleaned.replace(
    /(\d{4})-(\d{2})-(\d{2})/,
    (_match, _year: string, month: string, day: string) => {
      const monthName = MONTHS_SHORT[Number(month) - 1] ?? month;
      return `${monthName} ${Number(day)}`;
    },
  );
  if (room && !cleaned.toLowerCase().includes(room.toLowerCase())) {
    cleaned += ` · ${stripRoomPrefix(room)}`;
  }
  return cleaned;
}

/** v4's dashboard-row date format ("Sun, Oct 18"), fixed to en-US so the
 * visual baselines do not depend on the host locale. */
function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3) return iso;
  const date = new Date(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1);
  if (Number.isNaN(date.getTime())) return iso;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${weekdays[date.getDay()]}, ${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/** v4 `stripLeadingEmoji`: exam rules arrive with emoji bullets; the row
 * renders the text only. Code-point loop — regex character classes mislead
 * with variation selectors and ZWJ. */
function stripLeadingEmoji(text: string): string {
  let index = 0;
  while (index < text.length) {
    const code = text.codePointAt(index) ?? 0;
    const isEmojiOrJoiner =
      (code >= 0x1f000 && code <= 0x1faff) ||
      (code >= 0x2600 && code <= 0x27bf) ||
      code === 0xfe0f ||
      code === 0x200d ||
      code === 0x20e3;
    if (!isEmojiOrJoiner) break;
    index += code > 0xffff ? 2 : 1;
  }
  return text.slice(index).trim();
}

/** en-US range labels for the "Next 7 days" KPI (v4 `kpi-week-subtext`).
 *  Seven calendar days: today plus the next six - the same window the core
 *  counts, so the printed range and the number can never disagree. */
function weekRangeLabels(referenceDate: string | undefined): { start: string; end: string } {
  const base = parseIsoDate(referenceDate ?? "");
  const start = base && !Number.isNaN(base.getTime()) ? base : new Date();
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const startIso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(
    start.getDate(),
  ).padStart(2, "0")}`;
  const endIso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(
    end.getDate(),
  ).padStart(2, "0")}`;
  return {
    start: formatIsoShortDate(startIso, { weekday: true }),
    end: formatIsoShortDate(endIso, { weekday: true, year: true }),
  };
}

/** Source pill/icon lookup — the core's `source_icon` names, with the same
 * mapping for chips built from the source label. */
function SourceIcon({ name, className }: { name: string; className?: string }) {
  const props = { className, "aria-hidden": true } as const;
  switch (name) {
    case "graduation-cap":
      return <GraduationCap {...props} />;
    case "users":
      return <Users {...props} />;
    case "school":
      return <School {...props} />;
    case "calendar-plus":
      return <CalendarPlus {...props} />;
    case "calendar":
      return <Calendar {...props} />;
    default:
      return <Mail {...props} />;
  }
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/**
 * Remote Announcement Banner wired to PostHog feature flag `banner-announcement`.
 */
const RemoteAnnouncementBanner: React.FC = () => {
  const isEnabled = useFeatureFlag("banner-announcement", false);
  const payload = useFeatureFlagPayload<{ message?: string; active?: boolean }>(
    "banner-announcement",
  );
  const [dismissed, setDismissed] = useState(false);

  const message = payload?.message || (typeof payload === "string" ? payload : "");
  const isActive = payload?.active !== false;

  useEffect(() => {
    if (message) {
      const isDismissed = localStorage.getItem(`quizradar_dismissed_banner_${message}`) === "true";
      setDismissed(isDismissed);
    }
  }, [message]);

  if (!isEnabled || !isActive || !message || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem(`quizradar_dismissed_banner_${message}`, "true");
    setDismissed(true);
  };

  return (
    <div
      data-testid="remote-announcement-banner"
      className="flex items-center justify-between gap-3 rounded-xl border border-blue-200/80 bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-blue-500/10 p-3 text-xs text-slate-800 dark:border-blue-800/60 dark:text-blue-100"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Sparkles
          className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400"
          aria-hidden="true"
        />
        <span className="font-medium leading-snug">{message}</span>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss announcement"
        className="shrink-0 rounded-lg p-1 text-slate-500 hover:bg-black/5 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white transition"
      >
        <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};

export interface DashboardViewProps {
  forceWidescreen?: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ forceWidescreen }) => {
  const dash = useAppStore((s) => s.data.dashboard);
  const assessments = useAppStore((s) => s.data.assessments);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const config = useAppStore((s) => s.data.config);
  const auth = useAppStore((s) => s.data.auth);
  const selectedCourseIds = useAppStore((s) => s.selectedCourseIds);
  // The top-bar search is app-wide (spec §4.8): typing filters this dashboard
  // and the week calendar live.
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const toggleTopic = useAppStore((s) => s.toggleTopic);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);
  const setView = useAppStore((s) => s.setView);
  const triggerSync = useAppStore((s) => s.triggerSync);
  const runGcalSync = useAppStore((s) => s.runGcalSync);
  const openModal = useAppStore((s) => s.openModal);
  const openSettings = useAppStore((s) => s.openSettings);
  const openEventModal = useAppStore((s) => s.openEventModal);

  const [mobileTab, setMobileTab] = useState<MobileDashboardTab>("study");

  const [isWidescreen, setIsWidescreen] = useState(() => {
    if (forceWidescreen !== undefined) return forceWidescreen;
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(min-width: 1200px)").matches;
    }
    return false;
  });

  useEffect(() => {
    if (forceWidescreen !== undefined) {
      setIsWidescreen(forceWidescreen);
      return;
    }
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 1200px)");
    setIsWidescreen(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsWidescreen(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, [forceWidescreen]);

  // Course-layer filter (the sidebar's calendar checkboxes)
  const isCourseSelected = (courseId?: string | null) => {
    if (!courseId || selectedCourseIds === null) return true;
    return selectedCourseIds.includes(courseId);
  };

  const upcomingThisWeek = (dash.upcomingThisWeek || []).filter((a) =>
    isCourseSelected(a.courseId),
  );
  const weekCount = upcomingThisWeek.length;
  // The seven-day type breakdown, sorted by count then name so the pills do
  // not shuffle between renders.
  const typeBreakdown = Object.entries(dash.examTypeCounts || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // The "Exams ahead" KPI: midterm + final exams among the radar's upcoming
  // items, honouring the course filter like every other KPI on the row.
  const examsAheadCount = (dash.allUpcoming || []).filter(
    (a) => isCourseSelected(a.courseId) && assessmentKind(a.assessmentType) === "exam",
  ).length;

  const trimmedSearch = searchQuery.trim();
  const searchActive = trimmedSearch.length > 0;

  const filteredRecs = (dash.studyRecommendations || []).filter(
    (r) =>
      isCourseSelected(r.courseId) &&
      (!searchActive ||
        matchesGlobalSearch(
          searchQuery,
          r.title,
          r.courseName,
          r.courseId,
          r.assessmentType,
          r.whyStudyNow,
          r.topics?.map((t) => t.title).join(" "),
        )),
  );

  // v4 looks the rec card's room up from the matching assessment record.
  const roomByAssessment = new Map((assessments || []).map((a) => [a.id, a.room] as const));

  const weekLabels = weekRangeLabels(dash.referenceDate);
  // The KPI card is the only sync summary visible on the mobile/PWA tier
  // (the sidebar footer is desktop-only), so it carries the real numbers.
  const activeSourceCount = computeActiveSourceCount(config, auth);
  const lastSyncText = formatLastSynced(
    [config.lastGmailSync, config.lastGcalSync]
      .filter((stamp): stamp is string => Boolean(stamp && stamp.trim()))
      .sort((a, b) => b.localeCompare(a))[0],
  );
  // 0 tracked topics means no readiness number exists yet — never show 100%.
  const readinessPct = dash.totalTopicsCount === 0 ? null : (dash.readinessPercent ?? 100);
  const hasCourses = courses.length > 0;

  // Aggregate approaching assessments + custom exam/quiz events into the Timeline Horizon
  const allHorizonAssessments = useMemo(() => {
    const list = [...(dash.allUpcoming || [])];
    const existingIds = new Set(list.map((a) => a.id));

    for (const ev of config.customEvents || []) {
      if (!ev.dateIso || existingIds.has(ev.id)) continue;
      const type = (ev.eventType || "").toLowerCase();
      if (
        type.includes("exam") ||
        type.includes("quiz") ||
        type.includes("midterm") ||
        type.includes("final") ||
        type.includes("test")
      ) {
        const from = new Date((dash.referenceDate || "2026-10-29") + "T00:00:00Z");
        const to = new Date(ev.dateIso + "T00:00:00Z");
        const days = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
        if (days >= 0) {
          list.push({
            id: ev.id,
            courseId: ev.courseId,
            courseName: courses.find((c) => c.id === ev.courseId)?.name ?? null,
            title: ev.title,
            assessmentType: ev.eventType || "Exam",
            dateIso: ev.dateIso,
            startTime: ev.startTime,
            endTime: ev.endTime,
            displayTime: ev.startTime
              ? `${ev.startTime}${ev.endTime ? ` - ${ev.endTime}` : ""}`
              : null,
            room: ev.room,
            isUpcoming: true,
            daysUntil: days,
            urgencyLevel: days <= 1 ? "critical" : days <= 4 ? "high" : "upcoming",
            priorityScore: Math.max(10, 100 - days * 5),
            topics: [],
            warnings: [],
            source: "MANUAL",
            color: ev.color,
          });
        }
      }
    }
    return list;
  }, [dash.allUpcoming, config.customEvents, dash.referenceDate, courses]);

  // v4 hero spotlight: the next assessment, honouring the course filter.
  // Checks dash.nextUp, then upcoming this week, then allHorizonAssessments (unifying custom exams/quizzes).
  const nextUp =
    (dash.nextUp && isCourseSelected(dash.nextUp.courseId) ? dash.nextUp : null) ??
    upcomingThisWeek[0] ??
    allHorizonAssessments.find((a) => isCourseSelected(a.courseId)) ??
    (dash.allUpcoming || []).find((a) => isCourseSelected(a.courseId)) ??
    null;

  // Track scroll position for adaptive parallax canopy collapse
  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    const handleScroll = () => {
      const main = document.querySelector("main");
      const scrollY = main ? main.scrollTop : window.scrollY;
      setIsScrolled(scrollY > 50);
    };
    const main = document.querySelector("main");
    if (main) {
      main.addEventListener("scroll", handleScroll, { passive: true });
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      if (main) main.removeEventListener("scroll", handleScroll);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <div data-testid="dashboard-view" className="w-full relative space-y-6">
      {/* Sticky Observatory Canopy Hero Banner — Parallax Anchor */}
      <div className="sticky top-0 z-20 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 pt-1 pb-3 bg-[var(--page)]/90 backdrop-blur-md transition-all space-y-3">
        <RemoteAnnouncementBanner />
        <ConflictBanner />
        <NextUpHero
          assessment={nextUp}
          testId={isWidescreen ? "dashboard-next-up-hero-top" : "dashboard-next-up-hero"}
          isScrolled={isScrolled}
          onOpenDetail={() => nextUp && openAssessmentDetail(nextUp.id)}
          onOpenCalendar={() => setView("calendar")}
          onConnect={() => openSettings("account")}
          onSync={() => void triggerSync()}
        />
      </div>

      {/* Mobile Segmented Sub-Navigation Switcher (< 1024px) */}
      <nav aria-label="Dashboard sections" className="lg:hidden">
        <div
          role="tablist"
          className="flex items-center gap-1 rounded-xl border border-slate-200/80 bg-slate-100 p-1 text-xs font-semibold dark:border-slate-700/80 dark:bg-slate-800/80"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "study"}
            onClick={() => setMobileTab("study")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 transition ${
              mobileTab === "study"
                ? "bg-white font-bold text-[#1557b0] shadow-2xs dark:bg-slate-900 dark:text-blue-300"
                : "cursor-pointer text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            }`}
          >
            <BrainCircuit className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.dashboard.subtabs.study}</span>
            {filteredRecs.length > 0 && (
              <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-blue-800 dark:bg-blue-900/70 dark:text-blue-200">
                {filteredRecs.length}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "overview"}
            onClick={() => setMobileTab("overview")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 transition ${
              mobileTab === "overview"
                ? "bg-white font-bold text-[#1557b0] shadow-2xs dark:bg-slate-900 dark:text-blue-300"
                : "cursor-pointer text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            }`}
          >
            <BarChart2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.dashboard.subtabs.overview}</span>
          </button>
        </div>
      </nav>

      {/* Astronomical Timeline Horizon (Replaces the 4 generic SaaS KPI cards) */}
      <section className={mobileTab === "overview" ? "block" : "hidden lg:block"}>
        <TimelineHorizon
          assessments={allHorizonAssessments}
          recommendations={dash.studyRecommendations || []}
          conflictAlerts={dash.conflictAlerts || []}
          weekCount={weekCount}
          examsAheadCount={examsAheadCount}
          readinessPct={readinessPct}
          totalTopicsCount={dash.totalTopicsCount}
          completedTopicsCount={dash.completedTopicsCount}
          typeBreakdown={typeBreakdown}
          auth={auth}
          config={config}
          activeSourceCount={activeSourceCount}
          lastSyncText={lastSyncText}
          weekRangeLabel={copy.dashboard.kpiWeekRange(weekLabels.start, weekLabels.end)}
          onOpenDetail={openAssessmentDetail}
          onRunGcalSync={runGcalSync}
          onOpenConnect={() => openSettings("account")}
          onOpenAddCourse={() => openModal("add-course")}
        />
      </section>

      {/* Local-First Personal Study Stats Card */}
      <section
        data-testid="dashboard-study-stats-section"
        className={mobileTab === "overview" ? "block" : "hidden lg:block"}
      >
        <StudyStatsCard />
      </section>

      {/* The top-bar search filters both panels below (spec §4.8). The banner
          says so explicitly - a silently filtered list reads as "that is all
          there is". */}
      {searchActive && (
        <div
          data-testid="dashboard-search-banner"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-blue-900 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-100"
        >
          <SearchIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="font-semibold">{copy.dashboard.searchFilterActive(trimmedSearch)}</span>
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="ml-auto cursor-pointer rounded-lg border border-blue-300 px-2 py-1 text-[11px] font-semibold text-blue-900 transition hover:bg-blue-100 dark:border-blue-800 dark:text-blue-100 dark:hover:bg-blue-900/60"
          >
            {copy.dashboard.searchClear}
          </button>
        </div>
      )}

      {/* Main Dashboard Grid: Standard <1200px Layout */}
      {!isWidescreen && (
        <section className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12 lg:gap-6 relative z-10">
          {/* Full-Width Study Planner Canvas */}
          <div
            data-testid="dashboard-study-panel"
            className="flex flex-col rounded-xl border border-slate-200 bg-white p-3 sm:p-5 lg:col-span-12 lg:min-h-[500px] dark:border-slate-800 dark:bg-slate-900 shadow-xs"
          >
            <div className="flex shrink-0 flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 sm:text-base dark:text-white">
                  <BrainCircuit
                    className="h-4 w-4 shrink-0 text-[var(--accent-ink)]"
                    aria-hidden="true"
                  />
                  <span>{copy.dashboard.recommendationsTitle}</span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                  Personalized study blocks and topic readiness derived from your course timetable.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setView("tasks")}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-ink)] hover:bg-[var(--surface-hover)] hover:border-[var(--accent)] transition"
                >
                  <span>View All Assessments & Ledger in Tasks</span>
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="max-h-[640px] flex-1 space-y-2.5 overflow-y-auto pr-1.5 pt-3 sm:space-y-3 lg:max-h-none">
              {hasCourses ? (
                filteredRecs.length === 0 ? (
                  searchActive ? (
                    // Not "all caught up": the search hid the plans, the plans
                    // are still pending.
                    <SearchNoMatchesEmpty
                      title={copy.dashboard.studyEmptySearchTitle}
                      body={copy.dashboard.studyEmptySearchBody(trimmedSearch)}
                      onClear={() => setSearchQuery("")}
                    />
                  ) : (
                    <AllClearEmpty onCreateEvent={() => openEventModal()} />
                  )
                ) : (
                  filteredRecs.map((rec, index) => (
                    <StudyRecommendationCard
                      key={rec.assessmentId}
                      index={index + 1}
                      recommendation={rec}
                      room={roomByAssessment.get(rec.assessmentId)}
                      onToggleTopic={(topicIdx) => toggleTopic(rec.assessmentId, topicIdx)}
                      onOpenDetail={() => openAssessmentDetail(rec.assessmentId)}
                    />
                  ))
                )
              ) : (
                <FirstRunEmpty
                  onAddCourse={() => openModal("add-course")}
                  onConnect={() => openSettings("account")}
                />
              )}
            </div>
          </div>
        </section>
      )}

      {/* Multi-Pane Widescreen Density (≥1200px) */}
      {isWidescreen && (
        <section
          data-testid="dashboard-widescreen-split"
          className="grid grid-cols-12 gap-6 items-start relative z-10"
        >
          {/* Left Pane (~58% width / col-span-7): Embedded Weekly Class Schedule & Calendar Grid */}
          <div
            data-testid="dashboard-widescreen-left-pane"
            className="col-span-7 flex flex-col rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 shadow-xs"
          >
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Weekly Class Schedule &amp; Timetable
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setView("calendar")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-ink)] hover:underline cursor-pointer"
              >
                <span>Full Calendar View</span>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[700px] pr-1">
              <CalendarGrid compactMode />
            </div>
          </div>

          {/* Right Pane (~42% width / col-span-5): Upcoming Assessments Radar & Daily Study Roadmap */}
          <div
            data-testid="dashboard-widescreen-right-pane"
            className="col-span-5 flex flex-col space-y-4"
          >
            {/* Widescreen NextUp test anchor */}
            <div data-testid="dashboard-next-up-hero" className="sr-only" aria-hidden="true">
              {nextUp ? `Up next: ${nextUp.title}` : "No Upcoming Quizzes Scheduled"}
            </div>

            {/* Prioritized Study Recommendations & Topic Mastery (Preserved on Widescreen!) */}
            <div
              data-testid="dashboard-widescreen-recommendations"
              className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 shadow-xs space-y-3"
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2.5">
                <div className="flex items-center gap-1.5">
                  <BrainCircuit className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    {copy.dashboard.recommendationsTitle}
                  </h2>
                </div>
                <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                  {filteredRecs.length} plans
                </span>
              </div>
              <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
                {filteredRecs.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-500">
                    No active study plans matching your filters.
                  </p>
                ) : (
                  filteredRecs.map((rec, index) => (
                    <StudyRecommendationCard
                      key={rec.assessmentId}
                      index={index + 1}
                      recommendation={rec}
                      room={roomByAssessment.get(rec.assessmentId)}
                      onToggleTopic={(topicIdx) => toggleTopic(rec.assessmentId, topicIdx)}
                      onOpenDetail={() => openAssessmentDetail(rec.assessmentId)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Daily Study Roadmap */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 shadow-xs">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-1.5">
                  <BrainCircuit className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    Daily Study Roadmap
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setView("tasks")}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-ink)] hover:underline cursor-pointer"
                >
                  <span>All Tasks</span>
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <div className="max-h-[380px] overflow-y-auto pr-1">
                <DailyStudyRoadmap compactMode />
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Empty states (v4-first-run + all-clear, honesty doctrine)
// ---------------------------------------------------------------------------

const FirstRunEmpty: React.FC<{ onAddCourse: () => void; onConnect: () => void }> = ({
  onAddCourse,
  onConnect,
}) => (
  <div
    data-testid="empty-dashboard-no-courses"
    className="space-y-3 rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900"
  >
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[var(--accent-ink)] dark:bg-blue-950/70">
      <MapIcon className="h-6 w-6" aria-hidden="true" />
    </div>
    <div className="text-sm font-bold text-slate-900 dark:text-white">
      {copy.dashboard.studyEmptyTitle}
    </div>
    <p className="mx-auto max-w-sm text-xs text-slate-600 dark:text-slate-400">
      {copy.dashboard.studyEmptyBody}
    </p>
    <div className="flex items-center justify-center gap-2 pt-1">
      <button
        type="button"
        onClick={onAddCourse}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[var(--accent-fill-hover)] active:scale-95"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{copy.dashboard.studyEmptyAddCourse}</span>
      </button>
      <button
        type="button"
        onClick={onConnect}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition active:scale-95 dark:border-slate-700 dark:text-slate-200"
      >
        <Link className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{copy.dashboard.connectAccount}</span>
      </button>
    </div>
  </div>
);

/** The study panel's "nothing matched" state. Deliberately NOT the all-clear
 *  card: the plans are still pending, the search just hid them. */
const SearchNoMatchesEmpty: React.FC<{
  title: string;
  body: string;
  onClear: () => void;
}> = ({ title, body, onClear }) => (
  <div
    data-testid="study-empty-search"
    className="space-y-3 rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900"
  >
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[var(--accent-ink)] dark:bg-blue-950/70">
      <SearchIcon className="h-6 w-6" aria-hidden="true" />
    </div>
    <div className="text-sm font-bold text-slate-900 dark:text-white">{title}</div>
    <p className="mx-auto max-w-sm text-xs text-slate-600 dark:text-slate-400">{body}</p>
    <button
      type="button"
      onClick={onClear}
      className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition active:scale-95 dark:border-slate-700 dark:text-slate-200"
    >
      <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{copy.dashboard.searchClear}</span>
    </button>
  </div>
);

const AllClearEmpty: React.FC<{ onCreateEvent: () => void }> = ({ onCreateEvent }) => (
  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[var(--accent-ink)] dark:bg-blue-950/70">
      <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
    </div>
    <div className="text-sm font-bold text-slate-900 dark:text-white">
      {copy.dashboard.studyAllClearTitle}
    </div>
    <p className="mx-auto max-w-sm text-xs text-slate-600 dark:text-slate-400">
      {copy.dashboard.studyAllClearBody}
    </p>
    <button
      type="button"
      onClick={onCreateEvent}
      className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[var(--accent-fill-hover)] active:scale-95"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{copy.dashboard.studyAddCustomEvent}</span>
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// v4 hero spotlight (v4-final:static/index.html `#dashboard-next-up-hero`)
// ---------------------------------------------------------------------------

interface NextUpHeroProps {
  assessment: Assessment | null;
  testId?: string;
  isScrolled?: boolean;
  onOpenDetail: () => void;
  onOpenCalendar: () => void;
  onConnect: () => void;
  onSync: () => void;
}

const HERO_SHELL =
  "hero-view-transition relative isolate overflow-hidden rounded-2xl bg-gradient-to-r from-[#1e3a8a] via-[#1e40af] to-[#1d4ed8] dark:from-slate-900 dark:via-blue-950 dark:to-indigo-950 border border-blue-700/30 dark:border-blue-800/50 text-white p-3.5 sm:p-5 lg:p-6 shadow-sm";

/**
 * Sky over the hero gradient. Light mode gets a few dim stars and a soft sun
 * disc bleeding over the card's top-right edge; dark mode gets a denser,
 * brighter field split across two layers that pulse against each other (a
 * pure-CSS shimmer — no per-star DOM, no JS timer). All layers sit behind
 * the content via the shell's `isolate` + `-z-10`; reduced-motion users get
 * a static sky.
 */
const DAY_STARS: ReadonlyArray<[x: number, y: number, size: number, opacity: number]> = [
  [7, 24, 1, 0.28],
  [15, 64, 1.1, 0.2],
  [24, 32, 0.9, 0.35],
  [33, 74, 1, 0.22],
  [42, 18, 1.1, 0.3],
  [52, 52, 0.9, 0.25],
  [61, 30, 1, 0.3],
  [69, 70, 0.9, 0.2],
  [76, 40, 1, 0.28],
  [84, 58, 0.9, 0.22],
  [92, 34, 1, 0.3],
  [20, 86, 0.9, 0.25],
  [3, 48, 0.9, 0.22],
  [28, 52, 1, 0.18],
  [38, 88, 0.9, 0.2],
  [47, 38, 0.9, 0.24],
  [58, 82, 1, 0.2],
  [88, 72, 0.9, 0.22],
];

const NIGHT_STARS_A: ReadonlyArray<[x: number, y: number, size: number, opacity: number]> = [
  [4, 18, 1.4, 0.95],
  [14, 40, 1.2, 1],
  [18, 12, 1, 0.8],
  [27, 26, 1.4, 0.9],
  [36, 8, 1.6, 0.85],
  [45, 66, 1.1, 0.9],
  [49, 22, 1.5, 0.95],
  [57, 36, 1.2, 1],
  [66, 14, 1.3, 0.9],
  [74, 44, 1.4, 0.95],
  [83, 68, 1.3, 0.85],
  [91, 82, 1.2, 0.9],
  [50, 94, 1.1, 0.8],
  [12, 90, 1.3, 0.85],
  [8, 52, 1.2, 0.85],
  [22, 74, 1.1, 0.8],
  [31, 44, 1.3, 0.9],
  [41, 30, 1, 0.75],
  [55, 82, 1.2, 0.85],
  [63, 52, 1.1, 0.8],
  [80, 52, 1.7, 0.95],
  [86, 8, 1.3, 0.85],
];

const NIGHT_STARS_B: ReadonlyArray<[x: number, y: number, size: number, opacity: number]> = [
  [9, 72, 1.6, 0.9],
  [23, 58, 1.3, 0.85],
  [31, 84, 1.2, 0.8],
  [40, 46, 1.4, 0.9],
  [53, 88, 1.2, 0.75],
  [62, 60, 1.5, 0.9],
  [70, 78, 1.2, 0.8],
  [79, 20, 1.3, 0.85],
  [87, 34, 1.4, 0.9],
  [95, 50, 1.5, 0.85],
  [33, 12, 1.1, 0.7],
  [58, 6, 1.2, 0.75],
  [5, 38, 1.4, 0.85],
  [17, 92, 1.2, 0.75],
  [37, 62, 1.3, 0.85],
  [44, 74, 1.7, 0.9],
  [47, 10, 1.1, 0.7],
  [59, 28, 1.4, 0.9],
  [75, 92, 1.2, 0.8],
  [93, 68, 1.3, 0.85],
];

const starsToGradients = (stars: typeof DAY_STARS, isNight = false): string =>
  stars
    .map(([x, y, size, opacity]) => {
      const coreSize = isNight ? Math.max(2.4, size * 1.9) : Math.max(1.6, size * 1.4);
      const bloomSize = isNight ? Math.max(7.0, size * 5.6) : Math.max(3.5, size * 2.8);
      const bloomOpacity = (opacity * 0.45).toFixed(2);
      const outerOpacity = (opacity * 0.18).toFixed(2);
      return [
        `radial-gradient(${coreSize}px ${coreSize}px at ${x}% ${y}%, rgba(255,255,255,${opacity}) 45%, transparent 62%)`,
        `radial-gradient(${bloomSize}px ${bloomSize}px at ${x}% ${y}%, rgba(224,231,255,${bloomOpacity}) 15%, rgba(129,140,248,${outerOpacity}) 50%, transparent 75%)`,
      ].join(", ");
    })
    .join(", ");

const NextUpHeroStars: React.FC = () => (
  <>
    {/* Day sky: crisp crystalline stars */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 dark:hidden"
      style={{ backgroundImage: starsToGradients(DAY_STARS, false) }}
    />
    {/* Radiant glowing Sun in light themes */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 animate-[heroSunGlow_5s_ease-in-out_infinite] dark:hidden motion-reduce:animate-none"
      style={{
        backgroundImage: [
          // Expansive warm golden atmospheric corona
          "radial-gradient(340px 340px at 90% 6%, rgba(251,191,36,0.48), rgba(245,158,11,0.22) 42%, rgba(252,211,77,0.08) 68%, transparent 84%)",
          // Brilliant golden mid-corona
          "radial-gradient(180px 180px at 90% 6%, rgba(254,240,138,0.85), rgba(245,158,11,0.52) 45%, transparent 74%)",
          // Incandescent blazing solar core
          "radial-gradient(72px 72px at 90% 6%, rgba(255,255,255,1) 0%, rgba(254,249,195,0.98) 35%, rgba(250,204,21,0.88) 62%, rgba(245,158,11,0.55) 76%, transparent 82%)",
        ].join(", "),
      }}
    />
    {/* Ambient solar dawn dispersion over the right quadrant */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 dark:hidden"
      style={{
        backgroundImage:
          "radial-gradient(480px 240px at 92% 0%, rgba(253,224,71,0.18), transparent 70%)",
      }}
    />
    {/* Night sky: two bright sparkling star layers pulsing against each other */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 hidden animate-[heroTwinkleA_4.5s_ease-in-out_infinite] dark:block motion-reduce:animate-none"
      style={{ backgroundImage: starsToGradients(NIGHT_STARS_A, true) }}
    />
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 hidden animate-[heroTwinkleB_5.6s_ease-in-out_0.9s_infinite] dark:block motion-reduce:animate-none"
      style={{ backgroundImage: starsToGradients(NIGHT_STARS_B, true) }}
    />
    {/* Sheen: one diagonal light band sweeps the card every few seconds, over
        both the day and the night sky. */}
    <div
      aria-hidden="true"
      className="hero-sheen pointer-events-none absolute inset-0 -z-10 motion-reduce:animate-none"
    />
  </>
);

const NextUpHero: React.FC<NextUpHeroProps> = ({
  assessment,
  testId = "dashboard-next-up-hero",
  isScrolled = false,
  onOpenDetail,
  onOpenCalendar,
  onConnect,
  onSync,
}) => {
  const courses = useAppStore((s) => s.data.schedule.courses);

  if (isScrolled) {
    if (!assessment) {
      return (
        <section
          data-testid={testId}
          className="relative overflow-hidden rounded-xl border border-blue-900/40 bg-slate-950/85 px-4 py-2 shadow-md backdrop-blur-md transition-all duration-300"
        >
          <NextUpHeroStars />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Sparkles className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
              <span>{copy.dashboard.heroEmptyTitle}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onConnect}
                className="flex cursor-pointer items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-[#1557b0] transition hover:bg-blue-50"
              >
                <UserCheck className="h-3 w-3" aria-hidden="true" />
                <span>{copy.dashboard.heroConnectAccount}</span>
              </button>
              <button
                type="button"
                onClick={onSync}
                className="flex cursor-pointer items-center gap-1 rounded-lg bg-slate-900/60 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-slate-900"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                <span>{copy.dashboard.heroSyncRadar}</span>
              </button>
            </div>
          </div>
        </section>
      );
    }

    const days = assessment.daysUntil ?? null;
    const countdownLabel =
      days === 0
        ? copy.dashboard.heroToday
        : days === 1
          ? copy.dashboard.heroTomorrow
          : days !== null
            ? copy.dashboard.heroInDays(days)
            : "";
    const room = assessment.room?.trim();
    const heroCourseBadge = assessment.courseId
      ? `${courseDisplayName(assessment.courseId, courses)} · ${assessment.assessmentType}`
      : assessment.assessmentType;

    return (
      <section
        data-testid={testId}
        className="relative overflow-hidden rounded-xl border border-blue-900/40 bg-slate-950/85 px-4 py-2 shadow-md backdrop-blur-md transition-all duration-300"
      >
        <NextUpHeroStars />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {countdownLabel && (
              <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-extrabold text-slate-950 shrink-0">
                <Zap className="h-2.5 w-2.5" aria-hidden="true" />
                <span>{copy.dashboard.heroUpNext(countdownLabel)}</span>
              </span>
            )}
            <span className="truncate text-xs font-bold text-white">
              {heroCourseBadge}: {assessment.title}
            </span>
            {room && (
              <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-emerald-300 shrink-0">
                <MapPin className="h-2.5 w-2.5" />
                <span>{copy.dashboard.roomLabel(stripRoomPrefix(room))}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenDetail}
              className="flex cursor-pointer items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-[#1557b0] transition hover:bg-blue-50"
            >
              <span>{copy.dashboard.heroStudyPlan}</span>
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!assessment) {
    return (
      <section data-testid={testId} className={HERO_SHELL}>
        <NextUpHeroStars />
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="flex items-center gap-2 text-base font-bold text-white sm:text-lg">
              <Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" />
              <span>{copy.dashboard.heroEmptyTitle}</span>
            </h1>
            <p className="mt-0.5 text-xs text-blue-100">{copy.dashboard.heroEmptyBody}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onConnect}
              className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-[#1557b0] shadow-xs transition hover:bg-blue-50"
            >
              <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{copy.dashboard.heroConnectAccount}</span>
            </button>
            <button
              type="button"
              onClick={onSync}
              className="flex cursor-pointer items-center gap-1 rounded-xl bg-slate-950/35 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-950/50"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{copy.dashboard.heroSyncRadar}</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  const days = assessment.daysUntil ?? null;
  const countdownLabel =
    days === 0
      ? copy.dashboard.heroToday
      : days === 1
        ? copy.dashboard.heroTomorrow
        : days !== null
          ? copy.dashboard.heroInDays(days)
          : "";
  const room = assessment.room?.trim();
  const when = assessment.displayTime || assessment.dayName || assessment.dateIso || "—";
  // The Focus pill carries the AI study plan, or the labeled inference note —
  // and only when one of them actually exists (never an empty "Focus:").
  const focusText = assessment.aiStudyPlan || assessment.aiInferenceNote || "";
  const googleCalUrl = safeExternalUrl(assessment.googleCalUrl);
  const heroCourseBadge = assessment.courseId
    ? `${courseDisplayName(assessment.courseId, courses)} · ${assessment.assessmentType}`
    : assessment.assessmentType;

  return (
    <section data-testid={testId} className={HERO_SHELL}>
      <NextUpHeroStars />
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center sm:gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {countdownLabel && (
              <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-950 shadow-2xs sm:text-xs">
                <Zap className="h-3 w-3" aria-hidden="true" />
                <span>{copy.dashboard.heroUpNext(countdownLabel)}</span>
              </span>
            )}
            <span className="rounded-full bg-slate-950/35 px-2.5 py-0.5 text-[11px] font-semibold text-white sm:text-xs">
              {heroCourseBadge}
            </span>
            {room && (
              <span className="hidden items-center gap-1 rounded-full border border-emerald-300/30 bg-slate-950/35 px-2.5 py-0.5 text-xs font-medium text-emerald-100 sm:inline-flex">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                <span>{copy.dashboard.roomLabel(stripRoomPrefix(room))}</span>
              </span>
            )}
          </div>

          <h1 className="text-base font-bold leading-snug tracking-tight text-white line-clamp-2 sm:text-xl lg:text-2xl">
            {assessment.title}
            {assessment.courseName && (
              <span className="text-xs font-normal text-blue-100 sm:text-sm">
                {" "}
                ({assessment.courseName})
              </span>
            )}
          </h1>

          <div className="flex flex-wrap items-center gap-2.5 text-[11px] tabular-nums text-blue-100 sm:gap-4 sm:text-xs">
            <span className="flex items-center gap-1 font-medium">
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{when}</span>
            </span>
            {assessment.instructor && (
              <span className="hidden items-center gap-1 sm:flex">
                <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{assessment.instructor}</span>
              </span>
            )}
            {room && (
              <span className="flex items-center gap-1 sm:hidden">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                <span>{copy.dashboard.roomLabel(stripRoomPrefix(room))}</span>
              </span>
            )}
          </div>

          {/* Compact Study Focus Pill */}
          {focusText && (
            <div className="flex max-w-3xl items-start gap-2 rounded-xl border border-white/15 bg-slate-950/45 p-2 text-[11px] text-blue-50 sm:p-2.5 sm:text-xs">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
              <div className="leading-relaxed line-clamp-2">
                <span className="font-semibold text-white">{copy.dashboard.heroFocusLabel}</span>{" "}
                {focusText}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons: Horizontal on mobile, neatly grouped on desktop */}
        <div className="flex shrink-0 items-center gap-2 pt-1 md:pt-0">
          <button
            type="button"
            onClick={onOpenDetail}
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-[#1557b0] shadow-xs transition hover:bg-blue-50 active:scale-[0.98] md:flex-initial"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.dashboard.heroStudyPlan}</span>
          </button>
          <button
            type="button"
            onClick={onOpenCalendar}
            aria-label={copy.dashboard.heroCalendar}
            title={copy.dashboard.heroCalendar}
            className="flex cursor-pointer items-center justify-center gap-1 rounded-xl bg-slate-950/35 px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-950/50 active:scale-95"
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{copy.dashboard.heroCalendar}</span>
          </button>
          {/* The Google-Cal link only renders when the pipeline established a
              real template URL — v4 linked to "#", which was dishonest. */}
          {googleCalUrl && (
            <a
              href={googleCalUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={copy.dashboard.heroGoogleCal}
              title={copy.dashboard.heroGoogleCal}
              className="flex cursor-pointer items-center justify-center gap-1 rounded-xl bg-slate-950/35 px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-950/50 active:scale-95"
            >
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{copy.dashboard.heroGoogleCal}</span>
            </a>
          )}
        </div>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Sub-components: Recommendation Card & Timeline Row (v4-exact layout)
// ---------------------------------------------------------------------------

interface RecommendationCardProps {
  index: number;
  recommendation: StudyRecommendation;
  /** The matching assessment's room (v4 looked it up from `appState.assessments`). */
  room?: string | null;
  onToggleTopic: (topicIdx: number) => void;
  onOpenDetail: () => void;
}

const StudyRecommendationCard: React.FC<RecommendationCardProps> = ({
  index,
  recommendation: rec,
  room,
  onToggleTopic,
  onOpenDetail,
}) => {
  const [topicsExpanded, setTopicsExpanded] = useState(false);
  const theme = useAppStore((s) => s.theme);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const palette = coursePalette(rec.courseId || "GENERAL");
  const enrolled = courses.find((c) => c.id === rec.courseId);
  const accent = rec.color || enrolled?.color || palette.color;
  const chip = courseAccessibleChip(accent, theme === "dark");
  const completedCount = rec.topics.filter((t) => t.completed).length;
  const totalCount = rec.topics.length;
  // 0 tracked topics means there is no readiness number to show at all. The
  // core's 0/0 = 100 semantic means "nothing is pending", not "100% mastered",
  // so the percentage is withheld instead of being rendered as mastery the
  // user never recorded (mirrors the KPI card's `totalTopicsCount === 0` rule).
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : null;
  const topicsCount = rec.topics.length;
  const uniqueWarnings = [...new Set(rec.warnings || [])];
  const displaySchedule = formatCompactCardSchedule(rec.displayTime, room);

  const badgeColor =
    (rec.daysUntil ?? 99) <= 1
      ? "border-red-200 bg-red-100 text-red-700 dark:border-red-800/60 dark:bg-red-950/70 dark:text-red-300"
      : (rec.daysUntil ?? 99) <= 4
        ? "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/70 dark:text-amber-300"
        : "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800/60 dark:bg-blue-950/70 dark:text-blue-300";

  return (
    <div
      data-testid={`rec-card-${rec.assessmentId}`}
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail();
        }
      }}
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-xs transition-all duration-200 hover:border-[#1a73e8]/70 hover:shadow-md active:scale-[0.985] sm:p-4 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-500/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
    >
      {/* Left Course Color Accent Bar */}
      <div
        className="absolute bottom-3 left-0 top-3 w-1.5 rounded-r-full"
        style={{ backgroundColor: chip.dot }}
      />

      <div className="space-y-2 pl-2">
        {/* Top Row: Badges & Readiness Meter */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white dark:bg-slate-800">
              #{index}
            </span>
            <span
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white"
              style={{ backgroundColor: chip.solidBg }}
            >
              {courseDisplayName(rec.courseId, courses)}
            </span>
            <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {rec.assessmentType}
            </span>
            {rec.urgencyBadge && (
              <span
                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${badgeColor}`}
              >
                {rec.urgencyBadge}
              </span>
            )}
          </div>

          {/* Progress Pill — withheld entirely when nothing is tracked */}
          <div className="flex shrink-0 items-center gap-1.5 text-right tabular-nums">
            {progressPct === null ? (
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {copy.common.noTopicsTracked}
              </span>
            ) : (
              <>
                <div
                  role="progressbar"
                  aria-label={`Topic readiness for ${rec.title}`}
                  aria-valuenow={progressPct === null ? 0 : progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100 sm:w-16 dark:bg-slate-800"
                >
                  <div
                    className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                  {progressPct}%
                </span>
              </>
            )}
          </div>
        </div>

        {/* Main Title & Course Name */}
        <div>
          <h3 className="text-xs font-bold leading-snug text-slate-900 transition line-clamp-1 group-hover:text-[var(--accent-ink)] sm:text-sm dark:text-white">
            {rec.title}
          </h3>
          <div className="mt-0.5 truncate text-[11px] text-slate-600 line-clamp-1 dark:text-slate-400">
            {rec.courseName || "—"}
          </div>
        </div>

        {/* Bottom Row: Time / Location Pill & Topics Count & Chevron Details Affordance */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1 text-[11px] text-slate-600 dark:border-slate-800/80 dark:text-slate-400">
          <div className="flex min-w-0 items-center gap-2 truncate">
            <span className="flex items-center gap-1 truncate font-medium">
              <Calendar
                className="h-3.5 w-3.5 shrink-0 text-[var(--accent-ink)]"
                aria-hidden="true"
              />
              <span className="truncate">{displaySchedule}</span>
            </span>
            {topicsCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTopicsExpanded((v) => !v);
                }}
                aria-expanded={topicsExpanded}
                className="inline-flex min-h-6 shrink-0 cursor-pointer items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[11px] font-semibold text-[#1557b0] hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-200 dark:hover:bg-blue-900/60"
              >
                <BookOpen className="h-2.5 w-2.5" aria-hidden="true" />
                <span>{copy.dashboard.topicsCount(topicsCount)}</span>
                <ChevronRight
                  className={`h-2.5 w-2.5 transition-transform ${topicsExpanded ? "rotate-90" : ""}`}
                  aria-hidden="true"
                />
              </button>
            )}
            {uniqueWarnings.length > 0 && (
              <span className="hidden shrink-0 items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 md:inline-flex dark:bg-amber-950/50 dark:text-amber-300">
                <AlertCircle
                  className="h-2.5 w-2.5 text-amber-700 dark:text-amber-400"
                  aria-hidden="true"
                />
                <span>{copy.dashboard.rulesCount(uniqueWarnings.length)}</span>
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-[var(--accent-ink)] transition-transform group-hover:translate-x-0.5">
            <span>{copy.dashboard.detailsAction}</span>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
        </div>

        {/* Inline Topic Checklist (optimistic toggles — 01 §4.3) */}
        {topicsExpanded && topicsCount > 0 && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="space-y-2 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 transition-all duration-200"
          >
            <div className="space-y-1">
              {rec.topics.map((topic) => (
                <div key={topic.key} className="flex items-center gap-2">
                  <label className="group flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2 text-xs text-slate-800 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={topic.completed}
                      onChange={() => onToggleTopic(topic.topicIndex)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3.5 w-3.5 cursor-pointer rounded accent-[var(--accent-fill)]"
                    />
                    <span
                      className={`transition ${
                        topic.completed
                          ? "text-slate-600 line-through dark:text-slate-400"
                          : "group-hover:text-[var(--accent-ink)]"
                      }`}
                    >
                      {topic.title}
                    </span>
                  </label>
                  {/* Focus THIS topic: the pomodoro's "Mark Done" completes
                      exactly this topic (spec §4.7). */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      useAppStore.getState().openPomodoro({
                        assessmentId: rec.assessmentId,
                        topicIndex: topic.topicIndex,
                        topicTitle: topic.title,
                      });
                    }}
                    aria-label={`${copy.pomodoro.startForTopic} ${topic.title}`}
                    title={`${copy.pomodoro.startForTopic} ${topic.title}`}
                    className="inline-flex min-h-6 shrink-0 cursor-pointer items-center rounded-md bg-amber-500/10 px-1.5 py-0.5 text-amber-700 transition hover:bg-amber-500/20 dark:text-amber-300"
                  >
                    <Timer className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // Target the next pending topic so the modal's "Mark Done"
                  // completes the topic the user is actually working on.
                  const nextTopic = rec.topics.find((t) => !t.completed) ?? rec.topics[0];
                  useAppStore.getState().openPomodoro({
                    assessmentId: rec.assessmentId,
                    topicIndex: nextTopic?.topicIndex,
                    topicTitle: nextTopic?.title,
                  });
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[11px] font-semibold transition cursor-pointer"
              >
                <Timer className="h-3 w-3" />
                <span>Pomodoro</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  useAppStore.getState().openPracticeQuiz(rec.assessmentId);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent-ink)] text-[11px] font-semibold transition cursor-pointer"
              >
                <Sparkles className="h-3 w-3" />
                <span>Practice</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export interface TimelineRowProps {
  assessment: Assessment;
  onClick: () => void;
}

export const TimelineRow: React.FC<TimelineRowProps> = ({ assessment: a, onClick }) => {
  const theme = useAppStore((s) => s.theme);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const palette = coursePalette(a.courseId || "GENERAL");
  const enrolled = courses.find((c) => c.id === a.courseId);
  const accent = a.color || enrolled?.color || palette.color;
  const chip = courseAccessibleChip(accent, theme === "dark");

  const uniqueRules = [...new Set(a.warnings || [])];
  const rulesHtml = uniqueRules.slice(0, 2);

  let timeText = "";
  if (a.startTime && a.endTime) {
    timeText = `${a.startTime} – ${a.endTime}`;
  } else if (a.startTime) {
    timeText = a.startTime;
  } else if (a.endTime) {
    timeText = `Until ${a.endTime}`;
  }
  const dateText = formatShortDate(a.dateIso);
  const dateTimeDisplay = [dateText, timeText].filter(Boolean).join(" · ");

  return (
    <div
      data-testid={`timeline-row-${a.id}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="cursor-pointer space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 transition hover:border-[#1a73e8] hover:bg-white sm:p-3 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-blue-500 dark:hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white"
            style={{ backgroundColor: chip.solidBg }}
          >
            {courseDisplayName(a.courseId, courses)}
          </span>
          <span className="shrink-0 rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            {a.assessmentType}
          </span>
          <span className="flex shrink-0 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-800 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-200">
            <SourceIcon name={a.sourceIcon || "mail"} className="h-2.5 w-2.5" />
            {/* No source means "unknown" - never a fabricated "Gmail". */}
            <span>{a.source?.trim() ? a.source : "—"}</span>
          </span>
          {a.conflictWarning && (
            <span
              className="flex shrink-0 items-center gap-0.5 rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:border-amber-300/60 dark:bg-amber-950/80 dark:text-amber-200"
              title={a.conflictWarning}
            >
              <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
              <span>{copy.dashboard.conflictBadge}</span>
            </span>
          )}
          {a.achievedScore != null && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-md border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-300/60 dark:bg-emerald-950/80 dark:text-emerald-200">
              <Award className="h-2.5 w-2.5" aria-hidden="true" />
              <span>
                {a.achievedScore}/{a.maxScore ?? "—"}
              </span>
            </span>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
            a.isUpcoming
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
          }`}
        >
          {/* Honest countdown: undated drafts carry none (never "In 0d"). */}
          {a.isUpcoming && a.daysUntil != null
            ? a.daysUntil === 0
              ? copy.dashboard.heroToday
              : a.daysUntil === 1
                ? copy.dashboard.heroTomorrow
                : copy.dashboard.countdownShort(a.daysUntil)
            : a.semester || "—"}
        </span>
      </div>
      <div className="text-xs font-bold leading-snug text-slate-900 line-clamp-2 dark:text-white">
        {a.title}
      </div>
      <div className="flex items-center justify-between text-[11px] tabular-nums text-slate-600 sm:text-[11px] dark:text-slate-400">
        <span className="flex items-center gap-1">
          <Calendar className="h-3 w-3" aria-hidden="true" />
          <span>{dateTimeDisplay || "—"}</span>
        </span>
        {a.room && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            <span>{a.room}</span>
          </span>
        )}
      </div>
      {rulesHtml.length > 0 && (
        <div className="space-y-1 pt-0.5">
          {rulesHtml.map((rule, ruleIndex) => (
            <div
              key={ruleIndex}
              className="flex items-start gap-1.5 rounded-md border border-amber-200/80 bg-amber-50/90 px-2.5 py-1 text-[11px] text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <AlertCircle
                className="mt-0.5 h-3 w-3 shrink-0 text-amber-700 dark:text-amber-400"
                aria-hidden="true"
              />
              <span>{stripLeadingEmoji(rule)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
