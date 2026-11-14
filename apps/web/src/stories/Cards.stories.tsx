import type { Story, StoryDefault } from "@ladle/react";
import { CalendarGrid } from "../components/CalendarGrid";
import { DailyStudyRoadmap } from "../components/DailyStudyRoadmap";
import { StudyStatsCard } from "../components/StudyStatsCard";
import { TimelineHorizon } from "../components/TimelineHorizon";
import {
  AllClearEmpty,
  FirstRunEmpty,
  SearchNoMatchesEmpty,
} from "../views/dashboard/DashboardEmptyStates";
import { NextUpHero } from "../views/dashboard/NextUpHero";
import { StudyRecommendationCard } from "../views/dashboard/StudyRecommendationCard";
import { TimelineRow } from "../views/dashboard/TimelineRow";
import { useAppStore } from "../state/store";
import { getWeekStart } from "../state/dateUtils";
import { seedWorkbench } from "./workbenchFixtures";

export default { title: "Cards" } satisfies StoryDefault;

const noop = () => undefined;

/** The week grid: timetable lanes, assessment pins, custom events. */
export const CalendarGridLoaded: Story = () => {
  seedWorkbench();
  return (
    <div className="p-4">
      <CalendarGrid />
    </div>
  );
};

/** The daily study roadmap: day groups, tasks, reasoning, estimates. */
export const DailyStudyRoadmapLoaded: Story = () => {
  seedWorkbench();
  return (
    <div className="p-4">
      <DailyStudyRoadmap />
    </div>
  );
};

/** Local-first study stats (focus minutes, readiness, streak) — full card. */
export const StudyStatsFull: Story = () => {
  seedWorkbench();
  return (
    <div className="max-w-2xl p-4">
      <StudyStatsCard />
    </div>
  );
};

/** The compact stats strip used in tighter shells. */
export const StudyStatsCompact: Story = () => {
  seedWorkbench();
  return (
    <div className="max-w-2xl p-4">
      <StudyStatsCard variant="compact" />
    </div>
  );
};

/**
 * The dashboard's logarithmic exam timeline, wired with the fixture's real
 * dashboard slices (assessments, recommendations, conflicts, counts).
 */
export const TimelineHorizonLoaded: Story = () => {
  seedWorkbench();
  const data = useAppStore.getState().data;
  const dashboard = data.dashboard;
  const upcoming = dashboard.allUpcoming.length
    ? dashboard.allUpcoming
    : data.assessments.filter((a) => a.isUpcoming);
  const weeks = new Set(
    upcoming.map((a) => (a.dateIso ? getWeekStart(a.dateIso) : "")).filter(Boolean),
  );
  const dates = upcoming
    .map((a) => a.dateIso)
    .filter((d): d is string => Boolean(d))
    .sort();
  return (
    <div className="p-4">
      <TimelineHorizon
        assessments={upcoming}
        recommendations={dashboard.studyRecommendations}
        conflictAlerts={dashboard.conflictAlerts}
        weekCount={weeks.size || 1}
        examsAheadCount={
          upcoming.filter((a) => (a.assessmentType || "").toLowerCase().includes("exam")).length
        }
        readinessPct={dashboard.readinessPercent}
        totalTopicsCount={dashboard.totalTopicsCount}
        completedTopicsCount={dashboard.completedTopicsCount}
        typeBreakdown={Object.entries(dashboard.examTypeCounts)}
        auth={data.auth}
        config={data.config}
        activeSourceCount={Object.values(dashboard.sourcesCount).reduce((a, b) => a + b, 0)}
        lastSyncText={
          data.config.lastGmailSync
            ? `Gmail · ${data.config.lastGmailSync.slice(0, 10)}`
            : "Never synced"
        }
        weekRangeLabel={dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : undefined}
        onOpenDetail={noop}
        onRunGcalSync={noop}
        onOpenConnect={noop}
        onOpenAddCourse={noop}
      />
    </div>
  );
};

/** The "up next" hero with the fixture's next assessment. */
export const NextUpHeroLoaded: Story = () => {
  seedWorkbench();
  const nextUp = useAppStore.getState().data.dashboard.nextUp ?? null;
  return (
    <div className="p-4">
      <NextUpHero
        assessment={nextUp}
        onOpenDetail={noop}
        onOpenCalendar={noop}
        onConnect={noop}
        onSync={noop}
      />
    </div>
  );
};

/** The hero's honest empty state when nothing is scheduled yet. */
export const NextUpHeroEmpty: Story = () => {
  seedWorkbench();
  const data = useAppStore.getState().data;
  useAppStore.setState({
    data: { ...data, dashboard: { ...data.dashboard, nextUp: null } },
  });
  return (
    <div className="p-4">
      <NextUpHero
        assessment={null}
        onOpenDetail={noop}
        onOpenCalendar={noop}
        onConnect={noop}
        onSync={noop}
      />
    </div>
  );
};

/** One study recommendation card with its topic checkboxes. */
export const StudyRecommendationCardLoaded: Story = () => {
  seedWorkbench();
  const data = useAppStore.getState().data;
  const rec = data.dashboard.studyRecommendations[0];
  const room = data.assessments.find((a) => a.id === rec.assessmentId)?.room ?? null;
  return (
    <div className="max-w-2xl p-4">
      <StudyRecommendationCard
        index={0}
        recommendation={rec}
        room={room}
        onToggleTopic={noop}
        onOpenDetail={noop}
      />
    </div>
  );
};

/** A timeline row for the fixture's critical midterm. */
export const TimelineRowCritical: Story = () => {
  seedWorkbench();
  const assessment = useAppStore.getState().data.assessments[0];
  return (
    <div className="max-w-3xl p-4">
      <TimelineRow assessment={assessment} onClick={noop} />
    </div>
  );
};

/** A graded, past assessment row: recorded score + result state. */
export const TimelineRowGraded: Story = () => {
  seedWorkbench();
  const assessment = useAppStore.getState().data.assessments[0];
  return (
    <div className="max-w-3xl p-4">
      <TimelineRow
        assessment={{
          ...assessment,
          achievedScore: 17,
          maxScore: 20,
          isUpcoming: false,
          daysUntil: -5,
          urgencyLevel: "past",
        }}
        onClick={noop}
      />
    </div>
  );
};

/** First-run dashboard: no courses, no sources yet. */
export const FirstRunEmptyState: Story = () => {
  seedWorkbench();
  return (
    <div className="max-w-xl p-4">
      <FirstRunEmpty onAddCourse={noop} onConnect={noop} />
    </div>
  );
};

/** Search active but nothing matched the query. */
export const SearchNoMatchesEmptyState: Story = () => {
  seedWorkbench();
  return (
    <div className="max-w-xl p-4">
      <SearchNoMatchesEmpty
        title="Nothing matches “lab”"
        body="No assessment or topic in your radar matches the current search."
        onClear={noop}
      />
    </div>
  );
};

/** Everything done: the all-clear study panel state. */
export const AllClearEmptyState: Story = () => {
  seedWorkbench();
  return (
    <div className="max-w-xl p-4">
      <AllClearEmpty onCreateEvent={noop} />
    </div>
  );
};
