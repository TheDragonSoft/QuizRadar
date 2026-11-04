import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Download,
  MapPin,
  X,
} from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { courseAccessibleChip, courseDisplayName, coursePalette } from "../lib/coursePalette";
import {
  START_HOUR,
  END_HOUR,
  HOUR_HEIGHT,
  DAY_ABBR,
  computeBlockPosition,
  assignOverlapLanes,
  getClampedDayWindow,
  formatCompactTime,
  hourLabel,
  roomLabel,
  stripCoursePrefix,
  hexToRgba,
  toIsoLocal,
  matchesGlobalSearch,
  type CalendarLaneItem,
} from "../lib/calendarLanes";
import { rpc } from "../state/rpc";
import type { Assessment, Course, ScheduleSlot, CustomCalendarEvent } from "../state/types";

/**
 * Week calendar — v4 parity port (v4-final:static/app.js `renderWeekCalendar`).
 *
 * Visual language copied from v4: the Google-Calendar-style `gcal-card` blocks
 * (course-tinted surface, 1px border, exam glow), the 8 AM – 8 PM gutter with
 * 12-hour labels straddling the hour line, the big day-abbr/date-circle
 * headers with the per-day exam chips, and v4's greedy side-by-side overlap
 * layout.
 *
 * Deliberate v5 deviations (AGENTS §1 honesty doctrine):
 *  - a missing room renders "—" (v4 printed an empty/"TBD" room);
 *  - the gutter shows the device's real UTC offset (v4 hardcoded "GMT+03");
 *  - the mobile window renders 3 columns wide (v4 left 4 empty columns).
 */

interface BlockPalette {
  color: string;
  bg: string;
  border: string;
}

interface CalendarBlockItem extends CalendarLaneItem {
  kind: "merged_exam" | "standalone_exam" | "class_slot" | "custom_event";
  title: string;
  courseId?: string | null;
  courseName?: string | null;
  assessmentType?: string | null;
  room?: string | null;
  group?: string | null;
  instructor?: string | null;
  eventType?: string | null;
  startTime: string;
  endTime: string;
  /** False when the source record had no real time and placement guessed one. */
  timeKnown: boolean;
  assessmentId?: string | null;
  eventId?: string | null;
  event?: CustomCalendarEvent;
  palette: BlockPalette;
}

/** Honest time label: real clock range when the source stated one, an em
 * dash when placement guessed a slot for a time-less record. */
const blockTimeLabel = (item: CalendarBlockItem): string =>
  item.timeKnown
    ? `${formatCompactTime(item.startTime)} – ${formatCompactTime(item.endTime)}`
    : "Time —";

const CUSTOM_EVENT_PALETTE: BlockPalette = {
  color: "#db2777",
  bg: "#fce7f3",
  border: "#db2777",
};

const STUDY_BLOCK_PALETTE: BlockPalette = {
  color: "#10b981",
  bg: "#d1fae5",
  border: "#10b981",
};

function isSolidHex(value?: string | null): boolean {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

/**
 * Palette resolution (v4 semantics): a course's own palette wins, otherwise the
 * deterministic per-course preset. `border` must stay a solid hex so the dark
 * card tint can be derived from it.
 */
function resolvePalette(
  courseId: string | null | undefined,
  courses: Map<string, Course>,
  override?: { color?: string | null; bg?: string | null; border?: string | null },
): BlockPalette {
  const course = courseId ? courses.get(courseId) : undefined;
  const derived = coursePalette(courseId || "");
  const color = override?.color || course?.color || derived.color;
  const bg = override?.bg || course?.bg || `${color}18`;
  const border =
    (isSolidHex(override?.border) ? (override?.border as string) : undefined) ||
    (isSolidHex(course?.border) ? (course?.border as string) : undefined) ||
    color;
  return { color, bg, border };
}

/** Device-local UTC offset label (v4 hardcoded "GMT+03" — that was wrong). */
function localUtcOffsetLabel(): string {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return minutes === 0
    ? `GMT${sign}${hours}`
    : `GMT${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}

export const CalendarView: React.FC = () => {
  const theme = useAppStore((s) => s.theme);
  const currentWeekStartStr = useAppStore((s) => s.currentWeekStart);
  const selectedDateStr = useAppStore((s) => s.selectedCalendarDate);
  const shiftWeek = useAppStore((s) => s.shiftWeek);
  const jumpToToday = useAppStore((s) => s.jumpToToday);
  const setSelectedCalendarDate = useAppStore((s) => s.setSelectedCalendarDate);
  const openAssessmentDetail = useAppStore((s) => s.openAssessmentDetail);
  const openEventModal = useAppStore((s) => s.openEventModal);
  const openSettings = useAppStore((s) => s.openSettings);
  const refreshState = useAppStore((s) => s.refreshState);
  const addToast = useAppStore((s) => s.addToast);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const exportIcs = useAppStore((s) => s.exportIcs);

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

  const coursesById = useMemo(() => {
    const map = new Map<string, Course>();
    (schedule.courses || []).forEach((c) => map.set(c.id, c));
    return map;
  }, [schedule.courses]);

  const todayIso = toIsoLocal(new Date());

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

  const isCourseSelected = useCallback(
    (courseId?: string | null) => {
      if (!courseId) return true;
      if (selectedCourseIds === null) return true;
      return selectedCourseIds.includes(courseId);
    },
    [selectedCourseIds],
  );

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

  // Generate hourly time slots for the gutter (v4: 8 AM – 8 PM inclusive)
  const hours = useMemo(() => {
    const list: number[] = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      list.push(h);
    }
    return list;
  }, []);

  // Per-day exam chips in the header row (v4 `dayExams` overlay chips)
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
  }, [assessments, layers.exams, isCourseSelected, searchQuery]);

  return (
    <div data-testid="calendar-view" className="space-y-4">
      {/* Calendar Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--surface-border)] pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-fill)] text-white shadow-xs">
            <CalendarIcon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-base font-bold text-[var(--text)]">{headerRangeTitle}</h1>
            <p className="text-xs text-[var(--text-muted)]">
              {schedule.semester || "Semester Week"}
            </p>
          </div>
        </div>

        {/* Navigation Actions (compact viewports; lg+ uses TopBar calendar controls) */}
        <div className="flex items-center gap-1.5">
          {/* Export every assessment as one .ics file (01 §4.6 offers
              single/all). Hidden when the radar is empty - an empty export
              would be a file with no events. */}
          {assessments.length > 0 && (
            <button
              type="button"
              onClick={() => void exportIcs()}
              title={copy.calendar.exportAllIcs}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--text)] transition hover:bg-[var(--surface-hover)] active:scale-95 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[var(--accent-ink)]" aria-hidden="true" />
              <span className="hidden sm:inline">{copy.calendar.exportAllIcs}</span>
            </button>
          )}
          <div className="flex items-center gap-1.5 lg:hidden">
            <button
              type="button"
              onClick={jumpToToday}
              className="h-8 px-2.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-xs font-medium text-[var(--text)] transition active:scale-95 cursor-pointer"
            >
              {copy.calendar.jumpToToday}
            </button>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => shiftWeek(-1)}
                aria-label={copy.calendar.prevWeek}
                className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[var(--surface-hover)] text-[var(--text-muted)] transition cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => shiftWeek(1)}
                aria-label={copy.calendar.nextWeek}
                className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[var(--surface-hover)] text-[var(--text-muted)] transition cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Empty State Banner — actionable guidance when 0 courses & 0 events */}
      {(schedule.courses?.length ?? 0) === 0 &&
        assessments.length === 0 &&
        customEvents.length === 0 && (
          <div
            data-testid="calendar-empty-guide"
            className="rounded-2xl border border-[var(--border)] bg-[var(--page)] p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
                <CalendarIcon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-xs font-bold text-[var(--text)]">Your Calendar is Ready</h2>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Add courses, sync your timetable, or record custom study events to see your weekly
                  radar.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => openSettings("courses")}
                className="rounded-xl bg-[var(--accent-fill)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[var(--accent-fill-hover)] transition cursor-pointer active:scale-95"
              >
                + Add Course
              </button>
              <button
                type="button"
                onClick={() => openEventModal()}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition cursor-pointer active:scale-95"
              >
                + Custom Event
              </button>
            </div>
          </div>
        )}

      {/* Week Grid Container */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] overflow-hidden shadow-xs">
        {/* Days Header Row */}
        <div className="flex border-b border-[var(--surface-border)]">
          {/* Time Gutter Header (v4 showed the UTC offset here) */}
          <div className="w-16 shrink-0 border-r border-[var(--surface-border)] flex flex-col justify-end items-center pb-2 text-[11px] tabular-nums text-[var(--text-muted)]">
            <span>{localUtcOffsetLabel()}</span>
          </div>

          {/* Day Header Cells */}
          <div
            className="flex-1 grid"
            style={{ gridTemplateColumns: `repeat(${displayedDates.length}, minmax(0, 1fr))` }}
          >
            {displayedDates.map((date) => {
              const iso = toIsoLocal(date);
              const isSelected = iso === selectedDateStr;
              const isToday = iso === todayIso;
              const dayExams = headerExamsByDate.get(iso) || [];

              return (
                <div
                  key={iso}
                  className="border-r border-[var(--surface-border)] last:border-r-0 py-2.5 px-2 text-center"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedCalendarDate(iso)}
                    aria-pressed={isSelected}
                    className={`w-full rounded-md py-1 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                      isSelected ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    <div
                      className={`text-xs font-semibold ${
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
                      className={`mt-1 w-9 h-9 mx-auto rounded-full flex items-center justify-center text-lg tabular-nums ${
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
                    <div className="mt-1.5 flex flex-col gap-0.5">
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
                              openAssessmentDetail(ex.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                openAssessmentDetail(ex.id);
                              }
                            }}
                            className="text-[11px] font-bold px-1.5 py-0.5 rounded-md line-clamp-2 text-left text-white hover:opacity-90 transition cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
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

        {/* Scrollable Hours & Columns Area */}
        <div className="relative flex overflow-x-auto max-h-[680px] bg-[var(--surface)]">
          {/* Time Gutter Column */}
          <div
            data-testid="calendar-time-gutter"
            className="w-16 shrink-0 border-r border-[var(--surface-border)] bg-[var(--surface)] select-none"
          >
            {hours.map((hour) => (
              <div key={hour} className="hour-row relative pr-2 text-right">
                <span className="text-[11px] tabular-nums text-[var(--text-muted)] -top-2 relative">
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
              gridTemplateColumns: `repeat(${displayedDates.length}, minmax(0, 1fr))`,
              minWidth: displayedDates.length * (isNarrow ? 110 : 130),
            }}
          >
            {displayedDates.map((date) => {
              const iso = toIsoLocal(date);
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
                  coursesById={coursesById}
                  showExams={layers.exams}
                  showClasses={layers.classes}
                  isCourseSelected={isCourseSelected}
                  searchQuery={searchQuery}
                  onOpenAssessmentDetail={openAssessmentDetail}
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
  coursesById: Map<string, Course>;
  showExams: boolean;
  showClasses: boolean;
  isCourseSelected: (courseId?: string | null) => boolean;
  searchQuery: string;
  onOpenAssessmentDetail: (id: string) => void;
  onOpenEvent: (event: CustomCalendarEvent) => void;
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
    coursesById,
    showExams,
    showClasses,
    isCourseSelected,
    searchQuery,
    onOpenAssessmentDetail,
    onOpenEvent,
    onDeleteCustomEvent,
  }) => {
    // The class-slot popover (v4 parity: clicking a slot shows its facts).
    const [slotPopover, setSlotPopover] = useState<{
      id: string;
      courseId?: string | null;
      courseName?: string | null;
      title: string;
      group?: string | null;
      room?: string | null;
      startTime: string;
      endTime: string;
      topPx: number;
      heightPx: number;
    } | null>(null);

    // 1. Gather Day Items (v4 order: slots → standalone exams → custom events)
    const isToday = dateIso === toIsoLocal(new Date());
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const nowTopPx = ((nowMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;

    const dayItems: CalendarBlockItem[] = useMemo(() => {
      const items: CalendarBlockItem[] = [];

      const daySlots = showClasses
        ? scheduleSlots.filter(
            (s) =>
              s.dayIndex === dayIndex &&
              isCourseSelected(s.courseId) &&
              matchesGlobalSearch(searchQuery, s.courseId, s.courseName, s.type),
          )
        : [];

      const dayExams = showExams
        ? assessments.filter(
            (a) =>
              a.dateIso === dateIso &&
              isCourseSelected(a.courseId) &&
              matchesGlobalSearch(searchQuery, a.courseId, a.courseName, a.title),
          )
        : [];

      // v4 merge rule: a slot and an exam are the same block when they share
      // the course AND the start time.
      const mergedExamIds = new Set<string>();

      daySlots.forEach((slot) => {
        const matchingExam = dayExams.find(
          (a) => a.courseId === slot.courseId && a.startTime === slot.startTime,
        );
        const pos = computeBlockPosition(slot.startTime, slot.endTime);
        const palette = resolvePalette(slot.courseId, coursesById);

        if (matchingExam) {
          mergedExamIds.add(matchingExam.id);
          items.push({
            id: `merged-${slot.id}-${matchingExam.id}`,
            kind: "merged_exam",
            topPx: pos.topPx,
            heightPx: pos.heightPx,
            title: matchingExam.title,
            courseId: slot.courseId,
            courseName: slot.courseName,
            assessmentType: matchingExam.assessmentType,
            room: slot.room ?? matchingExam.room,
            group: slot.group,
            startTime: slot.startTime,
            endTime: slot.endTime,
            timeKnown: true,
            assessmentId: matchingExam.id,
            palette,
          });
        } else {
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
            timeKnown: true,
            palette,
          });
        }
      });

      // Standalone assessments
      dayExams.forEach((exam) => {
        if (mergedExamIds.has(exam.id)) return;
        const pos = computeBlockPosition(exam.startTime, exam.endTime);
        const palette = resolvePalette(exam.courseId, coursesById, {
          color: exam.color,
          bg: exam.bg,
          border: exam.border,
        });
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
          instructor: exam.instructor,
          // Undated-time assessments are still placed at the top of the day
          // for visibility, but the fabricated clock must never render as
          // the item's real time.
          startTime: exam.startTime || "09:00",
          endTime: exam.endTime || "10:30",
          timeKnown: Boolean(exam.startTime),
          assessmentId: exam.id,
          palette,
        });
      });

      // Custom calendar events (pink; smart study blocks stay emerald)
      customEvents
        .filter((ev) => ev.dateIso === dateIso)
        .forEach((ev) => {
          const pos = computeBlockPosition(ev.startTime, ev.endTime);
          const isStudyBlock = ev.id.startsWith("study-block-") || ev.id.startsWith("study_block_");
          items.push({
            id: `custom-${ev.id}`,
            kind: "custom_event",
            topPx: pos.topPx,
            heightPx: pos.heightPx,
            title: ev.title,
            courseId: ev.courseId,
            eventType: ev.eventType,
            room: ev.room,
            startTime: ev.startTime || "10:00",
            endTime: ev.endTime || "11:30",
            timeKnown: Boolean(ev.startTime),
            eventId: ev.id,
            event: ev,
            palette: isStudyBlock ? STUDY_BLOCK_PALETTE : CUSTOM_EVENT_PALETTE,
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
      coursesById,
      showClasses,
      showExams,
      isCourseSelected,
      searchQuery,
    ]);

    return (
      <div
        data-testid={`calendar-day-col-${dateIso}`}
        className="day-col last:border-r-0 select-none"
        style={{ height: hoursCount * HOUR_HEIGHT }}
      >
        {/* Background Hour Grid Lines */}
        {Array.from({ length: hoursCount }).map((_, i) => (
          <div key={i} className="hour-row pointer-events-none" />
        ))}

        {/* Live Current Time Indicator (Now Line) */}
        {isToday && nowTopPx >= 0 && nowTopPx <= hoursCount * HOUR_HEIGHT && (
          <div
            data-testid="calendar-now-indicator"
            className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
            style={{ top: `${nowTopPx}px` }}
          >
            <div className="-ml-1.5 h-3 w-3 rounded-full bg-red-500 shadow-sm ring-2 ring-white dark:ring-slate-900" />
            <div className="h-[2px] flex-1 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]" />
          </div>
        )}

        {/* Calendar Blocks (v4 `gcal-card`) */}
        {dayItems.map((item) => {
          const laneCount = item.laneCount || 1;
          const laneIndex = item.laneIndex || 0;
          const widthPct = 100 / laneCount;
          const leftPct = laneIndex * widthPct;
          const isCompact = item.heightPx < 54;

          const borderHex = item.palette.border || item.palette.color || "#1a73e8";
          const bgLight = item.palette.bg || "#e8f0fe";
          const bgDark = hexToRgba(borderHex, 0.22);

          const horizontal =
            laneCount === 1
              ? { left: "4px", right: "4px" }
              : { left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)` };

          const style: React.CSSProperties = {
            top: item.topPx,
            height: item.heightPx,
            ...horizontal,
            borderColor: borderHex,
            ["--card-bg-light" as string]: bgLight,
            ["--card-bg-dark" as string]: bgDark,
          };

          const compactClass = isCompact ? " gcal-card-compact" : "";

          if (item.kind === "merged_exam") {
            return (
              <div
                key={item.id}
                style={style}
                role="button"
                tabIndex={0}
                onClick={() => item.assessmentId && onOpenAssessmentDetail(item.assessmentId)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && item.assessmentId) {
                    e.preventDefault();
                    onOpenAssessmentDetail(item.assessmentId);
                  }
                }}
                className={`gcal-card has-exam-glow${compactClass}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-bold truncate flex items-center gap-1 text-[var(--text)]">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: borderHex }}
                    />
                    <span className="truncate">
                      {item.courseName || courseDisplayName(item.courseId, coursesById)}
                    </span>
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-red-700 text-white text-[11px] font-bold shrink-0">
                    {item.assessmentType}
                  </span>
                </div>
                <div className="text-[11px] font-bold text-red-700 dark:text-red-300 truncate mt-0.5">
                  {item.title}
                </div>
                {!isCompact && (
                  <>
                    <div className="text-[11px] truncate text-[var(--text)]">
                      {roomLabel(item.room)}
                      {item.group ? ` · Group ${item.group}` : ""}
                    </div>
                    <div className="text-[11px] tabular-nums text-[var(--text-muted)]">
                      {blockTimeLabel(item)}
                    </div>
                  </>
                )}
              </div>
            );
          }

          if (item.kind === "standalone_exam") {
            return (
              <div
                key={item.id}
                style={style}
                role="button"
                tabIndex={0}
                onClick={() => item.assessmentId && onOpenAssessmentDetail(item.assessmentId)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && item.assessmentId) {
                    e.preventDefault();
                    onOpenAssessmentDetail(item.assessmentId);
                  }
                }}
                className={`gcal-card has-exam-glow${compactClass}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-bold truncate flex items-center gap-1 text-[var(--text)]">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: borderHex }}
                    />
                    <span className="truncate">
                      {courseDisplayName(item.courseId, coursesById)} ·{" "}
                      {stripCoursePrefix(item.title, item.courseId)}
                    </span>
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-red-700 text-white text-[11px] font-bold shrink-0">
                    {item.assessmentType}
                  </span>
                </div>
                {!isCompact ? (
                  <>
                    <div className="text-[11px] truncate text-[var(--text)]">
                      {roomLabel(item.room)}
                      {item.instructor ? ` · ${item.instructor}` : ""}
                    </div>
                    <div className="text-[11px] tabular-nums text-[var(--text-muted)]">
                      {blockTimeLabel(item)}
                    </div>
                  </>
                ) : (
                  <div className="text-[11px] tabular-nums truncate text-[var(--text-muted)]">
                    {blockTimeLabel(item)} · {roomLabel(item.room)}
                  </div>
                )}
              </div>
            );
          }

          if (item.kind === "custom_event") {
            const openEvent = () => item.event && onOpenEvent(item.event);
            return (
              <div
                key={item.id}
                style={style}
                role="button"
                tabIndex={0}
                onClick={openEvent}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openEvent();
                  }
                }}
                className={`gcal-card${compactClass} cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      openEvent();
                    }}
                    className="text-[11px] font-bold truncate text-[var(--text)] cursor-pointer hover:underline"
                    title="Edit this event"
                  >
                    {item.title}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => item.eventId && onDeleteCustomEvent(item.eventId, e)}
                    className="shrink-0 p-1.5 -m-1.5 text-[var(--text-muted)] hover:text-red-600 transition rounded"
                    aria-label="Delete event"
                    title="Delete event"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
                {!isCompact ? (
                  <>
                    <div className="text-[11px] truncate text-[var(--text)]">
                      {item.eventType || "Event"} · {roomLabel(item.room)}
                    </div>
                    <div className="text-[11px] tabular-nums text-[var(--text-muted)]">
                      {blockTimeLabel(item)}
                    </div>
                  </>
                ) : (
                  <div className="text-[11px] tabular-nums truncate text-[var(--text-muted)]">
                    {blockTimeLabel(item)}
                  </div>
                )}
              </div>
            );
          }

          // Plain class slot — clicking it opens a small popover with the
          // slot's real facts (v4's slot popover; the click used to be dead).
          return (
            <div
              key={item.id}
              style={style}
              role="button"
              tabIndex={0}
              onClick={() =>
                setSlotPopover({
                  id: item.id,
                  courseId: item.courseId,
                  courseName: item.courseName,
                  title: item.title,
                  group: item.group,
                  room: item.room,
                  startTime: item.startTime,
                  endTime: item.endTime,
                  topPx: item.topPx,
                  heightPx: item.heightPx,
                })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSlotPopover({
                    id: item.id,
                    courseId: item.courseId,
                    courseName: item.courseName,
                    title: item.title,
                    group: item.group,
                    room: item.room,
                    startTime: item.startTime,
                    endTime: item.endTime,
                    topPx: item.topPx,
                    heightPx: item.heightPx,
                  });
                }
              }}
              className={`gcal-card${compactClass} cursor-pointer hover:ring-1 hover:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]`}
            >
              <div className="text-[11px] font-bold truncate flex items-center gap-1.5 text-[var(--text)]">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: borderHex }}
                />
                <span className="truncate">
                  {item.courseName || courseDisplayName(item.courseId, coursesById)}
                </span>
              </div>
              {!isCompact ? (
                <>
                  <div className="text-[11px] truncate text-[var(--text)]">
                    {item.title}
                    {item.group ? ` (Grp ${item.group})` : ""} · {roomLabel(item.room)}
                  </div>
                  <div className="text-[11px] tabular-nums text-[var(--text-muted)]">
                    {blockTimeLabel(item)}
                  </div>
                </>
              ) : (
                <div className="text-[11px] tabular-nums truncate text-[var(--text-muted)]">
                  {blockTimeLabel(item)} · {roomLabel(item.room)}
                </div>
              )}
            </div>
          );
        })}

        {/* Class-slot popover (v4 parity: slots answer a click) */}
        {slotPopover && (
          <>
            <div
              className="fixed inset-0 z-20"
              onClick={() => setSlotPopover(null)}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-label="Class details"
              className="absolute z-30 w-56 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-3 shadow-xl"
              style={{
                top: Math.min(slotPopover.topPx + 8, hoursCount * HOUR_HEIGHT - 150),
                left: "8px",
                right: "8px",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[var(--text)]">
                  {courseDisplayName(slotPopover.courseId, coursesById)}
                </span>
                <button
                  type="button"
                  onClick={() => setSlotPopover(null)}
                  aria-label={copy.common.close}
                  className="shrink-0 rounded-md p-0.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-[var(--text-muted)]">
                <div className="font-semibold text-[var(--text)]">{slotPopover.title}</div>
                <div className="flex items-center gap-1">
                  <CalendarIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="tabular-nums">
                    {formatCompactTime(slotPopover.startTime)} –{" "}
                    {formatCompactTime(slotPopover.endTime)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{roomLabel(slotPopover.room)}</span>
                </div>
                {slotPopover.group && (
                  <div>
                    <span>Group {slotPopover.group}</span>
                  </div>
                )}
              </div>
              <div className="mt-3 pt-2 border-t border-[var(--surface-border)]">
                <button
                  type="button"
                  onClick={() => {
                    const pop = slotPopover;
                    setSlotPopover(null);
                    useAppStore.getState().openModal({
                      id: "create-edit-event",
                      props: {
                        event: {
                          title: `Study: ${courseDisplayName(pop.courseId, coursesById)}`,
                          courseId: pop.courseId || undefined,
                          dateIso,
                        },
                      },
                    });
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent-ink)] font-semibold text-[11px] transition cursor-pointer"
                >
                  <span>+ Plan Study Prep</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  },
);

DayColumn.displayName = "DayColumn";
