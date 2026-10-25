import React from "react";
import { Calendar, CheckSquare, Clock, Layers, LayoutDashboard, Radio, Timer } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { computeSyncStatusSummary } from "../state/syncStatus";
import type { View } from "../state/types";
import { MiniCalendar } from "./MiniCalendar";

declare const __APP_VERSION__: string;

const NAV_ITEMS: ReadonlyArray<{
  id: View;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "dashboard", label: copy.nav.dashboard, icon: LayoutDashboard },
  { id: "tasks", label: copy.nav.tasks, icon: CheckSquare },
  { id: "calendar", label: copy.nav.calendar, icon: Calendar },
  { id: "focus", label: copy.nav.focus, icon: Timer },
];

export const Sidebar: React.FC = () => {
  const currentView = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const selectedCourseIds = useAppStore((s) => s.selectedCourseIds);
  const toggleCourseFilter = useAppStore((s) => s.toggleCourseFilter);
  const layers = useAppStore((s) => s.layers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const config = useAppStore((s) => s.data.config);
  const auth = useAppStore((s) => s.data.auth);
  const triggerSync = useAppStore((s) => s.triggerSync);
  const syncStatus = useAppStore((s) => s.syncStatus);
  const assessments = useAppStore((s) => s.data.assessments);

  const syncSummary = computeSyncStatusSummary(config, auth);

  const assessmentDates = assessments.map((a) => a.dateIso).filter((d): d is string => Boolean(d));

  const appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "5.0.0";

  return (
    <aside
      data-testid="app-sidebar"
      aria-label="Main sidebar"
      className="hidden lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-[var(--surface-border)] lg:bg-[var(--surface)] transition-colors select-none"
    >
      {/* Brand Header */}
      <div className="flex h-14 items-center justify-between border-b border-[var(--surface-border)] px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-white shadow-sm">
            <Radio className="h-4 w-4" aria-hidden="true" />
          </div>
          <span className="font-bold tracking-tight text-[var(--text)]">{copy.brand.name}</span>
        </div>
        <span
          data-testid="version-badge"
          className="rounded-full bg-[var(--page)] border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]"
        >
          v{appVersion}
        </span>
      </div>

      {/* Scrollable Center Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Navigation Tabs */}
        <nav aria-label="Sidebar navigation" className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                aria-current={isActive ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  isActive
                    ? "bg-[var(--accent)] text-white shadow-sm"
                    : "text-[var(--text)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${isActive ? "text-white" : "text-[var(--text-muted)]"}`}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Mini Month Calendar */}
        <MiniCalendar assessmentDates={assessmentDates} />

        {/* Course Filter Checkboxes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {copy.sidebar.coursesHeader} ({courses.length})
            </span>
          </div>

          {courses.length === 0 ? (
            <p className="px-1 text-xs text-[var(--text-muted)] italic">
              {copy.sidebar.noCoursesEnrolled}
            </p>
          ) : (
            <div className="space-y-1">
              {courses.map((course) => {
                const isSelected =
                  selectedCourseIds === null || selectedCourseIds.includes(course.id);
                return (
                  <label
                    key={course.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-hover)] transition"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleCourseFilter(course.id)}
                      className="h-3.5 w-3.5 rounded border-[var(--surface-border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    />
                    <span
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: course.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium">
                      {course.id} <span className="opacity-75 font-normal">· {course.name}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Layer Toggles */}
        <div className="space-y-2 border-t border-[var(--surface-border)] pt-3">
          <div className="flex items-center gap-1.5 px-1">
            <Layers className="h-3 w-3 text-[var(--text-muted)]" aria-hidden="true" />
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {copy.sidebar.layersHeader}
            </span>
          </div>
          <div className="space-y-1">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-hover)] transition">
              <input
                type="checkbox"
                checked={layers.exams}
                onChange={() => toggleLayer("exams")}
                className="h-3.5 w-3.5 rounded border-[var(--surface-border)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              <span>{copy.sidebar.layerExams}</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-hover)] transition">
              <input
                type="checkbox"
                checked={layers.classes}
                onChange={() => toggleLayer("classes")}
                className="h-3.5 w-3.5 rounded border-[var(--surface-border)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              <span>{copy.sidebar.layerClasses}</span>
            </label>
          </div>
        </div>
      </div>

      {/* Sync Honesty Footer */}
      <div
        data-testid="sync-honesty-footer"
        className="border-t border-[var(--surface-border)] bg-[var(--page)] p-3"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                syncSummary.statusVariant === "active"
                  ? "bg-emerald-500 shadow-sm"
                  : syncSummary.statusVariant === "warning"
                    ? "bg-amber-500"
                    : "bg-slate-400"
              }`}
              aria-hidden="true"
            />
            <span className="text-xs font-semibold text-[var(--text)]">{syncSummary.label}</span>
          </div>

          <button
            type="button"
            onClick={() => triggerSync()}
            disabled={syncStatus === "syncing"}
            className="text-[11px] font-semibold text-[var(--accent)] hover:underline disabled:opacity-50"
          >
            {copy.sidebar.syncFooter.syncNow}
          </button>
        </div>

        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <Clock className="h-3 w-3" aria-hidden="true" />
          <span>{syncSummary.lastSyncedText}</span>
        </div>
      </div>
    </aside>
  );
};
