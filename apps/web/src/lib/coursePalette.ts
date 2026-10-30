/**
 * Per-course palette derivation (docs/rebuild/01-product-spec.md §6).
 *
 * The 8 v4 preset accents; rgba-style translucency kept as v4 computed it
 * (bg = `${color}18`, border = `${color}55`). Derivation util placeholder —
 * full derivation algorithm (palette cycling + contrast checks) is refined in
 * phase 08. Whilefull note: no demo-course forcing here; palettes key off the
 * course id itself, only.
 */

export const COURSE_PALETTE_PRESETS: readonly string[] = [
  "#1a73e8", // Blue
  "#0f9d58", // Emerald
  "#ea8600", // Amber
  "#d93025", // Red
  "#8e24aa", // Purple
  "#00acc1", // Cyan
  "#e67c73", // Coral
  "#3949ab", // Indigo
] as const;

export interface CourseColors {
  color: string;
  bg: string;
  border: string;
}

/** Stable FNV-1a over the course id — same id ⇒ same palette entry forever. */
function hashCourseId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash);
}

/**
 * Deterministic palette lookup from a course id (or direct preset index).
 * Empty ids resolve to the first preset — they still render a course-colored
 * chip, never a fabricated "default room"-style string.
 */
export function coursePalette(course: string | number): CourseColors {
  const index =
    (typeof course === "number" ? course : hashCourseId(course)) % COURSE_PALETTE_PRESETS.length;
  const color = COURSE_PALETTE_PRESETS[index];
  return {
    color,
    bg: `${color}18`,
    border: `${color}55`,
  };
}

/**
 * User-facing course label: the course's name when it is enrolled, otherwise
 * the id itself (never an invented name). Raw ids must never be rendered
 * directly in chips/labels — this helper is the single place that resolves them.
 */
export function courseDisplayName(
  courseId: string | null | undefined,
  courses:
    ReadonlyArray<{ id: string; name: string }> | ReadonlyMap<string, { id: string; name: string }>,
): string {
  if (!courseId) return "—";
  const course =
    "get" in courses
      ? (courses as ReadonlyMap<string, { id: string; name: string }>).get(courseId)
      : (courses as ReadonlyArray<{ id: string; name: string }>).find((c) => c.id === courseId);
  return course?.name ?? courseId;
}
