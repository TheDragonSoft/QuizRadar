import React, { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Award,
  BarChart2,
  BookOpen,
  BrainCircuit,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  ChevronsUpDown,
  GraduationCap,
  Layers,
  Link,
  Mail,
  Map as MapIcon,
  MapPin,
  Plus,
  Radar as RadarIcon,
  RefreshCw,
  School,
  Sparkles,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { ConflictBanner } from "../components/ConflictBanner";
import { courseDisplayName, coursePalette } from "../lib/coursePalette";
import { safeExternalUrl } from "../lib/safeUrl";
import type { Assessment, StudyRecommendation } from "../state/types";

type MobileDashboardTab = "study" | "assessments" | "overview";

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

/** en-US week-range labels for the week KPI (v4 `kpi-week-subtext`). */
function weekRangeLabels(referenceDate: string | undefined): { start: string; end: string } {
  const parts = (referenceDate ?? "").split("-").map(Number);
  const base =
    parts.length === 3 ? new Date(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1) : new Date();
  const fmt = (date: Date, withYear: boolean) =>
    `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()]}, ${
      MONTHS_SHORT[date.getMonth()]
    } ${date.getDate()}${withYear ? `, ${date.getFullYear()}` : ""}`;
  const end = new Date(base);
  end.setDate(base.getDate() + 7);
  return { start: fmt(base, false), end: fmt(end, true) };
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

export const DashboardView: React.FC = () => {
  const dash = useAppStore((s) => s.data.dashboard);
  const assessments = useAppStore((s) => s.data.assessments);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const config = useAppStore((s) => s.data.config);
  const auth = useAppStore((s) => s.data.auth);
  const selectedCourseIds = useAppStore((s) => s.selectedCourseIds);
  const activeSourceFilter = useAppStore((s) => s.activeSourceFilter);
  const setActiveSourceFilter = useAppStore((s) => s.setActiveSourceFilter);
  const activeTypeFilter = useAppStore((s) => s.activeTypeFilter);
  const setActiveTypeFilter = useAppStore((s) => s.setActiveTypeFilter);
  const toggleTopic = useAppStore((s) => s.toggleTopic);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);
  const setView = useAppStore((s) => s.setView);
  const triggerSync = useAppStore((s) => s.triggerSync);
  const runGcalSync = useAppStore((s) => s.runGcalSync);
  const openModal = useAppStore((s) => s.openModal);

  const [mobileTab, setMobileTab] = useState<MobileDashboardTab>("study");

  // Course-layer filter (the sidebar's calendar checkboxes)
  const isCourseSelected = (courseId?: string | null) => {
    if (!courseId || selectedCourseIds === null) return true;
    return selectedCourseIds.includes(courseId);
  };

  const upcomingThisWeek = (dash.upcomingThisWeek || []).filter((a) =>
    isCourseSelected(a.courseId),
  );
  const weekCount = upcomingThisWeek.length;

  const filteredTimeline = (assessments || []).filter((a) => {
    if (!isCourseSelected(a.courseId)) return false;
    if (activeSourceFilter !== "ALL") {
      const src = (a.source || "Gmail").toUpperCase();
      if (!src.includes(activeSourceFilter)) return false;
    }
    if (activeTypeFilter === "UPCOMING") return a.isUpcoming;
    if (activeTypeFilter !== "ALL" && a.assessmentType !== activeTypeFilter) return false;
    return true;
  });

  const filteredRecs = (dash.studyRecommendations || []).filter((r) =>
    isCourseSelected(r.courseId),
  );

  // v4 looks the rec card's room up from the matching assessment record.
  const roomByAssessment = new Map((assessments || []).map((a) => [a.id, a.room] as const));

  // v4 hero spotlight: the next assessment, honouring the course filter.
  const nextUp =
    (dash.nextUp && isCourseSelected(dash.nextUp.courseId) ? dash.nextUp : null) ??
    upcomingThisWeek[0] ??
    (dash.allUpcoming || []).find((a) => isCourseSelected(a.courseId)) ??
    null;

  const weekLabels = weekRangeLabels(dash.referenceDate);
  // 0 tracked topics means no readiness number exists yet — never show 100%.
  const readinessPct = dash.totalTopicsCount === 0 ? null : (dash.readinessPercent ?? 100);
  const hasCourses = courses.length > 0;

  // Adaptive source pills: only the sources that actually have records
  // (v4 un-hides its Moodle pill the same way).
  const sourcePills: ReadonlyArray<{ filter: string; label: string; icon: string }> = [
    { filter: "GMAIL", label: "Gmail", icon: "mail" },
    { filter: "MOODLE", label: "Moodle", icon: "graduation-cap" },
    { filter: "TEAMS", label: "Teams", icon: "users" },
    { filter: "CLASSROOM", label: "Classroom", icon: "school" },
  ].filter((pill) =>
    (assessments || []).some((a) => (a.source || "").toUpperCase().includes(pill.filter)),
  );

  return (
    <div data-testid="dashboard-view" className="mx-auto max-w-[1440px] space-y-6">
      {/* Conflict & Schedule Overload Alert Banner (v4 renders it above the hero) */}
      <ConflictBanner />

      {/* Top Hero Banner: What's Coming Next */}
      <NextUpHero
        assessment={nextUp}
        onOpenDetail={() => nextUp && openAssessmentDetail(nextUp.id)}
        onOpenCalendar={() => setView("calendar")}
        onConnect={() => openModal({ id: "settings", props: { initialTab: "account" } })}
        onSync={() => void triggerSync()}
      />

      {/* Mobile Segmented Sub-Navigation Switcher (< 1024px) */}
      <div className="flex items-center gap-1 rounded-xl border border-slate-200/80 bg-slate-100 p-1 text-xs font-semibold lg:hidden dark:border-slate-700/80 dark:bg-slate-800/80">
        <button
          type="button"
          onClick={() => setMobileTab("study")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 transition ${
            mobileTab === "study"
              ? "bg-white font-bold text-[#1a73e8] shadow-2xs dark:bg-slate-900 dark:text-blue-400"
              : "cursor-pointer text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          }`}
        >
          <BrainCircuit className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{copy.dashboard.subtabs.study}</span>
          {filteredRecs.length > 0 && (
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">
              {filteredRecs.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("assessments")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 transition ${
            mobileTab === "assessments"
              ? "bg-white font-bold text-[#1a73e8] shadow-2xs dark:bg-slate-900 dark:text-blue-400"
              : "cursor-pointer text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          }`}
        >
          <RadarIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{copy.dashboard.subtabs.assessments}</span>
          {filteredTimeline.length > 0 && (
            <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
              {filteredTimeline.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("overview")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 transition ${
            mobileTab === "overview"
              ? "bg-white font-bold text-[#1a73e8] shadow-2xs dark:bg-slate-900 dark:text-blue-400"
              : "cursor-pointer text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          }`}
        >
          <BarChart2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{copy.dashboard.subtabs.overview}</span>
        </button>
      </div>

      {/* 4 KPI Overview Cards (desktop; the "At a Glance" tab on mobile) */}
      <section
        data-testid="dashboard-kpi-row"
        className={`${
          mobileTab === "overview" ? "grid" : "hidden lg:grid"
        } grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4`}
      >
        {/* Card 1: Upcoming This Week */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {copy.dashboard.kpiUpcomingTitle}
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-[#1a73e8] dark:bg-blue-950/80 dark:text-blue-400">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
                {weekCount}
              </span>
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {copy.dashboard.kpiUpcomingCountLabel}
              </span>
            </div>
            <p className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {weekCount > 0
                ? copy.dashboard.kpiWeekRange(weekLabels.start, weekLabels.end)
                : copy.dashboard.kpiUpcomingEmpty}
            </p>
          </div>
        </div>

        {/* Card 2: Types of Exams Breakdown */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {copy.dashboard.kpiTypesTitle}
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/80 dark:text-purple-400">
              <Layers className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Object.entries(dash.examTypeCounts || {}).length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTypeFilter("ALL")}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                    activeTypeFilter === "ALL"
                      ? "border-[#1a73e8]/40 bg-[#e8f0fe] text-[#1a73e8] dark:border-blue-500/50 dark:bg-blue-950/80 dark:text-blue-300"
                      : "cursor-pointer border-slate-200 bg-slate-100 text-slate-700 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-blue-950/50"
                  }`}
                >
                  <span>All</span>
                </button>
                {Object.entries(dash.examTypeCounts || {}).map(([type, count]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setActiveTypeFilter(type)}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                      activeTypeFilter === type
                        ? "border-[#1a73e8]/40 bg-[#e8f0fe] text-[#1a73e8] dark:border-blue-500/50 dark:bg-blue-950/80 dark:text-blue-300"
                        : "cursor-pointer border-slate-200 bg-slate-100 text-slate-800 hover:bg-blue-50 hover:text-[#1a73e8] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-blue-950/50 dark:hover:text-blue-400"
                    }`}
                  >
                    <span>{type}</span>
                    <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-[#1a73e8] dark:bg-slate-900 dark:text-blue-400">
                      {count}
                    </span>
                  </button>
                ))}
              </>
            ) : (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {copy.dashboard.kpiTypesEmpty}
              </span>
            )}
          </div>
        </div>

        {/* Card 3: Study Readiness Progress */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {copy.dashboard.kpiReadinessTitle}
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/80 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
                {readinessPct === null ? "—" : `${readinessPct}%`}
              </span>
              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {readinessPct === null
                  ? copy.dashboard.kpiReadinessNone
                  : copy.dashboard.kpiReadinessCounts(
                      dash.completedTopicsCount,
                      dash.totalTopicsCount,
                    )}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{
                  width: `${readinessPct === null ? 0 : Math.min(100, Math.max(0, readinessPct))}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Card 4: Gemini AI & Google Calendar Sync */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {copy.dashboard.kpiSyncTitle}
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/80 dark:text-amber-400">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  auth.authenticated ? "bg-emerald-500" : "bg-slate-400"
                }`}
                aria-hidden="true"
              />
              <span
                className="min-w-0 truncate text-sm font-bold text-slate-900 dark:text-white"
                title={
                  auth.authenticated
                    ? auth.email || config.userEmail || auth.name || config.userName || undefined
                    : undefined
                }
              >
                {auth.authenticated
                  ? auth.email || config.userEmail || auth.name || config.userName
                  : copy.dashboard.kpiNotConnected}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {config.geminiEnabled ? copy.dashboard.kpiAiActive : copy.dashboard.kpiAiOff}
              </span>
              <button
                type="button"
                onClick={() => void runGcalSync()}
                className="min-h-6 shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-xs font-semibold text-[#1a73e8] hover:underline dark:text-blue-400"
              >
                {copy.dashboard.kpiSyncCalendarAction}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Main Dashboard Grid: Left = Study Planner | Right = Assessments Radar */}
      <section className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12 lg:gap-6">
        {/* Left 7 Cols: What Should I Study? */}
        <div
          data-testid="dashboard-study-panel"
          className={`${
            mobileTab === "study" ? "flex" : "hidden"
          } flex-col rounded-xl border border-slate-200 bg-white p-3 sm:p-4 lg:col-span-7 lg:flex lg:h-[720px] dark:border-slate-800 dark:bg-slate-900`}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 sm:text-base dark:text-white">
                <BrainCircuit
                  className="h-4 w-4 shrink-0 text-[#1a73e8] dark:text-blue-400"
                  aria-hidden="true"
                />
                <span>{copy.dashboard.recommendationsTitle}</span>
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {copy.dashboard.recommendationsSubtitle}
              </p>
            </div>
            <span className="hidden shrink-0 items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 sm:inline-flex dark:bg-slate-800 dark:text-slate-300">
              <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{copy.dashboard.scrollBadge}</span>
            </span>
          </div>

          <div className="max-h-[640px] flex-1 space-y-2.5 overflow-y-auto pr-1.5 pt-3 sm:space-y-3 lg:max-h-none">
            {hasCourses ? (
              filteredRecs.length === 0 ? (
                <AllClearEmpty onCreateEvent={() => openModal("create-event")} />
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
                onConnect={() => openModal({ id: "settings", props: { initialTab: "account" } })}
              />
            )}
          </div>
        </div>

        {/* Right 5 Cols: All Assessments Radar */}
        <div
          data-testid="all-assessments-panel"
          className={`${
            mobileTab === "assessments" ? "flex" : "hidden"
          } flex-col rounded-xl border border-slate-200 bg-white p-3 sm:p-4 lg:col-span-5 lg:flex lg:h-[720px] dark:border-slate-800 dark:bg-slate-900`}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 sm:text-base dark:text-white">
                <RadarIcon
                  className="h-4 w-4 shrink-0 text-[#1a73e8] dark:text-blue-400"
                  aria-hidden="true"
                />
                <span>{copy.dashboard.timelineTitle}</span>
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {copy.dashboard.timelineSubtitle}
              </p>
            </div>
            <select
              aria-label={copy.dashboard.timelineTitle}
              title={copy.dashboard.timelineTitle}
              value={activeTypeFilter}
              onChange={(e) => setActiveTypeFilter(e.target.value)}
              className="shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="UPCOMING">{copy.dashboard.typeFilterUpcoming}</option>
              <option value="ALL">{copy.dashboard.typeFilterAll}</option>
              <option value="Class Quiz">{copy.dashboard.typeFilterClassQuiz}</option>
              <option value="Online Quiz">{copy.dashboard.typeFilterOnlineQuiz}</option>
              <option value="Midterm Exam">{copy.dashboard.typeFilterMidterm}</option>
              <option value="Assignment">{copy.dashboard.typeFilterAssignment}</option>
            </select>
          </div>

          {/* Multi-Source Platform Filter Pills */}
          <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-slate-100 pb-1 pt-2.5 text-[11px] font-semibold dark:border-slate-800/80">
            <button
              type="button"
              onClick={() => setActiveSourceFilter("ALL")}
              className={`rounded-lg px-2.5 py-1 transition ${
                activeSourceFilter === "ALL"
                  ? "bg-[#1a73e8] text-white shadow-2xs"
                  : "cursor-pointer bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              {copy.dashboard.filterAllSources}
            </button>
            {sourcePills.map((pill) => {
              const Icon = () => <SourceIcon name={pill.icon} className="h-3 w-3" />;
              const iconColor =
                pill.icon === "mail"
                  ? "text-blue-500"
                  : pill.icon === "graduation-cap"
                    ? "text-orange-500"
                    : pill.icon === "users"
                      ? "text-indigo-500"
                      : "text-emerald-500";
              return (
                <button
                  key={pill.filter}
                  type="button"
                  onClick={() => setActiveSourceFilter(pill.filter)}
                  className={`flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1 transition ${
                    activeSourceFilter === pill.filter
                      ? "bg-[#1a73e8] text-white shadow-2xs"
                      : "cursor-pointer bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                >
                  <span className={activeSourceFilter === pill.filter ? "text-white" : iconColor}>
                    <Icon />
                  </span>
                  <span>{pill.label}</span>
                </button>
              );
            })}
          </div>

          <div className="max-h-[640px] flex-1 space-y-2.5 overflow-y-auto pr-1.5 pt-3.5 lg:max-h-none">
            {filteredTimeline.length === 0 ? (
              (assessments || []).length === 0 ? (
                <div className="space-y-2 rounded-xl border border-slate-200 p-6 text-center dark:border-slate-800">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {copy.dashboard.timelineEmptyTitle}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {copy.dashboard.timelineEmptyBody}
                  </p>
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openModal("add-course")}
                      className="cursor-pointer rounded-lg bg-[#1a73e8] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#1557b0] active:scale-95"
                    >
                      {copy.dashboard.studyEmptyAddCourse}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        openModal({ id: "settings", props: { initialTab: "account" } })
                      }
                      className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                    >
                      {copy.dashboard.connectAccount}
                    </button>
                  </div>
                </div>
              ) : (
                // Assessments exist but the active filters exclude all of them —
                // say so instead of claiming nothing is scheduled.
                <div
                  data-testid="timeline-empty-filtered"
                  className="space-y-2 rounded-xl border border-slate-200 p-6 text-center dark:border-slate-800"
                >
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {copy.dashboard.timelineEmptyFilteredTitle}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {copy.dashboard.timelineEmptyFilteredBody}
                  </p>
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSourceFilter("ALL");
                        setActiveTypeFilter("ALL");
                      }}
                      className="cursor-pointer rounded-lg bg-[#1a73e8] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#1557b0] active:scale-95"
                    >
                      {copy.dashboard.timelineClearFilters}
                    </button>
                  </div>
                </div>
              )
            ) : (
              filteredTimeline.map((assessment) => (
                <TimelineRow
                  key={assessment.id}
                  assessment={assessment}
                  onClick={() => openAssessmentDetail(assessment.id)}
                />
              ))
            )}
          </div>
        </div>
      </section>
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
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[#1a73e8] dark:bg-blue-950/70 dark:text-blue-400">
      <MapIcon className="h-6 w-6" aria-hidden="true" />
    </div>
    <div className="text-sm font-bold text-slate-900 dark:text-white">
      {copy.dashboard.studyEmptyTitle}
    </div>
    <p className="mx-auto max-w-sm text-xs text-slate-500 dark:text-slate-400">
      {copy.dashboard.studyEmptyBody}
    </p>
    <div className="flex items-center justify-center gap-2 pt-1">
      <button
        type="button"
        onClick={onAddCourse}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#1a73e8] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[#1557b0] active:scale-95"
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

const AllClearEmpty: React.FC<{ onCreateEvent: () => void }> = ({ onCreateEvent }) => (
  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[#1a73e8] dark:bg-blue-950/70 dark:text-blue-400">
      <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
    </div>
    <div className="text-sm font-bold text-slate-900 dark:text-white">
      {copy.dashboard.studyAllClearTitle}
    </div>
    <p className="mx-auto max-w-sm text-xs text-slate-500 dark:text-slate-400">
      {copy.dashboard.studyAllClearBody}
    </p>
    <button
      type="button"
      onClick={onCreateEvent}
      className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#1a73e8] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[#1557b0] active:scale-95"
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
  onOpenDetail: () => void;
  onOpenCalendar: () => void;
  onConnect: () => void;
  onSync: () => void;
}

const HERO_SHELL =
  "rounded-2xl bg-gradient-to-r from-[#1e3a8a] via-[#1d4ed8] to-[#2563eb] dark:from-slate-900 dark:via-blue-950 dark:to-indigo-950 border border-blue-700/30 dark:border-blue-800/50 text-white p-3.5 sm:p-5 lg:p-6 shadow-sm";

const NextUpHero: React.FC<NextUpHeroProps> = ({
  assessment,
  onOpenDetail,
  onOpenCalendar,
  onConnect,
  onSync,
}) => {
  const courses = useAppStore((s) => s.data.schedule.courses);
  if (!assessment) {
    return (
      <section data-testid="dashboard-next-up-hero" className={HERO_SHELL}>
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
              className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-[#1a73e8] shadow-xs transition hover:bg-blue-50"
            >
              <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{copy.dashboard.heroConnectAccount}</span>
            </button>
            <button
              type="button"
              onClick={onSync}
              className="flex cursor-pointer items-center gap-1 rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/25"
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

  return (
    <section data-testid="dashboard-next-up-hero" className={HERO_SHELL}>
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center sm:gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {countdownLabel && (
              <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-950 shadow-2xs sm:text-xs">
                <Zap className="h-3 w-3" aria-hidden="true" />
                <span>{copy.dashboard.heroUpNext(countdownLabel)}</span>
              </span>
            )}
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold text-white sm:text-xs">
              {courseDisplayName(assessment.courseId, courses)} · {assessment.assessmentType}
            </span>
            {room && (
              <span className="hidden items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-400/20 px-2 py-0.5 text-xs font-medium text-emerald-100 sm:inline-flex">
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
            <div className="flex max-w-3xl items-start gap-2 rounded-xl border border-white/15 bg-slate-900/40 p-2 text-[11px] text-blue-50 sm:p-2.5 sm:text-xs">
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
            className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-[#1a73e8] shadow-xs transition hover:bg-blue-50 active:scale-[0.98] md:flex-initial"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.dashboard.heroStudyPlan}</span>
          </button>
          <button
            type="button"
            onClick={onOpenCalendar}
            title={copy.dashboard.heroCalendar}
            className="flex cursor-pointer items-center justify-center gap-1 rounded-xl bg-white/15 px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-white/25 active:scale-95"
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
              title={copy.dashboard.heroGoogleCal}
              className="flex cursor-pointer items-center justify-center gap-1 rounded-xl bg-white/15 px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-white/25 active:scale-95"
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
  const courses = useAppStore((s) => s.data.schedule.courses);
  const palette = coursePalette(rec.courseId || "GENERAL");
  const accent = rec.color || palette.color;
  const completedCount = rec.topics.filter((t) => t.completed).length;
  const totalCount = rec.topics.length;
  const progressPct =
    rec.progressPercent ?? (totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100);
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
      onClick={onOpenDetail}
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-xs transition-all duration-200 hover:border-[#1a73e8]/70 hover:shadow-md active:scale-[0.985] sm:p-4 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-500/70"
    >
      {/* Left Course Color Accent Bar */}
      <div
        className="absolute bottom-3 left-0 top-3 w-1.5 rounded-r-full"
        style={{ backgroundColor: accent }}
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
              style={{ backgroundColor: accent }}
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

          {/* Progress Pill */}
          <div className="flex shrink-0 items-center gap-1.5 text-right tabular-nums">
            <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100 sm:w-16 dark:bg-slate-800">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
              />
            </div>
            <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
              {progressPct}%
            </span>
          </div>
        </div>

        {/* Main Title & Course Name */}
        <div>
          <h3 className="text-xs font-bold leading-snug text-slate-900 transition line-clamp-1 group-hover:text-[#1a73e8] sm:text-sm dark:text-white dark:group-hover:text-blue-400">
            {rec.title}
          </h3>
          <div className="mt-0.5 truncate text-[11px] text-slate-500 line-clamp-1 dark:text-slate-400">
            {rec.courseName || "—"}
          </div>
        </div>

        {/* Bottom Row: Time / Location Pill & Topics Count & Chevron Details Affordance */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1 text-[11px] text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
          <div className="flex min-w-0 items-center gap-2 truncate">
            <span className="flex items-center gap-1 truncate font-medium">
              <Calendar
                className="h-3.5 w-3.5 shrink-0 text-[#1a73e8] dark:text-blue-400"
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
                className="inline-flex min-h-6 shrink-0 cursor-pointer items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[11px] font-semibold text-[#1a73e8] hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/60"
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
              <span className="hidden shrink-0 items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 md:inline-flex dark:bg-amber-950/50 dark:text-amber-300">
                <AlertCircle className="h-2.5 w-2.5 text-amber-500" aria-hidden="true" />
                <span>{copy.dashboard.rulesCount(uniqueWarnings.length)}</span>
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-[#1a73e8] transition-transform group-hover:translate-x-0.5 dark:text-blue-400">
            <span>{copy.dashboard.detailsAction}</span>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
        </div>

        {/* Inline Topic Checklist (optimistic toggles — 01 §4.3) */}
        {topicsExpanded && topicsCount > 0 && (
          <div className="space-y-1 rounded-lg bg-slate-50 p-2 pt-2 dark:bg-slate-800/50">
            {rec.topics.map((topic) => (
              <label
                key={topic.key}
                className="group flex cursor-pointer select-none items-center gap-2 text-xs text-slate-800 dark:text-slate-200"
              >
                <input
                  type="checkbox"
                  checked={topic.completed}
                  onChange={() => onToggleTopic(topic.topicIndex)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-3.5 w-3.5 cursor-pointer rounded accent-[var(--accent)]"
                />
                <span
                  className={`transition ${
                    topic.completed
                      ? "text-slate-500 line-through dark:text-slate-500"
                      : "group-hover:text-[#1a73e8] dark:group-hover:text-blue-400"
                  }`}
                >
                  {topic.title}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface TimelineRowProps {
  assessment: Assessment;
  onClick: () => void;
}

const TimelineRow: React.FC<TimelineRowProps> = ({ assessment: a, onClick }) => {
  const courses = useAppStore((s) => s.data.schedule.courses);
  const palette = coursePalette(a.courseId || "GENERAL");
  const accent = a.color || palette.color;

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
      onClick={onClick}
      className="cursor-pointer space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 transition hover:border-[#1a73e8] hover:bg-white sm:p-3 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-blue-500 dark:hover:bg-slate-800"
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white"
            style={{ backgroundColor: accent }}
          >
            {courseDisplayName(a.courseId, courses)}
          </span>
          <span className="shrink-0 rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            {a.assessmentType}
          </span>
          <span className="flex shrink-0 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-300">
            <SourceIcon name={a.sourceIcon || "mail"} className="h-2.5 w-2.5" />
            <span>{a.source || "Gmail"}</span>
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
              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
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
      <div className="flex items-center justify-between text-[11px] tabular-nums text-slate-500 sm:text-[11px] dark:text-slate-400">
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
                className="mt-0.5 h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400"
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
