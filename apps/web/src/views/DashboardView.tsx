import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart2,
  BrainCircuit,
  Calendar,
  ChevronRight,
  Search as SearchIcon,
} from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { ConflictBanner } from "../components/ConflictBanner";
import { StudyStatsCard } from "../components/StudyStatsCard";
import { CalendarGrid } from "../components/CalendarGrid";
import { DailyStudyRoadmap } from "../components/DailyStudyRoadmap";
import { TimelineHorizon } from "../components/TimelineHorizon";
import { assessmentKind } from "../lib/assessmentKind";
import { matchesGlobalSearch } from "../lib/calendarLanes";
import { computeActiveSourceCount, formatLastSynced } from "../state/syncStatus";
import {
  RemoteAnnouncementBanner,
  NextUpHero,
  StudyRecommendationCard,
  FirstRunEmpty,
  SearchNoMatchesEmpty,
  AllClearEmpty,
  weekRangeLabels,
  TimelineRow,
  type TimelineRowProps,
} from "./dashboard";

// Re-export for callers like TasksView.tsx
export { TimelineRow };
export type { TimelineRowProps };

type MobileDashboardTab = "study" | "overview";

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
