import React, { useState } from "react";
import {
  Sparkles,
  ListCheck,
  LayoutDashboard,
  Clock,
  MapPin,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { ConflictBanner } from "../components/ConflictBanner";
import { coursePalette } from "../lib/coursePalette";
import type { Assessment, StudyRecommendation } from "../state/types";

type MobileDashboardTab = "study" | "assessments" | "overview";

export const DashboardView: React.FC = () => {
  const dash = useAppStore((s) => s.data.dashboard);
  const assessments = useAppStore((s) => s.data.assessments);
  const config = useAppStore((s) => s.data.config);
  const selectedCourseIds = useAppStore((s) => s.selectedCourseIds);
  const activeSourceFilter = useAppStore((s) => s.activeSourceFilter);
  const setActiveSourceFilter = useAppStore((s) => s.setActiveSourceFilter);
  const activeTypeFilter = useAppStore((s) => s.activeTypeFilter);
  const setActiveTypeFilter = useAppStore((s) => s.setActiveTypeFilter);
  const toggleTopic = useAppStore((s) => s.toggleTopic);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);

  const [mobileTab, setMobileTab] = useState<MobileDashboardTab>("study");

  // 1. Course filtering
  const isCourseSelected = (courseId?: string | null) => {
    if (!courseId || selectedCourseIds === null) return true;
    return selectedCourseIds.includes(courseId);
  };

  const filteredUpcoming = (dash.upcomingThisWeek || []).filter((a) =>
    isCourseSelected(a.courseId),
  );
  const weekCount = filteredUpcoming.length;

  // 2. Timeline assessments filtering
  const filteredTimeline = (assessments || []).filter((a) => {
    // Course filter
    if (!isCourseSelected(a.courseId)) return false;

    // Source filter
    if (activeSourceFilter !== "ALL") {
      const src = (a.source || "GMAIL").toUpperCase();
      if (!src.includes(activeSourceFilter)) return false;
    }

    // Type filter
    if (activeTypeFilter === "UPCOMING") {
      return a.isUpcoming;
    }
    if (activeTypeFilter !== "ALL" && a.assessmentType !== activeTypeFilter) {
      return false;
    }

    return true;
  });

  // 3. Recommendations filtering
  const filteredRecs = (dash.studyRecommendations || []).filter((r) =>
    isCourseSelected(r.courseId),
  );

  // Active sources count for Account/Sync KPI
  const activeSourcesCount = [
    config.teamsEnabled,
    config.moodleEnabled,
    config.classroomEnabled,
    config.feeds.length > 0,
    true, // Local / Gmail
  ].filter(Boolean).length;

  const readinessPct = dash.readinessPercent ?? 100;
  const readinessColor =
    readinessPct >= 80
      ? "text-emerald-600 dark:text-emerald-400"
      : readinessPct >= 50
        ? "text-amber-600 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400";

  return (
    <div data-testid="dashboard-view" className="space-y-6">
      {/* Mobile Sub-Tab Bar (Gated < 1024px) */}
      <div className="flex lg:hidden rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-1 shadow-xs">
        <button
          type="button"
          onClick={() => setMobileTab("study")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
            mobileTab === "study"
              ? "bg-[var(--accent)] text-white shadow-xs"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{copy.dashboard.subtabs.study}</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("assessments")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
            mobileTab === "assessments"
              ? "bg-[var(--accent)] text-white shadow-xs"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          <ListCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{copy.dashboard.subtabs.assessments}</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("overview")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
            mobileTab === "overview"
              ? "bg-[var(--accent)] text-white shadow-xs"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{copy.dashboard.subtabs.overview}</span>
        </button>
      </div>

      {/* KPI Row (Desktop: always visible; Mobile: visible when mobileTab === 'overview') */}
      <div
        data-testid="dashboard-kpi-row"
        className={`${
          mobileTab === "overview" ? "grid" : "hidden lg:grid"
        } grid-cols-1 sm:grid-cols-3 gap-4`}
      >
        {/* KPI 1: Next 7 Days */}
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {copy.dashboard.kpiUpcomingTitle}
              </span>
              <span className="h-2 w-2 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight tabular-nums text-[var(--text)]">
                {weekCount}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {weekCount === 1 ? "assessment" : "assessments"}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {weekCount > 0 ? "Scheduled within upcoming 7 days" : copy.dashboard.kpiUpcomingEmpty}
            </p>
          </div>

          {/* Exam Type Breakdown Pills */}
          <div className="mt-4 flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() =>
                setActiveTypeFilter(activeTypeFilter === "UPCOMING" ? "ALL" : "UPCOMING")
              }
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition cursor-pointer ${
                activeTypeFilter === "UPCOMING"
                  ? "bg-[var(--accent)] text-white shadow-2xs"
                  : "bg-[var(--surface-hover)] text-[var(--text-muted)] hover:bg-[var(--surface-border)]"
              }`}
            >
              {copy.dashboard.filterUpcomingOnly}
            </button>
            {Object.entries(dash.examTypeCounts || {}).map(([type, count]) => (
              <button
                key={type}
                type="button"
                onClick={() => setActiveTypeFilter(activeTypeFilter === type ? "ALL" : type)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition cursor-pointer ${
                  activeTypeFilter === type
                    ? "bg-[var(--accent)] text-white shadow-2xs"
                    : "bg-[var(--surface-hover)] text-[var(--text-muted)] hover:bg-[var(--surface-border)]"
                }`}
              >
                {type} ({count})
              </button>
            ))}
          </div>
        </div>

        {/* KPI 2: Exam Readiness */}
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {copy.dashboard.kpiReadinessTitle}
              </span>
              <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span
                className={`text-3xl font-extrabold tracking-tight tabular-nums ${readinessColor}`}
              >
                {readinessPct}%
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {copy.dashboard.kpiReadinessCounts(dash.completedTopicsCount, dash.totalTopicsCount)}
            </p>
          </div>

          {/* Progress Bar */}
          <div className="mt-4 w-full bg-[var(--surface-border)] h-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${readinessPct}%` }}
            />
          </div>
        </div>

        {/* KPI 3: Connected Sources */}
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {copy.dashboard.kpiSyncTitle}
              </span>
              <CheckCircle2 className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight tabular-nums text-[var(--text)]">
                {activeSourcesCount}
              </span>
              <span className="text-xs text-[var(--text-muted)]">connected</span>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {copy.dashboard.kpiSyncActive(activeSourcesCount)}
            </p>
          </div>

          <div className="mt-4 text-[10px] text-[var(--text-muted)] flex items-center justify-between">
            <span>Gmail, Teams, Moodle</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">Active</span>
          </div>
        </div>
      </div>

      {/* Conflict & Exam Overload Banner */}
      <ConflictBanner />

      {/* Main Content: Split Columns on Desktop (lg:grid-cols-2) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel A: What Should I Study? (Study Recommendations) */}
        <div
          data-testid="dashboard-study-panel"
          className={`${mobileTab === "study" ? "block" : "hidden lg:block"} space-y-4`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold tracking-tight text-[var(--text)]">
                {copy.dashboard.recommendationsTitle}
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                {copy.dashboard.recommendationsSubtitle}
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[11px] font-bold">
              {filteredRecs.length}
            </span>
          </div>

          {filteredRecs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--surface-border)] p-8 text-center text-xs text-[var(--text-muted)]">
              <Sparkles className="mx-auto h-8 w-8 text-[var(--text-muted)] opacity-50 mb-2" />
              <p>{copy.dashboard.recommendationsEmpty}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRecs.map((rec, index) => (
                <StudyRecommendationCard
                  key={rec.assessmentId}
                  index={index + 1}
                  recommendation={rec}
                  onToggleTopic={(topicIdx) => toggleTopic(rec.assessmentId, topicIdx)}
                  onOpenDetail={() => openAssessmentDetail(rec.assessmentId)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Panel B: All Assessments Radar (Timeline) */}
        <div
          data-testid="all-assessments-panel"
          className={`${mobileTab === "assessments" ? "block" : "hidden lg:block"} space-y-4`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold tracking-tight text-[var(--text)]">
                {copy.dashboard.timelineTitle}
              </h2>
              <p className="text-xs text-[var(--text-muted)]">{copy.dashboard.timelineSubtitle}</p>
            </div>

            {/* Type Filter Dropdown */}
            <select
              value={activeTypeFilter}
              onChange={(e) => setActiveTypeFilter(e.target.value)}
              className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Types</option>
              <option value="UPCOMING">All Upcoming</option>
              <option value="Class Quiz">Class Quiz</option>
              <option value="Midterm Exam">Midterm Exam</option>
              <option value="Final Exam">Final Exam</option>
              <option value="Assignment">Assignment</option>
              <option value="Lab Assessment">Lab Assessment</option>
              <option value="Online Quiz">Online Quiz</option>
            </select>
          </div>

          {/* Source Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(["ALL", "GMAIL", "MOODLE", "TEAMS", "CLASSROOM"] as const).map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => setActiveSourceFilter(src)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeSourceFilter === src
                    ? "bg-[var(--accent)] text-white shadow-2xs"
                    : "bg-[var(--surface)] border border-[var(--surface-border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                {src === "ALL" ? copy.dashboard.filterAll : src}
              </button>
            ))}
          </div>

          {/* Timeline List Rows */}
          {filteredTimeline.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--surface-border)] p-8 text-center text-xs text-[var(--text-muted)]">
              <p>{copy.emptyStates.noAssessmentsFound}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTimeline.map((assessment) => (
                <TimelineRow
                  key={assessment.id}
                  assessment={assessment}
                  onClick={() => openAssessmentDetail(assessment.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-components: Recommendation Card & Timeline Row
// ---------------------------------------------------------------------------

interface RecommendationCardProps {
  index: number;
  recommendation: StudyRecommendation;
  onToggleTopic: (topicIdx: number) => void;
  onOpenDetail: () => void;
}

const StudyRecommendationCard: React.FC<RecommendationCardProps> = ({
  index,
  recommendation: rec,
  onToggleTopic,
  onOpenDetail,
}) => {
  const palette = coursePalette(rec.courseId || "GENERAL");
  const completedCount = rec.topics.filter((t) => t.completed).length;
  const totalCount = rec.topics.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100;

  return (
    <div
      data-testid={`rec-card-${rec.assessmentId}`}
      className="relative overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-4 shadow-xs transition hover:shadow-sm hover:border-[var(--accent)]"
    >
      {/* Course Color Left Edge Bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5"
        style={{ backgroundColor: palette.color }}
      />

      <div className="pl-2 space-y-3">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[10px] font-extrabold text-[var(--text)]">
              #{index}
            </span>
            <span
              className="px-2 py-0.5 rounded-md text-[11px] font-bold shadow-2xs"
              style={{ backgroundColor: palette.bg, color: palette.color }}
            >
              {rec.courseId}
            </span>
            <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase">
              {rec.urgencyLevel}
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenDetail}
            className="text-[var(--text-muted)] hover:text-[var(--text)] p-1 rounded-lg transition"
            aria-label="View assessment details"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Title & Schedule */}
        <div onClick={onOpenDetail} className="cursor-pointer group">
          <h3 className="text-sm font-bold text-[var(--text)] group-hover:text-[var(--accent)] transition">
            {rec.title}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--text-muted)] line-clamp-1">{rec.whyStudyNow}</p>
        </div>

        {/* Progress Bar & Counter */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-muted)]">
            <span>Syllabus Topics</span>
            <span>{copy.dashboard.topicsCompletedProgress(completedCount, totalCount)}</span>
          </div>
          <div className="w-full bg-[var(--surface-border)] h-1.5 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Topics Checklist */}
        {totalCount > 0 && (
          <div className="space-y-1 pt-1">
            {rec.topics.map((topic) => (
              <label
                key={topic.key}
                className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer select-none group"
              >
                <input
                  type="checkbox"
                  checked={topic.completed}
                  onChange={() => onToggleTopic(topic.topicIndex)}
                  className="h-3.5 w-3.5 rounded accent-[var(--accent)] cursor-pointer"
                />
                <span
                  className={`transition ${
                    topic.completed
                      ? "line-through text-[var(--text-muted)]"
                      : "group-hover:text-[var(--accent)]"
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
  const palette = coursePalette(a.courseId || "GENERAL");

  return (
    <div
      data-testid={`timeline-row-${a.id}`}
      onClick={onClick}
      className="flex items-center justify-between p-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] transition cursor-pointer gap-3 shadow-2xs"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="px-2 py-0.5 rounded-md text-[11px] font-bold shrink-0"
          style={{ backgroundColor: palette.bg, color: palette.color }}
        >
          {a.courseId || "EXAM"}
        </span>

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-xs font-bold text-[var(--text)] truncate">{a.title}</h4>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] font-semibold">
              {a.assessmentType}
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] mt-0.5">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 shrink-0" />
              <span>{a.dateIso || copy.assessmentDetail.missingValue}</span>
            </span>
            {a.room && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" />
                <span>Room {a.room}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Chips: Conflict, Score, Urgency, Warnings */}
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
        {a.conflictWarning && (
          <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-700 dark:text-red-300 text-[10px] font-bold">
            Conflict
          </span>
        )}

        {a.achievedScore != null && a.maxScore != null && (
          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold tabular-nums">
            {a.achievedScore}/{a.maxScore}
          </span>
        )}

        <span className="px-2 py-0.5 rounded-full bg-[var(--surface-hover)] text-[10px] font-bold text-[var(--text)] uppercase">
          {a.urgencyLevel}
        </span>

        {/* Up to 2 warnings */}
        {a.warnings?.slice(0, 2).map((w, i) => (
          <span
            key={i}
            className="hidden sm:inline-flex px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[9px] font-semibold truncate max-w-[120px]"
            title={w}
          >
            {w}
          </span>
        ))}
      </div>
    </div>
  );
};
