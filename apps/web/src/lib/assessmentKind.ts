/**
 * Assessment-kind families for UI differentiation (quiz / exam / lab /
 * assignment), derived from the core's `AssessmentType` display strings
 * (`01` §3 type ladder: "Class Quiz", "Online Quiz", "Midterm Exam",
 * "Final Exam", "Lab Assessment", "Assignment").
 *
 * The ladder mirror below matches `core/src/types.rs` `from_import_label`
 * (most specific keyword first) so a label the core has not normalized yet —
 * a raw backup import on the web tier — still classifies identically.
 * Unknown labels fall back to the ladder's default rung ("Class Quiz"), the
 * same default the core applies, never an invented kind.
 */

export type AssessmentKind = "quiz" | "exam" | "lab" | "assignment";

const KIND_BY_LABEL: Readonly<Record<string, AssessmentKind>> = {
  "class quiz": "quiz",
  "online quiz": "quiz",
  "midterm exam": "exam",
  "final exam": "exam",
  "lab assessment": "lab",
  assignment: "assignment",
};

export function assessmentKind(assessmentType?: string | null): AssessmentKind {
  const lowered = String(assessmentType ?? "")
    .trim()
    .toLowerCase();
  if (KIND_BY_LABEL[lowered]) return KIND_BY_LABEL[lowered];
  if (lowered.includes("final") || lowered.includes("midterm")) return "exam";
  if (lowered.includes("quiz")) return "quiz";
  if (lowered.includes("lab")) return "lab";
  if (lowered.includes("assignment")) return "assignment";
  // The v4 ladder's default rung — an unclassified assessment is a quiz.
  return "quiz";
}
