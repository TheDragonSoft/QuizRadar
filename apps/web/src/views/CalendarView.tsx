import React, { useMemo, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Trash2 } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { coursePalette } from "../lib/coursePalette";
import {
  START_HOUR,
  END_HOUR,
  HOUR_HEIGHT,
  computeBlockPosition,
  assignOverlapLanes,
  getClampedDayWindow,
  type CalendarLaneItem,
} from "../lib/calendarLanes";
import { rpc } from "../state/rpc";
import type { Assessment, ScheduleSlot, CustomCalendarEvent } from "../state/types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CalendarBlockItem extends CalendarLaneItem {
  kind: "merged_exam" | "standalone_exam" | "class_slot" | "custom_event";
  title: string;
  courseId?: string | null;
  courseName?: string | null;
  assessmentType?: string | null;
  room?: string | null;
  group?: string | null;
  startTime: string;
  endTime: string;
  assessmentId?: string | null;
  colorHex: string;
  bgHex: string;
}

export const CalendarView: React.FC = () => {
  const currentWeekStartStr = useAppStore((s) => s.currentWeekStart);
  const selectedDateStr = useAppStore((s) => s.selectedCalendarDate);
  const shiftWeek = useAppStore((s) => s.shiftWeek);
  const jumpToToday = useAppStore((s) => s.jumpToToday);
  const setSelectedCalendarDate = useAppStore((s) => s.setSelectedCalendarDate);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);
  const refreshState = useAppStore((s) => s.refreshState);
  const addToast = useAppStore((s) => s.addToast);

  const schedule = useAppStore((s) => s.data.schedule);
  const assessments = useAppStore((s) => s.data.assessments);
  const customEvents = useAppStore((s) => s.data.config.customEvents) || [];
  const layers = useAppStore((s) => s.layers);
  const selectedCourseIds = useAppStore((s) => s.selectedCourseIds);

  const [isNarrow, setIsNarrow] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );

  useEffect(() => {
    const handleResize = () => {
      setIsNarrow(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const currentWeekStart = useMemo(
    () => new Date(currentWeekStartStr + "T00:00:00"),
    [currentWeekStartStr],
  );
  const selectedDate = useMemo(() => new Date(selectedDateStr + "T00:00:00"), [selectedDateStr]);

  const { dayOffset, dayCount } = useMemo(
    () => getClampedDayWindow(currentWeekStart, selectedDate, isNarrow),
    [currentWeekStart, selectedDate, isNarrow],
  );

  // Generate date array for the week (7 days)
  const allWeekDates = useMemo(() => {
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(currentWeekStart);
      d.setDate(currentWeekStart.getDate() + i);
      dates.push(d);
    }
    return dates;
  }, [currentWeekStart]);

  // Displayed dates (clamped 3 days on mobile or all 7 on desktop)
  const displayedDates = useMemo(
    () => allWeekDates.slice(dayOffset, dayOffset + dayCount),
    [allWeekDates, dayOffset, dayCount],
  );

  // Format header title e.g. "Oct 19 – Oct 25, 2026"
  const headerRangeTitle = useMemo(() => {
    const start = allWeekDates[0];
    const end = allWeekDates[6];
    const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endStr = end.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${startStr} – ${endStr}`;
  }, [allWeekDates]);

  const isCourseSelected = (courseId?: string | null) => {
    if (!courseId || selectedCourseIds === null) return true;
    return selectedCourseIds.includes(courseId);
  };

  const handleDeleteCustomEvent = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await rpc("delete_custom_event", { id });
      await refreshState();
      addToast({ type: "success", message: "Event removed" });
    } catch (err) {
      addToast({
        type: "error",
        message: `Failed to remove event: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // Generate hourly time slots for the gutter
  const hours = useMemo(() => {
    const list: string[] = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      list.push(`${String(h).padStart(2, "0")}:00`);
    }
    return list;
  }, []);

  return (
    <div data-testid="calendar-view" className="space-y-4">
      {/* Calendar Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--surface-border)] pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-white shadow-xs">
            <CalendarIcon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-base font-bold text-[var(--text)]">{headerRangeTitle}</h1>
            <p className="text-xs text-[var(--text-muted)]">
              {schedule.semester || "Semester Week"}
            </p>
          </div>
        </div>

        {/* Navigation Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={jumpToToday}
            className="px-3 py-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text)] transition shadow-2xs cursor-pointer"
          >
            {copy.calendar.jumpToToday}
          </button>
          <div className="flex items-center border border-[var(--surface-border)] rounded-xl overflow-hidden bg-[var(--surface)]">
            <button
              type="button"
              onClick={() => shiftWeek(-1)}
              aria-label={copy.calendar.prevWeek}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="h-4 w-[1px] bg-[var(--surface-border)]" />
            <button
              type="button"
              onClick={() => shiftWeek(1)}
              aria-label={copy.calendar.nextWeek}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Week Grid Container */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] overflow-hidden shadow-xs">
        {/* Days Header Row */}
        <div className="flex border-b border-[var(--surface-border)] bg-[var(--surface-hover)]">
          {/* Time Gutter Spacer */}
          <div className="w-14 shrink-0 border-r border-[var(--surface-border)]" />

          {/* Day Header Cells */}
          <div
            className="grid flex-1"
            style={{ gridTemplateColumns: `repeat(${displayedDates.length}, minmax(0, 1fr))` }}
          >
            {displayedDates.map((date) => {
              const iso = date.toISOString().slice(0, 10);
              const isSelected = iso === selectedDateStr;
              const isToday = iso === new Date().toISOString().slice(0, 10);

              return (
                <div
                  key={iso}
                  onClick={() => setSelectedCalendarDate(iso)}
                  className={`py-2 px-1 text-center cursor-pointer transition border-r border-[var(--surface-border)] last:border-r-0 ${
                    isSelected ? "bg-[var(--accent)]/10" : "hover:bg-[var(--surface)]"
                  }`}
                >
                  <div
                    className={`text-[11px] font-semibold ${isToday ? "text-[var(--accent)] font-bold" : "text-[var(--text-muted)]"}`}
                  >
                    {DAY_NAMES[date.getDay()]}
                  </div>
                  <div
                    className={`mt-0.5 mx-auto h-7 w-7 rounded-full flex items-center justify-center text-xs tabular-nums font-bold transition ${
                      isSelected
                        ? "bg-[var(--accent)] text-white shadow-2xs"
                        : isToday
                          ? "border border-[var(--accent)] text-[var(--accent)]"
                          : "text-[var(--text)]"
                    }`}
                  >
                    {date.getDate()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Scrollable Hours & Columns Area */}
        <div className="relative flex overflow-x-auto max-h-[680px]">
          {/* Time Gutter Column */}
          <div
            data-testid="calendar-time-gutter"
            className="w-14 shrink-0 border-r border-[var(--surface-border)] bg-[var(--surface-hover)] select-none"
          >
            {hours.map((hour) => (
              <div
                key={hour}
                style={{ height: HOUR_HEIGHT }}
                className="text-[10px] text-[var(--text-muted)] font-semibold text-right pr-2 pt-1 border-b border-[var(--surface-border)]/40 tabular-nums"
              >
                {hour}
              </div>
            ))}
          </div>

          {/* Day Columns */}
          <div
            data-testid="calendar-columns-grid"
            className="grid flex-1 relative"
            style={{
              gridTemplateColumns: `repeat(${displayedDates.length}, minmax(0, 1fr))`,
              minWidth: displayedDates.length * (isNarrow ? 100 : 120),
            }}
          >
            {displayedDates.map((date) => {
              const iso = date.toISOString().slice(0, 10);
              const dayIndex = date.getDay();

              return (
                <DayColumn
                  key={iso}
                  dateIso={iso}
                  dayIndex={dayIndex}
                  hoursCount={hours.length}
                  scheduleSlots={schedule.slots || []}
                  assessments={assessments || []}
                  customEvents={customEvents}
                  showExams={layers.exams}
                  showClasses={layers.classes}
                  isCourseSelected={isCourseSelected}
                  onOpenAssessmentDetail={openAssessmentDetail}
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

// ---------------------------------------------------------------------------
// Memoized Day Column (Perf Guard: Prevents full week re-renders on edits)
// ---------------------------------------------------------------------------

interface DayColumnProps {
  dateIso: string;
  dayIndex: number;
  hoursCount: number;
  scheduleSlots: ScheduleSlot[];
  assessments: Assessment[];
  customEvents: CustomCalendarEvent[];
  showExams: boolean;
  showClasses: boolean;
  isCourseSelected: (courseId?: string | null) => boolean;
  onOpenAssessmentDetail: (id: string) => void;
  onDeleteCustomEvent: (id: string, e: React.MouseEvent) => void;
}

export const DayColumn: React.FC<DayColumnProps> = React.memo(
  ({
    dateIso,
    dayIndex,
    hoursCount,
    scheduleSlots,
    assessments,
    customEvents,
    showExams,
    showClasses,
    isCourseSelected,
    onOpenAssessmentDetail,
    onDeleteCustomEvent,
  }) => {
    // 1. Gather Day Items
    const dayItems: CalendarBlockItem[] = useMemo(() => {
      const items: CalendarBlockItem[] = [];

      // Day slots
      const daySlots = scheduleSlots.filter(
        (s) => s.dayIndex === dayIndex && isCourseSelected(s.courseId),
      );

      // Day assessments
      const dayExams = assessments.filter(
        (a) => a.dateIso === dateIso && isCourseSelected(a.courseId),
      );

      // Day custom events
      const dayCustoms = customEvents.filter(
        (e) => e.dateIso === dateIso && isCourseSelected(e.courseId),
      );

      const matchedExamIds = new Set<string>();

      // 1. Check for Merged Slot + Exam blocks
      if (showClasses && showExams) {
        daySlots.forEach((slot) => {
          const overlappingExam = dayExams.find((ex) => {
            if (matchedExamIds.has(ex.id)) return false;
            if (ex.courseId !== slot.courseId) return false;
            // Overlaps if exam time matches or slot has quiz
            return (
              slot.hasQuiz ||
              (ex.startTime &&
                slot.startTime &&
                ex.startTime >= slot.startTime &&
                ex.startTime < slot.endTime)
            );
          });

          if (overlappingExam) {
            matchedExamIds.add(overlappingExam.id);
            const pos = computeBlockPosition(slot.startTime, slot.endTime);
            const palette = coursePalette(slot.courseId);
            items.push({
              id: `merged-${slot.id}-${overlappingExam.id}`,
              kind: "merged_exam",
              topPx: pos.topPx,
              heightPx: pos.heightPx,
              title: overlappingExam.title,
              courseId: slot.courseId,
              courseName: slot.courseName,
              assessmentType: overlappingExam.assessmentType,
              room: slot.room || overlappingExam.room,
              group: slot.group,
              startTime: slot.startTime,
              endTime: slot.endTime,
              assessmentId: overlappingExam.id,
              colorHex: palette.color,
              bgHex: palette.bg,
            });
          } else {
            // Plain class slot
            const pos = computeBlockPosition(slot.startTime, slot.endTime);
            const palette = coursePalette(slot.courseId);
            items.push({
              id: `slot-${slot.id}`,
              kind: "class_slot",
              topPx: pos.topPx,
              heightPx: pos.heightPx,
              title: slot.type || "Lecture",
              courseId: slot.courseId,
              courseName: slot.courseName,
              room: slot.room,
              group: slot.group,
              startTime: slot.startTime,
              endTime: slot.endTime,
              colorHex: palette.color,
              bgHex: palette.bg,
            });
          }
        });
      } else if (showClasses) {
        // Classes only
        daySlots.forEach((slot) => {
          const pos = computeBlockPosition(slot.startTime, slot.endTime);
          const palette = coursePalette(slot.courseId);
          items.push({
            id: `slot-${slot.id}`,
            kind: "class_slot",
            topPx: pos.topPx,
            heightPx: pos.heightPx,
            title: slot.type || "Lecture",
            courseId: slot.courseId,
            courseName: slot.courseName,
            room: slot.room,
            group: slot.group,
            startTime: slot.startTime,
            endTime: slot.endTime,
            colorHex: palette.color,
            bgHex: palette.bg,
          });
        });
      }

      // 2. Standalone Assessments
      if (showExams) {
        dayExams.forEach((exam) => {
          if (matchedExamIds.has(exam.id)) return;
          const pos = computeBlockPosition(exam.startTime || "09:00", exam.endTime || "10:30");
          const palette = coursePalette(exam.courseId || "GENERAL");
          items.push({
            id: `exam-${exam.id}`,
            kind: "standalone_exam",
            topPx: pos.topPx,
            heightPx: pos.heightPx,
            title: exam.title,
            courseId: exam.courseId,
            courseName: exam.courseName,
            assessmentType: exam.assessmentType,
            room: exam.room,
            startTime: exam.startTime || "09:00",
            endTime: exam.endTime || "10:30",
            assessmentId: exam.id,
            colorHex: palette.color,
            bgHex: palette.bg,
          });
        });
      }

      // 3. Custom Calendar Events (Pink palette or Emerald for study blocks)
      dayCustoms.forEach((ev) => {
        const pos = computeBlockPosition(ev.startTime || "10:00", ev.endTime || "11:30");
        const isStudyBlock = ev.id.startsWith("study-block-") || ev.id.startsWith("study_block_");
        items.push({
          id: `custom-${ev.id}`,
          kind: "custom_event",
          topPx: pos.topPx,
          heightPx: pos.heightPx,
          title: ev.title,
          courseId: ev.courseId,
          room: ev.room,
          startTime: ev.startTime || "10:00",
          endTime: ev.endTime || "11:30",
          colorHex: isStudyBlock ? "#10b981" : "#db2777",
          bgHex: isStudyBlock ? "#d1fae5" : "#fce7f3",
        });
      });

      // Assign overlap lanes
      return assignOverlapLanes(items);
    }, [
      dateIso,
      dayIndex,
      scheduleSlots,
      assessments,
      customEvents,
      showClasses,
      showExams,
      isCourseSelected,
    ]);

    return (
      <div
        data-testid={`calendar-day-col-${dateIso}`}
        className="relative border-r border-[var(--surface-border)] last:border-r-0 select-none"
        style={{ height: hoursCount * HOUR_HEIGHT }}
      >
        {/* Background Hour Grid Lines */}
        {Array.from({ length: hoursCount }).map((_, i) => (
          <div
            key={i}
            style={{ height: HOUR_HEIGHT }}
            className="border-b border-[var(--surface-border)]/40 pointer-events-none"
          />
        ))}

        {/* Calendar Blocks */}
        {dayItems.map((item) => {
          const laneCount = item.laneCount || 1;
          const laneIndex = item.laneIndex || 0;
          const widthPct = 100 / laneCount;
          const leftPct = laneIndex * widthPct;

          const style: React.CSSProperties = {
            top: item.topPx,
            height: item.heightPx,
            position: "absolute",
            zIndex: item.kind === "merged_exam" ? 12 : item.kind === "standalone_exam" ? 10 : 5,
            ...(laneCount === 1
              ? { left: "4px", right: "4px" }
              : { left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)` }),
          };

          if (item.kind === "merged_exam") {
            return (
              <div
                key={item.id}
                style={style}
                onClick={() => item.assessmentId && onOpenAssessmentDetail(item.assessmentId)}
                className="rounded-xl border border-red-500 bg-[var(--surface)] p-2 shadow-xs transition hover:scale-[1.01] hover:shadow-md cursor-pointer overflow-hidden has-exam-glow"
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className="px-1.5 py-0.2 rounded text-[9px] font-bold"
                    style={{ backgroundColor: item.bgHex, color: item.colorHex }}
                  >
                    {item.courseId}
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-red-600 text-white text-[9px] font-bold truncate">
                    {item.assessmentType}
                  </span>
                </div>
                <div className="mt-1 text-xs font-bold text-red-700 dark:text-red-300 truncate">
                  {item.title}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] truncate flex items-center gap-1 mt-0.5">
                  <Clock className="h-2.5 w-2.5 shrink-0" />
                  <span>
                    {item.startTime} – {item.endTime}
                  </span>
                  {item.room && <span>• {item.room}</span>}
                </div>
              </div>
            );
          }

          if (item.kind === "standalone_exam") {
            return (
              <div
                key={item.id}
                style={style}
                onClick={() => item.assessmentId && onOpenAssessmentDetail(item.assessmentId)}
                className="rounded-xl border border-[var(--accent)] bg-[var(--surface)] p-2 shadow-xs transition hover:scale-[1.01] hover:shadow-md cursor-pointer overflow-hidden"
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className="px-1.5 py-0.2 rounded text-[9px] font-bold"
                    style={{ backgroundColor: item.bgHex, color: item.colorHex }}
                  >
                    {item.courseId}
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-[var(--surface-hover)] text-[10px] font-semibold text-[var(--text-muted)] truncate">
                    {item.assessmentType}
                  </span>
                </div>
                <div className="mt-0.5 text-xs font-bold text-[var(--text)] truncate">
                  {item.title}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] truncate flex items-center gap-1 mt-0.5">
                  <Clock className="h-2.5 w-2.5 shrink-0" />
                  <span>
                    {item.startTime} – {item.endTime}
                  </span>
                </div>
              </div>
            );
          }

          if (item.kind === "custom_event") {
            return (
              <div
                key={item.id}
                className="rounded-xl border p-2 shadow-xs overflow-hidden transition group"
                style={{
                  ...style,
                  borderColor: item.colorHex,
                  backgroundColor: item.bgHex,
                }}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-bold truncate" style={{ color: item.colorHex }}>
                    {item.title}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => onDeleteCustomEvent(item.id.replace("custom-", ""), e)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-muted)] hover:text-red-600 transition"
                    title="Delete event"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <div className="text-[9px] text-[var(--text-muted)] truncate">
                  {item.startTime} – {item.endTime}
                </div>
              </div>
            );
          }

          // Plain class slot
          return (
            <div
              key={item.id}
              style={style}
              className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-2 shadow-xs transition hover:bg-[var(--surface-hover)] overflow-hidden"
            >
              <div className="flex items-center gap-1">
                <span
                  className="px-1.5 py-0.2 rounded text-[9px] font-bold"
                  style={{ backgroundColor: item.bgHex, color: item.colorHex }}
                >
                  {item.courseId}
                </span>
                <span className="text-[9px] text-[var(--text-muted)] font-semibold truncate">
                  {item.title}
                </span>
              </div>
              {item.courseName && (
                <div className="text-[10px] font-medium text-[var(--text)] truncate mt-0.5">
                  {item.courseName}
                </div>
              )}
              <div className="text-[9px] text-[var(--text-muted)] truncate mt-0.5">
                {item.startTime} – {item.endTime} {item.room ? `• ${item.room}` : ""}
              </div>
            </div>
          );
        })}
      </div>
    );
  },
);

DayColumn.displayName = "DayColumn";
