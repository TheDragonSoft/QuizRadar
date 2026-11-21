import { useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  FileText,
  Share2,
  X,
} from "lucide-react";
import { copy } from "../copy";
import { courseAccessibleChip } from "../lib/coursePalette";
import { useAppStore } from "../state/store";
import { isDarkTheme } from "../state/storage";
import type { CourseImportReport, DesktopExtractedSyllabi } from "../state/types";

export interface SyllabusPreviewModalProps {
  extracted?: DesktopExtractedSyllabi;
  onApplied?: (courseIds: string[]) => void;
}

export function SyllabusPreviewModal({
  props,
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const modalProps = (props || {}) as SyllabusPreviewModalProps;
  const extracted = modalProps.extracted;

  const theme = useAppStore((s) => s.theme);
  const dark = isDarkTheme(theme);
  const applyCourseBundle = useAppStore((s) => s.applyCourseBundle);
  const openShareCoursePack = useAppStore((s) => s.openShareCoursePack);
  const addToast = useAppStore((s) => s.addToast);

  const schedule = useMemo(
    () => extracted?.schedule ?? { courses: [], slots: [] },
    [extracted?.schedule],
  );
  const assessments = useMemo(() => extracted?.assessments ?? [], [extracted?.assessments]);
  const droppedCourses = extracted?.droppedCourses ?? extracted?.dropped_courses ?? 0;
  const droppedSlots = extracted?.droppedSlots ?? extracted?.dropped_slots ?? 0;
  const droppedAssessments = extracted?.droppedAssessments ?? extracted?.dropped_assessments ?? 0;
  const fileErrors = extracted?.fileErrors ?? extracted?.file_errors ?? [];

  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(
    () => new Set(schedule.courses.map((c) => c.id)),
  );
  const [selectedAssessments, setSelectedAssessments] = useState<Set<number>>(
    () => new Set(assessments.map((_, idx) => idx)),
  );
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedState, setAppliedState] = useState<{
    report: CourseImportReport;
    courseIds: string[];
  } | null>(null);

  const selectedCourseSetLower = useMemo(
    () => new Set(Array.from(selectedCourses).map((id) => id.toLowerCase())),
    [selectedCourses],
  );

  const visibleSlotsCount = useMemo(
    () =>
      schedule.slots.filter((slot) => {
        const raw = slot as unknown as Record<string, unknown>;
        const cid = String(raw.course_id ?? slot.courseId ?? "").toLowerCase();
        return selectedCourseSetLower.has(cid);
      }).length,
    [schedule.slots, selectedCourseSetLower],
  );

  const selectedAssessmentCount = useMemo(
    () =>
      assessments.filter((a, idx) => {
        if (!selectedAssessments.has(idx)) return false;
        const cid = (a.courseId ?? a.course_id ?? "").toLowerCase();
        return !cid || selectedCourseSetLower.has(cid);
      }).length,
    [assessments, selectedAssessments, selectedCourseSetLower],
  );

  const toggleCourse = (courseId: string) => {
    setSelectedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  };

  const toggleAssessment = (idx: number) => {
    setSelectedAssessments((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleApply = async () => {
    if (selectedCourses.size === 0 && selectedAssessmentCount === 0) {
      setError("Select at least one course or assessment to add.");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const chosenCourses = schedule.courses.filter((c) => selectedCourses.has(c.id));
      const chosenSlots = schedule.slots.filter((slot) => {
        const raw = slot as unknown as Record<string, unknown>;
        const cid = String(raw.course_id ?? slot.courseId ?? "").toLowerCase();
        return selectedCourseSetLower.has(cid);
      });
      const chosenAssessments = assessments.filter((a, idx) => {
        if (!selectedAssessments.has(idx)) return false;
        const cid = (a.courseId ?? a.course_id ?? "").toLowerCase();
        return !cid || selectedCourseSetLower.has(cid);
      });

      const res = await applyCourseBundle({
        semester: schedule.semester ?? null,
        courses: chosenCourses,
        slots: chosenSlots,
        assessments: chosenAssessments,
      });
      const courseIds = chosenCourses.map((c) => c.id);
      setAppliedState({ report: res.report, courseIds });
      modalProps.onApplied?.(courseIds);
      addToast({
        type: "success",
        message: `Added ${res.report.coursesAdded} course(s), ${res.report.slotsAdded} slot(s), and ${res.report.assessmentsAdded} assessment(s).`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  const hasDrops = droppedCourses > 0 || droppedSlots > 0 || droppedAssessments > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[var(--text)]">
      <div className="flex shrink-0 items-start justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="syllabus-preview-title" className="text-lg font-bold text-[var(--text)]">
              {copy.syllabusImport.previewTitle}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {copy.syllabusImport.previewSubtitle}
              {extracted?.model ? ` · Model: ${extracted.model}` : ""}
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
        {hasDrops && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {copy.syllabusImport.droppedWarning(droppedCourses, droppedSlots, droppedAssessments)}
            </span>
          </div>
        )}

        {fileErrors.length > 0 && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
            <p className="font-semibold">Some files could not be read:</p>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              {fileErrors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300"
          >
            {error}
          </div>
        )}

        {appliedState ? (
          <div className="space-y-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="flex items-start gap-2.5">
              <CheckCircle2
                className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-sm font-bold text-[var(--text)]">
                  {copy.syllabusImport.appliedTitle}
                </h3>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  +{appliedState.report.coursesAdded} course(s) added (
                  {appliedState.report.coursesUpdated} updated) · +{appliedState.report.slotsAdded}{" "}
                  class slot(s) · +{appliedState.report.assessmentsAdded} assessment(s) added (
                  {appliedState.report.assessmentsUpdated} merged)
                </p>
              </div>
            </div>

            {appliedState.courseIds.length > 0 && (
              <div className="space-y-2 border-t border-emerald-500/20 pt-3">
                <p className="text-xs font-medium text-[var(--text)]">
                  {copy.syllabusImport.appliedSharePrompt}
                </p>
                <div className="flex flex-wrap gap-2">
                  {appliedState.courseIds.map((cid) => (
                    <button
                      key={cid}
                      type="button"
                      onClick={() => {
                        onClose();
                        openShareCoursePack(cid);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:border-[var(--accent)] hover:text-[var(--accent-ink)]"
                    >
                      <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Share {cid} Course Pack
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <section aria-label="Extracted courses">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  Courses ({selectedCourses.size}/{schedule.courses.length}) · Slots (
                  {visibleSlotsCount})
                </h3>
                {schedule.semester && (
                  <span className="rounded-md bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">
                    {schedule.semester}
                  </span>
                )}
              </div>

              {schedule.courses.length === 0 ? (
                <p className="rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
                  No courses were identified in these documents.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {schedule.courses.map((course) => {
                    const checked = selectedCourses.has(course.id);
                    const chip = courseAccessibleChip(course.color || "#1a73e8", dark);
                    const slotCount = schedule.slots.filter((s) => {
                      const raw = s as unknown as Record<string, unknown>;
                      return (
                        String(raw.course_id ?? s.courseId ?? "").toLowerCase() ===
                        course.id.toLowerCase()
                      );
                    }).length;
                    return (
                      <label
                        key={course.id}
                        className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 transition hover:border-[var(--accent)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCourse(course.id)}
                          className="mt-1 h-4 w-4 accent-[var(--accent)]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className="inline-block rounded px-1.5 py-0.5 text-[11px] font-bold"
                              style={{ backgroundColor: chip.bg, color: chip.text }}
                            >
                              {course.id}
                            </span>
                            {course.credits != null && (
                              <span className="text-[11px] text-[var(--text-muted)]">
                                {course.credits} cr
                              </span>
                            )}
                            <span className="text-[11px] text-[var(--text-muted)]">
                              · {slotCount} slot(s)
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs font-medium text-[var(--text)]">
                            {course.name}
                          </p>
                          {(course.aliases?.length ?? 0) > 0 && (
                            <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                              Also known as: {course.aliases!.join(", ")}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </section>

            <section aria-label="Extracted assessments">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                Assessments &amp; Weights ({selectedAssessmentCount}/{assessments.length})
              </h3>
              {assessments.length === 0 ? (
                <p className="rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--text-muted)]">
                  No graded assessments were listed in these documents.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {assessments.map((a, idx) => {
                    const cid = a.courseId ?? a.course_id ?? "";
                    const courseSelected = !cid || selectedCourseSetLower.has(cid.toLowerCase());
                    const checked = selectedAssessments.has(idx) && courseSelected;
                    const dateIso = a.dateIso ?? a.date_iso ?? null;
                    const assessmentType = a.assessmentType ?? a.assessment_type ?? "Class Quiz";
                    const weight = a.weightagePercent ?? a.weightage_percent ?? null;

                    return (
                      <label
                        key={`${cid}-${a.title}-${idx}`}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 transition ${
                          courseSelected ? "hover:border-[var(--accent)]" : "opacity-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!courseSelected}
                          onChange={() => toggleAssessment(idx)}
                          className="mt-1 h-4 w-4 accent-[var(--accent)]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {cid && (
                                <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--text)]">
                                  {cid}
                                </span>
                              )}
                              <span className="text-xs font-semibold text-[var(--text)]">
                                {a.title}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--text-muted)]">
                                {assessmentType}
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
                          {(a.topics.length > 0 || a.warnings.length > 0) && (
                            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                              {a.topics.length > 0 ? `Topics: ${a.topics.join(", ")}` : ""}
                              {a.topics.length > 0 && a.warnings.length > 0 ? " · " : ""}
                              {a.warnings.join("; ")}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
        {appliedState ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent-fill-hover)]"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)]"
            >
              {copy.common.cancel}
            </button>
            <button
              type="button"
              disabled={applying || (selectedCourses.size === 0 && selectedAssessmentCount === 0)}
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent-fill-hover)] disabled:opacity-50"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {applying ? "Adding..." : copy.syllabusImport.applyAction}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
