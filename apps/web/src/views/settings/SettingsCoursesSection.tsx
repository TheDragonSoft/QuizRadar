import { useState } from "react";
import { BookOpen, Plus, Trash2, Edit2, Upload } from "lucide-react";
import { copy } from "../../copy";
import { courseAccessibleChip } from "../../lib/coursePalette";
import { useAppStore } from "../../state/store";
import { isDarkTheme } from "../../state/storage";
import type { Course } from "../../state/types";
import { SECTION_ID } from "./constants";

export function SettingsCoursesSection() {
  const theme = useAppStore((s) => s.theme);
  const config = useAppStore((s) => s.data.config);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const slots = useAppStore((s) => s.data.schedule.slots);
  const deleteCourse = useAppStore((s) => s.deleteCourse);
  const extractSchedule = useAppStore((s) => s.extractSchedule);
  const aiQuota = useAppStore((s) => s.aiQuota);
  const openModal = useAppStore((s) => s.openModal);
  const addToast = useAppStore((s) => s.addToast);

  // Timetable vision import state
  const [extractingTimetable, setExtractingTimetable] = useState(false);

  // Timetable vision import (`01` §4.1): pick an image → Gemini Vision reads
  // the courses and slots → the preview modal shows exactly what was read
  // before anything is saved. The manual course editor stays one click away
  // for every image the model cannot read.
  const handleTimetableImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setExtractingTimetable(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("The image could not be read from disk."));
        reader.readAsDataURL(file);
      });
      const extracted = await extractSchedule(dataUrl);
      openModal({ id: "schedule-preview", props: { extracted } });
    } catch (err) {
      addToast({
        type: "error",
        message: `Timetable extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setExtractingTimetable(false);
    }
  };

  const handleDeleteCourse = (c: Course) => {
    openModal({
      id: "app-confirm",
      props: {
        title: `Delete Course ${c.id}?`,
        message: `This will remove course ${c.id} (${c.name}) and all its associated weekly timetable slots.`,
        destructive: true,
        confirmLabel: "Delete Course",
        onConfirm: async () => {
          await deleteCourse(c.id);
        },
      },
    });
  };

  return (
    <section id={SECTION_ID.courses} className="scroll-mt-6 space-y-6">
      <div className="border-b border-[var(--border)] pb-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]">
          <BookOpen className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
          {copy.settings.tabCourses}
        </h2>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">{copy.settings.sectionCoursesSub}</p>
      </div>

      {/* Timetable vision import (`01` §4.1): image → Gemini Vision →
          preview → apply. The manual editor is always one click away. */}
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--page)] p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
            <Upload className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-bold text-[var(--text)]">
              {copy.settings.timetableImportTitle}
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
              {copy.settings.timetableImportSub}
            </p>
            {(!config.geminiEnabled || aiQuota?.keyInMemory === false) && (
              <p className="mt-1.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                {copy.settings.timetableImportNoKey}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--accent-fill-hover)]">
                <span>
                  {extractingTimetable
                    ? copy.settings.timetableImportExtracting
                    : copy.settings.timetableImportButton}
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label={copy.settings.timetableImportButton}
                  disabled={extractingTimetable}
                  onChange={handleTimetableImage}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={() => openModal({ id: "add-course" })}
                className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)]"
              >
                {copy.settings.timetableImportManual}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
            {copy.settings.coursesHeader}
          </h3>
          <p className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">
            {courses.length} course{courses.length === 1 ? "" : "s"} enrolled
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openModal({ id: "onboarding", flush: true })}
            className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)]"
          >
            {copy.settings.reopenOnboarding}
          </button>
          <button
            type="button"
            onClick={() => openModal({ id: "add-course" })}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--accent-fill-hover)]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.settings.addCourse}</span>
          </button>
        </div>
      </div>

      {courses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--text-muted)]">
          {copy.sidebar.noCoursesEnrolled}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {courses.map((c) => {
            const courseSlots = slots.filter(
              (s) => s.courseId.toLowerCase() === c.id.toLowerCase(),
            );
            const chip = courseAccessibleChip(c.color || "#1a73e8", isDarkTheme(theme));
            return (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--page)] p-3.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white shadow-sm"
                    style={{ backgroundColor: chip.solidBg }}
                  >
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-[var(--text)]">{c.name}</div>
                    <div className="truncate text-xs text-[var(--text-muted)]">{c.id}</div>
                    <div className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">
                      {courseSlots.length} weekly slot
                      {courseSlots.length === 1 ? "" : "s"} · {c.credits ?? 3.0} credits
                    </div>
                  </div>
                </div>

                <div className="ml-2 flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openModal({ id: "add-course", props: { course: c } })}
                    aria-label={`Edit course ${c.id}`}
                    className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] hover:text-[var(--text)]"
                  >
                    <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCourse(c)}
                    aria-label={`Delete course ${c.id}`}
                    className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
