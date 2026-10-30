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
  const isEditing = Boolean(initialEvent);

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
    <div className="relative w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl transition-all">
      <div className="flex items-start justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-500/10 text-pink-600 dark:text-pink-400">
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
          className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--border)]/30 hover:text-[var(--text)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
            {copy.eventModal.titleLabel}
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Study Session / Office Hours"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs font-semibold text-[var(--text)] outline-none focus:border-pink-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
              {copy.eventModal.courseLabel}
            </label>
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs text-[var(--text)]"
            >
              <option value="">General / None</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
              {copy.eventModal.dateLabel}
            </label>
            <input
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
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
              Start Time
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs text-[var(--text)]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
              End Time
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs text-[var(--text)]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
            {copy.eventModal.roomLabel}
          </label>
          <input
            type="text"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="e.g. Library 3rd Floor / Desk"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs text-[var(--text)] outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
            {copy.eventModal.notesLabel}
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Objectives, topics to cover..."
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs text-[var(--text)] outline-none resize-none"
          />
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] pt-4 mt-6">
          {isEditing ? (
            <button
              type="button"
              onClick={handleDelete}
              className="flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:underline"
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
              className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition"
            >
              {copy.common.cancel}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 rounded-xl bg-pink-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-pink-500/20 hover:bg-pink-700 transition disabled:opacity-50"
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
