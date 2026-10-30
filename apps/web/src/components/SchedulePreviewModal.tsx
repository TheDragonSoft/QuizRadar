import { Calendar, AlertCircle, Check, X, Edit3 } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
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

  const saveSchedule = useAppStore((s) => s.saveSchedule);
  const openCourseModal = useAppStore((s) => s.openCourseModal);

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
    <div className="relative w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl transition-all max-h-[90vh] overflow-y-auto">
      <div className="flex items-start justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <Calendar className="h-5 w-5" />
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
          className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--border)]/30 hover:text-[var(--text)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Dropped Warning if any */}
      {(droppedCourses > 0 || droppedSlots > 0) && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>{copy.schedulePreview.droppedWarning(droppedCourses, droppedSlots)}</div>
        </div>
      )}

      {/* Summary Counts */}
      <div className="mt-4 flex gap-4 text-xs font-semibold text-[var(--text-muted)]">
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
          {schedule.courses.map((course) => (
            <div
              key={course.id}
              className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--page)] p-2.5"
            >
              <span
                className="h-6 w-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                style={{ backgroundColor: course.color || "var(--accent)" }}
              >
                {course.id.slice(0, 3)}
              </span>
              <div className="min-w-0">
                <div className="text-xs font-bold text-[var(--text)] truncate">{course.id}</div>
                <div className="text-[11px] text-[var(--text-muted)] truncate">{course.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Slots List */}
      <div className="mt-6">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
          Extracted Weekly Timetable Slots
        </h3>
        <div className="max-h-60 overflow-y-auto space-y-1.5 border border-[var(--border)] rounded-xl p-2 bg-[var(--page)]">
          {schedule.slots.map((slot, index) => (
            <div
              key={`${slot.courseId}-${slot.day}-${index}`}
              className="flex items-center justify-between rounded-lg bg-[var(--surface)] px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-bold text-[var(--text)]">{slot.courseId}</span>
                <span className="text-[var(--text-muted)]">{slot.type}</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
                <span>{slot.day}</span>
                <span>{slot.displayTime || `${slot.startTime}–${slot.endTime}`}</span>
                <span>@{slot.room || "—"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
        <button
          type="button"
          onClick={handleManual}
          className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition"
        >
          <Edit3 className="h-4 w-4" />
          <span>{copy.schedulePreview.manualAction}</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition"
          >
            {copy.schedulePreview.discardAction}
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 hover:bg-[var(--accent-hover)] transition"
          >
            <Check className="h-4 w-4" />
            <span>{copy.schedulePreview.applyAction}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
