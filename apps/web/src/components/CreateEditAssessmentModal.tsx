import React, { useState } from "react";
import { BookOpen, Check, Trash2, X } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { getLocalDateString } from "../state/watchdog";
import type { Assessment } from "../state/types";

export interface CreateEditAssessmentModalProps {
  assessment?: Assessment;
}

const ASSESSMENT_TYPES: string[] = [
  "Class Quiz",
  "Online Quiz",
  "Midterm Exam",
  "Final Exam",
  "Lab Assessment",
  "Assignment",
];

function getWeekdayName(dateIso: string): string {
  try {
    const d = new Date(`${dateIso}T12:00:00Z`);
    return d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  } catch {
    return "Monday";
  }
}

export function CreateEditAssessmentModal({
  props,
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const modalProps = (props || {}) as CreateEditAssessmentModalProps;
  const initialAssessment = modalProps.assessment;
  const isEditing = Boolean(initialAssessment?.id);

  const courses = useAppStore((s) => s.data.schedule.courses);
  const upsertAssessment = useAppStore((s) => s.upsertAssessment);
  const deleteAssessment = useAppStore((s) => s.deleteAssessment);

  const [title, setTitle] = useState(initialAssessment?.title || "");
  const [courseId, setCourseId] = useState(initialAssessment?.courseId || "");
  const [assessmentType, setAssessmentType] = useState<string>(
    initialAssessment?.assessmentType || "Class Quiz",
  );
  const [dateIso, setDateIso] = useState(initialAssessment?.dateIso || getLocalDateString());
  const [startTime, setStartTime] = useState(initialAssessment?.startTime || "09:00");
  const [endTime, setEndTime] = useState(initialAssessment?.endTime || "10:00");
  const [room, setRoom] = useState(initialAssessment?.room || "");
  const [instructor, setInstructor] = useState(initialAssessment?.instructor || "");
  const [topicsRaw, setTopicsRaw] = useState(initialAssessment?.topics?.join("\n") || "");
  const [weightagePercent, setWeightagePercent] = useState<string>(
    initialAssessment?.weightagePercent != null ? String(initialAssessment.weightagePercent) : "",
  );
  const [maxScore, setMaxScore] = useState<string>(
    initialAssessment?.maxScore != null ? String(initialAssessment.maxScore) : "",
  );
  const [submitting, setSubmitting] = useState(false);

  const selectedCourse = courses.find((c) => c.id === courseId);
  const courseName = selectedCourse ? selectedCourse.name : initialAssessment?.courseName || null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !dateIso) return;

    setSubmitting(true);
    try {
      const parsedTopics = topicsRaw
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const parsedWeightage = weightagePercent.trim() !== "" ? Number(weightagePercent) : null;
      const parsedMaxScore = maxScore.trim() !== "" ? Number(maxScore) : null;

      const displayTime = startTime && endTime ? `${startTime} – ${endTime}` : startTime || "";
      const dayName = getWeekdayName(dateIso);

      const payload: Assessment = {
        id: initialAssessment?.id || `custom-${Date.now()}`,
        title: title.trim(),
        courseId: courseId.trim() || null,
        courseName: courseName || null,
        assessmentType,
        dateIso,
        dayName,
        startTime: startTime.trim() || null,
        endTime: endTime.trim() || null,
        displayTime: displayTime || null,
        room: room.trim() || null,
        instructor: instructor.trim() || null,
        isUpcoming: initialAssessment?.isUpcoming ?? true,
        daysUntil: initialAssessment?.daysUntil ?? 0,
        urgencyLevel: initialAssessment?.urgencyLevel || "upcoming",
        priorityScore: initialAssessment?.priorityScore ?? 50,
        weightagePercent: Number.isFinite(parsedWeightage) ? parsedWeightage : null,
        maxScore: Number.isFinite(parsedMaxScore) ? parsedMaxScore : null,
        topics: parsedTopics,
        warnings: initialAssessment?.warnings || [],
        source: "Custom",
        aiInferenceNote: isEditing
          ? copy.assessmentModal.provenanceEdited
          : copy.assessmentModal.provenanceManual,
      };

      await upsertAssessment(payload);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (initialAssessment?.id) {
      setSubmitting(true);
      try {
        await deleteAssessment(initialAssessment.id);
        onClose();
      } finally {
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-700 dark:text-indigo-400">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h2 id="assessment-modal-title" className="text-lg font-bold text-[var(--text)]">
              {isEditing ? copy.assessmentModal.titleEdit : copy.assessmentModal.titleAdd}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="inline-flex items-center rounded-md bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)] border border-[var(--border)]">
                {isEditing
                  ? copy.assessmentModal.provenanceEdited
                  : copy.assessmentModal.provenanceManual}
              </span>
            </div>
          </div>
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
              htmlFor="assessment-title"
              className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
            >
              {copy.assessmentModal.titleLabel} *
            </label>
            <input
              id="assessment-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Midterm Examination"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs font-semibold text-[var(--text)] outline-none focus:border-indigo-600"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="assessment-course"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
              >
                {copy.assessmentModal.courseLabel}
              </label>
              <select
                id="assessment-course"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs text-[var(--text)]"
              >
                <option value="">None / General</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="assessment-type"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
              >
                {copy.assessmentModal.typeLabel}
              </label>
              <select
                id="assessment-type"
                value={assessmentType}
                onChange={(e) => setAssessmentType(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs text-[var(--text)]"
              >
                {ASSESSMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label
                htmlFor="assessment-date"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
              >
                {copy.assessmentModal.dateLabel} *
              </label>
              <input
                id="assessment-date"
                type="date"
                required
                value={dateIso}
                onChange={(e) => setDateIso(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs text-[var(--text)]"
              />
            </div>

            <div>
              <label
                htmlFor="assessment-start-time"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
              >
                {copy.assessmentModal.startTimeLabel}
              </label>
              <input
                id="assessment-start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs tabular-nums text-[var(--text)]"
              />
            </div>

            <div>
              <label
                htmlFor="assessment-end-time"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
              >
                {copy.assessmentModal.endTimeLabel}
              </label>
              <input
                id="assessment-end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] p-2 text-xs tabular-nums text-[var(--text)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="assessment-room"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
              >
                {copy.assessmentModal.roomLabel}
              </label>
              <input
                id="assessment-room"
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder={copy.assessmentModal.noValuePlaceholder}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-indigo-600"
              />
            </div>

            <div>
              <label
                htmlFor="assessment-instructor"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
              >
                {copy.assessmentModal.instructorLabel}
              </label>
              <input
                id="assessment-instructor"
                type="text"
                value={instructor}
                onChange={(e) => setInstructor(e.target.value)}
                placeholder={copy.assessmentModal.noValuePlaceholder}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="assessment-weightage"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
              >
                {copy.assessmentModal.weightageLabel}
              </label>
              <input
                id="assessment-weightage"
                type="number"
                min="0"
                max="100"
                step="any"
                value={weightagePercent}
                onChange={(e) => setWeightagePercent(e.target.value)}
                placeholder={copy.assessmentModal.noValuePlaceholder}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-indigo-600"
              />
            </div>

            <div>
              <label
                htmlFor="assessment-max-score"
                className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
              >
                {copy.assessmentModal.maxScoreLabel}
              </label>
              <input
                id="assessment-max-score"
                type="number"
                min="0"
                step="any"
                value={maxScore}
                onChange={(e) => setMaxScore(e.target.value)}
                placeholder={copy.assessmentModal.noValuePlaceholder}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="assessment-topics"
              className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
            >
              {copy.assessmentModal.topicsLabel}
            </label>
            <textarea
              id="assessment-topics"
              rows={3}
              value={topicsRaw}
              onChange={(e) => setTopicsRaw(e.target.value)}
              placeholder={"e.g. Dynamic Programming\nGraph Algorithms\nShortest Path"}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-indigo-600 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-6 py-4 shrink-0">
          <div>
            {isEditing && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-500/10 transition disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {copy.assessmentModal.deleteAssessment}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition"
            >
              {copy.common.cancel}
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim() || !dateIso}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-700 transition disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {copy.assessmentModal.saveAssessment}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
