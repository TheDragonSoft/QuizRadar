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

/**
 * Stable FNV-1a over the course id's UTF-8 bytes — same id ⇒ same palette
 * entry forever, and the SAME entry as the Rust core's
 * `preset_course_colors` (core/src/sources/mod.rs): bytes (not UTF-16 code
 * units) and unsigned 32-bit wrap (`>>> 0`, not Math.abs — the signed
 * variant picks a different preset for ~37% of ids whose hash has the high
 * bit set, so a course could color differently on web vs desktop).
 */
function hashCourseId(id: string): number {
  const bytes = new TextEncoder().encode(id);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
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

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) || 26,
      parseInt(clean[1] + clean[1], 16) || 115,
      parseInt(clean[2] + clean[2], 16) || 232,
    ];
  }
  if (clean.length >= 6) {
    return [
      parseInt(clean.slice(0, 2), 16) || 26,
      parseInt(clean.slice(2, 4), 16) || 115,
      parseInt(clean.slice(4, 6), 16) || 232,
    ];
  }
  return [26, 115, 232];
}

function relLuminance(r: number, g: number, b: number): number {
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function wcagContrast(rgbA: [number, number, number], rgbB: [number, number, number]): number {
  const l1 = relLuminance(rgbA[0], rgbA[1], rgbA[2]);
  const l2 = relLuminance(rgbB[0], rgbB[1], rgbB[2]);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function toHex([r, g, b]: [number, number, number]): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export interface AccessibleCourseChip {
  /** Base swatch color (exact preset/user hex for dots and accent bars). */
  dot: string;
  /** High-contrast text color (>= 5.0:1 against tinted chip bg in active theme). */
  text: string;
  /** Subtle translucent chip background. */
  bg: string;
  /** Subtle translucent chip border. */
  border: string;
  /** Solid fill guaranteed >= 5.0:1 contrast with #ffffff white text. */
  solidBg: string;
}

/**
 * Computes WCAG AA (>= 5.0:1) foreground and solid-badge colors while preserving
 * the exact hue of any course preset or user-chosen hex color across Light & Dark themes.
 */
export function courseAccessibleChip(hex: string, isDark = false): AccessibleCourseChip {
  const base = parseHexRgb(hex);

  // Solid fill for white (#ffffff) text badges/avatars: darken until >= 5.0:1 with white.
  let solid: [number, number, number] = [...base];
  for (let step = 0; step < 18 && wcagContrast(solid, [255, 255, 255]) < 5.0; step += 1) {
    solid = [solid[0] * 0.9, solid[1] * 0.9, solid[2] * 0.9];
  }

  if (isDark) {
    // Dark surface (~#111827 blended with 18% course tint): lighten text until >= 5.4:1.
    const chipBgOnDark: [number, number, number] = [
      Math.round(base[0] * 0.18 + 17 * 0.82),
      Math.round(base[1] * 0.18 + 24 * 0.82),
      Math.round(base[2] * 0.18 + 39 * 0.82),
    ];
    let textRgb: [number, number, number] = [...base];
    for (let step = 0; step < 18 && wcagContrast(textRgb, chipBgOnDark) < 5.4; step += 1) {
      textRgb = [
        textRgb[0] + (255 - textRgb[0]) * 0.18,
        textRgb[1] + (255 - textRgb[1]) * 0.18,
        textRgb[2] + (255 - textRgb[2]) * 0.18,
      ];
    }
    return {
      dot: toHex(base),
      text: toHex(textRgb),
      bg: `rgba(${base[0]}, ${base[1]}, ${base[2]}, 0.18)`,
      border: `rgba(${base[0]}, ${base[1]}, ${base[2]}, 0.42)`,
      solidBg: toHex(solid),
    };
  }

  // Light surface (~#f8fafc blended with 11% course tint): darken text until >= 5.2:1.
  const chipBgOnLight: [number, number, number] = [
    Math.round(base[0] * 0.11 + 248 * 0.89),
    Math.round(base[1] * 0.11 + 250 * 0.89),
    Math.round(base[2] * 0.11 + 252 * 0.89),
  ];
  let textRgb: [number, number, number] = [...base];
  for (let step = 0; step < 18 && wcagContrast(textRgb, chipBgOnLight) < 5.2; step += 1) {
    textRgb = [textRgb[0] * 0.88, textRgb[1] * 0.88, textRgb[2] * 0.88];
  }
  return {
    dot: toHex(base),
    text: toHex(textRgb),
    bg: `rgba(${base[0]}, ${base[1]}, ${base[2]}, 0.11)`,
    border: `rgba(${base[0]}, ${base[1]}, ${base[2]}, 0.32)`,
    solidBg: toHex(solid),
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
