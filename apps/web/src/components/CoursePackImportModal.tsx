import { useEffect, useState } from "react";
import { Calendar, Check, Download, Info, X } from "lucide-react";
import { copy } from "../copy";
import { courseMatchesCode } from "../lib/coursePack";
import { useAppStore } from "../state/store";
import type { CoursePackPayload } from "../state/types";

export interface CoursePackImportModalProps {
  rawInput?: string;
  pack?: CoursePackPayload;
}

export function CoursePackImportModal({
  props,
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const modalProps = (props || {}) as CoursePackImportModalProps;

  const existingCourses = useAppStore((s) => s.data.schedule.courses);
  const onboardingCompleted = useAppStore((s) => s.data.config.onboardingCompleted);
  const decodeCoursePack = useAppStore((s) => s.decodeCoursePack);
  const importCoursePack = useAppStore((s) => s.importCoursePack);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const addToast = useAppStore((s) => s.addToast);

  const [rawInput, setRawInput] = useState(modalProps.rawInput || "");
  const [pack, setPack] = useState<CoursePackPayload | null>(modalProps.pack ?? null);
  const [decoding, setDecoding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!modalProps.pack && modalProps.rawInput) {
      setDecoding(true);
      setError(null);
      decodeCoursePack(modalProps.rawInput)
        .then((decoded) => {
          if (!cancelled) {
            setPack(decoded);
            setDecoding(false);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
            setDecoding(false);
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [decodeCoursePack, modalProps.pack, modalProps.rawInput]);

  const handleDecode = async () => {
    setDecoding(true);
    setError(null);
    try {
      const decoded = await decodeCoursePack(rawInput);
      setPack(decoded);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDecoding(false);
    }
  };

  const handleImport = async () => {
    const source = rawInput.trim();
    if (!source) return;
    setImporting(true);
    setError(null);
    try {
      const res = await importCoursePack(source);
      if (!onboardingCompleted) {
        await updateConfig({ onboardingCompleted: true });
      }
      addToast({
        type: "success",
        message: `${res.courseId || pack?.course.id || "Course"} added (+${res.report.slotsAdded} slots, +${res.report.assessmentsAdded} deadlines).`,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const alreadyEnrolled = Boolean(
    pack && existingCourses.some((c) => courseMatchesCode(c, pack.course.id)),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[var(--text)]">
      <div className="flex shrink-0 items-start justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
            <Download className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="course-pack-import-title" className="text-lg font-bold text-[var(--text)]">
              {copy.coursePack.importTitle}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {copy.coursePack.importSubtitle}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.common.close}
          className="rounded-lg p-1.5 text-[var(--text-muted)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] hover:text-[var(--text)]"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300"
          >
            {error}
          </div>
        )}

        {!pack ? (
          <div className="space-y-3">
            <label
              htmlFor="course-pack-link-input"
              className="block text-xs font-semibold text-[var(--text-muted)]"
            >
              Course Pack Link
            </label>
            <textarea
              id="course-pack-link-input"
              rows={3}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder={copy.coursePack.pastePlaceholder}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 font-mono text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
            <div className="flex justify-end">
              <button
                type="button"
                disabled={decoding || !rawInput.trim()}
                onClick={handleDecode}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent-fill-hover)] disabled:opacity-50"
              >
                {decoding ? "Decoding..." : copy.coursePack.previewLinkAction}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: pack.course.color || "#1a73e8" }}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-bold text-[var(--text)]">
                    {pack.course.id} — {pack.course.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  {pack.course.credits != null && <span>{pack.course.credits} cr</span>}
                  {pack.semester && <span>· {pack.semester}</span>}
                </div>
              </div>
            </div>

            {alreadyEnrolled && (
              <div className="flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-700 dark:text-sky-300">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{copy.coursePack.alreadyEnrolledNote}</span>
              </div>
            )}

            <section aria-label="Course slots preview">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Weekly Class Slots ({pack.slots.length})
              </h3>
              {pack.slots.length === 0 ? (
                <p className="rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
                  No weekly timetable slots attached.
                </p>
              ) : (
                <div className="space-y-1">
                  {pack.slots.map((slot, i) => {
                    const sr = slot as unknown as Record<string, unknown>;
                    const timeLabel =
                      String(sr.display_time ?? slot.displayTime ?? "").trim() ||
                      `${sr.start_time ?? slot.startTime}–${sr.end_time ?? slot.endTime}`;
                    return (
                      <div
                        key={slot.id || i}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs"
                      >
                        <span className="font-semibold text-[var(--text)]">
                          {slot.day} · {timeLabel}
                        </span>
                        <span className="text-[var(--text-muted)]">
                          {slot.type || "Lecture"} · {slot.room?.trim() ? slot.room : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section aria-label="Course assessments preview">
              <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                Shared Deadlines &amp; Weights ({pack.assessments.length})
              </h3>
              {pack.assessments.length === 0 ? (
                <p className="rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
                  No graded assessments attached to this pack.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {pack.assessments.map((item, i) => {
                    const dateIso = item.dateIso ?? item.date_iso ?? null;
                    const typeLabel = item.assessmentType ?? item.assessment_type ?? "Class Quiz";
                    const weight = item.weightagePercent ?? item.weightage_percent ?? null;
                    return (
                      <div
                        key={`${item.title}-${i}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-[var(--text)]">{item.title}</span>
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--text-muted)]">
                            {typeLabel}
                          </span>
                          {weight != null && (
                            <span className="rounded bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] px-1.5 py-0.5 font-semibold text-[var(--accent-ink)]">
                              {weight}%
                            </span>
                          )}
                          <span className="font-mono text-[var(--text-muted)]">
                            {dateIso ?? copy.syllabusImport.dateTba}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <div className="mt-4 flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] pt-4">
        {pack ? (
          <button
            type="button"
            onClick={() => {
              setPack(null);
              setError(null);
            }}
            className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            Paste different link
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-2)]"
          >
            {copy.common.cancel}
          </button>
          {pack && (
            <button
              type="button"
              disabled={importing}
              onClick={handleImport}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent-fill-hover)] disabled:opacity-50"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {importing ? "Adding..." : copy.coursePack.addCourseAction}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
