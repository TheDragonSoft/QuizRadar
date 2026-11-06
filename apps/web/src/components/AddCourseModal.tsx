import { useState } from "react";
import { BookOpen, Plus, Trash2, X, Check } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { COURSE_PALETTE_PRESETS, coursePalette } from "../lib/coursePalette";
import type { Course, ScheduleSlot } from "../state/types";

export interface AddCourseModalProps {
  course?: Course;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SLOT_TYPES = ["Lecture", "Tutorial", "Lab"];

export function AddCourseModal({
  props,
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const modalProps = (props || {}) as AddCourseModalProps;
  const initialCourse = modalProps.course;
  const isEditing = Boolean(initialCourse);

  const existingSlots = useAppStore((s) => s.data.schedule.slots);
  const upsertCourse = useAppStore((s) => s.upsertCourse);

  const [code, setCode] = useState(initialCourse?.id || "");
  const [name, setName] = useState(initialCourse?.name || "");
  const [color, setColor] = useState(
    initialCourse?.color ||
      (initialCourse ? coursePalette(initialCourse.id).color : COURSE_PALETTE_PRESETS[0]),
  );

  const courseSlots = initialCourse
    ? existingSlots.filter((s) => s.courseId.toLowerCase() === initialCourse.id.toLowerCase())
    : [];

  const [slots, setSlots] = useState<
    Array<{
      id: string;
      day: string;
      dayIndex: number;
      startTime: string;
      endTime: string;
      room: string;
      type: string;
      group: string;
    }>
  >(() => {
    if (courseSlots.length > 0) {
      return courseSlots.map((s) => ({
        id: s.id,
        day: s.day,
        dayIndex: s.dayIndex,
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room || "",
        type: s.type || "Lecture",
        group: s.group || "",
      }));
    }
    return [
      {
        id: `slot-init-${Date.now()}`,
        day: "Monday",
        dayIndex: 1,
        startTime: "09:00",
        endTime: "10:30",
        room: "",
        type: "Lecture",
        group: "",
      },
    ];
  });

  const handleAddSlot = () => {
    setSlots((prev) => [
      ...prev,
      {
        id: `slot-${Date.now()}-${prev.length}`,
        day: "Monday",
        dayIndex: 1,
        startTime: "09:00",
        endTime: "10:30",
        room: "",
        type: "Lecture",
        group: "",
      },
    ]);
  };

  const handleRemoveSlot = (index: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateSlot = (index: number, field: string, value: unknown) => {
    setSlots((prev) => {
      const copyArr = [...prev];
      const slot = { ...copyArr[index], [field]: value };
      if (field === "day") {
        const dayIdx = WEEKDAYS.indexOf(value as string);
        slot.dayIndex = dayIdx >= 0 ? dayIdx : 0;
      }
      copyArr[index] = slot;
      return copyArr;
    });
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = name.trim();
    if (!trimmedCode || !trimmedName) return;

    setSubmitting(true);
    try {
      const courseData: Course = {
        id: trimmedCode,
        name: trimmedName,
        color,
      };

      const slotPayload: ScheduleSlot[] = slots.map((s, idx) => ({
        id: s.id || `slot-${trimmedCode}-${idx}`,
        day: s.day,
        dayIndex: s.dayIndex,
        courseId: trimmedCode,
        courseName: trimmedName,
        type: s.type,
        room: s.room.trim() || null,
        group: s.group.trim() || null,
        startTime: s.startTime,
        endTime: s.endTime,
        displayTime: `${s.startTime}–${s.endTime}`,
        hasQuiz: false,
      }));

      await upsertCourse(courseData, slotPayload);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
            <BookOpen className="h-5 w-5" />
          </div>
          <h2 id="course-modal-title" className="text-lg font-bold text-[var(--text)]">
            {isEditing ? copy.courseModal.titleEdit : copy.courseModal.titleAdd}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.common.close}
          className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Course Code & Name */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="course-code"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5"
              >
                {copy.courseModal.codeLabel}
              </label>
              <input
                id="course-code"
                type="text"
                required
                disabled={isEditing}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. CSE241"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs font-bold text-[var(--text)] outline-none focus:border-[var(--accent)] uppercase"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="course-name"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5"
              >
                {copy.courseModal.nameLabel}
              </label>
              <input
                id="course-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Digital Logic Design"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs font-medium text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          {/* Color Palette Picker */}
          <div role="group" aria-labelledby="course-color-label">
            <span
              id="course-color-label"
              className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2"
            >
              {copy.courseModal.colorLabel}
            </span>
            <div className="flex flex-wrap gap-2.5">
              {COURSE_PALETTE_PRESETS.map((presetColor: string) => (
                <button
                  key={presetColor}
                  type="button"
                  onClick={() => setColor(presetColor)}
                  aria-label={copy.courseModal.colorOption(presetColor)}
                  aria-pressed={color === presetColor}
                  style={{ backgroundColor: presetColor }}
                  className={`h-7 w-7 rounded-lg transition-transform ${
                    color === presetColor
                      ? "scale-110 ring-2 ring-[var(--text)] ring-offset-2 ring-offset-[var(--surface)]"
                      : "opacity-80 hover:opacity-100"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Slots List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                {copy.courseModal.slotsHeader}
              </label>
              <button
                type="button"
                onClick={handleAddSlot}
                className="flex min-h-6 items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold text-[var(--accent-ink)] hover:underline"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{copy.courseModal.addSlot}</span>
              </button>
            </div>

            <div className="space-y-2.5 max-h-60 overflow-y-auto border border-[var(--border)] rounded-xl p-2.5 bg-[var(--page)]">
              {slots.map((slot, index) => (
                <div
                  key={slot.id || index}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-2.5 text-xs"
                >
                  <div className="sm:col-span-3">
                    <select
                      value={slot.day}
                      aria-label={copy.courseModal.slotField(index + 1, copy.courseModal.dayLabel)}
                      onChange={(e) => handleUpdateSlot(index, "day", e.target.value)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--page)] px-2 py-1.5 text-xs text-[var(--text)]"
                    >
                      {WEEKDAYS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-4 flex items-center gap-1 min-w-0">
                    <input
                      type="time"
                      aria-label={copy.courseModal.slotField(
                        index + 1,
                        copy.courseModal.startTimeLabel,
                      )}
                      value={slot.startTime}
                      onChange={(e) => handleUpdateSlot(index, "startTime", e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--page)] px-1.5 py-1.5 text-xs tabular-nums text-[var(--text)]"
                    />
                    <span className="text-[var(--text-muted)]">–</span>
                    <input
                      type="time"
                      aria-label={copy.courseModal.slotField(
                        index + 1,
                        copy.courseModal.endTimeLabel,
                      )}
                      value={slot.endTime}
                      onChange={(e) => handleUpdateSlot(index, "endTime", e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--page)] px-1.5 py-1.5 text-xs tabular-nums text-[var(--text)]"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <select
                      value={slot.type}
                      aria-label={copy.courseModal.slotField(index + 1, copy.courseModal.typeLabel)}
                      onChange={(e) => handleUpdateSlot(index, "type", e.target.value)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--page)] px-2 py-1.5 text-xs text-[var(--text)]"
                    >
                      {SLOT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5 sm:col-span-3">
                    <input
                      type="text"
                      aria-label={copy.courseModal.slotField(index + 1, copy.courseModal.roomLabel)}
                      placeholder="Room (e.g. Eng 302)"
                      value={slot.room}
                      onChange={(e) => handleUpdateSlot(index, "room", e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--page)] px-2 py-1.5 text-xs text-[var(--text)]"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveSlot(index)}
                      aria-label={copy.courseModal.slotRemove(index + 1)}
                      className="shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Action Buttons Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] bg-[var(--page)] px-6 py-3.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition"
          >
            {copy.common.cancel}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-blue-500/20 hover:bg-[var(--accent-fill-hover)] transition disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            <span>{copy.courseModal.saveCourse}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
