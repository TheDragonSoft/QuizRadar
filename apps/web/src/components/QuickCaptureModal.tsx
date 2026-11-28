import React, { useEffect, useRef, useState } from "react";
import {
  ClipboardPaste,
  FileImage,
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useAppStore } from "../state/store";
import type { Assessment } from "../state/types";
import { readSyllabusFiles } from "../lib/syllabusDocuments";

interface QuickCaptureModalProps {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}

const ASSESSMENT_TYPES = [
  "Class Quiz",
  "Lab Assessment",
  "Midterm Exam",
  "Final Exam",
  "Assignment",
] as const;

export const QuickCaptureModal: React.FC<QuickCaptureModalProps> = ({ props, onClose }) => {
  const initialText = typeof props?.initialText === "string" ? props.initialText : "";
  const parseSharedAnnouncement = useAppStore((s) => s.parseSharedAnnouncement);
  const extractAnnouncementMedia = useAppStore((s) => s.extractAnnouncementMedia);
  const upsertAssessment = useAppStore((s) => s.upsertAssessment);
  const showToast = useAppStore((s) => s.showToast);
  const courses = useAppStore((s) => s.data.schedule?.courses ?? []);

  const [mode, setMode] = useState<"text" | "media">("text");
  const [messageText, setMessageText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Assessment | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Editable draft fields
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [assessmentType, setAssessmentType] = useState<string>("Class Quiz");
  const [dateIso, setDateIso] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [room, setRoom] = useState("");

  const populateDraft = (parsed: Assessment) => {
    setDraft(parsed);
    setTitle(parsed.title ?? "");
    setCourseId(parsed.courseId ?? parsed.course_id ?? "");
    setAssessmentType(parsed.assessmentType ?? parsed.assessment_type ?? "Class Quiz");
    setDateIso(parsed.dateIso ?? parsed.date ?? "");
    setStartTime(parsed.startTime ?? parsed.start_time ?? "");
    setEndTime(parsed.endTime ?? parsed.end_time ?? "");
    setRoom(parsed.room ?? "");
  };

  const handleParseText = async () => {
    const trimmed = messageText.trim();
    if (!trimmed) {
      setError("Paste a WhatsApp, Telegram, Discord, or portal message first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const parsed = await parseSharedAnnouncement(trimmed);
      populateDraft(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const docs = await readSyllabusFiles(list.slice(0, 1));
      if (docs.length === 0) {
        setError("Select a PNG, JPG, WebP screenshot, or PDF announcement.");
        return;
      }
      const parsed = await extractAnnouncementMedia(docs[0]);
      populateDraft(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Support Ctrl+V pasting a screenshot directly into the modal.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/") || item.type === "application/pdf") {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            setMode("media");
            void handleFiles([file]);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const handleSaveToRadar = async () => {
    if (!draft) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Give this assessment a title before adding it to your radar.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const matchedCourse = courses.find(
        (c) => c.id.toLowerCase() === courseId.trim().toLowerCase(),
      );
      const next: Assessment = {
        ...draft,
        title: cleanTitle,
        courseId: matchedCourse?.id ?? (courseId.trim() || null),
        course_id: matchedCourse?.id ?? (courseId.trim() || null),
        courseName: matchedCourse?.name ?? draft.courseName ?? null,
        course_name: matchedCourse?.name ?? draft.course_name ?? null,
        assessmentType,
        assessment_type: assessmentType,
        date: dateIso.trim() || null,
        dateIso: dateIso.trim() || null,
        startTime: startTime.trim() || null,
        start_time: startTime.trim() || null,
        endTime: endTime.trim() || null,
        end_time: endTime.trim() || null,
        room: room.trim() || null,
      };
      await upsertAssessment(next);
      showToast(`Added "${cleanTitle}" to your radar`, "success");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Quick Announcement Capture</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Paste a WhatsApp, Telegram, or Discord message — or drop / paste (Ctrl+V) a screenshot —
            and QuizRadar resolves relative dates against your timetable.
          </p>
        </div>
      </div>

      {/* Mode Switcher */}
      <div
        role="tablist"
        aria-label="Capture input mode"
        className="inline-flex rounded-xl border border-border-subtle bg-surface-muted p-1 self-start"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "text"}
          onClick={() => {
            setMode("text");
            setError(null);
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "text"
              ? "bg-surface-elevated text-text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" />
          Forwarded Text (Offline)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "media"}
          onClick={() => {
            setMode("media");
            setError(null);
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "media"
              ? "bg-surface-elevated text-text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <FileImage className="h-3.5 w-3.5" aria-hidden="true" />
          Screenshot / PDF (AI)
        </button>
      </div>

      {mode === "text" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="quick-capture-text" className="text-xs font-medium text-text-secondary">
            Announcement text
          </label>
          <textarea
            id="quick-capture-text"
            rows={4}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder='e.g. "ECE 210 Quiz 2 moved to next Tuesday tutorial. Topics: Flip-Flops, Counters."'
            className="w-full rounded-xl border border-border-subtle bg-surface-base px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">
              Runs 100% locally on your device — zero network or AI calls.
            </span>
            <button
              type="button"
              disabled={busy || !messageText.trim()}
              onClick={() => void handleParseText()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-95 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Resolve Against Timetable
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            id="quick-capture-file"
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                void handleFiles(e.target.files);
                e.target.value = "";
              }
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-default bg-surface-muted/40 px-4 py-7 text-center hover:border-accent-primary/60 hover:bg-surface-muted/70 transition-colors disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-6 w-6 animate-spin text-accent-primary" />
            ) : (
              <FileImage className="h-6 w-6 text-accent-primary" />
            )}
            <span className="text-sm font-medium text-text-primary">
              {busy
                ? "Reading screenshot & anchoring to your timetable…"
                : "Choose a screenshot or PDF, or press Ctrl+V to paste"}
            </span>
            <span className="text-xs text-text-muted">
              PNG, JPG, WebP, or PDF up to 15 MB. Uses your Gemini key or Free Starter AI when
              enabled.
            </span>
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-xs text-danger"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {draft && (
        <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface-muted/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-primary">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
              Resolved Preview — Review & Add to Radar
            </span>
            {(draft.aiInferenceNote ?? draft.ai_inference_note) && (
              <span className="text-[11px] text-text-muted">
                {draft.aiInferenceNote ?? draft.ai_inference_note}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="qc-title" className="block text-xs font-medium text-text-secondary">
                Title
              </label>
              <input
                id="qc-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border-subtle bg-surface-base px-3 py-1.5 text-sm text-text-primary"
              />
            </div>

            <div>
              <label htmlFor="qc-course" className="block text-xs font-medium text-text-secondary">
                Course code
              </label>
              <input
                id="qc-course"
                type="text"
                list="qc-course-list"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                placeholder="e.g. ECE210"
                className="mt-1 w-full rounded-lg border border-border-subtle bg-surface-base px-3 py-1.5 text-sm text-text-primary"
              />
              <datalist id="qc-course-list">
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </datalist>
            </div>

            <div>
              <label htmlFor="qc-type" className="block text-xs font-medium text-text-secondary">
                Type
              </label>
              <select
                id="qc-type"
                value={assessmentType}
                onChange={(e) => setAssessmentType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border-subtle bg-surface-base px-3 py-1.5 text-sm text-text-primary"
              >
                {ASSESSMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="qc-date" className="block text-xs font-medium text-text-secondary">
                Date (blank = TBA)
              </label>
              <input
                id="qc-date"
                type="date"
                value={dateIso}
                onChange={(e) => setDateIso(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border-subtle bg-surface-base px-3 py-1.5 text-sm text-text-primary"
              />
            </div>

            <div>
              <label htmlFor="qc-room" className="block text-xs font-medium text-text-secondary">
                Room (blank = —)
              </label>
              <input
                id="qc-room"
                type="text"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="—"
                className="mt-1 w-full rounded-lg border border-border-subtle bg-surface-base px-3 py-1.5 text-sm text-text-primary"
              />
            </div>

            <div>
              <label htmlFor="qc-start" className="block text-xs font-medium text-text-secondary">
                Start time
              </label>
              <input
                id="qc-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border-subtle bg-surface-base px-3 py-1.5 text-sm text-text-primary"
              />
            </div>

            <div>
              <label htmlFor="qc-end" className="block text-xs font-medium text-text-secondary">
                End time
              </label>
              <input
                id="qc-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border-subtle bg-surface-base px-3 py-1.5 text-sm text-text-primary"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border-subtle px-3.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSaveToRadar()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-4 py-1.5 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add to Radar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
