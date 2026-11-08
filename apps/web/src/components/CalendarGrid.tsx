import React, { useMemo } from "react";
import { useAppStore } from "../state/store";
import {
  START_HOUR,
  END_HOUR,
  DAY_ABBR,
  hourLabel,
  stripCoursePrefix,
  toIsoLocal,
  matchesGlobalSearch,
} from "../lib/calendarLanes";
import { courseAccessibleChip, courseDisplayName } from "../lib/coursePalette";
import { DayColumn, localUtcOffsetLabel, resolvePalette } from "../views/CalendarView";
import type { Assessment, Course } from "../state/types";

export interface CalendarGridProps {
  displayedDates?: Date[];
  compactMode?: boolean;
  className?: string;
  onSelectAssessment?: (id: string) => void;
  onSelectDate?: (dateIso: string) => void;
}

export const CalendarGrid: React.FC<CalendarGridProps> = ({
  displayedDates: propDates,
  compactMode = false,
  className = "",
  onSelectAssessment,
  onSelectDate,
}) => {
  const currentWeekStartStr = useAppStore((s) => s.currentWeekStart);
  const selectedDateStr = useAppStore((s) => s.selectedCalendarDate);
  const setSelectedCalendarDate = useAppStore((s) => s.setSelectedCalendarDate);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);
  const openEventModal = useAppStore((s) => s.openEventModal);
  const deleteCustomEvent = useAppStore((s) => s.deleteCustomEvent);
  const addToast = useAppStore((s) => s.addToast);

  const schedule = useAppStore((s) => s.data.schedule);
  const assessments = useAppStore((s) => s.data.assessments || []);
  const customEvents = useAppStore((s) => s.data.config.customEvents || []);
  const layers = useAppStore((s) => s.layers);
  const selectedCourseIds = useAppStore((s) => s.selectedCourseIds);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const theme = useAppStore((s) => s.theme);

  // Derive 7-day week if no dates provided
  const dates = useMemo(() => {
    if (propDates && propDates.length > 0) return propDates;
    const start = new Date(currentWeekStartStr + "T00:00:00");
    const list: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      list.push(d);
    }
    return list;
  }, [propDates, currentWeekStartStr]);

  const coursesById = useMemo(() => {
    const map = new Map<string, Course>();
    (schedule.courses || []).forEach((c) => map.set(c.id, c));
    return map;
  }, [schedule.courses]);

  const isCourseSelected = useCallback(
    (courseId?: string | null) => {
      if (!courseId) return true;
      if (selectedCourseIds === null) return true;
      return selectedCourseIds.includes(courseId);
    },
    [selectedCourseIds],
  );

  const hours = useMemo(() => {
    const list: number[] = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      list.push(h);
    }
    return list;
  }, []);

  const todayIso = toIsoLocal(new Date());

  // Exam overlay chips for day headers
  const headerExamsByDate = useMemo(() => {
    const map = new Map<string, Assessment[]>();
    if (!layers.exams) return map;
    assessments.forEach((a) => {
      if (!a.dateIso || !isCourseSelected(a.courseId)) return;
      if (!matchesGlobalSearch(searchQuery, a.courseId, a.courseName, a.title)) return;
      const list = map.get(a.dateIso) || [];
      list.push(a);
      map.set(a.dateIso, list);
    });
    return map;
  }, [assessments, layers.exams, searchQuery, isCourseSelected]);

  const handleAssessmentClick = (id: string) => {
    if (onSelectAssessment) {
      onSelectAssessment(id);
    } else {
      openAssessmentDetail(id);
    }
  };

  const handleDateClick = (iso: string) => {
    if (onSelectDate) {
      onSelectDate(iso);
    } else {
      setSelectedCalendarDate(iso);
    }
  };

  const handleDeleteCustomEvent = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteCustomEvent(id);
      addToast({ type: "success", message: "Event removed" });
    } catch (err) {
      addToast({
        type: "error",
        message: `Failed to remove event: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  return (
    <div
      data-testid="calendar-grid"
      className={`rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] overflow-x-auto overflow-y-auto min-h-0 shadow-xs relative ${className}`}
    >
      <div className="min-w-fit">
        {/* Header Row: Days */}
        <div
          data-testid="calendar-header-row"
          className="sticky top-0 z-30 flex border-b border-[var(--surface-border)] bg-[var(--surface)] shadow-xs"
        >
          {/* Timezone Gutter Corner */}
          <div className="w-14 sm:w-16 shrink-0 border-r border-[var(--surface-border)] p-2 flex items-center justify-center text-[10px] font-semibold text-[var(--text-muted)] select-none">
            <span>{localUtcOffsetLabel()}</span>
          </div>

          {/* Day Header Cells */}
          <div
            className="flex-1 grid"
            style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))` }}
          >
            {dates.map((date) => {
              const iso = toIsoLocal(date);
              const isSelected = iso === selectedDateStr;
              const isToday = iso === todayIso;
              const dayExams = headerExamsByDate.get(iso) || [];

              return (
                <div
                  key={iso}
                  className="border-r border-[var(--surface-border)] last:border-r-0 py-2 sm:py-2.5 px-1 sm:px-2 text-center"
                >
                  <button
                    type="button"
                    onClick={() => handleDateClick(iso)}
                    aria-pressed={isSelected}
                    className={`w-full rounded-md py-1 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] cursor-pointer ${
                      isSelected ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    <div
                      className={`text-[11px] sm:text-xs font-semibold ${
                        isToday
                          ? "text-[var(--accent-ink)] font-bold"
                          : isSelected
                            ? "text-[var(--accent-ink)]"
                            : "text-[var(--text-muted)]"
                      }`}
                    >
                      {DAY_ABBR[date.getDay()]}
                    </div>
                    <div
                      className={`mt-0.5 sm:mt-1 w-7 h-7 sm:w-9 sm:h-9 mx-auto rounded-full flex items-center justify-center text-sm sm:text-lg tabular-nums ${
                        isSelected
                          ? "bg-[var(--accent-fill)] text-white font-semibold"
                          : isToday
                            ? "border-2 border-[var(--accent-ink)] text-[var(--accent-ink)] font-bold"
                            : "text-[var(--text)] font-medium"
                      }`}
                    >
                      {date.getDate()}
                    </div>
                  </button>
                  {dayExams.length > 0 && (
                    <div className="mt-1 flex flex-col gap-0.5">
                      {dayExams.map((ex) => {
                        const palette = resolvePalette(ex.courseId, coursesById, {
                          color: ex.color,
                          bg: ex.bg,
                          border: ex.border,
                        });
                        const chip = courseAccessibleChip(palette.color, theme === "dark");
                        return (
                          <div
                            key={ex.id}
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAssessmentClick(ex.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                handleAssessmentClick(ex.id);
                              }
                            }}
                            className="text-[10px] sm:text-[11px] font-bold px-1 py-0.5 rounded-md line-clamp-1 sm:line-clamp-2 text-left text-white hover:opacity-90 transition cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                            style={{ backgroundColor: chip.solidBg }}
                            title={`${courseDisplayName(ex.courseId, coursesById)}: ${stripCoursePrefix(ex.title, ex.courseId)}`}
                          >
                            {courseDisplayName(ex.courseId, coursesById)}:{" "}
                            {stripCoursePrefix(ex.title, ex.courseId)}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Calendar Body: Hours Gutter + Day Columns */}
        <div className="flex relative">
          {/* Time Gutter */}
          <div
            data-testid="calendar-time-gutter"
            className="w-14 sm:w-16 shrink-0 border-r border-[var(--surface-border)] bg-[var(--surface)] select-none"
          >
            {hours.map((hour) => (
              <div key={hour} className="hour-row relative pr-1.5 sm:pr-2 text-right">
                <span className="text-[10px] sm:text-[11px] tabular-nums text-[var(--text-muted)] -top-2 relative">
                  {hourLabel(hour)}
                </span>
              </div>
            ))}
          </div>

          {/* Day Columns */}
          <div
            data-testid="calendar-columns-grid"
            className="flex-1 grid relative"
            style={{
              gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))`,
              minWidth: dates.length * (compactMode ? 95 : 125),
            }}
          >
            {dates.map((date) => {
              const iso = toIsoLocal(date);
              const dayIndex = date.getDay();

              return (
                <DayColumn
                  key={iso}
                  dateIso={iso}
                  dayIndex={dayIndex}
                  hoursCount={hours.length}
                  scheduleSlots={schedule.slots || []}
                  assessments={assessments}
                  customEvents={customEvents}
                  coursesById={coursesById}
                  showExams={layers.exams}
                  showClasses={layers.classes}
                  isCourseSelected={isCourseSelected}
                  searchQuery={searchQuery}
                  onOpenAssessmentDetail={handleAssessmentClick}
                  onOpenEvent={openEventModal}
                  onDeleteCustomEvent={handleDeleteCustomEvent}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
