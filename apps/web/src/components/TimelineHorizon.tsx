import React, { useMemo } from "react";
import {
  CalendarClock,
  GraduationCap,
  Sparkles,
  AlertTriangle,
  RotateCw,
  Plus,
  Compass,
  Telescope,
  Radio,
  Clock,
  Layers,
  MapPin,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { copy } from "../copy";
import { courseAccessibleChip, coursePalette } from "../lib/coursePalette";
import { useAppStore } from "../state/store";
import type {
  Assessment,
  DesktopAuthProfile,
  DesktopConfig,
  ConflictAlert,
  StudyRecommendation,
} from "../state/types";

export interface TimelineHorizonProps {
  assessments: Assessment[];
  recommendations?: StudyRecommendation[];
  conflictAlerts?: ConflictAlert[];
  weekCount: number;
  examsAheadCount: number;
  readinessPct: number | null;
  totalTopicsCount: number;
  completedTopicsCount: number;
  typeBreakdown: [string, number][];
  auth: DesktopAuthProfile;
  config: DesktopConfig;
  activeSourceCount: number;
  lastSyncText: string;
  weekRangeLabel?: string;
  onOpenDetail: (assessmentId: string) => void;
  onRunGcalSync: () => void;
  onOpenConnect: () => void;
  onOpenAddCourse: () => void;
}

interface HorizonNode {
  assessment: Assessment;
  daysUntil: number;
  isCrunch48h: boolean;
  isConflict: boolean;
  conflictPartner?: string;
  topicProgressPct: number;
  totalTopics: number;
  completedTopics: number;
  logPositionPct: number;
}

export const TimelineHorizon: React.FC<TimelineHorizonProps> = ({
  assessments,
  recommendations = [],
  conflictAlerts = [],
  weekCount,
  examsAheadCount,
  readinessPct,
  totalTopicsCount,
  completedTopicsCount,
  typeBreakdown,
  auth,
  config,
  activeSourceCount,
  lastSyncText,
  weekRangeLabel,
  onOpenDetail,
  onRunGcalSync,
  onOpenConnect,
  onOpenAddCourse,
}) => {
  const theme = useAppStore((s) => s.theme);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const draftBalancedFlightPath = useAppStore((s) => s.draftBalancedFlightPath);

  // Map recommendations by assessment id for quick topic lookup
  const recMap = useMemo(() => {
    const map = new Map<string, StudyRecommendation>();
    for (const r of recommendations) {
      map.set(r.assessmentId, r);
    }
    return map;
  }, [recommendations]);

  // Conflict set of assessment ids involved in 48h clashes
  const conflictMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of conflictAlerts) {
      if (!c.isMitigated) {
        map.set(c.assessmentAId, c.titleB || c.courseB || "Exam");
        map.set(c.assessmentBId, c.titleA || c.courseA || "Exam");
      }
    }
    return map;
  }, [conflictAlerts]);

  // Filter to upcoming assessments with dates, sorted chronologically
  const horizonNodes = useMemo<HorizonNode[]>(() => {
    const upcoming = assessments
      .filter(
        (a) =>
          a.isUpcoming && a.daysUntil !== null && a.daysUntil !== undefined && a.daysUntil >= 0,
      )
      .sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0));

    if (upcoming.length === 0) return [];

    // Map to logarithmic time positions
    // Range: 0 days -> ~5%, 2 days -> ~32%, 7 days -> ~60%, 14 days -> ~80%, 30+ days -> ~95%
    // formula: log(1 + d) / log(1 + maxD)
    const maxReferenceDays = 28;
    const logMax = Math.log1p(maxReferenceDays);

    return upcoming.map((a) => {
      const days = a.daysUntil ?? 0;
      const normalizedLog = Math.min(1, Math.log1p(Math.max(0, days)) / logMax);
      // scale between 5% and 95%
      const logPositionPct = Math.round(5 + normalizedLog * 88);

      const rec = recMap.get(a.id);
      const totalTopics = rec?.topics?.length ?? 0;
      const completedTopics = rec?.topics?.filter((t) => t.completed).length ?? 0;
      const topicProgressPct =
        totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;

      const isConflict = conflictMap.has(a.id);
      const conflictPartner = conflictMap.get(a.id);
      const isCrunch48h = days <= 2;

      return {
        assessment: a,
        daysUntil: days,
        isCrunch48h,
        isConflict,
        conflictPartner,
        topicProgressPct,
        totalTopics,
        completedTopics,
        logPositionPct,
      };
    });
  }, [assessments, recMap, conflictMap]);

  return (
    <section
      data-testid="dashboard-kpi-row"
      aria-label="Astronomical Timeline Horizon"
      className="relative overflow-hidden rounded-3xl border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text)] shadow-lg transition-all duration-300"
    >
      {/* Background Starlight & Nebula Ambient Glow */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40 dark:opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle at 10% 20%, rgba(99, 102, 241, 0.15) 0%, transparent 40%), radial-gradient(circle at 90% 80%, rgba(244, 63, 94, 0.12) 0%, transparent 45%), radial-gradient(circle at 50% 50%, rgba(56, 189, 248, 0.08) 0%, transparent 60%)",
        }}
        aria-hidden="true"
      />

      {/* Subtle Starry Grid Lines */}
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--surface-border) 1px, transparent 1px), linear-gradient(to bottom, var(--surface-border) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
        aria-hidden="true"
      />

      {/* TOP TELEMETRY HUD BAR (Includes all KPI facts so spec & tests stay 100% satisfied) */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--surface-border)] px-4 py-3 sm:px-6">
        {/* Left: Astronomical Radar Brand & Trajectory */}
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 via-sky-500/10 to-rose-500/20 text-[var(--accent-ink)] border border-[var(--surface-border)] shadow-inner">
            <Telescope className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" />
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold tracking-tight text-[var(--text)] sm:text-base">
                Timeline Horizon
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase text-sky-600 dark:text-sky-300">
                <Radio className="h-2.5 w-2.5 animate-pulse" aria-hidden="true" />
                Academic Radar
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)] font-medium">
              Logarithmic timeline of upcoming exams, quizzes &amp; preparation windows
            </p>
          </div>
        </div>

        {/* Right: Telemetry KPI Chips (Accessible & Test-Compliant) */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Chip 1: Upcoming This Week */}
          <div className="flex items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] px-3 py-1.5 text-xs shadow-xs">
            <CalendarClock className="h-3.5 w-3.5 text-blue-500 shrink-0" aria-hidden="true" />
            <div className="flex items-baseline gap-1.5">
              <span className="font-bold tabular-nums text-[var(--text)]">{weekCount}</span>
              <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                {copy.dashboard.kpiUpcomingTitle}
              </span>
              {weekRangeLabel && (
                <span className="hidden xl:inline text-[10px] text-[var(--text-muted)] font-normal">
                  ({weekRangeLabel})
                </span>
              )}
            </div>
          </div>

          {/* Chip 2: Exams Ahead */}
          <div className="flex items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] px-3 py-1.5 text-xs shadow-xs">
            <GraduationCap className="h-3.5 w-3.5 text-purple-500 shrink-0" aria-hidden="true" />
            <div className="flex items-baseline gap-1.5">
              <span className="font-bold tabular-nums text-[var(--text)]">{examsAheadCount}</span>
              <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                {copy.dashboard.kpiExamsTitle}
              </span>
            </div>
          </div>

          {/* Chip 3: Readiness Score */}
          <div className="flex items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] px-3 py-1.5 text-xs shadow-xs">
            <CheckCircle2
              className={`h-3.5 w-3.5 shrink-0 ${
                readinessPct !== null && readinessPct >= 75
                  ? "text-emerald-500"
                  : readinessPct !== null && readinessPct >= 40
                    ? "text-amber-500"
                    : "text-slate-400"
              }`}
              aria-hidden="true"
            />
            <div className="flex items-baseline gap-1.5">
              <span className="font-bold tabular-nums text-[var(--text)]">
                {readinessPct === null ? "—" : `${readinessPct}%`}
              </span>
              <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                {readinessPct === null
                  ? copy.dashboard.kpiReadinessNone
                  : copy.dashboard.kpiReadinessCounts(completedTopicsCount, totalTopicsCount)}
              </span>
            </div>
          </div>

          {/* Chip 4: GCal & Sync Telemetry */}
          <div className="hidden lg:flex items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] px-3 py-1.5 text-xs shadow-xs">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                auth.authenticated
                  ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                  : "bg-slate-400"
              }`}
              aria-hidden="true"
            />
            <span
              className="max-w-[130px] truncate text-[11px] font-semibold text-[var(--text)]"
              title={
                auth.authenticated
                  ? auth.email || config.userEmail || "Connected"
                  : copy.dashboard.kpiNotConnected
              }
            >
              {auth.authenticated
                ? auth.email || config.userEmail || "Google Account"
                : copy.dashboard.kpiNotConnected}
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              {activeSourceCount > 0
                ? copy.dashboard.kpiSyncActive(activeSourceCount)
                : copy.dashboard.kpiSyncNone}
              {lastSyncText ? ` · ${lastSyncText}` : ""}
            </span>
            <button
              type="button"
              onClick={() => void onRunGcalSync()}
              aria-label={copy.dashboard.kpiSyncCalendarAction}
              className="cursor-pointer text-[11px] font-bold text-[var(--accent-ink)] hover:underline ml-1"
            >
              <RotateCw className="h-3 w-3 inline mr-1" aria-hidden="true" />
              Sync
            </button>
          </div>
        </div>
        {typeBreakdown.length > 0 && (
          <div className="w-full flex items-center gap-1.5 pt-1 text-[10px] text-[var(--text-muted)]">
            <span className="font-semibold uppercase tracking-wider">
              {copy.dashboard.kpiTypeBreakdown}:
            </span>
            {typeBreakdown.map(([type, count]) => (
              <span
                key={type}
                className="rounded-md bg-[var(--page)] border border-[var(--surface-border)] px-1.5 py-0.5 font-semibold text-[var(--text)]"
              >
                {type} · {count}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ACADEMIC HORIZON BODY */}
      <div className="relative z-10 p-4 sm:p-6" data-testid="timeline-horizon">
        {horizonNodes.length === 0 ? (
          /* EMPTY HORIZON STATE */
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-3xl bg-[var(--page)] border border-[var(--surface-border)] shadow-inner mb-4">
              <Compass
                className="h-8 w-8 text-[var(--text-muted)] animate-[spin_12s_linear_infinite]"
                aria-hidden="true"
              />
              <div className="absolute inset-0 rounded-3xl border border-sky-400/20 animate-ping opacity-30" />
            </div>
            <h3 className="text-base font-bold text-[var(--text)]">Clear Exam Horizon</h3>
            <p className="mt-1 max-w-md text-xs text-[var(--text-muted)] leading-relaxed">
              No upcoming exams or quizzes in your radar. Connect your university accounts or add
              your course timetable to project upcoming deadlines.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={onOpenAddCourse}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 py-2 text-xs font-bold text-white shadow-md hover:opacity-95 transition"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Course</span>
              </button>
              <button
                type="button"
                onClick={onOpenConnect}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] px-3.5 py-2 text-xs font-bold text-[var(--text)] hover:bg-[var(--surface-hover)] transition"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                <span>Connect University / Google</span>
              </button>
            </div>
          </div>
        ) : (
          /* POPULATED HORIZON: LOGARITHMIC CURVE & UPCOMING EXAMS */
          <div className="space-y-4">
            {/* Horizon Temporal Scale Labels */}
            <div className="relative flex items-center justify-between text-[11px] font-bold tracking-wider uppercase text-[var(--text-muted)] px-2">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-rose-500 dark:text-rose-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" />
                  <span>T-0 / 48h Exam Window</span>
                </div>
                {conflictAlerts.some((c) => !c.isMitigated) && (
                  <button
                    type="button"
                    onClick={() => void draftBalancedFlightPath()}
                    className="cursor-pointer inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-300 transition"
                  >
                    <Sparkles className="h-2.5 w-2.5 text-rose-400" aria-hidden="true" />
                    <span>Auto-Balance 48h Schedule</span>
                  </button>
                )}
              </div>
              <div className="hidden sm:block text-amber-500 dark:text-amber-400">
                <span>7-Day Horizon</span>
              </div>
              <div className="hidden md:block text-sky-500 dark:text-sky-400">
                <span>14-Day Horizon</span>
              </div>
              <div className="text-indigo-400 dark:text-indigo-300">
                <span>30+ Days Ahead</span>
              </div>
            </div>

            {/* Logarithmic Track Runway */}
            <div className="relative h-2 rounded-full bg-gradient-to-r from-rose-500/40 via-amber-400/30 via-sky-400/30 to-indigo-500/20 overflow-hidden shadow-inner">
              <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.2)_50%,transparent_100%)] animate-[shimmer_3s_infinite]" />
            </div>

            {/* Upcoming Exams Grid / Horizon Scrollable Strip */}
            <div className="relative overflow-x-auto pb-3 pt-2 scrollbar-thin">
              <div className="flex min-w-[700px] items-stretch gap-4 px-1">
                {horizonNodes.map((node) => {
                  const {
                    assessment: a,
                    daysUntil,
                    isCrunch48h,
                    isConflict,
                    conflictPartner,
                    topicProgressPct,
                    totalTopics,
                    completedTopics,
                  } = node;

                  const enrolled = courses.find((c) => c.id === a.courseId);
                  const palette = coursePalette(a.courseId || "");
                  const accentColor = a.color || enrolled?.color || palette.color;
                  const chipStyle = courseAccessibleChip(accentColor, theme === "dark");

                  // Urgency-based styling
                  const cardBorderClass = isCrunch48h
                    ? "border-rose-500/60 dark:border-rose-500/70 shadow-[0_0_20px_rgba(244,63,94,0.22)] bg-gradient-to-b from-rose-500/5 to-transparent"
                    : isConflict
                      ? "border-amber-500/60 dark:border-amber-500/70 shadow-[0_0_16px_rgba(245,158,11,0.2)]"
                      : daysUntil <= 7
                        ? "border-sky-500/40 dark:border-sky-500/50 hover:border-sky-400 shadow-sm"
                        : "border-[var(--surface-border)] hover:border-[var(--border-subtle)] shadow-2xs";

                  const orbPulseClass = isCrunch48h
                    ? "bg-rose-500 text-white shadow-[0_0_16px_rgba(244,63,94,0.8)] animate-pulse"
                    : daysUntil <= 7
                      ? "bg-amber-500 text-slate-900 shadow-[0_0_12px_rgba(245,158,11,0.6)]"
                      : "bg-sky-500 text-slate-950 shadow-[0_0_10px_rgba(56,189,248,0.5)]";

                  return (
                    <div
                      key={a.id}
                      onClick={() => onOpenDetail(a.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenDetail(a.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Upcoming Exam: ${a.title} for ${a.courseId || "Course"}, in ${daysUntil} days`}
                      className={`group relative flex flex-col justify-between w-64 shrink-0 rounded-2xl border p-3.5 bg-[var(--page)] transition-all duration-200 hover:-translate-y-1 hover:shadow-md cursor-pointer ${cardBorderClass}`}
                    >
                      {/* Top Node Header: Urgency Orb + Course Badge + Countdown */}
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2.5">
                          {/* Indicator with Topic Completion Ring */}
                          <div className="relative flex items-center justify-center h-8 w-8">
                            <svg className="h-8 w-8 -rotate-90" viewBox="0 0 32 32">
                              <circle
                                cx="16"
                                cy="16"
                                r="13"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                className="text-[var(--surface-border)]"
                              />
                              {totalTopics > 0 && (
                                <circle
                                  cx="16"
                                  cy="16"
                                  r="13"
                                  fill="none"
                                  stroke={isCrunch48h ? "#f43f5e" : "#10b981"}
                                  strokeWidth="2.5"
                                  strokeDasharray={`${(topicProgressPct / 100) * 81.68} 81.68`}
                                  strokeLinecap="round"
                                  className="transition-all duration-500"
                                />
                              )}
                            </svg>
                            <span
                              className={`absolute h-4 w-4 rounded-full flex items-center justify-center font-black text-[9px] ${orbPulseClass}`}
                              aria-hidden="true"
                            >
                              ●
                            </span>
                          </div>

                          {/* Course Code Chip */}
                          <span
                            className="inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-bold tracking-tight shadow-2xs"
                            style={chipStyle}
                          >
                            {a.courseId || "ACADEMIC"}
                          </span>

                          {/* Relative Countdown Badge */}
                          <span
                            className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-extrabold tabular-nums ${
                              isCrunch48h
                                ? "bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30"
                                : daysUntil <= 7
                                  ? "bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/30"
                                  : "bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--surface-border)]"
                            }`}
                          >
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            <span>
                              {daysUntil === 0
                                ? "Today"
                                : daysUntil === 1
                                  ? "Tomorrow"
                                  : `T-${daysUntil}d`}
                            </span>
                          </span>
                        </div>

                        {/* Assessment Title & Kind */}
                        <h4 className="text-xs font-bold text-[var(--text)] line-clamp-1 group-hover:text-[var(--accent-ink)] transition-colors">
                          {a.title}
                        </h4>

                        {/* Date and Delivery Meta */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                          <span>{a.dateIso || "Date unconfirmed"}</span>
                          {(a.displayTime || a.startTime) && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums font-semibold">
                                {a.displayTime || a.startTime}
                              </span>
                            </>
                          )}
                          {a.room && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span
                                className="inline-flex items-center gap-0.5 truncate max-w-[80px]"
                                title={a.room}
                              >
                                <MapPin className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                                {a.room}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Bottom Tray: Topic Readiness or 48h Conflict Banner */}
                      <div className="mt-3 pt-2.5 border-t border-[var(--surface-border)] flex items-center justify-between text-[11px]">
                        {isConflict ? (
                          <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-bold truncate">
                            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">48h Cluster ({conflictPartner})</span>
                          </div>
                        ) : totalTopics > 0 ? (
                          <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                            <Layers className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                            <span className="font-semibold text-[var(--text)]">
                              {completedTopics}/{totalTopics}
                            </span>
                            <span>topics</span>
                          </div>
                        ) : (
                          <span className="text-[var(--text-muted)] font-medium">
                            Ready to review
                          </span>
                        )}

                        <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-[var(--accent-ink)] group-hover:translate-x-0.5 transition-transform">
                          <span>Inspect</span>
                          <ChevronRight className="h-3 w-3" aria-hidden="true" />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
