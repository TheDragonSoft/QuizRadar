import { Calendar, AlertCircle, Check, X, Edit3 } from "lucide-react";
import { copy } from "../copy";
import { courseAccessibleChip } from "../lib/coursePalette";
import { useAppStore } from "../state/store";
import { isDarkTheme } from "../state/storage";
import type { DesktopExtractedTimetable } from "../state/types";

export interface SchedulePreviewModalProps {
  extracted?: DesktopExtractedTimetable;
}

export function SchedulePreviewModal({
  props,
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const modalProps = (props || {}) as SchedulePreviewModalProps;
  const extracted = modalProps.extracted;

  const theme = useAppStore((s) => s.theme);
  const saveSchedule = useAppStore((s) => s.saveSchedule);
  const openCourseModal = useAppStore((s) => s.openCourseModal);
  const currentCourses = useAppStore((s) => s.data.schedule.courses.length);
  const currentSlots = useAppStore((s) => s.data.schedule.slots.length);

  const schedule = extracted?.schedule || { courses: [], slots: [] };
  const droppedCourses = extracted?.droppedCourses ?? extracted?.dropped_courses ?? 0;
  const droppedSlots = extracted?.droppedSlots ?? extracted?.dropped_slots ?? 0;

  const handleApply = async () => {
    await saveSchedule(schedule);
    onClose();
  };

  const handleManual = () => {
    onClose();
    openCourseModal();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[var(--text)]">
      <div className="flex shrink-0 items-start justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
            <Calendar className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="schedule-preview-title" className="text-lg font-bold text-[var(--text)]">
              {copy.schedulePreview.title}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {copy.schedulePreview.subtitle}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.common.close}
          className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] hover:text-[var(--text)] transition"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-4 pr-0.5">
        {/* Dropped Warning if any */}
        {(droppedCourses > 0 || droppedSlots > 0) && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-medium text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <div>{copy.schedulePreview.droppedWarning(droppedCourses, droppedSlots)}</div>
          </div>
        )}

        {/* Apply replaces the saved timetable, so say so before the click. */}
        {currentCourses > 0 && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs font-medium text-[var(--text-muted)]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <div>{copy.schedulePreview.replacesCurrent(currentCourses, currentSlots)}</div>
          </div>
        )}

        {/* Summary Counts */}
        <div className="flex gap-4 text-xs font-semibold tabular-nums text-[var(--text-muted)]">
          <span>{copy.schedulePreview.coursesCount(schedule.courses.length)}</span>
          <span>•</span>
          <span>{copy.schedulePreview.slotsCount(schedule.slots.length)}</span>
        </div>

        {/* Courses List */}
        <div className="mt-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Extracted Courses
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {schedule.courses.map((course) => {
              const chip = courseAccessibleChip(course.color || "#1a73e8", isDarkTheme(theme));
              return (
                <div
                  key={course.id}
                  className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--page)] p-2.5"
                >
                  <span
                    className="h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ backgroundColor: chip.solidBg }}
                  >
                    {course.id.slice(0, 3)}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[var(--text)] truncate">{course.id}</div>
                    <div className="text-xs text-[var(--text-muted)] truncate">{course.name}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Slots List */}
        <div className="mt-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Extracted Weekly Timetable Slots
          </h3>
          <div className="max-h-60 overflow-y-auto space-y-1.5 border border-[var(--border)] rounded-xl p-2 bg-[var(--page)]">
            {schedule.slots.map((slot, index) => (
              <div
                key={`${slot.courseId}-${slot.day}-${index}`}
                className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface)] px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-[var(--text)]">{slot.courseId}</span>
                  <span className="text-[var(--text-muted)] truncate">{slot.type}</span>
                </div>
                <div className="flex items-center gap-3 text-xs tabular-nums text-[var(--text-muted)] shrink-0">
                  <span>{slot.day}</span>
                  <span>{slot.displayTime || `${slot.startTime}–${slot.endTime}`}</span>
                  <span>{slot.room ? `@ ${slot.room}` : "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
        <button
          type="button"
          onClick={handleManual}
          className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] transition"
        >
          <Edit3 className="h-4 w-4" aria-hidden="true" />
          <span>{copy.schedulePreview.manualAction}</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] transition"
          >
            {copy.schedulePreview.discardAction}
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 hover:bg-[var(--accent-fill-hover)] transition"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            <span>{copy.schedulePreview.applyAction}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
