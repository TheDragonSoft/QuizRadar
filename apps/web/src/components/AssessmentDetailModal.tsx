import React, { useState } from "react";
import {
  Calendar,
  Download,
  ExternalLink,
  MapPin,
  Clock,
  User,
  Sparkles,
  AlertTriangle,
  Calculator,
  Save,
  CheckCircle,
  HelpCircle,
  X,
} from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { calculateWhatIf } from "../lib/whatIf";
import { coursePalette } from "../lib/coursePalette";

interface AssessmentDetailModalProps {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}

export const AssessmentDetailModal: React.FC<AssessmentDetailModalProps> = ({ props, onClose }) => {
  const activeModalAssessmentId = useAppStore((s) => s.activeModalAssessmentId);
  const assessmentId = (props?.assessmentId as string) || activeModalAssessmentId;
  const assessments = useAppStore((s) => s.data.assessments);
  const recommendations = useAppStore((s) => s.data.dashboard.studyRecommendations);
  const toggleTopic = useAppStore((s) => s.toggleTopic);
  const saveGrade = useAppStore((s) => s.saveGrade);
  const exportIcs = useAppStore((s) => s.exportIcs);
  const addToast = useAppStore((s) => s.addToast);
  const openPracticeQuiz = useAppStore((s) => s.openPracticeQuiz);
  const openPomodoro = useAppStore((s) => s.openPomodoro);

  const assessment = assessments.find((a) => a.id === assessmentId);
  const rec = recommendations.find((r) => r.assessmentId === assessmentId);

  // Grade edit inputs state (allows string editing and explicit null/empty clearing)
  const [scoreInput, setScoreInput] = useState<string>(
    assessment?.achievedScore != null ? String(assessment.achievedScore) : "",
  );
  const [maxInput, setMaxInput] = useState<string>(
    assessment?.maxScore != null ? String(assessment.maxScore) : "",
  );
  const [weightInput, setWeightInput] = useState<string>(
    assessment?.weightagePercent != null ? String(assessment.weightagePercent) : "",
  );

  // What-if planned score input (default 85%)
  const [whatIfScore, setWhatIfScore] = useState<number>(() => {
    if (
      assessment?.achievedScore != null &&
      assessment?.maxScore != null &&
      assessment.maxScore > 0
    ) {
      return Math.round((assessment.achievedScore / assessment.maxScore) * 100);
    }
    return 85;
  });

  if (!assessment) {
    return (
      <div className="p-6 text-center text-[var(--text-muted)]">
        <p>Assessment not found.</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 px-4 py-2 bg-[var(--surface-hover)] rounded-xl text-sm font-semibold"
        >
          {copy.common.close}
        </button>
      </div>
    );
  }

  const palette = coursePalette(assessment.courseId || "GENERAL");
  const rawTopics =
    assessment.topics?.length > 0 ? assessment.topics : rec?.topics?.map((t) => t.title) || [];
  const completedTopicsCount = rec?.topics?.filter((t) => t.completed).length || 0;
  const totalTopicsCount = rawTopics.length;

  const handleSaveGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedScore = scoreInput.trim() !== "" ? parseFloat(scoreInput) : null;
    const parsedMax = maxInput.trim() !== "" ? parseFloat(maxInput) : null;
    const parsedWeight = weightInput.trim() !== "" ? parseFloat(weightInput) : null;

    if (parsedScore !== null && parsedScore < 0) {
      addToast({ type: "error", message: "Score cannot be negative." });
      return;
    }
    if (parsedMax !== null && parsedMax <= 0) {
      addToast({ type: "error", message: "Max score must be greater than 0." });
      return;
    }
    if (parsedScore !== null && parsedMax !== null && parsedScore > parsedMax) {
      addToast({ type: "error", message: "Achieved score cannot exceed max score." });
      return;
    }
    if (parsedWeight !== null && (parsedWeight < 0 || parsedWeight > 100)) {
      addToast({ type: "error", message: "Course weightage must be between 0% and 100%." });
      return;
    }

    await saveGrade(assessment.id, {
      achievedScore: parsedScore,
      maxScore: parsedMax,
      weightagePercent: parsedWeight,
    });
  };

  const whatIf = calculateWhatIf(assessment, assessments, whatIfScore);
  const isGraded = assessment.achievedScore != null && assessment.maxScore != null;

  return (
    <div
      data-testid="assessment-detail-modal"
      className="relative max-h-[85vh] overflow-y-auto -m-6 p-6 space-y-6 text-[var(--text)]"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={copy.common.close}
        className="absolute right-4 top-5 z-10 rounded-lg p-1 text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Course Color Header Bar */}
      <div
        className="h-3 w-full -mt-6 -mx-6 mb-4 rounded-t-2xl"
        style={{ backgroundColor: palette.color }}
      />

      {/* Header Info */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="px-2.5 py-0.5 rounded-full text-xs font-bold shadow-2xs"
            style={{ backgroundColor: palette.bg, color: palette.color }}
          >
            {assessment.courseId || "Course"}
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-red-600/10 text-red-600 dark:text-red-400 text-xs font-bold">
            {assessment.assessmentType}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-[var(--surface-hover)] text-[var(--text-muted)] text-[11px] font-semibold">
            {assessment.source || copy.assessmentDetail.defaultSource}
          </span>
          {isGraded ? (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold">
              {copy.assessmentDetail.recordedStatus(
                assessment.achievedScore!,
                assessment.maxScore!,
                assessment.weightagePercent,
              )}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-slate-500/15 text-[var(--text-muted)] text-[11px] font-semibold">
              {copy.assessmentDetail.notGradedStatus}
            </span>
          )}
        </div>

        <h1 className="text-xl font-bold tracking-tight text-[var(--text)]">{assessment.title}</h1>
        {assessment.courseName && (
          <p className="text-xs text-[var(--text-muted)]">{assessment.courseName}</p>
        )}
      </div>

      {/* Facts Card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-hover)] p-3.5 text-xs">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-[var(--accent)] shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <span className="text-[10px] text-[var(--text-muted)] block font-semibold">
              {copy.assessmentDetail.dateLabel}
            </span>
            <span className="font-semibold text-[var(--text)] truncate block">
              {assessment.dateIso || copy.assessmentDetail.missingValue}{" "}
              {assessment.displayTime ? `(${assessment.displayTime})` : ""}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-[var(--accent)] shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <span className="text-[10px] text-[var(--text-muted)] block font-semibold">
              {copy.assessmentDetail.roomLabel}
            </span>
            <span className="font-semibold text-[var(--text)] truncate block">
              {assessment.room ? `Room ${assessment.room}` : copy.assessmentDetail.missingValue}
              {assessment.group ? ` (${assessment.group})` : ""}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-[var(--accent)] shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <span className="text-[10px] text-[var(--text-muted)] block font-semibold">
              {copy.assessmentDetail.instructorLabel}
            </span>
            <span className="font-semibold text-[var(--text)] truncate block">
              {assessment.instructor || copy.assessmentDetail.missingValue}
            </span>
          </div>
        </div>
      </div>

      {/* Warnings & Alerts */}
      {(assessment.warnings?.length > 0 || assessment.conflictWarning) && (
        <div className="space-y-1.5 rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle
              className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0"
              aria-hidden="true"
            />
            <span>{copy.assessmentDetail.warningsHeader}</span>
          </div>
          <div className="space-y-1 pl-5">
            {assessment.conflictWarning && (
              <p className="font-semibold">{copy.assessmentDetail.examOverloadWarning}</p>
            )}
            {assessment.warnings?.map((w, idx) => (
              <p key={idx}>• {w}</p>
            ))}
          </div>
        </div>
      )}

      {/* Topics Syllabus with Optimistic Toggle */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold tracking-wide uppercase text-[var(--text-muted)]">
            {copy.assessmentDetail.topicsHeader}
          </h2>
          <span className="text-xs font-semibold text-[var(--text-muted)]">
            {copy.assessmentDetail.topicsProgress(completedTopicsCount, totalTopicsCount)}
          </span>
        </div>

        {totalTopicsCount > 0 ? (
          <div className="space-y-1.5">
            {rawTopics.map((topic, idx) => {
              const isDone = rec?.topics?.find((t) => t.topicIndex === idx)?.completed ?? false;
              return (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-2.5 transition hover:bg-[var(--surface-hover)] gap-2"
                >
                  <label className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={() => toggleTopic(assessment.id, idx)}
                      className="h-4 w-4 rounded accent-[var(--accent)] cursor-pointer shrink-0"
                    />
                    <span
                      className={`text-xs transition ${
                        isDone
                          ? "line-through text-[var(--text-muted)]"
                          : "font-medium text-[var(--text)]"
                      }`}
                    >
                      {topic}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)] italic">
            No explicit syllabus topics extracted.
          </p>
        )}
      </div>

      {/* Study Strategy / Guidance */}
      <div className="space-y-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-hover)] p-3 text-xs">
        <div className="flex items-center gap-1.5 font-bold text-[var(--accent)]">
          <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{copy.assessmentDetail.studyStrategyHeader}</span>
        </div>
        <p className="text-[var(--text)] leading-relaxed">
          {rec?.whyStudyNow ||
            assessment.aiInferenceNote ||
            copy.assessmentDetail.aiGuidanceFallback}
        </p>
        {assessment.aiStudyPlan && (
          <p className="text-[var(--text-muted)] leading-relaxed mt-1">{assessment.aiStudyPlan}</p>
        )}
      </div>

      {/* Actions: Google Calendar & ICS Export */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold tracking-wide uppercase text-[var(--text-muted)]">
          {copy.assessmentDetail.actionsHeader}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {assessment.gcalSynced ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
              <CheckCircle className="h-4 w-4" aria-hidden="true" />
              <span>{copy.assessmentDetail.addedToGcal}</span>
            </div>
          ) : assessment.googleCalUrl ? (
            <a
              href={assessment.googleCalUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text)] transition"
            >
              <Calendar className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
              <span>{copy.assessmentDetail.addToGcal}</span>
            </a>
          ) : null}

          <button
            type="button"
            onClick={() => exportIcs(assessment.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text)] transition cursor-pointer"
          >
            <Download className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
            <span>{copy.assessmentDetail.exportIcs}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              openPomodoro({ assessmentId: assessment.id });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text)] transition cursor-pointer"
          >
            <Clock className="h-4 w-4 text-amber-500" aria-hidden="true" />
            <span>{copy.assessmentDetail.pomodoroAction}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              openPracticeQuiz(assessment.id);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text)] transition cursor-pointer"
          >
            <HelpCircle className="h-4 w-4 text-purple-500" aria-hidden="true" />
            <span>{copy.practice.practiceQuizAction}</span>
          </button>

          {assessment.elearningUrl && (
            <a
              href={assessment.elearningUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text)] transition"
            >
              <ExternalLink className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
              <span>{copy.assessmentDetail.elearningLink}</span>
            </a>
          )}
        </div>
      </div>

      {/* Grade Editor & What-If Projection */}
      <div className="space-y-4 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-4">
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--text)]">
          <Calculator className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
          <span>{copy.assessmentDetail.gradeEditorHeader}</span>
        </div>

        <form onSubmit={handleSaveGrade} className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-[var(--text-muted)] block mb-1">
                {copy.assessmentDetail.achievedScoreLabel}
              </label>
              <input
                type="number"
                step="any"
                value={scoreInput}
                onChange={(e) => setScoreInput(e.target.value)}
                placeholder="e.g. 18.5"
                className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--page)] px-2.5 py-1.5 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] font-semibold text-[var(--text-muted)] block mb-1">
                {copy.assessmentDetail.maxScoreLabel}
              </label>
              <input
                type="number"
                step="any"
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                placeholder="e.g. 20"
                className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--page)] px-2.5 py-1.5 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] font-semibold text-[var(--text-muted)] block mb-1">
                {copy.assessmentDetail.weightageLabel}
              </label>
              <input
                type="number"
                step="any"
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                placeholder="e.g. 15"
                className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--page)] px-2.5 py-1.5 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-bold hover:bg-[var(--accent-hover)] transition shadow-2xs cursor-pointer"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{copy.assessmentDetail.saveGradeAction}</span>
            </button>
          </div>
        </form>

        {/* What-If Projector */}
        <div className="pt-3 border-t border-[var(--surface-border)] space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[var(--text)]">
              {copy.assessmentDetail.whatIfHeader}
            </span>
            <span className={`font-bold tabular-nums text-sm ${whatIf.scoreColorClass}`}>
              {copy.assessmentDetail.whatIfResult(whatIf.projectedAvg)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-[11px] text-[var(--text-muted)] shrink-0">
              {copy.assessmentDetail.whatIfScoreInputLabel}
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={whatIfScore}
              onChange={(e) => setWhatIfScore(parseInt(e.target.value, 10) || 0)}
              className="w-20 rounded-lg border border-[var(--surface-border)] bg-[var(--page)] px-2 py-1 text-xs tabular-nums text-[var(--text)] focus:border-[var(--accent)] focus:outline-none text-right"
            />
          </div>

          <div className="text-[10px] text-[var(--text-muted)]">
            <p>
              {whatIf.isFirstGraded
                ? copy.assessmentDetail.whatIfFirstItem
                : copy.assessmentDetail.whatIfEqualWeight(whatIf.gradedCount + 1)}{" "}
              {copy.assessmentDetail.whatIfNote}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
