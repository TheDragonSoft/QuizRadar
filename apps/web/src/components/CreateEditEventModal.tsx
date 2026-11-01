import React, { useState } from "react";
import { Calendar, Trash2, X, Check } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { getLocalDateString } from "../state/watchdog";
import type { CustomCalendarEvent } from "../state/types";

export interface CreateEditEventModalProps {
  event?: CustomCalendarEvent;
}

export function CreateEditEventModal({
  props,
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const modalProps = (props || {}) as CreateEditEventModalProps;
  const initialEvent = modalProps.event;
  // A draft prefill (e.g. "+ Plan Study Prep") carries no id — it must open
  // as ADD, or the modal shows a Delete button for a nonexistent event.
  const isEditing = Boolean(initialEvent?.id);

  const courses = useAppStore((s) => s.data.schedule.courses);
  const addCustomEvent = useAppStore((s) => s.addCustomEvent);
  const deleteCustomEvent = useAppStore((s) => s.deleteCustomEvent);

  const [title, setTitle] = useState(initialEvent?.title || "");
  const [courseId, setCourseId] = useState(initialEvent?.courseId || "");
  const [dateIso, setDateIso] = useState(initialEvent?.dateIso || getLocalDateString());
  const [startTime, setStartTime] = useState(initialEvent?.startTime || "10:00");
  const [endTime, setEndTime] = useState(initialEvent?.endTime || "11:30");
  const [room, setRoom] = useState(initialEvent?.room || "");
  const [notes, setNotes] = useState(initialEvent?.notes || "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    try {
      const eventPayload: CustomCalendarEvent = {
        id: initialEvent?.id || `custom-${Date.now()}`,
        title: title.trim(),
        courseId: courseId || null,
        eventType: initialEvent?.eventType || "custom",
        dateIso: dateIso || null,
        startTime: startTime || null,
        endTime: endTime || null,
        room: room.trim() || null,
        notes: notes.trim() || null,
        color: "#db2777", // Spec custom event pink
      };

      await addCustomEvent(eventPayload);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (initialEvent) {
      await deleteCustomEvent(initialEvent.id);
      onClose();
    }
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-500/10 text-pink-700 dark:text-pink-400">
            <Calendar className="h-5 w-5" />
          </div>
          <h2 id="event-modal-title" className="text-lg font-bold text-[var(--text)]">
            {isEditing ? copy.eventModal.titleEdit : copy.eventModal.titleAdd}
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
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label
              htmlFor="custom-event-title"
              className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
            >
              {copy.eventModal.titleLabel}
            </label>
            <input
              id="custom-event-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Study Session / Office Hours"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs font-semibold text-[var(--text)] outline-none focus:border-pink-600"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="custom-event-course"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
              >
                {copy.eventModal.courseLabel}
              </label>
              <select
                id="custom-event-course"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs text-[var(--text)]"
              >
                <option value="">None / Unassigned</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="custom-event-date"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
              >
                {copy.eventModal.dateLabel}
              </label>
              <input
                id="custom-event-date"
                type="date"
                required
                value={dateIso}
                onChange={(e) => setDateIso(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs text-[var(--text)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="custom-event-start"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
              >
                Start Time
              </label>
              <input
                id="custom-event-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs tabular-nums text-[var(--text)]"
              />
            </div>

            <div>
              <label
                htmlFor="custom-event-end"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
              >
                End Time
              </label>
              <input
                id="custom-event-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs tabular-nums text-[var(--text)]"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="custom-event-room"
              className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
            >
              {copy.eventModal.roomLabel}
            </label>
            <input
              id="custom-event-room"
              type="text"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="e.g. Library 3rd Floor / Desk"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-pink-600"
            />
          </div>

          <div>
            <label
              htmlFor="custom-event-notes"
              className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
            >
              {copy.eventModal.notesLabel}
            </label>
            <textarea
              id="custom-event-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Objectives, topics to cover..."
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs text-[var(--text)] outline-none resize-none focus:border-pink-600"
            />
          </div>
        </div>

        {/* Action Buttons Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--page)] px-6 py-3.5 shrink-0">
          {isEditing ? (
            <button
              type="button"
              onClick={handleDelete}
              className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400 hover:underline"
            >
              <Trash2 className="h-4 w-4" />
              <span>{copy.common.delete}</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
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
              className="flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-fill-hover)] transition disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              <span>{copy.eventModal.saveEvent}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
